/**
 * Cost calculation — the router's own arithmetic, because the DSH wrapper drops
 * pi-ai's `usage.cost` (measured 2026-11-07: `mapUsage()` forwards tokens only,
 * and `NO_COST` stands in for models the installed catalog does not describe).
 *
 * The formula mirrors upstream `@earendil-works/pi-ai` `calculateCost()`:
 *   - rates are US$ per 1,000,000 tokens;
 *   - tiers apply by total input tokens (`input + cacheRead + cacheWrite`);
 *   - a 1-hour cache write bills at 2x the input rate (Anthropic), the rest at
 *     the plain cache-write rate;
 *   - `total` is the sum of the four buckets.
 *
 * The second half of this module is the SHARED spending ledger: the union of the
 * two adapters' ledgers, so the router can report billed vs list cost, plan
 * allowance, and a per-model / per-source split without either copy.
 * The bucket normalizer tolerates BOTH recorded cache conventions:
 *
 *   convention A (undifferentiated):
 *     tokens: { input, output, reasoning, cacheRead, cacheWrite }
 *   convention B (explicit TTL split):
 *     tokens: { input, output, reasoning, cacheRead,
 *               cacheWrite5m, cacheWrite1h }
 *
 * Canonical buckets are B's split (`TOKEN_BUCKETS`); a plain `cacheWrite` total
 * is folded into `cacheWrite5m` with `cacheWrite1h: 0`, so the sum of the two
 * always equals the reported write total.
 *
 * PHASE-2 DELETIONS this module replaces (targets recorded here so the cut is a
 * one-line lookup; not yet performed, because both adapters still call their own
 * copies from their streaming paths):
 *   - `vendor/deepinfra/lib/cost.js:166-314`  (createCostLedger + pickSession)
 *   - `vendor/opencode/lib/cost.js:142-288`   (createCostLedger + shared registry)
 * The store half (`createCostStore`) replaces the read/write pair duplicated at
 * `vendor/deepinfra/lib/cost.js:367-391` and `vendor/opencode/lib/cost.js:356-381`.
 *
 * Pure module: no host context, no provider-specific vocabulary, no I/O of its
 * own. The store takes an injected `fs` adapter instead of importing `node:fs`,
 * so this module stays loadable from the browser bundle (`lib/usage.js` imports
 * it) and testable without touching a real path.
 *
 * @module @nolit/dsh-custom-router/cost
 */

const RATE_FIELDS = Object.freeze(['input', 'output', 'cacheRead', 'cacheWrite'])

/** Canonical ledger token buckets (the union of both vendors' recorded shapes). */
export const TOKEN_BUCKETS = Object.freeze([
  'input',
  'output',
  'reasoning',
  'cacheRead',
  'cacheWrite5m',
  'cacheWrite1h',
])

/** Persisted-ledger schema version, so a reader can migrate instead of guess. */
export const LEDGER_VERSION = 1

/** Newest per-request rows kept for the spend panel. */
const RECENT_LIMIT = 200

/** Idempotency keys remembered per session (bounded, oldest evicted). */
const EVENT_KEYS_LIMIT = 500

/**
 * Normalize a usage record without inventing values.
 * @param {object} usage - raw usage (`input`, `output`, optional cache fields).
 * @returns {{input: number, output: number, cacheRead: number, cacheWrite: number, cacheWrite1h: number}} canonical usage.
 */
export function normalizeUsage(usage = {}) {
  const number = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : 0)
  const input = number(usage.input ?? usage.inputTokens)
  const output = number(usage.output ?? usage.outputTokens)
  const cacheRead = number(usage.cacheRead ?? usage.cacheReadTokens)
  const cacheWrite = number(usage.cacheWrite ?? usage.cacheWriteTokens)
  const cacheWrite1h = Math.min(number(usage.cacheWrite1h), cacheWrite)
  return { input, output, cacheRead, cacheWrite, cacheWrite1h }
}

/**
 * Pick the applicable rate record for a usage total.
 * @param {object} cost - model cost record with base rates and optional tiers.
 * @param {number} inputTokens - total input tokens (input + cacheRead + cacheWrite).
 * @returns {object} the rate record to bill against.
 */
