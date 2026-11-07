/**
 * Routing: explicit preset → provider id → model prefix, deterministic and
 * ambiguity-refusing (never route to the wrong vendor).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { PRESETS } from '../lib/presets.js'
import { modelPrefix, resolvePreset, resolveRoute } from '../lib/routing.js'

test('a model id routes by its declared prefix', () => {
  const decision = resolvePreset('deepinfra/deepseek-ai/DeepSeek-V4.1')
  assert.equal(decision.ok, true)
  assert.equal(decision.preset.id, 'deepinfra')
  assert.equal(decision.matchedBy, 'prefix')
})

test('opencode-go routes to the opencode preset', () => {
  const decision = resolvePreset('opencode-go/glm-5.3-flash')
  assert.equal(decision.preset.id, 'opencode')
})

test('an explicit preset id wins', () => {
  const decision = resolvePreset({ presetId: 'antigravity', modelId: 'anything' })
  assert.equal(decision.preset.id, 'antigravity')
  assert.equal(decision.matchedBy, 'preset')
})

test('an explicit provider id resolves', () => {
  const decision = resolvePreset({ providerId: 'opencode-http-agent' })
  assert.equal(decision.preset.id, 'opencode')
  assert.equal(decision.matchedBy, 'provider')
})

test('an unknown prefix or provider fails loud', () => {
  assert.equal(resolvePreset('unknown/model').ok, false)
  assert.equal(resolvePreset({ providerId: 'nope' }).ok, false)
  assert.equal(resolvePreset({ presetId: 'nope' }).ok, false)
})

test('a prefix claimed twice is refused, not guessed', () => {
  const a = { ...structuredClone(PRESETS[0]), id: 'a', providerId: 'a', modelPrefixes: ['shared'] }
  const b = { ...structuredClone(PRESETS[1]), id: 'b', providerId: 'b', modelPrefixes: ['shared'] }
  const decision = resolvePreset('shared/model', [a, b])
  assert.equal(decision.ok, false)
  assert.match(decision.error, /claimed by a, b/)
})

test('resolveRoute carries the endpoint and auth', () => {
  const route = resolveRoute('antigravity/gemini-3.8-flash')
  assert.equal(route.ok, true)
  assert.equal(route.preset.id, 'antigravity')
  assert.equal(route.endpoint.protocol, 'google-generative-sse')
  assert.equal(route.auth.mode, 'web-auth')
})

test('modelPrefix reads only the first segment', () => {
  assert.equal(modelPrefix('deepinfra/a/b'), 'deepinfra')
  assert.equal(modelPrefix('bare'), undefined)
})
