/**
 * Plan model: availability comes from the provider id (Go subscription vs Zen
 * pay-as-you-go), never from a per-model request. These tests pin the rule and
 * the ordering, because the settings tab's whole cost story depends on them.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  PLANS,
  PLAN_PROVIDERS,
  availabilityOf,
  orderModels,
  planOfProvider,
  planOfRoute,
  rankingForRoutes,
  rankingFromDataIndex,
  isNewModel,
} from '../lib/plans.js'

test('provider ids map to plans', () => {
  assert.deepEqual(PLANS, ['go', 'zen'])
  assert.equal(PLAN_PROVIDERS.go, 'opencode-go')
  assert.equal(PLAN_PROVIDERS.zen, 'opencode')
  assert.equal(planOfProvider('opencode-go'), 'go')
  assert.equal(planOfProvider('opencode'), 'zen')
  assert.equal(planOfProvider('something-else'), 'other')
  assert.equal(planOfRoute('opencode-go/glm-5.3-flash'), 'go')
  assert.equal(planOfRoute('opencode/flint-40b-free'), 'zen')
  assert.equal(planOfRoute(''), 'other')
})

test('availability is the plan, with backend refusals overriding it', () => {
  const goRoute = { route: 'opencode-go/glm-5.3-flash' }
  const zenRoute = { route: 'opencode/flint-40b-free' }

  assert.deepEqual(availabilityOf(goRoute, { activePlan: 'go' }), { plan: 'go', available: true, state: 'usable' })
  assert.deepEqual(availabilityOf(zenRoute, { activePlan: 'go' }), { plan: 'zen', available: false, state: 'other-plan' })
  assert.deepEqual(availabilityOf(goRoute, { activePlan: 'zen' }), { plan: 'go', available: false, state: 'other-plan' })
  assert.equal(availabilityOf(zenRoute, { activePlan: 'zen' }).available, true)

  // A route the backend refused stays refused even inside the active plan.
  for (const state of ['unavailable', 'deprecated', 'auth', 'forbidden']) {
    assert.deepEqual(availabilityOf(goRoute, { activePlan: 'go', verdicts: { [goRoute.route]: state } }), {
      plan: 'go',
      available: false,
      state,
    })
  }
  // An unknown provider is shown but never offered.
  assert.deepEqual(availabilityOf({ route: 'thirdparty/model' }, { activePlan: 'go' }), {
    plan: 'other',
    available: false,
    state: 'unknown',
  })
})

test('the checklist orders usable first, then by usage rank, then by name', () => {
  const models = [
    { route: 'opencode/zen-a', name: 'Zeta' },
    { route: 'opencode-go/b-ranked-2', name: 'Bravo' },
    { route: 'opencode-go/a-ranked-1', name: 'Alpha' },
    { route: 'opencode-go/unranked-c', name: 'Charlie' },
  ]
  const ranking = { 'opencode-go/a-ranked-1': 1, 'opencode-go/b-ranked-2': 2 }
  const ordered = orderModels(models, { activePlan: 'go', ranking })
  assert.deepEqual(
    ordered.map((model) => model.route),
    ['opencode-go/a-ranked-1', 'opencode-go/b-ranked-2', 'opencode-go/unranked-c', 'opencode/zen-a'],
  )
  assert.deepEqual(ordered.map((model) => model.available), [true, true, true, false])
  assert.equal(ordered[0].rank, 1)
  assert.equal(ordered[2].rank, null)
  // Nothing is dropped by ordering.
  assert.equal(ordered.length, models.length)
})

test('a refused route sorts into the unavailable group even on the active plan', () => {
  const models = [
    { route: 'opencode-go/refused', name: 'Aaa' },
    { route: 'opencode-go/ok', name: 'Zzz' },
  ]
  const ordered = orderModels(models, { activePlan: 'go', verdicts: { 'opencode-go/refused': 'deprecated' } })
  assert.deepEqual(ordered.map((model) => model.route), ['opencode-go/ok', 'opencode-go/refused'])
  assert.equal(ordered[1].state, 'deprecated')
})

test('the public ranking payload reduces to model -> rank', () => {
  const payload = {
    updatedAt: '2026-10-30T16:16:39.000Z',
    leaderboard: {
      pastWeek: [
        { rank: 1, model: 'deepseek-v4.1-flash' },
        { model: 'glm-5.3-flash' },
      ],
    },
  }
  const parsed = rankingFromDataIndex(payload)
  assert.deepEqual(parsed.ranking, { 'deepseek-v4.1-flash': 1, 'glm-5.3-flash': 2 })
  assert.equal(parsed.updatedAt, '2026-10-30T16:16:39.000Z')
  assert.equal(parsed.covered, 2)

  const empty = rankingFromDataIndex(null)
  assert.deepEqual(empty.ranking, {})
  assert.equal(empty.updatedAt, null)
})

test('ranking maps onto provider-qualified routes', () => {
  const routes = ['opencode-go/glm-5.3-flash', 'opencode/glm-5.3-flash', 'opencode-go/never-ranked']
  const mapped = rankingForRoutes(routes, { 'glm-5.3-flash': 3 })
  assert.deepEqual(mapped, { 'opencode-go/glm-5.3-flash': 3, 'opencode/glm-5.3-flash': 3 })
})

test('a newly appeared route is served first, without escaping the plan', () => {
  const now = Date.parse('2026-10-31T02:00:00.000Z')
  const firstSeen = {
    'opencode-go/brand-new': '2026-10-30T18:00:00.000Z', // 8h ago -> new
    'opencode-go/old-route': '2026-09-01T00:00:00.000Z', // long known
    'opencode/zen-new': '2026-10-30T18:00:00.000Z', // new but other plan
  }
  assert.equal(isNewModel('opencode-go/brand-new', { firstSeen, now }), true)
  assert.equal(isNewModel('opencode-go/old-route', { firstSeen, now }), false)
  // Once the public ranking covers it, usage decides again.
  assert.equal(isNewModel('opencode-go/brand-new', { firstSeen, now, ranking: { 'opencode-go/brand-new': 9 } }), false)
  // The window closes after NEW_MODEL_DAYS.
  assert.equal(isNewModel('opencode-go/brand-new', { firstSeen, now: Date.parse('2026-11-10T00:00:00.000Z') }), false)

  const models = [
    { route: 'opencode-go/ranked-1', name: 'Ranked One' },
    { route: 'opencode-go/brand-new', name: 'Zzz New' },
    { route: 'opencode-go/old-route', name: 'Aaa Old' },
    { route: 'opencode/zen-new', name: 'Zen New' },
  ]
  const ordered = orderModels(models, {
    activePlan: 'go',
    ranking: { 'opencode-go/ranked-1': 1 },
    firstSeen,
    now,
  })
  assert.deepEqual(
    ordered.map((model) => model.route),
    ['opencode-go/brand-new', 'opencode-go/ranked-1', 'opencode-go/old-route', 'opencode/zen-new'],
  )
  // Priority 0 does not bypass the plan: the new Zen route stays unavailable.
  assert.equal(ordered.find((model) => model.route === 'opencode/zen-new').available, false)
  assert.equal(ordered[0].isNew, true)
})
