/**
 * The Anthropic route of the DeepInfra plugin: `deepinfra-anthropic`.
 *
 * The second route speaks the Anthropic Messages protocol on DeepInfra's
 * Anthropic-compatible mount instead of the OpenAI-compatible chat route. It
 * is opt-in (`anthropicRoute: true`) and shares the credential and the catalog
 * with the chat route.
 *
 * Every test here runs against a FAKE fetch: no network, no key, no provider.
 * The two recorded captures under `test/fixtures/` are byte-identical copies of
 * the live probes (CRLF line endings and all), so the suite never depends on
 * `/tmp` and never drifts from the wire.
 *
 * Measured facts this suite pins (2026-11-08, against the live native mount):
 *   - the request goes to the Messages path with `x-api-key` and
 *     `anthropic-version: 2023-06-01`, and carries `max_tokens` because
 *     Anthropic REQUIRES it (the chat route can omit it);
 *   - the body never carries a cache directive: prompt caching is a billing
 *     decision this adapter does not make on the caller's behalf;
 *   - the shared pipe owns the order: `block-start -> text-delta(s) ->
 *     block-end -> usage -> finish`, usage strictly before finish and nothing
 *     after it;
 *   - usage arrives in TWO pieces (`message_start` -> input/cache,
 *     `message_delta` -> output) and the pipe's per-stream binding merges them,
 *     so the LAST usage record is the complete one;
 *   - Anthropic's `input_tokens` already EXCLUDES cache, so the cache buckets
 *     are added, never subtracted from the input count;
 *   - an in-stream `error` event is TERMINAL: it must never leave the turn
 *     looking like a clean `stop`.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'

import { DeepInfraAnthropicAdapter, openAiUsageFrom, resolveAnthropicBaseURL } from '../lib/anthropic-adapter.js'
import { apply } from '../lib/index.js'
import { parseCost } from '../lib/cost.js'

// The plugin's ledger path resolves from `$DSH_HOME`, and `apply()` builds a
// cost store at that path. Point it at a throwaway home so a standalone run
// (`node --test test/anthropic-route.test.mjs`, without `--import
// setup-isolate.mjs`) can never touch the operator's real usage file.
process.env.DSH_HOME = mkdtempSync(join(tmpdir(), 'dsh-deepinfra-anthropic-test-'))

/** The recorded captures, copied into the package so the suite is self-contained. */
const FIXTURES = new URL('./fixtures/', import.meta.url)

/**
 * Read one recorded capture.
 * @param {string} name - file name under `test/fixtures/`.
 * @returns {string} the captured SSE text.
 */
function readFixture(name) {
  return readFileSync(new URL(name, FIXTURES), 'utf8')
}

/**
 * Build an adapter over a scripted response, with no network.
 *
 * The adapter is given the SAME dependency set the chat route gets in
 * `lib/index.js` — `catalogEntry` and `recordCost` included — because a route
 * that is constructed without them serves the stream and silently writes no
 * ledger row.
 *
 * @param {() => string} respond - the SSE text the fake fetch returns.
 * @param {object} [overrides] - settings overrides.
 * @param {object} [deps] - dependency overrides (`catalogEntry`, `recordCost`).
 * @returns {{ adapter: DeepInfraAnthropicAdapter, requests: object[], costs: object[] }}
 */
function harness(respond, overrides = {}, deps = {}) {
  const requests = []
  const costs = []
  const adapter = new DeepInfraAnthropicAdapter({
    settings: () => ({ baseURL: 'https://api.deepinfra.com/v1/openai', apiKey: 'test-key', ...overrides }),
    catalog: async () => ({
      list: () => [],
      resolve: (provider, model) => ({ provider, id: model, name: model }),
    }),
    catalogEntry: async (model) => ({
      id: model,
      metadata: { pricing: { input_tokens: 3, output_tokens: 15, cache_read_tokens: 0.3 } },
    }),
    recordCost: (options, rawUsage, pricing, requestId) => {
      costs.push({ options, rawUsage, pricing, requestId })
    },
    fetchImpl: async (url, init) => {
      requests.push({ url, init, body: JSON.parse(init.body) })
      // A REAL `Response` over a scripted body: the reader consumes `.body`,
      // so the fake exercises the same path a live response would.
      return new Response(
        new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(respond()))
            controller.close()
          },
        }),
        { status: 200, headers: { 'content-type': 'text/event-stream' } },
      )
    },
    log: { warn() {} },
    ...deps,
  })
  return { adapter, requests, costs }
}

