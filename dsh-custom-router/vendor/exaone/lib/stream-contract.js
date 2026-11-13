/**
 * This provider's binding to the shared downstream pipe.
 *
 * The pipe (`@nolit/dsh-custom-router/stream`) owns the block lifecycle, the
 * finish table, the usage writer, the failure shape and the empty/cut/abort
 * terminal policy. Everything EXAONE-specific lives here as data plus pure
 * hooks, so a wire quirk never edits the core.
 *
 * EXAONE stream shape (docs.exaone.ai, read 2026-11-13):
 *
 *   frame               { choices: [{ delta, finish_reason }], usage }
 *   text part           delta.content
 *   reasoning part      delta.reasoning_content
 *   tool-call part      delta.tool_calls[] -> { index, id, function: { name, arguments } }
 *   usage               { prompt_tokens, completion_tokens, total_tokens,
 *                         reasoning_tokens, prompt_tokens_details.cached_tokens }
 *   sentinel            data: [DONE]
 *
 * Two consequences this file encodes:
 *   1. tool calls use the OpenAI fragment shape (`toolCallShape: 'fragmented'`);
 *   2. EXAONE reports reasoning tokens at the TOP level (`usage.reasoning_tokens`),
 *      not under `completion_tokens_details`, so the default writer would drop
 *      that detail. `usageFrom` projects the top-level value onto the canonical
 *      field and then defers to the one shared writer.
 *
 * @module @nolit/dsh-exaone/stream-contract
 */

import { finishReasonFor, usageFromProjection } from '../../../lib/stream/index.js'

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
 * EXAONE speaks the OpenAI vocabulary, which the shared table already
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
      defect: { code: 'PROTOCOL_DEFECT', message: 'EXAONE event is not a JSON object' },
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
 * Project one EXAONE usage object onto the shared writer's canonical fields.
 *
 * @param raw - the provider's usage object.
 * @param options - `{ formula }`.
 * @returns disjoint `TokenUsage`, or undefined when nothing usable arrived.
 */
export function usageFrom(raw, options = {}) {
  return usageFromProjection(raw, (usage) => ({
    prompt: usage.prompt_tokens,
    completion: usage.completion_tokens,
    reasoning: usage.reasoning_tokens ?? usage.completion_tokens_details?.reasoning_tokens,
    cached: usage.prompt_tokens_details?.cached_tokens,
    written: usage.prompt_tokens_details?.cache_write_tokens,
    total: usage.total_tokens,
  }), options)
}

/**
 * The hook set handed to `normalizeStream`.
 *
 * Pure: no I/O, no context.
 */
export const STREAM_HOOKS = Object.freeze({ readEvent, mapFinish, usageFrom })
