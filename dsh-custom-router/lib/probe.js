/**
 * Probe executor — layer 2 of the catalog/price model.
 *
 * Fetches the endpoint's own model list and normalizes it into catalog entries
 * the merger understands. Only the shapes the router can prove are implemented:
 *
 *   - `openai`    — `GET {baseURL}{endpoint}` → `{ data: [{ id, ... }] }` (or a bare array)
 *   - `anthropic` — `GET {baseURL}{endpoint}` → `{ data: [{ id, display_name }] }`, one page
 *   - `vendor`    — the endpoint answers a provider-specific RPC whose parser the
 *                   vendor plugin already owns; the router refuses to re-implement it
 *
 * Pure-ish: the network call is injected (`fetchImpl`), so tests never touch the
 * network and the caller owns credentials and cancellation.
 *
 * @module @nolit/dsh-custom-router/probe
 */

/**
 * Resolve one vendor-owned probe layer.
 *
 * Connection order (owner decision: the router never re-implements a vendor RPC):
 *   1. an explicit handler (`options.vendorProbes[presetId]`);
 *   2. the host discovery seam (`ctx.llm.discoverModels(layer.namespace, …)`) when the
 *      vendor registered one under that settings namespace;
 *   3. otherwise `VENDOR_OWNED` — the vendor must supply one of the two.
 * @param {object} layer - probe layer.
 * @param {object} preset - owning preset.
 * @param {object} options - probe options plus `ctx`/`vendorProbes`.
 * @returns {Promise<{models: object[], measuredAt: string, shape: string}>} normalized models.
 */
export async function probeVendor(layer, preset, options = {}) {
  const handler = options.vendorProbes?.[preset?.id]
  if (typeof handler === 'function') {
    // Scope the flexible slots per preset: `vendorConfig[presetId]` wins over a
    // flat config object, so one profile can carry several providers' overrides.
    const scoped = options.vendorConfig !== null && typeof options.vendorConfig === 'object' && preset?.id !== undefined
      && options.vendorConfig[preset.id] !== null && typeof options.vendorConfig[preset.id] === 'object'
      ? options.vendorConfig[preset.id]
      : options.vendorConfig
    const result = await handler(layer, { ...options, vendorConfig: scoped ?? {} })
    return {
      models: Array.isArray(result?.models) ? result.models : [],
      measuredAt: result?.measuredAt ?? new Date(options.now ?? Date.now()).toISOString(),
      shape: 'vendor',
    }
  }
  const discoverModels = options.ctx?.llm?.discoverModels
  if (typeof discoverModels === 'function' && typeof layer.namespace === 'string' && layer.namespace !== '') {
    const discovered = await discoverModels(
      layer.namespace,
      { provider: preset?.providerId, baseURL: options.baseUrl, ...(options.apiKey === undefined ? {} : { apiKey: options.apiKey }) },
      options.signal,
    )
    const models = (Array.isArray(discovered) ? discovered : []).map((model) => ({
      id: model.id,
      name: model.name ?? model.id,
      ...(model.inputModalities === undefined ? {} : { input: model.inputModalities }),
    })).filter((model) => typeof model.id === 'string' && model.id !== '')
    return { models, measuredAt: new Date(options.now ?? Date.now()).toISOString(), shape: 'vendor' }
  }
  throw new ProbeError(
    `probe endpoint "${layer.endpoint}" is a vendor RPC and no vendor probe is connected; the owning plugin must pass vendorProbes["${preset?.id}"] or register discovery under "${layer.namespace ?? '(no namespace)'}"`,
    'VENDOR_OWNED',
  )
}

/** Error with a stable code so callers can branch without string matching. */
export class ProbeError extends Error {
  /**
   * @param {string} message - diagnostic text.
   * @param {string} code - stable code.
   * @param {object} [cause] - optional cause.
   */
  constructor(message, code, cause) {
    super(message, cause === undefined ? undefined : { cause })
    this.name = 'ProbeError'
    this.code = code
  }
}

/** Anthropic requires the protocol version header. */
export const ANTHROPIC_VERSION = '2023-06-01'

/**
 * Normalize an OpenAI-shaped listing.
 * @param {unknown} body - parsed JSON.
 * @returns {object[]} catalog entries.
 */
export function parseOpenAIListing(body) {
  const items = Array.isArray(body) ? body : Array.isArray(body?.data) ? body.data : []
  const models = []
  for (const item of items) {
    if (item === null || typeof item !== 'object' || typeof item.id !== 'string' || item.id === '') continue
    const entry = { id: item.id, name: typeof item.name === 'string' && item.name !== '' ? item.name : item.id }
    const contextWindow = item.context_length ?? item.context_window ?? item.max_model_len
    if (typeof contextWindow === 'number' && contextWindow > 0) entry.contextWindow = contextWindow
    const maxTokens = item.max_output_tokens ?? item.max_completion_tokens
    if (typeof maxTokens === 'number' && maxTokens > 0) entry.maxTokens = maxTokens
    models.push(entry)
  }
  return models
}

