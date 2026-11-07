/**
 * This provider's binding to the shared downstream pipe.
 *
 * The pipe (`@nolit/dsh-custom-router/stream`) owns the block lifecycle, the
 * finish table, the usage writer, the failure shape and the empty/cut/abort
 * terminal policy. Everything DeepInfra-specific lives here as data plus pure
 * hooks, so a wire quirk never edits the core.
 *
 * Measured DeepInfra shapes (2026-11-04, api.deepinfra.com/v1/openai/chat/completions):
 *
 *   frame               { choices: [{ delta, finish_reason }], usage }
 *   text part           delta.content
 *   reasoning part      delta.reasoning_content   (aliases: map.js REASONING_FIELDS)
 *   tool-call part      delta.tool_calls[] -> { index, id, function: { name, arguments } }
 *                       FRAGMENTED: the first fragment carries index/id/name with
 *                       EMPTY arguments, later ones carry only index and an
 *                       argument slice, with id:null and name:null
 *   usage               { prompt_tokens, completion_tokens, total_tokens,
 *                         estimated_cost, prompt_tokens_details.cached_tokens,
 *                         completion_tokens_details.reasoning_tokens }
 *
 * Three measured consequences this file encodes:
 *   1. tool calls arrive in fragments, so `toolCallShape` is `'fragmented'`
 *      (the wire's own fragment ordinals are reused, never re-invented here);
 *   2. `total_tokens === prompt_tokens + completion_tokens` held on all four
 *      routes checked, so the provider aggregate cross-checks under
 *      `prompt+output` — NOT under the Gemini formula;
 *   3. there is no `usageFrom` override: this provider already speaks the
 *      OpenAI usage shape, and the shared writer's default buckets are exactly
 *      the ones measured here (`prompt_tokens` folds the cache hit, so it must
 *      be split; `reasoning_tokens` is a detail of output, never added again).
 *      Adding a provider-local writer would be a second implementation of a
 *      rule that already has one.
 *
 * @module @nolit/dsh-deepinfra/stream-contract
 */

import { finishReasonFor } from '@nolit/dsh-custom-router/stream'

import { mapDelta } from './map.js'

/**
 * The descriptor handed to `normalizeStream`.
 *
 * `malformedRecord: 'fail'` is what this provider already did: an undecodable
 * record threw instead of being skipped, because a skipped frame silently
 * truncates a turn.
 */
export const STREAM_DESCRIPTOR = Object.freeze({
  toolCallShape: 'fragmented',
  usage: Object.freeze({ totalFormula: 'prompt+output' }),
  malformedRecord: 'fail',
})

/**
 * Map this provider's `finish_reason` onto the host `FinishReason`.
 *
 * DeepInfra speaks the OpenAI vocabulary, which the shared table already
 * covers, so this is a re-export with the intent documented rather than a
 * second table. D4 closes here: `content_filter` is now an error with code
 * `CONTENT_FILTERED`, not a clean `stop`.
 *
 * @param value - `choices[0].finish_reason`.
 * @returns the host `FinishReason` (`{ kind, failure? }`).
 */
export function mapFinish(value) {
  return finishReasonFor(value)
}

/**
 * The provider's `readEvent` hook: one decoded payload in, one normalized
 * record out.
 *
 * The shared pipe never inspects provider JSON. This function is the whole
 * boundary: it decides what one event means and hands over plain parts, the
 * raw usage object and the raw finish value. Nothing here synthesises identity
 * (a tool-call id or name a fragment omitted) — the pipe owns first-seen
 * allocation, so a `call_N` fallback exists in exactly one place.
 *
 * @param payload - one decoded SSE payload. The shared reader ends iteration at
 *   `[DONE]`, so the sentinel never reaches this function.
 * @returns `{ parts?, usage?, finish? }`, `{ defect }` when the payload is not an
 *   object, or undefined when the event carries nothing this provider cares about.
 */
export function readEvent(payload) {
  if (payload === null || typeof payload !== 'object') {
    return {
      defect: { code: 'PROTOCOL_DEFECT', message: 'DeepInfra event is not a JSON object' },
    }
  }

  const choice = payload.choices?.[0]
  const finish = typeof choice?.finish_reason === 'string' && choice.finish_reason.length > 0
    ? choice.finish_reason
    : undefined

  const parts = []
  for (const part of mapDelta(choice?.delta)) {
    if (part.kind === 'tool-call') {
      // map.js reports the fragment as `{ index, id, name, argumentsDelta }` with
      // `id`/`name` present-but-undefined; the record shape omits absent identity
      // so the pipe's `part.id`/`part.name` reads test the value, not the key.
      parts.push({
        kind: 'tool-call',
        index: part.index,
        ...(part.id !== undefined ? { id: part.id } : {}),
        ...(part.name !== undefined ? { name: part.name } : {}),
        argumentsDelta: part.argumentsDelta,
      })
      continue
    }
    parts.push(part)
  }

  // Usage may arrive with an empty `choices` array (measured: the cost-bearing
  // event is the last one), so it is read independently of the choice.
  const usage = payload.usage !== null && typeof payload.usage === 'object' ? payload.usage : undefined

  if (parts.length === 0 && usage === undefined && finish === undefined) return undefined
  return {
    ...(parts.length > 0 ? { parts } : {}),
    ...(usage === undefined ? {} : { usage }),
    ...(finish === undefined ? {} : { finish }),
  }
}

/**
 * The hook set handed to `normalizeStream`.
 *
 * Pure: no I/O, no context. There is deliberately no `usageFrom` override; see
 * the module note above.
 */
export const STREAM_HOOKS = Object.freeze({ readEvent, mapFinish })
