import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config } from '../lib/index.js'
import { resetSharedSelectionSync } from '@nolit/dsh-custom-router/vendor-bridge'

test('saving the DeepInfra checklist mirrors slash-bearing ids to OpenCodex', async () => {
  resetSharedSelectionSync()
  const routes = []
  const writes = []
  const requests = []
  const previous = globalThis.fetch
  const previousKey = process.env.OPENCODEX_BRIDGE_KEY_ID
  delete process.env.OPENCODEX_BRIDGE_KEY_ID
  globalThis.fetch = async (url, init) => {
    if (String(url).includes('api.deepinfra.com')) {
      return new Response(JSON.stringify([{ id: 'zai-org/GLM-5.3', metadata: { tags: ['chat'] } }]))
    }
    requests.push({ url: String(url), method: init.method, body: init.body && JSON.parse(init.body) })
    if (init.method === 'GET') {
      return new Response(JSON.stringify({ selected: {}, available: { deepinfra: ['zai-org/GLM-5.3'] } }))
    }
    return new Response(JSON.stringify({ ok: true }))
  }
  const ctx = {
    llm: { registerAdapter: () => () => {} },
    effect: (fn) => typeof fn === 'function' ? fn() : undefined,
    inject: (deps, fn) => fn({
      connection: { fetch: { register: (route) => { routes.push(route); return () => {} } } },
      settings: { update: async (ns, patch) => { writes.push({ ns, patch }) } },
    }),
    logger: { warn() {} },
    on: () => () => {},
  }
  try {
    apply(ctx, Config({ enabledModels: [] }))
    const route = routes.find((entry) => entry.path === '/api/local/deepinfra/models/apply')
    assert.ok(route)
    const response = await route.fetch(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ enabled: ['zai-org/GLM-5.3'] }),
    }))
    assert.equal(response.status, 200)
    assert.deepEqual(writes, [{ ns: 'dsh-deepinfra', patch: { enabledModels: ['zai-org/GLM-5.3'] } }])
    const select = requests.find((entry) => entry.method === 'PUT')
    assert.deepEqual(select.body, { provider: 'deepinfra', models: ['zai-org/GLM-5.3'] })
  } finally {
    globalThis.fetch = previous
    if (previousKey === undefined) delete process.env.OPENCODEX_BRIDGE_KEY_ID
    else process.env.OPENCODEX_BRIDGE_KEY_ID = previousKey
    resetSharedSelectionSync()
  }
})
