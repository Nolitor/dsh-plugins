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
 *
 * THE TWO TRACKS (owner correction 2026-11-12)
 *   A verdict answers a question that must be answered **before dispatch**, so it
 *   may only rest on evidence that exists at that moment. Two kinds of evidence
 *   exist, and they are not interchangeable:
 *
 *   **Track A — declared baseline (pre-request).** The operator states the plan
 *   (`declaredPlan`). This is the ONLY tier evidence available at t=0, measured:
 *   the Console OAuth token is an opaque `st_…` value with no claims, its stored
 *   metadata (`type, server, access, refresh, expires, accountID, email, orgID,
 *   orgName`) carries no plan field, and no Console or zen endpoint names a tier
 *   (all of `/zen/go/v1/subscription|plan|plans|billing|account|me|limits` and
 *   `/console/api/v2/{me,orgs,members,subscription,billing,plan,usage}` answer
 *   404; `/console/api/orgs` has no plan).
 *
 *   **Track B — observed correction (post-request).** `usage.opencode.billing_source`
 *   (`go` / `go-plus`) arrives on the wire AFTER a turn completes. It is a
 *   receipt, so it can never judge a pre-dispatch decision. It is instead a
 *   **correction proposal**: `proposeCorrection()` names the difference, and only
 *   an operator-consented write changes the declaration.
 *
 *   Therefore the verdict NEVER promotes a receipt into the account tier on its
 *   own. A `billingSources` list that disagrees with `declaredPlan` does not make
 *   the verdict `mismatch` — it makes a correction proposal, which is a different
 *   output with a different consumer.
 *
 * @param {object} input - `{service, billing, declaredPlan?, accountPlan?, windows?, endpointProbe?, measuredAt?, degraded?}`.
 *   `accountPlan` must be set by the caller only from pre-request evidence; it is
 *   never derived from `billingSources` here (see Track B).
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
  } else if (accountPlan !== null) {
    // A pre-request account tier WAS measured. Two values that agree, or an
    // account tier with no declaration to contradict it, are both a match.
    verdict = 'match'
  } else if (declaredPlan !== null) {
    // Track A: the operator declared a plan. That is the pre-dispatch baseline,
    // and a settled probe corroborates reachability, so this is a match — but the
    // verdict records that the tier itself is DECLARED, not measured.
    verdict = 'match'
    if (!SETTLED_PROBES.has(endpointProbe)) {
      degraded.push({
        dimension: 'accountPlan',
        reason: 'plan tier is the declared baseline; no pre-request account evidence exists',
      })
    }
  } else {
    // Nothing declared and nothing measured. A settled probe proves the route is
    // reachable, not which plan pays for it.
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
 * Track B — compare a post-request receipt against the declared baseline.
 *
 * This is deliberately NOT part of `judgePlan()`. A `billing_source` is recorded
 * after the turn it belongs to, so using it to judge the pre-dispatch verdict
 * would be reading a receipt to decide a purchase. Instead it produces a
 * **proposal**: the caller shows it, and only an operator-consented write
 * (`settings.update` on the row's own field) applies it.
 *
 * The vocabulary split this depends on (measured in `vendor/opencode/lib/cost.js`):
 * `PLANS = ['go','zen']` are plan ids the route prefix decides;
 * `billing_source` adds the **tier** (`go`, `go-plus`). A tier difference is a
 * real, actionable difference: the two tiers bill against different monthly
 * limits, so `declared: 'go'` against `observed: 'go-plus'` means the operator
 * under-declared a $40 plan as a $10 one.
 *
 * @param {object} input - `{declaredPlan, billingSources, sampleCount?, measuredAt?}`.
 * @returns {{status: 'agree'|'propose'|'none', declared: string|null, observed: string|null, proposal: object|null, reason: string}} the proposal.
 */
export function proposeCorrection(input = {}) {
  const declared = input.declaredPlan ?? null
  const sources = Array.isArray(input.billingSources) ? input.billingSources : []
  const observed = tierFromBillingSources(sources)
  const sampleCount = typeof input.sampleCount === 'number' ? input.sampleCount : undefined

  if (observed === null) {
    return {
      status: 'none',
      declared,
      observed: null,
      proposal: null,
      reason: 'no subscription billing source has been observed yet (balance/free/byok prove no tier)',
    }
  }
  if (declared === null) {
    return {
      status: 'propose',
      declared: null,
      observed,
      proposal: {
        field: 'activePlan',
        from: null,
        to: observed,
        source: 'billing_source',
        ...(sampleCount === undefined ? {} : { sampleCount }),
        requiresConsent: true,
      },
      reason: `the wire reports ${observed}; no plan has been declared`,
    }
  }
  if (declared === observed) {
    return { status: 'agree', declared, observed, proposal: null, reason: `declared and observed both ${observed}` }
  }
  return {
    status: 'propose',
    declared,
    observed,
    proposal: {
      field: 'activePlan',
      from: declared,
      to: observed,
      source: 'billing_source',
      ...(sampleCount === undefined ? {} : { sampleCount }),
      requiresConsent: true,
    },
    reason: `declared ${declared} but every subscription request billed as ${observed}`,
  }
}

/**
 * The subscription tier a `billingSources` list proves, or null.
 *
 * Only `go` / `go-plus` name a tier; `balance`, `free` and `byok` prove a request
 * did not consume a subscription and therefore say nothing about which tier the
 * account holds.
 * @param {readonly string[]} sources - observed `billing_source` values.
 * @returns {string|null} `go-plus` | `go` | null.
 */
export function tierFromBillingSources(sources) {
  const seen = new Set(Array.isArray(sources) ? sources : [])
  if (seen.has('go-plus')) return 'go-plus'
  if (seen.has('go')) return 'go'
  return null
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
