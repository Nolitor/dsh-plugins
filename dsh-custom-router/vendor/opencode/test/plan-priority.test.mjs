/**
 * Plan is the first axis of the checklist, and the state follows it.
 *
 * Owner rule (2026-11-04): with Go selected, Zen models are "another plan" and
 * must not be selectable; with Zen selected, Go-only models likewise. "Unusable"
 * and "new" describe a model ONLY inside the plan that is actually being shown —
 * a refusal measured on the other plan's endpoint must not relabel the row, and a
 * brand-new route must not outrank or out-rank the plan grouping.
 *
 * Measured before this rule was applied (live /model-settings, activePlan=go):
 *   12 zen routes carried state "unavailable" instead of "other-plan"
 *    1 zen route (opencode/pulse-alpha-free) carried the "새 모델" badge
 *   12 blocked rows interleaved across two plans -> 11 rank/plan inversions
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { availabilityOf, orderModels } from '../lib/plans.js'

const GO = (id) => ({ route: 'opencode-go/' + id, name: id })
const ZEN = (id) => ({ route: 'opencode/' + id, name: id })

test('a route of the other plan is always "other-plan", whatever the backend said', () => {
  // Measured: these zen routes answer "unavailable" on the Go endpoint.
  const refusedZen = [
    'opencode/claude-opus-5-5',
    'opencode/flint-40b-free',
    'opencode/mistral-large-4',
  ]
  const verdicts = Object.fromEntries(refusedZen.map((route) => [route, 'unavailable']))
  for (const route of refusedZen) {
    const model = { route, name: route }
    assert.deepEqual(
      availabilityOf(model, { activePlan: 'go', verdicts }),
      { plan: 'zen', available: false, state: 'other-plan' },
      route + ' must read as another plan, not as an unusable model of this plan',
    )
  }
})

test('the mirror case holds: a go route under the zen plan is "other-plan"', () => {
  const model = GO('deepseek-v4.1-flash')
  assert.deepEqual(
    availabilityOf(model, { activePlan: 'zen', verdicts: { 'opencode-go/deepseek-v4.1-flash': 'deprecated' } }),
    { plan: 'go', available: false, state: 'other-plan' },
  )
})

test('a refusal still decides inside the plan being shown', () => {
  // Measured: opencode-go/mimo-v2.5 and mimo-v2.5-pro answer "deprecated".
  assert.deepEqual(
    availabilityOf(GO('mimo-v2.5'), { activePlan: 'go', verdicts: { 'opencode-go/mimo-v2.5': 'deprecated' } }),
    { plan: 'go', available: false, state: 'deprecated' },
  )
  assert.deepEqual(availabilityOf(ZEN('big-pickle'), { activePlan: 'zen' }), {
    plan: 'zen',
    available: true,
    state: 'usable',
  })
  assert.deepEqual(
    availabilityOf(ZEN('big-pickle'), { activePlan: 'zen', verdicts: { 'opencode/big-pickle': 'unavailable' } }),
    { plan: 'zen', available: false, state: 'unavailable' },
  )
})

test('an unknown provider is never offered and never claims a plan', () => {
  assert.deepEqual(availabilityOf({ route: 'thirdparty/model' }, { activePlan: 'go' }), {
    plan: 'other',
    available: false,
    state: 'unknown',
  })
})

test('the active plan is one contiguous block, usable rows first inside it', () => {
  const models = [
    ZEN('pulse-alpha-free'),
    GO('ranked-2'),
    ZEN('deepseek-v4.1-flash'),
    GO('ranked-1'),
    GO('refused'),
  ]
  const ordered = orderModels(models, {
    activePlan: 'go',
    ranking: { 'opencode-go/ranked-1': 1, 'opencode-go/ranked-2': 4 },
    verdicts: { 'opencode-go/refused': 'deprecated' },
    firstSeen: {},
  })
  // Every go row precedes every zen row; usable go rows precede the refused one.
  // Inside the zen block no route is "available", so the usage rank orders it.
  assert.deepEqual(ordered.map((model) => model.route), [
    'opencode-go/ranked-1',
    'opencode-go/ranked-2',
    'opencode-go/refused',
    'opencode/deepseek-v4.1-flash',
    'opencode/pulse-alpha-free',
  ])
})

test('a new route is "new" only inside the plan being shown', () => {
  const now = Date.parse('2026-11-04T00:00:00.000Z')
  const firstSeen = {
    'opencode/pulse-alpha-free': '2026-11-03T08:32:04.000Z', // measured, real
    'opencode-go/brand-new': '2026-11-03T20:00:00.000Z',
    'opencode/pulse-alpha-free ': '2026-11-03T08:32:04.000Z',
  }
  const ordered = orderModels([ZEN('pulse-alpha-free'), GO('brand-new')], {
    activePlan: 'go',
    ranking: {},
    firstSeen,
    now,
  })
  const zen = ordered.find((model) => model.route === 'opencode/pulse-alpha-free')
  const go = ordered.find((model) => model.route === 'opencode-go/brand-new')
  // The route really is new, so the fact stays recorded — but the row still reads
  // as another plan, and the badge is chosen from the state, never from isNew.
  assert.equal(zen.isNew, true)
  assert.equal(zen.state, 'other-plan')
  assert.equal(go.isNew, true)
  assert.equal(go.state, 'usable')
  // The new route of the shown plan sorts first inside that plan.
  assert.equal(ordered[0].route, 'opencode-go/brand-new')
})
