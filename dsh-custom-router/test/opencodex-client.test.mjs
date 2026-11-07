import test from 'node:test'
import assert from 'node:assert/strict'
import { createOpenCodexClient } from '../lib/opencodex-client.js'

test('the management client sends only the requested model projection', async () => {
  const calls = []
  const client = createOpenCodexClient({
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init })
      return new Response(JSON.stringify({ ok: true }))
    },
  })
  await client.selectModels('deepinfra', ['zai-org/GLM-5.3'])
  assert.deepEqual(JSON.parse(calls[0].init.body), { provider: 'deepinfra', models: ['zai-org/GLM-5.3'] })
  assert.equal(calls[0].init.headers.authorization, undefined)
})

test('scope updates target an existing key and never return key material', async () => {
  let request
  const client = createOpenCodexClient({
    managementToken: 'management-only',
    fetchImpl: async (url, init) => {
      request = { url: String(url), init }
      return new Response(JSON.stringify({ id: 'key-id', allowedModels: [] }))
    },
  })
  await client.scopeKey('key-id', ['opencode-go/kimi-k3'])
  assert.deepEqual(JSON.parse(request.init.body), { id: 'key-id', allowedModels: ['opencode-go/kimi-k3'] })
  assert.equal(JSON.parse(request.init.body).key, undefined)
})
