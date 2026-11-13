/**
 * Shared HTTP retry loop: backoff arithmetic, an abortable sleep, a status
 * predicate set, and one `withRetry` wrapper.
 *
 * Parameters are measured from the subscription-route adapter this package
 * already ships (2026-11-13), and are the defaults here:
 *
 *   - retryable statuses `[429, 451, 500, 502, 503, 504]` — a rate limit, a
 *     gateway fault, or a legal/unavailable refusal says nothing about the
 *     request body. `401/403/404` stay out: they need a new credential or a
 *     different model, not another attempt.
 *   - `httpRetries = 3`, `httpRetryBaseMs = 1000`.
 *   - backoff `base * 2 ** attempt` (attempt is 0-based), rounded, no jitter.
 *   - abort wins over the timer: the sleep races `setTimeout` against the
 *     caller's `abort` event and reports which one won.
 *   - a transport throw is NOT retried (only a status is), and an
 *     `AbortError` is always rethrown untouched.
 *
 * One deliberate departure: the measured loop has no upper bound, so attempt 3
 * already sleeps 8000ms and a long-lived route can back off for minutes.
 * `capMs` clamps every step; its default (`DEFAULT_CAP_MS`) keeps the worst
 * case bounded while leaving the first three steps identical to the measured
 * ones (1000, 2000, 4000).
 *
 * Pure: no network, no timers beyond the injected call, no imports.
 *
 * @module @nolit/dsh-custom-router/retry
 */

/** Statuses worth another attempt; frozen so a caller cannot mutate the set. */
export const DEFAULT_RETRY_STATUSES = Object.freeze([429, 451, 500, 502, 503, 504])

/** Retryable statuses as a Set, for the default predicate. */
export const RETRYABLE_STATUSES = new Set(DEFAULT_RETRY_STATUSES)

/** Default number of retries after the first attempt (measured: 3). */
export const DEFAULT_RETRIES = 3

/** Default first backoff step in milliseconds (measured: 1000). */
export const DEFAULT_BASE_MS = 1000

/** Default per-step ceiling in milliseconds. */
export const DEFAULT_CAP_MS = 30_000

/** Highest exponent considered, so `2 ** attempt` cannot overflow. */
const MAX_EXPONENT = 30

/**
 * Whether a status code belongs to the retryable set.
 *
 * @param {unknown} status HTTP status.
 * @param {Iterable<number>} [retryStatuses] Override set; defaults to the measured one.
 * @returns {boolean} True when another attempt is justified.
 */
export function isRetryableStatus(status, retryStatuses = RETRYABLE_STATUSES) {
  const code = Number(status)
  if (!Number.isFinite(code)) return false
  if (retryStatuses instanceof Set) return retryStatuses.has(code)
  for (const candidate of retryStatuses) if (Number(candidate) === code) return true
  return false
}

/**
 * Status carried by a thrown error, if any.
 *
 * Providers throw three shapes in this package: a bare `{ status }`, a
 * `{ statusCode }`, and a response-shaped `{ response: { status } }`. All three
 * are read so no route has to reshape its error for the retry loop.
 *
 * @param {unknown} error Thrown value.
 * @returns {number | undefined} Status when one is present.
 */
export function statusOf(error) {
  if (!error || typeof error !== 'object') return undefined
  const direct = error.status ?? error.statusCode
  if (direct !== undefined && Number.isFinite(Number(direct))) return Number(direct)
  const nested = error.response?.status
  if (nested !== undefined && Number.isFinite(Number(nested))) return Number(nested)
  return undefined
}

/**
 * Default retry predicate: an error is retryable only through its status.
 *
 * @param {unknown} error Thrown value.
 * @param {Iterable<number>} [retryStatuses] Status set.
 * @returns {boolean} True when the error carries a retryable status.
 */
export function isRetryableError(error, retryStatuses = RETRYABLE_STATUSES) {
  const status = statusOf(error)
  return status !== undefined && isRetryableStatus(status, retryStatuses)
}

/**
 * Whether a thrown value means the caller cancelled.
 *
 * @param {unknown} error Thrown value.
 * @returns {boolean} True for an `AbortError`, a cancellation `code`, or DOM-style abort.
 */
export function isAbortError(error) {
  if (!error || typeof error !== 'object') return false
  if (error.name === 'AbortError') return true
  return error.code === 'ABORT_ERR' || error.code === 'ERR_CANCELED'
}

/**
 * Build an error shaped like the platform's cancellation error.
 *
 * @param {string} message Human-readable reason.
 * @returns {Error & { name: string }} An `AbortError`.
 */
export function abortError(message = 'operation aborted') {
  const error = new Error(message)
  error.name = 'AbortError'
  return error
}

/**
 * Exponential backoff step.
 *
 * `backoffDelay(0, 1000, 30000) === 1000`, then 2000, 4000, 8000, ... clamped
 * to `capMs`. A non-positive or unreadable `baseMs` yields 0, so a caller that
 * cannot configure backoff still makes the attempts.
 *
 * @param {number} attempt 0-based retry index.
 * @param {number} baseMs First step in milliseconds.
 * @param {number} [capMs] Per-step ceiling; defaults to {@link DEFAULT_CAP_MS}.
 * @returns {number} Delay in whole milliseconds.
 */
