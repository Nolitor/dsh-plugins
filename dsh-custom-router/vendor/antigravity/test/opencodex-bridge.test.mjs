import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config } from '../lib/index.js'
import { resetSharedSelectionSync } from '../../../lib/vendor-bridge.js'

test('saving the Antigravity checklist mirrors only advertised families', async () => {
  resetSharedSelectionSync()
  const routes = []
  const writes = []
  const requests = []
  const previous = globalThis.fetch
  const previousKey = process.env.OPENCODEX_BRIDGE_KEY_ID
  delete process.env.OPENCODEX_BRIDGE_KEY_ID
  globalThis.fetch = async (url, init) => {
    requests.push({ url: String(url), method: init.method, body: init.body && JSON.parse(init.body) })
    if (init.method === 'GET') {
      return new Response(JSON.stringify({
        selected: {}, available: { 'google-antigravity': ['gemini-3.8-flash'] },
      }))
    }
    return new Response(JSON.stringify({ ok: true }))
  }
  const ctx = {
    llm: { registerAdapter: () => () => {} },
    logger: { warn() {}, debug() {} },
    effect: (fn) => fn(),
    inject: (deps, fn) => fn({
      connection: { fetch: { register: (route) => { routes.push(route); return () => {} } } },
      settings: { update: async (ns, patch) => { writes.push({ ns, patch }) } },
    }),
    emit() {},
  }
  try {
    apply(ctx, Config({ enabledModels: [] }))
    const route = routes.find((entry) => entry.path === '/api/local/dsh-antigravity/models/apply')
    assert.ok(route)
    const response = await route.fetch(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ enabled: ['gemini-3.8-flash-low', 'gemini-3.8-flash-high'] }),
    }))
    assert.equal(response.status, 200)
    assert.deepEqual(writes, [{ ns: 'dsh-antigravity', patch: { enabledModels: ['gemini-3.8-flash-low', 'gemini-3.8-flash-high'] } }])
    const select = requests.find((entry) => entry.method === 'PUT')
    assert.deepEqual(select.body, { provider: 'google-antigravity', models: ['gemini-3.8-flash'] })
    assert.equal(requests.some((entry) => entry.url.endsWith('/api/model-visibility')), false)
  } finally {
    globalThis.fetch = previous
    if (previousKey === undefined) delete process.env.OPENCODEX_BRIDGE_KEY_ID
    else process.env.OPENCODEX_BRIDGE_KEY_ID = previousKey
    resetSharedSelectionSync()
  }
})
