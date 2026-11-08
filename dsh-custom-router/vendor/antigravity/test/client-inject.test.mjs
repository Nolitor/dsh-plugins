/**
 * F-38 guard: the browser half must EXPORT the services its apply() uses.
 *
 * docs/dsh-plugin-runtime-spec.md §3.1 and docs/FAILURE-LEDGER.md F-38: the
 * loader injects only `module.exports.inject`. A `const inject = [...]` that is
 * never assigned to exports buys nothing, `ctx.<service>` is undefined, the first
 * call throws during activation, and the shell reports "web boot: N entries did
 * not activate" — which stops the ENTIRE web UI from mounting.
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
  globalThis.window = { __ModuleLoader__: { load: ({ factory }) => { captured = factory((name) => (name === 'react' ? React : {})) } } }
  globalThis.document = { head: { querySelector: () => true, appendChild: () => {} }, createElement: () => ({ setAttribute() {}, textContent: '' }) }
  // eslint-disable-next-line no-new-func
  new Function('window', 'document', 'require', source)(globalThis.window, globalThis.document, () => React)
  return captured
}

test('client exports an inject array', () => {
  const client = loadClient()
  assert.ok(Array.isArray(client.inject), 'module.exports.inject must be an array; a local const does nothing')
  assert.ok(client.inject.length > 0, 'an empty inject cannot be right when apply() reads services')
})

test('every ctx.<service> read in apply() is declared in the exported inject', () => {
  const client = loadClient()
  // Collect ctx.<name> reads from the factory source, ignoring ctx.slots.* methods.
  const reads = new Set([...source.matchAll(/ctx\.([a-zA-Z]+)/g)].map((m) => m[1]))
  const missing = [...reads].filter((name) => !client.inject.includes(name))
  assert.deepEqual(missing, [], 'apply() reads these services but does not inject them: ' + missing.join(', '))
})

test('the services actually used are slots and locale', () => {
  const client = loadClient()
  assert.deepEqual([...client.inject].sort(), ['locale', 'slots'])
})
