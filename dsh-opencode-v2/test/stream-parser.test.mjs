/**
 * Contract tests for the pass-through reducer.
 *
 * lib/stream-parser.js used to be a tag-guessing state machine that re-typed
 * delta text by scanning for `<thinking>`, `[tool call …]` and `<invoke …>`.
 * Typing now happens upstream (lib/upstream-map.js), so what is left to prove is
 * negative: the reducer changes nothing — and, as the regression guard, text
 * that merely *looks* like transcript notation is returned verbatim rather than
 * converted back into reasoning or a tool call.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createPassThroughReducer } from '../lib/stream-parser.js'

/** One already-typed sequence covering every kind, in a fixed order. */
const MIXED = [
  { kind: 'reasoning', text: 'weigh the options' },
  { kind: 'text', text: 'Here is the plan.' },
  { kind: 'tool-call', id: 'call_1', name: 'bash', arguments: '{"command":"ls"}' },
  { kind: 'text', text: 'Done.' },
]

test('a mixed sequence comes back as the same array, same objects, same order', () => {
  const reducer = createPassThroughReducer()
  const out = reducer.push(MIXED)

  assert.equal(out, MIXED, 'push must return its own argument array, not a copy')
  assert.equal(out.length, MIXED.length, 'part count changed')
  for (let index = 0; index < MIXED.length; index += 1) {
    assert.equal(out[index], MIXED[index], 'part at ' + index + ' is not the same object')
    assert.equal(out[index].kind, MIXED[index].kind, 'kind at ' + index + ' changed')
  }
  assert.deepEqual(out, MIXED)
})

test('the order of kinds is preserved exactly', () => {
  const reducer = createPassThroughReducer()
  const kinds = reducer.push(MIXED).map((part) => part.kind)
  assert.deepEqual(kinds, ['reasoning', 'text', 'tool-call', 'text'])
})

test('pushPart returns a one-element array holding the same object', () => {
  const reducer = createPassThroughReducer()
  const part = { kind: 'text', text: 'only me' }
  const out = reducer.pushPart(part)

  assert.deepEqual(out, [part])
  assert.equal(out.length, 1)
  assert.equal(out[0], part)
})

test('pushPart returns [] for null and undefined', () => {
  const reducer = createPassThroughReducer()
  assert.deepEqual(reducer.pushPart(null), [])
  assert.deepEqual(reducer.pushPart(undefined), [])
  assert.deepEqual(reducer.stats, { text: 0, reasoning: 0, toolCall: 0, total: 0 })
})

test('push returns [] for non-array input instead of throwing', () => {
  const reducer = createPassThroughReducer()
  assert.deepEqual(reducer.push(null), [])
  assert.deepEqual(reducer.push(undefined), [])
  assert.deepEqual(reducer.push('a string delta'), [])
  assert.deepEqual(reducer.push({ kind: 'text', text: 'not an array' }), [])
  assert.deepEqual(reducer.stats, { text: 0, reasoning: 0, toolCall: 0, total: 0 })
})

test('flush is always empty: nothing is ever held back', () => {
  const reducer = createPassThroughReducer()

  assert.deepEqual(reducer.flush(), [], 'flush on a fresh reducer must be empty')
  reducer.push(MIXED)
  assert.deepEqual(reducer.flush(), [], 'flush after a push must be empty')
  assert.deepEqual(reducer.flush(), [], 'flush must stay empty when called twice')
  assert.deepEqual(reducer.pushPart({ kind: 'reasoning', text: 'r' }), [
    { kind: 'reasoning', text: 'r' },
  ])
  assert.deepEqual(reducer.flush(), [], 'flush after pushPart must be empty')
})

test('a push plus its flush equals the push, with no trailing parts', () => {
  const reducer = createPassThroughReducer()
  const streamed = [...reducer.push(MIXED), ...reducer.flush()]
  assert.deepEqual(streamed, MIXED)
})

test('stats count what passed through, per kind and in total', () => {
  const reducer = createPassThroughReducer()

  reducer.push([
    { kind: 'text', text: 'a' },
    { kind: 'reasoning', text: 'b' },
    { kind: 'tool-call', id: 'c1', name: 'bash', arguments: '{}' },
    { kind: 'text', text: 'c' },
    { kind: 'reasoning', text: 'd' },
    { kind: 'tool-call', id: 'c2', name: 'read', arguments: '{}' },
  ])

  assert.deepEqual(reducer.stats, { text: 2, reasoning: 2, toolCall: 2, total: 6 })
})

