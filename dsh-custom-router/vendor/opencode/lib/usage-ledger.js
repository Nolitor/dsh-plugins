/**
 * Per-session usage accounting for the OpenCode routes.
 *
 * OpenCode reports usage two ways, and neither is a request's usage on its own:
 *
 *   - `session.step.ended.tokens` is the STEP's tokens (accurate per step), so
 *     one DSH generation sums the steps it produced;
 *   - `GET /api/session/{id}.tokens` and `opencode session export` are the
 *     SESSION's cumulative counters, which only grow.
 *
 * Reporting the cumulative counters as one request's usage inflates every later
 * request of a long-lived session: the second generation of a session already
 * carries the first one's tokens, and the hundredth carries all hundred.
 *
 * The accumulator keeps the total already reported per OpenCode session, so a
 * cumulative snapshot yields only the growth since the last report, and a step
 * total is reported as it is while still advancing the baseline.
 *
 * ROUTED ONTO THE CORE (R2, 2026-11-14): `USAGE_BUCKETS`, `usageTotal` and the
 * baseline itself are `lib/usage.js` (`createUsageBaseline`), imported below.
 * They were measured to be genuinely identical, not merely similar — the
 * differential test over plain / missing / negative / null / partition-shaped
 * input produced byte-equal results for both `steps` and `cumulative`. The only
 * divergence found is a string or NaN bucket value, which the sole producer
 * (`shared.js` `usageFromSessionExport`) cannot emit: it funnels every counter
 * through `Number(...)` with a finite/non-negative clamp and defaults to `0`.
 * `reported`/`forget` keep this package's names; `sessions()` is the core's extra
 * and is re-exported for free.
 *
 * @module @nolit/dsh-opencode-v2/usage-ledger
 */
import { USAGE_BUCKETS, createUsageBaseline, usageTotal } from '../../../lib/usage.js'

export { USAGE_BUCKETS, usageTotal }

/**
 * Create the per-session usage ledger.
 *
 * The baseline is the usage already reported for one OpenCode session. It is
 * keyed by the OpenCode session id, so two DSH sessions that share one
 * OpenCode session do not report each other's tokens.
 *
 * @returns {object} the ledger.
 */
export function createUsageLedger() {
  return createUsageBaseline()
}
