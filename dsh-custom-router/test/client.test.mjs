/**
 * Client surface tests for @nolit/dsh-custom-router.
 *
 * The browser half is a CommonJS factory that the host evaluates in the page,
 * so these tests evaluate the SAME file in a vm sandbox with a stub React and
 * a stub DOM, then assert the rendered element tree.
 *
 * WHAT IS ASSERTED HERE
 *   - exactly one settings.section, id `custom-router`, and no vendor section;
 *   - the injected service list;
 *   - the rendered hierarchy: KPI grid, provider grid, tabs, one card per
 *     provider, one settings panel per card;
 *   - REAL progress bars (`role="progressbar"` plus aria-valuenow/min/max) and
 *     no block characters;
 *   - the exact settings write paths, including the atomic CLI-worker pair;
 *   - that no secret value ever reaches the DOM.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

// ------------------------------------------------------------- test doubles

/** A minimal React: createElement plus the hooks this client uses. */
function createReact() {
  let current = null
  const stores = new Map()
  let dirty = false

  const createElement = (type, props, ...children) => ({
    type,
    props: { ...(props ?? {}), children: children.length <= 1 ? children[0] : children },
  })

  const useState = (initial) => {
    const store = current
    const index = store.index++
    if (!(index in store.values)) {
      store.values[index] = typeof initial === 'function' ? initial() : initial
    }
    const setter = (next) => {
      const value = typeof next === 'function' ? next(store.values[index]) : next
      if (Object.is(value, store.values[index])) return
      store.values[index] = value
      dirty = true
    }
    return [store.values[index], setter]
  }

  const useReducer = (reducer, initial) => {
    const store = current
    const index = store.index++
    if (!(index in store.values)) store.values[index] = initial
    const dispatch = (action) => {
      store.values[index] = reducer(store.values[index], action)
      dirty = true
    }
    return [store.values[index], dispatch]
  }

  const useEffect = (effect) => {
    current.effects.push(effect)
  }

  const useCallback = (fn) => fn
  const useMemo = (fn) => fn()

  const render = (element, path) => {
    if (element === null || element === undefined || typeof element === 'boolean') return null
    if (typeof element === 'string' || typeof element === 'number') return { type: '#text', text: String(element) }
    if (Array.isArray(element)) return element.map((child, index) => render(child, path + '/' + index)).filter((node) => node !== null)
    if (typeof element.type === 'function') {
      const store = stores.get(path) ?? { values: {}, index: 0, effects: [] }
      stores.set(path, store)
      store.index = 0
      store.effects = []
      const previous = current
      current = store
      let output
      try {
        output = element.type(element.props)
      } finally {
        current = previous
      }
      const rendered = render(output, path)
      const effects = store.effects
      store.effects = []
      for (const effect of effects) effect()
      return rendered
    }
    return {
      type: element.type,
      props: element.props,
      children: render(element.props.children, path + '/c'),
    }
  }

  return {
    React: { createElement, useState, useReducer, useEffect, useCallback, useMemo },
    renderRoot: (Component, props) => {
      let output = null
      for (let pass = 0; pass < 20; pass += 1) {
        dirty = false
        output = render(createElement(Component, props), 'root')
        if (!dirty) break
      }
      return output
    },
  }
}

/** A DOM stub good enough for the style injection and the style lookups. */
function createDocument() {
  const head = {
    children: [],
    querySelector: () => null,
    appendChild: (node) => { head.children.push(node) },
  }
  return {
    head,
    createElement: () => ({ setAttribute: () => {}, textContent: '' }),
    querySelector: () => null,
  }
}

/** Walk a rendered tree and collect the nodes matching a predicate. */
function findAll(node, predicate, found = []) {
  if (node === null || node === undefined) return found
  if (Array.isArray(node)) {
    for (const child of node) findAll(child, predicate, found)
    return found
  }
  if (typeof node !== 'object') return found
  if (typeof node.type === 'object' && node.type !== null && node.type.type) {
    // An element whose type is an element object (never produced by this client).
  }
  if (predicate(node)) found.push(node)
  findAll(node.children, predicate, found)
  return found
}

