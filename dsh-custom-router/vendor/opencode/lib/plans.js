/**
 * Plan model: which routes a plan can use, and how the checklist is ordered.
 *
 * OpenCode exposes two providers under one account:
 *
 *   `opencode-go`  — "OpenCode Go", the subscription plan
 *   `opencode`     — "Personal / OpenCode", the pay-as-you-go (Zen) plan
 *
 * The provider id is the plan, so availability is decidable from the catalog
 * alone — no per-model request. A route belongs to the active plan or it does
 * not; that is the whole rule, plus any observation the runtime already made
 * about that route (a backend that answered `deprecated`/`unavailable` wins over
 * the plan, because the plan does not cover per-account exceptions).
 *
 * Sorting: usable first, then the rest; inside each group by the public usage
 * ranking (opencode.ai/data, weekly tokens) when the route appears there, then
 * by name. Routes the ranking does not cover keep a stable name order behind the
 * ranked ones.
 */

/** Plans in display order. */
export const PLANS = ['go', 'zen']

/** Provider id that owns each plan's routes. */
export const PLAN_PROVIDERS = { go: 'opencode-go', zen: 'opencode' }

/**
 * @param {string} providerId Provider of a catalog row (`opencode-go`, `opencode`, ...).
 * @returns {'go' | 'zen' | 'other'}
 */
export function planOfProvider(providerId) {
  for (const plan of PLANS) {
    if (PLAN_PROVIDERS[plan] === providerId) return plan
  }
  return 'other'
}

/**
 * @param {string} route `provider/model` catalog id.
 * @returns {'go' | 'zen' | 'other'}
 */
export function planOfRoute(route) {
  return planOfProvider(String(route ?? '').split('/')[0])
}

/** How long a newly appeared route keeps priority-0 ordering. */
export const NEW_MODEL_DAYS = 7

/**
 * Is this route new enough to be served first?
 *
 * A route counts as new when it was first seen inside the window **and** the
 * public usage ranking has not covered it yet — once it is ranked it competes on
 * usage like everything else. Plan availability is decided separately, so a new
 * route from the other plan is still not offered.
 *
 * @param {string} route `provider/model`.
 * @param {{ firstSeen?: Record<string,string|number>, ranking?: Record<string,number>, now?: number, newWithinDays?: number }} state
 * @returns {boolean}
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

/** Verdicts that mean "the backend itself refused this route". */
const REFUSALS = new Set(['unavailable', 'deprecated', 'auth', 'forbidden'])

/**
 * Decide whether one route may be used right now.
 *
 * @param {{ route: string }} model Catalog row.
 * @param {{ activePlan?: string, verdicts?: Record<string, string> }} state
 * @returns {{ plan: 'go'|'zen'|'other', available: boolean, state: 'usable'|'other-plan'|'unavailable'|'deprecated'|'auth'|'forbidden'|'unknown' }}
 */
export function availabilityOf(model, { activePlan = 'go', verdicts = {} } = {}) {
  const route = String(model?.route ?? model?.id ?? '')
  const plan = planOfRoute(route)
  const verdict = verdicts?.[route]
  const refusal = verdict && REFUSALS.has(verdict) ? verdict : null

  // The plan is the FIRST question, not a tie-breaker. A route is only ever
  // described relative to the plan being shown: a refusal measured on the other
  // plan's endpoint does not turn that route into "unavailable", because the
  // operator is not being offered it at all. Measured 2026-11-04 before this
  // ordering: 13 zen routes under `activePlan: 'go'` read as "unavailable"
  // instead of "another plan", and the checklist interleaved two plans.
  if (plan === 'other') {
    // A provider this build does not know: show it, but do not offer it.
    return { plan, available: false, state: 'unknown' }
  }
  if (plan !== activePlan) {
    return { plan, available: false, state: 'other-plan' }
  }
  if (refusal) {
    return { plan, available: false, state: refusal }
  }
  return { plan, available: true, state: 'usable' }
}

/**
 * Order the checklist: available first, then by usage rank, then by name.
 * Unranked routes sort after ranked ones inside the same availability group.
 *
 * @param {readonly object[]} models Catalog rows (`{route, name}`).
 * @param {{ activePlan?: string, verdicts?: Record<string,string>, ranking?: Record<string, number> }} state
 * @returns {(object & { plan: string, available: boolean, state: string, rank: number|null })[]}
 */
export function orderModels(
  models,
  { activePlan = 'go', verdicts = {}, ranking = {}, firstSeen = {}, now = Date.now(), newWithinDays = NEW_MODEL_DAYS } = {},
) {
  const annotated = (models ?? []).map((model) => {
    const route = String(model?.route ?? model?.id ?? '')
    const availability = availabilityOf({ route }, { activePlan, verdicts })
    const rank = typeof ranking?.[route] === 'number' ? ranking[route] : null
    const isNew = isNewModel(route, { firstSeen, ranking, now, newWithinDays })
    return { ...model, route, ...availability, rank, isNew }
  })
  // Sort order is plan first, then usability, then the "just appeared" bonus,
  // then usage rank, then name. Grouping by plan first is what keeps the
  // checklist readable: measured 2026-11-04, sorting by availability first
  // interleaved the two plans 11 times in one list, because blocked rows of both
  // plans shared one group and fell back to name/rank comparison.
  const onActive = (model) => (model.plan === activePlan ? 0 : 1)
  return annotated.sort((left, right) => {
    const planDelta = onActive(left) - onActive(right)
    if (planDelta !== 0) return planDelta
    if (left.available !== right.available) return left.available ? -1 : 1
    // A route that just appeared is served first so it is impossible to miss,
    // but only inside the plan and availability group it already qualified for.
    if (left.isNew !== right.isNew) return left.isNew ? -1 : 1
    const leftRank = left.rank ?? Number.POSITIVE_INFINITY
    const rightRank = right.rank ?? Number.POSITIVE_INFINITY
    if (leftRank !== rightRank) return leftRank - rightRank
    const nameDelta = String(left.name ?? left.route).localeCompare(String(right.name ?? right.route), 'en')
    return nameDelta !== 0 ? nameDelta : left.route.localeCompare(right.route)
  })
}

/**
 * Extract `route -> weekly usage rank` from an `opencode.ai/data/index.json`
 * payload. The payload is bare model ids (`glm-5.3-flash`), while routes are
 * `provider/model`, so every plan that carries the model gets the same rank.
 *
 * @param {unknown} payload Parsed index.json.
 * @returns {{ ranking: Record<string, number>, updatedAt: string|null, covered: number }}
 */
export function rankingFromDataIndex(payload) {
  const leaderboard = payload?.leaderboard?.pastWeek
  const ranking = {}
  if (Array.isArray(leaderboard)) {
    leaderboard.forEach((row, index) => {
      const model = typeof row?.model === 'string' ? row.model : ''
      if (model.length === 0) return
      const rank = typeof row?.rank === 'number' ? row.rank : index + 1
      ranking[model] = rank
    })
  }
  const updatedAt = typeof payload?.updatedAt === 'string' && payload.updatedAt.length > 0 ? payload.updatedAt : null
  return { ranking, updatedAt, covered: Object.keys(ranking).length }
}

/**
 * Apply the bare-id ranking map to `provider/model` routes.
 *
 * @param {readonly string[]} routes
 * @param {Record<string, number>} byModel
 * @returns {Record<string, number>}
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
