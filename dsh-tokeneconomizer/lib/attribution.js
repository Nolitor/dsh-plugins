/**
 * Provenance records: who rewrote which surface node, and why.
 *
 * The harness's own `dsh-compaction-tool-result-pruner` writes exactly the same
 * `compaction/prune` payload and the same `tool/result` replacement with
 * `surfaceOp: { op: 'replace', startSeq, endSeq }` that this plugin writes, and
 * `compaction/prune` carries no producer field. On the log alone the two are
 * indistinguishable, so a measurement once credited the harness's 179 rewrites
 * to this plugin. The fix is a side channel: every write this plugin performs is
 * accompanied by a DSH-native plugin record under the `plugin:tokeneconomizer/`
 * namespace. A record is `ignorable`, never enters the model-visible surface
 * (so it costs no tokens), and survives fork and resume with the rest of the
 * log.
 *
 * ## Ordering, which is the whole failure policy
 *
 * The surface replacement commits first; the record is appended after it, and
 * only to describe a write that already succeeded. Consequences, both intended:
 *
 *   1. A record failure never corrupts or undoes the replacement. It also never
 *      retries the replacement: a lost record is a missing attribution, not a
 *      reason to write the surface twice. The failure is reported back to the
 *      caller as `warning` once, and this module prints nothing itself.
 *   2. A replacement failure returns before any record is appended, so a record
 *      can never claim a write that did not happen. A resumed log therefore has
 *      records only for writes that really landed.
 *
 * Records are cheap but not free, and they are advisory evidence: a missing one
 * weakens attribution, never correctness. Every path in this module is fail-open.
 *
 * ## Zero runtime imports
 *
 * This package has zero runtime imports outside `node:` builtins by design, so
 * nothing here imports `@deepseek-ai/dsh-session`. The record machinery is
 * injected: `options.appendPluginRecord` for tests, else `session.appendPluginRecord`
 * when the harness Session object provides one. With neither, the call reports
 * `ok: false` and warns; it never throws.
 */

/**
 * The record names this plugin writes. These are fixed identifiers, not labels:
 * renaming one is a migration of committed logs, and readers of old logs resolve
 * names by exact match.
 */
export const RECORD_NAMES = Object.freeze({
  SURFACE_REWRITE: 'plugin:tokeneconomizer/surface-rewrite',
  TIER_DECISION: 'plugin:tokeneconomizer/tier-decision',
  TOOLPRUNE_APPLIED: 'plugin:tokeneconomizer/toolprune-applied',
})

/** Every declared record name, for grammar and reader tests. */
export const ALL_RECORD_NAMES = Object.freeze(Object.values(RECORD_NAMES))

/**
 * The harness grammar for a plugin record type: `plugin:` then slash-separated
 * segments of lowercase letters, digits, `.`, `_` and `-`, each segment starting
 * with a letter or digit.
 */
const RECORD_TYPE_PATTERN = /^plugin:[a-z0-9][a-z0-9._-]*(?:\/[a-z0-9][a-z0-9._-]*)*$/

/**
 * Report whether a string is a legal plugin record type.
 * @param {unknown} type - candidate name.
 * @returns {boolean} true when the harness would accept it.
 */
export function isRecordType (type) {
  return typeof type === 'string' && RECORD_TYPE_PATTERN.test(type)
}

