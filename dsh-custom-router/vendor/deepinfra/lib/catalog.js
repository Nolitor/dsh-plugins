/**
 * DeepInfra model catalog: fetch, cache, and project onto host metadata.
 *
 * Measured 2026-11-14 against https://api.deepinfra.com/v1/openai/models (and
 * first measured 2026-11-04):
 *   - PUBLIC: HTTP 200 with no Authorization header, 178 entries, 119,966 bytes.
 *     A cold start therefore never fails on auth; a missing key only fails the
 *     first completion.
 *   - 92 chat-tagged routes. Every one of the 92 carries `context_length`,
 *     `max_tokens` and a `pricing` object -- the brief expected 57 of 148 to
 *     have no context_length; that count came from all entries, not chat routes.
 *   - On all 92 routes `max_tokens === context_length`. There is no separate
 *     output cap in the catalog, so the "hard 16,384 output cap" in the brief is
 *     NOT a catalog fact: HTTP accepts max_tokens well above it (see wire.js).
 *   - Tags: chat 92, vlm 54, vision 54, prompt_cache 46, reasoning 67,
 *     reasoning_effort 36, embed 25, tts 13, image-gen 27, video-gen 14, stt 7.
 *   - `metadata.discount` is a fraction to subtract (0.3 => pay 70%), present on
 *     8 chat routes (0.05-0.51). Verified by fitting provider-reported cost.
 */

/** Catalog endpoint. Public; no credential needed. */
export const MODELS_PATH = '/models'

/**
 * Live platform metrics.
 *
 * Measured 2026-11-05: `GET /v1/metrics/live` returns platform-wide throughput, not
 * anything about this account or this request:
 *
 *   {"tokens_per_second":85070217.47,"time_to_first_token":0.565,
 *    "requests_per_second":4594.63,"total_tflops":24780714.0}
 *
 * It is therefore a STATUS surface (shown in the settings card), never an input to
 * cost. Treating platform-wide throughput as a per-request quantity would be a
 * fabricated number.
 */
export const METRICS_LIVE_PATH = '/v1/metrics/live'

/**
 * Per-request authoritative billing, as documented by DeepInfra.
 *
 * `POST /v1/request-costs { requestIds: string[] }` ->
 * `{ requests: [{ requestId, costNanoUsd }] }`.
 *
 * Measured 2026-11-05: documented in the OpenAPI spec (`/v1/request-costs` is
 * present at `api.deepinfra.com/openapi.json`) and it VALIDATES the payload
 * (a wrong shape returns 422 naming `body.requestIds`), but every correctly shaped
 * call from this account answers **404 Not Found**. The route is documented and
 * undeployed for this credential, so the adapter treats it as optional and falls
 * back to the wire's own `usage.estimated_cost`.
 */
export const REQUEST_COSTS_PATH = '/v1/request-costs'

/**
 * Query live platform metrics.
 * @param {string} origin - API origin, e.g. `https://api.deepinfra.com`.
 * @param {{ fetchImpl?: Function, signal?: AbortSignal }} [options] - seams.
 * @returns {Promise<object|null>} the metrics object, or null when unavailable.
 */
export async function fetchLiveMetrics(origin, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  try {
    const response = await fetchImpl(String(origin).replace(/\/$/, '') + METRICS_LIVE_PATH, {
      method: 'GET',
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    if (!response.ok) return null
    const body = await response.json()
    return body !== null && typeof body === 'object' ? body : null
  } catch {
    // Metrics are decoration; an unavailable platform surface must not fail a turn.
    return null
  }
}

/**
 * Ask DeepInfra what a request actually cost, by its id.
 *
 * @param {string} origin - API origin.
 * @param {string} requestId - the `x-request-id` header value from the completion.
 * @param {{ fetchImpl?: Function, signal?: AbortSignal }} [options] - seams.
 * @returns {Promise<number|null>} billed USD, or null when the endpoint is not
 *   deployed for this credential.
 */
export async function fetchRequestCost(origin, requestId, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof requestId !== 'string' || requestId.length === 0) return null
  try {
    const response = await fetchImpl(String(origin).replace(/\/$/, '') + REQUEST_COSTS_PATH, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ requestIds: [requestId] }),
      ...(options.signal === undefined ? {} : { signal: options.signal }),
    })
    if (!response.ok) return null
    const body = await response.json()
    const item = Array.isArray(body?.requests) ? body.requests[0] : undefined
    const nano = item?.costNanoUsd
    if (typeof nano !== 'number' || !Number.isFinite(nano) || nano < 0) return null
    // costNanoUsd is integer nano-USD: 1e9 nano = 1 USD.
    return nano / 1e9
  } catch {
    return null
  }
}

