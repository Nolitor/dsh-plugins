import test from 'node:test'
import assert from 'node:assert/strict'
import { apply, Config } from '../lib/http.js'
import { resetSharedSelectionSync } from '@nolit/dsh-custom-router/vendor-bridge'

test('saving the OpenCode checklist mirrors the Go allowlist to OpenCodex', async () => {
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
        selected: {}, available: { 'opencode-go': ['kimi-k3', 'hy4'], opencode: [] },
      }))
    }
    return new Response(JSON.stringify({ ok: true }))
  }
  const ctx = {
    llm: { registerAdapter: () => () => {}, listProviders: () => [] },
    subprocess: {},
    sessions: { get: () => undefined },
    logger: { warn() {}, debug() {} },
    on: () => {},
    effect: (fn) => fn(),
    connection: { fetch: { register: (route) => { routes.push(route); return () => {} } } },
    settings: { update: async (ns, patch) => { writes.push({ ns, patch }) } },
  }
  try {
    const dispose = apply(ctx, Config({ attachToDaemon: false, spawnServer: false, autoDiscoverModels: false }))
    const route = routes.find((entry) => entry.path === '/api/local/opencode-v2/model-settings/apply')
    assert.ok(route)
    const response = await route.fetch(new Request('http://localhost', {
      method: 'POST', body: JSON.stringify({ enabled: ['opencode-go/kimi-k3'] }),
    }))
    assert.equal(response.status, 200)
    assert.deepEqual(writes, [{ ns: 'dsh-opencode-v2-http', patch: { enabledModels: ['opencode-go/kimi-k3'] } }])
    const select = requests.find((entry) => entry.method === 'PUT' && entry.url.endsWith('/api/selected-models'))
    assert.deepEqual(select.body, { provider: 'opencode-go', models: ['kimi-k3'] })
    assert.equal(requests.some((entry) => entry.url.endsWith('/api/keys')), false, 'no shared key id => no key write')
    dispose()
  } finally {
    globalThis.fetch = previous
    if (previousKey === undefined) delete process.env.OPENCODEX_BRIDGE_KEY_ID
    else process.env.OPENCODEX_BRIDGE_KEY_ID = previousKey
    resetSharedSelectionSync()
  }
})
