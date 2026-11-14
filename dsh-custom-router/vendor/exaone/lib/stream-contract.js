/**
 * This provider's binding to the shared downstream pipe.
 *
 * The pipe (`@nolit/dsh-custom-router/stream`) owns the block lifecycle, the
 * finish table, the usage writer, the failure shape and the empty/cut/abort
 * terminal policy. The OpenAI-compatible wire itself now lives in exactly one
 * place — `lib/stream/openai.js` — and this file is the thin EXAONE binding over
 * it, not a second copy of it.
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
 * Measured, this provider differs from the shared OpenAI core in ONE respect
 * only: EXAONE reports reasoning tokens at the TOP level
 * (`usage.reasoning_tokens`), not under `completion_tokens_details`, so the
 * default writer would drop that detail. `usageFrom` is therefore the single
 * vendor-local hook: it projects the top-level value onto the canonical field
 * and then defers to the one shared writer.
 *
 * Everything else — the descriptor (`toolCallShape: 'fragmented'`,
 * `malformedRecord: 'fail'`) and both stream hooks (`readEvent`, `mapFinish`) —
 * is the core's, unredeclared. The 41-line `readEvent` that used to sit here
 * (`:76-116`) was byte-identical to the core apart from the vendor name in one
 * defect message; the core's wording ("OpenAI-compatible event is not a JSON
 * object", code `PROTOCOL_DEFECT`) replaces it.
 *
 * @module @nolit/dsh-exaone/stream-contract
 */

import { STREAM_DESCRIPTOR as OPENAI_STREAM_DESCRIPTOR, STREAM_HOOKS as OPENAI_STREAM_HOOKS } from '../../../lib/stream/openai.js'
import { usageFromProjection } from '../../../lib/stream/index.js'

/**
 * The descriptor handed to `normalizeStream`: the shared OpenAI one.
 *
 * EXAONE's fragmented tool calls and fail-fast malformed records are already
 * what the core declares, so this is the core object itself — one declaration
 * for every OpenAI-compatible route.
 */
export const STREAM_DESCRIPTOR = OPENAI_STREAM_DESCRIPTOR

/**
 * The core's own hooks, re-exported for callers that bind this module directly.
 *
 * `readEvent` and `mapFinish` are the core's functions, not wrappers: a wrapper
 * would re-open the drift this module exists to close.
 */
export const { readEvent, mapFinish } = OPENAI_STREAM_HOOKS

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
 * Pure: no I/O, no context. The core hooks are extended rather than replaced;
 * `usageFrom` is EXAONE's only override.
 */
export const STREAM_HOOKS = Object.freeze({ ...OPENAI_STREAM_HOOKS, usageFrom })
