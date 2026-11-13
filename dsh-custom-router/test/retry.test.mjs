/**
 * Retry arithmetic and the abortable sleep: delay growth and cap, no sleep on
 * success, abort wins over the timer, status gating, and the measured defaults.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  backoffDelay,
  DEFAULT_BASE_MS,
  DEFAULT_RETRIES,
  DEFAULT_RETRY_STATUSES,
  isAbortError,
  isRetryableError,
  isRetryableStatus,
  RETRYABLE_STATUSES,
  sleepFor,
  statusOf,
  withRetry,
} from '../lib/retry.js'

/** Error carrying a status, the shape a provider adapter throws. */
function httpError(status, message = `HTTP ${status}`) {
  const error = new Error(message)
  error.status = status
  return error
}

test('backoff grows by powers of two from the base', () => {
  assert.equal(backoffDelay(0, 1000, 30_000), 1000)
  assert.equal(backoffDelay(1, 1000, 30_000), 2000)
  assert.equal(backoffDelay(2, 1000, 30_000), 4000)
  assert.equal(backoffDelay(3, 1000, 30_000), 8000)
  assert.equal(backoffDelay(0, 250, 30_000), 250)
  assert.equal(backoffDelay(2, 250, 30_000), 1000)
})

test('backoff clamps at the cap and never exceeds it', () => {
  assert.equal(backoffDelay(5, 1000, 8000), 8000)
  assert.equal(backoffDelay(20, 1000, 8000), 8000)
  assert.equal(backoffDelay(3, 1000, 1000), 1000)
  // No cap configured: the raw step is returned.
  assert.equal(backoffDelay(4, 100, 0), 1600)
})

test('an unusable base yields zero, an unusable attempt yields the base', () => {
  assert.equal(backoffDelay(0, 0, 1000), 0)
  assert.equal(backoffDelay(0, -5, 1000), 0)
  assert.equal(backoffDelay(0, 'nope', 1000), 0)
  assert.equal(backoffDelay(-3, 1000, 1000), 1000)
  assert.equal(backoffDelay(1.9, 1000, 1000), 1000)
})

test('the measured retry set and defaults are preserved', () => {
  assert.deepEqual([...DEFAULT_RETRY_STATUSES], [429, 451, 500, 502, 503, 504])
  assert.equal(DEFAULT_RETRIES, 3)
  assert.equal(DEFAULT_BASE_MS, 1000)
  for (const status of [429, 451, 500, 502, 503, 504]) assert.equal(isRetryableStatus(status), true)
  for (const status of [400, 401, 403, 404, 409, 422]) assert.equal(isRetryableStatus(status), false)
  assert.equal(isRetryableStatus('429'), true)
  assert.equal(isRetryableStatus(undefined), false)
  assert.equal(isRetryableStatus(429, new Set([500])), false)
  assert.equal(isRetryableStatus(500, [500, 503]), true)
  assert.equal(RETRYABLE_STATUSES.has(451), true)
})

test('status is read from every error shape the routes throw', () => {
  assert.equal(statusOf(httpError(429)), 429)
  assert.equal(statusOf({ statusCode: 503 }), 503)
  assert.equal(statusOf({ response: { status: 502 } }), 502)
  assert.equal(statusOf(new Error('transport')), undefined)
  assert.equal(statusOf(undefined), undefined)
  assert.equal(isRetryableError(httpError(429)), true)
  assert.equal(isRetryableError(new Error('transport')), false)
  assert.equal(isRetryableError({ response: { status: 500 } }), true)
})

test('abortError is recognised by name and by code', () => {
  const error = new Error('cancelled')
  error.name = 'AbortError'
  assert.equal(isAbortError(error), true)
  assert.equal(isAbortError({ code: 'ABORT_ERR' }), true)
  assert.equal(isAbortError(new Error('nope')), false)
})

