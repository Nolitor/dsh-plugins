/**
 * Pass-through reducer for already-typed stream parts.
 *
 * Part typing is decided upstream (lib/upstream-map.js), following the OpenAI /
 * Vercel AI SDK wire: `delta.reasoning_content` -> `reasoning`, `delta.tool_calls`
 * -> `tool-call`, `delta.content` -> `text`. By the time a part reaches this
 * module it already carries its kind, so this module never inspects characters:
 * no tag scanning, no regex over text, no bytes held back, no state machine. The
 * invariant is `output === input` — the same parts, the same objects, in the same
 * order, with nothing added, merged, split, reordered or dropped.
 */

/**
 * Create a reducer that counts parts and returns them untouched.
 *
 * @param {object} [options] - accepted for call-site compatibility; a
 *   pass-through has nothing to configure, so every field is ignored.
 * @returns {{
 *   push: (parts: object[]) => object[],
 *   pushPart: (part: object) => object[],
 *   flush: () => object[],
 *   stats: { text: number, reasoning: number, toolCall: number, total: number },
 * }} the reducer: `push` returns its array argument itself, `pushPart` returns
 *   `[part]` (`[]` for null/undefined), `flush` always returns `[]`, and
 *   `stats` counts what passed through.
 */
export function createPassThroughReducer(options = {}) {
  const stats = { text: 0, reasoning: 0, toolCall: 0, total: 0 }

  /** Account for one part that is about to pass through unchanged. */
  function account(part) {
    stats.total += 1
    const kind = part === null || typeof part !== 'object' ? undefined : part.kind
    if (kind === 'text') stats.text += 1
    else if (kind === 'reasoning') stats.reasoning += 1
    else if (kind === 'tool-call') stats.toolCall += 1
  }

  return {
    stats,
    push(parts) {
      if (!Array.isArray(parts)) return []
      for (const part of parts) account(part)
      return parts
    },
    pushPart(part) {
      if (part === null || part === undefined) return []
      account(part)
      return [part]
    },
    flush() {
      return []
    },
  }
}