/** Cache file name under `$DSH_HOME/cache`. */
export const CACHE_FILE = 'deepinfra-models.json'

/** How long a fetched catalog stays authoritative before a refetch is attempted. */
export const DEFAULT_CATALOG_TTL_MS = 30 * 60 * 1000

/**
 * Reasoning efforts DeepInfra accepts, least to greatest.
 *
 * This is the provider's own enum, not an invention: sending anything else
 * returns HTTP 422 "Input should be 'none', 'minimal', 'low', 'medium', 'high',
 * 'xhigh' or 'max'". Ordered as the host requires for a selectable list.
 */
export const REASONING_EFFORTS = Object.freeze([
  { id: 'none', name: 'None' },
  { id: 'minimal', name: 'Minimal' },
  { id: 'low', name: 'Low' },
  { id: 'medium', name: 'Medium' },
  { id: 'high', name: 'High' },
  { id: 'xhigh', name: 'Extra high' },
  { id: 'max', name: 'Max' },
])

/** Effort members by id, for fast validation. */
const EFFORT_IDS = new Set(REASONING_EFFORTS.map((effort) => effort.id))

/**
 * Whether a reasoning effort id is one the provider accepts.
 * @param id - candidate effort id.
 * @returns true when the provider's enum contains it.
 */
export function isSupportedEffort(id) {
  return typeof id === 'string' && EFFORT_IDS.has(id)
}

/**
 * Query the public catalog.
 *
 * @param baseURL - provider base URL, without a trailing slash.
 * @param options - `{ fetchImpl, signal, headers }`.
 * @returns the raw entry array.
 * @throws when the endpoint fails or returns an unusable body.
 */
export async function fetchCatalog(baseURL, options = {}) {
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') throw new Error('DeepInfra catalog: no fetch implementation')
  const url = `${baseURL}${MODELS_PATH}`
  const response = await fetchImpl(url, {
    method: 'GET',
    headers: { ...(options.headers ?? {}) },
    ...(options.signal === undefined ? {} : { signal: options.signal }),
  })
  if (!response.ok) {
    throw new Error(`DeepInfra catalog: HTTP ${response.status} from ${MODELS_PATH}`)
  }
  const body = await response.json()
  const entries = Array.isArray(body?.data) ? body.data : undefined
  if (entries === undefined) throw new Error('DeepInfra catalog: response has no data array')
  return entries
}

/**
 * Keep only text-generation routes the host can actually drive.
 *
 * "Chat-tagged" is the filter, not "not an embedding": image-gen, tts, stt and
 * video-gen entries each carry their own tag and none carry `chat`.
 *
 * @param entries - raw catalog entries.
 * @returns chat entries, in catalog order.
 */
export function chatRoutes(entries) {
  if (!Array.isArray(entries)) return []
  return entries.filter((entry) => {
    if (entry == null || typeof entry.id !== 'string' || entry.id.length === 0) return false
    const tags = entry.metadata?.tags
    return Array.isArray(tags) && tags.includes('chat')
  })
}

/**
 * Project one catalog entry onto the host's advisory model metadata.
 *
 * Reasoning is advertised ONLY when the route's own tags promise it. Measured
 * counter-example to the brief's rule: 7 routes carry `reasoning_effort` without
 * `reasoning`, and a route carrying neither can still stream reasoning when an
 * effort is sent (deepseek-ai/DeepSeek-V3.2 emitted 50 reasoning deltas with
 * `reasoning_effort:"high"` and none without it). Tags are therefore a
 * conservative advertisement, not a complete description -- and the adapter
 * accepts an effort on any route, since the provider accepts it on any route.
 *
 * @param provider - registered provider route.
 * @param entry - one catalog entry.
 * @returns host `LlmModelInfo`-shaped metadata.
 */
