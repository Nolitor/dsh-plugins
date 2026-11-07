/** Providers whose allowlists must all be explicit before one shared key is scoped. */
export const SCOPABLE_PROVIDERS = Object.freeze([
  'opencode-go', 'opencode', 'deepinfra', 'google-antigravity',
])

export function scopedDestinations(selection) {
  return selection.models.map((id) => `${selection.provider}/${id}`)
}

/** Union of every provider's explicit selection, deduplicated. */
export function aggregateScopes(selections) {
  return [...new Set(selections.flatMap(scopedDestinations))]
}

/**
 * Decide the shared key's allowlist from OpenCodex's own current projection.
 *
 * A provider with no stored `selectedModels` serves EVERY model, which a union
 * cannot express. Scoping in that state would silently deny that provider, so
 * the caller must skip the key write instead of guessing.
 *
 * @param projection - `GET /api/selected-models` payload.
 * @returns `{ allowedModels, reason }`; `allowedModels` is null when unsafe.
 */
export function scopeFromProjection(projection) {
  const selected = projection?.selected ?? {}
  const available = projection?.available ?? {}
  const configured = SCOPABLE_PROVIDERS.filter((name) => Array.isArray(available[name]))
  if (configured.length === 0) return { allowedModels: null, reason: 'no-configured-provider' }
  const unrestricted = configured.filter((name) => !Array.isArray(selected[name]) || selected[name].length === 0)
  if (unrestricted.length > 0) {
    return { allowedModels: null, reason: 'provider-unrestricted:' + unrestricted.join(',') }
  }
  const selections = configured.map((name) => ({ provider: name, models: selected[name] }))
  return { allowedModels: aggregateScopes(selections), reason: 'complete' }
}
