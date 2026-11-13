#!/usr/bin/env node
/**
 * Expected live routes for `npm run verify:refresh` — the expectation half, kept
 * pure so it can be unit-tested without booting a profile.
 *
 * WHY THIS EXISTS (ROADMAP P1-6)
 *   `verify:presets` checks that a preset is registered and `verify:refresh`
 *   checks that a mounted model route answers. Neither said WHAT must be in the
 *   answer, so a preset or model could disappear and the gate would still pass:
 *   an empty-but-200 payload, a lost Claude lane, or a dropped EXAONE row all
 *   read as success. This table names the four presets and the model rows each
 *   one must keep serving; `evaluateRefresh` turns a route read into
 *   pass/fail plus one message per missing expectation.
 *
 * The table is data: a new preset adds one row, and the unit tests in
 * `test/refresh-expectations.test.mjs` prove each expected row really fails when
 * it disappears (mutation style, matching the preset drift gate).
 *
 * TWO RULES THE TABLE ENFORCES
 *   1. **A missing route is a FAILURE, not a skip.** These four presets are the
 *      serving path now; "the row did not mount" is the exact regression P1-6
 *      exists to catch, so it must never read as a green gate.
 *   2. **An expectation holds on BOTH reads.** The plain read is served from the
 *      vendor's cache and the forced read (`?refresh=1`) re-reads the vendor. A
 *      lane that is missing from either one is missing from the serving path,
 *      and a lane that differs between them is a stale cache.
 *
 * @module @nolit/dsh-custom-router/scripts/refresh-expectations
 */

/**
 * Model rows in a flat `{ models: [] }` catalog payload.
 * @param {object} [body] - the route payload.
 * @returns {object[]} the rows (empty when the payload carries none).
 */
export function modelRows(body) {
  return Array.isArray(body?.models) ? body.models : []
}

/**
 * Flat model ids in an Antigravity payload, whose rows are grouped by usage
 * family (`{ groups: [{ models: [] }] }`).
 * @param {object} [body] - the route payload.
 * @returns {string[]} every base model id.
 */
export function antigravityBases(body) {
  const groups = Array.isArray(body?.groups) ? body.groups : []
  return groups.flatMap((group) => (Array.isArray(group?.models)
    ? group.models.map((model) => String(model?.id ?? '')).filter((id) => id !== '')
    : []))
}

/**
 * Rows the gate speaks to. `expected` is the completion criterion: every entry
 * must hold on the plain read AND on the forced read, and a missing route is a
 * failure, not a skip.
 *
 * The measured baseline (live gate, 2026-11-14): Antigravity 10 base rows
 * including `claude-opus-5-5` and `gemini-4-hydrogen`; OpenCode 32 rows on the
 * `go` plan; DeepInfra 92 rows of which 8 carry a promotion; EXAONE 1 row,
 * `k-exaone_v2.5`.
 */
export const ROUTES = Object.freeze([
  {
    preset: 'antigravity',
    path: '/api/local/dsh-antigravity/models',
    rows: antigravityBases,
    expected: [
      // The Claude lane is where the 2026-11-14 multi-turn tool-use fix lives,
      // and the Gemini lane is the same wire's other half: both must stay listed.
      { label: 'a Claude base row (…claude…)', find: (body) => antigravityBases(body).some((id) => /claude/i.test(id)) },
      { label: 'a Gemini base row (…gemini…)', find: (body) => antigravityBases(body).some((id) => /gemini/i.test(id)) },
      // The newest Gemini generation, named separately so a lost lane reports
      // itself instead of hiding behind the family check above.
      { label: 'the Hydrogen lane (…hydrogen…)', find: (body) => antigravityBases(body).some((id) => /hydrogen/i.test(id)) },
    ],
  },
  {
    preset: 'opencode',
    path: '/api/local/opencode-v2/model-settings',
    rows: modelRows,
    expected: [{ label: 'at least one served model row', find: (body) => modelRows(body).length > 0 }],
  },
  {
    preset: 'deepinfra',
    path: '/api/local/deepinfra/models',
    rows: modelRows,
    expected: [{ label: 'at least one served model row', find: (body) => modelRows(body).length > 0 }],
  },
  {
    preset: 'exaone',
    path: '/api/local/dsh-exaone/models',
    rows: modelRows,
    // EXAONE publishes one chat model and no listing endpoint, so the row is
    // static: a rename or a dropped registration must fail the gate rather than
    // shrink a count nobody reads.
    expected: [{ label: 'the k-exaone_v2.5 model', find: (body) => modelRows(body).some((model) => String(model?.id) === 'k-exaone_v2.5') }],
  },
])

