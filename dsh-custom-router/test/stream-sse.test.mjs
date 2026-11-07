import test from 'node:test'
import assert from 'node:assert/strict'
import { DONE, readSseEvents } from '../lib/stream/sse.js'

/** Feed raw chunks as an async iterable of strings. */
async function* chunks(...parts) {
  for (const part of parts) yield part
}

async function collect(iterable) {
  const out = []
  for await (const value of iterable) out.push(value)
  return out
}

const json = (value) => JSON.stringify(value)
const frame = (value) => `data: ${json(value)}\n\n`

test('a record ends at a blank line under the LF convention', async () => {
  const out = await collect(readSseEvents(chunks(frame({ a: 1 }), frame({ a: 2 }))))
  assert.deepEqual(out, [{ a: 1 }, { a: 2 }])
})

test('a record ends at a blank line under the CRLF convention', async () => {
  const out = await collect(readSseEvents(chunks(`data: ${json({ a: 1 })}\r\n\r\n`)))
  assert.deepEqual(out, [{ a: 1 }])
})

test('CRLF is matched before LF so a frame is never cut in the wrong place', async () => {
  const body = `data: ${json({ a: 1 })}\r\n\r\ndata: ${json({ a: 2 })}\r\n\r\n`
  assert.deepEqual(await collect(readSseEvents(chunks(body))), [{ a: 1 }, { a: 2 }])
})

test('a frame split across arbitrary chunk boundaries decodes the same', async () => {
  const body = `data: ${json({ a: 1 })}\n\ndata: ${json({ b: 2 })}\n\n`
  const oneByte = [...body]
  assert.deepEqual(await collect(readSseEvents(chunks(...oneByte))), [{ a: 1 }, { b: 2 }])
})

test('multi-line data fields join with a newline as the SSE spec requires', async () => {
  const body = 'data: {"a":\ndata: 1}\n\n'
  assert.deepEqual(await collect(readSseEvents(chunks(body))), [{ a: 1 }])
})

test('comment and keep-alive lines produce no payload', async () => {
  const body = `: keep-alive\n\ndata: ${json({ a: 1 })}\n\n`
  assert.deepEqual(await collect(readSseEvents(chunks(body))), [{ a: 1 }])
})

test('[DONE] terminates iteration and is never yielded', async () => {
  const body = `data: ${json({ a: 1 })}\n\ndata: [DONE]\n\ndata: ${json({ b: 2 })}\n\n`
  assert.deepEqual(await collect(readSseEvents(chunks(body))), [{ a: 1 }])
})

test('a server that closes without a trailing blank line still owes its last record', async () => {
  const body = `data: ${json({ usage: { total_tokens: 3 } })}`
  assert.deepEqual(await collect(readSseEvents(chunks(body))), [{ usage: { total_tokens: 3 } }])
})

test('an undecodable record fails by default', async () => {
  await assert.rejects(
    async () => collect(readSseEvents(chunks('data: {not json}\n\n'))),
    (error) => error.code === 'PROTOCOL_DEFECT',
  )
})

test('an undecodable record is skippable only when the descriptor asks for it', async () => {
  const body = `data: {not json}\n\ndata: ${json({ a: 1 })}\n\n`
  assert.deepEqual(await collect(readSseEvents(chunks(body), { malformed: 'skip' })), [{ a: 1 }])
})

test('an unknown malformed policy is refused instead of silently defaulting', async () => {
  // The reader is an async generator, so the refusal surfaces on first pull.
  await assert.rejects(async () => collect(readSseEvents(chunks(''), { malformed: 'ignore' })), TypeError)
})

test('an aborted signal stops the reader with an AbortError', async () => {
  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    async () => collect(readSseEvents(chunks(frame({ a: 1 })), { signal: controller.signal })),
    (error) => error.name === 'AbortError',
  )
})

test('a web ReadableStream body is cancelled when iteration stops early', async () => {
  let cancelled = false
  const body = new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(`data: ${json({ a: 1 })}\n\n`)) },
    cancel() { cancelled = true },
  })
  const iterator = readSseEvents(body)[Symbol.asyncIterator]()
  await iterator.next()
  await iterator.return?.()
  assert.equal(cancelled, true)
})

test('the exported DONE sentinel is the literal wire marker', () => {
  assert.equal(DONE, '[DONE]')
})
