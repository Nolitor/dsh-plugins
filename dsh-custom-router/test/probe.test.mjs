/**
 * Probe executor (layer 2): OpenAI/Anthropic listings normalized; vendor RPCs
 * refused by design; auth headers match each protocol.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { ProbeError, parseAnthropicListing, parseOpenAIListing, probeCatalog, probePreset, probeUrl, probeVendor } from '../lib/probe.js'
import { findPreset } from '../lib/presets.js'

/** Fetch double recording the request. */
function fakeFetch(reply) {
  const calls = []
  const fn = async (url, init) => {
    calls.push({ url, init })
    if (typeof reply === 'function') return reply(url, init)
    return reply
  }
  fn.calls = calls
  return fn
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

test('openai listing normalizes ids, names and limits', () => {
  const models = parseOpenAIListing({ data: [{ id: 'm1', context_length: 128000, max_output_tokens: 4096 }, { id: 'm2' }, { nope: true }] })
  assert.deepEqual(models, [
    { id: 'm1', name: 'm1', contextWindow: 128000, maxTokens: 4096 },
    { id: 'm2', name: 'm2' },
  ])
})

test('anthropic listing reads one page of display names', () => {
  assert.deepEqual(parseAnthropicListing({ data: [{ id: 'claude-x', display_name: 'Claude X' }] }), [
    { id: 'claude-x', name: 'Claude X' },
  ])
})

test('probeCatalog sends a bearer token for an openai shape', async () => {
  const fetchImpl = fakeFetch(json({ data: [{ id: 'm1' }] }))
  const result = await probeCatalog(
    { source: 'probe', kind: 'api', shape: 'openai', endpoint: '/models' },
    { baseUrl: 'https://api.example/v1', apiKey: 'k', fetchImpl, now: 0 },
  )
  assert.equal(result.shape, 'openai')
  assert.equal(result.models[0].id, 'm1')
  assert.equal(fetchImpl.calls[0].url, 'https://api.example/v1/models')
  assert.equal(new Headers(fetchImpl.calls[0].init.headers).get('authorization'), 'Bearer k')
})

test('probeCatalog sends x-api-key and the anthropic version header', async () => {
  const fetchImpl = fakeFetch(json({ data: [{ id: 'c1', display_name: 'C1' }] }))
  await probeCatalog(
    { source: 'probe', kind: 'api', shape: 'anthropic', endpoint: '/v1/models' },
    { baseUrl: 'https://api.anthropic.com', apiKey: 'k', fetchImpl },
  )
  const headers = new Headers(fetchImpl.calls[0].init.headers)
  assert.equal(headers.get('x-api-key'), 'k')
  assert.equal(headers.get('anthropic-version'), '2023-06-01')
})

test('a vendor-owned RPC is refused by the router', async () => {
  await assert.rejects(
    () => probeCatalog({ source: 'probe', kind: 'web-auth', shape: 'vendor', endpoint: '/v1internal:fetchAvailableModels' }, { baseUrl: 'https://x' }),
    (error) => error instanceof ProbeError && error.code === 'VENDOR_OWNED',
  )
})

test('a non-2xx answer is a probe failure', async () => {
  const fetchImpl = fakeFetch(json({}, 401))
  await assert.rejects(
    () => probeCatalog({ source: 'probe', kind: 'api', shape: 'openai', endpoint: '/models' }, { baseUrl: 'https://api.example', fetchImpl }),
    (error) => error instanceof ProbeError && error.code === 'PROBE_FAILED',
  )
})

test('probePreset skips vendor layers and keeps the standard ones', async () => {
  const fetchImpl = fakeFetch(json({ data: [{ id: 'm1' }] }))
  const preset = structuredClone(findPreset('opencode'))
  preset.catalog.layers = [
    { source: 'upstream', providers: ['opencode'] },
    { source: 'probe', kind: 'api', shape: 'vendor', endpoint: '/api/model' },
    { source: 'probe', kind: 'api', shape: 'openai', endpoint: '/models' },
  ]
  const result = await probePreset(preset, { baseUrl: 'https://x', fetchImpl })
  assert.deepEqual(result.models.map((model) => model.id), ['m1'])
  assert.deepEqual(result.errors, [])
})

test('probeUrl joins without doubling slashes', () => {
  assert.equal(probeUrl('https://x/v1/', '/models'), 'https://x/v1/models')
})

test('a vendor probe connects through an explicit handler map', async () => {
  const vendorProbes = { opencode: async () => ({ models: [{ id: 'oc-1', name: 'OC 1' }], measuredAt: '2026-11-07T00:00:00.000Z' }) }
  const result = await probeVendor(
    { source: 'probe', kind: 'api', shape: 'vendor', endpoint: '/api/model' },
    { id: 'opencode' },
    { vendorProbes },
  )
  assert.deepEqual(result.models, [{ id: 'oc-1', name: 'OC 1' }])
  assert.equal(result.shape, 'vendor')
})

test('a vendor probe connects through the host discovery seam', async () => {
  const ctx = {
    llm: {
      discoverModels: async (namespace, request) => {
        assert.equal(namespace, 'dsh-opencode-v2-http')
        assert.equal(request.provider, 'opencode-http-agent')
        return [{ id: 'm1', name: 'M1', inputModalities: ['text'] }]
      },
    },
  }
  const result = await probeVendor(
    { source: 'probe', kind: 'api', shape: 'vendor', endpoint: '/api/model', namespace: 'dsh-opencode-v2-http' },
    { id: 'opencode', providerId: 'opencode-http-agent' },
    { ctx, baseUrl: 'http://127.0.0.1:4096' },
  )
  assert.deepEqual(result.models, [{ id: 'm1', name: 'M1', input: ['text'] }])
})

test('an unconnected vendor probe is refused with a reason', async () => {
  await assert.rejects(
    () => probeVendor({ source: 'probe', kind: 'api', shape: 'vendor', endpoint: '/api/model' }, { id: 'opencode' }, {}),
    (error) => error instanceof ProbeError && error.code === 'VENDOR_OWNED' && /no vendor probe is connected/.test(error.message),
  )
})
