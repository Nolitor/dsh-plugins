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
 * Billing modes that charge per token, whatever the provider calls them.
 *
 * `pay-per-token` is the preset vocabulary (`lib/presets.js`, deepinfra);
 * `metered` is the same thing named by `specs/pricing/*.kind: 'live-catalog'`.
 * Both bill the catalog estimate and neither is ever covered by a plan.
 */
export const METERED_MODES = Object.freeze(['pay-per-token', 'metered'])

/** The canonical billing modes `billingOutcome()` judges, in display order. */
export const BILLING_MODES = Object.freeze(['subscription', 'flat', 'pay-per-token', 'free', 'none'])

/** Aliases seen on the wire / in specs, mapped to a canonical mode. */
const MODE_ALIASES = Object.freeze({
  'pay-per-token': 'pay-per-token',
  metered: 'pay-per-token',
  'live-catalog': 'pay-per-token',
  subscription: 'subscription',
  flat: 'flat',
  free: 'free',
  none: 'none',
})

/**
 * The canonical billing mode of a preset/record, or `null` when undeclared.
 *
 * Measured 2026-11-14: `specs/pricing/*.kind` uses `subscription` /
 * `live-catalog` / `free` / `flat` while `preset.usage.billing.mode` uses
 * `subscription` / `flat` / `pay-per-token` / `none`. This is the one place the
 * two vocabularies are reconciled, so a caller never has to know both.
 *
 * @param {object} billing - `{mode}` record (preset `usage.billing` or a spec row).
 * @returns {'subscription'|'flat'|'pay-per-token'|'free'|'none'|null} canonical mode.
 */
export function billingModeOf(billing) {
  const raw = billing?.mode ?? billing?.kind
  if (typeof raw !== 'string' || raw.length === 0) return null
  return MODE_ALIASES[raw.toLowerCase()] ?? null
}

/**
 * Window-label aliases. The measured labels (`5h`, `rolling`, `weekly`, `7d`,
 * `monthly`, `30d`, `per-request`, `quota`) and their normalised ids.
 */
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

/**
 * Map a provider window label to the normalised window id.
 * @param {unknown} label - e.g. `rolling`, `7d`, `weekly`.
 * @returns {string|null} normalised id, or null when the label is not a string.
 */
export function normalizeWindow(label) {
  if (typeof label !== 'string') return null
  return WINDOW_ALIASES[label.toLowerCase()] ?? label
}

/**
 * Read the DECLARED window set out of `usage.billing.windows`.
 *
 * This field was validated, projected to the browser and read by nothing —
 * measured 2026-11-14 (`docs/ROADMAP.md:201`, "dead declarations"). It is the
 * only window information that exists before any probe runs: antigravity
 * declares `5h` / `weekly` / `monthly`, opencode-v2 declares `per-request`.
 * A declaration says a window EXISTS; it never says how much is consumed, so the
 * result carries `measured: false` and no `percent`.
 *
 * @param {object} billing - preset `usage.billing` (may also be given directly).
 * @returns {{window: string|null, label: string, scope: 'plan'|'request', declared: true, measured: false, limited: null, resetsAt: null}[]} declarations.
 */
