/**
 * The usage chip must appear ONLY while the composer is on the Antigravity route.
 *
 * MEASURED 2026-11-05, owner report: "프롬프트에서 안티그래비티 모델서빙해서 사용한 이후
 * 다른 플러그인 모델 서빙해도 이렇게 표시가 되네". The live session log
 * (`session-13e95450-…`) recorded `model/selection = antigravity/gemini-3.8-flash`,
 * a later screenshot showed the DeepSeek-V4.1-Flash model selector, and the chip
 * still printed `사용량 179,958` — the chip had no route gate at all.
 *
 * Ownership is decided by the PROVIDER id this package registers, never by a model
 * id: the same catalog ids are resold by other routers.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

/** Load the client factory with a React stand-in. */
function loadClient() {
  let captured = null
  const React = {
    createElement: () => null,
    useState: (init) => [typeof init === 'function' ? init() : init, () => {}],
    useEffect: () => {},
    useReducer: (r, i) => [i, () => {}],
    useCallback: (fn) => fn,
  }
  globalThis.window = {
    __ModuleLoader__: {
      load: ({ factory }) => {
        captured = factory((name) => (name === 'react' ? React : {}))
      },
    },
  }
  globalThis.document = {
    head: { querySelector: () => true, appendChild: () => {} },
    createElement: () => ({ setAttribute() {}, textContent: '' }),
  }
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'require', source)(globalThis.window, globalThis.document, () => React)
  return captured
}

/** Point the fake composer chip at one route. */
function select(provider, model) {
  globalThis.document.querySelector = (selector) => (selector === '[data-provider-id][data-model-id]'
    ? { getAttribute: (name) => (name === 'data-provider-id' ? provider : model) }
    : null)
}

const client = loadClient()

test('the provider id is the one this package registers', () => {
  assert.equal(client.PROVIDER_ID, 'antigravity')
  assert.ok(typeof client.isOwnRoute === 'function', 'the gate must be exported for this test')
})

test('our own route shows the chip', () => {
  select('antigravity', 'gemini-3.8-flash-low')
  assert.equal(client.isOwnRoute(), true)
})

test('every other provider hides the chip', () => {
  for (const provider of ['deepseek-account', 'opencode-http-agent', 'deepinfra', 'subrouter', 'agy', '', null]) {
    select(provider, 'gemini-3.8-flash-low')
    assert.equal(client.isOwnRoute(), false, String(provider) + ' must not show the chip')
  }
})

test('the model id alone is not evidence of ownership', () => {
  select('deepseek-account', 'gemini-3.8-flash-low')
  assert.equal(client.isOwnRoute(), false, 'a model id from our catalog served by another route is foreign')
})

test('no composer chip means no chip (it cannot claim a route it cannot see)', () => {
  globalThis.document.querySelector = () => null
  assert.equal(client.isOwnRoute(), false)
})

test('the component renders nothing off-route and re-reads the route when it changes', () => {
  const start = source.indexOf('function UsageChip(')
  assert.ok(start >= 0, 'UsageChip must exist')
  const rest = source.slice(start + 1)
  const end = rest.indexOf('\n    function ')
  const body = end < 0 ? rest : rest.slice(0, end)
  assert.match(body, /if \(!onRoute\) return null/, 'off-route must occupy no seat')
  assert.match(body, /watchRoute\(/, 'a model switch must re-evaluate the gate')
  assert.doesNotMatch(body, /if \(!snapshot\)[^\n]*return null[^\n]*if \(!onRoute\)/, 'order sanity')
})

test('the chip stays in the additive list seat, not the single activity seat', () => {
  assert.match(source, /slots\.inject\('conversation\.input\.right'/)
  assert.doesNotMatch(source, /slots\.inject\('conversation\.input\.activity'/, 'the activity seat is single and owned by tk')
})
