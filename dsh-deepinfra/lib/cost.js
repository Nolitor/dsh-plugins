/**
 * Per-request cost and per-session spend, from DeepInfra's own accounting.
 *
 * DeepInfra reports the cost of every completion on the wire, so this module
 * PARSE it rather than deriving it. Measured 2026-11-04, the final streaming
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
 *   cache_write_tokens    always null on DeepInfra today; parsed, never assumed.
 *   reasoning_tokens      present on some routes, entirely absent on others
 *                         (gpt-oss-120b, claude-sonnet-5). Absence is "not
 *                         reported", never a fabricated zero.
 *
 * This module is standalone: it parses and accumulates, and the adapter calls it.
 * Nothing here reaches into the streaming or display path.
 *
 * @module @nolit/dsh-deepinfra/cost
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

/** The ledger schema version, so a future reader can migrate instead of guess. */
export const LEDGER_VERSION = 1

/**
 * Read a finite number, or null.
 *
 * 0 is a real answer ("this call was free"), so only a missing or unusable value
 * becomes null.
 *
 * @param {unknown} value - wire value.
 * @returns {number|null} the number, or null when absent/not finite.
 */
export function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

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

/** The zeroed per-session accumulator. */
function zeroTotals() {
  return {
    requests: 0,
    // costUsd      = actually billed (what the provider charged)
    // listCostUsd  = at catalog list price, before any promotion
    costUsd: 0,
    listCostUsd: 0,
    pricedRequests: 0,
    unpricedRequests: 0,
    byModel: {},
    turns: {},
    tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    lastAt: null,
    firstAt: null,
  }
}

/**
 * Create the per-session cost ledger.
 *
 * Records are partitioned the way the owner asked for: by SESSION (the
 * accumulator's key), by MODEL (inside it), and by TURN (a turn index the caller
 * supplies, so one DSH turn that makes two model calls is still one turn's cost).
 *
 * @param {{ now?: () => number, store?: object|null }} [options] - clock and store seams.
 * @returns {object} the ledger.
 */
