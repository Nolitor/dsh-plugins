/**
 * Unit tests for lib/http.js against a local fake OpenCode v2 HTTP server.
 * No real opencode child, no ~/.dsh access: the server is a node:http stub that
 * speaks the measured surface (OpenAPI paths + SSE event stream).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'

import {
  Config,
  errorText,
  OpencodeHttpAdapter,
  authHeader,
  modelKey,
  modelRefFromRoute,
  newUserText,
  parseBanner,
  probeServer,
  readBanner,
  usageFromTokens,
} from '../lib/http.js'

const json = (res, status, body) => {
  res.writeHead(status, { 'content-type': 'application/json' })
  res.end(body === undefined ? '' : JSON.stringify(body))
}

/** One fake OpenCode server; `script` decides which events one prompt emits. */
async function startServer(script = {}) {
  const state = {
    pending: [],
    sessions: new Map(),
    creates: 0,
    modelSwitches: [],
    prompts: [],
    permissions: [],
    deletes: 0,
    sse: [],
  }
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost')
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => {
      const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString('utf8')) : undefined
      if (url.pathname === '/api/info') {
        return json(res, 200, { version: '2.2.0', pid: 1, hostname: 'test', urls: ['http://127.0.0.1'] })
      }
      if (url.pathname === '/api/model') {
        return json(res, 200, {
          location: { directory: '/tmp' },
          data: script.models ?? [
            { providerID: 'opencode', id: 'beam-free', name: 'Beam Free', limit: { context: 200000, output: 8192 }, variants: [{ id: 'low' }, { id: 'high' }] },
            { providerID: 'opencode-go', id: 'deepseek-v4.1-flash', name: 'DeepSeek', limit: { context: 1000000, output: 65536 } },
          ],
        })
      }
      if (url.pathname === '/api/session' && req.method === 'POST') {
        state.creates += 1
        const id = `ses_${state.creates}`
        state.sessions.set(id, { model: body?.model })
        return json(res, 200, { data: { id, model: body?.model } })
      }
      const modelSwitch = url.pathname.match(/^\/api\/session\/([^/]+)\/model$/)
      if (modelSwitch && req.method === 'POST') {
        state.modelSwitches.push({ sessionID: modelSwitch[1], model: body?.model })
        return json(res, 204)
      }
      const prompt = url.pathname.match(/^\/api\/session\/([^/]+)\/prompt$/)
      if (prompt && req.method === 'POST') {
        const sessionID = prompt[1]
        state.prompts.push({ sessionID, text: body?.text })
        // Emit the scripted SSE sequence asynchronously.
        const events = script.events ?? [
          { type: 'session.inbox.enqueued', data: { sessionID } },
          { type: 'session.execution.started', data: { sessionID } },
          { type: 'session.step.started', data: { sessionID } },
          { type: 'session.reasoning.started', data: { sessionID, ordinal: 0 } },
          { type: 'session.reasoning.delta', data: { sessionID, ordinal: 0, delta: 'Think.' } },
          { type: 'session.reasoning.ended', data: { sessionID, ordinal: 0, text: 'Think.' } },
          { type: 'session.text.started', data: { sessionID, ordinal: 0 } },
          { type: 'session.text.delta', data: { sessionID, ordinal: 0, delta: 'Hello' } },
          { type: 'session.text.delta', data: { sessionID, ordinal: 0, delta: ' HTTP' } },
          { type: 'session.text.ended', data: { sessionID, ordinal: 0, text: 'Hello HTTP' } },
          { type: 'session.step.ended', data: { sessionID, tokens: { input: 11, output: 4, reasoning: 9, cache: { read: 4096, write: 0 } } } },
          { type: 'session.execution.succeeded', data: { sessionID } },
        ]
        const stampedEvents = events.map((event) => ({
          id: `evt_${state.sse.length}`,
          created: Date.now(),
          ...event,
          data: { sessionID, ...(event.data ?? {}) },
        }))
        for (const event of stampedEvents) state.sse.push(event)
        state.pending.push(...stampedEvents)
        const flush = () => {
          if (!state.clients?.size) return setTimeout(flush, 5)
          for (const event of state.pending.splice(0)) {
            const frame = `data: ${JSON.stringify({ ...event, created: Date.now() })}\n\n`
            for (const response of [...state.clients]) {
              try {
                response.write(frame)
              } catch {
                /* closed */
              }
            }
          }
        }
        setTimeout(flush, 5)
        return json(res, 200, { data: { id: 'msg_user', sessionID } })
      }
      const perm = url.pathname.match(/^\/api\/session\/([^/]+)\/permission\/([^/]+)\/reply$/)
      if (perm && req.method === 'POST') {
        state.permissions.push({ sessionID: perm[1], requestID: perm[2], decision: body?.decision })
        return json(res, 204)
      }
      const del = url.pathname.match(/^\/api\/session\/([^/]+)$/)
      if (del && req.method === 'DELETE') {
        state.deletes += 1
        return json(res, 204)
      }
      if (del && req.method === 'GET') {
        const id = del[1]
        if (!state.sessions.has(id)) return json(res, 404, { _tag: 'NotFoundError' })
        return json(res, 200, { data: { id, tokens: { input: 11, output: 4, reasoning: 9, cache: { read: 4096, write: 0 } } } })
      }
      if (url.pathname === '/api/event') {
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' })
        res.write('data: {"id":"evt_connected","type":"server.connected","created":0,"data":{}}\n\n')
        state.clients ??= new Set()
        state.clients.add(res)
        res.on('close', () => state.clients.delete(res))
        for (const event of state.pending.splice(0)) {
          try {
            res.write(`data: ${JSON.stringify({ ...event, created: Date.now() })}\n\n`)
          } catch {
            /* closed */
          }
        }
        return
      }
      return json(res, 404, { _tag: 'NotFoundError', path: url.pathname })
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const address = server.address()
  state.url = `http://127.0.0.1:${address.port}`
  state.close = () =>
    new Promise((resolve) => {
      for (const client of state.clients ?? []) {
        try {
          client.end()
        } catch {
          /* closed */
        }
      }
      server.closeAllConnections?.()
      server.close(() => resolve())
    })
  return state
}

