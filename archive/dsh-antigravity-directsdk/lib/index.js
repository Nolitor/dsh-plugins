/**
 * @nolit/dsh-antigravity-directsdk -- Antigravity subscription route for DSH.
 *
 * Registers ONE provider route (`antigravity`) whose adapter calls
 * https://cloudcode-pa.googleapis.com/v1internal:streamGenerateContent directly.
 * There is no CLI, no spawn and no agent persona: the harness owns the agent
 * loop, so the model is given exactly the host's system prompt and tool schemas.
 *
 * Measured 2026-11-05 that this path works end to end: OAuth refresh-token grant,
 * loadCodeAssist, fetchAvailableModels, and SSE generation with text, thought and
 * functionCall parts.
 *
 * Credential model: the OAuth client id/secret default to the values extracted
 * from the `agy` binary but are ordinary config fields, so a rotated pair from a
 * newer CLI is a settings edit, never a code change. The refresh token is read
 * from the CLI's credential file (or config/env) and is never stored here.
 */
import Schema from '@deepseek-ai/schemastery'

import { AntigravityAdapter } from './adapter.js'
import { TokenProvider } from './auth.js'
import { parseAccount, parseCatalog, splitEffort } from './catalog.js'
import { DEFAULT_CONTROL_BASE_URL, configValue, resolveEndpoint } from './settings.js'
import { GENERATION_PATH } from './wire.js'

/** Provider route this plugin owns. */
export const PROVIDER_ID = 'antigravity'

/** This plugin's entry name; also its settings namespace. */
export const name = 'dsh-antigravity-directsdk'

/**
 * Only `llm` is mandatory. A web-only service must never gate the model route
 * (measured on the DeepInfra track: declaring `connection` in inject left the
 * plugin pending and produced NO_ADAPTER in a headless boot).
 */
export const inject = ['llm']

/** Default catalog lifetime: quota and model lists move, so re-read periodically. */
const DEFAULT_CATALOG_TTL_MS = 15 * 60 * 1000

/** Config surface. Every credential is overridable; none is pinned to a call site. */
export const Config = Schema.object({
  /** OAuth client id. Empty = the agy-extracted default in settings.js. */
  clientId: Schema.string().default(''),
  /** OAuth client secret. Empty = the agy-extracted default in settings.js. */
  clientSecret: Schema.string().role('secret').default(''),
  /** Antigravity CLI credential file. Empty = probe the known filenames. */
  tokenFile: Schema.string().default(''),
  /** Explicit refresh token; wins over the file. */
  refreshToken: Schema.string().role('secret').default(''),
  /** Generation base URL. */
  baseUrl: Schema.string().default(''),
  /** Cloud project. Empty = aicode-consumers (consumer tier). */
  project: Schema.string().default(''),
  /** User-Agent accepted by the API. Empty = the measured agy string. */
  userAgent: Schema.string().default(''),
  /** How long a fetched catalog stays authoritative (ms). */
  catalogTtlMs: Schema.number().default(DEFAULT_CATALOG_TTL_MS),
  /** Advertise only these model ids; empty = the live catalog. */
  enabledModels: Schema.array(Schema.string()).default([]),
  /** Extra headers merged into every generation request (e.g. for a proxy). */
  extraHeaders: Schema.dict(Schema.string()).default({}),
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
 * Build the caching catalog reader.
 * @param ctx - cordis context.
 * @param config - live plugin config.
 * @param tokens - token provider.
 * @param fetchImpl - fetch implementation.
 * @returns a function returning `{ list, find, account }`.
 */
function createCatalog({ ctx, config, tokens, fetchImpl, log, now }) {
  let cache = null
  let inflight = null

  /** Read the body of one cloudcode RPC. */
  async function rpc(method, body, signal) {
    const endpoint = resolveEndpoint(config)
    const token = await tokens.get(signal)
    // Control-plane RPCs live on the plain host; generation uses the daily-* host.
    const host = configValue(config, 'controlBaseUrl') || (configValue(config, 'baseUrl') || DEFAULT_CONTROL_BASE_URL)
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
    const entries = parseCatalog(models)
    const enabled = configValue(config, 'enabledModels') ?? []
    const filtered = enabled.length > 0 ? entries.filter((entry) => enabled.includes(entry.id)) : entries
    return {
      entries: filtered,
      account: account ? parseAccount(account) : undefined,
      fetchedAt: now(),
    }
  }

  /** Return the cached snapshot or refresh it. */
  async function snapshot(signal) {
    const ttl = Number(configValue(config, 'catalogTtlMs')) || DEFAULT_CATALOG_TTL_MS
    if (cache && now() - cache.fetchedAt < ttl) return cache
    if (inflight) return inflight
    inflight = load(signal)
      .then((value) => {
        cache = value
        ctx?.emit?.('llm/models-updated', PROVIDER_ID)
        return value
      })
      .catch((error) => {
        if (cache) {
          log?.warn?.(`antigravity: catalog refresh failed, serving stale: ${error?.message ?? error}`)
          return cache
        }
        // A cold start with no catalog still serves: routing accepted, only the
        // picker is empty until the next successful fetch.
        log?.warn?.(`antigravity: catalog unavailable: ${error?.message ?? error}`)
        cache = { entries: [], account: undefined, fetchedAt: now() }
        return cache
      })
      .finally(() => {
        inflight = null
      })
    return inflight
  }

  return {
    list: async (signal) => (await snapshot(signal)).entries.map((entry) => {
      const { effort } = splitEffort(entry.id)
      return { ...entry, efforts: effort ? [effort] : [] }
    }),
    find: async (signal, id) => (await snapshot(signal)).entries.find((entry) => entry.id === id),
    account: async (signal) => (await snapshot(signal)).account,
  }
}

/**
 * Plugin apply function.
 * @param ctx - cordis context.
 * @param config - validated plugin config.
 */
export function apply(ctx, config) {
  const env = process.env
  const tokenProvider = new TokenProvider({
    config,
    env,
    fetchImpl: globalThis.fetch,
    log: ctx?.logger,
  })

  const catalog = createCatalog({
    ctx,
    config,
    tokens: tokenProvider,
    fetchImpl: globalThis.fetch,
    log: ctx?.logger,
    now: Date.now,
  })

  const settings = () => config

  const adapter = new AntigravityAdapter({
    settings,
    tokens: tokenProvider,
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

  // Warm the catalog so the first picker read answers from memory.
  void catalog.account()

  return () => {
    registration()
  }
}
