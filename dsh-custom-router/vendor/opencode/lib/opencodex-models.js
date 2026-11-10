/** Vendor seam only: @nolit/dsh-custom-router owns the OpenCodex bridge. */
import { applySelection } from '../../../lib/vendor-bridge.js'

/** DSH's OpenCode plan decides the provider namespace, not the vendor. */
export function syncOpenCodeSelection(enabled, { activePlan = 'go' } = {}) {
  return applySelection({ provider: 'opencode-go', enabled, activePlan })
}
