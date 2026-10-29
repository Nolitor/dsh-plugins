/**
 * OpenCode v2.2.0 shared core: argv assembly, ndjson event parsing, and token
 * accounting. Hand-written ESM, no build step.
 *
 * Shape follows @quonaro/dsh-plugin-opencode/lib/shared-*.js so the two trees
 * diff cleanly; the v2 surface differences are:
 *   - v2 rejects `--attach` and `--pure` ("Unrecognized flag", exit 1, usage on
 *     stdout)       -> never emitted.
 *   - v2 adds `--thinking`, `--title`, `-f/--file` -> exposed here.
 *   - v2 emits `step_start` / `reasoning` / `text` on a tool-free run, and no
 *     `step_finish` there. A run that USES a tool emits `step_finish` with a
 *     per-step `tokens` object — never a whole-run total.
 *   - Authoritative usage comes from `opencode session export <sid>`.
 *
 * @see OPENCODE-V2-SURFACE-MEASUREMENT.md (workspace root)
 */

/**
 * Collect the env entries a forwardEnv list names, skipping unset variables.
 * @param {readonly string[]} names
 * @returns {Record<string, string>}
 */
export function forwardedEnv(names) {
  const env = {}
  for (const key of names) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
}

/**
 * Flags that opencode v2.2.0 rejects. Used by tests and by a defensive filter
 * on `extraArgs` so a stale config value cannot brick every run.
 */
export const UNSUPPORTED_V2_FLAGS = Object.freeze(['--attach', '--pure'])

/**
 * Drop `--attach <value>` / `--pure` (and `--attach=<value>`) pairs from an
 * extraArgs list. Keeps every other token verbatim, order intact.
 * @param {readonly string[]} args
 * @returns {string[]}
 */
export function stripUnsupportedFlags(args) {
  const out = []
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]
    if (arg === '--attach') {
      i++
      continue
    }
    if (arg === '--pure' || arg.startsWith('--attach=') || arg.startsWith('--pure=')) continue
    out.push(arg)
  }
  return out
}

/**
 * Assemble `opencode run` argv (without the executable itself).
 * The prompt is always last, behind `--`, so it can never parse as a flag.
 *
 * Flag order mirrors upstream (model, agent, auto, fork, session, then the
 * v2-only additions, then format, extraArgs, prompt).
 *
 * `attach` and `pure` are deliberately absent: opencode v2.2.0 does not know
 * them and exits 1 with a usage dump on stdout. Callers may keep passing the
 * keys (old profile rows); they are ignored here by design.
 *
 * @param {{
 *   model?: string,
 *   agent?: string,
 *   auto?: boolean,
 *   fork?: boolean,
 *   session?: string,
 *   continueLast?: boolean,
 *   thinking?: boolean,
 *   title?: string,
 *   files?: readonly string[],
 *   format?: string,
 *   extraArgs?: readonly string[],
 * }} flags
 * @param {string} prompt
 * @returns {string[]}
 */
export function buildRunArgv(flags, prompt) {
  const argv = ['run']
  if (flags.model) argv.push('-m', flags.model)
  if (flags.agent) argv.push('--agent', flags.agent)
  if (flags.auto) argv.push('--auto')
  if (flags.fork) argv.push('--fork')
  if (flags.session) argv.push('-s', flags.session)
  else if (flags.continueLast) argv.push('-c')
  if (flags.thinking) argv.push('--thinking')
  if (flags.title) argv.push('--title', flags.title)
  if (flags.files) for (const file of flags.files) if (file) argv.push('-f', file)
  if (flags.format && flags.format !== 'default') argv.push('--format', flags.format)
  // Strip here as well so the invariant is local to the builder: callers are
  // not required to pre-sanitise, and a stale config value can never reach argv.
  if (flags.extraArgs) argv.push(...stripUnsupportedFlags(flags.extraArgs))
  argv.push('--', prompt)
  return argv
}

/**
 * Diff one cumulative snapshot against what was already emitted for that part.
 * Snapshot semantics: `part.text` always carries the whole text of the part so
 * far, never a delta.
 * @param {Map<string, string>} emitted
 * @param {string} id
 * @param {string} next
 * @returns {string} the new suffix
 */
function snapshotDelta(emitted, id, next) {
  const prev = emitted.get(id) ?? ''
  if (next === prev) return ''
  if (next.startsWith(prev)) {
    emitted.set(id, next)
    return next.slice(prev.length)
  }
  // Divergent snapshot (part rewound/replaced): re-emit it whole, separated.
  emitted.set(id, next)
  return prev ? `\n${next}` : next
}

/**
 * Incremental ndjson parser for `opencode run --format json` on v2.
 *
 * `feedLine()` returns a structured event ({kind: 'text'|'reasoning', partId,
 * delta}) or null; `feed()`/`finish()` return the ordered event list so both the
 * tool (which only wants final text) and the provider (which wants delta
 * order) can consume the same parse.
 *
 * Unknown event types are counted, never fatal. `step_finish` is still
 * tolerated in case a future v2 release restores it.
 */
