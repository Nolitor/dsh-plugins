/**
 * The cost pill must appear ONLY while this plugin's own route is selected.
 *
 * Measured 2026-11-04 (owner report + live DOM): the slot component rendered the
 * chip for every provider, so selecting a DeepSeek account model or any other
 * API still showed "$0.31" next to the model selector. The figure then described
 * a session this adapter had not served — and the chip also opened the OpenCode
 * plan panel from a model that has nothing to do with OpenCode.
 *
 * The rule already existed for the old DOM path (`paintCostPill` ->
 * `usingOwnRoute()`); it was simply missing from the React component that
 * replaced it. This file pins the rule at the source level, because the component
 * is a browser module and the repo has no React test harness.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** The body of one named function, from its declaration to the next top-level one. */
function bodyOf(name) {
  const start = SRC.indexOf('function ' + name + '(')
  assert.ok(start >= 0, name + ' must exist')
  const rest = SRC.slice(start + 1)
  const end = rest.indexOf('\n    function ')
  return end < 0 ? rest : rest.slice(0, end)
}

test('the route gate reads the provider and model stamped on the composer chip', () => {
  const gate = bodyOf('usingOwnRoute')
  assert.match(gate, /data-provider-id/)
  assert.match(gate, /data-model-id/)
  assert.match(gate, /opencode-http-agent/)
  assert.match(gate, /opencode\(-go\)\?/, 'a route id like opencode-go/... must count as ours')
})

test('the pill component applies the route gate before it renders anything', () => {
  const pill = bodyOf('CostPill')
  assert.match(pill, /usingOwnRoute\(\)/, 'the component must consult the gate')
  assert.match(pill, /if \(!onRoute\) return null/, 'a foreign route must render NOTHING')
  // And it must re-check: switching models does not remount the slot.
  assert.match(pill, /setInterval\(\s*sync/, 'the gate must be polled, not read once')
})

test('the pill does not poll cost while another provider is selected', () => {
  const pill = bodyOf('CostPill')
  assert.match(pill, /if \(!onRoute\) return undefined/, 'no cost request on a foreign route')
  // The effect that fetches depends on the gate, so a switch re-runs it.
  assert.match(pill, /\}, \[onRoute\]\)/)
})

test('the legacy DOM painter keeps the same gate', () => {
  const paint = bodyOf('paintCostPill')
  assert.match(paint, /if \(!usingOwnRoute\(\)\)/, 'both paths must agree')
})

test('only one place decides ownership, so the two paths cannot drift', () => {
  const matches = SRC.match(/function usingOwnRoute\(/g) ?? []
  assert.equal(matches.length, 1, 'one gate, used by both render paths')
})
