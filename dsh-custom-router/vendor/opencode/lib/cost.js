/**
 * Per-request cost and per-session spend, from the wire's own accounting.
 *
 * Every OpenCode response reports what the request cost, beside the usage its
 * API already returns. Measured 2026-11-04 on the live Go root
 * (test/live/cost-capture.mjs), the final streaming chunk carries:
 *
 *   "usage": {
 *     "prompt_tokens": 32, "completion_tokens": 8,
 *     "cost": 0,
 *     "opencode": {
 *       "billing_source": "go-plus",
 *       "list_cost": 0.0000096,
 *       "allowance": 0.00001152,
 *       "tokens": { "input": 32, "output": 8, "reasoning": 0,
 *                   "cache_read": 0, "cache_write_5m": 0, "cache_write_1h": 0 }
 *     }
 *   }
 *
 * Field semantics (OpenCode console docs, `/docs/console/models#cost`):
 *
 *   cost                  USD charged to the balance. 0 for free models and for
 *                         Go usage within its limits. ABSENT when the model has
 *                         no price — which is not the same as 0, so it parses to
 *                         null and never to a fabricated zero.
 *   opencode.billing_source  free | balance | go | go-plus | byok
 *   opencode.list_cost    USD at the model's price (peak hours and long context
 *                         included), i.e. what the request was worth.
 *   opencode.estimated    true when `cost` is an estimate at list price rather
 *                         than an amount OpenCode charged. Only set for byok.
 *   opencode.allowance    Go only: dollars of the plan's monthly limit this
 *                         request consumed. This is the "plan burn" number.
 *   opencode.tokens       the tokens actually billed. `input` EXCLUDES cache
 *                         reads and writes; `output` INCLUDES reasoning.
 *
 * This module is deliberately standalone: it parses and it accumulates, and the
 * route calls it. Nothing here reaches into the streaming or display path.
 *
 * @module @nolit/dsh-opencode-v2/cost
 */
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname } from 'node:path'

import { resolveCatalogPath } from './catalog-file.js'

/** Billing sources this adapter knows how to report. */
export const BILLING_SOURCES = Object.freeze(['free', 'balance', 'go', 'go-plus', 'byok'])

/** Sources whose `allowance` counts against a monthly plan limit. */
export const PLAN_SOURCES = Object.freeze(['go', 'go-plus'])

/**
 * Read a finite number, or null.
 *
 * `0` is a real answer ("this was free", "nothing counted toward the plan"), so
 * only a missing or unusable value becomes null.
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
 * Accepts the streaming final chunk and the non-streaming body alike: both put
 * the same fields on `usage`.
 *
 * @param {unknown} raw - the `usage` object from a response or stream chunk.
 * @returns {{
 *   costUsd: number|null,
 *   listCostUsd: number|null,
 *   allowanceUsd: number|null,
 *   estimated: boolean,
 *   billingSource: string|null,
 *   planSource: boolean,
 *   tokens: { input: number, output: number, reasoning: number, cacheRead: number, cacheWrite5m: number, cacheWrite1h: number } | null,
 * }} the record; every cost field is null when the wire did not report it.
 */
export function parseCost(raw) {
  const oc = raw && typeof raw === 'object' && raw.opencode && typeof raw.opencode === 'object' ? raw.opencode : null
  const rawTokens = oc?.tokens && typeof oc.tokens === 'object' ? oc.tokens : null
  const source = typeof oc?.billing_source === 'string' && oc.billing_source.length > 0 ? oc.billing_source : null
  return {
    costUsd: numberOrNull(raw?.cost),
    listCostUsd: numberOrNull(oc?.list_cost),
    allowanceUsd: numberOrNull(oc?.allowance),
    estimated: oc?.estimated === true,
    billingSource: source,
    // A plan burn only exists for a subscription source; byok/balance never
    // consume a monthly allowance, whatever the field happens to say.
    planSource: source !== null && PLAN_SOURCES.includes(source),
    tokens: rawTokens === null ? null : {
      // The billed counters, not the derived ones: `input` already excludes
      // cache, `output` already includes reasoning (measured 2026-11-04).
      input: numberOrNull(rawTokens.input) ?? 0,
      output: numberOrNull(rawTokens.output) ?? 0,
      reasoning: numberOrNull(rawTokens.reasoning) ?? 0,
      cacheRead: numberOrNull(rawTokens.cache_read) ?? 0,
      cacheWrite5m: numberOrNull(rawTokens.cache_write_5m) ?? 0,
      cacheWrite1h: numberOrNull(rawTokens.cache_write_1h) ?? 0,
    },
  }
}

