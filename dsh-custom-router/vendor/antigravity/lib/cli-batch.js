/**
 * Antigravity CLI batch worker — the synchronous one-shot shape.
 *
 * `agy_worker` (and `/agy`) start a tracked child session and return at once
 * (owner decision 2026-11-05). This module is the other shape the Custom Router
 * surface contract (`CUSTOM-ROUTER-SURFACE-CONTRACT.md`, M13) names: **one call =
 * one CLI process = the answer in the result**, carrying exit facts, bounded
 * output, disjoint usage and hashed artifacts.
 *
 * It is a port of `@nolit/dsh-subagent-local`'s synchronous worker (owner
 * decision 1(a), 2026-11-07: fold that functionality into the provider plugins
 * and retire the separate package). The bare-process trade-off is why it is
 * gated by its own switch and **off by default**: an operator who wants the
 * batch shape enables `cliBatch`, and the tracked-child shape stays the default.
 *
 * The prompt rides beside `-p` in argv (measured: `agy` ignores stdin in print
 * mode), so a task over the kernel's single-argument limit is rejected rather
 * than truncated.
 *
 * @module @nolit/dsh-antigravity/cli-batch
 */
import { isAbsolute, resolve } from 'node:path'

import { buildAgyArgv, parseAgyOutput } from './backends.js'
import { collectArtifacts } from './artifacts.js'

/** Tool name for the synchronous shape. Never a reserved `subagent_*` name. */
export const BATCH_TOOL_NAME = 'agy_cli'

/** Tail size kept from stderr for diagnostics. */
const STDERR_TAIL_CHARS = 4000

/** Grace period before a terminated child is reaped. */
const DISPOSE_GRACE_MS = 5000

/** Description shown to the model. */
const DESCRIPTION =
  'Run one synchronous `agy` batch: the CLI sees only the task text, never this conversation, and the call returns its final answer, exit facts, token usage and any collected artifacts. Use it for self-contained one-shot jobs. It does not create a tracked child session — use agy_worker for that.'

/**
 * Parameter map for the batch tool.
 * @returns {Record<string, object>} parameter schema.
 */
export function batchParameters() {
  return {
    task: {
      type: 'string',
      required: true,
      description: 'The complete instruction for the CLI. It does not see this conversation, so include every path and constraint it needs.',
    },
    cwd: {
      type: 'string',
      description: 'Absolute directory the CLI may modify. Defaults to the calling session working directory.',
    },
    model: {
      type: 'string',
      description: 'Model id override for this call. Omission uses the plugin config value.',
    },
    effort: {
      type: 'string',
      enum: ['low', 'medium', 'high', 'xhigh', 'max'],
      description: 'Reasoning effort override. A model id that already encodes its level rejects a different effort.',
    },
    mode: {
      type: 'string',
      enum: ['accept-edits', 'auto', 'plan'],
      description: 'Execution mode override.',
    },
    timeoutMs: {
      type: 'number',
      description: 'Hard deadline in milliseconds for this call.',
    },
    collect: {
      type: 'array',
      items: { type: 'string' },
      description: 'Glob patterns relative to cwd whose matches are returned as hashed artifacts.',
    },
  }
}

/**
 * Canonical empty result: every field of the output schema is present, so the
 * host can validate and render a failed run.
 * @param {string} [diagnostic] - why the run did not happen.
 * @returns {object} canonical result.
 */
export function emptyBatchResult(diagnostic = '') {
  return {
    ok: false,
    backend: 'antigravity',
    executable: '',
    model: '',
    promptTransport: 'argv',
    exitCode: -1,
    signal: '',
    timedOut: false,
    truncated: false,
    elapsedMs: 0,
    promptBytes: 0,
    usage: { inputTokens: 0, outputTokens: 0, thinkingTokens: 0, cacheReadTokens: 0 },
    summary: '',
    diagnostic,
    errorKind: '',
    yieldedProvider: '',
    stderrTail: '',
    artifacts: [],
    missing: [],
    skipped: 0,
  }
}

/**
 * Output declaration for the canonical tool value.
 * @returns {object} JSON schema.
 */
export function batchOutputSchema() {
  const counter = { type: 'integer', required: true }
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      ok: { type: 'boolean', required: true },
      backend: { type: 'string', required: true },
      executable: { type: 'string', required: true },
      model: { type: 'string', required: true },
      promptTransport: { type: 'string', required: true },
      exitCode: { type: 'integer', required: true },
      signal: { type: 'string', required: true },
      timedOut: { type: 'boolean', required: true },
      truncated: { type: 'boolean', required: true },
      elapsedMs: { type: 'integer', required: true },
      promptBytes: { type: 'integer', required: true },
      usage: {
        type: 'object',
        required: true,
        additionalProperties: false,
        properties: {
          inputTokens: counter,
          outputTokens: counter,
          thinkingTokens: counter,
          cacheReadTokens: counter,
        },
      },
      summary: { type: 'string', required: true },
      diagnostic: { type: 'string', required: true },
      errorKind: { type: 'string', required: true },
      yieldedProvider: { type: 'string', required: true },
      stderrTail: { type: 'string', required: true },
      artifacts: {
        type: 'array',
        required: true,
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            path: { type: 'string', required: true },
            bytes: { type: 'integer', required: true },
            sha256: { type: 'string', required: true },
          },
        },
      },
      missing: { type: 'array', required: true, items: { type: 'string' } },
      skipped: { type: 'integer', required: true },
    },
  }
}

