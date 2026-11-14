/**
 * This provider's binding to the shared downstream stream pipe.
 *
 * The pipe (`@nolit/dsh-custom-router/stream`) owns the block lifecycle, the
 * finish table, the usage writer, the failure shape and the empty/cut/abort
 * terminal policy. Everything OpenCode-specific lives here as data plus pure
 * hooks, so a wire quirk never edits the shared core.
 *
 * Measured OpenCode wire shapes:
 *
 *   frame               { choices: [{ delta, finish_reason }], usage }
 *   text part           delta.content
 *   reasoning part      delta.reasoning_content (aliases: upstream-map.js
 *                       REASONING_FIELDS), or the route's own field name
 *   tool-call part      delta.tool_calls[] -> { ordinal, id, name, arguments }
 *                       FRAGMENTED: the first fragment carries the ordinal, the
 *                       id and the name; later fragments carry only the ordinal
 *                       and an argument slice (id and name absent)
 *   usage               { prompt_tokens, prompt_tokens_details.cached_tokens,
 *                         completion_tokens,
 *                         completion_tokens_details.reasoning_tokens }
 *
 * Three measured consequences this file encodes:
 *
 *   1. tool calls arrive in fragments, so `toolCallShape` is `'fragmented'`;
 *      the wire's own ordinals are reused, never re-invented here;
 *   2. the provider's usage total is `prompt + output` (the OpenAI aggregate),
 *      so `totalFormula` is `'prompt+output'` — but the buckets are written by
 *      this adapter's own writer (`usageFromOpenAi`), because the shared writer
 *      folds a cache hit into `prompt_tokens` differently from this adapter's
 *      published contract;
 *   3. `malformedRecord` is `'fail'`: an undecodable record threw instead of
 *      being skipped, because a skipped frame silently truncates a turn.
 *
 * ONE vocabulary translation happens here. This adapter's own mapper
 * (`mapChatDelta`) names a fragment's ordinal `ordinal` and its argument slice
 * `arguments`; the shared pipe reads the ordinal as `index` and the slice as
 * `argumentsDelta` — the vocabulary every other vendor's map already speaks.
 * The translation is done once, at the boundary, so a raw pass-through cannot
 * make every fragment of every call look like ordinal 0.
 *
 * The parser is now the SHARED OpenAI core (lib/stream/openai.js): `readEvent`
 * delegates to it, so the wire boundary is one implementation shared with
 * DeepInfra and EXAONE. The three OpenCode wire facts the core does not model
 * (a route-configured reasoning field name, structured `content` arrays, and the
 * legacy top-level `{ name, arguments }` tool-call entry) are folded into the
 * core's vocabulary by `adaptForSharedCore()` before the delegation, never by a
 * second classifier. The vendor-local NOTATION classifier (lib/stream-parser.js)
 * still classifies text/reasoning prose and is now the only legacy piece left;
 * the explicit `pipe: 'legacy'` opt-out in http.js is deleted together with it
 * by W2-A2.
 *
 * @module @nolit/dsh-opencode-v2/stream-contract
 */

import { createStreamClassifier } from './stream-parser.js'
import { contentText } from './upstream-map.js'
import { finishFromOpenAi, usageFromOpenAi } from './openai-mapping.js'
import {
  REASONING_FIELDS as CORE_REASONING_FIELDS,
  STREAM_DESCRIPTOR,
  readEvent as readSharedOpenAiEvent,
} from '../../../lib/stream/openai.js'

/**
 * The parser identity this hook set speaks.
 *
 * It names the SHARED OpenAI core (`lib/stream/openai.js`), which now answers
 * the wire boundary. The value is data: nothing branches on it, so a future
 * parser change is a label change in one place, not a hunt for a hardcoded
 * `'legacy'` string in the HTTP adapter.
 */
export const OPENCODE_PARSER = 'shared-openai'

/**
 * The descriptor handed to `normalizeStream`.
 *
 * It is the SHARED core's descriptor itself (`STREAM_DESCRIPTOR`), not a copy:
 * OpenCode's measured wire facts — fragmented tool calls, `prompt+output` total,
 * and `malformedRecord: 'fail'` (an undecodable record threw rather than being
 * skipped, because a skipped frame silently truncates a turn) — are exactly the
 * OpenAI facts the core already states. Re-exporting the same frozen object
 * keeps one source of truth and keeps the
 * `@nolit/dsh-opencode-v2/stream-contract` export list stable.
 */
