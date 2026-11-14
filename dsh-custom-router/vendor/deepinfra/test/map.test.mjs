import assert from 'node:assert/strict'
import test from 'node:test'

import * as core from '../../../lib/stream/openai.js'
import { finishReason, isFinishEvent, mapDelta, reasoningText, toolCallFragments } from '../lib/map.js'

test('the delta type comes from the wire field, never the characters', () => {
  // Phase 2: the delta mapper is the shared OpenAI core, re-exported by
  // identity. This file's own 90-line copy was byte-identical to exaone's and is
  // deleted, so the assertion is identity and not behaviour equivalence.
  assert.equal(mapDelta, core.mapDelta)
  assert.equal(reasoningText, core.reasoningText)
  assert.equal(toolCallFragments, core.toolCallFragments)
  // Failure ledger F-22: a text scanner is forbidden. Prose that carries
  // protocol notation is still text because it arrived as content.
  const parts = mapDelta({ content: '[tool call get_weather #1]: {"city":"Seoul"}' })
  assert.deepEqual(parts, [{ kind: 'text', text: '[tool call get_weather #1]: {"city":"Seoul"}' }])
})

test('reasoning_content becomes a reasoning part, distinct from content', () => {
  const parts = mapDelta({ reasoning_content: 'let me think', content: 'the answer' })
  assert.deepEqual(parts, [
    { kind: 'reasoning', text: 'let me think' },
    { kind: 'text', text: 'the answer' },
  ])
})

test('reasoning aliases are honored', () => {
  assert.equal(reasoningText({ reasoning: 'a' }), 'a')
  assert.equal(reasoningText({ reasoning_text: 'b' }), 'b')
  assert.equal(reasoningText({ reasoning_content: 'c', reasoning: 'd' }), 'c')
  assert.equal(reasoningText({ content: 'plain' }), '')
})

test('the measured two-fragment tool call maps to one call', () => {
  // Recorded 2026-11-04 from deepseek-ai/DeepSeek-V4.1-Flash: the first fragment
  // carries id and name with EMPTY arguments; the second carries only index and
  // a 2,944-character argument slice.
  const first = toolCallFragments([
    { index: 0, id: 'chatcmpl-tool-9c59', function: { name: 'apply_edits', arguments: '' } },
  ])
  assert.deepEqual(first, [{ index: 0, id: 'chatcmpl-tool-9c59', name: 'apply_edits', argumentsDelta: '' }])

  const second = toolCallFragments([{ index: 0, id: null, function: { name: null, arguments: '{"edits":[' } }])
  assert.deepEqual(second, [{ index: 0, id: undefined, name: undefined, argumentsDelta: '{"edits":[' }])
})

test('parallel tool calls keep distinct indexes', () => {
  const fragments = toolCallFragments([
    { index: 0, id: 'call_a', function: { name: 'get_weather', arguments: '{"city":"Seoul"}' } },
    { index: 1, id: 'call_b', function: { name: 'get_weather', arguments: '{"city":"Busan"}' } },
  ])
  assert.deepEqual(fragments.map((f) => f.index), [0, 1])
  assert.deepEqual(fragments.map((f) => f.id), ['call_a', 'call_b'])
})

test('arguments stay a raw JSON string end-to-end', () => {
  const [fragment] = toolCallFragments([{ index: 0, id: 'x', function: { name: 'f', arguments: '{"a":1}' } }])
  assert.equal(typeof fragment.argumentsDelta, 'string')
  assert.equal(fragment.argumentsDelta, '{"a":1}')
})

test('a provider that hands back parsed arguments is re-stringified once', () => {
  const [fragment] = toolCallFragments([{ index: 0, id: 'x', function: { name: 'f', arguments: { a: 1 } } }])
  assert.equal(fragment.argumentsDelta, '{"a":1}')
})

test('a missing tool_calls array contributes nothing', () => {
  assert.deepEqual(mapDelta({ content: 'hi' }).filter((p) => p.kind === 'tool-call'), [])
  assert.deepEqual(toolCallFragments(undefined), [])
  assert.deepEqual(toolCallFragments([]), [])
})

test('finish reasons map onto the harness vocabulary', () => {
  assert.equal(finishReason('stop').reason.kind, 'stop')
  assert.equal(finishReason('tool_calls').reason.kind, 'tool-calls')
  assert.equal(finishReason('length').reason.kind, 'max-tokens')
})

test('the shared table keeps the tool-calls and budget classes distinct', () => {
  // `function_call` is the same semantic class as `tool_calls`; `max_tokens` is
  // the same class as `length`. One table, so the two spellings cannot drift.
  assert.equal(finishReason('function_call').reason.kind, 'tool-calls')
  assert.equal(finishReason('max_tokens').reason.kind, 'max-tokens')
  assert.equal(finishReason('end_turn').reason.kind, 'stop')
  assert.equal(finishReason(null).reason.kind, 'stop')
  assert.equal(finishReason(undefined).reason.kind, 'stop')
})

test('a filtered finish is an error with CONTENT_FILTERED, not a clean stop', () => {
  // D4 closure (spec §5.2). The old per-vendor table mapped `content_filter`
  // to a clean `stop`, so the host committed a filtered answer as a complete
  // one. The shared table makes it a terminal error with a code.
  const filtered = finishReason('content_filter')
  assert.equal(filtered.reason.kind, 'error')
  assert.equal(filtered.reason.failure.code, 'CONTENT_FILTERED')
  assert.equal(typeof filtered.reason.failure.message, 'string')
  assert.ok(filtered.reason.failure.message.length > 0)
})

test('an unknown finish reason is an error with UNKNOWN_FINISH_REASON and is NOT recognized', () => {
  // The old table flattened an unmapped value to `stop`. The shared table makes
  // it a terminal error, and `recognized: false` keeps it visible in a trace.
  const mapped = finishReason('some_future_reason')
  assert.equal(mapped.reason.kind, 'error')
  assert.equal(mapped.reason.failure.code, 'UNKNOWN_FINISH_REASON')
  assert.equal(mapped.recognized, false)
})

test('a recognized finish reason is reported as recognized', () => {
  assert.equal(finishReason('stop').recognized, true)
  assert.equal(finishReason('tool_calls').recognized, true)
  assert.equal(finishReason('length').recognized, true)
  // A filtered finish IS recognized: the shared table had a rule for it. Only
  // the catch-all UNKNOWN_FINISH_REASON branch counts as unrecognised.
  assert.equal(finishReason('content_filter').recognized, true)
})

test('every mapped failure carries both message and code', () => {
  for (const value of ['content_filter', 'some_future_reason']) {
    const reason = finishReason(value).reason
    assert.equal(reason.kind, 'error', value)
    assert.equal(typeof reason.failure.message, 'string', value)
    assert.ok(reason.failure.message.length > 0, value)
    assert.equal(typeof reason.failure.code, 'string', value)
    assert.ok(reason.failure.code.length > 0, value)
  }
})

test('isFinishEvent detects only a non-empty finish_reason', () => {
  assert.equal(isFinishEvent({ choices: [{ finish_reason: 'tool_calls' }] }), true)
  assert.equal(isFinishEvent({ choices: [{ delta: { content: 'x' } }] }), false)
  assert.equal(isFinishEvent({ choices: [{ finish_reason: null }] }), false)
  assert.equal(isFinishEvent({ choices: [{ finish_reason: '' }] }), false)
  assert.equal(isFinishEvent({ usage: { prompt_tokens: 1 } }), false)
})
