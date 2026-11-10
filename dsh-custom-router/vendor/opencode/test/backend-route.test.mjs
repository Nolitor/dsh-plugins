/**
 * The plan decides the ENDPOINT, not just the list.
 *
 * Measured 2026-11-04 with one token against both OpenAI-compatible roots
 * (test/live/endpoint-plan-probe.mjs):
 *
 *   go endpoint  + go-owned model  (deepseek-v4.1-flash) -> 200, billing_source "go-plus"
 *   go endpoint  + zen-only model  (pulse-alpha-free)    -> 400 "Model is unavailable."
 *   zen endpoint + go-owned model                        -> 402 "Insufficient account funds"
 *   zen endpoint + zen-only model                        -> 429 FreeUsageLimitError
 *
 * Before this test the adapter resolved \`/api/provider/\`backendProviderId\` once,
 * cached it, and reused it for every route. With \`activePlan: 'zen'\` the list
 * offered Zen routes while every request still went to the Go root, so a Zen
 * pick could only ever answer 400 "Model is unavailable" — the route was
 * selectable and unroutable at the same time.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { backendProviderForRoute } from '../lib/http.js'

const config = { backendProviderId: { get: () => 'opencode-go' } }

test('a route from the active plan picks its own provider', () => {
  assert.equal(backendProviderForRoute('opencode/beam-free', config), 'opencode')
  assert.equal(backendProviderForRoute('opencode/deepseek-v4.1-flash', config), 'opencode')
})

test('a route from the configured provider keeps the configured provider', () => {
  assert.equal(backendProviderForRoute('opencode-go/deepseek-v4.1-flash', config), 'opencode-go')
})

test('a route without a plan prefix falls back instead of guessing', () => {
  // The worker path and \`default\` reach here with a bare model id.
  assert.equal(backendProviderForRoute('default', config), 'opencode-go')
  assert.equal(backendProviderForRoute('', config), 'opencode-go')
  assert.equal(backendProviderForRoute(undefined, config), 'opencode-go')
})

test('an unknown provider is not silently mapped onto the configured one', () => {
  // A third-party prefix must be sent as written: guessing the Go root for it
  // would trade a visible 400 for a confusing one.
  assert.equal(backendProviderForRoute('thirdparty/model', config), 'thirdparty')
})
