/**
 * Conformance oracle (Tier C).
 *
 * The beta parser is checked against what recipe DOCUMENTS AND IMPLEMENTS, not
 * against its own output. Each case below is derived from a named source in
 * deepseek-recipe and carries that source in `ref`, so a failure says which
 * contract broke:
 *
 *   recipe:output-parser   deepseek-recipe/src/stream/output_parser.rs
 *   recipe:streaming       docs/streaming.md
 *   recipe:tokens          deepseek-recipe-core/src/special_tokens.rs
 *   plugin:measured        recorded adapter trace, 2026-11-01..11-04
 *
 * Two properties are asserted for every case:
 *
 *   1. SHAPE   - the parts, in order, are what the source says they must be.
 *   2. INVARIANCE - re-chunking the same bytes (every split, or a fixed stride)
 *      yields the same parts. This is the property the stable classifier states
 *      as I4 and can only test against itself.
 */
import { PART, createProtocolParser } from './protocol-parser.js'
import { SPECIAL_TOKENS } from './canonical-tokens.js'

/** Deterministic PRNG so a failing seed is reproducible. */
function mulberry32(seed) {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6D2B79F5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Split `text` into chunks of `size` code units. */
export function chunkFixed(text, size) {
  const out = []
  for (let index = 0; index < text.length; index += size) out.push(text.slice(index, index + size))
  return out.length === 0 ? [''] : out
}

/** Split `text` at random code-unit boundaries, at least one unit per chunk. */
export function chunkRandom(text, seed = 1, maxSize = 7) {
  const random = mulberry32(seed)
  const out = []
  let index = 0
  while (index < text.length) {
    const size = 1 + Math.floor(random() * maxSize)
    out.push(text.slice(index, index + size))
    index += size
  }
  return out.length === 0 ? [''] : out
}

/** Parse `chunks` with a fresh parser and return the parts in order. */
export function parseChunks(chunks, options = {}) {
  const parser = createProtocolParser(options)
  const parts = []
  for (const chunk of chunks) parts.push(...parser.push(chunk))
  parts.push(...parser.flush())
  return { parts, stats: parser.stats() }
}

/**
 * The canonical shape of a part list.
 *
 * Adjacent `text` parts (and adjacent `reasoning` parts) are merged first: a
 * stream that delivered the same bytes in more chunks must produce the same
 * shape, and a chunk boundary is not a protocol event. Every other kind stays a
 * separate entry, so order still matters everywhere it should.
 *
 * @param {object[]} parts - parser output, any chunking.
 * @returns {string[]} `kind:text` shapes, merged where merging is legal.
 */
export function shapeOf(parts) {
  const merged = []
  for (const part of parts) {
    const previous = merged[merged.length - 1]
    if (previous && (part.kind === PART.TEXT || part.kind === PART.REASONING) && previous.kind === part.kind) {
      previous.text += part.text
      continue
    }
    merged.push({ ...part })
  }
  return merged.map((part) => {
    if (part.kind === PART.TOOL_CALL) return `tool-call:${part.name}:${part.arguments}`
    if (part.kind === PART.NOTATION) return `notation:${part.reason}`
    return `${part.kind}:${part.text}`
  })
}

const DSML = SPECIAL_TOKENS.Dsml
const THINK_END = SPECIAL_TOKENS.ThinkingEnd
const THINK_START = SPECIAL_TOKENS.ThinkingStart

/**
 * The conformance corpus.
 *
 * Each entry: `{ name, ref, input, expected, options }` where `expected` is the
 * {@link shapeOf} array the source requires.
 */
export const CORPUS = Object.freeze([
  {
    name: 'plain prose is emitted verbatim, once',
    ref: 'recipe:output-parser (Stage::Text)',
    input: 'The file is large. I will read it in two parts.',
    expected: ['text:The file is large. I will read it in two parts.'],
  },
  {
    name: 'a thinking wrapper is reasoning content, never prose',
    ref: 'recipe:streaming (thinking mode keeps reasoning separate)',
    input: THINK_START + 'weighing it' + THINK_END + 'Done.',
    expected: ['reasoning:weighing it', 'text:Done.'],
  },
  {
    name: 'reasoning channel never becomes visible text',
    ref: 'recipe:streaming (thinking mode keeps reasoning separate)',
    input: THINK_START + 'private' + THINK_END,
    options: { channel: 'reasoning' },
    expected: ['reasoning:private'],
  },
  {
    name: 'a declared DSML call becomes a tool call, not text',
    ref: 'recipe:output-parser (add_tool_calls_open_branch)',
    input: '<' + DSML + 'invoke name="bash">'
      + '<' + DSML + 'parameter name="command">ls</' + DSML + 'parameter>'
      + '</' + DSML + 'invoke>',
    options: { toolNames: ['bash'] },
    expected: ['tool-call:bash:{"command":"ls"}'],
  },
  {
    name: 'an UNDECLARED call is notation, never a call',
    ref: 'plugin:measured (display-gate settle: undeclared)',
    input: '<' + DSML + 'invoke name="rm_rf">'
      + '<' + DSML + 'parameter name="path">/</' + DSML + 'parameter>'
      + '</' + DSML + 'invoke>',
    options: { toolNames: ['bash'] },
    expected: ['notation:undeclared-or-nameless'],
  },
  {
    name: 'prose that merely CONTAINS the notation stays prose',
    ref: 'recipe:output-parser (markers match special-token segments)',
    // The stable classifier fails exactly here (measured 2026-11-04): it erased
    // the sentence and re-armed the text as a call candidate.
    input: 'The model writes <' + DSML + 'invoke name="bash"> when it calls a tool.',
    options: { toolNames: ['bash'] },
    expected: ['text:The model writes ', 'notation:unterminated'],
  },
  {
    name: 'an unterminated block is dropped, never printed',
    ref: 'plugin:measured (I3: notation that cannot be parsed is dropped)',
    input: '<' + DSML + 'invoke name="bash">'
      + '<' + DSML + 'parameter name="command">ls',
    options: { toolNames: ['bash'] },
    expected: ['notation:unterminated'],
  },
])

/**
 * Run the corpus.
 *
 * @param {object} [options]
 * @param {boolean} [options.strict] - treat an unexpected extra part as a failure.
 * @returns {{ ok: boolean, failures: object[], checked: number }}
 */
export function runConformance(options = {}) {
  const failures = []
  let checked = 0
  for (const entry of CORPUS) {
    checked += 1
    const { parts } = parseChunks([entry.input], { ...entry.options })
    const actual = shapeOf(parts)
    const expected = entry.expected
    const matches = options.strict
      ? JSON.stringify(actual) === JSON.stringify(expected)
      : expected.every((shape) => actual.includes(shape))
    if (!matches) failures.push({ name: entry.name, ref: entry.ref, expected, actual })
  }
  return { ok: failures.length === 0, failures, checked }
}

/**
 * The re-chunking property: the same bytes split differently must parse the same.
 *
 * @param {object} [options]
 * @param {string[]} [options.inputs] - inputs to test; defaults to the corpus.
 * @param {number} [options.seeds] - random splits per input.
 * @returns {{ ok: boolean, failures: object[], checked: number }}
 */
export function runInvariance(options = {}) {
  const inputs = options.inputs ?? CORPUS.map((entry) => entry.input)
  const seeds = options.seeds ?? 5
  const failures = []
  let checked = 0
  for (const input of inputs) {
    const reference = shapeOf(parseChunks([input]).parts)
    const splits = [
      ...Array.from({ length: Math.min(input.length, 40) }, (_, index) => chunkFixed(input, index + 1)),
      ...Array.from({ length: seeds }, (_, seed) => chunkRandom(input, seed + 1)),
    ]
    for (const chunks of splits) {
      checked += 1
      const actual = shapeOf(parseChunks(chunks).parts)
      if (JSON.stringify(actual) !== JSON.stringify(reference)) {
        failures.push({ input, chunks: chunks.length, reference, actual })
        break
      }
    }
  }
  return { ok: failures.length === 0, failures, checked }
}
