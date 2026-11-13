/**
 * The shared OpenAI protocol core reproduces the vendor-boundary behaviour.
 *
 * `lib/stream/openai.js` supersedes two byte-identical vendor copies
 * (`vendor/deepinfra/lib/stream-contract.js:85-125`,
 * `vendor/exaone/lib/stream-contract.js:76-116`) plus the delta mapping and the
 * request projection they re-implemented. Until Phase 2 deletes those copies,
 * this test runs BOTH sides over the same bytes and requires the chunk stream and
 * the request body to be deep-equal, so the deletion is provably behaviour-free.
 *
 * Covered: fragmented tool-call assembly, text + reasoning deltas, usage
 * projection, finish mapping, and one request-projection case.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import {
  MAX_STOP_SEQUENCES,
  PART_TEXT,
  REASONING_FIELDS,
  STREAM_DESCRIPTOR,
  STREAM_HOOKS,
  mapDelta,
  mapFinish,
  nonEmpty,
  positiveInteger,
  readEvent,
  requestBody,
  serializeMessages,
  serializeTools,
  textOf,
  toolCallFragments,
  toolCallsOf,
  userContent,
} from '../lib/stream/openai.js'
import { normalizeStream, readSseEvents } from '../lib/stream/index.js'

import {
  STREAM_HOOKS as DEEPINFRA_HOOKS,
  STREAM_DESCRIPTOR as DEEPINFRA_DESCRIPTOR,
} from '../vendor/deepinfra/lib/stream-contract.js'
import { STREAM_HOOKS as EXAONE_HOOKS } from '../vendor/exaone/lib/stream-contract.js'
import {
  requestBody as vendorRequestBody,
  serializeMessages as vendorSerializeMessages,
  serializeTools as vendorSerializeTools,
  textOf as vendorTextOf,
  toolCallsOf as vendorToolCallsOf,
  userContent as vendorUserContent,
} from '../vendor/deepinfra/lib/wire.js'

const FIXTURE = readFileSync(new URL('./conformance/fixtures/openai-completions.sse', import.meta.url), 'utf8')

const VENDOR_HOOK_SETS = Object.freeze([
  Object.freeze({ name: 'deepinfra', hooks: DEEPINFRA_HOOKS }),
  Object.freeze({ name: 'exaone', hooks: EXAONE_HOOKS }),
])

/**
 * Drive one hook set over an SSE body and collect every chunk verbatim.
 * @param {object} hooks - a STREAM_HOOKS object.
 * @param {string} body - recorded SSE body.
 * @returns {Promise<object[]>} raw normalized chunks.
 */
async function chunksFor(hooks, body = FIXTURE) {
  const chunks = []
  for await (const chunk of normalizeStream({
    events: readSseEvents(new Response(body).body, { malformed: 'fail' }),
    descriptor: STREAM_DESCRIPTOR,
    hooks,
  })) chunks.push(chunk)
  return chunks
}

/** @param {object[]} chunks - normalized chunks. @returns accumulated text. */
const textOfChunks = (chunks, type) => chunks
  .filter((chunk) => chunk.type === type)
  .map((chunk) => chunk.text)
  .join('')

test('the core chunk stream is byte-identical to both vendor bindings', async () => {
  for (const vendor of VENDOR_HOOK_SETS) {
    const mine = await chunksFor(STREAM_HOOKS)
    const theirs = []
    for await (const chunk of normalizeStream({
      events: readSseEvents(new Response(FIXTURE).body, { malformed: 'fail' }),
      descriptor: DEEPINFRA_DESCRIPTOR,
      hooks: vendor.hooks,
    })) theirs.push(chunk)
    assert.deepEqual(mine, theirs, `${vendor.name} chunk stream diverged from the shared core`)
  }
})

