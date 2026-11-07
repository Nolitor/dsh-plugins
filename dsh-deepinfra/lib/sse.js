/**
 * SSE framing for the DeepInfra OpenAI-compatible stream — compatibility
 * surface only.
 *
 * The implementation moved to `@nolit/dsh-custom-router/stream` (P3). Three
 * vendors shipped three readers with three malformed-record policies; the
 * workspace now has one. This file keeps the published `./sse` shape working
 * and performs no parsing of its own.
 *
 * Measured framing (2026-11-04, api.deepinfra.com/v1/openai/chat/completions),
 * all guaranteed by the shared reader: every event is a single `data: {json}`
 * line, events are separated by a blank line, and the terminal marker is the
 * literal `data: [DONE]`. There are no `event:`, `id:` or retry fields.
 *
 * Contract change to note for consumers: an undecodable record now THROWS with
 * `code === 'PROTOCOL_DEFECT'` instead of yielding a `{ __unparsed }` object.
 * Skipping such a record would silently truncate a turn, so the policy is
 * explicit here (`malformed: 'fail'`) and the caller decides nothing.
 *
 * @module @nolit/dsh-deepinfra/sse
 */

import { readSseEvents } from '@nolit/dsh-custom-router/stream'

/** The literal payload that ends a DeepInfra stream. */
export const DONE = '[DONE]'

/**
 * Read a response body as decoded JSON events, in order.
 *
 * A blank line ends a record; multi-line `data:` fields are joined with a
 * newline; comment lines (`: keep-alive`) are ignored; `[DONE]` terminates
 * iteration and is never yielded; a body that closes without a trailing blank
 * line still gets its last record decoded (otherwise the trailing usage event
 * would be dropped).
 *
 * @param body - the response body stream (or a `Response`).
 * @param options - passed to the shared reader: `{ signal, malformed, emitDone }`.
 * @returns decoded events, one per provider record, in wire order.
 */
export function readEvents(body, options = {}) {
  return readSseEvents(body, options)
}
