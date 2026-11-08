/**
 * Process orchestration for the built-in `cli_worker` tool: resolve the
 * executable, spawn one child through `ctx.subprocess`, deliver the task on
 * stdin, then parse the result and collect artifacts.
 *
 * One call owns exactly one process. There is no resume, no streaming, and no
 * fallback: a failed worker returns its exit facts and the caller decides.
 */
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

import { forwardedEnv, sendPrompt } from '../shared.js'
import { collectArtifacts } from './artifacts.js'
import { backendSpec, buildWorkerArgv, parseWorkerOutput } from './backends.js'

/** Tail size kept from stderr for diagnostics. */
const STDERR_TAIL_CHARS = 4000

/**
 * Read one config value from a reactive config object, a plain object, or a fallback.
 * Unit tests pass a plain stub, the host passes reactive getters.
 * @param {object} config - reactive or plain config.
 * @param {string} key - field name.
 * @param {unknown} fallback - value used when the field is absent.
 * @returns {unknown} the value.
 */
function configValue(config, key, fallback) {
  const entry = config?.[key]
  if (entry !== null && typeof entry === 'object' && typeof entry.get === 'function') {
    const value = entry.get()
    return value === undefined ? fallback : value
  }
  return entry === undefined ? fallback : entry
}

/**
 * Read a per-backend string map.
 * @param {object} config - reactive or plain config.
 * @param {string} key - field name.
 * @returns {Record<string, string>} the map (never null).
 */
function backendMap(config, key) {
  const value = configValue(config, key, {})
  return value && typeof value === 'object' ? value : {}
}

/**
 * Canonical zero-valued result, so every schema field is present on a run that
 * never spawned a process.
 * @param {string} backend - backend id.
 * @returns {object} canonical result.
 */
function skipResult(backend) {
  return {
    ok: false,
    backend,
    elapsedMs: 0,
    promptBytes: 0,
    promptTransport: 'stdin',
    exitCode: -1,
    timedOut: false,
    truncated: false,
    summary: '',
    artifacts: [],
    missing: [],
    skipped: 0,
    inputTokens: 0,
    outputTokens: 0,
    stderrTail: '',
    diagnostic: '',
    errorKind: '',
    yieldedProvider: '',
  }
}

/**
 * Validate a worker working directory.
 * @param {string | undefined} cwd - requested directory (absolute).
 * @returns {Promise<string>} the resolved absolute directory.
 * @throws {Error} when the path is relative or not a directory.
 */
async function resolveWorkerCwd(cwd) {
  if (!cwd || !isAbsolute(cwd)) {
    throw new Error('cli_worker requires an absolute "cwd" outside the workspace')
  }
  const absolute = resolve(cwd)
  let info
  try {
    info = await stat(absolute)
  } catch {
    throw new Error(`cli_worker cwd does not exist: ${absolute}`)
  }
  if (!info.isDirectory()) throw new Error(`cli_worker cwd is not a directory: ${absolute}`)
  return absolute
}

/**
 * Run one worker call.
 * @param {object} ctx - host context carrying the subprocess service.
 * @param {object} config - plugin config with `workerTimeoutMs`, `workerMaxOutputBytes`, `workerArtifactLimit`, `forwardEnv`, and `opencodePath`.
 * @param {{backend: string, task: string, cwd: string, model?: string, effort?: string, mode?: string, timeoutMs?: number, collect?: string[], signal?: AbortSignal}} options - call options.
 * @returns {Promise<{ok: boolean, backend: string, elapsedMs: number, promptBytes: number, promptTransport: string, exitCode: number, timedOut: boolean, truncated: boolean, summary: string, artifacts: {path: string, bytes: number, sha256: string}[], missing: string[], skipped: number, inputTokens: number, outputTokens: number, stderrTail: string}>} worker result.
 */
