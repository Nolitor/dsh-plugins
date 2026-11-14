/**
 * This provider's binding to the shared downstream pipe.
 *
 * The pipe (`@nolit/dsh-custom-router/stream`) owns the block lifecycle, the
 * finish table, the usage writer, the failure shape and the empty/cut/abort
 * terminal policy. Everything DeepInfra-specific lives in `map.js` plus this
 * module's prose, so a wire quirk never edits the core.
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
 * Three measured consequences this module encodes:
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
 * WHAT WAS DELETED IN PHASE 2: this file carried its own 40-line `readEvent`,
 * its own descriptor literal and its own `mapFinish` delegation — a copy of
 * `vendor/exaone/lib/stream-contract.js` with zero non-comment difference. All
 * three are now the shared OpenAI protocol core at `../../../lib/stream/openai.js`.
 * No behaviour changes; the only delta is one shared error string, which now
 * names the protocol ("OpenAI-compatible event is not a JSON object") instead of
 * the vendor. The defect CODE is unchanged (`PROTOCOL_DEFECT`).
 *
 * @module @nolit/dsh-deepinfra/stream-contract
 */

import {
  STREAM_DESCRIPTOR as CORE_DESCRIPTOR,
  STREAM_HOOKS as CORE_HOOKS,
  mapFinish,
  readEvent,
} from '../../../lib/stream/openai.js'

export { mapFinish, readEvent }

/**
 * The descriptor handed to `normalizeStream` — the shared OpenAI descriptor,
 * re-exported under this module's historical name.
 *
 * `malformedRecord: 'fail'` is what this provider already did: an undecodable
 * record threw instead of being skipped, because a skipped frame silently
 * truncates a turn.
 */
export const STREAM_DESCRIPTOR = CORE_DESCRIPTOR

/**
 * The hook set handed to `normalizeStream`.
 *
 * Pure: no I/O, no context. There is deliberately no `usageFrom` override; see
 * the module note above.
 */
export const STREAM_HOOKS = CORE_HOOKS
