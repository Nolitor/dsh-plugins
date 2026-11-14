/**
 * Turn-based hierarchical memory policy for tool outputs.
 *
 * A session's context is re-sent on every request, so an old tool output is
 * paid for again and again. Truncating it blindly destroys the working
 * context: the model loses the file it just read and starts guessing, which
 * costs more than the tokens it saves. The policy therefore grades every tool
 * output by how far behind the current turn it is, and by what kind of output
 * it is:
 *
 *   Tier 1 (hot)  the newest turns. Full fidelity, never touched: tool
 *                 outputs, diffs and code reads stay byte-identical.
 *   Tier 2 (warm) middle turns. A lossless structural summary: the head and
 *                 tail stay, the bulk is replaced by an index that keeps the
 *                 file names, the status codes and the structural schema.
 *                 Code reads keep their whole content here: they are the work.
 *   Tier 3 (cold) old turns. Evicted from the model-visible context; the
 *                 durable session log keeps the original, reachable through the
 *                 session query (full-text search) by its turn and step.
 *
 * Every function here is pure: the policy decides, the caller applies.
 *
 * ## The trigger seam
 *
 * The policy is applied from a DSH hook, and the hook this module targets is the
 * non-deprecated `agent/pre-step` waterfall. Its contract is weaker than the
 * deprecated `agent/request` seam it replaces: `agent/request` ran after request
 * assembly and `step/start`, before the system prompt and the accepted user batch
 * were committed, whereas `agent/pre-step` runs at step preparation, before request
 * assembly. That difference is real and is not hidden here: a rewrite triggered from
 * `agent/pre-step` may land **one step later** than it would have on `agent/request`.
 * It still saves tokens on every subsequent step of the turn, and the session/event
 * fallback (which observes `step/start` and applies before the next pre-step) is
 * exposed below as {@link TRIGGERS}. `agent/request` is never chosen.
 *
 * ## Decision records
 *
 * The policy is only half the evidence a later measurement needs. The other
 * half is why a node was graded the way it was, kept even when the surface
 * write that follows is rejected: a decision that produced no rewrite is a
 * measurement fact, not a failure to be hidden. {@link buildTierDecision} is
 * pure and {@link emitTierDecision} is fail-open, so the same policy that
 * decides the write can describe it without being able to break it.
 */

import { createHash } from 'node:crypto'

import { appendRecord, RECORD_NAMES } from './attribution.js'
import { probeAll, SEAM_CATALOG } from './probes.js'

/** The newest turns: full fidelity, never pruned. */
export const TIER_HOT = 'hot'
/** Middle turns: structural summary, code reads intact. */
export const TIER_WARM = 'warm'
/** Old turns: evicted from the model context, kept in the session log. */
export const TIER_COLD = 'cold'

/** Tool outputs that carry code rather than logs. */
export const KIND_CODE = 'code'
/** Tool outputs that carry run logs rather than code. */
export const KIND_LOG = 'log'

/** Default policy: five hot turns, ten warm turns, then cold. */
export const TIER_DEFAULTS = Object.freeze({
  hotTurns: 6,
  warmTurns: 15,
  headChars: 2000,
  tailChars: 600,
  minChars: 3700,
})

/**
 * The marker this plugin puts on a tool result it reduced itself.
 *
 * Deliberately different from the harness's own pruner marker (owned by
 * `dsh-compaction-tool-result-pruner`), so a rewrite found in a log can be attributed from its
 * content alone — the harness pruner writes no record at all, and this plugin does. This module
 * must never carry that other marker's text: a reader greps for it to tell the two apart.
 */
export const PLUGIN_PRUNE_MARKER = '[... tokeneconomizer: tool result reduced ...]'

/** Tools whose output is code: kept whole through the warm tier. */
const CODE_TOOLS = new Set([
  'read', 'read_file', 'edit', 'write', 'apply_patch', 'patch', 'grep', 'glob',
  'list', 'ls', 'diff', 'view', 'notebookread', 'notebookedit', 'str_replace',
  'str_replace_editor', 'working_directory', 'skill', 'present',
  // A script runner returns the analysis a read would have returned. Its output is code-shaped,
  // so summarizing it into a structural index would drop the lines the call was made for.
  'ctx_execute', 'ctx_execute_file', 'run_code', 'sandbox',
])