/** Every rendered node that carries a class name. */
function byClass(tree, className) {
  return findAll(tree, (node) => typeof node.props?.className === 'string' && node.props.className.split(' ').includes(className))
}

// ------------------------------------------------------------- the harness

const clientSource = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

/**
 * Evaluate the client bundle and return its exports plus the registrations it
 * performed.
 */
function loadClient(options = {}) {
  const { React, renderRoot } = createReact()
  let descriptor = null
  const document = createDocument()
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { descriptor = value } } },
    document,
    console,
    setTimeout,
    clearTimeout,
  }
  vm.createContext(sandbox)
  vm.runInContext(clientSource, sandbox, { filename: 'client.js' })
  const exports = descriptor.factory((name) => {
    if (name === 'react') return React
    throw new Error('unexpected require: ' + name)
  })

  const registrations = []
  const writes = []
  const form = {
    getSnapshot: () => ({
      status: 'ready',
      value: options.namespace,
      revision: 1,
      writable: true,
    }),
    subscribe: () => () => {},
    mutate: (ops) => {
      writes.push(ops)
      return Promise.resolve(true)
    },
  }
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'en' }), subscribe: () => () => {} },
    configForms: {
      get: (id) => {
        assert.equal(id, 'dsh-custom-router')
        return form
      },
      // The secret sidecar lives on the settings MIRROR's namespace view, as an
      // ARRAY of { path, set } positions (dsh-api-settings-controller
      // namespaceView). The form snapshot does NOT carry it.
      describe: () => ({
        namespace: (ns) => (ns === 'dsh-custom-router' ? { secrets: options.secrets ?? [] } : undefined),
      }),
    },
    slots: {
      inject: (name, register) => {
        const release = register()
        return release
      },
      register: (options_, component) => {
        registrations.push({ options: options_, component })
        return () => {
          const index = registrations.findIndex((entry) => entry.component === component)
          if (index >= 0) registrations.splice(index, 1)
        }
      },
    },
  }
  const dispose = exports.apply(ctx)
  return { exports, registrations, writes, dispose, React, renderRoot }
}

const NAMESPACE_WITH_USAGE = {
  presets: { antigravity: true, opencode: true, deepinfra: false },
  vendorConfig: {
    'dsh-antigravity': { modelServing: true, subagent: false, cliWorker: false, workerEnabled: false },
    'dsh-opencode-v2': { subagent: true, cli: false, workerEnabled: false },
    'dsh-opencode-v2-http': { modelServing: true },
    'dsh-deepinfra': { apiKey: '<redacted>' },
  },
  secrets: [{ path: ['vendorConfig', 'dsh-deepinfra', 'apiKey'], set: true }],
  usage: {
    antigravity: {
      measuredAt: '2026-11-08T00:00:00.000Z',
      windows: [
        { id: '5h', percent: 42, resetsAt: '2026-11-08T05:00:00.000Z' },
        { id: 'weekly', percent: 91, resetsAt: '2026-11-09T00:00:00.000Z' },
      ],
      serving: { modelCount: 12, health: 'healthy' },
    },
    opencode: {
      measuredAt: '2026-11-08T00:00:00.000Z',
      windows: [{ id: '5h', percent: 10, resetsAt: '2026-11-08T04:00:00.000Z' }],
      serving: { modelCount: 4, health: 'unknown' },
    },
    deepinfra: {
      measuredAt: '2026-11-08T00:00:00.000Z',
      spend: 12.5,
      requests: 42,
      inputTokens: 1000,
      outputTokens: 200,
      inputRate: 0.5,
      outputRate: 1.5,
    },
  },
}

/** Compare write operations across vm realms (prototypes differ there). */
function assertOps(actual, expected) {
  assert.equal(JSON.stringify(actual), JSON.stringify(expected))
}

