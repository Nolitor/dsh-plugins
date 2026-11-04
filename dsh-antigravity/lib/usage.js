/**
 * Usage accounting for cloudcode-pa.
 *
 * Measured `usageMetadata` (2026-11-05), cumulative across frames:
 *   promptTokenCount      total input, cache hits INCLUDED
 *   candidatesTokenCount  visible output
 *   thoughtsTokenCount    reasoning output, billed but not shown as text
 *   cachedContentTokenCount  present when the prompt hit the cache
 *   totalTokenCount       prompt + candidates + thoughts
 *
 * DSH TokenUsage counts are DISJOINT: `inputTokens` is uncached input only and
 * cached input is reported separately, with billed input = input + cacheRead +
 * cacheWrite. So the prompt count is split rather than copied, and reasoning is
 * surfaced as `reasoningTokens` without inflating `outputTokens`.
 *
 * @module @nolit/dsh-antigravity/usage
 */

/**
 * Convert one cumulative usageMetadata object into DSH TokenUsage.
 *
 * @param metadata - latest frame's usageMetadata (never summed across frames).
 * @returns disjoint token usage, or undefined when the frame carried none.
 */
export function toTokenUsage(metadata) {
  if (!metadata || typeof metadata !== 'object') return undefined
  const prompt = num(metadata.promptTokenCount)
  const candidates = num(metadata.candidatesTokenCount)
  const thoughts = num(metadata.thoughtsTokenCount)
  const cached = num(metadata.cachedContentTokenCount)
  if (prompt === undefined && candidates === undefined && thoughts === undefined) return undefined

  const cacheRead = cached ?? 0
  const totalInput = prompt ?? 0
  const uncachedInput = Math.max(0, totalInput - cacheRead)

  const usage = {
    inputTokens: uncachedInput,
    outputTokens: candidates ?? 0,
  }
  if (cacheRead > 0) usage.cacheReadTokens = cacheRead
  if (thoughts !== undefined && thoughts > 0) usage.reasoningTokens = thoughts
  const total = num(metadata.totalTokenCount)
  if (total !== undefined) usage.totalTokens = total
  return usage
}

/**
 * Read a non-negative finite integer.
 * @param value - raw field.
 * @returns the number, or undefined.
 */
function num(value) {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined
  return Math.max(0, Math.trunc(value))
}
