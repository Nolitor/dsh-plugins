/**
 * Usage binding, per-session baseline accounting, and quota-window display.
 *
 * Binds one adapter usage record to the plan/cost layers:
 *   normalized tokens → catalog cost → billing outcome → `UsageReading[]`
 * (token buckets plus the plan's quota windows), following
 * `PLAN-AND-USAGE-SPEC.md` §2.2/§2.3.
 *
 * It also owns the per-session **baseline** seam. Providers report usage two
 * ways and neither is one request's usage on its own:
 *   - a step/event total is that generation's own tokens;
 *   - a session's cumulative counters only grow, so reporting them raw inflates
 *     every later request of a long-lived session (the hundredth generation
 *     carries all hundred).
 * `createUsageBaseline()` keeps what has already been reported per session, so a
 * cumulative snapshot yields only its growth. `createUsageLedger()` composes that
 * baseline with the cost ledger from `lib/cost.js`, so one report advances the
 * token baseline AND bills the delta exactly once.
 *
 * Display strings are locale-aware (`en`, `ko`); the raw `value`/`unit`/`window`
 * stay in the reading so a surface can render its own way. A reading that could
 * not be measured carries `confidence: 'unavailable'` and a reason — never 0.
 *
 * Pure module: no host context, no I/O.
 *
 * @module @nolit/dsh-custom-router/usage
 */
import { calculateCost, normalizeBuckets, normalizeUsage } from './cost.js'
import { billingOutcome, normalizeWindow } from './plan.js'

// `normalizeWindow` is defined once in `lib/plan.js` (the plan layer owns the
// window vocabulary) and re-exported here because callers have always reached it
// through this module.
export { normalizeWindow }

/** Reading kinds (spec §2.2). */
export const READING_KINDS = Object.freeze([
  'percent-consumed',
  'fraction-remaining',
  'tokens',
  'usd-amount',
])

/**
 * The usage bucket names the adapters report (host vocabulary).
 *
 * These are NOT the canonical cost buckets (`lib/cost.js` `TOKEN_BUCKETS`): the
 * host names the five adapter buckets, the cost layer splits cache-write by TTL.
 * `normalizeBuckets()` accepts both, so this is a reporting vocabulary only.
 */
export const USAGE_BUCKETS = Object.freeze([
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
])

/**
 * A zeroed usage record in the host vocabulary.
 * @returns {Record<string, number>} every bucket at zero, plus `totalTokens`.
 */
export function emptyUsage() {
  const usage = {}
  for (const bucket of USAGE_BUCKETS) usage[bucket] = 0
  usage.totalTokens = 0
  return usage
}

/**
 * Sum the buckets of one usage record.
 * @param {Record<string, number>} usage - bucket record (partial is fine).
 * @returns {number} the total across `USAGE_BUCKETS`.
 */
export function usageTotal(usage) {
  let total = 0
  for (const bucket of USAGE_BUCKETS) {
    const value = usage?.[bucket]
    total += typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0
  }
  return total
}

/**
 * Build one usage reading with a locale-aware display string.
 * @param {object} input - reading fields.
 * @returns {object} the reading.
 */
export function usageReading(input = {}) {
  const kind = input.kind ?? 'tokens'
  const value = typeof input.value === 'number' && Number.isFinite(input.value) ? input.value : 0
  const reading = {
    service: input.service ?? '',
    source: input.source ?? '',
    kind,
    value,
    unit: input.unit ?? (kind === 'percent-consumed' ? '%' : kind === 'fraction-remaining' ? 'fraction' : kind === 'usd-amount' ? 'USD' : 'tokens'),
    window: input.window ?? null,
    scope: input.scope ?? 'account',
    limited: input.limited ?? null,
    resetsAt: input.resetsAt ?? null,
    display: input.display ?? '',
    measuredAt: input.measuredAt ?? Date.now(),
    confidence: input.confidence ?? 'measured',
    ...(input.unavailableReason === undefined ? {} : { unavailableReason: input.unavailableReason }),
  }
  if (reading.display === '') reading.display = formatReading(reading, input.locale ?? 'en')
  return reading
}

