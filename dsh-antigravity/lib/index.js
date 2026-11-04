/**
 * @nolit/dsh-antigravity -- the Antigravity Agent for DeepSeek Harness.
 *
 * ONE plugin, three surfaces over ONE account:
 *
 *   1. CLI surface   -- `/agy <task>` command + `agy_worker` tool, which spawn
 *                       `agy` as an isolated one-shot process.
 *   2. Model surface -- the `antigravity` provider route, a pure LlmAdapter
 *                       calling cloudcode-pa over HTTP with the subscription
 *                       credential (no CLI, no persona).
 *   3. UI surface    -- an "Antigravity" settings section and a composer usage
 *                       chip that sits beside the model selector.
 *
 * Why one plugin rather than three: the CLI and the HTTP path read the SAME
 * credential file and serve the SAME account. Splitting them would duplicate the
 * OAuth client id/secret in two places, which is exactly what makes a rotated
 * credential hard to track down.
 *
 * DISABLE SEMANTICS
 *   `enabled: false` removes the provider route (the model disappears from the
 *   picker), the settings section, and the usage chip in one switch. Individual
 *   surfaces can then be switched off independently with `modelServing`,
 *   `cliWorker` and `usagePill`. Every removal goes through a disposer that the
 *   host already runs, so nothing leaks a half-registered surface.
 */
import Schema from '@deepseek-ai/schemastery'

import { AntigravityAdapter } from './adapter.js'
import { TokenProvider } from './auth.js'
import { DEFAULT_EFFORT, DEFAULT_MODE, DEFAULT_MODEL, EFFORTS, MODES } from './backends.js'
import { parseAccount, parseCatalog, splitEffort } from './catalog.js'
import { configValue, resolveEndpoint } from './settings.js'
import { readSelection, writeSelection } from './selection.js'
import { listAgyModels, runAgyWorker } from './worker.js'
import { AntigravitySubagentProvider } from './subagent.js'
import { registerRoutes } from './server.js'

/** Provider route owned by the model surface. */
export const PROVIDER_ID = 'antigravity'

/** Host plugin name; must match package.json `name` and the bundle row id. */
export const name = '@nolit/dsh-antigravity'

/**
 * Services required before load. `llm` is mandatory for the model surface;
 * `tools`, `subprocess` and `connection` are resolved optionally so a headless
 * profile that lacks the web seam still serves models.
 */
export const inject = ['llm']

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
  '  --mode <mode>       accept-edits | auto | plan',
  '  --timeout <ms>      hard wall-clock limit',
].join('\n')

/** Config surface: defaults live here; GUI edits validate against this schema. */
export const Config = Schema.object({
  // ---- master / per-surface switches -------------------------------------
  /** Master switch. false removes the route, the settings section and the chip. */
  enabled: Schema.boolean().default(true).volatile(),
  /** HTTP model serving (the `antigravity` provider route). */
  modelServing: Schema.boolean().default(true).volatile(),
  /** `/agy` command and `agy_worker` tool. */
  cliWorker: Schema.boolean().default(true).volatile(),
  /** Composer usage chip. */
  usagePill: Schema.boolean().default(true).volatile(),
  /** Antigravity subagent provider (`subagent_antigravity`). */
  subagent: Schema.boolean().default(true).volatile(),

  // ---- credential (config -> env -> built-in default) ---------------------
  /** OAuth client id. '' = the agy-extracted default. */
  clientId: Schema.string().default('').volatile(),
  /** OAuth client secret. '' = the agy-extracted default. */
  clientSecret: Schema.string().role('secret').default('').volatile(),
  /** CLI credential file. '' = probe the known filenames. */
  tokenFile: Schema.string().default('').volatile(),
  /** Explicit refresh token; wins over the file. */
  refreshToken: Schema.string().role('secret').default('').volatile(),

  // ---- endpoint ----------------------------------------------------------
  /** Generation base URL. '' = daily-cloudcode-pa. */
  baseUrl: Schema.string().default('').volatile(),
  /** Control-plane base URL. '' = cloudcode-pa. */
  controlBaseUrl: Schema.string().default('').volatile(),
  /** Cloud project. '' = aicode-consumers. */
  project: Schema.string().default('').volatile(),
  /** User-Agent. '' = the measured agy string. */
  userAgent: Schema.string().default('').volatile(),
  /** How long a fetched catalog stays authoritative (ms). */
  catalogTtlMs: Schema.number().default(900000).volatile(),
  /** Advertise only these model ids; empty = the live catalog. */
  enabledModels: Schema.array(Schema.string()).default([]).volatile(),
  /** Extra headers merged into generation requests. */
  extraHeaders: Schema.dict(Schema.string()).default({}).volatile(),

  // ---- subagent surface --------------------------------------------------
  /** Registry name the delegation tool binds to. */
  subagentProviderName: Schema.string().default('antigravity').volatile(),
  /** Wall-clock limit for one delegation (ms). */
  subagentTimeoutMs: Schema.number().default(900000).volatile(),
  /** Grace period before a delegation child is terminated (ms). */
  subagentDisposeGraceMs: Schema.number().default(5000).volatile(),
  /** Extra environment variables for the delegation child. */
  subagentEnv: Schema.dict(Schema.string()).default({}).volatile(),

  // ---- CLI surface -------------------------------------------------------
  agyPath: Schema.string().default('agy').volatile(),
  model: Schema.string().default(DEFAULT_MODEL).volatile(),
  effort: Schema.union(EFFORTS).default(DEFAULT_EFFORT).volatile(),
  mode: Schema.union(MODES).default(DEFAULT_MODE).volatile(),
  timeoutMs: Schema.number().default(600000).volatile(),
  maxOutputBytes: Schema.number().default(8388608).volatile(),
  forwardEnv: Schema.array(Schema.string()).default(FORWARD_ENV_DEFAULT).volatile(),
  extraArgs: Schema.array(Schema.string()).default([]).volatile(),
  artifactLimit: Schema.number().default(100).volatile(),
  workerEnabled: Schema.boolean().default(true).volatile(),
})