/**
 * Model-facing text for one batch result.
 * @param {object} result - canonical result.
 * @returns {string} rendered report.
 */
export function renderBatchResult(result) {
  const head = result.timedOut
    ? 'agy batch timed out and was terminated.'
    : result.ok
      ? 'agy batch finished successfully.'
      : `agy batch exited with code ${result.exitCode}.`
  const usage = result.usage.inputTokens || result.usage.outputTokens
    ? `\n[tokens: input ${result.usage.inputTokens}, output ${result.usage.outputTokens}, thinking ${result.usage.thinkingTokens}, cache read ${result.usage.cacheReadTokens}]`
    : ''
  const files = result.artifacts.length
    ? `\n[artifacts]\n${result.artifacts.map((file) => `${file.path} (${file.bytes} B, sha256 ${file.sha256.slice(0, 12)}…)`).join('\n')}`
    : ''
  const missing = result.missing.length ? `\n[no match for: ${result.missing.join(', ')}]` : ''
  const skipped = result.skipped ? `\n[${result.skipped} artifact(s) dropped by the collection limit]` : ''
  const truncated = result.truncated ? '\n[output truncated — tail shown]' : ''
  const diagnostic = result.diagnostic ? `\n[diagnostic] ${result.diagnostic}` : ''
  const body = result.summary || '(no output)'
  const error = result.stderrTail ? `\n\n--- stderr ---\n${result.stderrTail}` : ''
  return `${head}${usage}${files}${missing}${skipped}${truncated}${diagnostic}\n\n${body}${error}`
}

/**
 * Resolve the batch working directory.
 * @param {string|undefined} requested - caller-supplied cwd.
 * @param {object|undefined} agent - the calling agent (its session cwd is the fallback).
 * @returns {string} an absolute directory.
 * @throws {Error} when no absolute directory can be resolved.
 */
function resolveBatchCwd(requested, agent) {
  const candidate = requested || agent?.session?.header?.cwd || ''
  if (typeof candidate !== 'string' || candidate === '') {
    throw new Error('agy_cli needs an absolute "cwd" (or a calling session with one)')
  }
  if (!isAbsolute(candidate)) throw new Error(`agy_cli cwd must be absolute: ${candidate}`)
  return resolve(candidate)
}

/**
 * Run one synchronous `agy` batch.
 * @param {object} options - run options.
 * @param {object} options.services - acquired services (`subprocess` required).
 * @param {object} options.config - reactive plugin config.
 * @param {string} options.task - task text.
 * @param {string} [options.cwd] - absolute working directory.
 * @param {object} [options.agent] - calling agent (cwd fallback).
 * @param {string} [options.model] - model override.
 * @param {string} [options.effort] - effort override.
 * @param {string} [options.mode] - mode override.
 * @param {number} [options.timeoutMs] - deadline override.
 * @param {string[]} [options.collect] - artifact globs.
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @returns {Promise<object>} canonical result.
 */
