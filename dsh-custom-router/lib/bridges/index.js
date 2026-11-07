/**
 * Vendor bridge registry — one handler per bridged provider.
 *
 * Bridged today:
 *   - antigravity — OAuth + digital-fingerprint RPC (`bridges/antigravity.js`)
 *   - opencode    — local daemon `/api/model` with Basic auth (`bridges/opencode.js`)
 *   - deepinfra   — standard OpenAI listing (thin wrapper over `probeCatalog`)
 *
 * Each handler accepts the same `(layer, {vendorConfig})` shape `probeVendor`
 * calls, and `vendorConfig` is scoped per preset by the caller.
 *
 * @module @nolit/dsh-custom-router/bridges
 */
import { createAntigravityProbe } from './antigravity.js'
import { createDeepinfraProbe } from './deepinfra.js'
import { createOpencodeProbe } from './opencode.js'

/** Provider ids that have a vendor bridge. */
export const BRIDGED_VENDORS = Object.freeze(['antigravity', 'opencode', 'deepinfra'])

/**
 * Build every available bridge from the loaded vendor modules.
 * @param {object} [options] - `{ modules, env, fetchImpl, now, readFile }`.
 * @returns {Record<string, Function>} `vendorProbes` map.
 */
export function createVendorBridges({ modules, env, fetchImpl, now, readFile } = {}) {
  const bridges = {}
  if (modules?.antigravity) {
    bridges.antigravity = createAntigravityProbe({ modules: modules.antigravity, env, fetchImpl, now })
  }
  if (modules?.opencode) {
    bridges.opencode = createOpencodeProbe({ modules: modules.opencode, env, fetchImpl, now, readFile })
  }
  // DeepInfra needs no vendor module: its listing is standard OpenAI.
  bridges.deepinfra = createDeepinfraProbe({ env, fetchImpl, now })
  return bridges
}
