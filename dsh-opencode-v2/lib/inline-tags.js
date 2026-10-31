import { createStreamParser } from './stream-parser.js'
/**
 * Router and last-mile sanitiser for transcript notation that leaks into text.
 *
 * Measured 2026-10-31 in stored session records: some routes (and some model
 * habits) put DSH's own transcript notation into the *text* stream instead of
 * using the structured fields. Three shapes were seen in real sessions:
 *
 *   - `<thinking>…</thinking>` — often only a stray `</thinking>` survived
 *   - `[tool call bash #call_…]: {"command":"…"}` — well formed
 *   - `[tool call chatcmpl-0]: <prose>` / broken JSON — malformed
 *
 * v0.7.3 only converted the well-formed second shape and passed everything else
 * through "byte for byte"; the transcript therefore kept showing the notation.
 * v0.7.4 inverts the default: **no protocol marker reaches the model-visible
 * text, ever.** A marker with parseable arguments still becomes a real tool
 * call; anything else is stripped (the marker, and the payload when it is a
 * JSON object), leaving only the model's actual prose.
 */

/** Tag openings the router understands, longest first. */
const OPENERS = ['<antml:thinking>', '<thinking>', '[tool call ', '<antml:invoke', '<invoke']

/** Longest tag that can be split across two deltas; held back in text mode. */
const MAX_OPENER = Math.max(...OPENERS.map((opener) => opener.length))

/** Held bytes that may still belong to a closing `</thinking>` tag. */
const CLOSE_GUARD = '</antml:thinking>'.length

/** A held literal call is abandoned (released as text) beyond this size. */
const DEFAULT_MAX_HOLD = 8192

/** `[tool call bash #call_1]: {…}` — name, optional id, then the JSON arguments. */
const BRACKET_CALL = /^\[tool call ([^\s\]]+)(?:\s+#([^\]\s]+))?\]\s*:?\s*/

/** `<invoke name="bash">…</invoke>` with optional `antml:` prefix at every tag. */
const INVOKE_OPEN = /^<(antml:)?invoke\s+name="([^"]+)"/i

/** `<parameter name="command">ls</parameter>` */
const INVOKE_PARAM = /<(?:antml:)?parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/(?:antml:)?parameter>/gi

/** Any thinking tag, opening or closing, in any known spelling. */
const THINKING_TAG = /<\/?(?:antml:)?thinking>/gi

/** A whole `<invoke …>…</invoke>` block, any spelling. */
const INVOKE_BLOCK = /<(?:antml:)?invoke\b[\s\S]*?<\/(?:antml:)?invoke>/gi

/** A stray invoke/parameter tag with no block around it. */
const INVOKE_TAG = /<\/?(?:antml:)?(?:invoke|parameter)\b[^>]*>/gi

/** Any `[tool call name #id]` marker, wherever it sits in the text. */
const CALL_MARKER = /\[tool call [^\s\]]+(?:\s+#[^\]\s]+)?\]\s*:?\s*/g

/**
 * A compaction scratchpad block: `<analysis>…</analysis>`.
 *
 * The compaction prompt in this family ("an <analysis> block followed by a
 * <summary> block", inherited from Claude Code's /compact) designates the
 * analysis as a drafting scratchpad, not answer text. Upstream treats a leak of
 * it into visible output as a bug, not a rendering choice — see
 * QwenLM/qwen-code#6023, QwenLM/qwen-code#6595 and windmill-labs/windmill#9750.
 */
const ANALYSIS_BLOCK = /<analysis\b[^>]*>[\s\S]*?<\/analysis\s*>/gi
const ANALYSIS_OPEN = /<analysis\b[^>]*>/gi
/** The answer wrapper keeps its content; only the tags go. */
const SUMMARY_TAG = /<\/?summary\b[^>]*>/gi

/**
 * Fast pre-check: does this delta contain anything the router must look at?
 * @param {string} text - one content delta.
 * @returns {boolean} whether the delta carries a known inline tag.
 */
export function hasInlineTags(text) {
  return (
    typeof text === 'string' &&
    /<(?:antml:)?thinking>|\[tool call |<(?:antml:)?invoke|<analysis\b|<\/?summary\b/i.test(text)
  )
}

/**
 * The first complete JSON object in `text`, scanned with string/escape awareness.
 * @param {string} text - starting at or before `{`.
 * @returns {{ text: string, start: number } | null} the object and its offset.
 */
function takeJsonObject(text) {
  const start = text.search(/\S/)
  if (start < 0 || text[start] !== '{') return null
  let depth = 0
  let inString = false
  let escape = false
  for (let index = start; index < text.length; index += 1) {
    const ch = text[index]
    if (escape) {
      escape = false
      continue
    }
    if (ch === '\\') {
      escape = true
      continue
    }
    if (inString) {
      if (ch === '"') inString = false
      continue
    }
    if (ch === '"') {
      inString = true
      continue
    }
    if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) return { text: text.slice(start, index + 1), start }
    }
  }
  return null
}

/** @param {string} text - candidate JSON. @returns {boolean} whether it parses. */
function parsesJson(text) {
  try {
    JSON.parse(text)
    return true
  } catch {
    return false
  }
}

