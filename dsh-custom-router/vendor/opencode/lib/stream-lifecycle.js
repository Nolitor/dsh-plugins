/**
 * One lifecycle owner per stream.
 *
 * Phase B, increment B-1, lifecycle rule (CP3): **exactly one
 * `AbortController` per stream**. A stream used to be able to hold two owners —
 * the caller's signal and the adapter's own timeout — and an abort or an error
 * could leave a reader lock or a listener dangling when the pipe meets the
 * vendored consumer.
 *
 * This module is that single owner. It:
 *
 *   - creates exactly ONE `AbortController` for the stream;
 *   - forwards the caller's abort to that controller;
 *   - removes the caller's listener on `dispose()`;
 *   - makes `abort(reason)` and `dispose()` idempotent, and `dispose()` never
 *     throws.
 *
 * Two deliberate guards (architecture review, Argon 4.0):
 *
 *   1. `dispose()` does NOT abort the controller. A normal completion and a
 *      cancellation must stay distinguishable downstream: dispose means "this
 *      stream is over", not "this stream was cancelled".
 *   2. An already-aborted caller signal is honoured SYNCHRONOUSLY at
 *      registration. Waiting for an `abort` event that already fired would let
 *      the stream start work it must never start.
 *
 * @module @nolit/dsh-opencode-v2/stream-lifecycle
 */

/**
 * Create the lifecycle owner of one stream.
 *
 * @param {AbortSignal} [callerSignal] - the caller's cancellation signal.
 * @returns {{
 *   signal: AbortSignal,
 *   abort: (reason?: unknown) => void,
 *   dispose: () => void,
 *   readonly disposed: boolean,
 *   readonly aborted: boolean,
 * }}
 */
export function createStreamLifecycle(callerSignal) {
  // The one and only controller of this stream.
  const controller = new AbortController()
  let disposed = false

  /**
   * Forward a caller abort to the controller.
   *
   * Guard 3: after `dispose()` the caller's late abort must not reach the
   * controller — the listener is removed on dispose, and this early return
   * covers the window where an abort was queued before the removal.
   */
  const onCallerAbort = () => {
    if (disposed) return
    if (!controller.signal.aborted) controller.abort(callerSignal?.reason)
  }

  if (callerSignal && typeof callerSignal.addEventListener === 'function') {
    // Guard 2: an already-aborted caller signal aborts the controller now, not
    // on the next event that never comes.
    if (callerSignal.aborted) {
      if (!controller.signal.aborted) controller.abort(callerSignal.reason)
    } else {
      callerSignal.addEventListener('abort', onCallerAbort, { once: true })
    }
  }

  return {
    /** The stream's signal. Pass this downstream, never a second controller. */
    signal: controller.signal,

    /**
     * Abort the stream. Idempotent: the first call wins, later calls are no-ops.
     *
     * @param {unknown} [reason] - the abort reason.
     */
    abort(reason) {
      if (controller.signal.aborted) return
      try {
        controller.abort(reason)
      } catch {
        // An abort must never throw out of the lifecycle owner.
      }
    },

    /**
     * Release the lifecycle owner.
     *
     * Removes the caller's listener and marks the owner disposed. It does NOT
     * abort the controller: a stream that finished normally must not look like a
     * cancelled one downstream. Idempotent, and never throws.
     */
    dispose() {
      if (disposed) return
      disposed = true
      try {
        if (callerSignal && typeof callerSignal.removeEventListener === 'function') {
          callerSignal.removeEventListener('abort', onCallerAbort)
        }
      } catch {
        // A listener that cannot be removed must not break the stream teardown.
      }
    },

    /** Whether `dispose()` has run. */
    get disposed() {
      return disposed
    },

    /** Whether the stream was aborted (by the caller or by `abort()`). */
    get aborted() {
      return controller.signal.aborted
    },
  }
}