/**
 * Normalize an Anthropic-shaped listing (one page; `has_more` is not followed).
 * @param {unknown} body - parsed JSON.
 * @returns {object[]} catalog entries.
 */
export function parseAnthropicListing(body) {
  const items = Array.isArray(body?.data) ? body.data : []
  const models = []
  for (const item of items) {
    if (item === null || typeof item !== 'object' || typeof item.id !== 'string' || item.id === '') continue
    models.push({
      id: item.id,
      name: typeof item.display_name === 'string' && item.display_name !== '' ? item.display_name : item.id,
    })
  }
  return models
}

/**
 * Build the absolute probe URL.
 * @param {string} baseUrl - base URL (may be empty for a daemon).
 * @param {string} endpoint - endpoint path starting with `/`.
 * @returns {string} the URL.
 */
export function probeUrl(baseUrl, endpoint) {
  if (typeof baseUrl !== 'string') throw new ProbeError('probe needs a baseUrl', 'INVALID_PROBE')
  return `${baseUrl.replace(/\/+$/, '')}${endpoint}`
}

/**
 * Execute one probe layer.
 * @param {object} layer - `{ source: 'probe', kind, shape?, endpoint, ttlMs? }`.
 * @param {object} options - `{ baseUrl, apiKey?, resolveToken?, fetchImpl?, headers?, signal?, now? }`.
 * @returns {Promise<{models: object[], measuredAt: string, shape: string}>} normalized models.
 * @throws {ProbeError} on a vendor-owned shape, a non-2xx answer, or an unreadable body.
 */
export async function probeCatalog(layer, options = {}) {
  if (layer === null || typeof layer !== 'object' || layer.source !== 'probe') {
    throw new ProbeError('probeCatalog requires a probe layer', 'INVALID_PROBE')
  }
  const shape = layer.shape ?? 'openai'
  if (shape === 'vendor') {
    throw new ProbeError(
      `probe endpoint "${layer.endpoint}" is a vendor RPC; the owning plugin parses it, not the router`,
      'VENDOR_OWNED',
    )
  }
  if (shape !== 'openai' && shape !== 'anthropic') {
    throw new ProbeError(`unsupported probe shape "${shape}"`, 'INVALID_PROBE')
  }
  if (typeof layer.endpoint !== 'string' || !layer.endpoint.startsWith('/')) {
    throw new ProbeError('probe endpoint must start with "/"', 'INVALID_PROBE')
  }
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new ProbeError('no fetch implementation is available', 'NO_FETCH')

  const headers = new Headers(options.headers ?? {})
  headers.set('accept', 'application/json')
  const apiKey = options.apiKey ?? (typeof options.resolveToken === 'function' ? await options.resolveToken() : undefined)
  if (shape === 'anthropic') {
    headers.set('anthropic-version', ANTHROPIC_VERSION)
    if (apiKey !== undefined && apiKey !== '') headers.set('x-api-key', apiKey)
  } else if (apiKey !== undefined && apiKey !== '') {
    headers.set('authorization', `Bearer ${apiKey}`)
  }

  const url = probeUrl(options.baseUrl, layer.endpoint)
  let response
  try {
    response = await fetchImpl(url, {
      method: 'GET',
      headers,
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
  } catch (error) {
    throw new ProbeError(`could not reach ${url}`, 'PROBE_FAILED', error)
  }
  if (!response.ok) {
    throw new ProbeError(`${url} answered ${response.status}`, 'PROBE_FAILED')
  }
  let body
  try {
    body = await response.json()
  } catch (error) {
    throw new ProbeError(`${url} did not answer with JSON`, 'PROBE_FAILED', error)
  }
  const models = shape === 'anthropic' ? parseAnthropicListing(body) : parseOpenAIListing(body)
  const measuredAt = new Date(options.now ?? Date.now()).toISOString()
  return { models, measuredAt, shape }
}

/**
 * Execute every executable probe layer of a preset in order.
 * @param {object} preset - preset declaration.
 * @param {object} options - see {@link probeCatalog}, plus `skipVendor` (default true).
 * @returns {Promise<{models: object[], measuredAt: string, errors: {endpoint: string, code: string, message: string}[]}>} merged layer-2 data.
 */
export async function probePreset(preset, options = {}) {
  const layers = (preset?.catalog?.layers ?? []).filter((layer) => layer?.source === 'probe')
  const models = []
  const errors = []
  let measuredAt = new Date(options.now ?? Date.now()).toISOString()
  for (const layer of layers) {
    try {
      const result = layer.shape === 'vendor'
        ? await probeVendor(layer, preset, options)
        : await probeCatalog(layer, options)
      models.push(...result.models)
      measuredAt = result.measuredAt
    } catch (error) {
      if (error instanceof ProbeError && error.code === 'VENDOR_OWNED' && options.skipVendor !== false) continue
      errors.push({
        endpoint: layer.endpoint,
        code: error instanceof ProbeError ? error.code : 'PROBE_FAILED',
        message: error instanceof Error ? error.message : String(error),
      })
    }
  }
  return { models, measuredAt, errors }
}
