/**
 * Pure-adapter contract tests for lib/http.js.
 *
 * The fake server exposes only the measured control plane (`/api/info`,
 * `/api/model`, `/api/provider/{id}`, `/api/credential`) plus an
 * OpenAI-compatible `/backend/v1/chat/completions` SSE endpoint. It records
 * every request so tests can prove that no agent/session endpoint is called.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  Config,
  OpencodeHttpAdapter,
  addUsage,
  authHeader,
  chatSseEvents,
  errorText,
  finishFromOpenAi,
  modelKey,
  modelRefFromRoute,
  classifyProbe,
  enabledRouteFilter,
  isTransientStreamError,
  parseBanner,
  probeServer,
  registerModelSettingsRoutes,
  repairJson,
  sessionHeaders,
  readBanner,
  resolveWorkspaceDirectory,
  serviceStateCandidates,
  usageFromOpenAi,
  usageFromTokens,
} from '../lib/http.js'
import { buildChatRequest } from '../lib/http.js'

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

async function startServer(script = {}) {
  const state = {
    chatRequests: [],
    chatHeaders: [],
    providerRequests: 0,
    credentialRequests: 0,
    sessionCalls: 0,
    backendURL: '',
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', async () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
      if (url.pathname === '/api/info') {
        return json(res, 200, { version: '2.2.0', pid: 1, hostname: 'test', urls: ['http://127.0.0.1'] })
      }
      if (url.pathname === '/api/model') {
        return json(res, 200, {
          location: { directory: '/tmp' },
          data: script.models ?? [
            { providerID: 'opencode', id: 'beam-free', name: 'Beam Free', limit: { context: 200000, output: 8192 }, variants: [{ id: 'low' }, { id: 'high' }] },
            {
              providerID: 'opencode-go',
              id: 'minimax-m3.1-flash',
              name: 'MiniMax M3.1 Flash',
              limit: { context: 1000000, output: 512000 },
              variants: [{ id: 'low' }, { id: 'medium' }, { id: 'high' }, { id: 'xhigh' }, { id: 'max' }],
            },
          ],
        })
      }
      if (url.pathname.startsWith('/api/session')) {
        state.sessionCalls += 1
        return json(res, 500, { error: 'session API must not be called by a pure adapter' })
      }
      if (url.pathname === '/api/provider/opencode-go') {
        state.providerRequests += 1
        return json(res, 200, {
          data: {
            id: 'opencode-go',
            integrationID: 'opencode-go',
            settings: { baseURL: state.backendURL },
            headers: { 'x-opencode-org-id': 'org_test' },
          },
        })
      }
      if (url.pathname === '/api/credential') {
        state.credentialRequests += 1
        return json(res, 200, {
          data: script.credentials ?? [
            { id: 'cred_1', integrationID: 'opencode-go', active: true, value: { type: 'key', key: 'test-key' } },
          ],
        })
      }
      if (url.pathname === '/backend/v1/chat/completions') {
        state.chatRequests.push(body)
        state.chatHeaders.push(req.headers)
        if (script.status) return json(res, script.status, { error: 'backend refused' })
        const events = script.events ?? [
          { choices: [{ delta: { reasoning_content: 'Think.' } }] },
          { choices: [{ delta: { content: 'Hello' } }] },
          { choices: [{ delta: { content: ' HTTP' } }] },
          { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 11, prompt_tokens_details: { cached_tokens: 4 }, completion_tokens: 4 } },
        ]
        // `cuts[i]` = how many events attempt i delivers before the socket is
        // destroyed mid-stream (the measured `TypeError: terminated` shape).
        const cutEvents = (script.cuts ?? [])[state.chatRequests.length - 1]
        if (cutEvents !== undefined) {
          res.writeHead(200, { 'content-type': 'text/event-stream' })
          for (const event of events.slice(0, cutEvents)) res.write(`data: ${JSON.stringify(event)}\n\n`)
          res.flushHeaders()
          setTimeout(() => res.destroy(), 10)
          return undefined
        }
        res.writeHead(200, { 'content-type': 'text/event-stream' })
        for (const event of events) res.write(`data: ${JSON.stringify(event)}\n\n`)
        res.write('data: [DONE]\n\n')
        return res.end()
      }
      return json(res, 404, { error: 'not found' })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  state.backendURL = `http://127.0.0.1:${server.address().port}/backend/v1`
  return { server, state, close: () => new Promise((resolve) => server.close(resolve)) }
}

function adapterFor(serverState, overrides = {}) {
  return new OpencodeHttpAdapter(
    { logger: { warn() {} } },
    Config({
      baseUrl: serverState.backendURL.replace(/\/backend\/v1$/, ''),
      password: 'pw',
      attachToDaemon: false,
      spawnServer: false,
      autoDiscoverModels: true,
      catalogSyncMs: 0,
      requestTimeoutMs: 2000,
      timeoutMs: 5000,
      ...overrides,
    }),
  )
}

// The base URL needs the server's control-plane port, not the backend path.
function controlURL(serverState) {
  return serverState.backendURL.replace(/\/backend\/v1$/, '')
}

async function collect(stream) {
  const out = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

test('parseBanner reads the measured serve banner', () => {
  const banner = parseBanner('server listening on http://127.0.0.1:42111\nserver password abc123\n')
  assert.deepEqual(banner, { url: 'http://127.0.0.1:42111', password: 'abc123' })
  assert.equal(parseBanner('no banner'), null)
})

test('readBanner consumes split chunks from a piped stdout', async () => {
  const encoder = new TextEncoder()
  const text = 'server listening on http://127.0.0.1:1234\nserver password pw\n'
  const handle = {
    stdout: (async function* () {
      yield encoder.encode(text.slice(0, 20))
      yield encoder.encode(text.slice(20))
    })(),
  }
  assert.deepEqual(await readBanner(handle, 1000), { url: 'http://127.0.0.1:1234', password: 'pw' })
})

test('modelRefFromRoute maps DSH routes onto backend refs', () => {
  const table = [{ id: 'default', opencodeModel: 'opencode-go/minimax-m3.1-flash' }]
  assert.deepEqual(modelRefFromRoute('opencode/beam-free', table, ''), { providerID: 'opencode', id: 'beam-free' })
  assert.deepEqual(modelRefFromRoute('default', table, ''), { providerID: 'opencode-go', id: 'minimax-m3.1-flash' })
  assert.equal(modelRefFromRoute('unqualified', table, ''), null)
  assert.equal(modelKey({ providerID: 'p', id: 'm' }, 'high'), 'p/m#high')
})

test('usageFromTokens keeps legacy OpenCode bucket semantics', () => {
  assert.deepEqual(usageFromTokens({ input: 11, output: 4, reasoning: 9, cache: { read: 4096, write: 0 } }), {
    inputTokens: 11,
    outputTokens: 4,
    reasoningTokens: 9,
    cacheReadTokens: 4096,
    cacheWriteTokens: 0,
    totalTokens: 4120,
  })
  assert.equal(addUsage(usageFromTokens({ input: 1, output: 2 }), usageFromTokens({ input: 3, output: 4 })).totalTokens, 10)
})

test('usageFromOpenAi produces disjoint DSH buckets', () => {
  assert.deepEqual(
    usageFromOpenAi({ prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens: 20, completion_tokens_details: { reasoning_tokens: 5 } }),
    { inputTokens: 60, outputTokens: 20, cacheReadTokens: 40, cacheWriteTokens: 0, reasoningTokens: 5, totalTokens: 120 },
  )
})

test('finishFromOpenAi maps tool calls and length', () => {
  assert.deepEqual(finishFromOpenAi('tool_calls'), { kind: 'tool-calls' })
  assert.deepEqual(finishFromOpenAi('length'), { kind: 'max-tokens' })
  assert.deepEqual(finishFromOpenAi('stop'), { kind: 'stop' })
})

test('authHeader is basic opencode:<password>', () => {
  assert.equal(authHeader('pw'), `Basic ${Buffer.from('opencode:pw').toString('base64')}`)
})

test('resolveWorkspaceDirectory reads the live DSH session cwd only', () => {
  const ctx = { sessions: { get: (id) => (id === 's1' ? { header: { cwd: '/work/project' } } : undefined) } }
  assert.equal(resolveWorkspaceDirectory(ctx, { sessionId: 's1' }), '/work/project')
  assert.equal(resolveWorkspaceDirectory(ctx, { sessionId: 'missing' }), '')
  assert.equal(resolveWorkspaceDirectory({}, {}), '')
})

test('buildChatRequest is prompt-neutral and forwards DSH tools', () => {
  const config = Config({ reasoningField: 'reasoning_content', effortField: 'reasoning_effort' })
  const body = buildChatRequest(
    {
      system: 'SYSTEM',
      messages: [
        { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        { role: 'assistant', content: [{ type: 'text', text: 'ok' }, { type: 'tool-call', id: 'call_1', name: 'bash', arguments: '{"command":"ls"}' }] },
        { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: 'file.txt' }] },
      ],
      tools: [{ name: 'bash', description: 'Run a command', parameters: { type: 'object' } }],
      reasoningEffort: 'high',
      maxTokens: 99,
    },
    { providerID: 'opencode-go', id: 'minimax-m3.1-flash' },
    config,
  )
  assert.equal(body.model, 'minimax-m3.1-flash')
  assert.equal(body.stream, true)
  assert.deepEqual(body.stream_options, { include_usage: true })
  assert.equal(body.messages[0].role, 'system')
  assert.equal(body.messages[1].content, 'hi')
  assert.deepEqual(body.messages[2].tool_calls[0].function, { name: 'bash', arguments: '{"command":"ls"}' })
  assert.equal(body.messages[3].tool_call_id, 'call_1')
  assert.equal(body.tools[0].function.name, 'bash')
  assert.equal(body.reasoning_effort, 'high')
  assert.equal(body.max_tokens, 99)
  const serialized = JSON.stringify(body)
  assert.ok(!/You are OpenCode|caller declared|complete the work with your own/.test(serialized), 'no persona/note text')
})

test('chatSseEvents frames JSON data and ignores [DONE]', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"a":1}\n\ndata: [DONE]\n\n'))
      controller.close()
    },
  })
  const events = []
  for await (const event of chatSseEvents(body, new AbortController().signal)) events.push(event)
  assert.deepEqual(events, [{ a: 1 }])
})

test('pure stream maps reasoning, text, usage, and finish without session calls', async () => {
  const { server, state, close } = await startServer()
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const chunks = await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      sessionId: 'dsh-1',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    }))
    assert.equal(state.sessionCalls, 0, 'no /api/session prompt may be used')
    assert.equal(state.chatRequests.length, 1)
    assert.equal(state.chatRequests[0].model, 'minimax-m3.1-flash')
    assert.equal(state.chatRequests[0].stream, true)
    assert.equal(adapter.lastWorkspace, '', 'no sessions service in this unit context')
    const types = chunks.map((chunk) => chunk.type)
    assert.deepEqual(types, ['block-start', 'reasoning-delta', 'block-start', 'text-delta', 'text-delta', 'block-end', 'block-end', 'usage', 'finish'])
    const usage = chunks.find((chunk) => chunk.type === 'usage').usage
    assert.deepEqual(usage, { inputTokens: 7, outputTokens: 4, cacheReadTokens: 4, cacheWriteTokens: 0, totalTokens: 15 })
    assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  } finally {
    await close()
  }
})

test('pure stream emits tool-call deltas and a tool-call block', async () => {
  const events = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'bash', arguments: '{"command":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] }, finish_reason: 'tool_calls' }] },
  ]
  const { server, state, close } = await startServer({ events })
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const chunks = await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'list' }] }],
    }))
    const calls = chunks.filter((chunk) => chunk.type === 'tool-call-delta')
    assert.equal(calls[0].id, 'call_1')
    assert.equal(calls[0].name, 'bash')
    assert.equal(calls[0].argumentsDelta, '{"command":')
    assert.equal(calls[1].argumentsDelta, '"ls"}')
    const end = chunks.find((chunk) => chunk.type === 'block-end')
    assert.deepEqual(end.block, { type: 'tool-call', id: 'call_1', name: 'bash', arguments: '{"command":"ls"}' })
    assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } })
  } finally {
    await close()
  }
})

test('backend base URL and credential are cached across calls', async () => {
  const { server, state, close } = await startServer()
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    await collect(adapter.stream({ provider: 'opencode-http-agent', model: 'opencode-go/minimax-m3.1-flash', messages: [{ role: 'user', content: [{ type: 'text', text: 'a' }] }] }))
    await collect(adapter.stream({ provider: 'opencode-http-agent', model: 'opencode-go/minimax-m3.1-flash', messages: [{ role: 'user', content: [{ type: 'text', text: 'b' }] }] }))
    assert.equal(state.providerRequests, 1)
    assert.equal(state.credentialRequests, 1)
    assert.equal(state.chatRequests.length, 2)
  } finally {
    await close()
  }
})

test('resolveModel publishes contextWindow and reasoning variants from /api/model', async () => {
  const { server, state, close } = await startServer()
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const resolved = await adapter.resolveModel('opencode-http-agent', 'opencode-go/minimax-m3.1-flash')
    assert.equal(resolved.context.contextWindow, 1000000)
    assert.equal(resolved.defaultMaxTokens, 512000)
    assert.deepEqual(resolved.reasoning.efforts.map((effort) => effort.id), ['low', 'medium', 'high', 'xhigh', 'max'])
  } finally {
    await close()
  }
})

test('stream rejects a level the route does not advertise before calling the backend', async () => {
  const { server, state, close } = await startServer()
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const chunks = await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      reasoningEffort: 'none',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    }))
    assert.equal(state.chatRequests.length, 0)
    assert.equal(chunks.at(-1).reason.failure.code, 'UNSUPPORTED_REASONING_EFFORT')
  } finally {
    await close()
  }
})

test('backend HTTP failure becomes a stable error finish', async () => {
  const { server, state, close } = await startServer({ status: 502 })
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const chunks = await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    }))
    assert.equal(chunks.at(-1).reason.failure.code, 'OPENCODE_BACKEND_HTTP')
  } finally {
    await close()
  }
})

test('an unreachable control plane is reported instead of an empty model list', async () => {
  // No durable catalog: a cache left by an earlier run would answer for the dead
  // control plane and hide the failure this test exists to catch.
  const adapter = new OpencodeHttpAdapter({}, Config({
    baseUrl: 'http://127.0.0.1:1',
    password: 'pw',
    attachToDaemon: false,
    spawnServer: false,
    autoDiscoverModels: true,
    catalogPath: join(await mkdtemp(join(tmpdir(), 'dsh-nocatalog-')), 'models.json'),
    catalogSyncMs: 0,
    requestTimeoutMs: 200,
  }))
  await assert.rejects(() => adapter.listModels('opencode-http-agent'), /catalog unavailable/)
})

test('probeServer reports the serving version and null for a dead port', async () => {
  const { server, state, close } = await startServer()
  try {
    assert.equal((await probeServer(controlURL(state), 'pw')).version, '2.2.0')
    assert.equal(await probeServer('http://127.0.0.1:1', 'pw', 200), null)
  } finally {
    await close()
  }
})

test('the provider name states direct backend serving', () => {
  const adapter = new OpencodeHttpAdapter({}, Config({}))
  assert.deepEqual(adapter.providerInfo('opencode-http-agent'), { id: 'opencode-http-agent', name: 'OpenCode Go (direct)' })
})

test('errorText renders structured execution errors instead of [object Object]', () => {
  assert.equal(errorText({ message: 'boom' }), 'boom')
  assert.equal(errorText({ error: { message: 'nested' } }), 'nested')
  assert.equal(errorText('plain'), 'plain')
})

test('serviceStateCandidates covers the explicit row, v2 roots, and legacy state', () => {
  const candidates = serviceStateCandidates('/explicit')
  assert.equal(candidates[0], '/explicit')
  assert.ok(candidates.some((path) => path.endsWith('/.local/state/opencode/service.json')))
  assert.ok(candidates.some((path) => path.endsWith('/.config/opencode/service.json')))
})

// Measured 2026-10-30: the Go backend answers HTTP 400 MissingSessionID when
// `x-opencode-session` is absent, and 401 when a revoked `key` credential is
// preferred over the active web (oauth) credential.
test('session header is sent with the DSH session id', async () => {
  const { server, state, close } = await startServer()
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      sessionId: 'session-abc',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    }))
    assert.equal(state.chatHeaders[0]['x-opencode-session'], 'session-abc')
  } finally {
    await close()
  }
})

test('session header falls back to a stable value when DSH sends no session id', async () => {
  const { server, state, close } = await startServer()
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'probe' }] }],
    }))
    assert.equal(state.chatHeaders[0]['x-opencode-session'], 'deepseek-harness')
  } finally {
    await close()
  }
})

test('sessionHeaders honours a configured header name and an empty header config', () => {
  const on = Config({ sessionHeader: 'x-opencode-session', sessionFallback: 'fallback' })
  assert.deepEqual(sessionHeaders({ a: '1' }, { sessionId: 's-1' }, on), { a: '1', 'x-opencode-session': 's-1' })
  assert.equal(sessionHeaders({}, {}, on)['x-opencode-session'], 'fallback')
  const off = Config({ sessionHeader: '' })
  assert.deepEqual(sessionHeaders({ a: '1' }, { sessionId: 's-1' }, off), { a: '1' })
})

test('credential selection prefers the active oauth entry over a revoked key', async () => {
  const { server, state, close } = await startServer({
    credentials: [
      { id: 'cred_go', integrationID: 'opencode-go', active: true, label: 'OpenCode Go', value: { type: 'key', key: 'revoked-key' } },
      { id: 'cred_personal', integrationID: 'opencode', active: true, label: 'Personal', value: { type: 'oauth', access: 'oauth-token' } },
    ],
  })
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    }))
    assert.equal(state.chatHeaders[0].authorization, 'Bearer oauth-token')
  } finally {
    await close()
  }
})

test('credentialLabel pins an exact store entry', async () => {
  const { server, state, close } = await startServer({
    credentials: [
      { id: 'cred_go', integrationID: 'opencode-go', active: true, label: 'OpenCode Go', value: { type: 'key', key: 'go-key' } },
      { id: 'cred_personal', integrationID: 'opencode', active: true, label: 'Personal', value: { type: 'oauth', access: 'oauth-token' } },
    ],
  })
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state), credentialLabel: 'OpenCode Go' })
    await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    }))
    assert.equal(state.chatHeaders[0].authorization, 'Bearer go-key')
  } finally {
    await close()
  }
})

// Measured 2026-10-30: an empty allow-list must not change anything, and a
// non-empty one must hide every other route from the prompt picker only.
test('enabledRouteFilter treats an empty list as unrestricted', () => {
  assert.equal(enabledRouteFilter([]), null)
  assert.equal(enabledRouteFilter(undefined), null)
  assert.equal(enabledRouteFilter(['', '   ']), null)
})

test('enabledRouteFilter trims and matches full provider/model routes', () => {
  const filter = enabledRouteFilter([' opencode-go/a ', 'opencode/b'])
  assert.ok(filter instanceof Set)
  assert.ok(filter.has('opencode-go/a'))
  assert.ok(filter.has('opencode/b'))
  assert.ok(!filter.has('a'))
})

test('classifyProbe maps the measured backend answers', () => {
  assert.equal(classifyProbe(200, ''), 'usable')
  assert.equal(classifyProbe(400, 'Upstream request failed: Model is unavailable.'), 'unavailable')
  assert.equal(classifyProbe(410, 'Model mimo-v2.5 has been deprecated. Use mimo-v2.6-flash instead.'), 'deprecated')
  assert.equal(classifyProbe(401, 'Upstream request failed: Invalid credential'), 'auth')
  assert.equal(classifyProbe(403, 'An active OpenCode Go subscription is required'), 'forbidden')
  assert.equal(classifyProbe(500, 'boom'), 'error')
})

test('listModels hides routes outside enabledModels but keeps the default row', async () => {
  const { state, close } = await startServer()
  try {
    const adapter = adapterFor(state, {
      baseUrl: controlURL(state),
      enabledModels: ['opencode-go/minimax-m3.1-flash'],
    })
    const models = await adapter.listModels('opencode-http-agent')
    const ids = models.map((model) => model.id)
    assert.ok(ids.includes('default'), 'the config-default row always stays selectable')
    assert.ok(ids.includes('opencode-go/minimax-m3.1-flash'))
    assert.ok(!ids.includes('opencode/beam-free'), 'an unselected route is hidden')
  } finally {
    await close()
  }
})

test('listModels offers only the active plan, and falls back to a plan-free catalog when unrestricted', async () => {
  const { state, close } = await startServer()
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const goIds = (await adapter.listModels('opencode-http-agent')).map((model) => model.id)
    assert.ok(goIds.includes('opencode-go/minimax-m3.1-flash'))
    assert.ok(!goIds.includes('opencode/beam-free'), 'the other plan is not offered while it is inactive')

    // Switching the plan swaps the offered set without any backend request.
    adapter.config.activePlan = { get: () => 'zen' }
    const zenIds = (await adapter.listModels('opencode-http-agent')).map((model) => model.id)
    assert.ok(zenIds.includes('opencode/beam-free'))
    assert.ok(!zenIds.includes('opencode-go/minimax-m3.1-flash'))
  } finally {
    await close()
  }
})

test('observe() persists a refusal and clears it when the route serves', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'ocv2-observe-'))
  const { state, close } = await startServer()
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    adapter.config.verdictPath = { get: () => join(dir, 'verdicts.json') }

    // The backend refuses the route during a real turn: recorded for free.
    assert.equal(adapter.observe('opencode-go/minimax-m3.1-flash', 'unavailable'), true)
    assert.deepEqual(adapter.verdicts().verdicts, { 'opencode-go/minimax-m3.1-flash': 'unavailable' })

    // Same state again is a no-op (no write on the common path).
    assert.equal(adapter.observe('opencode-go/minimax-m3.1-flash', 'unavailable'), false)

    // A served route clears the stale refusal.
    assert.equal(adapter.observe('opencode-go/minimax-m3.1-flash', 'usable'), true)
    assert.deepEqual(adapter.verdicts().verdicts, {})

    // `default` is a pseudo-row, never a route.
    assert.equal(adapter.observe('default', 'unavailable'), false)
  } finally {
    await close()
    await rm(dir, { recursive: true, force: true })
  }
})

test('model-settings routes expose the catalog and persist the allow-list', async () => {
  const { state, close } = await startServer()
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state), enabledModels: [] })
    const registered = new Map()
    const ctx = {
      effect: (fn) => fn(),
      connection: { fetch: { register: (route) => { registered.set(route.path, route); return () => {} } } },
    }
    // The row config is a live accessor; keep the written value in the test.
    let stack = []
    adapter.config.enabledModels = { get: () => stack }
    // The host settings service is the writer: mirror what `ctx.settings.update` does.
    const updates = []
    ctx.settings = { update: async (ns, patch) => { updates.push([ns, patch]); stack = patch.enabledModels } }
    assert.equal(registerModelSettingsRoutes(ctx, adapter, adapter.config), true)
    assert.ok(registered.has('/api/local/opencode-v2/model-settings'))
    assert.ok(registered.has('/api/local/opencode-v2/model-settings/apply'))

    const getRoute = registered.get('/api/local/opencode-v2/model-settings')
    const initial = await (await getRoute.fetch(new Request('http://x/', { method: 'POST' }))).json()
    assert.deepEqual(initial.enabled, [])
    assert.ok(initial.models.some((model) => model.route === 'opencode-go/minimax-m3.1-flash'))

    const applyRoute = registered.get('/api/local/opencode-v2/model-settings/apply')
    const applied = await (await applyRoute.fetch(new Request('http://x/', {
      method: 'POST',
      body: JSON.stringify({ enabled: ['opencode-go/minimax-m3.1-flash', '  ', 'opencode/beam-free'] }),
    }))).json()
    assert.deepEqual(applied.enabled, ['opencode-go/minimax-m3.1-flash', 'opencode/beam-free'])
    assert.ok(applied.visible.includes('opencode-go/minimax-m3.1-flash'))
    assert.ok(!applied.visible.includes('opencode/beam-free') || applied.visible.every((id) => id === 'opencode-go/minimax-m3.1-flash' || id === 'opencode/beam-free'))

    assert.equal(updates.length, 1)
    assert.equal(updates[0][0], 'dsh-opencode-v2-http')
    assert.deepEqual(updates[0][1].enabledModels, ['opencode-go/minimax-m3.1-flash', 'opencode/beam-free'])

    const bad = await applyRoute.fetch(new Request('http://x/', { method: 'POST', body: JSON.stringify({ nope: 1 }) }))
    assert.equal(bad.status, 400)
  } finally {
    await close()
  }
})

test('model-settings routes report a host without a settings service instead of writing', async () => {
  const { state, close } = await startServer()
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const registered = new Map()
    const ctx = { effect: (fn) => fn(), connection: { fetch: { register: (r) => { registered.set(r.path, r); return () => {} } } } }
    adapter.config.enabledModels = { get: () => [] }
    registerModelSettingsRoutes(ctx, adapter, adapter.config)
    const res = await registered.get('/api/local/opencode-v2/model-settings/apply').fetch(
      new Request('http://x/', { method: 'POST', body: JSON.stringify({ enabled: ['a/b'] }) }),
    )
    assert.equal(res.status, 409)
  } finally {
    await close()
  }
})

// --- upstream stream cut (measured 2026-10-31: `TypeError: terminated`) ---------

test('a stream cut before any output is retried once and then succeeds', async () => {
  const { server, state, close } = await startServer({ cuts: [0] })
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const chunks = await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    }))
    // The retry is invisible in the transcript: exactly one text block, one stop.
    assert.equal(state.chatRequests.length, 2)
    const texts = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text)
    assert.deepEqual(texts, ['Hello', ' HTTP'])
    assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
  } finally {
    await close()
  }
})

test('a stream cut after partial text preserves the text instead of failing the turn', async () => {
  const events = [
    { choices: [{ delta: { reasoning_content: 'Think.' } }] },
    { choices: [{ delta: { content: 'Hello' } }] },
    { choices: [{ delta: { content: ' HTTP' } }] },
  ]
  const { server, state, close } = await startServer({ events, cuts: [2] })
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const chunks = await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    }))
    const final = chunks.at(-1)
    // `stop`, not `error`: the harness keeps the partial message and continues.
    assert.deepEqual(final, { type: 'finish', reason: { kind: 'stop' } })
    assert.ok(!chunks.some((chunk) => chunk.type === 'finish' && chunk.reason.kind === 'error'))
    const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
    assert.equal(text, 'Hello')
    // Every opened block is closed exactly once.
    const opened = chunks.filter((chunk) => chunk.type === 'block-start').map((chunk) => chunk.index)
    const closed = chunks.filter((chunk) => chunk.type === 'block-end').map((chunk) => chunk.index)
    assert.deepEqual(closed.sort(), opened.sort())
  } finally {
    await close()
  }
})

test('a stream cut mid tool-call closes the call with repaired JSON', async () => {
  const events = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_7', function: { name: 'bash', arguments: '{"command":"ls' } }] } }] },
  ]
  const { server, state, close } = await startServer({ events, cuts: [1] })
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const chunks = await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'list' }] }],
      tools: [{ name: 'bash', description: 'run', parameters: { type: 'object', properties: {} } }],
    }))
    assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'stop' } })
    const end = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    assert.equal(end.block.id, 'call_7')
    assert.equal(end.block.name, 'bash')
    // Never invalid JSON: the tool layer can parse it and the model can retry.
    assert.doesNotThrow(() => JSON.parse(end.block.arguments))
  } finally {
    await close()
  }
})

test('streamCutPreserve:false keeps the previous hard error verdict', async () => {
  const { server, state, close } = await startServer({ cuts: [1] })
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state), streamCutPreserve: false, streamRetries: 0 })
    const chunks = await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    }))
    const final = chunks.at(-1)
    assert.equal(final.type, 'finish')
    assert.equal(final.reason.kind, 'error')
    assert.equal(final.reason.failure.code, 'OPENCODE_BACKEND')
  } finally {
    await close()
  }
})

test('a thinking wrapper in content becomes reasoning, never screen text', async () => {
  const events = [
    { choices: [{ delta: { content: '<thinking>plan it</thinking>Hel' } }] },
    { choices: [{ delta: { content: 'lo' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ]
  const { server, state, close } = await startServer({ events })
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const chunks = await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    }))
    const starts = chunks.filter((chunk) => chunk.type === 'block-start').map((chunk) => chunk.blockType)
    // 0.0.1: the restored top classifier turns the wrapper into reasoning and the
    // screen channel never carries the token.
    assert.deepEqual(starts, ['reasoning', 'text'])
    const reasoning = chunks.filter((chunk) => chunk.type === 'reasoning-delta').map((chunk) => chunk.text).join('')
    const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
    assert.equal(reasoning, 'plan it')
    assert.equal(text, 'Hello')
  } finally {
    await close()
  }
})


test('structured tool_calls deltas accumulate into one real tool-call block', async () => {
  const events = [
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'bash', arguments: '{"command":' } }] } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '"ls"}' } }] }, finish_reason: 'tool_calls' }] },
  ]
  const { server, state, close } = await startServer({ events })
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const chunks = await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'list' }] }],
      tools: [{ name: 'bash', description: 'run', parameters: { type: 'object', properties: {} } }],
    }))
    const end = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    assert.equal(end.block.id, 'call_1')
    assert.equal(end.block.name, 'bash')
    assert.equal(end.block.arguments, '{"command":"ls"}')
    assert.equal(chunks.filter((chunk) => chunk.type === 'text-delta').length, 0)
    assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } })
  } finally {
    await close()
  }
})

test('isTransientStreamError separates a transport cut from a request verdict', () => {
  assert.equal(isTransientStreamError(new TypeError('terminated')), true)
  assert.equal(isTransientStreamError(Object.assign(new Error('x'), { code: 'ECONNRESET' })), true)
  assert.equal(isTransientStreamError(Object.assign(new Error('fetch failed'), { cause: { code: 'UND_ERR_SOCKET' } })), true)
  assert.equal(isTransientStreamError(new Error('HTTP 400 model is unavailable')), false)
  assert.equal(isTransientStreamError(undefined), false)
})

test('repairJson returns valid JSON for a cut argument fragment', () => {
  assert.equal(repairJson('{"command":"ls"}'), '{"command":"ls"}')
  assert.equal(repairJson('{"command":"ls'), '{"command":"ls"}')
  assert.equal(repairJson('{"a":1,"b":[1,2'), '{"a":1,"b":[1,2]}')
  assert.doesNotThrow(() => JSON.parse(repairJson('{"a":1,"b":[1,2')))
  assert.equal(repairJson('not json'), null)
  assert.equal(repairJson(''), null)
})

// --- boundary contract: the wire field decides the type (measured 2026-11-01) ---

test('reasoning_content is reasoning with the two protocol tokens removed', async () => {
  const events = [
    { choices: [{ delta: { reasoning_content: 'plan it</thinking> and more' } }] },
    { choices: [{ delta: { content: 'done' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ]
  const { server, state, close } = await startServer({ events })
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const chunks = await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
    }))
    const starts = chunks.filter((chunk) => chunk.type === 'block-start').map((chunk) => chunk.blockType)
    assert.deepEqual(starts, ['reasoning', 'text'])
    const reasoning = chunks.filter((chunk) => chunk.type === 'reasoning-delta').map((chunk) => chunk.text).join('')
    const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
    assert.equal(reasoning, 'plan it and more')
    assert.equal(text, 'done')
  } finally {
    await close()
  }
})

test('a tool-call marker split across SSE events is promoted and dropped from text', async () => {
  // Boundaries copied from the stored stream of session e9c75e9a (2026-10-31).
  const events = [
    { choices: [{ delta: { content: 'Now I will look.\n\n' } }] },
    { choices: [{ delta: { content: '[tool call bash #' } }] },
    { choices: [{ delta: { content: 'chatcmpl-t' } }] },
    { choices: [{ delta: { content: 'ool-f82' } }] },
    { choices: [{ delta: { content: 'dc4b5b1582ac5' } }] },
    { choices: [{ delta: { content: ']: {"command":"ls -la"}' } }] },
    { choices: [{ delta: {}, finish_reason: 'stop' }] },
  ]
  const { server, state, close } = await startServer({ events })
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const chunks = await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'list' }] }],
      tools: [{ name: 'bash', description: 'run', parameters: { type: 'object', properties: {} } }],
    }))
    const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
    // 0.0.1: the split marker is classified, promoted to the DSH parser channel and
    // dropped from the screen channel - no marker, no id, no payload in the text.
    assert.equal(text, 'Now I will look.\n\n')
    const calls = chunks.filter((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].block.name, 'bash')
    assert.equal(calls[0].block.id, 'chatcmpl-tool-f82dc4b5b1582ac5')
    assert.deepEqual(JSON.parse(calls[0].block.arguments), { command: 'ls -la' })
  } finally {
    await close()
  }
})



test('an echo of a call that also arrived as a wire field is dropped, not executed twice', async () => {
  // Shape measured live on 0.9.0 (2026-11-01T20:23:08Z): the text carries the rendered
  // call, and a structured tool_calls delta carries the same call.
  const events = [
    { choices: [{ delta: { content: 'Look.\n[tool call bash #call_1]: {"command":"ls"}\n' } }] },
    { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'bash', arguments: '{"command":"ls"}' } }] } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ]
  const { server, state, close } = await startServer({ events })
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const chunks = await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'list' }] }],
      tools: [{ name: 'bash', description: 'run', parameters: { type: 'object', properties: {} } }],
    }))
    const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
    assert.equal(text, 'Look.\n\n')
    const calls = chunks.filter((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    assert.equal(calls.length, 1, 'the echo must not become a second call')
    assert.equal(calls[0].block.id, 'call_1')
  } finally {
    await close()
  }
})

test('DSML notation leaked into content reaches the parser and never the screen', async () => {
  const dsml = 'Doing it.\n[tool call bash">\n' +
    '<｜DSML｜ parameter name="command" string="true">ls -la</｜DSML｜ parameter>\n' +
    '</｜DSML｜ invoke>\n</｜DSML｜ calls>'
  const events = [
    { choices: [{ delta: { content: dsml } }] },
    { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
  ]
  const { server, state, close } = await startServer({ events })
  try {
    const adapter = adapterFor(state, { baseUrl: controlURL(state) })
    const chunks = await collect(adapter.stream({
      provider: 'opencode-http-agent',
      model: 'opencode-go/minimax-m3.1-flash',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'list' }] }],
      tools: [{ name: 'bash', description: 'run', parameters: { type: 'object', properties: {} } }],
    }))
    const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
    assert.equal(text, 'Doing it.\n')
    assert.equal(text.includes('｜DSML｜'), false)
    const calls = chunks.filter((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
    assert.equal(calls.length, 1)
    assert.equal(calls[0].block.name, 'bash')
    assert.deepEqual(JSON.parse(calls[0].block.arguments), { command: 'ls -la' })
  } finally {
    await close()
  }
})

