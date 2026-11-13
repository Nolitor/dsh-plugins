import test from 'node:test'
import assert from 'node:assert/strict'
import { TOTAL_FORMULAS, usageFrom, usageFromProjection } from '../lib/stream/usage.js'

const openAiShape = () => ({
  prompt_tokens: 1000,
  completion_tokens: 200,
  total_tokens: 1200,
  prompt_tokens_details: { cached_tokens: 800 },
  completion_tokens_details: { reasoning_tokens: 150 },
})

test('buckets are disjoint: input is the uncached prompt remainder', () => {
  const usage = usageFrom(openAiShape())
  assert.equal(usage.inputTokens, 200)
  assert.equal(usage.cacheReadTokens, 800)
  assert.equal(usage.outputTokens, 200)
})

test('reasoning is a detail of output, never added on top of it', () => {
  const usage = usageFrom(openAiShape())
  assert.equal(usage.reasoningTokens, 150)
  assert.equal(usage.outputTokens, 200)
})

test('the provider total is preserved when it agrees with its own buckets', () => {
  assert.equal(usageFrom(openAiShape()).totalTokens, 1200)
})

test('an inconsistent provider total is omitted rather than repaired', () => {
  const raw = { ...openAiShape(), total_tokens: 999 }
  assert.equal(usageFrom(raw).totalTokens, undefined)
})

test('an absent total stays absent — a subset is not a call total', () => {
  const raw = openAiShape()
  delete raw.total_tokens
  const usage = usageFrom(raw)
  assert.equal(usage.totalTokens, undefined)
  assert.equal(usage.inputTokens + usage.outputTokens + usage.cacheReadTokens, 1200)
})

test('cache write is clamped inside the prompt total and never makes input negative', () => {
  const usage = usageFrom({
    prompt_tokens: 100,
    completion_tokens: 10,
    prompt_tokens_details: { cached_tokens: 60, cache_write_tokens: 500 },
  })
  assert.equal(usage.cacheReadTokens, 60)
  assert.equal(usage.cacheWriteTokens, 40)
  assert.equal(usage.inputTokens, 0)
})

test('the Gemini formula counts thoughts in the total because candidates exclude them', () => {
  const raw = {
    prompt_tokens: 1000,
    completion_tokens: 200,
    total_tokens: 1350,
    prompt_tokens_details: { cached_tokens: 800 },
    completion_tokens_details: { reasoning_tokens: 150 },
  }
  const openAi = usageFrom(raw, { formula: 'prompt+output' })
  assert.equal(openAi.totalTokens, undefined)
  const gemini = usageFrom(raw, { formula: 'prompt+output+reasoning' })
  assert.equal(gemini.totalTokens, 1350)
})

test('a usage object with no counts is not evidence of a zero call', () => {
  assert.equal(usageFrom({}), undefined)
  assert.equal(usageFrom(null), undefined)
  assert.equal(usageFrom({ estimated_cost: 0.01 }), undefined)
})

test('zero cache fields are omitted instead of emitted as zero', () => {
  const usage = usageFrom({ prompt_tokens: 10, completion_tokens: 2 })
  assert.equal('cacheReadTokens' in usage, false)
  assert.equal('cacheWriteTokens' in usage, false)
})

test('an unknown formula is refused instead of quietly defaulting', () => {
  assert.throws(() => usageFrom(openAiShape(), { formula: 'invented' }), TypeError)
  // Three first-class conventions, one per live protocol: OpenAI, Anthropic and
  // Gemini. Aliases (`openai`, `gemini`) resolve onto these, they are not extras.
  assert.deepEqual(Object.keys(TOTAL_FORMULAS), [
    'prompt+output',
    'prompt+output+reasoning',
    'input+output+cache',
  ])
})

test('a provider with its own field names projects onto the same writer', () => {
  const usage = usageFromProjection(
    { promptTokenCount: 1000, candidatesTokenCount: 200, thoughtsTokenCount: 150, cachedContentTokenCount: 800, totalTokenCount: 1350 },
    (raw) => ({
      prompt: raw.promptTokenCount,
      completion: raw.candidatesTokenCount,
      reasoning: raw.thoughtsTokenCount,
      cached: raw.cachedContentTokenCount,
      total: raw.totalTokenCount,
    }),
    { formula: 'prompt+output+reasoning' },
  )
  assert.deepEqual(usage, {
    inputTokens: 200,
    outputTokens: 200,
    cacheReadTokens: 800,
    reasoningTokens: 150,
    totalTokens: 1350,
  })
})

test('a projection that finds nothing yields undefined rather than zeros', () => {
  assert.equal(usageFromProjection({}, () => ({})), undefined)
})
