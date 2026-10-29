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
 * This ledger keeps the total already reported per OpenCode session, so a
 * cumulative snapshot yields only the growth since the last report, and a step
 * total is reported as it is while still advancing the baseline.
 */

/** The usage buckets the host understands. */
export const USAGE_BUCKETS = Object.freeze([
  'inputTokens',
  'outputTokens',
  'reasoningTokens',
  'cacheReadTokens',
  'cacheWriteTokens',
])

/**
 * A zeroed usage record.
 * @returns {Record<string, number>} every bucket at zero.
 */
function zeroUsage () {
  const usage = {}
  for (const bucket of USAGE_BUCKETS) usage[bucket] = 0
  usage.totalTokens = 0
  return usage
}

/**
 * Sum the buckets of one usage record.
 * @param {Record<string, number>} usage - the usage record.
 * @returns {number} the total.
 */
export function usageTotal (usage) {
  let total = 0
  for (const bucket of USAGE_BUCKETS) total += usage?.[bucket] ?? 0
  return total
}

/**
 * Create the per-session usage ledger.
 *
 * The baseline is the usage already reported for one OpenCode session. It is
 * keyed by the OpenCode session id, so two DSH sessions that share one
 * OpenCode session do not report each other's tokens.
 *
 * @returns {object} the ledger.
 */
export function createUsageLedger () {
  /** @type {Map<string, Record<string, number>>} */
  const baselines = new Map()

  /**
   * The baseline of one session, created on first use.
   * @param {string} sessionId - the OpenCode session id.
   * @returns {Record<string, number>} the mutable baseline.
   */
  function baselineOf (sessionId) {
    let baseline = baselines.get(sessionId)
    if (baseline === undefined) {
      baseline = zeroUsage()
      baselines.set(sessionId, baseline)
    }
    return baseline
  }

  return {
    /**
     * Report a generation measured by its own steps.
     *
     * The steps are the generation's own tokens, so they are reported as they
     * are; the baseline advances by the same amount, so a later cumulative
     * snapshot yields only what this session grew since.
     *
     * @param {string} sessionId - the OpenCode session id.
     * @param {Record<string, number>} usage - the generation's summed step usage.
     * @returns {Record<string, number>} the usage to report.
     */
    steps (sessionId, usage) {
      const baseline = baselineOf(sessionId)
      for (const bucket of USAGE_BUCKETS) {
        const value = Math.max(0, usage?.[bucket] ?? 0)
        baseline[bucket] += value
      }
      const reported = zeroUsage()
      for (const bucket of USAGE_BUCKETS) reported[bucket] = Math.max(0, usage?.[bucket] ?? 0)
      reported.totalTokens = usageTotal(reported)
      return reported
    },

    /**
     * Report the growth of a session's cumulative counters.
     *
     * @param {string} sessionId - the OpenCode session id.
     * @param {Record<string, number>} cumulative - the session's cumulative usage.
     * @returns {Record<string, number>} the growth since the last report.
     */
    cumulative (sessionId, cumulative) {
      const baseline = baselineOf(sessionId)
      const delta = zeroUsage()
      for (const bucket of USAGE_BUCKETS) {
        const value = Math.max(0, cumulative?.[bucket] ?? 0)
        delta[bucket] = Math.max(0, value - baseline[bucket])
        baseline[bucket] = Math.max(baseline[bucket], value)
      }
      delta.totalTokens = usageTotal(delta)
      return delta
    },

    /**
     * The usage already reported for one session.
     * @param {string} sessionId - the OpenCode session id.
     * @returns {Record<string, number>} the baseline.
     */
    reported (sessionId) {
      return { ...baselineOf(sessionId) }
    },

    /**
     * Forget one session's baseline.
     * @param {string} sessionId - the OpenCode session id.
     * @returns {void}
     */
    forget (sessionId) {
      baselines.delete(sessionId)
    },
  }
}
