import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as core from '../../../lib/cost.js'
import {
  COST_FILE_NAME,
  LEDGER_VERSION,
  createCostLedger,
  createCostStore,
  formatCost,
  numberOrNull,
  parseCost,
  pickSession,
} from '../lib/cost.js'

/**
 * The provider's real usage object, captured 2026-11-04 from
 * deepseek-ai/DeepSeek-V4.1-Flash (catalog $0.20/$0.60 per Mtok, discount 0.30).
 */
const MEASURED = {
  prompt_tokens: 7,
  total_tokens: 9,
  completion_tokens: 2,
  estimated_cost: 0.00000182,
  prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: null },
  completion_tokens_details: { reasoning_tokens: 0 },
}

test('the provider cost field is used verbatim', () => {
  const cost = parseCost(MEASURED)
  assert.equal(cost.costUsd, 0.00000182)
  assert.equal(cost.costSource, 'provider')
})

test('a missing cost field is null, never a fabricated zero', () => {
  const cost = parseCost({ prompt_tokens: 5, completion_tokens: 1 })
  assert.equal(cost.costUsd, null)
  assert.equal(cost.costSource, null)
})

test('tokens are the billed split: input excludes cache, output includes reasoning', () => {
  // Measured: prompt_tokens is the TOTAL and cached_tokens a subset of it.
  const cost = parseCost({ prompt_tokens: 9612, completion_tokens: 40, prompt_tokens_details: { cached_tokens: 9600 } })
  assert.equal(cost.tokens.input, 12)
  assert.equal(cost.tokens.cacheRead, 9600)
  assert.equal(cost.tokens.input + cost.tokens.cacheRead, 9612)
})

test('absent reasoning_tokens is "not reported", not zero', () => {
  const reported = parseCost(MEASURED)
  assert.equal(reported.reportedReasoning, true)
  const absent = parseCost({ prompt_tokens: 5, completion_tokens: 1 })
  assert.equal(absent.reportedReasoning, false)
  assert.equal(absent.tokens.reasoning, 0)
})

test('the ledger partitions by session, by model and by turn', () => {
  const ledger = createCostLedger()
  ledger.record('session-1', 'deepseek-ai/DeepSeek-V4.1-Flash', parseCost(MEASURED), 1)
  ledger.record('session-1', 'deepseek-ai/DeepSeek-V4.1-Flash', parseCost(MEASURED), 1)
  ledger.record('session-1', 'moonshotai/Kimi-K2.6', parseCost({ prompt_tokens: 100, completion_tokens: 10, estimated_cost: 0.5 }), 2)
  const session = ledger.session('session-1')
  assert.equal(session.requests, 3)
  assert.equal(Number(session.costUsd.toFixed(10)), Number((0.00000182 * 2 + 0.5).toFixed(10)))
  // by model
  assert.equal(session.byModel['deepseek-ai/DeepSeek-V4.1-Flash'].requests, 2)
  assert.equal(session.byModel['moonshotai/Kimi-K2.6'].requests, 1)
  // by turn: two calls in turn 1, one in turn 2
  assert.equal(session.turns['1'].requests, 2)
  assert.equal(session.turns['2'].requests, 1)
})

test('an unpriced request still counts as a request', () => {
  const ledger = createCostLedger()
  ledger.record('s', 'm', parseCost({ prompt_tokens: 5, completion_tokens: 1 }), 1)
  const session = ledger.session('s')
  assert.equal(session.requests, 1)
  assert.equal(session.pricedRequests, 0)
  assert.equal(session.unpricedRequests, 1)
  assert.equal(session.costUsd, 0)
})

test('spend survives a restart through the store', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'dif-cost-'))
  const path = join(dir, 'deepinfra-session-cost.json')
  const store = createCostStore({ path })
  const first = createCostLedger({ store })
  first.record('session-1', 'm', parseCost(MEASURED), 1)
  assert.equal(first.flush(), true)
  // A new process reads the same file.
  const second = createCostLedger({ store: createCostStore({ path }) })
  const session = second.session('session-1')
  assert.equal(session.requests, 1)
  assert.equal(session.costUsd, 0.00000182)
  // The persisted file is real JSON with a version.
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(raw.version, 1)
  assert.ok(raw.sessions['session-1'])
  // Phase 2: the snapshot is the SHARED ledger's, so it names its canonical
  // buckets — a re-forked local ledger would fail this key check.
  assert.deepEqual(raw.buckets, [...core.TOKEN_BUCKETS])
  assert.equal(COST_FILE_NAME, 'deepinfra-session-cost.json')
})

