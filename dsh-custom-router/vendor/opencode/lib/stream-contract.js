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
 * The parser is the LEGACY classifier (lib/stream-parser.js) by owner decision
 * D-4: the canonical parser stays ported-but-off until Phase F.
 *
 * @module @nolit/dsh-opencode-v2/stream-contract
 */

import { createStreamClassifier } from './stream-parser.js'
import { mapChatDelta } from './upstream-map.js'
import { finishFromOpenAi, usageFromOpenAi } from './openai-mapping.js'

/**
 * The descriptor handed to `normalizeStream`.
 *
 * `malformedRecord: 'fail'` is what this provider already did: an undecodable
 * record threw instead of being skipped, because a skipped frame silently
 * truncates a turn.
 */
export const OPENCODE_DESCRIPTOR = Object.freeze({
  toolCallShape: 'fragmented',
  usage: Object.freeze({ totalFormula: 'prompt+output' }),
  malformedRecord: 'fail',
})

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
 * @param {string} [options.parser] - `'legacy'` (the only parser shipped in
 *   Phase B; the canonical parser arrives in Phase F).
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
    parser = 'legacy',
    gate = null,
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
   * The shared pipe never inspects provider JSON. This function is the whole
   * boundary: it decides what one event means and hands over plain parts, the
   * raw usage object and the raw finish value.
   *
   * The part vocabulary is translated here, once. `mapChatDelta` (this
   * adapter's own mapper) names the fragment ordinal `ordinal` and the argument
   * slice `arguments`; the shared pipe reads the ordinal as `index` and the
   * slice as `argumentsDelta` (the vocabulary of every other vendor's map).
   * Passing `mapChatDelta`'s output through unchanged would make every
   * fragment of every call look like ordinal 0, so two parallel calls would
   * collapse into one block. The wire's own ordinal is reused here, never
   * re-invented.
   *
   * @param {object} payload - one decoded SSE payload.
   * @returns `{ parts?, usage?, finish? }`, `{ defect }` when the payload is not
   *   an object, or undefined when the event carries nothing this provider
   *   cares about.
   */
  const readEvent = (payload) => {
    if (payload === null || typeof payload !== 'object') {
      return {
        defect: { code: 'PROTOCOL_DEFECT', message: 'OpenCode event is not a JSON object' },
      }
    }
    const choice = payload.choices?.[0]
    const delta = choice?.delta ?? {}
    const parts = []
    for (const part of mapChatDelta(delta, { reasoningField })) {
      if (part.kind === 'tool-call') {
        // Absent identity is omitted rather than reported as an empty string, so
        // the pipe's "has an id or a name" test reads the value, not the key.
        parts.push({
          kind: 'tool-call',
          index: part.ordinal,
          ...(part.id ? { id: part.id } : {}),
          ...(part.name ? { name: part.name } : {}),
          argumentsDelta: part.arguments,
        })
        continue
      }
      parts.push(part)
    }
    const finish = typeof choice?.finish_reason === 'string' && choice.finish_reason.length > 0
      ? choice.finish_reason
      : undefined
    const usage = payload.usage !== null && typeof payload.usage === 'object' ? payload.usage : undefined
    if (parts.length === 0 && usage === undefined && finish === undefined) return undefined
    return {
      ...(parts.length > 0 ? { parts } : {}),
      ...(usage === undefined ? {} : { usage }),
      ...(finish === undefined ? {} : { finish }),
    }
  }

  /**
   * The `classifyText` hook: notation the route left inside a text payload.
   *
   * This is the LEGACY path (owner decision D-4): the restored classifier
   * (lib/stream-parser.js) recovers a tool call the model wrote as prose and
   * holds back a marker that is split across two deltas.
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
    /** The parser this hook set speaks; `'legacy'` in Phase B. */
    parser,
  }
}
