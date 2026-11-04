import assert from 'node:assert/strict'
import test from 'node:test'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createServer, resolveLedgerPath } from '../lib/server.js'

/** A minimal cordis-shaped context: effects are collected, not run. */
function fakeContext() {
  const effects = []
  const settingsWrites = []
  const registered = []
  return {
    effects,
    settingsWrites,
    registered,
    effect(factory) {
      effects.push(factory())
      return () => {}
    },
    settings: {
      async update(ns, patch) { settingsWrites.push({ ns, patch }) },
    },
    // The real seam is ctx.connection.fetch.register (measured in the installed
    // host). `connection.register` does not exist — a fake that invented it made
    // this suite green while the live page 404'd on every route.
    connection: {
      fetch: {
        register(spec) { registered.push(spec); return () => {} },
      },
    },
  }
}

/** Build a server over a throwaway ledger and a stub catalog. */
function harness(config = {}) {
  // The ledger path resolves from DSH_HOME, so a test that runs on a developer
  // shell with the LIVE DSH_HOME exported would read and write the operator's real
  // usage file. Point it at a throwaway directory first: measured 2026-11-05, an
  // un-isolated suite asserted '$0.1736' and got '$0.5208' from live data.
  const isolatedHome = mkdtempSync(join(tmpdir(), 'dif-home-'))
  const previousHome = process.env.DSH_HOME
  process.env.DSH_HOME = isolatedHome
  const ctx = fakeContext()
  const dir = mkdtempSync(join(tmpdir(), 'dif-server-'))
  const live = { apiKey: '', baseURL: 'https://api.deepinfra.com/v1/openai', turnMaxTokens: 16384, defaultEffort: '' }
  const server = createServer({
    ctx,
    config: {
      apiKey: { get: () => live.apiKey },
      baseURL: { get: () => live.baseURL },
      turnMaxTokens: { get: () => live.turnMaxTokens },
      defaultEffort: { get: () => live.defaultEffort },
      ...config,
    },
    catalog: {
      list: async () => Array.from({ length: 91 }, (_, i) => ({ id: 'm' + i })),
      entries: async () => Array.from({ length: 91 }, (_, i) => ({ id: 'm' + i, metadata: { tags: ['chat'], context_length: 131072 } })),
    },
    profileDir: dir,
    log: { warn() {} },
  })
  // Point the ledger at the throwaway directory.
  server.dispose()
  const restore = () => {
    if (previousHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousHome
  }
  return { ctx, server, live, registered: ctx.registered, restore }
}

/** Call one route handler with a JSON body. */
async function call(server, route, body = {}) {
  const response = await server.routes[route](new Request('http://localhost/api/local/deepinfra/' + route, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  }))
  return { status: response.status, body: await response.json() }
}

test('a host whose connection seam lacks fetch.register explains, not crashes', () => {
  // Guard against re-introducing the invented seam: a plain object without
  // `fetch.register` must be reported, never thrown from.
  const ctx = fakeContext()
  ctx.connection = { register() {} }
  const warnings = []
  assert.doesNotThrow(() => {
    const server = createServer({
      ctx,
      config: { apiKey: { get: () => '' }, baseURL: { get: () => 'https://api.deepinfra.com/v1/openai' } },
      catalog: { list: async () => [] },
      profileDir: mkdtempSync(join(tmpdir(), 'dif-badseam-')),
      log: { warn: (m) => warnings.push(m) },
    })
    server.dispose()
  })
  assert.ok(warnings.some((m) => /no register function|connection service/.test(m)))
})

test('every documented route is registered on the connection seam', () => {
  const { registered } = harness()
  const paths = registered.map((spec) => spec.path).sort()
  assert.deepEqual(paths, [
    '/api/local/deepinfra/cost/reset',
    '/api/local/deepinfra/cost/session',
    '/api/local/deepinfra/cost/summary',
    '/api/local/deepinfra/models',
    '/api/local/deepinfra/models/apply',
    '/api/local/deepinfra/setup',
    '/api/local/deepinfra/setup/apply',
  ])
  assert.ok(registered.every((spec) => spec.methods.includes('POST')))
})

test('cost/session reports the figure and the aggregate beside it', async () => {
  const { server } = harness()
  server.ledger.record('session-abc', 'm', { costUsd: 0.1736, costSource: 'provider', tokens: { input: 10, output: 2, reasoning: 0, cacheRead: 0, cacheWrite: 0 } }, 1)
  const reply = await call(server, 'cost/session', { sessionId: 'session-abc' })
  assert.equal(reply.status, 200)
  assert.equal(reply.body.text, '$0.1736')
  assert.equal(reply.body.session.sessionId, 'session-abc')
  assert.equal(reply.body.totals.requests, 1)
})