test('stats are live: pushPart and later pushes accumulate on the same object', () => {
  const reducer = createPassThroughReducer()
  const stats = reducer.stats

  reducer.pushPart({ kind: 'text', text: 'one' })
  assert.deepEqual(stats, { text: 1, reasoning: 0, toolCall: 0, total: 1 })

  reducer.push([{ kind: 'reasoning', text: 'two' }])
  assert.deepEqual(stats, { text: 1, reasoning: 1, toolCall: 0, total: 2 })
  assert.equal(reducer.stats, stats, 'stats must be one stable object, not a fresh copy')
})

test('stats do not count input that could not pass through', () => {
  const reducer = createPassThroughReducer()
  reducer.push('a bare string delta')
  reducer.push(null)
  reducer.pushPart(undefined)
  reducer.flush()
  assert.deepEqual(reducer.stats, { text: 0, reasoning: 0, toolCall: 0, total: 0 })
})

test('splitting the same parts across pushes equals one single push', () => {
  const head = [
    { kind: 'reasoning', text: 'think' },
    { kind: 'text', text: 'say ' },
  ]
  const middle = [
    { kind: 'tool-call', id: 'call_9', name: 'bash', arguments: '{"command":"pwd"}' },
  ]
  const tail = [{ kind: 'text', text: 'end' }]

  const whole = createPassThroughReducer()
  const once = [...whole.push([...head, ...middle, ...tail])]

  const split = createPassThroughReducer()
  const many = [...split.push(head), ...split.push(middle), ...split.push(tail)]

  assert.deepEqual(many, once)
  assert.deepEqual(many, [...head, ...middle, ...tail])
  assert.deepEqual(split.stats, whole.stats, 'stats must not depend on chunking')
})

// The regression guard. This module used to convert each of these into a
// reasoning or tool-call part by scanning characters; typing is upstream now,
// so text that happens to contain the old markers must survive untouched.
const NOTATION = [
  '<thinking>x</thinking>',
  '[tool call bash #c1]: {"command":"ls"}',
  '<invoke name="bash">',
]

for (const fixture of NOTATION) {
  test('notation is returned verbatim, never re-typed: ' + JSON.stringify(fixture), () => {
    const reducer = createPassThroughReducer()
    const part = { kind: 'text', text: fixture }
    const out = reducer.push([part])

    assert.deepEqual(out, [part])
    assert.equal(out[0].text, fixture, 'text was rewritten')
    assert.equal(out[0].kind, 'text', 'a text part changed kind')
    assert.equal(out.length, 1, 'a text part was split into several parts')
    assert.deepEqual(
      out.filter((candidate) => candidate.kind === 'tool-call'),
      [],
      'text was converted into a tool call',
    )
    assert.deepEqual(reducer.stats, { text: 1, reasoning: 0, toolCall: 0, total: 1 })
  })
}

test('all three notations inside one text part survive together', () => {
  const reducer = createPassThroughReducer()
  const text =
    'Before <thinking>x</thinking> after [tool call bash #c1]: {"command":"ls"} and <invoke name="bash"> tail'
  const out = reducer.push([{ kind: 'text', text }])

  assert.equal(out.length, 1)
  assert.equal(out[0].text, text)
  assert.deepEqual(reducer.stats, { text: 1, reasoning: 0, toolCall: 0, total: 1 })
})

test('every notation fixture also survives pushPart verbatim', () => {
  const reducer = createPassThroughReducer()
  for (const fixture of NOTATION) {
    const part = { kind: 'text', text: fixture }
    const out = reducer.pushPart(part)
    assert.equal(out.length, 1)
    assert.equal(out[0].text, fixture)
    assert.equal(out[0].kind, 'text')
  }
  assert.equal(reducer.stats.toolCall, 0, 'pushPart must never yield a tool call')
  assert.equal(reducer.stats.reasoning, 0, 'pushPart must never yield reasoning')
})

test('two reducers do not share state', () => {
  const first = createPassThroughReducer()
  const second = createPassThroughReducer()
  first.push([{ kind: 'text', text: 'only the first' }])
  assert.deepEqual(second.stats, { text: 0, reasoning: 0, toolCall: 0, total: 0 })
  assert.deepEqual(second.flush(), [])
})
