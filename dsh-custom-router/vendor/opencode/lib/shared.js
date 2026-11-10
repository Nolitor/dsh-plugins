/**
 * OpenCode v2.2.0 shared core: argv assembly, ndjson event parsing, and token
 * accounting. Hand-written ESM, no build step.
 *
 * Shape follows @quonaro/dsh-plugin-opencode/lib/shared-*.js so the two trees
 * diff cleanly; the v2 surface differences are:
 *   - v2 rejects `--attach` and `--pure` ("Unrecognized flag", exit 1, usage on
 *     stdout)       -> never emitted.
 *   - v2 adds `--thinking`, `--title`, `-f/--file` -> exposed here.
 *   - v2 selects a reasoning level through the model's `variants`:
 *     `-m provider/model#variant`. `/api/model` lists them per route.
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
 * Compose the `-m` value for one route at one reasoning level.
 *
 * OpenCode selects a model variant with a `#` suffix (`run --help`:
 * `Model to use in the format provider/model#variant`); a variant carries the
 * route's `reasoningEffort` or `thinkingConfig`. An omitted level leaves the
 * route untouched, so OpenCode's own default variant stays in force.
 *
 * @param {string} route - `provider/model`, optionally already carrying a variant
 * @param {string} [effort] - variant id from the route's advertised variants
 * @returns {string} the route to pass to `-m`
 */
export function withVariant(route, effort) {
  if (!route || !effort) return route
  const hash = route.indexOf('#')
  return `${hash === -1 ? route : route.slice(0, hash)}#${effort}`
}

/**
 * Assemble `opencode run` argv (without the executable itself).
 *
 * The prompt is **not** part of argv: it travels on the child's stdin. A
 * single argv string is capped at 128 KiB on Linux (`MAX_ARG_STRLEN`, 32
 * pages) — measured: a 140 KB argument makes `spawn` fail with `E2BIG` while
 * 120 KB succeeds. A flattened DSH transcript routinely exceeds that, and
 * v0.1.2 passed it as one `-- <prompt>` argument, so every long session failed
 * with `OPENCODE_SPAWN` / `spawn E2BIG` before the CLI ever started. Measured
 * v2.2.0: `opencode run` reads the message from stdin when no positional
 * message is given (`printf 'say OK' | opencode run -m …` answers "OK"), and a
 * 200 KB piped prompt is accepted. Use {@link sendPrompt} to deliver it.
 *
 * Flag order mirrors upstream (model, agent, auto, fork, session, then the
 * v2-only additions, then format, extraArgs).
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
 * @returns {string[]}
 */
export function buildRunArgv(flags) {
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
  return argv
}

/**
 * Deliver the run prompt to a child spawned with `stdin: 'pipe'`.
 *
 * `opencode run` takes the message from stdin when it has no positional
 * message argument, so nothing prompt-shaped is ever concatenated into argv
 * (see {@link buildRunArgv} for the E2BIG limit that motivated this). The
 * write is fire-and-forget: the caller observes the outcome through
 * `handle.done`, and a child that exits before consuming the prompt tears the
 * pipe down — that is an exit fact, not a process-killing exception.
 *
 * @param {{stdin?: NodeJS.WritableStream | undefined} | null | undefined} handle
 * @param {string} prompt
 * @returns {boolean} true when the prompt was handed to a live stdin
 */
