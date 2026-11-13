/**
 * Core consolidation locks (Phase 1, A1 / W1-2a).
 *
 * Three things were forked inside L1 and are pinned here so they cannot drift
 * back apart:
 *   1. ONE `totalFormula` vocabulary — the provider driver contract and the
 *      usage writer must accept the same names, or a descriptor validates and
 *      the pipe then throws on it.
 *   2. ONE Anthropic usage writer — folded into `lib/stream/usage.js` as a
 *      projection. Its buckets and its serialized key order must match the
 *      per-provider writer it replaced, measured against the committed fixture.
 *   3. ONE `abortError` factory — all three former call sites raise the same
 *      shape, so a cancellation looks the same whichever layer notices it.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  ADDITIVE_FORMULA,
  ALL_FORMULAS,
  FORMULA_ALIASES,
  TOTAL_FORMULAS,
  resolveFormula,
  usageFrom,
  usageFromAnthropic,
} from '../lib/stream/usage.js'
import { ABORT_MESSAGE, abortError } from '../lib/stream/failure.js'
import { ANTHROPIC_DESCRIPTOR, createAnthropicHooks, readAnthropicSse } from '../lib/stream/anthropic.js'
import { defineProviderDriver } from '../lib/driver/contract.js'
import { normalizeStream } from '../lib/stream/index.js'
import { readSseEvents } from '../lib/stream/sse.js'
import { createAnthropicBinding } from '../vendor/deepinfra/lib/stream-anthropic.js'
import { readFileSync } from 'node:fs'

/** The committed recorded Anthropic SSE body, shared with the conformance suite. */
const FIXTURE = readFileSync(new URL('./conformance/fixtures/anthropic-messages.sse', import.meta.url), 'utf8')

/** A driver spec that differs from a live vendor only in its `totalFormula`. */
function specWithFormula(totalFormula) {
  return {
    id: `probe-${totalFormula}`,
    descriptor: { toolCallShape: 'fragmented', usage: { totalFormula }, malformedRecord: 'fail' },
    hooks: { readEvent: () => null },
    surfaces: { model: { adapter: true, factory: 'createAdapter' } },
    activation: { switches: [{ name: 'probe', module: 'probe-module', role: 'adapter' }] },
  }
}

test('the three formulas are first-class and every accepted name resolves', () => {
  assert.deepEqual(Object.keys(TOTAL_FORMULAS), [
    'prompt+output',
    'prompt+output+reasoning',
    'input+output+cache',
  ])

  // Five names resolve: the three implementations plus their two legacy aliases.
  assert.equal(ALL_FORMULAS.length, 5)
  for (const name of ALL_FORMULAS) {
    assert.ok(typeof resolveFormula(name) === 'string', `${name} must resolve`)
    assert.ok(TOTAL_FORMULAS[resolveFormula(name)], `${name} must resolve to an implementation`)
  }

  // The dead alias is no longer a dead end: `gemini` used to throw here.
  assert.equal(resolveFormula('gemini'), 'prompt+output+reasoning')
  assert.equal(resolveFormula('openai'), 'prompt+output')
  assert.deepEqual(Object.keys(FORMULA_ALIASES), ['openai', 'gemini'])

  // An invented name is still refused rather than quietly defaulted.
  assert.equal(resolveFormula('invented'), undefined)
  assert.throws(() => usageFrom({ prompt_tokens: 1 }, { formula: 'invented' }), TypeError)
})