export function readDeclaredWindows(billing) {
  const rows = Array.isArray(billing?.windows) ? billing.windows : []
  const out = []
  for (const row of rows) {
    const label = typeof row === 'string' ? row : row?.label
    if (typeof label !== 'string' || label.length === 0) continue
    const window = normalizeWindow(label)
    out.push({
      window,
      label,
      scope: window === 'per-request' ? 'request' : 'plan',
      declared: true,
      measured: false,
      limited: null,
      resetsAt: null,
    })
  }
  return out
}

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
  if (!billing || billingModeOf(billing) === 'none') {
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
  // Canonicalise first: `metered` / `live-catalog` are the same mode as
  // `pay-per-token`, and a preset may carry either vocabulary.
  const mode = billingModeOf(billing)
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
  if (mode === 'free') {
    // A provider-declared free route (`specs/pricing/*.kind: 'free'`): the plan
    // model stays out of it, and the amount is measured at zero, not guessed.
    return { billed: 0, covered: true, confidence: 'measured', reason: 'free tier; the provider charges nothing' }
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

/* ------------------------------------------------------------------ *
 * Plan availability and ordering (union of `vendor/opencode/lib/plans.js`)
 * ------------------------------------------------------------------ */

/**
 * Plans in display order. A provider id IS the plan id on the wire, so
 * availability is decidable from the catalog alone — no per-model request.
 */
export const PLANS = Object.freeze(['go', 'zen'])

/** Provider id that owns each plan's routes (measured: opencode-go / opencode). */
export const PLAN_PROVIDERS = Object.freeze({ go: 'opencode-go', zen: 'opencode' })

/** How long a newly appeared route keeps priority ordering. */
export const NEW_MODEL_DAYS = 7

/** Verdicts that mean "the backend itself refused this route". */
const REFUSALS = new Set(['unavailable', 'deprecated', 'auth', 'forbidden'])

/**
 * The plan a provider id belongs to.
 * @param {string} providerId - catalog row provider (`opencode-go`, `opencode`, ...).
 * @param {Record<string,string>} [providers] - plan → provider map (defaults to `PLAN_PROVIDERS`).
 * @returns {string} `go` | `zen` | `other`.
 */
export function planOfProvider(providerId, providers = PLAN_PROVIDERS) {
  for (const plan of PLANS) {
    if (providers?.[plan] === providerId) return plan
  }
  return 'other'
}

/**
 * The plan a `provider/model` route belongs to.
 * @param {string} route - catalog id.
 * @param {Record<string,string>} [providers] - plan → provider map.
 * @returns {string} `go` | `zen` | `other`.
 */
export function planOfRoute(route, providers = PLAN_PROVIDERS) {
  return planOfProvider(String(route ?? '').split('/')[0], providers)
}

/**
 * Is this route new enough to be served first?
 *
 * New means first seen inside the window AND not yet covered by the public usage
 * ranking — once ranked it competes on usage like everything else.
 * @param {string} route - `provider/model`.
 * @param {{firstSeen?: object, ranking?: object, now?: number, newWithinDays?: number}} [state] - observation state.
 * @returns {boolean} true when the route is inside its new-model window.
 */
export function isNewModel(route, { firstSeen = {}, ranking = {}, now = Date.now(), newWithinDays = NEW_MODEL_DAYS } = {}) {
  const key = String(route ?? '')
  if (key.length === 0) return false
  if (typeof ranking?.[key] === 'number') return false
  const seen = firstSeen?.[key]
  if (seen === undefined || seen === null) return false
  const stamp = typeof seen === 'number' ? seen : Date.parse(String(seen))
  if (!Number.isFinite(stamp)) return false
  return now - stamp < newWithinDays * 86_400_000
}

/**
 * Decide whether one route may be used right now.
 *
 * The plan is the FIRST question, not a tie-breaker: a refusal measured on the
 * other plan's endpoint does not make the route "unavailable", because the
 * operator is not being offered it at all.
 * @param {{route?: string, id?: string}} model - catalog row.
 * @param {{activePlan?: string, verdicts?: Record<string,string>, providers?: Record<string,string>}} [state] - plan state.
 * @returns {{plan: string, available: boolean, state: 'usable'|'other-plan'|'unknown'|'unavailable'|'deprecated'|'auth'|'forbidden'}} availability.
 */
export function availabilityOf(model, { activePlan = 'go', verdicts = {}, providers = PLAN_PROVIDERS } = {}) {
  const route = String(model?.route ?? model?.id ?? '')
  const plan = planOfRoute(route, providers)
  const verdict = verdicts?.[route]
  const refusal = typeof verdict === 'string' && REFUSALS.has(verdict) ? verdict : null

  if (plan === 'other') return { plan, available: false, state: 'unknown' }
  if (plan !== activePlan) return { plan, available: false, state: 'other-plan' }
  if (refusal !== null) return { plan, available: false, state: refusal }
  return { plan, available: true, state: 'usable' }
}

/**
 * Order a checklist: the active plan first, usable before blocked, newly appeared
 * first, then public usage rank, then name. Nothing is dropped.
 * @param {readonly object[]} models - catalog rows (`{route, name}`).
 * @param {{activePlan?: string, verdicts?: object, ranking?: object, firstSeen?: object, now?: number, newWithinDays?: number, providers?: object}} [state] - ordering state.
 * @returns {(object & {plan: string, available: boolean, state: string, rank: number|null, isNew: boolean})[]} ordered rows.
 */
export function orderModels(
  models,
  { activePlan = 'go', verdicts = {}, ranking = {}, firstSeen = {}, now = Date.now(), newWithinDays = NEW_MODEL_DAYS, providers = PLAN_PROVIDERS } = {},
) {
  const annotated = (models ?? []).map((model) => {
    const route = String(model?.route ?? model?.id ?? '')
    const availability = availabilityOf({ route }, { activePlan, verdicts, providers })
    const rank = typeof ranking?.[route] === 'number' ? ranking[route] : null
    const isNew = isNewModel(route, { firstSeen, ranking, now, newWithinDays })
    return { ...model, route, ...availability, rank, isNew }
  })
  const onActive = (model) => (model.plan === activePlan ? 0 : 1)
  return annotated.sort((left, right) => {
    const planDelta = onActive(left) - onActive(right)
    if (planDelta !== 0) return planDelta
    if (left.available !== right.available) return left.available ? -1 : 1
    if (left.isNew !== right.isNew) return left.isNew ? -1 : 1
    const leftRank = left.rank ?? Number.POSITIVE_INFINITY
    const rightRank = right.rank ?? Number.POSITIVE_INFINITY
    if (leftRank !== rightRank) return leftRank - rightRank
    const nameDelta = String(left.name ?? left.route).localeCompare(String(right.name ?? right.route), 'en')
    return nameDelta !== 0 ? nameDelta : left.route.localeCompare(right.route)
  })
}

/**
 * Extract `model -> weekly usage rank` from a public data index payload.
 * @param {unknown} payload - parsed `opencode.ai/data/index.json`.
 * @returns {{ranking: Record<string, number>, updatedAt: string|null, covered: number}} the ranking.
 */
export function rankingFromDataIndex(payload) {
  const leaderboard = payload?.leaderboard?.pastWeek
  const ranking = {}
  if (Array.isArray(leaderboard)) {
    leaderboard.forEach((row, index) => {
      const model = typeof row?.model === 'string' ? row.model : ''
      if (model.length === 0) return
      ranking[model] = typeof row?.rank === 'number' ? row.rank : index + 1
    })
  }
  const updatedAt = typeof payload?.updatedAt === 'string' && payload.updatedAt.length > 0 ? payload.updatedAt : null
  return { ranking, updatedAt, covered: Object.keys(ranking).length }
}

/**
 * Apply a bare-model ranking map to `provider/model` routes.
 * @param {readonly string[]} routes - qualified routes.
 * @param {Record<string, number>} byModel - bare-id ranking.
 * @returns {Record<string, number>} route → rank.
 */
export function rankingForRoutes(routes, byModel) {
  const out = {}
  for (const route of routes ?? []) {
    const model = String(route).split('/').slice(1).join('/')
    const rank = byModel?.[model]
    if (typeof rank === 'number') out[String(route)] = rank
  }
  return out
}
