import assert from 'node:assert/strict'
import { test } from 'node:test'

import { readEvents } from '../lib/sse.js'
import { classify } from '../lib/map.js'

/** Build a Response whose body streams the given chunks. */
function streamResponse(chunks) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  }))
}

const frame = (obj) => `data: ${JSON.stringify(obj)}\n\n`

test('readEvents parses frames split across chunks', async () => {
  const body = frame({ response: { candidates: [] } })
  const half = Math.floor(body.length / 2)
  const events = []
  for await (const event of readEvents(streamResponse([body.slice(0, half), body.slice(half)]))) events.push(event)
  assert.equal(events.length, 1)
  assert.ok(events[0].response)
})

test('readEvents stops at [DONE]', async () => {
  const events = []
  for await (const event of readEvents(streamResponse(['data: [DONE]\n\n']))) events.push(event)
  assert.deepEqual(events, [{ done: true }])
})

test('classify distinguishes thought, text and functionCall', () => {
  assert.equal(classify({ text: 'x', thought: true }), 'reasoning')
  assert.equal(classify({ text: 'x' }), 'text')
  assert.equal(classify({ functionCall: { name: 'f' } }), 'tool-call')
  assert.equal(classify({ thoughtSignature: 'sig' }), 'other')
})

// ---- generation retry (2026-11-05 resilience patch) -----------------------

import { AntigravityAdapter } from '../lib/adapter.js'

const okSse = () => new Response(
  'data: {"response":{"candidates":[{"content":{"parts":[{"text":"hi"}]}}]}}\n\ndata: [DONE]\n\n',
  { status: 200, headers: { 'content-type': 'text/event-stream' } },
)

/** One adapter whose fetch answers from a script and records every call. */
function makeAdapter(script, overrides = {}) {
  const calls = []
  const state = { invalidated: 0 }
  const responses = [...script]
  const adapter = new AntigravityAdapter({
    settings: () => ({ baseUrl: 'https://antigravity.test', project: 'p', userAgent: 'ua', ...overrides }),
    tokens: {
      get: async () => 'test-token',
      invalidate: () => { state.invalidated += 1 },
    },
    catalog: async () => ({ list: async () => [], find: async () => null }),
    fetch: async (url, init) => {
      calls.push({ url, init })
      const next = responses.length > 1 ? responses.shift() : responses[0]
      return next
    },
    log: { warn() {} },
  })
  return { adapter, calls, state }
}

const requestOptions = () => ({
  model: 'gemini-3.5-flash-lite',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
  signal: new AbortController().signal,
})

test('a 429 is retried with backoff and the retried request streams', async () => {
  const { adapter, calls } = makeAdapter([new Response('slow down', { status: 429 }), okSse()], { httpRetryBaseMs: 1 })
  const chunks = []
  for await (const chunk of adapter.stream(requestOptions())) chunks.push(chunk)
  assert.equal(calls.length, 2, 'the refused request is re-sent once')
  assert.ok(chunks.some((chunk) => chunk.type === 'text-delta' && chunk.text === 'hi'))
})

test('retryable statuses are bounded and the final refusal is thrown', async () => {
  const { adapter, calls } = makeAdapter(
    [new Response('front door down', { status: 503 })],
    { httpRetryBaseMs: 1, httpRetries: 2 },
  )
  await assert.rejects(
    async () => { for await (const _chunk of adapter.stream(requestOptions())) { /* drain */ } },
    (error) => error.code === 'HTTP_ERROR' && /503/.test(error.message),
  )
  assert.equal(calls.length, 3, 'initial attempt plus two retries')
})

test('a 401 refreshes the token and retries exactly once', async () => {
  const { adapter, calls, state } = makeAdapter([new Response('expired', { status: 401 }), okSse()])
  const chunks = []
  for await (const chunk of adapter.stream(requestOptions())) chunks.push(chunk)
  assert.equal(state.invalidated, 1)
  assert.equal(calls.length, 2)
  assert.ok(chunks.some((chunk) => chunk.type === 'text-delta'))
})

test('a 403 is not retried', async () => {
  const { adapter, calls } = makeAdapter([new Response('no license', { status: 403 })])
  await assert.rejects(
    async () => { for await (const _chunk of adapter.stream(requestOptions())) { /* drain */ } },
    (error) => error.code === 'NO_LICENSE',
  )
  assert.equal(calls.length, 1)
})

// ---- block-end content (2026-11-05, the "answer eaten" bug) ----------------

/**
 * Build an SSE response from candidate frames.
 *
 * MEASURED 2026-11-05 in live session-13e95450-0a9b-4a5a-b49b-a3ac85237e4d:
 * every `text-chunks` entry carried the answer, but the following `block-end`
 * carried `{type:'text', text:''}`, the host stored the empty block, and the
 * transcript showed no reply at all. The block-end payload is what the host
 * persists, so it must be the accumulated text.
 */
const textSse = (frames) => new Response(
  frames.map(frame).join('') + 'data: [DONE]\n\n',
  { status: 200, headers: { 'content-type': 'text/event-stream' } },
)

