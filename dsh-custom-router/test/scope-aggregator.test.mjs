import test from 'node:test'
import assert from 'node:assert/strict'
import { aggregateScopes, scopeFromProjection } from '../lib/scope-aggregator.js'

const complete = {
  selected: {
    'opencode-go': ['kimi-k3'],
    deepinfra: ['zai-org/GLM-5.3'],
    'google-antigravity': ['gemini-3.8-flash'],
  },
  available: {
    'opencode-go': ['kimi-k3', 'hy4'],
    deepinfra: ['zai-org/GLM-5.3'],
    'google-antigravity': ['gemini-3.8-flash'],
  },
}

test('the shared key is the union of every provider selection', () => {
  assert.deepEqual(scopeFromProjection(complete), {
    allowedModels: [
      'opencode-go/kimi-k3',
      'deepinfra/zai-org/GLM-5.3',
      'google-antigravity/gemini-3.8-flash',
    ],
    reason: 'complete',
  })
})

test('an unrestricted provider blocks the scope write instead of narrowing it', () => {
  const partial = { selected: { 'opencode-go': ['kimi-k3'] }, available: complete.available }
  assert.deepEqual(scopeFromProjection(partial), {
    allowedModels: null,
    reason: 'provider-unrestricted:deepinfra,google-antigravity',
  })
})

test('a key scope is never guessed when no provider is configured', () => {
  assert.deepEqual(scopeFromProjection({ selected: {}, available: {} }), {
    allowedModels: null,
    reason: 'no-configured-provider',
  })
})

test('aggregation deduplicates fully-qualified destinations', () => {
  assert.deepEqual(aggregateScopes([
    { provider: 'deepinfra', models: ['a', 'a'] },
    { provider: 'deepinfra', models: ['a'] },
  ]), ['deepinfra/a'])
})
