/**
 * Bottom gate: split classified parts into two destinations.
 *
 *   DSH parser channel : { kind: 'tool-call' } parts -> emitPart() -> the host
 *                        parses and executes the call.
 *   screen channel     : { kind: 'text' | 'reasoning' } parts -> text-delta /
 *                        reasoning-delta. Protocol notation never reaches it.
 *
 * A body call that the top classifier recovered has one of three fates:
 *
 *   promote   no structured call with that name exists in this response, so the
 *             notation was the only representation of the call: it becomes a real
 *             tool-call part and the host executes it.
 *   echo      the same call already arrived as a structured wire field (same id,
 *             or same name with equal arguments): the text copy is dropped and
 *             nothing is promoted, so a call can never execute twice.
 *   supersede a structured call of the same name exists but with different
 *             arguments (measured: the route re-renders the failed attempt, then
 *             sends a corrected call). Dropped, not promoted - executing the stale
 *             attempt would run a call the route already replaced.
 *   undeclared the name is not in the declared tool set: dropped, never executed.
 *
 * Invariants:
 *   G1 the screen channel receives no marker, id or argument payload;
 *   G2 a promoted call is never a duplicate of a structured call;
 *   G3 a candidate is decided once (settle clears the queue).
 */

/** Canonical JSON with sorted keys, for argument equality. */
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map((item) => stableStringify(item)).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + stableStringify(value[key])).join(',') + '}'
}

/** Parse one argument string; returns undefined when it is not a JSON object. */
function parseArgs(value) {
  if (typeof value !== 'string') return undefined
  try {
    const parsed = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : undefined
  } catch { return undefined }
}

/**
 * Whether a candidate is the same call as an already-structured one.
 *
 * @param {{id?: string, name?: string, arguments?: string}} candidate
 * @param {{id?: string, name?: string, arguments?: string}} structured
 * @returns {boolean}
 */
export function sameCall(candidate, structured) {
  if (!candidate || !structured) return false
  if (candidate.id && structured.id && candidate.id === structured.id) return true
  if (candidate.name !== structured.name) return false
  const left = parseArgs(candidate.arguments)
  const right = parseArgs(structured.arguments)
  if (left === undefined || right === undefined) return false
  return stableStringify(left) === stableStringify(right)
}

/**
 * Create the gate.
 *
 * @param {object} [options]
 * @param {Iterable<string>|Set<string>} [options.toolNames] - declared tool names.
 * @returns {{
 *   addCandidate: (part: object) => void,
 *   settle: (structuredCalls?: object[]) => {
 *     promote: object[], dropped: object[],
 *     stats: { candidates: number, promoted: number, echo: number,
 *              superseded: number, undeclared: number },
 *   },
 *   stats: object,
 * }}
 */
export function createDisplayGate(options = {}) {
  const toolNames = options.toolNames instanceof Set
    ? options.toolNames
    : new Set(options.toolNames ?? [])
  const candidates = []
  const stats = { candidates: 0, promoted: 0, echo: 0, superseded: 0, undeclared: 0 }

  const declared = (name) => toolNames.size > 0 && toolNames.has(name)

  return {
    stats,
    /** Queue one tool-call part recovered by the top classifier. */
    addCandidate(part) {
      if (!part || typeof part !== 'object' || part.kind !== 'tool-call') return
      const name = typeof part.name === 'string' ? part.name : ''
      if (name.length === 0) return
      candidates.push({
        kind: 'tool-call',
        id: typeof part.id === 'string' ? part.id : '',
        name,
        arguments: typeof part.arguments === 'string' ? part.arguments : '{}',
        source: 'text',
      })
      stats.candidates += 1
    },
    /**
     * Decide every queued candidate against the structured calls of this
     * response. Called once, after the response body has been consumed.
     *
     * @param {object[]} [structuredCalls] - id/name/arguments of the calls that
     *   arrived as wire fields in the same response.
     */
    settle(structuredCalls = []) {
      const structured = Array.isArray(structuredCalls) ? structuredCalls : []
      const promote = []
      const dropped = []
      const seen = new Set()
      for (const candidate of candidates) {
        const parsed = parseArgs(candidate.arguments)
        const key = candidate.name + '::' + stableStringify(parsed ?? candidate.arguments)
        if (seen.has(key)) { stats.echo += 1; dropped.push({ ...candidate, verdict: 'duplicate' }); continue }
        seen.add(key)
        if (structured.some((call) => sameCall(candidate, call))) {
          stats.echo += 1
          dropped.push({ ...candidate, verdict: 'echo' })
          continue
        }
        const sameName = structured.filter((call) => call && call.name === candidate.name)
        if (sameName.length > 0) {
          // A wire call whose own arguments never parsed cannot execute (measured:
          // INVALID_ARGS after a duplicated snapshot). The body payload is then the
          // only usable statement of that call, so it replaces the broken one.
          const usable = sameName.filter((call) => parseArgs(call.arguments) !== undefined)
          if (usable.length === 0) {
            stats.promoted += 1
            promote.push({ ...candidate, verdict: 'replacement' })
            continue
          }
          stats.superseded += 1
          dropped.push({ ...candidate, verdict: 'superseded' })
          continue
        }
        if (!declared(candidate.name)) {
          stats.undeclared += 1
          dropped.push({ ...candidate, verdict: 'undeclared' })
          continue
        }
        stats.promoted += 1
        promote.push({ ...candidate })
      }
      candidates.length = 0
      return { promote, dropped, stats }
    },
  }
}
