/**
 * The badge must describe the row's state, not its novelty.
 *
 * Owner rule (2026-11-04): "사용불가나 새 모델은 같은 플랜일 때 나타나야지" — an
 * unusable or brand-new marker belongs to the plan being shown. Measured before
 * this rule: `pulse-alpha-free` (zen, first seen 2026-11-03T08:32Z) rendered the
 * "새 모델" badge while Go was selected, so a model that could not be picked read
 * as the freshest entry in the list.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

let registration = null
new Function('window', SRC)({ __ModuleLoader__: { load: (reg) => { registration = reg } } })
const stub = () => new Proxy(function () {}, {
  get: (_target, key) => (key === Symbol.toPrimitive ? () => 'stub' : key === 'then' ? undefined : stub()),
  apply: () => stub(),
  construct: () => stub(),
})
const exportsObj = registration.factory(() => stub())

const badge = (model) => exportsObj.badgeKey(model)
const className = (model) => exportsObj.badgeClass(model)

test('a model of another plan reads as another plan, never as new or unusable', () => {
  // The exact measured row: zen route, really new, backend says unavailable.
  const zenNew = { route: 'opencode/pulse-alpha-free', plan: 'zen', state: 'other-plan', isNew: true }
  assert.equal(badge(zenNew), 'stateOtherPlan')
  assert.equal(className(zenNew), 'ocv2Badge', 'no green, no red, no accent: it is simply not this plan')

  const zenRefused = { route: 'opencode/flint-40b-free', plan: 'zen', state: 'other-plan', isNew: false }
  assert.equal(badge(zenRefused), 'stateOtherPlan')
  assert.equal(className(zenRefused), 'ocv2Badge')
})

test('inside the shown plan a new route is labelled new, and only there', () => {
  const goNew = { route: 'opencode-go/brand-new', plan: 'go', state: 'usable', isNew: true }
  assert.equal(badge(goNew), 'stateNew')
  assert.equal(className(goNew), 'ocv2Badge ocv2BadgeNew')
  const goOld = { route: 'opencode-go/deepseek-v4.1-flash', plan: 'go', state: 'usable', isNew: false }
  assert.equal(badge(goOld), 'stateUsable')
  assert.equal(className(goOld), 'ocv2Badge ocv2BadgeUsable')
})

test('inside the shown plan a refusal keeps its own name and error colour', () => {
  for (const [state, key] of [
    ['unavailable', 'stateUnavailable'],
    ['deprecated', 'stateDeprecated'],
    ['auth', 'stateAuth'],
    ['forbidden', 'stateForbidden'],
  ]) {
    const model = { route: 'opencode-go/mimo-v2.5', plan: 'go', state, isNew: false }
    assert.equal(badge(model), key)
    assert.equal(className(model), 'ocv2Badge ocv2BadgeBad', state + ' is a refusal of this plan')
  }
  // A deprecated route is not "new" even inside a real 7-day window: it cannot be
  // chosen, so novelty is not what the row should say.
  assert.equal(badge({ route: 'opencode-go/x', plan: 'go', state: 'deprecated', isNew: true }), 'stateDeprecated')
  assert.equal(className({ route: 'opencode-go/x', plan: 'go', state: 'deprecated', isNew: true }), 'ocv2Badge ocv2BadgeBad')
})
