/**
 * The provenance records that tell this plugin's surface rewrites apart from the
 * harness's own, and the failure ordering between a rewrite and its record.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  ALL_RECORD_NAMES,
  appendRecord,
  isRecordType,
  readRecords,
  RECORD_NAMES,
  recordsOfType,
  validateRecord,
} from '../lib/attribution.js'

/**
 * A log-backed fake session that mimics the harness Session surface this plugin
 * touches: `append` for real events, and an optional `appendPluginRecord` that
 * the test can make throw.
 * @param {{ recordThrows?: boolean }} [options] - failure injection.
 * @returns {object} the fake session plus its committed events.
 */
function fakeSession (options = {}) {
  const events = []
  const session = {
    events,
    append (type, data, opts) {
      const seq = events.length + 1
      events.push({ type, data, seq, time: 1_700_000_000_000, ...opts })
      return seq
    },
    appendPluginRecord (type, data) {
      if (options.recordThrows) throw new Error('store refused the record')
      const seq = events.length + 1
      events.push({ type, data, seq, time: 1_700_000_000_000, ignorable: true })
      return seq
    },
  }
  return session
}

const REWRITE = {
  nodeSeq: 7,
  tier: 'cold',
  charsBefore: 900,
  charsAfter: 120,
  shadowTokens: 220,
  reason: 'turn-outside-warm-window',
}

/**
 * Mirror the plugin's write order exactly: the surface replacement commits
 * first, then its record. This helper is what the ordering test exercises.
 * @param {object} session - the target session.
 * @param {object} record - the record to append after the replacement.
 * @returns {{ replacementSeq: number, record: object }} both results.
 */
function applyRewrite (session, record) {
  const replacementSeq = session.append('tool/result', { message: { content: [] } }, {
    surfaceOp: { op: 'replace', startSeq: REWRITE.nodeSeq, endSeq: REWRITE.nodeSeq },
    sourceEventSeqs: [REWRITE.nodeSeq],
  })
  const result = appendRecord(session, record.type, record.data)
  return { replacementSeq, record: result }
}

test('record append failure does not corrupt the replacement event', () => {
  const session = fakeSession({ recordThrows: true })
  const outcome = applyRewrite(session, { type: RECORD_NAMES.SURFACE_REWRITE, data: REWRITE })

  const replacement = session.events.find((event) => event.surfaceOp?.op === 'replace')
  assert.ok(replacement, 'the replacement event is committed')
  assert.deepEqual(replacement.surfaceOp, { op: 'replace', startSeq: 7, endSeq: 7 })
  assert.equal(outcome.replacementSeq, replacement.seq)

  assert.equal(outcome.record.ok, false)
  assert.match(outcome.record.warning, /surface write kept/)
  assert.equal(session.events.filter((event) => event.ignorable === true).length, 0)
})

test('a replacement failure leaves no record claiming success', () => {
  const session = fakeSession()
  session.append = () => {
    throw new Error('surface write refused')
  }
  let outcome
  assert.throws(() => {
    outcome = applyRewrite(session, { type: RECORD_NAMES.SURFACE_REWRITE, data: REWRITE })
  }, /surface write refused/)
  assert.equal(outcome, undefined)
  assert.equal(readRecords(session.events).length, 0)
})

test('owner validation rejects a malformed record', () => {
  const restored = {
    nodeSeq: '7',
    tier: 'lukewarm',
    charsBefore: 900,
    charsAfter: 120,
    shadowTokens: 220,
    reason: 'turn-outside-warm-window',
  }
  const result = validateRecord(RECORD_NAMES.SURFACE_REWRITE, restored)
  assert.equal(result.ok, false)
  assert.match(result.reason, /nodeSeq/)

  assert.deepEqual(validateRecord(RECORD_NAMES.SURFACE_REWRITE, REWRITE), { ok: true })
  assert.equal(validateRecord(RECORD_NAMES.SURFACE_REWRITE, null).ok, false)
  assert.equal(validateRecord('plugin:other/thing', REWRITE).ok, false)
  assert.equal(validateRecord(RECORD_NAMES.TOOLPRUNE_APPLIED, {
    tools: 'ripgrep',
    countBefore: 12,
    countAfter: 9,
    visibleIntersection: ['ripgrep'],
    repoKey: 'repo-1',
    time: 1,
  }).ok, false)
})

test('appendRecord returns ok:false when no appendPluginRecord exists', () => {
  const result = appendRecord({ events: [] }, RECORD_NAMES.SURFACE_REWRITE, REWRITE)
  assert.deepEqual(result, { ok: false, reason: 'no appendPluginRecord' })

  const injected = []
  const viaOption = appendRecord(null, RECORD_NAMES.SURFACE_REWRITE, REWRITE, {
    appendPluginRecord: (session, type, data) => {
      injected.push({ session, type, data })
      return 42
    },
  })
  assert.deepEqual(viaOption, { ok: true, seq: 42 })
  assert.equal(injected.length, 1)
})

test('recordsOfType filters by type', () => {
  const session = fakeSession()
  session.appendPluginRecord(RECORD_NAMES.SURFACE_REWRITE, REWRITE)
  session.appendPluginRecord(RECORD_NAMES.TIER_DECISION, {
    nodeSeq: 7,
    tier: 'cold',
    turn: 3,
    step: 2,
    policyHash: 'abc123',
    reason: 'below-warm-window',
  })
  session.appendPluginRecord(RECORD_NAMES.SURFACE_REWRITE, { ...REWRITE, nodeSeq: 8 })
  session.append('tool/result', { message: {} })

  assert.equal(readRecords(session.events).length, 3)
  const rewrites = recordsOfType(session.events, RECORD_NAMES.SURFACE_REWRITE)
  assert.equal(rewrites.length, 2)
  assert.deepEqual(rewrites.map((record) => record.data.nodeSeq), [7, 8])
  assert.equal(recordsOfType(session.events, RECORD_NAMES.TOOLPRUNE_APPLIED).length, 0)
  assert.equal(recordsOfType(session.events, RECORD_NAMES.TIER_DECISION).length, 1)
})

test('record names satisfy the plugin: grammar', () => {
  assert.equal(ALL_RECORD_NAMES.length, 3)
  for (const name of ALL_RECORD_NAMES) {
    assert.equal(isRecordType(name), true, `${name} follows the record grammar`)
    assert.match(name, /^plugin:tokeneconomizer\//)
  }
  assert.equal(RECORD_NAMES.TOOLPRUNE_APPLIED, 'plugin:tokeneconomizer/toolprune-applied')
  assert.equal(isRecordType('plugin:tokeneconomizer/ToolPrune'), false)
  assert.equal(isRecordType('plugin:'), false)
  assert.equal(isRecordType('plugin:tokeneconomizer/'), false)
  assert.equal(isRecordType('compaction/prune'), false)
})
