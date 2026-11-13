/**
 * The one failure vocabulary for the shared downstream pipe.
 *
 * Every terminal error this pipe emits carries `{ message, code }`: `code` is
 * mandatory in the host contract (`LlmFailure`), and a track that emitted
 * `{ kind: 'provider', message }` without it produced a failure the host could
 * not route on. Kept here so no provider re-declares the shape.
 *
 * @module @nolit/dsh-custom-router/stream/failure
 */

/** Stable machine codes this pipe raises. Never rename one without a test. */
export const CODES = Object.freeze({
  CONTENT_FILTERED: 'CONTENT_FILTERED',
  PROVIDER_RESOURCE: 'PROVIDER_RESOURCE',
  UNKNOWN_FINISH_REASON: 'UNKNOWN_FINISH_REASON',
  PROTOCOL_DEFECT: 'PROTOCOL_DEFECT',
  EMPTY_RESPONSE: 'EMPTY_RESPONSE',
  STREAM_CUT: 'STREAM_CUT',
  ABORTED: 'ABORTED',
})

/**
 * Build the host's `LlmFailure`.
 *
 * @param code - one of {@link CODES} (or a provider code that follows the same shape).
 * @param message - operator-facing detail.
 * @param extra - optional `status`, `providerRetryAfterMs`, `requestId`.
 * @returns a failure with `message` and `code` always present.
 */
export function fail(code, message, extra = {}) {
  if (typeof code !== 'string' || code.length === 0) throw new TypeError('stream failure requires a non-empty code')
  if (typeof message !== 'string' || message.length === 0) throw new TypeError('stream failure requires a non-empty message')
  return { message, ...extra, code }
}

/**
 * Terminal error for a response that carried no content block.
 *
 * In-band, never thrown: the stream has already started when this decision is
 * made, so throwing here would replace a clean terminal chunk with an
 * exception the host reports differently.
 *
 * @returns a `finish` chunk.
 */
export function emptyCompletion() {
  return {
    type: 'finish',
    reason: { kind: 'error', failure: fail(CODES.EMPTY_RESPONSE, 'the provider returned no content blocks') },
  }
}

/**
 * Terminal error for a stream that ended after partial output.
 *
 * The caller has already emitted the accumulated `block-end`s; this only says
 * why the turn stopped. The original cause is preserved verbatim.
 *
 * @param cause - `{ code, message, status?, providerRetryAfterMs? }`.
 * @returns a `finish` chunk.
 */
export function cutCompletion(cause = {}) {
  return {
    type: 'finish',
    reason: {
      kind: 'error',
      failure: fail(cause.code ?? CODES.STREAM_CUT, cause.message ?? 'the provider closed the stream before it finished', {
        ...(cause.status === undefined ? {} : { status: cause.status }),
        ...(cause.providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs: cause.providerRetryAfterMs }),
      }),
    },
  }
}

/**
 * Terminal abort chunk.
 *
 * @param message - why the caller cancelled.
 * @returns a `finish` chunk.
 */
export function abortedCompletion(message = 'request cancelled by the caller') {
  return { type: 'finish', reason: { kind: 'aborted', failure: fail(CODES.ABORTED, message) } }
}

/** The one abort message the shared pipe raises. */
export const ABORT_MESSAGE = 'the stream was aborted'

/**
 * Build the `AbortError` this pipe throws when a caller's signal is aborted.
 *
 * One factory, one message, one shape across `index.js`, `sse.js` and
 * `anthropic.js`: those three each carried their own copy and one of them used a
 * different message, so the same cancellation surfaced differently depending on
 * which layer noticed it first. `error.name === 'AbortError'` is the contract the
 * pipe and `lib/retry.js` both recognise, so it is set explicitly rather than
 * relying on `DOMException`.
 *
 * @param message - operator-facing detail; defaults to {@link ABORT_MESSAGE}.
 * @returns an `AbortError`-shaped `Error`.
 */
export function abortError(message = ABORT_MESSAGE) {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}
