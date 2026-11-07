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
    Promise,
    // The section reads live vendor usage through globalThis.fetch; a test that
    // never provides one makes the merge path untestable.
    fetch: options.fetch ?? (() => Promise.reject(new Error('fetch unavailable in test'))),
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

/** Build the view model through the loaded bundle (the same code the page runs). */
function exports_buildViewModel(value, now, secrets) {
  const { exports, dispose } = loadClient({ namespace: value })
  return exports.buildViewModel(value, now, secrets)
}

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
  // Three contributions: the settings section, the sidebar panel row and its
  // `main` page. None of them may be a vendor tab.
  assert.equal(registrations.length, 3, 'settings section + sidebar panel + main page')
  const byName = (name) => registrations.filter((entry) => entry.options.name === name)
  assert.equal(byName('settings.section').length, 1)
  assert.equal(byName('sidebar.panellist').length, 1)
  assert.equal(byName('main').length, 1)
  for (const entry of registrations) {
    if (entry.options.name === 'main') assert.equal(entry.options.key, 'custom-router')
    else assert.equal(entry.options.id, 'custom-router')
  }
  const label = byName('settings.section')[0].options.label()
  assert.equal(label, 'Custom Router')
  const panelLabel = byName('sidebar.panellist')[0].options.label()
  assert.equal(panelLabel, 'Custom Router')
  dispose()
})

