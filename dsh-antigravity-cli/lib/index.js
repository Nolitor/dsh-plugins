/**
 * `@nolit/dsh-antigravity-cli`
 *
 * Two surfaces over the official `agy` CLI:
 *   - `/agy <task>` — the user-run command (primary surface).
 *   - `agy_worker`  — a model-facing tool for delegated one-shot work.
 *
 * Both run one isolated CLI call and report the complete response text. The
 * last model and reasoning level a user picks are persisted and reused.
 */
import Schema from '@deepseek-ai/schemastery'

import { DEFAULT_EFFORT, DEFAULT_MODE, DEFAULT_MODEL, EFFORTS, MODES } from './backends.js'
import { readSelection, writeSelection } from './selection.js'
import { listAgyModels, runAgyWorker } from './worker.js'

/** Host plugin name; must match package.json `name` and the bundle row id. */
export const name = '@nolit/dsh-antigravity-cli'

/** Services required before load: the tool registry and a subprocess provider. */
export const inject = ['tools', 'subprocess']

const FORWARD_ENV_DEFAULT = [
  'PATH',
  'HOME',
  'USER',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'GEMINI_CONFIG_DIR',
  'GOOGLE_APPLICATION_CREDENTIALS',
]

/** Schemastery schema: defaults live here; cordis.yml and GUI edits are validated against it. */
export const Config = Schema.object({
  agyPath: Schema.string().default('agy').volatile(),
  model: Schema.string().default(DEFAULT_MODEL).volatile(),
  effort: Schema.union(EFFORTS).default(DEFAULT_EFFORT).volatile(),
  mode: Schema.union(MODES).default(DEFAULT_MODE).volatile(),
  timeoutMs: Schema.number().default(600000).volatile(),
  // Output is shown in full by default; this bound only stops pathological runs.
  maxOutputBytes: Schema.number().default(8388608).volatile(),
  forwardEnv: Schema.array(Schema.string()).default(FORWARD_ENV_DEFAULT).volatile(),
  extraArgs: Schema.array(Schema.string()).default([]).volatile(),
  artifactLimit: Schema.number().default(100).volatile(),
  workerEnabled: Schema.boolean().default(true).volatile(),
})

const TOOL_NAME = 'agy_worker'
const COMMAND_NAME = 'agy'

const DESCRIPTION =
  'Run a one-shot Antigravity (agy) CLI worker. The worker sees only the task text you pass, never this conversation, and returns its final message plus any collected artifacts. Use it for self-contained build, test, or edit jobs that should not stream into the chat.'

const USAGE = [
  'Usage: /agy [options] <task>',
  '       /agy models',
  '',
  'Options:',
  '  --model <id>        agy model id (default: the last selected model)',
  '  --effort <level>    low | medium | high | xhigh | max',
  '  --mode <mode>       accept-edits | auto | plan (default: accept-edits)',
  '  --timeout <ms>      hard budget for this call',
  '  --json              append the raw JSON envelope',
  '  --models            list the agy models available to this account',
  '  --help              show this usage',
].join('\n')

/**
 * Split a command input into leading options and the remaining task text.
 *
 * Options are consumed only before the first bare token so a task containing
 * `--` sequences is preserved verbatim.
 * @param {string} raw - text after the command name.
 * @returns {{options: Record<string, string|boolean>, task: string, unknown: string[]}} parsed input.
 */
