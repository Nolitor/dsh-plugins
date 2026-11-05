/**
 * Config access helpers shared by the plugin and the worker.
 *
 * Cordis wraps settings-editable fields in reactive accessors with `get()`;
 * plain objects (unit tests, `--dump-config` snapshots) expose the value
 * directly. Reading through this helper keeps both shapes working and keeps
 * the volatile/non-volatile split a registration concern only.
 *
 * @module @nolit/dsh-subagent-local/config
 */

/**
 * Read one config field whether it is reactive or plain.
 * @param {object|undefined} config - plugin config object.
 * @param {string} key - field name.
 * @returns {unknown} the current value, or undefined.
 */
export function configValue(config, key) {
  if (!config || typeof config !== 'object') return undefined
  const value = config[key]
  if (value && typeof value === 'object' && typeof value.get === 'function') return value.get()
  return value
}

/**
 * Read one backend's config object.
 * @param {object|undefined} config - plugin config object.
 * @param {string} backend - backend id.
 * @returns {object} the backend config, or an empty object.
 */
export function backendConfig(config, backend) {
  const backends = configValue(config, 'backends')
  if (!backends || typeof backends !== 'object') return {}
  const entry = backends[backend]
  if (!entry || typeof entry !== 'object') return {}
  return entry
}

/**
 * Read a per-backend field with a global fallback.
 * @param {object|undefined} config - plugin config object.
 * @param {string} backend - backend id.
 * @param {string} key - backend field name.
 * @param {unknown} [fallback] - value used when the backend field is absent/empty.
 * @returns {unknown} the effective value.
 */
export function backendValue(config, backend, key, fallback) {
  const value = configValue(backendConfig(config, backend), key)
  if (value === undefined || value === '') return fallback
  return value
}

/**
 * Effective timeout for one call: call override, backend override, global.
 * @param {object|undefined} config - plugin config object.
 * @param {string} backend - backend id.
 * @param {number|undefined} override - per-call timeout.
 * @returns {number} positive milliseconds.
 */
export function effectiveTimeoutMs(config, backend, override) {
  const candidates = [override, backendValue(config, backend, 'timeoutMs'), configValue(config, 'timeoutMs')]
  for (const candidate of candidates) {
    const value = Number(candidate)
    if (Number.isFinite(value) && value > 0) return Math.trunc(value)
  }
  return 600000
}

/**
 * Effective model for one call.
 * @param {object|undefined} config - plugin config object.
 * @param {string} backend - backend id.
 * @param {string|undefined} override - per-call model.
 * @returns {string} model id or an empty string (CLI default).
 */
export function effectiveModel(config, backend, override) {
  return String(override || backendValue(config, backend, 'model', '') || '')
}

/**
 * Effective effort for one call.
 * @param {object|undefined} config - plugin config object.
 * @param {string} backend - backend id.
 * @param {string|undefined} override - per-call effort.
 * @returns {string} effort id or an empty string.
 */
export function effectiveEffort(config, backend, override) {
  return String(override || backendValue(config, backend, 'effort', '') || '')
}

/**
 * Effective mode for one call.
 * @param {object|undefined} config - plugin config object.
 * @param {string} backend - backend id.
 * @param {string|undefined} override - per-call mode.
 * @returns {string} mode id or an empty string.
 */
export function effectiveMode(config, backend, override) {
  return String(override || backendValue(config, backend, 'mode', '') || '')
}

/**
 * Forward only the selected parent environment entries to the child CLI.
 * @param {object|undefined} config - plugin config object.
 * @returns {Record<string, string>} the forwarded subset.
 */
export function forwardedEnv(config) {
  const names = configValue(config, 'forwardEnv')
  const env = {}
  if (!Array.isArray(names)) return env
  for (const key of names) {
    const value = process.env[String(key)]
    if (value !== undefined) env[key] = value
  }
  return env
}
