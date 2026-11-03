/**
 * The cost figure must describe the session on screen.
 *
 * Measured 2026-11-04, a real defect the owner reported as "요금이 또 리셋되었고":
 * the ledger held `session-c67cb8aa` (4,904 events — the live conversation) while
 * the DOM attribute reported `session-eaa3d2b7` (6 events — an empty shell). An
 * exact-only match found nothing and the chip read "무료" next to a real balance.
 *
 * The rule pinned here: an exact id wins, and otherwise the MOST RECENTLY ACTIVE
 * session is the one being displayed — never a silent zero.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { pickSession } from '../lib/cost.js'

const LEDGER = {
  bySession: [
    { sessionId: 'session-aaa', requests: 2, allowanceUsd: 0.01, lastAt: 1000 },
    { sessionId: 'session-bbb', requests: 9, allowanceUsd: 0.42, lastAt: 5000 },
  ],
}

test('an exact id is used even when another session was more recent', () => {
  assert.equal(pickSession(LEDGER, 'session-aaa').sessionId, 'session-aaa')
})

test('the bare uuid also matches the prefixed id', () => {
  assert.equal(pickSession(LEDGER, 'aaa').sessionId, 'session-aaa')
  assert.equal(pickSession(LEDGER, 'session-bbb').sessionId, 'session-bbb')
})

test('an unknown id falls back to the session that spent most recently', () => {
  // The measured case: the DOM id belonged to a session with no spend at all.
  const picked = pickSession(LEDGER, 'session-eaa3d2b7-dead-beef-0000-000000000000')
  assert.equal(picked.sessionId, 'session-bbb', 'the live conversation, not a zero')
})

test('no id at all still reports the live total', () => {
  assert.equal(pickSession(LEDGER, '').sessionId, 'session-bbb')
  assert.equal(pickSession(LEDGER, null).sessionId, 'session-bbb')
})

test('an empty ledger reports nothing rather than inventing an entry', () => {
  assert.equal(pickSession({ bySession: [] }, 'session-aaa'), null)
  assert.equal(pickSession({}, 'session-aaa'), null)
  assert.equal(pickSession(null, 'session-aaa'), null)
})
