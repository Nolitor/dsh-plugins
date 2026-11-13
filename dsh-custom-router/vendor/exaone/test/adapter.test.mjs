/**
 * EXAONE adapter contract: request shape, SSE translation, usage and failures.
 *
 * The wire facts are pinned from docs.exaone.ai (read 2026-11-13): OpenAI
 * chat-completions, `reasoning_content` deltas, top-level `reasoning_tokens`,
 * `reasoning_effort` low|high|max and `chat_template_kwargs.preserve_thinking`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { EXAONEAdapter } from '../lib/adapter.js'

/** One SSE body built from JSON frames. */
function sse(frames) {
  return frames.map((frame) => `data: ${JSON.stringify(frame)}\n\n`).join('')
}

/** An adapter over a scripted fetch that records the request. */
function adapterWith(options = {}) {
  const calls = []
  const adapter = new EXAONEAdapter({
    settings: () => ({
      baseUrl: options.baseUrl ?? 'https://api.exaone.ai/v1',
      apiKey: options.apiKey ?? 'secret-key',
      maxTokens: options.maxTokens ?? 4096,
      defaultEffort: 'max',
      enabledModels: options.enabledModels ?? [],
    }),
    fetchImpl: async (url, init) => {
      calls.push({ url, init })
      if (options.throwOnFetch) throw options.throwOnFetch
      if (options.response !== undefined) return options.response
      return new Response(options.body ?? '', { status: 200, headers: { 'content-type': 'text/event-stream' } })
    },
  })
  return { adapter, calls }
}

/** Collect one stream's chunks. */
async function collect(adapter, options = {}) {
  const chunks = []
  for await (const chunk of adapter.stream({
    model: 'k-exaone_v2.5',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    signal: new AbortController().signal,
    ...options,
  })) chunks.push(chunk)
  return chunks
}

test('one request targets /v1/chat/completions with the bearer key and the declared model', async () => {
  const { adapter, calls } = adapterWith({ body: sse([{ choices: [{ delta: { content: 'ok' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]) })
  await collect(adapter)
  assert.equal(calls.length, 1)
  assert.equal(calls[0].url, 'https://api.exaone.ai/v1/chat/completions')
  assert.equal(calls[0].init.headers.authorization, 'Bearer secret-key')
  const body = JSON.parse(calls[0].init.body)
  assert.equal(body.model, 'k-exaone_v2.5')
  assert.equal(body.stream, true)
  assert.deepEqual(body.stream_options, { include_usage: true })
  assert.equal(body.max_tokens, 4096)
  assert.deepEqual(body.chat_template_kwargs, { preserve_thinking: true })
})

test('a trailing slash on the configured base URL does not double the path', async () => {
  const { adapter, calls } = adapterWith({ baseUrl: 'https://gateway.example/v1/', body: sse([{ choices: [{ delta: { content: 'ok' } }] }]) })
  await collect(adapter)
  assert.equal(calls[0].url, 'https://gateway.example/v1/chat/completions')
})

test('reasoning and text deltas become separate blocks; top-level reasoning tokens are kept', async () => {
  const { adapter } = adapterWith({
    body: sse([
      { choices: [{ delta: { reasoning_content: 'think ' } }] },
      { choices: [{ delta: { content: 'answer' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 3, total_tokens: 8, reasoning_tokens: 2 } },
    ]),
  })
  const chunks = await collect(adapter)
  const reasoning = chunks.filter((chunk) => chunk.type === 'reasoning-delta').map((chunk) => chunk.text).join('')
  const text = chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text).join('')
  assert.equal(reasoning, 'think ')
  assert.equal(text, 'answer')
  const usage = chunks.find((chunk) => chunk.type === 'usage')
  assert.deepEqual(usage.usage, { inputTokens: 5, outputTokens: 3, reasoningTokens: 2, totalTokens: 8 })
  const finish = chunks.find((chunk) => chunk.type === 'finish')
  assert.equal(finish.reason.kind, 'stop')
})

test('a fragmented tool call is reassembled into one call with its arguments', async () => {
  const { adapter } = adapterWith({
    body: sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'lookup', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"q":"x"}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]),
  })
  const chunks = await collect(adapter)
  const end = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block?.type === 'tool-call')
  assert.ok(end, 'a tool-call block must close')
  assert.equal(end.block.name, 'lookup')
  assert.equal(end.block.arguments, '{"q":"x"}')
  assert.equal(end.block.id, 'call_1')
})

test('reasoning effort is folded onto low|high|max and preserve_thinking is always on', async () => {
  for (const [requested, wired] of [['medium', 'high'], ['xhigh', 'max'], ['low', 'low']]) {
    const { adapter, calls } = adapterWith({ body: sse([{ choices: [{ delta: { content: 'ok' } }] }]) })
    await collect(adapter, { reasoningEffort: requested })
    assert.equal(JSON.parse(calls[0].init.body).reasoning_effort, wired, `${requested} must map to ${wired}`)
  }
})

test('a missing key fails before any request is made', async () => {
  const { adapter, calls } = adapterWith({ apiKey: '' })
  await assert.rejects(() => collect(adapter), (error) => error.code === 'INVALID_CREDENTIAL')
  assert.equal(calls.length, 0)
})

test('HTTP 401 is INVALID_CREDENTIAL, 429 is RATE_LIMIT, 404 is UNKNOWN_MODEL', async () => {
  for (const [status, code] of [[401, 'INVALID_CREDENTIAL'], [429, 'RATE_LIMIT'], [404, 'UNKNOWN_MODEL']]) {
    const { adapter } = adapterWith({
      response: new Response(JSON.stringify({ error: { message: 'nope', code: 'x' } }), { status }),
    })
    await assert.rejects(() => collect(adapter), (error) => error.code === code, `HTTP ${status}`)
  }
})

test('a platform-shaped error body is surfaced verbatim', async () => {
  const { adapter } = adapterWith({
    response: new Response(JSON.stringify({ result_code: 500, description: 'temporary issue' }), { status: 500 }),
  })
  await assert.rejects(() => collect(adapter), (error) => /temporary issue/.test(error.message))
})

test('listModels and resolveModel advertise the documented capacity and efforts', async () => {
  const { adapter } = adapterWith()
  assert.deepEqual(await adapter.listModels('exaone'), [{ provider: 'exaone', id: 'k-exaone_v2.5', name: 'K-EXAONE 2.5' }])
  const resolved = await adapter.resolveModel('exaone', 'k-exaone_v2.5', new AbortController().signal)
  assert.equal(resolved.context.contextWindow, 524288)
  assert.equal(resolved.defaultMaxTokens, 4096)
  assert.deepEqual(resolved.reasoning.efforts.map((effort) => effort.id), ['low', 'high', 'max'])
  assert.equal(resolved.reasoning.defaultEffort, 'max')
})
