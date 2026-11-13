/**
 * Protocol conformance: one recorded OpenAI-completions stream through every
 * router binding that speaks it.
 *
 * The router's promise is that a wire change is re-standardized ONCE, not once
 * per vendor. This test pins that promise for the OpenAI-completions family:
 * DeepInfra, EXAONE and OpenCode each bind the same shared `lib/stream` pipe
 * through their own contract module, so the same bytes must produce the same
 * canonical semantic view.
 *
 * Covered: reasoning/text deltas, fragmented tool calls, finish reason, usage
 * buckets (input/cacheRead/output/reasoning/total).
 * Not covered: request serialization, vendor HTTP, retries, and per-vendor
 * catalog/pricing facts. Those live in the vendor tests and `specs/`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { normalizeStream, readSseEvents } from '../../lib/stream/index.js'
import {
  STREAM_DESCRIPTOR as DEEPINFRA_DESCRIPTOR,
  STREAM_HOOKS as DEEPINFRA_HOOKS,
} from '../../vendor/deepinfra/lib/stream-contract.js'
import {
  STREAM_DESCRIPTOR as EXAONE_DESCRIPTOR,
  STREAM_HOOKS as EXAONE_HOOKS,
} from '../../vendor/exaone/lib/stream-contract.js'
import {
  OPENCODE_DESCRIPTOR,
  createStreamHooks as createOpencodeHooks,
} from '../../vendor/opencode/lib/stream-contract.js'

/** One recorded SSE body shared by every binding. */
const FIXTURE = readFileSync(new URL('./fixtures/openai-completions.sse', import.meta.url), 'utf8')

/**
 * The three bindings under test.
 *
 * OpenCode's hooks are per-stream (its classifier carries state), so its factory
 * is called inside the run, never shared between runs.
 */
const BINDINGS = Object.freeze([
  Object.freeze({
    name: 'deepinfra',
    descriptor: DEEPINFRA_DESCRIPTOR,
    hooks: () => DEEPINFRA_HOOKS,
  }),
  Object.freeze({
    name: 'exaone',
    descriptor: EXAONE_DESCRIPTOR,
    hooks: () => EXAONE_HOOKS,
  }),
  Object.freeze({
    name: 'opencode',
    descriptor: OPENCODE_DESCRIPTOR,
    hooks: () => createOpencodeHooks(),
  }),
])

/**
 * Collapse raw stream chunks onto the semantic view every binding must agree on.
 *
 * Zero-valued optional usage buckets are dropped: a binding that writes
 * `cacheWriteTokens: 0` and one that omits it describe the same usage. Any
 * NON-zero bucket must match exactly.
 *
 * @param {object[]} chunks - normalized chunks from one binding.
 * @returns {object} the canonical semantic view.
 */
function project(chunks) {
  const view = { reasoning: '', text: '', tool: null, finish: null, usage: null }
  for (const chunk of chunks) {
    if (chunk.type === 'reasoning-delta') view.reasoning += chunk.text
    else if (chunk.type === 'text-delta') view.text += chunk.text
    else if (chunk.type === 'block-end' && chunk.block?.type === 'tool-call') {
      view.tool = {
        id: chunk.block.id,
        name: chunk.block.name,
        arguments: chunk.block.arguments,
      }
    } else if (chunk.type === 'finish') view.finish = chunk.reason
    else if (chunk.type === 'usage') {
      const usage = { ...chunk.usage }
      for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']) {
        if (usage[key] === 0) delete usage[key]
      }
      view.usage = usage
    }
  }
  return view
}

/**
 * Drive one binding over the recorded fixture.
 * @param {{name: string, descriptor: object, hooks: Function}} binding - binding under test.
 * @returns {Promise<object>} the canonical semantic view.
 */
async function run(binding) {
  const events = readSseEvents(new Response(FIXTURE).body, { malformed: 'fail' })
  const chunks = []
  for await (const chunk of normalizeStream({
    events,
    descriptor: binding.descriptor,
    hooks: binding.hooks(),
    signal: undefined,
  })) chunks.push(chunk)
  return project(chunks)
}

test('the same OpenAI-completions stream normalizes identically on every binding', async () => {
  const results = {}
  for (const binding of BINDINGS) results[binding.name] = await run(binding)

  // Pin the canonical meaning, not just mutual agreement: three bindings that
  // all regress the same way would otherwise pass.
  assert.deepEqual(results.deepinfra, {
    reasoning: 'think ',
    text: 'answer',
    tool: { id: 'call_1', name: 'lookup', arguments: '{"q":"x"}' },
    finish: { kind: 'tool-calls' },
    usage: {
      inputTokens: 90,
      outputTokens: 20,
      cacheReadTokens: 10,
      reasoningTokens: 5,
      totalTokens: 120,
    },
  })

  for (const name of ['exaone', 'opencode']) {
    assert.deepEqual(
      results[name],
      results.deepinfra,
      `${name} diverged from the shared OpenAI-completions normalization`,
    )
  }
})

test('the fixture exercises every signal the conformance view reads', async () => {
  const view = await run(BINDINGS[0])
  assert.notEqual(view.reasoning, '', 'reasoning delta missing')
  assert.notEqual(view.text, '', 'text delta missing')
  assert.ok(view.tool?.id && view.tool?.name && view.tool?.arguments, 'tool-call fragment missing')
  assert.equal(view.finish?.kind, 'tool-calls', 'finish reason missing')
  assert.equal(view.usage?.cacheReadTokens, 10, 'cached tokens must be split from input')
  assert.equal(view.usage?.reasoningTokens, 5, 'reasoning tokens must be reported')
})

test('a malformed record fails instead of truncating the turn', async () => {
  const broken = 'data: {"choices": [}\n\ndata: [DONE]\n\n'
  await assert.rejects(async () => {
    const events = readSseEvents(new Response(broken).body, { malformed: 'fail' })
    for await (const _chunk of normalizeStream({
      events,
      descriptor: EXAONE_DESCRIPTOR,
      hooks: EXAONE_HOOKS,
      signal: undefined,
    })) { /* drain */ }
  }, (error) => error?.code === 'PROTOCOL_DEFECT' || /undecodable/i.test(String(error?.message)))
})
