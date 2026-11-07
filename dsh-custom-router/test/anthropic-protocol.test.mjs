/**
 * Anthropic Messages protocol hooks: SSE framing, event projection, usage
 * projection and finish mapping.
 *
 * Anthropic is not an OpenAI-shaped stream, so every case below pins a wire
 * difference that the shared pipe would otherwise get wrong: no `[DONE]`
 * sentinel, `event:` + `data.type` double discrimination, `input_tokens` that
 * EXCLUDES cache, fragmented tool arguments, and a thinking signature that no
 * host chunk field can carry.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ANTHROPIC_DESCRIPTOR,
  createAnthropicHooks,
  mapAnthropicFinish,
  readAnthropicEvent,
  readAnthropicSse,
  usageFromAnthropic,
} from '../lib/stream/anthropic.js'
// The real pipe, not a stand-in: FIX 3 is about what the pipe does with the
// record an `error` event produces, so the assertion has to cross that boundary.
import { normalizeStream } from '../lib/stream/index.js'

/** A web `ReadableStream` of encoded string chunks. */
function streamOf(...chunks) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
}

/** Drain one SSE source into its decoded payloads, in wire order. */
async function collect(source) {
  const payloads = []
  for await (const payload of readAnthropicSse(source)) payloads.push(payload)
  return payloads
}

test('ANTHROPIC_DESCRIPTOR declares the anthropic-messages wire exactly', () => {
  assert.deepEqual(ANTHROPIC_DESCRIPTOR, {
    protocol: 'anthropic-messages',
    toolCallShape: 'fragmented',
    usage: { totalFormula: 'input+output+cache' },
    malformedRecord: 'fail',
  })
  assert.equal(Object.isFrozen(ANTHROPIC_DESCRIPTOR), true)
})

test('readAnthropicSse parses event/data frames, joins multi-line data and ignores comments', async () => {
  const payloads = await collect(streamOf(
    ': keep-alive\n\n',
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":3}}}\n\n',
    ': a comment inside a record\n',
    'event: message_delta\ndata: {"type":"message_delta",\ndata: "delta":{"stop_reason":"end_turn"}}\n\n',
    'event: ping\ndata: {"subtype":"keepalive"}\n\n',
  ))

  assert.equal(payloads.length, 3)
  assert.deepEqual(payloads[0], {
    type: 'message_start',
    message: { usage: { input_tokens: 3 } },
  })
  // Multi-line `data:` fields join with '\n' and still parse as one JSON value.
  assert.deepEqual(payloads[1], {
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
  })
  // The `event:` name is folded into `type` only when the payload omits it.
  assert.deepEqual(payloads[2], { subtype: 'keepalive', type: 'ping' })
})

test('readAnthropicSse frames CRLF records and survives a chunk split mid-record', async () => {
  const payloads = await collect(streamOf(
    'event: message_start\r\ndata: {"type":"message_st',
    'art"}\r\n\r\n',
    'event: message_stop\r\ndata: {"type":"message_stop"}\r\n\r\n',
  ))

  assert.deepEqual(payloads, [
    { type: 'message_start' },
    { type: 'message_stop' },
  ])
})

test('readAnthropicSse ends at stream close; there is no [DONE] sentinel', async () => {
  const payloads = await collect(streamOf(
    'event: message_start\ndata: {"type":"message_start"}\n\n',
    // The socket closes right after `message_stop`: the last record has no
    // closing blank line and must still be decoded.
    'event: message_stop\ndata: {"type":"message_stop"}',
  ))

  assert.deepEqual(payloads, [
    { type: 'message_start' },
    { type: 'message_stop' },
  ])
  assert.equal(payloads.some((payload) => payload === '[DONE]'), false)
  assert.equal(payloads.some((payload) => payload?.type === '[DONE]'), false)
})

