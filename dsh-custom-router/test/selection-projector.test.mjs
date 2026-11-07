import test from 'node:test'
import assert from 'node:assert/strict'
import { antigravitySelection, openCodeSelection, projectSelection } from '../lib/selection-projector.js'

test('OpenCode Go and Zen never share a provider namespace', () => {
  assert.deepEqual(openCodeSelection(['opencode-go/kimi-k3', 'opencode/beam-free']), {
    provider: 'opencode-go', models: ['kimi-k3'],
  })
  assert.deepEqual(openCodeSelection(['opencode-go/kimi-k3', 'opencode/beam-free'], 'zen'), {
    provider: 'opencode', models: ['beam-free'],
  })
})

test('Antigravity raw effort variants collapse to advertised families only', () => {
  assert.deepEqual(antigravitySelection(
    ['gemini-3.8-flash-low', 'gemini-3.8-flash-high', 'gemini-2.5-flash-thinking', 'missing-low'],
    ['gemini-3.8-flash', 'gemini-3.5-flash-lite'],
  ), ['gemini-3.8-flash', 'gemini-3.5-flash-lite'])
})

test('DeepInfra keeps slash-bearing upstream ids intact', () => {
  assert.deepEqual(projectSelection({
    provider: 'deepinfra', enabled: ['deepseek-ai/DeepSeek-V4.1-Flash-1017'],
  }), { provider: 'deepinfra', models: ['deepseek-ai/DeepSeek-V4.1-Flash-1017'] })
})

test('an unknown provider fails loudly instead of guessing a namespace', () => {
  assert.throws(() => projectSelection({ provider: 'nope', enabled: [] }), /unsupported OpenCodex provider/)
})