/** The zeroed per-session accumulator. */
function zeroTotals() {
  return {
    requests: 0,
    costUsd: 0,
    listCostUsd: 0,
    allowanceUsd: 0,
    pricedRequests: 0,
    unpricedRequests: 0,
    estimatedRequests: 0,
    byModel: {},
    bySource: {},
    tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    lastAt: null,
    lastBillingSource: null,
  }
}

/**
 * Create the per-session cost ledger.
 *
 * Keyed by DSH session id, because that is what the operator sees; a session's
 * model is recorded alongside so a mid-session model switch stays visible.
 *
 * @param {{ now?: () => number }} [options] - clock seam for tests.
 * @returns {{
 *   record: (sessionId: string, model: string, record: ReturnType<typeof parseCost>) => object,
 *   session: (sessionId: string) => object|null,
 *   summary: () => object,
 *   reset: (sessionId?: string) => void,
 * }}
 */
export function createCostLedger({ now = Date.now, store = null } = {}) {
  /** @type {Map<string, object>} */
  const sessions = new Map()

  // A restart must not reset the bill. Measured 2026-11-04: the figure went back
  // to zero on every restart because the ledger lived only in this Map, which is
  // exactly what an operator cannot use to work out what a day cost.
  const load = () => {
    if (store === null) return
    const saved = store.read()
    for (const [sessionId, totals] of Object.entries(saved?.sessions ?? {})) {
      if (sessionId && totals && typeof totals === 'object') sessions.set(sessionId, { ...zeroTotals(), ...totals })
    }
  }
  let flushTimer = null
  const persist = () => {
    if (store === null) return
    const out = {}
    for (const [sessionId, totals] of sessions) out[sessionId] = totals
    // Debounced: a stream reports every turn and each write is a whole file.
    if (flushTimer !== null) return
    flushTimer = setTimeout(() => {
      flushTimer = null
      const snapshot = {}
      for (const [sessionId, totals] of sessions) snapshot[sessionId] = totals
      store.write({ sessions: snapshot, savedAt: new Date(now()).toISOString() })
    }, 1000)
    if (typeof flushTimer?.unref === 'function') flushTimer.unref()
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

  const record = (sessionId, model, cost) => {
    const id = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : '(no session)'
    const route = typeof model === 'string' && model.length > 0 ? model : '(no model)'
    const totals = totalsOf(id)
    totals.requests += 1
    totals.lastAt = now()
    totals.lastBillingSource = cost?.billingSource ?? null

    if (cost?.costUsd === null || cost?.costUsd === undefined) totals.unpricedRequests += 1
    else {
      totals.pricedRequests += 1
      totals.costUsd += cost.costUsd
    }
    if (typeof cost?.listCostUsd === 'number') totals.listCostUsd += cost.listCostUsd
    if (cost?.planSource && typeof cost?.allowanceUsd === 'number') totals.allowanceUsd += cost.allowanceUsd
    if (cost?.estimated) totals.estimatedRequests += 1
    if (cost?.billingSource) totals.bySource[cost.billingSource] = (totals.bySource[cost.billingSource] ?? 0) + 1

    // Per-model detail is the whole point of the ledger: models are priced
    // differently and consume the plan at different rates, so the session total
    // alone cannot answer "what did the expensive one cost me". Tokens are kept
    // per model for the same reason.
    const perModel = totals.byModel[route] ?? (totals.byModel[route] = {
      requests: 0,
      costUsd: 0,
      listCostUsd: 0,
      allowanceUsd: 0,
      tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 },
    })
    perModel.requests += 1
    if (typeof cost?.costUsd === 'number') perModel.costUsd += cost.costUsd
    if (typeof cost?.listCostUsd === 'number') perModel.listCostUsd += cost.listCostUsd
    if (cost?.planSource && typeof cost?.allowanceUsd === 'number') perModel.allowanceUsd += cost.allowanceUsd
    if (cost?.tokens) {
      perModel.tokens ??= { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }
      for (const key of ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h']) {
        perModel.tokens[key] = (perModel.tokens[key] ?? 0) + (cost.tokens[key] ?? 0)
      }
    }
    totals.tokens ??= { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite5m: 0, cacheWrite1h: 0 }
    if (cost?.tokens) {
      for (const key of ['input', 'output', 'reasoning', 'cacheRead', 'cacheWrite5m', 'cacheWrite1h']) {
        totals.tokens[key] = (totals.tokens[key] ?? 0) + (cost.tokens[key] ?? 0)
      }
    }
    persist()
    return { sessionId: id, model: route, totals }
  }

  return {
    record,
    session(sessionId) {
      const totals = sessions.get(sessionId)
      return totals === undefined ? null : { sessionId, ...totals }
    },
    summary() {
      const out = []
      let costUsd = 0
      let listCostUsd = 0
      let allowanceUsd = 0
      let requests = 0
      for (const [sessionId, totals] of sessions) {
        costUsd += totals.costUsd
        listCostUsd += totals.listCostUsd
        allowanceUsd += totals.allowanceUsd
        requests += totals.requests
        out.push({ sessionId, ...totals })
      }
      out.sort((left, right) => (right.lastAt ?? 0) - (left.lastAt ?? 0))
      return { sessions: out.length, requests, costUsd, listCostUsd, allowanceUsd, bySession: out }
    },
    reset(sessionId) {
      if (sessionId === undefined) sessions.clear()
      else sessions.delete(sessionId)
      persist()
    },
    /** Force the pending write to land (shutdown, tests). */
    flush() {
      if (store === null) return false
      const snapshot = {}
      for (const [sessionId, totals] of sessions) snapshot[sessionId] = totals
      return store.write({ sessions: snapshot, savedAt: new Date(now()).toISOString() })
    },
  }
}

