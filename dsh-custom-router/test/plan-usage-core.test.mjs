/**
 * Plan + usage core: the PLAN half of A4.
 *
 * Covers the union this module set now expresses:
 *   - plan availability and ordering (semantics formerly only in
 *     `vendor/opencode/lib/plans.js`);
 *   - the declared `usage.billing.windows` reader (a field that was validated and
 *     read by nothing — `docs/ROADMAP.md:201`);
 *   - `billingOutcome` per canonical mode, including the `free` mode;
 *   - per-session baseline capture and delta accounting (semantics formerly only
 *     in `vendor/opencode/lib/usage-ledger.js`);
 *   - baseline + cost-ledger composition.
 *
 * The parity fixtures at the bottom are RECORDED SHAPES copied out of the two
 * vendor test suites. They are literals on purpose: this test must never import a
 * vendor module, and must keep passing after Phase 2 deletes those modules.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createCostLedger } from '../lib/cost.js'
import { PLAN_PROVIDERS, findPreset } from '../lib/presets.js'
import {
  BILLING_MODES,
  NEW_MODEL_DAYS,
  PLANS,
  availabilityOf,
  billingModeOf,
  billingOutcome,
  bindPlanProviders,
  isNewModel,
  normalizeWindow as planNormalizeWindow,
  orderModels,
  planOfProvider,
  planOfRoute,
  rankingFromDataIndex,
  rankingForRoutes,
  readDeclaredWindows,
} from '../lib/plan.js'

// R5 (2026-11-14): the plan → provider map is VENDOR data and now lives in the
// preset declaration layer (`lib/presets.js`). L1 (`lib/plan.js`) holds no
// vendor ids, so a host installs the declared map through this seam. Every
// assertion below is therefore unchanged, including the bare `planOfRoute(route)`
// calls: they read the binding, exactly as they used to read the old literal.
bindPlanProviders(PLAN_PROVIDERS)
import {
  USAGE_BUCKETS,
  bindUsage,
  createUsageBaseline,
  createUsageLedger,
  emptyUsage,
  normalizeWindow,
  usageTotal,
  windowReadings,
} from '../lib/usage.js'

/* ---------------------------------------------------------------- *
 * Plan availability and ordering
 * ---------------------------------------------------------------- */

test('provider ids map to plans, unknown providers are "other"', () => {
  assert.deepEqual(PLANS, ['go', 'zen'])
  assert.equal(PLAN_PROVIDERS.go, 'opencode-go')
  assert.equal(PLAN_PROVIDERS.zen, 'opencode')
  assert.equal(planOfProvider('opencode-go'), 'go')
  assert.equal(planOfProvider('opencode'), 'zen')
  assert.equal(planOfProvider('something-else'), 'other')
  assert.equal(planOfRoute('opencode-go/glm-5.3-flash'), 'go')
  assert.equal(planOfRoute('opencode/flint-40b-free'), 'zen')
  assert.equal(planOfRoute(''), 'other')
})

test('availability is the plan first, with backend refusals overriding it', () => {
  const goRoute = { route: 'opencode-go/glm-5.3-flash' }
  const zenRoute = { route: 'opencode/flint-40b-free' }

  assert.deepEqual(availabilityOf(goRoute, { activePlan: 'go' }), { plan: 'go', available: true, state: 'usable' })
  assert.deepEqual(availabilityOf(zenRoute, { activePlan: 'go' }), { plan: 'zen', available: false, state: 'other-plan' })
  assert.deepEqual(availabilityOf(goRoute, { activePlan: 'zen' }), { plan: 'go', available: false, state: 'other-plan' })
  assert.equal(availabilityOf(zenRoute, { activePlan: 'zen' }).available, true)

  for (const state of ['unavailable', 'deprecated', 'auth', 'forbidden']) {
    assert.deepEqual(availabilityOf(goRoute, { activePlan: 'go', verdicts: { [goRoute.route]: state } }), {
      plan: 'go',
      available: false,
      state,
    })
  }
  // An unknown provider is shown but never offered.
  assert.deepEqual(availabilityOf({ route: 'thirdparty/model' }, { activePlan: 'go' }), {
    plan: 'other',
    available: false,
    state: 'unknown',
  })
})

