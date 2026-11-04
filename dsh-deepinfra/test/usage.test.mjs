import assert from 'node:assert/strict'
import test from 'node:test'

import { estimatedCost, discountFactor, providerCost, reasoningTokensOf, tokenUsage } from '../lib/usage.js'

/**
 * The provider's real usage object, captured 2026-11-04 from
 * deepseek-ai/DeepSeek-V4.1-Flash (catalog input $0.20 / output $0.60 per Mtok,
 * cache_read $0.006, discount 0.30).
 */
const MEASURED = {
  prompt_tokens: 7,
  total_tokens: 9,
  completion_tokens: 2,
  estimated_cost: 0.00000182,
  prompt_tokens_details: { cached_tokens: 0, cache_write_tokens: null },
  completion_tokens_details: { reasoning_tokens: 0 },
}

test('buckets are disjoint: input is the UNCACHED remainder', () => {
  // DeepInfra folds cache hits into prompt_tokens exactly like DeepSeek, so a
  // naive mapping double-counts cached input. Measured on a warm prefix:
  // prompt_tokens 9612 with cached_tokens 9600.
  const usage = tokenUsage({ prompt_tokens: 9612, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 9600 } })
  assert.equal(usage.cacheReadTokens, 9600)
  assert.equal(usage.inputTokens, 12)
  assert.equal(usage.inputTokens + usage.cacheReadTokens, 9612)
})

test('totalTokens is preserved only when it matches the buckets', () => {
  assert.equal(tokenUsage(MEASURED).totalTokens, 9)
  // An inconsistent total is worse than none.
  assert.equal(tokenUsage({ prompt_tokens: 10, completion_tokens: 5, total_tokens: 999 }).totalTokens, undefined)
})

test('reasoning tokens are detail, never added to output', () => {
  const usage = tokenUsage({ prompt_tokens: 10, completion_tokens: 40, completion_tokens_details: { reasoning_tokens: 25 } })
  assert.equal(usage.outputTokens, 40)
  assert.equal(usage.reasoningTokens, 25)
})

test('absent reasoning_tokens reports undefined, not zero', () => {
  // Measured: gpt-oss-120b and claude-sonnet-5 stream reasoning but omit the field.
  assert.equal(reasoningTokensOf({ completion_tokens_details: null }), undefined)
  assert.equal(reasoningTokensOf({}), undefined)
  assert.equal(tokenUsage({ prompt_tokens: 1, completion_tokens: 2 }).reasoningTokens, undefined)
})

test('no usable counts means no usage chunk', () => {
  assert.equal(tokenUsage(undefined), undefined)
  assert.equal(tokenUsage({}), undefined)
})

test('provider cost is used verbatim when present', () => {
  const cost = providerCost(MEASURED)
  assert.equal(cost.source, 'provider')
  assert.equal(cost.amount, 0.00000182)
  assert.equal(cost.currency, 'USD')
})

test('a negative or non-numeric cost is rejected', () => {
  assert.equal(providerCost({ estimated_cost: -1 }), undefined)
  assert.equal(providerCost({ estimated_cost: 'free' }), undefined)
  assert.equal(providerCost({}), undefined)
})

test('discount is a fraction to subtract, verified against provider cost', () => {
  // Measured ratios: DeepSeek-V4.1-Flash discount 0.3 -> pays 0.7;
  // GLM-5.2 0.25 -> 0.75; Qwen3.8-27B 0.25 -> 0.75; no discount -> 1.0.
  assert.equal(discountFactor(0.3), 0.7)
  assert.equal(discountFactor(0.25), 0.75)
  assert.equal(discountFactor(null), 1)
  assert.equal(discountFactor(undefined), 1)
  assert.equal(discountFactor(1), 1)
  assert.equal(discountFactor(-0.2), 1)
})

test('the local estimate reproduces the provider number on a discounted route', () => {
  // This is the check the brief asked for and did not have: with discount
  // applied, derived cost equals provider cost exactly.
  const pricing = { input_tokens: 0.2, output_tokens: 0.6, cache_read_tokens: 0.006 }
  const usage = { prompt_tokens: 15, completion_tokens: 50, prompt_tokens_details: { cached_tokens: 0 } }
  const providerReported = 0.0000231
  const derived = estimatedCost(usage, pricing, 0.3)
  assert.equal(Number(derived.toFixed(10)), Number(providerReported.toFixed(10)))
})

test('a cache rate is applied only where the catalog publishes one', () => {
  const withCache = { input_tokens: 1, output_tokens: 2, cache_read_tokens: 0.1 }
  const withoutCache = { input_tokens: 1, output_tokens: 2 }
  const usage = { prompt_tokens: 1_000_000, completion_tokens: 0, prompt_tokens_details: { cached_tokens: 1_000_000 } }
  // 1M cached tokens: published rate 0.1 vs falling back to the input rate 1.
  assert.equal(estimatedCost(usage, withCache, null), 0.1)
  assert.equal(estimatedCost(usage, withoutCache, null), 1)
})

test('missing pricing yields no estimate rather than a wrong one', () => {
  assert.equal(estimatedCost({ prompt_tokens: 5, completion_tokens: 5 }, undefined, 0), undefined)
  assert.equal(estimatedCost({}, {}, null), undefined)
})
