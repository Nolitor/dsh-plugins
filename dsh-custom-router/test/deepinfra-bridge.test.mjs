/** DeepInfra bridge: standard OpenAI listing with an api-key slot. */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createDeepinfraProbe, DEFAULT_DEEPINFRA_BASE } from '../lib/bridges/deepinfra.js'
import { ProbeError } from '../lib/probe.js'

const json = (body) => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } })

test('the probe lists /models with a bearer key', async () => {
  const seen = []
  const probe = createDeepinfraProbe({ env: { DEEPINFRA_API_KEY: 'env-key' }, fetchImpl: async (url, init) => { seen.push({ url, init }); return json({ data: [{ id: 'deepseek-ai/x' }] }) } })
  const result = await probe({}, { vendorConfig: { extraHeaders: { 'x-proxy': 'di' } } })
  assert.equal(seen[0].url, `${DEFAULT_DEEPINFRA_BASE}/models`)
  assert.equal(new Headers(seen[0].init.headers).get('authorization'), 'Bearer env-key')
  assert.equal(new Headers(seen[0].init.headers).get('x-proxy'), 'di')
  assert.equal(result.models[0].id, 'deepseek-ai/x')
})

test('a config apiKey overrides the environment', async () => {
  const seen = []
  const probe = createDeepinfraProbe({ env: { DEEPINFRA_API_KEY: 'env-key' }, fetchImpl: async (url, init) => { seen.push(init); return json({ data: [] }) } })
  await probe({}, { vendorConfig: { apiKey: 'cfg-key', baseUrl: 'https://proxy.local/v1' } })
  assert.equal(new Headers(seen[0].headers).get('authorization'), 'Bearer cfg-key')
})

test('no key is a ProbeError', async () => {
  const probe = createDeepinfraProbe({ env: {}, fetchImpl: async () => json({ data: [] }) })
  await assert.rejects(() => probe({}, {}), (error) => error instanceof ProbeError && /DEEPINFRA_API_KEY/.test(error.message))
})
