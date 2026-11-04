/**
 * Subagent provider for the Antigravity CLI.
 *
 * Merged from @nolit/dsh-subagent-antigravity 0.1.0 (2026-11-05) so one package
 * carries every Antigravity surface: the `/agy` command, the `agy_worker` tool,
 * the HTTP model route, the settings section, the usage chip, and this
 * delegation provider.
 *
 * Shape follows the shipped `dsh-subagent-acp` provider: an out-of-process child
 * starts fresh, advertises no parent-enforced start capabilities, and flattens
 * child-level failures to a `stopReason` because the seam forbids `result` from
 * rejecting.
 *
 * @module @nolit/dsh-antigravity/subagent
 */
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'

/** Largest diagnostic the seam accepts, in bytes. */
const MAX_DIAGNOSTIC_BYTES = 4096
const MAX_STDOUT_BYTES = 8 * 1024 * 1024
const MAX_STDERR_BYTES = 65536

/**
 * Bound a diagnostic string to what the seam accepts.
 * @param text - raw diagnostic.
 * @returns the bounded string.
 */
function boundDiagnostic(text) {
  const value = String(text ?? '')
  if (value.length <= MAX_DIAGNOSTIC_BYTES) return value
  return value.slice(0, MAX_DIAGNOSTIC_BYTES)
}

/**
 * Flatten a request prompt into text.
 * @param prompt - prompt blocks or a string.
 * @returns concatenated text.
 */
function promptText(prompt) {
  if (typeof prompt === 'string') return prompt
  if (!Array.isArray(prompt)) return ''
  const out = []
  for (const block of prompt) {
    if (block?.type === 'text' && typeof block.text === 'string') out.push(block.text)
  }
  return out.join('\n')
}

/**
 * Parse the CLI's JSON envelope.
 * @param stdout - captured stdout.
 * @returns `{ text, status, error }`.
 */
function parseAgyEnvelope(stdout) {
  const text = String(stdout ?? '').trim()
  if (text === '') return { text: '', status: '', error: '' }
  try {
    const parsed = JSON.parse(text)
    return {
      text: String(parsed?.response ?? ''),
      status: String(parsed?.status ?? ''),
      error: String(parsed?.error ?? ''),
    }
  } catch {
    // Print mode can emit prose before the envelope; fall back to the raw tail.
    return { text, status: '', error: '' }
  }
}

/**
 * Build the one-shot argv for a delegation.
 * @param options - `{ executable, prompt, model, effort, mode }`.
 * @returns the argv array.
 */
export function buildSubagentArgv(options) {
  const argv = [options.executable, '-p', options.prompt, '--model', options.model]
  // A model id may encode its level, and the CLI rejects a conflicting flag.
  if (!/-(low|medium|high)$/.test(options.model)) argv.push('--effort', options.effort)
  argv.push('--mode', options.mode, '--output-format', 'json')
  return argv
}

/** Provider implementation handed to `ctx.subagents`. */
export class AntigravitySubagentProvider {
  capabilities = Object.freeze({ agentOptions: false, agentPreset: false, outputSchema: false, depthLimit: false })
  inheritsParentContext = false

  /**
   * @param name - registry name.
   * @param ctx - host context exposing `subprocess`.
   * @param config - resolved config.
   */
  constructor(name, ctx, config) {
    this.name = name
    this.ctx = ctx
    this.config = config
  }

  /**
   * Start one delegation.
   * @param request - resolved start request (absolute `cwd`, `prompt`, `signal`).
   * @returns the run handle.
   */
  start(request) {
    if (request.signal.aborted) throw new Error('antigravity subagent request was aborted before start')
    if (!request.cwd || !isAbsolute(request.cwd)) throw new Error('antigravity subagent requires an absolute child cwd')
    const prompt = promptText(request.prompt)
    if (prompt === '') throw new Error('antigravity subagent requires a non-empty text prompt')

    const env = { ...process.env, ...this.config.env }
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const signal = AbortSignal.any([request.signal, timeout])
    const argv = buildSubagentArgv({
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