export class JsonRunParser {
  /** part id -> full emitted text (per part), for snapshot diffing. */
  textParts = new Map()
  reasoningParts = new Map()
  sessionId = ''
  /** Per-step `step_finish` token/cost totals; 0 for a tool-free v2 run. */
  inputTokens = 0
  outputTokens = 0
  cost = 0
  errors = []
  sawEvents = false
  /** Ordered reasonings + texts, as `{kind, partId, delta}`. */
  events = []

  /**
   * Feed one complete stdout line.
   * @param {string} line
   * @returns {{kind: 'text'|'reasoning', partId: string, delta: string} | null}
   */
  feedLine(line) {
    if (!line || !line.trim()) return null
    let event
    try {
      event = JSON.parse(line)
    } catch {
      return null
    }
    if (!event || typeof event !== 'object' || Array.isArray(event)) return null
    this.sawEvents = true
    if (typeof event.sessionID === 'string' && event.sessionID) this.sessionId = event.sessionID

    const part = event.part && typeof event.part === 'object' ? event.part : undefined

    if (event.type === 'text' && part && typeof part.text === 'string') {
      const id = part.id ?? `anon-text-${this.textParts.size}`
      const delta = snapshotDelta(this.textParts, id, part.text)
      if (!delta) return null
      const out = { kind: 'text', partId: id, delta }
      this.events.push(out)
      return out
    }

    if (event.type === 'reasoning' && part && typeof part.text === 'string') {
      const id = part.id ?? `anon-reasoning-${this.reasoningParts.size}`
      const delta = snapshotDelta(this.reasoningParts, id, part.text)
      if (!delta) return null
      const out = { kind: 'reasoning', partId: id, delta }
      this.events.push(out)
      return out
    }

    // A tool-using step's terminal event. Its tokens are that step's, never the
    // whole run's, so they are not the authoritative usage source.
    if (event.type === 'step_finish') {
      const tokens = part?.tokens ?? event.tokens
      if (tokens && typeof tokens === 'object') {
        this.inputTokens += Number(tokens.input) || 0
        this.outputTokens += Number(tokens.output) || 0
      }
      this.cost += Number(part?.cost ?? event.cost) || 0
      return null
    }

    if (event.type === 'error') {
      this.errors.push(errorMessage(event))
      return null
    }

    return null
  }

  /**
   * Feed a stdout chunk; appends complete lines to the carry buffer and
   * returns the ordered events they produced.
   * @param {string} text
   * @param {{buffer: string}} carry
   * @returns {{kind: 'text'|'reasoning', partId: string, delta: string}[]}
   */
  feed(text, carry) {
    carry.buffer += text
    const out = []
    let idx
    while ((idx = carry.buffer.indexOf('\n')) >= 0) {
      const event = this.feedLine(carry.buffer.slice(0, idx))
      carry.buffer = carry.buffer.slice(idx + 1)
      if (event) out.push(event)
    }
    return out
  }

  /**
   * Flush the trailing unterminated line (if any) and summarise.
   * @param {{buffer: string}} carry
   * @returns {ReturnType<JsonRunParser['summary']>}
   */
  finish(carry) {
    if (!carry) return this.summary()
    // Drain every complete line still buffered, then the trailing fragment.
    this.feed('', carry)
    if (carry.buffer && carry.buffer.trim()) this.feedLine(carry.buffer)
    carry.buffer = ''
    return this.summary()
  }

  /** Running summary. `text`/`reasoning` are the assembled blocks in part order. */
  summary() {
    return {
      text: [...this.textParts.values()].join(''),
      reasoning: [...this.reasoningParts.values()].join(''),
      sessionId: this.sessionId,
      inputTokens: this.inputTokens,
      outputTokens: this.outputTokens,
      cost: this.cost,
      errors: [...this.errors],
      sawEvents: this.sawEvents,
      events: [...this.events],
    }
  }
}

/** Best-effort human message from an `{"type":"error"}` event. */
function errorMessage(event) {
  const error = event.error
  if (typeof error === 'string') return error
  if (error && typeof error === 'object') {
    if (typeof error.message === 'string') return error.message
    if (typeof error.data?.message === 'string') return error.data.message
    if (typeof error.name === 'string') {
      const data = error.data && typeof error.data === 'object' ? `: ${JSON.stringify(error.data)}` : ''
      return `${error.name}${data}`
    }
  }
  if (typeof event.message === 'string') return event.message
  return 'unknown opencode error'
}

/** Parse `opencode models`: one `provider/model` id per line; banners skipped. */
export function modelsFromCliOutput(text) {
  const models = []
  for (const raw of String(text ?? '').split('\n')) {
    const id = raw.trim()
    if (!/^[^\s/]+\/\S+$/.test(id)) continue
    models.push({ id, name: id })
  }
  return models.length ? { models } : null
}

