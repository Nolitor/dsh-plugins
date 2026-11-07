/**
 * Plan (subscription/flat) layer: PlanVerdict detection and billing outcome.
 * The invariant that matters: `unknown` never becomes a fabricated `0`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { billingOutcome, buildVerdict, judgePlan } from '../lib/plan.js'

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