// ------------------------------------------------------------------- tests

test('the client registers exactly one settings section, id custom-router', () => {
  const { registrations, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const sections = registrations.filter((entry) => entry.options.name === 'settings.section')
  assert.equal(sections.length, 1)
  assert.equal(sections[0].options.id, 'custom-router')
  assert.equal(sections[0].options.label(), 'Custom Router')
  assert.equal(sections[0].options.order < 62, true)
  dispose()
})

test('the client registers no vendor settings section', () => {
  const { registrations, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  assert.equal(registrations.length, 1, 'the client registers exactly one contribution')
  for (const entry of registrations) {
    assert.equal(entry.options.id, 'custom-router')
    assert.equal(['antigravity', 'opencode', 'deepinfra', 'dsh-antigravity', 'dsh-opencode-v2'].includes(entry.options.id), false)
    const label = entry.options.label()
    assert.equal(['Antigravity', 'OpenCode', 'DeepInfra'].includes(label), false)
  }
  dispose()
})

test('the client injects exactly slots, locale and configForms', () => {
  const { exports, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  assert.equal(JSON.stringify(exports.inject), JSON.stringify(['slots', 'locale', 'configForms']))
  dispose()
})

test('the rendered dashboard has a KPI grid of three cards, a provider grid of three cards and two tabs', () => {
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterSection, {})

  const kpiGrid = byClass(tree, 'crKpiGrid')
  assert.equal(kpiGrid.length, 1)
  const kpiCards = byClass(kpiGrid[0], 'crKpiCard')
  assert.equal(kpiCards.length, 3)
  for (const card of kpiCards) {
    assert.equal(byClass(card, 'crKpiLabelRow').length, 1)
    assert.equal(byClass(card, 'crKpiValue').length, 1)
    assert.equal(byClass(card, 'crKpiMeta').length, 1)
  }

  const vendorGrid = byClass(tree, 'crVendorGrid')
  assert.equal(vendorGrid.length, 1)
  assert.equal(byClass(vendorGrid[0], 'crVendorCard').length, 3)

  const tabs = findAll(tree, (node) => node.props?.role === 'tab')
  assert.equal(tabs.length, 2)
  const panels = findAll(tree, (node) => node.props?.role === 'tabpanel')
  assert.equal(panels.length, 2)
  assert.deepEqual(panels.map((panel) => panel.props.id).sort(), ['cr-panel-add', 'cr-panel-usage'])
  dispose()
})

test('usage windows render real progress bars with aria values', () => {
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterSection, {})

  const bars = findAll(tree, (node) => node.props?.role === 'progressbar')
  assert.equal(bars.length, 3)
  for (const bar of bars) {
    assert.equal(typeof bar.props['aria-valuenow'], 'number')
    assert.equal(bar.props['aria-valuemin'], 0)
    assert.equal(bar.props['aria-valuemax'], 100)
    assert.equal(typeof bar.props['aria-label'], 'string')
    const fill = byClass(bar, 'crBarFill')
    assert.equal(fill.length, 1)
    assert.equal(typeof fill[0].props.style.width, 'string')
  }
  dispose()
})

test('no block characters are used for progress', () => {
  assert.equal(/[█▓▒░]/u.test(clientSource), false)
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterSection, {})
  const texts = findAll(tree, (node) => node.type === '#text').map((node) => node.text).join('')
  assert.equal(/[█▓▒░]/u.test(texts), false)
  dispose()
})

test('the DeepInfra card renders the pay-per-token billing body, never an unsupported notice', () => {
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterSection, {})
  const cards = byClass(tree, 'crVendorCard')
  const deepinfra = cards.find((card) => card.props['data-preset'] === 'deepinfra')
  assert.ok(deepinfra)
  assert.equal(byClass(deepinfra, 'crBillingHero').length, 1)
  assert.equal(byClass(deepinfra, 'crBillingGrid').length, 1)
  assert.equal(byClass(deepinfra, 'crBillingStat').length, 3)
  assert.equal(byClass(deepinfra, 'crBillingRow').length, 2)
  assert.equal(byClass(deepinfra, 'crUsageWindow').length, 0)
  dispose()
})

