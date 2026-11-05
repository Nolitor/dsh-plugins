/**
 * One-shot local CLI delegation.
 *
 * Every call owns exactly one child process. The worker resolves a backend and
 * its executable, builds the adapter's argv, delivers the task over the
 * backend's measured prompt transport, enforces a deadline, collects bounded
 * stdout/stderr, parses the answer, optionally collects artifacts and persists
 * run files, and returns facts instead of throwing for runtime failures.
 *
 * @module @nolit/dsh-subagent-local/worker
 */
import { randomUUID } from 'node:crypto'
import { isAbsolute, resolve } from 'node:path'

import {
  BACKENDS,
  DEFAULT_AUTO_ORDER,
  buildInvocation,
  parseOutput,
  usesArgvPrompt,
} from './backends.js'
import { collectArtifacts, persistRunFiles, resolveArtifactDir } from './artifacts.js'
import {
  backendConfig,
  backendValue,
  configValue,
  effectiveEffort,
  effectiveModel,
  effectiveMode,
  effectiveTimeoutMs,
  forwardedEnv,
} from './config.js'

/** Tail size kept from stderr for diagnostics. */
export const STDERR_TAIL_CHARS = 4000

/** Bounded diagnostic text length. */
export const MAX_DIAGNOSTIC_CHARS = 4000

/** Default disposal grace for a terminated child. */
export const DEFAULT_DISPOSE_GRACE_MS = 5000

/**
 * The requested backend has no resolvable executable on this host.
 * Carries the per-candidate reasons so the caller can report measured facts.
 */
export class BackendResolutionError extends Error {
  /**
   * @param {string} message - diagnostic text.
   * @param {Array<{backend: string, path: string, error: string}>} attempts - measured resolution attempts.
   */
  constructor(message, attempts) {
    super(message)
    this.name = 'BackendResolutionError'
    this.attempts = attempts
  }
}

/**
 * Keep only the final `n` characters of a captured stream.
 * @param {string} text - captured text.
 * @param {number} n - maximum characters.
 * @returns {string} the tail.
 */
function tail(text, n) {
  const value = String(text ?? '')
  return value.length <= n ? value : value.slice(value.length - n)
}

/**
 * Build the canonical empty result for a failed or non-started run.
 * Every field of the tool output schema is present so the host can always
 * validate and render it.
 * @param {string} backend - backend id (may be empty when unresolved).
 * @returns {object} canonical result.
 */
export function emptyResult(backend = '') {
  return {
    ok: false,
    backend,
    executable: '',
    model: '',
    promptTransport: backend ? (usesArgvPrompt(backend) ? 'argv' : 'stdin') : '',
    exitCode: -1,
    signal: '',
    timedOut: false,
    truncated: false,
    elapsedMs: 0,
    promptBytes: 0,
    usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0 },
    summary: '',
    diagnostic: '',
    errorKind: '',
    yieldedProvider: '',
    stderrTail: '',
    artifacts: [],
    missing: [],
    skipped: 0,
    artifactDir: '',
  }
}

/**
 * Resolve which local CLI backend a call will use.
 *
 * Explicit requests fail loudly when their executable is missing. `auto`
 * walks the configured order and picks the first backend whose executable
 * resolves, then reports every measured miss when none does.
 * @param {object} options - resolution options.
 * @param {object} options.ctx - host context exposing `subprocess`.
 * @param {object} options.config - plugin config.
 * @param {string} [options.requested] - explicit backend id or `auto`.
 * @param {string} [options.cwd] - absolute child working directory.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @returns {Promise<{backend: string, executable: string, requested: string}>} the resolution.
 * @throws {RangeError} when an explicit backend id is unknown.
 * @throws {BackendResolutionError} when no candidate resolves.
 */
