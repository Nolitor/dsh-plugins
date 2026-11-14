/**
 * Surface composition primitives for the token economizer rewrite path.
 *
 * These are pure builders plus one read-only validator. Nothing here mutates a
 * session or appends a record; `lib/surface-attribution.js` owns the write order.
 *
 * ## Verified contract (do not re-derive)
 *
 *  - `surfaceOp` has exactly two forms: the string `'append'` and
 *    `{ op: 'replace', startSeq, endSeq }` with an **inclusive** end.
 *  - `shadowedRange` / `shadowedSeqs` / `shadowedTokenCount` belong to the
 *    `compaction/prune` payload, never to `surfaceOp`.
 *    `shadowedSeqs` is never taken from the caller: it is derived here from the
 *    declared range (a single-node rewrite always shadows exactly one seq), the
 *    same value the session itself derives at fold time. The durable format
 *    (`dsh-session-format-v3-to-v4`) and the token-meter breakdown fold both
 *    read it from the payload, so the payload must state it.
 *  - A replacement must target a **current** surface node. `session.surface.nodes`
 *    (a `SessionSurface`) is the authoritative current list.
 *  - A `tool/result` replacement rewrites **exactly one** current `tool/result`
 *    and may change **only** `data.message.content`.
 *  - The log is append-only; shadowed events remain in the durable log.
 *
 * ## Reading the target event without a deprecated API
 *
 * Measured constraint: `SessionSurface` exposes sequence numbers (`nodes`) and the
 * generation counters (`replaceGeneration`, `contentGeneration`) only — it has no
 * event-body read. A caller must therefore supply the event or a reader, and the
 * module never invokes a deprecated `Session` read itself. The body is resolved
 * from, in order:
 *
 *  1. `options.event` — the caller already holds the event it decided about.
 *  2. `options.readEvent(seq)` — a caller-supplied reader (the plugin's cache or
 *     a host adapter over its own `eventAt`).
 *  3. a surface node object that itself carries `.event`.
 *  4. otherwise: `{ ok: false, reason: 'event-unavailable' }`.
 *
 * There is no fallback to a deprecated read: an unresolvable seq stays unresolved.
 *
 * @module dsh-tokeneconomizer/lib/rewriter
 */

/** The only replace op name the harness accepts. */
const OP_REPLACE = 'replace'

/** Tiers the surface-rewrite record may carry (`attribution.validateRecord`). */
const REWRITE_TIERS = Object.freeze(['warm', 'cold'])

/** Every tier a decision record may carry. */
const DECISION_TIERS = Object.freeze(['hot', 'warm', 'cold'])

/**
 * Deep-freeze a JSON-ish value in place and return it.
 * @param {any} value
 * @returns {any}
 */
function deepFreeze (value) {
  if (value === null || typeof value !== 'object') return value
  if (Object.isFrozen(value)) return value
  for (const key of Object.keys(value)) deepFreeze(value[key])
  return Object.freeze(value)
}

/**
 * Deep-clone a JSON-ish value so mutations cannot reach the input.
 * @param {any} value
 * @returns {any}
 */
function cloneJSON (value) {
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) return value.map(cloneJSON)
  const out = {}
  for (const key of Object.keys(value)) out[key] = cloneJSON(value[key])
  return out
}

/**
 * Read the current sequence numbers off a session surface.
 * @param {any} session
 * @returns {number[]|null} null when no usable surface exists.
 */
function currentNodeSeqs (session) {
  const surface = session && session.surface
  if (!surface) return null
  const nodes = surface.nodes
  if (!Array.isArray(nodes)) return null
  const seqs = []
  for (const node of nodes) {
    if (node && typeof node.seq === 'number') seqs.push(node.seq)
    else if (typeof node === 'number') seqs.push(node)
  }
  return seqs
}

/**
 * Resolve the event body for one current surface seq without a deprecated read.
 * @param {any} session
 * @param {number} seq
 * @param {{ event?: any, readEvent?: Function }} [options]
 * @returns {{ event: any|null, reason: string|null }} the event, or why none.
 */
function resolveEvent (session, seq, options = {}) {
  if (options && options.event && typeof options.event === 'object') {
    const candidate = options.event
    if (typeof candidate.seq === 'number' && candidate.seq !== seq) {
      return { event: null, reason: 'event-seq-mismatch' }
    }
    return { event: candidate, reason: null }
  }

  const surface = session && session.surface

  if (options && typeof options.readEvent === 'function') {
    let found
    try {
      found = options.readEvent(seq)
    } catch (error) {
      return { event: null, reason: `readEvent-threw: ${error instanceof Error ? error.message : String(error)}` }
    }
    if (found !== undefined && found !== null) return { event: found, reason: null }
  }

  if (surface && Array.isArray(surface.nodes)) {
    for (const node of surface.nodes) {
      if (node && typeof node === 'object' && node.seq === seq && node.event) {
        return { event: node.event, reason: null }
      }
    }
  }

  return { event: null, reason: 'event-unavailable' }
}

/**
 * Concatenate the text blocks of a message content array.
 * @param {any} content
 * @returns {string}
 */
