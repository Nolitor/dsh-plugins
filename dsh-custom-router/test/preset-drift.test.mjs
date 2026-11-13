/**
 * Drift-gate tests for `lib/preset-drift.js`.
 *
 * The gate's whole value is that it FAILS on real drift, so this suite pins
 * both directions: the shipped registries pass, and each documented drift class
 * fails with a message that names the preset. `scripts/verify-presets-mutation.mjs`
 * runs the same mutations end-to-end; these tests keep them in `npm test`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { PRESETS } from '../lib/presets.js'
import { presetSettings } from '../lib/preset-derive.js'
import {
  LOCALES,
  checkGeneratedArtifacts,
  checkPresetRegistry,
  readLocales,
  readModelPresets,
} from '../lib/preset-drift.js'

/** A deep clone that keeps functions by reference. */
function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = clone(item)
    return out
  }
  return value
}

/** The pristine registries, freshly cloned. */
function pristine() {
  // `derive` is always supplied: without it the gate states that it could not
  // check "descriptor IS the derivation" (a hole), and a suite that ran that way
  // would be testing a weaker gate than the one shipped.
  return {
    presets: clone(PRESETS),
    descriptors: clone(readModelPresets()),
    locales: clone(readLocales()),
    derive: presetSettings,
  }
}

test('the shipped registries pass the static drift gate', () => {
  const verdict = checkPresetRegistry(pristine())
  assert.equal(verdict.ok, true, 'unexpected drift: ' + verdict.problems.join('; '))
  assert.equal(verdict.problems.length, 0)
})

test('the gate reports what it cannot see instead of implying full coverage', () => {
  const { holes } = checkPresetRegistry(pristine())
  assert.ok(holes.length >= 1, 'a green gate must state its blind spots')
  assert.ok(holes.some((hole) => /runtime registration/.test(hole)))
})

test('every preset carries an ordered usage route list', () => {
  for (const preset of PRESETS) {
    assert.ok(Array.isArray(preset.usage.routes), preset.id + ' must declare usage.routes')
    assert.ok(preset.usage.routes.length > 0, preset.id + ' must declare at least one usage route')
    for (const route of preset.usage.routes) {
      assert.equal(route.path.startsWith('/api/local/'), true, preset.id + ': usage route must be a local panel route')
      assert.equal(typeof route.normalize, 'string', preset.id + ': usage route must name its reader')
    }
  }
  // OpenCode needs both routes to build one reading; order is the contract.
  const opencode = PRESETS.find((preset) => preset.id === 'opencode')
  assert.equal(JSON.stringify(opencode.usage.routes.map((route) => route.path)), JSON.stringify([
    '/api/local/opencode-v2/plan-usage',
    '/api/local/opencode-v2/model-settings',
  ]))
})

test('a backend preset with no browser descriptor is refused', () => {
  const input = pristine()
  input.presets.push({ ...clone(input.presets[0]), id: 'fnord', providerId: 'fnord', row: 'dsh-fnord', entries: [{ row: 'dsh-fnord' }] })
  const verdict = checkPresetRegistry(input)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => problem.includes('fnord') && /no MODEL_PRESETS descriptor/.test(problem)))
})

test('a descriptor whose preset does not exist is refused', () => {
  const input = pristine()
  input.descriptors.push({ ...clone(input.descriptors[0]), id: 'ghost' })
  const verdict = checkPresetRegistry(input)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => problem.includes('ghost') && /no PRESETS entry/.test(problem)))
})

test('a descriptor writing an undeclared row is refused', () => {
  const input = pristine()
  input.descriptors[0].row = 'dsh-antigravity-typo'
  const verdict = checkPresetRegistry(input)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => /dsh-antigravity-typo/.test(problem)))
})

test('a preset with no usage routes is refused — the silent dashboard failure', () => {
  const input = pristine()
  input.descriptors[1].usageRoutes = []
  const verdict = checkPresetRegistry(input)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => /no usageRoutes/.test(problem)))
})

test('a usage route outside /api/local/ is refused', () => {
  const input = pristine()
  input.descriptors[0].usageRoutes[0].path = 'https://example.invalid/v1/x'
  const verdict = checkPresetRegistry(input)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => /not a local panel route/.test(problem)))
})

test('a labelKey missing from one locale is refused — the silent raw-key render', () => {
  const input = pristine()
  delete input.locales.ko.vendorAntigravity
  const verdict = checkPresetRegistry(input)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => /absent from locale\/ko\.json/.test(problem)))
})

test('a non-callable load() is refused', () => {
  const input = pristine()
  delete input.descriptors[2].load
  const verdict = checkPresetRegistry(input)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => /load is undefined/.test(problem)))
})

test('duplicate descriptor ids are refused', () => {
  const input = pristine()
  input.descriptors.push({ ...clone(input.descriptors[0]) })
  const verdict = checkPresetRegistry(input)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => /share this id/.test(problem)))
})

test('every locale declares every key the UI asks for', () => {
  const locales = readLocales()
  assert.equal(JSON.stringify(Object.keys(locales).sort()), JSON.stringify([...LOCALES].sort()))
  for (const descriptor of readModelPresets()) {
    for (const name of ['labelKey', 'planKey']) {
      for (const locale of LOCALES) {
        assert.ok(descriptor[name] in locales[locale], descriptor.id + ': ' + descriptor[name] + ' missing from ' + locale)
      }
    }
  }
})

test('the generated artefacts are current with their sources', () => {
  const verdict = checkGeneratedArtifacts()
  assert.equal(verdict.ok, true, 'stale build: ' + verdict.problems.join('; '))
})

test('a descriptor fact that is not the derivation is refused — the second-registry regression', () => {
  // The page cannot build a descriptor by hand any more; if one appears anyway,
  // the fact it invented is what used to drift silently (STANDARD §4 steps 2–3).
  const input = pristine()
  input.descriptors[0].row = 'dsh-antigravity-old'
  const verdict = checkPresetRegistry(input)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => /not what the derivation produces/.test(problem)))
})

test('a catalog route that is really the usage feed is refused for a non-model route', () => {
  const input = pristine()
  // Simulate the measured pre-rc.16 shape: the tab opened the FIRST usage route.
  input.descriptors[0].route = '/api/local/dsh-antigravity/usage'
  const verdict = checkPresetRegistry(input)
  assert.equal(verdict.ok, false)
  assert.ok(verdict.problems.some((problem) => /not what the derivation produces/.test(problem)))
})

test('without the derivation the gate says so instead of passing silently', () => {
  const input = pristine()
  delete input.derive
  const verdict = checkPresetRegistry(input)
  assert.equal(verdict.ok, true, 'consistency checks still run')
  assert.ok(verdict.holes.some((hole) => /descriptor-equals-derivation/.test(hole)))
})