export async function resolveBackend(options) {
  const config = options.config
  const requested = String(options.requested ?? '').trim()
  const configured = String(configValue(config, 'backend') ?? 'auto').trim()
  const explicit = requested && requested !== 'auto' ? requested : (configured && configured !== 'auto' ? configured : '')
  if (explicit && !BACKENDS.includes(explicit)) {
    throw new RangeError(`unknown local delegation backend "${explicit}"; supported: ${BACKENDS.join(', ')}`)
  }

  let order
  if (requested && requested !== 'auto') order = [requested]
  else if (configured && configured !== 'auto') order = [configured]
  else {
    const configuredOrder = configValue(config, 'autoOrder')
    order = Array.isArray(configuredOrder) && configuredOrder.length > 0
      ? configuredOrder.map(String).filter((name) => BACKENDS.includes(name))
      : [...DEFAULT_AUTO_ORDER]
    if (order.length === 0) order = [...DEFAULT_AUTO_ORDER]
  }

  const env = forwardedEnv(config)
  const attempts = []
  for (const backend of order) {
    if (configValue(backendConfig(config, backend), 'enabled') === false) {
      attempts.push({ backend, path: String(backendValue(config, backend, 'path', backend)), error: 'disabled by config' })
      continue
    }
    const rawPath = String(backendValue(config, backend, 'path', backend))
    try {
      const executable = await options.ctx.subprocess.resolveExecutable(rawPath, env, options.signal)
      return { backend, executable, requested: requested || configured }
    } catch (error) {
      attempts.push({
        backend,
        path: rawPath,
        error: error instanceof Error ? error.message : String(error),
      })
    }
  }

  const measured = attempts.map((attempt) => `${attempt.backend} ("${attempt.path}"): ${attempt.error}`).join('; ')
  throw new BackendResolutionError(
    `no local CLI backend resolved for ${options.cwd ?? 'this call'}: ${measured}`,
    attempts,
  )
}

/**
 * Resolve one case-insensitive backend name from a model-facing string.
 * @param {string} value - requested backend name.
 * @returns {string} the canonical backend id.
 * @throws {RangeError} when the value is not a known backend.
 */
export function canonicalBackend(value) {
  const candidate = String(value ?? '').trim().toLowerCase()
  if (candidate === '' || candidate === 'auto') return ''
  const match = BACKENDS.find((backend) => backend === candidate)
  if (!match) throw new RangeError(`unknown local delegation backend "${value}"; supported: ${BACKENDS.join(', ')}`)
  return match
}

/**
 * Run one local CLI delegation to completion.
 * @param {object} options - call options.
 * @param {object} options.ctx - host context exposing `subprocess`.
 * @param {object} options.config - plugin config.
 * @param {string} options.task - task text.
 * @param {string} options.cwd - absolute child working directory.
 * @param {string} [options.backend] - explicit backend or `auto`.
 * @param {string} [options.model] - model override.
 * @param {string} [options.effort] - effort override.
 * @param {string} [options.mode] - mode override.
 * @param {number} [options.timeoutMs] - deadline override.
 * @param {string[]} [options.collect] - artifact globs.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {object} [options.resolved] - pre-resolved backend (from resolveBackend).
 * @returns {Promise<object>} canonical worker result (never rejects for runtime failures).
 */
