/**
 * Shared cost core: bucket union, discount maths, ledger merge idempotency, and
 * an atomic store round-trip.
 *
 * The parity fixtures at the bottom are RECORDED JSON SHAPES copied out of the
 * two vendored ledgers (`deepinfra-session-cost.json`, `opencode-session-cost.json`).
 * They are literals on purpose: this test must never import a vendor module, and
 * must keep passing after Phase 2 deletes those modules.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import * as fs from 'node:fs'

import {
  LEDGER_VERSION,
  TOKEN_BUCKETS,
  calculateCost,
  cacheWriteTotal,
  createCostLedger,
  createCostStore,
  normalizeBuckets,
  normalizeUsage,
  numberOrNull,
  pickSession,
  ratesFor,
} from '../lib/cost.js'

/* ---------------------------------------------------------------- *
 * helpers
 * ---------------------------------------------------------------- */

/** A monotonic clock, so `lastAt` ordering is deterministic. */
function clock(start = 1_700_000_000_000) {
  let tick = start
  return () => (tick += 1000)
}

/** A deep-clone that also normalizes `undefined`, for snapshot comparisons. */
const clone = (value) => JSON.parse(JSON.stringify(value))

/* ---------------------------------------------------------------- *
 * bucket union / clamping
 * ---------------------------------------------------------------- */

test('bucket union: both cache conventions land on one bucket set', () => {
  // DeepInfra's convention: one undifferentiated write total.
  const di = normalizeBuckets({ input: 10, output: 2, reasoning: 1, cacheRead: 3, cacheWrite: 8 })
  assert.deepEqual(di, {
    input: 10, output: 2, reasoning: 1, cacheRead: 3, cacheWrite5m: 8, cacheWrite1h: 0,
  })

  // OpenCode's convention: an explicit 5m/1h split.
  const oc = normalizeBuckets({
    input: 32, output: 8, reasoning: 0, cache_read: 4, cache_write_5m: 6, cache_write_1h: 2,
  })
  assert.deepEqual(oc, {
    input: 32, output: 8, reasoning: 0, cacheRead: 4, cacheWrite5m: 6, cacheWrite1h: 2,
  })

  // Every canonical bucket is always present and numeric, so a renderer never
  // has to guard for a missing key.
  assert.deepEqual(Object.keys(oc).sort(), [...TOKEN_BUCKETS].sort())
  assert.deepEqual(
    Object.keys(normalizeBuckets()).sort(),
    [...TOKEN_BUCKETS].sort(),
  )
  assert.equal(cacheWriteTotal(di), 8)
  assert.equal(cacheWriteTotal(oc), 8)
})

test('bucket union: the 1h split is clamped to the reported write total', () => {
  // 1h greater than the total is impossible on the wire; the surplus is dropped,
  // never turned into a negative 5m bucket.
  const clamped = normalizeBuckets({ cacheWrite: 5, cacheWrite1h: 9 })
  assert.deepEqual(
    { '5m': clamped.cacheWrite5m, '1h': clamped.cacheWrite1h },
    { '5m': 0, '1h': 5 },
  )
  assert.equal(cacheWriteTotal(clamped), 5)

  // A 1h share inside the total leaves the remainder as the 5m bucket.
  const split = normalizeBuckets({ cacheWrite: 10, cacheWrite1h: 4 })
  assert.deepEqual({ '5m': split.cacheWrite5m, '1h': split.cacheWrite1h }, { '5m': 6, '1h': 4 })
})

test('bucket union: unusable counters become 0, never NaN or negative', () => {
  const hostile = normalizeBuckets({
    input: -5, output: 'x', reasoning: Number.NaN, cacheRead: Infinity,
    cacheWrite: 4, cacheWrite1h: -2,
  })
  assert.deepEqual(hostile, {
    input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite5m: 4, cacheWrite1h: 0,
  })
  assert.deepEqual(normalizeBuckets(null), normalizeBuckets({}))
  assert.deepEqual(normalizeBuckets(undefined), normalizeBuckets({}))
})

