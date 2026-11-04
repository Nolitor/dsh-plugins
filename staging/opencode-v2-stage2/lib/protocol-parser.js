/**
 * Deterministic protocol parser for DeepSeek V4/V4.1 output (beta track).
 *
 * Tier B: the replacement for the stable classifier's regex scanner. Its shape is
 * recipe's `OutputParser` (`deepseek-recipe/src/stream/output_parser.rs`):
 *
 *   - an explicit STAGE MACHINE per block, not a pattern set applied to prose;
 *   - every marker is matched as a whole sequence (plain text plus the canonical
 *     special-token spellings), so a parameter is never found by guessing where
 *     the block ends;
 *   - a partial marker is retained, and at most (longest TRACKED marker - 1) code
 *     units are held back while the shape is undecided;
 *   - notation that cannot be completed is DROPPED, never printed;
 *   - the parse shape is invariant under re-chunking.
 *
 * Stage flow, mirroring recipe:
 *
 *   text --'<DSML invoke name="X">'--> arguments --'<DSML parameter name="k">'--> value
 *        <--'</DSML invoke>'----------            <--'</DSML parameter>'----------
 *
 * A block that is opened and never closed is reported as `notation:unterminated`,
 * never as a call: an unterminated call would execute with half its arguments.
 */
import { SPECIAL_TOKENS, marker, markerText, normalizeGlyphs } from './canonical-tokens.js'

/** Parser stages, in recipe's order. */
export const STAGE = Object.freeze({
  TEXT: 'text',
  CALLS: 'calls',
  ARGUMENTS: 'arguments',
  VALUE: 'value',
})

/** Bumped whenever the parse result could differ for the same input. */
export const PARSER_VERSION = '1.0.0'

const DSML = SPECIAL_TOKENS.Dsml
const DSML_OPEN = markerText(marker('<', { token: 'Dsml' }))
const DSML_CLOSE = markerText(marker('</', { token: 'Dsml' }))
const PARAM_OPEN = DSML_OPEN + 'parameter name="'
const PARAM_CLOSE = DSML_CLOSE + 'parameter>'
const INVOKE_CLOSE = DSML_CLOSE + 'invoke>'
const CALLS_CLOSE = [DSML_CLOSE + 'calls>', DSML_CLOSE + 'tool_calls>']

/**
 * Every marker this parser matches, AS THE WHOLE SEQUENCE.
 *
 * Holding back a suffix only protects a marker that is actually matched, and a
 * marker is the full opener/closer — not just its token spelling. Tracking
 * '<｜DSML｜' alone lost the opener at '<｜DSML｜i' (measured: 1-character chunking
 * turned a complete call into prose), because that buffer is longer than the
 * token and not a prefix of it.
 */
export const MARKERS = Object.freeze([
  SPECIAL_TOKENS.ThinkingStart,
  SPECIAL_TOKENS.ThinkingEnd,
  DSML_OPEN + 'invoke name="',
  PARAM_OPEN,
  PARAM_CLOSE,
  INVOKE_CLOSE,
  ...CALLS_CLOSE,
])

/** How many code units a marker match may hold back. */
export const HOLD_BACK = Math.max(...MARKERS.map((value) => value.length)) - 1

/** Statuses a part can carry. */
export const PART = Object.freeze({
  TEXT: 'text',
  REASONING: 'reasoning',
  TOOL_CALL: 'tool-call',
  NOTATION: 'notation',
})

/** Attribute value reader: returns the value and the code units consumed. */
function readQuoted(text, markerTextValue) {
  if (!text.startsWith(markerTextValue)) return null
  const end = text.indexOf('"', markerTextValue.length)
  if (end < 0) return null
  return { value: text.slice(markerTextValue.length, end), size: end + 1 }
}

/** Longest suffix of `text` that could still become a tracked marker. */
function heldTailSize(text) {
  const limit = Math.min(HOLD_BACK, text.length)
  for (let size = limit; size > 0; size -= 1) {
    const tail = text.slice(text.length - size)
    if (MARKERS.some((tracked) => tracked.startsWith(tail))) return size
  }
  return 0
}

