/**
 * The paired surface write: a rewrite is only trustworthy when its records exist
 * and its records only exist for writes that really landed. These tests drive the
 * real write order (`applyRewrite`) against a faithful fake session whose surface
 * is folded from its own log, exactly as the harness folds one.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { RECORD_NAMES, readRecords, recordsOfType } from '../lib/attribution.js'
import {
  applyRewrite,
} from '../lib/surface-attribution.js'
import {
  buildPrunePayload,
  buildReplacement,
  validateRewriteTarget,
} from '../lib/rewriter.js'

/** Event types that join the model-visible surface. */
const SURFACE_TYPES = new Set(['system/message', 'user/message', 'assistant/message', 'tool/result'])

/**
 * Fold a log into its current surface sequence numbers, applying replacements.
 * Mirrors the harness fold: a replacement splices its inclusive range and
 * shadowed events stay in the log.
 * @param {Array<{ type: string, seq: number, ignorable?: boolean, options?: any }>} log
 * @returns {number[]} current nodes in model-visible order.
 */
function foldNodes (log) {
  const nodes = []
  for (const entry of log) {
    if (entry.ignorable) continue
    if (!SURFACE_TYPES.has(entry.type)) continue
    const op = entry.options && entry.options.surfaceOp
    if (!op) continue
    if (op === 'append') {
      nodes.push(entry.seq)
      continue
    }
    const startIdx = nodes.indexOf(op.startSeq)
    const endIdx = nodes.indexOf(op.endSeq)
    if (startIdx === -1 || endIdx === -1) throw new Error(`surface replace: range not current at seq ${entry.seq}`)
    nodes.splice(startIdx, endIdx - startIdx + 1, entry.seq)
  }
  return nodes
}

/**
 * A log-backed fake session: `append` commits surface events, `appendPluginRecord`
 * commits ignorable records, and `surface.nodes` is folded from the log.
 * @param {object[]} log - the shared log array; each append pushes `{ type, data, options, seq }`.
 * @param {{ recordThrows?: boolean }} [options] - failure injection.
 * @returns {object} the fake session.
 */
function fakeSession (log, options = {}) {
  return {
    log,
    append (type, data, appendOptions) {
      const entry = { type, data, options: appendOptions, seq: log.length }
      log.push(entry)
      return entry
    },
    appendPluginRecord (type, data) {
      if (options.recordThrows) throw new Error('store refused the record')
      const entry = { type, data, options: undefined, seq: log.length, ignorable: true }
      log.push(entry)
      return entry.seq
    },
    surface: {
      get nodes () {
        return foldNodes(log)
      },
    },
  }
}

/**
 * Seed one current `tool/result` node plus a non-result node.
 * @param {object[]} log - the log to seed into.
 * @returns {{ resultSeq: number, userSeq: number }} the seeded seqs.
 */
function seedLog (log) {
  log.push({
    type: 'user/message',
    data: { message: { role: 'user', content: [{ type: 'text', text: 'run it' }] } },
    options: { surfaceOp: 'append' },
    seq: log.length,
  })
  const userSeq = log.length - 1
  log.push({
    type: 'tool/result',
    data: {
      turn: 3,
      step: 2,
      message: {
        role: 'user',
        source: { callId: 'call-1' },
        content: [{ type: 'text', text: 'x'.repeat(400) }],
      },
    },
    options: { surfaceOp: 'append' },
    seq: log.length,
  })
  return { resultSeq: log.length - 1, userSeq }
}

/** The meta every test passes. */
const META = { tier: 'cold', turn: 7, step: 3, policyHash: 'tp-3', reason: 'tier-cold', shadowTokens: 220 }

