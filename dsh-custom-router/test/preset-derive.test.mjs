/**
 * The derivation seam (STANDARD §4 steps 2–3).
 *
 * The claim under test is the owner's question that produced the standard:
 * *"if presets keep being added, do I have to update three places again?"*
 * The answer this module enforces is **no** — one backend declaration produces
 * the settings tab, the dashboard card and the usage routes, with no second
 * edit in the browser half.
 *
 * What is asserted:
 *   1. the derivation reproduces every hand-written descriptor value rc.15 had
 *      (so the migration changed the mechanism, not the behaviour);
 *   2. an ID-ONLY synthetic preset gets a tab, a catalog route and a usage card;
 *   3. `metered`/`planKey` are derived from billing, never declared twice;
 *   4. a page cannot shadow a derived fact (the second-registry regression);
 *   5. the mirror in `lib/client.src.js` is the canonical module, byte for byte.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { PRESETS, validatePresets } from '../lib/presets.js'
import {
  BILLING_PLAN_KEYS,
  MEASURED_LABELS,
  catalogRouteOf,
  labelKeyOf,
  meteredOf,
  planKeyOf,
  presetSettings,
  presetSettingsList,
  presetUi,
} from '../lib/preset-derive.js'
import { checkDeriveMirror, checkGeneratedArtifacts, readModelPresets } from '../lib/preset-drift.js'

/** A minimal, valid declaration that names nothing but its own facts. */
function idOnlyPreset(overrides = {}) {
  return Object.freeze({
    id: 'fnord',
    name: 'Fnord',
    kind: 'package',
    package: '@nolit/dsh-custom-router/vendor/fnord',
    row: 'dsh-fnord',
    entries: Object.freeze([Object.freeze({ row: 'dsh-fnord' })]),
    providerId: 'fnord',
    modelPrefixes: Object.freeze(['fnord']),
    endpoint: Object.freeze({ mode: 'http', protocol: 'openai-completions', route: 'own', baseUrl: 'https://fnord.invalid', chatPath: '/chat/completions', transport: 'sse' }),
    auth: Object.freeze({ mode: 'api-key', sources: Object.freeze([Object.freeze({ kind: 'env', name: 'FNORD_API_KEY' })]) }),
    catalog: Object.freeze({ mode: 'live', layers: Object.freeze([Object.freeze({ source: 'probe', kind: 'api', shape: 'openai', endpoint: '/models', ttlMs: 60000 })]) }),
    switches: Object.freeze([]),
    surfaces: Object.freeze({
      model: Object.freeze({ adapter: true }),
      subagent: null,
      cli: null,
      batch: null,
      tools: Object.freeze([]),
      commands: Object.freeze([]),
      skill: null,
    }),
    usage: Object.freeze({
      record: 'fnord-cost',
      plan: 'available',
      billing: Object.freeze({ mode: 'pay-per-token' }),
      routes: Object.freeze([Object.freeze({ path: '/api/local/fnord/cost/summary', normalize: 'normalizeFnordUsage' })]),
    }),
    ...overrides,
  })
}

test('every measured preset is VALID as a declaration (the derivation needs no extra field)', () => {
  const verdict = validatePresets(PRESETS)
  assert.deepEqual(verdict.errors, [])
})

test('the derivation reproduces the rc.15 descriptor values exactly', () => {
  // These are the values the hand-written MODEL_PRESETS table carried before
  // rc.16; the point of the change is that they now have ONE author.
  const derived = presetSettingsList(PRESETS)
  const byId = Object.fromEntries(derived.map((entry) => [entry.id, entry]))
  assert.deepEqual(Object.keys(byId), ['antigravity', 'opencode', 'deepinfra', 'exaone'])

  assert.equal(byId.antigravity.labelKey, 'vendorAntigravity')
  assert.equal(byId.antigravity.planKey, 'planSubscription')
  assert.equal(byId.antigravity.metered, false)
  assert.equal(byId.antigravity.row, 'dsh-antigravity')
  assert.equal(byId.antigravity.route, '/api/local/dsh-antigravity/models')

  assert.equal(byId.opencode.labelKey, 'vendorOpenCode')
  assert.equal(byId.opencode.planKey, 'planOpenCode')
  assert.equal(byId.opencode.metered, false)
  assert.equal(byId.opencode.row, 'dsh-opencode-v2-http')
  // The TAB lists models; the usage card still reads plan-usage FIRST.
  assert.equal(byId.opencode.route, '/api/local/opencode-v2/model-settings')
  assert.deepEqual(byId.opencode.usageRoutes.map((route) => route.path), [
    '/api/local/opencode-v2/plan-usage',
    '/api/local/opencode-v2/model-settings',
  ])

  assert.equal(byId.deepinfra.labelKey, 'vendorDeepInfra')
  assert.equal(byId.deepinfra.planKey, 'planPayAsYouGo')
  assert.equal(byId.deepinfra.metered, true)
  assert.equal(byId.deepinfra.route, '/api/local/deepinfra/models')

  assert.equal(byId.exaone.labelKey, 'vendorExaone')
  assert.equal(byId.exaone.planKey, 'planFree')
  assert.equal(byId.exaone.metered, false)
  assert.equal(byId.exaone.row, 'dsh-exaone')
  assert.equal(byId.exaone.route, '/api/local/dsh-exaone/models')
  assert.deepEqual(byId.exaone.usageRoutes, [])

  // The browser registry is what the page actually gets.
  const browser = readModelPresets()
  assert.deepEqual(browser.map((preset) => preset.id), PRESETS.map((preset) => preset.id))
  for (const descriptor of browser) {
    const settings = byId[descriptor.id]
    for (const key of ['labelKey', 'planKey', 'metered', 'row', 'route']) {
      assert.equal(descriptor[key], settings[key], descriptor.id + '.' + key + ' must come from the derivation')
    }
    // JSON, not deepEqual: the page-side array is built inside the vm realm, so
    // its Array prototype differs from this file's even when the values match.
    assert.equal(
      JSON.stringify(descriptor.usageRoutes.map((route) => route.path)),
      JSON.stringify(settings.usageRoutes.map((route) => route.path)),
    )
  }
})