test('cost/session with no spend reports an empty figure, not a fake zero', async () => {
  const { server } = harness()
  const reply = await call(server, 'cost/session', { sessionId: 'nothing' })
  assert.equal(reply.body.text, '')
  assert.equal(reply.body.session, null)
  assert.equal(reply.body.totals.requests, 0)
})

test('setup never returns the raw key', async () => {
  const { server, live } = harness()
  live.apiKey = 'sk-di-super-secret-value-1234'
  const reply = await call(server, 'setup')
  assert.equal(reply.status, 200)
  assert.equal(JSON.stringify(reply.body).includes('sk-di-super-secret-value-1234'), false)
  assert.equal(reply.body.hasApiKey, true)
  assert.equal(reply.body.apiKeySource, 'ui')
  assert.equal(reply.body.catalogCount, 91)
})

test('setup reports the environment source when the UI key is empty', async () => {
  const previous = process.env.DEEPINFRA_API_KEY
  process.env.DEEPINFRA_API_KEY = 'sk-di-from-env-9999'
  try {
    const { server } = harness()
    const reply = await call(server, 'setup')
    assert.equal(reply.body.apiKeySource, 'env')
    assert.equal(JSON.stringify(reply.body).includes('sk-di-from-env-9999'), false)
  } finally {
    if (previous === undefined) delete process.env.DEEPINFRA_API_KEY
    else process.env.DEEPINFRA_API_KEY = previous
  }
})

test('setup/apply writes through the settings service', async () => {
  // Regression: the live page once answered 409 "this host exposes no settings
  // service" because the server read the ROOT ctx, which does not own `settings`
  // once the panel mounts through ctx.inject([...]). The scoped services must be
  // preferred, and the root must still work when there is no scope at all.
  const { server, ctx } = harness()
  const reply = await call(server, 'setup/apply', { apiKey: '  sk-new  ', turnMaxTokens: 2048, defaultEffort: 'high' })
  assert.equal(reply.status, 200)
  assert.equal(ctx.settingsWrites.length, 1)
  // The namespace is the plugin name, which is what the loader derives.
  assert.equal(ctx.settingsWrites[0].ns, 'dsh-deepinfra')
  assert.deepEqual(ctx.settingsWrites[0].patch, { apiKey: 'sk-new', turnMaxTokens: 2048, defaultEffort: 'high' })
})

test('setup/apply rejects an empty patch instead of writing nothing', async () => {
  const { server, ctx } = harness()
  const reply = await call(server, 'setup/apply', {})
  assert.equal(reply.status, 400)
  assert.equal(ctx.settingsWrites.length, 0)
})

test('a host without a settings service explains instead of throwing', async () => {
  const ctx = fakeContext()
  ctx.settings = undefined
  const server = createServer({
    ctx,
    config: { apiKey: { get: () => '' }, baseURL: { get: () => 'https://api.deepinfra.com/v1/openai' } },
    catalog: { list: async () => [] },
    profileDir: mkdtempSync(join(tmpdir(), 'dif-nosettings-')),
    log: { warn() {} },
  })
  const reply = await call(server, 'setup/apply', { apiKey: 'x' })
  assert.equal(reply.status, 409)
  assert.match(reply.body.error, /settings service/)
})

test('cost/reset clears one session', async () => {
  const { server } = harness()
  server.ledger.record('a', 'm', { costUsd: 1, costSource: 'provider', tokens: null }, 1)
  server.ledger.record('b', 'm', { costUsd: 1, costSource: 'provider', tokens: null }, 1)
  await call(server, 'cost/reset', { sessionId: 'a' })
  assert.equal(server.ledger.session('a'), null)
  assert.notEqual(server.ledger.session('b'), null)
})

test('recordCost ignores a request with no usage object', () => {
  const { server } = harness()
  // A thrown bookkeeping error must never reach the stream; nothing recorded here.
  assert.doesNotThrow(() => server.recordCost({ sessionId: 's', model: 'm' }, undefined))
  assert.equal(server.ledger.session('s'), null)
})

test('recordCost parses the real wire usage into the ledger', () => {
  const { server } = harness()
  server.recordCost(
    { sessionId: 'session-x', model: 'deepseek-ai/DeepSeek-V4.1-Flash' },
    { prompt_tokens: 7, completion_tokens: 2, estimated_cost: 0.00000182, prompt_tokens_details: { cached_tokens: 0 } },
  )
  const session = server.ledger.session('session-x')
  assert.equal(session.requests, 1)
  assert.equal(session.costUsd, 0.00000182)
})

