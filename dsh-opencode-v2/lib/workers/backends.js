/**
 * One-shot CLI worker backends for the built-in `cli_worker` tool.
 *
 * A backend is data, not a class: an executable name, a pure
 * `argv(options) -> string[]`, and a pure `parse(stdout) -> {summary, usage}`.
 * Prompt text never enters argv — it goes to the child's stdin (see
 * `runWorker`) — so a long task cannot hit the 128 KiB `MAX_ARG_STRLEN` limit.
 *
 * The `opencode` surface is the measured v2.2.0 one (`run --format json`,
 * prompt on stdin). The `codex` and `claude` entries follow their documented
 * one-shot modes and are marked best-effort: their parsers degrade to the raw
 * tail when the JSON envelope is not recognised.
 */
import { JsonRunParser } from '../shared.js'

/** Executable name used when the caller does not configure an absolute path. */
export const WORKER_BACKENDS = Object.freeze(['opencode', 'codex', 'claude'])

/**
 * Build the argv tail for `opencode run`. Mirrors the plugin's own run builder:
 * v2 selects `--format json`, `--thinking` keeps reasoning available, and
 * `--auto` is required because a headless worker cannot answer prompts.
 *
 * `--standalone` is mandatory here: without it the CLI connects to the shared
 * background service (`opencode service`), which is also what the conversation
 * route attaches to. A batch worker must never start, restart, or contend with
 * that daemon.
 * @param {{model?: string}} options - worker call options.
 * @returns {string[]} argv tail appended after the resolved executable.
 */
function opencodeArgv(options) {
  const argv = ['run', '--format', 'json', '--thinking', '--auto', '--standalone']
  if (options.model) argv.push('-m', options.model)
  return argv
}

/**
 * Parse `opencode run --format json` stdout.
 * @param {string} stdout - complete child stdout.
 * @returns {{summary: string, usage: {inputTokens: number, outputTokens: number}, errors: string[]}} final text, usage, and provider errors.
 */
function parseOpencode(stdout) {
  const parser = new JsonRunParser()
  const summary = parser.finish({ buffer: stdout ?? '' })
  return {
    summary: summary.sawEvents ? summary.text : String(stdout ?? '').trim(),
    usage: { inputTokens: summary.inputTokens, outputTokens: summary.outputTokens },
    errors: summary.errors,
  }
}

/**
 * Build the argv tail for `codex exec`. `-` is the documented stdin prompt
 * marker; `--json` makes the child emit one JSON event per line.
 * @param {{model?: string}} options - worker call options.
 * @returns {string[]} argv tail.
 */
function codexArgv(options) {
  const argv = ['exec', '--json', '--skip-git-repo-check', '-']
  if (options.model) argv.push('--model', options.model)
  return argv
}

/**
 * Parse `codex exec --json` stdout: the last `item.completed` agent message is
 * the worker's answer, and the last `turn.completed` carries usage.
 * @param {string} stdout - complete child stdout.
 * @returns {{summary: string, usage: {inputTokens: number, outputTokens: number}}} final text and usage.
 */
function parseCodex(stdout) {
  const text = String(stdout ?? '')
  let summary = ''
  let inputTokens = 0
  let outputTokens = 0
  let sawEvent = false
  for (const line of text.split('\n')) {
    if (!line.trim().startsWith('{')) continue
    let event
    try {
      event = JSON.parse(line)
    } catch {
      continue
    }
    if (!event || typeof event !== 'object') continue
    sawEvent = true
    const item = event.item
    if (event.type === 'item.completed' && item && item.type === 'agent_message' && typeof item.text === 'string') {
      summary = item.text
    }
    const usage = event.usage ?? item?.usage
    if (usage && typeof usage === 'object') {
      if (Number.isFinite(usage.input_tokens)) inputTokens = usage.input_tokens
      if (Number.isFinite(usage.output_tokens)) outputTokens = usage.output_tokens
    }
  }
  return {
    summary: sawEvent ? summary : text.trim(),
    usage: { inputTokens, outputTokens },
    errors: [],
  }
}

/**
 * Build the argv tail for Claude Code print mode. `-p` takes the prompt from
 * stdin when no positional prompt is given; `--output-format json` returns one
 * result object.
 * @param {{model?: string}} options - worker call options.
 * @returns {string[]} argv tail.
 */
function claudeArgv(options) {
  const argv = ['-p', '--output-format', 'json']
  if (options.model) argv.push('--model', options.model)
  return argv
}

/**
 * Parse `claude -p --output-format json` stdout.
 * @param {string} stdout - complete child stdout.
 * @returns {{summary: string, usage: {inputTokens: number, outputTokens: number}}} final text and usage.
 */
function parseClaude(stdout) {
  const text = String(stdout ?? '').trim()
  let result
  try {
    result = JSON.parse(text)
  } catch {
    return { summary: text, usage: { inputTokens: 0, outputTokens: 0 }, errors: [] }
  }
  if (!result || typeof result !== 'object') {
    return { summary: text, usage: { inputTokens: 0, outputTokens: 0 }, errors: [] }
  }
  const usage = result.usage && typeof result.usage === 'object' ? result.usage : {}
  return {
    summary: typeof result.result === 'string' ? result.result : text,
    usage: {
      inputTokens: Number.isFinite(usage.input_tokens) ? usage.input_tokens : 0,
      outputTokens: Number.isFinite(usage.output_tokens) ? usage.output_tokens : 0,
    },
    errors: result.is_error && typeof result.result === 'string' ? [result.result] : [],
  }
}

/** Backend table: executable, argv builder, and stdout parser per CLI family. */
const SPECS = Object.freeze({
  opencode: { executable: 'opencode', argv: opencodeArgv, parse: parseOpencode },
  codex: { executable: 'codex', argv: codexArgv, parse: parseCodex },
  claude: { executable: 'claude', argv: claudeArgv, parse: parseClaude },
})

/**
 * Look up one backend.
 * @param {string} name - one of {@link WORKER_BACKENDS}.
 * @returns {{executable: string, argv: (options: {model?: string}) => string[], parse: (stdout: string) => {summary: string, usage: {inputTokens: number, outputTokens: number}}}} the backend spec.
 * @throws {Error} when the name is not a known backend.
 */
export function backendSpec(name) {
  const spec = SPECS[name]
  if (!spec) throw new Error(`unknown cli_worker backend "${name}" (expected one of ${WORKER_BACKENDS.join(', ')})`)
  return spec
}

/**
 * Compose the full argv for one worker call.
 * @param {string} backend - backend name.
 * @param {{executable: string, model?: string}} options - resolved executable path and optional route.
 * @returns {string[]} argv with the executable first.
 */
export function buildWorkerArgv(backend, options) {
  return [options.executable, ...backendSpec(backend).argv({ model: options.model })]
}

/**
 * Parse one worker's stdout through its backend parser.
 * @param {string} backend - backend name.
 * @param {string} stdout - complete child stdout.
 * @returns {{summary: string, usage: {inputTokens: number, outputTokens: number}}} final text and usage.
 */
export function parseWorkerOutput(backend, stdout) {
  return backendSpec(backend).parse(stdout)
}
