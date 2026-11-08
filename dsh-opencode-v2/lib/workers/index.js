/**
 * The built-in `cli_worker` tool: run one isolated agent CLI (OpenCode, Codex,
 * or Claude Code) as a bounded batch worker and return only its final message
 * plus the artifacts it produced.
 *
 * This module is deliberately part of `@nolit/dsh-opencode-v2` rather than a
 * second package: the HTTP conversation route and the worker tool track the
 * same OpenCode surface and must version together.
 */
import { WORKER_BACKENDS } from './backends.js'
import { runWorker } from './run.js'

const DESCRIPTION =
  'Run a one-shot CLI agent (opencode, codex, or claude) as an isolated batch worker. The worker sees only the task text you pass, never this conversation, and returns its final message plus any collected artifacts. Use it for self-contained build/test/edit jobs that should not stream into the chat.'

/** Default route hint per backend, shown in the `model` parameter description. */
const MODEL_HINTS = Object.freeze({
  opencode: 'provider/model, e.g. "opencode/beam-free"',
  codex: 'model id, e.g. "gpt-5-codex"',
  claude: 'model id, e.g. "sonnet"',
})

/**
 * Parameter map for the tool.
 * @param {object} config - plugin config supplying the default backend.
 * @returns {Record<string, object>} parameter schema.
 */
export function workerParameters(config) {
  return {
    task: {
      type: 'string',
      required: true,
      description: 'The complete instruction for the worker. It does not see this conversation, so include every path and constraint it needs.',
    },
    backend: {
      type: 'string',
      enum: [...WORKER_BACKENDS],
      description: `CLI family to run. Defaults to the plugin config value (${config.workerBackend.get()}). ${MODEL_HINTS[config.workerBackend.get()] ?? ''}`,
    },
    cwd: {
      type: 'string',
      description: 'Absolute directory the worker may modify. Required: a worker never inherits an implicit working directory.',
    },
    model: {
      type: 'string',
      description: 'Backend-specific route override. Leave empty to use the worker CLI\'s own default.',
    },
    effort: {
      type: 'string',
      description: 'Backend-specific reasoning effort (codex: model_reasoning_effort; opencode ignores it).',
    },
    mode: {
      type: 'string',
      description: 'Backend-specific execution mode (codex: sandbox; claude: permission mode).',
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
export function workerOutputSchema() {
  return {
    type: 'object',
    properties: {
      ok: { type: 'boolean', required: true },
      backend: { type: 'string', required: true },
      elapsedMs: { type: 'integer', required: true },
      promptBytes: { type: 'integer', required: true },
      promptTransport: { type: 'string', required: true },
      diagnostic: { type: 'string', required: true },
      errorKind: { type: 'string', required: true },
      yieldedProvider: { type: 'string', required: true },
      exitCode: { type: 'integer', required: true },
      timedOut: { type: 'boolean', required: true },
      truncated: { type: 'boolean', required: true },
      summary: { type: 'string', required: true },
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
      inputTokens: { type: 'integer', required: true },
      outputTokens: { type: 'integer', required: true },
      stderrTail: { type: 'string', required: true },
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
    ? `${result.backend} worker timed out and was terminated.`
    : result.ok
      ? `${result.backend} worker finished successfully.`
      : `${result.backend} worker exited with code ${result.exitCode}.`
  const usage = result.inputTokens || result.outputTokens ? `\n[tokens: input ${result.inputTokens}, output ${result.outputTokens}]` : ''
  const timing = result.promptBytes ? `\n[${result.promptTransport} prompt, ${result.promptBytes} B, ${result.elapsedMs} ms]` : ''
  const files = result.artifacts.length
    ? `\n[artifacts]\n${result.artifacts.map((file) => `${file.path} (${file.bytes} B, sha256 ${file.sha256.slice(0, 12)}…)`).join('\n')}`
    : ''
  const missing = result.missing.length ? `\n[no match for: ${result.missing.join(', ')}]` : ''
  const skipped = result.skipped ? `\n[${result.skipped} artifact(s) dropped by the collection limit]` : ''
  const truncated = result.truncated ? '\n[output truncated — tail shown]' : ''
  const body = result.summary || '(no output)'
  const diagnostic = result.diagnostic ? `\n[diagnostic] ${result.diagnostic}` : ''
  const error = result.stderrTail ? `\n\n--- stderr ---\n${result.stderrTail}` : ''
  return `${head}${usage}${timing}${files}${missing}${skipped}${truncated}${diagnostic}\n\n${body}${error}`
}

/**
 * Register the `cli_worker` tool and the `/worker` command.
 *
 * Registrations are effects: unloading the plugin reverts both.
 * @param {object} ctx - host context.
 * @param {object} config - plugin config.
 * @returns {Promise<void>} resolves after registration.
 */
export async function registerCliWorker(ctx, config, dispatch = null) {
  if (!config.workerEnabled.get()) return
  const { defineTool } = await import('@deepseek-ai/dsh-tools')
  ctx.tools.register(
    defineTool({
      name: 'cli_worker',
      description: DESCRIPTION,
      parameters: workerParameters(config),
      output: {
        schema: workerOutputSchema(),
        render: (_args, value) => [{ type: 'text', text: renderWorkerResult(value) }],
      },
      async execute(args, exec) {
        return runWorker(ctx, config, {
          backend: args.backend ?? config.workerBackend.get(),
          task: args.task,
          cwd: args.cwd,
          model: args.model,
          effort: args.effort,
          mode: args.mode,
          timeoutMs: args.timeoutMs,
          collect: args.collect,
          signal: exec.signal,
          ownerSession: exec?.agent?.session,
          track: dispatch?.track,
        })
      },
      presentResult: (_args, result) => ({
        card: 'generic',
        title: `cli_worker (${result.backend})`,
        content: result.content,
      }),
    }),
  )

}