/**
 * Remove every protocol marker from a text fragment.
 *
 * This is the last mile: whatever the streaming scanner did or did not catch —
 * a marker split across deltas, a stray `</thinking>`, a marker with broken
 * arguments, or plain prose that imitates the transcript — the text handed to
 * the harness carries no protocol syntax. A marker followed by a JSON object
 * takes that object with it, because that object is the call's payload, not
 * something the model meant to say.
 *
 * @param {string} text - one text fragment.
 * @returns {string} the same fragment without protocol notation.
 */
export function sanitizeProtocolText(text) {
  if (typeof text !== 'string' || text.length === 0) return text
  const withoutScratchpad = dropScratchpad(text)
  const withoutInvoke = withoutScratchpad.replace(INVOKE_BLOCK, '').replace(INVOKE_TAG, '')
  const withoutTags = withoutInvoke.replace(THINKING_TAG, '')
  let out = ''
  let last = 0
  CALL_MARKER.lastIndex = 0
  for (let match = CALL_MARKER.exec(withoutTags); match !== null; match = CALL_MARKER.exec(withoutTags)) {
    out += withoutTags.slice(last, match.index)
    const afterMarker = match.index + match[0].length
    const payload = takeJsonObject(withoutTags.slice(afterMarker))
    if (payload !== null && parsesJson(payload.text)) {
      last = afterMarker + payload.start + payload.text.length
    } else {
      last = afterMarker
    }
    CALL_MARKER.lastIndex = last
  }
  return out + withoutTags.slice(last)
}

/**
 * Remove a leading protocol marker from a fragment that is *not* a usable call.
 *
 * This is the last mile of `drainCall`: once a marker is proven not to be a
 * call, its syntax must still never reach the text. Only the marker goes; the
 * prose around it stays.
 *
 * @param {string} text - fragment starting at a marker.
 * @returns {string} the fragment without its leading marker.
 */
function dropScratchpad(text) {
  // Only a response that *starts* with the scratchpad is a compaction answer.
  // A mention of <analysis> inside prose or a code fence must stay readable.
  if (!/^\s*<analysis\b/i.test(text)) return text.replace(SUMMARY_TAG, '')
  const closed = text.replace(ANALYSIS_BLOCK, '')
  ANALYSIS_OPEN.lastIndex = 0
  const open = ANALYSIS_OPEN.exec(closed)
  if (open === null) return closed.replace(SUMMARY_TAG, '')
  const rest = closed.slice(open.index + open[0].length)
  const closer = rest.toLowerCase().indexOf('</analysis')
  if (closer !== -1) {
    const after = rest.slice(closer + '</analysis'.length).replace(/^\s*>/, '')
    return (closed.slice(0, open.index) + after).replace(SUMMARY_TAG, '')
  }
  const summaryAt = rest.toLowerCase().indexOf('<summary')
  const kept = summaryAt === -1 ? '' : rest.slice(summaryAt)
  return (closed.slice(0, open.index) + kept).replace(SUMMARY_TAG, '')
}

function stripLeadingMarker(text) {
  const bracket = /^\[tool call\b[^\]]*\]?\s*:?\s*/i.exec(text)
  if (bracket !== null) return text.slice(bracket[0].length)
  const invoke = /^<(?:antml:)?invoke\b[^>]*>/i.exec(text)
  if (invoke !== null) return text.slice(invoke[0].length)
  return text
}

/**
 * Index of the earliest known opening tag in `text`.
 * @param {string} text - the pending buffer.
 * @returns {{ index: number, opener: string } | null} the earliest hit.
 */
function firstOpener(text) {
  let hit = null
  for (const opener of OPENERS) {
    const index = text.indexOf(opener)
    if (index < 0) continue
    if (hit === null || index < hit.index) hit = { index, opener }
  }
  return hit
}

/**
 * Length of the trailing fragment of `text` that could still become an opening
 * tag once the next delta arrives.
 * @param {string} text - the pending buffer.
 * @returns {number} bytes to hold back.
 */
function pendingOpenerTail(text) {
  const max = Math.min(text.length, MAX_OPENER - 1)
  for (let size = max; size > 0; size -= 1) {
    const tail = text.slice(text.length - size)
    if (OPENERS.some((opener) => opener.length > size && opener.startsWith(tail))) return size
  }
  return 0
}

/**
 * Split leaked transcript notation out of a text stream.
 *
 * @param {{ toolNames?: Set<string>, maxHold?: number }} [options] - `toolNames`
 *   gates conversion (an undeclared name is stripped, not executed); `maxHold`
 *   bounds a literal call that never completes.
 * @returns {{ push: (delta: string) => object[], flush: () => object[], stats: object }}
 *   `push` returns the parts resolved by this delta (`{ kind: 'text'|'reasoning',
 *   text }` or `{ kind: 'tool-call', id, name, arguments }`), `flush` returns
 *   whatever the stream ended with. Text parts are already sanitised.
 */

export function createInlineTagRouter(options = {}) {
  // The router IS the state machine now; see lib/stream-parser.js.
  return createStreamParser(options)
}