test('the ledger stores BILLED and LIST as separate figures', () => {
  // The operator needs both: the composer chip answers "what did this turn cost
  // me" (billed), and the settings card answers "what would it cost without the
  // promotion" (list). Measured: billed/list = 0.70 on a 30%-discount route.
  const pricing = { input_tokens: 0.2, output_tokens: 0.6, cache_read_tokens: 0.006 }
  const cost = parseCost({ prompt_tokens: 905, completion_tokens: 19, estimated_cost: 0.00013468 }, pricing)
  assert.equal(cost.costUsd, 0.00013468)
  assert.ok(Math.abs(cost.listCostUsd - 0.0001924) < 1e-12)
  assert.ok(Math.abs(cost.costUsd / cost.listCostUsd - 0.7) < 1e-9)

  const ledger = createCostLedger()
  ledger.record('s', 'deepseek-ai/DeepSeek-V4.1-Flash', cost, 1)
  const session = ledger.session('s')
  assert.equal(session.costUsd, 0.00013468)
  assert.ok(Math.abs(session.listCostUsd - 0.0001924) < 1e-12)
  // Both survive into the per-model and per-turn partitions.
  assert.ok(Math.abs(session.byModel['deepseek-ai/DeepSeek-V4.1-Flash'].listCostUsd - 0.0001924) < 1e-12)
  assert.ok(Math.abs(session.turns['1'].listCostUsd - 0.0001924) < 1e-12)
})

test('a route with no published pricing reports list as null, not zero', () => {
  // An unpriced route must not look like a 100% discount.
  const cost = parseCost({ prompt_tokens: 10, completion_tokens: 5, estimated_cost: 0.0001 })
  assert.equal(cost.costUsd, 0.0001)
  assert.equal(cost.listCostUsd, null)
})

test('a record is written to disk IMMEDIATELY, with no pending timer', () => {
  // Measured 2026-11-05: a 1-second debounce with `.unref()` meant a short
  // `dsh headless` run exited before the timer fired, so the ledger file was
  // never created and the usage panel reported zero for work that was billed.
  const dir = mkdtempSync(join(tmpdir(), 'dif-sync-'))
  const path = join(dir, 'deepinfra-session-cost.json')
  const ledger = createCostLedger({ store: createCostStore({ path }) })
  ledger.record('session-fast', 'm', parseCost(MEASURED), 1)
  // No flush(), no timer, no event loop turn: the file must already exist.
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  assert.ok(raw.sessions['session-fast'], 'the record must be on disk synchronously')
  assert.equal(raw.sessions['session-fast'].requests, 1)
  assert.equal(raw.sessions['session-fast'].costUsd, 0.00000182)
})

test('repeated records keep the file current without a flush', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dif-sync2-'))
  const path = join(dir, 'deepinfra-session-cost.json')
  const ledger = createCostLedger({ store: createCostStore({ path }) })
  ledger.record('s', 'm', parseCost(MEASURED), 1)
  ledger.record('s', 'm', parseCost(MEASURED), 1)
  const raw = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(raw.sessions.s.requests, 2)
})

test('a corrupt ledger file is "nothing measured yet", not a crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dif-cost-bad-'))
  const path = join(dir, 'bad.json')
  const store = createCostStore({ path })
  store.write({ broken: true })
  // Wrong shape: read() returns null and the ledger starts empty.
  const ledger = createCostLedger({ store })
  assert.equal(ledger.session('nope'), null)
  assert.equal(ledger.summary().requests, 0)
})

test('pickSession prefers the exact id, then the most recent', () => {
  // Phase 2: the session picker and the number reader are the SHARED ledger's,
  // re-exported by identity — this file's copies were byte-derived from it.
  assert.equal(pickSession, core.pickSession)
  assert.equal(numberOrNull, core.numberOrNull)
  assert.equal(LEDGER_VERSION, core.LEDGER_VERSION)
  const ledger = createCostLedger()
  ledger.record('session-aaa', 'm', parseCost(MEASURED), 1)
  ledger.record('session-bbb', 'm', parseCost({ prompt_tokens: 1, completion_tokens: 1, estimated_cost: 9 }), 1)
  const summary = ledger.summary()
  assert.equal(pickSession(summary, 'session-aaa').sessionId, 'session-aaa')
  // The prefix is optional: the DOM may carry either form.
  assert.equal(pickSession(summary, 'aaa').sessionId, 'session-aaa')
  // Unknown id falls back to the most recent, never to null while spend exists.
  assert.notEqual(pickSession(summary, 'session-zzz'), null)
})

test('formatCost renders a chip figure and hides an empty session', () => {
  assert.equal(formatCost(null), '')
  assert.equal(formatCost({ requests: 0, costUsd: 0 }), '')
  assert.equal(formatCost({ requests: 3, costUsd: 0 }), '$0')
  assert.equal(formatCost({ requests: 1, costUsd: 0.1736 }), '$0.1736')
  // Sub-cent totals keep six decimals so a cheap turn is still visible.
  assert.equal(formatCost({ requests: 1, costUsd: 0.0000182 }), '$0.000018')
})

test('reset clears one session or everything', () => {
  const ledger = createCostLedger()
  ledger.record('a', 'm', parseCost(MEASURED), 1)
  ledger.record('b', 'm', parseCost(MEASURED), 1)
  ledger.reset('a')
  assert.equal(ledger.session('a'), null)
  assert.notEqual(ledger.session('b'), null)
  ledger.reset()
  assert.equal(ledger.summary().sessions, 0)
})

test('the summary exposes recent per-request records newest first', () => {
  const ledger = createCostLedger()
  ledger.record('a', 'model-x', parseCost(MEASURED), 1)
  const summary = ledger.summary()
  assert.equal(summary.recent.length, 1)
  assert.equal(summary.recent[0].model, 'model-x')
  assert.equal(summary.recent[0].turn, '1')
})
