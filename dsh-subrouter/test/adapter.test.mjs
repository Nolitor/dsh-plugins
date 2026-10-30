import test from 'node:test'
import assert from 'node:assert/strict'

import {
  OpenAIChatAdapter,
  mapUsage,
  parseSSE,
  resolveConfig,
  toOpenAIMessages,
} from '../lib/adapter.js'
import { apply } from '../lib/index.js'

test('resolveConfig validates and normalizes provider settings', () => {
  const config = resolveConfig({
    provider: 'ours',
    baseURL: 'http://127.0.0.1:9000/v1///',
    models: [{ id: 'm1', name: 'M1', contextWindow: 32768, maxTokens: 4096 }],
    headers: { 'x-test': 'yes' },
  })
  assert.equal(config.provider, 'ours')
  assert.equal(config.baseURL, 'http://127.0.0.1:9000/v1')
  assert.deepEqual(config.models, [{ id: 'm1', name: 'M1', contextWindow: 32768, maxTokens: 4096 }])
  assert.deepEqual(config.headers, { 'x-test': 'yes' })
  assert.throws(() => resolveConfig({ typo: true }), /unknown setting typo/)
})

test('toOpenAIMessages keeps tool calls and tool results structured', () => {
  const messages = toOpenAIMessages({
    system: 'sys',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'read it' }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'thinking' },
          { type: 'text', text: 'calling read' },
          { type: 'tool-call', id: 'call_1', name: 'read', arguments: '{"path":"a"}' },
        ],
      },
      {
        role: 'tool',
        toolCallId: 'call_1',
        content: [{ type: 'text', text: 'file body' }],
      },
    ],
  })
  assert.deepEqual(messages[0], { role: 'system', content: 'sys' })
  assert.deepEqual(messages[1], { role: 'user', content: 'read it' })
  assert.equal(messages[2].reasoning_content, 'thinking')
  assert.equal(messages[2].tool_calls[0].id, 'call_1')
  assert.equal(messages[2].tool_calls[0].function.name, 'read')
  assert.deepEqual(messages[3], { role: 'tool', tool_call_id: 'call_1', content: 'file body' })
})

test('mapUsage separates cached prompt tokens', () => {
  assert.deepEqual(
    mapUsage({
      prompt_tokens: 100,
      completion_tokens: 20,
      total_tokens: 120,
      prompt_tokens_details: { cached_tokens: 30 },
    }),
    { inputTokens: 70, outputTokens: 20, totalTokens: 120, cacheReadTokens: 30 },
  )
})

test('parseSSE yields multiline and final data records', async () => {
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: one\n\ndata: two\n'))
      controller.close()
    },
  })
  const out = []
  for await (const item of parseSSE(body)) out.push(item)
  assert.deepEqual(out, ['one', 'two'])
})

test('adapter streams text, tool call, usage, and terminal chunks', async () => {
  const sse = [
    'data: {"choices":[{"index":0,"delta":{"reasoning_content":"plan"}}]}',
    '',
    'data: {"choices":[{"index":0,"delta":{"content":"checking"}}]}',
    '',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"id":"call_x","type":"function","function":{"name":"read","arguments":"{\\"file_path\\":\\""}}]}}]}',
    '',
    'data: {"choices":[{"index":0,"delta":{"tool_calls":[{"index":0,"function":{"arguments":"a.txt\\"}"}}]}}]}',
    '',
    'data: {"choices":[{"index":0,"finish_reason":"tool_calls","delta":{}}],"usage":{"prompt_tokens":12,"completion_tokens":7,"total_tokens":19,"prompt_tokens_details":{"cached_tokens":2}}}',
    '',
    'data: [DONE]',
    '',
  ].join('\n')
  let captured
  const fetchImpl = async (url, init) => {
    captured = { url, init }
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  const config = resolveConfig({
    provider: 'ours',
    baseURL: 'http://router.local/v1',
    apiKey: 'test-key',
    models: [{ id: 'm1', name: 'M1' }],
  })
  const adapter = new OpenAIChatAdapter({}, config, { fetchImpl })
  const chunks = []
  for await (const chunk of adapter.stream({
    provider: 'ours',
    model: 'm1',
    sessionId: 'session-1',
    maxTokens: 4096,
    tools: [{ name: 'read', description: 'read', parameters: { type: 'object' } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
  })) {
    chunks.push(chunk)
  }

  assert.equal(captured.url, 'http://router.local/v1/chat/completions')
  assert.equal(captured.init.headers.authorization, 'Bearer test-key')
  assert.equal(captured.init.headers['x-opencode-session'], 'session-1')
  assert.equal(captured.init.headers.authorization, 'Bearer test-key')
  const body = JSON.parse(captured.init.body)
  assert.equal(body.tools[0].function.name, 'read')
  assert.equal(body.stream_options.include_usage, true)

  const types = chunks.map((chunk) => chunk.type)
  assert.ok(types.includes('reasoning-delta'))
  assert.ok(types.includes('text-delta'))
  assert.ok(types.includes('tool-call-delta'))
  assert.ok(types.includes('usage'))
  const toolStart = chunks.find((chunk) => chunk.type === 'block-start' && chunk.blockType === 'tool-call')
  const toolEnd = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
  assert.equal(toolStart.index, toolEnd.index)
  assert.deepEqual(toolEnd.block, {
    type: 'tool-call',
    id: 'call_x',
    name: 'read',
    arguments: '{"file_path":"a.txt"}',
  })
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } })
})

test('applying the plugin registers one route and unload releases it', () => {
  const calls = []
  let effectDisposer
  const ctx = {
    llm: {
      registerAdapter(providers, adapter) {
        calls.push(['register', providers, adapter.providerInfo(providers[0]).name])
        return () => calls.push(['unregister', providers])
      },
    },
    effect(fn) {
      effectDisposer = fn
      return () => {}
    },
    emit() {},
    logger: { info() {}, warn() {} },
  }
  const dispose = apply(ctx, {
    provider: 'ours',
    baseURL: 'http://router.local/v1',
    apiKey: 'test',
    models: [{ id: 'm1', name: 'M1' }],
  })
  assert.deepEqual(calls[0], ['register', ['ours'], 'Subrouter (OpenAI-compatible)'])
  effectDisposer()
  dispose()
  assert.deepEqual(calls, [
    ['register', ['ours'], 'Subrouter (OpenAI-compatible)'],
    ['unregister', ['ours']],
  ])
})

test('a dispatch without a session id sends the configured fallback identity', async () => {
  let captured
  const fetchImpl = async (_url, init) => {
    captured = init
    return new Response('data: [DONE]\n', { status: 200 })
  }
  const config = resolveConfig({
    provider: 'ours',
    baseURL: 'http://router.local/v1',
    apiKey: 'test-key',
    sessionFallback: 'dsh-subrouter',
    models: [{ id: 'm1' }],
  })
  const adapter = new OpenAIChatAdapter({}, config, { fetchImpl })
  for await (const _chunk of adapter.stream({
    provider: 'ours',
    model: 'm1',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
  })) {
    /* drain */
  }
  assert.equal(captured.headers['x-opencode-session'], 'dsh-subrouter')
})