test('a refusal on the other plan does not make a route "unavailable"', () => {
  // The operator is not being offered it at all, so the reason must stay
  // `other-plan` even when this build measured a refusal there.
  const readiness = availabilityOf(
    { route: 'opencode/flint-40b-free' },
    { activePlan: 'go', verdicts: { 'opencode/flint-40b-free': 'deprecated' } },
  )
  assert.equal(readiness.state, 'other-plan')
  assert.equal(readiness.available, false)
})

test('the checklist orders active plan, usable, new, rank, then name', () => {
  const models = [
    { route: 'opencode/zen-a', name: 'Zeta' },
    { route: 'opencode-go/b-ranked-2', name: 'Bravo' },
    { route: 'opencode-go/a-ranked-1', name: 'Alpha' },
    { route: 'opencode-go/unranked-c', name: 'Charlie' },
  ]
  const ranking = { 'opencode-go/a-ranked-1': 1, 'opencode-go/b-ranked-2': 2 }
  const ordered = orderModels(models, { activePlan: 'go', ranking })
  assert.deepEqual(
    ordered.map((model) => model.route),
    ['opencode-go/a-ranked-1', 'opencode-go/b-ranked-2', 'opencode-go/unranked-c', 'opencode/zen-a'],
  )
  assert.deepEqual(ordered.map((model) => model.available), [true, true, true, false])
  assert.equal(ordered[0].rank, 1)
  assert.equal(ordered[2].rank, null)
  assert.equal(ordered.length, models.length, 'ordering never drops a row')
})

test('the two plans are never interleaved', () => {
  const models = [
    { route: 'opencode/zen-b', name: 'Aaa' },
    { route: 'opencode-go/go-b', name: 'Zzz' },
    { route: 'opencode/zen-a', name: 'Bbb' },
    { route: 'opencode-go/go-a', name: 'Yyy' },
  ]
  const ordered = orderModels(models, { activePlan: 'go' })
  assert.deepEqual(ordered.map((model) => model.plan), ['go', 'go', 'zen', 'zen'])
})

test('a newly seen route is served first inside its own group', () => {
  const now = 1_700_000_000_000
  const firstSeen = { 'opencode-go/fresh': now - 86_400_000 }
  const ranking = { 'opencode-go/ranked': 1 }
  assert.equal(isNewModel('opencode-go/fresh', { firstSeen, ranking, now }), true)
  // Ranked routes compete on usage instead, even when they are recent.
  assert.equal(isNewModel('opencode-go/ranked', { firstSeen, ranking, now }), false)
  // A route older than the window is not new.
  assert.equal(isNewModel('opencode-go/fresh', { firstSeen, ranking, now: now + (NEW_MODEL_DAYS + 1) * 86_400_000 }), false)
  assert.equal(isNewModel('', { firstSeen, ranking, now }), false)

  const ordered = orderModels(
    [{ route: 'opencode-go/ranked', name: 'Ranked' }, { route: 'opencode-go/fresh', name: 'Zzz fresh' }],
    { activePlan: 'go', ranking, firstSeen, now },
  )
  assert.equal(ordered[0].route, 'opencode-go/fresh')
  assert.equal(ordered[0].isNew, true)
})

test('a refused route sorts into the unavailable group on the active plan', () => {
  const models = [
    { route: 'opencode-go/refused', name: 'Aaa' },
    { route: 'opencode-go/ok', name: 'Zzz' },
  ]
  const ordered = orderModels(models, { activePlan: 'go', verdicts: { 'opencode-go/refused': 'deprecated' } })
  assert.deepEqual(ordered.map((model) => model.route), ['opencode-go/ok', 'opencode-go/refused'])
  assert.equal(ordered[1].state, 'deprecated')
})