export async function runBatch(options) {
  const { services, config } = options
  const result = emptyBatchResult()
  const subprocess = services?.subprocess
  if (!subprocess) {
    result.diagnostic = 'the host did not provide the subprocess service'
    return result
  }

  // S2: when the profile maps this backend to an already-mounted subagent
  // provider, report it and spawn nothing — one CLI run per request.
  const yieldTo = String(configValue(config, 'batchYieldToProvider') || '')
  if (yieldTo !== '') {
    const provider = typeof services?.subagents?.getProvider === 'function'
      ? services.subagents.getProvider(yieldTo)
      : undefined
    if (provider) {
      result.diagnostic = `antigravity is served by the mounted provider "${yieldTo}"`
      result.errorKind = 'provider-mounted'
      result.yieldedProvider = yieldTo
      return result
    }
  }

  const task = String(options.task ?? '')
  if (task.trim() === '') throw new Error('agy_cli requires a non-empty task')

  const cwd = resolveBatchCwd(options.cwd, options.agent)
  const model = options.model || configValue(config, 'model')
  const effort = options.effort || configValue(config, 'effort')
  const mode = options.mode || configValue(config, 'mode')
  const timeoutMs = options.timeoutMs || configValue(config, 'timeoutMs') || 600000
  const maxBytes = configValue(config, 'maxOutputBytes') || 8388608
  const artifactLimit = configValue(config, 'artifactLimit') || 100
  const env = forwardedEnv(configValue(config, 'forwardEnv'))

  result.model = model || ''
  result.promptBytes = Buffer.byteLength(task, 'utf8')

  let argv
  try {
    argv = buildAgyArgv({
      executable: '',
      prompt: task,
      model,
      effort,
      mode,
      extraArgs: configValue(config, 'extraArgs'),
    })
  } catch (error) {
    result.diagnostic = error instanceof Error ? error.message : String(error)
    return result
  }

  const started = Date.now()
  try {
    const executable = await subprocess.resolveExecutable(configValue(config, 'agyPath') || 'agy', env, options.signal)
    argv[0] = executable
    result.executable = executable

    const timeout = AbortSignal.timeout(timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
    const handle = subprocess.spawn({
      argv,
      cwd,
      stdio: {
        // `agy -p` takes the prompt as an argv value; stdin stays closed so the
        // CLI cannot wait on a pipe that never produces a prompt.
        stdin: 'ignore',
        stdout: { maxBytes },
        stderr: { maxBytes },
      },
      graceMs: DISPOSE_GRACE_MS,
      signal,
      env: { ...env, PWD: cwd },
    })
    // Router control plane (optional). A batch run is an external `agy` process
    // with its own timeout; registering it lets a Session teardown reclaim it
    // instead of waiting out `agyBatchTimeoutMs`. A standalone mount has no
    // `track` and keeps the signal-only path.
    let release = () => {}
    if (typeof options.track === 'function' && options.agent?.session !== undefined && options.agent?.session !== null) {
      try {
        const registered = options.track(options.agent.session, handle, 'agy batch')
        if (typeof registered === 'function') release = registered
      } catch {
        // A registry that cannot accept the handle must not fail the run.
      }
    }
    let outcome
    try {
      outcome = await handle.done
    } finally {
      release()
    }
    const stdout = handle.collected.stdout?.readFrom(0)
    const stderr = handle.collected.stderr?.readFrom(0)
    const parsed = parseAgyOutput(stdout?.text ?? '')
    const artifacts = await collectArtifacts(cwd, options.collect ?? [], artifactLimit)
    const stderrText = String(stderr?.text ?? '')
    const timedOut = timeout.aborted

    result.ok = !timedOut && (outcome.exitCode ?? 0) === 0
    result.exitCode = outcome.exitCode ?? -1
    result.signal = outcome.signal ? String(outcome.signal) : ''
    result.timedOut = timedOut
    result.truncated = Boolean(stdout?.lossy || stderr?.lossy)
    result.elapsedMs = Date.now() - started
    result.usage = parsed.usage
    result.summary = parsed.summary
    result.stderrTail = stderrText.length > STDERR_TAIL_CHARS ? stderrText.slice(-STDERR_TAIL_CHARS) : stderrText
    result.artifacts = artifacts.artifacts
    result.missing = artifacts.missing
    result.skipped = artifacts.skipped
    if (!parsed.parsed && stderrText.trim() !== '') result.diagnostic = 'agy output was not a JSON envelope; raw output shown'
    return result
  } catch (error) {
    result.elapsedMs = Date.now() - started
    result.diagnostic = error instanceof Error ? error.message : String(error)
    return result
  }
}

/**
 * Read one config value from a reactive config object or a plain object.
 * @param {object} config - reactive or plain config.
 * @param {string} key - field name.
 * @returns {unknown} the value.
 */
function configValue(config, key) {
  const entry = config?.[key]
  if (entry !== null && typeof entry === 'object' && typeof entry.get === 'function') return entry.get()
  return entry
}

/**
 * Forward selected environment variables to the child.
 * @param {string[]|undefined} names - variable names.
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
 * Build the tool definition registered under {@link BATCH_TOOL_NAME}.
 * @param {object} deps - `{ services, config }`.
 * @returns {object} a registry-ready tool definition.
 */
export function batchToolDefinition(deps) {
  return {
    name: BATCH_TOOL_NAME,
    description: DESCRIPTION,
    parameters: batchParameters(),
    output: {
      schema: batchOutputSchema(),
      render: (_args, value) => [{ type: 'text', text: renderBatchResult(value) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      return runBatch({
        services: deps.services,
        config: deps.config,
        task: String(args?.task ?? ''),
        cwd: args?.cwd,
        agent: exec?.agent,
        model: args?.model,
        effort: args?.effort,
        mode: args?.mode,
        timeoutMs: args?.timeoutMs,
        collect: args?.collect,
        signal: exec?.signal,
        track: deps.dispatch?.track,
      })
    },
  }
}
