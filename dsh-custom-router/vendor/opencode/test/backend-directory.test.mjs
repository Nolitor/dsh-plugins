/**
 * Provider endpoints resolve from the DIRECTORY, not from the single-item route.
 *
 * Measured 2026-11-14 against OpenCode v2.2.6 (a fresh daemon and the live one)
 * with Basic auth `opencode:<password>` from the daemon's service state:
 *
 *   GET /api/provider                  -> 200, `data[]` lists EVERY provider,
 *                                         each with its own `settings.baseURL`
 *                                         and `headers`
 *   GET /api/provider/opencode-go      -> 404 {"_tag":"ProviderNotFoundError",
 *                                         "providerID":"opencode-go"}
 *   GET /api/provider/nonexistent-xyz  -> 404 (same shape)
 *
 * The LIST route therefore enumerates a SUPERSET of the ids the item route
 * serves. The adapter used to resolve every endpoint through the item route
 * alone, so a directory-listed id that the item route did not serve failed the
 * whole turn:
 *
 *   opencode GET /api/provider/opencode-go -> HTTP 404: ProviderNotFoundError
 *   {"_tag":"ProviderNotFoundError","providerID":"opencode-go", ...} OPENCODE_BACKEND
 *
 * The tests below pin the fix at that seam. They use provider ids that are
 * deliberately NOT `opencode`/`opencode-go`: the resolution must work for any id
 * the directory returns, so nothing here may depend on a known-name branch.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Config, OpencodeHttpAdapter, noBackendEndpointError } from '../lib/http.js'

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

/** The measured 404 body, so an error message can be asserted against the real shape. */
const providerNotFound = (id) => ({
  _tag: 'ProviderNotFoundError',
  providerID: id,
  message: `Provider not found: ${id}`,
})

/**
 * A fake daemon whose DIRECTORY and single-item routes are configured
 * independently — that is the whole point: the fixture must be able to list a
 * provider the item route refuses to serve.
 */