function textOfContent (content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (block && block.type === 'text' && typeof block.text === 'string') text += block.text
  }
  return text
}

/**
 * Measure the current text of the target's message.
 * @param {any} event
 * @returns {number} character count, 0 when unmeasurable.
 */
export function measureEventText (event) {
  const data = event && event.data ? event.data : (event || {})
  const message = data.message && typeof data.message === 'object' ? data.message : data
  return textOfContent(message.content).length
}

/**
 * Validate that `seq` is a current, replaceable `tool/result` surface node.
 * Never throws.
 *
 * @param {any} session
 * @param {number} seq
 * @param {{ event?: any, readEvent?: Function }} [options] - event resolution hooks.
 * @returns {{ ok: boolean, reason?: string, event?: any }}
 */
export function validateRewriteTarget (session, seq, options = {}) {
  if (!session || typeof session !== 'object') {
    return { ok: false, reason: 'session-invalid' }
  }
  const surface = session.surface
  if (!surface || !Array.isArray(surface.nodes)) {
    return { ok: false, reason: 'surface-missing' }
  }
  if (typeof seq !== 'number' || !Number.isInteger(seq) || seq < 0) {
    return { ok: false, reason: 'seq-invalid' }
  }
  const seqs = currentNodeSeqs(session)
  if (!seqs || !seqs.includes(seq)) {
    return { ok: false, reason: 'seq-not-current' }
  }
  const resolved = resolveEvent(session, seq, options)
  if (!resolved.event) {
    return { ok: false, reason: resolved.reason || 'event-unavailable' }
  }
  if (resolved.event.type !== 'tool/result') {
    return { ok: false, reason: 'not-tool-result' }
  }
  return { ok: true, event: resolved.event }
}

/**
 * Build the replacement event data: everything preserved, and only
 * `data.message.content` replaced with one text block.
 *
 * @param {any} originalEvent - the current event (or its `data`) at the target seq.
 * @param {string} replacementText - the new message text.
 * @returns {any} frozen event data.
 */
export function buildReplacement (originalEvent, replacementText) {
  const source = originalEvent && originalEvent.data && typeof originalEvent.data === 'object'
    ? originalEvent.data
    : (originalEvent || {})
  const text = typeof replacementText === 'string'
    ? replacementText
    : String(replacementText ?? '')

  const data = cloneJSON(source)
  const message = data.message && typeof data.message === 'object' ? data.message : {}
  message.content = [{ type: 'text', text }]
  data.message = message

  return deepFreeze(data)
}

/**
 * Build the `compaction/prune` payload for one shadowed seq.
 *
 * Shadow fields live here, never on `surfaceOp`. `shadowedSeqs` is derived from
 * the declared single-node range, not supplied by the caller: the durable
 * format and the token-meter breakdown fold both read it from this payload.
 *
 * @param {number} seq
 * @param {number} shadowTokens
 * @returns {any} frozen prune data.
 */
export function buildPrunePayload (seq, shadowTokens) {
  const tokens = typeof shadowTokens === 'number' && Number.isFinite(shadowTokens) && shadowTokens >= 0
    ? shadowTokens
    : 0
  const data = {
    shadowedRange: { start: seq, end: seq },
    shadowedSeqs: [seq],
    shadowedTokenCount: tokens,
  }
  return deepFreeze(data)
}

/**
 * Build the surface intent for a single-node replacement.
 * `sourceEventSeqs` is copied from the target, never inferred.
 *
 * @param {number} seq
 * @returns {any} frozen surface intent.
 */
export function buildSurfaceIntent (seq) {
  return deepFreeze({
    surfaceOp: { op: OP_REPLACE, startSeq: seq, endSeq: seq },
    sourceEventSeqs: [seq],
  })
}

/**
 * Compose the prune payload and the replacement append for one target.
 * Pure: performs no writes.
 *
 * @param {any} session
 * @param {number} seq
 * @param {string} replacementText
 * @param {number} shadowTokens
 * @param {{ event?: any, readEvent?: Function }} [options] - event resolution hooks.
 * @returns {{ ok: boolean, reason?: string, event?: any, pruneData?: any, resultData?: any, resultOptions?: any }}
 */
export function composeRewrite (session, seq, replacementText, shadowTokens, options = {}) {
  const check = validateRewriteTarget(session, seq, options)
  if (!check.ok) return { ok: false, reason: check.reason }

  return {
    ok: true,
    event: check.event,
    pruneData: buildPrunePayload(seq, shadowTokens),
    resultData: buildReplacement(check.event, replacementText),
    resultOptions: buildSurfaceIntent(seq),
  }
}

/**
 * Normalize a caller-supplied tier.
 * @param {unknown} tier
 * @returns {'hot'|'warm'|'cold'|null}
 */
export function normalizeDecisionTier (tier) {
  return DECISION_TIERS.includes(tier) ? tier : null
}

/**
 * Normalize a caller-supplied tier for the surface-rewrite record.
 * @param {unknown} tier
 * @returns {'warm'|'cold'|null}
 */
export function normalizeRewriteTier (tier) {
  return REWRITE_TIERS.includes(tier) ? tier : null
}
