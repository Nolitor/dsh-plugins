/**
 * The paired write: one tier decision, one prune payload, one surface
 * replacement, one rewrite record — in that order, with a stated failure policy.
 *
 * ## Why the order is the contract
 *
 * The surface replacement is the only irreversible act in the chain, and the log
 * is append-only, so every step before it is a precondition check:
 *
 *  1. **validate** the target against the *current* `session.surface.nodes`
 *     (a stale or foreign node would otherwise throw inside `Session.append`);
 *  2. **decision record first** (`plugin:tokeneconomizer/tier-decision`) — a
 *     decision must exist even when the rewrite never happens, so a reader can
 *     tell "decided, not rewritten" apart from "never decided";
 *  3. **prune payload** (`compaction/prune`) — the shadow price the token meter
 *     folds as the immediately preceding event; without it the replacement's
 *     delta is unrecoverable, so it must be adjacent and must land first;
 *  4. **replacement** (`tool/result` with `surfaceOp: { op: 'replace' }`);
 *  5. **rewrite record** (`plugin:tokeneconomizer/surface-rewrite`) describing
 *     the write that already landed.
 *
 * The replacement and its prune payload are adjacent by construction; the token
 * meter depends on exactly that adjacency.
 *
 * ## Failure matrix (implemented, not aspirational)
 *
 * | Failure | Effect |
 * |---|---|
 * | validation fails | **no** prune, **no** replacement; the decision record is still appended with a `rejected:` reason; returns `{ ok: false, reason }` |
 * | decision record append fails | **warn once** per session, then continue — a missing decision record must never block a legitimate saving |
 * | prune append fails | abort **before** the replacement; returns `{ ok: false }` — a replacement without its prune payload is never appended |
 * | replacement append fails | the rewrite did not happen; returns `{ ok: false, warning }`; **no** rewrite record |
 * | rewrite record append fails | the rewrite **stands**; returns `{ ok: true, warning }` — a committed surface write is never rolled back |
 *
 * All record writes go through `lib/attribution.js`; this module never calls
 * `appendPluginRecord` directly, and it never calls one of the three deprecated
 * synchronous session event reads — the surface is read through
 * `session.surface` and the event body arrives from the caller.
 *
 * @module dsh-tokeneconomizer/lib/surface-attribution
 */

import { appendRecord, RECORD_NAMES } from './attribution.js'
import {
  composeRewrite,
  measureEventText,
  normalizeDecisionTier,
  normalizeRewriteTier,
} from './rewriter.js'

/**
 * Sessions already warned about a lost decision record. The warning is emitted
 * once per session lifetime, not once per failed append: a store that refuses
 * records refuses every one of them, and repeating the notice would drown the
 * one-line diagnostic that identifies the problem.
 * @type {WeakSet<object>}
 */
const DECISION_WARNED = new WeakSet()

/**
 * Report a plugin-side failure once per session for a given category.
 * @param {object} session
 * @param {string} message
 * @param {((message: string) => void)|undefined} sink - injected warning sink.
 * @returns {void}
 */
function warnOnceForDecision (session, message, sink) {
  const key = session && typeof session === 'object' ? session : null
  if (key) {
    if (DECISION_WARNED.has(key)) return
    DECISION_WARNED.add(key)
  }
  if (typeof sink === 'function') {
    try {
      sink(message)
      return
    } catch (error) {
      // A broken warning sink must not turn a warning into a failed rewrite, so
      // the failure is reported on the default channel instead of swallowed.
      const cause = error instanceof Error ? error.message : String(error)
      console.warn(`${message} (warning sink threw: ${cause})`)
      return
    }
  }
  console.warn(message)
}

/**
 * Extract a committed sequence number from whatever `append` returned.
 * The harness returns a frozen event object; simple fakes return a number.
 * @param {any} result
 * @param {any[]} log - the session log, for the fallback index.
 * @returns {number|undefined}
 */
function seqOfAppend (result, log) {
  if (typeof result === 'number' && Number.isFinite(result)) return result
  if (result && typeof result === 'object' && typeof result.seq === 'number') return result.seq
  if (Array.isArray(log)) return log.length - 1
  return undefined
}

/**
 * Perform one surface rewrite with its full attribution pair.
 *
 * @param {any} session - the session to rewrite; must expose `surface.nodes` and `append`.
 * @param {number} seq - target seq; must be a **current** `tool/result` node.
 * @param {string} replacementText - the new message text.
 * @param {{ tier?: string, turn?: number, step?: number, policyHash?: string, reason?: string, shadowTokens?: number, charsBefore?: number }} meta
 *   the decision context. `tier` is `hot|warm|cold` for the decision and must be
 *   `warm|cold` for a rewrite; an unlisted tier is recorded as the decision tier
 *   and the rewrite record is skipped rather than mislabelled.
 * @param {{ event?: any, readEvent?: Function, appendPluginRecord?: Function, onWarn?: Function }} [options]
 *   event resolution and failure injection.
 * @returns {{ ok: boolean, reason?: string, warning?: string, recordSeq?: number, resultSeq?: number, pruneSeq?: number, decisionSeq?: number }}
 */