test('numberOrNull keeps 0 as an answer and rejects absent values', () => {
  assert.equal(numberOrNull(0), 0)
  assert.equal(numberOrNull('1.5'), 1.5)
  assert.equal(numberOrNull(null), null)
  assert.equal(numberOrNull(undefined), null)
  assert.equal(numberOrNull(''), null)
  assert.equal(numberOrNull('abc'), null)
  assert.equal(numberOrNull(Number.POSITIVE_INFINITY), null)
})

/* ---------------------------------------------------------------- *
 * discount maths (unchanged public exports)
 * ---------------------------------------------------------------- */

test('discount maths: a 1h cache write bills at 2x the input rate', () => {
  const rates = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }
  // Same total write volume, different split: the 1h share must cost double.
  const allShort = calculateCost(rates, { input: 0, output: 0, cacheWrite: 1_000_000, cacheWrite1h: 0 })
  const allLong = calculateCost(rates, { input: 0, output: 0, cacheWrite: 1_000_000, cacheWrite1h: 1_000_000 })
  const half = calculateCost(rates, { input: 0, output: 0, cacheWrite: 1_000_000, cacheWrite1h: 500_000 })
  assert.equal(allShort.cacheWrite, 12.5)
  assert.equal(allLong.cacheWrite, 20)
  assert.equal(half.cacheWrite, 16.25)
  assert.equal(allLong.total, 20)
})

test('discount maths: tiers and the unchanged exports still behave', () => {
  const tiered = {
    input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5,
    tiers: [{ inputTokensAbove: 200_000, input: 20, output: 100, cacheRead: 2, cacheWrite: 25 }],
  }
  assert.equal(ratesFor(tiered, 100_000), tiered)
  assert.equal(ratesFor(tiered, 300_000).input, 20)
  // 300k input tokens at the tiered $20/1M rate; the float sum is not exact.
  assert.ok(Math.abs(calculateCost(tiered, { input: 300_000, output: 1_000 }).input - 6) < 1e-9)
  assert.deepEqual(normalizeUsage({ inputTokens: 5, outputTokens: 2 }), {
    input: 5, output: 2, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0,
  })
  assert.equal(calculateCost({ input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }).totalFromProvider, false)
})

/* ---------------------------------------------------------------- *
 * ledger
 * ---------------------------------------------------------------- */

test('ledger: partitions by session, model, source and turn', () => {
  const ledger = createCostLedger({ now: clock() })
  ledger.record('session-a', 'deepinfra/moonshotai/Kimi-K2', {
    costUsd: 0.00000182, listCostUsd: 0.0000026, billingSource: 'balance',
    tokens: { input: 7, output: 2, cacheRead: 0, cacheWrite: 0 },
  }, { turn: 0 })
  ledger.record('session-a', 'opencode/glm', {
    costUsd: 0, listCostUsd: 0.0000096, allowanceUsd: 0.00001152, billingSource: 'go-plus', planSource: true,
    tokens: { input: 32, output: 8, cache_write_5m: 4 },
  }, { turn: 1 })

  const summary = ledger.summary()
  assert.equal(summary.sessions, 1)
  assert.equal(summary.requests, 2)
  assert.equal(summary.costUsd, 0.00000182)
  assert.equal(summary.listCostUsd, 0.0000122)
  assert.equal(summary.allowanceUsd, 0.00001152)

  const entry = ledger.session('session-a')
  assert.equal(entry.pricedRequests, 2)
  assert.equal(entry.unpricedRequests, 0)
  assert.equal(entry.byModel['opencode/glm'].requests, 1)
  assert.equal(entry.byModel['opencode/glm'].tokens.cacheWrite5m, 4)
  assert.deepEqual(Object.keys(entry.bySource).sort(), ['balance', 'go-plus'])
  assert.equal(entry.bySource['go-plus'].allowanceUsd, 0.00001152)
  assert.deepEqual(Object.keys(entry.turns).sort(), ['0', '1'])
  assert.equal(entry.turns['1'].tokens.input, 32)
})

