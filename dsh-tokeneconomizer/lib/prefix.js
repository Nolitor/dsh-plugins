/**
 * KV-cache-safe static prefix slot.
 *
 * The provider's prompt cache is a prefix cache over the request messages, and the request's
 * first message is the single system prompt the harness assembles from the registered
 * sections. This module keeps the plugin's pinned text inside that message and verifies that
 * the committed system node keeps the bytes it was mounted with, so a mid-session change is
 * reported instead of silently resetting the cached prefix.
 *
 * The guard observes only. The harness owns the system node, and the plugin does not rewrite
 * it: a replacement would move every later message in the transcript.
 */

/** Section name of the plugin's pinned rules inside the system prompt. */
export const PINNED_SECTION_NAME = 'tokeneconomizer:pinned-rules'

/** Default section order of the pinned rules, between the persona prefix and the plan policy. */
export const DEFAULT_PINNED_RULES_ORDER = 50

/**
 * Build the pinned-rules section descriptor.
 *
 * The text is a constant, so the rendered system prompt cannot drift between requests, and
 * interpolation is off, so the text is never rewritten by a prompt variable.
 * @param {string} text - the pinned text.
 * @param {number} order - section order inside the system prompt.
 * @returns {object} a section descriptor for `systemPrompt.section()`.
 */
export function pinnedSection(text, order) {
  return { name: PINNED_SECTION_NAME, order, text, interpolate: false }
}

/**
 * Create one session's prefix guard.
 * @returns {object} the guard.
 */
export function createPrefixGuard() {
  /** Bytes of the effective system message as first observed. */
  let baseline = null
  /** Number of later observations whose bytes differ from the baseline. */
  let changes = 0
  return {
    /**
     * Record the effective system text of the current request.
     * @param {string} text - the model-visible system message text.
     * @returns {object} `{ first, changed }` for the caller to report.
     */
    observe(text) {
      if (baseline === null) {
        baseline = text
        return { first: true, changed: false }
      }
      if (text === baseline) return { first: false, changed: false }
      changes += 1
      return { first: false, changed: true }
    },
    /** @returns {number} observed changes of the system node. */
    get changes() {
      return changes
    },
  }
}
