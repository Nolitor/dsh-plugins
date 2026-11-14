/**
 * P3 binding tests: this provider against the shared downstream pipe.
 *
 * The pipe (`@nolit/dsh-custom-router/stream`) owns the block lifecycle, the
 * finish table, the usage writer, the failure shape and the terminal policy.
 * These tests pin the DeepInfra edge only — what one OpenAI-shaped event means,
 * and that the shared core absorbed the vendor quirks.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import * as core from '../../../lib/stream/openai.js'
import {
  STREAM_DESCRIPTOR,
  STREAM_HOOKS,
  mapFinish,
  readEvent,
} from '../lib/stream-contract.js'

/** One OpenAI-shaped chat-completions event. */
const event = (choices, usage) => ({
  ...(choices === undefined ? {} : { choices }),
  ...(usage === undefined ? {} : { usage }),
})

test('the descriptor declares the fragmented tool-call shape and the prompt+output formula', () => {
  // Measured DeepInfra shapes: a tool call arrives as fragments carrying the
  // wire's own ordinal, and `total_tokens === prompt_tokens + completion_tokens`
  // on every route checked, so the provider aggregate cross-checks under
  // `prompt+output` and NOT under the Gemini formula.
  assert.deepEqual(STREAM_DESCRIPTOR, {
    toolCallShape: 'fragmented',
    usage: { totalFormula: 'prompt+output' },
    malformedRecord: 'fail',
  })
  // Phase 2: the descriptor and the hooks ARE the shared core objects by
  // identity, so a re-forked literal fails here instead of drifting.
  assert.equal(STREAM_DESCRIPTOR, core.STREAM_DESCRIPTOR)
  assert.equal(STREAM_HOOKS, core.STREAM_HOOKS)
  assert.equal(readEvent, core.readEvent)
  assert.equal(mapFinish, core.mapFinish)
})

test('a text delta becomes exactly one text part', () => {
  const record = readEvent(event([{ delta: { content: 'hello' } }]))
  assert.deepEqual(record, { parts: [{ kind: 'text', text: 'hello' }] })
})

test('reasoning_content becomes a reasoning part, distinct from content', () => {
  const record = readEvent(event([{ delta: { reasoning_content: 'let me think', content: 'the answer' } }]))
  assert.deepEqual(record, {
    parts: [
      { kind: 'reasoning', text: 'let me think' },
      { kind: 'text', text: 'the answer' },
    ],
  })
})

test('the measured first tool-call fragment keeps the wire index and its identity', () => {
  // Recorded 2026-11-04 from deepseek-ai/DeepSeek-V4.1-Flash: the first fragment
  // carries index, id and function.name with EMPTY arguments.
  const record = readEvent(event([{
    delta: { tool_calls: [{ index: 0, id: 'chatcmpl-tool-9c59', type: 'function', function: { name: 'apply_edits', arguments: '' } }] },
  }]))
  assert.deepEqual(record, {
    parts: [{
      kind: 'tool-call',
      index: 0,
      id: 'chatcmpl-tool-9c59',
      name: 'apply_edits',
      argumentsDelta: '',
    }],
  })
})

test('a later tool-call fragment carries NO id and NO name, and synthesises nothing', () => {
  // Measured: later fragments have `id: null` and `name: null`. The contract
  // forbids synthesising identity here — the pipe owns first-seen allocation,
  // so a `call_N` fallback exists in exactly one place.
  const record = readEvent(event([{
    delta: { tool_calls: [{ index: 0, id: null, function: { name: null, arguments: '{"edits":[' } }] },
  }]))
  assert.deepEqual(record, {
    parts: [{ kind: 'tool-call', index: 0, argumentsDelta: '{"edits":[' }],
  })
  const part = record.parts[0]
  assert.equal('id' in part, false, 'an absent id must not appear as a key at all')
  assert.equal('name' in part, false, 'an absent name must not appear as a key at all')
})

test('tool-call arguments stay a raw JSON string end-to-end', () => {
  const record = readEvent(event([{
    delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'f', arguments: '{"a":1}' } }] },
  }]))
  assert.equal(typeof record.parts[0].argumentsDelta, 'string')
  assert.equal(record.parts[0].argumentsDelta, '{"a":1}')
})

