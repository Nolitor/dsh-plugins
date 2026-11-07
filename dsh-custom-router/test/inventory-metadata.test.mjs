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
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].name, 'settings.section')
  assert.equal(registrations[0].id, 'custom-router')
  assert.equal(registrations[0].label(), 'Custom Router')
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
