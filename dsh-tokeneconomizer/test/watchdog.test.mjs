/**
 * The loop breaker and the thinking watchdog.
 *
 * The breaker is pure bookkeeping over the last calls; the watchdog is a timer that reports
 * when a session stops making progress. Both run in memory only.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  canonicalArguments,
  createLoopBreaker,
  createWatchdog,
  errorSignature,
} from '../lib/watchdog.js'

/** One failing call of the `bash` tool. */
const CALL = { name: 'bash', arguments: { command: 'pytest -q' } }

/**
 * Wait for the given number of milliseconds.
 * @param {number} ms - the wait.
 * @returns {Promise<void>} resolves after the wait.
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('consecutive identical failures trip the breaker', () => {
  const breaker = createLoopBreaker({ threshold: 3, window: 5 })
  assert.equal(breaker.observe(CALL, false, 'boom'), undefined)
  assert.equal(breaker.observe(CALL, false, 'boom'), undefined)
  const trip = breaker.observe(CALL, false, 'boom')
  assert.ok(trip)
  assert.equal(trip.count, 3)
  assert.equal(trip.signature, errorSignature('boom'))
})

test('the same call with a different error does not trip the breaker', () => {
  const breaker = createLoopBreaker({ threshold: 3, window: 5 })
  breaker.observe(CALL, false, 'boom')
  breaker.observe(CALL, false, 'boom')
  assert.equal(breaker.observe(CALL, false, 'other boom'), undefined)
})

test('a successful call breaks the chain', () => {
  const breaker = createLoopBreaker({ threshold: 3, window: 5 })
  breaker.observe(CALL, false, 'boom')
  breaker.observe(CALL, false, 'boom')
  breaker.observe(CALL, true, '')
  assert.equal(breaker.observe(CALL, false, 'boom'), undefined)
})

test('a different call breaks the chain', () => {
  const breaker = createLoopBreaker({ threshold: 3, window: 5 })
  breaker.observe(CALL, false, 'boom')
  breaker.observe(CALL, false, 'boom')
  const other = { name: 'bash', arguments: { command: 'pytest -x' } }
  assert.equal(breaker.observe(other, false, 'boom'), undefined)
})

test('arguments that differ only in key order are one call', () => {
  assert.equal(canonicalArguments({ a: 1, b: 2 }), canonicalArguments({ b: 2, a: 1 }))
  assert.notEqual(canonicalArguments({ a: 1 }), canonicalArguments({ a: 2 }))
})

test('the breaker remembers only the configured number of calls', () => {
  const breaker = createLoopBreaker({ threshold: 3, window: 5 })
  for (let index = 0; index < 20; index += 1) {
    breaker.observe({ name: 'bash', arguments: { command: `run ${index}` } }, true, '')
  }
  assert.equal(breaker.size, 5)
})

test('resetting the breaker forgets the chain', () => {
  const breaker = createLoopBreaker({ threshold: 3, window: 5 })
  breaker.observe(CALL, false, 'boom')
  breaker.observe(CALL, false, 'boom')
  breaker.reset()
  assert.equal(breaker.size, 0)
  assert.equal(breaker.observe(CALL, false, 'boom'), undefined)
})

test('two runs of the same failing command share an error signature', () => {
  const first = errorSignature('Error: line 12: /tmp/run/ab12cd34ef failed')
  const second = errorSignature('Error: line 99: /tmp/run/ff99aa88bb failed')
  assert.equal(first, second)
  assert.notEqual(first, errorSignature('Error: command not found'))
})

test('the watchdog reports a step without progress', async () => {
  let fired = 0
  const watchdog = createWatchdog({ thresholdMs: 20, onTimeout: () => { fired += 1 } })
  watchdog.arm()
  await wait(80)
  assert.equal(fired, 1)
  watchdog.disarm()
})

test('progress restarts the budget', async () => {
  let fired = 0
  const watchdog = createWatchdog({ thresholdMs: 60, onTimeout: () => { fired += 1 } })
  watchdog.arm()
  for (let index = 0; index < 4; index += 1) {
    await wait(20)
    watchdog.progress()
  }
  assert.equal(fired, 0)
  watchdog.disarm()
})

test('disarming stops the watchdog', async () => {
  let fired = 0
  const watchdog = createWatchdog({ thresholdMs: 20, onTimeout: () => { fired += 1 } })
  watchdog.arm()
  watchdog.disarm()
  await wait(60)
  assert.equal(fired, 0)
  assert.equal(watchdog.armed, false)
})

test('progress outside an armed budget starts no timer', async () => {
  let fired = 0
  const watchdog = createWatchdog({ thresholdMs: 20, onTimeout: () => { fired += 1 } })
  watchdog.progress()
  await wait(60)
  assert.equal(fired, 0)
  assert.equal(watchdog.armed, false)
})
