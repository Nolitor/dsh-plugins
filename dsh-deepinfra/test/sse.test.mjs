import assert from 'node:assert/strict'
import test from 'node:test'

import { DONE, readEvents } from '../lib/sse.js'

/**
 * Build a ReadableStream from string fragments, so a test can split an event
 * across chunks exactly the way a socket does.
 * @param {string[]} fragments - body fragments, in order.
 */
function streamOf(fragments) {
  const encoder = new TextEncoder()
  return new ReadableStream({
    start(controller) {
      for (const fragment of fragments) controller.enqueue(encoder.encode(fragment))
      controller.close()
    },
  })
}

test('decodes one JSON payload per record', async () => {
  const body = streamOf([
    'data: {"a":1}\n\n',
    'data: {"b":2}\n\n',
    `data: ${DONE}\n\n`,
  ])
  const events = []
  for await (const event of readEvents(body)) events.push(event)
  assert.deepEqual(events, [{ a: 1 }, { b: 2 }])
})

test('a payload split across chunks is reassembled', async () => {
  // Measured hazard: the JSON body arrives in arbitrary TCP fragments, so a
  // reader that decodes per chunk loses the record.
  const body = streamOf(['data: {"text":"hel', 'lo"}\n', '\ndata: [DONE]\n\n'])
  const events = []
  for await (const event of readEvents(body)) events.push(event)
  assert.deepEqual(events, [{ text: 'hello' }])
})

test('CRLF framing is accepted', async () => {
  const body = streamOf(['data: {"ok":true}\r\n\r\n', `data: ${DONE}\r\n\r\n`])
  const events = []
  for await (const event of readEvents(body)) events.push(event)
  assert.deepEqual(events, [{ ok: true }])
})

test('comment keep-alive lines are ignored', async () => {
  const body = streamOf([': ping\n\n', 'data: {"a":1}\n\n', `data: ${DONE}\n\n`])
  const events = []
  for await (const event of readEvents(body)) events.push(event)
  assert.deepEqual(events, [{ a: 1 }])
})

test('multi-line data fields join with a newline', async () => {
  const body = streamOf(['data: {"a":\ndata: 1}\n\n', `data: ${DONE}\n\n`])
  const events = []
  for await (const event of readEvents(body)) events.push(event)
  assert.deepEqual(events, [{ a: 1 }])
})

test('a final record without a trailing blank line is still decoded', async () => {
  // DeepInfra closes with "data: [DONE]\n\n", but a proxy that truncates the
  // trailing blank line must not lose the last usage event.
  const body = streamOf(['data: {"a":1}\n\n', 'data: {"usage":1}'])
  const events = []
  for await (const event of readEvents(body)) events.push(event)
  assert.deepEqual(events, [{ a: 1 }, { usage: 1 }])
})

test('an undecodable record is surfaced, not silently dropped', async () => {
  const body = streamOf(['data: {oops\n\n', `data: ${DONE}\n\n`])
  const events = []
  for await (const event of readEvents(body)) events.push(event)
  assert.equal(events.length, 1)
  assert.equal(events[0].__unparsed, '{oops')
})

test('DONE terminates iteration immediately', async () => {
  const body = streamOf(['data: {"a":1}\n\n', `data: ${DONE}\n\n`, 'data: {"after":true}\n\n'])
  const events = []
  for await (const event of readEvents(body)) events.push(event)
  assert.deepEqual(events, [{ a: 1 }])
})
