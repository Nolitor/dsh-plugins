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
 */
import Schema from '@deepseek-ai/schemastery'

import { JsonRunParser, buildRunArgv, fetchUsage, forwardedEnv, sendPrompt, stripUnsupportedFlags } from './shared.js'
import { readSelection, writeSelection } from './selection.js'
import { WORKER_BACKENDS } from './workers/backends.js'
import { registerCliWorker } from './workers/index.js'

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

/** Default `-m` route. Must be an `opencode/...` route: v2 knows those; never leave it bare. */
export const DEFAULT_MODEL = 'opencode/deepseek-v4.1-flash-free'

/** Schemastery schema: defaults live here; cordis.yml and GUI edits are validated against it. */
export const Config = Schema.object({
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
})

/**
 * Spawn `opencode run` once, collect bounded stdout/stderr, then (best effort)
 * over-fetch authoritative token usage from `opencode session export`.
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
  const promptDelivered = sendPrompt(handle, options.prompt)
  const outcome = await handle.done
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

/** Usage text for the user-run `/ocode` command. */
const OCODE_USAGE = [
  'Usage: /ocode [options] <task>',
  '',
  'Options:',
  '  --model <route>     provider/model#variant (default: the last selected route)',
  '  --timeout <ms>      hard budget for this call',
  '  --json              append the raw result',
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
  const boolFlags = new Set(['json', 'help'])

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
  'Delegate a task to the OpenCode agent (`opencode run`, headless). OpenCode works autonomously in the given directory and its final answer is returned as text. Prefer this for self-contained chunks of work you want a second agent to own end-to-end. The call blocks until OpenCode finishes or the configured timeout fires.'

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
      description: `Model override in provider/model form (e.g. "opencode/deepseek-v4.1-flash-free"). Defaults to the plugin config value (${DEFAULT_MODEL}).`,
    },
    agent: {
      type: 'string',
      description: 'OpenCode sub-agent to run (e.g. "build", "plan"). Defaults to the plugin config value.',
    },
    session: {
      type: 'string',
      description: 'Continue an existing OpenCode session by id (ses_…) instead of starting a new one.',
    },
    continueLast: {
      type: 'boolean',
      description: 'Continue the most recent OpenCode session in cwd. Ignored when session is set.',
    },
    auto: {
      type: 'boolean',
      description: 'Auto-approve permission requests (--auto). Headless runs cannot answer prompts; the default comes from plugin config.',
    },
    thinking: {
      type: 'boolean',
      description: 'Ask OpenCode to emit reasoning (--thinking). The summary reports that reasoning was produced; the full reasoning text is streamed by the opencode-agent provider route.',
    },
    title: {
      type: 'string',
      description: 'Session title for the new OpenCode session (--title).',
    },
    files: {
      type: 'array',
      items: { type: 'string' },
      description: 'File paths to attach to the run (-f/--file). Repeatable.',
    },
    timeoutMs: {
      type: 'number',
      description: 'Timeout in milliseconds for this call. Defaults to the plugin config value.',
    },
  }
}

/** The canonical output declaration; keys are frozen by dsh-tools. */
export function outputSchema() {
  return {
    type: 'object',
    properties: {
      ok: { type: 'boolean', required: true },
      exitCode: { type: 'integer', required: true },
      signal: { type: 'string', required: true },
      timedOut: { type: 'boolean', required: true },
      truncated: { type: 'boolean', required: true },
      sessionId: { type: 'string', required: true },
      inputTokens: { type: 'integer', required: true },
      outputTokens: { type: 'integer', required: true },
      stdout: { type: 'string', required: true },
      stderr: { type: 'string', required: true },
    },
    additionalProperties: false,
  }
}

/**
 * Plugin body: register the `opencode` tool, and `/opencode` when a commands
 * service is composed. All registrations are effects — unloading the plugin
 * reverts them automatically.
 */
export async function apply(ctx, config) {
  // Resolved lazily so the module stays importable (and unit-testable)
  // without the host toolchain installed; the host always provides it.
  const { defineTool } = await import('@deepseek-ai/dsh-tools')
  ctx.tools.register(
    defineTool({
      name: 'opencode',
      description: DESCRIPTION,
      parameters: parameters(),
      output: {
        schema: outputSchema(),
        // The canonical value is the upstream key set; usage rides in stdout's
        // rendered text via the runner's stderr summary + renderResult.
        render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
      },
      async execute(args, exec) {
        const result = await runOpencode(ctx, config, {
          prompt: args.prompt,
          cwd: args.cwd ?? process.cwd(),
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
        // The canonical value may carry only declared keys, so a successful
        // usage fetch is folded into `stderr` (a declared string) and nothing
        // else is added.
        const withUsage = result.usage
          ? { ...result, stderr: [result.stderr, formatUsage(result.usage)].filter(Boolean).join('\n') }
          : result
        return toOutput(withUsage)
      },
      presentResult: (_args, result) => ({
        card: 'generic',
        title: 'opencode',
        content: result.content,
      }),
    }),
  )

  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: 'ocode',
      description:
        'Run the OpenCode CLI worker. Usage: /ocode [--model <provider/model#variant>] [--timeout <ms>] <task>. Bare /ocode reuses the last selected model.',
      handler: async ({ rawInput }) => {
        const { options, task, unknown } = parseOcodeInput(rawInput)
        if (unknown.length > 0) return { kind: 'error', text: `Unknown option: --${unknown[0]}\n\n${OCODE_USAGE}` }
        if (task === '' || options.help) {
          const saved = await readSelection('ocode')
          const model = saved.model ?? config.model.get()
          return {
            kind: 'success',
            text: `${OCODE_USAGE}\n\nCurrent: model ${model}\nModel list: \`opencode models\``,
          }
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
          model,
          timeoutMs,
        })
        if (result.exitCode >= 0) await writeSelection('ocode', { model }).catch(() => {})
        const body = renderResult(result)
        const reasoning = result.reasoning ? `\n\n--- reasoning ---\n${result.reasoning}` : ''
        const raw = options.json ? `\n\n--- raw ---\n${JSON.stringify(result, null, 2)}` : ''
        return { kind: result.ok ? 'success' : 'error', text: `${body}${reasoning}${raw}` }
      },
    })
  })

  // The isolated batch worker ships with the same plugin: one install enables
  // the chat route, the `opencode` delegation tool, and `cli_worker` together.
  await registerCliWorker(ctx, config)
}