export function backoffDelay(attempt, baseMs, capMs = DEFAULT_CAP_MS) {
  const base = Number(baseMs)
  if (!Number.isFinite(base) || base <= 0) return 0
  const step = Math.max(0, Math.trunc(Number(attempt) || 0))
  const raw = Math.round(base * 2 ** Math.min(step, MAX_EXPONENT))
  const cap = Number(capMs)
  if (!Number.isFinite(cap) || cap <= 0) return raw
  return Math.min(raw, Math.round(cap))
}

/**
 * Abortable sleep.
 *
 * @param {number} ms Delay; a non-positive delay resolves immediately.
 * @param {AbortSignal} [signal] Cancellation.
 * @returns {Promise<boolean>} True when the timer elapsed, false when aborted.
 */
export async function sleepFor(ms, signal) {
  if (!(Number(ms) > 0)) return !signal?.aborted
  if (signal?.aborted) return false
  return new Promise((resolve) => {
    let settled = false
    const finish = (elapsed) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      resolve(elapsed)
    }
    const timer = setTimeout(() => finish(true), Number(ms))
    const onAbort = () => finish(false)
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

/**
 * Run `fn` with bounded retries.
 *
 * `fn` receives the 0-based attempt index. It may return a value or throw an
 * error carrying a status (see {@link statusOf}); a retryable status sleeps
 * `backoffDelay(attempt)` and calls `fn` again. The last error is rethrown
 * unchanged once retries are exhausted, so the caller keeps the provider's own
 * error shape. Cancellation before an attempt or during a backoff throws an
 * `AbortError`.
 *
 * @param {(attempt: number) => unknown} fn Attempt body.
 * @param {object} [options] Tuning and cancellation.
 * @param {number} [options.retries] Retries after the first attempt (measured: 3).
 * @param {number} [options.baseMs] First backoff step (measured: 1000).
 * @param {number} [options.capMs] Per-step ceiling; see the module note.
 * @param {Iterable<number>} [options.retryStatuses] Statuses worth retrying.
 * @param {AbortSignal} [options.signal] Caller lifetime.
 * @param {(error: unknown, attempt: number) => boolean} [options.shouldRetry]
 *   Override predicate, evaluated only for thrown errors.
 * @param {(info: { attempt: number, delay: number, error: unknown, status?: number }) => void} [options.onRetry]
 *   Called before each backoff; the place a route logs its retry.
 * @returns {Promise<unknown>} The first successful result.
 */
export async function withRetry(fn, options = {}) {
  if (typeof fn !== 'function') throw new TypeError('withRetry needs a function')
  const retries = nonNegativeInt(options.retries, DEFAULT_RETRIES)
  const baseMs = nonNegativeNumber(options.baseMs, DEFAULT_BASE_MS)
  const capMs = nonNegativeNumber(options.capMs, DEFAULT_CAP_MS)
  const statuses = options.retryStatuses === undefined ? RETRYABLE_STATUSES : new Set(normalizeStatuses(options.retryStatuses))
  const signal = options.signal
  const shouldRetry =
    typeof options.shouldRetry === 'function'
      ? options.shouldRetry
      : (error) => isRetryableError(error, statuses)
  const onRetry = typeof options.onRetry === 'function' ? options.onRetry : undefined

  let lastError
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    if (signal?.aborted) throw abortError('operation aborted before attempt')
    try {
      return await fn(attempt)
    } catch (error) {
      if (isAbortError(error)) throw error
      lastError = error
      if (attempt >= retries || !shouldRetry(error, attempt)) throw error
      const delay = backoffDelay(attempt, baseMs, capMs)
      onRetry?.({ attempt, delay, error, status: statusOf(error) })
      if (!(await sleepFor(delay, signal))) throw abortError('operation aborted during retry backoff')
    }
  }
  throw lastError
}

/**
 * Coerce `retryStatuses` into a numeric list; an unreadable value means "none".
 *
 * @param {unknown} value Caller-supplied set.
 * @returns {number[]} Numeric statuses.
 */
function normalizeStatuses(value) {
  if (value === null || value === undefined) return []
  const list = typeof value === 'object' && !(Symbol.iterator in value) ? [] : value
  const out = []
  for (const entry of list) {
    const code = Number(entry)
    if (Number.isFinite(code)) out.push(code)
  }
  return out
}

/**
 * @param {unknown} value Candidate.
 * @param {number} fallback Default when unreadable.
 * @returns {number} Whole number, at least 0.
 */
function nonNegativeInt(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, Math.trunc(number))
}

/**
 * @param {unknown} value Candidate.
 * @param {number} fallback Default when unreadable.
 * @returns {number} Finite number, at least 0.
 */
function nonNegativeNumber(value, fallback) {
  const number = Number(value)
  if (!Number.isFinite(number)) return fallback
  return Math.max(0, number)
}