export async function runLocalWorker(options) {
  const startedAt = Date.now()
  const config = options.config
  const task = String(options.task ?? '')
  const result = emptyResult()
  result.promptBytes = Buffer.byteLength(task, 'utf8')

  if (!options.cwd || !isAbsolute(options.cwd)) {
    result.diagnostic = 'delegate_local requires an absolute cwd'
    return result
  }
  const cwd = resolve(options.cwd)

  let resolved
  try {
    resolved = options.resolved ?? await resolveBackend({ ctx: options.ctx, config, requested: options.backend, cwd, signal: options.signal })
  } catch (error) {
    result.diagnostic = tail(error instanceof Error ? error.message : String(error), MAX_DIAGNOSTIC_CHARS)
    return result
  }
  const backend = resolved.backend
  result.backend = backend
  result.executable = resolved.executable
  result.promptTransport = usesArgvPrompt(backend) ? 'argv' : 'stdin'

  const model = effectiveModel(config, backend, options.model)
  const effort = effectiveEffort(config, backend, options.effort)
  const mode = effectiveMode(config, backend, options.mode)
  const timeoutMs = effectiveTimeoutMs(config, backend, options.timeoutMs)
  const maxOutputBytes = Number(configValue(config, 'maxOutputBytes')) || 8 * 1024 * 1024
  const artifactLimit = Number(configValue(config, 'artifactLimit')) || 100
  const disposeGraceMs = Number(configValue(config, 'disposeGraceMs')) || DEFAULT_DISPOSE_GRACE_MS
  result.model = model

  let invocation
  try {
    invocation = buildInvocation({
      backend,
      executable: resolved.executable,
      prompt: task,
      model,
      effort,
      mode,
      auto: configValue(backendConfig(config, backend), 'auto') !== false,
      extraArgs: backendValue(config, backend, 'extraArgs', []),
    })
  } catch (error) {
    result.diagnostic = tail(error instanceof Error ? error.message : String(error), MAX_DIAGNOSTIC_CHARS)
    return result
  }

  let artifactDir = null
  try {
    artifactDir = resolveArtifactDir(cwd, configValue(config, 'artifactDir'))
  } catch (error) {
    result.diagnostic = tail(error instanceof Error ? error.message : String(error), MAX_DIAGNOSTIC_CHARS)
    return result
  }

  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const env = forwardedEnv(config)
  const stdio = {
    stdin: usesArgvPrompt(backend) ? 'ignore' : 'pipe',
    stdout: { maxBytes: maxOutputBytes },
    stderr: { maxBytes: maxOutputBytes },
  }

  let handle
  try {
    handle = options.ctx.subprocess.spawn({
      argv: invocation.argv,
      cwd,
      stdio,
      graceMs: disposeGraceMs,
      signal,
      env,
    })
  } catch (error) {
    result.diagnostic = tail(`failed to start ${backend}: ${error instanceof Error ? error.message : String(error)}`, MAX_DIAGNOSTIC_CHARS)
    result.elapsedMs = Date.now() - startedAt
    return result
  }

  if (invocation.stdinPrompt !== null) {
    try {
      handle.stdin?.on?.('error', () => {})
      handle.stdin?.end?.(invocation.stdinPrompt)
    } catch {
      // A child that exits before reading stdin is reported through its exit facts.
    }
  }

  let outcome = { exitCode: -1, signal: null }
  let stdout = ''
  let stderr = ''
  let truncated = false
  try {
    outcome = await handle.done
    const out = handle.collected.stdout?.readFrom(0)
    const err = handle.collected.stderr?.readFrom(0)
    stdout = out?.text ?? ''
    stderr = err?.text ?? ''
    truncated = Boolean(out?.lossy || err?.lossy)
  } catch (error) {
    result.diagnostic = tail(`worker failed: ${error instanceof Error ? error.message : String(error)}`, MAX_DIAGNOSTIC_CHARS)
    result.elapsedMs = Date.now() - startedAt
    return result
  }

  const parsed = parseOutput(backend, stdout)
  result.exitCode = outcome.exitCode ?? -1
  result.signal = outcome.signal ?? ''
  result.timedOut = timeout.aborted && !(options.signal?.aborted ?? false)
  result.truncated = truncated
  result.elapsedMs = Date.now() - startedAt
  result.usage = parsed.usage
  result.summary = parsed.summary
  result.stderrTail = tail(stderr, STDERR_TAIL_CHARS)
  result.ok = !result.timedOut
    && result.exitCode === 0
    && parsed.status !== 'ERROR'
    && parsed.errors.length === 0
  if (!result.ok) {
    result.diagnostic = tail(parsed.errors.join('; ') || (result.timedOut ? `timed out after ${timeoutMs} ms` : ''), MAX_DIAGNOSTIC_CHARS)
  }

  const collected = await collectArtifacts(cwd, options.collect, artifactLimit)
  result.artifacts = collected.artifacts
  result.missing = collected.missing
  result.skipped = collected.skipped

  if (artifactDir) {
    const runId = `${new Date(startedAt).toISOString().replace(/[:.]/g, '-')}-${randomUUID().slice(0, 8)}`
    try {
      result.artifactDir = await persistRunFiles({ artifactDir, runId, cwd, stdout, stderr, result })
    } catch (error) {
      result.diagnostic = tail(`${result.diagnostic ? `${result.diagnostic}; ` : ''}artifactDir write failed: ${error instanceof Error ? error.message : String(error)}`, MAX_DIAGNOSTIC_CHARS)
    }
  }

  return result
}