/**
 * Spawn a short-lived `opencode <argv>` child, capture it, and return the text.
 * Shared by `session export` and `models` so both honour the same env/timeout
 * and one helper — callers own the `ctx.subprocess` seam.
 *
 * @param {*} ctx
 * @param {{
 *   executable: string,
 *   argv: (executable: string) => string[],
 *   cwd?: string,
 *   env: Record<string, string>,
 *   timeoutMs: number,
 *   signal?: AbortSignal,
 *   maxBytes?: number,
 *   stderrMaxBytes?: number,
 * }} options
 * @returns {Promise<{exitCode: number, stdout: string, stderr: string, timedOut: boolean} | null>}
 */
export async function captureCli(ctx, options) {
  const timeout = AbortSignal.timeout(options.timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  let handle
  try {
    handle = ctx.subprocess.spawn({
      argv: options.argv(options.executable),
      cwd: options.cwd || process.cwd(),
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: options.maxBytes ?? 4194304 },
        stderr: { maxBytes: options.stderrMaxBytes ?? 65536 },
      },
      graceMs: 5000,
      signal,
      env: options.env,
    })
  } catch {
    return null
  }
  try {
    const outcome = await handle.done
    const stdout = handle.collected?.stdout?.readFrom(0)?.text ?? ''
    const stderr = handle.collected?.stderr?.readFrom(0)?.text ?? ''
    return { exitCode: outcome.exitCode ?? -1, stdout, stderr, timedOut: timeout.aborted }
  } catch {
    return null
  } finally {
    try {
      handle.terminate()
      await handle.waitForExit?.(AbortSignal.timeout(3000)).catch(() => false)
    } catch {
      /* already gone */
    }
  }
}

/**
 * Map an `opencode session export <sid>` payload onto the host `TokenUsage`
 * contract (@deepseek-ai/dsh-llm types.d.ts:155). The contract is DISJOINT:
 * `inputTokens` is uncached input only, cache hits are reported separately.
 *
 * OpenCode's `info.tokens` already separates them:
 *   { input, output, reasoning, cache: { read, write } }
 *
 * @param {unknown} exported - parsed session export JSON
 * @returns {{inputTokens: number, outputTokens: number, reasoningTokens: number,
 *   cacheReadTokens: number, cacheWriteTokens: number, totalTokens: number} | null} null when absent
 */
export function usageFromSessionExport(exported) {
  if (!exported || typeof exported !== 'object') return null
  const info = exported.info && typeof exported.info === 'object' ? exported.info : exported
  const tokens = info.tokens
  if (!tokens || typeof tokens !== 'object') return null
  const count = (value) => {
    const n = Number(value)
    return Number.isFinite(n) && n >= 0 ? Math.trunc(n) : 0
  }
  const cache = tokens.cache && typeof tokens.cache === 'object' ? tokens.cache : {}
  const inputTokens = count(tokens.input)
  const outputTokens = count(tokens.output)
  const reasoningTokens = count(tokens.reasoning)
  const cacheReadTokens = count(cache.read)
  const cacheWriteTokens = count(cache.write)
  return {
    inputTokens,
    outputTokens,
    reasoningTokens,
    cacheReadTokens,
    cacheWriteTokens,
    totalTokens: inputTokens + outputTokens + reasoningTokens + cacheReadTokens + cacheWriteTokens,
  }
}

/**
 * Fetch authoritative usage for one finished session.
 * Returns null on any failure (missing id, unknown session, bad JSON, timeout):
 * callers must OMIT usage rather than invent numbers.
 *
 * @param {{
 *   ctx: any,
 *   opencodePath: string,
 *   sessionId: string,
 *   env: Record<string, string>,
 *   cwd?: string,
 *   timeoutMs?: number,
 *   signal?: AbortSignal,
 * }} options
 * @returns {Promise<ReturnType<typeof usageFromSessionExport>>}
 */
export async function fetchUsage(options) {
  const { ctx, opencodePath, sessionId } = options
  if (!ctx?.subprocess || !sessionId) return null
  try {
    const executable = await ctx.subprocess.resolveExecutable(opencodePath, options.env, options.signal)
    const captured = await captureCli(ctx, {
      executable,
      argv: (bin) => [bin, 'session', 'export', sessionId],
      cwd: options.cwd,
      env: options.env,
      timeoutMs: options.timeoutMs ?? 60000,
      signal: options.signal,
      maxBytes: 8388608,
      stderrMaxBytes: 65536,
    })
    if (!captured || captured.exitCode !== 0) return null
    let exported
    try {
      exported = JSON.parse(captured.stdout)
    } catch {
      return null
    }
    return usageFromSessionExport(exported)
  } catch {
    return null
  }
}

/** True when `id` is a `provider/model` route, which is what `-m` expects. */
export function isModelRoute(id) {
  return typeof id === 'string' && id.length > 0 && !id.includes(' ')
}

/** A short, safe tail of stderr for error surfaces. */
export function stderrTail(text, max = 400) {
  const clean = String(text ?? '').trim()
  return clean.length > max ? clean.slice(-max) : clean
}