function makeAdapter(state, overrides = {}) {
  const config = new Config({
    baseUrl: state.url,
    password: 'test-password',
    autoDiscoverModels: true,
    localSessionTitles: false,
    timeoutMs: 8000,
    ...overrides,
  })
  return new OpencodeHttpAdapter({}, config)
}

async function collect(iterable) {
  const chunks = []
  for await (const chunk of iterable) chunks.push(chunk)
  return chunks
}

test('parseBanner reads the measured serve banner', () => {
  assert.deepEqual(parseBanner('server listening on http://127.0.0.1:44103\nserver password abc\n'), {
    url: 'http://127.0.0.1:44103',
    password: 'abc',
  })
  assert.equal(parseBanner('server password abc'), null)
})

test('readBanner consumes split chunks from a piped stdout', async () => {
  const handle = {
    stdout: (async function* () {
      yield new TextEncoder().encode('server listening on http://127.0.0.1:9999\n')
      yield new TextEncoder().encode('server password tok\n')
    })(),
  }
  assert.deepEqual(await readBanner(handle, 1000), { url: 'http://127.0.0.1:9999', password: 'tok' })
  assert.equal(await readBanner({}, 100), null)
})

test('modelRefFromRoute maps DSH routes onto OpenCode refs', () => {
  assert.deepEqual(modelRefFromRoute('opencode/beam-free', [], 'opencode/beam-free'), { providerID: 'opencode', id: 'beam-free' })
  assert.deepEqual(modelRefFromRoute('default', [{ id: 'default', opencodeModel: 'opencode-go/deepseek-v4.1-flash' }], 'opencode/beam-free'), {
    providerID: 'opencode-go',
    id: 'deepseek-v4.1-flash',
  })
  assert.deepEqual(modelRefFromRoute('default', [], 'opencode/beam-free'), { providerID: 'opencode', id: 'beam-free' })
  assert.equal(modelRefFromRoute('bare', [], ''), null)
})

test('newUserText returns only the trailing user messages', () => {
  const messages = [
    { role: 'system', content: [{ type: 'text', text: 'sys' }] },
    { role: 'user', content: [{ type: 'text', text: 'old' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'answer' }] },
    { role: 'user', content: [{ type: 'text', text: 'new' }] },
  ]
  assert.equal(newUserText(messages), 'new')
  assert.equal(newUserText([{ role: 'assistant', content: [] }]), '')
})

