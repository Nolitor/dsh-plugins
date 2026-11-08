import assert from 'node:assert/strict'
import test from 'node:test'

import { MAX_STOP_SEQUENCES, requestBody, serializeMessages, serializeTools } from '../lib/wire.js'

test('every harness role maps explicitly; an unknown role throws', () => {
  // Failure ledger F-33: a role that falls through to "user" silently sends the
  // system prompt as a user turn.
  const messages = serializeMessages([
    { role: 'system', content: [{ type: 'text', text: 'be terse' }] },
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'hello' }] },
    { role: 'tool', toolCallId: 'call_1', content: [{ type: 'text', text: '{"ok":true}' }] },
  ])
  assert.deepEqual(messages, [
    { role: 'system', content: 'be terse' },
    { role: 'user', content: 'hi' },
    { role: 'assistant', content: 'hello' },
    { role: 'tool', tool_call_id: 'call_1', content: '{"ok":true}' },
  ])
  assert.throws(() => serializeMessages([{ role: 'narrator', content: [] }]), /unsupported message role/)
})

test('the leading system message is preserved in position', () => {
  const messages = serializeMessages([
    { role: 'system', content: [{ type: 'text', text: 'S' }] },
    { role: 'user', content: [{ type: 'text', text: 'U' }] },
  ])
  assert.deepEqual(messages.map((m) => m.role), ['system', 'user'])
})

test('developer messages contribute no wire message', () => {
  const messages = serializeMessages([
    { role: 'developer', content: [{ type: 'tool-addition', toolName: 'x' }] },
    { role: 'user', content: [{ type: 'text', text: 'hi' }] },
  ])
  assert.deepEqual(messages.map((m) => m.role), ['user'])
})

test('assistant tool calls travel as structured wire calls', () => {
  const messages = serializeMessages([
    {
      role: 'assistant',
      content: [
        { type: 'text', text: 'checking' },
        { type: 'tool-call', id: 'call_1', name: 'get_weather', arguments: '{"city":"Seoul"}' },
      ],
    },
  ])
  assert.deepEqual(messages[0], {
    role: 'assistant',
    content: 'checking',
    tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'get_weather', arguments: '{"city":"Seoul"}' } }],
  })
})

test('assistant reasoning is never replayed to the model', () => {
  // Failure ledger F-35: showing the model the notation makes it keep writing it.
  const messages = serializeMessages([
    { role: 'assistant', content: [{ type: 'reasoning', text: 'secret thinking' }, { type: 'text', text: 'answer' }] },
  ])
  assert.equal(messages[0].content, 'answer')
  assert.equal(JSON.stringify(messages).includes('secret thinking'), false)
})

test('an assistant message with only reasoning is dropped, not sent empty', () => {
  assert.deepEqual(serializeMessages([{ role: 'assistant', content: [{ type: 'reasoning', text: 'x' }] }]), [])
})

test('tool schemas map onto function declarations', () => {
  const tools = serializeTools([
    { name: 'get_weather', description: 'weather', parameters: { type: 'object', properties: { city: { type: 'string' } } } },
  ])
  assert.deepEqual(tools, [
    {
      type: 'function',
      function: {
        name: 'get_weather',
        description: 'weather',
        parameters: { type: 'object', properties: { city: { type: 'string' } } },
      },
    },
  ])
  assert.equal(serializeTools([]), undefined)
  assert.equal(serializeTools(undefined), undefined)
})

test('a tool with no description still gets a non-empty one', () => {
  // Measured 2026-11-05: Anthropic rejects the whole request with HTTP 500 and
  // "tools.0.custom.description: Input should be a valid string" when the field is
  // empty. DeepSeek/Google/Qwen tolerate it, so a missing description silently
  // removed Claude from the adapter. The name is the only truthful fallback.
  const out = serializeTools([
    { name: 'read', description: '', parameters: { type: 'object' } },
    { name: 'bash', description: 'run a command', parameters: { type: 'object' } },
  ])
  for (const tool of out) {
    assert.equal(typeof tool.function.description, 'string')
    assert.ok(tool.function.description.length > 0, 'description must be non-empty')
  }
  assert.equal(out[1].function.description, 'run a command')
})

test('a negative temperature is refused before any request', () => {
  // Measured 2026-11-05: DeepInfra answers a negative temperature with HTTP 422
  // "Input should be greater than or equal to 0".
  assert.throws(
    () => requestBody({ model: 'm', messages: [], temperature: -1 }),
    (error) => error.code === 'UNSUPPORTED_OPTION',
  )
  assert.equal(requestBody({ model: 'm', messages: [], temperature: 0 }).temperature, 0)
})

test('maxTokens 0 is omitted, not sent as an invalid zero', () => {
  // Measured: DeepInfra answers max_tokens:0 with HTTP 422 "Input should be
  // greater than 0"; omitting the field is the harness's "no explicit budget".
  assert.equal(requestBody({ model: 'm', messages: [] }, { maxTokens: 0 }).max_tokens, undefined)
})

test('the request body always streams with usage included', () => {
  const body = requestBody({ model: 'm', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })
  assert.equal(body.stream, true)
  assert.deepEqual(body.stream_options, { include_usage: true })
  assert.equal(body.model, 'm')
})

test('reasoning effort reaches the wire as its id', () => {
  const body = requestBody(
    { model: 'm', messages: [], reasoningEffort: 'high' },
    { reasoningEffort: 'medium' },
  )
  // The resolved setting wins over the raw option, matching the host's
  // materialized-config contract.
  assert.equal(body.reasoning_effort, 'medium')
})

test('a stop list above the provider ceiling throws UNSUPPORTED_OPTION', () => {
  // Measured: 4, 5, 8 and 16 all return 200; 32 returns
  // 422 "maximum of 16 stop sequences allowed". The brief said the limit was 4.
  assert.equal(MAX_STOP_SEQUENCES, 16)
  const tooMany = Array.from({ length: 17 }, (_, i) => String(i))
  assert.throws(
    () => requestBody({ model: 'm', messages: [], stop: tooMany }),
    (error) => error.code === 'UNSUPPORTED_OPTION',
  )
  const atLimit = Array.from({ length: 16 }, (_, i) => String(i))
  assert.equal(requestBody({ model: 'm', messages: [], stop: atLimit }).stop.length, 16)
})

test('maxTokens is passed through without a local cap', () => {
  // Measured: HTTP accepts 16385, 50000 and 100000 on a route whose catalog
  // max_tokens says 1048576. There is no 16,384 wire cap to clamp against.
  assert.equal(requestBody({ model: 'm', messages: [] }, { maxTokens: 50000 }).max_tokens, 50000)
})
