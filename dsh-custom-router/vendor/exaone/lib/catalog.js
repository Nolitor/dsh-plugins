/**
 * Static catalog for the EXAONE API Platform route.
 *
 * EXAONE publishes one chat model and no catalog listing endpoint in its
 * documentation (docs.exaone.ai, read 2026-11-13). The model row is therefore
 * declared here as measured documentation data, not fetched:
 *
 *   model          k-exaone_v2.5
 *   endpoint       POST https://api.exaone.ai/v1/chat/completions
 *   context        524,288 tokens (input + max_tokens must not exceed it)
 *   output         advertised up to 512K by the platform; a turn reserves
 *                  `turnMaxTokens` (default 16,384) instead of the whole window
 *   reasoning      always on; `reasoning_effort` low | high | max (default max)
 *   modalities     text
 *
 * @module @nolit/dsh-exaone/catalog
 */

/** Provider route this package owns. */
export const PROVIDER_ID = 'exaone'

/** The one chat model the platform serves. */
export const MODEL_ID = 'k-exaone_v2.5'

/** Display name the model selector shows. */
export const MODEL_NAME = 'K-EXAONE 2.5'

/** Documented context window (input + max_tokens ceiling). */
export const CONTEXT_WINDOW = 524288

/** Per-turn completion reservation when the operator sets none. */
export const DEFAULT_TURN_MAX_TOKENS = 16384

/** Reasoning efforts EXAONE accepts, in the platform's own order. */
export const REASONING_EFFORTS = Object.freeze([
  Object.freeze({ id: 'low', name: 'Low' }),
  Object.freeze({ id: 'high', name: 'High' }),
  Object.freeze({ id: 'max', name: 'Max' }),
])

/** Platform default when the caller names no effort. */
export const DEFAULT_EFFORT = 'max'

/** Effort ids, for fast validation. */
const EFFORT_IDS = new Set(REASONING_EFFORTS.map((effort) => effort.id))

/**
 * Whether one effort id is one the platform accepts.
 * @param {unknown} id - candidate effort.
 * @returns {boolean} true when supported.
 */
export function isSupportedEffort(id) {
  return typeof id === 'string' && EFFORT_IDS.has(id)
}

/**
 * Every advertised model id, filtered by the operator's `enabledModels`.
 *
 * An empty list means "serve the declared set" (the same convention every
 * router vendor uses), never "serve nothing".
 * @param {unknown} enabledModels - configured allow-list.
 * @returns {string[]} the model ids to advertise.
 */
export function enabledModelIds(enabledModels) {
  if (!Array.isArray(enabledModels) || enabledModels.length === 0) return [MODEL_ID]
  const allowed = new Set(enabledModels.filter((id) => typeof id === 'string' && id.length > 0))
  return allowed.has(MODEL_ID) ? [MODEL_ID] : []
}

/**
 * The host's advisory model list for this provider.
 * @param {string} provider - registered route.
 * @param {unknown} [enabledModels] - configured allow-list.
 * @returns {Array<{provider: string, id: string, name: string}>} model identities.
 */
export function listModels(provider, enabledModels) {
  return enabledModelIds(enabledModels).map((id) => ({
    provider,
    id,
    name: id === MODEL_ID ? MODEL_NAME : id,
  }))
}

/**
 * Exact-route metadata the host uses for context, reservation and efforts.
 * @param {string} provider - registered route.
 * @param {string} model - requested model id.
 * @param {{defaultMaxTokens?: number, defaultEffort?: string}} [options] - turn policy.
 * @returns {object} host `LlmResolvedModelInfo`-shaped metadata.
 */
export function resolveModel(provider, model, options = {}) {
  const reservation = Number.isFinite(options.defaultMaxTokens) && options.defaultMaxTokens > 0
    ? Math.min(options.defaultMaxTokens, CONTEXT_WINDOW)
    : DEFAULT_TURN_MAX_TOKENS
  const effort = isSupportedEffort(options.defaultEffort) ? options.defaultEffort : DEFAULT_EFFORT
  return {
    provider,
    id: typeof model === 'string' && model !== '' ? model : MODEL_ID,
    name: MODEL_NAME,
    context: { contextWindow: CONTEXT_WINDOW },
    defaultMaxTokens: reservation,
    reasoning: {
      efforts: REASONING_EFFORTS.map((entry) => ({ ...entry })),
      defaultEffort: effort,
    },
  }
}

/**
 * The models-panel payload.
 *
 * The router's generic catalog reader accepts a flat `models` array. `enabled`
 * reflects the saved allow-list so the checkboxes open in the saved state.
 * @param {{enabledModels?: unknown}} [options] - live config view.
 * @returns {{models: object[], enabled: string[], total: number}} panel data.
 */
export function describeModels({ enabledModels } = {}) {
  const enabled = enabledModelIds(enabledModels)
  return {
    models: [{
      id: MODEL_ID,
      name: MODEL_NAME,
      contextWindow: CONTEXT_WINDOW,
      maxTokens: CONTEXT_WINDOW,
      reasoning: true,
      vision: false,
      enabled: enabled.includes(MODEL_ID),
    }],
    enabled,
    total: 1,
  }
}