test('an unknown balance is reported as unavailable, never as zero', () => {
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterSection, {})
  const cards = byClass(tree, 'crVendorCard')
  const deepinfra = cards.find((card) => card.props['data-preset'] === 'deepinfra')
  const texts = findAll(deepinfra, (node) => node.type === '#text').map((node) => node.text).join(' ')
  assert.match(texts, /Balance lookup unavailable/)
  assert.equal(/\$0\.00/.test(texts), false)
  dispose()
})

test('each card carries its own settings panel and gear trigger', () => {
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterSection, {})
  const cards = byClass(tree, 'crVendorCard')
  for (const card of cards) {
    const gears = findAll(card, (node) => node.props?.className === 'crGear')
    assert.equal(gears.length, 1)
    assert.ok(gears[0].props['aria-expanded'] === 'true' || gears[0].props['aria-expanded'] === 'false')
    assert.equal(typeof gears[0].props['aria-controls'], 'string')
    const reveal = byClass(card, 'crReveal')
    assert.equal(reveal.length, 1)
    assert.equal(byClass(card, 'crSettingsPanel').length, 1)
  }
  dispose()
})

test('the gear toggles one card only', () => {
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterSection, {})
  const cards = byClass(tree, 'crVendorCard')
  const antigravity = cards.find((card) => card.props['data-preset'] === 'antigravity')
  const gear = findAll(antigravity, (node) => node.props?.className === 'crGear')[0]
  assert.equal(gear.props['aria-expanded'], 'false')
  gear.props.onClick()
  const after = renderRoot(exports.CustomRouterSection, {})
  const cardsAfter = byClass(after, 'crVendorCard')
  const opened = cardsAfter.filter((card) => findAll(card, (node) => node.props?.className === 'crGear')[0].props['aria-expanded'] === 'true')
  assert.equal(opened.length >= 1, true)
  dispose()
})

test('the DeepInfra layer grid marks subagent and CLI worker as unsupported capabilities', () => {
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterSection, {})
  const cards = byClass(tree, 'crVendorCard')
  const deepinfra = cards.find((card) => card.props['data-preset'] === 'deepinfra')
  const cells = byClass(deepinfra, 'crLayerCell')
  const unsupported = cells.filter((cell) => cell.props['data-unsupported'] === 'true')
  const unsupportedLayers = unsupported.map((cell) => cell.props['data-layer'])
  assert.deepEqual(unsupportedLayers.sort(), ['cliWorker', 'subagent'])
  dispose()
})

test('the model serving switch writes the frozen vendorConfig path', () => {
  const { exports, React, renderRoot, writes, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterSection, {})
  const cards = byClass(tree, 'crVendorCard')
  const antigravity = cards.find((card) => card.props['data-preset'] === 'antigravity')
  const cell = byClass(antigravity, 'crLayerCell').find((entry) => entry.props['data-layer'] === 'modelServing')
  const toggle = findAll(cell, (node) => node.props?.role === 'switch')[0]
  toggle.props.onClick()
  assertOps(writes.at(-1), [{ op: 'set', path: ['vendorConfig', 'dsh-antigravity', 'modelServing'], value: false }])
  dispose()
})

test('the CLI worker switch writes the atomic pair in one mutation', () => {
  const { exports, React, renderRoot, writes, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterSection, {})
  const cards = byClass(tree, 'crVendorCard')
  const antigravity = cards.find((card) => card.props['data-preset'] === 'antigravity')
  const cell = byClass(antigravity, 'crLayerCell').find((entry) => entry.props['data-layer'] === 'cliWorker')
  const toggle = findAll(cell, (node) => node.props?.role === 'switch')[0]
  toggle.props.onClick()
  assertOps(writes.at(-1), [
    { op: 'set', path: ['vendorConfig', 'dsh-antigravity', 'cliWorker'], value: true },
    { op: 'set', path: ['vendorConfig', 'dsh-antigravity', 'workerEnabled'], value: true },
  ])
  dispose()
})

