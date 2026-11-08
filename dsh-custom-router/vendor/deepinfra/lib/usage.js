/**
 * Usage translation and cost accounting for DeepInfra.
 *
 * Two measured facts drive this file, both verified against the live API on
 * 2026-11-04 and both contradicting the assumptions in the build brief:
 *
 * 1. DeepInfra DOES return a cost field. `usage.estimated_cost` is a decimal
 *    USD amount present on every completion, so a cost readout does not have to
 *    be derived at all. Measured: the value equals
 *    `(1 - metadata.discount) * (prompt/1e6 * input_tokens + completion/1e6 *
 *    output_tokens)` exactly, to the last returned digit, on all four models
 *    checked (DeepSeek-V4.1-Flash discount 0.3, GLM-5.2 0.25, Qwen3.8-27B 0.25,
 *    Qwen3-235B no discount). A locally derived number is therefore a FALLBACK
 *    for the case where the field is absent, and it must say so.
 *
 * 2. The prompt bucket is folded, exactly like DeepSeek's. `prompt_tokens` is
 *    the TOTAL prompt; `prompt_tokens_details.cached_tokens` is the cached
 *    subset of it. `TokenUsage.inputTokens` must be the uncached remainder, or
 *    the host double-counts cached input.
 */

import { usageFrom } from '../../../lib/stream/index.js'

/** Cost currency the provider reports and the catalog prices in. */
export const CURRENCY = 'USD'

/**
 * Convert one provider `usage` object into the host's disjoint buckets.
 *
 * The shared pipe's writer (`usageFrom`) now owns the buckets, the
 * `totalTokens` cross-check rule and the "absence is not zero" rule, so the
 * workspace has exactly one usage implementation. This export remains because
 * the cost path and its tests read it; it delegates rather than reimplementing.
 *
 * Measured, and preserved by the shared writer: `prompt_tokens` is the folded
 * TOTAL (cache hits must be split out), and `total_tokens` equals
 * `prompt_tokens + completion_tokens`, so the `prompt+output` formula is the
 * aggregate that cross-checks.
 *
 * @param usage - the provider's usage object; may be partial.
 * @returns disjoint `TokenUsage`, or undefined when the payload carries no
 *   usable counts (an all-zero/absent object is not evidence of a zero call).
 */
export function tokenUsage(usage) {
  return usageFrom(usage, { formula: 'prompt+output' })
}

/**
 * The provider's own cost figure, when it reported one.
 *
 * @param usage - the provider's usage object.
 * @returns the exact USD amount and its provenance, or undefined when absent.
 */
export function providerCost(usage) {
  const value = usage?.estimated_cost
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return { amount: value, currency: CURRENCY, source: 'provider' }
}

/**
 * Derive a cost from catalog pricing when the provider reported none.
 *
 * This is the FALLBACK path only. The brief assumed it was the only path; it is
 * not. The catalog `discount` field is a fraction to subtract (0.3 means pay
 * 70%), which was measured by fitting provider-reported costs, so the estimate
 * reproduces the provider's number when pricing and discount are both present.
 *
 * @param usage - the provider's usage object (uses prompt/cached/completion).
 * @param pricing - catalog `metadata.pricing`.
 * @param discount - catalog `metadata.discount`, or null/undefined for none.
 * @returns the estimated USD amount, or undefined when pricing is unusable.
 */
export function estimatedCost(usage, pricing, discount) {
  if (pricing == null || typeof pricing !== 'object') return undefined
  const promptTotal = count(usage?.prompt_tokens) ?? 0
  const completion = count(usage?.completion_tokens) ?? 0
  const cached = Math.min(count(usage?.prompt_tokens_details?.cached_tokens) ?? 0, promptTotal)
  const inputRate = rate(pricing.input_tokens)
  const outputRate = rate(pricing.output_tokens)
  if (inputRate === undefined && outputRate === undefined) return undefined
  // Cache reads are priced separately ONLY where the catalog publishes a rate;
  // 45 of 91 chat routes do not, and assuming one would silently misprice them.
  const cacheRate = rate(pricing.cache_read_tokens)
  const uncached = promptTotal - cached
  const amount =
    (uncached / 1e6) * (inputRate ?? 0) +
    (cached / 1e6) * (cacheRate ?? inputRate ?? 0) +
    (completion / 1e6) * (outputRate ?? 0)
  const factor = discountFactor(discount)
  return amount * factor
}

/**
 * Apply the catalog discount fraction.
 * @param discount - `metadata.discount` (a fraction to subtract), or null.
 * @returns the multiplier actually charged.
 */
export function discountFactor(discount) {
  if (typeof discount !== 'number' || !Number.isFinite(discount)) return 1
  if (discount < 0 || discount >= 1) return 1
  return 1 - discount
}

/**
 * The reasoning-token count, when the route reported one.
 *
 * Measured 2026-11-04: `completion_tokens_details.reasoning_tokens` appears on
 * some routes and is entirely absent on others (gpt-oss-120b and claude-sonnet-5
 * omit it while streaming reasoning). Absence is "not reported", never zero.
 *
 * @param usage - the provider's usage object.
 * @returns the count, or undefined when the field is absent.
 */
export function reasoningTokensOf(usage) {
  return count(usage?.completion_tokens_details?.reasoning_tokens)
}

/**
 * Read a non-negative integer from a provider field.
 * @param value - any field value.
 * @returns the integer, or undefined when the value is not a usable count.
 */
function count(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.trunc(value)
}

/**
 * Read a per-million-token rate.
 * @param value - catalog price field.
 * @returns the rate, or undefined when absent.
 */
function rate(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return value
}
