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
export const DEFAULT_THRESHOLD_MS = 600000

/** Fraction of the budget after which one soft warning is emitted, before the budget expires. */
export const DEFAULT_WARN_RATIO = 0.5

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
 *
 * While a tool call is in flight the TURN budget is held, because a running tool is activity even
 * though it commits no session event. It is replaced by a separate TOOL budget that starts when
 * the call starts, so a slow or spinning tool still expires inside `toolThresholdMs`. Setting
 * `toolThresholdMs: 0` restores the historical "a running tool never expires" behaviour.
 *
 * The warning tier is separate from the expiry: `onWarn` fires once per budget at `warnMs`, and
 * the caller decides whether the expiry is a notice or an interrupt.
 * @param {{ thresholdMs?: number, warnMs?: number, onWarn?: (elapsedMs: number) => void,
 *   onTimeout?: (elapsedMs: number) => void, disabled?: boolean }} [options] - the budget, the
 *   soft-warning point, the two handlers, and whether `watchdog: false` turned the watch off.
 * @returns {object} the watchdog.
 */
export function createWatchdog(options = {}) {
  /*
   * `watchdog: false` used to be a config key with no reader: it was declared, validated and
   * documented, and the watch ran anyway. The disabled watchdog keeps the object shape the call
   * sites already use (`progress()`, `suspend()`, `disarm()`) and simply never arms a timer, so a
   * deployment that turns it off gets no notices and no interrupt with no call-site changes.
   */
  const disabled = options.disabled === true
  const thresholdMs = options.thresholdMs ?? DEFAULT_THRESHOLD_MS
  const warnMs = Math.min(
    options.warnMs ?? Math.floor(thresholdMs * DEFAULT_WARN_RATIO),
    thresholdMs,
  )
  /*
   * The tool budget. While a tool call is in flight the turn budget is held, and this
   * separate budget runs from the moment the tool started. `0` disables it and restores
   * the historical "a running tool is activity" behaviour.
   */
  const toolThresholdMs = options.toolThresholdMs === undefined
    ? thresholdMs
    : Math.max(0, options.toolThresholdMs)
  const toolWarnMs = Math.min(
    options.toolWarnMs ?? Math.floor(toolThresholdMs * DEFAULT_WARN_RATIO),
    toolThresholdMs,
  )
  const onWarn = options.onWarn ?? (() => {})
  const onTimeout = options.onTimeout ?? (() => {})
  /** The live timer, or null when the watchdog is idle. */
  let timer = null
  /** When the session last committed progress. */
  let lastProgressAt = 0
  /** Whether the budget is currently armed. */
  let armed = false
  /** Whether the current budget already emitted its one soft warning. */
  let warned = false
  /** Whether a tool call is in flight, which holds the turn budget and runs the tool budget. */
  let suspended = false
  /** When the in-flight tool call started. */
  let suspendedAt = 0
  /** Whether the current tool budget already emitted its one soft warning. */
  let toolWarned = false

  /**
   * Stop the budget and clear the timer.
   * @returns {void}
   */
  function disarm() {
    if (timer !== null) clearTimeout(timer)
    timer = null
    armed = false
    warned = false
    suspended = false
    suspendedAt = 0
    toolWarned = false
  }

  /**
   * Arm the timer for the next interesting point: the soft warning, or the expiry.
   * @returns {void}
   */
  function schedule() {
    if (disabled) return
    if (timer !== null) {
      clearTimeout(timer)
      timer = null
    }
    if (!armed) return
    if (suspended) {
      // The turn budget is held, but the tool budget keeps running from the tool start.
      if (toolThresholdMs === 0) return
      const toolElapsed = Date.now() - suspendedAt
      if (toolElapsed >= toolThresholdMs) {
        armed = false
        suspended = false
        onTimeout(toolThresholdMs, { phase: 'tool' })
        return
      }
      const untilToolWarn = toolWarned ? Number.POSITIVE_INFINITY : toolWarnMs - toolElapsed
      const untilToolDeadline = toolThresholdMs - toolElapsed
      timer = setTimeout(onDeadline, Math.max(0, Math.min(untilToolWarn, untilToolDeadline)))
      timer.unref?.()
      return
    }
    const elapsed = Date.now() - lastProgressAt
    if (elapsed >= thresholdMs) {
      armed = false
      onTimeout(thresholdMs, { phase: 'turn' })
      return
    }
    const untilWarn = warned ? Number.POSITIVE_INFINITY : warnMs - elapsed
    const untilDeadline = thresholdMs - elapsed
    timer = setTimeout(onDeadline, Math.max(0, Math.min(untilWarn, untilDeadline)))
    timer.unref?.()
  }

  /**
   * The timer deadline: warn once, report the expiry, or wait for the rest of the budget.
   * @returns {void}
   */
  function onDeadline() {
    timer = null
    if (!armed) return
    if (suspended) {
      if (toolThresholdMs === 0) return
      const toolElapsed = Date.now() - suspendedAt
      if (toolElapsed >= toolThresholdMs) {
        armed = false
        suspended = false
        onTimeout(toolThresholdMs, { phase: 'tool' })
        return
      }
      if (!toolWarned && toolElapsed >= toolWarnMs) {
        toolWarned = true
        onWarn(toolElapsed, { phase: 'tool' })
      }
      schedule()
      return
    }
    const elapsed = Date.now() - lastProgressAt
    if (elapsed >= thresholdMs) {
      armed = false
      onTimeout(thresholdMs, { phase: 'turn' })
      return
    }
    if (!warned && elapsed >= warnMs) {
      warned = true
      onWarn(elapsed, { phase: 'turn' })
    }
    schedule()
  }

  return {
    /**
     * Start the budget.
     * @returns {void}
     */
    arm() {
      if (disabled) return
      lastProgressAt = Date.now()
      warned = false
      suspended = false
      armed = true
      schedule()
    },
    /**
     * Record progress and restart the budget. Progress outside an armed budget is ignored, so
     * an idle session never starts a timer.
     * @returns {void}
     */
    progress() {
      lastProgressAt = Date.now()
      warned = false
      if (armed) schedule()
    },
    /**
     * Stop the budget while a tool call is in flight, so a long tool or a question waiting on
     * the person is never mistaken for a stuck step.
     * @returns {void}
     */
    suspend() {
      suspended = true
      suspendedAt = Date.now()
      toolWarned = false
      schedule()
    },
    /**
     * Resume the budget after a tool call returned, measuring from now.
     * @returns {void}
     */
    resume() {
      if (!suspended) return
      suspended = false
      suspendedAt = 0
      toolWarned = false
      lastProgressAt = Date.now()
      warned = false
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
    /** @returns {boolean} whether a tool call currently holds the budget open. */
    get suspended() {
      return suspended
    },
  }
}
