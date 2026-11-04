/**
 * SSE framing for the DeepInfra OpenAI-compatible stream.
 *
 * Kept separate from translation so the only thing that knows about bytes is
 * this module. It emits decoded JSON payloads in wire order and stops at the
 * provider's end-of-stream marker; it never interprets a payload.
 *
 * Measured framing (2026-11-04, api.deepinfra.com/v1/openai/chat/completions):
 * every event is a single `data: {json}` line, events are separated by a blank
 * line, and the terminal marker is the literal `data: [DONE]`. There are no
 * `event:`, `id:` or retry fields.
 */

/** The literal payload that ends a DeepInfra stream. */
export const DONE = '[DONE]'

/**
 * Read a response body as decoded JSON events, in order.
 *
 * A blank line ends a record; multi-line `data:` fields are joined with a
 * newline exactly as the SSE spec requires, so a future provider that wraps
 * JSON over several lines still decodes. Comment lines (`: keep-alive`) are
 * ignored. `[DONE]` terminates iteration and is never yielded.
 *
 * @param body - the response body stream.
 * @param signal - optional cancellation, forwarded to the reader.
 * @returns decoded events, one per provider record, in wire order.
 */
export async function* readEvents(body, signal) {
  if (body == null) return
  const reader = body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''
  const flushSignal = () => {
    if (signal?.aborted) {
      const error = new Error('DeepInfra stream aborted')
      error.name = 'AbortError'
      throw error
    }
  }
  try {
    while (true) {
      flushSignal()
      const { done, value } = await reader.read()
      if (done) break
      buffer += decoder.decode(value, { stream: true })
      let boundary
      while ((boundary = nextRecord(buffer)) !== -1) {
        const record = buffer.slice(0, boundary)
        buffer = buffer.slice(boundary).replace(/^\r?\n/, '')
        const payload = parseRecord(record)
        if (payload === DONE) return
        if (payload !== undefined) yield payload
      }
    }
    // A server that closes without a trailing blank line still owes us its last
    // record; without this the final usage event would be dropped.
    buffer += decoder.decode()
    for (const record of buffer.split(/\r?\n\r?\n/)) {
      const payload = parseRecord(record)
      if (payload === DONE) return
      if (payload !== undefined) yield payload
    }
  } finally {
    try {
      await reader.cancel()
    } catch {
      // The body is already gone; nothing to release.
    }
  }
}

/**
 * Locate the end of the first complete SSE record.
 * @param buffer - accumulated text.
 * @returns the index just past the blank line, or -1 when no record is complete.
 */
function nextRecord(buffer) {
  const match = /\r?\n\r?\n/.exec(buffer)
  return match === null ? -1 : match.index + match[0].length
}

/**
 * Decode one SSE record into a JSON payload.
 * @param record - one record's raw text, without its terminating blank line.
 * @returns the decoded payload, `[DONE]`, or undefined for a record with no data.
 */
function parseRecord(record) {
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
    // A record we cannot decode is a protocol defect, not a delta; the caller
    // decides whether that aborts the stream.
    return { __unparsed: joined }
  }
}
