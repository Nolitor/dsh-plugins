/**
 * Antigravity vendor-probe bridge.
 *
 * Connects the vendor plugin to the router's layer-2 probe **without editing the
 * vendor**: it reuses the three measured exports —
 *   - `@nolit/dsh-antigravity/auth`     → `TokenProvider` (OAuth refresh, token file)
 *   - `@nolit/dsh-antigravity/settings` → `resolveEndpoint` (base URL, project, User-Agent)
 *   - `@nolit/dsh-antigravity/catalog`  → `parseCatalog` (models, quota, utility filters)
 *
 * The digital fingerprint is mandatory: without the measured `antigravity/cli/…` User-Agent the
 * endpoint answers 403 "You do not have a valid license of this product". The bridge therefore uses
 * the vendor's resolved User-Agent (or an explicit override) and never invents one.
 *
 * Flexible slots (all optional, read from the preset's vendor config; reactive or plain):
 *   tokenPath?      explicit OAuth token file          (mapped to the vendor `tokenFile`)
 *   refreshToken?   direct refresh token               (highest precedence in the vendor)
 *   userAgent?      User-Agent override                (default: vendor measured string)
 *   extraHeaders?   additional request headers         (proxy / custom routing headers)
 *   project?        cloudaicompanion project override
 *   baseUrl?        generation host override
 *   controlBaseUrl? RPC host override (default cloudcode-pa.googleapis.com)
 *
 * @module @nolit/dsh-custom-router/bridges/antigravity
 */
import { ProbeError } from '../probe.js'

/** Default RPC host measured from the vendor (`lib/index.js` rpc()). */
export const DEFAULT_CONTROL_BASE = 'https://cloudcode-pa.googleapis.com'

/** Read a config value from a reactive (`{get()}`) or plain object. */
function cfg(config, key, fallback) {
  const entry = config?.[key]
  if (entry !== null && typeof entry === 'object' && typeof entry.get === 'function') {
    const value = entry.get()
    return value === undefined ? fallback : value
  }
  return entry === undefined ? fallback : entry
}

/** Lower-case a header map so overrides cannot create duplicate keys. */
function headerMap(extra) {
  const headers = {}
  if (extra === null || typeof extra !== 'object') return headers
  for (const [name, value] of Object.entries(extra)) {
    if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
      headers[String(name).toLowerCase()] = String(value)
    }
  }
  return headers
}

/**
 * Map one `parseCatalog` entry onto the router's catalog model shape.
 * @param {object} entry - vendor catalog entry.
 * @returns {object} catalog model.
 */
export function toCatalogModel(entry) {
  const model = { id: entry.id, name: entry.name ?? entry.id }
  if (typeof entry.maxInputTokens === 'number' && entry.maxInputTokens > 0) model.contextWindow = entry.maxInputTokens
  if (typeof entry.maxOutputTokens === 'number' && entry.maxOutputTokens > 0) model.maxTokens = entry.maxOutputTokens
  model.input = entry.supportsImages === true ? ['text', 'image'] : ['text']
  if (typeof entry.supportsThinking === 'boolean') model.reasoning = entry.supportsThinking
  if (entry.quota !== undefined) model.quota = entry.quota
  return model
}

/**
 * Build the antigravity probe handler for `vendorProbes['antigravity']`.
 * @param {object} options - `{ modules, env?, fetchImpl?, now?, log? }`.
 * @param {{auth: object, settings: object, catalog: object}} options.modules - imported vendor modules.
 * @returns {(layer: object, options?: object) => Promise<{models: object[], measuredAt: string, shape: 'vendor'}>} the handler.
 * @throws {TypeError} when a required vendor module/export is missing.
 */
export function createAntigravityProbe({ modules, env = process.env, fetchImpl = globalThis.fetch, now = Date.now, log } = {}) {
  for (const [module, exportName] of [
    [modules?.auth, 'TokenProvider'],
    [modules?.settings, 'resolveEndpoint'],
    [modules?.catalog, 'parseCatalog'],
  ]) {
    if (typeof module?.[exportName] !== 'function') {
      throw new TypeError(`createAntigravityProbe requires the vendor export ${exportName}`)
    }
  }

  return async function antigravityProbe(layer, options = {}) {
    const config = options.vendorConfig ?? options.config ?? {}
    const signal = options.signal
    const requestFetch = options.fetchImpl ?? fetchImpl

    // OAuth token: explicit refreshToken > tokenPath/tokenFile > env > measured default files.
    const tokenConfig = {
      refreshToken: cfg(config, 'refreshToken'),
      tokenFile: cfg(config, 'tokenPath') ?? cfg(config, 'tokenFile'),
    }
    const tokens = new modules.auth.TokenProvider({ config: tokenConfig, env, fetchImpl: requestFetch, now, log })
    let token
    try {
      token = await tokens.get(signal)
    } catch (error) {
      throw new ProbeError(`antigravity token refresh failed: ${error instanceof Error ? error.message : String(error)}`, 'PROBE_FAILED', error)
    }

    const endpoint = modules.settings.resolveEndpoint(config, env)
    const host = cfg(config, 'controlBaseUrl') || DEFAULT_CONTROL_BASE
    const url = `${String(host).replace(/\/+$/, '')}/v1internal:fetchAvailableModels`
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      accept: 'application/json',
      // The digital fingerprint. An explicit override wins; never build one here.
      'user-agent': endpoint.userAgent ?? cfg(config, 'userAgent'),
      ...headerMap(cfg(config, 'extraHeaders', {})),
    }

    let response
    try {
      response = await requestFetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ project: endpoint.project }),
        ...(signal === undefined ? {} : { signal }),
      })
    } catch (error) {
      throw new ProbeError(`antigravity probe could not reach ${url}: ${error instanceof Error ? error.message : String(error)}`, 'PROBE_FAILED', error)
    }
    if (!response.ok) {
      const body = typeof response.text === 'function' ? await response.text().catch(() => '') : ''
      throw new ProbeError(`antigravity probe answered ${response.status}${body === '' ? '' : `: ${String(body).slice(0, 200)}`}`, 'PROBE_FAILED')
    }
    let payload
    try {
      payload = await response.json()
    } catch (error) {
      throw new ProbeError('antigravity probe did not answer with JSON', 'PROBE_FAILED', error)
    }

    const entries = modules.catalog.parseCatalog(payload)
    return {
      models: entries.map(toCatalogModel),
      measuredAt: new Date(now()).toISOString(),
      shape: 'vendor',
    }
  }
}