export function createCostLedger({ now = Date.now, store = null } = {}) {
  /** @type {Map<string, object>} */
  const sessions = new Map()
  /** @type {Array<object>} recent per-request records, newest last (bounded) */
  const recent = []
  const RECENT_LIMIT = 500

  const load = () => {
    if (store === null) return
    const saved = store.read()
    if (saved === null) return
    for (const [sessionId, totals] of Object.entries(saved?.sessions ?? {})) {
      if (sessionId && totals && typeof totals === 'object') sessions.set(sessionId, { ...zeroTotals(), ...totals })
    }
    if (Array.isArray(saved?.recent)) recent.push(...saved.recent.slice(-RECENT_LIMIT))
  }
  let flushTimer = null
  const snapshot = () => {
    const out = {}
    for (const [sessionId, totals] of sessions) out[sessionId] = totals
    return { version: LEDGER_VERSION, sessions: out, recent: recent.slice(-RECENT_LIMIT), savedAt: new Date(now()).toISOString() }
  }
  const persist = () => {
    if (store === null) return
    // WRITE SYNCHRONOUSLY.
    //
    // A 1-second debounce with `.unref()` looked harmless and was not: measured
    // 2026-11-05, a one-turn `dsh headless` run exits in well under a second, so
    // the pending timer never fired, the ledger file was never created, and the
    // usage panel reported zero for work that had genuinely been billed. An
    // unref'd timer is a promise the process is free to break.
    //
    // The write is small (one JSON object per session) and happens once per model
    // call, which is already an I/O-bound operation.
    store.write(snapshot())
    if (flushTimer !== null) {
      clearTimeout(flushTimer)
      flushTimer = null
    }
  }
  load()

  const totalsOf = (sessionId) => {
    let totals = sessions.get(sessionId)
    if (totals === undefined) {
      totals = zeroTotals()
      sessions.set(sessionId, totals)
    }
    return totals
  }

  /**
   * Record one completed request.
   * @param {string} sessionId - DSH session id.
   * @param {string} model - the exact route on the wire.
   * @param {ReturnType<typeof parseCost>} cost - parsed record.
   * @param {number} [turn] - DSH turn index, for the per-turn partition.
   * @returns {object} the session totals after the record.
   */
  const record = (sessionId, model, cost, turn) => {
    const id = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : '(no session)'
    const route = typeof model === 'string' && model.length > 0 ? model : '(no model)'
    const at = now()
    const totals = totalsOf(id)
    totals.requests += 1
    totals.lastAt = at
    if (totals.firstAt === null) totals.firstAt = at

    if (cost?.costUsd === null || cost?.costUsd === undefined) totals.unpricedRequests += 1
    else {
      totals.pricedRequests += 1
      totals.costUsd += cost.costUsd
    }
    if (typeof cost?.listCostUsd === 'number') totals.listCostUsd = (totals.listCostUsd ?? 0) + cost.listCostUsd

    const perModel = totals.byModel[route] ?? (totals.byModel[route] = {
      requests: 0, costUsd: 0, listCostUsd: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    })
    perModel.requests += 1
    if (typeof cost?.costUsd === 'number') perModel.costUsd += cost.costUsd
    if (typeof cost?.listCostUsd === 'number') perModel.listCostUsd = (perModel.listCostUsd ?? 0) + cost.listCostUsd

    // The per-turn partition: a turn may make several calls (tool loop), and the
    // owner asked for the split by turn, not only by session.
    const turnKey = Number.isInteger(turn) && turn >= 0 ? String(turn) : 'unassigned'
    const perTurn = totals.turns[turnKey] ?? (totals.turns[turnKey] = {
      requests: 0, costUsd: 0, listCostUsd: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
    })
    perTurn.requests += 1
    if (typeof cost?.costUsd === 'number') perTurn.costUsd += cost.costUsd
    if (typeof cost?.listCostUsd === 'number') perTurn.listCostUsd = (perTurn.listCostUsd ?? 0) + cost.listCostUsd

    if (cost?.tokens) {
      for (const bucket of ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite']) {
        const delta = cost.tokens[bucket] ?? 0
        totals.tokens[bucket] = (totals.tokens[bucket] ?? 0) + delta
        perModel.tokens[bucket] = (perModel.tokens[bucket] ?? 0) + delta
        perTurn.tokens[bucket] = (perTurn.tokens[bucket] ?? 0) + delta
      }
    }

    recent.push({
      at, sessionId: id, model: route, turn: turnKey,
      costUsd: cost?.costUsd ?? null,
      listCostUsd: cost?.listCostUsd ?? null,
      costSource: cost?.costSource ?? null,
      tokens: cost?.tokens ?? null,
    })
    if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT)

    persist()
    return totals
  }

  return {
    record,
    session(sessionId) {
      const totals = sessions.get(sessionId)
      return totals === undefined ? null : { sessionId, ...totals }
    },
    summary() {
      const bySession = []
      let costUsd = 0
      let listCostUsd = 0
      let requests = 0
      for (const [sessionId, totals] of sessions) {
        costUsd += totals.costUsd
        listCostUsd += totals.listCostUsd ?? 0
        requests += totals.requests
        bySession.push({ sessionId, ...totals })
      }
      bySession.sort((left, right) => (right.lastAt ?? 0) - (left.lastAt ?? 0))
      return { sessions: bySession.length, requests, costUsd, listCostUsd, bySession, recent: recent.slice(-50).reverse() }
    },
    reset(sessionId) {
      if (sessionId === undefined) {
        sessions.clear()
        recent.length = 0
      } else sessions.delete(sessionId)
      persist()
    },
    flush() {
      if (store === null) return false
      return store.write(snapshot())
    },
  }
}

/**
 * Pick the session whose spend describes the screen.
 *
 * Exact id first (with or without the `session-` prefix), then the most recently
 * active session. An exact-only match reports nothing for a live conversation
 * whose DOM carries a different id (the lesson recorded in opencode-v2).
 *
 * @param {{ bySession?: object[] }|null} summary - ledger summary.
 * @param {string|null|undefined} sessionId - the id the page reports.
 * @returns {object|null} the entry, or null when nothing has been spent.
 */
export function pickSession(summary, sessionId) {
  const list = Array.isArray(summary?.bySession) ? summary.bySession : []
  if (list.length === 0) return null
  const bare = (value) => String(value ?? '').replace(/^session-/, '')
  if (typeof sessionId === 'string' && sessionId.length > 0) {
    const exact = list.find((row) => row?.sessionId === sessionId || bare(row?.sessionId) === bare(sessionId))
    if (exact !== undefined) return exact
  }
  return list.reduce((best, row) => (best === null || (row?.lastAt ?? 0) > (best.lastAt ?? 0) ? row : best), null)
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
 * @param {{ path: string }} options - resolved ledger path.
 * @returns {{ path: string, read: () => object|null, write: (snapshot: object) => boolean }}
 */
export function createCostStore({ path } = {}) {
  return {
    path,
    read() {
      if (!path) return null
      try {
        const raw = JSON.parse(readFileSync(path, 'utf8'))
        return raw && typeof raw.sessions === 'object' ? raw : null
      } catch {
        // Missing or corrupt state is "nothing measured yet", never a crash.
        return null
      }
    },
    write(value) {
      if (!path) return false
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, JSON.stringify(value, null, 2) + '\n')
        return true
      } catch {
        return false
      }
    },
  }
}