/**
 * Read an optional service without requiring it in `inject`.
 *
 * cordis installs a proxy on ctx: reading an undeclared service THROWS instead of
 * returning undefined, and optional chaining does not help because the throw
 * happens on the property read itself.
 *
 * @param ctx - cordis context.
 * @param service - service name.
 * @returns the service, or undefined.
 */
function optional(ctx, service) {
  try {
    return ctx[service]
  } catch {
    return undefined
  }
}

/**
 * Build the caching catalog reader shared by the adapter and the panel routes.
 * @param options - `{ config, tokens, fetchImpl, log, now, onChanged }`.
 * @returns `{ list, find, account, snapshot }`.
 */
export function createCatalog({ config, tokens, fetchImpl, log, now, onChanged }) {
  let cache = null
  let inflight = null

  /** POST one cloudcode RPC to the control host. */
  async function rpc(method, body, signal) {
    const endpoint = resolveEndpoint(config)
    const host = configValue(config, 'controlBaseUrl') || 'https://cloudcode-pa.googleapis.com'
    const token = await tokens.get(signal)
    const response = await fetchImpl(`${host}/v1internal:${method}`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': endpoint.userAgent,
      },
      body: JSON.stringify(body),
      signal,
    })
    if (!response.ok) {
      const text = await response.text().catch(() => '')
      throw new Error(`${method} failed (HTTP ${response.status}): ${text.slice(0, 200)}`)
    }
    return response.json()
  }

  /** Fetch models and account state. */
  async function load(signal) {
    const endpoint = resolveEndpoint(config)
    const [models, account] = await Promise.all([
      rpc('fetchAvailableModels', { project: endpoint.project }, signal),
      rpc('loadCodeAssist', { metadata: { pluginType: 'GEMINI' } }, signal).catch((error) => {
        log?.warn?.(`antigravity: loadCodeAssist failed: ${error?.message ?? error}`)
        return undefined
      }),
    ])
    const entries = parseCatalog(models).map((entry) => {
      const { effort } = splitEffort(entry.id)
      return { ...entry, efforts: effort ? [effort] : [] }
    })
    const enabled = configValue(config, 'enabledModels') ?? []
    return {
      entries: enabled.length > 0 ? entries.filter((entry) => enabled.includes(entry.id)) : entries,
      all: entries,
      account: account ? parseAccount(account) : undefined,
      fetchedAt: now(),
    }
  }

  /** Cached snapshot or a fresh load. */
  async function snapshot(signal) {
    const ttl = Number(configValue(config, 'catalogTtlMs')) || 900000
    if (cache && now() - cache.fetchedAt < ttl) return cache
    if (inflight) return inflight
    inflight = load(signal)
      .then((value) => {
        cache = value
        onChanged?.(value)
        return value
      })
      .catch((error) => {
        if (cache) {
          log?.warn?.(`antigravity: catalog refresh failed, serving stale: ${error?.message ?? error}`)
          return cache
        }
        log?.warn?.(`antigravity: catalog unavailable: ${error?.message ?? error}`)
        cache = { entries: [], all: [], account: undefined, fetchedAt: now() }
        return cache
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  return {
    snapshot,
    /** Normalized model list (efforts attached). */
    list: async (signal) => (await snapshot(signal)).entries,
    /** Every model the account serves, ignoring `enabledModels`. */
    all: async (signal) => (await snapshot(signal)).all,
    /** Exact-id lookup. */
    find: async (signal, id) => (await snapshot(signal)).entries.find((entry) => entry.id === id),
    /** Account tier and project. */
    account: async (signal) => (await snapshot(signal)).account,
  }
}

/**
 * Plugin apply function.
 * @param ctx - cordis context.
 * @param config - validated plugin config.
 * @returns a disposer releasing every surface this plugin registered.
 */
export function apply(ctx, config) {
  const disposers = []
  const endpointOf = () => resolveEndpoint(config)

  const tokens = new TokenProvider({ config, fetchImpl: globalThis.fetch, log: ctx?.logger })
  const catalog = createCatalog({
    config,
    tokens,
    fetchImpl: globalThis.fetch,
    log: ctx?.logger,
    now: Date.now,
    onChanged: () => ctx?.emit?.('llm/models-updated', PROVIDER_ID),
  })

  // ---- model surface -----------------------------------------------------
  // The route is registered ONLY when every gate is open, so a disabled plugin
  // never advertises a model the harness would then fail to serve.
  if (configValue(config, 'enabled') !== false && configValue(config, 'modelServing') !== false) {
    const adapter = new AntigravityAdapter({
      settings: () => config,
      tokens,
      catalog: async (signal) => ({
        list: (sig) => catalog.list(sig ?? signal),
        find: (id, sig) => catalog.find(sig ?? signal, id),
      }),
      fetch: async (url, init) => {
        const headers = { ...init.headers, ...(configValue(config, 'extraHeaders') ?? {}) }
        return globalThis.fetch(url, { ...init, headers })
      },
      log: ctx?.logger,
    })
    const registration = ctx.llm.registerAdapter([PROVIDER_ID], adapter)
    disposers.push(() => {
      try {
        registration()
      } catch {
        // Already released.
      }
    })
    // Warm the catalog so the first picker read answers from memory.
    void catalog.account()
  }

  // ---- CLI surface -------------------------------------------------------
  const cliOn = configValue(config, 'enabled') !== false && configValue(config, 'cliWorker') !== false
  const tools = optional(ctx, 'tools')
  const subprocess = optional(ctx, 'subprocess')

  if (cliOn && tools && subprocess && configValue(config, 'workerEnabled') !== false) {
    // Duplicate tool names abort the whole plugin row, so yield instead of throwing.
    const existing = typeof tools.get === 'function' ? tools.get(TOOL_NAME) : undefined
    if (existing) {
      ctx?.logger?.warn?.(`antigravity: tool "${TOOL_NAME}" is already registered; skipping the CLI worker tool`)
    } else {
      try {
        tools.register({
          name: TOOL_NAME,
          description: DESCRIPTION,
          parameters: {
            type: 'object',
            properties: { task: { type: 'string', description: 'Self-contained task text for the worker.' } },
            required: ['task'],
          },
          handler: async (args, toolCtx) => {
            // The worker reads `options.prompt`; the tool argument is `task`.
            const result = await runAgyWorker(ctx, config, { prompt: String(args?.task ?? ''), cwd: process.cwd(), signal: toolCtx?.signal })
            return { content: result.text, isError: result.ok === false }
          },
          presentResult: (_args, result) => ({ card: 'generic', title: 'Antigravity', content: result.content }),
        })
      } catch (error) {
        ctx?.logger?.warn?.(`antigravity: tool registration failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  const commands = optional(ctx, 'commands')
  if (cliOn && commands) {
    const existing = typeof commands.get === 'function' ? commands.get(COMMAND_NAME) : undefined
    if (existing) {
      ctx?.logger?.warn?.(`antigravity: command "/${COMMAND_NAME}" is already registered; skipping`)
    } else {
      try {
        const registration = commands.register({
          name: COMMAND_NAME,
          input: { hint: '<task>   (--model <id> --effort <level> --mode <mode> --timeout <ms>)' },
          description: 'Run the Antigravity (agy) CLI worker. Usage: /agy [options] <task>. Bare /agy reuses the last selected model.',
          handler: async ({ rawInput }) => {
            const saved = await readSelection('agy').catch(() => ({}))
            const parts = String(rawInput ?? '').trim()
            if (parts === '' || parts === 'help') return { kind: 'success', text: USAGE }
            if (parts === 'models') {
              const listing = await listAgyModels(ctx, config, process.cwd())
              return { kind: listing.ok ? 'success' : 'error', text: listing.text || '(no models reported)' }
            }
            const result = await runAgyWorker(ctx, config, { prompt: parts, cwd: process.cwd() })
            if (result.ok && result.model) await writeSelection('agy', { model: result.model }).catch(() => {})
            return { kind: result.ok ? 'success' : 'error', text: result.text }
          },
        })
        disposers.push(() => {
          try {
            if (typeof registration === 'function') registration()
            else commands.unregister?.(COMMAND_NAME)
          } catch {
            // Already released.
          }
        })
      } catch (error) {
        ctx?.logger?.warn?.(`antigravity: command registration failed: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  // ---- subagent surface --------------------------------------------------
  // The provider registers on ctx.subagents; the shared delegation tool is a
  // SEPARATE row (@deepseek-ai/dsh-tool-subagent) bound to this provider name,
  // the same split the shipped codex/claude-code bundles use. That row lives in
  // cordis.patch.yml, so disabling this provider here leaves the tool pointing at
  // a name with no provider — hence the tool row is gated on the same switch in
  // the patch's documentation, not silently here.
  const subagents = optional(ctx, 'subagents')
  if (configValue(config, 'enabled') !== false && configValue(config, 'subagent') !== false && subagents) {
    // A second provider under the same name would shadow the first. The older
    // @nolit/dsh-subagent-antigravity package registers `antigravity` too, so a
    // profile carrying both must not lose one silently: yield and say so.
    const taken = typeof subagents.getProvider === 'function'
      ? subagents.getProvider(configValue(config, 'subagentProviderName') || 'antigravity')
      : undefined
    if (taken) {
      ctx?.logger?.warn?.('antigravity: a subagent provider named "' + (configValue(config, 'subagentProviderName') || 'antigravity') + '" is already registered; skipping the merged one')
    } else try {
      const provider = new AntigravitySubagentProvider(
        configValue(config, 'subagentProviderName') || 'antigravity',
        ctx,
        {
          agyPath: configValue(config, 'agyPath') || 'agy',
          model: configValue(config, 'model') || DEFAULT_MODEL,
          effort: configValue(config, 'effort') || DEFAULT_EFFORT,
          mode: configValue(config, 'mode') || DEFAULT_MODE,
          timeoutMs: Number(configValue(config, 'subagentTimeoutMs')) || 900000,
          disposeGraceMs: Number(configValue(config, 'subagentDisposeGraceMs')) || 5000,
          env: configValue(config, 'subagentEnv') ?? {},
        },
      )
      const release = subagents.registerProvider(provider)
      if (typeof release === 'function') disposers.push(release)
    } catch (error) {
      ctx?.logger?.warn?.(`antigravity: subagent provider registration failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ---- panel routes ------------------------------------------------------
  // The settings section and the usage chip read these. They are registered
  // only while at least one of those surfaces is on.
  const panelOn = configValue(config, 'enabled') !== false
    && (configValue(config, 'modelServing') !== false || configValue(config, 'usagePill') !== false)
  if (panelOn) {
    const disposed = registerRoutes(ctx, {
      config,
      catalog,
      endpointOf,
      pluginName: name,
    })
    if (typeof disposed === 'function') disposers.push(disposed)
  }

  const dispose = () => {
    for (const release of disposers.splice(0).reverse()) {
      try {
        release()
      } catch {
        // A failing disposer must not block the rest.
      }
    }
  }
  return dispose
}