test('a small model selection is honoured verbatim', async () => {
  // Instruction 2026-11-05: the operator chooses exactly which models the prompt
  // may offer, and "just these two" is a legitimate intent. A MIN_KEEP=5 guard
  // existed briefly and was removed because it blocked that intent.
  const { server, ctx } = harness()
  const reply = await call(server, 'models/apply', { enabled: ['a', 'b'] })
  assert.equal(reply.status, 200)
  assert.deepEqual(ctx.settingsWrites[0].patch, { enabledModels: ['a', 'b'] })
})

test('an explicit empty list still means serve everything', async () => {
  const { server, ctx } = harness()
  const reply = await call(server, 'models/apply', { enabled: [] })
  assert.equal(reply.status, 200)
  assert.deepEqual(ctx.settingsWrites[0].patch, { enabledModels: [] })
})

test('a real selection is saved normally', async () => {
  const { server, ctx } = harness()
  const many = Array.from({ length: 10 }, (_, i) => 'm' + i)
  const reply = await call(server, 'models/apply', { enabled: many })
  assert.equal(reply.status, 200)
  assert.deepEqual(ctx.settingsWrites[0].patch.enabledModels, many)
})

test('a scoped sub-context supplies settings the root does not own', async () => {
  const ctx = fakeContext()
  // The root has NO settings service; only the deferred scope does.
  const rootSettings = ctx.settings
  ctx.settings = undefined
  const server = createServer({
    ctx,
    config: { apiKey: { get: () => '' }, baseURL: { get: () => 'https://api.deepinfra.com/v1/openai' } },
    catalog: { list: async () => [], entries: async () => [] },
    profileDir: mkdtempSync(join(tmpdir(), 'dif-scope-')),
    log: { warn() {} },
  })
  const writes = []
  server.dispose({ connection: ctx.connection, settings: { update: async (ns, patch) => writes.push({ ns, patch }) } })
  const reply = await call(server, 'setup/apply', { apiKey: 'sk-scoped' })
  assert.equal(reply.status, 200, 'a scoped settings service must be used')
  assert.deepEqual(writes, [{ ns: 'dsh-deepinfra', patch: { apiKey: 'sk-scoped' } }])
  assert.equal(rootSettings !== undefined, true)
})

test('a multi-call turn is ONE turn in the partition', () => {
  // A tool-using turn makes several model calls. They must land under one turn
  // number, which is why the turn comes from the host's own numbering rather
  // than from a per-request counter.
  const { server } = harness()
  const entry = { costUsd: 0.0001, costSource: 'provider', tokens: { input: 1, output: 1, reasoning: 0, cacheRead: 0, cacheWrite: 0 } }
  server.ledger.record('s', 'm', entry, 1)
  server.ledger.record('s', 'm', entry, 1)
  server.ledger.record('s', 'm', entry, 1)
  const session = server.ledger.session('s')
  assert.equal(session.requests, 3)
  assert.deepEqual(Object.keys(session.turns), ['1'])
  assert.equal(session.turns['1'].requests, 3)
})

test('recordCost accepts an explicitly attributed turn', () => {
  const { server } = harness()
  server.recordCost(
    { sessionId: 'session-t', model: 'm' },
    { prompt_tokens: 1, completion_tokens: 1, estimated_cost: 0.5 },
    7,
  )
  const session = server.ledger.session('session-t')
  assert.deepEqual(Object.keys(session.turns), ['7'])
})

test('the ledger path follows DSH_HOME, never the working directory', () => {
  // $DSH_HOME is the only reliable root: the live web service exports it, while
  // ctx.profileDir is NOT a service the web profile exposes (measured 2026-11-05
  // - relying on it left the ledger somewhere nobody looked, which read as
  // "usage is always zero").
  assert.equal(resolveLedgerPath({ explicit: '/tmp/x.json' }), '/tmp/x.json')
  assert.equal(resolveLedgerPath({ dshHome: '/home/u/.dsh' }), '/home/u/.dsh/deepinfra-session-cost.json')
  // DSH_HOME wins over a profile hint, so one file serves every session.
  assert.equal(
    resolveLedgerPath({ dshHome: '/home/u/.dsh', profileDir: '/home/u/.dsh/profiles/web' }),
    '/home/u/.dsh/deepinfra-session-cost.json',
  )
  // profileDir is still honoured when DSH_HOME is absent.
  assert.equal(resolveLedgerPath({ profileDir: '/p' }), '/p/deepinfra-session-cost.json')
  // A relative cwd must never leak in.
  assert.equal(resolveLedgerPath({}).startsWith('/'), true)
})
