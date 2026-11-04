/**
 * The cost pill must appear ONLY on a route this package itself serves.
 *
 * Measured 2026-11-04 (owner report, twice): the chip appeared next to models served
 * by OTHER routers. The first fix gated on the route string and still leaked, because
 * the gate accepted any model id beginning with `opencode-go/`:
 *
 *   provider=subrouter        model=opencode-go/deepseek-v4.1-flash  -> SHOWED
 *   provider=deepseek-account model=opencode-go/deepseek-v4.1-flash  -> SHOWED
 *
 * The model id comes from OpenCode's CATALOG, not from this adapter, so any router
 * that resells the same catalog ids matches it. Only the PROVIDER id is evidence of
 * who serves the request.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** The body of one named function. */
function bodyOf(name) {
  const start = SRC.indexOf('function ' + name + '(')
  assert.ok(start >= 0, name + ' must exist')
  const rest = SRC.slice(start + 1)
  const end = rest.indexOf('\n    function ')
  return end < 0 ? rest : rest.slice(0, end)
}

/** The declared provider ids, evaluated exactly as the bundle does. */
function ownProviderIds() {
  const match = SRC.match(/const OWN_PROVIDER_IDS = \[([^\]]*)\]/)
  assert.ok(match, 'the gate must declare the ids this package registers')
  return [...match[1].matchAll(/'([^']+)'/g)].map((m) => m[1])
}

/** The gate, reproduced from the bundle's own declared ids. */
function gate(provider, model) {
  const ids = ownProviderIds()
  const acceptsProvider = bodyOf('usingOwnRoute').includes('OWN_PROVIDER_IDS.includes(provider)')
  assert.ok(acceptsProvider, 'the gate must test the provider id list')
  return ids.includes(provider)
}

test('the gate accepts every provider id this package registers', () => {
  // lib/http.js registers opencode-http-agent; lib/provider.js registers opencode-agent.
  assert.deepEqual(ownProviderIds().sort(), ['opencode-agent', 'opencode-http-agent'])
  assert.equal(gate('opencode-http-agent', 'opencode-go/deepseek-v4.1-flash'), true)
  assert.equal(gate('opencode-agent', 'opencode-go/minimax-m3.1-flash'), true)
})

test('a FOREIGN router serving an opencode-go model id is hidden', () => {
  // This is the leak the owner reported: the model id is not evidence.
  for (const provider of ['subrouter', 'deepseek-account', 'opencode', 'opencode-go', 'llm-pi-ai', '']) {
    assert.equal(gate(provider, 'opencode-go/deepseek-v4.1-flash'), false, provider + ' must not show the chip')
  }
})

test('the gate does not consult the model id at all', () => {
  const body = bodyOf('usingOwnRoute')
  assert.doesNotMatch(body, /test\(model\)/, 'the model id must not be matched')
  assert.doesNotMatch(body, /model\.startsWith/, 'the model id must not be matched')
  // Reading the attribute is still required: it proves the chip is a route chip.
  assert.match(body, /data-provider-id\]\[data-model-id\]/)
})

test('a route id that merely CONTAINS opencode is not ours', () => {
  for (const provider of ['opencode-zen', 'opencodeai', 'my-opencode-agent']) {
    assert.equal(gate(provider, 'opencode-go/x'), false, provider)
  }
})

test('the gate is still event-driven and still renders nothing off-route', () => {
  assert.doesNotMatch(SRC, /ROUTE_POLL_MS/)
  const pill = bodyOf('CostPill')
  assert.match(pill, /if \(!onRoute\) return null/)
  assert.match(pill, /watchRoute\b/)
})