test('the client injects exactly slots, locale and configForms', () => {
  const { exports, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  assert.equal(JSON.stringify(exports.inject), JSON.stringify(['slots', 'locale', 'configForms']))
  dispose()
})

test('the dashboard renders inside one centred width container, not full-bleed', () => {
  const { exports, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const sections = byClass(tree, 'crSection')
  assert.equal(sections.length, 1)
  // The page container is what constrains the width; the section alone does not.
  assert.ok(sections[0].props.className.split(' ').includes('crPage'), 'the dashboard must carry the crPage container')
  const css = exports.CSS
  assert.match(css, /\.crPage\{width:100%;max-width:1180px;margin:0 auto;padding:16px 20px;box-sizing:border-box\}/)
  dispose()
})

test('the rendered dashboard has a KPI grid of three cards and a provider grid of three cards', () => {
  const { exports, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})

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
  dispose()
})

test('only the active dashboard tab panel is rendered, with role and aria wiring', () => {
  const { exports, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  let tree = renderRoot(exports.CustomRouterDashboard, {})

  const tablist = findAll(tree, (node) => node.props?.role === 'tablist')
  assert.equal(tablist.length, 1)
  const tabs = findAll(tree, (node) => node.props?.role === 'tab')
  assert.deepEqual(tabs.map((tab) => tab.props.id), ['cr-tab-usage', 'cr-tab-add'])
  assert.deepEqual(tabs.map((tab) => tab.props['aria-selected']), ['true', 'false'])
  assert.equal(tabs[0].props['aria-controls'], 'cr-panel-usage')
  // The inactive tab must not point at an element that is not in the DOM.
  assert.equal(tabs[1].props['aria-controls'], undefined)

  // ONE panel renders at a time: the old layout kept both and the add-provider
  // content showed under the dashboard because `hidden` lost to display:flex.
  let panels = findAll(tree, (node) => node.props?.role === 'tabpanel')
  assert.deepEqual(panels.map((panel) => panel.props.id), ['cr-panel-usage'])
  assert.equal(panels[0].props['aria-labelledby'], 'cr-tab-usage')
  assert.equal(byClass(tree, 'crPickerGrid').length, 0, 'the add-provider grid must not render while the usage tab is active')

  tabs[1].props.onClick()
  tree = renderRoot(exports.CustomRouterDashboard, {})
  panels = findAll(tree, (node) => node.props?.role === 'tabpanel')
  assert.deepEqual(panels.map((panel) => panel.props.id), ['cr-panel-add'])
  assert.equal(panels[0].props['aria-labelledby'], 'cr-tab-add')
  assert.equal(byClass(tree, 'crKpiGrid').length, 0, 'the dashboard grid must not render while the add tab is active')
  assert.equal(byClass(tree, 'crPickerGrid').length, 1)

  const addTabs = findAll(tree, (node) => node.props?.role === 'tab')
  assert.deepEqual(addTabs.map((tab) => tab.props['aria-selected']), ['false', 'true'])
  // No panel may carry a `hidden` attribute any more: absence is the mechanism.
  for (const panel of findAll(tree, (node) => node.props?.role === 'tabpanel')) {
    assert.equal(panel.props.hidden, undefined)
  }
  dispose()
})

test('usage windows render real progress bars with aria values', () => {
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})

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

test('live vendor usage routes feed the dashboard when the namespace carries none', async () => {
  const routeAnswers = {
    '/api/local/dsh-antigravity/models': {
      groups: [{ kind: 'gemini', limits: [{ window: 'weekly', remainingFraction: 0.96, resetTime: '2026-11-09T00:00:00Z' }] }],
      total: 19,
    },
    '/api/local/opencode-v2/plan-usage': { windows: { rolling: { percent: 12, resetsAt: '2026-11-08T05:00:00Z' } } },
    '/api/local/opencode-v2/model-settings': { models: [{ id: 'a' }, { id: 'b' }, { id: 'c' }] },
    '/api/local/deepinfra/cost/summary': {
      costUsd: 0.75,
      requests: 560,
      bySession: [{ tokens: { input: 1000, output: 200 } }],
    },
  }
  const fetchStub = async (path) => {
    if (!(path in routeAnswers)) throw new Error('unexpected route: ' + path)
    return { ok: true, status: 200, json: async () => routeAnswers[path], text: async () => JSON.stringify(routeAnswers[path]) }
  }
  const { exports, renderRoot, dispose } = loadClient({
    namespace: { presets: { antigravity: true, opencode: true, deepinfra: true }, vendorConfig: {} },
    fetch: fetchStub,
  })
  // First render runs the effect that starts the fetches; the state lands on a
  // microtask, so a second render is what proves the readings reach the view.
  renderRoot(exports.CustomRouterDashboard, {})
  await new Promise((resolve) => setTimeout(resolve, 20))
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const bars = findAll(tree, (node) => node.props?.role === 'progressbar')
  assert.ok(bars.length >= 2, `expected live windows to render bars, got ${bars.length}`)
  const texts = findAll(tree, (node) => node.type === '#text').map((node) => node.text).join(' ')
  assert.match(texts, /0\.75/, 'DeepInfra spend must render from the cost summary')
  dispose()
})

test('the next-reset KPI reads epoch-millisecond reset times', () => {
  const now = Date.parse('2026-11-08T02:00:00.000Z')
  const view = exports_buildViewModel({
    presets: { antigravity: true, opencode: true, deepinfra: true },
    vendorConfig: {},
    usage: {
      antigravity: { windows: [{ id: 'weekly', percent: 4, resetsAt: now + 3 * 3600 * 1000 }] },
    },
  }, now)
  assert.notEqual(view.nextReset, null, 'a numeric resetsAt must produce a next-reset KPI')
  assert.equal(view.nextReset.at, now + 3 * 3600 * 1000)
  assert.match(view.nextReset.window, /^(Weekly|주간)$/)
})

/** Route answers for the three model catalogs the settings section reads. */
const MODEL_ROUTE_ANSWERS = {
  '/api/local/dsh-antigravity/models': {
    total: 4,
    groups: [
      {
        kind: 'gemini',
        label: 'Gemini Models',
        quotaRemaining: 0.04,
        quotaReset: '2026-11-09T00:00:00.000Z',
        limits: [{ window: 'weekly', remainingFraction: 0.04, resetTime: '2026-11-09T00:00:00.000Z', description: 'weekly bucket' }],
        models: [
          // One BASE row per model: the three effort ids are its variants.
          { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', variants: ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low'], enabled: true },
          { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', variants: ['gemini-3.5-flash-lite'], enabled: false },
        ],
      },
      {
        kind: 'claude-gpt',
        label: 'Claude and GPT models',
        limits: [{ window: '5h', remainingFraction: 0.5 }],
        models: [{ id: 'claude-sonnet-4.5', name: 'Claude Sonnet 4.5', variants: ['claude-sonnet-4.5'], enabled: true }],
      },
    ],
  },
  '/api/local/opencode-v2/model-settings': {
    enabled: ['opencode-go/minimax-m3.1-flash'],
    models: [
      { route: 'opencode-go/minimax-m3.1-flash', name: 'MiniMax M3.1 Flash', plan: 'go', available: true, contextWindow: 200000 },
      { route: 'opencode-zen/qwen3-coder', name: 'Qwen3 Coder', plan: 'zen', available: true },
    ],
  },
  '/api/local/deepinfra/models': {
    models: [{
      id: 'inclusionAI/Ling-3.1-flash',
      contextWindow: 262144,
      vision: false,
      reasoning: true,
      promotion: { percentOff: 75 },
      price: { input: 0.075, output: 0.225, listInput: 0.3, listOutput: 0.9 },
      enabled: true,
    }],
  },
}

/** Build the models section with every catalog answered, then settle. */
async function loadModels(options = {}) {
  const answers = options.answers ?? MODEL_ROUTE_ANSWERS
  const fetchStub = async (path) => {
    if (!(path in answers)) throw new Error('unexpected route: ' + path)
    return { ok: true, status: 200, json: async () => answers[path] }
  }
  const loaded = loadClient({
    namespace: { presets: { antigravity: true, opencode: true, deepinfra: true }, vendorConfig: {} },
    fetch: options.fetch ?? fetchStub,
    secrets: options.secrets,
  })
  loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  await new Promise((resolve) => setTimeout(resolve, 20))
  return loaded
}

/** The active models tab panel of a rendered tree. */
function activeModelsPanel(tree) {
  return findAll(tree, (node) => node.props?.role === 'tabpanel')[0]
}

/** Switch to one models tab and re-render. */
function selectModelsTab(loaded, id) {
  const tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  const tab = findAll(tree, (node) => node.props?.role === 'tab').find((entry) => entry.props.id === 'cr-models-tab-' + id)
  assert.ok(tab, 'missing models tab: ' + id)
  tab.props.onClick()
  return loaded.renderRoot(loaded.exports.CustomRouterModels, {})
}

test('the models section is tabbed by preset and renders only the active tab', async () => {
  const loaded = await loadModels()
  let tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})

  const tablist = findAll(tree, (node) => node.props?.role === 'tablist')
  assert.equal(tablist.length, 1)
  const tabs = findAll(tree, (node) => node.props?.role === 'tab')
  assert.deepEqual(tabs.map((entry) => entry.props.id), [
    'cr-models-tab-antigravity',
    'cr-models-tab-opencode',
    'cr-models-tab-deepinfra',
  ])
  assert.deepEqual(tabs.map((entry) => entry.props['aria-selected']), ['true', 'false', 'false'])

  // ONE panel, and no vendor section: the three long categories are gone.
  let panels = findAll(tree, (node) => node.props?.role === 'tabpanel')
  assert.equal(panels.length, 1)
  assert.equal(panels[0].props['data-category'], 'antigravity')
  assert.equal(panels[0].props['aria-labelledby'], 'cr-models-tab-antigravity')
  assert.equal(tabs[0].props['aria-controls'], 'cr-models-panel-antigravity')
  assert.equal(tabs[1].props['aria-controls'], undefined, 'an unmounted panel must not be referenced')
  assert.equal(findAll(tree, (node) => typeof node.props?.className === 'string' && node.props.className.includes('crCategory')).length, 0)

  // Switching renders only the other vendor, with its own groups.
  tree = selectModelsTab(loaded, 'deepinfra')
  panels = findAll(tree, (node) => node.props?.role === 'tabpanel')
  assert.equal(panels.length, 1)
  assert.equal(panels[0].props['data-category'], 'deepinfra')
  assert.deepEqual(byClass(tree, 'crGroup').map((group) => group.props['data-group']), ['deepinfra'])
  assert.equal(byClass(tree, 'crGroup').length, 1, 'DeepInfra is one price card')

  tree = selectModelsTab(loaded, 'opencode')
  assert.deepEqual(byClass(tree, 'crGroup').map((group) => group.props['data-group']), ['go', 'zen'])
  loaded.dispose()
})

