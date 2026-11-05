/**
 * @nolit/dsh-antigravity -- the Antigravity Agent for DeepSeek Harness.
 *
 * ONE plugin, three surfaces over ONE account:
 *
 *   1. CLI surface   -- `/agy <task>` command + `agy_worker` tool, which start a
 *                       managed subagent child session (provider `antigravity`)
 *                       and return its id; the answer arrives as a completion
 *                       notice. No bare `agy` process is spawned by the worker.
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
 *   picker), the CLI command/tool, the subagent provider and the usage chip in
 *   one switch. Individual surfaces can then be switched off independently with
 *   `modelServing`, `cliWorker`, `subagent` and `usagePill`. The settings panel
 *   stays mounted so the master can be turned back on; plugin-level removal is
 *   the Plugins page. Every removal goes through a disposer the host already
 *   runs, so nothing leaks a half-registered surface.
 */
import Schema from '@deepseek-ai/schemastery'

import { AntigravityAdapter } from './adapter.js'
import { TokenProvider } from './auth.js'
import { DEFAULT_EFFORT, DEFAULT_MODE, DEFAULT_MODEL, EFFORTS, MODES } from './backends.js'
import { parseAccount, parseCatalog, splitEffort } from './catalog.js'
import { configValue, resolveEndpoint } from './settings.js'
import { listAgyModels } from './worker.js'
import { startCliChild } from './cli-activation.js'
import { AntigravitySubagentProvider } from './subagent.js'
import { bootBeacon } from './beacon.js'
import { createLedger, registerRoutes } from './server.js'

/** Provider route owned by the model surface. */
export const PROVIDER_ID = 'antigravity'

// Which code this process actually loaded (stage-1 S2).
bootBeacon('load')

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
  'Start a managed Antigravity CLI child session for one self-contained task. The child sees only the task text you pass, never this conversation. This tool returns the child session id immediately; the final answer or failure arrives later as a completion notice, so do not wait for the result in this call. Use it for build, test, or edit jobs that should run in a tracked child session rather than a bare process.'