test('ledger: an unpriced request is counted, not billed as zero', () => {
  const ledger = createCostLedger({ now: clock() })
  ledger.record('s', 'm', { costUsd: null, tokens: { input: 10 } })
  ledger.record('s', 'm', { costUsd: 0.5, tokens: { input: 10 } })
  const entry = ledger.session('s')
  assert.equal(entry.unpricedRequests, 1)
  assert.equal(entry.pricedRequests, 1)
  assert.equal(entry.costUsd, 0.5)
  assert.equal(entry.tokens.input, 20)
})

test('ledger: merge is additive and re-merging the same snapshot is a no-op', () => {
  const before = createCostLedger({ now: clock() })
  before.record('a', 'm1', { costUsd: 1, tokens: { input: 10, cacheWrite: 4, cacheWrite1h: 1 } }, { turn: 0 })
  before.record('b', 'm2', { costUsd: 2, listCostUsd: 4, tokens: { input: 20, cache_write_5m: 3 } })
  const snapshot = clone(before.snapshot())

  const ledger = createCostLedger({ now: clock() })
  const first = ledger.merge(snapshot)
  assert.equal(first.merged, true)
  const once = clone(ledger.summary())

  // Same snapshot, three more times: nothing changes.
  for (let i = 0; i < 3; i += 1) assert.equal(ledger.merge(snapshot).merged, false)
  assert.deepEqual(clone(ledger.summary()), once)

  assert.equal(once.sessions, 2)
  assert.equal(once.costUsd, 3)
  assert.equal(once.listCostUsd, 4)
  // The un-split write total became a 5m bucket exactly once.
  assert.equal(ledger.session('a').tokens.cacheWrite5m, 3)
  assert.equal(ledger.session('a').tokens.cacheWrite1h, 1)
  assert.equal(ledger.session('b').tokens.cacheWrite5m, 3)
})

test('ledger: a snapshot without savedAt merges once by structural identity', () => {
  const ledger = createCostLedger({ now: clock() })
  const bare = { sessions: { s: { requests: 2, costUsd: 0.5, tokens: { input: 8 } } } }
  assert.equal(ledger.merge(bare).merged, true)
  assert.equal(ledger.merge(clone(bare)).merged, false)
  assert.equal(ledger.session('s').requests, 2)
  assert.equal(ledger.summary().costUsd, 0.5)
})

test('ledger: record-level eventId makes a re-reported request idempotent', () => {
  const ledger = createCostLedger({ now: clock() })
  const cost = { eventId: 'evt-1', costUsd: 0.25, tokens: { input: 5 } }
  const first = ledger.record('s', 'm', cost)
  const second = ledger.record('s', 'm', cost)
  assert.equal(first.duplicate, false)
  assert.equal(second.duplicate, true)
  assert.equal(ledger.session('s').requests, 1)
  assert.equal(ledger.session('s').costUsd, 0.25)
  // A different id bills normally.
  ledger.record('s', 'm', { eventId: 'evt-2', costUsd: 0.25, tokens: { input: 5 } })
  assert.equal(ledger.session('s').requests, 2)
})

test('ledger: summary order is newest-first and reset forgets a session only', () => {
  const ledger = createCostLedger({ now: clock() })
  ledger.record('old', 'm', { costUsd: 1 })
  ledger.record('new', 'm', { costUsd: 2 })
  assert.deepEqual(ledger.summary().bySession.map((row) => row.sessionId), ['new', 'old'])
  assert.equal(pickSession(ledger.summary(), null).sessionId, 'new')
  assert.equal(pickSession(ledger.summary(), 'session-old').sessionId, 'old')

  ledger.reset('new')
  assert.equal(ledger.session('new'), null)
  assert.equal(ledger.session('old').costUsd, 1)
  ledger.reset()
  assert.equal(ledger.summary().sessions, 0)
})