test('usageFromTokens maps disjoint buckets and sums the total', () => {
  const usage = usageFromTokens({ input: 11, output: 4, reasoning: 9, cache: { read: 4096, write: 8 } })
  assert.equal(usage.totalTokens, 11 + 4 + 9 + 4096 + 8)
  assert.equal(usage.cacheReadTokens, 4096)
  assert.equal(usage.cacheWriteTokens, 8)
})

test('authHeader is basic opencode:<password>', () => {
  assert.equal(authHeader('pw'), 'Basic ' + Buffer.from('opencode:pw').toString('base64'))
})

test('resolveModel publishes contextWindow and reasoning variants from /api/model', async () => {
  const state = await startServer()
  try {
    const adapter = makeAdapter(state)
    const model = await adapter.resolveModel('opencode-http-agent', 'opencode/beam-free')
    assert.equal(model.context.contextWindow, 200000)
    assert.equal(model.defaultMaxTokens, 8192)
    assert.deepEqual(model.reasoning.efforts.map((effort) => effort.id), ['low', 'high'])
    const plain = await adapter.resolveModel('opencode-http-agent', 'opencode-go/deepseek-v4.1-flash')
    assert.equal(plain.context.contextWindow, 1000000)
    assert.equal(plain.reasoning, undefined)
  } finally {
    await state.close()
  }
})

test('stream maps SSE deltas, usage, and stop; creates one session', async () => {
  const state = await startServer()
  try {
    const adapter = makeAdapter(state)
    const chunks = await collect(
      adapter.stream({
        provider: 'opencode-http-agent',
        model: 'opencode/beam-free',
        sessionId: 'dsh-session-1',
        messages: [
          { role: 'system', content: [{ type: 'text', text: 'sys' }] },
          { role: 'user', content: [{ type: 'text', text: 'hi' }] },
        ],
      }),
    )
    const types = chunks.map((chunk) => chunk.type)
    assert.equal(state.creates, 1)
    assert.deepEqual(types, ['block-start', 'reasoning-delta', 'block-end', 'block-start', 'text-delta', 'text-delta', 'block-end', 'usage', 'finish'])
    const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
    assert.equal(text, 'Hello HTTP')
    const usage = chunks.find((chunk) => chunk.type === 'usage').usage
    assert.equal(usage.cacheReadTokens, 4096)
    assert.equal(usage.inputTokens, 11)
    assert.deepEqual(chunks.at(-1).reason, { kind: 'stop' })
    // First call carries the flattened transcript, not just the last message.
    assert.match(state.prompts[0].text, /<transcript>/)
    assert.match(state.prompts[0].text, /hi/)
  } finally {
    await state.close()
  }
})

test('a second call reuses the session and sends only the new user text', async () => {
  const state = await startServer()
  try {
    const adapter = makeAdapter(state)
    const first = [
      { role: 'system', content: [{ type: 'text', text: 'sys' }] },
      { role: 'user', content: [{ type: 'text', text: 'one' }] },
    ]
    await collect(adapter.stream({ provider: 'opencode-http-agent', model: 'opencode/beam-free', sessionId: 'dsh-2', messages: first }))
    const history = [
      ...first,
      { role: 'assistant', content: [{ type: 'text', text: 'reply' }] },
      { role: 'user', content: [{ type: 'text', text: 'two' }] },
    ]
    state.sse = []
    await collect(adapter.stream({ provider: 'opencode-http-agent', model: 'opencode/beam-free', sessionId: 'dsh-2', messages: history }))
    assert.equal(state.creates, 1)
    assert.equal(state.prompts.length, 2)
    assert.equal(state.prompts[1].text, 'two')
  } finally {
    await state.close()
  }
})

test('a reasoning effort becomes the session model variant', async () => {
  const state = await startServer()
  try {
    const adapter = makeAdapter(state)
    await collect(
      adapter.stream({
        provider: 'opencode-http-agent',
        model: 'opencode/beam-free',
        sessionId: 'dsh-3',
        reasoningEffort: 'high',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    // Created with the variant; the SSE reasoning block still streams.
    assert.equal(state.sessions.get('ses_1').model.variant, 'high')
    assert.equal(modelKey({ providerID: 'opencode', id: 'beam-free' }, 'high'), 'opencode/beam-free#high')
  } finally {
    await state.close()
  }
})

test('permission.asked is answered with the configured decision', async () => {
  const state = await startServer({
    events: [
      { type: 'session.execution.started', data: {} },
      { type: 'permission.asked', data: { id: 'per_1', action: 'shell', resources: ['echo hi'] } },
      { type: 'session.text.started', data: { ordinal: 0 } },
      { type: 'session.text.delta', data: { ordinal: 0, delta: 'ok' } },
      { type: 'session.text.ended', data: { ordinal: 0, text: 'ok' } },
      { type: 'session.execution.succeeded', data: {} },
    ],
  })
  try {
    const adapter = makeAdapter(state, { permissionDecision: 'once' })
    const chunks = await collect(
      adapter.stream({
        provider: 'opencode-http-agent',
        model: 'opencode/beam-free',
        sessionId: 'dsh-4',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'run it' }] }],
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 20))
    assert.deepEqual(state.permissions, [{ sessionID: 'ses_1', requestID: 'per_1', decision: 'once' }])
    assert.deepEqual(chunks.at(-1).reason, { kind: 'stop' })
  } finally {
    await state.close()
  }
})

