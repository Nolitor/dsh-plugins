/** Vendor seam only: @nolit/dsh-custom-router owns the OpenCodex bridge. */
import { applySelection } from '../../../lib/vendor-bridge.js'

export function syncAntigravitySelection(enabled) {
  return applySelection({ provider: 'google-antigravity', enabled })
}