test('pickSession: exact id wins over recency, including the session- prefix', () => {
  const summary = {
    bySession: [
      { sessionId: 'session-alpha', lastAt: 10, costUsd: 1 },
      { sessionId: 'beta', lastAt: 99, costUsd: 2 },
    ],
  }
  assert.equal(pickSession(summary, 'session-alpha').costUsd, 1)
  assert.equal(pickSession(summary, 'alpha').costUsd, 1)
  assert.equal(pickSession(summary, 'gamma').costUsd, 2)
  assert.equal(pickSession(summary, null).costUsd, 2)
  assert.equal(pickSession({ bySession: [] }, 'x'), null)
  assert.equal(pickSession(null, 'x'), null)
})

/* ---------------------------------------------------------------- *
 * store round-trip
 * ---------------------------------------------------------------- */

test('store: round-trips through a real temp dir, creating parents', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cost-store-'))
  try {
    const path = join(dir, 'nested', 'ledger.json')
    const store = createCostStore({ path, fs, now: () => 1_700_000_000_000 })
    assert.equal(store.path, path)
    assert.equal(store.read(), null, 'a missing file is "nothing measured yet"')

    const ledger = createCostLedger({ now: clock() })
    ledger.record('session-a', 'm', { costUsd: 0.5, tokens: { input: 10, cacheWrite: 2 } }, { turn: 3 })
    const snapshot = ledger.snapshot()
    assert.equal(snapshot.version, LEDGER_VERSION)
    assert.equal(store.write(snapshot), true)

    // The file is real JSON and carries no temp sibling.
    const onDisk = JSON.parse(readFileSync(path, 'utf8'))
    assert.equal(onDisk.sessions['session-a'].costUsd, 0.5)
    // `clock()` ticked once for the record and once for `snapshot()`.
    assert.equal(onDisk.savedAt, '2023-11-14T22:13:22.000Z')
    assert.equal(fs.readdirSync(join(dir, 'nested')).length, 1)

    // Read back and merge: the bill survives a restart.
    const reopened = createCostLedger({ now: clock() })
    assert.equal(reopened.merge(store.read()).merged, true)
    assert.equal(reopened.session('session-a').costUsd, 0.5)
    assert.equal(reopened.session('session-a').tokens.cacheWrite5m, 2)
    assert.equal(reopened.session('session-a').turns['3'].requests, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('store: corrupt state and a missing fs read as null instead of throwing', () => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-cost-corrupt-'))
  try {
    const path = join(dir, 'ledger.json')
    writeFileSync(path, '{ not json at all')
    const store = createCostStore({ path, fs })
    assert.equal(store.read(), null)
    writeFileSync(path, JSON.stringify({ sessions: null }))
    assert.equal(store.read(), null)

    // No fs adapter and no path: inert, never a crash.
    const inert = createCostStore({})
    assert.equal(inert.path, '')
    assert.equal(inert.read(), null)
    assert.equal(inert.write({ sessions: {} }), false)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

/* ---------------------------------------------------------------- *
 * parity fixtures — recorded vendor ledger shapes, literals only
 * ---------------------------------------------------------------- */

/** `deepinfra-session-cost.json` as recorded 2026-11-05 (shape verbatim). */
const DEEPINFRA_FILE = {
  version: 1,
  sessions: {
    'session-di': {
      requests: 2,
      costUsd: 0.00000364,
      listCostUsd: 0.0000052,
      pricedRequests: 2,
      unpricedRequests: 0,
      byModel: {
        'deepinfra/moonshotai/Kimi-K2-Instruct': {
          requests: 2, costUsd: 0.00000364, listCostUsd: 0.0000052,
          tokens: { input: 14, output: 4, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        },
      },
      turns: {
        0: { requests: 1, costUsd: 0.00000182, listCostUsd: 0.0000026, tokens: { input: 7, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 } },
      },
      tokens: { input: 14, output: 4, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
      lastAt: 1762300001000,
      firstAt: 1762300000000,
    },
  },
  recent: [{
    at: 1762300000000, sessionId: 'session-di', model: 'deepinfra/moonshotai/Kimi-K2-Instruct', turn: '0',
    costUsd: 0.00000182, listCostUsd: 0.0000026, costSource: 'provider',
    tokens: { input: 7, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
  }],
  savedAt: '2026-11-05T01:00:01.000Z',
}

/** `opencode-session-cost.json` as recorded 2026-11-04 (shape verbatim). */
const OPENCODE_FILE = {
  sessions: {
    'session-oc': {
      requests: 1,
      costUsd: 0,
      listCostUsd: 0.0000096,
      allowanceUsd: 0.00001152,
      pricedRequests: 1,
      unpricedRequests: 0,
      estimatedRequests: 0,
      byModel: {
        'opencode/glm-4.6': {
          requests: 1, costUsd: 0, listCostUsd: 0.0000096, allowanceUsd: 0.00001152,
          tokens: { input: 32, output: 8, reasoning: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
        },
      },
      bySource: { 'go-plus': 1 },
      tokens: { input: 32, output: 8, reasoning: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
      lastAt: 1762200001000,
      lastBillingSource: 'go-plus',
    },
  },
  savedAt: '2026-11-04T01:00:01.000Z',
}

test('parity: the deepinfra ledger file merges with its figures intact', () => {
  const ledger = createCostLedger({ now: clock() })
  assert.equal(ledger.merge(clone(DEEPINFRA_FILE)).merged, true)
  const entry = ledger.session('session-di')
  assert.equal(entry.requests, 2)
  assert.equal(entry.costUsd, 0.00000364)
  assert.equal(entry.listCostUsd, 0.0000052)
  assert.equal(entry.tokens.input, 14)
  assert.equal(entry.tokens.cacheWrite5m, 0)
  assert.equal(entry.byModel['deepinfra/moonshotai/Kimi-K2-Instruct'].requests, 2)
  assert.equal(entry.turns['0'].costUsd, 0.00000182)
  assert.equal(entry.firstAt, 1762300000000)
  assert.equal(entry.lastAt, 1762300001000)
  // A second merge of the same file adds nothing.
  assert.equal(ledger.merge(clone(DEEPINFRA_FILE)).merged, false)
  assert.equal(ledger.summary().costUsd, 0.00000364)
})

test('parity: the opencode ledger file keeps allowance and source counts', () => {
  const ledger = createCostLedger({ now: clock() })
  assert.equal(ledger.merge(clone(OPENCODE_FILE)).merged, true)
  const entry = ledger.session('session-oc')
  assert.equal(entry.costUsd, 0)
  assert.equal(entry.listCostUsd, 0.0000096)
  assert.equal(entry.allowanceUsd, 0.00001152)
  assert.equal(entry.lastBillingSource, 'go-plus')
  assert.equal(entry.tokens.input, 32)
  // The legacy count map is read as "that many requests", not as a dollar figure.
  assert.equal(entry.bySource['go-plus'].requests, 1)
  assert.equal(ledger.summary().allowanceUsd, 0.00001152)
  assert.equal(ledger.merge(clone(OPENCODE_FILE)).merged, false)
})

test('parity: both vendor files coexist in one ledger without erasing each other', () => {
  const ledger = createCostLedger({ now: clock() })
  ledger.merge(clone(DEEPINFRA_FILE))
  ledger.merge(clone(OPENCODE_FILE))
  const summary = ledger.summary()
  assert.equal(summary.sessions, 2)
  assert.equal(summary.requests, 3)
  assert.equal(summary.costUsd, 0.00000364)
  assert.equal(summary.listCostUsd, 0.0000148)
  assert.equal(summary.allowanceUsd, 0.00001152)
  assert.deepEqual(summary.bySession.map((row) => row.sessionId), ['session-di', 'session-oc'])
  assert.equal(pickSession(summary, 'session-oc').allowanceUsd, 0.00001152)

  // And the merged ledger's own snapshot re-reads as a single additive file.
  const reparsed = createCostLedger({ now: clock() })
  reparsed.merge(clone(ledger.snapshot()))
  assert.equal(reparsed.summary().costUsd, 0.00000364)
  assert.equal(reparsed.summary().allowanceUsd, 0.00001152)
})
