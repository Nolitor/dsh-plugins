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

/**
 * The three measured aggregate conventions. One vocabulary: the provider driver
 * contract derives its `totalFormula` enum from {@link ALL_FORMULAS}, so a
 * descriptor can no longer name a formula this writer does not implement.
 *
 * The chosen formula also declares the provider's CACHE CONVENTION, because the
 * two measured conventions disagree and the name is what the descriptor already
 * states:
 *   - `prompt+output`, `prompt+output+reasoning` — cache is a SUBSET of the
 *     prompt total (OpenAI's `prompt_tokens`, Gemini's `promptTokenCount`
 *     include cache hits), so cache is subtracted before reporting `inputTokens`.
 *   - `input+output+cache` — cache is ADDITIVE: Anthropic's `input_tokens`
 *     EXCLUDES cache reads/writes, so the three input-side buckets are summed
 *     and nothing is subtracted.
 */
export const TOTAL_FORMULAS = Object.freeze({
  /** OpenAI-shaped: `total_tokens = prompt_tokens + completion_tokens`. */
  'prompt+output': (prompt, output) => prompt + output,
  /** Gemini-shaped: thoughts are separate from candidates, so they join the total. */
  'prompt+output+reasoning': (prompt, output, reasoning) => prompt + output + reasoning,
  /** Anthropic-shaped: cache reads/writes sit OUTSIDE `input_tokens` and join the total. */
  'input+output+cache': (input, output, reasoning, cacheRead = 0, cacheWrite = 0) =>
    input + cacheRead + cacheWrite + output,
})

/** The canonical name whose cache convention is additive rather than subset. */
export const ADDITIVE_FORMULA = 'input+output+cache'

/**
 * Legacy spellings kept resolvable instead of silently rejected.
 *
 * `'gemini'` was the second name in the provider driver contract while the
 * writer implemented `'prompt+output+reasoning'`; the two vocabularies met
 * nowhere, so a driver could name a formula the pipe then threw on. Resolving
 * here keeps a published name working and maps it onto the one implementation.
 */
export const FORMULA_ALIASES = Object.freeze({
  openai: 'prompt+output',
  gemini: 'prompt+output+reasoning',
})

/** Every accepted `totalFormula` name: the three formulas plus their aliases. */
export const ALL_FORMULAS = Object.freeze([
  ...Object.keys(TOTAL_FORMULAS),
  ...Object.keys(FORMULA_ALIASES),
])

/**
 * Resolve one accepted name to its canonical formula name.
 *
 * @param name - a canonical name, an alias, or anything else.
 * @returns the canonical name, or `undefined` when the name is not accepted.
 */
export function resolveFormula(name) {
  if (typeof name !== 'string') return undefined
  if (Object.prototype.hasOwnProperty.call(TOTAL_FORMULAS, name)) return name
  return FORMULA_ALIASES[name]
}

/**
 * Normalize one provider usage object onto the host's disjoint buckets.
 *
 * @param raw - the provider's usage object; may be partial.
 * @param options - `{ formula }`, default `'prompt+output'`.
 * @returns disjoint `TokenUsage`, or undefined when the object carries no counts.
 */
