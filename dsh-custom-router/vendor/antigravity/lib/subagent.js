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
import { accessSync, constants, statSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { delimiter, extname, isAbsolute, join } from 'node:path'

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
 *
 * `usage` is passed through raw: the CLI owns its field names
 * (`input_tokens`, `thinking_tokens`, ...), and the mapping to the host
 * TokenUsage shape happens once, at the seam where it is recorded.
 * @param stdout - captured stdout.
 * @returns `{ text, status, error, usage }`; `usage` is undefined when the
 *   envelope carried none.
 */
function parseAgyEnvelope(stdout) {
  const text = String(stdout ?? '').trim()
  if (text === '') return { text: '', status: '', error: '', usage: undefined }
  try {
    const parsed = JSON.parse(text)
    const raw = parsed?.usage
    return {
      text: String(parsed?.response ?? ''),
      status: String(parsed?.status ?? ''),
      error: String(parsed?.error ?? ''),
      usage: raw !== null && typeof raw === 'object' ? raw : undefined,
    }
  } catch {
    // Print mode can emit prose before the envelope; fall back to the raw tail.
    return { text, status: '', error: '', usage: undefined }
  }
}

/**
 * Count one token bucket, accepting missing or non-numeric values.
 * @param value - raw counter.
 * @returns a non-negative integer.
 */
function tokenCount(value) {
  return Number.isFinite(value) ? Math.max(0, value) : 0
}

/**
 * Map the CLI envelope's `usage` to the host TokenUsage shape.
 *
 * Required buckets are always present; optional ones are omitted when zero so
 * a caller can tell "no reasoning" from "reasoning was not reported".
 * @param usage - the CLI envelope's raw `usage` object.
 * @returns TokenUsage, or undefined when there is nothing to record.
 */
export function toSubagentTokenUsage(usage) {
  if (usage === null || typeof usage !== 'object') return undefined
  const inputTokens = tokenCount(usage.input_tokens ?? usage.inputTokens)
  const outputTokens = tokenCount(usage.output_tokens ?? usage.outputTokens)
  const reasoningTokens = tokenCount(usage.thinking_tokens ?? usage.thinkingTokens)
  // Measured 2026-11-08: the envelope spells the cache bucket
  // `cache_read_tokens` (see `parseAgyOutput` in backends.js), while the
  // documented provider spelling is `cache_read_input_tokens`. Accept both
  // rather than silently reporting zero for the field the CLI really emits.
  const cacheReadTokens = tokenCount(
    usage.cache_read_input_tokens ?? usage.cache_read_tokens ?? usage.cacheReadTokens,
  )
  if (inputTokens + outputTokens + reasoningTokens + cacheReadTokens === 0) return undefined
  const mapped = { inputTokens, outputTokens }
  if (reasoningTokens > 0) mapped.reasoningTokens = reasoningTokens
  if (cacheReadTokens > 0) mapped.cacheReadTokens = cacheReadTokens
  return mapped
}

/**
 * Resolve the `agy` executable without spawning anything.
 *
 * The host's `subprocess.spawn` hands `argv[0]` to the OS verbatim, so a bare
 * name inherits the *host's* PATH rather than the child's configured env. An
 * absolute path makes the target identity explicit and keeps a settings-level
 * `agyPath` honest.
 * @param configured - the configured `agyPath`.
 * @returns an absolute path to an existing `agy`.
 */
function resolveAgyExecutable(configured) {
  const candidate = String(configured ?? '')
  if (candidate !== '' && isAbsolute(candidate)) {
    try {
      if (statSync(candidate).isFile()) return candidate
    } catch {
      // Fall through to the PATH search: an absolute path that no longer
      // exists must not silently shadow a working install.
    }
  }
  const names = process.platform === 'win32' && extname('agy') === ''
    ? ['agy', ...(process.env.PATHEXT ?? '.COM;.EXE;.BAT;.CMD').split(';').filter(Boolean).map((ext) => 'agy' + ext)]
    : ['agy']
  for (const directory of String(process.env.PATH ?? '').split(delimiter)) {
    if (directory === '') continue
    for (const name of names) {
      const full = join(directory, name)
      try {
        if (!statSync(full).isFile()) continue
        accessSync(full, constants.X_OK)
        return full
      } catch {
        // Not executable here; keep looking.
      }
    }
  }
  throw new Error('antigravity subagent: agy CLI not found (set agyPath or add it to PATH)')
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
  capabilities = Object.freeze({ agentOptions: true, agentPreset: false, outputSchema: false, depthLimit: false })
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
    // A model-facing selection in the request wins over the configured
    // default; the tool has already validated that route against the
    // Session's allowlist before this request reaches the provider.
    const model = request.agentOptions?.model ?? this.config.model
    const effort = request.agentOptions?.reasoningEffort ?? this.config.effort
    const argv = buildSubagentArgv({
      executable: resolveAgyExecutable(this.config.agyPath),
      prompt,
      model,
      effort,
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
    // Usage is recorded at most once per run, and only for a run that actually
    // completed: an aborted, timed-out, or failed child did no measured work.
    let recorded = false
    const recordUsage = (usage) => {
      if (recorded) return
      recorded = true
      const mapped = toSubagentTokenUsage(usage)
      if (mapped === undefined) return
      try {
        this.config.recordUsage?.(mapped)
      } catch {
        // The ledger is best-effort telemetry; it must never fail the run.
      }
    }
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
        recordUsage(parsed.usage)
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
