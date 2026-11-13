/**
 * Protocol conformance: one recorded Anthropic-messages stream through every
 * router binding that speaks it, plus the request-side pairing rule.
 *
 * Two independent promises are pinned here.
 *
 * RESPONSE: the Anthropic wire is re-standardized ONCE in `lib/stream/anthropic.js`
 * and every binding that speaks `anthropic-messages` merely borrows those hooks
 * (DeepInfra's native mount delegating through `createAnthropicBinding`). The
 * same bytes must therefore produce the same canonical semantic view, and the
 * view must be pinned literally — bindings that regress together still fail.
 *
 * REQUEST: an assistant turn that emits two tool calls must have BOTH results
 * land in ONE following user message. That is the 2026-11-14 Claude fix: the
 * Anthropic-backed lane validates tool_use -> tool_result pairing and rejects a
 * history where a result is split into its own turn ("tool_use ids were found
 * without tool_result blocks immediately after", measured on claude-opus-5-5).
 *
 * Covered: reasoning/text deltas, fragmented tool-call arguments, finish reason,
 * disjoint usage buckets merged across `message_start` + `message_delta`, the
 * accumulated thinking signature, and the tool-result grouping on both the
 * Gemini-envelope (Antigravity Claude path) and Anthropic-native request shapes.
 * Not covered: vendor HTTP, retries, catalog/pricing facts, request headers.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { normalizeStream } from '../../lib/stream/index.js'
import { readAnthropicSse } from '../../lib/stream/anthropic.js'
import { createAnthropicBinding } from '../../vendor/deepinfra/lib/stream-anthropic.js'
import { toContents } from '../../vendor/antigravity/lib/wire.js'
import { requestBodyAnthropic } from '../../vendor/deepinfra/lib/wire.js'

/** One recorded Anthropic SSE body, shared by every binding under test. */
const FIXTURE = readFileSync(new URL('./fixtures/anthropic-messages.sse', import.meta.url), 'utf8')

/**
 * The bindings under test.
 *
 * A factory per run, never a shared hook object: the hooks own per-stream state
 * (accumulated usage and per-block thinking signatures), so two streams that
 * shared one hook set would corrupt each other's token counts.
 */
const BINDINGS = Object.freeze([
  Object.freeze({
    name: 'deepinfra-anthropic',
    make: () => createAnthropicBinding(),
  }),
])

/**
 * Collapse raw stream chunks onto the semantic view every binding must agree on.
 *
 * Usage is taken from the LAST `usage` chunk. The pipe replaces its usage per
 * record rather than merging, so the last one must already be cumulative — an
 * output-only `message_delta` that erased `message_start`'s input count shows up
 * here as a missing `inputTokens`.
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
    else if (chunk.type === 'usage') view.usage = { ...chunk.usage }
  }
  return view
}

/**
 * Drive one binding over the recorded fixture.
 * @param {{name: string, make: Function}} binding - binding under test.
 * @returns {Promise<{view: object, chunks: object[], hooks: object}>} the
 *   canonical view, the raw chunk list, and the binding's own state readers.
 */
async function run(binding) {
  const handle = binding.make()
  const chunks = []
  for await (const chunk of normalizeStream({
    events: readAnthropicSse(new Response(FIXTURE).body),
    descriptor: handle.descriptor,
    createHooks: () => handle.hooks,
    signal: undefined,
  })) chunks.push(chunk)
  return { view: project(chunks), chunks, hooks: handle }
}

/** One assistant turn that called the same tool twice, followed by both results. */
const TWO_RESULT_MESSAGES = Object.freeze([
  Object.freeze({ role: 'user', content: 'look up a and b' }),
  Object.freeze({
    role: 'assistant',
    content: [
      Object.freeze({ type: 'text', text: 'looking' }),
      Object.freeze({ type: 'tool-call', id: 'call_a', name: 'lookup', arguments: '{"q":"a"}' }),
      Object.freeze({ type: 'tool-call', id: 'call_b', name: 'lookup', arguments: '{"q":"b"}' }),
    ],
  }),
  Object.freeze({ role: 'tool', toolCallId: 'call_a', content: 'A' }),
  Object.freeze({ role: 'tool', toolCallId: 'call_b', content: 'B' }),
])

test('the Anthropic-messages stream normalizes onto the pinned canonical view', async () => {
  const [binding] = BINDINGS
  const { view } = await run(binding)

  // Pinned literally, not just "all bindings agree": the reversed reasoning/text
  // order, a dropped signature or a sum that invents `totalTokens` must fail.
  assert.deepEqual(view, {
    reasoning: 'think ',
    text: 'answer',
    tool: { id: 'toolu_1', name: 'lookup', arguments: '{"q":"x"}' },
    finish: { kind: 'tool-calls' },
    usage: {
      inputTokens: 60,
      cacheReadTokens: 10,
      cacheWriteTokens: 20,
      outputTokens: 20,
    },
  })

  for (const other of BINDINGS) {
    assert.deepEqual(
      (await run(other)).view,
      view,
      `${other.name} diverged from the shared Anthropic normalization`,
    )
  }
})

