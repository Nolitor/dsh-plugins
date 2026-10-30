/**
 * Runtime conflict guard for the autonomous OpenCode HTTP router.
 *
 * Target architecture: every model-serving plugin owns its own provider
 * namespace directly. This module is the narrow seam that detects when a
 * legacy adapter (llm-pi-ai's `opencode-go` / `opencode` routes) or a second
 * copy of this plugin is already registered, and decides whether this instance
 * should serve, warn, or stand down.
 *
 * The module is deliberately pure: no Cordis import, no I/O, no logging. The
 * caller passes a read-only snapshot of the live registry (the real shape is
 * `LlmProviderInfo[]`, i.e. `{ id, name }`), so every decision is unit
 * testable without a host.
 *
 * `warn` (default) keeps the native route and records that a duplicate model
 * family is exposed. `stand-down` yields the namespace: it does not register
 * (or releases its registration) while a legacy provider is active, and
 * re-registers when the legacy provider disappears. No policy can unload
 * another plugin — a plugin must never mutate the host registry on behalf of a
 * sibling — so "deactivating llm-pi-ai" means this instance stepping aside,
 * not reaching into another plugin's fiber.
 */

/** Provider ids registered by `dsh-llm-pi-ai` for the OpenCode model plane. */
export const LEGACY_OPENCODE_PROVIDERS = Object.freeze(['opencode-go', 'opencode'])

/** Supported conflict reactions, least to most conservative. */
export const CONFLICT_POLICIES = Object.freeze(['warn', 'stand-down'])

/**
 * Normalize an untrusted policy value.
 *
 * Unknown values fall back to `warn` rather than throwing: a typo in a profile
 * must not stop the provider from serving, and the fallback is logged by the
 * caller through the returned warning.
 *
 * @param {unknown} value Raw config value.
 * @returns {'warn'|'stand-down'} Supported policy.
 */
export function normalizeConflictPolicy(value) {
  const policy = typeof value === 'string' ? value.trim().toLowerCase() : ''
  return CONFLICT_POLICIES.includes(policy) ? policy : 'warn'
}

/**
 * Read registered provider ids without letting a broken registry break apply().
 *
 * @param {*} llm The `llm` service (only `listProviders()` is used).
 * @returns {string[]} Unique provider ids in registration order.
 */
export function registeredProviderIds(llm) {
  let providers
  try {
    providers = llm?.listProviders?.() ?? []
  } catch {
    return []
  }
  if (!Array.isArray(providers)) return []
  return [...new Set(providers.map((entry) => String(entry?.id ?? '')).filter(Boolean))]
}

/**
 * Detect conflicts relevant to one native OpenCode route.
 *
 * @param {*} llm The `llm` service.
 * @param {string} ownProvider Provider id this instance registers.
 * @returns {{
 *   ownProvider: string,
 *   providerIds: string[],
 *   legacyProviders: string[],
 *   ownProviderRegistered: boolean,
 * }} Detached conflict facts.
 */
export function detectRouterConflicts(llm, ownProvider) {
  const providerIds = registeredProviderIds(llm)
  return {
    ownProvider,
    providerIds,
    legacyProviders: providerIds.filter((id) => LEGACY_OPENCODE_PROVIDERS.includes(id)),
    ownProviderRegistered: providerIds.includes(ownProvider),
  }
}

/**
 * Turn conflict facts + policy into one action.
 *
 * `skip` is reserved for a hard collision: another registration already owns
 * this exact provider id. Registering anyway would throw `DUPLICATE_ADAPTER`
 * in the host, so the second instance yields and says why.
 *
 * @param {ReturnType<typeof detectRouterConflicts>} conflict Detected facts.
 * @param {unknown} policy Configured policy.
 * @returns {{ action: 'serve'|'stand-down'|'skip', code: string, warning: string|null }}
 *   Decision; `warning` is set when the operator should know.
 */
export function decideRouterConflict(conflict, policy) {
  const normalized = normalizeConflictPolicy(policy)
  const own = conflict?.ownProvider || 'opencode-http-agent'

  if (conflict?.ownProviderRegistered) {
    return {
      action: 'skip',
      code: 'DUPLICATE_OWN_PROVIDER',
      warning:
        `dsh-opencode-v2-http: provider "${own}" is already registered by another instance; `
        + 'this instance stands down rather than creating a second OpenCode server/SQLite owner.',
    }
  }

  const legacy = Array.isArray(conflict?.legacyProviders) ? [...conflict.legacyProviders] : []
  if (legacy.length === 0) {
    return { action: 'serve', code: 'CLEAR', warning: null }
  }

  const names = legacy.map((id) => `"${id}"`).join(', ')
  if (normalized === 'stand-down') {
    return {
      action: 'stand-down',
      code: 'LEGACY_OPENCODE_PROVIDER',
      warning:
        `dsh-opencode-v2-http: legacy OpenCode provider ${names} is active and `
        + "conflictPolicy is 'stand-down'; yielding the OpenCode namespace (no registration).",
    }
  }
  return {
    action: 'serve',
    code: 'LEGACY_OPENCODE_PROVIDER',
    warning:
      `dsh-opencode-v2-http: legacy OpenCode provider ${names} is active (llm-pi-ai?); `
      + `serving "${own}" alongside it duplicates the OpenCode model family. `
      + "Set conflictPolicy: 'stand-down' to yield instead.",
  }
}
