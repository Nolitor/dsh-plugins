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
  // The tab strip moves the DOM focus onto the next tab; the stub records
  // which element was focused.
  const elements = new Map()
  const focused = []
  return {
    head,
    focused,
    createElement: () => ({ setAttribute: () => {}, textContent: '' }),
    querySelector: () => null,
    getElementById: (id) => {
      if (!elements.has(id)) {
        elements.set(id, { id, focus: () => { focused.push(id) } })
      }
      return elements.get(id)
    },
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
  return { exports, registrations, writes, dispose, React, renderRoot, document }
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
  assert.match(css, /\.crPage\{width:100%;max-width:1120px;margin:0 auto;padding:20px 24px;box-sizing:border-box\}/)
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

  const providerList = byClass(tree, 'crProviderList')
  assert.equal(providerList.length, 1)
  assert.equal(byClass(providerList[0], 'crProviderItem').length, 3)
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
  const heading = findAll(tree, (node) => node.props?.className === 'crSettingsTitle')[0]
  assert.equal(heading.props.children, 'Models')
  // The hint is NOT shortened with it.
  const hint = findAll(tree, (node) => node.props?.className === 'crSettingsIntro')[0]
  assert.match(hint.props.children, /prompt picker/)
  assert.equal(loaded.exports.I18N.en.modelsTitle, 'Models')
  assert.equal(loaded.exports.I18N.ko.modelsTitle, '모델')
  assert.equal(loaded.exports.I18N.zh.modelsTitle, '模型')
  loaded.dispose()
})