test('the public ranking payload reduces to model -> rank and maps onto routes', () => {
  const payload = {
    updatedAt: '2026-10-30T16:16:39.000Z',
    leaderboard: {
      pastWeek: [
        { rank: 1, model: 'deepseek-v4.1-flash' },
        { model: 'glm-5.3-flash' },
      ],
    },
  }
  const parsed = rankingFromDataIndex(payload)
  assert.deepEqual(parsed.ranking, { 'deepseek-v4.1-flash': 1, 'glm-5.3-flash': 2 })
  assert.equal(parsed.updatedAt, '2026-10-30T16:16:39.000Z')
  assert.equal(parsed.covered, 2)

  const empty = rankingFromDataIndex(null)
  assert.deepEqual(empty.ranking, {})
  assert.equal(empty.updatedAt, null)

  const mapped = rankingForRoutes(
    ['opencode-go/glm-5.3-flash', 'opencode/glm-5.3-flash', 'opencode-go/never-ranked'],
    parsed.ranking,
  )
  assert.deepEqual(mapped, { 'opencode-go/glm-5.3-flash': 2, 'opencode/glm-5.3-flash': 2 })
})

/* ---------------------------------------------------------------- *
 * Declared windows (`usage.billing.windows`) — the field given a consumer
 * ---------------------------------------------------------------- */

test('an antigravity preset declares 5h/weekly/monthly windows, measured as plan scope', () => {
  const declared = readDeclaredWindows(findPreset('antigravity').usage.billing)
  assert.deepEqual(declared.map((row) => row.window), ['5h', 'weekly', 'monthly'])
  assert.deepEqual(declared.map((row) => row.scope), ['plan', 'plan', 'plan'])
  for (const row of declared) {
    assert.equal(row.declared, true)
    assert.equal(row.measured, false, 'a declaration never claims a measurement')
    assert.equal(row.limited, null)
    assert.equal('percent' in row, false, 'a declared window carries no percent')
  }
})

test('an opencode-v2 preset declares a per-request window in request scope', () => {
  const [row] = readDeclaredWindows(findPreset('opencode').usage.billing)
  assert.equal(row.window, 'per-request')
  assert.equal(row.scope, 'request')
})

test('a preset with no declared windows reads as an empty list, not null', () => {
  assert.deepEqual(readDeclaredWindows(undefined), [])
  assert.deepEqual(readDeclaredWindows({ mode: 'pay-per-token' }), [])
  assert.deepEqual(readDeclaredWindows({ windows: [null, {}, { label: '' }] }), [])
})

test('a declared window becomes an unavailable reading with its own reason', () => {
  const declared = readDeclaredWindows(findPreset('antigravity').usage.billing)
  const readings = windowReadings(declared, { service: 'antigravity' })
  assert.equal(readings.length, 3)
  for (const reading of readings) {
    assert.equal(reading.confidence, 'unavailable')
    assert.match(reading.unavailableReason, /no probe has measured it/)
    assert.equal(reading.window, '5h', 'first declaration is the 5h window')
    break
  }
  // A measured window is still preferred: same call, real numbers.
  const measured = windowReadings([{ label: 'weekly', percent: 8 }], { service: 'antigravity' })
  assert.equal(measured[0].confidence, 'measured')
  assert.equal(measured[0].value, 8)
})

test('window aliases are shared with the plan layer', () => {
  assert.equal(planNormalizeWindow('rolling'), '5h')
  assert.equal(normalizeWindow('7d'), 'weekly')
  assert.equal(normalizeWindow('30d'), 'monthly')
  assert.equal(normalizeWindow(undefined), null)
})

/* ---------------------------------------------------------------- *
 * Billing outcome per mode
 * ---------------------------------------------------------------- */

const COST = { input: 1, output: 2, cacheRead: 0, cacheWrite: 0, total: 3 }

