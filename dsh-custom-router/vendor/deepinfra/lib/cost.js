/**
 * Per-request cost and per-session spend, from DeepInfra's own accounting.
 *
 * DeepInfra reports the cost of every completion on the wire, so this module
 * PARSES it rather than deriving it. Measured 2026-11-04, the final streaming
 * event carries:
 *
 *   "usage": {
 *     "prompt_tokens": 7, "completion_tokens": 2, "total_tokens": 9,
 *     "estimated_cost": 0.00000182,
 *     "prompt_tokens_details": { "cached_tokens": 0, "cache_write_tokens": null },
 *     "completion_tokens_details": { "reasoning_tokens": 0 }
 *   }
 *
 * Field semantics, all verified against the live API:
 *
 *   estimated_cost        USD for this request, at the DISCOUNTED price. Measured
 *                         equal to (1 - metadata.discount) * catalog list price on
 *                         every route checked (0.70 / 0.75 / 0.75 / 1.00). Present
 *                         on every completion, so it is used verbatim and never
 *                         recomputed when present.
 *   prompt_tokens         the TOTAL prompt, cache included.
 *   cached_tokens         the cached SUBSET of prompt_tokens, not an addition.
 *   cache_write_tokens    null/0 for every request this plugin sends, because it
 *                         never opts into prompt-cache retention; the field is
 *                         populated only when `prompt_cache_options` opens or
 *                         extends a retention window (docs, 2026-11-08). Parsed,
 *                         never assumed.
 *   reasoning_tokens      present on some routes, entirely absent on others
 *                         (gpt-oss-120b, claude-sonnet-5). Absence is "not
 *                         reported", never a fabricated zero.
 *
 * WHAT IS LOCAL AND WHAT IS SHARED (Phase 2):
 *   - LOCAL: the wire parsing (`parseCost`), the catalog list-price projection
 *     (`listPriceOf`) and the chip renderer (`formatCost`) — DeepInfra-specific
 *     vocabulary that no other vendor shares.
 *   - SHARED: the ledger, the persisted store, `pickSession` and `numberOrNull`,
 *     imported from `@nolit/dsh-custom-router/cost`. This file used to carry a
 *     byte-derived copy of all four; that copy is deleted, not forked.
 *
 * The two thin wrappers below exist only because this vendor's call sites use a
 * positional turn argument and a `{ store }` ledger factory, while the shared
 * core takes an options object and separates `merge()` from construction. The
 * arithmetic and the persisted shape are entirely the core's.
 *
 * @module @nolit/dsh-deepinfra/cost
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'

import {
  LEDGER_VERSION,
  createCostLedger as createSharedLedger,
  createCostStore as createSharedStore,
  numberOrNull,
  pickSession,
} from '../../../lib/cost.js'

export { LEDGER_VERSION, numberOrNull, pickSession }

/**
 * Parse one wire `usage` object into a cost record.
 *
 * @param {unknown} raw - the `usage` object from a stream event.
 * @returns {{
 *   costUsd: number|null,
 *   costSource: 'provider'|'estimated'|null,
 *   tokens: { input: number, output: number, reasoning: number, cacheRead: number, cacheWrite: number } | null,
 *   reportedReasoning: boolean,
 * }} the record; every cost field is null when the wire did not report it.
 */
export function parseCost(raw, pricing) {
  if (raw === null || typeof raw !== 'object') {
    return { costUsd: null, listCostUsd: null, costSource: null, tokens: null, reportedReasoning: false }
  }
  const promptTotal = numberOrNull(raw.prompt_tokens) ?? 0
  const completion = numberOrNull(raw.completion_tokens) ?? 0
  const cached = numberOrNull(raw.prompt_tokens_details?.cached_tokens)
  const written = numberOrNull(raw.prompt_tokens_details?.cache_write_tokens)
  const reasoning = numberOrNull(raw.completion_tokens_details?.reasoning_tokens)
  const costUsd = numberOrNull(raw.estimated_cost)
  // TWO figures, and the operator needs both:
  //   costUsd      what DeepInfra actually BILLED (discount already applied)
  //   listCostUsd  the catalog LIST price for the same tokens, before discount
  // The composer chip shows the billed amount (what this turn really cost); the
  // settings card shows the list price as well, so a promotion is visible as a
  // promotion rather than as an unexpectedly small bill.
  const listCostUsd = listPriceOf(raw, pricing)
  return {
    costUsd,
    listCostUsd,
    // The provider always sends this today; the distinction is kept because a
    // gateway in front of it may drop the field, and then the figure is a local
    // estimate and the UI must say so.
    costSource: costUsd === null ? null : 'provider',
    tokens: {
      // Billed counters: input EXCLUDES cache (the wire folds it in), output
      // INCLUDES reasoning. Keeping the wire's own split avoids double counting.
      input: Math.max(0, promptTotal - (cached ?? 0)),
      output: completion,
      reasoning: reasoning ?? 0,
      cacheRead: cached ?? 0,
      cacheWrite: written ?? 0,
    },
    // Absence is not zero: a route that never reports this must not be rendered
    // as a route that reasoned for zero tokens.
    reportedReasoning: reasoning !== null,
  }
}

