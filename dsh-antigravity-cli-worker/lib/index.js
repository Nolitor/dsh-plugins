/**
 * `@nolit/dsh-antigravity-cli-worker`
 *
 * Registers the `agy_worker` tool: one isolated Antigravity (`agy`) CLI call
 * per invocation, defaulting to `gemini-3.8-flash-low` with low thinking effort.
 * The worker sees only the task text passed to it and returns its final message
 * plus any collected artifacts.
 */
import Schema from '@deepseek-ai/schemastery'

import { DEFAULT_EFFORT, DEFAULT_MODEL } from './backends.js'
import { runAgyWorker } from './worker.js'

/** Host plugin name; must match package.json `name` and the bundle row id. */
export const name = '@nolit/dsh-antigravity-cli-worker'

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
  effort: Schema.string().default(DEFAULT_EFFORT).volatile(),
  timeoutMs: Schema.number().default(600000).volatile(),
  maxOutputBytes: Schema.number().default(262144).volatile(),
  forwardEnv: Schema.array(Schema.string()).default(FORWARD_ENV_DEFAULT).volatile(),
  extraArgs: Schema.array(Schema.string()).default([]).volatile(),
  artifactLimit: Schema.number().default(100).volatile(),
  workerEnabled: Schema.boolean().default(true).volatile(),
})

const TOOL_NAME = 'agy_worker'

const DESCRIPTION =
  'Run a one-shot Antigravity (agy) CLI worker. The worker sees only the task text you pass, never this conversation, and returns its final message plus any collected artifacts. Use it for self-contained build, test, or edit jobs that should not stream into the chat.'

/**
 * Parameter map for the tool.
 * @param {object} config - plugin config supplying the default model.
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
      enum: ['low', 'medium', 'high', 'xhigh', 'max'],
      description: `Reasoning effort. Defaults to the plugin config value (${config.effort.get()}).`,
    },
    timeoutMs: {
      type: 'number',
      description: 'Hard budget in milliseconds. Defaults to the plugin config value.',
    },
    collect: {
      type: 'array',
      items: { type: 'string' },
      description: 'Glob patterns (relative to cwd) whose matches are returned as hashed artifacts, e.g. ["dist/**/*.js"].',
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
 * Model-facing text for one worker result.
 * @param {object} result - canonical worker result.
 * @returns {string} rendered report.
 */
export function renderWorkerResult(result) {
  const head = result.timedOut
    ? 'antigravity worker timed out and was terminated.'
    : result.ok
      ? 'antigravity worker finished successfully.'
      : `antigravity worker exited with code ${result.exitCode}.`
  const usage =
    result.inputTokens || result.outputTokens
      ? `\n[tokens: input ${result.inputTokens}, output ${result.outputTokens}, cached ${result.cacheReadTokens}]`
      : ''
  const files = result.artifacts.length
    ? `\n[artifacts]\n${result.artifacts.map((file) => `${file.path} (${file.bytes} B, sha256 ${file.sha256.slice(0, 12)}…)`).join('\n')}`
    : ''
  const missing = result.missing.length ? `\n[no match for: ${result.missing.join(', ')}]` : ''
  const skipped = result.skipped ? `\n[${result.skipped} artifact(s) dropped by the collection limit]` : ''
  const truncated = result.truncated ? '\n[output truncated — tail shown]' : ''
  const body = result.summary || '(no output)'
  const error = result.stderrTail ? `\n\n--- stderr ---\n${result.stderrTail}` : ''
  return `${head}${usage}${files}${missing}${skipped}${truncated}\n\n${body}${error}`
}

/**
 * Register the `agy_worker` tool.
 *
 * Registrations are effects: unloading the plugin reverts it.
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
        render: (_args, value) => [{ type: 'text', text: renderWorkerResult(value) }],
      },
      async execute(args, exec) {
        return runAgyWorker(ctx, config, {
          prompt: args.task,
          cwd: args.cwd,
          model: args.model,
          effort: args.effort,
          timeoutMs: args.timeoutMs,
          collect: args.collect,
          signal: exec.signal,
        })
      },
      presentResult: (_args, result) => ({
        card: 'generic',
        title: 'agy_worker',
        content: renderWorkerResult(result),
      }),
    }),
  )
}

/**
 * Mount the tool.
 * @param {object} ctx - host context.
 * @param {object} config - plugin config.
 * @returns {Promise<void>} resolves after registration.
 */
export async function apply(ctx, config) {
  await registerAgyWorker(ctx, config)
}