/**
 * Render one reading.
 * @param {object} reading - reading record.
 * @param {'en'|'ko'} [locale] - display language.
 * @returns {string} display text.
 */
export function formatReading(reading, locale = 'en') {
  const ko = locale === 'ko'
  if (reading.confidence === 'unavailable') {
    return ko ? `${reading.service}: 사용량 미확인 (${reading.unavailableReason ?? '원인 미상'})` : `${reading.service}: usage unavailable (${reading.unavailableReason ?? 'unknown reason'})`
  }
  const label = reading.window && reading.window !== 'per-request' ? `${reading.window} ` : ''
  switch (reading.kind) {
    case 'percent-consumed':
      return ko ? `${label}${reading.value}% 사용` : `${label}${reading.value}% used`
    case 'fraction-remaining':
      return ko ? `${label}${Math.round(reading.value * 100)}% 남음` : `${label}${Math.round(reading.value * 100)}% remaining`
    case 'usd-amount':
      return ko ? `${label}$${reading.value.toFixed(4)}` : `${label}$${reading.value.toFixed(4)}`
    case 'tokens':
    default:
      return ko ? `토큰 ${reading.value}` : `${reading.value} tokens`
  }
}

/**
 * Token readings for one usage record (disjoint buckets).
 * @param {object} usage - normalized usage.
 * @param {{service: string, source: string}} meta - attribution.
 * @returns {object[]} readings.
 */
export function tokenReadings(usage, meta = {}) {
  const buckets = [
    ['input', usage.input],
    ['output', usage.output],
    ['cacheRead', usage.cacheRead],
    ['cacheWrite', usage.cacheWrite],
  ].filter(([, value]) => value > 0)
  return buckets.map(([bucket, value]) => usageReading({
    service: meta.service,
    source: `${meta.source ?? 'usage'}.${bucket}`,
    kind: 'tokens',
    value,
    unit: 'tokens',
    window: 'per-request',
    scope: 'request',
    confidence: 'measured',
  }))
}

/**
 * Quota readings from a PlanVerdict's windows.
 * @param {object[]} windows - `{label, percent?, remainingFraction?, limited?, resetsAt?}`.
 * @param {{service?: string, measuredAt?: number}} [meta] - attribution.
 * @returns {object[]} readings.
 */
export function windowReadings(windows = [], meta = {}) {
  const readings = []
  for (const window of Array.isArray(windows) ? windows : []) {
    if (window === null || typeof window !== 'object') continue
    const normalized = normalizeWindow(window.label ?? window.id)
    if (typeof window.percent === 'number') {
      readings.push(usageReading({
        service: meta.service ?? '',
        source: `plan.${window.label ?? window.id}.percent`,
        kind: 'percent-consumed',
        value: window.percent,
        unit: '%',
        window: normalized,
        scope: 'plan',
        limited: window.limited ?? null,
        resetsAt: window.resetsAt ?? null,
        measuredAt: meta.measuredAt,
      }))
    } else if (typeof window.remainingFraction === 'number') {
      readings.push(usageReading({
        service: meta.service ?? '',
        source: `plan.${window.label ?? window.id}.remainingFraction`,
        kind: 'fraction-remaining',
        value: window.remainingFraction,
        unit: 'fraction',
        window: normalized,
        scope: 'plan',
        limited: window.limited ?? null,
        resetsAt: window.resetsAt ?? null,
        measuredAt: meta.measuredAt,
      }))
    } else if (window.declared === true) {
      // A DECLARED window (`usage.billing.windows`) exists but nothing has
      // measured it yet. It is surfaced as an unavailable reading with its own
      // reason, so a surface renders "not measured" instead of a missing bar.
      readings.push(usageReading({
        service: meta.service ?? '',
        source: `plan.${window.label}.declared`,
        kind: 'percent-consumed',
        value: 0,
        unit: '%',
        window: normalized,
        scope: window.scope ?? 'plan',
        confidence: 'unavailable',
        unavailableReason: 'window declared by the preset; no probe has measured it yet',
      }))
    }
  }
  return readings
}

/* ------------------------------------------------------------------ *
 * Per-session baseline (the seam every vendor copy implements)
 * ------------------------------------------------------------------ */