test('a malformed data frame rejects with PROTOCOL_DEFECT instead of being skipped', async () => {
  await assert.rejects(
    async () => {
      for await (const _payload of readAnthropicSse(
        streamOf('event: content_block_delta\ndata: {"type":\n\n'),
      )) { /* drain */ }
    },
    (error) => {
      assert.equal(error.code, 'PROTOCOL_DEFECT')
      assert.match(error.message, /malformed Anthropic SSE data/)
      return true
    },
  )
})

test('an empty data frame is ignored instead of raising PROTOCOL_DEFECT', async () => {
  const payloads = await collect(streamOf(
    'event: message_start\ndata: {"type":"message_start"}\n\n',
    // A blank `data:` frame is a keep-alive some proxies inject: no payload.
    'event: ping\ndata:\n\n',
    'data:   \n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  ))

  // Only the two real payloads survive; nothing is invented for the blanks.
  assert.deepEqual(payloads, [
    { type: 'message_start' },
    { type: 'message_stop' },
  ])
})

test('message_start projects the input count and both cache counts', () => {
  const state = {}
  const record = readAnthropicEvent({
    type: 'message_start',
    message: {
      usage: {
        input_tokens: 12,
        cache_read_input_tokens: 34,
        cache_creation_input_tokens: 5,
      },
    },
  }, state)

  assert.deepEqual(record, { usage: { input: 12, cacheRead: 34, cacheWrite: 5 } })
})

test('a thinking block projects one reasoning part per event with the exact text', () => {
  const state = {}

  const start = readAnthropicEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'thinking', thinking: '' },
  }, state)
  assert.deepEqual(start, { parts: [{ kind: 'reasoning', text: '' }] })

  const first = readAnthropicEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'thinking_delta', thinking: 'step one' },
  }, state)
  assert.deepEqual(first, { parts: [{ kind: 'reasoning', text: 'step one' }] })

  const second = readAnthropicEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'thinking_delta', thinking: ' step two' },
  }, state)
  assert.deepEqual(second, { parts: [{ kind: 'reasoning', text: ' step two' }] })
})

test('a signature delta is not surfaced downstream but accumulates per block', () => {
  const state = {}
  readAnthropicEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'thinking', thinking: '' },
  }, state)

  assert.equal(readAnthropicEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'signature_delta', signature: 'sig-1' },
  }, state), undefined)
  assert.equal(readAnthropicEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'signature_delta', signature: 'sig-2' },
  }, state), undefined)

  assert.equal(state.signatures.get(0), 'sig-1sig-2')
  // The latest-signature mirror stays valid for single-block callers.
  assert.equal(state.signature, 'sig-1sig-2')
})

test('two thinking blocks keep both signatures; the second start does not wipe the first', () => {
  const state = {}

  readAnthropicEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'thinking', thinking: 'first' },
  }, state)
  readAnthropicEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'signature_delta', signature: 'SIG-A' },
  }, state)

  // A second thinking block, starting with no signature of its own.
  readAnthropicEvent({
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'thinking', thinking: 'second' },
  }, state)
  // The first block's signature must survive the second block's start.
  assert.equal(state.signatures.get(0), 'SIG-A')
  assert.equal(state.signature, 'SIG-A')

  readAnthropicEvent({
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'signature_delta', signature: 'SIG-B' },
  }, state)

  assert.equal(state.signatures.get(0), 'SIG-A')
  assert.equal(state.signatures.get(1), 'SIG-B')
  assert.equal(state.signature, 'SIG-B')
})

test('a block start states its signature without erasing another block', () => {
  const state = {}
  readAnthropicEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'thinking', thinking: '', signature: 'BLOCK-0' },
  }, state)
  readAnthropicEvent({
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'thinking', thinking: '' },
  }, state)

  assert.equal(state.signatures.get(0), 'BLOCK-0')
  assert.equal(state.signatures.get(1), '')
  // The mirror is never set back to '' once a real signature exists.
  assert.equal(state.signature, 'BLOCK-0')
})

