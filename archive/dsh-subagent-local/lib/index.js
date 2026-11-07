/**
 * `@nolit/dsh-subagent-local` — experimental local-CLI delegation.
 *
 * ONE Host surface: the `delegate_local` tool. It resolves one local coding CLI
 * (`agy`, `opencode`, `codex`, `claude`), runs a single self-contained task to
 * completion in an isolated child process, and returns the answer text plus
 * exit/usage/artifact metadata. It never sees the parent conversation and it
 * registers NO provider on `ctx.subagents` — the provider namespace belongs to
 * the official `dsh-subagent-*` packages and to `subagent_oar`.
 *
 * Collision policy (docs/RULES.md §4: two plugins registering the same tool is
 * a hard mount failure):
 *   - the tool name is configurable and defaults to the unique `delegate_local`;
 *   - a name already present on `ctx.tools` makes this package YIELD: it logs
 *     and mounts without registering instead of failing the whole profile;
 *   - names owned by known delegation surfaces (`subagent_oar`, the shipped
 *     `subagent_*` tools) are reserved and always yielded;
 *   - an operator can map a backend to a mounted subagent provider
 *     (`yieldToProviders`); the tool then reports that provider instead of
 *     spawning a second CLI process.
 *
 * rc.1 notes: registration uses `defineTool({ output: { schema, render } })`
 * with canonical JSON results and a `when` step-activation condition for the
 * enable switch; no internal `tools.resolve`/`tools.executable` reads.
 *
 * @module @nolit/dsh-subagent-local
 */
import Schema from '@deepseek-ai/schemastery'

import { BACKENDS, BACKEND_DEFAULTS, DEFAULT_AUTO_ORDER } from './backends.js'
import { backendConfig, configValue } from './config.js'
import { renderResult } from './locales.js'
import { canonicalBackend, emptyResult, resolveBackend, runLocalWorker } from './worker.js'

/** Host plugin name; must match package.json `name` and the bundle row id. */
export const name = '@nolit/dsh-subagent-local'

/** Services required before load: the tool registry and a subprocess provider. */
export const inject = ['tools', 'subprocess']

/**
 * Tool names this package will never claim, because another delegation surface
 * owns or may own them.
 *
 * `subagent_oar` is the measured default of
 * `@deepseek-ai/dsh-experimental-tool-subagent-oar@0.2.2-alpha.2`. The other
 * names follow the shipped `dsh-tool-subagent` naming convention used by the
 * existing tracks (`subagent_antigravity`, `subagent_opencode`) and are listed
 * defensively; their exact upstream defaults are not installed here.
 */
export const RESERVED_TOOL_NAMES = Object.freeze([
  'delegate',
  'subagent',
  'subagent_oar',
  'subagent_codex',
  'subagent_claude_code',
  'subagent_antigravity',
  'subagent_opencode',
])

/** Default model-facing tool name. */
export const DEFAULT_TOOL_NAME = 'delegate_local'

/** Environment entries forwarded to a child CLI by default. */
export const DEFAULT_FORWARD_ENV = Object.freeze([
  'PATH',
  'HOME',
  'USER',
  'SHELL',
  'TERM',
  'LANG',
  'LC_ALL',
  'XDG_CONFIG_HOME',
  'XDG_DATA_HOME',
  'XDG_CACHE_HOME',
  'GEMINI_CONFIG_DIR',
  'GOOGLE_APPLICATION_CREDENTIALS',
  'CLAUDE_CONFIG_DIR',
  'CODEX_HOME',
])

/**
 * Credential-shaped variables are NOT forwarded by default. A child CLI uses
 * its own authenticated profile; an operator who needs an API key adds it to
 * `forwardEnv` explicitly, which is the deliberate opt-in the subprocess seam
 * documents (explicit entries merge after its credential scrub).
 */

