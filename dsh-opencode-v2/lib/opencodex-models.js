/** Vendor seam only: @nolit/dsh-custom-router owns the OpenCodex bridge. */
import { applySelection } from '@nolit/dsh-custom-router/vendor-bridge'

/** DSH's OpenCode plan decides the provider namespace, not the vendor. */
export function syncOpenCodeSelection(enabled, { activePlan = 'go' } = {}) {
  return applySelection({ provider: 'opencode-go', enabled, activePlan })
}