/** Shell commands that read a file rather than run something. */
const READ_COMMANDS = /^\s*(cat|head|tail|less|more|sed\s+-n|awk|bat|nl|od|xxd|grep|rg|find|ls|tree|stat|file|wc)\b/i

/**
 * The tier of one tool output, by the age of its turn.
 * @param {number} turn - the turn the output belongs to.
 * @param {number} currentTurn - the turn the session is in.
 * @param {{ hotTurns: number, warmTurns: number }} policy - the tier boundaries.
 * @returns {string} the tier name.
 */
export function tierForTurn (turn, currentTurn, policy = TIER_DEFAULTS) {
  const age = currentTurn - turn
  if (age < policy.hotTurns) return TIER_HOT
  if (age < policy.warmTurns) return TIER_WARM
  return TIER_COLD
}

/**
 * Whether one tool call carries code or a run log.
 *
 * A shell call is a code read when its command reads a file, and a log
 * otherwise; the two are graded differently, because a code read is the work
 * and a log is noise.
 * @param {string} name - the tool name.
 * @param {unknown} args - the tool arguments.
 * @returns {string} the kind name.
 */
export function classifyTool (name, args) {
  const tool = String(name ?? '').toLowerCase()
  if (CODE_TOOLS.has(tool)) return KIND_CODE
  const command = typeof args === 'string'
    ? args
    : typeof args?.command === 'string' ? args.command : ''
  if (command && READ_COMMANDS.test(command)) return KIND_CODE
  return KIND_LOG
}

/**
 * The structural index of one tool output: what a reader needs to know without
 * the bulk.
 * @param {string} text - the original output.
 * @returns {string} one compact index line.
 */