/**
 * Create the per-session usage baseline.
 *
 * The baseline is the usage already reported for one upstream session. It is
 * keyed by that session id, so two DSH sessions sharing one upstream session do
 * not report each other's tokens.
 *
 * @returns {object} the baseline.
 */
export function createUsageBaseline() {
  /** @type {Map<string, Record<string, number>>} */
  const baselines = new Map()

  const bucketOf = (sessionId) => {
    let baseline = baselines.get(sessionId)
    if (baseline === undefined) {
      baseline = emptyUsage()
      baselines.set(sessionId, baseline)
    }
    return baseline
  }
  const nonNegative = (value) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)

  return {
    /**
     * Report a generation measured by its own steps.
     *
     * The steps ARE the generation's tokens, so they are reported as they are;
     * the baseline advances by the same amount so a later cumulative snapshot
     * yields only what was added since.
     * @param {string} sessionId - upstream session id.
     * @param {Record<string, number>} usage - the generation's summed step usage.
     * @returns {Record<string, number>} the usage to report.
     */
    steps(sessionId, usage) {
      const baseline = bucketOf(sessionId)
      const reported = emptyUsage()
      for (const bucket of USAGE_BUCKETS) {
        const value = nonNegative(usage?.[bucket])
        baseline[bucket] += value
        reported[bucket] = value
      }
      reported.totalTokens = usageTotal(reported)
      return reported
    },

    /**
     * Report the growth of a session's cumulative counters.
     * @param {string} sessionId - upstream session id.
     * @param {Record<string, number>} cumulative - the session's cumulative usage.
     * @returns {Record<string, number>} the growth since the last report.
     */
    cumulative(sessionId, cumulative) {
      const baseline = bucketOf(sessionId)
      const delta = emptyUsage()
      for (const bucket of USAGE_BUCKETS) {
        const value = nonNegative(cumulative?.[bucket])
        delta[bucket] = Math.max(0, value - baseline[bucket])
        baseline[bucket] = Math.max(baseline[bucket], value)
      }
      delta.totalTokens = usageTotal(delta)
      return delta
    },

    /**
     * The usage already reported for one session.
     * @param {string} sessionId - upstream session id.
     * @returns {Record<string, number>} a copy of the baseline.
     */
    reported(sessionId) {
      return { ...bucketOf(sessionId) }
    },

    /**
     * Every session this baseline knows about.
     * @returns {string[]} session ids in first-seen order.
     */
    sessions() {
      return [...baselines.keys()]
    },

    /**
     * Forget one session's baseline, or every session when no id is given.
     * @param {string} [sessionId] - session to forget.
     * @returns {void}
     */
    forget(sessionId) {
      if (sessionId === undefined) baselines.clear()
      else baselines.delete(sessionId)
    },
  }
}

/* ------------------------------------------------------------------ *
 * Token ledger composed with the cost ledger
 * ------------------------------------------------------------------ */

/**
 * Create the per-session usage ledger: baseline + cost ledger in one report.
 *
 * This is the seam the vendor copies implement twice (`usage-ledger.js` for the
 * counters, the vendored cost module for the money). Composing them here is what
 * keeps the two from drifting: one `report()` advances the token baseline and
 * bills exactly the delta it produced, so a re-reported cumulative snapshot
 * neither double-counts tokens nor double-charges the account.
 *
 * @param {{costLedger?: object|null, baseline?: object, now?: () => number}} [options] - seams.
 * @returns {object} the ledger.
 */
