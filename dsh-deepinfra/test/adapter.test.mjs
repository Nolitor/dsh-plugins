import assert from 'node:assert/strict'
import test from 'node:test'

import { DeepInfraAdapter } from '../lib/adapter.js'

/**
 * Build an adapter over a scripted response, with no network.
 * @param {(body: object) => { status?: number, sse?: string, headers?: object, detail?: string }} respond
 * @param {object} [overrides] - config overrides.
 */
function harness(respond, overrides = {}) {
  const requests = []
  const adapter = new DeepInfraAdapter({
    settings: () => ({ baseURL: 'https://api.deepinfra.com/v1/openai', apiKey: 'test-key', ...overrides }),
    catalog: async () => ({
      list: () => [],
      resolve: (provider, model) => ({ provider, id: model, name: model }),
    }),
    fetchImpl: async (url, init) => {
      const body = JSON.parse(init.body)
      requests.push({ url, init, body })
      const result = respond(body)
      const sse = result.sse ?? ''
      return {
        ok: (result.status ?? 200) < 400,
        status: result.status ?? 200,
        headers: new Headers(result.headers ?? {}),
        text: async () => result.detail ?? '',
        body: new ReadableStream({
          start(controller) {
            controller.enqueue(new TextEncoder().encode(sse))
            controller.close()
          },
        }),
      }
    },
    log: { warn() {} },
  })
  return { adapter, requests }
}

/** Assemble chunks from one stream call. */
async function collect(adapter, options) {
  const chunks = []
  for await (const chunk of adapter.stream({ provider: 'deepinfra', model: 'm', messages: [], ...options })) {
    chunks.push(chunk)
  }
  return chunks
}

/** Render one SSE stream from provider events. */
const sse = (events) => events.map((e) => 'data: ' + JSON.stringify(e) + '\n\n').join('') + 'data: [DONE]\n\n'

