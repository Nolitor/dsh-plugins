/**
 * Cost parsing and per-session spend.
 *
 * The fixtures below are the payloads measured on the live Go root on 2026-11-04
 * (test/live/cost-capture.mjs and test/live/cost-cache-probe.mjs), quoted
 * verbatim apart from the whitespace. Nothing here is invented: the field names,
 * the 0-vs-absent distinction and the plan-burn semantics come from the wire.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { describeCost, parseCost, createCostLedger, numberOrNull } from '../lib/cost.js'

/** Measured: streaming final chunk, deepseek-v4.1-flash on the Go root. */
const GO_USAGE = {
  prompt_tokens: 32,
  completion_tokens: 8,
  total_tokens: 40,
  prompt_tokens_details: { cached_tokens: 0 },
  completion_tokens_details: { reasoning_tokens: 0 },
  cost: 0,
  opencode: {
    billing_source: 'go-plus',
    list_cost: 0.0000096,
    allowance: 0.00001152,
    tokens: { input: 32, output: 8, reasoning: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 },
  },
}

/** Measured: the long-prefix probe, same route, larger prompt. */
const GO_LONG = {
  prompt_tokens: 6033,
  completion_tokens: 4,
  cost: 0,
  opencode: {
    billing_source: 'go-plus',
    list_cost: 0.00090735,
    allowance: 0.00108882,
    tokens: { input: 6033, output: 4, reasoning: 4, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 },
  },
}

/** The documented balance shape (console docs) — the fields the wire adds for paid use. */
const BALANCE_USAGE = {
  prompt_tokens: 1200,
  completion_tokens: 300,
  cost: 0.00412,
  opencode: {
    billing_source: 'balance',
    list_cost: 0.00412,
    tokens: { input: 1200, output: 300, reasoning: 120, cache_read: 8000, cache_write_5m: 0, cache_write_1h: 0 },
  },
}

test('the measured Go payload parses to a zero charge with a real plan burn', () => {
  const cost = parseCost(GO_USAGE)
  assert.equal(cost.costUsd, 0, 'Go usage inside its limit charges nothing')
  assert.equal(cost.listCostUsd, 0.0000096)
  assert.equal(cost.allowanceUsd, 0.00001152)
  assert.equal(cost.billingSource, 'go-plus')
  assert.equal(cost.planSource, true, 'go-plus consumes the monthly allowance')
  assert.equal(cost.estimated, false)
  assert.deepEqual(cost.tokens, { input: 32, output: 8, reasoning: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 })
})

test('billed tokens come from opencode.tokens, not the derived top-level counters', () => {
  // The balance payload charges for 1200 input + 300 output and separately
  // reports 8000 cache reads: input excludes cache, output includes reasoning.
  const cost = parseCost(BALANCE_USAGE)
  assert.equal(cost.tokens.input, 1200)
  assert.equal(cost.tokens.output, 300)
  assert.equal(cost.tokens.reasoning, 120)
  assert.equal(cost.tokens.cacheRead, 8000)
  // The top-level prompt_tokens (1200) is NOT the billed input of a cached call;
  // taking it would double-count nothing but would hide the cache line entirely.
  assert.notEqual(cost.tokens.input, BALANCE_USAGE.prompt_tokens + 8000)
})

test('a balance charge is not a plan burn even when allowance is present', () => {
  const cost = parseCost(BALANCE_USAGE)
  assert.equal(cost.planSource, false, 'balance spend does not consume a Go allowance')
  assert.equal(parseCost({ opencode: { billing_source: 'byok', allowance: 5 } }).planSource, false)
  assert.equal(parseCost({ opencode: { billing_source: 'free', allowance: 5 } }).planSource, false)
})

test('an absent price stays absent instead of becoming a fabricated zero', () => {
  // "absent when the model has no price" — 0 means free, missing means unpriced.
  const cost = parseCost({ prompt_tokens: 10, completion_tokens: 2 })
  assert.equal(cost.costUsd, null)
  assert.equal(cost.listCostUsd, null)
  assert.equal(cost.allowanceUsd, null)
  assert.equal(cost.billingSource, null)
  assert.equal(cost.tokens, null)
  assert.equal(numberOrNull(undefined), null)
  assert.equal(numberOrNull(''), null)
  assert.equal(numberOrNull('abc'), null)
  assert.equal(numberOrNull(0), 0, 'zero is a real answer')
  assert.equal(numberOrNull('0.5'), 0.5)
})

test('estimated is only true when the wire says so', () => {
  assert.equal(parseCost({ cost: 1, opencode: { billing_source: 'byok', estimated: true } }).estimated, true)
  assert.equal(parseCost({ cost: 1, opencode: { billing_source: 'byok' } }).estimated, false)
  assert.equal(parseCost(BALANCE_USAGE).estimated, false)
})

test('the session ledger sums cost, plan burn and per-model spend', () => {
  let clock = 1_000
  const ledger = createCostLedger({ now: () => (clock += 1) })
  ledger.record('session-a', 'opencode-go/deepseek-v4.1-flash', parseCost(GO_USAGE))
  ledger.record('session-a', 'opencode-go/deepseek-v4.1-flash', parseCost(GO_LONG))
  ledger.record('session-b', 'opencode/claude-opus-5-5', parseCost(BALANCE_USAGE))
  ledger.record('session-b', 'opencode/beam-free', parseCost({ prompt_tokens: 1, completion_tokens: 1 }))

  const a = ledger.session('session-a')
  assert.equal(a.requests, 2)
  assert.equal(a.costUsd, 0, 'Go usage inside its limit costs nothing in dollars')
  assert.equal(a.allowanceUsd, 0.00001152 + 0.00108882, 'the plan burn still adds up')
  assert.equal(a.pricedRequests, 2)
  assert.equal(a.unpricedRequests, 0)
  assert.equal(a.byModel['opencode-go/deepseek-v4.1-flash'].requests, 2)
  assert.equal(a.lastBillingSource, 'go-plus')

  const b = ledger.session('session-b')
  assert.equal(b.requests, 2)
  assert.equal(b.costUsd, 0.00412, 'only the balance request charged dollars')
  assert.equal(b.allowanceUsd, 0, 'a balance charge does not touch the Go allowance')
  assert.equal(b.unpricedRequests, 1, 'the free bill with no price field is counted apart')
  assert.deepEqual(Object.keys(b.bySource).sort(), ['balance'])

  const summary = ledger.summary()
  assert.equal(summary.sessions, 2)
  assert.equal(summary.requests, 4)
  assert.equal(summary.costUsd, 0.00412)
  assert.equal(summary.listCostUsd, 0.0000096 + 0.00090735 + 0.00412)
  assert.equal(summary.allowanceUsd, 0.00001152 + 0.00108882)
  // Most recent session first, so an operator reads the live one at the top.
  assert.equal(summary.bySession[0].sessionId, 'session-b')
})

test('a stream without a session id still lands in a bucket', () => {
  const ledger = createCostLedger()
  ledger.record(undefined, 'opencode-go/x', parseCost(GO_USAGE))
  assert.equal(ledger.session('(no session)').requests, 1)
  ledger.reset()
  assert.equal(ledger.summary().sessions, 0)
})

test('the diagnostic line names every measured field', () => {
  const line = describeCost(parseCost(GO_USAGE))
  assert.match(line, /go-plus/)
  assert.match(line, /cost=0/)
  assert.match(line, /list=0\.0000096/)
  assert.match(line, /plan=0\.00001152/)
  assert.match(line, /in=32/)
  assert.match(line, /out=8/)
})
