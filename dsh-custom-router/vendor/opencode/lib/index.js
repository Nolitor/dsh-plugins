/**
 * The `opencode` delegation tool (+ `/opencode` command) for OpenCode v2.2.0.
 *
 * Structurally a diff of @quonaro/dsh-plugin-opencode/lib/index.js:
 *   - v2 argv: no `--attach`/`--pure`; adds `--thinking`, `--title`, `-f`.
 *   - `attach`/`pure` stay declared in Config so existing profile rows still
 *     load, but they are inert.
 *   - token counts come from `opencode session export <sid>` because v2's
 *     `run --format json` never emits a whole-run `step_finish` total.
 *
 * The output schema keeps upstream's keys exactly: dsh-tools declares
 * `additionalProperties: false`, so new data rides in rendered text only.
 *
 * DELEGATION MODEL (2026-11-05, owner decision): the `opencode` tool and the
 * `/ocode` command do NOT spawn `opencode run` for a conversation delegation.
 * They start a managed child session through the subagents service's `startActivation`
 * with this package's registered `opencode` provider and `delivery: 'parent'`,
 * return the child id immediately, and the child's result is delivered to the
 * parent as a completion notice. A bare spawn is reachable only through the
 * explicitly documented emergency fallback `DSH_OPENCODE_SPAWN_FALLBACK=1`
 * (`runOpencode` below); it is never the default path. `/ocode models` and
 * `listOpencodeModels` keep probing the CLI — a catalog read creates no session.
 */
import Schema from '@deepseek-ai/schemastery'

import {
  activationLabel,
  activationText,
  fallbackEnabled,
  fallbackText,
  providerNameOf,
  startChildSession,
  unavailableMessage,
  unsupportedChildArgs,
} from './delegation.js'
import { JsonRunParser, buildRunArgv, fetchUsage, forwardedEnv, sendPrompt, stripUnsupportedFlags } from './shared.js'
import { readSelection, writeSelection } from './selection.js'
import { WORKER_BACKENDS } from './workers/backends.js'
import { registerCliWorker } from './workers/index.js'
import { OpenCodeSubagentProvider } from './subagent.js'
import { createCostStore, parseCost, sharedCostLedger } from './cost.js'

/** Host plugin name; must match package.json `name` and the cordis.patch.yml row id. */
export const name = 'dsh-opencode-v2'

/** Services this plugin needs before it loads: the tool registry and a subprocess provider. */
export const inject = ['tools', 'subprocess']

const FORWARD_ENV_DEFAULT = [
  'PATH',
  'HOME',
  'USER',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'OPENCODE_CONFIG',
  'OPENCODE_SERVER_USERNAME',
  'OPENCODE_SERVER_PASSWORD',
]

/**
 * Default `-m` route. Must be an `opencode/...` route: v2 knows those; never
 * leave it bare. The `#low` variant is the route's lowest advertised reasoning
 * level, so a bare `/ocode` run reasons cheaply.
 */
export const DEFAULT_MODEL = 'opencode-go/minimax-m3.1-flash#low'

