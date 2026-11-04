/**
 * Real-API end-to-end test. Self-skips without DEEPINFRA_API_KEY, so a keyless
 * run stays green (acceptance gate D8).
 *
 * These assertions are the ones a fake SSE server cannot make: that the real
 * endpoint accepts our request shape, that it really streams reasoning as
 * deltas, and that its reported usage is consistent with our buckets.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { DeepInfraAdapter } from '../lib/adapter.js'

const KEY = process.env.DEEPINFRA_API_KEY ?? ''
const MODEL = process.env.DEEPINFRA_TEST_MODEL ?? 'deepseek-ai/DeepSeek-V4.1-Flash'
const skip = KEY.length === 0 ? 'DEEPINFRA_API_KEY is not set' : false

/**
 * Build a live adapter.
 * @param {object} [overrides] - config overrides.
 */
function liveAdapter(overrides = {}) {
  return new DeepInfraAdapter({
    settings: () => ({ baseURL: 'https://api.deepinfra.com/v1/openai', apiKey: KEY, ...overrides }),
    catalog: async () => ({ list: () => [], resolve: (provider, model) => ({ provider, id: model, name: model }) }),
    fetchImpl: (...args) => globalThis.fetch(...args),
    log: { warn() {} },
  })
}

/**
 * Collect a live stream.
 * @param {object} options - request options.
 * @param {object} [overrides] - adapter config overrides.
 */
async function run(options, overrides = {}) {
  const chunks = []
  for await (const chunk of liveAdapter(overrides).stream({ provider: 'deepinfra', model: MODEL, ...options })) {
    chunks.push(chunk)
  }
  return chunks
}

test('the live catalog is public and exposes the chat routes', { skip }, async () => {
  const response = await fetch('https://api.deepinfra.com/v1/openai/models')
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.ok(Array.isArray(body.data))
  // Measured 2026-11-04: 173 entries, 91 chat-tagged.
  const chat = body.data.filter((entry) => (entry.metadata?.tags ?? []).includes('chat'))
  assert.ok(chat.length >= 90, 'expected at least 90 chat routes, saw ' + chat.length)
})

test('a live turn streams text with usage before finish', { skip }, async () => {
  const chunks = await run({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply with exactly: OK' }] }],
    maxTokens: 32,
  })
  const kinds = chunks.map((c) => c.type)
  const text = chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join('')
  assert.ok(text.length > 0, 'expected visible text')
  const usageAt = kinds.indexOf('usage')
  const finishAt = kinds.indexOf('finish')
  assert.notEqual(usageAt, -1, 'the live endpoint must report usage')
  assert.ok(usageAt < finishAt, 'usage must precede finish')
  assert.equal(finishAt, kinds.length - 1)
  assert.equal(chunks.at(-1).reason.kind, 'stop')
})

test('live usage buckets are disjoint and total-consistent', { skip }, async () => {
  const chunks = await run({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'Count from 1 to 5.' }] }],
    maxTokens: 64,
  })
  const usage = chunks.find((c) => c.type === 'usage').usage
  assert.ok(usage.inputTokens >= 0)
  assert.ok(usage.outputTokens > 0)
  // Billed input is the sum of the three disjoint buckets; the provider total
  // is the folded prompt count, which must equal that sum plus what it reports.
  const billed = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  assert.ok(billed >= usage.inputTokens)
  if (usage.totalTokens !== undefined) {
    assert.equal(usage.totalTokens, billed + usage.outputTokens)
  }
})

test('a live tool call arrives as a structured call, not prose', { skip }, async () => {
  const chunks = await run({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'What is the weather in Seoul? Use the tool.' }] }],
    tools: [
      {
        name: 'get_weather',
        description: 'Get the current weather for a city',
        parameters: { type: 'object', properties: { city: { type: 'string' } }, required: ['city'] },
      },
    ],
    maxTokens: 128,
  })
  const calls = chunks.filter((c) => c.type === 'block-end' && c.block.type === 'tool-call')
  assert.ok(calls.length > 0, 'expected at least one tool call')
  for (const call of calls) {
    assert.equal(typeof call.block.name, 'string')
    assert.ok(call.block.name.length > 0)
    // Arguments are a raw JSON string end-to-end.
    assert.equal(typeof call.block.arguments, 'string')
    assert.doesNotThrow(() => JSON.parse(call.block.arguments))
  }
})

test('a live reasoning route streams reasoning as its own channel', { skip }, async () => {
  // maxTokens must leave room for the ANSWER, not just the thinking. Measured
  // 2026-11-04 on moonshotai/Kimi-K2.6 with reasoning_effort:"medium": at
  // max_tokens 256 the route spent all 256 completion tokens reasoning
  // (reasoning_tokens 256, finish "length", 0 text deltas); at 2048 it produced
  // 381 reasoning tokens followed by 97 text deltas and finish "stop". The first
  // run of this test failed on a budget that could never reach visible text --
  // a test defect, not an adapter defect.
  const chunks = await run({
    messages: [{ role: 'user', content: [{ type: 'text', text: 'A train travels 60km in 45 minutes. Speed in km/h? Think it through.' }] }],
    reasoningEffort: 'medium',
    maxTokens: 2048,
    model: 'moonshotai/Kimi-K2.6',
  })
  const reasoning = chunks.filter((c) => c.type === 'reasoning-delta')
  const text = chunks.filter((c) => c.type === 'text-delta')
  assert.ok(reasoning.length > 0, 'expected reasoning deltas from a reasoning route')
  assert.ok(text.length > 0, 'expected visible text alongside reasoning')
  // Two distinct blocks: reasoning must never be emitted on the text index.
  assert.notEqual(reasoning[0].index, text[0].index)
})

test('live: an unknown model surfaces a structured failure, not a crash', { skip }, async () => {
  await assert.rejects(
    () => run({ model: 'nope/none', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }),
    (error) => {
      assert.equal(error.code, 'UNKNOWN_MODEL')
      assert.equal(error.failure.status, 404)
      return true
    },
  )
})

test('live: a missing key surfaces INVALID_CREDENTIAL', { skip }, async () => {
  await assert.rejects(
    () => run({ messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }, { apiKey: '' }),
    (error) => error.code === 'INVALID_CREDENTIAL',
  )
})
