/**
 * Process orchestration for the Antigravity worker.
 *
 * One call owns exactly one `agy` process. The prompt rides in argv beside `-p`;
 * stdout is collected as a bounded tail and parsed as the CLI's JSON envelope.
 * A resolve miss, a spawn failure, a non-zero exit, and a timeout return facts
 * instead of throwing, so the caller decides what to report.
 */
import { isAbsolute, resolve } from 'node:path'

import { buildAgyArgv, parseAgyOutput } from './backends.js'
import { collectArtifacts } from './artifacts.js'

/** Tail size kept from stderr for diagnostics. */
const STDERR_TAIL_CHARS = 4000

/**
 * Forward selected environment variables to the child.
 * @param {string[]} names - variable names to copy.
 * @returns {Record<string, string>} the forwarded subset.
 */
function forwardedEnv(names) {
  const env = {}
  for (const key of names ?? []) {
    const value = process.env[key]
    if (value !== undefined) env[key] = value
  }
  return env
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
 * Run `agy models` and return its text.
 * @param {object} ctx - host context exposing `subprocess`.
 * @param {object} config - resolved plugin config with reactive getters.
 * @param {string} cwd - absolute working directory.
 * @returns {Promise<{ok: boolean, text: string}>} the listing, or a diagnostic.
 */
export async function listAgyModels(ctx, config, cwd) {
  const env = forwardedEnv(config.forwardEnv.get())
  try {
    const executable = await ctx.subprocess.resolveExecutable(config.agyPath.get(), env)
    const handle = ctx.subprocess.spawn({
      argv: [executable, 'models'],
      cwd,
      stdio: { stdin: 'ignore', stdout: { maxBytes: 262144 }, stderr: { maxBytes: 65536 } },
      graceMs: 5000,
      signal: AbortSignal.timeout(30000),
      env,
    })
    const outcome = await handle.done
    const out = handle.collected.stdout?.readFrom(0)?.text ?? ''
    const err = handle.collected.stderr?.readFrom(0)?.text ?? ''
    return { ok: (outcome.exitCode ?? 0) === 0, text: (out || err).trim() }
  } catch (error) {
    return { ok: false, text: `cannot list agy models: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/**
 * Run one Antigravity worker call.
 * @param {object} ctx - host context exposing `subprocess`.
 * @param {object} config - resolved plugin config with reactive getters.
 * @param {object} options - call options.
 * @param {string} options.prompt - task text.
 * @param {string} options.cwd - absolute working directory.
 * @param {string} [options.model] - model override.
 * @param {string} [options.effort] - effort override.
 * @param {string} [options.mode] - execution mode override.
 * @param {number} [options.timeoutMs] - deadline override.
 * @param {string[]} [options.collect] - artifact globs (tool path only).
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @returns {Promise<object>} canonical worker result.
 */
export async function runAgyWorker(ctx, config, options) {
  if (!options.cwd || !isAbsolute(options.cwd)) {
    throw new Error('agy requires an absolute "cwd"')
  }
  const cwd = resolve(options.cwd)
  const env = forwardedEnv(config.forwardEnv.get())
  const timeoutMs = options.timeoutMs ?? config.timeoutMs.get()
  const maxBytes = config.maxOutputBytes.get()
  const model = options.model ?? config.model.get()
  const effort = options.effort ?? config.effort.get()
  const mode = options.mode ?? config.mode.get()

  const empty = {
    ok: false,
    exitCode: -1,
    signal: '',
    timedOut: false,
    truncated: false,
    summary: '',
    conversationId: '',
    status: '',
    mode,
    planOnly: mode === 'plan',
    inputTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    cacheReadTokens: 0,
    stderrTail: '',
    artifacts: [],
    missing: [],
    skipped: 0,
  }

  let executable
  try {
    executable = await ctx.subprocess.resolveExecutable(config.agyPath.get(), env, options.signal)
  } catch (error) {
    return { ...empty, summary: `cannot resolve the agy executable: ${error instanceof Error ? error.message : String(error)}` }
  }

  let argv
  try {
    argv = buildAgyArgv({ executable, prompt: options.prompt, model, effort, mode, extraArgs: config.extraArgs.get() })
  } catch (error) {
    return { ...empty, summary: error instanceof Error ? error.message : String(error) }
  }

  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout

  let outcome
  let stdout = ''
  let stderr = ''
  let truncated = false
  try {
    const handle = ctx.subprocess.spawn({
      argv,
      cwd,
      stdio: {
        stdin: 'ignore',
        stdout: { maxBytes },
        stderr: { maxBytes },
      },
      graceMs: 10000,
      signal,
      env,
    })
    outcome = await handle.done
    const out = handle.collected.stdout?.readFrom(0)
    const err = handle.collected.stderr?.readFrom(0)
    stdout = out?.text ?? ''
    stderr = err?.text ?? ''
    truncated = Boolean(out?.lossy)
  } catch (error) {
    return {
      ...empty,
      timedOut: timeout.aborted,
      summary: `agy failed to start: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  const parsed = parseAgyOutput(stdout)
  const collected = await collectArtifacts(cwd, options.collect, config.artifactLimit.get())
  const failed = timeout.aborted || (outcome.exitCode ?? 0) !== 0

  return {
    ok: !failed && parsed.status !== 'ERROR',
    exitCode: outcome.exitCode ?? -1,
    signal: outcome.signal ?? '',
    timedOut: timeout.aborted,
    truncated,
    summary: parsed.summary,
    conversationId: parsed.conversationId,
    status: parsed.status,
    mode,
    planOnly: mode === 'plan',
    inputTokens: parsed.usage.inputTokens,
    outputTokens: parsed.usage.outputTokens,
    thinkingTokens: parsed.usage.thinkingTokens,
    cacheReadTokens: parsed.usage.cacheReadTokens,
    stderrTail: tail(stderr, STDERR_TAIL_CHARS),
    artifacts: collected.artifacts,
    missing: collected.missing,
    skipped: collected.skipped,
  }
}