test('a redacted thinking block is reported as a redacted reasoning part', () => {
  const state = {}
  const record = readAnthropicEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'redacted_thinking', data: 'ENCRYPTED-PAYLOAD' },
  }, state)

  assert.deepEqual(record, { parts: [{ kind: 'reasoning', text: '[Reasoning redacted]' }] })
  assert.equal(state.signatures.get(0), 'ENCRYPTED-PAYLOAD')
  assert.equal(state.signature, 'ENCRYPTED-PAYLOAD')
})

test('a fragmented tool call keeps its identity on the start and its fragments on the index', () => {
  const state = {}

  const start = readAnthropicEvent({
    type: 'content_block_start',
    index: 2,
    content_block: { type: 'tool_use', id: 'toolu_1', name: 'read_file' },
  }, state)
  assert.deepEqual(start, {
    parts: [{ kind: 'tool-call', index: 2, id: 'toolu_1', name: 'read_file', argumentsDelta: '' }],
  })

  const first = readAnthropicEvent({
    type: 'content_block_delta',
    index: 2,
    delta: { type: 'input_json_delta', partial_json: '{"path"' },
  }, state)
  assert.deepEqual(first, {
    parts: [{ kind: 'tool-call', index: 2, argumentsDelta: '{"path"' }],
  })

  const second = readAnthropicEvent({
    type: 'content_block_delta',
    index: 2,
    delta: { type: 'input_json_delta', partial_json: ':"a.txt"}' },
  }, state)
  assert.deepEqual(second, {
    parts: [{ kind: 'tool-call', index: 2, argumentsDelta: ':"a.txt"}' }],
  })

  // The block index is carried, never inferred from an ordinal.
  assert.equal(start.parts[0].index, first.parts[0].index)
  assert.equal(first.parts[0].index, second.parts[0].index)
})

test('message_delta carries the finish reason and the output count', () => {
  const state = {}
  const record = readAnthropicEvent({
    type: 'message_delta',
    delta: { stop_reason: 'tool_use' },
    usage: { output_tokens: 42 },
  }, state)

  assert.deepEqual(record, { finish: 'tool_use', usage: { output: 42 } })
})

test('message_stop ends the turn', () => {
  const state = {}
  assert.deepEqual(readAnthropicEvent({ type: 'message_stop' }, state), { done: true })
})

test('an event with no downstream effect projects to undefined', () => {
  const state = {}
  assert.equal(readAnthropicEvent({ type: 'ping' }, state), undefined)
  // A text block opens no downstream block: text arrives as deltas only.
  assert.equal(readAnthropicEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'text', text: '' },
  }, state), undefined)
})

test('an in-stream error event is a terminal failure, never an undefined no-op', () => {
  const state = {}

  assert.deepEqual(
    readAnthropicEvent({ type: 'error', error: { type: 'overloaded_error', message: 'busy' } }, state),
    { defect: { code: 'PROVIDER_RESOURCE', message: 'busy' } },
  )
  assert.deepEqual(
    readAnthropicEvent({ type: 'error', error: { type: 'api_error', message: 'went down' } }, state),
    { defect: { code: 'PROVIDER_RESOURCE', message: 'went down' } },
  )
  assert.deepEqual(
    readAnthropicEvent({ type: 'error', error: { type: 'rate_limit_error', message: 'slow down' } }, state),
    { defect: { code: 'RATE_LIMIT', message: 'slow down' } },
  )
  // A message-less event still yields a usable, non-empty failure message.
  const bare = readAnthropicEvent({ type: 'error', error: { type: 'overloaded_error' } }, state)
  assert.equal(bare.defect.code, 'PROVIDER_RESOURCE')
  assert.equal(bare.defect.message.length > 0, true)
})

test('usageFromAnthropic keeps the input count cache-free and reports both cache counts', () => {
  const usage = usageFromAnthropic({ input: 10, cacheRead: 90, cacheWrite: 5, output: 5 })

  assert.deepEqual(usage, {
    inputTokens: 10,
    cacheReadTokens: 90,
    cacheWriteTokens: 5,
    outputTokens: 5,
  })
  // The provider reported no total, so none is invented.
  assert.equal('totalTokens' in usage, false)
})