test('canonical billing modes are the declared preset vocabulary', () => {
  assert.deepEqual(BILLING_MODES, ['subscription', 'flat', 'pay-per-token', 'free', 'none'])
  // A preset is measured against the canonical list, so a typo is visible.
  for (const id of ['antigravity', 'opencode', 'deepinfra', 'exaone']) {
    const mode = billingModeOf(findPreset(id).usage.billing)
    assert.equal(BILLING_MODES.includes(mode), true, `${id} declares a canonical mode (got ${mode})`)
  }
})

test('spec vocabulary and preset vocabulary canonicalise to one mode', () => {
  // `specs/pricing/*.kind` says live-catalog/free/flat/subscription;
  // `preset.usage.billing.mode` says pay-per-token/none/...
  assert.equal(billingModeOf({ mode: 'pay-per-token' }), 'pay-per-token')
  assert.equal(billingModeOf({ kind: 'live-catalog' }), 'pay-per-token')
  assert.equal(billingModeOf({ mode: 'metered' }), 'pay-per-token')
  assert.equal(billingModeOf({ kind: 'free' }), 'free')
  assert.equal(billingModeOf({ kind: 'subscription' }), 'subscription')
  assert.equal(billingModeOf({}), null)
  assert.equal(billingModeOf({ mode: 'nonsense' }), null)
})

test('every canonical mode produces a billing outcome that never invents a zero', () => {
  const byMode = {}
  for (const mode of BILLING_MODES) {
    byMode[mode] = billingOutcome({ billing: { mode }, verdict: { verdict: 'match' }, cost: COST })
  }
  // none → measured zero; free → measured zero; covered plans → zero.
  assert.deepEqual(byMode.none, { billed: 0, covered: true, confidence: 'measured', reason: 'local endpoint, no billing' })
  assert.equal(byMode.free.billed, 0)
  assert.equal(byMode.free.covered, true)
  assert.equal(byMode.free.confidence, 'measured')
  // pay-per-token → the estimate, never covered.
  assert.equal(byMode['pay-per-token'].billed, 3)
  assert.equal(byMode['pay-per-token'].covered, false)
  assert.equal(byMode['pay-per-token'].confidence, 'estimated')
  // subscription / flat → covered at zero.
  assert.equal(byMode.subscription.billed, 0)
  assert.equal(byMode.flat.billed, 0)
})

test('an undeclared mode is unavailable, not free', () => {
  const outcome = billingOutcome({ billing: {}, verdict: { verdict: 'match' }, cost: COST })
  assert.equal(outcome.billed, null)
  assert.equal(outcome.covered, null)
  assert.equal(outcome.confidence, 'unavailable')
  assert.match(outcome.reason, /not declared/)
})

test('a metered alias bills the estimate but never claims plan coverage', () => {
  const outcome = billingOutcome({ billing: { mode: 'metered' }, verdict: { verdict: 'match' }, cost: COST })
  assert.equal(outcome.billed, 3)
  assert.equal(outcome.covered, false)
})

test('free mode ignores the plan verdict entirely', () => {
  // A free route is free whether or not a plan verdict was reached.
  for (const verdict of ['unknown', 'match', 'mismatch', 'throttled']) {
    const outcome = billingOutcome({ billing: { mode: 'free' }, verdict: { verdict }, cost: COST })
    assert.equal(outcome.billed, 0)
    assert.equal(outcome.covered, true)
  }
})

/* ---------------------------------------------------------------- *
 * Baseline and delta accounting
 * ---------------------------------------------------------------- */

test('a step total is reported as it is and advances the baseline', () => {
  const baseline = createUsageBaseline()
  const reported = baseline.steps('session-a', {
    inputTokens: 10, outputTokens: 4, reasoningTokens: 3, cacheReadTokens: 100, cacheWriteTokens: 0,
  })
  assert.equal(reported.inputTokens, 10)
  assert.equal(reported.cacheReadTokens, 100)
  assert.equal(reported.totalTokens, 117)
  assert.equal(baseline.reported('session-a').inputTokens, 10)
})