test('every accepted formula name is applied, not just validated', () => {
  // `gemini` throwing was the measured defect; it must now produce buckets.
  const gemini = usageFrom(
    { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 },
    { formula: 'gemini' },
  )
  assert.deepEqual(gemini, { inputTokens: 10, outputTokens: 2, totalTokens: 12 })

  // Additive: 10 input + 5 output + 90 cache read + 5 cache write = 110.
  const anthropic = usageFrom(
    {
      prompt_tokens: 10,
      completion_tokens: 5,
      prompt_tokens_details: { cached_tokens: 90, cache_write_tokens: 5 },
      total_tokens: 110,
    },
    { formula: 'input+output+cache' },
  )
  assert.deepEqual(anthropic, {
    inputTokens: 10,
    outputTokens: 5,
    cacheReadTokens: 90,
    cacheWriteTokens: 5,
    totalTokens: 110,
  })

  // The same numbers under the subset formula are NOT a call total, because
  // 90 cache reads are subtracted from the prompt total instead of added.
  const asOpenAi = usageFrom(
    { prompt_tokens: 10, completion_tokens: 5, prompt_tokens_details: { cached_tokens: 90 }, total_tokens: 110 },
    { formula: 'prompt+output' },
  )
  assert.equal(asOpenAi.totalTokens, undefined, 'the cache convention follows the formula name')
})

test('every live descriptor validates because the vocabulary is single-sourced', () => {
  // The three formulas the three protocols actually declare. Before the
  // unification, `input+output+cache` and `prompt+output+reasoning` were both
  // rejected here while `gemini` was accepted and then threw in the writer.
  for (const totalFormula of Object.keys(TOTAL_FORMULAS)) {
    const driver = defineProviderDriver(specWithFormula(totalFormula))
    assert.equal(driver.descriptor.usage.totalFormula, totalFormula)
    assert.equal(driver.descriptor.usage.totalFormula, resolveFormula(totalFormula))
  }

  // The live Anthropic descriptor is accepted as-is, not a copy of it.
  const anthropicDriver = defineProviderDriver({
    ...specWithFormula(ANTHROPIC_DESCRIPTOR.usage.totalFormula),
    id: 'anthropic-live',
  })
  assert.equal(anthropicDriver.descriptor.usage.totalFormula, ADDITIVE_FORMULA)

  // The Antigravity (Gemini) descriptor is accepted as-is.
  const antigravityDriver = defineProviderDriver(specWithFormula('prompt+output+reasoning'))
  assert.equal(antigravityDriver.descriptor.usage.totalFormula, 'prompt+output+reasoning')

  // An unnamed formula still names its field path.
  assert.throws(() => defineProviderDriver(specWithFormula('sum')), /descriptor\.usage\.totalFormula/)
})

test('the Anthropic projection keeps its bucket shape and omission rules', () => {
  // The additive convention: `input` is NOT reduced by cache.
  assert.deepEqual(usageFromAnthropic({ input: 10, cacheRead: 90, cacheWrite: 5, output: 5 }), {
    inputTokens: 10,
    cacheReadTokens: 90,
    cacheWriteTokens: 5,
    outputTokens: 5,
  })

  // A provider total is kept only when it agrees with the additive formula.
  assert.equal(usageFromAnthropic({ input: 10, cacheRead: 90, cacheWrite: 5, output: 5, total: 110 }).totalTokens, 110)
  assert.equal(usageFromAnthropic({ input: 10, cacheRead: 90, cacheWrite: 5, output: 5, total: 999 }).totalTokens, undefined)
  assert.equal(usageFromAnthropic({ input: 10, output: 5 }).totalTokens, undefined)

  // A zero cache count is an omission, never a claim.
  const uncached = usageFromAnthropic({ input: 5, cacheRead: 0, cacheWrite: 0, output: 2 })
  assert.deepEqual(uncached, { inputTokens: 5, outputTokens: 2 })
  assert.equal('cacheReadTokens' in uncached, false)
  assert.equal('cacheWriteTokens' in uncached, false)

  // Nothing usable means undefined, not a bag of zeros.
  assert.equal(usageFromAnthropic({}), undefined)
  assert.equal(usageFromAnthropic({ input: 'ten', output: -1 }), undefined)
  assert.equal(usageFromAnthropic(null), undefined)
})

test('the reversed key order of the old writer is preserved byte-for-byte', () => {
  // Not cosmetic: a serialized usage object used to read input, cache, cache,
  // output. Buckets already match; this pins the whole serialization.
  assert.equal(
    JSON.stringify(usageFromAnthropic({ input: 12, cacheRead: 34, cacheWrite: 5, output: 7 })),
    '{"inputTokens":12,"cacheReadTokens":34,"cacheWriteTokens":5,"outputTokens":7}',
  )
})

