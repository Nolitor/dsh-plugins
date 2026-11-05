/**
 * Per-CLI adapters for the local delegation worker.
 *
 * Every backend is a plain data record: an executable name, an argv builder,
 * the prompt transport the CLI actually accepts, and a stdout parser. The
 * worker never shells out and never interpolates a prompt into a shell string.
 *
 * Measured on this host (2026-11-05): only `agy` 1.5.0 is installed. The
 * opencode/codex/claude argv builders follow the published CLI surfaces and the
 * shapes already verified in this workspace's OpenCode track, but they are
 * labelled UNVERIFIED-LOCALLY in `COMPATIBILITY.md` because the binaries are
 * absent here.
 *
 * @module @nolit/dsh-subagent-local/backends
 */

/** Backends this package knows how to run. */
export const BACKENDS = Object.freeze(['antigravity', 'opencode', 'codex', 'claude'])

/** Default order used when `backend: auto` and the caller names no backend. */
export const DEFAULT_AUTO_ORDER = Object.freeze(['antigravity', 'opencode', 'codex', 'claude'])

/**
 * Prompt transport per backend.
 *
 * `agy` is measured to ignore stdin in print mode (`-p -` reads an empty
 * prompt), so its task text must ride beside `-p` in argv and is capped by the
 * kernel's single-argument limit. Every other CLI reads the task from stdin,
 * which this worker always uses so the prompt never appears in a process list.
 */
export const PROMPT_TRANSPORT = Object.freeze({
  antigravity: 'argv',
  opencode: 'stdin',
  codex: 'stdin',
  claude: 'stdin',
})

/** Linux `MAX_ARG_STRLEN`: one argv entry cannot reach this many bytes. */
export const MAX_ARG_STRLEN = 131072

/** Largest task this package will hand to a stdin-based CLI. */
export const MAX_STDIN_PROMPT_BYTES = 8 * 1024 * 1024

/** Modes accepted by `agy --mode`. */
export const AGY_MODES = Object.freeze(['accept-edits', 'auto', 'plan'])

/** Efforts accepted by `agy --effort`. */
export const AGY_EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh', 'max'])

/** Anthropic CLI permission modes accepted by `--permission-mode`. */
export const CLAUDE_PERMISSION_MODES = Object.freeze([
  'default',
  'acceptEdits',
  'bypassPermissions',
  'plan',
])

/** Per-backend defaults mirrored in the Cordis Config schema. */
export const BACKEND_DEFAULTS = Object.freeze({
  antigravity: Object.freeze({
    path: 'agy',
    model: 'gemini-3.8-flash-low',
    effort: 'low',
    mode: 'accept-edits',
  }),
  opencode: Object.freeze({ path: 'opencode', model: '', effort: '', mode: '' }),
  codex: Object.freeze({ path: 'codex', model: '', effort: '', mode: '' }),
  claude: Object.freeze({ path: 'claude', model: '', effort: '', mode: '' }),
})

/** Model ids that already encode an agy reasoning level. */
const AGY_EFFORT_SUFFIX = /-(low|medium|high)$/

/**
 * Read the reasoning level encoded in an `agy` model id.
 * @param {string} model - model id such as `gemini-3.8-flash-low`.
 * @returns {string} the encoded level, or an empty string.
 */
export function effortOfModel(model) {
  const match = AGY_EFFORT_SUFFIX.exec(String(model ?? ''))
  return match ? match[1] : ''
}

/**
 * Whether this backend accepts its prompt as one argv entry.
 * @param {string} backend - backend id.
 * @returns {boolean} true when the prompt must ride in argv.
 */
export function usesArgvPrompt(backend) {
  return PROMPT_TRANSPORT[backend] === 'argv'
}

/**
 * Reject a task that the selected transport cannot carry.
 * @param {object} options - transport facts.
 * @param {string} options.backend - backend id.
 * @param {string} options.prompt - task text.
 * @throws {TypeError} when the prompt is empty.
 * @throws {RangeError} when the prompt exceeds the transport limit.
 */
