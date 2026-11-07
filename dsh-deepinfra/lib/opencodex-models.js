/** Vendor seam only: @nolit/dsh-custom-router owns the OpenCodex bridge. */
import { applySelection } from '@nolit/dsh-custom-router/vendor-bridge'

export function syncDeepInfraSelection(enabled) {
  return applySelection({ provider: 'deepinfra', enabled })
}
