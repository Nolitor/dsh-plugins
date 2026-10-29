/**
 * @nolit/dsh-subagent-antigravity
 *
 * A `ctx.subagents` provider that runs one isolated Antigravity (`agy`) CLI
 * process per delegation and returns the final answer text.
 *
 * Shape follows the shipped `dsh-subagent-acp` provider: an out-of-process
 * child starts fresh, advertises no parent-enforced start capabilities, and
 * flattens child-level failures to a `stopReason` because the seam forbids
 * `result` from rejecting.
 */
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'

import Schema from '@deepseek-ai/schemastery'

/** Provider id inside the composition. */
export const name = '@nolit/dsh-subagent-antigravity'

/** The registry and the process seam this provider consumes. */
export const inject = ['subagents', 'subprocess']

const MODES = ['accept-edits', 'auto', 'plan']
const EFFORTS = ['low', 'medium', 'high', 'xhigh', 'max']

/** Defaults mirror the CLI worker plugin so both surfaces behave alike. */
const DEFAULT_MODEL = 'gemini-3.8-flash-low'
const DEFAULT_MODE = 'accept-edits'

/** Largest diagnostic the seam accepts, in bytes. */
const MAX_DIAGNOSTIC_BYTES = 4096
const MAX_STDOUT_BYTES = 8 * 1024 * 1024
const MAX_STDERR_BYTES = 65536

export const Config = Schema.object({
  providerName: Schema.string().default('antigravity'),
  agyPath: Schema.string().default('agy'),
  model: Schema.string().default(DEFAULT_MODEL),
  effort: Schema.union(EFFORTS).default('low'),
  mode: Schema.union(MODES).default(DEFAULT_MODE),
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
 * Extract the CLI's response text from its JSON envelope.
 * @param {string} stdout - captured stdout.
 * @returns {{text: string, status: string, error: string}} parsed facts.
 */
export function parseAgyEnvelope(stdout) {
  const raw = String(stdout ?? '').trim()
  if (!raw) return { text: '', status: '', error: '' }
  try {
    const parsed = JSON.parse(raw)
    if (parsed && typeof parsed === 'object') {
      return {
        text: typeof parsed.response === 'string' ? parsed.response.trim() : '',
        status: typeof parsed.status === 'string' ? parsed.status : '',
        error: typeof parsed.error === 'string' ? parsed.error : '',
      }
    }
  } catch {
    // A non-JSON payload is reported as-is rather than lost.
  }
  return { text: raw, status: '', error: '' }
}

/**
 * Build the one-shot argv for a delegation.
 * @param {object} options - resolved options.
 * @returns {string[]} the argv.
 */
export function buildArgv(options) {
  const argv = [options.executable, '-p', options.prompt, '--model', options.model]
  // A model id may encode its level, and the CLI rejects a conflicting flag.
  if (!/-(low|medium|high)$/.test(options.model)) argv.push('--effort', options.effort)
  argv.push('--mode', options.mode, '--output-format', 'json')
  return argv
}

/** Provider implementation handed to `ctx.subagents`. */
class AntigravityProvider {
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
    if (request.signal.aborted) throw new Error('antigravity subagent request was aborted before start')
    if (!request.cwd || !isAbsolute(request.cwd)) throw new Error('antigravity subagent requires an absolute child cwd')
    const prompt = promptText(request.prompt)
    if (prompt === '') throw new Error('antigravity subagent requires a non-empty text prompt')

    const env = { ...process.env, ...this.config.env }
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const signal = AbortSignal.any([request.signal, timeout])
    const argv = buildArgv({
      executable: this.config.agyPath,
      prompt,
      model: this.config.model,
      effort: this.config.effort,
      mode: this.config.mode,
    })

    const handle = this.ctx.subprocess.spawn({
      argv,
      cwd: request.cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes: MAX_STDOUT_BYTES },
        stderr: { maxBytes: MAX_STDERR_BYTES },
      },
      graceMs: this.config.disposeGraceMs,
      signal,
      env,
    })

    const id = randomUUID()
    const result = (async () => {
      try {
        const outcome = await handle.done
        const stdout = handle.collected.stdout?.readFrom(0)?.text ?? ''
        const stderr = handle.collected.stderr?.readFrom(0)?.text ?? ''
        if (request.signal.aborted) return { output: [], stopReason: 'aborted' }
        if (timeout.aborted) {
          return { output: [], stopReason: 'error', diagnostic: boundDiagnostic('antigravity child timed out') }
        }
        if ((outcome.exitCode ?? 0) !== 0) {
          return { output: [], stopReason: 'error', diagnostic: boundDiagnostic(stderr || stdout || 'antigravity exited non-zero') }
        }
        const parsed = parseAgyEnvelope(stdout)
        if (parsed.status === 'ERROR' || parsed.error) {
          return { output: [], stopReason: 'error', diagnostic: boundDiagnostic(parsed.error || parsed.text) }
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
  ctx.subagents.registerProvider(new AntigravityProvider(config.providerName, ctx, config))
}
