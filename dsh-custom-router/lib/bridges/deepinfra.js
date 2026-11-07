/**
 * DeepInfra vendor-probe bridge.
 *
 * DeepInfra speaks a standard OpenAI listing, so this bridge is deliberately
 * thin: it resolves the flexible slots and delegates to the shared probe
 * executor (`probeCatalog`, shape `openai`) instead of re-implementing a parser.
 *
 * Flexible slots (`vendorConfig.deepinfra`, reactive or plain):
 *   baseUrl?      API root (default `https://api.deepinfra.com/v1/openai`)
 *   apiKey?       bearer key (default `DEEPINFRA_API_KEY`, then the vendor key)
 *   extraHeaders? additional headers
 *
 * @module @nolit/dsh-custom-router/bridges/deepinfra
 */
import { ProbeError, probeCatalog } from '../probe.js'

/** Measured catalog root (`lib/catalog.js`: `https://api.deepinfra.com/v1/openai/models`). */
export const DEFAULT_DEEPINFRA_BASE = 'https://api.deepinfra.com/v1/openai'

/** Read a config value from a reactive or plain object. */
function cfg(config, key, fallback) {
  const entry = config?.[key]
  if (entry !== null && typeof entry === 'object' && typeof entry.get === 'function') {
    const value = entry.get()
    return value === undefined ? fallback : value
  }
  return entry === undefined ? fallback : entry
}

/**
 * Build the DeepInfra probe handler for `vendorProbes['deepinfra']`.
 * @param {object} options - `{ env?, fetchImpl?, now? }`.
 * @returns {(layer: object, options?: object) => Promise<{models: object[], measuredAt: string, shape: string}>} the handler.
 */
export function createDeepinfraProbe({ env = process.env, fetchImpl = globalThis.fetch, now = Date.now } = {}) {
  return async function deepinfraProbe(layer, options = {}) {
    const config = options.vendorConfig ?? options.config ?? {}
    const baseUrl = cfg(config, 'baseUrl') ?? DEFAULT_DEEPINFRA_BASE
    const apiKey = cfg(config, 'apiKey') ?? env.DEEPINFRA_API_KEY
    if (typeof apiKey !== 'string' || apiKey === '') {
      throw new ProbeError('deepinfra probe needs an apiKey slot or DEEPINFRA_API_KEY', 'PROBE_FAILED')
    }
    const extraHeaders = cfg(config, 'extraHeaders', {})
    const result = await probeCatalog(
      { source: 'probe', kind: 'api', shape: 'openai', endpoint: '/models' },
      {
        baseUrl,
        apiKey,
        headers: extraHeaders,
        fetchImpl: options.fetchImpl ?? fetchImpl,
        signal: options.signal,
        now: now(),
      },
    )
    return { models: result.models, measuredAt: result.measuredAt, shape: 'openai' }
  }
}
