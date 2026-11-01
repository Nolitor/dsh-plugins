import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * Regression: the watchdog must not treat its own injected notice as progress.
 *
 * Measured defect (2026-11-02): the warning was delivered through `noticeUser()` ->
 * `agent.inject()`, which is SYNCHRONOUS (send -> inbox.splice -> session.append), so the
 * notice came straight back into `onEvent` as an `agent/inbox/spliced` event and reset the
 * budget that was about to expire. The watchdog therefore warned forever: the live corpus
 * holds 24 injected notices and the journal 0 `action=interrupted` lines since the
 * regression (commit 3254ebf, 2026-11-01 09:09 KST, which swapped notice() for noticeUser()).
 *
 * The first fix guarded `event.data.source`, which is the `user/message` shape only. The
 * splice shape keeps its sources in `data.inserted[]`, so that guard missed the actual vector
 * (measured: 4 warnings, 0 cancels). `isOwnNotice` inspects both shapes.
 */
import { isOwnNotice, MESSAGE_SOURCE } from '../lib/index.js'

const OWN = MESSAGE_SOURCE.kind

test('a spliced notice from this plugin is not progress', () => {
  // The real shape emitted by agent.inject(): source lives per inserted message.
  const event = {
    type: 'agent/inbox/spliced',
    data: { target: 'next-step', start: 0, inserted: [{ source: { kind: OWN }, role: 'user' }] },
  }
  assert.equal(event.data.source, undefined, 'the splice event has no top-level source')
  assert.equal(isOwnNotice(event), true)
})

test('a spliced message from a person is still progress', () => {
  const event = {
    type: 'agent/inbox/spliced',
    data: { inserted: [{ source: { kind: 'user' }, role: 'user' }] },
  }
  assert.equal(isOwnNotice(event), false)
})

test('a mixed splice counts as activity', () => {
  const event = {
    type: 'agent/inbox/spliced',
    data: { inserted: [{ source: { kind: OWN } }, { source: { kind: 'user' } }] },
  }
  assert.equal(isOwnNotice(event), false, 'a person is in there; do not swallow it')
})

test('the user/message shape is still recognised', () => {
  assert.equal(isOwnNotice({ type: 'user/message', data: { source: { kind: OWN } } }), true)
  assert.equal(isOwnNotice({ type: 'user/message', data: { source: { kind: 'user' } } }), false)
})

test('events without a source are not treated as our own', () => {
  assert.equal(isOwnNotice({ type: 'step/start', data: {} }), false)
  assert.equal(isOwnNotice({}), false)
  assert.equal(isOwnNotice(null), false)
})

test('both progress() call sites use the guard', () => {
  // A re-implementation can stay green while the shipped handler regresses
  // (failure-ledger F-24: a metric that only describes itself).
  //
  // Note the function name: the progress() calls live in `observeMemory`, which `onEvent`
  // delegates to. Slicing on `onEvent` silently captures the wrong body and the test passes
  // for the wrong reason — so this pins the function that actually holds the calls.
  const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  const fnStart = source.indexOf('function observeMemory(')
  assert.ok(fnStart > 0, 'observeMemory exists')
  const tail = source.slice(fnStart)
  const endAt = tail.indexOf('\n\n  /**')
  assert.ok(endAt > 0, 'function body boundary found')
  const body = tail.slice(0, endAt)
  const guarded = body.match(/if \(!isOwnNotice\(event\)\) state\.watchdog\.progress\(\)/g) ?? []
  const bare = body.match(/^\s*state\.watchdog\.progress\(\)\s*$/gm) ?? []
  assert.equal(guarded.length, 2, 'both call sites guarded; found ' + String(guarded.length))
  assert.equal(bare.length, 0, 'no unguarded progress() left; found ' + String(bare.length))
})
