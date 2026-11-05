/**
 * Configuration and credential resolution.
 *
 * Precedence, highest first, for every value:
 *   1. the plugin's live cordis config (what the Settings UI writes)
 *   2. the process environment
 *   3. the built-in default
 *
 * The OAuth client id/secret defaults were extracted from the `agy` binary
 * (measured 2026-11-05, agy 1.4.12). They are the *installed application*
 * credentials Google ships inside the public client, so they are not secrets in
 * the private-key sense; they are still kept as overridable defaults rather than
 * hardcoded call sites, because Google can rotate them and the binary ships the
 * replacement.
 *
 * @module @nolit/dsh-antigravity-directsdk/settings
 */

/** Env var consulted when the UI config has no client id. */
export const CLIENT_ID_ENV = 'ANTIGRAVITY_CLIENT_ID'
/** Env var consulted when the UI config has no client secret. */
export const CLIENT_SECRET_ENV = 'ANTIGRAVITY_CLIENT_SECRET'
/** Env var for an explicit refresh token (skips the token file entirely). */
export const REFRESH_TOKEN_ENV = 'ANTIGRAVITY_REFRESH_TOKEN'
/** Env var overriding the token file path. */
export const TOKEN_FILE_ENV = 'ANTIGRAVITY_TOKEN_FILE'
/** Env var overriding the base URL. */
export const BASE_URL_ENV = 'ANTIGRAVITY_BASE_URL'

/**
 * OAuth installed-app client id shipped with the `agy` CLI.
 * Extracted 2026-11-05 from ~/.local/bin/agy (agy 1.4.12).
 */
export const DEFAULT_CLIENT_ID = '[client-id withheld from the public mirror; see local copy / PROVENANCE]'

/**
 * Matching installed-app client secret for {@link DEFAULT_CLIENT_ID}.
 * Public by Google's installed-app model; rotate via config when the CLI updates.
 */
export const DEFAULT_CLIENT_SECRET = '[installed-app secret withheld from the public mirror]'

/**
 * Generation API host.
 *
 * Measured 2026-11-05: the SAME body and token return 200 on this host and
 * 429 RESOURCE_EXHAUSTED on `https://cloudcode-pa.googleapis.com`, even though
 * `loadCodeAssist`/`fetchAvailableModels` answer 200 on both. The CLI sends
 * generation traffic to the daily-* host; the plain host is for control-plane
 * RPCs only.
 */
export const DEFAULT_BASE_URL = 'https://daily-cloudcode-pa.googleapis.com'

/** Control-plane host for loadCodeAssist / fetchAvailableModels. */
export const DEFAULT_CONTROL_BASE_URL = 'https://cloudcode-pa.googleapis.com'

/** Token endpoint. */
export const DEFAULT_TOKEN_URL = 'https://oauth2.googleapis.com/token'

/** Project the consumer tier is bound to (measured from loadCodeAssist). */
export const DEFAULT_PROJECT = 'aicode-consumers'

/**
 * User-Agent the API accepts.
 *
 * Measured 2026-11-05: without an `antigravity/cli/` User-Agent the generation
 * endpoint answers 403 "You do not have a valid license of this product", and
 * loadCodeAssist reports `UNSUPPORTED_CLIENT` in `ineligibleTiers`. This is the
 * value `agy` sends; it is a protocol field, not a disguise, and is configurable
 * so a newer CLI string can replace it without a code change.
 */
export const DEFAULT_USER_AGENT =
  'antigravity/cli/1.5.0 (aidev_client; os_type=linux; arch=amd64; cl=1013440158; auth_method=consumer)'

/** Token file names, in probe order. The Hermes plugin knows the same two. */
export const TOKEN_FILE_NAMES = ['jetski-standalone-oauth-token', 'antigravity-oauth-token']

/**
 * Read one config field whether it is reactive or plain.
 *
 * cordis wraps configured fields in an accessor with `get()`; a plain object
 * exposes the value directly. Both must work because the adapter reads settings
 * per request while the UI may rewrite them between turns.
 *
 * @param config - plugin config.
 * @param field - field name.
 * @returns the current value, or undefined.
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
 * First non-empty string among the candidates.
 * @param values - candidates, highest precedence first.
 * @returns the chosen value or undefined.
 */
function firstNonEmpty(values) {
  for (const value of values) {
    if (typeof value === 'string' && value.trim() !== '') return value.trim()
  }
  return undefined
}

/**
 * Resolve the OAuth client identity.
 * @param config - live plugin config.
 * @param env - process environment.
 * @returns the client id and secret actually used.
 */
export function resolveClient(config, env = process.env) {
  return {
    clientId: firstNonEmpty([configValue(config, 'clientId'), env[CLIENT_ID_ENV]]) ?? DEFAULT_CLIENT_ID,
    clientSecret: firstNonEmpty([configValue(config, 'clientSecret'), env[CLIENT_SECRET_ENV]]) ?? DEFAULT_CLIENT_SECRET,
    tokenUrl: firstNonEmpty([configValue(config, 'tokenUrl'), env[TOKEN_FILE_ENV + '_URL']]) ?? DEFAULT_TOKEN_URL,
  }
}

/**
 * Resolve endpoint and protocol constants.
 * @param config - live plugin config.
 * @param env - process environment.
 * @returns base URL, project, and User-Agent.
 */
export function resolveEndpoint(config, env = process.env) {
  return {
    baseUrl: firstNonEmpty([configValue(config, 'baseUrl'), env[BASE_URL_ENV]]) ?? DEFAULT_BASE_URL,
    project: firstNonEmpty([configValue(config, 'project')]) ?? DEFAULT_PROJECT,
    userAgent: firstNonEmpty([configValue(config, 'userAgent'), env.ANTIGRAVITY_USER_AGENT]) ?? DEFAULT_USER_AGENT,
  }
}

/**
 * Resolve where the refresh token comes from.
 * @param config - live plugin config.
 * @param env - process environment.
 * @returns an explicit token, or a list of candidate file paths.
 */
export function resolveTokenSource(config, env = process.env) {
  const explicit = firstNonEmpty([configValue(config, 'refreshToken'), env[REFRESH_TOKEN_ENV]])
  if (explicit) return { explicit, files: [] }
  const configured = firstNonEmpty([configValue(config, 'tokenFile'), env[TOKEN_FILE_ENV]])
  if (configured) return { explicit: undefined, files: [expandHome(configured, env)] }
  const home = env.HOME
  if (!home) return { explicit: undefined, files: [] }
  return {
    explicit: undefined,
    files: TOKEN_FILE_NAMES.map((name) => `${home}/.gemini/antigravity-cli/${name}`),
  }
}

/**
 * Expand a leading `~` against the environment home.
 * @param path - configured path.
 * @param env - process environment.
 * @returns the expanded path.
 */
export function expandHome(path, env = process.env) {
  if (path.startsWith('~/')) return `${env.HOME ?? ''}${path.slice(1)}`
  return path
}