test('usageFromAnthropic reports the total only when the provider total agrees', () => {
  const usage = usageFromAnthropic({ input: 10, cacheRead: 90, cacheWrite: 5, output: 5, total: 110 })
  assert.equal(usage.totalTokens, 110)
})

test('usageFromAnthropic returns undefined when no field carries a usable count', () => {
  assert.equal(usageFromAnthropic({}), undefined)
  assert.equal(usageFromAnthropic({ input: 'ten', output: -1 }), undefined)
  assert.equal(usageFromAnthropic(null), undefined)
})

test('mapAnthropicFinish maps the Anthropic stop reasons onto the shared table', () => {
  assert.deepEqual(mapAnthropicFinish('end_turn'), { kind: 'stop' })
  assert.deepEqual(mapAnthropicFinish('tool_use'), { kind: 'tool-calls' })
  assert.deepEqual(mapAnthropicFinish('max_tokens'), { kind: 'max-tokens' })
  assert.deepEqual(mapAnthropicFinish('stop_sequence'), { kind: 'stop' })
})

test('a paused turn and an exhausted context window are not unknown failures', () => {
  const paused = mapAnthropicFinish('pause_turn')
  assert.equal(paused.kind, 'stop')
  assert.equal('failure' in paused, false)

  const exhausted = mapAnthropicFinish('model_context_window_exceeded')
  assert.equal(exhausted.kind, 'max-tokens')
  assert.equal('failure' in exhausted, false)
})

test('end to end: a synthetic Anthropic SSE stream projects the hook record sequence', async () => {
  const sse = [
    'event: message_start',
    'data: {"type":"message_start","message":{"usage":{"input_tokens":12,"cache_read_input_tokens":34,"cache_creation_input_tokens":5,"output_tokens":1}}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"thinking","thinking":""}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":"step one"}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"thinking_delta","thinking":" step two"}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"text","text":""}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"text_delta","text":"Hello"}}',
    '',
    'event: message_delta',
    'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":7}}',
    '',
    'event: message_stop',
    'data: {"type":"message_stop"}',
    '',
  ].join('\n')

  const state = {}
  const records = []
  for await (const payload of readAnthropicSse(streamOf(sse))) {
    records.push(readAnthropicEvent(payload, state))
  }

  assert.equal(records.length, 8)
  // The text block start has no downstream effect and is projected as nothing.
  assert.equal(records[4], undefined)

  assert.deepEqual(records.filter((record) => record !== undefined), [
    { usage: { input: 12, cacheRead: 34, cacheWrite: 5 } },
    { parts: [{ kind: 'reasoning', text: '' }] },
    { parts: [{ kind: 'reasoning', text: 'step one' }] },
    { parts: [{ kind: 'reasoning', text: ' step two' }] },
    { parts: [{ kind: 'text', text: 'Hello' }] },
    { finish: 'end_turn', usage: { output: 7 } },
    { done: true },
  ])

  // The accumulated counts project onto the host usage shape.
  assert.deepEqual(
    usageFromAnthropic({ input: 12, cacheRead: 34, cacheWrite: 5, output: 7 }),
    {
      inputTokens: 12,
      cacheReadTokens: 34,
      cacheWriteTokens: 5,
      outputTokens: 7,
    },
  )
})