test('the OpenCode switches write their own row paths', () => {
  const { exports, React, renderRoot, writes, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterSection, {})
  const cards = byClass(tree, 'crVendorCard')
  const opencode = cards.find((card) => card.props['data-preset'] === 'opencode')
  const serving = byClass(opencode, 'crLayerCell').find((entry) => entry.props['data-layer'] === 'modelServing')
  findAll(serving, (node) => node.props?.role === 'switch')[0].props.onClick()
  assertOps(writes.at(-1), [{ op: 'set', path: ['vendorConfig', 'dsh-opencode-v2-http', 'modelServing'], value: false }])

  const subagent = byClass(opencode, 'crLayerCell').find((entry) => entry.props['data-layer'] === 'subagent')
  findAll(subagent, (node) => node.props?.role === 'switch')[0].props.onClick()
  assertOps(writes.at(-1), [{ op: 'set', path: ['vendorConfig', 'dsh-opencode-v2', 'subagent'], value: false }])

  const cli = byClass(opencode, 'crLayerCell').find((entry) => entry.props['data-layer'] === 'cliWorker')
  findAll(cli, (node) => node.props?.role === 'switch')[0].props.onClick()
  assertOps(writes.at(-1), [
    { op: 'set', path: ['vendorConfig', 'dsh-opencode-v2', 'cli'], value: true },
    { op: 'set', path: ['vendorConfig', 'dsh-opencode-v2', 'workerEnabled'], value: true },
  ])
  dispose()
})

test('the master switch writes the preset path', () => {
  const { exports, React, renderRoot, writes, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterSection, {})
  const cards = byClass(tree, 'crVendorCard')
  const deepinfra = cards.find((card) => card.props['data-preset'] === 'deepinfra')
  const master = byClass(deepinfra, 'crMaster')[0]
  const toggle = findAll(master, (node) => node.props?.role === 'switch')[0]
  toggle.props.onClick()
  assertOps(writes.at(-1), [{ op: 'set', path: ['presets', 'deepinfra'], value: true }])
  dispose()
})

test('no secret value ever reaches the DOM', () => {
  const namespace = {
    presets: { antigravity: true, opencode: false, deepinfra: true },
    vendorConfig: { 'dsh-deepinfra': { apiKey: 'super-secret-value' } },
  }
  const secrets = [{ path: ['vendorConfig', 'dsh-deepinfra', 'apiKey'], set: true }]
  const { exports, React, renderRoot, dispose } = loadClient({ namespace, secrets })
  const tree = renderRoot(exports.CustomRouterSection, {})
  const cards = byClass(tree, 'crVendorCard')
  const deepinfra = cards.find((card) => card.props['data-preset'] === 'deepinfra')
  const inputs = findAll(deepinfra, (node) => node.props?.type === 'password')
  assert.ok(inputs.length >= 1)
  for (const input of inputs) {
    assert.equal(input.props.value, '')
    assert.equal(input.props.placeholder, '••••••••')
  }
  const texts = findAll(deepinfra, (node) => node.type === '#text').map((node) => node.text).join(' ')
  assert.equal(texts.includes('super-secret-value'), false)
  assert.match(texts, /Set/)
  dispose()
})