test('a cumulative snapshot reports only its growth', () => {
  const baseline = createUsageBaseline()
  const first = baseline.cumulative('session-a', {
    inputTokens: 100, outputTokens: 20, reasoningTokens: 5, cacheReadTokens: 900, cacheWriteTokens: 3,
  })
  assert.equal(first.inputTokens, 100, 'the first report carries the whole session so far')
  assert.equal(first.totalTokens, 1028)  // 100+20+5+900+3

  const second = baseline.cumulative('session-a', {
    inputTokens: 140, outputTokens: 25, reasoningTokens: 9, cacheReadTokens: 1500, cacheWriteTokens: 3,
  })
  assert.equal(second.inputTokens, 40, 'the second report carries only the growth')
  assert.equal(second.outputTokens, 5)
  assert.equal(second.reasoningTokens, 4)
  assert.equal(second.cacheReadTokens, 600)
  assert.equal(second.cacheWriteTokens, 0)
  assert.equal(second.totalTokens, 649)
})

test('a cumulative snapshot after step usage reports the rest of the session', () => {
  const baseline = createUsageBaseline()
  baseline.steps('session-a', { inputTokens: 30, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  const growth = baseline.cumulative('session-a', {
    inputTokens: 100, outputTokens: 20, reasoningTokens: 5, cacheReadTokens: 900, cacheWriteTokens: 3,
  })
  assert.equal(growth.inputTokens, 70)
  assert.equal(growth.totalTokens, usageTotal({ inputTokens: 70, outputTokens: 19, reasoningTokens: 5, cacheReadTokens: 900, cacheWriteTokens: 3 }))
})

test('sessions are accounted separately', () => {
  const baseline = createUsageBaseline()
  baseline.cumulative('session-a', { inputTokens: 10, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  const other = baseline.cumulative('session-b', { inputTokens: 10, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.equal(other.inputTokens, 10, 'a second session reports its own total, not a shared one')
  assert.deepEqual(baseline.sessions(), ['session-a', 'session-b'])
})

test('a counter that goes backwards reports nothing and does not lower the baseline', () => {
  const baseline = createUsageBaseline()
  baseline.cumulative('session-a', { inputTokens: 50, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  const backwards = baseline.cumulative('session-a', { inputTokens: 10, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.equal(backwards.inputTokens, 0)
  assert.equal(backwards.totalTokens, 0)
  assert.equal(baseline.reported('session-a').inputTokens, 50, 'the baseline is a high-water mark')
})

test('missing buckets count as zero and negatives never reach the baseline', () => {
  const baseline = createUsageBaseline()
  const reported = baseline.cumulative('session-a', { inputTokens: 7, outputTokens: -5 })
  assert.equal(reported.inputTokens, 7)
  assert.equal(reported.outputTokens, 0)
  assert.equal(reported.totalTokens, 7)
  assert.deepEqual(Object.keys(emptyUsage()).sort(), [...USAGE_BUCKETS, 'totalTokens'].sort())
})

test('forget drops one session, or every session when no id is given', () => {
  const baseline = createUsageBaseline()
  baseline.steps('a', { inputTokens: 1 })
  baseline.steps('b', { inputTokens: 2 })
  baseline.forget('a')
  assert.deepEqual(baseline.sessions(), ['b'])
  baseline.forget()
  assert.deepEqual(baseline.sessions(), [])
  assert.equal(baseline.reported('b').inputTokens, 0, 'a forgotten session restarts from zero')
})

/* ---------------------------------------------------------------- *
 * Baseline composed with the cost ledger
 * ---------------------------------------------------------------- */

test('one ledger report bills exactly the delta it produced', () => {
  const costLedger = createCostLedger()
  const ledger = createUsageLedger({ costLedger })
  const first = ledger.report({
    sessionId: 's1',
    mode: 'cumulative',
    usage: { inputTokens: 1_000_000, outputTokens: 0 },
    model: 'opencode-go/glm-5.3-flash',
    cost: { costUsd: 1, billingSource: 'go' },
  })
  assert.equal(first.total, 1_000_000)
  assert.equal(first.recorded.duplicate, false)
  assert.equal(first.recorded.totals.costUsd, 1)

  // The same session's counters grow by 500k: the bill grows by that much only.
  const second = ledger.report({
    sessionId: 's1',
    mode: 'cumulative',
    usage: { inputTokens: 1_500_000, outputTokens: 0 },
    model: 'opencode-go/glm-5.3-flash',
    cost: { costUsd: 1, billingSource: 'go' },
  })
  assert.equal(second.total, 500_000, 'only the growth is reported')
  assert.equal(costLedger.session('s1').requests, 2, 'both reports were billed')
  assert.equal(costLedger.session('s1').tokens.input, 1_500_000, 'the ledger totals the deltas')
})

test('a re-reported cumulative snapshot bills nothing twice', () => {
  const costLedger = createCostLedger()
  const ledger = createUsageLedger({ costLedger })
  const snapshot = { inputTokens: 700, outputTokens: 30 }
  ledger.report({ sessionId: 's1', mode: 'cumulative', usage: snapshot, model: 'opencode-go/x', cost: { costUsd: 2 } })
  const again = ledger.report({ sessionId: 's1', mode: 'cumulative', usage: snapshot, model: 'opencode-go/x', cost: { costUsd: 2 } })
  assert.equal(again.total, 0, 'an unchanged snapshot is zero growth')
  assert.equal(costLedger.session('s1').requests, 2, 'the second report is still counted as a request')
  assert.equal(costLedger.session('s1').costUsd, 4)
})

test('an idempotent eventId makes a replayed report not bill twice', () => {
  const costLedger = createCostLedger()
  const ledger = createUsageLedger({ costLedger })
  ledger.report({ sessionId: 's1', usage: { inputTokens: 10 }, model: 'opencode-go/x', cost: { costUsd: 1 }, eventId: 'e1' })
  const replay = ledger.report({ sessionId: 's1', usage: { inputTokens: 10 }, model: 'opencode-go/x', cost: { costUsd: 1 }, eventId: 'e1' })
  assert.equal(replay.recorded.duplicate, true)
  assert.equal(costLedger.session('s1').costUsd, 1, 'the replayed report did not bill again')
})

test('a usage ledger without a cost ledger still accounts tokens', () => {
  const ledger = createUsageLedger()
  const report = ledger.report({ sessionId: 's1', usage: { inputTokens: 5, outputTokens: 6 } })
  assert.equal(report.total, 11)
  assert.equal(report.recorded, null)
  assert.equal(ledger.costLedger, null)
})

test('the ledger reading projects tokens, billing, and the live session totals', () => {
  const costLedger = createCostLedger()
  const ledger = createUsageLedger({ costLedger })
  ledger.report({ sessionId: 's1', usage: { inputTokens: 1000 }, model: 'opencode-go/x', cost: { costUsd: 0.5 } })
  const reading = ledger.reading({
    preset: findPreset('opencode'),
    sessionId: 's1',
    mode: 'cumulative',
    usage: { inputTokens: 4000 },
    verdict: { verdict: 'match', windows: [{ label: 'per-request' }], measuredAt: 9 },
    modelCost: { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 },
  })
  assert.equal(reading.total, 3000, 'the reading is the delta, not the session total')
  assert.equal(reading.billing.billed, 0, 'a flat plan covers it')
  assert.equal(reading.readings.some((row) => row.source === 'usage.input' || row.source === 'opencode-cost.input'), true)
  assert.equal(reading.totals.costUsd, 0.5, 'the projection carries the session spend')
})

test('bindUsage with a baseline bills the generation, not the session', () => {
  const baseline = createUsageBaseline()
  const modelCost = { input: 1, output: 0, cacheRead: 0, cacheWrite: 0 }
  baseline.cumulative('s1', { inputTokens: 1_000_000 })
  const bound = bindUsage({
    preset: findPreset('deepinfra'),
    usage: { inputTokens: 3_000_000 },
    baseline,
    sessionId: 's1',
    mode: 'cumulative',
    verdict: { verdict: 'no-plan-service', windows: [] },
    modelCost,
  })
  // 2M growth at $1/M, not the 3M the cumulative counter reported.
  assert.equal(bound.cost.total, 2)
  assert.equal(bound.billing.billed, 2)
  assert.equal(bound.delta.inputTokens, 2_000_000)
})

test('bindUsage without a baseline keeps its original shape', () => {
  const bound = bindUsage({
    preset: findPreset('antigravity'),
    usage: { inputTokens: 1000, outputTokens: 500 },
    verdict: { verdict: 'match', windows: [{ label: 'weekly', percent: 8 }], measuredAt: 7 },
    modelCost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 },
  })
  assert.equal('delta' in bound, false)
  assert.equal(bound.billing.billed, 0)
})

/* ---------------------------------------------------------------- *
 * Parity fixtures — RECORDED SHAPES from the vendor suites (literals only).
 * Copied 2026-11-14 out of `vendor/opencode/test/usage-ledger.test.mjs` and
 * `vendor/opencode/test/plans.test.mjs`; no vendor module is imported.
 * ---------------------------------------------------------------- */

test('parity: vendor usage-ledger recorded sequences reproduce exactly', () => {
  // Recorded from `usage-ledger.test.mjs` "a cumulative snapshot reports only its
  // growth" + "after step usage reports the rest of the session".
  const ledger = createUsageBaseline()
  const first = ledger.cumulative('session-a', {
    inputTokens: 100, outputTokens: 20, reasoningTokens: 5, cacheReadTokens: 900, cacheWriteTokens: 3,
  })
  assert.equal(first.totalTokens, 1028)  // 100+20+5+900+3
  assert.equal(first.totalTokens, usageTotal({
    inputTokens: 100, outputTokens: 20, reasoningTokens: 5, cacheReadTokens: 900, cacheWriteTokens: 3,
  }))

  const second = ledger.cumulative('session-a', {
    inputTokens: 140, outputTokens: 25, reasoningTokens: 9, cacheReadTokens: 1500, cacheWriteTokens: 3,
  })
  assert.deepEqual(
    { ...second, totalTokens: undefined },
    { ...emptyUsage(), inputTokens: 40, outputTokens: 5, reasoningTokens: 4, cacheReadTokens: 600, cacheWriteTokens: 0, totalTokens: undefined },
  )
  assert.equal(second.totalTokens, 649)
})

test('parity: vendor plans recorded order and availability reproduce exactly', () => {
  // Recorded from `plans.test.mjs` "the checklist orders usable first, then by
  // usage rank, then by name" and "availability is the plan ...".
  const models = [
    { route: 'opencode/zen-a', name: 'Zeta' },
    { route: 'opencode-go/b-ranked-2', name: 'Bravo' },
    { route: 'opencode-go/a-ranked-1', name: 'Alpha' },
    { route: 'opencode-go/unranked-c', name: 'Charlie' },
  ]
  const ranking = { 'opencode-go/a-ranked-1': 1, 'opencode-go/b-ranked-2': 2 }
  assert.deepEqual(
    orderModels(models, { activePlan: 'go', ranking }).map((model) => model.route),
    ['opencode-go/a-ranked-1', 'opencode-go/b-ranked-2', 'opencode-go/unranked-c', 'opencode/zen-a'],
  )
  assert.deepEqual(availabilityOf({ route: 'opencode-go/glm-5.3-flash' }, { activePlan: 'go' }), {
    plan: 'go', available: true, state: 'usable',
  })
  assert.deepEqual(availabilityOf({ route: 'opencode/flint-40b-free' }, { activePlan: 'go' }), {
    plan: 'zen', available: false, state: 'other-plan',
  })
  // Recorded payload shape from the same suite.
  const payload = {
    updatedAt: '2026-10-30T16:16:39.000Z',
    leaderboard: { pastWeek: [{ rank: 1, model: 'deepseek-v4.1-flash' }, { model: 'glm-5.3-flash' }] },
  }
  assert.deepEqual(rankingFromDataIndex(payload).ranking, { 'deepseek-v4.1-flash': 1, 'glm-5.3-flash': 2 })
})