test('an ID-ONLY preset gets a settings tab, a catalog route and a usage card', () => {
  // This is the whole point of §4 steps 2–3: NO browser edit for a new preset.
  const declaration = idOnlyPreset()
  const settings = presetSettings(declaration)
  assert.equal(settings.id, 'fnord')
  assert.equal(settings.labelKey, 'vendorFnord', 'a conventional label key, so the tab has a name')
  assert.equal(settings.planKey, BILLING_PLAN_KEYS['pay-per-token'])
  assert.equal(settings.metered, true, 'pay-per-token derives the price block')
  assert.equal(settings.route, '/api/local/fnord/cost/summary', 'the declared usage route is also a catalog route candidate')
  assert.equal(settings.usageRoutes.length, 1, 'the dashboard card comes from the declaration alone')

  // A declaration that reports no usage still gets a tab: the route falls back
  // to the probe layer, then to the conventional row route — never undefined.
  const noUsage = presetSettings(idOnlyPreset({
    usage: Object.freeze({ record: 'fnord-none', plan: 'unavailable', billing: Object.freeze({ mode: 'none' }) }),
  }))
  assert.equal(noUsage.usageRoutes.length, 0)
  assert.equal(noUsage.route, '/api/local/dsh-fnord/models', 'the probe layer has no local route, so the row route is used')
  assert.equal(noUsage.metered, false)
})

test('the derivation never invents a free-form key for a measured preset', () => {
  for (const preset of PRESETS) {
    const measured = MEASURED_LABELS[preset.id]
    assert.ok(measured, preset.id + ' must be in MEASURED_LABELS or its tab would render a guessed key')
    assert.equal(labelKeyOf(preset), measured.labelKey)
    assert.equal(planKeyOf(preset), measured.planKey)
    assert.equal(meteredOf(preset), preset.usage.billing.mode === 'pay-per-token')
  }
})

test('metered and planKey are cross-checked against billing, not declared twice', () => {
  const metered = idOnlyPreset({ usage: Object.freeze({ record: 'r', plan: 'available', billing: Object.freeze({ mode: 'pay-per-token' }), routes: Object.freeze([{ path: '/api/local/x/cost', normalize: 'n' }]) }) })
  assert.equal(meteredOf(metered), true)
  const subscription = idOnlyPreset({ usage: Object.freeze({ record: 'r', plan: 'available', billing: Object.freeze({ mode: 'subscription' }), routes: Object.freeze([{ path: '/api/local/x/usage', normalize: 'n' }]) }) })
  assert.equal(meteredOf(subscription), false)
  // The plan key follows the billing mode when no measured key exists.
  assert.equal(planKeyOf(subscription), BILLING_PLAN_KEYS.subscription)
})

test('a page cannot shadow a derived fact — the second-registry regression', () => {
  const declaration = idOnlyPreset()
  // A hook supplying `row`/`route`/`metered` is exactly how the old table
  // drifted from the backend. It is refused instead of silently winning.
  assert.throws(() => presetUi(declaration, { row: 'dsh-somewhere-else' }), /collide with a derived fact/)
  assert.throws(() => presetUi(declaration, { route: '/api/local/other' }), /collide with a derived fact/)
  // A page hook that is NOT a derived fact is accepted and preserved.
  const load = () => ({ groups: [] })
  const descriptor = presetUi(declaration, { load })
  assert.equal(descriptor.load, load)
  assert.equal(descriptor.row, 'dsh-fnord')
  assert.ok(Object.isFrozen(descriptor))
})

test('catalogRoute: the tab route and the usage routes are different questions', () => {
  // OpenCode is the measured case where conflating them blanked the tab.
  const opencode = PRESETS.find((preset) => preset.id === 'opencode')
  assert.equal(catalogRouteOf(opencode), '/api/local/opencode-v2/model-settings')
  assert.equal(opencode.usage.routes[0].path, '/api/local/opencode-v2/plan-usage')
  // An explicit catalogRoute always wins.
  assert.equal(catalogRouteOf({ row: 'r', catalogRoute: '/api/local/explicit/models', usage: { routes: [{ path: '/api/local/x/usage' }] } }), '/api/local/explicit/models')
  // A non-local catalogRoute is ignored (never POSTed with credentials).
  assert.equal(catalogRouteOf({ row: 'r', catalogRoute: 'https://evil.invalid', usage: { routes: [] } }), '/api/local/r/models')
})

test('the browser mirror is the canonical derivation, and the baked declarations are current', () => {
  const mirror = checkDeriveMirror()
  assert.equal(mirror.ok, true, mirror.problems.join('; '))
  const artifacts = checkGeneratedArtifacts()
  assert.equal(artifacts.ok, true, artifacts.problems.join('; '))
})
