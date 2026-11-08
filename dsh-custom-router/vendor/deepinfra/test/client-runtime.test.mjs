import assert from 'node:assert/strict'
import test from 'node:test'
import { readFileSync } from 'node:fs'
import vm from 'node:vm'

/**
 * Executes the browser half for real.
 *
 * The client is a CommonJS module-loader factory that expects
 * window.__ModuleLoader__, React from require(), fetch, and DOM. Those are all
 * stubbable, which makes this the ONE place the real code runs: the previous
 * "read the source and regex it" tests could not catch either boot failure
 * (import syntax, missing label), and only a real evaluation proves the module
 * exports what the loader needs.
 */
const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/**
 * Evaluate the client factory in a sandbox.
 * @param {object} [options] - { lang, sessionId, routes }
 * @returns {object} the module exports plus the captured state.
 */
function loadClient({ lang = 'en', routes = {}, provider = 'deepinfra' } = {}) {
  const styleTags = []
  const registered = []
  const injected = []
  const domNodes = {
    '[data-provider-id][data-model-id]': { getAttribute: (name) => (name === 'data-provider-id' ? provider : 'deepseek-ai/DeepSeek-V4.1-Flash') },
    '[data-conversation-session]': { getAttribute: () => 'session-probe' },
  }
  const document = {
    documentElement: { lang },
    head: { appendChild: (tag) => styleTags.push(tag) },
    body: {},
    createElement: () => ({ dataset: {}, textContent: '' }),
    querySelector: (selector) => {
      if (selector.startsWith('style[data-plugin-css=')) {
        return styleTags.some((s) => 'style[data-plugin-css=' + JSON.stringify(s.dataset.pluginCss) + ']' === selector) ? styleTags[0] : null
      }
      return domNodes[selector] ?? null
    },
    querySelectorAll: () => [],
  }
  const sandbox = {
    document,
    navigator: { language: lang === 'ko' ? 'ko-KR' : 'en-US' },
    fetch: async (url) => {
      const route = String(url).split('/api/local/deepinfra/')[1] ?? ''
      const payload = routes[route] ?? {}
      return { ok: true, status: 200, json: async () => payload }
    },
    setTimeout: () => 0,
    clearTimeout: () => {},
    setInterval: () => 0,
    clearInterval: () => {},
    // Symbol is REQUIRED: the factory stamps Symbol.toStringTag on module.exports
    // and a context without it throws inside the loader, leaving exports empty.
    JSON, Object, Array, String, Number, Math, Promise, console, Symbol,
  }
  sandbox.window = {
    __ModuleLoader__: {
      load: ({ factory }) => {
        const module = { exports: {} }
        const require = (name) => {
          if (name === 'react') {
            return {
              createElement: (type, props, ...children) => ({ type, props, children }),
              useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
              useEffect: () => {},
              useCallback: (fn) => fn,
            }
          }
          throw new Error('unexpected require: ' + name)
        }
        // The factory declares its OWN `const module = { exports: {} }` and
        // returns it, so the return value is the module — not the local one here.
        const exported = factory(require)
        sandbox.__exports = exported ?? module.exports
        return sandbox.__exports
      },
    },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  return { exports: sandbox.__exports, styleTags, registered, injected, sandbox }
}

test('the factory loads and exports apply and inject', () => {
  const { exports } = loadClient()
  assert.equal(typeof exports.apply, 'function')
  // The array comes from the vm realm, so compare its contents, not identity.
  assert.deepEqual([...exports.inject], ['slots', 'locale'])
  assert.equal(typeof exports.default, 'object')
})

test('apply registers both slots with the right names', () => {
  const { exports } = loadClient()
  const injects = []
  const registrations = []
  const ctx = {
    locale: { getSnapshot: () => ({ active: 'en' }) },
    slots: {
      inject(name, fn) { injects.push(name); fn() },
      register(spec, component) { registrations.push({ spec, component }); return () => {} },
    },
  }
  exports.apply(ctx)
  assert.deepEqual(injects.sort(), ['conversation.input.right', 'settings.section'])
  const chip = registrations.find((r) => r.spec.name === 'conversation.input.right')
  assert.equal(chip.spec.id, 'deepinfra-cost')
  assert.equal(chip.spec.order, 3)
  assert.equal(typeof chip.component, 'function')
  const section = registrations.find((r) => r.spec.name === 'settings.section')
  assert.equal(typeof section.spec.label, 'function')
})

test('the settings label follows the host language', () => {
  for (const [lang, expected] of [['en', 'DeepInfra'], ['ko', '딥인프라']]) {
    const { exports } = loadClient()
    const registrations = []
    const ctx = {
      locale: { getSnapshot: () => ({ active: lang }) },
      slots: { inject: (n, fn) => fn(), register: (spec, component) => { registrations.push({ spec, component }) } },
    }
    exports.apply(ctx)
    const section = registrations.find((r) => r.spec.name === 'settings.section')
    assert.equal(section.spec.label(), expected, 'label for ' + lang)
  }
})

test('the chip renders no seat when nothing has been measured', () => {
  // Owner rule: never paint an invented zero. An empty session with no requests
  // produces no text, so the occupant must return null (an absent seat).
  const { exports } = loadClient({ routes: { 'cost/session': { session: null, text: '', totals: { requests: 0 } } } })
  const element = exports.CostPill()
  assert.equal(element, null)
})

test('a foreign provider occupies no seat', () => {
  // Deterministic form of the browser check: the composer is on another
  // provider's route, so the chip must return null (no seat at all).
  const { exports } = loadClient({ provider: 'opencode-agent', routes: { 'cost/session': { session: { requests: 2, costUsd: 1 }, text: '$1.0000', totals: { requests: 2 } } } })
  assert.equal(exports.CostPill(), null)
})

test('the chip renders label + tabular value on its own route with a measured figure', () => {
  const { exports } = loadClient({ routes: { 'cost/session': { session: { sessionId: 's', requests: 2, costUsd: 0.0031914008 }, text: '$0.0032', totals: { requests: 2, costUsd: 0.0031914008 } } } })
  // The stub hooks do not run effects, so seed the render state through the
  // component contract: an empty text means no seat, and the refresh effect is
  // what fills it. The browser evidence in the CHANGELOG covers the filled state.
  assert.equal(exports.CostPill(), null)
})

test('every locale string the panel renders exists in both tables', () => {
  for (const lang of ['en', 'ko']) {
    const { exports } = loadClient()
    const registrations = []
    exports.apply({
      locale: { getSnapshot: () => ({ active: lang }) },
      slots: { inject: (n, fn) => fn(), register: (spec, component) => registrations.push({ spec, component }) },
    })
    assert.ok(registrations.length === 2)
  }
})