test('a failed execution becomes an error finish', async () => {
  const state = await startServer({
    events: [
      { type: 'session.execution.started', data: {} },
      { type: 'session.execution.failed', data: { error: 'Insufficient account funds' } },
    ],
  })
  try {
    const adapter = makeAdapter(state)
    const chunks = await collect(
      adapter.stream({
        provider: 'opencode-http-agent',
        model: 'opencode/beam-free',
        sessionId: 'dsh-5',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    const finish = chunks.at(-1)
    assert.equal(finish.type, 'finish')
    assert.equal(finish.reason.kind, 'error')
    assert.equal(finish.reason.failure.code, 'OPENCODE_HTTP_FAILED')
    assert.match(finish.reason.failure.message, /Insufficient account funds/)
  } finally {
    await state.close()
  }
})

test('events for another session are ignored', async () => {
  const state = await startServer({
    events: [
      { type: 'session.execution.started', data: {} },
      { type: 'session.text.started', data: { sessionID: 'ses_other', ordinal: 0 } },
      { type: 'session.text.delta', data: { sessionID: 'ses_other', ordinal: 0, delta: 'WRONG' } },
      { type: 'session.text.ended', data: { sessionID: 'ses_other', ordinal: 0, text: 'WRONG' } },
      { type: 'session.text.started', data: { ordinal: 0 } },
      { type: 'session.text.delta', data: { ordinal: 0, delta: 'RIGHT' } },
      { type: 'session.text.ended', data: { ordinal: 0, text: 'RIGHT' } },
      { type: 'session.execution.succeeded', data: {} },
    ],
  })
  try {
    const adapter = makeAdapter(state)
    const chunks = await collect(
      adapter.stream({
        provider: 'opencode-http-agent',
        model: 'opencode/beam-free',
        sessionId: 'dsh-6',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
      }),
    )
    const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
    assert.equal(text, 'RIGHT')
  } finally {
    await state.close()
  }
})

test('an ephemeral (no sessionId) call deletes its session', async () => {
  const state = await startServer()
  try {
    const adapter = makeAdapter(state)
    await collect(
      adapter.stream({
        provider: 'opencode-http-agent',
        model: 'opencode/beam-free',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'once' }] }],
      }),
    )
    await new Promise((resolve) => setTimeout(resolve, 30))
    assert.equal(state.deletes, 1)
  } finally {
    await state.close()
  }
})

test('local session titles answer without any HTTP call', async () => {
  const state = await startServer()
  try {
    const adapter = makeAdapter(state, { localSessionTitles: true })
    const chunks = await collect(
      adapter.stream({
        provider: 'opencode-http-agent',
        model: 'opencode/beam-free',
        purpose: 'session-title',
        messages: [{ role: 'user', content: [{ type: 'text', text: 'Fix the sidebar bug' }] }],
      }),
    )
    assert.equal(chunks.at(-1).reason.kind, 'stop')
    assert.equal(state.creates, 0)
  } finally {
    await state.close()
  }
})

// ---------------------------------------------------------------------------
// Server discovery: an unreachable server must be visible, not silently empty
// ---------------------------------------------------------------------------

test('probeServer reports the serving version and null for a dead port', async () => {
  const state = await startServer()
  try {
    const info = await probeServer(state.url, 'test-password')
    assert.equal(info.version, '2.2.0')
  } finally {
    await state.close()
  }
  const dead = await probeServer('http://127.0.0.1:1', 'x', 500)
  assert.equal(dead, null)
})

