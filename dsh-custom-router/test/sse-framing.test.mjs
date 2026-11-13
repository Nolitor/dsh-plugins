/**
 * Frame-dialect coverage for the shared SSE reader.
 *
 * `lib/stream/sse.js` serves two framing dialects from one splitter: the
 * OpenAI-compatible default (`data:` only, `[DONE]` terminates) and the
 * Anthropic-style dialect (`event:` captured, no sentinel, the stream ends by
 * closing). These tests pin both, and pin that the default path is unchanged.
 */

import test from 'node:test'
import assert from 'node:assert/strict'

import { readSseEvents, DONE, findRecordBoundary } from '../lib/stream/sse.js'

/** Turn fixed chunks into an async iterable, so splits are fully controlled. */
async function* chunksOf(...chunks) {
  for (const chunk of chunks) yield chunk
}

/** Collect the whole iterable into an array. */
async function collect(body, options) {
  const out = []
  for await (const event of readSseEvents(body, options)) out.push(event)
  return out
}

test('default dialect is unchanged: OpenAI frames, `[DONE]` terminates', async () => {
  const body = chunksOf(
    'data: {"id":"1","choices":[{"delta":{"content":"He"}}]}\n\n',
    'data: {"id":"1","choices":[{"delta":{"content":"llo"}}]}\n\n',
    `data: ${DONE}\n\n`,
    'data: {"should":"never be read"}\n\n',
  )
  const events = await collect(body)
  assert.equal(events.length, 2)
  assert.equal(events[0].choices[0].delta.content, 'He')
  assert.equal(events[1].choices[0].delta.content, 'llo')
})

test('default dialect ignores `event:` lines', async () => {
  const body = chunksOf('event: message_start\ndata: {"a":1}\n\n')
  const events = await collect(body)
  assert.deepEqual(events, [{ a: 1 }])
})

test('default dialect: a payload without `eventNames` keeps no `type` from `event:`', async () => {
  const body = chunksOf('event: content_block_delta\ndata: {"b":2}\n\n')
  const [event] = await collect(body)
  assert.deepEqual(event, { b: 2 })
})

test('Anthropic dialect folds `event:` into `type` when the payload lacks one', async () => {
  const body = chunksOf(
    'event: message_start\ndata: {"message":{"id":"m1"}}\n\n',
    'event: content_block_delta\ndata: {"delta":{"text":"Hi"}}\n\n',
  )
  const events = await collect(body, { eventNames: true })
  assert.equal(events.length, 2)
  assert.equal(events[0].type, 'message_start')
  assert.equal(events[1].type, 'content_block_delta')
  assert.equal(events[1].delta.text, 'Hi')
})

test('Anthropic dialect keeps the payload own `type` over the event name', async () => {
  const body = chunksOf('event: message_start\ndata: {"type":"own","n":1}\n\n')
  const [event] = await collect(body, { eventNames: true })
  assert.deepEqual(event, { type: 'own', n: 1 })
})

test('Anthropic dialect has no `[DONE]` sentinel: end of stream ends iteration', async () => {
  const body = chunksOf(
    'event: content_block_delta\ndata: {"delta":{"text":"A"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}\n\n',
  )
  const events = await collect(body, { eventNames: true })
  assert.equal(events.length, 2)
  assert.equal(events[1].type, 'message_stop')
})

test('Anthropic dialect: a literal `[DONE]` frame is dropped, not yielded or thrown', async () => {
  const body = chunksOf(
    'event: content_block_delta\ndata: {"delta":{"text":"A"}}\n\n',
    `data: ${DONE}\n\n`,
    'event: content_block_delta\ndata: {"delta":{"text":"B"}}\n\n',
  )
  const events = await collect(body, { eventNames: true })
  assert.equal(events.length, 2)
  assert.equal(events[0].delta.text, 'A')
  assert.equal(events[1].delta.text, 'B')
})