export async function runWorker(ctx, config, options) {
  const backend = options.backend
  const spec = backendSpec(backend)
  // Per-backend gates (S2): a disabled backend never spawns, and a backend that
  // an already-mounted subagent provider serves yields instead of duplicating the CLI.
  const disabled = configValue(config, 'workerDisabledBackends', [])
  if (Array.isArray(disabled) && disabled.includes(backend)) {
    const result = skipResult(backend)
    result.diagnostic = `cli_worker backend "${backend}" is disabled by config (workerDisabledBackends)`
    result.errorKind = 'disabled'
    return result
  }
  const yieldName = backendMap(config, 'yieldToProviders')[backend]
  if (yieldName) {
    const provider = typeof ctx.subagents?.getProvider === 'function' ? ctx.subagents.getProvider(yieldName) : undefined
    if (provider) {
      const result = skipResult(backend)
      result.diagnostic = `backend "${backend}" is served by the mounted provider "${yieldName}"`
      result.errorKind = 'provider-mounted'
      result.yieldedProvider = yieldName
      return result
    }
  }
  const cwd = await resolveWorkerCwd(options.cwd)
  // `PWD` is authoritative for shells and for the OpenCode CLI's session
  // directory: an inherited value from the host process makes the child work in
  // the caller's directory while `spawn.cwd` says otherwise. Pin it to `cwd`.
  const env = { ...forwardedEnv(config.forwardEnv.get()), PWD: cwd }
  const pathOverride = backendMap(config, 'workerBackendPaths')[backend]
  const executableName = pathOverride || (backend === 'opencode' ? config.opencodePath.get() : spec.executable)
  const executable = await ctx.subprocess.resolveExecutable(executableName, env, options.signal)
  const timeoutMs = options.timeoutMs ?? config.workerTimeoutMs.get()
  const maxBytes = config.workerMaxOutputBytes.get()
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const model = options.model || backendMap(config, 'workerBackendModels')[backend] || ''
  const effort = options.effort || backendMap(config, 'workerBackendEfforts')[backend] || ''
  const mode = options.mode || backendMap(config, 'workerBackendModes')[backend] || ''
  const argv = buildWorkerArgv(backend, { executable, model, effort, mode })
  const handle = ctx.subprocess.spawn({
    argv,
    cwd,
    stdio: {
      // The task goes to stdin, never argv: a single argv string is capped at
      // 128 KiB (MAX_ARG_STRLEN) and a task may embed a whole file.
      stdin: 'pipe',
      stdout: { maxBytes },
      stderr: { maxBytes },
    },
    graceMs: 10000,
    signal,
    env,
  })
  // Router control plane (optional): a `cli_worker` run is an external CLI
  // process, so it is registered the same way the delegation providers register
  // theirs. A session torn down while this batch runs would otherwise leave the
  // child unreaped. `ownerSession` is the DSH Session, distinct from the batch's
  // own `options.session`.
  let release = () => {}
  if (typeof options.track === 'function' && options.ownerSession !== undefined && options.ownerSession !== null) {
    try {
      const registered = options.track(options.ownerSession, handle, `cli_worker ${backend}`)
      if (typeof registered === 'function') release = registered
    } catch {
      // A registry that cannot accept the handle must not fail the run.
    }
  }
  const startedAt = Date.now()
  const promptBytes = Buffer.byteLength(String(options.task ?? ''), 'utf8')
  const delivered = sendPrompt(handle, options.task)
  let outcome
  try {
    outcome = await handle.done
  } finally {
    release()
  }
  const stdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  const timedOut = timeout.aborted
  const parsed = parseWorkerOutput(backend, stdout?.text ?? '')
  const artifacts = await collectArtifacts({
    cwd,
    patterns: options.collect ?? [],
    limit: config.workerArtifactLimit.get(),
    signal: options.signal,
  })
  // Provider failures (a 429, an unavailable route) arrive as JSON events on
  // stdout, not as a non-zero stderr write; surface them with the exit facts.
  const stderrText = [stderr?.text ?? '', ...(parsed.errors ?? [])].filter(Boolean).join('\n')
  return {
    ok: !timedOut && delivered && outcome.exitCode === 0,
    backend,
    // Measured facts ported from @nolit/dsh-subagent-local (2026-11-07): the
    // caller needs the transport and the request size to diagnose a run
    // without re-reading the process table.
    elapsedMs: Date.now() - startedAt,
    promptBytes,
    promptTransport: 'stdin',
    exitCode: outcome.exitCode ?? -1,
    timedOut,
    truncated: Boolean(stdout?.lossy || stderr?.lossy),
    summary: parsed.summary,
    artifacts: artifacts.artifacts,
    missing: artifacts.missing,
    skipped: artifacts.skipped,
    inputTokens: parsed.usage.inputTokens,
    outputTokens: parsed.usage.outputTokens,
    stderrTail: stderrText.length > STDERR_TAIL_CHARS ? stderrText.slice(-STDERR_TAIL_CHARS) : stderrText,
    diagnostic: '',
    errorKind: '',
    yieldedProvider: '',
  }
}