export const OPENCODE_DESCRIPTOR = STREAM_DESCRIPTOR

/**
 * Map an upstream `finish_reason` onto a DSH finish reason.
 *
 * OpenCode speaks the OpenAI vocabulary, but this adapter's own table is the
 * published one (it carries the `OPENCODE_FINISH_*` failure codes), so the hook
 * delegates to the extracted helper rather than to a second table.
 *
 * @param {string|null|undefined} value - `choices[0].finish_reason`.
 * @returns {{kind: string, failure?: {code: string, message: string}}}
 */
export function mapFinish(value) {
  return finishFromOpenAi(value)
}

/**
 * Normalize one provider usage object onto this adapter's disjoint buckets.
 *
 * @param {object} raw - the provider's `usage` object.
 * @returns {object} the adapter's `TokenUsage` shape.
 */
export function usageFrom(raw) {
  return usageFromOpenAi(raw)
}

/**
 * Fold this adapter's three extra wire shapes into the shared core's vocabulary.
 *
 * The shared OpenAI core reads exactly one shape per field. A route served by
 * this adapter can differ in three measured ways, and each is rewritten here
 * BEFORE the core sees the payload, so the core stays the single classifier:
 *
 *   1. **The reasoning field name is configurable** (`reasoningField`, from the
 *      route's `compatibility`). The core reads its three OpenAI aliases only,
 *      so a configured field is copied onto `reasoning_content`, which wins.
 *   2. **`content` may be a structured array** (`{ type: 'text', text }` parts).
 *      The core reads a string, so the array's text items are joined in order —
 *      byte-identical to what this adapter's own `contentText()` produced.
 *   3. **A tool-call entry may carry `name` / `arguments` at the top level**
 *      instead of under `function`. The core reads `function` only, so a
 *      top-level value is moved under it. A fragment with no usable `index`
 *      also keeps its array position as the ordinal, which is what this
 *      adapter's own mapper did.
 *
 * The payload is never mutated: a copy is made only when a fold is needed.
 *
 * @param payload - one decoded SSE payload.
 * @param {string} reasoningField - the route's reasoning field name.
 * @returns the payload in the core's vocabulary, or `undefined` when the payload
 *   is not an object (the caller turns that into a protocol defect).
 */
function adaptForSharedCore(payload, reasoningField) {
  if (payload === null || typeof payload !== 'object') return undefined
  const choice = payload.choices?.[0]
  const delta = choice?.delta
  if (delta === null || typeof delta !== 'object') return payload

  const nextDelta = { ...delta }
  let changed = false

  // 1. The route's own reasoning field, when the core does not read it already.
  if (typeof reasoningField === 'string' && reasoningField.length > 0 && !CORE_REASONING_FIELDS.includes(reasoningField)) {
    const value = delta[reasoningField]
    if (typeof value === 'string' && value.length > 0) {
      nextDelta.reasoning_content = value
      changed = true
    }
  }

  // 2. Structured content arrays become one string, in wire order.
  if (Array.isArray(delta.content)) {
    nextDelta.content = contentText(delta).join('')
    changed = true
  }

  // 3. Tool-call entries the core would drop or mis-key.
  if (Array.isArray(delta.tool_calls)) {
    let callsChanged = false
    const calls = delta.tool_calls.map((entry, position) => {
      if (entry === null || typeof entry !== 'object') return entry
      const next = { ...entry }
      const fn = entry.function !== null && typeof entry.function === 'object' ? { ...entry.function } : {}
      let entryChanged = false
      if (typeof fn.name !== 'string' || fn.name.length === 0) {
        if (typeof entry.name === 'string' && entry.name.length > 0) {
          fn.name = entry.name
          entryChanged = true
        }
      }
      if (typeof fn.arguments !== 'string') {
        if (typeof entry.arguments === 'string') {
          fn.arguments = entry.arguments
          entryChanged = true
        }
      }
      if (!(Number.isInteger(entry.index) && entry.index >= 0)) {
        next.index = position
        entryChanged = true
      }
      if (entryChanged) {
        next.function = fn
        callsChanged = true
      }
      return next
    })
    if (callsChanged) {
      nextDelta.tool_calls = calls
      changed = true
    }
  }

  if (!changed) return payload
  return { ...payload, choices: [{ ...choice, delta: nextDelta }, ...payload.choices.slice(1)] }
}