test('rewrite accepted ⇒ surface-rewrite record with matching startSeq/endSeq', () => {
  const log = []
  const session = fakeSession(log)
  const { resultSeq } = seedLog(log)

  const outcome = applyRewrite(session, resultSeq, '[tokeneconomizer] pruned', META, {
    event: log[resultSeq],
    onWarn: () => {},
  })
  assert.equal(outcome.ok, true)

  const replacement = log.find(entry => entry.type === 'tool/result' && entry.options?.surfaceOp?.op === 'replace')
  assert.ok(replacement, 'a replacement event landed')
  assert.equal(replacement.options.surfaceOp.startSeq, resultSeq)
  assert.equal(replacement.options.surfaceOp.endSeq, resultSeq)

  const records = recordsOfType(log, RECORD_NAMES.SURFACE_REWRITE)
  assert.equal(records.length, 1)
  assert.equal(records[0].data.nodeSeq, replacement.options.surfaceOp.startSeq)
  assert.equal(records[0].data.nodeSeq, resultSeq)
  assert.equal(outcome.recordSeq, records[0].seq)
  assert.equal(outcome.resultSeq, replacement.seq)

  // The decision record precedes the replacement; the rewrite record follows it.
  const decisions = recordsOfType(log, RECORD_NAMES.TIER_DECISION)
  assert.equal(decisions.length, 1)
  assert.ok(decisions[0].seq < replacement.seq)
  assert.ok(records[0].seq > replacement.seq)
})

test('rewrite rejected ⇒ decision record kept, no rewrite record', () => {
  const log = []
  const session = fakeSession(log)
  const { resultSeq } = seedLog(log)

  // Shadow the node with a replacement that is not yet applied: the seeded node
  // stops being current, so a rewrite targeting it must be rejected.
  log.push({
    type: 'tool/result',
    data: { turn: 3, step: 2, message: { role: 'user', content: [{ type: 'text', text: 'replaced' }] } },
    options: { surfaceOp: { op: 'replace', startSeq: resultSeq, endSeq: resultSeq }, sourceEventSeqs: [resultSeq] },
    seq: log.length,
  })
  const before = log.length

  const outcome = applyRewrite(session, resultSeq, '[tokeneconomizer] pruned', META, {
    event: log[resultSeq],
    onWarn: () => {},
  })
  assert.equal(outcome.ok, false)
  assert.equal(outcome.reason, 'seq-not-current')

  assert.equal(log.length, before + 1, 'only the decision record was appended')
  assert.equal(log[before].ignorable, true)

  assert.equal(recordsOfType(log, RECORD_NAMES.TIER_DECISION).length, 1)
  assert.equal(recordsOfType(log, RECORD_NAMES.SURFACE_REWRITE).length, 0)
  assert.equal(log.filter(entry => entry.type === 'compaction/prune').length, 0)
})

test('replacement changes only message.content', () => {
  const original = {
    type: 'tool/result',
    data: {
      turn: 9,
      step: 4,
      message: {
        role: 'user',
        source: { callId: 'call-9', toolName: 'shell' },
        isError: false,
        content: [{ type: 'text', text: 'the whole output' }],
      },
    },
  }

  const data = buildReplacement(original, 'shrunk')

  assert.deepEqual(data.message.content, [{ type: 'text', text: 'shrunk' }])
  // Every other field is preserved byte for byte.
  assert.equal(data.turn, 9)
  assert.equal(data.step, 4)
  assert.deepEqual(data.message.source, { callId: 'call-9', toolName: 'shell' })
  assert.equal(data.message.isError, false)
  assert.equal(data.message.role, 'user')
  // The input is untouched and the result is frozen.
  assert.deepEqual(original.data.message.content, [{ type: 'text', text: 'the whole output' }])
  assert.equal(Object.isFrozen(data), true)
  assert.equal(Object.isFrozen(data.message), true)
  assert.equal(Object.isFrozen(data.message.content), true)
})

test('prune payload carries the shadow fields, not surfaceOp', () => {
  const payload = buildPrunePayload(12, 220)

  assert.deepEqual(payload.shadowedRange, { start: 12, end: 12 })
  assert.deepEqual(payload.shadowedSeqs, [12])
  assert.equal(payload.shadowedTokenCount, 220)
  assert.equal(Object.hasOwn(payload, 'surfaceOp'), false)
  assert.equal(Object.isFrozen(payload), true)

  // The payload the write path actually commits carries the same shape.
  const log = []
  const session = fakeSession(log)
  const { resultSeq } = seedLog(log)
  applyRewrite(session, resultSeq, 'small', META, { event: log[resultSeq], onWarn: () => {} })

  const prune = log.find(entry => entry.type === 'compaction/prune')
  assert.ok(prune)
  assert.deepEqual(prune.data.shadowedRange, { start: resultSeq, end: resultSeq })
  assert.deepEqual(prune.data.shadowedSeqs, [resultSeq])
  assert.equal(prune.data.shadowedTokenCount, 220)
  assert.equal(Object.hasOwn(prune.data, 'surfaceOp'), false)
  assert.equal(prune.options, undefined, 'the prune event carries no surface intent')
})

