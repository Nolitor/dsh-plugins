/**
 * Plan (subscription/flat) layer: PlanVerdict detection and billing outcome.
 * The invariant that matters: `unknown` never becomes a fabricated `0`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { billingOutcome, buildVerdict, judgePlan, proposeCorrection, tierFromBillingSources } from '../lib/plan.js'

const COST = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 }

test('a loopback preset has no plan service', () => {
  const verdict = judgePlan({ billing: { mode: 'none' } })
  assert.equal(verdict.verdict, 'no-plan-service')
  assert.equal(verdict.measuredAt > 0, true)
})

test('a limited window makes the plan throttled', () => {
  const verdict = judgePlan({
    billing: { mode: 'subscription', service: 'antigravity' },
    windows: [{ label: 'weekly', percent: 100, limited: true }],
    endpointProbe: 'ok',
  })
  assert.equal(verdict.verdict, 'throttled')
})

test('declared and account plans disagreeing is a mismatch', () => {
  const verdict = judgePlan({
    billing: { mode: 'flat', service: 'opencode-v2' },
    declaredPlan: 'go',
    accountPlan: 'zen',
    endpointProbe: 'ok',
  })
  assert.equal(verdict.verdict, 'mismatch')
})

test('a settled probe with an account plan is a match', () => {
  const verdict = judgePlan({
    billing: { mode: 'subscription' },
    accountPlan: 'go',
    endpointProbe: 'ok',
    measuredAt: 123,
  })
  assert.equal(verdict.verdict, 'match')
  assert.equal(verdict.measuredAt, 123)
})

test('an auth error leaves the verdict unknown, not "no plan"', () => {
  const verdict = judgePlan({ billing: { mode: 'subscription' }, endpointProbe: 'auth-error' })
  assert.equal(verdict.verdict, 'unknown')
})

test('buildVerdict fills every field', () => {
  const verdict = buildVerdict({})
  assert.deepEqual(Object.keys(verdict).sort(), [
    'accountPlan', 'billingSources', 'declaredPlan', 'degraded', 'endpointProbe', 'measuredAt', 'service', 'verdict', 'windows',
  ])
})

test('pay-per-token bills the catalog estimate', () => {
  const outcome = billingOutcome({ billing: { mode: 'pay-per-token' }, verdict: { verdict: 'no-plan-service' }, cost: COST })
  assert.equal(outcome.billed, 3)
  assert.equal(outcome.covered, false)
  assert.equal(outcome.confidence, 'estimated')
})

test('pay-per-token without catalog rates is unavailable, not zero', () => {
  const outcome = billingOutcome({ billing: { mode: 'pay-per-token' }, verdict: { verdict: 'no-plan-service' } })
  assert.equal(outcome.billed, null)
  assert.equal(outcome.confidence, 'unavailable')
})

test('a covered subscription bills zero', () => {
  const outcome = billingOutcome({ billing: { mode: 'subscription' }, verdict: { verdict: 'match' }, cost: COST })
  assert.equal(outcome.billed, 0)
  assert.equal(outcome.covered, true)
})

test('an unknown plan verdict bills null, never zero', () => {
  const outcome = billingOutcome({ billing: { mode: 'flat' }, verdict: { verdict: 'unknown' }, cost: COST })
  assert.equal(outcome.billed, null)
  assert.equal(outcome.covered, null)
  assert.match(outcome.reason, /never assume covered/)
})

test('a plan mismatch falls back to the estimate', () => {
  const outcome = billingOutcome({ billing: { mode: 'subscription' }, verdict: { verdict: 'mismatch' }, cost: COST })
  assert.equal(outcome.billed, 3)
  assert.equal(outcome.covered, false)
})

test('a throttled plan is still covered', () => {
  const outcome = billingOutcome({ billing: { mode: 'subscription' }, verdict: { verdict: 'throttled' }, cost: COST })
  assert.equal(outcome.billed, 0)
  assert.equal(outcome.covered, true)
})

// ---------------------------------------------------------------------------
// Two-track plan evidence (owner correction 2026-11-12).
//
// Track A: a pre-dispatch verdict may only rest on evidence that exists BEFORE
// the request. The declared plan is that evidence; a post-request receipt is not.
// Track B: `billing_source` is a receipt and produces a CONSENT-GATED proposal,
// never a verdict.
// ---------------------------------------------------------------------------

test('Track A: the declared plan alone is a pre-dispatch match', () => {
  const verdict = judgePlan({
    billing: { mode: 'flat', service: 'opencode-v2' },
    declaredPlan: 'go',
    endpointProbe: 'ok',
  })
  assert.equal(verdict.verdict, 'match')
})

test('Track A: a declaration without a probe still judges and records the gap', () => {
  const verdict = judgePlan({ billing: { mode: 'flat' }, declaredPlan: 'go' })
  assert.equal(verdict.verdict, 'match')
  assert.equal(verdict.degraded.some((entry) => entry.dimension === 'accountPlan'), true)
})

test('Track A: no declaration and no account evidence is unknown, never a guess', () => {
  const verdict = judgePlan({ billing: { mode: 'flat' }, endpointProbe: 'ok' })
  assert.equal(verdict.verdict, 'unknown')
})

test('Track A: a receipt does NOT become the account tier', () => {
  // `billingSources: ['go-plus']` is post-request evidence. It must not turn a
  // pre-dispatch verdict into a mismatch against the declared plan.
  const verdict = judgePlan({
    billing: { mode: 'flat' },
    declaredPlan: 'go',
    billingSources: ['go-plus'],
    endpointProbe: 'ok',
  })
  assert.equal(verdict.accountPlan, null, 'the receipt must not populate accountPlan')
  assert.equal(verdict.verdict, 'match')
  assert.deepEqual(verdict.billingSources, ['go-plus'], 'it is still recorded for Track B')
})

test('Track B: a receipt that differs from the declaration is a consent-gated proposal', () => {
  const result = proposeCorrection({ declaredPlan: 'go', billingSources: ['go-plus'], sampleCount: 9279 })
  assert.equal(result.status, 'propose')
  assert.equal(result.proposal.from, 'go')
  assert.equal(result.proposal.to, 'go-plus')
  assert.equal(result.proposal.field, 'activePlan')
  assert.equal(result.proposal.requiresConsent, true)
  assert.equal(result.proposal.sampleCount, 9279)
})

test('Track B: an agreeing receipt proposes nothing', () => {
  const result = proposeCorrection({ declaredPlan: 'go-plus', billingSources: ['go-plus'] })
  assert.equal(result.status, 'agree')
  assert.equal(result.proposal, null)
})

test('Track B: a cold start has no receipt and proposes nothing', () => {
  const result = proposeCorrection({ declaredPlan: 'go', billingSources: [] })
  assert.equal(result.status, 'none')
  assert.equal(result.proposal, null)
})

test('Track B: pay-as-you-go sources prove no subscription tier', () => {
  for (const source of ['balance', 'free', 'byok']) {
    assert.equal(tierFromBillingSources([source]), null, `${source} must not set a tier`)
    assert.equal(proposeCorrection({ declaredPlan: 'go', billingSources: [source] }).status, 'none')
  }
})

test('Track B: go-plus outranks go when both appear', () => {
  assert.equal(tierFromBillingSources(['go', 'go-plus']), 'go-plus')
  assert.equal(tierFromBillingSources(['go']), 'go')
})
