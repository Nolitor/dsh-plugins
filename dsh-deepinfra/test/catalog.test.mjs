import assert from 'node:assert/strict'
import test from 'node:test'

import {
  REASONING_EFFORTS,
  chatRoutes,
  isSupportedEffort,
  indexRoutes,
  pricesOf,
  promotionOf,
  toModelInfo,
  toResolvedModelInfo,
} from '../lib/catalog.js'

/** A catalog row shaped exactly like the live payload. */
const ROW = {
  id: 'deepseek-ai/DeepSeek-V4.1-Flash',
  object: 'model',
  metadata: {
    description: 'Multimodal MoE with one-million-token context',
    context_length: 1048576,
    max_tokens: 1048576,
    pricing: { input_tokens: 0.2, output_tokens: 0.6, cache_read_tokens: 0.006 },
    discount: 0.3,
    tags: ['chat', 'vlm', 'vision', 'prompt_cache', 'reasoning'],
  },
}

test('only chat-tagged routes are exposed', () => {
  // Measured tag counts: embedding 25, tts 13, image-gen 27, video-gen 10, stt 7
  // -- none of them carry "chat".
  const entries = [
    ROW,
    { id: 'BAAI/bge-m3', metadata: { tags: ['embed'] } },
    { id: 'hexgrad/Kokoro-82M', metadata: { tags: ['tts'] } },
    { id: 'no-tags' },
  ]
  assert.deepEqual(chatRoutes(entries).map((e) => e.id), [ROW.id])
})

test('vision and vlm both advertise the image modality', () => {
  assert.deepEqual(toModelInfo('deepinfra', ROW).inputModalities, ['text', 'image'])
  // 52 live routes carry both tags; a route with neither is text-only.
  assert.equal(toModelInfo('deepinfra', { id: 'x', metadata: { tags: ['chat'] } }).inputModalities, undefined)
})

test('the catalog context_length becomes contextWindow', () => {
  assert.deepEqual(toResolvedModelInfo('deepinfra', ROW, {}).context, { contextWindow: 1048576 })
})

test('max_tokens is NOT advertised as defaultMaxTokens', () => {
  // Measured: on all 91 chat routes max_tokens === context_length, so using it as
  // an output cap would reserve a whole 1M window for one answer.
  const withoutTurnPolicy = toResolvedModelInfo('deepinfra', ROW, {})
  assert.equal(withoutTurnPolicy.defaultMaxTokens, undefined)

  const withTurnPolicy = toResolvedModelInfo('deepinfra', ROW, { defaultMaxTokens: 16384 })
  assert.equal(withTurnPolicy.defaultMaxTokens, 16384)
})

test('the turn reservation never exceeds the context window', () => {
  const narrow = { id: 'small', metadata: { context_length: 8192, tags: ['chat'] } }
  assert.equal(toResolvedModelInfo('deepinfra', narrow, { defaultMaxTokens: 16384 }).defaultMaxTokens, 8192)
})

test('reasoning is advertised only when a route carries a reasoning tag', () => {
  assert.equal(toResolvedModelInfo('deepinfra', ROW, {}).reasoning.efforts.length, REASONING_EFFORTS.length)
  const plain = { id: 'plain', metadata: { tags: ['chat'] } }
  assert.equal(toResolvedModelInfo('deepinfra', plain, {}).reasoning, undefined)
})

test('reasoning_effort alone is enough to advertise efforts', () => {
  // Measured: 7 routes carry reasoning_effort without reasoning.
  const effortOnly = { id: 'effort-only', metadata: { tags: ['chat', 'reasoning_effort'] } }
  assert.notEqual(toResolvedModelInfo('deepinfra', effortOnly, {}).reasoning, undefined)
})

test('efforts are ordered least to greatest and match the provider enum', () => {
  // The provider rejects anything else with HTTP 422 naming exactly these seven.
  assert.deepEqual(REASONING_EFFORTS.map((e) => e.id), ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'])
  assert.equal(isSupportedEffort('high'), true)
  assert.equal(isSupportedEffort('ultra'), false)
  assert.equal(isSupportedEffort(''), false)
})

test('defaultEffort is only advertised when it is a supported id', () => {
  assert.equal(toResolvedModelInfo('deepinfra', ROW, { defaultEffort: 'high' }).reasoning.defaultEffort, 'high')
  assert.equal(toResolvedModelInfo('deepinfra', ROW, { defaultEffort: 'ultra' }).reasoning.defaultEffort, undefined)
})

test('a promotion is derived from metadata.discount', () => {
  // Measured 2026-11-04: 8 of the 91 chat routes carry a discount, from 0.10 to
  // 0.75. The catalog has no "featured"/"promo" tag — only capability tags — so
  // an offer MUST be derived from the discount field.
  const promo = promotionOf({ metadata: { discount: 0.3 } })
  assert.equal(promo.discount, 0.3)
  assert.equal(promo.paysRatio, 0.7)
  assert.equal(promo.percentOff, 30)
})

test('a list-price route is not a promotion', () => {
  assert.equal(promotionOf({ metadata: {} }), null)
  assert.equal(promotionOf({ metadata: { discount: 0 } }), null)
  assert.equal(promotionOf({ metadata: { discount: null } }), null)
  // A nonsensical discount is not a promotion either.
  assert.equal(promotionOf({ metadata: { discount: 1 } }), null)
  assert.equal(promotionOf({ metadata: { discount: -0.1 } }), null)
})

test('effective prices apply the promotion, list prices do not', () => {
  const prices = pricesOf({ metadata: { discount: 0.3, pricing: { input_tokens: 0.2, output_tokens: 0.6, cache_read_tokens: 0.006 } } })
  assert.equal(prices.listInput, 0.2)
  assert.equal(prices.listOutput, 0.6)
  assert.equal(Number(prices.input.toFixed(10)), 0.14)
  assert.equal(Number(prices.output.toFixed(10)), 0.42)
  assert.equal(Number(prices.cacheRead.toFixed(10)), 0.0042)
})

test('a route with no pricing publishes null, not zero', () => {
  const prices = pricesOf({ metadata: { tags: ['chat'] } })
  assert.equal(prices.input, null)
  assert.equal(prices.output, null)
  assert.equal(prices.promotion, null)
})

test('indexRoutes keys by model id', () => {
  const index = indexRoutes([ROW])
  assert.equal(index.get(ROW.id), ROW)
  assert.equal(index.size, 1)
})

test('a route with no context_length advertises no context', () => {
  const info = toResolvedModelInfo('deepinfra', { id: 'x', metadata: { tags: ['chat'] } }, { defaultMaxTokens: 16384 })
  assert.equal(info.context, undefined)
  assert.equal(info.defaultMaxTokens, 16384)
})