export function assertPromptFits(options) {
  const prompt = options.prompt
  if (typeof prompt !== 'string' || prompt.trim() === '') {
    throw new TypeError(`delegate_local requires a non-empty task for backend "${options.backend}"`)
  }
  const bytes = Buffer.byteLength(prompt, 'utf8')
  if (usesArgvPrompt(options.backend)) {
    if (bytes >= MAX_ARG_STRLEN) {
      throw new RangeError(
        `${options.backend} task text is ${bytes} bytes; one command-line argument is capped at `
        + `${MAX_ARG_STRLEN - 1} bytes (Linux MAX_ARG_STRLEN). Save the text to a file inside the `
        + 'workspace and reference its path in the task instead.',
      )
    }
    return
  }
  if (bytes > MAX_STDIN_PROMPT_BYTES) {
    throw new RangeError(
      `${options.backend} task text is ${bytes} bytes; the stdin transport limit is `
      + `${MAX_STDIN_PROMPT_BYTES} bytes. Split the task or save it to a file first.`,
    )
  }
}

/**
 * Build the one-shot invocation for a backend.
 *
 * The return value separates argv from the stdin prompt so a caller can prove
 * the task text never appears in argv for stdin backends.
 * @param {object} options - resolved invocation options.
 * @param {string} options.backend - backend id.
 * @param {string} options.executable - resolved executable path.
 * @param {string} options.prompt - task text.
 * @param {string} [options.model] - model id override.
 * @param {string} [options.effort] - reasoning effort override.
 * @param {string} [options.mode] - backend execution mode override.
 * @param {boolean} [options.auto] - pass the CLI's non-interactive approval flag.
 * @param {string[]} [options.extraArgs] - verbatim trailing arguments.
 * @returns {{argv: string[], stdinPrompt: string|null}} the invocation.
 * @throws {Error} when the backend is unknown.
 * @throws {TypeError} when the prompt is empty.
 * @throws {RangeError} when the prompt is too large for its transport or a flag conflicts.
 */
export function buildInvocation(options) {
  const backend = options.backend
  assertPromptFits({ backend, prompt: options.prompt })
  const extra = Array.isArray(options.extraArgs) ? options.extraArgs.map(String) : []
  switch (backend) {
    case 'antigravity':
      return { argv: buildAgyArgv({ ...options, extraArgs: extra }), stdinPrompt: null }
    case 'opencode':
      return { argv: buildOpencodeArgv({ ...options, extraArgs: extra }), stdinPrompt: options.prompt }
    case 'codex':
      return { argv: buildCodexArgv({ ...options, extraArgs: extra }), stdinPrompt: options.prompt }
    case 'claude':
      return { argv: buildClaudeArgv({ ...options, extraArgs: extra }), stdinPrompt: options.prompt }
    default:
      throw new Error(`unknown local delegation backend "${backend}"; supported: ${BACKENDS.join(', ')}`)
  }
}

/**
 * Antigravity (`agy`) argv. Measured surface: prompt beside `-p`, one JSON
 * object on stdout with `--output-format json`.
 * @param {object} options - invocation options.
 * @returns {string[]} argv.
 */
export function buildAgyArgv(options) {
  const model = options.model || BACKEND_DEFAULTS.antigravity.model
  const effort = options.effort || BACKEND_DEFAULTS.antigravity.effort
  const argv = [options.executable, '-p', options.prompt]
  argv.push('--model', model)
  const encoded = effortOfModel(model)
  if (encoded) {
    if (effort !== encoded) {
      throw new RangeError(
        `model "${model}" encodes effort "${encoded}" and conflicts with effort "${effort}". `
        + 'Omit the effort or choose the matching level.',
      )
    }
  } else {
    argv.push('--effort', effort)
  }
  argv.push('--mode', options.mode || BACKEND_DEFAULTS.antigravity.mode)
  argv.push('--output-format', 'json')
  if (options.extraArgs?.length) argv.push(...options.extraArgs)
  return argv
}

/**
 * OpenCode argv (`opencode run`). The prompt is stdin; `--format json` emits an
 * NDJSON event stream whose text events carry cumulative `part.text` snapshots.
 * @param {object} options - invocation options.
 * @returns {string[]} argv.
 */
export function buildOpencodeArgv(options) {
  const argv = [options.executable, 'run']
  if (options.model) argv.push('-m', options.model)
  argv.push('--format', 'json')
  if (options.auto) argv.push('--auto')
  if (options.mode) argv.push('--agent', options.mode)
  if (options.extraArgs?.length) argv.push(...options.extraArgs)
  return argv
}