/**
 * The list-price cost of one request, before any catalog discount.
 *
 * Derived exactly the way the provider derives its own figure (verified: the
 * ratio equals `1 - metadata.discount` on every route checked), so the two
 * numbers differ only by the promotion.
 *
 * @param {object} raw - the wire usage object.
 * @param {object} [pricing] - catalog `metadata.pricing` for this route.
 * @returns {number|null} USD at list price, or null when pricing is unknown.
 */
export function listPriceOf(raw, pricing) {
  if (pricing === null || typeof pricing !== 'object') return null
  const prompt = numberOrNull(raw?.prompt_tokens) ?? 0
  const completion = numberOrNull(raw?.completion_tokens) ?? 0
  const cached = Math.min(numberOrNull(raw?.prompt_tokens_details?.cached_tokens) ?? 0, prompt)
  const rate = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)
  const inputRate = rate(pricing.input_tokens)
  const outputRate = rate(pricing.output_tokens)
  const cacheRate = rate(pricing.cache_read_tokens)
  if (inputRate === undefined && outputRate === undefined) return null
  const uncached = prompt - cached
  const amount =
    (uncached / 1e6) * (inputRate ?? 0) +
    (cached / 1e6) * (cacheRate ?? inputRate ?? 0) +
    (completion / 1e6) * (outputRate ?? 0)
  return amount
}

/**
 * Render a cost figure the way the composer chip shows it.
 *
 * A zero-request session renders the free label rather than "$0.0000": the owner
 * reads the chip as "what has this conversation cost", and before the first turn
 * the honest answer is that nothing has been spent yet.
 *
 * @param {object|null} entry - one session entry.
 * @returns {string} the chip text, or '' when there is nothing to show.
 */
export function formatCost(entry) {
  if (entry === null || entry === undefined) return ''
  if (!(entry.requests > 0)) return ''
  const value = typeof entry.costUsd === 'number' ? entry.costUsd : 0
  // Sub-cent totals keep four decimals; anything larger does not need them.
  if (value === 0) return '$0'
  if (value < 0.0001) return '$' + value.toFixed(6)
  return '$' + value.toFixed(4)
}

/** File name of the persisted spend ledger. */
export const COST_FILE_NAME = 'deepinfra-session-cost.json'

/**
 * Reader/writer pair for the persisted ledger.
 *
 * The shared store takes an injected `fs` so it stays loadable from the browser
 * bundle; this wrapper supplies `node:fs` once, here, where the server side is
 * the only caller. Writes are atomic through the shared implementation.
 *
 * @param {{ path: string }} options - resolved ledger path.
 * @returns {{ path: string, read: () => object|null, write: (snapshot: object) => boolean }}
 */
export function createCostStore({ path } = {}) {
  return createSharedStore({ path, fs: { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } })
}

/**
 * Create the per-session cost ledger.
 *
 * Records are partitioned the way the owner asked for: by SESSION (the
 * accumulator's key), by MODEL (inside it), and by TURN (a turn index the caller
 * supplies, so one DSH turn that makes two model calls is still one turn's cost).
 *
 * The shared ledger owns the accumulator, the partitions, the merge and the
 * snapshot. This wrapper adds the two things this vendor's call sites need and
 * the core deliberately does not do itself:
 *   - a POSITIONAL turn argument (`record(id, model, cost, turn)`);
 *   - a SYNCHRONOUS persistence on every record, and a restart load at
 *     construction. Measured 2026-11-05: a debounced write with `.unref()` lost
 *     the bill entirely on a one-turn headless run, so nothing here is deferred.
 *
 * @param {{ now?: () => number, store?: object|null }} [options] - clock and store seams.
 * @returns {object} the ledger.
 */
export function createCostLedger({ now = Date.now, store = null } = {}) {
  const ledger = createSharedLedger({ now })

  // Restart recovery: fold the last persisted snapshot in exactly once. The
  // shared merge is additive and idempotent, and it tolerates every row shape
  // this plugin has ever written.
  if (store !== null) {
    const saved = store.read()
    if (saved !== null) ledger.merge(saved)
  }

  const persist = () => (store === null ? false : store.write(ledger.snapshot()))

  /**
   * Record one completed request.
   * @param {string} sessionId - DSH session id.
   * @param {string} model - the exact route on the wire.
   * @param {ReturnType<typeof parseCost>} cost - parsed record.
   * @param {number} [turn] - DSH turn index, for the per-turn partition.
   * @returns {object} the session totals after the record.
   */
  const record = (sessionId, model, cost, turn) => {
    const outcome = ledger.record(sessionId, model, cost, { turn })
    persist()
    return outcome.totals
  }

  return {
    record,
    session: (sessionId) => ledger.session(sessionId),
    summary: () => ledger.summary(),
    reset(sessionId) {
      ledger.reset(sessionId)
      persist()
    },
    flush: () => persist(),
  }
}