test('a provider that hands back parsed arguments is re-stringified exactly once', () => {
  const record = readEvent(event([{
    delta: { tool_calls: [{ index: 0, id: 'x', function: { name: 'f', arguments: { a: 1 } } }] },
  }]))
  assert.equal(record.parts[0].argumentsDelta, '{"a":1}')
})

test('parallel tool calls keep the wire indexes distinct', () => {
  const record = readEvent(event([{
    delta: { tool_calls: [
      { index: 0, id: 'call_a', function: { name: 'get_weather', arguments: '{"city":"Seoul"}' } },
      { index: 1, id: 'call_b', function: { name: 'get_weather', arguments: '{"city":"Busan"}' } },
    ] },
  }]))
  assert.deepEqual(record.parts.map((part) => part.index), [0, 1])
  assert.deepEqual(record.parts.map((part) => part.id), ['call_a', 'call_b'])
})

test('a usage-only event hands the RAW provider object over to the shared writer', () => {
  // Measured: DeepInfra sends the usage event last, on its own, with an empty
  // `choices` array. The raw object is handed over untouched so the shared
  // writer owns the buckets and the `totalTokens` cross-check.
  const usage = { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12, estimated_cost: 0.0001 }
  const record = readEvent(event([], usage))
  assert.deepEqual(record, { usage })
  assert.equal(record.usage, usage, 'the raw object is passed through by identity')
})

test('the finish value is extracted raw and kept untranslated', () => {
  const record = readEvent(event([{ delta: {}, finish_reason: 'tool_calls' }]))
  assert.deepEqual(record, { finish: 'tool_calls' })
})

test('a finish and usage on ONE event are both extracted', () => {
  const usage = { prompt_tokens: 3, completion_tokens: 1 }
  const record = readEvent(event([{ delta: {}, finish_reason: 'stop' }], usage))
  assert.deepEqual(record, { usage, finish: 'stop' })
})

test('an event with nothing usable is skipped rather than emitted as an empty record', () => {
  assert.equal(readEvent({}), undefined)
  assert.equal(readEvent(event([])), undefined)
  assert.equal(readEvent(event([{ delta: {} }])), undefined)
})

test('a non-object payload is a protocol defect, not a silent skip', () => {
  // The pipe turns a defect into a thrown PROTOCOL_DEFECT; a payload that is
  // not an object cannot be a chat-completions event at all.
  for (const payload of [null, undefined, 'text', 42, true]) {
    const record = readEvent(payload)
    assert.equal(record.defect?.code, 'PROTOCOL_DEFECT', String(payload))
    assert.equal(typeof record.defect?.message, 'string', String(payload))
    assert.ok(record.defect.message.length > 0, String(payload))
  }
})

test('mapFinish uses the one shared table', () => {
  assert.deepEqual(mapFinish('stop'), { kind: 'stop' })
  assert.deepEqual(mapFinish('tool_calls'), { kind: 'tool-calls' })
  assert.deepEqual(mapFinish('length'), { kind: 'max-tokens' })
})

test('a filtered finish is an error with a code, not a clean stop (D4)', () => {
  // The old per-vendor table mapped `content_filter` to a clean `stop`, so the
  // host committed a filtered answer as a complete one.
  const filtered = mapFinish('content_filter')
  assert.equal(filtered.kind, 'error')
  assert.equal(filtered.failure.code, 'CONTENT_FILTERED')
})

test('an unmapped finish value is an error with UNKNOWN_FINISH_REASON', () => {
  const unknown = mapFinish('some_future_reason')
  assert.equal(unknown.kind, 'error')
  assert.equal(unknown.failure.code, 'UNKNOWN_FINISH_REASON')
})

test('every mapped failure carries both message and code (the D3 defect)', () => {
  for (const value of ['content_filter', 'some_future_reason', 'server_busy']) {
    const reason = mapFinish(value)
    assert.equal(reason.kind, 'error', value)
    assert.equal(typeof reason.failure.message, 'string', value)
    assert.ok(reason.failure.message.length > 0, value)
    assert.equal(typeof reason.failure.code, 'string', value)
    assert.ok(reason.failure.code.length > 0, value)
  }
})

test('the hook set is exactly the two the pipeline calls', () => {
  assert.deepEqual(Object.keys(STREAM_HOOKS).sort(), ['mapFinish', 'readEvent'])
  for (const hook of Object.values(STREAM_HOOKS)) assert.equal(typeof hook, 'function')
})