test('fragmented tool calls assemble into one block with the first fragment identity', async () => {
  const chunks = await chunksFor(STREAM_HOOKS)
  const starts = chunks.filter((chunk) => chunk.type === 'block-start' && chunk.blockType === 'tool-call')
  assert.equal(starts.length, 1, 'the two fragments must open exactly one block')

  const ends = chunks.filter((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
  assert.equal(ends.length, 1)
  // Identity comes from fragment 1, arguments from fragment 2, concatenated as raw JSON.
  assert.deepEqual(ends[0].block, {
    type: 'tool-call',
    id: 'call_1',
    name: 'lookup',
    arguments: '{"q":"x"}',
  })

  // The argument-only fragment emits a delta, never a second identity.
  const deltas = chunks.filter((chunk) => chunk.type === 'tool-call-delta')
  assert.equal(deltas[0].argumentsDelta, '', 'identity fragment carries empty arguments')
  assert.equal(deltas.at(-1).argumentsDelta, '{"q":"x"}')
})

test('a lone argument fragment stays silent until an identity exists', () => {
  const argsOnly = readEvent({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":1}' } }] } }] })
  assert.deepEqual(argsOnly, {
    parts: [{ kind: 'tool-call', index: 0, argumentsDelta: '{"a":1}' }],
  })
  assert.equal(Object.hasOwn(argsOnly.parts[0], 'id'), false, 'absent identity must omit the key')
  assert.equal(Object.hasOwn(argsOnly.parts[0], 'name'), false)
})

test('text and reasoning deltas map from their wire fields', async () => {
  const chunks = await chunksFor(STREAM_HOOKS)
  assert.equal(textOfChunks(chunks, 'reasoning-delta'), 'think ')
  assert.equal(textOfChunks(chunks, 'text-delta'), 'answer')
  // Field priority: reasoning_content wins, then reasoning, then reasoning_text.
  for (const field of REASONING_FIELDS) {
    assert.deepEqual(mapDelta({ [field]: 'r' }), [{ kind: 'reasoning', text: 'r' }])
  }
  assert.deepEqual(mapDelta({ content: 'c' }), [{ kind: PART_TEXT, text: 'c' }])
  assert.deepEqual(mapDelta(null), [])
  assert.deepEqual(mapDelta({}), [])
})

test('usage is projected onto the shared canonical buckets', async () => {
  const chunks = await chunksFor(STREAM_HOOKS)
  const usage = chunks.find((chunk) => chunk.type === 'usage')?.usage
  assert.deepEqual(usage, {
    inputTokens: 90,
    outputTokens: 20,
    cacheReadTokens: 10,
    reasoningTokens: 5,
    totalTokens: 120,
  })
  // Usage arrives after the last block closes and strictly before finish.
  const kinds = chunks.map((chunk) => chunk.type)
  assert.ok(kinds.lastIndexOf('block-end') < kinds.indexOf('usage'), 'usage must follow block-end')
  assert.equal(kinds.at(-1), 'finish', 'nothing may follow finish')
})

test('finish values map through the one shared table', async () => {
  const chunks = await chunksFor(STREAM_HOOKS)
  assert.deepEqual(chunks.at(-1).reason, { kind: 'tool-calls' })
  assert.deepEqual(mapFinish('stop'), { kind: 'stop' })
  assert.deepEqual(mapFinish('length'), { kind: 'max-tokens' })
  assert.deepEqual(mapFinish(undefined), { kind: 'stop' })
  assert.equal(mapFinish('content_filter').kind, 'error')
  assert.equal(mapFinish('content_filter').failure.code, 'CONTENT_FILTERED')
  // An unrecognised value is an error, never a silent clean stop.
  assert.equal(mapFinish('wat').failure.code, 'UNKNOWN_FINISH_REASON')
})

test('an undecodable payload is a PROTOCOL_DEFECT, not a skipped frame', () => {
  assert.deepEqual(readEvent(null), {
    defect: { code: 'PROTOCOL_DEFECT', message: 'OpenAI-compatible event is not a JSON object' },
  })
  // An event carrying nothing the core cares about is undefined, not a defect.
  assert.equal(readEvent({ choices: [{ delta: {} }] }), undefined)
})

test('request projection matches the vendor wire byte for byte', () => {
  const messages = [
    { role: 'system', content: 'be terse' },
    { role: 'developer', content: [{ type: 'text', text: 'dropped' }] },
    { role: 'user', content: [{ type: 'text', text: 'hi' }, { type: 'reasoning', text: 'hidden' }] },
    { role: 'assistant', content: [{ type: 'text', text: 'calling' }, { type: 'tool-call', id: 'c1', name: 'lookup', arguments: '{"q":"x"}' }] },
    { role: 'tool', toolCallId: 'c1', content: [{ type: 'text', text: '{"ok":true}' }] },
  ]
  assert.deepEqual(serializeMessages(messages, 'sys'), vendorSerializeMessages(messages, 'sys'))
  assert.equal(textOf(messages[4].content), vendorTextOf(messages[4].content))
  assert.deepEqual(toolCallsOf(messages[3].content), vendorToolCallsOf(messages[3].content))
  assert.deepEqual(userContent(messages[2].content), vendorUserContent(messages[2].content))
  assert.throws(() => serializeMessages([{ role: 'nope' }]), /unsupported message role "nope"/)

  const tools = [{ name: 'lookup', description: '  ', parameters: { type: 'object', properties: {} } }]
  assert.deepEqual(serializeTools(tools), vendorSerializeTools(tools))
  assert.equal(nonEmpty('', 'lookup'), 'Tool lookup')
  assert.equal(positiveInteger(0), undefined)
  assert.equal(positiveInteger(12.9), 12)

  const options = {
    model: 'm',
    system: 'sys',
    messages,
    tools,
    stop: ['a', 'b'],
    temperature: 0.2,
    reasoningEffort: 'low',
  }
  const settings = { maxTokens: 64 }
  assert.deepEqual(requestBody(options, settings), vendorRequestBody(options, settings))
  assert.equal(requestBody(options).stream, true)
  assert.deepEqual(requestBody(options).stream_options, { include_usage: true })
  // The measured ceiling refuses an over-long list instead of truncating it.
  const tooMany = { ...options, stop: Array.from({ length: MAX_STOP_SEQUENCES + 1 }, (_, i) => `s${i}`) }
  assert.throws(() => requestBody(tooMany), (error) => error.code === 'UNSUPPORTED_OPTION')
  assert.throws(() => requestBody({ ...options, temperature: -1 }), (error) => error.code === 'UNSUPPORTED_OPTION')
})
