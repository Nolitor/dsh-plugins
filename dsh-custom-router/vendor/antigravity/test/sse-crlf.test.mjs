/**
 * Regression: the live server frames SSE with CRLF. A \n\n-only split yields
 * zero events from a valid 200 response (measured 2026-11-05).
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { findBoundary, readEvents } from '../lib/sse.js'

const PAYLOAD = JSON.stringify({ response: { candidates: [{ content: { parts: [{ text: 'Hello!' }] } }] } })
const body = (sep) => `data: ${PAYLOAD}${sep}data: ${PAYLOAD}${sep}`

/** Stream raw text through a Response body. */
function response(bytes) {
  const encoder = new TextEncoder()
  return new Response(new ReadableStream({ start(c) { c.enqueue(encoder.encode(bytes)); c.close() } }))
}

test('CRLF frames are parsed', async () => {
  const events = []
  for await (const e of readEvents(response(body('\r\n\r\n')))) events.push(e)
  assert.equal(events.length, 2)
})

test('LF frames still parse', async () => {
  const events = []
  for await (const e of readEvents(response(body('\n\n')))) events.push(e)
  assert.equal(events.length, 2)
})

test('mixed CRLF and LF frames parse together', async () => {
  const events = []
  for await (const e of readEvents(response(`data: ${PAYLOAD}\r\n\r\ndata: ${PAYLOAD}\n\n`))) events.push(e)
  assert.equal(events.length, 2)
})

test('CRLF split across chunk boundaries', async () => {
  const full = body('\r\n\r\n')
  const cut = full.indexOf('\r\n\r\n') + 2
  const encoder = new TextEncoder()
  const res = new Response(new ReadableStream({
    start(c) {
      c.enqueue(encoder.encode(full.slice(0, cut)))
      c.enqueue(encoder.encode(full.slice(cut)))
      c.close()
    },
  }))
  const events = []
  for await (const e of readEvents(res)) events.push(e)
  assert.equal(events.length, 2)
})

test('findBoundary prefers the CRLF terminator over the LF inside it', () => {
  const buffer = `data: x\r\n\r\ndata: y`
  assert.deepEqual(findBoundary(buffer), { end: buffer.indexOf('\r\n\r\n') + 4 })
})