/**
 * One-line human summary of a record, for logs and diagnostics.
 *
 * @param {ReturnType<typeof parseCost>} cost - parsed record.
 * @returns {string} e.g. `go-plus cost=0.000000 list=0.000010 plan=0.000012 in=32 out=8`.
 */
/**
 * Process-wide ledger registry.
 *
 * The HTTP adapter and the CLI-subagent provider are two loader rows of ONE
 * process, and both spend against the same account. Two ledger instances would
 * each hold their own sessions map and each write the whole persisted snapshot,
 * so whichever flushed last would silently erase the other's newest rows. One
 * instance per owner key keeps the bill additive.
 *
 * @param {string} key - ledger owner (the provider id).
 * @param {{ now?: () => number, store?: object }} [options] - forwarded to createCostLedger on first use.
 * @returns the shared ledger.
 */
const sharedLedgers = new Map()

export function sharedCostLedger(key, options) {
  const existing = sharedLedgers.get(key)
  if (existing !== undefined) return existing
  const ledger = createCostLedger(options)
  sharedLedgers.set(key, ledger)
  return ledger
}

/**
 * Drop every shared ledger. Test-only: one process that builds several adapters
 * would otherwise carry earlier tests' rows into the next summary assertion.
 * Production never calls this.
 */
export function resetSharedCostLedgers() {
  sharedLedgers.clear()
}

export function describeCost(cost) {
  const usd = (value) => (value === null ? 'n/a' : value.toFixed(9).replace(/0+$/, '').replace(/\.$/, ''))
  const tokens = cost?.tokens
  const parts = [
    cost?.billingSource ?? 'unknown',
    'cost=' + usd(cost?.costUsd ?? null),
    'list=' + usd(cost?.listCostUsd ?? null),
  ]
  if (cost?.planSource) parts.push('plan=' + usd(cost?.allowanceUsd ?? null))
  if (cost?.estimated) parts.push('estimated')
  if (tokens) parts.push('in=' + tokens.input, 'out=' + tokens.output, 'cache=' + tokens.cacheRead)
  return parts.join(' ')
}


/**
 * Pick the session whose spend describes the screen.
 *
 * Exact id first (with or without the `session-` prefix), then the most recently
 * active session. Measured 2026-11-04: an exact-only match reported "무료" for a
 * live conversation because the DOM carried a different session's id.
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

/** File name of the persisted session spend. */
export const COST_FILE_NAME = 'opencode-session-cost.json'

/**
 * Reader/writer pair for the persisted ledger.
 *
 * Follows the catalog rule (explicit, then profile, then DSH_HOME) so spend lands
 * beside the other plugin state instead of the process working directory, and a
 * restart does not reset the bill.
 *
 * @param {{ explicit?: string, profileDir?: string, dshHome?: string, fileName?: string }} options
 * @returns {{ path: string, read: () => object|null, write: (snapshot: object) => boolean }}
 */
export function createCostStore({ explicit, profileDir, dshHome, fileName = COST_FILE_NAME } = {}) {
  const path = resolveCatalogPath({ explicit, profileDir, dshHome, fileName })
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
    write(snapshot) {
      if (!path) return false
      try {
        mkdirSync(dirname(path), { recursive: true })
        writeFileSync(path, JSON.stringify(snapshot, null, 2) + '\n')
        return true
      } catch {
        return false
      }
    },
  }
}
