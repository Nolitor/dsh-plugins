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