export function structuralIndex (text) {
  const lines = text.split('\n')
  const files = []
  const seen = new Set()
  const filePattern = /(?:^|[\s"'`([])(\/?[\w.@-]+\/[\w.@-]+\.[A-Za-z0-9]{1,10}|[\w-]+\.[A-Za-z0-9]{1,10})(?=[\s"'`):,\]]|$)/g
  for (const match of text.matchAll(filePattern)) {
    const name = match[1]
    if (!name || name.includes('..')) continue
    if (seen.has(name)) continue
    seen.add(name)
    files.push(name)
    if (files.length >= 20) break
  }
  const statuses = new Set()
  for (const match of text.matchAll(/(?:exit code|exit status|status|code|http)\s*[:=]?\s*(\d{2,5})/gi)) {
    statuses.add(match[1])
    if (statuses.size >= 8) break
  }
  const errors = lines.filter((line) => /\b(error|failed|failure|exception|traceback|denied|refused)\b/i.test(line)).length
  const warnings = lines.filter((line) => /\b(warn|warning|deprecated)\b/i.test(line)).length
  const sections = []
  for (const line of lines) {
    const heading = /^#{1,4}\s+(.{1,60})$/.exec(line) ?? /^\s*"([\w.$-]{1,40})"\s*:/.exec(line)
    if (heading) {
      sections.push(heading[1].trim())
      if (sections.length >= 12) break
    }
  }
  const parts = [
    `lines=${lines.length}`,
    `chars=${text.length}`,
  ]
  if (files.length) parts.push(`files=${files.length} (${files.join(', ')})`)
  if (statuses.size) parts.push(`status=${[...statuses].join('/')}`)
  if (sections.length) parts.push(`schema=${sections.join(' | ')}`)
  if (errors) parts.push(`errors=${errors}`)
  if (warnings) parts.push(`warnings=${warnings}`)
  return parts.join(' | ')
}

/**
 * The warm-tier replacement: the head, the structural index, and the tail.
 * @param {string} text - the original output.
 * @param {{ headChars: number, tailChars: number }} policy - the retained budgets.
 * @returns {string} the summary.
 */
export function structuralSummary (text, policy = TIER_DEFAULTS) {
  const head = text.slice(0, policy.headChars)
  const tail = policy.tailChars > 0 ? text.slice(-policy.tailChars) : ''
  return [
    '[tokeneconomizer] warm tier: the tool output was replaced by its structure.',
    `--- head (${policy.headChars} chars) ---`,
    head,
    '--- index ---',
    structuralIndex(text),
    ...(tail ? [`--- tail (${policy.tailChars} chars) ---`, tail] : []),
  ].join('\n')
}

/**
 * The cold-tier replacement: a pointer to the durable log.
 * @param {{ turn: number, step: number, chars: number, kind: string, name: string }} info - what was evicted.
 * @returns {string} the pointer.
 */
export function evictionNotice (info) {
  return [
    '[tokeneconomizer] cold tier: this tool output was evicted from the model context.',
    PLUGIN_PRUNE_MARKER,
    `tool=${info.name} kind=${info.kind} turn=${info.turn} step=${info.step} chars=${info.chars}`,
    'The full output stays in the session log: read it with the session query (full-text search)',
    `for turn ${info.turn} step ${info.step}.`,
  ].join('\n')
}

/**
 * The replacement content for one tool output, or undefined when the output
 * stays as it is.
 *
 * Tier 1 is never touched. Tier 2 summarizes logs and keeps code whole. Tier 3
 * evicts both, leaving a pointer.
 *
 * @param {{ text: string, kind: string, tier: string, turn: number, step: number, name: string,
 *   policy?: typeof TIER_DEFAULTS }} input - the output and its grading.
 * @returns {string | undefined} the replacement content, or undefined to keep it.
 */
export function tierContent (input) {
  const policy = input.policy ?? TIER_DEFAULTS
  const text = input.text ?? ''
  if (input.tier === TIER_HOT) return undefined
  if (text.length < policy.minChars) return undefined
  if (input.tier === TIER_WARM) {
    if (input.kind === KIND_CODE) return undefined
    return structuralSummary(text, policy)
  }
  return evictionNotice({
    turn: input.turn, step: input.step, chars: text.length, kind: input.kind, name: input.name,
  })
}

/**
 * One policy value as a stable string: primitives by `String`, aggregates by
 * key-sorted JSON. Key order is the only thing JSON leaves unspecified, so the
 * canonical form here is what makes a hash of two equal policies equal.
 * @param {unknown} value - a policy field value.
 * @returns {string} a deterministic rendering.
 */
function canonicalValue (value) {
  if (value === null) return 'null'
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (typeof value === 'string') return value
  if (Array.isArray(value)) return `[${value.map(canonicalValue).join(',')}]`
  if (typeof value === 'object') {
    const keys = Object.keys(value).sort()
    return `{${keys.map((key) => `${key}=${canonicalValue(value[key])}`).join(',')}}`
  }
  return String(value)
}

/**
 * The stable fingerprint of a tier policy: sha1 over its key-sorted
 * `key=value` pairs. Same policy, same hash; a boundary change changes it, so a
 * record can be read against the policy that produced it.
 * @param {object|null|undefined} policy - the policy object, or any non-object.
 * @returns {string} the hex digest.
 */
export function policyHash (policy) {
  const source = policy !== null && typeof policy === 'object' && !Array.isArray(policy) ? policy : {}
  const pairs = Object.keys(source).sort().map((key) => `${key}=${canonicalValue(source[key])}`)
  return createHash('sha1').update(pairs.join('\n')).digest('hex')
}

/**
 * Build one tier-decision payload: the grading of a node, described in the
 * shape {@link import('./attribution.js').RECORD_NAMES.TIER_DECISION} declares.
 *
 * Pure and deterministic: it reads its arguments only, mutates nothing, and
 * hashes the policy instead of copying it, so the same decision always yields
 * the same bytes. It deliberately knows nothing about whether the graded node
 * is rewritable — a decision stands on its own.
 *
 * @param {{ seq: number, tier: string, turn: number, step: number,
 *   policy?: object, reason: string }} input - the graded node and its policy.
 * @returns {{ nodeSeq: number, tier: string, turn: number, step: number,
 *   policyHash: string, reason: string }} the payload.
 */
export function buildTierDecision ({ seq, tier, turn, step, policy, reason }) {
  return {
    nodeSeq: seq,
    tier,
    turn,
    step,
    policyHash: policyHash(policy),
    reason,
  }
}

/**
 * Append the record for one tier decision. Fail-open by contract: attribution
 * is evidence about a decision, never a precondition for one, so nothing here
 * throws and a missing appender is reported rather than raised.
 *
 * @param {object|null|undefined} session - session carrying `appendPluginRecord`.
 * @param {{ nodeSeq: number, tier: string, turn: number, step: number,
 *   policyHash: string, reason: string }} decision - from {@link buildTierDecision}.
 * @param {{ appendPluginRecord?: Function }} [options] - injected appender.
 * @returns {{ ok: boolean, seq?: number, warning?: string, reason?: string }}
 *   the {@link import('./attribution.js').appendRecord} result.
 */
export function emitTierDecision (session, decision, options = {}) {
  try {
    return appendRecord(session, RECORD_NAMES.TIER_DECISION, decision, options)
  } catch (error) {
    return {
      ok: false,
      reason: error instanceof Error ? error.message : String(error),
      warning: 'tier decision record failed; the decision itself is unaffected',
    }
  }
}

/** The hook seams the tiering rewrite can be applied from. */
export const TRIGGERS = Object.freeze({
  /** Preferred: the non-deprecated step-preparation waterfall. */
  PRE_STEP: 'agent/pre-step',
  /** Fallback: observe `step/start` and apply before the next pre-step. */
  SESSION_EVENT: 'session/event',
})

/** The deprecated seam this module must never choose. Kept as a name, not a route. */
const DEPRECATED_REQUEST = 'agent/request'

/** @type {ReadonlySet<string>} */
const KNOWN_TRIGGERS = new Set(Object.values(TRIGGERS))

/**
 * Read one probe row without letting a hostile getter throw outward.
 * @param {unknown} probe - probe-result map, or anything else.
 * @param {string} id - the seam id.
 * @returns {unknown} the row, or `undefined`.
 */
function probeRow (probe, id) {
  if (probe === null || typeof probe !== 'object') return undefined
  try {
    return probe[id]
  } catch {
    return undefined
  }
}

/**
 * Whether a probe row reports the seam as available. Accepts both a
 * `ProbeResult` (`{ ok: true }`) and the bare `true` a caller may synthesize.
 * @param {unknown} row - the probe row.
 * @returns {boolean} true when the seam can be registered on.
 */
function rowOk (row) {
  if (row === true) return true
  if (row === null || typeof row !== 'object') return false
  try {
    return row.ok === true
  } catch {
    return false
  }
}

/**
 * The reason text of a probe row, when it has one.
 * @param {unknown} row - the probe row.
 * @returns {string} the reason, or an empty string.
 */
function rowReason (row) {
  if (row === null || typeof row !== 'object') return ''
  try {
    return typeof row.reason === 'string' ? row.reason : ''
  } catch {
    return ''
  }
}

/**
 * Choose the hook seam the tiering rewrite is applied from.
 *
 * Pure and total: it reads the probe result only, performs no I/O, and never
 * throws — a missing, empty or malformed probe simply lands on the fallback.
 * The fallback order is fixed:
 *
 *   1. `agent/pre-step` — preferred, non-deprecated, the exact step-preparation
 *      waterfall DSH still supports.
 *   2. `session/event` — first-class fallback: it observes `step/start` and
 *      applies before the next pre-step, so a rewrite may land one step later
 *      but still reaches every later step of the turn.
 *
 * `agent/request` is deprecated ("retained for existing listeners; do not add
 * new listeners") and is never returned, not even when it is the only hook the
 * probe reports.
 *
 * @param {Record<string, unknown>|null|undefined} probe - probe results, keyed
 *   by seam id; the rows may be `ProbeResult`s or bare booleans.
 * @returns {{ trigger: string, reason: string }} the chosen seam and why.
 */
export function chooseTrigger (probe) {
  const pre = probeRow(probe, TRIGGERS.PRE_STEP)
  if (rowOk(pre)) {
    const why = rowReason(pre)
    return {
      trigger: TRIGGERS.PRE_STEP,
      reason: why === ''
        ? 'agent/pre-step is available; tiering runs at step preparation'
        : `agent/pre-step is available (${why})`,
    }
  }
  const why = rowReason(pre)
  const missing = why === ''
    ? 'agent/pre-step is absent from the probe'
    : `agent/pre-step is unavailable (${why})`
  return {
    trigger: TRIGGERS.SESSION_EVENT,
    reason: `${missing}; ${
      rowOk(probeRow(probe, DEPRECATED_REQUEST))
        ? 'agent/request is deprecated and is not used'
        : 'using the session/event fallback (step/start)'
    }`,
  }
}

/**
 * Whether a value is a ctx whose event surface can carry a listener.
 * @param {unknown} ctx - the candidate context.
 * @returns {boolean} true when `ctx.on` is callable.
 */
function hasEventSurface (ctx) {
  if (ctx === null || typeof ctx !== 'object' && typeof ctx !== 'function') return false
  try {
    return typeof ctx.on === 'function'
  } catch {
    return false
  }
}

/**
 * Whether this build's seam catalog still declares the pre-step waterfall as a
 * live, non-deprecated contract.
 * @returns {boolean} true when the catalog row exists and is not deprecated.
 */
function catalogSupportsPreStep () {
  try {
    const row = SEAM_CATALOG.find((entry) => entry?.id === TRIGGERS.PRE_STEP)
    return row !== undefined && row.deprecated !== true
  } catch {
    return false
  }
}

/**
 * The event vocabulary a context declares, when it declares one.
 *
 * A real Cordis context does not enumerate its event names, so this is usually
 * `undefined`, and the presence of the hook has to be inferred (see
 * {@link triggerProbe}). When a caller *does* hand over an explicit list, that
 * list is authoritative: omitting the hook is positive proof the hook is gone.
 *
 * Only an explicit name list counts. `ctx.events` is a Cordis *service object*,
 * never a vocabulary, so reading a vocabulary out of its property names would
 * report every hook as absent on a live host.
 *
 * @param {unknown} ctx - the context to inspect.
 * @returns {string[]|undefined} the declared names, or `undefined`.
 */
function declaredEventTypes (ctx) {
  if (ctx === null || typeof ctx !== 'object') return undefined
  for (const key of ['eventTypes', 'knownEventTypes']) {
    let candidate
    try {
      candidate = ctx[key]
    } catch {
      continue
    }
    if (Array.isArray(candidate)) return candidate.map(String)
    if (candidate instanceof Set) return [...candidate].map(String)
    if (candidate !== null && typeof candidate === 'object' && typeof candidate.has === 'function') {
      try {
        if (candidate.has(TRIGGERS.PRE_STEP)) return [TRIGGERS.PRE_STEP]
        return []
      } catch {
        continue
      }
    }
  }
  return undefined
}

/**
 * Build the probe map {@link chooseTrigger} reads, from the live context and
 * the seam sweep {@link probeAll} produces.
 *
 * `probes.js` can only inspect hook *values* it finds on a context, and Cordis
 * accepts a listener under any event name, so a failed lookup is not proof the
 * waterfall is gone. This function therefore refuses to read silence as absence:
 *
 *   - an explicit probe hit wins outright;
 *   - a context that declares an event vocabulary omitting the hook is taken at
 *     its word, and the `session/event` fallback is chosen;
 *   - otherwise the declared seam catalog and a live event surface stand in for
 *     introspection, which is what this build targets.
 *
 * Never throws, and never reports `agent/request`: this function only ever
 * speaks about `agent/pre-step` and `session/event`.
 *
 * @param {unknown} ctx - the agent-scoped context.
 * @param {Record<string, unknown>} [probed] - an existing {@link probeAll} sweep.
 * @returns {Record<string, unknown>} the probe map for {@link chooseTrigger}.
 */
export function triggerProbe (ctx, probed) {
  let rows
  try {
    rows = probed ?? probeAll(ctx)
  } catch {
    rows = {}
  }
  if (rows === null || typeof rows !== 'object') rows = {}
  if (rowOk(probeRow(rows, TRIGGERS.PRE_STEP))) return rows
  const declared = declaredEventTypes(ctx)
  if (declared !== undefined && declared.length > 0 && !declared.includes(TRIGGERS.PRE_STEP)) {
    return rows
  }
  if (!hasEventSurface(ctx) || !catalogSupportsPreStep()) return rows
  return {
    ...rows,
    [TRIGGERS.PRE_STEP]: {
      ok: true,
      reason: 'declared by the seam catalog; the ctx event surface is present',
    },
  }
}

/**
 * The seam name recorded on a tiering decision. Accepts the object returned by
 * {@link chooseTrigger} or a bare trigger string, and normalizes anything
 * unknown to the safe fallback — this function must never yield the deprecated
 * `agent/request`.
 *
 * @param {{ trigger?: string }|string|null|undefined} chosen - the choice.
 * @returns {string} one of {@link TRIGGERS}.
 */
export function decidedAtTrigger (chosen) {
  let trigger
  try {
    trigger = typeof chosen === 'string'
      ? chosen
      : chosen !== null && typeof chosen === 'object'
        ? chosen.trigger
        : undefined
  } catch {
    trigger = undefined
  }
  return typeof trigger === 'string' && KNOWN_TRIGGERS.has(trigger) ? trigger : TRIGGERS.SESSION_EVENT
}
