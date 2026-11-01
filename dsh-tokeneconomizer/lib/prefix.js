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
 * The constant routing guidance mounted when Think-in-Code is on.
 *
 * Two lines, and deliberately constant. This text is part of the request's first message, so a
 * value that varied per session or per turn would rewrite the head of the cached prefix.
 */
export const THINK_IN_CODE_RULES = [
  'For a large inspection (many files, long logs, wide searches), write one short script and run it',
  'instead of reading file after file: keep only the few lines of result that answer the question.',
].join('\n')

/**
 * Compose the pinned section text from the person's own rules and the routing guidance.
 *
 * Both parts are constants, so the composed text is stable for a whole session; when both are
 * empty the caller mounts no section at all rather than an empty one.
 * @param {string} rules - the configured pinned rules, or an empty string.
 * @param {boolean} thinkInCode - whether the routing guidance is on.
 * @returns {string} the section text, or an empty string when there is nothing to pin.
 */
export function composePinnedText(rules, thinkInCode) {
  const parts = [String(rules ?? '').trim(), thinkInCode ? THINK_IN_CODE_RULES : '']
    .filter(Boolean)
  return parts.join('\n\n')
}

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
