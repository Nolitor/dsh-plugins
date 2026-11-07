import test from 'node:test'
import assert from 'node:assert/strict'

import { createLedger, json, registerRoutes } from '../lib/server.js'

function harness({ settings, onModelsApplied } = {}) {
  const routes = new Map()
  const ctx = {
    effect: (fn) => fn(),
    logger: { warn() {} },
  }
  const connection = {
    fetch: {
      register(route) {
        routes.set(route.path, route)
        return () => routes.delete(route.path)
      },
    },
  }
  const deps = {
    config: { enabled: true, modelServing: true, cliWorker: true, usagePill: true, enabledModels: [] },
    catalog: { account: async () => undefined, all: async () => [] },
    endpointOf: () => ({ baseUrl: 'https://example.invalid', project: 'p' }),
    ledger: createLedger(),
    pluginName: '@nolit/dsh-antigravity',
    onModelsApplied,
  }
  registerRoutes(ctx, deps, { connection, settings })
  return { routes, deps }
}

/** POST one route like the browser does. */
function call(route) {
  return route.fetch(new Request('http://localhost/api/local/dsh-antigravity/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }))
}

test('every panel route answers with a WHATWG Response', async () => {
  const { routes } = harness()
  assert.equal(routes.size, 5)
  for (const [path, route] of routes) {
    const response = await call(route)
    assert.ok(response instanceof Response, path + ' did not return a Response')
    // switch routes legitimately answer 400 for an empty body; the contract here
    // is the Response SHAPE, which is what the carrier requires.
    assert.ok([200, 400, 409].includes(response.status), path + ' status ' + response.status)
    assert.match(response.headers.get('content-type') ?? '', /application\/json/)
  }
})

test('info reports measured ledger totals, not a second empty ledger', async () => {
  const { routes, deps } = harness()
  deps.ledger.record({ inputTokens: 10, outputTokens: 4, reasoningTokens: 2 })
  const payload = await (await call(routes.get('/api/local/dsh-antigravity/info'))).json()
  assert.deepEqual(payload.usage, { requests: 1, inputTokens: 10, outputTokens: 4, reasoningTokens: 2, cacheReadTokens: 0 })
})

test('switches persist through the settings service, not a mutable config', async () => {
  const patches = []
  const settings = { update: async (id, patch) => { patches.push([id, patch]) } }
  const { routes } = harness({ settings })
  const route = routes.get('/api/local/dsh-antigravity/switches')
  const response = await route.fetch(new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modelServing: false, bogus: true }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(patches, [['dsh-antigravity', { modelServing: false }]])
})

test('switches without a settings service fail loudly instead of faking success', async () => {
  const { routes } = harness()
  const route = routes.get('/api/local/dsh-antigravity/switches')
  const response = await route.fetch(new Request('http://localhost/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ modelServing: false }),
  }))
  assert.equal(response.status, 409)
})

test('json helper always produces a Response', () => {
  const response = json({ ok: true }, 201)
  assert.ok(response instanceof Response)
  assert.equal(response.status, 201)
})

test('model selection persists in DSH then mirrors to OpenCodex', async () => {
  const patches = []
  const mirrored = []
  const settings = { update: async (id, patch) => { patches.push([id, patch]) } }
  const { routes } = harness({ settings, onModelsApplied: async (enabled) => { mirrored.push(enabled) } })
  const route = routes.get('/api/local/dsh-antigravity/models/apply')
  const response = await route.fetch(new Request('http://localhost/x', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: ['gemini-3.8-flash-low'] }),
  }))
  assert.equal(response.status, 200)
  assert.deepEqual(patches, [['dsh-antigravity', { enabledModels: ['gemini-3.8-flash-low'] }]])
  assert.deepEqual(mirrored, [['gemini-3.8-flash-low']])
})

test('an OpenCodex sync failure is reported after the DSH write, not faked as success', async () => {
  const settings = { update: async () => {} }
  const { routes } = harness({ settings, onModelsApplied: async () => { throw new Error('sync unavailable') } })
  const response = await routes.get('/api/local/dsh-antigravity/models/apply').fetch(new Request('http://localhost/x', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ enabled: ['gemini-3.8-flash-low'] }),
  }))
  assert.equal(response.status, 502)
  assert.equal((await response.json()).ok, false)
})
