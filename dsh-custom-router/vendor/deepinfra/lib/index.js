/**
 * @nolit/dsh-deepinfra -- a DeepInfra model route for DeepSeek Harness.
 *
 * Registers ONE provider route (`deepinfra`) with an adapter that calls
 * https://api.deepinfra.com/v1/openai/chat/completions directly. There is no
 * daemon, no spawn, no credential store and no control plane: the only moving
 * part is one bearer key.
 *
 * Credential precedence is UI-first (see lib/settings.js): a key saved in the
 * plugin settings wins, and DEEPINFRA_API_KEY from the environment is the
 * fallback. Secrets are cordis-native: a schemastery role('secret') field, so the
 * settings service redacts it on the wire and the UI can show whether a value is
 * set without receiving it.
 */
import Schema from '@deepseek-ai/schemastery'

import { createCatalogCache } from '../../../lib/catalog-cache.js'

import { DeepInfraAdapter } from './adapter.js'
import { DeepInfraAnthropicAdapter } from './anthropic-adapter.js'
import {
  DEFAULT_CATALOG_TTL_MS,
  chatRoutes,
  fetchCatalog,
  toModelInfo,
  toResolvedModelInfo,
} from './catalog.js'
import { createServer } from './server.js'
import { syncDeepInfraSelection } from './opencodex-models.js'
import { configValue } from './settings.js'
import { DEFAULT_BASE_URL, DEFAULT_CONTEXT_WINDOW, DEFAULT_TURN_MAX_TOKENS } from './wire.js'

/** Provider route this plugin owns. */
export const PROVIDER_ID = 'deepinfra'

/**
 * The second route: DeepInfra's Anthropic-compatible mount.
 *
 * Registered ONLY when the config-only `anthropicRoute` flag is `true`; it is
 * absent from bundles and from the settings UI, so a profile opts in
 * deliberately. Default off keeps the existing single-route behaviour intact.
 */
export const ANTHROPIC_PROVIDER_ID = 'deepinfra-anthropic'

/** This plugin's entry name; also its settings namespace. */
export const name = 'dsh-deepinfra'

/**
 * Services read from the cordis context.
 *
 * ONLY llm is mandatory. connection and settings are read through optional()
 * below, so a profile that does not provide them still serves models: measured
 * 2026-11-04 in an isolated HEADLESS boot, declaring them produced
 *   "dsh: warning: 1 entry did not activate"
 *   "dsh-deepinfra: pending (waiting for service: connection)"
 *   "dsh: NO_ADAPTER: no adapter registered for provider deepinfra"
 * i.e. a web-only service must never gate the model route.
 */
export const inject = ['llm']

/**
 * Read an OPTIONAL service without requiring it in `inject`.
 *
 * cordis installs a proxy on ctx: reading a service that is not declared THROWS
 * instead of returning undefined, and optional chaining does not help because the
 * throw happens on the property read itself (measured 2026-11-04 on this entry:
 * `ctx.profileDir` without inject => "cannot get property \"profileDir\" without
 * inject", which took the whole plugin down and printed
 * "1 entry did not activate"). The guard only WANTS the value when it is visible.
 *
 * @param {object} ctx - cordis context.
 * @param {string} name - service name.
 * @returns {*} the service, or undefined when not injected.
 */
function optional(ctx, name) {
  try {
    return ctx?.[name]
  } catch {
    return undefined
  }
}

/**
 * Credential precedence, as one pure rule so it can be tested without a host:
 * an explicitly configured key wins, then the DSH credential-store value, then
 * the ambient environment. A blank never wins.
 *
 * @param {unknown} uiKey - value from the profile/UI `apiKey` field.
 * @param {unknown} storedKey - value resolved from the DSH credential store.
 * @param {unknown} envKey - ambient environment fallback.
 * @returns {string} the key to use, or '' when none is configured.
 */