/** True for a plain object (not null, not an array). */
function isPlainObject (value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** True for a finite number. */
function isFiniteNumber (value) {
  return typeof value === 'number' && Number.isFinite(value)
}

/** True for a non-empty string. */
function isNonEmptyString (value) {
  return typeof value === 'string' && value.length > 0
}

/** True for an array of non-empty strings. */
function isStringArray (value) {
  return Array.isArray(value) && value.every(isNonEmptyString)
}

/** Reject a record with one reason, in the shape every validator returns. */
function reject (reason) {
  return { ok: false, reason }
}

const VALID_TIERS = new Set(['warm', 'cold'])
const VALID_DECISION_TIERS = new Set(['hot', 'warm', 'cold'])

/**
 * Validate one record payload against the shape this build writes.
 *
 * A restored record carries whatever JSON an earlier build committed, so a
 * caller must not trust `data` just because the record type is recognized.
 * This checks shape and field types only, never meaning, and it never throws.
 * @param {string} type - record name, from {@link RECORD_NAMES}.
 * @param {unknown} data - the record's committed payload.
 * @returns {{ ok: boolean, reason?: string }} `{ ok: true }` when trustworthy.
 */
export function validateRecord (type, data) {
  if (!isRecordType(type)) return reject(`unknown record type: ${String(type)}`)
  if (!isPlainObject(data)) return reject('payload is not an object')
  switch (type) {
    case RECORD_NAMES.SURFACE_REWRITE: {
      if (!isFiniteNumber(data.nodeSeq)) return reject('nodeSeq is not a finite number')
      if (!VALID_TIERS.has(data.tier)) return reject(`tier is not warm|cold: ${String(data.tier)}`)
      if (!isFiniteNumber(data.charsBefore)) return reject('charsBefore is not a finite number')
      if (!isFiniteNumber(data.charsAfter)) return reject('charsAfter is not a finite number')
      if (!isFiniteNumber(data.shadowTokens)) return reject('shadowTokens is not a finite number')
      if (!isNonEmptyString(data.reason)) return reject('reason is not a non-empty string')
      if (data.pairedRewriteSeq !== undefined && !isFiniteNumber(data.pairedRewriteSeq)) {
        return reject('pairedRewriteSeq is not a finite number')
      }
      return { ok: true }
    }
    case RECORD_NAMES.TIER_DECISION: {
      if (!isFiniteNumber(data.nodeSeq)) return reject('nodeSeq is not a finite number')
      if (!VALID_DECISION_TIERS.has(data.tier)) {
        return reject(`tier is not hot|warm|cold: ${String(data.tier)}`)
      }
      if (!isFiniteNumber(data.turn)) return reject('turn is not a finite number')
      if (!isFiniteNumber(data.step)) return reject('step is not a finite number')
      if (!isNonEmptyString(data.policyHash)) return reject('policyHash is not a non-empty string')
      if (!isNonEmptyString(data.reason)) return reject('reason is not a non-empty string')
      return { ok: true }
    }
    case RECORD_NAMES.TOOLPRUNE_APPLIED: {
      if (!isStringArray(data.tools)) return reject('tools is not a string array')
      if (!isFiniteNumber(data.countBefore)) return reject('countBefore is not a finite number')
      if (!isFiniteNumber(data.countAfter)) return reject('countAfter is not a finite number')
      if (!isStringArray(data.visibleIntersection)) {
        return reject('visibleIntersection is not a string array')
      }
      if (!isNonEmptyString(data.repoKey)) return reject('repoKey is not a non-empty string')
      if (!isFiniteNumber(data.time)) return reject('time is not a finite number')
      if (data.proposalId !== undefined && !isNonEmptyString(data.proposalId)) {
        return reject('proposalId is not a non-empty string')
      }
      return { ok: true }
    }
    default:
      return reject(`unknown record type: ${type}`)
  }
}

/**
 * Append one provenance record for a write this plugin already committed.
 *
 * Call this **after** the surface write, never before it. Failure is reported,
 * not thrown: the caller keeps its replacement and loses only the attribution.
 * @param {object|null|undefined} session - object carrying `appendPluginRecord`,
 *   or any session when `options.appendPluginRecord` is supplied.
 * @param {string} type - one of {@link RECORD_NAMES}.
 * @param {unknown} data - the payload; validated locally before it is committed.
 * @param {{ appendPluginRecord?: Function }} [options] - injected appender.
 * @returns {{ ok: boolean, seq?: number, warning?: string, reason?: string }}
 *   `ok: true` with the committed `seq` when the record landed.
 */
export function appendRecord (session, type, data, options = {}) {
  if (!isRecordType(type)) {
    return { ok: false, reason: `invalid record type: ${String(type)}` }
  }
  const validated = validateRecord(type, data)
  if (!validated.ok) {
    return { ok: false, reason: `invalid payload: ${validated.reason}`, warning: 'record skipped' }
  }
  const injected = options?.appendPluginRecord
  const appender = typeof injected === 'function'
    ? injected
    : (typeof session?.appendPluginRecord === 'function' ? session.appendPluginRecord.bind(session) : null)
  if (!appender) return { ok: false, reason: 'no appendPluginRecord' }
  try {
    const seq = injected ? appender(session, type, data) : appender(type, data)
    return { ok: true, seq: isFiniteNumber(seq) ? seq : undefined }
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      warning: 'record append failed; surface write kept',
    }
  }
}

/**
 * Read every plugin record out of a log, mirroring the harness's own
 * `pluginRecordOf`: only an `ignorable` event whose type satisfies the record
 * grammar is a record; anything else is skipped.
 * @param {Iterable<{ type?: string, seq?: number, time?: number, data?: unknown, ignorable?: boolean }>} events
 *   committed session events, in log order.
 * @returns {Array<{ type: string, seq: number, time: number, data: unknown }>} the records.
 */
export function readRecords (events) {
  const records = []
  if (!events || typeof events[Symbol.iterator] !== 'function') return records
  for (const event of events) {
    const type = event?.type
    if (event?.ignorable !== true) continue
    if (!isRecordType(type)) continue
    records.push({ type, seq: event.seq, time: event.time, data: event.data })
  }
  return records
}

/**
 * Filter a log down to records of one type.
 * @param {Iterable<object>} events - committed session events.
 * @param {string} type - the record name to keep.
 * @returns {Array<{ type: string, seq: number, time: number, data: unknown }>} matching records.
 */
export function recordsOfType (events, type) {
  return readRecords(events).filter((record) => record.type === type)
}
