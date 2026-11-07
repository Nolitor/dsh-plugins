/**
 * Usage binding and quota-window display.
 *
 * Binds one adapter usage record to the plan/cost layers:
 *   normalized tokens → catalog cost → billing outcome → `UsageReading[]`
 * (token buckets plus the plan's quota windows), following
 * `PLAN-AND-USAGE-SPEC.md` §2.2/§2.3.
 *
 * Display strings are locale-aware (`en`, `ko`); the raw `value`/`unit`/`window`
 * stay in the reading so a surface can render its own way. A reading that could
 * not be measured carries `confidence: 'unavailable'` and a reason — never 0.
 *
 * Pure module: no host context, no I/O.
 *
 * @module @nolit/dsh-custom-router/usage
 */
import { calculateCost, normalizeUsage } from './cost.js'
import { billingOutcome } from './plan.js'

/** Reading kinds (spec §2.2). */
export const READING_KINDS = Object.freeze([
  'percent-consumed',
  'fraction-remaining',
  'tokens',
  'usd-amount',
])

const WINDOW_ALIASES = Object.freeze({
  '5h': '5h',
  rolling: '5h',
  weekly: 'weekly',
  '7d': 'weekly',
  monthly: 'monthly',
  '30d': 'monthly',
  'per-request': 'per-request',
  quota: 'quota',
})

/** Map a provider window label to the normalised window id. */
export function normalizeWindow(label) {
  if (typeof label !== 'string') return null
  return WINDOW_ALIASES[label.toLowerCase()] ?? label
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
    const normalized = normalizeWindow(window.label)
    if (typeof window.percent === 'number') {
      readings.push(usageReading({
        service: meta.service ?? '',
        source: `plan.${window.label}.percent`,
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
        source: `plan.${window.label}.remainingFraction`,
        kind: 'fraction-remaining',
        value: window.remainingFraction,
        unit: 'fraction',
        window: normalized,
        scope: 'plan',
        limited: window.limited ?? null,
        resetsAt: window.resetsAt ?? null,
        measuredAt: meta.measuredAt,
      }))
    }
  }
  return readings
}

/**
 * Bind one usage record to the plan and cost layers.
 * @param {object} input - `{preset, usage, verdict, modelCost?, locale?}`.
 * @returns {{usage: object, cost: object|undefined, billing: object, readings: object[]}} the bound record.
 */
export function bindUsage({ preset, usage, verdict, modelCost, locale = 'en' } = {}) {
  const normalized = normalizeUsage(usage ?? {})
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
  return { usage: normalized, cost, billing, readings }
}
