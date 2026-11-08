/** Vendor seam only: @nolit/dsh-custom-router owns the OpenCodex bridge. */
import { applySelection } from '../../../lib/vendor-bridge.js'

export function syncDeepInfraSelection(enabled) {
  return applySelection({ provider: 'deepinfra', enabled })
}