/**
 * Create a parser.
 *
 * @param {object} [options]
 * @param {Iterable<string>} [options.toolNames] - declared names. A recovered
 *   call whose name is not declared is reported as `notation`, never as a call.
 * @param {'text'|'reasoning'} [options.channel] - channel prose is emitted on.
 * @returns {{ push: Function, flush: Function, stage: Function, stats: Function, version: string }}
 */
export function createProtocolParser(options = {}) {
  const toolNames = options.toolNames instanceof Set ? options.toolNames : new Set(options.toolNames ?? [])
  const channel = options.channel === 'reasoning' ? PART.REASONING : PART.TEXT
  const stats = { calls: 0, dropped: 0, unterminated: 0, thinking: 0 }

  let stage = STAGE.TEXT
  let buffer = ''
  // Whether a DSML block was opened and has not been closed yet. Tracked so an
  // unterminated block is REPORTED even when its bytes were already consumed.
  let blockOpened = false
  let callName = ''
  let args = {}
  let argsOrder = []
  let key = ''
  let value = ''

  function resetCall() {
    callName = ''
    args = {}
    argsOrder = []
    key = ''
    value = ''
  }

  function finishCall(out) {
    const complete = callName.length > 0
    if (!complete) {
      stats.dropped += 1
      out.push({ kind: PART.NOTATION, text: '', reason: 'nameless-call' })
      resetCall()
      return
    }
    const argumentsText = argsOrder.length === 0
      ? '{}'
      : '{' + argsOrder.map((name) => JSON.stringify(name) + ':' + args[name]).join(',') + '}'
    if (!toolNames.has(callName)) {
      stats.dropped += 1
      out.push({ kind: PART.NOTATION, text: '', reason: 'undeclared-or-nameless' })
      resetCall()
      return
    }
    stats.calls += 1
    out.push({ kind: PART.TOOL_CALL, id: '', name: callName, arguments: argumentsText, source: 'notation' })
    resetCall()
  }

  /** Emit `text` on the prose channel (only ever outside a call block). */
  function emitText(out, text) {
    if (text.length === 0) return
    out.push({ kind: channel, text })
  }

  /**
   * Consume one marker or character. Returns whether progress was made.
   */
  function step(out) {
    if (buffer.length === 0) return false

    if (stage === STAGE.TEXT) {
      const next = [SPECIAL_TOKENS.ThinkingStart, SPECIAL_TOKENS.ThinkingEnd, DSML_OPEN]
        .map((candidate) => buffer.indexOf(candidate))
        .filter((index) => index >= 0)
        .sort((left, right) => left - right)[0]
      if (next === undefined) {
        const hold = heldTailSize(buffer)
        emitText(out, buffer.slice(0, buffer.length - hold))
        buffer = buffer.slice(buffer.length - hold)
        return false
      }
      if (next > 0) {
        emitText(out, buffer.slice(0, next))
        buffer = buffer.slice(next)
        return true
      }
      if (buffer.startsWith(SPECIAL_TOKENS.ThinkingStart)) {
        stats.thinking += 1
        const close = buffer.indexOf(SPECIAL_TOKENS.ThinkingEnd)
        if (close < 0) {
          // Hold a partial thinking block; flush() decides.
          return false
        }
        const body = buffer.slice(SPECIAL_TOKENS.ThinkingStart.length, close)
        if (body.length > 0) out.push({ kind: PART.REASONING, text: body })
        buffer = buffer.slice(close + SPECIAL_TOKENS.ThinkingEnd.length)
        return true
      }
      if (buffer.startsWith(SPECIAL_TOKENS.ThinkingEnd)) {
        buffer = buffer.slice(SPECIAL_TOKENS.ThinkingEnd.length)
        return true
      }
      // A DSML opener: `<｜DSML｜invoke name="` or `<｜DSML｜parameter`. A spelling that is
      // not a block opener stays PROSE - prose may quote the notation.
      const invoke = readQuoted(buffer, DSML_OPEN + 'invoke name="')
      if (invoke) {
        stage = STAGE.CALLS
        blockOpened = true
        callName = invoke.value
        args = {}
        argsOrder = []
        buffer = buffer.slice(invoke.size)
        return true
      }
      // Hold while the buffer is undecided: a partial opener still growing, or a
      // complete opener whose name attribute has not arrived yet.
      // Hold while the buffer is undecided: still a prefix of an opener, or a
      // complete opener whose quoted name has not arrived yet. The second case is
      // what 1-character chunking hits; without it the opener was emitted as
      // prose one code unit at a time.
      const pending = [DSML_OPEN + 'invoke name="', PARAM_OPEN]
        .some((candidate) => candidate.startsWith(buffer) || buffer.startsWith(candidate))
      if (pending) return false
      emitText(out, buffer.slice(0, 1))
      buffer = buffer.slice(1)
      return true
    }

    if (stage === STAGE.CALLS) {
      const closer = [INVOKE_CLOSE, ...CALLS_CLOSE].find((candidate) => buffer.startsWith(candidate))
      if (closer) {
        buffer = buffer.slice(closer.length)
        blockOpened = false
        finishCall(out)
        stage = STAGE.TEXT
        return true
      }
      const parameter = readQuoted(buffer, PARAM_OPEN)
      if (parameter) {
        key = parameter.value
        value = ''
        buffer = buffer.slice(parameter.size)
        stage = STAGE.VALUE
        return true
      }
      // A partial closer (or partial parameter opener) must be HELD, never eaten:
      // eating one code unit of '</｜DSML｜invoke>' loses the block terminator and turns
      // a complete call into an unterminated block under 1-character chunking.
      const partial = [INVOKE_CLOSE, ...CALLS_CLOSE, PARAM_OPEN]
        .some((candidate) => candidate.startsWith(buffer))
      if (partial) return false
      // A complete opener still waiting for its closing quote also holds.
      if (buffer.startsWith(PARAM_OPEN) || buffer.startsWith(INVOKE_CLOSE)) return false
      if (/^\s*$/.test(buffer)) return false
      // Whitespace between attributes carries no meaning.
      buffer = buffer.slice(1)
      return true
    }

    // A parameter value runs to the closing tag; the model's own bytes are kept.
    if (stage === STAGE.VALUE) {
      // The tag ends with '>'; the value starts after it.
      if (value.length === 0 && buffer.startsWith('>')) {
        buffer = buffer.slice(1)
        return true
      }
      if (buffer.startsWith(PARAM_CLOSE)) {
        buffer = buffer.slice(PARAM_CLOSE.length)
        if (!argsOrder.includes(key)) argsOrder.push(key)
        args[key] = JSON.stringify(value)
        key = ''
        value = ''
        stage = STAGE.CALLS
        return true
      }
      if (PARAM_CLOSE.startsWith(buffer)) return false
      value += buffer.slice(0, 1)
      buffer = buffer.slice(1)
      return true
    }

    return false
  }

  return {
    version: PARSER_VERSION,
    stage: () => stage,
    stats: () => ({ ...stats }),
    push(delta) {
      if (typeof delta !== 'string' || delta.length === 0) return []
      buffer += delta
      const out = []
      let progressed = true
      while (progressed) {
        progressed = step(out)
        if (out.length > 100000) break
      }
      return out
    },
    flush() {
      const out = []
      if (blockOpened) {
        // An opened block that never closed is notation that cannot be parsed:
        // dropped and reported, never promoted to a call.
        stats.unterminated += 1
        out.push({ kind: PART.NOTATION, text: '', reason: 'unterminated' })
        blockOpened = false
        resetCall()
        buffer = ''
        return out
      }
      if (buffer.length > 0) {
        if (stage === STAGE.TEXT) {
          emitText(out, buffer)
        } else {
          stats.unterminated += 1
          out.push({ kind: PART.NOTATION, text: '', reason: 'unterminated' })
        }
        buffer = ''
      }
      return out
    }
  }
}

export { DSML, DSML_OPEN, DSML_CLOSE, normalizeGlyphs }
