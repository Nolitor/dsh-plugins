/**
 * Anti-stuck loop breaker and thinking watchdog, in memory only.
 *
 * The breaker counts consecutive identical failing calls that carry the same error signature.
 * The watchdog measures the time since the session last committed progress. Both report to
 * the caller, which owns the interrupt and the bail-out prompt.
 */

/** Consecutive identical failures that trip the breaker. */
export const DEFAULT_FAILURE_THRESHOLD = 3

/** Number of remembered calls. */
export const DEFAULT_WINDOW = 5

/** Progress-free budget of one step. */
export const DEFAULT_THRESHOLD_MS = 180000

/**
 * Canonical form of a call's arguments: two calls that differ only in key order are one call.
 * @param {unknown} value - parsed arguments.
 * @returns {string} the canonical text.
 */
export function canonicalArguments(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value ?? null)
  if (Array.isArray(value)) return `[${value.map(canonicalArguments).join(',')}]`
  const record = value
  return `{${Object.keys(record).sort()
    .map(key => `${JSON.stringify(key)}:${canonicalArguments(record[key])}`).join(',')}}`
}

/**
 * Normalize an error text into a comparable signature: identifiers, numbers and spacing are
 * masked, so two runs of the same failing command compare equal.
 * @param {string} text - the error text.
 * @returns {string} the signature.
 */
export function errorSignature(text) {
  return String(text ?? '')
    .replace(/[0-9a-f]{8,}/gi, '<id>')
    .replace(/\d+/g, '<n>')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 400)
}

/**
 * Create one session's loop breaker.
 * @param {{ threshold?: number, window?: number }} [options] - trip count and ring size.
 * @returns {object} the breaker.
 */
export function createLoopBreaker(options = {}) {
  const threshold = options.threshold ?? DEFAULT_FAILURE_THRESHOLD
  const window = options.window ?? DEFAULT_WINDOW
  /** The last `window` calls, oldest first. */
  const ring = []
  return {
    /**
     * Record one call outcome and report whether the breaker trips.
     * @param {object} call - the `{ name, arguments }` of the call.
     * @param {boolean} ok - whether the call succeeded.
     * @param {string} errorText - the error text of a failed call.
     * @returns {object | undefined} the trip report, or undefined when the chain is intact.
     */
    observe(call, ok, errorText) {
      const key = `${call.name} ${canonicalArguments(call.arguments)}`
      ring.push({ key, ok, signature: ok ? '' : errorSignature(errorText) })
      while (ring.length > window) ring.shift()
      if (ring.length < threshold) return undefined
      const recent = ring.slice(-threshold)
      if (!recent.every(entry => !entry.ok && entry.key === recent[0].key)) return undefined
      if (!recent.every(entry => entry.signature === recent[0].signature)) return undefined
      return { key: recent[0].key, count: threshold, signature: recent[0].signature }
    },
    /**
     * Forget the chain: a new user message ends the context the loop ran in.
     * @returns {void}
     */
    reset() {
      ring.length = 0
    },
    /** @returns {number} remembered calls. */
    get size() {
      return ring.length
    },
  }
}

/**
 * Create one session's thinking watchdog.
 *
 * Progress restarts the budget without recreating the timer, so a stream of frames does not
 * churn timers; the timer only fires when the budget is really exhausted.
 * @param {{ thresholdMs?: number, onTimeout?: (elapsedMs: number) => void }} [options] - the
 *   budget and the expiry handler.
 * @returns {object} the watchdog.
 */
export function createWatchdog(options = {}) {
  const thresholdMs = options.thresholdMs ?? DEFAULT_THRESHOLD_MS
  const onTimeout = options.onTimeout ?? (() => {})
  /** The live timer, or null when the watchdog is idle. */
  let timer = null
  /** When the session last committed progress. */
  let lastProgressAt = 0
  /** Whether the budget is currently armed. */
  let armed = false

  /**
   * Stop the budget and clear the timer.
   * @returns {void}
   */
  function disarm() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    armed = false
  }

  /**
   * Re-arm the timer for the remaining budget, or report the expiry.
   * @returns {void}
   */
  function schedule() {
    disarm()
    const remaining = thresholdMs - (Date.now() - lastProgressAt)
    if (remaining <= 0) {
      armed = true
      onTimeout(thresholdMs)
      return
    }
    armed = true
    timer = setTimeout(onDeadline, remaining)
    timer.unref?.()
  }

  /**
   * The timer deadline: report the expiry, or wait for the rest of the budget.
   * @returns {void}
   */
  function onDeadline() {
    timer = null
    if (Date.now() - lastProgressAt >= thresholdMs) {
      armed = false
      onTimeout(thresholdMs)
      return
    }
    schedule()
  }

  return {
    /**
     * Start the budget.
     * @returns {void}
     */
    arm() {
      lastProgressAt = Date.now()
      schedule()
    },
    /**
     * Record progress and restart the budget. Progress outside an armed budget is ignored, so
     * an idle session never starts a timer.
     * @returns {void}
     */
    progress() {
      lastProgressAt = Date.now()
      if (armed) schedule()
    },
    /** Stop the budget. */
    disarm,
    /** @returns {number} milliseconds since the last progress. */
    get elapsed() {
      return Date.now() - lastProgressAt
    },
    /** @returns {boolean} whether the budget is armed. */
    get armed() {
      return armed
    },
  }
}