test('a closed text block carries the accumulated text, not an empty string', async () => {
  const { adapter } = makeAdapter([
    textSse([
      { response: { candidates: [{ content: { parts: [{ text: 'The answer ' }] } }] } },
      { response: { candidates: [{ content: { parts: [{ text: 'is complete.' }] } }] } },
    ]),
  ])
  const chunks = []
  for await (const chunk of adapter.stream(requestOptions())) chunks.push(chunk)
  const end = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block?.type === 'text')
  assert.ok(end, 'the text block must be closed')
  assert.equal(end.block.text, 'The answer is complete.')
  assert.ok(
    chunks.some((chunk) => chunk.type === 'text-delta' && chunk.text === 'The answer '),
    'deltas still stream for the live view',
  )
})

test('a closed reasoning block carries the accumulated reasoning text', async () => {
  const { adapter } = makeAdapter([
    textSse([
      { response: { candidates: [{ content: { parts: [{ text: 'thinking…', thought: true }, { text: 'done' }] } }] } },
    ]),
  ])
  const chunks = []
  for await (const chunk of adapter.stream(requestOptions())) chunks.push(chunk)
  const reasoningEnd = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block?.type === 'reasoning')
  assert.ok(reasoningEnd, 'the reasoning block must be closed')
  assert.equal(reasoningEnd.block.text, 'thinking…')
})

// ---- P2: the adapter now emits through the shared downstream pipe ----------

test('a filtered finish is a terminal error with a code, not a clean stop', async () => {
  const { adapter } = makeAdapter([
    textSse([{ response: { candidates: [{ content: { parts: [{ text: 'partial' }] }, finishReason: 'SAFETY' }] } }]),
  ])
  const chunks = []
  for await (const chunk of adapter.stream(requestOptions())) chunks.push(chunk)
  const finish = chunks.at(-1)
  assert.equal(finish.type, 'finish')
  assert.equal(finish.reason.kind, 'error')
  assert.equal(finish.reason.failure.code, 'CONTENT_FILTERED')
  assert.equal(typeof finish.reason.failure.message, 'string')
})

test('an empty completion is an in-band terminal error, not a throw', async () => {
  const { adapter } = makeAdapter([textSse([{ response: { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] } }])])
  const chunks = []
  for await (const chunk of adapter.stream(requestOptions())) chunks.push(chunk)
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'EMPTY_RESPONSE')
})

test('a cut after partial text keeps the partial block and the original cause', async () => {
  // A real socket cut delivers the bytes already in flight, then fails the read.
  // `controller.error()` in `start()` would discard the queued chunk instead, so
  // the failure is raised on the pull AFTER the first frame was handed over.
  const encoder = new TextEncoder()
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode(frame({ response: { candidates: [{ content: { parts: [{ text: 'so far' }] } }] } })))
    },
    pull(controller) {
      controller.error(Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' }))
    },
  })
  const { adapter } = makeAdapter([new Response(body, { status: 200, headers: { 'content-type': 'text/event-stream' } })])
  const chunks = []
  for await (const chunk of adapter.stream(requestOptions())) chunks.push(chunk)
  const textEnd = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'text')
  assert.ok(textEnd, 'the partial text block must still be closed')
  assert.equal(textEnd.block.text, 'so far')
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'ECONNRESET')
})

test('a complete functionCall produces one delta and a closed block', async () => {
  const { adapter } = makeAdapter([
    textSse([{ response: { candidates: [{ content: { parts: [{ functionCall: { name: 'read_file', args: { path: '/tmp/x' }, id: 'g1' } }] }, finishReason: 'STOP' }] } }]),
  ])
  const chunks = []
  for await (const chunk of adapter.stream(requestOptions())) chunks.push(chunk)
  const delta = chunks.find((chunk) => chunk.type === 'tool-call-delta')
  assert.equal(delta.id, 'g1')
  assert.equal(delta.name, 'read_file')
  assert.equal(delta.argumentsDelta, '{"path":"/tmp/x"}')
  const end = chunks.find((chunk) => chunk.type === 'block-end' && chunk.block.type === 'tool-call')
  assert.deepEqual(end.block, { type: 'tool-call', id: 'g1', name: 'read_file', arguments: '{"path":"/tmp/x"}' })
  assert.deepEqual(chunks.at(-1).reason, { kind: 'tool-calls' })
})

test('usage arrives before finish and nothing follows the finish', async () => {
  const { adapter } = makeAdapter([
    textSse([{ response: { candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 5, candidatesTokenCount: 1 } } }]),
  ])
  const chunks = []
  for await (const chunk of adapter.stream(requestOptions())) chunks.push(chunk)
  const types = chunks.map((chunk) => chunk.type)
  assert.equal(types.at(-1), 'finish')
  assert.equal(types.indexOf('usage'), types.length - 2)
})

test('indexes are allocated in first-seen order, not from fixed constants', async () => {
  const { adapter } = makeAdapter([
    textSse([{ response: { candidates: [{ content: { parts: [{ text: 'think', thought: true }, { text: 'answer' }] }, finishReason: 'STOP' }] } }]),
  ])
  const chunks = []
  for await (const chunk of adapter.stream(requestOptions())) chunks.push(chunk)
  const starts = chunks.filter((chunk) => chunk.type === 'block-start').map((chunk) => [chunk.index, chunk.blockType])
  assert.deepEqual(starts, [[0, 'reasoning'], [1, 'text']])
})