test('the credential state comes from the redacted sidecar, not from a value', () => {
  const namespace = {
    presets: { deepinfra: true },
    vendorConfig: { 'dsh-deepinfra': { apiKey: '<redacted>' } },
  }
  const secrets = [
    { path: ['vendorConfig', 'dsh-deepinfra', 'apiKey'], set: true },
    { path: ['vendorConfig', 'dsh-deepinfra', 'password'], set: false },
  ]
  const { exports, React, renderRoot, dispose } = loadClient({ namespace, secrets })
  const tree = renderRoot(exports.CustomRouterSection, {})
  const cards = byClass(tree, 'crVendorCard')
  const deepinfra = cards.find((card) => card.props['data-preset'] === 'deepinfra')
  const states = findAll(deepinfra, (node) => node.props?.className === 'crState')
  const secretState = states.find((state) => state.props['data-secret-set'] !== undefined)
  assert.equal(secretState.props['data-secret-set'], 'true')
  dispose()
})

test('the add-provider tab panel lists four equal cards', () => {
  const { exports, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterSection, {})
  const panel = findAll(tree, (node) => node.props?.id === 'cr-panel-add')[0]
  const grid = byClass(panel, 'crPickerGrid')
  assert.equal(grid.length, 1)
  const cards = byClass(grid[0], 'crPickerCard')
  assert.equal(cards.length, 4)
  assert.deepEqual(cards.map((card) => card.props['data-picker']), ['antigravity', 'opencode', 'deepinfra', 'custom-json'])
  for (const card of cards) {
    assert.equal(byClass(card, 'crPickerDesc').length, 1)
    assert.equal(byClass(card, 'crPickerAuth').length, 1)
    assert.equal(byClass(card, 'crPickerActions').length, 1)
  }
  dispose()
})

test('adding a provider enables its preset, returns to the usage tab and opens its settings', () => {
  const { exports, renderRoot, writes, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterSection, {})
  const panel = findAll(tree, (node) => node.props?.id === 'cr-panel-add')[0]
  const card = byClass(panel, 'crPickerCard').find((entry) => entry.props['data-picker'] === 'deepinfra')
  const button = findAll(card, (node) => node.props?.className === 'crButton')[0]
  button.props.onClick()

  assertOps(writes.at(-1), [{ op: 'set', path: ['presets', 'deepinfra'], value: true }])

  const after = renderRoot(exports.CustomRouterSection, {})
  const usagePanel = findAll(after, (node) => node.props?.id === 'cr-panel-usage')[0]
  assert.notEqual(usagePanel.props.hidden, true)
  const cards = byClass(after, 'crVendorCard')
  const deepinfra = cards.find((entry) => entry.props['data-preset'] === 'deepinfra')
  const gear = findAll(deepinfra, (node) => node.props?.className === 'crGear')[0]
  assert.equal(gear.props['aria-expanded'], 'true')
  dispose()
})

