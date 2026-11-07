/**
 * Cost calculation — the router's own arithmetic, because the DSH wrapper drops
 * pi-ai's `usage.cost` (measured 2026-11-07: `mapUsage()` forwards tokens only,
 * and `NO_COST` stands in for models the installed catalog does not describe).
 *
 * The formula mirrors upstream `@earendil-works/pi-ai` `calculateCost()`:
 *   - rates are US$ per 1,000,000 tokens;
 *   - tiers apply by total input tokens (`input + cacheRead + cacheWrite`);
 *   - a 1-hour cache write bills at 2x the input rate (Anthropic), the rest at
 *     the plain cache-write rate;
 *   - `total` is the sum of the four buckets.
 *
 * Pure module: no host context, no I/O.
 *
 * @module @nolit/dsh-custom-router/cost
 */

const RATE_FIELDS = Object.freeze(['input', 'output', 'cacheRead', 'cacheWrite'])

/**
 * Normalize a usage record without inventing values.
 * @param {object} usage - raw usage (`input`, `output`, optional cache fields).
 * @returns {{input: number, output: number, cacheRead: number, cacheWrite: number, cacheWrite1h: number}} canonical usage.
 */
export function normalizeUsage(usage = {}) {
  const number = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
  const input = number(usage.input ?? usage.inputTokens)
  const output = number(usage.output ?? usage.outputTokens)
  const cacheRead = number(usage.cacheRead ?? usage.cacheReadTokens)
  const cacheWrite = number(usage.cacheWrite ?? usage.cacheWriteTokens)
  const cacheWrite1h = Math.min(number(usage.cacheWrite1h), cacheWrite)
  return { input, output, cacheRead, cacheWrite, cacheWrite1h }
}

/**
 * Pick the applicable rate record for a usage total.
 * @param {object} cost - model cost record with base rates and optional tiers.
 * @param {number} inputTokens - total input tokens (input + cacheRead + cacheWrite).
 * @returns {object} the rate record to bill against.
 */
export function ratesFor(cost, inputTokens) {
  let rates = cost
  let matchedThreshold = -1
  for (const tier of cost.tiers ?? []) {
    if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
      rates = tier
      matchedThreshold = tier.inputTokensAbove
    }
  }
  return rates
}

/**
 * Calculate the cost of one usage record.
 * @param {object} cost - model cost record (`input`, `output`, `cacheRead`, `cacheWrite`, optional `tiers`).
 * @param {object} usage - usage record (see {@link normalizeUsage}).
 * @returns {{input: number, output: number, cacheRead: number, cacheWrite: number, total: number, totalFromProvider: false}} cost in US$.
 * @throws {TypeError} when the cost record is missing base rates.
 */
export function calculateCost(cost, usage = {}) {
  if (cost === null || typeof cost !== 'object') throw new TypeError('calculateCost requires a model cost record')
  for (const field of RATE_FIELDS) {
    if (typeof cost[field] !== 'number' || !Number.isFinite(cost[field]) || cost[field] < 0) {
      throw new TypeError(`calculateCost: cost.${field} must be a non-negative number`)
    }
  }
  const canonical = normalizeUsage(usage)
  const inputTokens = canonical.input + canonical.cacheRead + canonical.cacheWrite
  const rates = ratesFor(cost, inputTokens)
  const longWrite = canonical.cacheWrite1h
  const shortWrite = canonical.cacheWrite - longWrite

  const input = (rates.input / 1_000_000) * canonical.input
  const output = (rates.output / 1_000_000) * canonical.output
  const cacheRead = (rates.cacheRead / 1_000_000) * canonical.cacheRead
  const cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1_000_000
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
    totalFromProvider: false,
  }
}
