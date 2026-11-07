/**
 * OpenCode bridge: daemon `/api/model` with Basic auth; reuses the vendor's
 * authHeader / serviceStateCandidates / modelsFromApiPayload.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createOpencodeProbe, readDaemonState, toCatalogModel } from '../lib/bridges/opencode.js'
import { ProbeError } from '../lib/probe.js'

function fakeModules() {
  return {
    http: {
      authHeader: (password) => `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
      serviceStateCandidates: (configured) => [configured, '/home/u/.local/state/opencode/service.json'].filter(Boolean),
    },
    // Mimic the vendor parser's OUTPUT shape (modelFromApiEntry), not the raw payload.
    shared: {
      modelsFromApiPayload: (payload) => (Array.isArray(payload?.data)
        ? {
            models: payload.data.map((entry) => ({
              id: entry.id,
              name: entry.name ?? entry.id,
              inputModalities: entry.inputModalities ?? ['text'],
              contextWindow: entry.limit?.context,
              maxTokens: entry.limit?.output,
            })),
          }
        : null),
    },
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const STATE = JSON.stringify({ url: 'http://127.0.0.1:4096', password: 'pw' })

test('the probe reads the daemon state file when no slot is given', async () => {
  const seen = []
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return json({ data: [{ id: 'opencode/go-1', name: 'Go 1', limit: { context: 200000, output: 8000 }, inputModalities: ['text', 'image'] }] }) }
  const probe = createOpencodeProbe({ modules: fakeModules(), fetchImpl, readFile: async () => STATE })
  const result = await probe({}, { vendorConfig: {} })
  assert.equal(seen[0].url, 'http://127.0.0.1:4096/api/model')
  assert.equal(seen[0].init.headers.authorization, `Basic ${Buffer.from('opencode:pw').toString('base64')}`)
  assert.equal(result.models[0].contextWindow, 200000)
  assert.deepEqual(result.models[0].input, ['text', 'image'])
})

test('explicit baseUrl/password and extraHeaders win', async () => {
  const seen = []
  const probe = createOpencodeProbe({ modules: fakeModules(), fetchImpl: async (url, init) => { seen.push({ url, init }); return json({ data: [] }) } })
  await probe({}, { vendorConfig: { baseUrl: 'http://127.0.0.1:5000', password: 'x', extraHeaders: { 'x-proxy': 'oc' } } })
  assert.equal(seen[0].url, 'http://127.0.0.1:5000/api/model')
  assert.equal(seen[0].init.headers['x-proxy'], 'oc')
})

test('no daemon at all is a ProbeError with a hint', async () => {
  const probe = createOpencodeProbe({ modules: fakeModules(), fetchImpl: async () => json({}), readFile: async () => { throw new Error('ENOENT') } })
  await assert.rejects(() => probe({}, { vendorConfig: {} }), (error) => error instanceof ProbeError && /serviceFile/.test(error.message))
})

test('an unexpected payload is refused', async () => {
  const probe = createOpencodeProbe({ modules: fakeModules(), fetchImpl: async () => json({ nope: true }) })
  await assert.rejects(() => probe({}, { vendorConfig: { baseUrl: 'http://x', password: 'p' } }), (error) => error instanceof ProbeError && /unexpected payload/.test(error.message))
})

test('readDaemonState skips broken files and returns the first valid one', async () => {
  const state = await readDaemonState(['/a.json', '/b.json'], async (path) => {
    if (path === '/a.json') throw new Error('missing')
    return STATE
  })
  assert.deepEqual(state, { url: 'http://127.0.0.1:4096', password: 'pw', path: '/b.json' })
})

test('toCatalogModel keeps the measured fields', () => {
  assert.deepEqual(toCatalogModel({ id: 'p/m', name: 'M', contextWindow: 10, maxTokens: 5, inputModalities: ['text'], reasoningField: 'reasoning_content', variants: ['high'] }), {
    id: 'p/m', name: 'M', input: ['text'], contextWindow: 10, maxTokens: 5, reasoningField: 'reasoning_content', variants: ['high'],
  })
})
