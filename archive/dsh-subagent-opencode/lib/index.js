/**
 * @nolit/dsh-subagent-opencode
 *
 * A `ctx.subagents` provider that runs one isolated OpenCode CLI process per
 * delegation and returns the final answer text.
 *
 * The shape follows the shipped `dsh-subagent-acp` provider: an out-of-process
 * child starts fresh, advertises no parent-enforced start capabilities, and
 * flattens child-level failures to a `stopReason` because the seam forbids
 * `result` from rejecting.
 */
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'

import Schema from '@deepseek-ai/schemastery'

/** Provider id inside the composition. */
export const name = '@nolit/dsh-subagent-opencode'

/** The registry and the process seam this provider consumes. */
export const inject = ['subagents', 'subprocess']

const DEFAULT_MODEL = 'opencode-go/beam-free'

/** Largest diagnostic the seam accepts, in bytes. */
const MAX_DIAGNOSTIC_BYTES = 4096
const MAX_STDOUT_BYTES = 8 * 1024 * 1024
const MAX_STDERR_BYTES = 65536

export const Config = Schema.object({
  providerName: Schema.string().default('opencode'),
  opencodePath: Schema.string().default('opencode'),
  model: Schema.string().default(DEFAULT_MODEL),
  agent: Schema.string().default(''),
  auto: Schema.boolean().default(true),
  timeoutMs: Schema.number().default(900000),
  disposeGraceMs: Schema.number().default(5000),
  env: Schema.dict(Schema.string()).default({}),
})

/**
 * Join the prompt content blocks into one task string.
 * @param {readonly object[]} blocks - `ContentBlock` values from the request.
 * @returns {string} the joined text.
 */
function promptText(blocks) {
  const parts = []
  for (const block of blocks ?? []) {
    if (block && block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
  }
  return parts.join('\n').trim()
}

/**
 * Bound a diagnostic to the seam's byte limit.
 * @param {string} text - raw diagnostic text.
 * @returns {string} the bounded text.
 */
function boundDiagnostic(text) {
  const value = String(text ?? '')
  if (Buffer.byteLength(value, 'utf8') <= MAX_DIAGNOSTIC_BYTES) return value
  return value.slice(0, MAX_DIAGNOSTIC_BYTES)
}

/**
 * Build the one-shot argv for a delegation.
 * @param {object} options - resolved options.
 * @returns {string[]} the argv.
 */
export function buildArgv(options) {
  const argv = [options.executable, 'run', '-m', options.model, '--format', 'json']
  if (options.auto) argv.push('--auto')
  if (options.agent) argv.push('--agent', options.agent)
  return argv
}

/**
 * Collect the final assistant text from an OpenCode `--format json` stream.
 *
 * Events carry cumulative `part.text` snapshots, so the last snapshot for each
 * part id wins; reasoning and tool events are ignored, keeping only the answer.
 * @param {string} stdout - captured NDJSON output.
 * @returns {{text: string, errors: string[]}} the answer text and reported errors.
 */
export function parseRunStream(stdout) {
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
  return { text: [...parts.values()].join('').trim(), errors }
}

/** Provider implementation handed to `ctx.subagents`. */
class OpenCodeProvider {
  capabilities = Object.freeze({ agentOptions: false, agentPreset: false, outputSchema: false, depthLimit: false })
  inheritsParentContext = false

  /**
   * @param {string} name - registry name.
   * @param {object} ctx - host context exposing `subprocess`.
   * @param {object} config - resolved config.
   */
  constructor(name, ctx, config) {
    this.name = name
    this.ctx = ctx
    this.config = config
  }

  /**
   * Start one delegation.
   * @param {object} request - resolved start request (absolute `cwd`, `prompt`, `signal`).
   * @returns {object} the run handle.
   */
  start(request) {
    if (request.signal.aborted) throw new Error('opencode subagent request was aborted before start')
    if (!request.cwd || !isAbsolute(request.cwd)) throw new Error('opencode subagent requires an absolute child cwd')
    const prompt = promptText(request.prompt)
    if (prompt === '') throw new Error('opencode subagent requires a non-empty text prompt')

    const env = { ...process.env, ...this.config.env }
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const signal = AbortSignal.any([request.signal, timeout])
    const argv = buildArgv({
      executable: this.config.opencodePath,
      model: this.config.model,
      auto: this.config.auto,
      agent: this.config.agent,
    })

    const handle = this.ctx.subprocess.spawn({
      argv,
      cwd: request.cwd,
      stdio: {
        stdin: 'pipe',
        stdout: { maxBytes: MAX_STDOUT_BYTES },
        stderr: { maxBytes: MAX_STDERR_BYTES },
      },
      graceMs: this.config.disposeGraceMs,
      signal,
      env,
    })

    // The prompt goes to stdin: a flattened transcript can exceed the argv cap.
    try {
      handle.stdin?.on?.('error', () => {})
      handle.stdin?.end?.(prompt)
    } catch {
      // A child that exits before reading stdin is reported through its exit facts.
    }

    const id = randomUUID()
    const result = (async () => {
      try {
        const outcome = await handle.done
        const stdout = handle.collected.stdout?.readFrom(0)?.text ?? ''
        const stderr = handle.collected.stderr?.readFrom(0)?.text ?? ''
        if (request.signal.aborted) return { output: [], stopReason: 'aborted' }
        if (timeout.aborted) {
          return { output: [], stopReason: 'error', diagnostic: boundDiagnostic('opencode child timed out') }
        }
        const parsed = parseRunStream(stdout)
        if ((outcome.exitCode ?? 0) !== 0 || parsed.errors.length > 0) {
          const detail = parsed.errors.join('; ') || stderr || stdout || 'opencode exited non-zero'
          return { output: [], stopReason: 'error', diagnostic: boundDiagnostic(detail) }
        }
        if (parsed.text === '') return { output: [], stopReason: 'completed' }
        return { output: [{ type: 'text', text: parsed.text }], stopReason: 'completed' }
      } catch (error) {
        return {
          output: [],
          stopReason: 'error',
          diagnostic: boundDiagnostic(error instanceof Error ? error.message : String(error)),
        }
      }
    })()

    return {
      id,
      result,
      dispose: async () => {
        try {
          handle.terminate?.()
        } catch {
          // A handle that already settled has nothing left to terminate.
        }
        await result.catch(() => {})
      },
    }
  }
}

/**
 * Register the provider.
 * @param {object} ctx - host context.
 * @param {object} config - plugin config.
 * @returns {void}
 */
export function apply(ctx, config) {
  ctx.subagents.registerProvider(new OpenCodeProvider(config.providerName, ctx, config))
}