test('every tab shares one toolbar, group card, row and footer layout', async () => {
  const loaded = await loadModels()
  const shapes = []
  for (const id of ['antigravity', 'opencode', 'deepinfra']) {
    const tree = selectModelsTab(loaded, id)
    const panel = activeModelsPanel(tree)
    assert.equal(byClass(panel, 'crToolbar').length, 1, id + ' must carry the shared toolbar')
    assert.equal(findAll(panel, (node) => node.props?.type === 'search').length, 1, id + ' must carry the search input')
    assert.equal(byClass(panel, 'crFooterBar').length, 1, id + ' must carry the shared footer')
    assert.equal(byClass(panel, 'crGroup').length >= 1, true)
    for (const group of byClass(panel, 'crGroup')) {
      assert.equal(byClass(group, 'crGroupHead').length, 1)
      assert.equal(byClass(group, 'crGroupTitle').length, 1)
      assert.equal(byClass(group, 'crList').length, 1)
      for (const row of byClass(group, 'crRow')) {
        assert.equal(findAll(row, (node) => node.props?.type === 'checkbox').length, 1)
        assert.equal(byClass(row, 'crRowMain').length, 1)
        assert.equal(byClass(row, 'crRowName').length, 1)
        assert.equal(byClass(row, 'crPrice').length, 1)
      }
    }
    shapes.push({
      toolbar: byClass(panel, 'crToolbar').length,
      footer: byClass(panel, 'crFooterBar').length,
      headClass: byClass(panel, 'crGroupHead')[0].props.className,
    })
  }
  // The geometry is identical across vendors: the data differs, not the layout.
  assert.deepEqual(shapes.map((entry) => [entry.toolbar, entry.footer, entry.headClass]), [
    [1, 1, 'crGroupHead'],
    [1, 1, 'crGroupHead'],
    [1, 1, 'crGroupHead'],
  ])
  loaded.dispose()
})

