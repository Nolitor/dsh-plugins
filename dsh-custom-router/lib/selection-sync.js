import { bridgeConfig, DEFAULT_OPENCODEX_MODELS_URL } from './config.js'
import { createOpenCodexClient } from './opencodex-client.js'
import { projectSelection } from './selection-projector.js'
import { scopeFromProjection } from './scope-aggregator.js'

export { DEFAULT_OPENCODEX_MODELS_URL }

/**
 * Mirror one vendor's DSH selection into OpenCodex.
 *
 * Two independent writes, in this order:
 *   1. the provider allowlist (what the catalog advertises), and
 *   2. the shared DSH client key's scope (what that key may actually call).
 *
 * The key write is skipped — with a reason, never silently — unless every
 * configured provider has an explicit allowlist, because a union cannot express
 * "this provider serves everything".
 */
export function createSelectionSync(options = {}) {
  const config = options.config ?? bridgeConfig(options.env)
  const client = options.client ?? createOpenCodexClient({
    url: config.url,
    managementToken: config.managementToken,
    fetchImpl: options.fetchImpl,
  })
  const keyId = options.keyId ?? (() => config.keyId)

  return {
    async apply({ provider, enabled, activePlan }) {
      const projection = await client.selectedModels()
      const available = projection?.available?.[provider] ?? []
      const selection = projectSelection({ provider, enabled, activePlan, available })
      const result = await client.selectModels(selection.provider, selection.models)

      const id = keyId()
      let scope = { allowedModels: null, reason: 'no-shared-key' }
      if (id) {
        const after = await client.selectedModels()
        scope = scopeFromProjection(after)
        if (scope.allowedModels !== null) await client.scopeKey(id, scope.allowedModels)
      }
      return { ...result, available, scope }
    },
  }
}

let singleton

/** One registry per host process: the union must not depend on load order. */
export function sharedSelectionSync(options = {}) {
  if (!singleton) singleton = createSelectionSync(options)
  return singleton
}

export function resetSharedSelectionSync() {
  singleton = undefined
}

/** Vendor-facing entry point. Vendors never own the URL or the key id. */
export function applySelection({ provider, enabled, activePlan }) {
  return sharedSelectionSync().apply({ provider, enabled, activePlan })
}
