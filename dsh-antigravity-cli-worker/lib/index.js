/**
 * @nolit/dsh-antigravity-cli-worker
 *
 * Antigravity (agy) CLI worker tool plugin for DeepSeek Harness.
 * Provides a dedicated CLI worker that uses the official agy CLI
 * (gemini-3.8-flash with low thinking by default) for simple tasks.
 */
import * as Schemas from '@deepseek-ai/schemastery'
const Schema = Schemas.default || Schemas.Schema || Schemas
import { runAgyWorker } from './worker.js'
import { DEFAULT_MODEL, DEFAULT_EFFORT } from './backends.js'

export const name = '@nolit/dsh-antigravity-cli-worker'

export const inject = ['tools', 'subprocess']

export const Config = Schema.object({
  agyPath: Schema.string().default('agy').volatile(),
  model: Schema.string().default(DEFAULT_MODEL).volatile(),
  effort: Schema.string().default(DEFAULT_EFFORT).volatile(),
  timeoutMs: Schema.number().default(600000).volatile(),
  maxOutputBytes: Schema.number().default(262144).volatile(),
  forwardEnv: Schema.array(Schema.string()).default([
    'PATH',
    'HOME',
    'USER',
    'XDG_CONFIG_HOME',
    'XDG_DATA_HOME',
    'XDG_CACHE_HOME',
    'GEMINI_CONFIG_DIR',
    'GOOGLE_APPLICATION_CREDENTIALS',
  ]),
  extraArgs: Schema.array(Schema.string()).default([]),
  enabled: Schema.boolean().default(true).volatile(),
  artifactLimit: Schema.number().default(100).volatile(),
  dangerouslySkipPermissions: Schema.boolean().default(true).volatile(),
  printMode: Schema.boolean().default(true).volatile(),
})

const TOOL_NAME = 'agy_worker'

const TOOL_DESCRIPTION =
  'Run a one-shot Antigravity (agy) CLI worker for simple, isolated tasks. Uses the official agy CLI with gemini-3.8-flash (low thinking) by default. The worker sees only the task text you pass and returns its final response plus any collected artifacts.'

export function apply(ctx, config) {
  if (config.enabled === false) return

  ctx.effect(() => {
    const disposer = ctx.tools.register({
      name: TOOL_NAME,
      description: TOOL_DESCRIPTION,
      parameters: Schema.object({
        prompt: Schema.string().describe('Task text to send to the worker. Required.'),
        cwd: Schema.string().describe('Absolute working directory for the worker.'),
        model: Schema.string().optional().describe(`Model override (default: ${config.model || DEFAULT_MODEL}).`),
        effort: Schema.string().optional().describe('Reasoning effort (low|medium|high|xhigh|max).'),
        timeoutMs: Schema.number().optional().describe('Timeout in milliseconds.'),
        artifacts: Schema.array(Schema.string()).optional().describe('Glob patterns for files to collect as artifacts.'),
      }),
      async execute(input, toolCtx) {
        const prompt = String(input.prompt ?? '').trim()
        if (!prompt) {
          throw new Error('agy_worker requires "prompt"')
        }
        if (!input.cwd) {
          throw new Error('agy_worker requires an absolute "cwd"')
        }

        const result = await runAgyWorker(ctx, config, {
          prompt,
          cwd: input.cwd,
          model: input.model,
          effort: input.effort,
          timeoutMs: input.timeoutMs,
          artifacts: input.artifacts,
        })

        return result
      },
    })
    return disposer
  })
}