test('the Antigravity tab groups by family, one row per base model, with the group quota in the header', async () => {
  const loaded = await loadModels()
  const tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  const panel = activeModelsPanel(tree)

  const groups = byClass(panel, 'crGroup')
  assert.deepEqual(groups.map((group) => group.props['data-group']), ['gemini', 'claude-gpt'])

  // The reasoning-effort variants collapse into ONE row per base model.
  const geminiCard = groups[0]
  const geminiRows = byClass(geminiCard, 'crRow')
  assert.deepEqual(geminiRows.map((row) => row.props['data-model']), ['gemini-3.8-flash', 'gemini-3.5-flash-lite'])
  assert.equal(geminiRows.some((row) => String(row.props['data-model']).endsWith('-high')), false)

  // The group's remaining quota (limits[].remainingFraction) rides the header.
  const geminiHead = byClass(geminiCard, 'crGroupHead')[0]
  const geminiHeadText = findAll(geminiHead, (node) => node.type === '#text').map((node) => node.text).join(' ')
  assert.match(geminiHeadText, /Weekly 4% left/)
  assert.match(geminiHeadText, /1 of 2 models selected/)

  const claudeHead = byClass(groups[1], 'crGroupHead')[0]
  const claudeHeadText = findAll(claudeHead, (node) => node.type === '#text').map((node) => node.text).join(' ')
  assert.match(claudeHeadText, /5 hours 50% left/)

  // Initial selection comes from each base row's `enabled` flag.
  const checkboxes = findAll(panel, (node) => node.props?.type === 'checkbox')
  assert.deepEqual(checkboxes.map((box) => [box.props['aria-label'], box.props.checked]), [
    ['Gemini 3.8 Flash', true],
    ['Gemini 3.5 Flash Lite', false],
    ['Claude Sonnet 4.5', true],
  ])

  // A subscription row never carries a fabricated price.
  const texts = findAll(panel, (node) => node.type === '#text').map((node) => node.text).join(' ')
  assert.match(texts, /included in plan/)
  assert.equal(/\$0\.00/.test(texts), false)
  loaded.dispose()
})

test('selecting one Antigravity row saves every reasoning-effort variant id', async () => {
  const loaded = await loadModels()
  let tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  const panel = activeModelsPanel(tree)

  // Enable the single-variant row so the saved set differs from the initial one.
  findAll(panel, (node) => node.props?.type === 'checkbox')[1].props.onChange({ target: { checked: true } })
  tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  const saveButton = findAll(activeModelsPanel(tree), (node) => node.props?.className === 'crButton crButtonPrimary')[0]
  assert.equal(saveButton.props.disabled, false)
  saveButton.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))

  // The write is the FLATTENED variant list of the selected base rows.
  assertOps(loaded.writes.at(-1), [{
    op: 'set',
    path: ['vendorConfig', 'dsh-antigravity', 'enabledModels'],
    value: [
      'gemini-3.8-flash-high',
      'gemini-3.8-flash-medium',
      'gemini-3.8-flash-low',
      'gemini-3.5-flash-lite',
      'claude-sonnet-4.5',
    ],
  }])
  loaded.dispose()
})