test('the fixture exercises every signal the conformance view reads', async () => {
  const { view, chunks } = await run(BINDINGS[0])
  assert.notEqual(view.reasoning, '', 'thinking_delta missing')
  assert.notEqual(view.text, '', 'text_delta missing')
  assert.ok(view.tool?.id && view.tool?.name && view.tool?.arguments, 'input_json_delta fragment missing')
  assert.equal(view.finish?.kind, 'tool-calls', 'stop_reason "tool_use" must map to tool-calls')
  assert.equal(view.usage?.cacheReadTokens, 10, 'cache_read_input_tokens must be its own bucket')
  assert.equal(view.usage?.cacheWriteTokens, 20, 'cache_creation_input_tokens must be its own bucket')

  // Anthropic's input_tokens EXCLUDES cache, so the three input-side buckets are
  // summed and `totalTokens` only appears when the provider states a matching
  // total. This fixture states none, so an invented total must not appear.
  assert.equal(view.usage?.totalTokens, undefined, 'no total was reported by the provider')
  assert.ok(
    chunks.some((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call'),
    'the tool call must be closed as a whole block',
  )
})

test('usage pieces merge across message_start and message_delta', async () => {
  // The regression this pins: `message_start` carries the input side and
  // `message_delta` carries only output. The pipe REPLACES usage per record, so a
  // hook that forwarded the delta as-is would erase the input counts entirely.
  const { view, chunks } = await run(BINDINGS[0])
  const usageChunks = chunks.filter((chunk) => chunk.type === 'usage')
  assert.ok(usageChunks.length >= 1, 'the fixture must produce a usage chunk')
  assert.equal(view.usage?.inputTokens, 60, 'input_tokens from message_start must survive message_delta')
  assert.equal(view.usage?.outputTokens, 20, 'output_tokens arrives only on message_delta')
})

test('fragmented signature deltas accumulate into one per-block signature', async () => {
  // The signature is not part of the canonical chunk view (the host has no field
  // for it), but it MUST survive so a later request can replay the thinking
  // block. It arrives as two `signature_delta` fragments.
  const { hooks } = await run(BINDINGS[0])
  assert.equal(hooks.signature(), 'sig_part_1-sig_part_2', 'signature fragments must concatenate')
  assert.equal(hooks.signature(0), 'sig_part_1-sig_part_2', 'the signature belongs to thinking block 0')
})

test('two tool results of one assistant turn land in the SAME user message', () => {
  // --- Antigravity envelope (the Claude path this host actually drives) ---
  const { contents } = toContents(TWO_RESULT_MESSAGES, undefined)
  const responses = contents.filter((turn) => turn.parts.some((part) => part.functionResponse !== undefined))

  assert.equal(responses.length, 1, 'both results must share ONE user turn, not two')
  assert.equal(responses[0].role, 'user', 'tool results ride as a user turn')
  assert.deepEqual(
    responses[0].parts.map((part) => part.functionResponse.id),
    ['call_a', 'call_b'],
    'the grouped turn must carry both results, in call order',
  )
  assert.deepEqual(responses[0].parts[0], {
    functionResponse: { name: 'lookup', response: { output: 'A' }, id: 'call_a' },
  })
  assert.deepEqual(responses[0].parts[1], {
    functionResponse: { name: 'lookup', response: { output: 'B' }, id: 'call_b' },
  })

  // The failing alternative, spelled out: splitting the same results into two
  // user turns is exactly the shape Anthropic rejects.
  const split = [
    { role: 'user', parts: [responses[0].parts[0]] },
    { role: 'user', parts: [responses[0].parts[1]] },
  ]
  assert.notDeepEqual(
    [{ role: responses[0].role, parts: responses[0].parts }],
    split,
    'grouping must be observably different from the split shape',
  )

  // --- Anthropic-native request shape (DeepInfra's /anthropic mount) ---
  const body = requestBodyAnthropic({ model: 'claude-sonnet-4-5', messages: TWO_RESULT_MESSAGES })
  const resultTurns = body.messages.filter((turn) =>
    Array.isArray(turn.content) && turn.content.some((block) => block.type === 'tool_result'))

  assert.equal(resultTurns.length, 1, 'Anthropic-native results must share ONE user turn')
  assert.deepEqual(resultTurns[0], {
    role: 'user',
    content: [
      { type: 'tool_result', tool_use_id: 'call_a', content: 'A' },
      { type: 'tool_result', tool_use_id: 'call_b', content: 'B' },
    ],
  })

  // The pairing is only valid if the assistant turn really declared both calls.
  const assistant = body.messages.find((turn) => turn.role === 'assistant')
  assert.deepEqual(
    assistant.content.filter((block) => block.type === 'tool_use').map((block) => block.id),
    ['call_a', 'call_b'],
    'both tool_use blocks must precede the single result turn',
  )

  // And the alternative that breaks it: the same results spread over two turns.
  const splitNative = [
    { role: 'user', content: [resultTurns[0].content[0]] },
    { role: 'user', content: [resultTurns[0].content[1]] },
  ]
  assert.notDeepEqual([resultTurns[0]], splitNative, 'the merged turn must differ from the split shape')
})

test('an unparseable record fails instead of truncating the turn', async () => {
  const broken = 'event: content_block_delta\ndata: {"type":"content_block_delta",\n\n'
  await assert.rejects(async () => {
    for await (const _chunk of normalizeStream({
      events: readAnthropicSse(new Response(broken).body),
      descriptor: createAnthropicBinding().descriptor,
      createHooks: () => createAnthropicBinding().hooks,
      signal: undefined,
    })) { /* drain */ }
  }, (error) => error?.code === 'PROTOCOL_DEFECT' || /malformed/i.test(String(error?.message)))
})