/** Per-backend settings schema factory; defaults mirror the adapter records. */
function backendSettings(defaults) {
  return Schema.object({
    enabled: Schema.boolean().default(true),
    path: Schema.string().default(defaults.path),
    model: Schema.string().default(defaults.model),
    effort: Schema.string().default(defaults.effort),
    mode: Schema.string().default(defaults.mode),
    timeoutMs: Schema.number().default(0),
    auto: Schema.boolean().default(true),
    extraArgs: Schema.array(Schema.string()).default([]),
  })
}

/**
 * Plugin config schema.
 *
 * `enabled`, `toolName` and `yieldToMountedTool` are registration-time fields
 * (changing them re-runs `apply`); the rest are read live per call.
 */
export const Config = Schema.object({
  enabled: Schema.boolean().default(true),
  toolName: Schema.string().default(DEFAULT_TOOL_NAME),
  backend: Schema.string().default('auto'),
  autoOrder: Schema.array(Schema.string()).default([...DEFAULT_AUTO_ORDER]),
  timeoutMs: Schema.number().default(600000).volatile(),
  maxOutputBytes: Schema.number().default(8388608).volatile(),
  artifactLimit: Schema.number().default(100).volatile(),
  artifactDir: Schema.string().default('').volatile(),
  disposeGraceMs: Schema.number().default(5000).volatile(),
  locale: Schema.union(['en', 'ko']).default('en').volatile(),
  forwardEnv: Schema.array(Schema.string()).default([...DEFAULT_FORWARD_ENV]).volatile(),
  yieldToProviders: Schema.dict(Schema.string()).default({}).volatile(),
  yieldToMountedTool: Schema.boolean().default(true),
  backends: Schema.object({
    antigravity: backendSettings(BACKEND_DEFAULTS.antigravity),
    opencode: backendSettings(BACKEND_DEFAULTS.opencode),
    codex: backendSettings(BACKEND_DEFAULTS.codex),
    claude: backendSettings(BACKEND_DEFAULTS.claude),
  }),
})

/** Model-facing description. English always; `locale` only affects result text. */
export const TOOL_DESCRIPTION = [
  'Run one self-contained task to completion in an isolated local coding CLI and return its final answer plus exit, usage, and artifact metadata.',
  'Backends: antigravity (agy), opencode, codex, claude; `auto` picks the first executable resolvable on this host.',
  'The child never sees this conversation: include every path and constraint it needs, and give it an absolute cwd.',
  'One call owns one process; it does not continue a conversation and does not stream into the chat.',
  'Prefer an existing official delegation provider/tool for the same backend when one is mounted; this tool yields to a provider mapped by `yieldToProviders`.',
].join(' ')

/**
 * Output declaration for the canonical tool value.
 * @returns {object} tool output schema spec.
 */
export function outputSchema() {
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
      artifactDir: { type: 'string', required: true },
    },
  }
}

/**
 * Parameter map for the model-facing tool.
 * @param {object} config - plugin config.
 * @returns {Record<string, object>} parameter schema.
 */