/** Schemastery schema: defaults live here; cordis.yml and GUI edits are validated against it. */
export const Config = Schema.object({
  /** Master switch: off removes the delegation tool, `/ocode`, `cli_worker` and the subagent provider. */
  enabled: Schema.boolean().default(true).volatile(),
  /** CLI switch: off removes the `opencode` tool, `/ocode` and `cli_worker`; the subagent surface stays. */
  cli: Schema.boolean().default(true).volatile(),
  opencodePath: Schema.string().default('opencode').volatile(),
  auto: Schema.boolean().default(true).volatile(),
  model: Schema.string().default(DEFAULT_MODEL).volatile(),
  agent: Schema.string().default('').volatile(),
  // Legacy keys from @quonaro/dsh-plugin-opencode@0.1.x rows: accepted, never used.
  // opencode v2.2.0 rejects `--attach`/`--pure` (Unrecognized flag, exit 1), so
  // emitting them would brick every run.
  attach: Schema.string().default('').volatile(),
  pure: Schema.boolean().default(false).volatile(),
  thinking: Schema.boolean().default(true).volatile(),
  title: Schema.string().default('').volatile(),
  timeoutMs: Schema.number().default(600000).volatile(),
  maxOutputBytes: Schema.number().default(1048576).volatile(),
  forwardEnv: Schema.array(Schema.string()).default(FORWARD_ENV_DEFAULT).volatile(),
  extraArgs: Schema.array(Schema.string()).default([]).volatile(),
  // Budget for the post-run `session export` usage fetch; 0 disables it.
  exportTimeoutMs: Schema.number().default(60000).volatile(),
  // Built-in `cli_worker` tool (isolated one-shot CLI batch work). The tool is
  // packaged here rather than in a second plugin because it tracks the same
  // OpenCode surface and must version with the conversation route.
  workerEnabled: Schema.boolean().default(true).volatile(),
  workerBackend: Schema.union(WORKER_BACKENDS).default('opencode').volatile(),
  workerTimeoutMs: Schema.number().default(900000).volatile(),
  workerMaxOutputBytes: Schema.number().default(262144).volatile(),
  workerArtifactLimit: Schema.number().default(100).volatile(),
  /** Backends this profile disables for the CLI worker (chat route unaffected). */
  workerDisabledBackends: Schema.array(Schema.union(WORKER_BACKENDS)).default([]).volatile(),
  /** Per-backend executable override (falls back to `opencodePath` / the backend name). */
  workerBackendPaths: Schema.dict(Schema.string()).default({}).volatile(),
  /** Per-backend default model id. */
  workerBackendModels: Schema.dict(Schema.string()).default({}).volatile(),
  /** Per-backend default reasoning effort. */
  workerBackendEfforts: Schema.dict(Schema.string()).default({}).volatile(),
  /** Per-backend default execution mode. */
  workerBackendModes: Schema.dict(Schema.string()).default({}).volatile(),
  /**
   * backend -> already-mounted subagent provider name. When that provider is
   * registered the worker reports `provider-mounted` and spawns nothing. Empty
   * by default: the batch shape stays available while the provider is mounted.
   */
  yieldToProviders: Schema.dict(Schema.string()).default({}).volatile(),
  // ---- subagent surface (merged from @nolit/dsh-subagent-opencode) --------
  /** Delegation provider. false leaves the chat route and CLI worker intact. */
  subagent: Schema.boolean().default(true).volatile(),
  /** Registry name the delegation tool binds to. */
  subagentProviderName: Schema.string().default('opencode').volatile(),
  /** Wall-clock limit for one delegation (ms). */
  subagentTimeoutMs: Schema.number().default(900000).volatile(),
  /** Grace period before a delegation child is terminated (ms). */
  subagentDisposeGraceMs: Schema.number().default(5000).volatile(),
  /** Extra environment variables for the delegation child. */
  subagentEnv: Schema.dict(Schema.string()).default({}).volatile(),
})

/**
 * EMERGENCY FALLBACK ONLY — spawn `opencode run` once, collect bounded
 * stdout/stderr, then (best effort) over-fetch authoritative token usage from
 * `opencode session export`.
 *
 * A bare process is invisible to the harness: it gets no DSH session, no
 * lineage, and no catalog row (the owner-observed "그룹 없음" leak). The default
 * delegation path is a managed child session (`startChildSession`); this
 * function is reachable only when `DSH_OPENCODE_SPAWN_FALLBACK=1` is set
 * explicitly, and every result it produces is labelled as fallback work.
 */
