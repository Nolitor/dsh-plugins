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
 */

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
  hotTurns: 5,
  warmTurns: 15,
  headChars: 2000,
  tailChars: 600,
  minChars: 1200,
})

/** Tools whose output is code: kept whole through the warm tier. */
const CODE_TOOLS = new Set([
  'read', 'read_file', 'edit', 'write', 'apply_patch', 'patch', 'grep', 'glob',
  'list', 'ls', 'diff', 'view', 'notebookread', 'notebookedit', 'str_replace',
  'str_replace_editor', 'working_directory', 'skill', 'present',
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