async function startServer(script = {}) {
  const state = {
    directoryRequests: 0,
    itemRequests: [],
    credentialRequests: 0,
    chatPaths: [],
    chatHeaders: [],
  }
  /**
   * `rows` is the DIRECTORY content and is mutable after `listen`, because the
   * fixture rows carry the server's own port. `directoryRows` pins the list
   * response to something else (an older daemon that lists nothing while the
   * item route still serves a provider).
   */
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
      if (url.pathname === '/api/info') {
        return json(res, 200, { version: '2.2.6', pid: 1, hostname: 'test', urls: ['http://127.0.0.1'] })
      }
      if (url.pathname === '/api/model') {
        return json(res, 200, {
          location: { directory: '/tmp' },
          data: script.models ?? [
            { providerID: 'alpha-route', id: 'model-a', limit: { context: 200000, output: 8192 }, variants: [{ id: 'low' }] },
            { providerID: 'beta-route', id: 'model-b', limit: { context: 200000, output: 8192 }, variants: [{ id: 'low' }] },
          ],
        })
      }
      // The DIRECTORY route, exactly `/api/provider` (no trailing segment).
      if (url.pathname === '/api/provider') {
        state.directoryRequests += 1
        const status = script.directoryStatus ?? 200
        if (status !== 200) return json(res, status, { error: 'no directory' })
        const listed = script.directoryRows === undefined ? state.rows : script.directoryRows
        return json(res, 200, { location: { directory: '/tmp' }, data: listed })
      }
      if (url.pathname.startsWith('/api/provider/')) {
        const id = decodeURIComponent(url.pathname.slice('/api/provider/'.length))
        state.itemRequests.push(id)
        // `itemServes` defaults to every row the daemon knows, so a test that
        // wants the measured list-superset shape must narrow it explicitly.
        const serves = script.itemServes ?? state.rows.map((row) => row.id)
        if (!serves.includes(id)) return json(res, 404, providerNotFound(id))
        const row = state.rows.find((entry) => entry.id === id)
        return json(res, 200, { location: { directory: '/tmp' }, data: row })
      }
      if (url.pathname === '/api/credential') {
        state.credentialRequests += 1
        return json(res, 200, {
          data: script.credentials ?? [
            { id: 'cred_1', integrationID: 'shared-integration', active: true, value: { type: 'key', key: 'test-key' } },
          ],
        })
      }
      if (url.pathname.startsWith('/alpha/v1/') || url.pathname.startsWith('/beta/v1/')) {
        state.chatPaths.push(url.pathname)
        state.chatHeaders.push(req.headers)
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: 'ok' } }] })}\n\n`)
        res.write(`data: ${JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }] })}\n\n`)
        res.write('data: [DONE]\n\n')
        return res.end()
      }
      return json(res, 404, { error: 'not found' })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const fixture = {
    state,
    base,
    /** The directory content; fill it after `listen` because rows carry `base`. */
    rows: [],
    close: () => new Promise((resolve) => server.close(resolve)),
  }
  state.rows = fixture.rows
  // Two providers with DISTINCT roots and DISTINCT headers, exactly like the
  // measured directory (`opencode` -> /inference/openai/v1, `opencode-go` ->
  // /inference/go/openai/v1). Any test can replace this list.
  fixture.fill = () => {
    fixture.rows.push(...twoRows(base))
    return fixture
  }
  return fixture
}

/** Directory rows for the standard fixture: two providers, distinct roots/headers. */
const twoRows = (base) => [
  {
    id: 'alpha-route',
    integrationID: 'shared-integration',
    name: 'Alpha',
    settings: { baseURL: `${base}/alpha/v1` },
    headers: { 'x-route-tag': 'alpha' },
  },
  {
    id: 'beta-route',
    integrationID: 'shared-integration',
    name: 'Beta',
    settings: { baseURL: `${base}/beta/v1` },
    headers: { 'x-route-tag': 'beta' },
  },
]

function adapterFor(server, overrides = {}) {
  return new OpencodeHttpAdapter(
    { logger: { warn() {} } },
    Config({
      baseUrl: server.base,
      password: 'pw',
      attachToDaemon: false,
      spawnServer: false,
      autoDiscoverModels: true,
      catalogSyncMs: 0,
      requestTimeoutMs: 2000,
      timeoutMs: 5000,
      // Test isolation, same rule as test/http.test.mjs: never read the
      // operator's live catalog or spend ledger.
      costPath: join(mkdtempSync(join(tmpdir(), 'dsh-cost-')), 'opencode-session-cost.json'),
      catalogPath: join(mkdtempSync(join(tmpdir(), 'dsh-catalog-')), 'opencode-models.json'),
      ...overrides,
    }),
  )
}

// ---------------------------------------------------------------------------
// The bug: the directory lists an id the item route 404s
// ---------------------------------------------------------------------------

test('a provider listed by the directory resolves even when the item route 404s for it', async () => {
  const server = await startServer({ itemServes: ['alpha-route'] }).then((fixture) => fixture.fill())
  try {
    const adapter = adapterFor(server)
    // `beta-route` is in the directory but its ITEM route answers 404 — the
    // measured shape. Resolution must still succeed.
    const beta = await adapter.resolveBackend(undefined, { model: 'beta-route/model-b' })
    assert.equal(beta.baseURL, `${server.base}/beta/v1`)
    // Directory-first: the item route is never consulted for a listed id.
    assert.deepEqual(server.state.itemRequests, [])
    assert.equal(server.state.directoryRequests, 1)
  } finally {
    await server.close()
  }
})

test('each route reaches its own root when the item route serves only one of them', async () => {
  const server = await startServer({ itemServes: ['alpha-route'] }).then((fixture) => fixture.fill())
  try {
    const adapter = adapterFor(server)
    const beta = await adapter.resolveBackend(undefined, { model: 'beta-route/model-b' })
    const alpha = await adapter.resolveBackend(undefined, { model: 'alpha-route/model-a' })
    assert.equal(beta.baseURL, `${server.base}/beta/v1`)
    assert.equal(alpha.baseURL, `${server.base}/alpha/v1`)
    // Per-row headers travel with the route; one provider's header must not
    // appear on the other's request.
    assert.equal(beta.headers['x-route-tag'], 'beta')
    assert.equal(alpha.headers['x-route-tag'], 'alpha')
    // One directory fetch serves both routes.
    assert.equal(server.state.directoryRequests, 1)
  } finally {
    await server.close()
  }
})

test('the resolved endpoint cache is keyed per provider: a second root never reuses the first', async () => {
  const server = (await startServer()).fill()
  try {
    const adapter = adapterFor(server)
    // This is the load-bearing keying documented in test/backend-route.test.mjs:
    // a zen route on the Go root answers 400 "Model is unavailable." and a Go
    // route on the Zen root answers 402 "Insufficient account funds". A shared
    // cache entry would trade an honest error for a wrong endpoint.
    const first = await adapter.resolveBackend(undefined, { model: 'alpha-route/model-a' })
    const second = await adapter.resolveBackend(undefined, { model: 'beta-route/model-b' })
    const again = await adapter.resolveBackend(undefined, { model: 'alpha-route/model-a' })
    assert.equal(first.baseURL, `${server.base}/alpha/v1`)
    assert.equal(second.baseURL, `${server.base}/beta/v1`)
    // Alternating routes must not hand back the other provider's root, even
    // though `backendCache` holds only the last resolved pair.
    assert.equal(again.baseURL, `${server.base}/alpha/v1`)
    assert.notEqual(first.baseURL, second.baseURL)
    // The DIRECTORY is fetched once for all three resolves; only the per-route
    // `{ baseURL, headers }` pair is re-resolved when the provider changes.
    assert.equal(server.state.directoryRequests, 1)
    // One credential fetch per resolved provider pair (three resolves, the third
    // being a different provider than the second).
    assert.equal(server.state.credentialRequests, 3)
  } finally {
    await server.close()
  }
})

test('the same provider resolved twice reuses one credential fetch', async () => {
  const server = (await startServer()).fill()
  try {
    const adapter = adapterFor(server)
    await adapter.resolveBackend(undefined, { model: 'alpha-route/model-a' })
    await adapter.resolveBackend(undefined, { model: 'alpha-route/model-a' })
    assert.equal(server.state.directoryRequests, 1)
    assert.equal(server.state.credentialRequests, 1, 'the resolved pair is cached per provider')
  } finally {
    await server.close()
  }
})

test('a forced resolve refetches the directory instead of serving the cached one', async () => {
  const server = (await startServer()).fill()
  try {
    const adapter = adapterFor(server)
    await adapter.resolveBackend(undefined, { model: 'alpha-route/model-a' })
    await adapter.resolveBackend(undefined, { model: 'alpha-route/model-a' })
    assert.equal(server.state.directoryRequests, 1, 'the second resolve is cached')
    await adapter.resolveBackend(undefined, { model: 'alpha-route/model-a', force: true })
    assert.equal(server.state.directoryRequests, 2, 'force refetches the directory')
  } finally {
    await server.close()
  }
})

// ---------------------------------------------------------------------------
// The fallback: a daemon whose directory is empty or absent
// ---------------------------------------------------------------------------

test('an empty directory falls back to the single-item route', async () => {
  // An older daemon answers the list route, but with no rows, while the item
  // route still serves the provider. The fallback must cover that shape.
  const server = (await startServer({ directoryRows: [] })).fill()
  try {
    const adapter = adapterFor(server)
    const directory = await adapter.backendDirectory()
    assert.equal(directory.size, 0, 'the empty list yields an empty directory')
    const resolved = await adapter.resolveBackend(undefined, { model: 'alpha-route/model-a' })
    assert.equal(resolved.baseURL, `${server.base}/alpha/v1`)
    assert.deepEqual(server.state.itemRequests, ['alpha-route'])
  } finally {
    await server.close()
  }
})

test('a daemon without a directory route resolves through the item route', async () => {
  const server = (await startServer({ directoryStatus: 404 })).fill()
  try {
    const adapter = adapterFor(server)
    const resolved = await adapter.resolveBackend(undefined, { model: 'beta-route/model-b' })
    assert.equal(resolved.baseURL, `${server.base}/beta/v1`)
    assert.deepEqual(server.state.itemRequests, ['beta-route'])
    assert.equal(resolved.headers['x-route-tag'], 'beta')
  } finally {
    await server.close()
  }
})

// ---------------------------------------------------------------------------
// The miss: in neither the directory nor the item route
// ---------------------------------------------------------------------------

test('an id in neither the directory nor the item route reports an actionable error', async () => {
  const server = (await startServer()).fill()
  try {
    const adapter = adapterFor(server, { daemonRetries: 0, daemonRetryBaseMs: 0 })
    await assert.rejects(
      () => adapter.resolveBackend(undefined, { model: 'ghost-route/model-x' }),
      (error) => {
        // The measured failure named only the missing id. The operator needs the
        // id AND what the daemon actually serves AND how to bypass the lookup.
        assert.match(error.message, /"ghost-route"/)
        assert.match(error.message, /"alpha-route"/)
        assert.match(error.message, /"beta-route"/)
        assert.match(error.message, /backendBaseUrl/)
        assert.doesNotMatch(error.message, /exposes no settings\.baseURL/)
        return true
      },
    )
  } finally {
    await server.close()
  }
})

test('a missing provider reaches the turn as an OPENCODE_BACKEND failure, not a dead turn', async () => {
  const server = (await startServer()).fill()
  try {
    const adapter = adapterFor(server, { daemonRetries: 0, daemonRetryBaseMs: 0 })
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'opencode-http-agent',
      model: 'ghost-route/model-x',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })) {
      chunks.push(chunk)
    }
    const final = chunks.at(-1)
    assert.equal(final.type, 'finish')
    assert.equal(final.reason.kind, 'error')
    assert.equal(final.reason.failure.code, 'OPENCODE_BACKEND')
    assert.match(final.reason.failure.message, /"ghost-route"/)
    assert.match(final.reason.failure.message, /"alpha-route"/)
    assert.equal(server.state.chatPaths.length, 0, 'no backend request is attempted')
  } finally {
    await server.close()
  }
})

test('the error factory names the served ids and stays generic about the id', () => {
  const error = noBackendEndpointError('some-id', new Map([['a', {}], ['b', {}]]))
  assert.match(error.message, /"some-id"/)
  assert.match(error.message, /"a", "b"/)
  const bare = noBackendEndpointError('some-id', new Map())
  assert.match(bare.message, /no provider directory/)
})

// ---------------------------------------------------------------------------
// End to end over the wire: directory resolution reaches the right root
// ---------------------------------------------------------------------------

test('a turn on a directory-only provider is served by that provider root', async () => {
  // `beta-route` cannot be reached through the item route at all: this is the
  // exact live shape that failed before the fix.
  const server = await startServer({ itemServes: ['alpha-route'] }).then((fixture) => fixture.fill())
  try {
    const adapter = adapterFor(server)
    const chunks = []
    for await (const chunk of adapter.stream({
      provider: 'opencode-http-agent',
      model: 'beta-route/model-b',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    })) {
      chunks.push(chunk)
    }
    assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
    assert.deepEqual(server.state.chatPaths, ['/beta/v1/chat/completions'])
    assert.equal(server.state.chatHeaders[0]['x-route-tag'], 'beta')
    // The provider prefix never travels on the wire; the endpoint carries it.
    assert.deepEqual(server.state.itemRequests, [])
  } finally {
    await server.close()
  }
})
