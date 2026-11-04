/**
 * Optional-service access for cordis contexts.
 *
 * cordis installs a proxy on `ctx`: reading a service the plugin did not declare
 * in `inject` **throws** instead of returning undefined -
 *
 *   Error: cannot get property "tools" without inject
 *
 * Measured 2026-11-04, on the live web profile: `dsh-opencode-v2-http` declares
 * `['llm','subprocess','sessions','connection','settings']`, and the exclusion
 * guard read `ctx?.tools`. Optional chaining does NOT help - the throw happens on
 * the property read itself - so the whole entry failed to activate and the profile
 * booted with one dead row ("dsh: warning: 1 entry did not activate").
 *
 * The guard only WANTS the tool table when it happens to be visible. This module
 * reads it that way: a rejected read is "not observable", never a crash.
 */

/**
 * Read a service without requiring it in `inject`.
 *
 * @param {object} ctx - cordis context (may be a proxy that throws).
 * @param {string} name - service name, e.g. `'tools'`.
 * @returns {*} the service, or `undefined` when it is not injected/available.
 */
export function optionalService(ctx, name) {
  if (!ctx || typeof name !== 'string' || name.length === 0) return undefined
  try {
    return ctx[name]
  } catch {
    // cordis: "cannot get property \"<name>\" without inject". Not an error here:
    // the caller treats an unavailable service as absent evidence.
    return undefined
  }
}

/**
 * Read several services at once.
 *
 * @param {object} ctx - cordis context.
 * @param {string[]} names - service names.
 * @returns {Record<string, *>} one entry per name, `undefined` when unavailable.
 */
export function optionalServices(ctx, names) {
  const out = {}
  for (const name of names ?? []) out[name] = optionalService(ctx, name)
  return out
}
