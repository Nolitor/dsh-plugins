/**
 * Tier-decision records: the grading is described in the log, whether or not
 * the surface write that follows it is accepted.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { appendRecord, RECORD_NAMES, recordsOfType, validateRecord } from '../lib/attribution.js'
import {
  buildTierDecision,
  emitTierDecision,
  policyHash,
  tierContent,
  TIER_COLD,
  TIER_DEFAULTS,
  TIER_WARM,
} from '../lib/tiering.js'

const policy = { ...TIER_DEFAULTS }

/**
 * A minimal session: it records what it was asked to commit, in log order, so a
 * test can read the log back through the real reader rather than a stub.
 */
function fakeSession () {
  const events = []
  let seq = 0
  return {
    events,
    appendPluginRecord (type, data) {
      seq += 1
      events.push({ type, data, seq, time: seq, ignorable: true })
      return seq
    },
  }
}

test('decision record exists even when rewrite validation fails', () => {
  const session = fakeSession()
  const decision = buildTierDecision({
    seq: 42, tier: TIER_COLD, turn: 3, step: 1, policy, reason: 'turn age past the warm window',
  })

  const emitted = emitTierDecision(session, decision)
  assert.equal(emitted.ok, true)
  assert.equal(session.events.length, 1)

  // The later surface write is rejected — too short to be worth a rewrite — and
  // that outcome must not touch the record already committed.
  const rejected = tierContent({
    text: 'short output',
    kind: 'log',
    tier: TIER_COLD,
    turn: 3,
    step: 1,
    name: 'run',
    policy,
  })
  assert.equal(rejected, undefined)

  const records = recordsOfType(session.events, RECORD_NAMES.TIER_DECISION)
  assert.equal(records.length, 1)
  assert.deepEqual(records[0].data, decision)
  assert.deepEqual(validateRecord(RECORD_NAMES.TIER_DECISION, records[0].data), { ok: true })
})

test('policyHash is stable for the same policy and differs for a changed policy', () => {
  const first = policyHash({ ...TIER_DEFAULTS })
  const second = policyHash({ ...TIER_DEFAULTS })
  assert.equal(first, second)

  // Key order is not part of a policy's identity.
  assert.equal(policyHash({ hotTurns: 6, warmTurns: 15 }), policyHash({ warmTurns: 15, hotTurns: 6 }))

  const changed = policyHash({ ...TIER_DEFAULTS, warmTurns: TIER_DEFAULTS.warmTurns + 1 })
  assert.notEqual(first, changed)

  // The hash carries into the payload, so two decisions differ only by policy.
  const base = { seq: 7, tier: TIER_WARM, turn: 4, step: 2, reason: 'within the warm window' }
  assert.notEqual(
    buildTierDecision({ ...base, policy }).policyHash,
    buildTierDecision({ ...base, policy: { ...policy, headChars: policy.headChars + 1 } }).policyHash,
  )
})

test('buildTierDecision is pure (same input, same output, no mutation)', () => {
  const input = Object.freeze({
    seq: 9, tier: TIER_WARM, turn: 5, step: 0, policy: Object.freeze({ ...TIER_DEFAULTS }),
    reason: 'middle turns are summarized',
  })
  const before = JSON.stringify(input)

  const once = buildTierDecision(input)
  const twice = buildTierDecision(input)

  assert.deepEqual(once, twice)
  assert.notEqual(once, twice, 'a fresh object per call, not a shared reference')
  assert.equal(JSON.stringify(input), before, 'the input is not mutated')
  assert.equal(once.nodeSeq, 9)
  assert.equal(once.tier, TIER_WARM)
  assert.equal(once.reason, input.reason)
  assert.match(once.policyHash, /^[0-9a-f]{40}$/)
})

test('emitTierDecision returns ok:false and does not throw when no appendPluginRecord is available', () => {
  const decision = buildTierDecision({
    seq: 1, tier: TIER_COLD, turn: 9, step: 2, policy, reason: 'evicted',
  })

  for (const session of [null, undefined, {}]) {
    let result
    assert.doesNotThrow(() => {
      result = emitTierDecision(session, decision)
    })
    assert.equal(result.ok, false)
    assert.equal(result.reason, 'no appendPluginRecord')
  }

  // An injected appender is used in place of the session's, as `appendRecord` documents.
  const injected = []
  const result = emitTierDecision(null, decision, {
    appendPluginRecord: (s, type, data) => {
      injected.push({ type, data })
      return 0
    },
  })
  assert.equal(result.ok, true)
  assert.equal(injected.length, 1)
  assert.equal(injected[0].type, RECORD_NAMES.TIER_DECISION)

  // A throwing appender is reported, not propagated.
  let thrown
  assert.doesNotThrow(() => {
    thrown = emitTierDecision(null, decision, {
      appendPluginRecord: () => {
        throw new Error('log is read-only')
      },
    })
  })
  assert.equal(thrown.ok, false)
  assert.equal(thrown.reason, 'log is read-only')

  // A malformed payload is rejected by the shared validator, still without throwing.
  const invalid = emitTierDecision(fakeSession(), { nodeSeq: 1 })
  assert.equal(invalid.ok, false)
  assert.equal(appendRecord(null, RECORD_NAMES.TIER_DECISION, { nodeSeq: 1 }).ok, false)
})