test('toggling an Antigravity base row moves all of its variants together', async () => {
  const loaded = await loadModels()
  let tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  const panel = activeModelsPanel(tree)
  // Uncheck the enabled Gemini 3.8 Flash row, then re-check it.
  findAll(panel, (node) => node.props?.type === 'checkbox')[0].props.onChange({ target: { checked: false } })
  tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  let boxes = findAll(activeModelsPanel(tree), (node) => node.props?.type === 'checkbox')
  assert.deepEqual(boxes.map((box) => [box.props['aria-label'], box.props.checked]), [
    ['Gemini 3.8 Flash', false],
    ['Gemini 3.5 Flash Lite', false],
    ['Claude Sonnet 4.5', true],
  ])
  findAll(activeModelsPanel(tree), (node) => node.props?.type === 'checkbox')[0].props.onChange({ target: { checked: true } })
  tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  boxes = findAll(activeModelsPanel(tree), (node) => node.props?.type === 'checkbox')
  assert.equal(boxes[0].props.checked, true)
  loaded.dispose()
})

test('the DeepInfra tab renders per-1M rates, the promotion badge and the struck-through list price', async () => {
  const loaded = await loadModels()
  const tree = selectModelsTab(loaded, 'deepinfra')
  const panel = activeModelsPanel(tree)
  const texts = findAll(panel, (node) => node.type === '#text').map((node) => node.text).join(' ')
  assert.match(texts, /in \$0\.075 · out \$0\.225 \/ 1M/, 'current rate renders per 1M tokens')
  assert.match(texts, /in \$0\.300 · out \$0\.900 \/ 1M/, 'list price renders beside it')
  assert.match(texts, /75% off/, 'the promotion badge must render')
  assert.match(texts, /262K ctx/)
  assert.equal(byClass(panel, 'crPriceList').length, 1, 'the list price is struck through')
  assert.equal(byClass(panel, 'crBadgeMeta').filter((badge) => badge.props['data-tone'] === 'promo').length >= 1, true)
  loaded.dispose()
})

test('the OpenCode tab groups by plan and never fabricates a price', async () => {
  const loaded = await loadModels()
  const tree = selectModelsTab(loaded, 'opencode')
  const panel = activeModelsPanel(tree)
  assert.deepEqual(byClass(panel, 'crGroup').map((group) => group.props['data-group']), ['go', 'zen'])
  const texts = findAll(panel, (node) => node.type === '#text').map((node) => node.text).join(' ')
  assert.match(texts, /included in plan/)
  assert.equal(/\$/.test(texts), false, 'a subscription route carries no dollar figure')
  assert.equal(byClass(panel, 'crPriceList').length, 0)
  loaded.dispose()
})

test('saving a preset writes the enabledModels list for that preset row', async () => {
  const answers = {
    '/api/local/dsh-antigravity/models': { models: [{ id: 'a', name: 'A', enabled: true }] },
    '/api/local/opencode-v2/model-settings': { enabled: [], models: [{ route: 'r/one', name: 'One', plan: 'go', available: true }] },
    '/api/local/deepinfra/models': {
      models: [
        { id: 'm/one', price: { input: 1, output: 2, listInput: 1, listOutput: 2 }, enabled: true },
        { id: 'm/two', price: { input: 1, output: 2, listInput: 1, listOutput: 2 }, enabled: false },
      ],
    },
  }
  const loaded = await loadModels({ answers })
  let tree = selectModelsTab(loaded, 'deepinfra')
  // The flat Antigravity payload still renders one card of single-id rows.
  const boxes = findAll(activeModelsPanel(tree), (node) => node.props?.type === 'checkbox')
  assert.equal(boxes.length, 2)
  boxes[0].props.onChange({ target: { checked: false } })
  boxes[1].props.onChange({ target: { checked: true } })
  tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  const saveButton = findAll(activeModelsPanel(tree), (node) => node.props?.className === 'crButton crButtonPrimary')[0]
  assert.ok(saveButton, 'the footer must offer a save button')
  saveButton.props.onClick()
  await new Promise((resolve) => setTimeout(resolve, 10))
  assertOps(loaded.writes.at(-1), [{ op: 'set', path: ['vendorConfig', 'dsh-deepinfra', 'enabledModels'], value: ['m/two'] }])
  loaded.dispose()
})