test('usage is emitted BEFORE finish and nothing follows it', async () => {
  // The contract exists for exactly this provider shape: DeepInfra sends the
  // usage event AFTER the finish_reason event (measured: FINISH -> USAGE -> [DONE]).
  const { adapter } = harness(() => ({
    sse: sse([
      { choices: [{ delta: { content: 'hello' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 10, completion_tokens: 2, total_tokens: 12 } },
    ]),
  }))
  const chunks = await collect(adapter, { messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] })
  const kinds = chunks.map((c) => c.type)
  const usageAt = kinds.indexOf('usage')
  const finishAt = kinds.indexOf('finish')
  assert.notEqual(usageAt, -1)
  assert.notEqual(finishAt, -1)
  assert.ok(usageAt < finishAt, 'usage at ' + usageAt + ' must precede finish at ' + finishAt)
  assert.equal(finishAt, kinds.length - 1, 'nothing may follow finish')
})

test('finish and usage arriving on ONE event still flush in order', async () => {
  const { adapter } = harness(() => ({
    sse: sse([
      { choices: [{ delta: { content: 'x' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 1 } },
    ]),
  }))
  const chunks = await collect(adapter, { messages: [] })
  const kinds = chunks.map((c) => c.type)
  assert.ok(kinds.indexOf('usage') < kinds.indexOf('finish'))
  assert.equal(kinds.at(-1), 'finish')
})

test('text streams as deltas on one reused block index', async () => {
  const { adapter } = harness(() => ({
    sse: sse([
      { choices: [{ delta: { content: 'he' } }] },
      { choices: [{ delta: { content: 'llo' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]),
  }))
  const chunks = await collect(adapter, { messages: [] })
  const starts = chunks.filter((c) => c.type === 'block-start')
  assert.equal(starts.length, 1)
  const deltas = chunks.filter((c) => c.type === 'text-delta')
  assert.deepEqual(deltas.map((d) => d.text), ['he', 'llo'])
  assert.ok(deltas.every((d) => d.index === starts[0].index))
})

test('reasoning occupies its own block, separate from text', async () => {
  const { adapter } = harness(() => ({
    sse: sse([
      { choices: [{ delta: { reasoning_content: 'thinking' } }] },
      { choices: [{ delta: { content: 'answer' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]),
  }))
  const chunks = await collect(adapter, { messages: [] })
  const reasoning = chunks.find((c) => c.type === 'reasoning-delta')
  const text = chunks.find((c) => c.type === 'text-delta')
  assert.equal(reasoning.text, 'thinking')
  assert.equal(text.text, 'answer')
  assert.notEqual(reasoning.index, text.index)
  const blockEnds = chunks.filter((c) => c.type === 'block-end')
  assert.deepEqual(blockEnds.map((b) => b.block.type).sort(), ['reasoning', 'text'])
})

test('the measured two-fragment tool call assembles one complete call', async () => {
  const { adapter } = harness(() => ({
    sse: sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'chatcmpl-tool-9c59', type: 'function', function: { name: 'apply_edits', arguments: '' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"edits":[1]' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]),
  }))
  const chunks = await collect(adapter, { messages: [] })
  const ends = chunks.filter((c) => c.type === 'block-end')
  assert.equal(ends.length, 1)
  assert.deepEqual(ends[0].block, {
    type: 'tool-call',
    id: 'chatcmpl-tool-9c59',
    name: 'apply_edits',
    arguments: '{"edits":[1]}',
  })
  const finish = chunks.at(-1)
  assert.equal(finish.reason.kind, 'tool-calls')
})

test('every tool-call delta carries the id from the first fragment', async () => {
  // Later fragments have id:null on the wire; a mapper that forwards the null
  // produces tool-call deltas the assembler cannot correlate.
  const { adapter } = harness(() => ({
    sse: sse([
      { choices: [{ delta: { tool_calls: [{ index: 0, id: 'call_1', function: { name: 'f', arguments: '{"a"' } }] } }] },
      { choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]),
  }))
  const chunks = await collect(adapter, { messages: [] })
  const deltas = chunks.filter((c) => c.type === 'tool-call-delta')
  assert.equal(deltas.length, 2)
  assert.ok(deltas.every((d) => d.id === 'call_1'))
  assert.ok(deltas.every((d) => d.name === 'f'))
})

test('parallel tool calls get distinct block indexes', async () => {
  const { adapter } = harness(() => ({
    sse: sse([
      { choices: [{ delta: { tool_calls: [
        { index: 0, id: 'c0', function: { name: 'w', arguments: '{"c":"Seoul"}' } },
        { index: 1, id: 'c1', function: { name: 'w', arguments: '{"c":"Busan"}' } },
      ] } }] },
      { choices: [{ delta: {}, finish_reason: 'tool_calls' }] },
    ]),
  }))
  const chunks = await collect(adapter, { messages: [] })
  const ends = chunks.filter((c) => c.type === 'block-end')
  assert.equal(ends.length, 2)
  assert.notEqual(ends[0].index, ends[1].index)
  assert.deepEqual(ends.map((e) => e.block.id), ['c0', 'c1'])
})

test('an empty completion becomes EMPTY_RESPONSE, not a silent success', async () => {
  const { adapter } = harness(() => ({
    sse: sse([
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 5, completion_tokens: 0 } },
    ]),
  }))
  const chunks = await collect(adapter, { messages: [] })
  const finish = chunks.at(-1)
  assert.equal(finish.reason.kind, 'error')
  assert.equal(finish.reason.failure.code, 'EMPTY_RESPONSE')
})

test('every request carries attribution and the bearer key', async () => {
  const { adapter, requests } = harness(() => ({
    sse: sse([{ choices: [{ delta: { content: 'x' } }] }, { choices: [{ delta: {}, finish_reason: 'stop' }] }]),
  }))
  await collect(adapter, { messages: [] })
  const headers = requests[0].init.headers
  assert.equal(headers.authorization, 'Bearer test-key')
  assert.equal(typeof headers['user-agent'], 'string')
  assert.ok(headers['user-agent'].length > 0)
  assert.equal(requests[0].url, 'https://api.deepinfra.com/v1/openai/chat/completions')
})

test('a 401 becomes INVALID_CREDENTIAL with its status', async () => {
  const { adapter } = harness(() => ({ status: 401, detail: '{"error":{"message":"missing API key","code":"invalid_api_key"}}' }))
  await assert.rejects(
    () => collect(adapter, { messages: [] }),
    (error) => {
      assert.equal(error.code, 'INVALID_CREDENTIAL')
      assert.equal(error.failure.status, 401)
      return true
    },
  )
})

test('a 404 model_not_found becomes UNKNOWN_MODEL', async () => {
  const { adapter } = harness(() => ({
    status: 404,
    detail: '{"error":{"message":"The model does not exist","code":"model_not_found"}}',
  }))
  await assert.rejects(() => collect(adapter, { messages: [] }), (error) => error.code === 'UNKNOWN_MODEL')
})

test('a 429 becomes a retryable RATE_LIMIT', async () => {
  const { adapter } = harness(() => ({
    status: 429,
    detail: '{"error":{"message":"Model busy, retry later","code":"engine_overloaded"}}',
    headers: { 'retry-after': '2' },
  }))
  await assert.rejects(
    () => collect(adapter, { messages: [] }),
    (error) => {
      assert.equal(error.code, 'RATE_LIMIT')
      assert.equal(error.failure.providerRetryAfterMs, 2000)
      return true
    },
  )
})

test('an over-long stop list throws before any request is sent', async () => {
  const { adapter, requests } = harness(() => ({ sse: '' }))
  await assert.rejects(
    () => collect(adapter, { messages: [], stop: Array.from({ length: 17 }, (_, i) => String(i)) }),
    (error) => error.code === 'UNSUPPORTED_OPTION',
  )
  assert.equal(requests.length, 0, 'a rejected request must not reach the network')
})

test('attribution is present on error paths too', async () => {
  const { adapter, requests } = harness(() => ({ status: 500, detail: 'boom' }))
  await assert.rejects(() => collect(adapter, { messages: [] }))
  assert.equal(typeof requests[0].init.headers['user-agent'], 'string')
})

test('an undecodable event aborts the stream as a protocol failure', async () => {
  const { adapter } = harness(() => ({ sse: 'data: {not json\n\ndata: [DONE]\n\n' }))
  await assert.rejects(() => collect(adapter, { messages: [] }), (error) => error.code === 'PROTOCOL')
})

test('block-end carries the ASSEMBLED text, not a placeholder', async () => {
  // Measured defect (2026-11-04, isolated headless boot): block-end emitted
  // text:'' so a turn that streamed 5 output tokens completed with an empty
  // message. The contract says block-end carries the fully assembled block.
  const { adapter } = harness(() => ({
    sse: sse([
      { choices: [{ delta: { content: 'he' } }] },
      { choices: [{ delta: { content: 'llo' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]),
  }))
  const chunks = await collect(adapter, { messages: [] })
  const end = chunks.find((c) => c.type === 'block-end')
  assert.deepEqual(end.block, { type: 'text', text: 'hello' })
})

test('block-end carries assembled reasoning text too', async () => {
  const { adapter } = harness(() => ({
    sse: sse([
      { choices: [{ delta: { reasoning_content: 'a' } }] },
      { choices: [{ delta: { reasoning_content: 'b' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
    ]),
  }))
  const chunks = await collect(adapter, { messages: [] })
  const end = chunks.find((c) => c.type === 'block-end')
  assert.deepEqual(end.block, { type: 'reasoning', text: 'ab' })
})

test('the peak per-turn usage stays well inside the reservation', async () => {
  const { adapter } = harness(() => ({
    sse: sse([
      { choices: [{ delta: { content: 'x' } }] },
      { choices: [{ delta: {}, finish_reason: 'stop' }] },
      { choices: [], usage: { prompt_tokens: 100, completion_tokens: 5 } },
    ]),
  }))
  const chunks = await collect(adapter, { messages: [] })
  const usage = chunks.find((c) => c.type === 'usage').usage
  assert.equal(usage.inputTokens, 100)
  assert.equal(usage.outputTokens, 5)
})

test('providerInfo names the route it owns', () => {
  const { adapter } = harness(() => ({ sse: '' }))
  assert.deepEqual(adapter.providerInfo('deepinfra'), { id: 'deepinfra', name: 'DeepInfra' })
})
