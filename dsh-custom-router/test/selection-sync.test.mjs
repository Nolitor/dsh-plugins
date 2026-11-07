import test from 'node:test'
import assert from 'node:assert/strict'
import { createSelectionSync } from '../lib/selection-sync.js'

function harness({ keyId = '', selected = {}, available = {} } = {}) {
  const calls = []
  const state = { selected: structuredClone(selected), available: structuredClone(available) }
  const client = {
    async selectedModels() {
      calls.push({ op: 'read' })
      return { selected: state.selected, available: state.available }
    },
    async selectModels(provider, models) {
      calls.push({ op: 'select', provider, models })
      state.selected[provider] = models
      return { ok: true, provider, selected: models }
    },
    async scopeKey(id, allowedModels) {
      calls.push({ op: 'scope', id, allowedModels })
      return { ok: true }
    },
  }
  const sync = createSelectionSync({ client, keyId: () => keyId })
  return { sync, calls, state }
}

test('the provider allowlist is written before the key scope', async () => {
  const { sync, calls } = harness({
    keyId: 'shared-key',
    selected: { 'opencode-go': ['kimi-k3'] },
    available: { 'opencode-go': ['kimi-k3', 'hy4'] },
  })
  await sync.apply({ provider: 'opencode-go', enabled: ['opencode-go/kimi-k3'] })
  assert.deepEqual(calls.map((c) => c.op), ['read', 'select', 'read', 'scope'])
})

test('one provider saving does not narrow the shared key to that provider alone', async () => {
  const { sync, state } = harness({
    keyId: 'shared-key',
    selected: {
      'opencode-go': ['kimi-k3'],
      deepinfra: ['zai-org/GLM-5.3'],
      'google-antigravity': ['gemini-3.8-flash'],
    },
    available: {
      'opencode-go': ['kimi-k3'],
      deepinfra: ['zai-org/GLM-5.3'],
      'google-antigravity': ['gemini-3.8-flash'],
    },
  })
  await sync.apply({ provider: 'opencode-go', enabled: ['opencode-go/kimi-k3'] })
  assert.deepEqual(state.selected['opencode-go'], ['kimi-k3'])
})

test('no shared key id means the catalog is mirrored and no key is touched', async () => {
  const { sync, calls } = harness({ selected: {}, available: { deepinfra: ['a'] } })
  const result = await sync.apply({ provider: 'deepinfra', enabled: ['a'] })
  assert.equal(calls.some((c) => c.op === 'scope'), false)
  assert.equal(result.scope.reason, 'no-shared-key')
})

test('an unrestricted provider is reported instead of being silently scoped', async () => {
  const { sync, calls } = harness({
    keyId: 'shared-key',
    selected: { 'opencode-go': ['kimi-k3'] },
    available: { 'opencode-go': ['kimi-k3'], deepinfra: ['a'] },
  })
  const result = await sync.apply({ provider: 'opencode-go', enabled: ['opencode-go/kimi-k3'] })
  assert.equal(calls.some((c) => c.op === 'scope'), false)
  assert.match(result.scope.reason, /provider-unrestricted:deepinfra/)
})