test('sleepFor resolves true on elapse and false on abort', async () => {
  const started = Date.now()
  assert.equal(await sleepFor(5), true)
  assert.ok(Date.now() - started >= 4)

  const controller = new AbortController()
  const pending = sleepFor(60_000, controller.signal)
  controller.abort()
  assert.equal(await pending, false)

  // An already-aborted signal does not wait, and a zero delay never waits.
  assert.equal(await sleepFor(10, controller.signal), false)
  assert.equal(await sleepFor(0), true)
})

test('withRetry does not sleep on success', async () => {
  const attempts = []
  const retriesSeen = []
  const result = await withRetry(async (attempt) => {
    attempts.push(attempt)
    return 'ok'
  }, { retries: 3, baseMs: 1000, capMs: 1000, onRetry: (info) => retriesSeen.push(info.delay) })
  assert.equal(result, 'ok')
  assert.deepEqual(attempts, [0])
  assert.deepEqual(retriesSeen, [])
})

test('withRetry retries a retryable status with growing capped delays', async () => {
  const delays = []
  let calls = 0
  assert.equal(
    await withRetry(
      async (attempt) => {
        calls += 1
        if (attempt < 2) throw httpError(503)
        return attempt
      },
      { retries: 3, baseMs: 1, capMs: 4, onRetry: ({ delay }) => delays.push(delay) },
    ),
    2,
  )
  assert.equal(calls, 3)
  assert.deepEqual(delays, [1, 2])
})

test('withRetry rethrows the last error once retries are exhausted', async () => {
  let calls = 0
  await assert.rejects(
    () =>
      withRetry(
        async () => {
          calls += 1
          throw httpError(429, 'rate limited')
        },
        { retries: 2, baseMs: 1, capMs: 1 },
      ),
    { message: 'rate limited' },
  )
  assert.equal(calls, 3)
})

test('withRetry does not retry an unlisted status or a transport throw', async () => {
  let authCalls = 0
  await assert.rejects(
    () =>
      withRetry(async () => {
        authCalls += 1
        throw httpError(401)
      }, { retries: 3, baseMs: 1 }),
    { status: 401 },
  )
  assert.equal(authCalls, 1)

  let transportCalls = 0
  await assert.rejects(
    () =>
      withRetry(async () => {
        transportCalls += 1
        throw new TypeError('socket hang up')
      }, { retries: 3, baseMs: 1 }),
    { message: 'socket hang up' },
  )
  assert.equal(transportCalls, 1)

  // A custom status set replaces the default one.
  let customCalls = 0
  await assert.rejects(
    () =>
      withRetry(async () => {
        customCalls += 1
        throw httpError(500)
      }, { retries: 2, baseMs: 1, retryStatuses: [418] }),
    { status: 500 },
  )
  assert.equal(customCalls, 1)
})

test('withRetry stops at an aborted signal, before and during a backoff', async () => {
  const before = new AbortController()
  before.abort()
  await assert.rejects(
    () => withRetry(async () => 'never', { retries: 3, signal: before.signal }),
    (error) => isAbortError(error),
  )

  const during = new AbortController()
  let calls = 0
  const pending = withRetry(
    async () => {
      calls += 1
      throw httpError(503)
    },
    {
      retries: 5,
      baseMs: 60_000,
      capMs: 60_000,
      signal: during.signal,
      onRetry: () => setImmediate(() => during.abort()),
    },
  )
  await assert.rejects(() => pending, (error) => isAbortError(error))
  assert.equal(calls, 1)
})

test('withRetry surfaces the provider error and lets shouldRetry override', async () => {
  let calls = 0
  const result = await withRetry(
    async () => {
      calls += 1
      throw new Error('flaky transport')
    },
    {
      retries: 2,
      baseMs: 1,
      capMs: 1,
      shouldRetry: (error) => /flaky/.test(error.message),
    },
  ).catch((error) => error.message)
  assert.equal(result, 'flaky transport')
  assert.equal(calls, 3)

  await assert.rejects(() => withRetry(null), TypeError)
})