/**
 * Codex CLI argv (`codex exec`). A trailing `-` reads the prompt from stdin;
 * `--json` emits JSONL events whose completed agent messages carry the answer.
 * @param {object} options - invocation options.
 * @returns {string[]} argv.
 */
export function buildCodexArgv(options) {
  const argv = [options.executable, 'exec', '--json', '--skip-git-repo-check']
  if (options.model) argv.push('--model', options.model)
  if (options.mode) argv.push('--sandbox', options.mode)
  if (options.effort) argv.push('-c', `model_reasoning_effort=${options.effort}`)
  if (options.extraArgs?.length) argv.push(...options.extraArgs)
  argv.push('-')
  return argv
}

/**
 * Claude Code CLI argv (`claude -p`). The prompt is stdin; `--output-format
 * json` prints one result envelope carrying `result` and `usage`.
 * @param {object} options - invocation options.
 * @returns {string[]} argv.
 */
export function buildClaudeArgv(options) {
  const argv = [options.executable, '-p', '--output-format', 'json']
  if (options.model) argv.push('--model', options.model)
  if (options.mode) {
    if (!CLAUDE_PERMISSION_MODES.includes(options.mode)) {
      throw new RangeError(
        `claude permission mode "${options.mode}" is not one of ${CLAUDE_PERMISSION_MODES.join(', ')}`,
      )
    }
    argv.push('--permission-mode', options.mode)
  }
  if (options.auto) argv.push('--dangerously-skip-permissions')
  if (options.extraArgs?.length) argv.push(...options.extraArgs)
  return argv
}

/** Empty usage record returned when a CLI prints no usage facts. */
export const NO_USAGE = Object.freeze({
  inputTokens: 0,
  outputTokens: 0,
  thinkingTokens: 0,
  cacheReadTokens: 0,
})

/**
 * Coerce a usage counter to a finite non-negative integer.
 * @param {unknown} value - candidate counter.
 * @returns {number} the counter or 0.
 */
function counter(value) {
  return Number.isFinite(value) && value > 0 ? Math.trunc(value) : 0
}

/**
 * Parse one backend's stdout into a uniform answer + usage record.
 *
 * An unrecognised or truncated payload degrades to the raw text so a caller
 * still sees what the CLI produced rather than losing the output.
 * @param {string} backend - backend id.
 * @param {string} stdout - captured stdout.
 * @returns {{summary: string, usage: object, status: string, conversationId: string, parsed: boolean, errors: string[]}} parsed facts.
 */
export function parseOutput(backend, stdout) {
  switch (backend) {
    case 'antigravity':
      return parseAgyOutput(stdout)
    case 'opencode':
      return parseOpencodeOutput(stdout)
    case 'codex':
      return parseCodexOutput(stdout)
    case 'claude':
      return parseClaudeOutput(stdout)
    default:
      return { summary: String(stdout ?? '').trim(), usage: NO_USAGE, status: '', conversationId: '', parsed: false, errors: [] }
  }
}

/**
 * Parse the single JSON object printed by `agy --output-format json`.
 * @param {string} stdout - captured stdout.
 * @returns {object} parsed facts.
 */
export function parseAgyOutput(stdout) {
  const text = String(stdout ?? '').trim()
  if (!text) return { summary: '', usage: NO_USAGE, status: '', conversationId: '', parsed: false, errors: [] }
  try {
    const result = JSON.parse(text)
    if (result && typeof result === 'object') {
      const usage = result.usage && typeof result.usage === 'object' ? result.usage : {}
      const errors = typeof result.error === 'string' && result.error ? [result.error] : []
      return {
        summary: typeof result.response === 'string' ? result.response.trim() : text,
        usage: {
          inputTokens: counter(usage.input_tokens),
          outputTokens: counter(usage.output_tokens),
          thinkingTokens: counter(usage.thinking_tokens),
          cacheReadTokens: counter(usage.cache_read_tokens),
        },
        status: typeof result.status === 'string' ? result.status : '',
        conversationId: typeof result.conversation_id === 'string' ? result.conversation_id : '',
        parsed: true,
        errors,
      }
    }
  } catch {
    // A non-JSON payload (for example an argument error) is reported as text.
  }
  return { summary: text, usage: NO_USAGE, status: '', conversationId: '', parsed: false, errors: [] }
}