test('each preset saves its own exact payload through the same shared write', async () => {
  // Two DeepInfra rows, so a save can move off the seeded set without emptying it.
  const answers = {
    ...MODEL_ROUTE_ANSWERS,
    '/api/local/deepinfra/models': {
      models: [
        MODEL_ROUTE_ANSWERS['/api/local/deepinfra/models'].models[0],
        { id: 'google/gemma-3-27b', price: { input: 0.06, output: 0.12, listInput: 0.06, listOutput: 0.12 }, enabled: false },
      ],
    },
  }
  const loaded = await loadModels({ answers })
  const saveActive = async () => {
    const tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
    const button = findAll(activeModelsPanel(tree), (node) => node.props?.className === 'crButton crButtonPrimary')[0]
    assert.equal(button.props.disabled, false, 'a dirty selection must enable save')
    button.props.onClick()
    await new Promise((resolve) => setTimeout(resolve, 10))
    return loaded.writes.at(-1)
  }

  // Antigravity: the seeded set, written as the FLATTENED variant ids.
  findAll(activeModelsPanel(loaded.renderRoot(loaded.exports.CustomRouterModels, {})), (node) => node.props?.type === 'checkbox')[1].props.onChange({ target: { checked: true } })
  assertOps(await saveActive(), [{
    op: 'set',
    path: ['vendorConfig', 'dsh-antigravity', 'enabledModels'],
    value: [
      'gemini-3.8-flash-high',
      'gemini-3.8-flash-medium',
      'gemini-3.8-flash-low',
      'gemini-3.5-flash-lite',
      'claude-sonnet-4.5',
    ],
  }])

  // OpenCode: the ROUTE ids, one per row, seeded from `enabled`.
  selectModelsTab(loaded, 'opencode')
  // A tab whose seed is untouched cannot save: the guard is per tab.
  let tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  let opencodeBoxes = findAll(activeModelsPanel(tree), (node) => node.props?.type === 'checkbox')
  assert.equal(opencodeBoxes.length, 2)
  assert.equal(opencodeBoxes[1].props.checked, false, 'the zen route starts disabled')
  opencodeBoxes[1].props.onChange({ target: { checked: true } })
  assertOps(await saveActive(), [{
    op: 'set',
    path: ['vendorConfig', 'dsh-opencode-v2-http', 'enabledModels'],
    value: ['opencode-go/minimax-m3.1-flash', 'opencode-zen/qwen3-coder'],
  }])

  // DeepInfra: the model ids.
  selectModelsTab(loaded, 'deepinfra')
  tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  const deepBoxes = findAll(activeModelsPanel(tree), (node) => node.props?.type === 'checkbox')
  assert.equal(deepBoxes.length, 2)
  deepBoxes[0].props.onChange({ target: { checked: false } })
  deepBoxes[1].props.onChange({ target: { checked: true } })
  assertOps(await saveActive(), [{
    op: 'set',
    path: ['vendorConfig', 'dsh-deepinfra', 'enabledModels'],
    value: ['google/gemma-3-27b'],
  }])
  loaded.dispose()
})

test('save stays disabled until the selection is dirty, on every tab', async () => {
  const loaded = await loadModels()
  for (const id of ['antigravity', 'opencode', 'deepinfra']) {
    const tree = selectModelsTab(loaded, id)
    const panel = activeModelsPanel(tree)
    const saveButton = findAll(panel, (node) => node.props?.className === 'crButton crButtonPrimary')[0]
    assert.equal(saveButton.props.disabled, true, id + ' must not offer a no-op save')
    const texts = findAll(panel, (node) => node.type === '#text').map((node) => node.text).join(' ')
    assert.match(texts, /Saved/)
  }
  assert.equal(loaded.writes.length, 0)
  loaded.dispose()
})

test('an empty model selection cannot be saved (vendors read empty as all)', async () => {
  const loaded = await loadModels()
  let tree = selectModelsTab(loaded, 'deepinfra')
  const clear = findAll(activeModelsPanel(tree), (node) => node.props?.className?.includes('crButtonGhost'))[0]
  clear.props.onClick()
  tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  const panel = activeModelsPanel(tree)
  const saveButton = findAll(panel, (node) => node.props?.className === 'crButton crButtonPrimary')[0]
  assert.equal(saveButton.props.disabled, true, 'save must be disabled with zero models selected')
  const texts = findAll(panel, (node) => node.type === '#text').map((node) => node.text).join(' ')
  assert.match(texts, /Select at least one model/)
  assert.equal(loaded.writes.length, 0)
  loaded.dispose()
})

