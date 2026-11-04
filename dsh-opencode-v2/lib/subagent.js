/**
 * Subagent provider for the OpenCode CLI.
 *
 * Merged from @nolit/dsh-subagent-opencode 0.1.0 (2026-11-05) so one package
 * carries the chat route, the `/ocode` command, `cli_worker`, the HTTP adapter
 * and this delegation provider. The prompt goes over stdin because a flattened
 * transcript can exceed the argv cap.
 *
 * @module @nolit/dsh-opencode-v2/subagent
 */
import { randomUUID } from 'node:crypto'
import { isAbsolute } from 'node:path'

const MAX_DIAGNOSTIC_BYTES = 4096
const MAX_STDOUT_BYTES = 8 * 1024 * 1024
const MAX_STDERR_BYTES = 65536

/**
 * Bound a diagnostic to what the seam accepts.
 * @param text - raw diagnostic.
 * @returns the bounded string.
 */
function boundDiagnostic(text) {
  const value = String(text ?? '')
  if (Buffer.byteLength(value, 'utf8') <= MAX_DIAGNOSTIC_BYTES) return value
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
 * Build the one-shot argv for a delegation.
 * @param options - resolved options.
 * @returns the argv.
 */
export function buildOpencodeArgv(options) {
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
 * @param stdout - captured NDJSON output.
 * @returns the answer text and reported errors.
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
export class OpenCodeSubagentProvider {
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
    if (request.signal.aborted) throw new Error('opencode subagent request was aborted before start')
    if (!request.cwd || !isAbsolute(request.cwd)) throw new Error('opencode subagent requires an absolute child cwd')
    const prompt = promptText(request.prompt)
    if (prompt === '') throw new Error('opencode subagent requires a non-empty text prompt')

    const env = { ...process.env, ...this.config.env }
    const timeout = AbortSignal.timeout(this.config.timeoutMs)
    const signal = AbortSignal.any([request.signal, timeout])
    const argv = buildOpencodeArgv({
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