/**
 * Whether one read answered with a usable catalog.
 * @param {object} [read] - a route read.
 * @returns {boolean} true when the read answered 200 with a JSON body.
 */
function answered(read) {
  return read?.status === 200 && read?.body !== undefined
}

/**
 * Evaluate one route read against its expectations.
 * @param {object} spec - one entry of {@link ROUTES}.
 * @param {{skipped?: boolean, status?: number, body?: object, ms?: number}} [plain] - the unforced read.
 * @param {{skipped?: boolean, status?: number, body?: object, ms?: number}} [forced] - the `?refresh=1` read.
 * @returns {{preset: string, path: string, present: boolean, ok: boolean, failures: string[],
 *   checks: {label: string, ok: boolean, plain: boolean, forced: boolean}[],
 *   plain: object, forced: object}} the verdict.
 */
export function evaluateRefreshRoute(spec, plain, forced) {
  const summarize = (read) => ({
    status: read?.status ?? -1,
    rows: read?.body === undefined ? -1 : spec.rows(read.body).length,
    ms: read?.ms ?? 0,
  })
  const wasRead = plain !== undefined && plain !== null
  const verdict = {
    preset: spec.preset,
    path: spec.path,
    // "present" means the ROUTE was mounted and read. A read that was never
    // made is not a mounted route: counting it as present is the false green
    // this module exists to prevent.
    present: wasRead && plain.skipped !== true,
    ok: true,
    failures: [],
    checks: [],
    plain: summarize(plain),
    forced: summarize(forced),
  }

  if (!verdict.present) {
    verdict.ok = false
    verdict.failures.push(wasRead
      ? `${spec.preset}: route ${spec.path} is not mounted`
      : `${spec.preset}: route ${spec.path} was never read`)
    return verdict
  }

  if (!answered(plain)) verdict.failures.push(`${spec.preset}: plain read did not answer (HTTP ${verdict.plain.status})`)
  if (!answered(forced)) verdict.failures.push(`${spec.preset}: forced read did not answer (HTTP ${verdict.forced.status})`)

  for (const want of spec.expected ?? []) {
    const found = (candidate) => {
      if (!answered(candidate)) return false
      try {
        return want.find(candidate.body) === true
      } catch {
        // A predicate that throws on an unexpected payload is a MISS, never a
        // crash: the gate reports, the operator reads.
        return false
      }
    }
    const plainOk = found(plain)
    const forcedOk = found(forced)
    const ok = plainOk && forcedOk
    verdict.checks.push({ label: want.label, ok, plain: plainOk, forced: forcedOk })
    if (!ok) {
      const where = plainOk
        ? 'the forced payload'
        : forcedOk ? 'the plain payload' : 'the plain and forced payloads'
      verdict.failures.push(`${spec.preset}: expected ${want.label} missing from ${where}`)
    }
  }

  verdict.ok = verdict.failures.length === 0
  return verdict
}

/**
 * Evaluate every route read. Failures are reported in table order so a diff is
 * stable.
 *
 * A read may carry its `preset` id; then it is matched by id, so a reordered
 * array cannot mis-evaluate. An array without ids is matched by position.
 *
 * @param {Array<{preset?: string, plain?: object, forced?: object}>} [reads] - one entry per {@link ROUTES} row.
 * @returns {{results: object[], failures: string[], ok: boolean, present: number, expected: number}} the verdict.
 */
export function evaluateRefresh(reads) {
  const list = Array.isArray(reads) ? reads : []
  // A read that names its preset is matched by that name. If ANY read is named,
  // the whole list is matched by name — a named read never falls back to a
  // positional slot, because that would let 'opencode' answer for
  // 'antigravity'. An anonymous list keeps the positional order.
  const named = list.some((entry) => typeof entry?.preset === 'string')
  const results = ROUTES.map((spec, index) => {
    const read = named
      ? list.find((entry) => entry?.preset === spec.preset)
      : list[index]
    return evaluateRefreshRoute(spec, read?.plain, read?.forced)
  })
  const failures = results.flatMap((result) => result.failures)
  return {
    results,
    failures,
    // The aggregate states its own verdict: a caller must not have to
    // re-derive "no failures" to know whether the gate passed.
    ok: failures.length === 0,
    present: results.filter((result) => result.present).length,
    expected: ROUTES.length,
  }
}
