/**
 * State-machine parser tests.
 *
 * The point of this file is the last block: a property test that re-chunks the
 * same input every possible way and demands identical output. Every chunk-boundary
 * bug this codebase has had (0.7.3 through 0.7.7) would have been caught here.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createStreamParser } from '../lib/stream-parser.js'

const tools = new Set(['bash', 'read'])

/** Run one whole input through a fresh parser. */
function parseWhole(input, options = {}) {
  const parser = createStreamParser({ toolNames: tools, ...options })
  return [...parser.push(input), ...parser.flush()]
}

/** Run the same input split at the given offsets. */
function parseChunks(input, cuts, options = {}) {
  const parser = createStreamParser({ toolNames: tools, ...options })
  const out = []
  let prev = 0
  for (const cut of [...cuts, input.length]) {
    if (cut <= prev) continue
    out.push(...parser.push(input.slice(prev, cut)))
    prev = cut
  }
  out.push(...parser.flush())
  return out
}

/**
 * Canonicalise a part sequence for comparison.
 *
 * Streaming legitimately fragments text (one part per delta), so the invariant
 * cannot be about part boundaries. It is about *content and order*: adjacent
 * text parts merge, adjacent reasoning parts merge, tool-calls stay whole.
 */
function canon(parts) {
  const out = []
  for (const part of parts) {
    const prev = out[out.length - 1]
    if (prev && (part.kind === 'text' || part.kind === 'reasoning') && prev.kind === part.kind) {
      out[out.length - 1] = { kind: part.kind, text: prev.text + part.text }
    } else {
      out.push({ ...part })
    }
  }
  return JSON.stringify(out)
}
/** Join text parts, so prose preservation can be asserted on its own. */
function allText(parts) {
  return parts.filter((p) => p.kind === 'text').map((p) => p.text).join('')
}

const FIXTURES = [
  'plain prose with no notation at all',
  'Now I will look.\n\nMore prose after a gap.',
  '[tool call bash #c1]: {"command":"ls -la"}\nDone.',
  'Before. [tool call bash #c2]: {"command":"a \\"quoted\\" b"} After.',
  '<thinking>weigh the options</thinking>Then the answer.',
  '<antml:thinking>nested</antml:thinking>tail text',
  '<invoke name="bash"><parameter name="command">pwd</parameter></invoke>then prose',
  'a < b and c > d, with <summary>kept</summary> and [brackets] left alone',
  '[tool call unknown #c3]: {"command":"nope"} trailing prose',
  '[tool call bash #c4]: {"command": broken json, tail prose',
  '<thinking>unterminated reasoning runs to the end',
]

test('plain prose passes through byte for byte', () => {
  const parts = parseWhole('just words, nothing else')
  assert.deepEqual(parts, [{ kind: 'text', text: 'just words, nothing else' }])
})

test('a whole bracket call becomes a tool-call part', () => {
  const parts = parseWhole('[tool call bash #c1]: {"command":"ls -la"}')
  const calls = parts.filter((p) => p.kind === 'tool-call')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'bash')
  assert.equal(calls[0].id, 'c1')
  assert.equal(calls[0].arguments, '{"command":"ls -la"}')
  assert.equal(allText(parts), '')
})

test('prose around a call is preserved in order', () => {
  const parts = parseWhole('Before. [tool call bash #c2]: {"command":"pwd"} After.')
  assert.equal(allText(parts).replace(/\s+/g, ' ').trim(), 'Before. After.')
  assert.equal(parts.filter((p) => p.kind === 'tool-call').length, 1)
})

test('a thinking block becomes reasoning, not text', () => {
  const parts = parseWhole('<thinking>weigh</thinking>Answer.')
  assert.equal(parts.filter((p) => p.kind === 'reasoning').map((p) => p.text).join(''), 'weigh')
  assert.equal(allText(parts), 'Answer.')
})

test('an invoke block becomes a tool-call with parsed parameters', () => {
  const parts = parseWhole('<invoke name="bash"><parameter name="command">pwd</parameter></invoke>')
  const calls = parts.filter((p) => p.kind === 'tool-call')
  assert.equal(calls.length, 1)
  assert.deepEqual(JSON.parse(calls[0].arguments), { command: 'pwd' })
})

test('an undeclared tool is not executed', () => {
  const parts = parseWhole('[tool call forged #c3]: {"command":"rm -rf /"}')
  assert.equal(parts.filter((p) => p.kind === 'tool-call').length, 0)
})

test('I3: a malformed payload degrades to text instead of being swallowed', () => {
  const input = '[tool call bash #c4]: {"command": broken json, tail prose'
  const parts = parseWhole(input)
  const text = allText(parts)
  assert.ok(text.includes('tail prose'), 'body text was swallowed: ' + JSON.stringify(text))
})

test('I4: output is identical for every two-way split of every fixture', () => {
  for (const input of FIXTURES) {
    const whole = canon(parseWhole(input))
    for (let cut = 1; cut < input.length; cut++) {
      const split = canon(parseChunks(input, [cut]))
      assert.equal(split, whole, 'fixture split at ' + cut + ' differs from whole: ' + JSON.stringify(input))
    }
  }
})

test('I4: output is identical for random multi-way splits', () => {
  for (const input of FIXTURES) {
    if (input.length < 3) continue
    const whole = canon(parseWhole(input))
    for (let run = 0; run < 40; run++) {
      const cuts = []
      for (let cut = 1; cut < input.length; cut++) if (Math.random() < 0.3) cuts.push(cut)
      const split = canon(parseChunks(input, cuts))
      assert.equal(split, whole, 'random split differs: ' + JSON.stringify(input) + ' cuts=' + cuts.join(','))
    }
  }
})

test('I2: the parser never holds more than a marker prefix while in text', () => {
  const parser = createStreamParser({ toolNames: tools })
  parser.push('hello world, still prose and getting longer')
  const parts = parser.push('more and more prose')
  assert.ok(allText(parts).includes('more and more prose'), 'prose was held back')
})

// The short tag form. Measured 2026-11-01 02:10: the model emitted <think> and the
// parser only knew <thinking>, so private reasoning was rendered as text.
test('the short <think> form is reasoning, not text', () => {
  const parts = parseWhole('<think>private reasoning</think>Answer text')
  assert.equal(parts.filter((p) => p.kind === 'reasoning').map((p) => p.text).join(''), 'private reasoning')
  assert.equal(allText(parts), 'Answer text')
})

test('<think> survives re-chunking at every split', () => {
  const input = '<think>a</think>B<think>c</think>D'
  const whole = canon(parseWhole(input))
  for (let cut = 1; cut < input.length; cut++) {
    assert.equal(canon(parseChunks(input, [cut])), whole, 'split at ' + cut)
  }
})