export function sendPrompt(handle, prompt) {
  const stdin = handle?.stdin
  if (!stdin || typeof stdin.end !== 'function') return false
  try {
    // EPIPE on a child that exits early must not surface as an unhandled
    // 'error' event on the host process.
    stdin.on?.('error', () => {})
    stdin.end(String(prompt ?? ''))
    return true
  } catch {
    return false
  }
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


/**
 * Fallback context window when opencode discloses nothing for a route.
 *
 * `compaction-basic` THROWS when a resolved model has no `context`:
 *   "no context capacity for <provider>/<model>; configure contextWindow on
 *    that adapter model"
 * so a missing value breaks compaction for every opencode model. This floor is
 * deliberately conservative (smallest common modern window) — understating the
 * window only compacts earlier; omitting it breaks the session.
 */
export const DEFAULT_CONTEXT_WINDOW = 32768

/** Default output cap used when opencode discloses no `limit.output`. */
export const DEFAULT_MAX_OUTPUT_TOKENS = 8192

/**
 * Per-turn completion reservation advertised as `defaultMaxTokens`.
 *
 * TWO DIFFERENT NUMBERS, deliberately not the same one:
 *
 *   `limit.output`  the ROUTE'S CAPABILITY (e.g. 384000 on deepseek-v4.1-flash).
 *                   A catalog fact; it belongs in the catalog and the settings UI.
 *   `defaultMaxTokens` what ONE TURN actually reserves. The host uses this for two
 *                   things: the per-request `max_tokens` it fills in when the
 *                   caller omits one, and — through compaction —
 *                   `contextWindow - reservedCompletionTokens - headroom` as the
 *                   budget messages may occupy.
 *
 * Publishing the capability as the reservation therefore costs context for nothing.
 * Measured 2026-11-03 on this profile: 384000 reserved left
 * 1000000 - 384000 - 65536 = 550464 tokens (55.0%) of a 1M window usable, while the
 * real per-step output distribution over 2223 routed steps was p50 661, p99 13077,
 * and only 17 steps (0.76%) ever exceeded 16384.
 *
 * At 16384 the reserved share is 1.6% and messages get 918080 tokens (91.8%) of the
 * window. A step whose reasoning genuinely needs more is truncated by the route, not
 * silently mis-billed: that is the same behaviour every other adapter has.
 */
export const DEFAULT_TURN_MAX_TOKENS = 16384

/**
 * The completion reservation for one turn on a route.
 *
 * Never more than the route can actually emit (a route capping at 8192 cannot
 * reserve 16384) and never more than the configured turn reservation.
 *
 * @param {number|undefined} catalogMaxTokens - the route's own `limit.output`.
 * @param {number|undefined} turnCap - configured per-turn reservation.
 * @returns {number} positive integer tokens to reserve for one completion.
 */
export function turnCompletionReservation(catalogMaxTokens, turnCap) {
  const capability = Number.isFinite(catalogMaxTokens) && catalogMaxTokens > 0
    ? Math.trunc(catalogMaxTokens)
    : DEFAULT_MAX_OUTPUT_TOKENS
  const ceiling = Number.isFinite(turnCap) && turnCap > 0 ? Math.trunc(turnCap) : DEFAULT_TURN_MAX_TOKENS
  return Math.min(capability, ceiling)
}

/**
 * Variant display names and ascending reasoning order.
 *
 * OpenCode names the levels itself; ids are an external spec and stay fixed, so
 * only the labels live here. Ids outside this table keep their raw id and are
 * appended in payload order rather than dropped.
 */
const VARIANT_ORDER = Object.freeze(['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max', 'thinking'])

const VARIANT_NAMES = Object.freeze({
  none: 'None',
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
  thinking: 'Thinking',
})

/**
 * Map a route's `/api/model` variants onto the host reasoning-effort metadata
 * (`LlmModelReasoningInfo.efforts`), least to greatest selectable effort.
 *
 * The host rejects empty or duplicate effort lists, so a route with no variants
 * must advertise none at all rather than an empty one.
 *
 * @param {readonly string[]} variants - variant ids in payload order
 * @returns {{id: string, name: string}[]} efforts for `resolveModel().reasoning`
 */
export function reasoningEffortsFromVariants(variants) {
  const ids = [...new Set((variants ?? []).filter((id) => typeof id === 'string' && id.length > 0))]
  const rank = (id) => {
    const at = VARIANT_ORDER.indexOf(id)
    return at === -1 ? VARIANT_ORDER.length : at
  }
  return ids
    .sort((a, b) => rank(a) - rank(b))
    .map((id) => ({ id, name: VARIANT_NAMES[id] ?? id }))
}

/**
 * Failure message for a reasoning level the route does not offer.
 *
 * The plugin composes `-m provider/model#<variant>` only from levels discovery
 * advertised; this message covers callers that bypass the host's
 * `UNSUPPORTED_REASONING_EFFORT` check (direct adapter use, a selection made
 * against an older catalog). It names the offered levels so a mismatch is
 * actionable instead of OpenCode's opaque "Variant unavailable".
 *
 * @param {string} provider - DSH provider id of the served route
 * @param {string} model - advertised route id that was requested
 * @param {string} effort - requested level id
 * @param {readonly string[]} offered - levels the route advertised, possibly empty
 * @returns {string} one-line failure message
 */
export function unsupportedEffortMessage(provider, model, effort, offered) {
  const levels = (offered ?? []).filter((id) => typeof id === 'string' && id.length > 0)
  return `provider "${provider}" model "${model}" does not support reasoning effort "${effort}"`
    + ` (advertised: ${levels.length ? levels.join(', ') : 'none'})`
}

/**
 * Map one `/api/model` entry from `opencode serve` onto the host catalog shape.
 *
 * Measured v2.2.0 payload: { id, modelID, providerID, name, limit:
 * { context, output, input? }, variants: [{ id, settings }], capabilities, cost,
 * ... }. `limit.context` is the combined request+response window, which is
 * exactly `LlmModelContext.contextWindow`. `variants` are the route's reasoning
 * levels, selected with `-m provider/model#<variant>`.
 *
 * @param {unknown} entry
 * @returns {{id: string, name: string, contextWindow: number, maxTokens: number,
 *   variants?: string[]} | null}
 */
export function modelFromApiEntry(entry) {
  if (!entry || typeof entry !== 'object') return null
  const providerID = typeof entry.providerID === 'string' ? entry.providerID : ''
  const modelID = typeof entry.id === 'string' ? entry.id : typeof entry.modelID === 'string' ? entry.modelID : ''
  if (!providerID || !modelID) return null
  const limit = entry.limit && typeof entry.limit === 'object' ? entry.limit : {}
  const positive = (value) => {
    const n = Number(value)
    return Number.isFinite(n) && n > 0 ? Math.trunc(n) : undefined
  }
  const variants = Array.isArray(entry.variants)
    ? [...new Set(entry.variants.map((variant) => variant?.id).filter((id) => typeof id === 'string' && id.length > 0))]
    : []
  // NOTE on `variants[].settings`: measured 2026-11-03, they are OpenCode's
  // INTERNAL provider options, not OpenAI wire fields. Sending a route's own
  // shape (thinkingConfig.thinkingLevel, thinking+effort, include+reasoningSummary)
  // to /chat/completions produced 400 "cannot be represented by ..." on
  // gpt-6-luna and claude-haiku-5-5, and a 503 on gemini-4-argon. They are
  // deliberately NOT forwarded: the levels reach the wire through
  // `reasoning_effort`, which the same measurement showed is honoured.
  // `capabilities.input` is the route's own statement of what it accepts. The
  // host's modality vocabulary is only text|image, so audio/video/pdf are not
  // advertised - but an image-capable route must not be advertised as
  // text-only, which would make the host refuse an image before the request is
  // even built (dsh-subagent: MODEL_DOES_NOT_SUPPORT_IMAGES).
  const declaredInput = Array.isArray(entry.capabilities?.input) ? entry.capabilities.input : []
  const inputModalities = declaredInput.includes('image') ? ['text', 'image'] : ['text']
  return {
    id: `${providerID}/${modelID}`,
    name: typeof entry.name === 'string' && entry.name ? entry.name : `${providerID}/${modelID}`,
    inputModalities,
    ...(typeof entry.compatibility?.reasoningField === 'string' && entry.compatibility.reasoningField.length > 0
      ? { reasoningField: entry.compatibility.reasoningField }
      : {}),
    contextWindow: positive(limit.context) ?? DEFAULT_CONTEXT_WINDOW,
    maxTokens: positive(limit.output) ?? DEFAULT_MAX_OUTPUT_TOKENS,
    ...(variants.length ? { variants } : {}),
  }
}

/**
 * Parse the `/api/model` response body: `{ location, data: [entry…] }`.
 * Returns null when the payload is not the expected shape or is empty.
 *
 * @param {unknown} payload
 * @returns {{models: object[]} | null}
 */
export function modelsFromApiPayload(payload) {
  if (!payload || typeof payload !== 'object') return null
  const data = Array.isArray(payload.data) ? payload.data : Array.isArray(payload) ? payload : null
  if (!data) return null
  const models = []
  for (const entry of data) {
    // A route the server marks disabled cannot serve a generation; listing it
    // would offer a model that fails on the first prompt.
    if (entry?.enabled === false || entry?.status === 'disabled') continue
    const model = modelFromApiEntry(entry)
    if (model) models.push(model)
  }
  return models.length ? { models: disambiguateModelNames(models) } : null
}

/**
 * Display suffix for a colliding provider id.
 *
 * OpenCode's two route namespaces are `opencode` (Zen) and `opencode-go` (Go);
 * the ids are an external spec and stay unchanged, only the picker copy differs.
 * Unknown providers keep their raw id.
 */
const PROVIDER_SUFFIX_LABELS = Object.freeze({ opencode: 'Zen', 'opencode-go': 'Go' })

/**
 * Split colliding display names by provider.
 *
 * Measured v2.2.0: `/api/model` has 45 entries and no duplicate route ids, but
 * seven display names appear twice because the same model is served by both the
 * `opencode` (Zen) and `opencode-go` providers, e.g.
 * `opencode/deepseek-v4.1-flash` and `opencode-go/deepseek-v4.1-flash` are both
 * named "DeepSeek V4.1 Flash". A picker that renders `name` shows them twice
 * with no way to tell them apart, so a collision takes the provider's display
 * label as a suffix. Unique names are left untouched.
 *
 * @param {{id: string, name: string}[]} models
 * @returns {{id: string, name: string}[]}
 */
export function disambiguateModelNames(models) {
  const counts = new Map()
  for (const model of models) counts.set(model.name, (counts.get(model.name) ?? 0) + 1)
  return models.map((model) => {
    if (counts.get(model.name) <= 1) return model
    const provider = model.id.split('/')[0]
    return { ...model, name: `${model.name} (${PROVIDER_SUFFIX_LABELS[provider] ?? provider})` }
  })
}

/** Parse `opencode models`: one `provider/model` id per line; banners skipped. */
export function modelsFromCliOutput(text) {
  const models = []
  for (const raw of String(text ?? '').split('\n')) {
    const id = raw.trim()
    if (!/^[^\s/]+\/\S+$/.test(id)) continue
    // The CLI lists ids only: attach the conservative floor so compaction works.
    // It also discloses no variants, so this fallback advertises no reasoning
    // levels — only the `serve` discovery path can.
    models.push({ id, name: id, contextWindow: DEFAULT_CONTEXT_WINDOW, maxTokens: DEFAULT_MAX_OUTPUT_TOKENS })
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

/** A short, safe tail of stderr for error surfaces. */
export function stderrTail(text, max = 400) {
  const clean = String(text ?? '').trim()
  return clean.length > max ? clean.slice(-max) : clean
}
