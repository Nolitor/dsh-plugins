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
 * WHAT IS LOCAL AND WHAT IS SHARED (R2, 2026-11-14):
 *   - LOCAL: the wire parsing (`parseCost`) and the diagnostic line
 *     (`describeCost`) — OpenCode-specific vocabulary that no other vendor
 *     shares — plus the process-wide registry (`sharedCostLedger`) and this
 *     package's own path rule (`resolveCatalogPath`).
 *   - SHARED: `numberOrNull`, `pickSession`, the per-session ledger and the
 *     persisted store, all imported from the router core (`lib/cost.js`). This
 *     file used to carry its own copy of every one of them; those copies are
 *     deleted, not forked.
 *
 * The two thin wrappers below exist only because this vendor's call sites need a
 * synchronous persistence on every record (a debounced write lost the bill on a
 * one-turn headless run — measured 2026-11-05) and a `bySource` count map in the
 * payload it serves, while the core keeps `bySource` as a spend partition. The
 * arithmetic, the accumulator and the persisted shape are entirely the core's.
 *
 * @module @nolit/dsh-opencode-v2/cost
 */
import { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'

import {
  createCostLedger as createSharedLedger,
  createCostStore as createSharedStore,
  numberOrNull,
  pickSession,
} from '../../../lib/cost.js'
import { resolveCatalogPath } from './catalog-file.js'

// `numberOrNull` and `pickSession` are defined ONCE, in the router's core
// (`lib/cost.js`). This package's call sites (`lib/http.js`) and its tests reach
// them through `./cost.js`, so the core symbols are re-exported here instead of
// being copied: a second copy is exactly the drift the shared core exists to
// prevent (`docs/ARCHITECTURE-LAYERED.md` §6 #3, R6's uniqueness gate).
export { numberOrNull, pickSession }

/** Billing sources this adapter knows how to report. */
export const BILLING_SOURCES = Object.freeze(['free', 'balance', 'go', 'go-plus', 'byok'])

/** Sources whose `allowance` counts against a monthly plan limit. */
export const PLAN_SOURCES = Object.freeze(['go', 'go-plus'])

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

/**
 * Fold one core session entry into the shape this adapter has always SERVED.
 *
 * The core ledger's row is a superset of what this module used to build: it adds
 * `turns` (a per-turn partition this adapter never had), `firstAt`, and a
 * `bySource` SPEND PARTITION (`{requests, costUsd, listCostUsd, allowanceUsd,
 * tokens}`) rather than a plain count map.
 *
 * Restoring the old shape is not cosmetic. The router's `lib/client.src.js`
 * `detectOpencodeTier()` reads `bySource` as `{source: count}` and does
 * `Number(value) || 0`, so a partition would sum to 0 and silently degrade the
 * plan badge from `go-plus`/`go` to "unknown"; and `firstAt`/`turns` were never
 * part of the payload the settings route polls. Measured by a differential test
 * against the pre-R2 implementation, which is why the projection lives here
 * instead of changing a frozen consumer.
 *
 * @param {{ sessionId: string } & Record<string, unknown>} entry - core session entry.
 * @returns {object} the entry with `bySource` as `{source: count}` and no core-only keys.
 */
function servedEntry(entry) {
  if (entry === null || typeof entry !== 'object') return entry
  const { bySource, turns, firstAt, ...rest } = entry
  const counts = {}
  for (const [source, value] of Object.entries(bySource ?? {})) {
    if (value === null || typeof value !== 'object') {
      counts[source] = typeof value === 'number' ? value : 0
      continue
    }
    // `requests` IS the record count: the core increments it once per record,
    // exactly as the old count map did.
    counts[source] = typeof value.requests === 'number' ? value.requests : 0
  }
  return { ...rest, bySource: counts }
}

/**
 * Create the per-session cost ledger.
 *
 * Keyed by DSH session id, because that is what the operator sees; a session's
 * model is recorded alongside so a mid-session model switch stays visible.
 *
 * The core ledger (`lib/cost.js`) owns the accumulator, its partitions, the
 * snapshot and the merge. This wrapper adds only what this adapter's call sites
 * need and the core deliberately does not do itself:
 *   - a SYNCHRONOUS persistence on every record, and a restart load at
 *     construction. Measured 2026-11-05: a debounced write with `.unref()` lost
 *     the bill entirely on a one-turn headless run, so nothing here is deferred;
 *   - the served `bySource` count map (see {@link servedEntry}).
 *
 * @param {{ now?: () => number, store?: object|null }} [options] - clock and store seams.
 * @returns {object} the ledger.
 */
export function createCostLedger({ now = Date.now, store = null } = {}) {
  const ledger = createSharedLedger({ now })

  // Restart recovery: a restart must not reset the bill. Measured 2026-11-04: the
  // figure went back to zero on every restart because the ledger lived only in a
  // Map, which is exactly what an operator cannot use to work out what a day cost.
  // The core merge is additive and idempotent and tolerates every row shape this
  // plugin has ever written (including the older `bySource` count map).
  if (store !== null) {
    const saved = store.read()
    if (saved !== null) ledger.merge(saved)
  }

  const persist = () => (store === null ? false : store.write(ledger.snapshot()))

  /**
   * Record one completed request.
   *
   * Returns `{sessionId, model, totals}` exactly as before. One deliberate
   * difference, measured by a differential test against the pre-R2 code: `totals`
   * is now a SNAPSHOT of the session row rather than the live mutable object the
   * old ledger handed back. No caller reads it (both call sites discard the
   * result), and a live interior reference is how a caller could mutate the
   * ledger's own accumulator; the served row is the safer contract.
   *
   * @param {string} sessionId - DSH session id.
   * @param {string} model - the exact route on the wire.
   * @param {ReturnType<typeof parseCost>} cost - parsed record.
   * @returns {{sessionId: string, model: string, totals: object}} the session row after the record.
   */
  const record = (sessionId, model, cost) => {
    const outcome = ledger.record(sessionId, model, cost)
    // Last-seen billing source: this adapter has always reported "no source" for
    // a request that carries none, rather than keeping the previous one.
    outcome.totals.lastBillingSource = cost?.billingSource ?? null
    persist()
    return { sessionId: outcome.sessionId, model: outcome.model, totals: servedEntry(outcome.totals) }
  }

  return {
    record,
    session(sessionId) {
      const totals = ledger.session(sessionId)
      return totals === null ? null : servedEntry(totals)
    },
    summary() {
      // `recent` (a per-request ring the core keeps for the spend panel) was never
      // part of this adapter's served summary, so it is not added to the payload
      // the settings route polls.
      const { recent, bySession, ...rest } = ledger.summary()
      return { sessions: rest.sessions, requests: rest.requests, costUsd: rest.costUsd, listCostUsd: rest.listCostUsd, allowanceUsd: rest.allowanceUsd, bySession: bySession.map(servedEntry) }
    },
    reset(sessionId) {
      ledger.reset(sessionId)
      persist()
    },
    /** Force a write now (shutdown, tests). */
    flush: () => persist(),
  }
}

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

/**
 * One-line human summary of a record, for logs and diagnostics.
 *
 * @param {ReturnType<typeof parseCost>} cost - parsed record.
 * @returns {string} e.g. `go-plus cost=0.000000 list=0.000010 plan=0.000012 in=32 out=8`.
 */
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

/** File name of the persisted session spend. */
export const COST_FILE_NAME = 'opencode-session-cost.json'

/**
 * Reader/writer pair for the persisted ledger.
 *
 * The PATH rule stays this vendor's own (`resolveCatalogPath`: explicit, then
 * profile, then `$DSH_HOME`) so spend lands beside the other plugin state instead
 * of the process working directory. The read/write MECHANICS are the core store's
 * (`lib/cost.js`), which takes an injected `fs` so it stays loadable from the
 * browser bundle; this wrapper supplies `node:fs` once, here, where the server
 * side is the only caller. Writes are atomic through the core (temp file +
 * rename), so a crash mid-write leaves the previous snapshot readable.
 *
 * @param {{ explicit?: string, profileDir?: string, dshHome?: string, fileName?: string }} options
 * @returns {{ path: string, read: () => object|null, write: (snapshot: object) => boolean }}
 */
export function createCostStore({ explicit, profileDir, dshHome, fileName = COST_FILE_NAME } = {}) {
  const path = resolveCatalogPath({ explicit, profileDir, dshHome, fileName })
  return createSharedStore({ path, fs: { mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } })
}
