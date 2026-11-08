/**
 * This provider's PER-STREAM binding to the shared downstream pipe for the
 * `anthropic-messages` protocol.
 *
 * Why a factory and not a hook constant: two pieces of stream state have no
 * home in the pipe's record shape, and the pipe hands every hook a *fresh*
 * context object per event (measured: `readAnthropicEvent(payload, state = {})`
 * is called with a default object each time, so a binding that relied on that
 * object would lose its contents between two events of one stream).
 *
 *   1. `signature` — Anthropic ships it in `content_block_start.signature`
 *      (thinking) and in `content_block_delta.signature_delta.signature`. The
 *      host chunk shape has **no signature field**, so the shared reader can
 *      only accumulate it into the object it was handed and emit nothing
 *      downstream. The shared reader keeps one signature per block index, so a
 *      turn with two thinking blocks keeps both.
 *   2. `usage` — it arrives in TWO pieces and the pipe REPLACES the usage on
 *      each record it writes, not merges it:
 *        `message_start` -> { input, cacheRead, cacheWrite }
 *        `message_delta` -> { output } (plus `stop_reason`)
 *      A record carrying only `{ output }` would therefore erase the input
 *      counts. The shared hook merges each piece and returns the cumulative
 *      object on every record that carried any usage piece, so the pipe's LAST
 *      record is the complete one regardless of arrival order.
 *
 * Both concerns are protocol-level, not provider-level, so the implementation
 * lives in `@nolit/dsh-custom-router/stream/anthropic` (`createAnthropicHooks`)
 * and this module only keeps the provider's own constants and its export shape.
 * One implementation means a second Anthropic-compatible provider cannot drift
 * into a subtly different signature or usage merge.
 *
 * Measured Anthropic accounting this file depends on (see the shared reader's
 * `usageFromAnthropic`): `usage.input_tokens` already EXCLUDES cache reads and
 * cache writes, so the three input-side buckets are summed, not de-duplicated.
 * `total` is only reported when the provider itself states one; nothing here
 * invents it, so a wrong total is a visible omission instead.
 *
 * @module @nolit/dsh-deepinfra/stream-anthropic
 */

import { createAnthropicHooks } from '../../../lib/stream/anthropic.js'

/**
 * Anthropic-compatible surface of this provider, relative to its API root.
 *
 * Documented constant, not a probe: the Messages protocol lives at
 * `/v1/messages`, and the Anthropic-compatible mount is exposed under
 * `/anthropic`. Callers compose `baseUrl + ANTHROPIC_BASE_URL_SUFFIX +
 * anthropicMessagesPath()`; nothing here performs I/O.
 */
export const ANTHROPIC_BASE_URL_SUFFIX = '/anthropic'

/**
 * The Messages protocol path.
 *
 * Anthropic answers `POST /v1/messages` for this protocol and the compatible
 * mount keeps the same path, so the suffix is the only part that differs.
 *
 * @returns the literal `'/v1/messages'`.
 */
export function anthropicMessagesPath() {
  return '/v1/messages'
}

/**
 * Create one binding for one stream.
 *
 * Thin delegation: every call to the shared factory owns a private state, which
 * is the whole point — two concurrent streams must not share a signature or a
 * token count. The returned functions are the only way to read that state, and
 * each read is a copy.
 *
 * @returns `{ descriptor, hooks, signature, usage }`, where `signature()` is
 *   the accumulated thinking signature (`''` until one arrives), `signature(index)`
 *   is one block's signature, and `usage()` is the accumulated usage snapshot.
 */
export function createAnthropicBinding() {
  return createAnthropicHooks()
}
