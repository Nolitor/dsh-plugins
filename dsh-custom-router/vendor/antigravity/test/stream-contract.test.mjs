/**
 * P2 binding tests: this provider against the shared downstream pipe.
 *
 * The pipe owns the lifecycle; these tests pin the provider edge only — what a
 * Gemini frame means, and that the shared core absorbed the vendor quirks.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  STREAM_DESCRIPTOR,
  STREAM_HOOKS,
  candidateOf,
  classify,
  mapFinish,
  partsOf,
  readEvent,
  usageFrom,
} from '../lib/stream-contract.js'

const frame = (candidate, usageMetadata) => ({
  response: { candidates: [{ content: { parts: candidate.parts }, ...(candidate.finishReason ? { finishReason: candidate.finishReason } : {}) }], ...(usageMetadata ? { usageMetadata } : {}) },
})

test('the descriptor declares a complete tool-call shape and the thoughts formula', () => {
  assert.deepEqual(STREAM_DESCRIPTOR, {
    toolCallShape: 'complete',
    usage: { totalFormula: 'prompt+output+reasoning' },
    malformedRecord: 'fail',
  })
})

test('the descriptor is frozen so a consumer cannot mutate the shared contract', () => {
  assert.equal(Object.isFrozen(STREAM_DESCRIPTOR), true)
  assert.equal(Object.isFrozen(STREAM_DESCRIPTOR.usage), true)
})

test('candidateOf unwraps the response envelope and refuses an empty list', () => {
  assert.deepEqual(candidateOf({ response: { candidates: [{ a: 1 }] } }), { a: 1 })
  assert.deepEqual(candidateOf({ candidates: [{ a: 2 }] }), { a: 2 })
  assert.equal(candidateOf({ response: { candidates: [] } }), undefined)
  assert.equal(candidateOf({}), undefined)
})

test('partsOf never returns undefined', () => {
  assert.deepEqual(partsOf({ content: { parts: [{ text: 'x' }] } }), [{ text: 'x' }])
  assert.deepEqual(partsOf({}), [])
  assert.deepEqual(partsOf(undefined), [])
})

test('classify separates thought, text, call and opaque signature', () => {
  assert.equal(classify({ text: 'x', thought: true }), 'reasoning')
  assert.equal(classify({ text: 'x' }), 'text')
  assert.equal(classify({ functionCall: { name: 'f' } }), 'tool-call')
  assert.equal(classify({ thoughtSignature: 'sig' }), 'other')
})

test('a thought signature never reaches the record', () => {
  const record = readEvent(frame({ parts: [{ thoughtSignature: 'opaque' }, { text: 'visible' }] }))
  assert.deepEqual(record.parts, [{ kind: 'text', text: 'visible' }])
})

test('a functionCall thoughtSignature is preserved for replay', () => {
  const record = readEvent(frame({ parts: [{ functionCall: { name: 'read_file', args: { path: '/tmp/x' }, id: 'g1' }, thoughtSignature: 'sig' }] }))
  assert.deepEqual(record.parts, [
    { kind: 'tool-call', id: 'g1', name: 'read_file', arguments: { path: '/tmp/x' }, thoughtSignature: 'sig' },
  ])
})

test('text and reasoning parts map to the pipe vocabulary', () => {
  const record = readEvent(frame({ parts: [{ text: 'think', thought: true }, { text: 'answer' }] }))
  assert.deepEqual(record.parts, [
    { kind: 'reasoning', text: 'think' },
    { kind: 'text', text: 'answer' },
  ])
})

test('an empty text part is dropped instead of opening a block', () => {
  assert.equal(readEvent(frame({ parts: [{ text: '' }] })).parts, undefined)
})

test('a complete functionCall maps to one whole tool-call part', () => {
  const record = readEvent(frame({ parts: [{ functionCall: { name: 'read_file', args: { path: '/tmp/x' }, id: 'g1' } }] }))
  assert.deepEqual(record.parts, [
    { kind: 'tool-call', id: 'g1', name: 'read_file', arguments: { path: '/tmp/x' } },
  ])
})

test('a call without an id gets a synthesised one so the pipe never invents a policy', () => {
  const record = readEvent(frame({ parts: [{ functionCall: { name: 'f', args: {} } }] }))
  assert.equal(record.parts[0].kind, 'tool-call')
  assert.match(record.parts[0].id, /^antigravity-/)
})

test('a call with no args still carries an object, never undefined', () => {
  const record = readEvent(frame({ parts: [{ functionCall: { name: 'f' } }] }))
  assert.deepEqual(record.parts[0].arguments, {})
})

test('usageMetadata is handed over raw so the shared writer owns the buckets', () => {
  const metadata = { promptTokenCount: 10, candidatesTokenCount: 2, thoughtsTokenCount: 3, cachedContentTokenCount: 4, totalTokenCount: 15 }
  assert.deepEqual(readEvent(frame({ parts: [{ text: 'x' }] }, metadata)).usage, metadata)
})

test('a frame with no candidate is skipped rather than emitted as an empty record', () => {
  assert.equal(readEvent({ response: { candidates: [] } }), undefined)
})

test('the [DONE] sentinel becomes a done record', () => {
  assert.deepEqual(readEvent({ done: true }), { done: true })
})

test('mapFinish uses the one shared table, including the filtered class', () => {
  assert.deepEqual(mapFinish('STOP'), { kind: 'stop' })
  assert.deepEqual(mapFinish('MAX_TOKENS'), { kind: 'max-tokens' })
  const safety = mapFinish('SAFETY')
  assert.equal(safety.kind, 'error')
  assert.equal(safety.failure.code, 'CONTENT_FILTERED')
})

test('every mapped failure carries both message and code (the D3 defect)', () => {
  for (const value of ['SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII', 'OTHER', 'unmapped_reason']) {
    const reason = mapFinish(value)
    assert.equal(reason.kind, 'error', value)
    assert.equal(typeof reason.failure.message, 'string', value)
    assert.ok(reason.failure.message.length > 0, value)
    assert.equal(typeof reason.failure.code, 'string', value)
    assert.ok(reason.failure.code.length > 0, value)
    assert.equal(reason.failure.kind, undefined, 'the extra non-contract key must be gone')
  }
})

test('thoughts are counted in the total because candidates exclude them', () => {
  const usage = usageFrom({ promptTokenCount: 18, candidatesTokenCount: 32, thoughtsTokenCount: 655, totalTokenCount: 705 })
  assert.deepEqual(usage, {
    inputTokens: 18,
    outputTokens: 32,
    reasoningTokens: 655,
    totalTokens: 705,
  })
})

test('promptTokenCount includes cache hits, so input is the uncached remainder', () => {
  const usage = usageFrom({ promptTokenCount: 1000, candidatesTokenCount: 20, cachedContentTokenCount: 800, totalTokenCount: 1020 })
  assert.equal(usage.inputTokens, 200)
  assert.equal(usage.cacheReadTokens, 800)
})

test('an inconsistent provider total is omitted rather than repaired', () => {
  const usage = usageFrom({ promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 999 })
  assert.equal(usage.totalTokens, undefined)
})

test('the hook set is exactly the three the pipeline calls', () => {
  assert.deepEqual(Object.keys(STREAM_HOOKS).sort(), ['mapFinish', 'readEvent', 'usageFrom'])
  for (const hook of Object.values(STREAM_HOOKS)) assert.equal(typeof hook, 'function')
})