test('the Anthropic writer rides the shared projection seam, not a private copy', () => {
  // The provenance marker: the moved function is exported by usage.js, and
  // anthropic.js only re-exports it, so a second implementation cannot silently
  // reappear next to the protocol reader.
  const hooks = createAnthropicHooks()
  assert.equal(hooks.hooks.usageFrom, usageFromAnthropic)

  // It is the same function identity the shared module exports.
  assert.equal(
    typeof usageFromAnthropic,
    'function',
    'usage.js must export the one Anthropic writer',
  )
})

test('an aborted signal raises the one AbortError shape from every layer', async () => {
  const expected = { name: 'AbortError', message: ABORT_MESSAGE }

  const shapeOf = (error) => ({ name: error.name, message: error.message })

  // 1. The factory itself.
  assert.deepEqual(shapeOf(abortError()), expected)
  assert.ok(abortError() instanceof Error)

  // 2. The SSE reader (lib/stream/sse.js).
  const controller = new AbortController()
  controller.abort()
  const sseError = await (async () => {
    try {
      for await (const _ of readSseEvents(new Response('data: {"a":1}\n\n').body, { signal: controller.signal })) { /* drain */ }
    } catch (error) {
      return error
    }
    return undefined
  })()
  assert.deepEqual(shapeOf(sseError), expected)

  // 3. The Anthropic reader (lib/stream/anthropic.js).
  const anthropicError = await (async () => {
    try {
      for await (const _ of readAnthropicSse(new Response('event: ping\ndata: {}\n\n').body, { signal: controller.signal })) { /* drain */ }
    } catch (error) {
      return error
    }
    return undefined
  })()
  assert.deepEqual(shapeOf(anthropicError), expected)

  // 4. The shared pipe (lib/stream/index.js) raises the same factory but, by
  // contract, converts a caller cancellation into an IN-BAND terminal chunk
  // rather than a throw — so the identity is asserted on the chunk it emits.
  const pipeChunks = []
  for await (const chunk of normalizeStream({
    events: (async function* () { yield { type: 'message_stop' } })(),
    descriptor: ANTHROPIC_DESCRIPTOR,
    createHooks: () => createAnthropicHooks().hooks,
    signal: controller.signal,
  })) pipeChunks.push(chunk)

  const finish = pipeChunks[pipeChunks.length - 1]
  assert.equal(finish.type, 'finish')
  assert.equal(finish.reason.kind, 'aborted')
  assert.equal(finish.reason.failure.code, 'ABORTED')
})

test('the moved writer reproduces the committed fixture usage exactly', async () => {
  // Parity against the recorded wire, not against a hand-written shape: the
  // fixture reports input 60 / cache_read 10 / cache_creation 20 / output 20 and
  // NO total, so an invented `totalTokens` or a cache-reduced `inputTokens` fails.
  const handle = createAnthropicBinding()
  const chunks = []
  for await (const chunk of normalizeStream({
    events: readAnthropicSse(new Response(FIXTURE).body),
    descriptor: handle.descriptor,
    createHooks: () => handle.hooks,
  })) chunks.push(chunk)

  const usageChunks = chunks.filter((chunk) => chunk.type === 'usage')
  assert.ok(usageChunks.length >= 1, 'the fixture must produce a usage chunk')

  const last = usageChunks[usageChunks.length - 1].usage
  assert.deepEqual(last, {
    inputTokens: 60,
    cacheReadTokens: 10,
    cacheWriteTokens: 20,
    outputTokens: 20,
  })
  assert.equal('totalTokens' in last, false, 'no total was reported by the provider')

  // The accumulator's own snapshot projects onto the identical buckets.
  assert.deepEqual(
    usageFromAnthropic(handle.usage()),
    {
      inputTokens: 60,
      cacheReadTokens: 10,
      cacheWriteTokens: 20,
      outputTokens: 20,
    },
  )
})