export function usageFrom(raw, options = {}) {
  if (raw === null || raw === undefined || typeof raw !== 'object') return undefined
  const requested = options.formula ?? 'prompt+output'
  const formulaName = resolveFormula(requested)
  if (formulaName === undefined) throw new TypeError(`unknown usage formula: ${String(requested)}`)
  const formula = TOTAL_FORMULAS[formulaName]
  const additiveCache = formulaName === ADDITIVE_FORMULA

  const promptTotal = count(raw.prompt_tokens)
  const completion = count(raw.completion_tokens)
  const reasoning = count(raw.completion_tokens_details?.reasoning_tokens)
  const cached = count(raw.prompt_tokens_details?.cached_tokens) ?? 0
  const written = count(raw.prompt_tokens_details?.cache_write_tokens) ?? 0

  if (promptTotal === undefined && completion === undefined) return undefined

  // Cache fields are subsets of the prompt total; clamp so a provider that
  // reports them independently cannot make the uncached remainder negative.
  // An additive-cache provider reports its input count ALREADY excluding cache,
  // so the same subtraction would delete real cache reads from the input bucket.
  const cacheRead = additiveCache ? cached : Math.min(cached, promptTotal ?? cached)
  const cacheWrite = additiveCache
    ? written
    : Math.min(written, Math.max(0, (promptTotal ?? 0) - cacheRead))
  const input = additiveCache
    ? Math.max(0, promptTotal ?? 0)
    : Math.max(0, (promptTotal ?? 0) - cacheRead - cacheWrite)

  const usage = { inputTokens: input, outputTokens: completion ?? 0 }
  if (cacheRead > 0) usage.cacheReadTokens = cacheRead
  if (cacheWrite > 0) usage.cacheWriteTokens = cacheWrite
  if (reasoning !== undefined && reasoning > 0) usage.reasoningTokens = reasoning

  const total = count(raw.total_tokens)
  if (total !== undefined && total === formula(promptTotal ?? 0, completion ?? 0, reasoning ?? 0, cacheRead, cacheWrite)) {
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

/**
 * Project an Anthropic usage object onto the canonical OpenAI-style names.
 *
 * This is the whole of Anthropic's usage convention, expressed as a pure
 * projection: `input`/`cacheRead`/`cacheWrite`/`output` are already DISJOINT, so
 * each maps straight onto its bucket and every writer rule below stays in
 * {@link usageFrom}. Anthropic's `input_tokens` EXCLUDES cache, which is what
 * the additive `input+output+cache` formula declares.
 *
 * @param raw - `{ input, cacheRead, cacheWrite, output, total? }`; every field optional.
 * @returns the canonical projection, or `undefined` when nothing usable is present.
 */
function readAnthropicUsage(raw) {
  const input = count(raw.input)
  const cacheRead = count(raw.cacheRead)
  const cacheWrite = count(raw.cacheWrite)
  const output = count(raw.output)
  if (input === undefined && cacheRead === undefined && cacheWrite === undefined && output === undefined) {
    return undefined
  }
  // Nothing is subtracted and nothing is summed here: the buckets are disjoint on
  // the wire, and a zero cache count must stay a visible omission rather than
  // become a claim of "this turn used the cache".
  //
  // `?? 0` on input/output preserves the original writer's shape exactly: an
  // event that carried only a cache count still reported `inputTokens: 0`, and a
  // projection that returned `undefined` here would drop that usage entirely.
  return {
    prompt: input ?? 0,
    completion: output ?? 0,
    cached: cacheRead,
    written: cacheWrite,
    total: count(raw.total),
  }
}

/**
 * Normalize an Anthropic usage object onto the host's disjoint buckets.
 *
 * The one Anthropic usage writer; it rides {@link usageFromProjection} so the
 * bucket rules cannot drift from OpenAI's or Gemini's.
 *
 * @param raw - `{ input, cacheRead, cacheWrite, output, total? }`.
 * @param options - accepted for `hooks.usageFrom(raw, options)` symmetry; the
 *   Anthropic formula is fixed by the descriptor.
 * @returns `{ inputTokens, cacheReadTokens?, cacheWriteTokens?, outputTokens, totalTokens? }`,
 *   or `undefined` when no field carries a usable count.
 */
export function usageFromAnthropic(raw = {}, options = {}) {
  const usage = usageFromProjection(
    raw,
    readAnthropicUsage,
    { ...options, formula: options.formula ?? ADDITIVE_FORMULA },
  )
  if (usage === undefined) return undefined
  // Emitted in the order the previous per-provider writer used (input, cache
  // read, cache write, output): the buckets are already identical, and this keeps
  // any serialized snapshot of an Anthropic usage object byte-identical too.
  const ordered = { inputTokens: usage.inputTokens }
  if (usage.cacheReadTokens !== undefined) ordered.cacheReadTokens = usage.cacheReadTokens
  if (usage.cacheWriteTokens !== undefined) ordered.cacheWriteTokens = usage.cacheWriteTokens
  ordered.outputTokens = usage.outputTokens
  if (usage.reasoningTokens !== undefined) ordered.reasoningTokens = usage.reasoningTokens
  if (usage.totalTokens !== undefined) ordered.totalTokens = usage.totalTokens
  return ordered
}