export function applyRewrite (session, seq, replacementText, meta, options = {}) {
  const context = meta && typeof meta === 'object' ? meta : {}
  const turn = Number.isFinite(context.turn) ? context.turn : 0
  const step = Number.isFinite(context.step) ? context.step : 0
  const policyHash = typeof context.policyHash === 'string' && context.policyHash.length > 0
    ? context.policyHash
    : 'unstated'
  const decisionTier = normalizeDecisionTier(context.tier) ?? 'cold'
  const rewriteTier = normalizeRewriteTier(context.tier)
  const reason = typeof context.reason === 'string' && context.reason.length > 0
    ? context.reason
    : `tier-${rewriteTier ?? decisionTier}`
  const shadowTokens = Number.isFinite(context.shadowTokens) ? context.shadowTokens : 0

  const recordOptions = options.appendPluginRecord
    ? { appendPluginRecord: options.appendPluginRecord }
    : {}

  // 1. Validate the target against the current surface. Validation failure is
  //    the one path that still writes a record: the decision is kept, and no
  //    prune, no replacement and no rewrite record follow it.
  const composed = composeRewrite(session, seq, replacementText, shadowTokens, {
    event: options.event,
    readEvent: options.readEvent,
  })
  if (!composed.ok) {
    const reasonText = String(composed.reason ?? 'validation-failed')
    const decision = appendRecord(session, RECORD_NAMES.TIER_DECISION, {
      nodeSeq: Number.isInteger(seq) ? seq : 0,
      tier: decisionTier,
      turn,
      step,
      policyHash,
      reason: `rejected: ${reasonText}`,
    }, recordOptions)
    if (!decision.ok) {
      warnOnceForDecision(
        session,
        `[tokeneconomizer] tier decision record could not be appended (${decision.reason ?? 'unknown'}); rewrite unchanged`,
        options.onWarn
      )
    }
    return { ok: false, reason: reasonText }
  }

  // 2. Decision record before anything mutates the surface.
  const decision = appendRecord(session, RECORD_NAMES.TIER_DECISION, {
    nodeSeq: seq,
    tier: decisionTier,
    turn,
    step,
    policyHash,
    reason,
  }, recordOptions)
  if (!decision.ok) {
    warnOnceForDecision(
      session,
      `[tokeneconomizer] tier decision record could not be appended (${decision.reason ?? 'unknown'}); continuing without it`,
      options.onWarn
    )
  }

  // 3. Prune payload. A replacement without its shadow price must never exist,
  //    so a prune failure aborts here.
  const log = Array.isArray(session?.log) ? session.log : undefined
  let pruneResult
  try {
    pruneResult = session.append('compaction/prune', composed.pruneData)
  } catch (error) {
    return {
      ok: false,
      reason: `prune-append-failed: ${error instanceof Error ? error.message : String(error)}`,
      decisionSeq: decision.seq,
    }
  }
  const pruneSeq = seqOfAppend(pruneResult, log)

  // 4. Replacement.
  let resultResult
  try {
    resultResult = session.append('tool/result', composed.resultData, composed.resultOptions)
  } catch (error) {
    return {
      ok: false,
      reason: `replacement-append-failed: ${error instanceof Error ? error.message : String(error)}`,
      decisionSeq: decision.seq,
      pruneSeq,
    }
  }
  const resultSeq = seqOfAppend(resultResult, log)

  // 5. Rewrite record, describing the write that already landed.
  if (rewriteTier === null) {
    return {
      ok: true,
      warning: `rewrite committed without a rewrite record: tier "${String(context.tier)}" is not warm|cold`,
      decisionSeq: decision.seq,
      pruneSeq,
      resultSeq,
    }
  }

  const charsBefore = Number.isFinite(context.charsBefore)
    ? context.charsBefore
    : measureEventText(composed.event)
  const charsAfter = replacementText.length

  const record = appendRecord(session, RECORD_NAMES.SURFACE_REWRITE, {
    nodeSeq: seq,
    tier: rewriteTier,
    charsBefore,
    charsAfter,
    shadowTokens,
    reason,
  }, recordOptions)
  if (!record.ok) {
    return {
      ok: true,
      warning: `rewrite committed without its record: ${record.reason ?? 'record append failed'}`,
      decisionSeq: decision.seq,
      pruneSeq,
      resultSeq,
    }
  }

  return {
    ok: true,
    decisionSeq: decision.seq,
    pruneSeq,
    resultSeq,
    recordSeq: record.seq,
  }
}