test('Anthropic dialect: an unterminated final frame is still decoded', async () => {
  const body = chunksOf(
    'event: content_block_delta\ndata: {"delta":{"text":"A"}}\n\n',
    'event: message_stop\ndata: {"type":"message_stop"}',
  )
  const events = await collect(body, { eventNames: true })
  assert.equal(events.length, 2)
  assert.equal(events[1].type, 'message_stop')
})

test('Anthropic dialect: multi-line `data:` joins with a newline', async () => {
  const body = chunksOf('event: content_block_delta\ndata: {"delta":\ndata: {"text":"multi"}}\n\n')
  const [event] = await collect(body, { eventNames: true })
  assert.equal(event.type, 'content_block_delta')
  assert.equal(event.delta.text, 'multi')
})

test('Anthropic dialect: a blank `data:` keep-alive is skipped in both dialects', async () => {
  const body = chunksOf('data:\n\n', 'event: content_block_delta\ndata: {"n":1}\n\n')
  const events = await collect(body, { eventNames: true })
  assert.deepEqual(events, [{ n: 1, type: 'content_block_delta' }])
})

test('chunk split mid-frame decodes the same as one write (both dialects)', async () => {
  const openAi = 'data: {"id":"1","choices":[{"delta":{"content":"split"}}]}\n\n'
  const splitAt = openAi.indexOf('"split"')
  const openAiEvents = await collect(chunksOf(openAi.slice(0, splitAt), openAi.slice(splitAt)))
  assert.equal(openAiEvents.length, 1)
  assert.equal(openAiEvents[0].choices[0].delta.content, 'split')

  const anthropic = 'event: content_block_delta\ndata: {"delta":{"text":"split"}}\n\n'
  const cut = anthropic.indexOf('"split"')
  const anthropicEvents = await collect(
    chunksOf(anthropic.slice(0, cut), anthropic.slice(cut)),
    { eventNames: true },
  )
  assert.equal(anthropicEvents.length, 1)
  assert.equal(anthropicEvents[0].type, 'content_block_delta')
  assert.equal(anthropicEvents[0].delta.text, 'split')
})

test('chunk split between the event line and its data line', async () => {
  const body = chunksOf('event: message_start\n', 'data: {"message":{"id":"m1"}}\n\n')
  const [event] = await collect(body, { eventNames: true })
  assert.equal(event.type, 'message_start')
  assert.equal(event.message.id, 'm1')
})

test('CRLF records decode in both dialects', async () => {
  const openAi = await collect(chunksOf('data: {"a":1}\r\n\r\n'))
  assert.deepEqual(openAi, [{ a: 1 }])

  const anthropic = await collect(chunksOf('event: ping\r\ndata: {"b":2}\r\n\r\n'), { eventNames: true })
  assert.deepEqual(anthropic, [{ b: 2, type: 'ping' }])
})

test('non-boolean eventNames keeps the default dialect', async () => {
  for (const value of [false, 'true', 1, null, undefined]) {
    const events = await collect(chunksOf('event: content_block_delta\ndata: {"b":2}\n\n'), { eventNames: value })
    assert.deepEqual(events, [{ b: 2 }], `eventNames=${String(value)} must not opt in`)
  }
})

test('findRecordBoundary is dialect-agnostic', () => {
  assert.deepEqual(findRecordBoundary('a\n\nrest'), { end: 3 })
  assert.deepEqual(findRecordBoundary('a\r\n\r\nrest'), { end: 5 })
  assert.equal(findRecordBoundary('a\nb'), undefined)
})

test('default dialect: a malformed record still raises PROTOCOL_DEFECT', async () => {
  await assert.rejects(
    collect(chunksOf('data: {not json}\n\n')),
    (error) => error.code === 'PROTOCOL_DEFECT',
  )
})

test('`emitDone` still yields the legacy sentinel on the default path', async () => {
  const events = await collect(chunksOf('data: {"a":1}\n\n', `data: ${DONE}\n\n`), { emitDone: true })
  assert.equal(events.length, 2)
  assert.deepEqual(events[0], { a: 1 })
  assert.deepEqual(events[1], { done: true })
})