export function keyPrecedence(uiKey, storedKey, envKey) {
  const explicit = typeof uiKey === 'string' ? uiKey.trim() : ''
  if (explicit.length > 0) return explicit
  if (typeof storedKey === 'string' && storedKey.trim().length > 0) return storedKey.trim()
  return typeof envKey === 'string' ? envKey.trim() : ''
}

/** Config schema: defaults live here; cordis.yml and GUI edits validate against it. */
export const Config = Schema.object({
  /** Provider base URL. Override only for a compatible gateway. */
  baseURL: Schema.string().default(DEFAULT_BASE_URL).description('DeepInfra base URL (OpenAI-compatible).').volatile(),
  /**
   * Bearer credential. role('secret') makes the settings service redact it, so
   * the UI learns only whether a value is set. Empty means "use the environment",
   * which is what makes the UI-then-env precedence work without a key file.
   */
  apiKey: Schema.string().default('').role('secret').description('DeepInfra API key. Leave empty to use credentialRef, then DEEPINFRA_API_KEY.').volatile(),
  /**
   * DSH credential-store reference (an env-var-shaped name in
   * `~/.dsh/.credentials.yaml` -> `refs:`). The store owns the value; the
   * profile carries only this name. Resolved at mount and re-resolved on
   * `credentials/reference-updated`, so a rotated value reaches the next
   * request without a plugin restart.
   */
  credentialRef: Schema.string().default('DEEPINFRA_API_KEY').description('DSH credential-store ref used when apiKey is empty.').volatile(),
  /** Completion tokens ONE TURN reserves (the host's defaultMaxTokens). */
  turnMaxTokens: Schema.number().default(DEFAULT_TURN_MAX_TOKENS).description('Completion tokens one turn reserves.').volatile(),
  /** Context window used only when a route reports none. */
  contextWindow: Schema.number().default(DEFAULT_CONTEXT_WINDOW).description('Fallback context window.').volatile(),
  /** How long a fetched catalog stays authoritative. */
  catalogTtlMs: Schema.number().default(DEFAULT_CATALOG_TTL_MS).description('Model catalog cache lifetime (ms).').volatile(),
  /** Default reasoning effort materialized when a caller omits one; "" means provider default. */
  defaultEffort: Schema.string().default('').description('Default reasoning effort: none|minimal|low|medium|high|xhigh|max.').volatile(),
  /** Advertise only these model ids (empty = every chat route in the catalog). */
  enabledModels: Schema.array(Schema.string()).default([]).description('Only advertise these model ids (empty = all).').volatile(),
  /**
   * Opt-in second route on DeepInfra's Anthropic-compatible mount.
   *
   * Default false keeps a profile that does not ask for it registering exactly
   * the single chat route. The flag is config-only: no bundle row and no
   * settings-UI control, so enabling it is a deliberate profile edit.
   */
  anthropicRoute: Schema.boolean().default(false).description('Register the deepinfra-anthropic route (Anthropic Messages endpoint).').volatile(),
  /** Anthropic base URL; '' derives the origin from `baseURL`. */
  anthropicBaseURL: Schema.string().default('').description("DeepInfra Anthropic base URL (empty = derive from baseURL).").volatile(),
})

/**
 * Register the provider route and the panel routes.
 *
 * @param {object} ctx - cordis context.
 * @param {object} config - validated plugin config.
 */