export function ratesFor(cost, inputTokens) {
  let rates = cost
  let matchedThreshold = -1
  for (const tier of cost.tiers ?? []) {
    if (inputTokens > tier.inputTokensAbove && tier.inputTokensAbove > matchedThreshold) {
      rates = tier
      matchedThreshold = tier.inputTokensAbove
    }
  }
  return rates
}

/**
 * Calculate the cost of one usage record.
 * @param {object} cost - model cost record (`input`, `output`, `cacheRead`, `cacheWrite`, optional `tiers`).
 * @param {object} usage - usage record (see {@link normalizeUsage}).
 * @returns {{input: number, output: number, cacheRead: number, cacheWrite: number, total: number, totalFromProvider: false}} cost in US$.
 * @throws {TypeError} when the cost record is missing base rates.
 */
export function calculateCost(cost, usage = {}) {
  if (cost === null || typeof cost !== 'object') throw new TypeError('calculateCost requires a model cost record')
  for (const field of RATE_FIELDS) {
    if (typeof cost[field] !== 'number' || !Number.isFinite(cost[field]) || cost[field] < 0) {
      throw new TypeError(`calculateCost: cost.${field} must be a non-negative number`)
    }
  }
  const canonical = normalizeUsage(usage)
  const inputTokens = canonical.input + canonical.cacheRead + canonical.cacheWrite
  const rates = ratesFor(cost, inputTokens)
  const longWrite = canonical.cacheWrite1h
  const shortWrite = canonical.cacheWrite - longWrite

  const input = (rates.input / 1_000_000) * canonical.input
  const output = (rates.output / 1_000_000) * canonical.output
  const cacheRead = (rates.cacheRead / 1_000_000) * canonical.cacheRead
  const cacheWrite = (rates.cacheWrite * shortWrite + rates.input * 2 * longWrite) / 1_000_000
  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    total: input + output + cacheRead + cacheWrite,
    totalFromProvider: false,
  }
}

/* ------------------------------------------------------------------ *
 * Shared helpers the two vendored ledgers duplicate
 * ------------------------------------------------------------------ */

/**
 * Read a finite number, or null.
 *
 * `0` is a real answer ("this was free", "nothing counted toward the plan"), so
 * only a missing or unusable value becomes null.
 *
 * @param {unknown} value - wire or persisted value.
 * @returns {number|null} the number, or null when absent/not finite.
 */