test('the section heading is the short "Models", in every locale', async () => {
  const loaded = await loadModels()
  const tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  const panel = activeModelsPanel(tree)
  const heading = findAll(tree, (node) => node.props?.className === 'crTitle')[0]
  assert.equal(heading.props.children, 'Models')
  // The hint is NOT shortened with it.
  const hint = findAll(tree, (node) => node.props?.className === 'crSubtitle')[0]
  assert.match(hint.props.children, /prompt picker/)
  assert.equal(loaded.exports.I18N.en.modelsTitle, 'Models')
  assert.equal(loaded.exports.I18N.ko.modelsTitle, '모델')
  assert.equal(loaded.exports.I18N.zh.modelsTitle, '模型')
  loaded.dispose()
})

test('the three presets are descriptors: shared chrome, preset-only hooks', async () => {
  const loaded = await loadModels()
  const presets = loaded.exports.MODEL_PRESETS
  assert.equal(JSON.stringify(presets.map((preset) => preset.id)), JSON.stringify(['antigravity', 'opencode', 'deepinfra']))
  // The descriptor table carries data and hooks, never elements.
  for (const preset of presets) {
    assert.equal(typeof preset.load, 'function')
    assert.equal(typeof preset.labelKey, 'string')
    assert.equal(typeof preset.row, 'string')
    // Adding a fourth preset needs only a descriptor: no `planKey`-style vendor
    // branch may be reachable from the section, so metered is a flag.
    assert.equal(preset.metered === undefined || preset.metered === true, true)
  }
  assert.equal(presets.find((preset) => preset.id === 'deepinfra').metered, true)
  assert.equal(presets.filter((preset) => preset.metered === true).length, 1)
  // The family tab owns the variant flatten; the others fall back to it.
  assert.equal(typeof presets[0].saveValue, 'function')
  assert.equal(presets[1].saveValue, undefined)
  assert.equal(presets[2].saveValue, undefined)
  // Every load() answers the SAME group shape: key + rows of {key,id,name,badges}.
  for (const preset of presets) {
    const { groups } = preset.load(MODEL_ROUTE_ANSWERS[preset.route])
    assert.equal(Array.isArray(groups), true)
    for (const group of groups) {
      assert.equal(typeof group.key, 'string')
      assert.equal(Array.isArray(group.rows), true)
      for (const row of group.rows) {
        assert.equal(typeof row.key, 'string')
        assert.equal(typeof row.id, 'string')
        assert.equal(typeof row.name, 'string')
        assert.equal(Array.isArray(row.badges), true)
        assert.equal(Array.isArray(row.variants), true)
      }
    }
  }
  loaded.dispose()
})

test('the search box filters the active tab only', async () => {
  const loaded = await loadModels()
  let tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  let search = findAll(activeModelsPanel(tree), (node) => node.props?.type === 'search')[0]
  search.props.onChange({ target: { value: 'flash-lite' } })
  tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  let rows = byClass(activeModelsPanel(tree), 'crRow')
  assert.deepEqual(rows.map((row) => row.props['data-model']), ['gemini-3.5-flash-lite'])

  // The other tabs keep their own query (empty here) and full lists.
  tree = selectModelsTab(loaded, 'opencode')
  rows = byClass(activeModelsPanel(tree), 'crRow')
  assert.equal(rows.length, 2)
  loaded.dispose()
})

test('no block characters are used for progress', () => {
  assert.equal(/[█▓▒░]/u.test(clientSource), false)
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const texts = findAll(tree, (node) => node.type === '#text').map((node) => node.text).join('')
  assert.equal(/[█▓▒░]/u.test(texts), false)
  dispose()
})

test('the DeepInfra card renders the pay-per-token billing body, never an unsupported notice', () => {
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
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
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const cards = byClass(tree, 'crVendorCard')
  const deepinfra = cards.find((card) => card.props['data-preset'] === 'deepinfra')
  const texts = findAll(deepinfra, (node) => node.type === '#text').map((node) => node.text).join(' ')
  assert.match(texts, /Balance lookup unavailable/)
  assert.equal(/\$0\.00/.test(texts), false)
  dispose()
})

