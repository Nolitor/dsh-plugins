/**
 * Usage accounting — compatibility surface only.
 *
 * The bucket rules live in the shared writer (`usageFrom`), so this file cannot
 * drift from the other vendors. It keeps the published `./usage` export and the
 * provider's field names.
 *
 * @module @nolit/dsh-antigravity/usage
 */

import { usageFrom } from './stream-contract.js'

/**
 * Convert one cumulative `usageMetadata` object into DSH `TokenUsage`.
 *
 * @param metadata - the latest frame's `usageMetadata` (never summed: cumulative).
 * @returns disjoint token usage, or undefined when the frame carried none.
 */
export function toTokenUsage(metadata) {
  return usageFrom(metadata)
}