/**
 * Collect every chunk of one stream call.
 * @param {DeepInfraAnthropicAdapter} adapter - the adapter.
 * @param {object} [options] - request options.
 * @returns {Promise<object[]>} the emitted chunks, in order.
 */
async function collect(adapter, options = {}) {
  const chunks = []
  for await (const chunk of adapter.stream({
    provider: 'deepinfra-anthropic',
    model: 'anthropic/claude-sonnet-5',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
    ...options,
  })) {
    chunks.push(chunk)
  }
  return chunks
}

/**
 * Render one Anthropic SSE stream from provider events.
 * @param {object[]} events - the decoded events, in wire order.
 * @returns {string} the SSE text.
 */
const anthropicSse = (events) => events
  .map((event) => 'event: ' + event.type + '\ndata: ' + JSON.stringify(event) + '\n\n')
  .join('')

/**
 * Find a key anywhere in a JSON-shaped value.
 *
 * A body-level check is not enough: a cache directive could hide inside a
 * content block, so the whole body is walked.
 *
 * @param {unknown} value - the value to walk.
 * @param {string} key - the key to look for.
 * @returns {unknown} the value found under that key, or undefined.
 */
function findKey(value, key) {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = findKey(entry, key)
      if (found !== undefined) return found
    }
    return undefined
  }
  if (value === null || typeof value !== 'object') return undefined
  if (Object.prototype.hasOwnProperty.call(value, key)) return value[key]
  for (const entry of Object.values(value)) {
    const found = findKey(entry, key)
    if (found !== undefined) return found
  }
  return undefined
}

/**
 * Assert the pipe's terminal ordering contract.
 * @param {object[]} chunks - the emitted chunks.
 * @returns {number} the index of the finish chunk.
 */
function assertTerminalOrder(chunks) {
  const kinds = chunks.map((chunk) => chunk.type)
  const usageAt = kinds.indexOf('usage')
  const finishAt = kinds.indexOf('finish')
  assert.notEqual(usageAt, -1, 'a usage chunk must be emitted')
  assert.notEqual(finishAt, -1, 'a finish chunk must be emitted')
  assert.ok(usageAt < finishAt, 'usage at ' + usageAt + ' must precede finish at ' + finishAt)
  assert.equal(finishAt, kinds.length - 1, 'nothing may follow finish')
  return finishAt
}

// ---- 1. identity -----------------------------------------------------------

test('the Anthropic route reports its OWN identity, not the chat route id', () => {
  // The route key passed to `registerAdapter()` is `deepinfra-anthropic` and
  // the adapter's id must agree with it, or the host attributes the route to
  // the wrong provider.
  const { adapter } = harness(() => '')
  assert.deepEqual(adapter.providerInfo('deepinfra-anthropic'), {
    id: 'deepinfra-anthropic',
    name: 'DeepInfra (Anthropic)',
  })
})

// ---- 2. request shape ------------------------------------------------------