/**
 * Create the hook set of ONE stream.
 *
 * The hook set is per-stream on purpose: the classifier that holds back a
 * marker split across two deltas carries state, so two streams must never share
 * one instance. `createStreamHooks()` therefore returns a fresh classifier every
 * call, and the two hook sets are fully independent.
 *
 * @param {object} [options]
 * @param {string} [options.reasoningField] - the route's reasoning field name;
 *   the OpenAI aliases always follow it.
 * @param {Iterable<string>|Set<string>} [options.toolNames] - declared tool names.
 * @param {object[]} [options.tools] - declared tools (schemas), for inference.
 * @param {string} [options.parser] - the parser identity to report; defaults to
 *   `OPENCODE_PARSER` (the shared OpenAI core). Data only: nothing branches on
 *   it, and the legacy text-notation classifier is still used for prose.
 * @param {(context: object) => object[]} [options.beforeSettle] - drain run
 *   between the classifier flush and the gate's verdict; returns parts to emit.
 * @param {object} [options.gate] - a display gate (lib/display-gate.js). When a
 *   gate is present, a call recovered from text is QUEUED for the gate instead
 *   of being emitted: the gate can only tell promote from echo once the
 *   structured calls of the whole response are known. Without a gate the
 *   legacy behaviour is unchanged.
 * @returns {{
 *   readEvent: (payload: unknown) => {parts?: object[], usage?: object, finish?: string, defect?: object}|undefined,
 *   classifyText: (text: string) => object[],
 *   classifyReasoning: (text: string) => object[],
 *   onPart: (part: unknown) => void,
 *   flush: () => object[],
 *   mapFinish: (value: unknown) => object,
 *   usageFrom: (raw: unknown) => object,
 *   parser: string,
 * }}
 */
