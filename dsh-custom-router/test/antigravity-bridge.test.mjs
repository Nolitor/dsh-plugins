/**
 * Antigravity bridge: reuses the vendor's TokenProvider/resolveEndpoint/parseCatalog
 * exports, keeps the measured User-Agent (digital fingerprint), and exposes the
 * tokenPath / userAgent / extraHeaders override slots.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createAntigravityProbe, DEFAULT_CONTROL_BASE, toCatalogModel } from '../lib/bridges/antigravity.js'
import { ProbeError } from '../lib/probe.js'

const UA = 'antigravity/cli/1.5.0 (aidev_client; os_type=linux; arch=amd64; cl=1013440158; auth_method=consumer)'

/** Vendor modules double; records the token config and endpoint resolution. */
function fakeModules(overrides = {}) {
  const calls = { tokenConfigs: [], endpoints: [] }
  const modules = {
    auth: {
      TokenProvider: class {
        constructor(options) { calls.tokenConfigs.push(options.config) }
        async get() { return 'access-token' }
      },
    },
    settings: {
      resolveEndpoint: (config) => {
        const plain = (value) => (value && typeof value.get === 'function' ? value.get() : value)
        const endpoint = { baseUrl: plain(config?.baseUrl) ?? 'https://daily-cloudcode-pa.googleapis.com', project: plain(config?.project) ?? 'aicode-consumers', userAgent: plain(config?.userAgent) ?? UA }
        calls.endpoints.push(endpoint)
        return endpoint
      },
    },
    catalog: {
      parseCatalog: () => [
        { id: 'gemini-3.8-flash', name: 'Gemini 3.8 Flash', maxInputTokens: 1000000, maxOutputTokens: 65536, supportsImages: true, supportsThinking: true, quota: { remaining: 0.64 } },
        { id: 'gemini-3.5-flash-lite', name: 'Gemini 3.5 Flash Lite', supportsImages: false, supportsThinking: false },
      ],
    },
  }
  return { modules: { ...modules, ...overrides }, calls }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('the bridge posts fetchAvailableModels with the fingerprint and bearer token', async () => {
  const { modules, calls } = fakeModules()
  const seen = []
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return json({ models: {} }) }
  const probe = createAntigravityProbe({ modules, fetchImpl, now: () => 5 })

  const result = await probe({ source: 'probe', kind: 'web-auth', shape: 'vendor', endpoint: '/v1internal:fetchAvailableModels' }, {
    vendorConfig: { tokenPath: '/custom/token.json', extraHeaders: { 'x-proxy-route': 'antigravity' } },
  })

  assert.equal(seen[0].url, `${DEFAULT_CONTROL_BASE}/v1internal:fetchAvailableModels`)
  assert.equal(seen[0].init.method, 'POST')
  assert.equal(seen[0].init.headers.authorization, 'Bearer access-token')
  assert.equal(seen[0].init.headers['user-agent'], UA)
  assert.equal(seen[0].init.headers['x-proxy-route'], 'antigravity')
  assert.deepEqual(JSON.parse(seen[0].init.body), { project: 'aicode-consumers' })
  assert.equal(calls.tokenConfigs[0].tokenFile, '/custom/token.json')
  assert.equal(result.shape, 'vendor')
  assert.equal(result.measuredAt, new Date(5).toISOString())
})

test('an explicit refreshToken wins and userAgent is overridable', async () => {
  const { modules, calls } = fakeModules()
  const fetchImpl = async () => json({ models: {} })
  const probe = createAntigravityProbe({ modules, fetchImpl })
  await probe({}, { vendorConfig: { refreshToken: 'rt-1', userAgent: 'custom-agent/9.9', extraHeaders: { 'x-custom': '1' } } })
  assert.equal(calls.tokenConfigs[0].refreshToken, 'rt-1')
  assert.equal(calls.endpoints[0].userAgent, 'custom-agent/9.9')
})

test('models map context, modalities, reasoning and quota', async () => {
  const { modules } = fakeModules()
  const probe = createAntigravityProbe({ modules, fetchImpl: async () => json({}) })
  const result = await probe({}, {})
  const [flash, lite] = result.models
  assert.equal(flash.id, 'gemini-3.8-flash')
  assert.equal(flash.contextWindow, 1000000)
  assert.equal(flash.maxTokens, 65536)
  assert.deepEqual(flash.input, ['text', 'image'])
  assert.equal(flash.reasoning, true)
  assert.deepEqual(flash.quota, { remaining: 0.64 })
  assert.deepEqual(lite.input, ['text'])
  assert.equal(toCatalogModel({ id: 'x' }).input[0], 'text')
})

test('a reactive config object is accepted', async () => {
  const { modules } = fakeModules()
  const fetchImpl = async () => json({})
  const probe = createAntigravityProbe({ modules, fetchImpl })
  const reactive = { tokenPath: { get: () => '/reactive/token' }, userAgent: { get: () => 'reactive-agent' } }
  await probe({}, { vendorConfig: reactive })
  assert.equal(reactive.tokenPath.get(), '/reactive/token')
})

test('a non-2xx answer is a ProbeError', async () => {
  const { modules } = fakeModules()
  const probe = createAntigravityProbe({ modules, fetchImpl: async () => json({}, 403) })
  await assert.rejects(() => probe({}, {}), (error) => error instanceof ProbeError && error.code === 'PROBE_FAILED' && /403/.test(error.message))
})

test('a missing vendor export fails at construction', () => {
  assert.throws(() => createAntigravityProbe({ modules: { auth: {}, settings: {}, catalog: {} } }), /TokenProvider/)
})
