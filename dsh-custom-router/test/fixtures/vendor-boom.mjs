/**
 * A child plugin whose `apply` rejects ASYNCHRONOUSLY — the duplicate
 * registration case the router's mount seam must survive.
 *
 * Measured on cordis 4.0.5: `ctx.plugin()` returns normally for this plugin and
 * only the fiber settles at state 3, so a `try/catch` around the call alone never
 * sees the failure. `await fiber` rethrows it. This fixture exists to keep that
 * distinction under test.
 */
export const name = 'fixture-vendor-boom'
export const inject = []
export async function apply() {
  throw new Error('duplicate provider registration')
}
export default { name, inject, apply }
