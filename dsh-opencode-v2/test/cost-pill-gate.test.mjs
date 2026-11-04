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
  // It must re-check on change: a model switch does not remount the slot.
  assert.match(pill, /watchRoute\b/, 'the gate must follow the route, not be read once')
})

test('the route gate is event-driven, not a timer', () => {
  // Owner instruction 2026-11-04: "1초 폴링 대신 MutationObserver나 모델 변경
  // 이벤트 리스너로". A 1 s interval queried the DOM forever on every page.
  assert.doesNotMatch(SRC, /ROUTE_POLL_MS/, 'no polling constant for the route gate')
  const watcher = bodyOf('watchRoute')
  assert.match(watcher, /new MutationObserver/, 'the route gate observes the composer')
  assert.match(watcher, /attributeFilter: \[\s*'data-provider-id',\s*'data-model-id'\s*\]/, 'only the two route attributes are watched')
  assert.match(watcher, /disconnect\(\)/, 'the observer is released with the effect')
  // It must only fire on an actual change, not on every mutation.
  assert.match(watcher, /if \(next === last\) return/, 'an unchanged route must not re-render')
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

test('cost refreshes on activity, not only on the clock', () => {
  const pill = bodyOf('CostPill')
  assert.match(pill, /watchSession\(schedule\)/, 'a turn ending must trigger a read')
  assert.match(pill, /COST_REFRESH_DEBOUNCE_MS/, 'a burst of mutations collapses into one read')
})

test('only one place decides ownership, so the two paths cannot drift', () => {
  const matches = SRC.match(/function usingOwnRoute\(/g) ?? []
  assert.equal(matches.length, 1, 'one gate, used by both render paths')
})