test('each card carries its own settings panel and gear trigger', () => {
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
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
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const cards = byClass(tree, 'crVendorCard')
  const antigravity = cards.find((card) => card.props['data-preset'] === 'antigravity')
  const gear = findAll(antigravity, (node) => node.props?.className === 'crGear')[0]
  assert.equal(gear.props['aria-expanded'], 'false')
  gear.props.onClick()
  const after = renderRoot(exports.CustomRouterDashboard, {})
  const cardsAfter = byClass(after, 'crVendorCard')
  const opened = cardsAfter.filter((card) => findAll(card, (node) => node.props?.className === 'crGear')[0].props['aria-expanded'] === 'true')
  assert.equal(opened.length >= 1, true)
  dispose()
})

test('the DeepInfra layer grid marks subagent and CLI worker as unsupported capabilities', () => {
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
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
  const tree = renderRoot(exports.CustomRouterDashboard, {})
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
  const tree = renderRoot(exports.CustomRouterDashboard, {})
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
  const tree = renderRoot(exports.CustomRouterDashboard, {})
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
  const tree = renderRoot(exports.CustomRouterDashboard, {})
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
  const tree = renderRoot(exports.CustomRouterDashboard, {})
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
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const cards = byClass(tree, 'crVendorCard')
  const deepinfra = cards.find((card) => card.props['data-preset'] === 'deepinfra')
  const states = findAll(deepinfra, (node) => node.props?.className === 'crState')
  const secretState = states.find((state) => state.props['data-secret-set'] !== undefined)
  assert.equal(secretState.props['data-secret-set'], 'true')
  dispose()
})

/** The add-provider grid of a rendered dashboard, after switching to its tab. */
function openAddTab(loaded) {
  let tree = loaded.renderRoot(loaded.exports.CustomRouterDashboard, {})
  const tab = findAll(tree, (node) => node.props?.role === 'tab').find((entry) => entry.props.id === 'cr-tab-add')
  tab.props.onClick()
  tree = loaded.renderRoot(loaded.exports.CustomRouterDashboard, {})
  return tree
}

test('the add-provider tab panel lists four equal cards', () => {
  const loaded = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = openAddTab(loaded)
  const panel = findAll(tree, (node) => node.props?.id === 'cr-panel-add')[0]
  assert.ok(panel, 'the add-provider panel must exist once its tab is active')
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
  loaded.dispose()
})

test('adding a provider enables its preset, returns to the usage tab and opens its settings', () => {
  const loaded = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = openAddTab(loaded)
  const panel = findAll(tree, (node) => node.props?.id === 'cr-panel-add')[0]
  const card = byClass(panel, 'crPickerCard').find((entry) => entry.props['data-picker'] === 'deepinfra')
  const button = findAll(card, (node) => node.props?.className === 'crButton')[0]
  button.props.onClick()

  assertOps(loaded.writes.at(-1), [{ op: 'set', path: ['presets', 'deepinfra'], value: true }])

  const after = loaded.renderRoot(loaded.exports.CustomRouterDashboard, {})
  // The usage tab is active again and it is the ONLY panel in the tree.
  const usagePanels = findAll(after, (node) => node.props?.role === 'tabpanel')
  assert.deepEqual(usagePanels.map((entry) => entry.props.id), ['cr-panel-usage'])
  const cards = byClass(after, 'crVendorCard')
  const deepinfra = cards.find((entry) => entry.props['data-preset'] === 'deepinfra')
  const gear = findAll(deepinfra, (node) => node.props?.className === 'crGear')[0]
  assert.equal(gear.props['aria-expanded'], 'true')
  loaded.dispose()
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
  // The width container and the shared model-list geometry are pinned here.
  assert.match(css, /\.crPage\{width:100%;max-width:1180px;margin:0 auto;padding:16px 20px;box-sizing:border-box\}/)
  assert.match(css, /\.crToolbar\{display:flex/)
  assert.match(css, /\.crGroup\{border:\.[0-9]px solid var\(--dsw-alias-settings-card-stroke\)/)
  assert.match(css, /\.crRow\{display:grid;grid-template-columns:auto minmax\(0,1fr\) auto/)
  assert.match(css, /\.crPriceList\{[^}]*text-decoration:line-through/)
  assert.match(css, /\.crFooterBar\{display:flex/)
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