export function numberOrNull(value) {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Clamp a possibly-absent counter to a non-negative finite number.
 * @param {unknown} value - counter.
 * @param {number} [max] - optional upper bound.
 * @returns {number} the clamped value (`0` when unusable).
 */
function countOf(value, max = Number.POSITIVE_INFINITY) {
  const n = numberOrNull(value)
  if (n === null || n < 0) return 0
  return Math.min(n, max)
}

/**
 * Normalize a token record from EITHER vendor's convention.
 *
 * Accepts camelCase (ledger rows, wire `usage`) and snake_case (recorded
 * fixtures) aliases, clamps every bucket to a non-negative finite number, and
 * reconciles the cache-write split:
 *   - plain `cacheWrite` given → `cacheWrite1h` is clamped to it and the
 *     remainder becomes `cacheWrite5m`;
 *   - only `cacheWrite5m` / `cacheWrite1h` given → they are kept as-is;
 *   - `cacheWrite1h` exceeding the reported total is clamped, never negative.
 *
 * @param {object} tokens - token record in either convention.
 * @returns {{input: number, output: number, reasoning: number, cacheRead: number, cacheWrite5m: number, cacheWrite1h: number}} canonical buckets.
 */
export function normalizeBuckets(tokens = {}) {
  const raw = tokens !== null && typeof tokens === 'object' ? tokens : {}
  const read = (...keys) => {
    for (const key of keys) {
      const value = numberOrNull(raw[key])
      if (value !== null) return value
    }
    return null
  }
  const writeTotal = read('cacheWrite', 'cacheWriteTokens', 'cache_write', 'cache_write_tokens')
  const given5m = read('cacheWrite5m', 'cache_write_5m', 'cacheWrite5mTokens')
  const given1h = read('cacheWrite1h', 'cache_write_1h', 'cacheWrite1hTokens')

  let write1h = countOf(given1h)
  let write5m
  if (writeTotal === null) {
    write5m = countOf(given5m)
  } else {
    const total = countOf(writeTotal)
    write1h = countOf(write1h, total)
    write5m = given5m === null ? total - write1h : countOf(given5m, total - write1h)
  }
  return {
    input: countOf(read('input', 'inputTokens', 'input_tokens', 'prompt')),
    output: countOf(read('output', 'outputTokens', 'output_tokens', 'completion')),
    reasoning: countOf(read('reasoning', 'reasoningTokens', 'reasoning_tokens')),
    cacheRead: countOf(read('cacheRead', 'cacheReadTokens', 'cache_read', 'cache_read_tokens')),
    cacheWrite5m: write5m,
    cacheWrite1h: write1h,
  }
}

/**
 * The combined cache-write total of a canonical bucket record.
 * @param {object} buckets - output of {@link normalizeBuckets}.
 * @returns {number} `cacheWrite5m + cacheWrite1h`.
 */
export function cacheWriteTotal(buckets) {
  return countOf(buckets?.cacheWrite5m) + countOf(buckets?.cacheWrite1h)
}

/**
 * Pick the session whose spend describes the screen.
 *
 * Exact id first (with or without the `session-` prefix), then the most recently
 * active session. An exact-only match reports nothing for a live conversation
 * whose DOM carries a different id (measured 2026-11-04, both vendors).
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

/* ------------------------------------------------------------------ *
 * Shared spending ledger
 * ------------------------------------------------------------------ */

/**
 * A zeroed canonical bucket record.
 * @param {readonly string[]} buckets - bucket names to allocate.
 * @returns {Record<string, number>} zeros.
 */
function zeroBuckets(buckets) {
  const out = {}
  for (const bucket of buckets) out[bucket] = 0
  return out
}

/** A zeroed spend partition (one model, one turn, or one source). */
function zeroPartition(buckets) {
  return {
    requests: 0,
    costUsd: 0,
    listCostUsd: 0,
    allowanceUsd: 0,
    tokens: zeroBuckets(buckets),
  }
}

/** The zeroed per-session accumulator. */
function zeroTotals(buckets) {
  return {
    requests: 0,
    // costUsd     = what the provider charged (discount already applied)
    // listCostUsd = the same tokens at catalog list price, before promotion
    costUsd: 0,
    listCostUsd: 0,
    allowanceUsd: 0,
    pricedRequests: 0,
    unpricedRequests: 0,
    estimatedRequests: 0,
    byModel: {},
    bySource: {},
    turns: {},
    tokens: zeroBuckets(buckets),
    lastBillingSource: null,
    firstAt: null,
    lastAt: null,
  }
}

/**
 * Fold a cost record into one partition.
 * @param {object} target - partition to mutate.
 * @param {object} cost - parsed cost record.
 * @param {readonly string[]} buckets - bucket names.
 * @returns {void}
 */
function addToPartition(target, cost, buckets) {
  target.requests += 1
  if (typeof cost.costUsd === 'number') target.costUsd += cost.costUsd
  if (typeof cost.listCostUsd === 'number') target.listCostUsd += cost.listCostUsd
  if (cost.planSource === true && typeof cost.allowanceUsd === 'number') target.allowanceUsd += cost.allowanceUsd
  if (cost.tokens !== null && cost.tokens !== undefined) {
    for (const bucket of buckets) target.tokens[bucket] = (target.tokens[bucket] ?? 0) + (cost.tokens[bucket] ?? 0)
  }
}

/**
 * Additively fold one persisted session row into a target accumulator.
 *
 * Tolerates BOTH recorded row shapes: adapter A's rows (`costUsd`, `listCostUsd`,
 * `byModel`, `turns`, `tokens.cacheWrite`) and adapter B's rows (`allowanceUsd`,
 * `bySource` as a count map, `tokens.cache_write_5m`). Unknown keys are ignored
 * rather than copied, so a merged ledger never carries a vendor's private field.
 *
 * @param {object} target - session totals to mutate.
 * @param {object} row - persisted session row (either vendor's).
 * @param {readonly string[]} buckets - bucket names.
 * @returns {void}
 */
function mergeSessionRow(target, row, buckets) {
  target.requests += countOf(row.requests)
  target.costUsd += countOf(row.costUsd)
  target.listCostUsd += countOf(row.listCostUsd)
  target.allowanceUsd += countOf(row.allowanceUsd)
  target.pricedRequests += countOf(row.pricedRequests)
  target.unpricedRequests += countOf(row.unpricedRequests)
  target.estimatedRequests += countOf(row.estimatedRequests)
  if (typeof row.lastBillingSource === 'string') target.lastBillingSource = row.lastBillingSource

  const first = numberOrNull(row.firstAt)
  if (first !== null) target.firstAt = target.firstAt === null ? first : Math.min(target.firstAt, first)
  const last = numberOrNull(row.lastAt)
  if (last !== null) target.lastAt = target.lastAt === null ? last : Math.max(target.lastAt, last)

  const bucketsIn = normalizeBuckets(row.tokens)
  for (const bucket of buckets) target.tokens[bucket] = (target.tokens[bucket] ?? 0) + bucketsIn[bucket]

  for (const [model, value] of Object.entries(row.byModel ?? {})) {
    if (value === null || typeof value !== 'object') continue
    const partition = target.byModel[model] ?? (target.byModel[model] = zeroPartition(buckets))
    partition.requests += countOf(value.requests)
    partition.costUsd += countOf(value.costUsd)
    partition.listCostUsd += countOf(value.listCostUsd)
    partition.allowanceUsd += countOf(value.allowanceUsd)
    const modelBuckets = normalizeBuckets(value.tokens)
    for (const bucket of buckets) partition.tokens[bucket] = (partition.tokens[bucket] ?? 0) + modelBuckets[bucket]
  }

  for (const [turn, value] of Object.entries(row.turns ?? {})) {
    if (value === null || typeof value !== 'object') continue
    const partition = target.turns[turn] ?? (target.turns[turn] = zeroPartition(buckets))
    partition.requests += countOf(value.requests)
    partition.costUsd += countOf(value.costUsd)
    partition.listCostUsd += countOf(value.listCostUsd)
    partition.allowanceUsd += countOf(value.allowanceUsd)
    const turnBuckets = normalizeBuckets(value.tokens)
    for (const bucket of buckets) partition.tokens[bucket] = (partition.tokens[bucket] ?? 0) + turnBuckets[bucket]
  }

  // `bySource` is a plain count map in the older ledger and a spend partition here;
  // a legacy number is read as "that many requests, cost unknown".
  for (const [source, value] of Object.entries(row.bySource ?? {})) {
    const partition = target.bySource[source] ?? (target.bySource[source] = zeroPartition(buckets))
    if (typeof value === 'number') {
      partition.requests += countOf(value)
      continue
    }
    if (value === null || typeof value !== 'object') continue
    partition.requests += countOf(value.requests)
    partition.costUsd += countOf(value.costUsd)
    partition.listCostUsd += countOf(value.listCostUsd)
    partition.allowanceUsd += countOf(value.allowanceUsd)
    const sourceBuckets = normalizeBuckets(value.tokens)
    for (const bucket of buckets) partition.tokens[bucket] = (partition.tokens[bucket] ?? 0) + sourceBuckets[bucket]
  }
}

/**
 * Identity of one persisted snapshot, so re-merging it is a no-op.
 * @param {object} snapshot - persisted ledger.
 * @returns {string} `savedAt` when recorded, otherwise a structural fingerprint.
 */
function snapshotIdentity(snapshot) {
  if (typeof snapshot?.snapshotId === 'string' && snapshot.snapshotId.length > 0) return snapshot.snapshotId
  if (typeof snapshot?.savedAt === 'string' && snapshot.savedAt.length > 0) return 'saved:' + snapshot.savedAt
  const rows = snapshot?.sessions ?? {}
  const parts = Object.keys(rows).sort()
  let requests = 0
  let cost = 0
  for (const id of parts) {
    requests += countOf(rows[id]?.requests)
    cost += countOf(rows[id]?.costUsd)
  }
  return `shape:${parts.length}:${requests}:${cost}`
}

/**
 * Create the per-session spending ledger.
 *
 * Keyed by DSH session id, partitioned by MODEL and by BILLING SOURCE, with an
 * optional TURN partition (a turn that makes several model calls is still one
 * turn's cost). Records are idempotent: re-reporting the same `eventId` for a
 * session never bills it twice.
 *
 * Restart safety lives outside: `snapshot()` → `createCostStore().write()`, and
 * `merge()` on the way back in. The merge is additive AND idempotent, so two
 * adapters in one process can share one persisted file without erasing rows.
 *
 * @param {{ now?: () => number, buckets?: readonly string[] }} [options] - clock and bucket seams.
 * @returns {object} the ledger.
 */
export function createCostLedger({ now = Date.now, buckets = TOKEN_BUCKETS } = {}) {
  const names = Array.isArray(buckets) && buckets.length > 0 ? [...buckets] : [...TOKEN_BUCKETS]
  /** @type {Map<string, object>} */
  const sessions = new Map()
  /** @type {Map<string, Set<string>>} idempotency keys per session */
  const eventKeys = new Map()
  /** @type {Set<string>} snapshots already folded in */
  const mergedSnapshots = new Set()
  /** @type {Array<object>} recent per-request rows, newest last (bounded) */
  const recent = []

  const totalsOf = (sessionId) => {
    let totals = sessions.get(sessionId)
    if (totals === undefined) {
      totals = zeroTotals(names)
      sessions.set(sessionId, totals)
    }
    return totals
  }

  const rememberEvent = (sessionId, key) => {
    let keys = eventKeys.get(sessionId)
    if (keys === undefined) {
      keys = new Set()
      eventKeys.set(sessionId, keys)
    }
    if (keys.has(key)) return false
    keys.add(key)
    while (keys.size > EVENT_KEYS_LIMIT) {
      const oldest = keys.values().next().value
      keys.delete(oldest)
    }
    return true
  }

  /**
   * Record one completed request.
   * @param {string} sessionId - DSH session id.
   * @param {string} model - the exact route on the wire.
   * @param {object} cost - parsed cost record (`costUsd`, `listCostUsd`, `allowanceUsd`, `billingSource`, `planSource`, `estimated`, `tokens`).
   * @param {{ turn?: number, eventId?: string, source?: string }} [options] - turn partition, idempotency key, billing source.
   * @returns {{sessionId: string, model: string, duplicate: boolean, totals: object}} the session totals after the record.
   */
  const record = (sessionId, model, cost = {}, options = {}) => {
    const id = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : '(no session)'
    const route = typeof model === 'string' && model.length > 0 ? model : '(no model)'
    const eventId = typeof cost?.eventId === 'string' ? cost.eventId : options.eventId
    if (typeof eventId === 'string' && eventId.length > 0 && !rememberEvent(id, eventId)) {
      return { sessionId: id, model: route, duplicate: true, totals: totalsOf(id) }
    }

    const source = typeof cost?.billingSource === 'string' && cost.billingSource.length > 0
      ? cost.billingSource
      : (typeof options.source === 'string' && options.source.length > 0 ? options.source : null)
    const at = now()
    const totals = totalsOf(id)
    totals.requests += 1
    totals.lastAt = at
    if (totals.firstAt === null) totals.firstAt = at
    if (source !== null) totals.lastBillingSource = source

    const billed = numberOrNull(cost?.costUsd)
    if (billed === null) totals.unpricedRequests += 1
    else {
      totals.pricedRequests += 1
      totals.costUsd += billed
    }
    const listed = numberOrNull(cost?.listCostUsd)
    if (listed !== null) totals.listCostUsd += listed
    const allowance = numberOrNull(cost?.allowanceUsd)
    if (cost?.planSource === true && allowance !== null) totals.allowanceUsd += allowance
    if (cost?.estimated === true) totals.estimatedRequests += 1
    if (source !== null) {
      const perSource = totals.bySource[source] ?? (totals.bySource[source] = zeroPartition(names))
      perSource.requests += 1
      if (billed !== null) perSource.costUsd += billed
      if (listed !== null) perSource.listCostUsd += listed
      if (cost?.planSource === true && allowance !== null) perSource.allowanceUsd += allowance
    }

    const canonical = cost?.tokens === null || cost?.tokens === undefined ? null : normalizeBuckets(cost.tokens)
    const perModel = totals.byModel[route] ?? (totals.byModel[route] = zeroPartition(names))
    perModel.requests += 1
    if (billed !== null) perModel.costUsd += billed
    if (listed !== null) perModel.listCostUsd += listed
    if (cost?.planSource === true && allowance !== null) perModel.allowanceUsd += allowance
    if (source !== null) {
      const perSource = totals.bySource[source]
      if (canonical !== null) {
        for (const bucket of names) perSource.tokens[bucket] = (perSource.tokens[bucket] ?? 0) + canonical[bucket]
      }
    }
    if (canonical !== null) {
      for (const bucket of names) {
        totals.tokens[bucket] = (totals.tokens[bucket] ?? 0) + canonical[bucket]
        perModel.tokens[bucket] = (perModel.tokens[bucket] ?? 0) + canonical[bucket]
      }
    }

    // The per-turn partition: a turn may make several calls (tool loop), and the
    // operator asked for the split by turn, not only by session.
    const turnKey = Number.isInteger(options.turn) && options.turn >= 0 ? String(options.turn) : 'unassigned'
    const perTurn = totals.turns[turnKey] ?? (totals.turns[turnKey] = zeroPartition(names))
    perTurn.requests += 1
    if (billed !== null) perTurn.costUsd += billed
    if (listed !== null) perTurn.listCostUsd += listed
    if (cost?.planSource === true && allowance !== null) perTurn.allowanceUsd += allowance
    if (canonical !== null) {
      for (const bucket of names) perTurn.tokens[bucket] = (perTurn.tokens[bucket] ?? 0) + canonical[bucket]
    }

    recent.push({
      at,
      sessionId: id,
      model: route,
      turn: turnKey,
      eventId: typeof eventId === 'string' ? eventId : null,
      costUsd: billed,
      listCostUsd: listed,
      allowanceUsd: allowance,
      costSource: cost?.costSource ?? null,
      billingSource: source,
      tokens: canonical,
    })
    if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT)

    return { sessionId: id, model: route, duplicate: false, totals }
  }

  const entryOf = (sessionId) => {
    const totals = sessions.get(sessionId)
    return totals === undefined ? null : { sessionId, ...totals }
  }

  return {
    /** Canonical bucket names this ledger accumulates. */
    buckets: Object.freeze(names),
    record,
    session: entryOf,
    /**
     * Aggregate every session, newest activity first.
     * @returns {object} totals + `bySession` + the newest request rows.
     */
    summary() {
      const bySession = []
      let costUsd = 0
      let listCostUsd = 0
      let allowanceUsd = 0
      let requests = 0
      for (const [sessionId, totals] of sessions) {
        costUsd += totals.costUsd
        listCostUsd += totals.listCostUsd
        allowanceUsd += totals.allowanceUsd
        requests += totals.requests
        bySession.push({ sessionId, ...totals })
      }
      bySession.sort((left, right) => (right.lastAt ?? 0) - (left.lastAt ?? 0))
      return {
        sessions: bySession.length,
        requests,
        costUsd,
        listCostUsd,
        allowanceUsd,
        bySession,
        recent: recent.slice(-50).reverse(),
      }
    },
    /**
     * The persistable state.
     * @returns {object} `{ version, buckets, sessions, recent, savedAt }`.
     */
    snapshot() {
      const out = {}
      for (const [sessionId, totals] of sessions) out[sessionId] = totals
      return {
        version: LEDGER_VERSION,
        buckets: names,
        sessions: out,
        recent: recent.slice(-RECENT_LIMIT),
        savedAt: new Date(now()).toISOString(),
      }
    },
    /**
     * Fold a persisted snapshot in, additively and exactly once.
     *
     * Used both for restart recovery and for sharing one spend file between two
     * adapters: the same snapshot merged twice changes nothing.
     *
     * @param {object} snapshot - output of {@link snapshot} or a vendor's ledger file.
     * @returns {{merged: boolean, key: string, sessions: number}} the outcome.
     */
    merge(snapshot) {
      if (snapshot === null || typeof snapshot !== 'object') return { merged: false, key: '', sessions: 0 }
      const key = snapshotIdentity(snapshot)
      if (mergedSnapshots.has(key)) return { merged: false, key, sessions: sessions.size }
      mergedSnapshots.add(key)
      const rows = snapshot.sessions !== null && typeof snapshot.sessions === 'object' ? snapshot.sessions : {}
      for (const [sessionId, row] of Object.entries(rows)) {
        if (typeof sessionId !== 'string' || sessionId.length === 0) continue
        if (row === null || typeof row !== 'object') continue
        mergeSessionRow(totalsOf(sessionId), row, names)
      }
      if (Array.isArray(snapshot.recent)) {
        for (const row of snapshot.recent) {
          if (row === null || typeof row !== 'object') continue
          recent.push({
            at: numberOrNull(row.at) ?? 0,
            sessionId: typeof row.sessionId === 'string' ? row.sessionId : '(no session)',
            model: typeof row.model === 'string' ? row.model : '(no model)',
            turn: typeof row.turn === 'string' ? row.turn : 'unassigned',
            eventId: typeof row.eventId === 'string' ? row.eventId : null,
            costUsd: numberOrNull(row.costUsd),
            listCostUsd: numberOrNull(row.listCostUsd),
            allowanceUsd: numberOrNull(row.allowanceUsd),
            costSource: row.costSource ?? null,
            billingSource: row.billingSource ?? null,
            tokens: row.tokens === null || row.tokens === undefined ? null : normalizeBuckets(row.tokens),
          })
        }
        if (recent.length > RECENT_LIMIT) recent.splice(0, recent.length - RECENT_LIMIT)
      }
      return { merged: true, key, sessions: sessions.size }
    },
    /**
     * Drop one session, or everything when no id is given.
     * @param {string} [sessionId] - session to forget.
     * @returns {void}
     */
    reset(sessionId) {
      if (sessionId === undefined) {
        sessions.clear()
        eventKeys.clear()
        mergedSnapshots.clear()
        recent.length = 0
      } else {
        sessions.delete(sessionId)
        eventKeys.delete(sessionId)
      }
    },
  }
}

