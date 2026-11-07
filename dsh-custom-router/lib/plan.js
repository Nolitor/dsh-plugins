/**
 * Plan detection and billing outcome — the subscription/flat-rate half of the
 * usage layer.
 *
 * The contracts are the ones measured and written down in
 * `PLAN-AND-USAGE-SPEC.md`:
 *   - `PlanVerdict` (§1.4): declared (L1) / account (L2) / endpoint probe (L3),
 *     with `unknown` as a **visible** state — never a fabricated `0` or "no plan".
 *   - `usage.billing.mode` names the billing model: `subscription` (Antigravity,
 *     5h/weekly/monthly windows), `flat` (OpenCode go/zen, per-request allowance),
 *     `pay-per-token` (DeepInfra), `none` (loopback).
 *
 * Pure module: no host context, no I/O. The vendor plugins still own the actual
 * probes; this layer only judges and prices.
 *
 * @module @nolit/dsh-custom-router/plan
 */

const FAILED_PROBES = new Set(['auth-error', 'model-unavailable', 'overloaded'])
const SETTLED_PROBES = new Set(['ok', 'free-limit', 'throttled'])

/**
 * Assemble a PlanVerdict with every field explicit.
 * @param {object} input - measured facts.
 * @returns {object} the verdict.
 */
export function buildVerdict(input = {}) {
  const windows = Array.isArray(input.windows) ? input.windows : []
  const degraded = Array.isArray(input.degraded) ? input.degraded : []
  return {
    service: input.service ?? '',
    declaredPlan: input.declaredPlan ?? null,
    accountPlan: input.accountPlan ?? null,
    windows,
    billingSources: Array.isArray(input.billingSources) ? input.billingSources : [],
    endpointProbe: input.endpointProbe ?? 'skipped',
    verdict: input.verdict ?? 'unknown',
    measuredAt: input.measuredAt ?? Date.now(),
    degraded,
  }
}

/**
 * Judge the plan from the three detection layers (L3 probe > L2 account > L1 config).
 * @param {object} input - `{service, billing, declaredPlan?, accountPlan?, windows?, endpointProbe?, measuredAt?, degraded?}`.
 * @returns {object} a PlanVerdict.
 */
export function judgePlan(input = {}) {
  const billing = input.billing
  const windows = Array.isArray(input.windows) ? input.windows : []
  const declaredPlan = input.declaredPlan ?? null
  const accountPlan = input.accountPlan ?? null
  const endpointProbe = input.endpointProbe ?? 'skipped'
  const degraded = Array.isArray(input.degraded) ? input.degraded : []

  let verdict = 'unknown'
  if (!billing || billing.mode === 'none') {
    verdict = 'no-plan-service'
  } else if (FAILED_PROBES.has(endpointProbe)) {
    verdict = 'unknown'
  } else if (windows.some((window) => window?.limited === true)) {
    verdict = 'throttled'
  } else if (declaredPlan !== null && accountPlan !== null && declaredPlan !== accountPlan) {
    verdict = 'mismatch'
  } else if (SETTLED_PROBES.has(endpointProbe) || accountPlan !== null || declaredPlan !== null) {
    verdict = 'match'
  } else {
    verdict = 'unknown'
  }

  return buildVerdict({
    service: input.service ?? billing?.service ?? '',
    declaredPlan,
    accountPlan,
    windows,
    endpointProbe,
    billingSources: input.billingSources,
    verdict,
    measuredAt: input.measuredAt,
    degraded,
  })
}

/**
 * Decide what a usage record actually bills, given the plan verdict.
 *
 * The rule that matters: `unknown` must not become `0`. When the plan cannot be
 * established, the billed amount is `null` with a reason, so a surface shows the
 * gap instead of a free ride.
 * @param {object} options - `{billing, verdict, cost}` where `cost` is the
 *   `calculateCost()` result (or undefined when the catalog has no rates).
 * @returns {{billed: number|null, covered: boolean|null, confidence: 'measured'|'estimated'|'unavailable', reason: string}} the billing outcome.
 */
export function billingOutcome({ billing, verdict, cost } = {}) {
  const mode = billing?.mode
  const planVerdict = verdict?.verdict ?? 'unknown'
  const estimatedTotal = typeof cost?.total === 'number' ? cost.total : undefined

  if (mode === 'none') {
    return { billed: 0, covered: true, confidence: 'measured', reason: 'local endpoint, no billing' }
  }
  if (mode === 'pay-per-token') {
    if (estimatedTotal === undefined) {
      return { billed: null, covered: false, confidence: 'unavailable', reason: 'no catalog rates for this model' }
    }
    return { billed: estimatedTotal, covered: false, confidence: 'estimated', reason: 'per-token catalog estimate' }
  }
  if (mode === 'subscription' || mode === 'flat') {
    if (planVerdict === 'unknown') {
      return { billed: null, covered: null, confidence: 'unavailable', reason: 'plan verdict unknown; never assume covered' }
    }
    if (planVerdict === 'mismatch') {
      return {
        billed: estimatedTotal ?? null,
        covered: false,
        confidence: estimatedTotal === undefined ? 'unavailable' : 'estimated',
        reason: 'declared plan and account plan disagree',
      }
    }
    if (planVerdict === 'throttled') {
      return { billed: 0, covered: true, confidence: 'measured', reason: 'plan covers usage but is throttled' }
    }
    return { billed: 0, covered: true, confidence: 'measured', reason: `${mode} plan covers this usage` }
  }
  return { billed: null, covered: null, confidence: 'unavailable', reason: 'billing mode is not declared' }
}
