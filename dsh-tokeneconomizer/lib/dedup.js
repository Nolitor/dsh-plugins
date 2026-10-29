/**
 * Tool-result hash deduplication, in memory only.
 *
 * One session keeps a SHA-256 map of the tool outputs the model has already been shown. The
 * first occurrence keeps its full text; every later occurrence of the same output is replaced,
 * in the model-visible copy only, by a pointer to the step that produced it.
 *
 * Only digests are retained. The raw text of the first occurrence is already in the session
 * log, and a duplicate is by definition identical to it, so no copy of the output is kept
 * here. The map is bounded: the oldest digest is evicted when the budget is exhausted.
 */
import { createHash } from 'node:crypto'

/** Shortest output worth replacing: below this a pointer costs more than it saves. */
export const DEFAULT_MIN_CHARS = 200

/** Upper bound on remembered digests, so a long session cannot grow the map without limit. */
export const DEFAULT_MAX_ENTRIES = 512

/** Number of hash characters quoted in the pointer. */
export const SHORT_HASH_CHARS = 12

/**
 * SHA-256 of one output text.
 * @param {string} text - the tool output text.
 * @returns {string} the hex digest.
 */
export function hashText(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex')
}

/**
 * The pointer that replaces a repeated output.
 * @param {number} step - step of the first occurrence.
 * @param {string} digest - hex digest of the output.
 * @returns {string} the pointer text.
 */
export function pointerText(step, digest) {
  return `[Output identical to step ${step} (hash: ${digest.slice(0, SHORT_HASH_CHARS)}), content omitted to save context]`
}

/**
 * Create one session's dedup store.
 * @param {{ minChars?: number, maxEntries?: number }} [options] - the budgets.
 * @returns {object} the store.
 */
export function createDedupStore(options = {}) {
  const minChars = options.minChars ?? DEFAULT_MIN_CHARS
  const maxEntries = options.maxEntries ?? DEFAULT_MAX_ENTRIES
  /** digest -> { count, step } for the outputs already seen, in insertion order. */
  const seen = new Map()
  return {
    /**
     * Record one output and report whether it repeats an earlier one.
     * @param {string} text - the tool output text.
     * @param {number} step - the step that produced the output.
     * @returns {object | undefined} the pointer decision, or undefined to keep the output.
     */
    observe(text, step) {
      if (text.length < minChars) return undefined
      const digest = hashText(text)
      const entry = seen.get(digest)
      if (entry === undefined) {
        if (seen.size >= maxEntries) seen.delete(seen.keys().next().value)
        seen.set(digest, { count: 1, step })
        return undefined
      }
      entry.count += 1
      return { digest, count: entry.count, step: entry.step, text: pointerText(entry.step, digest) }
    },
    /**
     * Forget every remembered output.
     * @returns {void}
     */
    clear() {
      seen.clear()
    },
    /** @returns {number} remembered digests. */
    get size() {
      return seen.size
    },
  }
}
