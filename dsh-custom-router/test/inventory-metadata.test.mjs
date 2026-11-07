/**
 * Inventory and metadata tests for @nolit/dsh-custom-router.
 *
 * These guard the seam between the browser half and the backend contract:
 *   - the client registers exactly ONE settings section (no vendor tabs);
 *   - the switch write paths match the rows and switch names that
 *     `lib/presets.js` declares (drift gate);
 *   - the package exposes the client bundle and the locale files.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'
import { PRESETS } from '../lib/presets.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (path) => readFileSync(join(root, path), 'utf8')

/**
 * Evaluate the client bundle in a vm sandbox and return its exports.
 * @returns {object} the module exports.
 */
function loadExports() {
  let descriptor = null
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { descriptor = value } } },
    document: { head: { querySelector: () => null, appendChild: () => {} }, createElement: () => ({ setAttribute: () => {} }) },
    console,
  }
  vm.createContext(sandbox)
  vm.runInContext(read('lib/client.js'), sandbox, { filename: 'client.js' })
  return descriptor.factory((name) => {
    if (name === 'react') {
      return {
        createElement: (type, props, ...children) => ({ type, props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children } }),
        useState: () => [undefined, () => {}],
        useReducer: () => [0, () => {}],
        useEffect: () => {},
        useCallback: (fn) => fn,
        useMemo: (fn) => fn(),
      }
    }
    throw new Error('unexpected require: ' + name)
  })
}

test('the package ships the client bundle, the locale files and the client export', () => {
  const manifest = JSON.parse(read('package.json'))
  assert.equal(manifest.name, '@nolit/dsh-custom-router')
  assert.equal(manifest.dsh.client.platform, 'web')
  assert.equal(manifest.exports['./client'].default, './lib/client.js')
  assert.ok(manifest.files.includes('locale/'))
  assert.ok(manifest.files.includes('lib/'))
})

test('the client registers exactly one settings section and no vendor tab', () => {
  const exports = loadExports()
  const registrations = []
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'en' }) },
    configForms: { get: () => ({ getSnapshot: () => ({ status: 'ready', value: {} }), subscribe: () => () => {} }) },
    slots: {
      inject: (_name, register) => register(),
      register: (options) => {
        registrations.push(options)
        return () => {}
      },
    },
  }
  exports.apply(ctx)
  const sections = registrations.filter((entry) => entry.name === 'settings.section')
  const panels = registrations.filter((entry) => entry.name === 'sidebar.panellist')
  const pages = registrations.filter((entry) => entry.name === 'main')
  assert.equal(sections.length, 1)
  assert.equal(sections[0].id, 'custom-router')
  assert.equal(sections[0].label(), 'Custom Router')
  // One sidebar page, keyed to the same id the panel row selects.
  assert.equal(panels.length, 1)
  assert.equal(panels[0].id, 'custom-router')
  assert.equal(pages.length, 1)
  assert.equal(pages[0].key, 'custom-router')
  for (const entry of registrations) {
    const id = entry.id ?? entry.key
    assert.equal(id, 'custom-router', 'no vendor tab may be registered: ' + id)
  }
})

test('the client writes only the rows and switch names lib/presets.js declares', () => {
  const exports = loadExports()
  const presets = new Map(PRESETS.map((preset) => [preset.id, preset]))
  const rows = new Set()
  for (const preset of PRESETS) {
    for (const entry of preset.entries) rows.add(entry.row)
  }

  for (const provider of exports.ROUTER_PROVIDERS) {
    const preset = presets.get(provider.id)
    assert.ok(preset, 'unknown preset: ' + provider.id)
    assert.equal(JSON.stringify([...provider.masterPath]), JSON.stringify(['presets', provider.id]))

    const declaredSwitches = new Set(preset.switches.map((entry) => entry.name))
    for (const layer of provider.layers) {
      const row = layer.path[1]
      assert.ok(rows.has(row), 'unknown vendor row: ' + row)
      assert.equal(layer.path[0], 'vendorConfig')
      assert.ok(declaredSwitches.has(layer.switchName), provider.id + ' declares no switch named ' + layer.switchName)
      if (layer.pairPath) {
        assert.equal(layer.pairPath[0], 'vendorConfig')
        assert.equal(layer.pairPath[1], row, 'the atomic pair must stay inside one row')
        assert.ok(declaredSwitches.has('workerEnabled'), provider.id + ' declares no workerEnabled switch')
      }
    }
    assert.ok(rows.has(provider.credentialRow), 'unknown credential row: ' + provider.credentialRow)
  }
})

