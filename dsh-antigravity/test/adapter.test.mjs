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
