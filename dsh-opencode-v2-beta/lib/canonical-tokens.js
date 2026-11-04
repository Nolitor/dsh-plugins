/**
 * Canonical DeepSeek V4/V4.1 special-token table.
 *
 * Copied from deepseek-ai/deepseek-recipe `deepseek-recipe-core/src/special_tokens.rs`
 * (`SpecialToken::default_str`). Every spelling below was extracted from that
 * file and verified by code point, not by eye: the pipe is U+FF5C (FULLWIDTH
 * VERTICAL LINE) and the word separator inside a template token is U+2581
 * (LOWER ONE EIGHTH BLOCK). A table typed by hand from the rendered docs is
 * wrong in five of eighteen entries — that is why this file spells them with
 * escapes.
 *
 * Two facts from the source that change how a client must read them:
 *
 *   - `ThinkingStart` and `ThinkingEnd` are PLAIN spellings ('<thinking>' and
 *     '</thinking>'), not '｜…｜' template tokens. They are the tags the stable
 *     plugin already strips; the table keeps them because the model emits them.
 *   - Only the template tokens carry a special-token boundary. Recipe still
 *     models every marker as segments (`Segment::{Plain,Special}`), and matches
 *     a special segment only at a special-token boundary — which is what makes
 *     its match immune to the same spelling appearing inside prose.
 */

/** @typedef {{ kind: 'plain'|'special', text: string, token?: string }} Segment */

const PIPE = '\uFF5C'
const SEP = '\u2581'

/** The token names recipe defines, in its own order. */
export const SPECIAL_TOKEN_NAMES = Object.freeze([
  'Bos', 'Eos', 'ThinkingStart', 'ThinkingEnd', 'System', 'User', 'Assistant',
  'LatestReminder', 'Dsml', 'Image', 'Ref', 'RefEnd', 'Box', 'BoxEnd', 'Point',
  'PointEnd', 'Polygon', 'PolygonEnd',
])

/**
 * The spellings, code point for code point from `SpecialToken::default_str`.
 *
 * @type {Readonly<Record<string, string>>}
 */
export const SPECIAL_TOKENS = Object.freeze({
  Bos: `<${PIPE}begin${SEP}of${SEP}sentence${PIPE}>`,
  Eos: `<${PIPE}end${SEP}of${SEP}sentence${PIPE}>`,
  ThinkingStart: '<thinking>',
  ThinkingEnd: '</thinking>',
  System: `<${PIPE}System${PIPE}>`,
  User: `<${PIPE}User${PIPE}>`,
  Assistant: `<${PIPE}Assistant${PIPE}>`,
  LatestReminder: `<${PIPE}latest_reminder${PIPE}>`,
  Dsml: `${PIPE}DSML${PIPE}`,
  Image: `<${PIPE}image${PIPE}>`,
  Ref: `<${PIPE}ref${PIPE}>`,
  RefEnd: `<${PIPE}/ref${PIPE}>`,
  Box: `<${PIPE}box${PIPE}>`,
  BoxEnd: `<${PIPE}/box${PIPE}>`,
  Point: `<${PIPE}point${PIPE}>`,
  PointEnd: `<${PIPE}/point${PIPE}>`,
  Polygon: `<${PIPE}polygon${PIPE}>`,
  PolygonEnd: `<${PIPE}/polygon${PIPE}>`,
})

/** Which entries the model may emit in OUTPUT (a prompt-only token is not output). */
export const OUTPUT_TOKENS = Object.freeze([
  'ThinkingStart', 'ThinkingEnd', 'Dsml', 'Ref', 'RefEnd', 'Box', 'BoxEnd',
  'Point', 'PointEnd', 'Polygon', 'PolygonEnd',
])

/**
 * The markers this parser tracks, and therefore the only spellings it holds back.
 *
 * Holding back a suffix is only needed for a marker that is actually matched.
 * Tracking the whole table would hold back 25+ code units per delta for tokens
 * this adapter never handles.
 */
export const TRACKED_MARKERS = Object.freeze([
  SPECIAL_TOKENS.ThinkingStart,
  SPECIAL_TOKENS.ThinkingEnd,
  SPECIAL_TOKENS.Dsml,
  `<${SPECIAL_TOKENS.Dsml}`,
  `</${SPECIAL_TOKENS.Dsml}`,
])

/** Longest tracked marker; the maximum any matcher must hold back. */
export const MAX_TOKEN_LEN = Math.max(...TRACKED_MARKERS.map((value) => value.length))

/** The longest spelling in the canonical table (for reference and tests). */
export const MAX_TABLE_TOKEN_LEN = Math.max(...Object.values(SPECIAL_TOKENS).map((value) => value.length))

/**
 * Build a marker as recipe does: plain text and special tokens, in order.
 *
 * @param {...(string|{token: string})} parts - plain strings, or `{ token }`.
 * @returns {Segment[]}
 */
export function marker(...parts) {
  const out = []
  for (const part of parts) {
    if (typeof part === 'string') {
      if (part.length > 0) out.push({ kind: 'plain', text: part })
      continue
    }
    if (part && typeof part.token === 'string') {
      const text = SPECIAL_TOKENS[part.token]
      if (text === undefined) throw new Error(`unknown special token ${part.token}`)
      out.push({ kind: 'special', text, token: part.token })
    }
  }
  return out
}

/** The spelling of a marker, for logs and for a plain-text fallback. */
export function markerText(segments) {
  return (segments ?? []).map((segment) => segment.text).join('')
}

/**
 * Normalise the glyph drift measured in live traffic onto the canonical spelling.
 *
 * The model reproduces U+FF5C with whatever pipe it has — U+FF5C (fullwidth),
 * U+2502 (box drawing) or U+007C (ascii), sometimes doubled — and sometimes
 * writes a plain space where U+2581 belongs. The table stays canonical; only the
 * MATCHING is normalised, so a drifted token is recognised without the parser
 * ever treating drift as correct.
 *
 * Length is preserved so an index computed on the normalised text is valid on
 * the raw text.
 *
 * @param {string} text - raw model output.
 * @returns {string} the same-length text with pipes normalised to one U+FF5C.
 */
export function normalizeGlyphs(text) {
  if (typeof text !== 'string' || text.length === 0) return ''
  // Two pipes collapse to one canonical pipe plus one filler that keeps length.
  return text.replace(/[\u2502\uFF5C|]{2}/g, PIPE + PIPE).replace(/[\u2502|]/g, PIPE)
}
