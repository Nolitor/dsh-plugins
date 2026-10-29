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
 * @param {{backend: string, task: string, cwd: string, model?: string, timeoutMs?: number, collect?: string[], signal?: AbortSignal}} options - call options.
 * @returns {Promise<{ok: boolean, backend: string, exitCode: number, timedOut: boolean, truncated: boolean, summary: string, artifacts: {path: string, bytes: number, sha256: string}[], missing: string[], skipped: number, inputTokens: number, outputTokens: number, stderrTail: string}>} worker result.
 */
export async function runWorker(ctx, config, options) {
  const backend = options.backend
  const spec = backendSpec(backend)
  const cwd = await resolveWorkerCwd(options.cwd)
  // `PWD` is authoritative for shells and for the OpenCode CLI's session
  // directory: an inherited value from the host process makes the child work in
  // the caller's directory while `spawn.cwd` says otherwise. Pin it to `cwd`.
  const env = { ...forwardedEnv(config.forwardEnv.get()), PWD: cwd }
  const executableName = backend === 'opencode' ? config.opencodePath.get() : spec.executable
  const executable = await ctx.subprocess.resolveExecutable(executableName, env, options.signal)
  const timeoutMs = options.timeoutMs ?? config.workerTimeoutMs.get()
  const maxBytes = config.workerMaxOutputBytes.get()
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const argv = buildWorkerArgv(backend, { executable, model: options.model })
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
  const delivered = sendPrompt(handle, options.task)
  const outcome = await handle.done
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
  }
}
