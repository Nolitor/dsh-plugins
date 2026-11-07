/**
 * The one SSE frame reader for the shared downstream pipe.
 *
 * Three vendors shipped three readers with three malformed-record policies: one
 * skipped a bad frame silently, one threw, one returned null. A skipped frame
 * silently truncates a turn, so the policy is now an explicit descriptor field
 * (`malformedRecord: 'fail' | 'skip'`) and the default is `fail`.
 *
 * Framing rules this reader guarantees, all measured on at least one provider:
 *   - a record ends at a blank line under CRLF or LF; CRLF is tested first
 *     because "\r\n\r\n" also contains "\n\r\n";
 *   - multi-line `data:` fields join with a newline, as the SSE spec requires;
 *   - comment lines (`: keep-alive`) are ignored;
 *   - `[DONE]` terminates iteration and is never yielded;
 *   - a server that closes without a trailing blank line still gets its last
 *     record decoded, otherwise the trailing usage chunk would be lost.
 *
 * @module @nolit/dsh-custom-router/stream/sse
 */

/** The literal payload that ends an OpenAI-compatible stream. */
export const DONE = '[DONE]'

/**
 * Read a response body as decoded payloads, in wire order.
 *
 * @param body - a web `ReadableStream` of bytes, an async iterable of chunks, or a
 *   `Response` whose `.body` carries the stream.
 * @param options - `{ signal, malformed = 'fail', emitDone = false }`.
 * @returns decoded `data:` payload objects. `[DONE]` normally ends the iterable;
 *   with `emitDone` it is yielded as the legacy `{ done: true }` sentinel instead,
 *   which keeps a published legacy reader contract working.
 */
export async function* readSseEvents(body, options = {}) {
  if (body === null || body === undefined) return
  const { signal, malformed = 'fail', emitDone = false } = options
  if (malformed !== 'fail' && malformed !== 'skip') throw new TypeError(`unknown malformed policy: ${String(malformed)}`)

  const decoder = new TextDecoder()
  let buffer = ''
  const release = readerOf(body)

  try {
    for await (const chunk of release) {
      if (signal?.aborted) throw abortError()
      buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
      let boundary
      while ((boundary = nextRecord(buffer)) !== -1) {
        const record = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary).replace(/^\r?\n/, '')
        const decoded = decodeRecord(record, malformed)
        if (decoded === DONE) {
          if (emitDone) yield { done: true }
          return
        }
        if (decoded !== undefined) yield decoded
      }
    }
    buffer += decoder.decode()
    for (const record of buffer.split(/\r?\n\r?\n/)) {
      if (record.trim() === '') continue
      const decoded = decodeRecord(record, malformed)
      if (decoded === DONE) {
        if (emitDone) yield { done: true }
        return
      }
      if (decoded !== undefined) yield decoded
    }
  } finally {
    await release.return?.()
  }
}

/**
 * Adapt either a web ReadableStream or an async iterable to one iteration shape.
 *
 * @param body - the response body.
 * @returns an async iterable of chunks plus an optional `return`.
 */
function readerOf(body) {
  if (typeof body?.[Symbol.asyncIterator] === 'function') return body
  // A Response carries the stream on `.body`; accepting it keeps legacy callers
  // working instead of forcing every consumer to unwrap by hand.
  if (body?.body !== undefined && body.getReader === undefined) return readerOf(body.body)
  if (typeof body?.getReader === 'function') {
    const reader = body.getReader()
    return {
      [Symbol.asyncIterator]() {
        return {
          async next() { return reader.read() },
          async return(value) {
            try { await reader.cancel() } catch { /* already gone */ }
            return { done: true, value }
          },
        }
      },
    }
  }
  throw new TypeError('readSseEvents requires a ReadableStream or an async iterable body')
}

/**
 * Locate the end of the first complete record under either line-ending
 * convention. CRLF is preferred because "\r\n\r\n" also contains "\n\r\n".
 *
 * @param buffer - accumulated text.
 * @returns `{ end }` just past the terminator, or undefined when incomplete.
 */
export function findRecordBoundary(buffer) {
  const crlf = buffer.indexOf('\r\n\r\n')
  const lf = buffer.indexOf('\n\n')
  if (crlf === -1 && lf === -1) return undefined
  if (crlf !== -1 && (lf === -1 || crlf <= lf)) return { end: crlf + 4 }
  return { end: lf + 2 }
}

/**
 * Locate the end of the first complete record.
 *
 * @param buffer - accumulated text.
 * @returns the index just past the blank line, or -1 when no record is complete.
 */
function nextRecord(buffer) {
  const boundary = findRecordBoundary(buffer)
  return boundary === undefined ? -1 : boundary.end
}

/**
 * Decode one SSE record.
 *
 * @param record - raw record text without its terminating blank line.
 * @param malformed - `'fail'` or `'skip'`.
 * @returns the decoded payload, the `DONE` sentinel, or undefined for a record with no data.
 */
function decodeRecord(record, malformed) {
  if (record.length === 0) return undefined
  const data = []
  for (const line of record.split(/\r?\n/)) {
    if (line.startsWith(':')) continue
    if (!line.startsWith('data:')) continue
    data.push(line.slice(5).replace(/^ /, ''))
  }
  if (data.length === 0) return undefined
  const joined = data.join('\n')
  if (joined === DONE) return DONE
  try {
    return JSON.parse(joined)
  } catch {
    if (malformed === 'skip') return undefined
    const error = new Error('the provider sent an undecodable SSE record')
    error.code = 'PROTOCOL_DEFECT'
    error.raw = joined.slice(0, 400)
    throw error
  }
}

/** @returns an `AbortError`-shaped error. */
function abortError() {
  const error = new Error('the stream was aborted')
  error.name = 'AbortError'
  return error
}