export async function runOpencode(ctx, config, options) {
  const env = forwardedEnv(config.forwardEnv.get())
  const executable = await ctx.subprocess.resolveExecutable(config.opencodePath.get(), env, options.signal)
  const timeoutMs = options.timeoutMs ?? config.timeoutMs.get()
  const argv = [
    executable,
    ...buildRunArgv({
      model: options.model ?? config.model.get(),
      agent: options.agent ?? config.agent.get(),
      auto: options.auto ?? config.auto.get(),
      session: options.session,
      continueLast: options.continueLast,
      thinking: options.thinking ?? config.thinking.get(),
      title: options.title ?? config.title.get(),
      files: options.files,
      format: 'json',
      extraArgs: stripUnsupportedFlags(config.extraArgs.get()),
    }),
  ]
  const timeout = AbortSignal.timeout(timeoutMs)
  const signal = options.signal ? AbortSignal.any([options.signal, timeout]) : timeout
  const maxBytes = config.maxOutputBytes.get()
  const handle = ctx.subprocess.spawn({
    argv,
    cwd: options.cwd,
    stdio: {
      // The prompt goes to stdin, never argv: a single argv string is capped at
      // 128 KiB (MAX_ARG_STRLEN) and a flattened transcript exceeds it.
      stdin: 'pipe',
      stdout: { maxBytes },
      stderr: { maxBytes },
    },
    graceMs: 10000,
    signal,
    env,
  })
  // Reclaimable fallback: a bare process is exactly the orphan this registry
  // exists for, so the handle is tracked before anything else can fail.
  // `ownerSession` is the DSH Session (not `options.session`, which is the
  // OpenCode conversation id).
  let release = () => {}
  if (typeof options.track === 'function' && options.ownerSession !== undefined && options.ownerSession !== null) {
    try {
      const registered = options.track(options.ownerSession, handle, 'opencode fallback')
      if (typeof registered === 'function') release = registered
    } catch {
      // A registry that cannot accept the handle must not fail the run.
    }
  }
  const promptDelivered = sendPrompt(handle, options.prompt)
  let outcome
  try {
    outcome = await handle.done
  } finally {
    release()
  }
  const rawStdout = handle.collected.stdout?.readFrom(0)
  const stderr = handle.collected.stderr?.readFrom(0)
  const timedOut = timeout.aborted
  const parser = new JsonRunParser()
  const summary = parser.finish({ buffer: rawStdout?.text ?? '' })
  const stdout = summary.sawEvents ? summary.text : rawStdout?.text ?? ''
  const deliveryErrors = promptDelivered ? '' : 'prompt could not be delivered: no stdin pipe'
  const eventErrors = [deliveryErrors, summary.errors.length ? `opencode errors: ${summary.errors.join('; ')}` : '']
    .filter(Boolean)
    .join('; ')
  const stderrParts = [stderr?.text ?? '', eventErrors].filter(Boolean)

  // v2 emits no usage on the run stream: `session export` is the authoritative
  // source. Failing to fetch keeps the upstream 0 defaults rather than inventing
  // characters/4 heuristics.
  let usage = null
  const exportTimeoutMs = config.exportTimeoutMs?.get?.() ?? 60000
  if (summary.sessionId && exportTimeoutMs > 0) {
    usage = await fetchUsage({
      ctx,
      opencodePath: config.opencodePath.get(),
      sessionId: summary.sessionId,
      env,
      cwd: options.cwd,
      timeoutMs: exportTimeoutMs,
      signal: options.signal,
    })
    // Never fabricate: if the export failed, fall back to whatever the run
    // stream's `step_finish` reported. On v2 that is a per-step total, and
    // 0/0 for a tool-free run.
    if (!usage && (summary.inputTokens || summary.outputTokens)) {
      usage = {
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        reasoningTokens: 0,
        cacheReadTokens: 0,
        cacheWriteTokens: 0,
        totalTokens: summary.inputTokens + summary.outputTokens,
      }
    }
  }

  return {
    ok: !timedOut && promptDelivered && outcome.exitCode === 0 && summary.errors.length === 0,
    exitCode: outcome.exitCode ?? -1,
    signal: outcome.signal ?? '',
    timedOut,
    truncated: Boolean(rawStdout?.lossy || stderr?.lossy),
    sessionId: summary.sessionId,
    inputTokens: usage ? usage.inputTokens : summary.inputTokens,
    outputTokens: usage ? usage.outputTokens : summary.outputTokens,
    stdout,
    stderr: stderrParts.filter(Boolean).join('\n'),
    // Presentation-only extras; NOT part of the output schema (see renderResult).
    usage,
    // Reasoning text shown by `/ocode`; the tool output schema keeps it out.
    reasoning: summary.reasoning ?? '',
  }
}