test('createAnthropicHooks merges the two usage pieces so the last record is complete', () => {
  const binding = createAnthropicHooks()

  assert.deepEqual(binding.descriptor, ANTHROPIC_DESCRIPTOR)
  assert.equal(binding.hooks.mapFinish, mapAnthropicFinish)
  assert.equal(binding.hooks.usageFrom, usageFromAnthropic)

  const start = binding.hooks.readEvent({
    type: 'message_start',
    message: { usage: { input_tokens: 12, cache_read_input_tokens: 34, cache_creation_input_tokens: 5 } },
  })
  assert.deepEqual(start, { usage: { input: 12, cacheRead: 34, cacheWrite: 5, output: undefined, total: undefined } })

  const delta = binding.hooks.readEvent({
    type: 'message_delta',
    delta: { stop_reason: 'end_turn' },
    usage: { output_tokens: 7 },
  })
  // The output-only piece must NOT erase the input/cache counts.
  assert.deepEqual(delta, {
    finish: 'end_turn',
    usage: { input: 12, cacheRead: 34, cacheWrite: 5, output: 7, total: undefined },
  })

  assert.deepEqual(binding.usage(), { input: 12, cacheRead: 34, cacheWrite: 5, output: 7, total: undefined })
  // The accumulated snapshot projects onto the host usage shape.
  assert.deepEqual(binding.hooks.usageFrom(binding.usage()), {
    inputTokens: 12,
    cacheReadTokens: 34,
    cacheWriteTokens: 5,
    outputTokens: 7,
  })
})

test('createAnthropicHooks never overwrites a real count with an absent field', () => {
  const binding = createAnthropicHooks()
  binding.hooks.readEvent({
    type: 'message_start',
    message: { usage: { input_tokens: 10, cache_read_input_tokens: 90 } },
  })
  // An uncached second piece omits the cache field; it must not clobber 90.
  binding.hooks.readEvent({ type: 'message_delta', usage: { output_tokens: 3 } })

  assert.equal(binding.usage().cacheRead, 90)
  assert.equal(binding.usage().input, 10)
  assert.equal(binding.usage().output, 3)
})

test('createAnthropicHooks keeps one signature per block and a stream-private state', () => {
  const first = createAnthropicHooks()
  const second = createAnthropicHooks()

  first.hooks.readEvent({
    type: 'content_block_start',
    index: 0,
    content_block: { type: 'thinking', thinking: '' },
  })
  first.hooks.readEvent({
    type: 'content_block_delta',
    index: 0,
    delta: { type: 'signature_delta', signature: 'SIG-A' },
  })
  first.hooks.readEvent({
    type: 'content_block_start',
    index: 1,
    content_block: { type: 'thinking', thinking: '' },
  })
  first.hooks.readEvent({
    type: 'content_block_delta',
    index: 1,
    delta: { type: 'signature_delta', signature: 'SIG-B' },
  })

  assert.equal(first.signature(0), 'SIG-A')
  assert.equal(first.signature(1), 'SIG-B')
  assert.equal(first.signature(), 'SIG-B')
  // A second binding for a second stream sees none of the first one's state.
  assert.equal(second.signature(), '')
  assert.equal(second.usage().input, undefined)
})

test('end to end: an overloaded_error event finishes as an error, not as stop', async () => {
  const sse = [
    'event: message_start',
    'data: {"type":"message_start","message":{"usage":{"input_tokens":5}}}',
    '',
    'event: content_block_start',
    'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
    '',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"partial"}}',
    '',
    'event: error',
    'data: {"type":"error","error":{"type":"overloaded_error","message":"Overloaded"}}',
    '',
  ].join('\n')

  const binding = createAnthropicHooks()
  const chunks = []
  for await (const chunk of normalizeStream({
    events: readAnthropicSse(streamOf(sse)),
    descriptor: binding.descriptor,
    hooks: binding.hooks,
  })) chunks.push(chunk)

  const finish = chunks.at(-1)
  assert.equal(finish.type, 'finish')
  assert.equal(finish.reason.kind, 'error')
  assert.deepEqual(finish.reason.failure, {
    message: 'Overloaded',
    code: 'PROVIDER_RESOURCE',
  })
  // The exact regression: the turn must never close as a clean stop.
  assert.notEqual(finish.reason.kind, 'stop')
  // Usage still arrives before the terminal finish, and the partial text is intact.
  const usageIndex = chunks.findIndex((chunk) => chunk.type === 'usage')
  assert.equal(usageIndex >= 0 && usageIndex < chunks.indexOf(finish), true)
  assert.deepEqual(
    chunks.filter((chunk) => chunk.type === 'text-delta').map((chunk) => chunk.text),
    ['partial'],
  )
})
