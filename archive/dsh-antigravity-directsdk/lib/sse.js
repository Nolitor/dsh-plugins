/**
 * Server-sent-events reader for cloudcode-pa.
 *
 * Measured frame shape (2026-11-05):
 *   data: {"response":{"candidates":[{"content":{"role":"model","parts":[...]},
 *          "finishReason":"STOP"}],"usageMetadata":{...},"modelVersion":"..."},
 *          "traceId":"...","metadata":{}}
 *
 * Every frame is one `data:` line followed by a blank line. Usage is cumulative
 * across frames, so the caller takes the LATEST frame, not a sum.
 *
 * LINE ENDINGS: the live server terminates frames with CRLF ("\r\n\r\n"),
 * measured 2026-11-05 — a naive \n\n split finds no boundary and silently
 * yields zero events from a perfectly good 200 response. Frames are therefore
 * split on a blank line under EITHER convention.
 *
 * @module @nolit/dsh-antigravity-directsdk/sse
 */

/**
 * Iterate decoded JSON values from a Response body.
 * @param response - fetch Response with an SSE body.
 * @returns each parsed `data:` payload, in order.
 */
export async function* readEvents(response) {
  if (!response.body) throw new Error('Antigravity response has no body')
  const decoder = new TextDecoder()
  let buffer = ''
  for await (const chunk of response.body) {
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    let split = findBoundary(buffer)
    while (split !== undefined) {
      const raw = buffer.slice(0, split.end)
      buffer = buffer.slice(split.end)
      const event = parseFrame(raw)
      if (event !== undefined) yield event
      split = findBoundary(buffer)
    }
  }
  buffer += decoder.decode()
  if (buffer.trim() !== '') {
    const event = parseFrame(buffer)
    if (event !== undefined) yield event
  }
}

/**
 * Locate the next frame terminator under either line-ending convention.
 *
 * CRLF must be tested first: "\r\n\r\n" also contains "\n\r\n", so an LF-first
 * search would cut a frame in the wrong place.
 *
 * @param buffer - accumulated text.
 * @returns `{ end }` where `end` is the index just past the terminator.
 */
export function findBoundary(buffer) {
  const crlf = buffer.indexOf('\r\n\r\n')
  const lf = buffer.indexOf('\n\n')
  if (crlf === -1 && lf === -1) return undefined
  if (crlf !== -1 && (lf === -1 || crlf <= lf)) return { end: crlf + 4 }
  return { end: lf + 2 }
}

/**
 * Parse one SSE frame block.
 * @param raw - frame text without the trailing blank line.
 * @returns the parsed payload, or undefined for comments and non-data frames.
 */
export function parseFrame(raw) {
  const dataLines = []
  for (const line of raw.split('\n')) {
    const trimmed = line.endsWith('\r') ? line.slice(0, -1) : line
    if (trimmed.startsWith('data:')) dataLines.push(trimmed.slice(5).replace(/^ /, ''))
  }
  if (dataLines.length === 0) return undefined
  const payload = dataLines.join('\n')
  if (payload === '[DONE]') return { done: true }
  try {
    return JSON.parse(payload)
  } catch {
    // A partial or non-JSON frame must not kill the stream; skip it.
    return undefined
  }
}