/**
 * Run `opencode models` and return its text.
 * @param {object} ctx - host context exposing `subprocess`.
 * @param {object} config - plugin config with reactive getters.
 * @param {string} cwd - absolute working directory.
 * @returns {Promise<{ok: boolean, text: string}>} the listing, or a diagnostic.
 */
export async function listOpencodeModels(ctx, config, cwd) {
  const env = forwardedEnv(config.forwardEnv.get())
  try {
    const executable = await ctx.subprocess.resolveExecutable(config.opencodePath.get(), env)
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
    return { ok: false, text: `cannot list opencode models: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** Usage text for the user-run `/ocode` command (managed child-session mode). */
const OCODE_USAGE = [
  'Usage: /ocode <task>',
  '       /ocode models',
  '',
  'Starts a managed OpenCode child session and returns its id immediately; the',
  'result arrives later as a completion notice. The route comes from the plugin',
  'config. `--model`, `--timeout` and `--json` are accepted only by the',
  'emergency bare-process fallback (DSH_OPENCODE_SPAWN_FALLBACK=1).',
  '',
  '  models              list the opencode models available to this account',
  '  --help              show this usage',
].join('\n')

/**
 * Split a command input into leading options and the remaining task text.
 * @param {string} raw - text after the command name.
 * @returns {{options: Record<string, string|boolean>, task: string, unknown: string[]}} parsed input.
 */
export function parseOcodeInput(raw) {
  const text = String(raw ?? '').trim()
  const options = {}
  const unknown = []
  let rest = text
  const valueFlags = new Set(['model', 'timeout'])
  const boolFlags = new Set(['json', 'help', 'models'])

  while (rest.startsWith('--')) {
    const match = /^--([a-zA-Z-]+)(?:=(\S*))?\s*/.exec(rest)
    if (!match) break
    const [, flag, inline] = match
    rest = rest.slice(match[0].length)
    if (boolFlags.has(flag)) {
      options[flag] = true
      continue
    }
    if (!valueFlags.has(flag)) {
      unknown.push(flag)
      rest = `--${flag}${inline === undefined ? '' : `=${inline}`} ${rest}`.trim()
      break
    }
    if (inline !== undefined) {
      options[flag] = inline
      continue
    }
    const valueMatch = /^(\S+)\s*/.exec(rest)
    if (!valueMatch) break
    options[flag] = valueMatch[1]
    rest = rest.slice(valueMatch[0].length)
  }

  return { options, task: rest.trim(), unknown }
}

/** One-line token summary. */
export function formatUsage(usage) {
  if (!usage) return ''
  return [
    'usage:',
    `input ${usage.inputTokens}`,
    `output ${usage.outputTokens}`,
    `reasoning ${usage.reasoningTokens}`,
    `cache read ${usage.cacheReadTokens}`,
    `cache write ${usage.cacheWriteTokens}`,
    `total ${usage.totalTokens}`,
  ].join(' ')
}

/**
 * Model-facing text. `usage` is stripped back out first: the canonical value
 * carries it for the renderer, but the schema is additionalProperties:false.
 */
export function renderResult(result) {
  const head = result.timedOut
    ? 'opencode timed out and was terminated.'
    : result.ok
      ? 'opencode finished successfully.'
      : `opencode exited with code ${result.exitCode}${result.signal ? ` (signal ${result.signal})` : ''}.`
  const meta = result.sessionId ? `\n[session: ${result.sessionId} — pass as "session" to continue]` : ''
  const usageLine = result.usage ? `\n[${formatUsage(result.usage)}]` : ''
  const tail = result.truncated ? '\n[output truncated — tail shown]' : ''
  const body = result.stdout || '(no output)'
  const err = result.stderr ? `\n\n--- stderr ---\n${result.stderr}` : ''
  return `${head}${meta}${usageLine}\n\n${body}${err}${tail}`
}

/** The canonical tool value: exactly the upstream key set, no extras. */
export function toOutput(result) {
  return {
    ok: result.ok,
    exitCode: result.exitCode,
    signal: result.signal,
    timedOut: result.timedOut,
    truncated: result.truncated,
    sessionId: result.sessionId ?? '',
    inputTokens: result.inputTokens ?? 0,
    outputTokens: result.outputTokens ?? 0,
    stdout: result.stdout ?? '',
    stderr: result.stderr ?? '',
  }
}

const DESCRIPTION =
  'Start a managed OpenCode child session for one independent task and return its session id immediately. '
  + 'The child runs on the plugin-configured route and its result arrives later as a completion notice, so continue with other work instead of waiting. '
  + 'Only "prompt", "cwd" and "title" are honored per call; configure model/agent/thinking/auto in the plugin config. '
  + 'The child is a real DSH session with this conversation as its parent (no orphan process).'

/** Parameter map, upstream-compatible plus the v2-only additions. */
export function parameters() {
  return {
    prompt: {
      type: 'string',
      required: true,
      description: 'The task for OpenCode, written self-contained — it does not see this conversation.',
    },
    cwd: {
      type: 'string',
      description: 'Working directory for the OpenCode session. Defaults to the current directory.',
    },
    model: {
      type: 'string',
      description: `Not honored per call in managed child-session mode (the child runs on the configured route, currently ${DEFAULT_MODEL}); supplying it is rejected. Set the plugin's model config instead.`,
    },
    agent: {
      type: 'string',
      description: 'Not honored per call in managed child-session mode; configure it in the plugin config.',
    },
    session: {
      type: 'string',
      description: 'Not supported in managed child-session mode: the child session is created by the harness, not continued from an OpenCode id.',
    },
    continueLast: {
      type: 'boolean',
      description: 'Not supported in managed child-session mode: each delegation is a fresh managed child.',
    },
    auto: {
      type: 'boolean',
      description: 'Not honored per call in managed child-session mode; configure it in the plugin config.',
    },
    thinking: {
      type: 'boolean',
      description: 'Not honored per call in managed child-session mode; configure it in the plugin config.',
    },
    title: {
      type: 'string',
      description: 'Short label for the child session in the catalog (defaults to the first line of the prompt).',
    },
    files: {
      type: 'array',
      items: { type: 'string' },
      description: 'Not supported in managed child-session mode; attach paths inside the prompt instead.',
    },
    timeoutMs: {
      type: 'number',
      description: 'Not honored per call in managed child-session mode; configure it in the plugin config.',
    },
  }
}