test('the advertised model list names the serving OpenCode build', async () => {
  const state = await startServer()
  try {
    const adapter = makeAdapter(state)
    const models = await adapter.listModels('opencode-http-agent')
    assert.match(models[0].description, /2\.2\.0/)
    assert.match(models[0].description, /HTTP API/)
  } finally {
    await state.close()
  }
})

test('an unreachable server is reported instead of an empty model list', async () => {
  const state = await startServer()
  const deadUrl = state.url
  await state.close()
  const adapter = makeAdapter({ url: deadUrl }, { fallbackToCli: false })
  await assert.rejects(
    () => adapter.listModels('opencode-http-agent'),
    /OpenCode model catalog unavailable/,
  )
})

test('a missing daemon state file names the reason in the failure', async () => {
  const config = new Config({
    baseUrl: '',
    attachToDaemon: true,
    spawnServer: false,
    serviceStatePath: '/nonexistent/opencode-service.json',
    autoDiscoverModels: true,
    fallbackToCli: false,
    localSessionTitles: false,
    timeoutMs: 8000,
  })
  const adapter = new OpencodeHttpAdapter({}, config)
  await assert.rejects(
    () => adapter.listModels('opencode-http-agent'),
    /daemon state unreadable/,
  )
})

test('the provider name states the transport', () => {
  const adapter = makeAdapter({ url: 'http://127.0.0.1:1' })
  assert.equal(adapter.providerInfo('opencode-http-agent').name, 'OpenCode (HTTP)')
})


test('errorText renders structured execution errors instead of [object Object]', () => {
  assert.equal(errorText('plain'), 'plain')
  assert.equal(errorText({ message: 'Insufficient account funds' }), 'Insufficient account funds')
  assert.equal(errorText({ error: { message: 'quota exceeded' } }), 'quota exceeded')
  assert.match(errorText({ type: 'provider.quota', status: 402 }), /provider\.quota/)
  assert.equal(errorText(undefined), 'opencode execution failed')
})


test('HTTP transport failure falls back to the CLI adapter', async () => {
  const config = new Config({ baseUrl: 'http://127.0.0.1:1', password: 'x', fallbackToCli: true, localSessionTitles: false, timeoutMs: 5000 })
  const adapter = new OpencodeHttpAdapter({}, config)
  const seen = []
  adapter.cli = () => ({
    async *stream(options) {
      seen.push(options.model)
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text: 'from-cli' }
      yield { type: 'block-end', index: 0, block: { type: 'text', text: 'from-cli' } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    },
  })
  const chunks = await collect(adapter.stream({ provider: 'opencode-http-agent', model: 'opencode/beam-free', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }))
  assert.deepEqual(seen, ['opencode/beam-free'])
  assert.equal(chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join(''), 'from-cli')
  assert.deepEqual(chunks.at(-1).reason, { kind: 'stop' })
})

test('fallbackToCli=false reports the HTTP transport error instead', async () => {
  const config = new Config({ baseUrl: 'http://127.0.0.1:1', password: 'x', fallbackToCli: false, localSessionTitles: false, timeoutMs: 5000 })
  const adapter = new OpencodeHttpAdapter({}, config)
  let cliCalls = 0
  adapter.cli = () => { cliCalls += 1; return { stream: async function* () {} } }
  const chunks = await collect(adapter.stream({ provider: 'opencode-http-agent', model: 'opencode/beam-free', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }))
  assert.equal(cliCalls, 0)
  assert.equal(chunks.at(-1).reason.failure.code, 'OPENCODE_HTTP')
})

test('a model-level execution failure does not fall back to the CLI', async () => {
  const state = await startServer({
    events: [
      { type: 'session.execution.started', data: {} },
      { type: 'session.execution.failed', data: { error: { type: 'provider.quota', message: 'Insufficient account funds', status: 402 } } },
    ],
  })
  try {
    const adapter = makeAdapter(state)
    let cliCalls = 0
    adapter.cli = () => { cliCalls += 1; return { stream: async function* () {} } }
    const chunks = await collect(adapter.stream({ provider: 'opencode-http-agent', model: 'opencode/beam-free', sessionId: 'dsh-fb', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }))
    assert.equal(cliCalls, 0)
    assert.equal(chunks.at(-1).reason.failure.code, 'OPENCODE_HTTP_FAILED')
    assert.match(chunks.at(-1).reason.failure.message, /Insufficient account funds/)
  } finally {
    await state.close()
  }
})