test('the request uses the Messages mount, the Anthropic headers and the Anthropic body', async () => {
  const { adapter, requests } = harness(() => anthropicSse([
    { type: 'message_start', message: { usage: { input_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 2 } },
    { type: 'message_stop' },
  ]))
  await collect(adapter)

  assert.equal(requests.length, 1, 'exactly one request')
  const { url, init, body } = requests[0]

  // FIXED (BUG 1): the adapter used to join the Messages path onto the OPENAI
  // base URL, producing `/v1/openai/anthropic/v1/messages`. The live endpoint
  // that answers HTTP 200 is the origin's `/anthropic/v1/messages`, so the
  // OpenAI base's `/v1/openai` segment must be stripped before joining.
  assert.equal(url, 'https://api.deepinfra.com/anthropic/v1/messages')
  assert.equal(url.includes('/v1/openai'), false, 'the OpenAI mount must never appear in the Messages URL')
  assert.equal(init.method, 'POST')

  // Anthropic authenticates with `x-api-key`, NOT with an OpenAI bearer token.
  assert.equal(init.headers['x-api-key'], 'test-key')
  assert.equal(init.headers['anthropic-version'], '2023-06-01')
  assert.equal(init.headers['authorization'], undefined, 'the bearer header belongs to the chat route')

  assert.equal(body.stream, true)
  assert.ok(Array.isArray(body.messages), 'the body must carry the messages')
  assert.ok(
    Number.isInteger(body.max_tokens) && body.max_tokens > 0,
    'Anthropic REQUIRES max_tokens; the body had ' + JSON.stringify(body.max_tokens),
  )
})

test('the Anthropic base URL is resolved separately from the OpenAI base URL', () => {
  // The one public setting is documented as an OpenAI-compatible base, so the
  // `/v1/openai` segment it carries must be stripped rather than joined.
  assert.equal(resolveAnthropicBaseURL({ baseURL: 'https://api.deepinfra.com/v1/openai' }), 'https://api.deepinfra.com')
  assert.equal(resolveAnthropicBaseURL({ baseURL: 'https://api.deepinfra.com/v1/openai/' }), 'https://api.deepinfra.com')
  // No base at all falls back to the provider origin, never the OpenAI mount.
  assert.equal(resolveAnthropicBaseURL({}), 'https://api.deepinfra.com')
  assert.equal(resolveAnthropicBaseURL(undefined), 'https://api.deepinfra.com')
  // An origin-only base is already the right one and is kept.
  assert.equal(resolveAnthropicBaseURL({ baseURL: 'https://api.deepinfra.com' }), 'https://api.deepinfra.com')
  // A gateway base that is NOT the OpenAI mount is used verbatim.
  assert.equal(resolveAnthropicBaseURL({ baseURL: 'https://gw.example/anthropic' }), 'https://gw.example/anthropic')
  // An explicit mount setting always wins.
  assert.equal(
    resolveAnthropicBaseURL({ baseURL: 'https://api.deepinfra.com/v1/openai', anthropicBaseURL: 'https://gw.example' }),
    'https://gw.example',
  )
})

test('the request never carries a prompt-cache directive', async () => {
  // Prompt caching is a billing decision this adapter does not make on the
  // caller's behalf: no `cache_control`, no `prompt_cache_key`, anywhere.
  const { adapter, requests } = harness(() => anthropicSse([
    { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'message_stop' },
  ]))
  await collect(adapter, {
    system: 'you are a helpful assistant',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  })

  const { body } = requests[0]
  assert.equal(findKey(body, 'cache_control'), undefined)
  assert.equal(findKey(body, 'prompt_cache_key'), undefined)

  // Anthropic has no `system` ROLE: the system prompt is a TOP-LEVEL field.
  // A prompt that fell through to a user turn would be silently mis-addressed.
  assert.equal(body.system, 'you are a helpful assistant')
  assert.equal(body.messages.some((message) => message.role === 'system'), false)
})

test('max_tokens is always sent, and an explicit budget wins over the default', async () => {
  // Anthropic rejects a request without `max_tokens`, so "unset" is not
  // expressible by omission on this route: the adapter materializes a default.
  const withoutBudget = harness(() => anthropicSse([
    { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'message_stop' },
  ]))
  await collect(withoutBudget.adapter)
  assert.ok(
    Number.isInteger(withoutBudget.requests[0].body.max_tokens) && withoutBudget.requests[0].body.max_tokens > 0,
    'the default max_tokens must be sent',
  )

  const withBudget = harness(() => anthropicSse([
    { type: 'message_start', message: { usage: { input_tokens: 1, output_tokens: 0 } } },
    { type: 'message_stop' },
  ]))
  await collect(withBudget.adapter, { maxTokens: 512 })
  assert.equal(withBudget.requests[0].body.max_tokens, 512)
})

// ---- 3. the recorded native capture ----------------------------------------

test('the recorded native capture replays in the pipe order: usage strictly before finish', async () => {
  // Recorded live against DeepInfra's native Anthropic mount.
  const { adapter } = harness(() => readFixture('anthropic-sonnet-5.sse'))
  const chunks = await collect(adapter)
  assertTerminalOrder(chunks)

  // MEASURED: this particular capture carries a `content_block_start` (type
  // text) and a `content_block_stop` but NO `content_block_delta` at all, so
  // no visible content ever arrives and the pipe reports the turn as empty
  // rather than as a clean answer. The contract under test is the ORDER; the
  // capture's own content is asserted so a change in the fixture is visible.
  assert.equal(chunks.some((chunk) => chunk.type === 'text-delta'), false)
  assert.equal(chunks.some((chunk) => chunk.type === 'block-start'), false)
  const finish = chunks.at(-1)
  assert.equal(finish.reason.kind, 'error')
  assert.equal(finish.reason.failure.code, 'EMPTY_RESPONSE')
})

test('the recorded native capture WITH content replays as block-start -> text-delta(s) -> block-end -> usage -> finish', async () => {
  // The second recording of the same live mount, this time with the text
  // deltas the first capture lacks.
  const { adapter } = harness(() => readFixture('anthropic-think2.sse'))
  const chunks = await collect(adapter)
  const kinds = chunks.map((chunk) => chunk.type)

  assert.equal(kinds[0], 'block-start')
  assert.equal(kinds.at(-1), 'finish')
  assertTerminalOrder(chunks)

  const deltas = chunks.filter((chunk) => chunk.type === 'text-delta')
  assert.ok(deltas.length > 0, 'the capture carries text deltas')
  assert.equal(kinds.indexOf('block-end'), kinds.lastIndexOf('text-delta') + 1, 'block-end follows the deltas')
  assert.ok(kinds.indexOf('block-end') < kinds.indexOf('usage'), 'block-end precedes usage')

  // The closed block carries the whole text, so a consumer never has to
  // re-assemble the deltas.
  const end = chunks.find((chunk) => chunk.type === 'block-end')
  assert.equal(end.block.type, 'text')
  assert.equal(end.block.text, deltas.map((delta) => delta.text).join(''))

  // MEASURED BUG (FIXED, BUG 2): DeepInfra's native mount reports the INPUT
  // count on `message_delta`, not on `message_start` (the capture carries
  // `message_start.input_tokens = 0` and `message_delta.input_tokens = 51`), and
  // the shared reader used to read only `usage.output_tokens` from
  // `message_delta`. The emitted usage reported `inputTokens: 0` for a turn that
  // really consumed 51 input tokens — the count was silently dropped.
  const usage = chunks.find((chunk) => chunk.type === 'usage')
  assert.equal(usage.usage.inputTokens, 51)
  assert.equal(usage.usage.outputTokens, 157)
  // The provider states no total, so the accumulator must not invent one.
  assert.equal(usage.usage.totalTokens, undefined)
})

// ---- 4. the synthetic thinking stream --------------------------------------

test('a thinking stream yields a reasoning block, and cache is ADDED to the input count', async () => {
  const { adapter } = harness(() => anthropicSse([
    { type: 'message_start', message: { usage: { input_tokens: 10, cache_creation_input_tokens: 0, cache_read_input_tokens: 90, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'thinking', thinking: '', signature: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: 'Let me think' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'thinking_delta', thinking: ' about it.' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'signature_delta', signature: 'sig-abc' } },
    { type: 'content_block_delta', index: 1, delta: { type: 'text_delta', text: 'Hello' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn', stop_sequence: null }, usage: { output_tokens: 5 } },
    { type: 'message_stop' },
  ]))
  const chunks = await collect(adapter)

  const reasoning = chunks.filter((chunk) => chunk.type === 'reasoning-delta')
  assert.equal(reasoning.length, 2)
  assert.equal(reasoning.map((delta) => delta.text).join(''), 'Let me think about it.')

  const ends = chunks.filter((chunk) => chunk.type === 'block-end')
  const reasoningEnd = ends.find((end) => end.block.type === 'reasoning')
  assert.ok(reasoningEnd, 'the reasoning block must be closed')
  assert.deepEqual(reasoningEnd.block, { type: 'reasoning', text: 'Let me think about it.' })

  // The usage arrives in TWO pieces (`message_start` -> input/cache,
  // `message_delta` -> output) and the merged snapshot must carry both.
  const usage = chunks.find((chunk) => chunk.type === 'usage')
  assert.equal(usage.usage.inputTokens, 10)
  assert.equal(usage.usage.cacheReadTokens, 90)
  assert.equal(usage.usage.outputTokens, 5)
  // Anthropic's `input_tokens` already EXCLUDES cache, so the input count is
  // NOT reduced by the cache read. 10 stays 10.
  assert.equal(usage.usage.inputTokens, 10)
  assertTerminalOrder(chunks)
})

// ---- 5. the tool call ------------------------------------------------------

test('a fragmented tool call assembles ONE tool-call block with parsed arguments', async () => {
  const { adapter } = harness(() => anthropicSse([
    { type: 'message_start', message: { usage: { input_tokens: 7, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: 'toolu_01', name: 'get_weather', input: {} } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '{"city":' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: '"Seoul"}' } },
    { type: 'message_delta', delta: { stop_reason: 'tool_use', stop_sequence: null }, usage: { output_tokens: 20 } },
    { type: 'message_stop' },
  ]))
  const chunks = await collect(adapter)

  const ends = chunks.filter((chunk) => chunk.type === 'block-end')
  assert.equal(ends.length, 1, 'exactly one closed block')
  assert.equal(ends[0].block.type, 'tool-call')
  assert.equal(ends[0].block.id, 'toolu_01')
  assert.equal(ends[0].block.name, 'get_weather')
  assert.equal(ends[0].block.arguments, '{"city":"Seoul"}')
  assert.deepEqual(JSON.parse(ends[0].block.arguments), { city: 'Seoul' })

  const finish = chunks.at(-1)
  assert.equal(finish.type, 'finish')
  assert.equal(finish.reason.kind, 'tool-calls')
})

// ---- 6. the mid-stream error ----------------------------------------------

test('an in-stream error ends the turn as PROVIDER_RESOURCE, never as a clean stop', async () => {
  const { adapter } = harness(() => anthropicSse([
    { type: 'message_start', message: { usage: { input_tokens: 3, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'partial' } },
    { type: 'error', error: { type: 'overloaded_error', message: 'Overloaded' } },
  ]))
  const chunks = await collect(adapter)

  const finish = chunks.at(-1)
  assert.equal(finish.type, 'finish')
  assert.equal(finish.reason.kind, 'error')
  assert.equal(finish.reason.failure.code, 'PROVIDER_RESOURCE')
  assert.notEqual(finish.reason.kind, 'stop')
  assert.equal(finish.reason.failure.message, 'Overloaded')
})

// ---- 7. the cost ledger ----------------------------------------------------

test('recordCost is called EXACTLY ONCE per stream, with the raw shape parseCost reads', async () => {
  // FIXED (BUG 3): the adapter used to call recordCost on EVERY usage-bearing
  // record. The Anthropic wire sends usage on both `message_start` and
  // `message_delta`, so a single turn wrote two ledger rows and was billed
  // twice. One row per response is the chat route's contract.
  //
  // FIXED (BUG 4): `cost.js parseCost` reads the OpenAI-compatible shape
  // (`prompt_tokens` / `completion_tokens` / `prompt_tokens_details`), so the
  // Anthropic counters are mapped before they are recorded.
  const { adapter, costs } = harness(() => anthropicSse([
    { type: 'message_start', message: { usage: { input_tokens: 10, cache_creation_input_tokens: 2, cache_read_input_tokens: 90, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 10, cache_creation_input_tokens: 2, cache_read_input_tokens: 90, output_tokens: 5 } },
    { type: 'message_stop' },
  ]))
  await collect(adapter)

  assert.equal(costs.length, 1, 'one ledger row per response, not one per usage record')
  const [{ rawUsage }] = costs

  // Anthropic's `input_tokens` EXCLUDES cache, so the prompt total sums all
  // three input-side buckets: 10 + 90 + 2.
  assert.equal(rawUsage.prompt_tokens, 102)
  assert.equal(rawUsage.completion_tokens, 5)
  assert.equal(rawUsage.total_tokens, 107)
  assert.deepEqual(rawUsage.prompt_tokens_details, { cached_tokens: 90, cache_write_tokens: 2 })

  // The catalog row IS resolved, so the record can also carry a list price.
  assert.equal(costs[0].pricing.input_tokens, 3)
})

test('the recorded cost is priced by parseCost instead of reading as zero tokens', async () => {
  // The end-to-end consequence of BUG 4: `parseCost` on the mapped object must
  // recover the billed counters, including the uncached remainder.
  const { adapter, costs } = harness(() => anthropicSse([
    { type: 'message_start', message: { usage: { input_tokens: 0, output_tokens: 0 } } },
    { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
    { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'ok' } },
    { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { input_tokens: 40, cache_read_input_tokens: 60, output_tokens: 7 } },
    { type: 'message_stop' },
  ]))
  await collect(adapter)

  assert.equal(costs.length, 1)
  const cost = parseCost(costs[0].rawUsage, costs[0].pricing)
  // 40 uncached + 60 cached, 7 completion; the cache read is not double counted.
  assert.deepEqual(cost.tokens, { input: 40, output: 7, reasoning: 0, cacheRead: 60, cacheWrite: 0 })
  assert.ok(cost.listCostUsd > 0, 'the catalog pricing must produce a list figure')
})

test('a usage stream whose output count never arrives still records exactly ONE row', async () => {
  // `message_start` carries `input_tokens: 3` and no `output_tokens` at all,
  // and nothing later restates the count. The turn really consumed 3 input
  // tokens, so dropping the row would be BUG 4 all over again; the row is
  // written once, at the end, with the input count it does know.
  const recorded = []
  const adapter = new DeepInfraAnthropicAdapter({
    settings: () => ({ baseURL: 'https://api.deepinfra.com/v1/openai', apiKey: 'test-key' }),
    catalog: async () => ({ list: () => [], resolve: () => null }),
    recordCost: (options, rawUsage) => { recorded.push(rawUsage) },
    fetchImpl: async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(anthropicSse([
            { type: 'message_start', message: { usage: { input_tokens: 3 } } },
            { type: 'message_stop' },
          ])))
          controller.close()
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ),
    log: { warn() {} },
  })
  await collect(adapter)
  assert.equal(recorded.length, 1, 'exactly one row, never zero and never two')
  assert.equal(recorded[0].prompt_tokens, 3)
  assert.equal(recorded[0].completion_tokens, 0)
  // No output count was reported, so no total may be claimed.
  assert.equal('total_tokens' in recorded[0], false)
})

test('an explicit output_tokens: 0 is a measurement and still records one row', async () => {
  // A real 0 is a statement, not an absence: a turn that produced no tokens
  // must still be counted as a request rather than vanish from the ledger.
  let recordCalls = 0
  const adapter = new DeepInfraAnthropicAdapter({
    settings: () => ({ baseURL: 'https://api.deepinfra.com/v1/openai', apiKey: 'test-key' }),
    catalog: async () => ({ list: () => [], resolve: () => null }),
    recordCost: () => { recordCalls += 1 },
    fetchImpl: async () => new Response(
      new ReadableStream({
        start(controller) {
          controller.enqueue(new TextEncoder().encode(anthropicSse([
            { type: 'message_start', message: { usage: { input_tokens: 3, output_tokens: 0 } } },
            { type: 'message_stop' },
          ])))
          controller.close()
        },
      }),
      { status: 200, headers: { 'content-type': 'text/event-stream' } },
    ),
    log: { warn() {} },
  })
  await collect(adapter)
  assert.equal(recordCalls, 1)
})

// ---- 8. the route registration guard ---------------------------------------

/**
 * Build a cordis-shaped context that records the registered routes.
 * @param {string[][]} calls - the collected route arrays.
 * @returns {object} the fake context.
 */
function fakeCtx(calls) {
  return {
    llm: {
      registerAdapter: (routes) => {
        calls.push(routes)
        return () => {}
      },
    },
    effect: () => () => {},
    inject: () => {},
    logger: { warn() {} },
    on: () => () => {},
  }
}

test('the Anthropic route is registered ONLY when `anthropicRoute` is true', () => {
  const off = []
  apply(fakeCtx(off), { anthropicRoute: false })
  assert.deepEqual(off, [['deepinfra']])

  const on = []
  apply(fakeCtx(on), { anthropicRoute: true })
  assert.deepEqual(on, [['deepinfra'], ['deepinfra-anthropic']])

  // The same, as the flattened route list the host would serve.
  assert.deepEqual(off.flat(), ['deepinfra'])
  assert.deepEqual(on.flat(), ['deepinfra', 'deepinfra-anthropic'])
})

test('the route guard is strict: only the boolean true opens the second route', () => {
  // A truthy-but-not-true value (a string from a hand-edited YAML, a number)
  // must NOT silently mount a route the operator did not ask for.
  const truthy = []
  apply(fakeCtx(truthy), { anthropicRoute: 'true' })
  assert.deepEqual(truthy, [['deepinfra']])

  const absent = []
  apply(fakeCtx(absent), {})
  assert.deepEqual(absent, [['deepinfra']])
})