export function toolParameters(config) {
  const configuredBackend = String(configValue(config, 'backend') ?? 'auto')
  return {
    task: {
      type: 'string',
      required: true,
      description:
        'The complete instruction for the local CLI. It does not see this conversation, so include every path and constraint it needs.',
    },
    cwd: {
      type: 'string',
      description: 'Absolute directory the CLI may modify. Defaults to the calling session working directory.',
    },
    backend: {
      type: 'string',
      enum: ['auto', ...BACKENDS],
      description: `Local CLI backend. Defaults to the plugin config value (${configuredBackend}).`,
    },
    model: {
      type: 'string',
      description: 'Model id override for this call. Omission uses the per-backend config value or the CLI default.',
    },
    effort: {
      type: 'string',
      description: 'Reasoning effort override for this call (agy levels: low|medium|high|xhigh|max).',
    },
    mode: {
      type: 'string',
      description: 'Backend execution mode override (agy: accept-edits|auto|plan; codex: sandbox mode; claude: permission mode).',
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
 * Resolve the backend a call names without touching executables.
 * @param {object} config - plugin config.
 * @param {string} [requested] - per-call backend.
 * @returns {string} a backend id, or an empty string for `auto`/unset.
 */
export function selectedBackend(config, requested) {
  const request = String(requested ?? '').trim()
  if (request && request !== 'auto') return canonicalBackend(request)
  const configured = String(configValue(config, 'backend') ?? '').trim()
  if (configured && configured !== 'auto') return canonicalBackend(configured)
  return ''
}

/**
 * Decide whether registration must yield before claiming a tool name.
 * @param {object} ctx - host context exposing `tools`.
 * @param {object} config - plugin config.
 * @param {string} toolName - candidate tool name.
 * @returns {{reason: string, detail: string}|null} the yield decision, or null to register.
 */
export function registrationYield(ctx, config, toolName) {
  if (configValue(config, 'yieldToMountedTool') === false) return null
  if (RESERVED_TOOL_NAMES.includes(toolName)) {
    return { reason: 'reserved-name', detail: `tool name "${toolName}" is reserved for an existing delegation surface` }
  }
  const existing = typeof ctx.tools?.get === 'function' ? ctx.tools.get(toolName) : undefined
  if (existing) {
    return { reason: 'tool-name-taken', detail: `tool name "${toolName}" is already registered by another plugin` }
  }
  return null
}

/**
 * Warn once through the host logger when one is available.
 * @param {object} ctx - host context.
 * @param {string} message - warning text.
 */
function warn(ctx, message) {
  try {
    ctx.logger?.warn?.(`subagent-local: ${message}`)
  } catch {
    // Logging must never turn a yield into an activation failure.
  }
}

/**
 * Acquire the optional subagent registry for provider-yield checks.
 *
 * Cordis throws on an undeclared service read (FAILURE-LEDGER F-44), so this
 * uses the documented late-acquisition form and tolerates its absence.
 * @param {object} ctx - host context.
 * @param {object} state - mutable mount state.
 */
function watchProviders(ctx, state) {
  if (typeof ctx.inject !== 'function') return
  try {
    ctx.inject(['subagents'], (scoped) => {
      state.subagents = scoped?.subagents ?? null
    })
  } catch {
    // A profile without the subagent seam simply has no provider to yield to.
  }
}

/**
 * Check whether a backend is already served by a mounted subagent provider.
 * @param {object} state - mount state.
 * @param {object} config - plugin config.
 * @param {string} backend - backend id.
 * @returns {string} the mounted provider name, or an empty string.
 */
export function mountedProviderFor(state, config, backend) {
  if (!backend || !state.subagents) return ''
  const map = configValue(config, 'yieldToProviders')
  if (!map || typeof map !== 'object') return ''
  const providerName = String(map[backend] ?? '')
  if (providerName === '') return ''
  try {
    return state.subagents.getProvider?.(providerName) ? providerName : ''
  } catch {
    return ''
  }
}

/**
 * Build the `delegate_local` tool definition.
 * @param {object} ctx - host context.
 * @param {object} config - plugin config.
 * @param {object} state - mount state shared with the provider watcher.
 * @returns {Promise<object>} a registry-ready definition.
 */
export async function createToolDefinition(ctx, config, state) {
  const { defineTool } = await import('@deepseek-ai/dsh-tools')
  const toolName = String(configValue(config, 'toolName') || DEFAULT_TOOL_NAME)
  const localeOf = () => String(configValue(config, 'locale') ?? 'en')
  return defineTool({
    name: toolName,
    description: TOOL_DESCRIPTION,
    parameters: toolParameters(config),
    output: {
      schema: outputSchema(),
      render: (_args, value) => [{ type: 'text', text: renderResult(value, localeOf()) }],
    },
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      if (configValue(config, 'enabled') === false) {
        const result = emptyResult()
        result.errorKind = 'disabled'
        result.diagnostic = 'delegate_local is disabled by configuration (enabled: false)'
        return result
      }

      const task = String(args.task ?? '')
      if (task.trim() === '') throw new Error('delegate_local requires a non-empty task')

      const cwd = String(args.cwd ?? exec.agent?.session?.header?.cwd ?? '')
      if (cwd === '') {
        throw new Error(
          'delegate_local cannot resolve a child cwd: pass an absolute "cwd" or delegate from a session with one',
        )
      }

      const backend = selectedBackend(config, args.backend)
      const providerName = mountedProviderFor(state, config, backend)
      if (providerName) {
        const result = emptyResult(backend)
        result.errorKind = 'provider-mounted'
        result.yieldedProvider = providerName
        result.diagnostic = `backend "${backend}" is served by the mounted provider "${providerName}"`
        return result
      }

      let resolved
      try {
        resolved = await resolveBackend({ ctx, config, requested: args.backend, cwd, signal: exec.signal })
      } catch (error) {
        const result = emptyResult(backend)
        result.diagnostic = error instanceof Error ? error.message : String(error)
        return result
      }

      return runLocalWorker({
        ctx,
        config,
        task,
        cwd,
        backend: args.backend,
        model: args.model,
        effort: args.effort,
        mode: args.mode,
        timeoutMs: args.timeoutMs,
        collect: args.collect,
        signal: exec.signal,
        resolved,
      })
    },
    presentResult: (_args, result) => ({
      card: 'generic',
      title: `${result.backend || 'local'}${result.model ? ` · ${result.model}` : ''}`,
      content: renderResult(result, localeOf()),
    }),
  })
}

/**
 * Mount the plugin and return its mount state for tests/diagnostics.
 *
 * A Cordis plugin's `apply` must not return a non-nullable value: it runs as an
 * effect, and any returned object that is neither a function nor a promise is
 * rejected as `TypeError: Invalid effect` (measured in an isolated rc.1 boot on
 * 2026-11-05). `apply` therefore returns nothing; this function is the
 * state-returning seam tests use.
 * @param {object} ctx - host context.
 * @param {object} config - plugin config.
 * @returns {Promise<object>} mount state.
 */
export async function mount(ctx, config) {
  const state = { toolName: '', registered: false, yielded: null, subagents: null }
  if (configValue(config, 'enabled') === false) {
    state.yielded = { reason: 'disabled', detail: 'plugin disabled by configuration' }
    return state
  }
  const toolName = String(configValue(config, 'toolName') || DEFAULT_TOOL_NAME)
  state.toolName = toolName
  const decision = registrationYield(ctx, config, toolName)
  if (decision) {
    state.yielded = decision
    warn(ctx, `${decision.detail}; mounting without registering the delegation tool`)
    return state
  }

  watchProviders(ctx, state)
  const definition = await createToolDefinition(ctx, config, state)
  const dispose = ctx.tools.register(definition, {
    when: () => configValue(config, 'enabled') !== false,
  })
  if (typeof ctx.effect === 'function') ctx.effect(() => dispose)
  state.registered = true
  try {
    ctx.logger?.info?.(`subagent-local: registered tool "${toolName}" (backends: ${BACKENDS.join(', ')})`)
  } catch {
    // A missing logger must not undo a successful registration.
  }
  return state
}

/**
 * Cordis entry point. Returns nothing so the effect contract stays valid.
 * @param {object} ctx - host context.
 * @param {object} config - plugin config.
 * @returns {Promise<void>} resolves after the surface is mounted or yielded.
 */
export async function apply(ctx, config) {
  await mount(ctx, config)
}

/**
 * Read one per-backend setting (re-exported for diagnostics and tests).
 * @param {object} config - plugin config.
 * @param {string} backend - backend id.
 * @param {string} key - field name.
 * @returns {unknown} the value or undefined.
 */
export function readBackendSetting(config, backend, key) {
  return configValue(backendConfig(config, backend), key)
}
