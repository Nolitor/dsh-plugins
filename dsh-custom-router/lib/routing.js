/**
 * Routing — pick the preset that serves a model id.
 *
 * Resolution order (deterministic, no heuristics beyond the declared prefixes):
 *   1. an explicit `presetId` (the caller already knows);
 *   2. an explicit `providerId` (matches `preset.providerId`);
 *   3. the model id's prefix before the first `/` against `preset.modelPrefixes`.
 *
 * A prefix shared by two presets is an error, not a silent pick: the router must
 * never route to the wrong vendor. Pure module: no host context, no I/O.
 *
 * @module @nolit/dsh-custom-router/routing
 */
import { PRESETS } from './presets.js'

/**
 * Normalize the query argument.
 * @param {string|object} query - model id string or `{modelId, providerId, presetId}`.
 * @returns {{modelId?: string, providerId?: string, presetId?: string}} the normalized query.
 */
function normalizeQuery(query) {
  if (typeof query === 'string') return { modelId: query }
  if (query === null || typeof query !== 'object') return {}
  return {
    modelId: typeof query.modelId === 'string' ? query.modelId : undefined,
    providerId: typeof query.providerId === 'string' ? query.providerId : undefined,
    presetId: typeof query.presetId === 'string' ? query.presetId : undefined,
  }
}

/** The prefix a model id carries before its first `/`, if any. */
export function modelPrefix(modelId) {
  if (typeof modelId !== 'string') return undefined
  const index = modelId.indexOf('/')
  return index === -1 ? undefined : modelId.slice(0, index)
}

/**
 * Resolve the preset for one query.
 * @param {string|object} query - model id or `{modelId, providerId, presetId}`.
 * @param {readonly object[]} [presets] - declarations (defaults to the measured set).
 * @returns {{ok: boolean, preset?: object, modelId?: string, matchedBy?: 'preset'|'provider'|'prefix', error?: string}} the decision.
 */
export function resolvePreset(query, presets = PRESETS) {
  const { modelId, providerId, presetId } = normalizeQuery(query)

  if (presetId !== undefined) {
    const preset = presets.find((candidate) => candidate.id === presetId)
    if (preset === undefined) return { ok: false, error: `unknown preset "${presetId}"` }
    return { ok: true, preset, modelId: modelId ?? '', matchedBy: 'preset' }
  }

  if (providerId !== undefined) {
    const matches = presets.filter((candidate) => candidate.providerId === providerId)
    if (matches.length === 1) return { ok: true, preset: matches[0], modelId: modelId ?? '', matchedBy: 'provider' }
    if (matches.length > 1) return { ok: false, error: `provider "${providerId}" is claimed by ${matches.map((preset) => preset.id).join(', ')}` }
  }

  if (modelId !== undefined) {
    const prefix = modelPrefix(modelId)
    if (prefix !== undefined) {
      const matches = presets.filter((candidate) => (candidate.modelPrefixes ?? []).includes(prefix))
      if (matches.length === 1) return { ok: true, preset: matches[0], modelId, matchedBy: 'prefix' }
      if (matches.length > 1) {
        return { ok: false, error: `model prefix "${prefix}" is claimed by ${matches.map((preset) => preset.id).join(', ')}` }
      }
    }
    // A bare model id (no prefix) can only route when exactly one preset is
    // declared; guessing among several would pick the wrong vendor.
    if (presets.length === 1) return { ok: true, preset: presets[0], modelId, matchedBy: 'prefix' }
  }

  return { ok: false, error: `no preset serves ${modelId ?? providerId ?? '(empty query)'}` }
}

/**
 * Resolve the routing view of one query: the preset plus the endpoint/auth
 * fields the caller needs before probing or mounting.
 * @param {string|object} query - model id or `{modelId, providerId, presetId}`.
 * @param {readonly object[]} [presets] - declarations.
 * @returns {{ok: boolean, preset?: object, modelId?: string, endpoint?: object, auth?: object, matchedBy?: string, error?: string}} the route.
 */
export function resolveRoute(query, presets = PRESETS) {
  const decision = resolvePreset(query, presets)
  if (!decision.ok) return decision
  return {
    ...decision,
    endpoint: decision.preset.endpoint,
    auth: decision.preset.auth,
  }
}