test('DeepInfra declares no layer switch, because its preset master is the model router', () => {
  const exports = loadExports()
  const deepinfra = exports.ROUTER_PROVIDERS.find((provider) => provider.id === 'deepinfra')
  assert.equal(deepinfra.layers.length, 0)
  assert.equal(deepinfra.masterIsModelServing, true)
  const preset = PRESETS.find((entry) => entry.id === 'deepinfra')
  assert.equal(preset.switches.length, 0)
})

test('the OpenCode preset keeps its two distinct rows', () => {
  const exports = loadExports()
  const opencode = exports.ROUTER_PROVIDERS.find((provider) => provider.id === 'opencode')
  const serving = opencode.layers.find((layer) => layer.id === 'modelServing')
  const subagent = opencode.layers.find((layer) => layer.id === 'subagent')
  assert.equal(JSON.stringify([...serving.path]), JSON.stringify(['vendorConfig', 'dsh-opencode-v2-http', 'modelServing']))
  assert.equal(JSON.stringify([...subagent.path]), JSON.stringify(['vendorConfig', 'dsh-opencode-v2', 'subagent']))
})

test('the picker offers the three presets and the custom JSON declaration', () => {
  const exports = loadExports()
  const ids = exports.PICKER_ITEMS.map((item) => item.id)
  assert.equal(JSON.stringify(ids), JSON.stringify(['antigravity', 'opencode', 'deepinfra', 'custom-json']))
  assert.equal(exports.PICKER_ITEMS[3].presetId, null, 'a JSON declaration mounts no preset row')
})

test('the model-serving tabs map onto the three presets and their declared rows', () => {
  const exports = loadExports()
  const presets = new Map(PRESETS.map((preset) => [preset.id, preset]))
  const rows = new Set()
  for (const preset of PRESETS) for (const entry of preset.entries) rows.add(entry.row)

  assert.equal(JSON.stringify(exports.MODEL_SOURCES.map((source) => source.id)), JSON.stringify(['antigravity', 'opencode', 'deepinfra']))
  for (const source of exports.MODEL_SOURCES) {
    assert.ok(presets.has(source.id), 'unknown preset behind a model tab: ' + source.id)
    // The saved value lands in this row's config, so the row MUST be one the
    // preset declares; a typo would write a vendor row nobody mounts.
    assert.ok(rows.has(source.row), 'unknown vendor row behind a model tab: ' + source.row)
    assert.equal(source.route.startsWith('/api/local/'), true, 'every catalog route is a local panel route')
    assert.equal(typeof source.normalize, 'function')
  }
  // The OpenCode tab writes the HTTP row, the one that carries `enabledModels`.
  assert.equal(exports.MODEL_SOURCES.find((source) => source.id === 'opencode').row, 'dsh-opencode-v2-http')
})

test('the grouped normalizers return groups, never a flat vendor list', () => {
  const exports = loadExports()
  const antigravity = exports.normalizeAntigravityModels({
    groups: [
      { kind: 'gemini', limits: [], models: [{ id: 'gemini-3.8-flash', variants: ['gemini-3.8-flash-high', 'gemini-3.8-flash-low'], enabled: true }] },
      { kind: 'other', limits: [], models: [] },
    ],
  })
  assert.equal(antigravity.length, 1, 'an empty family is dropped instead of rendering a bare header')
  assert.equal(antigravity[0].labelKey, 'groupGemini')
  assert.equal(JSON.stringify(antigravity[0].rows[0].variants), JSON.stringify(['gemini-3.8-flash-high', 'gemini-3.8-flash-low']))

  // A flat payload still renders as one fallback card (no groups key).
  const flat = exports.normalizeAntigravityModels({ models: [{ id: 'a', enabled: false }] })
  assert.equal(flat.length, 1)
  assert.equal(flat[0].labelKey, 'groupOther')
  assert.equal(JSON.stringify(flat[0].rows[0].variants), JSON.stringify(['a']))

  const opencode = exports.normalizeOpencodeModels({
    enabled: ['r/one'],
    models: [{ route: 'r/one', plan: 'go' }, { route: 'r/two', plan: 'zen' }],
  })
  assert.equal(JSON.stringify(opencode.map((group) => group.id)), JSON.stringify(['go', 'zen']))
  assert.equal(opencode[0].rows[0].enabled, true)
  assert.equal(opencode[1].rows[0].enabled, false)

  const deepinfra = exports.normalizeDeepinfraModels({
    models: [{ id: 'm/one', price: { input: 1, output: 2, listInput: 3, listOutput: 4 }, promotion: { percentOff: 50 }, enabled: true }],
  })
  assert.equal(deepinfra.length, 1, 'DeepInfra is one price card, not one card per model')
  assert.equal(deepinfra[0].rows[0].price.input, 1)
  assert.equal(deepinfra[0].rows[0].promotion.percentOff, 50)
})