/**
 * The canonical output declaration; keys are frozen by dsh-tools.
 *
 * `kind: 'activation'` is the normal path and carries the managed child id.
 * `kind: 'fallback'` appears only under the explicit emergency env switch; it
 * carries the legacy report in `summary` and an empty child id, so a consumer
 * can never mistake fallback work for a managed child session.
 */
export function outputSchema() {
  return {
    type: 'object',
    properties: {
      kind: { type: 'string', required: true, enum: ['activation', 'fallback'] },
      subagentId: { type: 'string', required: true },
      provider: { type: 'string', required: true },
      summary: { type: 'string', required: true },
    },
    additionalProperties: false,
  }
}

/**
 * Model-facing text for one tool value: the started child id, or the labelled
 * emergency-fallback report.
 * @param {{kind: string, subagentId: string, summary: string}} value - the canonical value.
 * @returns {string} the rendered text.
 */
export function renderActivation(value) {
  if (value.kind === 'fallback') return fallbackText(value.summary)
  return activationText({ provider: value.provider, childId: value.subagentId })
}

/**
 * Plugin body: register the `opencode` tool, and `/opencode` when a commands
 * service is composed. All registrations are effects — unloading the plugin
 * reverts them automatically.
 */
export async function apply(ctx, config) {
  // The subagent service is optional and is acquired later through `ctx.inject`
  // (a Cordis context throws on an undeclared service read). Keeping the
  // acquired handle here lets the tool and command decide between a managed
  // child session and the explicit refusal — never an untracked spawn.
  let subagents = null

  // The router's CLI dispatch control plane, when this plugin is mounted by
  // @nolit/dsh-custom-router. Acquired through `ctx.inject` like every other
  // service here: a child's plain `ctx.get()` cannot see a service its parent
  // fiber provided (measured 2026-11-08), and a standalone mount never gets it.
  let dispatch = null

  // Surface gates (2026-11-07, unified with dsh-antigravity): `enabled` is the
  // master, `cli` gates the delegation tool + `/ocode` + `cli_worker`, and
  // `subagent` keeps owning only the delegation provider. Registration happens
  // once at load, so a settings change applies on the next plugin load.
  const cfg = (key, fallback) => {
    const entry = config?.[key]
    if (entry !== null && typeof entry === 'object' && typeof entry.get === 'function') {
      const value = entry.get()
      return value === undefined ? fallback : value
    }
    return entry === undefined ? fallback : entry
  }
  const masterOn = cfg('enabled', true) !== false
  const cliOn = masterOn && cfg('cli', true) !== false

  // Resolved lazily so the module stays importable (and unit-testable)
  // without the host toolchain installed; the host always provides it.
  const { defineTool } = await import('@deepseek-ai/dsh-tools')
  const opencodeTool = defineTool({
    name: 'opencode',
    description: DESCRIPTION,
    parameters: parameters(),
    output: {
      schema: outputSchema(),
      render: (_args, value) => [{ type: 'text', text: renderActivation(value) }],
    },
    async execute(args, exec) {
      const providerName = providerNameOf(config)
      // With the managed path available, per-call overrides are refused rather
      // than silently dropped: the child runs on the configured route.
      if (subagents !== null) {
        const unsupported = unsupportedChildArgs(args)
        if (unsupported.length > 0) {
          throw new Error(
            'opencode delegation runs as a managed child session on the plugin-configured route; '
            + `per-call ${unsupported.map((name) => '"' + name + '"').join(', ')} cannot be honored. `
            + 'Configure model/agent/thinking/auto in the plugin config, or call the tool without them.',
          )
        }
        const started = await startChildSession({
          subagents,
          providerName,
          label: activationLabel({ title: args.title, prompt: args.prompt }),
          prompt: args.prompt,
          parent: exec.agent,
          cwd: args.cwd,
          signal: exec.signal,
        })
        return { kind: 'activation', subagentId: started.childId, provider: started.provider, summary: '' }
      }
      // No managed child is possible. Only the explicit emergency switch may
      // spawn a bare process; otherwise refuse with an actionable message.
      if (!fallbackEnabled()) {
        throw new Error(unavailableMessage(providerName))
      }
      const result = await runOpencode(ctx, config, {
        prompt: args.prompt,
        cwd: args.cwd ?? process.cwd(),
        ownerSession: exec?.agent?.session,
        track: dispatch?.track,
        model: args.model,
        agent: args.agent,
        session: args.session,
        continueLast: args.continueLast,
        auto: args.auto,
        thinking: args.thinking,
        title: args.title,
        files: args.files,
        timeoutMs: args.timeoutMs,
        signal: exec.signal,
      })
      const withUsage = result.usage
        ? { ...result, stderr: [result.stderr, formatUsage(result.usage)].filter(Boolean).join('\n') }
        : result
      return { kind: 'fallback', subagentId: '', provider: providerName, summary: renderResult(toOutput(withUsage)) }
    },
    presentResult: (_args, result) => ({
      card: 'generic',
      title: 'opencode',
      content: result.content,
    }),
  })

  // Conflict guard: a second live row (e.g. the legacy @quonaro plugin) may
  // already own the `opencode` tool name. The host throws on duplicate tool
  // registration, which would abort the whole plugin row; yield the tool and
  // keep the commands/worker half usable instead.
  const existing = cliOn && typeof ctx?.tools?.get === 'function' ? ctx.tools.get('opencode') : undefined
  if (!cliOn) {
    // CLI surface switched off by `enabled`/`cli`: the tool and `/ocode` are absent.
  } else if (existing) {
    ctx?.logger?.warn?.(
      'dsh-opencode-v2: tool "opencode" is already registered by another plugin; '
      + 'skipping tool registration (commands and cli_worker still load).',
    )
  } else {
    try {
      ctx.tools.register(opencodeTool)
    } catch (error) {
      ctx?.logger?.warn?.(
        `dsh-opencode-v2: tool "opencode" registration failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }

  // The router's dispatch seam. Deferred, exactly like `subagents`: it is
  // provided by the router row during that row's own apply, so an eager read at
  // plugin load sees nothing.
  ctx.inject(['customRouter'], (scoped) => {
    dispatch = scoped.customRouter?.cliDispatch ?? null
    return () => {
      dispatch = null
    }
  })

  ctx.inject(['commands'], (commandCtx) => {
    if (!cliOn) return
    commandCtx.commands.register({
      name: 'ocode',
      input: { hint: '<task>   (/ocode models lists the catalog)' },
      description:
        'Start a managed OpenCode child session for one task. Usage: /ocode <task>. The result arrives as a completion notice; /ocode models lists the catalog and /ocode --help shows the usage.',
      handler: async ({ rawInput, agent, signal }) => {
        const { options, task, unknown } = parseOcodeInput(rawInput)
        if (unknown.length > 0) return { kind: 'error', text: `Unknown option: --${unknown[0]}\n\n${OCODE_USAGE}` }
        if (task === 'models' || options.models) {
          const listing = await listOpencodeModels(ctx, config, process.cwd())
          return { kind: listing.ok ? 'success' : 'error', text: listing.text || '(no models reported)' }
        }
        if (task === '' || options.help) {
          const saved = await readSelection('ocode')
          const model = saved.model ?? config.model.get()
          return {
            kind: 'success',
            text: `${OCODE_USAGE}\n\nCurrent: model ${model}\nModel list: \`opencode models\``,
          }
        }
        const providerName = providerNameOf(config)
        // Managed child session: the route is the provider's configured one, so
        // per-run overrides are refused instead of silently ignored.
        if (subagents !== null) {
          const rejected = []
          if (options.model !== undefined) rejected.push('--model')
          if (options.timeout !== undefined) rejected.push('--timeout')
          if (options.json) rejected.push('--json')
          if (rejected.length > 0) {
            return {
              kind: 'error',
              text: 'Child-session mode runs on the plugin-configured OpenCode route, so '
                + `${rejected.join(', ')} cannot be honored here. Set the route in the plugin config, `
                + 'or keep using /ocode models to inspect the available models.',
            }
          }
          const started = await startChildSession({
            subagents,
            providerName,
            label: activationLabel({ prompt: task }),
            prompt: task,
            parent: agent,
            signal,
          })
          return { kind: 'success', text: activationText(started) }
        }
        // No managed child is possible: the explicit emergency switch is the
        // only path that may spawn a bare process.
        if (!fallbackEnabled()) {
          return { kind: 'error', text: unavailableMessage(providerName) }
        }
        const saved = await readSelection('ocode')
        const model = String(options.model ?? saved.model ?? config.model.get())
        const timeoutMs = options.timeout === undefined ? undefined : Number(options.timeout)
        if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
          return { kind: 'error', text: `Invalid --timeout "${options.timeout}". Use milliseconds.` }
        }
        const result = await runOpencode(ctx, config, {
          prompt: task,
          cwd: process.cwd(),
          ownerSession: agent?.session,
          track: dispatch?.track,
          model,
          timeoutMs,
        })
        if (result.exitCode >= 0) await writeSelection('ocode', { model }).catch(() => {})
        const body = renderResult(result)
        const reasoning = result.reasoning ? `\n\n--- reasoning ---\n${result.reasoning}` : ''
        const raw = options.json ? `\n\n--- raw ---\n${JSON.stringify(result, null, 2)}` : ''
        return { kind: result.ok ? 'success' : 'error', text: fallbackText(`${body}${reasoning}${raw}`) }
      },
    })
  })

  // The isolated batch worker ships with the same plugin. It belongs to the CLI
  // surface, so `enabled`/`cli` gate it alongside the tool and `/ocode`.
  if (cliOn) await registerCliWorker(ctx, config, dispatch)

  // Subagent delegation provider, merged from @nolit/dsh-subagent-opencode
  // (2026-11-05) so one package owns every OpenCode surface. Gated on its own
  // switch: a profile that wants only the chat route can turn delegation off.
  // The subagent surface was merged from @nolit/dsh-subagent-opencode, but
  // reading the `subagents` service without declaring it THROWS on a real Cordis host.
  // `optionalService` swallowed that throw, so the merged provider never
  // registered while the old package's provider shadowed it — the merge looked
  // done and was not. Acquire the service through a deferred sub-context and
  // register there; the disposer releases it with the plugin.
  ctx.inject(['subagents'], (scoped) => {
    const service = scoped.subagents
    subagents = service
    const clear = () => {
      if (subagents === service) subagents = null
    }
    if (!masterOn || config.subagent.get() === false) return clear
    const providerName = config.subagentProviderName.get() || 'opencode'
    // A profile that still carries the superseded package must not lose a
    // provider silently: yield with a warning so the operator removes the old
    // row, which is the real fix.
    const taken = typeof service.getProvider === 'function' ? service.getProvider(providerName) : undefined
    if (taken) {
      ctx.logger?.warn?.('opencode-v2: a subagent provider named "' + providerName + '" is already registered; skipping the merged one (remove @nolit/dsh-subagent-opencode)')
      return clear
    }
    try {
      // The CLI child spends on the same account as the HTTP route, so its
      // usage feeds the SAME persisted ledger the cost pill reads. The shared
      // instance prevents the two rows from clobbering each other's snapshot.
      const cliLedger = sharedCostLedger('opencode-http-agent', {
        store: createCostStore({
          profileDir: ctx?.get?.('profileContext')?.dir,
          dshHome: process.env.DSH_HOME,
        }),
      })
      const provider = new OpenCodeSubagentProvider(providerName, ctx, {
        opencodePath: config.opencodePath.get(),
        model: config.model.get(),
        agent: config.agent.get(),
        auto: config.auto.get(),
        timeoutMs: config.subagentTimeoutMs.get(),
        disposeGraceMs: config.subagentDisposeGraceMs.get(),
        env: config.subagentEnv.get(),
        // Router control plane: refuse a restricted session before any argv is
        // built, and keep the handle reclaimable if that session is torn down
        // mid-run. Both are absent under a standalone (non-router) mount.
        // Pass the identity through UNWRAPPED: the provider already hands the
        // parent Agent, and the router's `gate` normalizes Agent-or-Session
        // itself. Wrapping it a second time here produced `{agent:{session:Agent}}`,
        // which normalized to `undefined` and silently ALLOWED a restricted
        // session (measured regression, 2026-11-08).
        gate: (subject) => dispatch?.gate?.(subject),
        track: (session, handle, label) => dispatch?.track?.(session, handle, label),
        // One row per completed CLI run: the wire reports `step_finish` steps,
        // never estimated_cost, so this is a token-only record (costUsd null).
        recordUsage: ({ usage, model }) => {
          if (usage === null || typeof usage !== 'object') return
          const tokens = {
            input: usage.input ?? 0,
            output: usage.output ?? 0,
            reasoning: usage.reasoning ?? 0,
            cache_read: usage.cacheRead ?? 0,
            cache_write_5m: 0,
            cache_write_1h: 0,
          }
          cliLedger.record(undefined, model, parseCost({ opencode: { tokens } }))
        },
      })
      const release = service.registerProvider(provider)
      return () => {
        clear()
        if (typeof release === 'function') release()
      }
    } catch (error) {
      ctx.logger?.warn?.(`opencode-v2: subagent provider registration failed: ${error instanceof Error ? error.message : String(error)}`)
      return clear
    }
  })
}
