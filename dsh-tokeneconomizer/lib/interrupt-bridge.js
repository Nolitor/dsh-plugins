/**
 * Bridge to the shared interrupt registry (total_skill commit ebd7540).
 *
 * The watchdog has to RECORD its interrupt before it cancels, so the turn-exit reason names
 * a system issuer instead of an anonymous abort. The registry therefore has to be loaded
 * before the first deadline fires, not inside it.
 *
 * Everything here is fail-open: a missing or broken registry never stops the watchdog from
 * cancelling the turn. The record is attribution, not control.
 */

const DEFAULT_CORE_URL = 'file:///home/minami/Workspace/projects/total_skill/src/interrupt-core.js'
const DEFAULT_REASONS_URL = 'file:///home/minami/Workspace/projects/total_skill/src/reasons.js'

/** The issuer slug this bridge records. */
export const WATCHDOG_ISSUER = 'watchdog_timeout'

/**
 * Create one recorder.
 *
 * @param {object} [options] - overrides, mainly for tests.
 * @param {string} [options.coreUrl] - module URL of the interrupt core.
 * @param {string} [options.reasonsUrl] - module URL of the wording helpers.
 * @returns {object} the recorder: `init()`, `record(scope, reason)`, `loaded`.
 */
export function createInterruptRecorder(options = {}) {
  const coreUrl = options.coreUrl ?? process.env.DSH_INTERRUPT_CORE_URL ?? DEFAULT_CORE_URL
  const reasonsUrl = options.reasonsUrl ?? process.env.DSH_INTERRUPT_REASONS_URL ?? DEFAULT_REASONS_URL
  let core = null
  let reasons = null

  const ready = (async () => {
    try {
      const loaded = await Promise.all([import(coreUrl), import(reasonsUrl)])
      const loadedCore = loaded[0]
      if (typeof loadedCore?.interrupts?.requestInterrupt !== 'function') return
      core = loadedCore
      reasons = loaded[1]
    } catch {
      core = null
      reasons = null
    }
  })()

  return {
    /** Await the one-time load; safe to call repeatedly. */
    init: () => ready,
    /** @returns {boolean} whether the registry is usable. */
    get loaded() {
      return core !== null
    },
    /**
     * Record one interrupt synchronously. Callers cancel immediately after.
     * @param {string} scope - the agent id the interrupt belongs to.
     * @param {string} [reason] - the issuer slug.
     * @returns {object} `{ recorded, issuer?, wording?, detail? }`.
     */
    record(scope, reason = WATCHDOG_ISSUER) {
      if (core === null) return { recorded: false, detail: 'registry unavailable' }
      try {
        const id = String(scope)
        const accepted = core.interrupts.requestInterrupt(id, { reason, hard: false })
        if (!accepted) return { recorded: false, detail: 'declined: the scope made progress' }
        const snap = core.interrupts.snapshot(id)
        return {
          recorded: true,
          issuer: reasons?.interruptIssuer?.(snap.reason) ?? reason,
          wording: reasons?.interruptSkipWording?.(snap.reason) ?? reason,
        }
      } catch (error) {
        return { recorded: false, detail: 'error: ' + (error instanceof Error ? error.message : String(error)) }
      }
    },
  }
}