const USAGE = [
  'Usage: /agy <task>',
  '       /agy models',
  '',
  'Runs the task in a managed Antigravity child session and prints its id;',
  'the answer arrives later as a completion notice. The model, effort and mode',
  'come from this plugin\'s settings (Antigravity panel), not per-call flags.',
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

  // ---- generation resilience --------------------------------------------
  /**
   * Adapter-level retries of a generation request refused with a retryable
   * status (429/451/500/502/503/504). Exponential backoff: 1s → 2s → 4s.
   * Measured 2026-11-05: the sibling OpenCode HTTP route lost a 27-step turn to
   * one unretried 451; this route gets the same contract.
   */
  httpRetries: Schema.number().default(3).volatile(),
  /** Statuses that trigger `httpRetries`; 401/403/404 are deliberately absent. */
  httpRetryStatuses: Schema.array(Schema.number()).default([429, 451, 500, 502, 503, 504]).volatile(),
  /** First backoff step; doubles per attempt. */
  httpRetryBaseMs: Schema.number().default(1000).volatile(),

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
  // Weekly / 5-hour limits live on a separate RPC (retrieveUserQuotaSummary),
  // measured 2026-11-05. They move faster than the model catalog, so cache them
  // for a minute only.
  let quotaCache = null
  let quotaInflight = null

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

  /**
   * Fetch the account's quota summary (weekly + 5-hour buckets per family).
   * @param signal - cancellation.
   * @returns the summary, or a stale/empty fallback on failure.
   */
  async function quotaSummary(signal) {
    const ttl = 60_000
    if (quotaCache && now() - quotaCache.fetchedAt < ttl) return quotaCache.value
    if (quotaInflight) return quotaInflight
    const project = resolveEndpoint(config).project
    quotaInflight = rpc('retrieveUserQuotaSummary', { project }, signal)
      .then((value) => {
        quotaCache = { value, fetchedAt: now() }
        return value
      })
      .catch((error) => {
        log?.warn?.('antigravity: quota summary unavailable: ' + (error?.message ?? error))
        return quotaCache?.value ?? { groups: [] }
      })
      .finally(() => {
        quotaInflight = null
      })
    return quotaInflight
  }

  return {
    snapshot,
    quotaSummary,
    /** Drop the cached catalog so the next list read re-applies enabledModels. */
    invalidate() {
      cache = null
    },
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
 *
 * Services arrive in two waves on a real Cordis host: `llm` is injected and
 * therefore present when apply() runs, while `tools`, `commands`, `subagents`
 * and `connection`/ `settings` activate later. Reading an uninjected service
 * throws, so the old `optional()` reads returned undefined on the web profile
 * and silently skipped the CLI, command and subagent surfaces while every mock
 * test passed (measured 2026-11-05: the slash menu listed no /agy). Each surface
 * therefore acquires its services through ctx.inject() and installs itself when
 * they appear.
 *
 * Config fields are VOLATILE (cordis keeps the same reference and updates it in
 * place), so a settings write does not re-run apply(). Reconciliation is driven
 * by the host's `app-boot/config-reload` event, which fires after a profile
 * recompose: every surface re-checks its gate and installs or disposes exactly
 * once.
 *
 * @param ctx - cordis context.
 * @param config - validated plugin config.
 * @returns a disposer releasing every surface this plugin registered.
 */
export function apply(ctx, config) {
  /** Services acquired from deferred sub-contexts. */
  const services = {}
  /** Installed surfaces, keyed so each can be released independently. */
  const parts = new Map()
  /** Long-lived disposers (injection bindings + the reload listener). */
  const disposers = []
  const endpointOf = () => resolveEndpoint(config)

  const warn = (message) => {
    try {
      ctx?.logger?.warn?.(message)
    } catch {
      // Logging is advisory.
    }
  }
  /** One warning per collision key: reconcile runs on every config reload. */
  const warned = new Set()
  const warnOnce = (key, message) => {
    if (warned.has(key)) return
    warned.add(key)
    warn(message)
  }

  /** Master + one surface gate. */
  const gate = (field) => configValue(config, 'enabled') !== false && configValue(config, field) !== false

  /** Release one installed surface. */
  const release = (key) => {
    const disposer = parts.get(key)
    if (disposer === undefined) return
    parts.delete(key)
    try {
      disposer()
    } catch {
      // Already released.
    }
  }

  /** Release every surface (plugin unload). */
  const releaseAll = () => {
    for (const key of [...parts.keys()].reverse()) release(key)
  }

  const tokens = new TokenProvider({ config, fetchImpl: globalThis.fetch, log: ctx?.logger })
  // One ledger for the adapter that RECORDS usage and the panel routes that read
  // it. Previously the routes created their own ledger, so the chip could only
  // ever show zero even when the adapter served real turns.
  const ledger = createLedger()
  // The catalog filters by enabledModels at fetch time and caches for 15 min, so
  // a settings write must drop the cache or the picker keeps the old set.
  let lastEnabledModels = JSON.stringify(configValue(config, 'enabledModels') ?? [])
  const catalog = createCatalog({
    config,
    tokens,
    fetchImpl: globalThis.fetch,
    log: ctx?.logger,
    now: Date.now,
    onChanged: () => ctx?.emit?.('llm/models-updated', PROVIDER_ID),
  })

  // ---- model surface -----------------------------------------------------
  const syncModel = () => {
    if (!gate('modelServing')) {
      release('model')
      return
    }
    if (parts.has('model')) return
    try {
      const adapter = new AntigravityAdapter({
        settings: () => config,
        tokens,
        ledger,
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
      parts.set('model', () => {
        try {
          registration()
        } catch {
          // Already released.
        }
      })
      // Warm the catalog so the first picker read answers from memory.
      void catalog.account()
    } catch (error) {
      warn('antigravity: model route registration failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  // ---- CLI surface -------------------------------------------------------
  /** Registry-ready tool definition (DSH 0.2.2 contract: output + execute). */
  const toolDefinition = () => ({
    name: TOOL_NAME,
    description: DESCRIPTION,
    parameters: {
      type: 'object',
      properties: {
        task: { type: 'string', description: 'Self-contained task text for the child session.' },
        cwd: {
          type: 'string',
          description: 'Optional child directory. Omitted inherits the calling session\'s working directory.',
        },
      },
      required: ['task'],
      additionalProperties: false,
    },
    output: {
      schema: {
        type: 'object',
        properties: {
          kind: { type: 'string', const: 'activation' },
          subagentId: { type: 'string' },
          provider: { type: 'string' },
          label: { type: 'string' },
          status: { type: 'string' },
        },
        required: ['kind', 'subagentId', 'provider', 'label', 'status'],
        additionalProperties: false,
      },
      render: (_args, value) => [{ type: 'text', text: renderActivation(value) }],
    },
    presentCall: (args) => ({
      card: 'generic',
      title: 'agy child session',
      rawInput: args,
    }),
    presentResult: (args, value) => ({
      card: 'generic',
      title: `antigravity · ${value?.label || 'agy task'}`,
      content: renderActivation(value),
    }),
    execute: async (args, exec) => {
      const activation = await startCliChild({
        services,
        config,
        prompt: String(args?.task ?? ''),
        cwd: args?.cwd,
        agent: exec?.agent,
        signal: exec?.signal,
      })
      return activationValue(activation)
    },
  })

  /** Model-facing text for one started activation. */
  const renderActivation = (value) => {
    const id = String(value?.subagentId ?? '')
    const provider = String(value?.provider ?? 'antigravity')
    const label = String(value?.label ?? '')
    return `started ${provider} child session ${id}${label ? ` — ${label}` : ''}\n`
      + 'The answer or failure arrives as a completion notice; this call did not wait for it.'
  }

  /** Canonical tool value for one started activation. */
  const activationValue = (activation) => ({
    kind: 'activation',
    subagentId: activation.childId,
    provider: activation.provider,
    label: activation.label,
    status: 'started',
  })

  /** Command definition shared by the live surface and the tests. */
  const commandDefinition = () => ({
    name: COMMAND_NAME,
    input: { hint: '<task>   (/agy models lists the account\'s models)' },
    description: 'Start a managed Antigravity CLI child session. Usage: /agy <task>. The answer arrives later as a completion notice; /agy models keeps working.',
    handler: async ({ rawInput, agent, signal }) => {
      const parts = String(rawInput ?? '').trim()
      if (parts === '' || parts === 'help') return { kind: 'success', text: USAGE }
      if (parts === 'models') {
        const listing = await listAgyModels(ctx, config, process.cwd())
        return { kind: listing.ok ? 'success' : 'error', text: listing.text || '(no models reported)' }
      }
      try {
        const activation = await startCliChild({
          services,
          config,
          prompt: parts,
          agent,
          signal,
        })
        return {
          kind: 'success',
          text: `started Antigravity child session ${activation.childId} (${activation.provider})\n`
            + 'The answer or failure will arrive as a completion notice.',
        }
      } catch (error) {
        return { kind: 'error', text: error instanceof Error ? error.message : String(error) }
      }
    },
  })

  const syncCli = () => {
    if (!gate('cliWorker')) {
      release('cli-tool')
      release('cli-command')
      return
    }
    const { tools, commands } = services
    // The tool no longer needs `subprocess`: the activation path runs the CLI
    // through the subagent provider's own start(). `subprocess` is only used by
    // the read-only `/agy models` listing.
    if (!parts.has('cli-tool') && tools && configValue(config, 'workerEnabled') !== false) {
      // Duplicate tool names abort the whole plugin row, so yield instead of throwing.
      const existing = typeof tools.get === 'function' ? tools.get(TOOL_NAME) : undefined
      if (existing) {
        warnOnce('tool', `antigravity: tool "${TOOL_NAME}" is already registered; skipping the CLI worker tool`)
      } else {
        try {
          const registration = tools.register(toolDefinition())
          parts.set('cli-tool', typeof registration === 'function' ? registration : () => {})
        } catch (error) {
          warn(`antigravity: tool registration failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
    if (!parts.has('cli-command') && commands) {
      const existing = typeof commands.get === 'function' ? commands.get(COMMAND_NAME) : undefined
      if (existing) {
        warnOnce('command', `antigravity: command "/${COMMAND_NAME}" is already registered; skipping`)
      } else {
        try {
          const registration = commands.register(commandDefinition())
          parts.set('cli-command', typeof registration === 'function'
            ? registration
            : () => commands.unregister?.(COMMAND_NAME))
        } catch (error) {
          warn(`antigravity: command registration failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }
  }

  // ---- subagent surface --------------------------------------------------
  const syncSubagent = () => {
    if (!gate('subagent') || !services.subagents) {
      release('subagent')
      return
    }
    // The provider itself runs `agy`, so it needs the subprocess service. That
    // service lives on a deferred sub-context; handing the provider the plugin
    // context would make every child start throw "cannot get property
    // subprocess without inject" (measured 2026-11-05 in an isolated boot).
    if (!services.subprocess) {
      release('subagent')
      return
    }
    if (parts.has('subagent')) return
    const providerName = configValue(config, 'subagentProviderName') || 'antigravity'
    // A second provider under the same name would shadow the first. The older
    // @nolit/dsh-subagent-antigravity package registers `antigravity` too, so a
    // profile carrying both must not lose one silently: yield and say so.
    const taken = typeof services.subagents.getProvider === 'function'
      ? services.subagents.getProvider(providerName)
      : undefined
    if (taken) {
      warnOnce('subagent', 'antigravity: a subagent provider named "' + providerName + '" is already registered; skipping the merged one')
      return
    }
    try {
      const provider = new AntigravitySubagentProvider(providerName, { subprocess: services.subprocess }, {
        agyPath: configValue(config, 'agyPath') || 'agy',
        model: configValue(config, 'model') || DEFAULT_MODEL,
        effort: configValue(config, 'effort') || DEFAULT_EFFORT,
        mode: configValue(config, 'mode') || DEFAULT_MODE,
        timeoutMs: Number(configValue(config, 'subagentTimeoutMs')) || 900000,
        disposeGraceMs: Number(configValue(config, 'subagentDisposeGraceMs')) || 5000,
        env: configValue(config, 'subagentEnv') ?? {},
      })
      const registration = services.subagents.registerProvider(provider)
      parts.set('subagent', typeof registration === 'function' ? registration : () => {})
    } catch (error) {
      warn(`antigravity: subagent provider registration failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // ---- panel routes ------------------------------------------------------
  const syncPanel = () => {
    // The panel is the CONTROL surface, not a product surface: it stays mounted
    // even when the master switch is off, because it is the only place the
    // master can be turned back on. Plugin-level removal is the Plugins page,
    // which unloads this whole row.
    if (!services.connection) {
      release('panel')
      return
    }
    if (parts.has('panel')) return
    try {
      const deps = {
        config,
        catalog,
        endpointOf,
        ledger,
        invalidate: () => catalog.invalidate(),
        quota: () => catalog.quotaSummary(),
        pluginName: name,
        installed: () => ({
          model: parts.has('model'),
          cliTool: parts.has('cli-tool'),
          cliCommand: parts.has('cli-command'),
          subagent: parts.has('subagent'),
          panel: parts.has('panel'),
        }),
      }
      const disposed = registerRoutes(ctx, deps, services)
      if (typeof disposed === 'function') parts.set('panel', disposed)
    } catch (error) {
      warn('antigravity: panel route registration failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  /** Reconcile every surface against the live config. Idempotent. */
  const syncAll = () => {
    const enabledModels = JSON.stringify(configValue(config, 'enabledModels') ?? [])
    if (enabledModels !== lastEnabledModels) {
      lastEnabledModels = enabledModels
      catalog.invalidate()
      ctx?.emit?.('llm/models-updated', PROVIDER_ID)
    }
    syncModel()
    syncCli()
    syncSubagent()
    syncPanel()
  }

  /**
   * Acquire one service group through deferred injection.
   * @param deps - service names to wait for.
   */
  const bind = (deps) => {
    if (typeof ctx.inject === 'function') {
      try {
        const off = ctx.inject(deps, (scoped) => {
          for (const dep of deps) services[dep] = scoped[dep]
          syncAll()
          return () => {
            // Drop only the surfaces that owned these services. Re-running
            // syncAll here would re-register a surface during plugin disposal.
            for (const dep of deps) services[dep] = undefined
            if (deps.includes('tools') || deps.includes('subprocess')) release('cli-tool')
            if (deps.includes('commands')) release('cli-command')
            if (deps.includes('subagents')) release('subagent')
            if (deps.includes('connection')) release('panel')
          }
        })
        if (typeof off === 'function') disposers.push(off)
        return
      } catch (error) {
        warn('antigravity: deferred injection failed: ' + (error instanceof Error ? error.message : String(error)))
      }
    }
    // Hosts without deferred injection (and the unit-test context) expose the
    // services directly. Reading an undeclared service throws, so each read is
    // guarded; the absence simply leaves that surface uninstalled.
    for (const dep of deps) {
      try {
        services[dep] = ctx[dep]
      } catch {
        services[dep] = undefined
      }
    }
    syncAll()
  }

  bind(['tools', 'subprocess'])
  bind(['commands'])
  bind(['subagents'])
  bind(['connection', 'settings'])

  // Volatile config updates do not re-run apply(); the host announces the
  // completed recompose instead, and that is when gates must be re-evaluated.
  try {
    const off = ctx.on?.('app-boot/config-reload', syncAll)
    if (typeof off === 'function') disposers.push(off)
  } catch (error) {
    warn('antigravity: config-reload listener unavailable: ' + (error instanceof Error ? error.message : String(error)))
  }

  syncAll()

  return () => {
    releaseAll()
    for (const off of disposers.splice(0).reverse()) {
      try {
        off()
      } catch {
        // A failing disposer must not block the rest.
      }
    }
  }
}