/* ------------------------------------------------------------------ *
 * Persisted ledger store
 * ------------------------------------------------------------------ */

/**
 * Reader/writer pair for the persisted ledger.
 *
 * The `fs` adapter is injected (default `null` = in-memory only) so this module
 * carries no `node:fs` import: the browser bundle imports it through
 * `lib/usage.js`, where a filesystem does not exist.
 *
 * Writes are atomic: a sibling temp file is written and renamed over the target,
 * so a crash mid-write leaves the previous snapshot readable instead of a
 * truncated JSON file. The vendors' 1-second debounced timer is deliberately
 * NOT reproduced — measured 2026-11-05, a one-turn headless run exits before the
 * timer fires and the bill silently disappears.
 *
 * @param {{ path?: string, fs?: object|null, now?: () => number, tmpSuffix?: () => string }} [options] - store seams.
 * @returns {{ path: string, read: () => (object|null), write: (snapshot: object) => boolean }}
 */
export function createCostStore({ path, fs = null, now = Date.now } = {}) {
  const target = typeof path === 'string' && path.length > 0 ? path : ''
  const sep = Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'))
  const dir = sep > 0 ? target.slice(0, sep) : ''
  let counter = 0

  const usable = (name) => fs !== null && typeof fs?.[name] === 'function'

  return {
    path: target,
    /**
     * Read the last persisted snapshot.
     * @returns {object|null} the snapshot, or null when missing/corrupt.
     */
    read() {
      if (target === '' || !usable('readFileSync')) return null
      try {
        const raw = JSON.parse(fs.readFileSync(target, 'utf8'))
        return raw !== null && typeof raw === 'object' && raw.sessions !== null && typeof raw.sessions === 'object'
          ? raw
          : null
      } catch {
        // Missing or corrupt state is "nothing measured yet", never a crash.
        return null
      }
    },
    /**
     * Persist a snapshot atomically.
     * @param {object} snapshot - output of ledger `snapshot()`.
     * @returns {boolean} whether the write landed.
     */
    write(snapshot) {
      if (target === '' || !usable('writeFileSync')) return false
      const body = JSON.stringify(snapshot, null, 2) + '\n'
      const tmp = `${target}.${counter++}.${now()}.tmp`
      try {
        if (dir !== '' && usable('mkdirSync')) fs.mkdirSync(dir, { recursive: true })
        fs.writeFileSync(tmp, body)
        if (usable('renameSync')) {
          fs.renameSync(tmp, target)
        } else {
          fs.writeFileSync(target, body)
          if (usable('unlinkSync')) fs.unlinkSync(tmp)
        }
        return true
      } catch {
        try {
          if (usable('unlinkSync')) fs.unlinkSync(tmp)
        } catch {
          // A temp file that cannot be removed is not worth masking the failure.
        }
        return false
      }
    },
  }
}
