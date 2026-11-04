import assert from 'node:assert/strict'
import test from 'node:test'

import { finishReason, isFinishEvent, mapDelta, reasoningText, toolCallFragments } from '../lib/map.js'

test('the delta type comes from the wire field, never the characters', () => {
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

test('an unknown finish reason is reported as unrecognized but not fatal', () => {
  const mapped = finishReason('some_future_reason')
  assert.equal(mapped.reason.kind, 'stop')
  assert.equal(mapped.recognized, false)
})

test('isFinishEvent detects only a non-empty finish_reason', () => {
  assert.equal(isFinishEvent({ choices: [{ finish_reason: 'tool_calls' }] }), true)
  assert.equal(isFinishEvent({ choices: [{ delta: { content: 'x' } }] }), false)
  assert.equal(isFinishEvent({ choices: [{ finish_reason: null }] }), false)
  assert.equal(isFinishEvent({ choices: [{ finish_reason: '' }] }), false)
  assert.equal(isFinishEvent({ usage: { prompt_tokens: 1 } }), false)
})
