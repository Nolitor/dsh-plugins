/**
 * Beta parser conformance (Tier C).
 *
 * The oracle lives in lib/conformance.js and carries the recipe source for every
 * case, so a failure names the contract that broke rather than the expectation
 * that changed.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  MAX_TABLE_TOKEN_LEN,
  SPECIAL_TOKENS,
  marker,
  markerText,
  normalizeGlyphs,
} from '../lib/canonical-tokens.js'
import { HOLD_BACK, MARKERS, PART, STAGE, createProtocolParser } from '../lib/protocol-parser.js'
import {
  CORPUS,
  chunkFixed,
  chunkRandom,
  parseChunks,
  runConformance,
  runInvariance,
  shapeOf,
} from '../lib/conformance.js'

test('the token table matches recipe code point for code point', () => {
  // Extracted from deepseek-recipe-core/src/special_tokens.rs; the pipe is
  // U+FF5C and the word separator U+2581. A table transcribed from rendered
  // docs gets five of these wrong, so each is asserted explicitly.
  assert.equal(SPECIAL_TOKENS.Dsml, '\uFF5CDSML\uFF5C')
  assert.equal(SPECIAL_TOKENS.User, '<\uFF5CUser\uFF5C>')
  assert.equal(SPECIAL_TOKENS.Assistant, '<\uFF5CAssistant\uFF5C>')
  assert.equal(SPECIAL_TOKENS.System, '<\uFF5CSystem\uFF5C>')
  assert.equal(SPECIAL_TOKENS.LatestReminder, '<\uFF5Clatest_reminder\uFF5C>')
  assert.equal(SPECIAL_TOKENS.Bos, '<\uFF5Cbegin\u2581of\u2581sentence\uFF5C>')
  assert.equal(SPECIAL_TOKENS.Eos, '<\uFF5Cend\u2581of\u2581sentence\uFF5C>')
  assert.equal(SPECIAL_TOKENS.ThinkingStart, '<thinking>')
  assert.equal(SPECIAL_TOKENS.ThinkingEnd, '</thinking>')
  assert.equal(SPECIAL_TOKENS.Image, '<\uFF5Cimage\uFF5C>')
})

test('hold-back is bounded by the longest MATCHED marker sequence', () => {
  // Holding back a token spelling alone is not enough: '<｜DSML｜i' is longer than
  // '<｜DSML｜' and not a prefix of it, so 1-character chunking emitted the opener
  // as prose. The bound must cover the whole opener, closer and parameter tags.
  assert.equal(HOLD_BACK, Math.max(...MARKERS.map((value) => value.length)) - 1)
  assert.ok(MARKERS.some((value) => value.includes('invoke name="')))
  assert.ok(MARKERS.some((value) => value.includes('parameter>')))
  assert.ok(HOLD_BACK < 40, 'a hold-back larger than a short word would stall prose')
})

test('a marker is segments, as recipe models it', () => {
  const built = marker('<', { token: 'Dsml' }, 'invoke name="x"')
  assert.deepEqual(built.map((segment) => segment.kind), ['plain', 'special', 'plain'])
  assert.equal(built[1].token, 'Dsml')
  assert.equal(markerText(built), '<\uFF5CDSML\uFF5Cinvoke name="x"')
  assert.throws(() => marker({ token: 'Nope' }), /unknown special token/)
})

test('glyph drift is normalised without changing length', () => {
  const drifted = '<\u2502DSML\u2502>'
  const normalised = normalizeGlyphs(drifted)
  assert.equal(normalised, '<\uFF5CDSML\uFF5C>')
  assert.equal(normalised.length, drifted.length)
  assert.equal(normalizeGlyphs(''), '')
  assert.ok(normalizeGlyphs('<|DSML|>').includes('\uFF5C'))
})

test('the conformance corpus passes', () => {
  const result = runConformance()
  assert.equal(result.ok, true, JSON.stringify(result.failures, null, 1))
  assert.equal(result.checked, CORPUS.length)
})

test('every corpus input is invariant under re-chunking', () => {
  const result = runInvariance()
  assert.equal(result.ok, true, JSON.stringify(result.failures.slice(0, 2), null, 1))
  assert.ok(result.checked > 100)
})

test('the parser declares its stage vocabulary', () => {
  assert.deepEqual(Object.values(STAGE).sort(), ['arguments', 'calls', 'text', 'value'])
  const parser = createProtocolParser()
  assert.equal(parser.stage(), STAGE.TEXT)
  assert.equal(parser.version, '1.0.0')
})

test('an adversarial re-chunking of prose keeps it verbatim', () => {
  const prose = 'The model writes <\uFF5CDSML\uFF5Cinvoke name="bash"> when it calls a tool.'
  const reference = shapeOf(parseChunks([prose], { toolNames: ['bash'] }).parts)
  for (let size = 1; size <= prose.length; size += 1) {
    const actual = shapeOf(parseChunks(chunkFixed(prose, size), { toolNames: ['bash'] }).parts)
    assert.deepEqual(actual, reference, 'chunk size ' + size)
  }
})

test('a declared call survives every chunk boundary', () => {
  const input = '<\uFF5CDSML\uFF5Cinvoke name="bash"><\uFF5CDSML\uFF5Cparameter name="command">echo hi</\uFF5CDSML\uFF5Cparameter></\uFF5CDSML\uFF5Cinvoke>'
  const expected = shapeOf(parseChunks([input], { toolNames: ['bash'] }).parts)
  assert.deepEqual(expected, ['tool-call:bash:{"command":"echo hi"}'])
  for (let seed = 1; seed <= 20; seed += 1) {
    const actual = shapeOf(parseChunks(chunkRandom(input, seed), { toolNames: ['bash'] }).parts)
    assert.deepEqual(actual, expected, 'seed ' + seed)
  }
})

test('two parameters keep their order and their values', () => {
  const input = '<\uFF5CDSML\uFF5Cinvoke name="read"><\uFF5CDSML\uFF5Cparameter name="file_path">a.md</\uFF5CDSML\uFF5Cparameter><\uFF5CDSML\uFF5Cparameter name="limit">10</\uFF5CDSML\uFF5Cparameter></\uFF5CDSML\uFF5Cinvoke>'
  const parts = parseChunks([input], { toolNames: ['read'] }).parts
  assert.deepEqual(JSON.parse(parts[0].arguments), { file_path: 'a.md', limit: '10' })
  assert.deepEqual(shapeOf(parts), ['tool-call:read:{"file_path":"a.md","limit":"10"}'])
})

test('flush reports an unterminated block exactly once', () => {
  const parser = createProtocolParser({ toolNames: ['bash'] })
  parser.push('<\uFF5CDSML\uFF5Cinvoke name="bash">')
  const parts = parser.flush()
  assert.deepEqual(shapeOf(parts), ['notation:unterminated'])
  assert.deepEqual(shapeOf(parser.flush()), [], 'a second flush must not repeat the report')
})

test('reasoning channel output is never text', () => {
  const parts = parseChunks([SPECIAL_TOKENS.ThinkingStart + 'secret' + SPECIAL_TOKENS.ThinkingEnd], { channel: 'reasoning' }).parts
  assert.deepEqual(parts.map((part) => part.kind), [PART.REASONING])
})