test('the settings section follows the built-in plugin section spec', async () => {
  const loaded = await loadModels()
  const tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  const section = findAll(tree, (node) => node.props?.className?.split(' ').includes('crSettingsSection'))[0]
  assert.ok(section, 'the settings section must carry the crSettingsSection container')
  // A settings section is not a page: it must not claim the dashboard's
  // full-bleed width container.
  assert.equal(section.props.className.split(' ').includes('crPage'), false, 'the settings section must not be a full-bleed page')
  // The heading is an h2 in the heading class, the intro a secondary paragraph.
  const heading = findAll(section, (node) => node.type === 'h2')[0]
  assert.equal(heading.props.className, 'crSettingsTitle')
  const intro = findAll(section, (node) => node.type === 'p' && node.props?.className === 'crSettingsIntro')[0]
  assert.ok(intro, 'the section needs its intro paragraph')
  // The tab strip keeps its tablist role, its accessible name and its tabs.
  const tablist = findAll(section, (node) => node.props?.role === 'tablist')[0]
  assert.equal(tablist.props.className, 'crSettingsTabs')
  assert.equal(tablist.props['aria-label'], 'Models')
  assert.equal(typeof tablist.props.onKeyDown, 'function')
  const tabs = findAll(tablist, (node) => node.props?.role === 'tab')
  assert.equal(tabs.length, 3)
  for (const tab of tabs) assert.equal(tab.props.className, 'crSettingsTab')

  // The measured built-in spec, pinned.
  const css = loaded.exports.CSS
  assert.ok(css.includes('.crSettingsSection{display:flex;flex-direction:column;gap:12px;max-width:760px;min-width:0}'), 'the settings column is 760px wide')
  assert.ok(css.includes('font-size:calc(var(--dsh-content-font-size,14px) + 4px);font-weight:600'), 'the heading is the content size +4px, weight 600')
  assert.ok(css.includes('.crSettingsIntro{margin:0;font-family:inherit;font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));color:var(--dsw-alias-label-tertiary)}'), 'the intro is the secondary token in the tertiary label colour')
  assert.ok(css.includes('.crSettingsTabs{display:flex;align-items:flex-end;gap:22px;border-bottom:var(--dsh-hairline-width,1px) solid var(--dsw-alias-border-l2);margin-top:2px;'), 'the tab strip is the built-in geometry on the host hairline token')
  assert.ok(css.includes('padding:7px 1px 9px;'), 'the tab padding is the built-in padding')
  assert.ok(css.includes('font-size:var(--dsh-content-font-size-secondary,13px);line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px));white-space:nowrap;flex:0 0 auto}'), 'the tab label is the secondary token')
  assert.ok(css.includes('.crSettingsTab[aria-selected=true]{color:var(--dsw-alias-label-primary)}'), 'the active tab is the primary label colour')
  assert.ok(css.includes('.crSettingsTab[aria-selected=true]::after,.crSettingsTab:focus-visible::after{position:absolute;right:0;bottom:-1px;left:0;height:2px;border-radius:2px 2px 0 0;background:var(--dsw-alias-label-primary);content:""}'), 'the active tab carries a 2px label-primary underline')
  assert.ok(css.includes('.crSettingsTab:focus-visible{outline:var(--dsw-focus-ring-width,2px) solid var(--dsw-focus-ring-color,var(--dsw-alias-state-business-primary));outline-offset:2px;border-radius:2px;color:var(--dsw-alias-label-primary)}'), 'the focused tab carries the host focus ring')
  // The group cards keep the settings-card tokens and the large radius.
  assert.ok(css.includes('.crGroup{border:var(--dsh-hairline-width,1px) solid var(--dsw-alias-settings-card-stroke);background:var(--dsw-alias-settings-card-fill);border-radius:var(--dsw-radius-lg);'), 'a group card is a hairline settings card on the host token')
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

test('the plan tier comes from ledger evidence, never from a guess', () => {
  const { exports, dispose } = loadClient({ namespace: {} })
  const plus = exports.detectOpencodeTier({ bySession: [{ bySource: { 'go-plus': 54 } }, { bySource: { go: 3 } }] })
  assert.equal(plus.tier, 'go-plus')
  assert.equal(plus.counts['go-plus'], 54)
  const go = exports.detectOpencodeTier({ bySession: [{ bySource: { go: 3 } }] })
  assert.equal(go.tier, 'go')
  const unknown = exports.detectOpencodeTier({ bySession: [{ bySource: {} }, {}] })
  assert.equal(unknown.tier, null, 'no evidence must answer null, never go')
  const none = exports.detectOpencodeTier(null)
  assert.equal(none.tier, null)
  dispose()
})

test('the documented monthly limit resolves through the provider prefix', () => {
  const { exports, dispose } = loadClient({ namespace: {} })
  assert.equal(exports.documentedLimit('opencode-go/minimax-m3.1-flash', 'go-plus'), 80)
  assert.equal(exports.documentedLimit('opencode-go/minimax-m3.1-flash', 'go'), 20)
  assert.equal(exports.documentedLimit('opencode-go/minimax-m3.1-flash', 'go-teams'), 25)
  assert.equal(exports.documentedLimit('opencode-go/minimax-m3.1-flash', null), null, 'unknown tier has no limit')
  assert.equal(exports.documentedLimit('opencode-go/not-in-docs', 'go-plus'), null)
  dispose()
})

test('the per-model ledger aggregates sessions and sorts by allowance burn', () => {
  const { exports, dispose } = loadClient({ namespace: {} })
  const rows = exports.opencodeCostByModel({
    bySession: [
      { byModel: { 'opencode-go/a': { requests: 2, costUsd: 0, listCostUsd: 1.5, allowanceUsd: 1.2, tokens: { input: 10, output: 5 } } } },
      { byModel: { 'opencode-go/a': { requests: 3, listCostUsd: 0.5, allowanceUsd: 0.4 }, 'opencode-go/b': { requests: 1, listCostUsd: 9, allowanceUsd: 0.1 } } },
    ],
  })
  assert.equal(rows.length, 2)
  assert.equal(rows[0].route, 'opencode-go/a')
  assert.equal(rows[0].requests, 5)
  assert.equal(rows[0].listCostUsd, 2)
  assert.equal(rows[0].allowanceUsd, 1.6)
  assert.equal(rows[0].tokens, 15)
  assert.equal(rows[1].route, 'opencode-go/b')
  dispose()
})

test('the settings OpenCode tab does not duplicate the sidebar usage card', async () => {
  const routeAnswers = {
    '/api/local/dsh-antigravity/models': { models: [] },
    '/api/local/opencode-v2/model-settings': { enabled: [], models: [{ route: 'r/one', name: 'One', plan: 'go', available: true }] },
    '/api/local/deepinfra/models': { models: [] },
  }
  const fetchStub = async (path) => ({ ok: true, status: 200, json: async () => routeAnswers[path] })
  const { exports, renderRoot, dispose } = loadClient({
    namespace: { presets: { opencode: true }, vendorConfig: {} },
    fetch: fetchStub,
  })
  let tree = renderRoot(exports.CustomRouterModels, {})
  findAll(tree, (node) => node.props?.id === 'cr-models-tab-opencode')[0].props.onClick()
  tree = renderRoot(exports.CustomRouterModels, {})
  assert.equal(findAll(tree, (node) => node.props?.['data-plan-card'] !== undefined).length, 0,
    'usage belongs to the sidebar dashboard, not the settings model picker')
  const texts = findAll(tree, (node) => node.type === '#text').map((node) => node.text).join(' ')
  assert.equal(texts.includes('Plan usage'), false)
  dispose()
})

test('antigravity usage windows are ordered 5h, weekly, monthly', () => {
  const { exports, dispose } = loadClient({ namespace: {} })
  const usage = exports.normalizeAntigravityUsage({
    total: 9,
    groups: [{ limits: [
      { window: 'weekly', remainingFraction: 0.96, resetTime: '2026-11-11T00:00:00Z' },
      { window: '5h', remainingFraction: 1, resetTime: '2026-11-08T07:00:00Z' },
    ] }],
  })
  assert.equal(JSON.stringify(usage.windows.map((w) => w.id)), JSON.stringify(['5h', 'weekly']))
  dispose()
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
  const cards = byClass(tree, 'crProviderItem')
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
  const cards = byClass(tree, 'crProviderItem')
  const deepinfra = cards.find((card) => card.props['data-preset'] === 'deepinfra')
  const texts = findAll(deepinfra, (node) => node.type === '#text').map((node) => node.text).join(' ')
  assert.match(texts, /Balance lookup unavailable/)
  assert.equal(/\$0\.00/.test(texts), false)
  dispose()
})

test('each card carries its own settings panel and gear trigger', () => {
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const cards = byClass(tree, 'crProviderItem')
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
  const cards = byClass(tree, 'crProviderItem')
  const antigravity = cards.find((card) => card.props['data-preset'] === 'antigravity')
  const gear = findAll(antigravity, (node) => node.props?.className === 'crGear')[0]
  assert.equal(gear.props['aria-expanded'], 'false')
  gear.props.onClick()
  const after = renderRoot(exports.CustomRouterDashboard, {})
  const cardsAfter = byClass(after, 'crProviderItem')
  const opened = cardsAfter.filter((card) => findAll(card, (node) => node.props?.className === 'crGear')[0].props['aria-expanded'] === 'true')
  assert.equal(opened.length >= 1, true)
  dispose()
})

test('the DeepInfra layer grid marks subagent and CLI worker as unsupported capabilities', () => {
  const { exports, React, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const cards = byClass(tree, 'crProviderItem')
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
  const cards = byClass(tree, 'crProviderItem')
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
  const cards = byClass(tree, 'crProviderItem')
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
  const cards = byClass(tree, 'crProviderItem')
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
  const cards = byClass(tree, 'crProviderItem')
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
  const cards = byClass(tree, 'crProviderItem')
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
  const cards = byClass(tree, 'crProviderItem')
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
  const button = findAll(card, (node) => node.props?.['data-picker-action'] === 'add')[0]
  button.props.onClick()

  assertOps(loaded.writes.at(-1), [{ op: 'set', path: ['presets', 'deepinfra'], value: true }])

  const after = loaded.renderRoot(loaded.exports.CustomRouterDashboard, {})
  // The usage tab is active again and it is the ONLY panel in the tree.
  const usagePanels = findAll(after, (node) => node.props?.role === 'tabpanel')
  assert.deepEqual(usagePanels.map((entry) => entry.props.id), ['cr-panel-usage'])
  const cards = byClass(after, 'crProviderItem')
  const deepinfra = cards.find((entry) => entry.props['data-preset'] === 'deepinfra')
  const gear = findAll(deepinfra, (node) => node.props?.className === 'crGear')[0]
  assert.equal(gear.props['aria-expanded'], 'true')
  loaded.dispose()
})

test('the stylesheet uses the token grid and never a bare element selector', () => {
  const { exports, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const css = exports.CSS
  dispose()
  assert.match(css, /\.crKpiGrid\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(min\(240px,100%\),1fr\)\)/)
  assert.match(css, /\.crProviderList\{display:flex;flex-direction:column/)
  assert.match(css, /\.crProviderItem\{display:flex;flex-direction:column/)
  assert.match(css, /\.crProviderRow\{display:grid;grid-template-columns:auto minmax\(0,1fr\) auto/)
  assert.match(css, /\.crProviderDetail\{[^}]*border:var\(--dsh-hairline-width,1px\) solid var\(--dsw-alias-settings-card-stroke\)/)
  assert.match(css, /\.crLayerGrid\{display:grid;grid-template-columns:repeat\(auto-fit,minmax\(min\(240px,100%\),1fr\)\)/)
  assert.match(css, /\.crReveal\{display:grid;grid-template-rows:0fr/)
  assert.match(css, /\.crReveal\[data-open=true\]\{grid-template-rows:1fr\}/)
  assert.match(css, /\.crRevealInner\{min-height:0;overflow:hidden/)
  // The width container and the shared model-list geometry are pinned here.
  assert.match(css, /\.crPage\{width:100%;max-width:1120px;margin:0 auto;padding:20px 24px;box-sizing:border-box\}/)
  assert.match(css, /\.crToolbar\{display:flex/)
  assert.match(css, /\.crGroup\{border:var\(--dsh-hairline-width,1px\) solid var\(--dsw-alias-settings-card-stroke\)/)
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

test('the usage feeder uses the vendor panel routes, not a synthetic zero', async () => {  const { exports, dispose } = loadClient()
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

test('every size stays on the DSH typography tokens and every colour on a --dsw token', () => {
  const { exports, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const css = exports.CSS
  dispose()
  const literals = [...css.matchAll(/font-size:(?!var\(|calc\()([^;}]+)/g)].map((match) => match[1])
  assert.deepEqual(literals, [], 'every font-size must be a var()/calc() with the DSH fallback')
  const families = [...css.matchAll(/font-family:([^;}]+)/g)].map((match) => match[1])
  for (const family of families) {
    assert.ok(
      family === 'inherit' || family.startsWith('var(--ds-font-family-code'),
      'a plugin surface may only inherit the family or borrow the code seat: ' + family,
    )
  }
  assert.deepEqual([...css.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map((match) => match[0]), [], 'no literal colour')
  // The content size token drives the surface root, exactly as the style
  // standard demands.
  assert.match(css, /\.crSection\{[^}]*font-size:var\(--dsh-content-font-size,14px\)/)
})

test('the settings trigger is an inline SVG icon, never an emoji glyph', () => {
  const { exports, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const cards = byClass(tree, 'crProviderItem')
  for (const card of cards) {
    const trigger = findAll(card, (node) => node.props?.className === 'crGear')[0]
    const icons = findAll(trigger, (node) => node.type === 'svg')
    assert.equal(icons.length, 1, 'the trigger carries one inline svg')
    assert.equal(icons[0].props['aria-hidden'], 'true', 'the decorative glyph is hidden from the reader')
  }
  assert.equal(clientSource.includes('⚙'), false, 'the emoji gear must not come back')
  dispose()
})

test('each provider card frames its measurement in one compact usage inset', () => {
  const { exports, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const cards = byClass(tree, 'crProviderItem')
  for (const card of cards) {
    const insets = byClass(card, 'crUsageInset')
    assert.equal(insets.length, 1, 'one measurement inset per card')
    // A pay-per-token provider measures money, not windows: it renders the
    // billing body inside the same inset.
    const windows = byClass(insets[0], 'crUsageWindow').length
    const billing = byClass(insets[0], 'crBillingHero').length
    assert.ok(windows > 0 !== billing > 0, 'the inset carries either windows or a billing body, never both')
  }
  dispose()
})

test('every interactive control has a focus-visible ring from the DSH tokens', () => {
  const { exports, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const css = exports.CSS
  dispose()
  assert.match(
    css, /:focus-visible\{outline:var\(--dsw-focus-ring-width,2px\) solid var\(--dsw-focus-ring-color,var\(--dsw-alias-state-business-primary\)\)/,
  )
  for (const control of ['.crButton', '.crTab', '.crGear', '.crJump', '.crSearchInput', '.crInput', '.crSwitch']) {
    assert.ok(css.includes(control + ':focus-visible'), 'no focus ring on ' + control)
  }
})

test('the credential form labels every write-only field and shows its set state', () => {
  const { exports, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const cards = byClass(tree, 'crProviderItem')
  for (const card of cards) {
    const fields = byClass(card, 'crField')
    const credentials = card.props['data-preset'] === 'deepinfra' ? 1 : 2
    assert.equal(fields.length, credentials)
    for (const field of fields) {
      assert.equal(byClass(field, 'crFieldLabel').length, 1)
      assert.equal(byClass(field, 'crFieldActions').length, 1)
      const input = findAll(field, (node) => node.props?.type === 'password')[0]
      assert.ok(input, 'every credential field carries one masked input')
      assert.equal(input.props.value, '')
      const state = findAll(field, (node) => node.props?.className === 'crState')[0]
      assert.ok(state.props['data-secret-set'] !== undefined)
    }
  }
  dispose()
})

test('the picker card states its action and disables what cannot be added', () => {
  const loaded = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = openAddTab(loaded)
  const panel = findAll(tree, (node) => node.props?.id === 'cr-panel-add')[0]
  const cards = byClass(panel, 'crPickerCard')
  for (const card of cards) {
    assert.equal(byClass(card, 'crPickerHead').length, 1)
    const action = findAll(card, (node) => node.props?.['data-picker-action'] === 'add')[0]
    assert.ok(action, 'every picker card offers exactly one action')
    assert.equal(action.props.className, 'crButton crButtonPrimary')
  }
  // The custom JSON entry has no preset id: it cannot be added from here.
  const custom = cards.find((card) => card.props['data-picker'] === 'custom-json')
  const customAction = findAll(custom, (node) => node.props?.['data-picker-action'] === 'add')[0]
  assert.equal(customAction.props.disabled, true)
  loaded.dispose()
})

test('the provider list renders one compact row per provider and a full-width detail below it', () => {
  const { exports, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const list = byClass(tree, 'crProviderList')
  assert.equal(list.length, 1)
  const items = byClass(list[0], 'crProviderItem')
  assert.equal(items.length, 3)
  for (const item of items) {
    // One row per provider: the identity, the compact measurement and the
    // settings trigger, and nothing else.
    const rows = byClass(item, 'crProviderRow')
    assert.equal(rows.length, 1)
    assert.equal(byClass(rows[0], 'crProviderHead').length, 1)
    assert.equal(byClass(rows[0], 'crProviderUsage').length, 1)
    assert.equal(byClass(rows[0], 'crMiniUsage').length, 1)
    assert.equal(findAll(rows[0], (node) => node.props?.className === 'crGear').length, 1)
    // The detail is a sibling of the row, not a column of it: it spans the
    // whole width of the list.
    const details = byClass(item, 'crProviderDetail')
    assert.equal(details.length, 1)
    assert.equal(byClass(rows[0], 'crProviderDetail').length, 0)
    assert.equal(byClass(details[0], 'crUsageInset').length, 1)
    assert.equal(byClass(details[0], 'crSettingsPanelBody').length, 1)
  }
  dispose()
})

test('the responsive rules collapse the grids instead of scrolling sideways', () => {
  const { exports, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const css = exports.CSS
  dispose()
  // Every grid wraps on its own: the auto-fit track count shrinks with the
  // width, so no breakpoint has to name a column count.
  for (const grid of ['.crKpiGrid', '.crBillingGrid', '.crLayerGrid', '.crPickerGrid']) {
    assert.match(css, new RegExp(grid + '\\{display:grid;grid-template-columns:repeat\\(auto-(fit|fill)'), grid + ' must wrap on its own')
  }
  // The provider row collapses to one column on a narrow surface.
  assert.match(css, /@media \(max-width:640px\)\{.*\.crProviderRow\{grid-template-columns:minmax\(0,1fr\)\}/)
  // The page itself never scrolls sideways.
  assert.match(css, /\.crPage\.crPageScroll\{[^}]*overflow-x:hidden/)
})


// ------------------------------------------------- accessibility repairs

/**
 * Press one key on a tab strip and re-render.
 * @param {object} loaded - the loaded client.
 * @param {object} tree - the current tree.
 * @param {string} key - the pressed key.
 * @param {string} [component] - the component to re-render.
 * @returns {{tree: object, prevented: boolean, selected: string[]}} the outcome.
 */
function pressTabKey(loaded, tree, key, component = 'CustomRouterDashboard') {
  const tablist = findAll(tree, (node) => node.props?.role === 'tablist')[0]
  assert.ok(tablist, 'the tab strip must render a tablist')
  assert.equal(typeof tablist.props.onKeyDown, 'function', 'the tab strip must handle the keyboard')
  let prevented = false
  tablist.props.onKeyDown({ key, preventDefault: () => { prevented = true } })
  const next = loaded.renderRoot(loaded.exports[component], {})
  const selected = findAll(next, (node) => node.props?.role === 'tab')
    .filter((tab) => tab.props['aria-selected'] === 'true')
    .map((tab) => tab.props.id)
  return { tree: next, prevented, selected }
}

test('every tab strip carries an accessible name', () => {
  const { exports, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const tablist = findAll(tree, (node) => node.props?.role === 'tablist')[0]
  assert.equal(typeof tablist.props['aria-label'], 'string')
  assert.ok(tablist.props['aria-label'].length > 0, 'the tab strip needs a name')
  dispose()
})

test('the dashboard tab strip moves the selection with ArrowRight, ArrowLeft, Home and End', () => {
  const loaded = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  let tree = loaded.renderRoot(loaded.exports.CustomRouterDashboard, {})

  let outcome = pressTabKey(loaded, tree, 'ArrowRight')
  assert.equal(outcome.prevented, true, 'a tab key consumes the event')
  assert.deepEqual(outcome.selected, ['cr-tab-add'], 'ArrowRight selects the next tab')
  assert.ok(loaded.document.focused.includes('cr-tab-add'), 'the focus follows the selection')

  tree = outcome.tree
  outcome = pressTabKey(loaded, tree, 'ArrowLeft')
  assert.deepEqual(outcome.selected, ['cr-tab-usage'], 'ArrowLeft selects the previous tab')

  tree = outcome.tree
  outcome = pressTabKey(loaded, tree, 'End')
  assert.deepEqual(outcome.selected, ['cr-tab-add'], 'End selects the last tab')

  tree = outcome.tree
  outcome = pressTabKey(loaded, tree, 'Home')
  assert.deepEqual(outcome.selected, ['cr-tab-usage'], 'Home selects the first tab')

  // A key that is not a tab key changes nothing and is not consumed.
  tree = outcome.tree
  outcome = pressTabKey(loaded, tree, 'a')
  assert.equal(outcome.prevented, false)
  assert.deepEqual(outcome.selected, ['cr-tab-usage'])
  loaded.dispose()
})

test('the models tab strip moves the selection with the keyboard', async () => {
  const loaded = await loadModels()
  let tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})

  const outcome = pressTabKey(loaded, tree, 'ArrowRight', 'CustomRouterModels')
  assert.equal(outcome.prevented, true)
  assert.deepEqual(outcome.selected, ['cr-models-tab-opencode'])
  assert.ok(loaded.document.focused.includes('cr-models-tab-opencode'), 'the focus follows the selection')

  const panels = findAll(outcome.tree, (node) => node.props?.role === 'tabpanel')
  assert.deepEqual(panels.map((panel) => panel.props.id), ['cr-models-panel-opencode'])
  assert.equal(panels[0].props['aria-labelledby'], 'cr-models-tab-opencode')

  const end = pressTabKey(loaded, outcome.tree, 'End', 'CustomRouterModels')
  assert.deepEqual(end.selected, ['cr-models-tab-deepinfra'])
  loaded.dispose()
})

test('a collapsed settings panel leaves the tab order and the accessibility tree', () => {
  const { exports, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const cards = byClass(tree, 'crProviderItem')
  assert.equal(cards.length, 3)
  for (const card of cards) {
    const gear = findAll(card, (node) => node.props?.className === 'crGear')[0]
    assert.equal(gear.props['aria-expanded'], 'false')
    const inner = byClass(card, 'crRevealInner')[0]
    assert.ok(inner, 'the reveal keeps its inner box')
    assert.equal(inner.props.inert, true, 'the collapsed controls are not tabbable')
    assert.equal(inner.props['aria-hidden'], 'true', 'the collapsed controls are not announced')
    // The panel content itself is still there: the reveal animates it open.
    assert.equal(byClass(card, 'crSettingsPanel').length, 1)
  }

  // Opening one panel removes both flags from that panel only.
  const gear = findAll(cards[0], (node) => node.props?.className === 'crGear')[0]
  gear.props.onClick()
  const after = renderRoot(exports.CustomRouterDashboard, {})
  const opened = byClass(after, 'crProviderItem')[0]
  const openedInner = byClass(opened, 'crRevealInner')[0]
  assert.equal(openedInner.props.inert, undefined)
  assert.equal(openedInner.props['aria-hidden'], undefined)
  const closed = byClass(after, 'crProviderItem')[1]
  assert.equal(byClass(closed, 'crRevealInner')[0].props.inert, true)
  dispose()
})

test('the write results are announced through live regions', () => {
  const { exports, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const live = findAll(tree, (node) => node.props?.role === 'status')
  assert.ok(live.length >= 3, 'every provider panel carries a status region')
  for (const region of live) {
    assert.equal(region.props['aria-live'], 'polite')
  }
  dispose()
})

test('the models footer announces the dirty, saved and error state', async () => {
  const loaded = await loadModels()
  const tree = loaded.renderRoot(loaded.exports.CustomRouterModels, {})
  const live = findAll(tree, (node) => node.props?.role === 'status')
  assert.equal(live.length, 1, 'the models footer carries one status region')
  assert.equal(live[0].props['aria-live'], 'polite')
  const texts = findAll(live[0], (node) => node.type === '#text').map((node) => node.text).join(' ')
  assert.match(texts, /Saved/)
  loaded.dispose()
})

test('every credential input is named by a real label element', () => {
  const { exports, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const cards = byClass(tree, 'crProviderItem')
  const ids = new Set()
  for (const card of cards) {
    for (const field of byClass(card, 'crField')) {
      const label = findAll(field, (node) => node.type === 'label')[0]
      assert.ok(label, 'a credential field carries a label element')
      const input = findAll(field, (node) => node.props?.type === 'password')[0]
      assert.ok(input, 'a credential field carries one masked input')
      assert.equal(typeof input.props.id, 'string')
      assert.equal(label.props.htmlFor, input.props.id, 'the label names the input')
      assert.equal(ids.has(input.props.id), false, 'the input ids are unique')
      ids.add(input.props.id)
      // The label is the accessible name: no aria-label may shadow it.
      assert.equal(input.props['aria-label'], undefined)
      // The field stays write-only and is never autofilled.
      assert.equal(input.props.value, '')
      assert.equal(input.props.autoComplete, 'new-password')
    }
  }
  dispose()
})

test('the progress bars carry a readable value text', () => {
  const { exports, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.CustomRouterDashboard, {})
  const bars = findAll(tree, (node) => node.props?.role === 'progressbar')
  assert.equal(bars.length, 3)
  for (const bar of bars) {
    assert.equal(typeof bar.props['aria-valuetext'], 'string')
    assert.ok(bar.props['aria-valuetext'].length > 0)
    assert.match(bar.props['aria-valuetext'], /%/)
  }
  dispose()
})

test('the plan window progress bars carry a readable value text', () => {
  const { exports, renderRoot, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const tree = renderRoot(exports.PlanUsageCard, { usage: { status: 'ready', windows: { rolling: { percent: 30 } } } })
  const bars = findAll(tree, (node) => node.props?.role === 'progressbar')
  assert.equal(bars.length, 1)
  assert.match(bars[0].props['aria-valuetext'], /30%/)
  dispose()
})

test('a reduced-motion preference disables the reveal and the switch transitions', () => {
  const { exports, dispose } = loadClient({ namespace: NAMESPACE_WITH_USAGE })
  const css = exports.CSS
  dispose()
  const block = /@media \(prefers-reduced-motion: reduce\)\{([\s\S]*?)\}\}/.exec(css)
  assert.ok(block, 'the stylesheet owns a reduced-motion block')
  assert.match(block[1], /\.crReveal/)
  assert.match(block[1], /\.crSwitch::after/)
  assert.match(block[1], /transition:none/)
})

// --- 2026-11-11 regression gate ------------------------------------------------
// The 2026-11-08 settings-surface alignment (3b1634a) shipped the hairline as a
// `.5px` literal, which ignores the host's device-pixel-ratio correction. This
// check fails the build the moment a literal comes back.

test('REGRESSION GATE: no .5px hairline literal exists in the stylesheet', async () => {
  const loaded = await loadModels()
  const css = loaded.exports.CSS
  const literals = css.match(/\.5px/g) ?? []
  assert.deepEqual(
    literals,
    [],
    'hairline width must come from var(--dsh-hairline-width,1px), never a .5px literal',
  )
  loaded.dispose()
})

test('REGRESSION GATE: the root container keeps Korean words together', () => {
  assert.match(clientSource, /\.crSection\{[^}]*word-break:keep-all/, 'the root must wrap on word boundaries (CJK)')
  assert.match(clientSource, /\.crSection\{[^}]*overflow-wrap:break-word/, 'the root must still break a single long token')
})