export function toModelInfo(provider, entry) {
  const tags = Array.isArray(entry.metadata?.tags) ? entry.metadata.tags : []
  /** @type {{ provider: string, id: string, name: string, description?: string, inputModalities?: string[] }} */
  const info = {
    provider,
    id: entry.id,
    name: entry.id,
  }
  const description = typeof entry.metadata?.description === 'string' ? entry.metadata.description.trim() : ''
  if (description.length > 0) info.description = description
  // The host understands exactly text|image. "vision" and "vlm" are the same
  // capability under two DeepInfra tag names, and 52 routes carry both.
  if (tags.includes('vision') || tags.includes('vlm')) info.inputModalities = ['text', 'image']
  return info
}

/**
 * Project one catalog entry onto the host's exact-route metadata.
 *
 * @param provider - registered provider route.
 * @param entry - one catalog entry.
 * @param options - `{ defaultMaxTokens }` the per-turn completion reservation.
 * @returns host `LlmResolvedModelInfo`-shaped metadata.
 */
export function toResolvedModelInfo(provider, entry, options = {}) {
  const info = toModelInfo(provider, entry)
  const tags = Array.isArray(entry.metadata?.tags) ? entry.metadata.tags : []
  const contextWindow = positiveInteger(entry.metadata?.context_length)
  if (contextWindow !== undefined) info.context = { contextWindow }
  // The catalog's max_tokens EQUALS context_length on all 92 chat routes, so it
  // describes capacity, not a per-response cap. Advertising it as defaultMaxTokens
  // would reserve the whole window for one completion. The reservation comes from
  // the caller's turn policy instead.
  const reservation = positiveInteger(options.defaultMaxTokens)
  if (reservation !== undefined) {
    info.defaultMaxTokens = contextWindow === undefined ? reservation : Math.min(reservation, contextWindow)
  }
  if (tags.includes('reasoning') || tags.includes('reasoning_effort')) {
    info.reasoning = { efforts: REASONING_EFFORTS.map((effort) => ({ ...effort })) }
    if (isSupportedEffort(options.defaultEffort)) info.reasoning.defaultEffort = options.defaultEffort
  }
  return info
}

/**
 * Promotional pricing for one route.
 *
 * The catalog publishes exactly one promotion signal: `metadata.discount`, a
 * fraction of list price the operator does not pay. Re-measured 2026-11-14 on the
 * 92 chat routes: 8 carry a discount, from 0.05 (pay 95%) to 0.51 (pay 49%). There is
 * no "featured" or "promo" tag — the tag vocabulary is capability only
 * (chat, vision, vlm, reasoning, reasoning_effort, prompt_cache, embed, tts,
 * stt, image-gen, video-gen), so a promotion MUST be derived from the discount.
 *
 * @param {object} entry - one catalog entry.
 * @returns {{ discount: number, paysRatio: number, percentOff: number }|null}
 *   the promotion, or null when the route is at list price.
 */
export function promotionOf(entry) {
  const discount = entry?.metadata?.discount
  if (typeof discount !== 'number' || !Number.isFinite(discount) || discount <= 0 || discount >= 1) return null
  return {
    discount,
    paysRatio: 1 - discount,
    // Rounded because the catalog carries values like 0.375 and a badge must not
    // claim "62.5% off".
    percentOff: Math.round(discount * 100),
  }
}

/**
 * Effective price of one route, at list and after any promotion.
 *
 * @param {object} entry - one catalog entry.
 * @returns {{ input: number|null, output: number|null, cacheRead: number|null,
 *   listInput: number|null, listOutput: number|null, promotion: object|null }}
 *   prices in USD per million tokens.
 */
export function pricesOf(entry) {
  const pricing = entry?.metadata?.pricing
  const promotion = promotionOf(entry)
  const ratio = promotion === null ? 1 : promotion.paysRatio
  const rate = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null)
  const input = rate(pricing?.input_tokens)
  const output = rate(pricing?.output_tokens)
  const cacheRead = rate(pricing?.cache_read_tokens)
  return {
    input: input === null ? null : input * ratio,
    output: output === null ? null : output * ratio,
    cacheRead: cacheRead === null ? null : cacheRead * ratio,
    listInput: input,
    listOutput: output,
    promotion,
  }
}

/**
 * Build a lookup index over the chat routes.
 * @param entries - raw catalog entries.
 * @returns a Map from model id to entry.
 */
export function indexRoutes(entries) {
  const index = new Map()
  for (const entry of chatRoutes(entries)) index.set(entry.id, entry)
  return index
}

/**
 * Read one non-negative integer field.
 * @param value - candidate value.
 * @returns the integer, or undefined when it is not one.
 */
function positiveInteger(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.trunc(value)
}