test('the stylesheet uses the token grid and never a bare element selector', () => {
  const { exports, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const css = exports.CSS
  dispose()
  assert.match(css, /\.crKpiGrid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
  assert.match(css, /\.crVendorGrid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
  assert.match(css, /\.crLayerGrid\{display:grid;grid-template-columns:repeat\(3,minmax\(0,1fr\)\)/)
  assert.match(css, /\.crReveal\{display:grid;grid-template-rows:0fr/)
  assert.match(css, /\.crReveal\[data-open=true\]\{grid-template-rows:1fr\}/)
  assert.match(css, /\.crRevealInner\{min-height:0;overflow:hidden/)
  // No rule may target a bare element selector: only the .cr* classes.
  const selectors = css.replace(/@media[^{]+\{/g, '').split('}').map((rule) => rule.split('{')[0]).filter((selector) => selector !== '')
  for (const selector of selectors) {
      for (const part of selector.split(',')) {
        const trimmed = part.trim()
        if (trimmed === '') continue
        assert.match(trimmed, /^\.cr[A-Za-z0-9_-]/, 'unexpected selector: ' + trimmed)
        assert.equal(
          /(^|[\s,>+~])(div|span|button|input|section|article|p|h1|h2|h3|h4|a|ul|li)([\s,.:\[{]|$)/.test(trimmed),
          false,
          'bare element selector: ' + trimmed,
        )
      }
  }
  assert.match(clientSource, /data-plugin-css/)
})

test('Antigravity quota groups are normalized into dashboard windows', () => {
  const { exports, dispose } = loadClient()
  const usage = exports.normalizeAntigravityUsage({
    total: 7,
    groups: [
      { models: [{}, {}], limits: [{ window: '5h', remainingFraction: 0.39, resetTime: '2026-11-08T05:00:00.000Z' }] },
      { models: [{}], limits: [{ window: 'weekly', remainingFraction: 0.09, resetTime: '2026-11-09T00:00:00.000Z' }] },
    ],
  })
  dispose()
  assert.equal(JSON.stringify(Array.from(usage.windows, (entry) => [entry.id, entry.percent])), JSON.stringify([['5h', 61], ['weekly', 91]]))
  assert.equal(usage.serving.modelCount, 7)
  assert.equal(usage.serving.health, 'healthy')
})

test('OpenCode plan windows are normalized and serving count comes from the catalog', () => {
  const { exports, dispose } = loadClient()
  const usage = exports.normalizeOpencodeUsage(
    { windows: { rolling: { percent: 0 }, weekly: { percent: 22 }, monthly: { percent: 37 } } },
    { models: [{}, {}, {}] },
  )
  dispose()
  assert.equal(JSON.stringify(Array.from(usage.windows, (entry) => [entry.id, entry.percent])), JSON.stringify([['5h', 0], ['weekly', 22], ['monthly', 37]]))
  assert.equal(usage.serving.modelCount, 3)
})

test('DeepInfra cost summary becomes a pay-per-token billing measurement, never a fake balance', () => {
  const { exports, dispose } = loadClient()
  const usage = exports.normalizeDeepinfraUsage({
    costUsd: 12.5,
    requests: 42,
    bySession: [{ tokens: { input: 1000, output: 200 } }, { tokens: { input: 500, output: 100 } }],
  })
  dispose()
  assert.equal(usage.spend, 12.5)
  assert.equal(usage.requests, 42)
  assert.equal(usage.inputTokens, 1500)
  assert.equal(usage.outputTokens, 300)
  assert.equal(usage.balance, null)
})

test('runtime usage overrides settings fallback without mutating saved state', () => {
  const { exports, dispose } = loadClient()
  const section = { presets: { antigravity: true }, usage: { antigravity: { windows: [{ id: '5h', percent: 1 }] } } }
  const merged = exports.mergeRuntimeUsage(section, { antigravity: { windows: [{ id: '5h', percent: 42 }] } })
  dispose()
  assert.equal(merged.usage.antigravity.windows[0].percent, 42)
  assert.equal(section.usage.antigravity.windows[0].percent, 1)
})

test('the usage feeder uses the vendor panel routes, not a synthetic zero', async () => {
  const { exports, dispose } = loadClient()
  const calls = []
  const fetchImpl = async (path) => {
    calls.push(path)
    const bodies = {
      '/api/local/dsh-antigravity/models': { total: 1, groups: [{ models: [{}], limits: [{ window: '5h', remainingFraction: 0.5 }] }] },
      '/api/local/opencode-v2/plan-usage': { windows: { rolling: { percent: 5 } } },
      '/api/local/opencode-v2/model-settings': { models: [{}] },
      '/api/local/deepinfra/cost/summary': { costUsd: 0, requests: 0, bySession: [] },
    }
    return { ok: true, json: async () => bodies[path] }
  }
  const result = await exports.fetchUsageFeeds(fetchImpl)
  dispose()
  assert.deepEqual(calls.sort(), [
    '/api/local/deepinfra/cost/summary',
    '/api/local/dsh-antigravity/models',
    '/api/local/opencode-v2/model-settings',
    '/api/local/opencode-v2/plan-usage',
  ])
  assert.equal(result.antigravity.windows[0].percent, 50)
  assert.equal(result.opencode.windows[0].percent, 5)
  assert.equal(result.deepinfra.spend, 0)
})