export function parseCommandInput(raw) {
  const text = String(raw ?? '').trim()
  const options = {}
  const unknown = []
  let rest = text
  const valueFlags = new Set(['model', 'effort', 'mode', 'timeout'])
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
      // Unknown flag: stop consuming options so the text stays intact.
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

/**
 * Model-facing text for one worker result.
 * @param {object} result - canonical worker result.
 * @returns {string} rendered report.
 */
export function renderResult(result) {
  const head = result.timedOut
    ? `agy timed out and was terminated. (mode ${result.mode})`
    : result.ok
      ? `agy finished. (mode ${result.mode})`
      : `agy exited with code ${result.exitCode}${result.signal ? ` (signal ${result.signal})` : ''}. (mode ${result.mode})`
  const plan = result.planOnly ? '\n[PLAN_ONLY — no files changed] showing the plan/reasoning result only.' : ''
  const usage = `\n[tokens: input ${result.inputTokens}, output ${result.outputTokens}, thinking ${result.thinkingTokens}, cached ${result.cacheReadTokens}]`
  const reasoningNote = result.thinkingTokens > 0
    ? `\n[reasoning: agy reported ${result.thinkingTokens} thinking tokens but does not emit reasoning text]`
    : ''
  const files = result.artifacts.length
    ? `\n[artifacts]\n${result.artifacts.map((file) => `${file.path} (${file.bytes} B, sha256 ${file.sha256.slice(0, 12)}…)`).join('\n')}`
    : ''
  const missing = result.missing?.length ? `\n[no match for: ${result.missing.join(', ')}]` : ''
  const skipped = result.skipped ? `\n[${result.skipped} artifact(s) dropped by the collection limit]` : ''
  const truncated = result.truncated ? '\n[output truncated — increase maxOutputBytes]' : ''
  const body = result.summary || '(no output)'
  const error = result.stderrTail ? `\n\n--- stderr ---\n${result.stderrTail}` : ''
  return `${head}${plan}${usage}${reasoningNote}${files}${missing}${skipped}${truncated}\n\n${body}${error}`
}

/**
 * Parameter map for the model-facing tool.
 * @param {object} config - plugin config supplying defaults.
 * @returns {Record<string, object>} parameter schema.
 */
function workerParameters(config) {
  return {
    task: {
      type: 'string',
      required: true,
      description:
        'The complete instruction for the worker. It does not see this conversation, so include every path and constraint it needs.',
    },
    cwd: {
      type: 'string',
      required: true,
      description: 'Absolute directory the worker may modify. A worker never inherits an implicit working directory.',
    },
    model: {
      type: 'string',
      description: `agy model id. Defaults to the plugin config value (${config.model.get()}).`,
    },
    effort: {
      type: 'string',
      enum: [...EFFORTS],
      description: `Reasoning effort. Defaults to the plugin config value (${config.effort.get()}).`,
    },
    mode: {
      type: 'string',
      enum: [...MODES],
      description: `Execution mode. Defaults to the plugin config value (${config.mode.get()}).`,
    },
    timeoutMs: {
      type: 'number',
      description: 'Hard budget in milliseconds. Defaults to the plugin config value.',
    },
    collect: {
      type: 'array',
      items: { type: 'string' },
      description: 'Glob patterns (relative to cwd) whose matches are returned as hashed artifacts.',
    },
  }
}

/** Output declaration for the canonical tool value. */
function workerOutputSchema() {
  return {
    type: 'object',
    properties: {
      ok: { type: 'boolean', required: true },
      exitCode: { type: 'integer', required: true },
      signal: { type: 'string', required: true },
      timedOut: { type: 'boolean', required: true },
      truncated: { type: 'boolean', required: true },
      summary: { type: 'string', required: true },
      conversationId: { type: 'string', required: true },
      status: { type: 'string', required: true },
      mode: { type: 'string', required: true },
      planOnly: { type: 'boolean', required: true },
      inputTokens: { type: 'integer', required: true },
      outputTokens: { type: 'integer', required: true },
      thinkingTokens: { type: 'integer', required: true },
      cacheReadTokens: { type: 'integer', required: true },
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
    additionalProperties: false,
  }
}

/**
 * Register the model-facing `agy_worker` tool.
 * @param {object} ctx - host context.
 * @param {object} config - plugin config.
 * @returns {Promise<void>} resolves after registration.
 */
export async function registerAgyWorker(ctx, config) {
  if (!config.workerEnabled.get()) return
  const { defineTool } = await import('@deepseek-ai/dsh-tools')
  ctx.tools.register(
    defineTool({
      name: TOOL_NAME,
      description: DESCRIPTION,
      parameters: workerParameters(config),
      output: {
        schema: workerOutputSchema(),
        render: (_args, value) => [{ type: 'text', text: renderResult(value) }],
      },
      async execute(args, exec) {
        return runAgyWorker(ctx, config, {
          prompt: args.task,
          cwd: args.cwd,
          model: args.model,
          effort: args.effort,
          mode: args.mode,
          timeoutMs: args.timeoutMs,
          collect: args.collect,
          signal: exec.signal,
        })
      },
      presentResult: (_args, result) => ({
        card: 'generic',
        title: `agy · ${result.mode}`,
        content: renderResult(result),
      }),
    }),
  )
}

/**
 * Register the user-run `/agy` command.
 * @param {object} ctx - host context.
 * @param {object} config - plugin config.
 * @returns {Promise<void>} resolves after registration.
 */
export async function registerAgyCommand(ctx, config) {
  ctx.inject(['commands'], (commandCtx) => {
    commandCtx.commands.register({
      name: COMMAND_NAME,
      input: { hint: '<task>   (--model <id> --effort <level> --mode <mode>)' },
      description:
        'Run the Antigravity CLI worker. Usage: /agy [--model <id>] [--effort <level>] [--mode <mode>] <task>. Bare /agy reuses the last selected model.',
      handler: async ({ rawInput }) => {
        const { options, task, unknown } = parseCommandInput(rawInput)

        if (unknown.length > 0) {
          return { kind: 'error', text: `Unknown option: --${unknown[0]}\n\n${USAGE}` }
        }

        if (task === '' || task === 'models' || options.models || options.help) {
          if (task === 'models' || options.models) {
            const listing = await listAgyModels(ctx, config, process.cwd())
            return { kind: listing.ok ? 'success' : 'error', text: listing.text || '(no models reported)' }
          }
          const saved = await readSelection('agy')
          const current = {
            model: saved.model ?? config.model.get(),
            effort: saved.effort ?? config.effort.get(),
            mode: saved.mode ?? config.mode.get(),
          }
          return {
            kind: 'success',
            text: `${USAGE}\n\nCurrent: model ${current.model}, effort ${current.effort}, mode ${current.mode}\nModel list: \`agy models\``,
          }
        }

        const saved = await readSelection('agy')
        const model = String(options.model ?? saved.model ?? config.model.get())
        const effort = String(options.effort ?? saved.effort ?? config.effort.get())
        const mode = String(options.mode ?? saved.mode ?? config.mode.get())

        if (!EFFORTS.includes(effort)) {
          return { kind: 'error', text: `Unsupported effort "${effort}". Allowed: ${EFFORTS.join(', ')}` }
        }
        if (!MODES.includes(mode)) {
          return { kind: 'error', text: `Unsupported mode "${mode}". Allowed: ${MODES.join(', ')}` }
        }

        const timeoutMs = options.timeout === undefined ? undefined : Number(options.timeout)
        if (timeoutMs !== undefined && (!Number.isFinite(timeoutMs) || timeoutMs <= 0)) {
          return { kind: 'error', text: `Invalid --timeout "${options.timeout}". Use milliseconds.` }
        }

        const result = await runAgyWorker(ctx, config, {
          prompt: task,
          cwd: process.cwd(),
          model,
          effort,
          mode,
          timeoutMs,
        })

        // Remember the selection only after the call actually ran, so a typo
        // never becomes the new default.
        if (result.exitCode >= 0) {
          await writeSelection('agy', { model, effort, mode }).catch(() => {})
        }

        const body = renderResult(result)
        const raw = options.json ? `\n\n--- raw ---\n${JSON.stringify(result, null, 2)}` : ''
        return { kind: result.ok ? 'success' : 'error', text: `${body}${raw}` }
      },
    })
  })
}

/**
 * Mount both surfaces.
 * @param {object} ctx - host context.
 * @param {object} config - plugin config.
 * @returns {Promise<void>} resolves after registration.
 */
export async function apply(ctx, config) {
  await registerAgyWorker(ctx, config)
  await registerAgyCommand(ctx, config)
}