export function createStreamHooks(options = {}) {
  const {
    reasoningField = 'reasoning_content',
    toolNames = [],
    tools = [],
    parser = OPENCODE_PARSER,
    gate = null,
    beforeSettle = null,
  } = options

  // ONE classifier per stream, held in this closure. Two streams never share it.
  const classifier = createStreamClassifier({ toolNames, tools })
  // The reasoning channel gets its own classifier, exactly like the legacy path:
  // the model also writes calls into the reasoning channel (measured: 5 of 6
  // leaking requests had the marker in reasoning).
  const reasoningClassifier = createStreamClassifier({ toolNames, tools })
  // The structured calls of this response, as the gate decides against them.
  const structuredCalls = []
  // Whether a display gate was handed in. With a gate, recovered calls are
  // queued and decided at the end of the stream; without one, the legacy
  // behaviour is unchanged (a recovered call is emitted immediately).
  const hasGate = gate !== null && gate !== undefined && typeof gate.addCandidate === 'function' && typeof gate.settle === 'function'
  // The position of the next promoted call; the promoted call's index is its
  // negative ordinal translation (-(n+1)), so it never collides with a wire
  // ordinal.
  let promotedOrdinal = 0
  // The next ordinal for a call recovered from text; negative, so it can never
  // collide with a wire ordinal (the wire's own ordinals are non-negative).
  let recoveredOrdinal = 0

  /**
   * The `readEvent` hook: one decoded payload in, one normalized record out.
   *
   * The record itself comes from the SHARED OpenAI core
   * (`lib/stream/openai.js#readEvent`), so this adapter no longer owns a second
   * classifier for the OpenAI wire. What stays here is the fold: the three
   * shapes this route produces that the core does not model are rewritten into
   * the core's own vocabulary by `adaptForSharedCore()` before the delegation —
   * the route-configured reasoning field name, structured `content` arrays, and
   * the legacy top-level `{ name, arguments }` tool-call entry.
   *
   * The core emits the pipe vocabulary directly (`index` / `argumentsDelta`, and
   * `content` arrays are already unwrapped), so no second translation runs here.
   *
   * @param {object} payload - one decoded SSE payload.
   * @returns `{ parts?, usage?, finish? }`, `{ defect }` when the payload is not
   *   an object, or undefined when the event carries nothing this provider
   *   cares about.
   */
  const readEvent = (payload) => {
    // The wire boundary is the SHARED OpenAI core. This adapter folds the three
    // shapes the core does not model into the core's own vocabulary first, so
    // there is exactly one classifier for the wire and no OpenCode fork of it.
    const normalized = adaptForSharedCore(payload, reasoningField)
    if (normalized === undefined) {
      return {
        defect: { code: 'PROTOCOL_DEFECT', message: 'OpenCode event is not a JSON object' },
      }
    }
    return readSharedOpenAiEvent(normalized)
  }

  /**
   * The `classifyText` hook: notation the route left inside a text payload.
   *
   * This is the remaining VENDOR-LOCAL piece: the notation classifier
   * (lib/stream-parser.js) recovers a tool call the model wrote as prose and
   * holds back a marker that is split across two deltas. The WIRE classifier is
   * the shared core; only this prose-notation recovery is still per-vendor, and
   * W2-A2 deletes it together with the legacy loop it came from.
   *
   * A recovered call gets its own ordinal, from a space the wire never uses.
   * The legacy path assigns it "the next free ordinal after the structured
   * ones", but that is only knowable at end of stream, when the legacy path
   * settles its display gate. A pipe consumer emits the part the moment the
   * classifier produces it, so a recovered call that borrowed a wire ordinal
   * could merge with a structured call's block. The pipe keys its tool-call
   * blocks by ordinal, so the two spaces must not overlap.
   *
   * @param {string} text - one text delta.
   * @returns {object[]} the classifier's parts; empty when the text is plain prose.
   */
  const classifyText = (text) => {
    if (typeof text !== 'string' || text.length === 0) return []
    if (!hasGate) return translateRecovered(classifier.push(text))
    // With a gate, a recovered call is not emitted here: it is queued for the
    // gate, which decides promote / echo / superseded / undeclared once the
    // structured calls of the whole response are known.
    return collectGateParts(classifier.push(text))
  }

  /**
   * The `classifyReasoning` hook: notation the route left inside the reasoning
   * channel.
   *
   * The reasoning channel gets its own classifier, exactly like the legacy
   * path: the model also writes calls into reasoning (measured: 5 of 6 leaking
   * requests had the marker there), and reasoning prose must stay reasoning.
   *
   * @param {string} text - one reasoning delta.
   * @returns {object[]} the classifier's parts.
   */
  const classifyReasoning = (text) => {
    if (typeof text !== 'string' || text.length === 0) return []
    // The classifier is channel-agnostic: it labels recovered prose `text`.
    // This lane is the reasoning channel, so prose keeps its label; without
    // this the pipe emits reasoning as visible text (measured in B-2b2).
    return asReasoning(hasGate
      ? collectGateParts(reasoningClassifier.push(text))
      : translateRecovered(reasoningClassifier.push(text)))
  }

  /**
   * The `onPart` hook: one structured call of this response.
   *
   * Only a wire-field tool call is a structured call: the gate decides a
   * recovered candidate against exactly those, so their id / name / arguments
   * are collected here. Every other part is ignored.
   *
   * @param {object} part - one part of the response.
   */
  const onPart = (part) => {
    if (!part || typeof part !== 'object') return
    if (part.kind !== 'tool-call') return
    structuredCalls.push({
      id: part.id,
      name: part.name,
      // The classifier's own vocabulary is `arguments`; the pipe's is
      // `argumentsDelta`. Both are accepted, so the gate compares arguments
      // whichever vocabulary the caller used.
      arguments: part.arguments !== undefined ? part.arguments : part.argumentsDelta,
    })
  }

  /**
   * The `flush` hook: what the classifier still holds at end of stream.
   *
   * The legacy path calls `classifier.flush()` before closing its blocks. The
   * pipe has the same seam (a held-back partial marker must be drained at EOF
   * or it is silently lost), so the hook is provided here too.
   *
   * With a gate the drain composes the whole end-of-stream order: the text
   * classifier, then the reasoning classifier, then the gate's verdict - the
   * promoted calls, translated to the pipe's vocabulary with negative indices,
   * so a promoted call can never collide with a wire ordinal.
   *
   * @returns {object[]} the classifier's remaining parts.
   */
  const flush = () => {
    if (!hasGate) {
      // Legacy drains BOTH channels in this order; dropping the reasoning
      // classifier here would silently lose a held-back marker at EOF.
      return [
        ...translateRecovered(classifier.flush()),
        ...asReasoning(translateRecovered(reasoningClassifier.flush())),
      ]
    }
    const parts = [
      ...collectGateParts(classifier.flush()),
      ...asReasoning(collectGateParts(reasoningClassifier.flush())),
    ]
    // The pre-settle seam: a caller that holds text outside the classifier (the
    // JSON-body probe in http.js) must drain BEFORE the gate decides, because
    // what it drains can itself be a candidate. Anything it releases is emitted
    // in this same flush, in this position.
    if (typeof beforeSettle === 'function') {
      const released = beforeSettle({ descriptor: OPENCODE_DESCRIPTOR })
      for (const part of Array.isArray(released) ? released : []) parts.push(part)
    }
    const { promote } = gate.settle(structuredCalls)
    for (const call of promote) {
      parts.push(translatePromoted(call, promotedOrdinal))
      promotedOrdinal += 1
    }
    return parts
  }

  /**
   * Route a classifier's parts: a tool call goes to the gate, everything else
   * is returned to the caller.
   *
   * @param {object[]} parts - the classifier's parts.
   * @returns {object[]} the text / reasoning parts.
   */
  function asReasoning(parts) {
    return parts.map((part) => (part?.kind === 'tool-call' ? part : { ...part, kind: 'reasoning' }))
  }

  function collectGateParts(parts) {
    const out = []
    for (const part of parts) {
      if (part?.kind === 'tool-call') {
        gate.addCandidate(part)
        continue
      }
      out.push(part)
    }
    return out
  }

  /**
   * Translate one promoted call into the pipe's part vocabulary.
   *
   * A promoted call takes a negative index: the wire's own ordinals are
   * non-negative, so a promoted call can never merge with a structured call's
   * block. The index is ordinal-translated from the promoted call's position.
   *
   * @param {object} call - the gate's promoted call.
   * @param {number} ordinal - the promoted call's position (0-based).
   * @returns {object} the pipe part.
   */
  function translatePromoted(call, ordinal) {
    return {
      kind: 'tool-call',
      index: -(ordinal + 1),
      ...(call.id ? { id: call.id } : {}),
      ...(call.name ? { name: call.name } : {}),
      argumentsDelta: typeof call.arguments === 'string' ? call.arguments : '',
    }
  }

  /**
   * Translate the classifier's parts into the pipe's part vocabulary.
   *
   * The classifier emits `{ kind: 'tool-call', id, name, arguments }`; the pipe
   * reads the ordinal as `index` and the argument slice as `argumentsDelta`
   * (it also accepts `arguments`, so only the ordinal is added here).
   *
   * @param {object[]} parts - the classifier's parts.
   * @returns {object[]} the same parts, with a recovered ordinal attached.
   */
  function translateRecovered(parts) {
    const out = []
    for (const part of parts) {
      if (part?.kind !== 'tool-call') {
        out.push(part)
        continue
      }
      out.push({
        kind: 'tool-call',
        index: nextRecoveredOrdinal(),
        ...(part.id ? { id: part.id } : {}),
        ...(part.name ? { name: part.name } : {}),
        arguments: typeof part.arguments === 'string' ? part.arguments : '',
      })
    }
    return out
  }

  /**
   * The next ordinal for a recovered call.
   *
   * Recovered calls live in a negative space: the wire's own ordinals are
   * non-negative, so the two can never collide, and two recovered calls never
   * collide with each other.
   *
   * @returns {number} the next recovered ordinal.
   */
  function nextRecoveredOrdinal() {
    recoveredOrdinal -= 1
    return recoveredOrdinal
  }

  return {
    readEvent,
    classifyText,
    classifyReasoning,
    onPart,
    flush,
    mapFinish,
    usageFrom,
    /** The parser this hook set reports; the shared OpenAI core. */
    parser,
  }
}
