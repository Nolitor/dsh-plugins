import test from 'node:test'
import assert from 'node:assert/strict'

import {
  AnthropicMessagesAdapter,
  mapAnthropicUsage,
  toAnthropicMessages,
} from '../lib/anthropic.js'
import { apply } from '../lib/index.js'
import { resolveConfig, routeConfigs } from '../lib/adapter.js'

test('toAnthropicMessages merges tool results into a user content array', () => {
  const converted = toAnthropicMessages({
    system: 'be useful',
    messages: [
      { role: 'user', content: [{ type: 'text', text: 'read a' }] },
      {
        role: 'assistant',
        content: [
          { type: 'reasoning', text: 'hidden' },
          { type: 'text', text: 'reading' },
          { type: 'tool-call', id: 'toolu_1', name: 'read', arguments: '{"file_path":"a"}' },
        ],
      },
      { role: 'tool', toolCallId: 'toolu_1', content: [{ type: 'text', text: 'body' }] },
      { role: 'tool', toolCallId: 'toolu_2', content: [{ type: 'text', text: 'body2' }] },
    ],
  })
  assert.equal(converted.system, 'be useful')
  assert.deepEqual(converted.messages[0], { role: 'user', content: [{ type: 'text', text: 'read a' }] })
  assert.deepEqual(converted.messages[1], {
    role: 'assistant',
    content: [
      { type: 'text', text: 'reading' },
      { type: 'tool_use', id: 'toolu_1', name: 'read', input: { file_path: 'a' } },
    ],
  })
  assert.deepEqual(converted.messages[2], {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'toolu_1', content: 'body' },
      { type: 'tool_result', tool_use_id: 'toolu_2', content: 'body2' },
    ],
  })
})

test('mapAnthropicUsage exposes cache read and creation counters', () => {
  assert.deepEqual(
    mapAnthropicUsage({
      input_tokens: 20,
      output_tokens: 5,
      cache_read_input_tokens: 7,
      cache_creation_input_tokens: 3,
    }),
    {
      inputTokens: 20,
      outputTokens: 5,
      totalTokens: 35,
      cacheReadTokens: 7,
      cacheWriteTokens: 3,
    },
  )
})

test('Anthropic adapter streams text, tool_use, usage, and terminal chunks', async () => {
  const events = [
    {
      type: 'message_start',
      message: { usage: { input_tokens: 12, output_tokens: 0, cache_read_input_tokens: 2 } },
    },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'checking' } },
    { type: 'content_block_stop', index: 0 },
    {
      type: 'content_block_start',
      index: 1,
      content_block: { type: 'tool_use', id: 'toolu_x', name: 'read', input: {} },
    },
    {
      type: 'content_block_delta',
      index: 1,
      delta: { type: 'input_json_delta', partial_json: '{"file_path":' },
    },
    { type: 'content_block_delta', index: 1, delta: { type: 'input_json_delta', partial_json: '"a.txt"}' } },
    { type: 'content_block_stop', index: 1 },
    { type: 'message_delta', delta: { stop_reason: 'tool_use' }, usage: { output_tokens: 7 } },
    { type: 'message_stop' },
  ]
  const sse = events.map((event) => `data: ${JSON.stringify(event)}\n`).join('\n') + '\n'
  let captured
  const fetchImpl = async (url, init) => {
    captured = { url, init }
    return new Response(sse, { status: 200, headers: { 'content-type': 'text/event-stream' } })
  }
  const config = resolveConfig({
    provider: 'ours-anthropic',
    protocol: 'anthropic-messages',
    baseURL: 'http://router.local/v1',
    apiKey: 'test-key',
    models: [{ id: 'claude-test', name: 'Claude Test', maxTokens: 4096 }],
  })
  const adapter = new AnthropicMessagesAdapter({}, config, { fetchImpl })
  const chunks = []
  for await (const chunk of adapter.stream({
    provider: 'ours-anthropic',
    model: 'claude-test',
    sessionId: 'session-a',
    tools: [{ name: 'read', description: 'Read', parameters: { type: 'object', properties: {} } }],
    messages: [{ role: 'user', content: [{ type: 'text', text: 'go' }] }],
  })) {
    chunks.push(chunk)
  }

  assert.equal(captured.url, 'http://router.local/v1/messages')
  assert.equal(captured.init.headers['x-api-key'], 'test-key')
  assert.equal(captured.init.headers['anthropic-version'], '2023-06-01')
  assert.equal(captured.init.headers['x-opencode-session'], 'session-a')
  const body = JSON.parse(captured.init.body)
  assert.equal(body.max_tokens, 4096)
  assert.equal(body.tools[0].input_schema.type, 'object')

  const types = chunks.map((chunk) => chunk.type)
  assert.ok(types.includes('text-delta'))
  assert.ok(types.includes('tool-call-delta'))
  assert.ok(types.includes('usage'))
  const toolEnd = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
  assert.deepEqual(toolEnd.block, {
    type: 'tool-call',
    id: 'toolu_x',
    name: 'read',
    arguments: '{"file_path":"a.txt"}',
  })
  assert.deepEqual(chunks.at(-1), { type: 'finish', reason: { kind: 'tool-calls' } })
  assert.deepEqual(chunks.find((chunk) => chunk.type === 'usage'), {
    type: 'usage',
    usage: {
      inputTokens: 12,
      outputTokens: 7,
      totalTokens: 21,
      cacheReadTokens: 2,
    },
  })
})

test('one plugin instance registers every umbrella route and disposes all of them', () => {
  const calls = []
  let effectDisposer
  const ctx = {
    llm: {
      registerAdapter(providers) {
        calls.push(['register', providers[0]])
        return () => calls.push(['unregister', providers[0]])
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
    apiKey: 'test',
    routes: [
      { provider: 'ours-openai', baseURL: 'http://router/v1', models: [{ id: 'm1' }] },
      {
        provider: 'ours-anthropic',
        protocol: 'anthropic-messages',
        baseURL: 'http://router/v1',
        models: [{ id: 'm2' }],
      },
    ],
  })
  assert.deepEqual(calls, [
    ['register', 'ours-openai'],
    ['register', 'ours-anthropic'],
  ])
  effectDisposer()
  dispose()
  assert.deepEqual(calls, [
    ['register', 'ours-openai'],
    ['register', 'ours-anthropic'],
    ['unregister', 'ours-anthropic'],
    ['unregister', 'ours-openai'],
  ])
})

test('routeConfigs rejects duplicate provider ids', () => {
  assert.throws(
    () => routeConfigs(resolveConfig({
      routes: [
        { provider: 'same', baseURL: 'http://a', models: [{ id: 'm1' }] },
        { provider: 'same', baseURL: 'http://b', models: [{ id: 'm2' }] },
      ],
    })),
    /duplicate route provider same/,
  )
})
