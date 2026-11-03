/**
 * Plan attribution: which plan a route belongs to, and what that decides.
 *
 * The owner asked (2026-11-04) whether the newly appeared model can be used on
 * Go. Measured against the live catalog at that moment:
 *
 *   route   `opencode/pulse-alpha-free`      (providerID `opencode`)
 *   plan    zen
 *   state   other-plan  under `activePlan: 'go'`
 *   firstSeen 2026-11-03T08:32:04Z
 *
 * The provider id is the plan — `opencode-go` is the Go subscription, `opencode`
 * is Zen pay-as-you-go — so a model the catalog publishes under `opencode` is
 * Zen-only by construction. Nothing about the display name changes that, which is
 * the property these tests pin: a decorated name ("… (Go)", "… (Zen)") must never
 * move a route between plans, because the name is presentation and the provider
 * is the contract.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { availabilityOf, planOfRoute, orderModels } from '../lib/plans.js'

test('a route published under the zen provider is zen, whatever its name says', () => {
  assert.equal(planOfRoute('opencode/pulse-alpha-free'), 'zen')
  assert.equal(planOfRoute('opencode-go/pulse-alpha-free'), 'go')
  // The catalog decorates colliding names with the provider, but the decision
  // reads the route prefix only.
  assert.equal(planOfRoute('opencode-go/deepseek-v4.1-flash'), 'go')
  assert.equal(planOfRoute('opencode/deepseek-v4.1-flash'), 'zen')
})

test('the measured new model is not offered while the active plan is go', () => {
  const model = { route: 'opencode/pulse-alpha-free', name: 'Pulse Alpha Free' }
  assert.deepEqual(availabilityOf(model, { activePlan: 'go' }), {
    plan: 'zen',
    available: false,
    state: 'other-plan',
  })
  assert.deepEqual(availabilityOf(model, { activePlan: 'zen' }), {
    plan: 'zen',
    available: true,
    state: 'usable',
  })
})

test('a backend refusal outranks the plan, in both directions', () => {
  // Measured: opencode-go/mimo-v2.5 and mimo-v2.5-pro answer "deprecated".
  const deprecated = { route: 'opencode-go/mimo-v2.5', name: 'MiMo V2.5' }
  const verdicts = { 'opencode-go/mimo-v2.5': 'deprecated' }
  assert.deepEqual(availabilityOf(deprecated, { activePlan: 'go', verdicts }), {
    plan: 'go',
    available: false,
    state: 'deprecated',
  })
  // Without a measured refusal the plan alone decides, which is the whole point:
  // availability must never be inferred from the display name.
  assert.deepEqual(availabilityOf(deprecated, { activePlan: 'go' }), {
    plan: 'go',
    available: true,
    state: 'usable',
  })
  // A zen route the backend refused stays refused even on the zen plan.
  const refusedZen = { route: 'opencode/big-pickle', name: 'Big Pickle' }
  assert.equal(availabilityOf(refusedZen, { activePlan: 'zen', verdicts: { 'opencode/big-pickle': 'unavailable' } }).state, 'unavailable')
})

test('the checklist never sorts an unusable route above a usable one', () => {
  const models = [
    { route: 'opencode/pulse-alpha-free', name: 'Pulse Alpha Free' },
    { route: 'opencode-go/mimo-v2.5', name: 'MiMo V2.5' },
    { route: 'opencode-go/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash (Go)' },
  ]
  const ordered = orderModels(models, {
    activePlan: 'go',
    verdicts: { 'opencode-go/mimo-v2.5': 'deprecated' },
  })
  assert.equal(ordered[0].route, 'opencode-go/deepseek-v4.1-flash')
  assert.deepEqual(ordered.map((model) => model.available), [true, false, false])
  assert.deepEqual(ordered.map((model) => model.state), ['usable', 'deprecated', 'other-plan'])
})