export function apply(ctx, config) {
  const log = {
    warn: (message) => {
      try {
        ctx?.logger?.warn?.(message)
      } catch {
        /* logging is advisory */
      }
    },
  }

  const numberAt = (field, fallback) => {
    const value = Number(configValue(config, field))
    return Number.isFinite(value) && value > 0 ? value : fallback
  }
  const stringAt = (field, fallback) => {
    const value = configValue(config, field)
    return typeof value === 'string' ? value : fallback
  }

  // The host credential store is the managed path: the value lives in
  // `~/.dsh/.credentials.yaml` under `refs:` and is resolved by reference, so
  // nothing secret is ever stored in the profile patch. An unresolvable ref is a
  // warning plus the env fallback, never a crash and never a logged value.
  let storedKey = ''
  const credentialRefName = () => stringAt('credentialRef', 'DEEPINFRA_API_KEY').trim()
  const resolveStoredKey = async () => {
    const ref = credentialRefName()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) return ''
    try {
      // `get(name)` reads a mounted service WITHOUT an inject requirement
      // (cordis:1345). A bare property read of a service this plugin does not
      // inject throws "cannot get property ... without inject" (cordis:1257),
      // and swallowing that error silently disabled the key. Both presets
      // inject only `llm`, so this accessor is the correct one.
      // strict=false: return the provider even while its fiber is still
      // activating (a plugin apply() can run first — measured 2026-11-14).
      const credentials = ctx?.get?.('credentials', false)
      const found = await credentials?.resolve?.(ref)
      return typeof found?.value === 'string' ? found.value : ''
    } catch (error) {
      log.warn('dsh-deepinfra: credential ref "' + ref + '" could not be resolved: ' + (error instanceof Error ? error.message : String(error)))
      return ''
    }
  }
  const refreshStoredKey = () => { void resolveStoredKey().then((value) => { storedKey = value }) }
  // MEASURED 2026-11-14: `ctx.get(name, strict)` returns undefined while the
  // providing fiber is not yet active, and a plugin `apply()` can run before the
  // credentials service is. A single eager attempt therefore left the key empty
  // for the whole process (live DeepInfra child: `HTTP 401: missing API key`).
  // `ctx.inject([...])` is cordis's deferred sub-context: the callback runs as
  // soon as the service is available, which is the correct mount seam.
  refreshStoredKey()
  try {
    ctx?.inject?.(['credentials'], (scoped) => {
      refreshStoredKey()
      scoped?.on?.('credentials/reference-updated', (ref) => {
        if (ref === undefined || ref === credentialRefName()) refreshStoredKey()
      })
    })
  } catch {
    /* an older host without deferred inject keeps the eager attempt */
  }

  /** One diagnostic per distinct outage message until a probe succeeds again. */
  const catalogWarnings = new Set()
  const warnCatalog = (message) => {
    if (catalogWarnings.has(message)) return
    catalogWarnings.add(message)
    log.warn('dsh-deepinfra: ' + message)
  }

  /**
   * The model catalog cache.
   *
   * The TTL, the single-flight probe, the stale answer and the rule that a failed
   * refresh never becomes fresh data belong to the router's one cache
   * (`lib/catalog-cache.js`); this file keeps only the DeepInfra probe and the
   * projection onto host metadata. Measured 2026-11-14: this reader owned a
   * SECOND cache here (`invalidateCatalog` + a `fetchedAt` stamp), with no
   * in-flight dedupe and an error path that refreshed `fetchedAt`, extending
   * questionable data by another full TTL.
   *
   * `ttlMs` is a function so `catalogTtlMs` is re-read on every call and a
   * settings change applies without rebuilding the reader. The fallback is THIS
   * plugin's 30-minute `DEFAULT_CATALOG_TTL_MS` (catalog.js), not the router
   * module's 15-minute default: the config default and the runtime fallback stay
   * one number.
   */
  const catalogCache = createCatalogCache({
    fetch: (signal) => fetchCatalog(stringAt('baseURL', DEFAULT_BASE_URL), { signal }),
    ttlMs: () => numberAt('catalogTtlMs', DEFAULT_CATALOG_TTL_MS),
    warn: warnCatalog,
  })

  /** Whether the current outage has already been announced to the operator. */
  let outageAnnounced = false

  /**
   * Raw catalog entries, cached.
   *
   * A cold probe failure answers an EMPTY list instead of rejecting: the routes
   * and the model picker call this without a `catch`. The empty answer is not
   * stored (the core cache keeps "no value"), so the next read probes again
   * rather than blanking the picker for a whole TTL after one bad poll — the
   * defect the previous implementation had.
   *
   * @param {AbortSignal} [signal] Caller lifetime for a cold probe.
   * @returns {Promise<object[]>} Raw entries; empty when the catalog is unreachable.
   */
  const catalogEntries = async (signal) => {
    const value = await catalogCache.read(signal)
    if (Array.isArray(value)) {
      outageAnnounced = false
      catalogWarnings.clear()
      return value
    }
    if (!outageAnnounced) {
      outageAnnounced = true
      warnCatalog('catalog unavailable; serving an empty model list')
    }
    return []
  }

  const selected = (entries) => {
    const allowed = configValue(config, 'enabledModels')
    const routes = chatRoutes(entries)
    if (!Array.isArray(allowed) || allowed.length === 0) return routes
    const set = new Set(allowed)
    return routes.filter((entry) => set.has(entry.id))
  }

  const catalogReader = async (signal) => {
    const entries = await catalogEntries(signal)
    return {
      list: (provider) => selected(entries).map((entry) => toModelInfo(provider, entry)),
      resolve: (provider, model) => {
        const route = selected(entries).find((entry) => entry.id === model)
        if (route === undefined) return toModelInfo(provider, { id: model, metadata: {} })
        return toResolvedModelInfo(provider, route, {
          defaultMaxTokens: numberAt('turnMaxTokens', DEFAULT_TURN_MAX_TOKENS),
          defaultEffort: stringAt('defaultEffort', ''),
        })
      },
    }
  }

  // Turn attribution.
  //
  // `GenerateOptions` has no turn field (confirmed in the installed
  // dsh-llm types.d.ts), so the ledger cannot learn the turn from the request.
  // The host DOES announce it: `agent/turn-stopping` carries `{ agent, turn }`.
  // Keeping the latest announced turn per agent lets a request be attributed to
  // the turn it belongs to, which is the partition the owner asked for. A build
  // without the event falls back to "unassigned" rather than inventing a number.
  const completedTurn = new Map()
  /**
   * The turn a request belongs to.
   *
   * `agent/turn-stopping` announces a turn as it CLOSES, but model calls happen
   * BEFORE that, so the announced number is always one behind the requests it
   * describes. Measured 2026-11-04: attributing the raw value left every request
   * "unassigned" for the first turn. The turn in flight is therefore
   * lastCompleted + 1, which is exact because turns are numbered from 1.
   *
   * @returns {number} the turn in flight (1 before any turn has closed).
   */
  const currentTurn = () => {
    let latest = 0
    for (const turn of completedTurn.values()) if (turn > latest) latest = turn
    return latest + 1
  }
  try {
    if (typeof ctx?.on === 'function') {
      ctx.on('agent/turn-stopping', (payload) => {
        const turn = payload?.turn
        if (!Number.isInteger(turn) || turn < 0) return
        const key = String(payload?.agent?.id ?? payload?.agent ?? 'default')
        completedTurn.set(key, turn)
      })
    }
  } catch (error) {
    // A host without the event keeps serving; the turn partition is the only loss.
    log.warn('dsh-deepinfra: turn tracking unavailable: ' + (error instanceof Error ? error.message : String(error)))
  }

  const server = createServer({
    ctx,
    config,
    catalog: {
      list: (provider) => catalogReader().then((reader) => reader.list(provider)),
      // Raw chat entries, so the panel can show prices and promotions that the
      // host's advisory LlmModelInfo has no fields for. Read through the cache
      // (not the reader, which exposes only list/resolve).
      entries: async () => chatRoutes(await catalogEntries()),
    },
    onModelsApplied: async (enabled) => {
      await syncDeepInfraSelection(enabled)
    },
    // `?refresh=1` must reach the provider: dropping the core cache's in-memory
    // entry makes the next read a cold miss, which fetches.
    invalidateCatalog: () => catalogCache.invalidate(),
    profileDir: typeof optional(ctx, 'profileDir') === 'string' ? optional(ctx, 'profileDir') : undefined,
    log,
  })

  // Reads through the LIVE config on every request, so a key saved in the UI
  // takes effect on the next turn without a restart. Shared by both routes: the
  // Anthropic mount takes the same credential and the same base URL.
  const settings = () => {
    const baseURL = stringAt('baseURL', DEFAULT_BASE_URL)
    const uiKey = stringAt('apiKey', '')
    const envKey = typeof process.env.DEEPINFRA_API_KEY === 'string' ? process.env.DEEPINFRA_API_KEY.trim() : ''
    return {
      baseURL: baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL,
      // Precedence: explicit profile/UI key -> DSH credential store -> env.
      apiKey: keyPrecedence(uiKey, storedKey, envKey),
    }
  }

  /** One `fetch` per call, resolved at call time so a test double stays swappable. */
  const fetchImpl = (...args) => globalThis.fetch(...args)

  // Both routes share the credential, the catalog and the cost sink. The
  // Anthropic route previously received only `settings`/`catalog`/`fetchImpl`,
  // so every one of its turns was served but never recorded (measured
  // 2026-11-08: a completed turn left the ledger empty while the chat route's
  // did not). The dependency object is therefore built ONCE and given to both.
  const catalogEntry = async (model) => {
    const entries = await catalogEntries()
    return chatRoutes(entries).find((entry) => entry.id === model) ?? null
  }
  // The adapter asks for the turn at record time, so one DSH turn that makes
  // several model calls is still one turn's cost.
  const recordCost = (options, rawUsage, pricing, requestId) => server.recordCost(options, rawUsage, currentTurn(), pricing, requestId)

  const adapter = new DeepInfraAdapter({
    settings,
    catalog: catalogReader,
    // Look up one catalog row by id, so a request can be priced at list too.
    catalogEntry,
    fetchImpl,
    recordCost,
    log,
  })

  // Effect-based registration: disposal is owned by the fiber, and a duplicate
  // route throws instead of silently shadowing (hard mount failure by design).
  const registration = ctx.llm.registerAdapter([PROVIDER_ID], adapter)
  ctx.effect?.(() => () => registration?.())

  // Second route, opt-in by config only (`anthropicRoute: true`). Guarded so the
  // default profile registers exactly what it registered before, and disposed by
  // its own effect so a reload cannot leave a stale route behind.
  if (configValue(config, 'anthropicRoute') === true) {
    const anthropicAdapter = new DeepInfraAnthropicAdapter({
      settings,
      catalog: catalogReader,
      // The SAME three cost dependencies the chat route gets: without them the
      // stream serves, but no ledger row is ever written.
      catalogEntry,
      fetchImpl,
      recordCost,
      log,
    })
    const anthropicRegistration = ctx.llm.registerAdapter([ANTHROPIC_PROVIDER_ID], anthropicAdapter)
    ctx.effect?.(() => () => anthropicRegistration?.())
  }

  // Panel routes need services that may not exist yet.
  //
  // Measured 2026-11-04: with inject=['llm'] only (which is required so a
  // headless profile still serves models), apply() runs BEFORE the `connection`
  // row activates, so registering there silently mounted nothing and every panel
  // route answered 404 while the unit suite stayed green. ctx.inject([...], fn)
  // is cordis's deferred sub-context: fn runs when — and only if — those services
  // become available, so a profile without them simply never mounts the panel.
  let panelMounted = false
  try {
    ctx.inject?.(['connection', 'settings'], (scoped) => {
      panelMounted = true
      server.dispose(scoped)
    })
  } catch (error) {
    log.warn('dsh-deepinfra: panel routes unavailable: ' + (error instanceof Error ? error.message : String(error)))
  }
  // A host without deferred inject mounts immediately and degrades inside
  // dispose() with a warning rather than throwing.
  if (panelMounted === false && typeof ctx.inject !== 'function') server.dispose()
}

export { createServer } from './server.js'
export { createCostLedger, createCostStore, parseCost, formatCost, pickSession } from './cost.js'
export { resolveCredentials, maskKey, configValue } from './settings.js'