/**
 * Parse the NDJSON stream printed by `opencode run --format json`.
 *
 * Text events carry cumulative `part.text` snapshots, so the last snapshot for
 * each part id wins; reasoning and tool events are ignored.
 * @param {string} stdout - captured stdout.
 * @returns {object} parsed facts.
 */
export function parseOpencodeOutput(stdout) {
  const parts = new Map()
  const errors = []
  for (const line of String(stdout ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let event
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!event || typeof event !== 'object') continue
    if (event.type === 'text' && event.part && typeof event.part.text === 'string') {
      parts.set(event.part.id ?? `anon-${parts.size}`, event.part.text)
      continue
    }
    if (event.type === 'error') {
      const error = event.error
      if (typeof error === 'string') errors.push(error)
      else if (error && typeof error === 'object') errors.push(String(error.message ?? error.name ?? 'error'))
    }
  }
  const text = [...parts.values()].join('').trim()
  const raw = String(stdout ?? '').trim()
  return {
    summary: text || (errors.length ? '' : raw),
    usage: NO_USAGE,
    status: errors.length ? 'ERROR' : 'SUCCESS',
    conversationId: '',
    parsed: true,
    errors,
  }
}

/**
 * Parse the JSONL event stream printed by `codex exec --json`.
 *
 * The final `item.completed` event with `item.type === 'agent_message'` carries
 * the answer; `turn.completed` carries usage; `error`/`turn.failed` carry a
 * diagnostic.
 * @param {string} stdout - captured stdout.
 * @returns {object} parsed facts.
 */
export function parseCodexOutput(stdout) {
  let text = ''
  const errors = []
  const usage = { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0 }
  let parsed = false
  for (const line of String(stdout ?? '').split('\n')) {
    const trimmed = line.trim()
    if (!trimmed.startsWith('{')) continue
    let event
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!event || typeof event !== 'object') continue
    parsed = true
    if (event.type === 'item.completed' && event.item && typeof event.item === 'object') {
      if (event.item.type === 'agent_message' && typeof event.item.text === 'string') {
        text = event.item.text.trim()
      }
      continue
    }
    if (event.type === 'turn.completed' && event.usage && typeof event.usage === 'object') {
      usage.inputTokens = counter(event.usage.input_tokens)
      usage.outputTokens = counter(event.usage.output_tokens)
      usage.thinkingTokens = counter(event.usage.reasoning_output_tokens)
      usage.cacheReadTokens = counter(event.usage.cached_input_tokens)
      continue
    }
    if (event.type === 'error' || event.type === 'turn.failed') {
      const error = event.error ?? event.message
      if (typeof error === 'string') errors.push(error)
      else if (error && typeof error === 'object') errors.push(String(error.message ?? 'error'))
    }
  }
  return {
    summary: text || (errors.length ? '' : String(stdout ?? '').trim()),
    usage,
    status: errors.length ? 'ERROR' : 'SUCCESS',
    conversationId: '',
    parsed,
    errors,
  }
}

/**
 * Parse the single result envelope printed by `claude -p --output-format json`.
 * @param {string} stdout - captured stdout.
 * @returns {object} parsed facts.
 */
export function parseClaudeOutput(stdout) {
  const text = String(stdout ?? '').trim()
  if (!text) return { summary: '', usage: NO_USAGE, status: '', conversationId: '', parsed: false, errors: [] }
  try {
    const result = JSON.parse(text)
    if (result && typeof result === 'object') {
      const usage = result.usage && typeof result.usage === 'object' ? result.usage : {}
      const errors = []
      if (result.is_error === true) errors.push(String(result.result ?? 'claude reported is_error'))
      return {
        summary: typeof result.result === 'string' ? result.result.trim() : text,
        usage: {
          inputTokens: counter(usage.input_tokens),
          outputTokens: counter(usage.output_tokens),
          thinkingTokens: counter(usage.thinking_tokens),
          cacheReadTokens: counter(usage.cache_read_input_tokens ?? usage.cache_read_tokens),
        },
        status: result.subtype === 'success' || result.is_error !== true ? 'SUCCESS' : 'ERROR',
        conversationId: typeof result.session_id === 'string' ? result.session_id : '',
        parsed: true,
        errors,
      }
    }
  } catch {
    // A non-JSON payload is reported as text.
  }
  return { summary: text, usage: NO_USAGE, status: '', conversationId: '', parsed: false, errors: [] }
}