export function createUsageLedger({ costLedger = null, baseline = null, now = Date.now } = {}) {
  const tracker = baseline ?? createUsageBaseline()

  return {
    /** The baseline tracker in use (injectable for tests / restart recovery). */
    baseline: tracker,
    /** The cost ledger this usage ledger bills into, or null. */
    costLedger,

    /**
     * Account one usage report.
     *
     * @param {object} input - `{sessionId, usage, mode?, model?, cost?, turn?, eventId?}`.
     *   `mode: 'cumulative'` treats `usage` as the session's cumulative counters
     *   and reports only the growth; the default `'steps'` reports it as-is.
     * @returns {{sessionId: string, mode: 'steps'|'cumulative', delta: object, tokens: object, total: number, baseline: object, recorded: object|null}} the report.
     */
    report({ sessionId, usage, mode = 'steps', model, cost = null, turn, eventId } = {}) {
      const id = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : '(no session)'
      const cumulative = mode === 'cumulative'
      const delta = cumulative ? tracker.cumulative(id, usage) : tracker.steps(id, usage)
      const tokens = normalizeBuckets(delta)
      const total = usageTotal(delta)
      let recorded = null
      if (costLedger !== null && typeof costLedger?.record === 'function' && typeof model === 'string' && model.length > 0) {
        recorded = costLedger.record(id, model, { ...(cost ?? {}), tokens, totalTokens: total }, { turn, eventId })
      }
      return { sessionId: id, mode: cumulative ? 'cumulative' : 'steps', delta, tokens, total, baseline: tracker.reported(id), recorded }
    },

    /**
     * Read back one session's already-reported usage.
     * @param {string} sessionId - session id.
     * @returns {Record<string, number>} the baseline.
     */
    reported(sessionId) {
      return tracker.reported(sessionId)
    },

    /**
     * Forget one session, or all of them.
     * @param {string} [sessionId] - session to forget.
     * @returns {void}
     */
    forget(sessionId) {
      tracker.forget(sessionId)
    },

    /**
     * The projection a surface renders: readings for the reported delta plus the
     * session's live cost totals.
     * @param {object} input - `{preset, sessionId, usage, mode?, verdict, modelCost?, locale?}`.
     * @returns {{readings: object[], billing: object, cost: object|undefined, tokens: object, total: number, totals: object|null}} the projection.
     */
    reading({ preset, sessionId, usage, mode = 'steps', verdict, modelCost, locale = 'en' } = {}) {
      const report = this.report({ sessionId, usage, mode })
      const bound = bindUsage({ preset, usage: report.delta, verdict, modelCost, locale })
      const totals = costLedger !== null && typeof costLedger?.session === 'function' ? costLedger.session(report.sessionId) : null
      return { readings: bound.readings, billing: bound.billing, cost: bound.cost, tokens: report.tokens, total: report.total, totals }
    },
  }
}

/**
 * Bind one usage record to the plan and cost layers.
 * @param {object} input - `{preset, usage, verdict, modelCost?, locale?, baseline?, sessionId?, mode?}`.
 *   When `baseline` is given, `usage` is accounted through it first, so a
 *   cumulative snapshot contributes only its growth.
 * @returns {{usage: object, cost: object|undefined, billing: object, readings: object[], delta?: object}} the bound record.
 */
export function bindUsage({ preset, usage, verdict, modelCost, locale = 'en', baseline = null, sessionId, mode = 'steps' } = {}) {
  const id = typeof sessionId === 'string' && sessionId.length > 0 ? sessionId : (preset?.id ?? '(no session)')
  // A baseline turns "the session so far" into "this generation", which is the
  // only reading that may be billed or displayed as one request's usage.
  const source = baseline === null
    ? usage
    : (mode === 'cumulative' ? baseline.cumulative(id, usage) : baseline.steps(id, usage))
  const normalized = normalizeUsage(source ?? {})
  const cost = modelCost === undefined ? undefined : calculateCost(modelCost, normalized)
  const billing = billingOutcome({ billing: preset?.usage?.billing, verdict, cost })
  const readings = [
    ...tokenReadings(normalized, { service: preset?.id ?? '', source: preset?.usage?.record ?? 'usage' }),
    ...windowReadings(verdict?.windows, { service: preset?.id ?? '', measuredAt: verdict?.measuredAt }),
  ]
  if (billing.confidence === 'unavailable') {
    readings.push(usageReading({
      service: preset?.id ?? '',
      source: preset?.usage?.record ?? 'usage',
      kind: 'usd-amount',
      value: 0,
      unit: 'USD',
      window: 'per-request',
      scope: 'request',
      confidence: 'unavailable',
      unavailableReason: billing.reason,
      locale,
    }))
  }
  return baseline === null
    ? { usage: normalized, cost, billing, readings }
    : { usage: normalized, cost, billing, readings, delta: source }
}
