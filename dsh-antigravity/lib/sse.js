/**
 * SSE framing — compatibility surface only.
 *
 * The implementation moved to `@nolit/dsh-custom-router/stream` (P2). Three
 * vendors shipped three SSE readers with three malformed-record policies; the
 * workspace now has one. This file keeps the published `./sse` export working
 * and performs no parsing of its own.
 *
 * Contract change to note for consumers: the shared reader ends iteration at
 * `data: [DONE]` instead of yielding a `{ done: true }` sentinel. Callers that
 * looped `for await` and checked `event?.done` need no change; callers that
 * counted that sentinel as an event do.
 *
 * @module @nolit/dsh-antigravity/sse
 */

import { findRecordBoundary, readSseEvents } from '@nolit/dsh-custom-router/stream'

export const findBoundary = findRecordBoundary

/**
 * Read a response body as decoded payloads.
 *
 * Kept as a thin wrapper because this provider's published contract yields a
 * `{ done: true }` sentinel at `[DONE]`; the shared reader ends iteration.
 *
 * @param response - a `Response` (or its body) carrying SSE.
 * @param options - forwarded to the shared reader.
 * @returns decoded payloads, then `{ done: true }`.
 */
export function readEvents(response, options = {}) {
  return readSseEvents(response, { ...options, emitDone: true })
}