test('rewrite record failure keeps the rewrite', () => {
  const log = []
  const session = fakeSession(log, { recordThrows: true })
  const { resultSeq } = seedLog(log)
  const warnings = []
  let failedRecords = 0
  // Fail only the rewrite record: the decision record succeeds, so the write
  // reaches step 5 with a committed replacement in front of it.
  session.appendPluginRecord = (type, data) => {
    if (type === RECORD_NAMES.SURFACE_REWRITE) {
      failedRecords += 1
      throw new Error('store refused the record')
    }
    const entry = { type, data, options: undefined, seq: log.length, ignorable: true }
    log.push(entry)
    return entry.seq
  }

  const outcome = applyRewrite(session, resultSeq, '[tokeneconomizer] pruned', META, {
    event: log[resultSeq],
    onWarn: (message) => warnings.push(message),
  })

  assert.equal(outcome.ok, true, 'the committed rewrite stands')
  assert.equal(typeof outcome.warning, 'string')
  assert.match(outcome.warning, /rewrite committed without its record/)
  assert.equal(failedRecords, 1)
  assert.equal(warnings.length, 0, 'only a decision-record loss warns')

  const replacement = log.find(entry => entry.type === 'tool/result' && entry.options?.surfaceOp?.op === 'replace')
  assert.ok(replacement, 'the surface replacement is durable')
  assert.equal(replacement.seq, outcome.resultSeq)
  assert.equal(recordsOfType(log, RECORD_NAMES.SURFACE_REWRITE).length, 0)
})

test('validateRewriteTarget rejects a non-tool/result node', () => {
  const log = []
  const session = fakeSession(log)
  const { userSeq, resultSeq } = seedLog(log)

  const rejected = validateRewriteTarget(session, userSeq, { event: log[userSeq] })
  assert.deepEqual(rejected, { ok: false, reason: 'not-tool-result' })

  const accepted = validateRewriteTarget(session, resultSeq, { event: log[resultSeq] })
  assert.equal(accepted.ok, true)
  assert.equal(accepted.event.type, 'tool/result')

  // Absent surface, non-integer seq and a missing event body are all failures,
  // never throws.
  assert.deepEqual(validateRewriteTarget({}, resultSeq), { ok: false, reason: 'surface-missing' })
  assert.deepEqual(validateRewriteTarget(session, 1.5), { ok: false, reason: 'seq-invalid' })
  assert.deepEqual(validateRewriteTarget(session, resultSeq), { ok: false, reason: 'event-unavailable' })
})

test('prune failure aborts before the replacement', () => {
  const log = []
  const session = fakeSession(log)
  const { resultSeq } = seedLog(log)
  const append = session.append.bind(session)
  let prunes = 0
  session.append = (type, data, opts) => {
    if (type === 'compaction/prune') {
      prunes += 1
      throw new Error('store rejected the prune payload')
    }
    return append(type, data, opts)
  }

  const outcome = applyRewrite(session, resultSeq, 'small', META, { event: log[resultSeq], onWarn: () => {} })

  assert.equal(outcome.ok, false)
  assert.match(outcome.reason, /^prune-append-failed:/)
  assert.equal(prunes, 1)
  assert.equal(log.filter(entry => entry.type === 'tool/result' && entry.options?.surfaceOp?.op === 'replace').length, 0)
  assert.equal(recordsOfType(log, RECORD_NAMES.SURFACE_REWRITE).length, 0)
  assert.equal(recordsOfType(log, RECORD_NAMES.TIER_DECISION).length, 1)
})

test('decision record failure warns once and still commits the rewrite', () => {
  const log = []
  const session = fakeSession(log, { recordThrows: true })
  const { resultSeq } = seedLog(log)
  const warnings = []

  const outcome = applyRewrite(session, resultSeq, 'small', META, {
    event: log[resultSeq],
    onWarn: (message) => warnings.push(message),
  })

  assert.equal(outcome.ok, true, 'a lost decision record does not block the saving')
  assert.equal(warnings.length, 1, 'warned once')
  assert.match(warnings[0], /tier decision record/)
  assert.equal(log.filter(entry => entry.type === 'compaction/prune').length, 1)
  assert.equal(log.filter(entry => entry.type === 'tool/result' && entry.options?.surfaceOp?.op === 'replace').length, 1)
})
