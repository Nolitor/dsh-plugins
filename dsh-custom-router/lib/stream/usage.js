/**
 * The one usage writer for the shared downstream pipe.
 *
 * Host `TokenUsage` buckets are DISJOINT: `inputTokens` is uncached input only,
 * cached input is reported separately, and billed input is
 * `input + cacheRead + cacheWrite`. Reasoning is a detail of the output budget,
 * never added on top of it.
 *
 * Two measured rules this module enforces:
 *
 *   1. `totalTokens` is preserved only when the provider's own aggregate agrees
 *      with the buckets it claims to describe. opencode-v2 published
 *      `input + output + cacheRead`, a subset, which is not a call total.
 *   2. Absence is not zero. A provider that never reported a bucket leaves it
 *      out; a caller that needs a number opts in explicitly.
 *
 * @module @nolit/dsh-custom-router/stream/usage
 */

import { count } from './wire.js'

/** The two measured aggregate conventions. */
export const TOTAL_FORMULAS = Object.freeze({
  /** OpenAI-shaped: `total_tokens = prompt_tokens + completion_tokens`. */
  'prompt+output': (prompt, output) => prompt + output,
  /** Gemini-shaped: thoughts are separate from candidates, so they join the total. */
  'prompt+output+reasoning': (prompt, output, reasoning) => prompt + output + reasoning,
})

/**
 * Normalize one provider usage object onto the host's disjoint buckets.
 *
 * @param raw - the provider's usage object; may be partial.
 * @param options - `{ formula }`, default `'prompt+output'`.
 * @returns disjoint `TokenUsage`, or undefined when the object carries no counts.
 */
export function usageFrom(raw, options = {}) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return undefined
  const formula = TOTAL_FORMULAS[options.formula ?? 'prompt+output']
  if (formula === undefined) throw new TypeError(`unknown usage formula: ${String(options.formula)}`)

  const promptTotal = count(raw.prompt_tokens)
  const completion = count(raw.completion_tokens)
  const reasoning = count(raw.completion_tokens_details?.reasoning_tokens)
  const cached = count(raw.prompt_tokens_details?.cached_tokens) ?? 0
  const written = count(raw.prompt_tokens_details?.cache_write_tokens) ?? 0

  if (promptTotal === undefined && completion === undefined) return undefined

  // Cache fields are subsets of the prompt total; clamp so a provider that
  // reports them independently cannot make the uncached remainder negative.
  const cacheRead = Math.min(cached, promptTotal ?? cached)
  const cacheWrite = Math.min(written, Math.max(0, (promptTotal ?? 0) - cacheRead))
  const input = Math.max(0, (promptTotal ?? 0) - cacheRead - cacheWrite)

  const usage = { inputTokens: input, outputTokens: completion ?? 0 }
  if (cacheRead > 0) usage.cacheReadTokens = cacheRead
  if (cacheWrite > 0) usage.cacheWriteTokens = cacheWrite
  if (reasoning !== undefined && reasoning > 0) usage.reasoningTokens = reasoning

  const total = count(raw.total_tokens)
  if (total !== undefined && total === formula(promptTotal ?? 0, completion ?? 0, reasoning ?? 0)) {
    usage.totalTokens = total
  }
  return usage
}

/**
 * Normalize one provider usage object whose fields are not OpenAI-named.
 *
 * Providers with a different shape supply `read`, a pure projection onto the
 * canonical OpenAI-style names; everything after that is the same writer, so
 * the bucket rules cannot drift.
 *
 * @param raw - the provider's usage object.
 * @param read - pure projection returning `{ prompt, completion, cached, written, reasoning, total }`.
 * @param options - `{ formula }`.
 * @returns disjoint `TokenUsage`, or undefined when nothing usable is present.
 */
export function usageFromProjection(raw, read, options = {}) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return undefined
  const projected = read(raw) ?? {}
  return usageFrom({
    prompt_tokens: projected.prompt,
    completion_tokens: projected.completion,
    prompt_tokens_details: { cached_tokens: projected.cached, cache_write_tokens: projected.written },
    completion_tokens_details: { reasoning_tokens: projected.reasoning },
    total_tokens: projected.total,
  }, options)
}
