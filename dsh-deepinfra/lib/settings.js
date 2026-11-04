/**
 * Credential and configuration resolution.
 *
 * The owner's rule: a key entered in the Web UI wins, and the environment is the
 * fallback — not the other way round. Measured DeepInfra behaviour that makes the
 * fallback safe: the catalog endpoint is public, so a boot without any key still
 * succeeds and only the first completion fails (401 `invalid_api_key`).
 *
 * Precedence, highest first:
 *   1. `apiKey` in the plugin's live cordis config (what the Settings UI writes)
 *   2. `DEEPINFRA_API_KEY` from the process environment (fed by `.env` / the unit)
 *
 * The UI value is read through `config.<field>.get()` when cordis exposes a
 * reactive field, and through the plain property otherwise, so the same code works
 * for a live settings edit and for a plain object in a test.
 *
 * @module @nolit/dsh-deepinfra/settings
 */

/** Environment variable consulted when the UI config has no key. */
export const API_KEY_ENV = 'DEEPINFRA_API_KEY'

/** Environment variable consulted for the base URL. */
export const BASE_URL_ENV = 'DEEPINFRA_BASE_URL'

/**
 * Read one config field whether it is reactive or plain.
 *
 * cordis wraps configured fields in an accessor with `get()`; a plain object (and
 * a validated snapshot) exposes the value directly. Both must work, because the
 * adapter reads settings on every request while the UI may rewrite them between
 * turns.
 *
 * @param {object|null|undefined} config - plugin config.
 * @param {string} field - field name.
 * @returns {*} the current value, or undefined.
 */
export function configValue(config, field) {
  if (config === null || config === undefined) return undefined
  try {
    const holder = config[field]
    if (holder !== null && typeof holder === 'object' && typeof holder.get === 'function') return holder.get()
    return holder
  } catch {
    // A disposed or re-reading entry must not throw into a request.
    return undefined
  }
}

/**
 * Trim a trailing slash so path joins stay single-slash.
 * @param {string} value - base URL.
 * @returns {string} the trimmed URL.
 */
export function trimSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value
}

/**
 * Resolve the credential and endpoint for one request.
 *
 * @param {object} config - plugin config.
 * @param {object} [environment] - process environment (a seam for tests).
 * @returns {{ apiKey: string, apiKeySource: 'ui'|'env'|'none', baseURL: string, baseURLSource: 'ui'|'env'|'default' }}
 */
export function resolveCredentials(config, environment = globalThis.process?.env ?? {}) {
  const uiKey = stringOf(configValue(config, 'apiKey'))
  const envKey = stringOf(environment?.[API_KEY_ENV])
  // UI first. A key the operator typed must never be shadowed by a stale export
  // in the service unit, which is exactly the failure mode that makes a saved key
  // look ignored.
  const apiKey = uiKey.length > 0 ? uiKey : envKey
  const apiKeySource = uiKey.length > 0 ? 'ui' : envKey.length > 0 ? 'env' : 'none'

  const uiBase = stringOf(configValue(config, 'baseURL'))
  const envBase = stringOf(environment?.[BASE_URL_ENV])
  const baseURL = trimSlash(uiBase.length > 0 ? uiBase : envBase.length > 0 ? envBase : 'https://api.deepinfra.com/v1/openai')
  const baseURLSource = uiBase.length > 0 ? 'ui' : envBase.length > 0 ? 'env' : 'default'
  return { apiKey, apiKeySource, baseURL, baseURLSource }
}

/**
 * Read a non-empty string.
 * @param {unknown} value - candidate.
 * @returns {string} the string, or ''.
 */
function stringOf(value) {
  return typeof value === 'string' ? value.trim() : ''
}

/**
 * Mask a credential for display and logs.
 *
 * Failure ledger F-12: key values are never printed. A settings surface still has
 * to tell the operator WHICH source is in force, so it shows the source and a
 * four-character tail, never the whole value.
 *
 * @param {string} apiKey - the resolved key.
 * @returns {string} e.g. `sk-di-…9f2a`, or '' when unset.
 */
export function maskKey(apiKey) {
  if (typeof apiKey !== 'string' || apiKey.length === 0) return ''
  if (apiKey.length <= 8) return '••••'
  return apiKey.slice(0, 6) + '…' + apiKey.slice(-4)
}
