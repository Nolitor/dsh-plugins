/**
 * Upstream mapping tests: the wire field decides a part's type.
 *
 * These are the boundary tests for the switch away from text tag scanning:
 * a delta is classified by which OpenAI / AI SDK field carried it, and its
 * characters are never read. Every case below is a field-shape case, not a
 * pattern case.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  REASONING_FIELDS,
  contentText,
  mapChatDelta,
  reasoningText,
  toolCallParts,
} from '../lib/upstream-map.js'

test('a delta maps to reasoning, then text, then tool-call, in wire order', () => {
  const parts = mapChatDelta({
    reasoning_content: 'think',
    content: 'say',
    tool_calls: [{ index: 0, id: 'c1', function: { name: 'bash', arguments: '{"a":1}' } }],
  })
  assert.deepEqual(parts.map((part) => part.kind), ['reasoning', 'text', 'tool-call'])
  assert.deepEqual(parts[0], { kind: 'reasoning', text: 'think' })
  assert.deepEqual(parts[1], { kind: 'text', text: 'say' })
  assert.deepEqual(parts[2], { kind: 'tool-call', ordinal: 0, id: 'c1', name: 'bash', arguments: '{"a":1}' })
})

test('reasoning aliases are read in order, and the configured field wins', () => {
  assert.deepEqual(REASONING_FIELDS, ['reasoning_content', 'reasoning', 'reasoning_text'])
  assert.equal(reasoningText({ reasoning_content: 'main' }), 'main')
  assert.equal(reasoningText({ reasoning: 'alias' }), 'alias')
  assert.equal(reasoningText({ reasoning_text: 'alias2' }), 'alias2')
  assert.equal(reasoningText({ reasoning: 'alias', reasoning_content: 'main' }), 'main')
  assert.equal(reasoningText({ custom: 'configured' }, 'custom'), 'configured')
  assert.equal(reasoningText({}), '')
  assert.equal(reasoningText(undefined), '')
})

test('content as a structured array maps each text item, in order', () => {
  const parts = contentText({ content: [{ type: 'text', text: 'a' }, { type: 'image_url' }, 'b'] })
  assert.deepEqual(parts, ['a', 'b'])
  assert.deepEqual(contentText({ content: '' }), [])
  assert.deepEqual(contentText({}), [])
})

test('a delta with no content fields produces no parts', () => {
  assert.deepEqual(mapChatDelta({}), [])
  assert.deepEqual(mapChatDelta({ finish_reason: 'stop' }), [])
  assert.deepEqual(mapChatDelta(null), [])
  assert.deepEqual(mapChatDelta('nope'), [])
})

test('tool fragments keep their ordinal and only this delta arguments', () => {
  const parts = toolCallParts({ tool_calls: [{ index: 3, function: { arguments: 'X' } }] })
  assert.deepEqual(parts, [{ kind: 'tool-call', ordinal: 3, id: '', name: '', arguments: 'X' }])
})

test('a fragment without index falls back to its position', () => {
  const parts = toolCallParts({ tool_calls: [{ id: 'a' }, { id: 'b' }] })
  assert.deepEqual(parts.map((part) => part.ordinal), [0, 1])
})

test('an empty tool fragment is dropped', () => {
  assert.deepEqual(toolCallParts({ tool_calls: [{}] }), [])
  assert.deepEqual(toolCallParts({ tool_calls: [] }), [])
  assert.deepEqual(toolCallParts({}), [])
})

test('content is never inspected for tags: notation stays one text part', () => {
  const raw = '<thinking>a</thinking>[tool call bash #c]: {"command":"ls"}<invoke name="bash"></invoke>'
  const parts = mapChatDelta({ content: raw })
  assert.equal(parts.length, 1)
  assert.equal(parts[0].kind, 'text')
  assert.equal(parts[0].text, raw)
})

test('reasoning is never inspected for tags either', () => {
  const raw = 'plan </thinking> more'
  assert.deepEqual(mapChatDelta({ reasoning_content: raw }), [{ kind: 'reasoning', text: raw }])
})
