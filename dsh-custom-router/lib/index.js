/**
 * Custom Router — plugin body (preset application).
 *
 * The router applies **preset declarations** instead of re-implementing
 * providers. A preset names a provider package; activating it mounts that
 * package's own plugin as a child of this one (`ctx.plugin`), and deactivation
 * disposes exactly that child. The router therefore
 *   - never calls `ctx.llm.registerAdapter` itself (R0 stays intact),
 *   - never carries a second route table, retry loop or credential reader,
 *   - owns only the decision of *which preset is mounted*.
 *
 * Configuration is a plain object (the Cordis schema lands with the bundle row):
 *
 *   {
 *     strict?: boolean,               // throw when a declaration is invalid (default true)
 *     presets?: { [id]: boolean },    // which presets to mount (default: none)
 *     packages?: { [id]: string },    // module override (bare name, file: URL, path)
 *     vendorConfig?: { [id]: object } // per-preset plugin Config handed to the child
 *   }
 *
 * Mounting is deliberately opt-in: a profile that still lists the vendor
 * bundles must not mount the same plugin twice (the host would see duplicate
 * provider/tool registrations).
 *
 * @module @nolit/dsh-custom-router/plugin
 */
import { PRESETS, validatePresets } from './presets.js'
import { createVendorBridges } from './bridges/index.js'
import { mergeCatalog } from './catalog.js'
import { probePreset } from './probe.js'
import { resolveRoute } from './routing.js'
import { loadVendorModules } from './vendor-modules.js'

/** Plugin name used by the loader. */
export const name = '@nolit/dsh-custom-router'

/**
 * Services the body needs. It reads none: presets are data and the mounted
 * vendor plugins acquire their own services through their own `inject`.
 */
export const inject = []

/** Runtime revision of the applied-config shape. */
export const PRESET_RUNTIME_VERSION = 1

/**
 * Read a plain config value with a fallback (the value may also be a reactive
 * getter once the Cordis schema is wired).
 * @param {object} config - plugin config.
 * @param {string} key - field name.
 * @param {unknown} fallback - value used when absent.
 * @returns {unknown} the value.
 */
function configValue(config, key, fallback) {
  const entry = config?.[key]
  if (entry !== null && typeof entry === 'object' && typeof entry.get === 'function') {
    const value = entry.get()
    return value === undefined ? fallback : value
  }
  return entry === undefined ? fallback : entry
}

/**
 * Plan which presets to mount, without importing or mounting anything.
 * Pure: safe to unit-test and to call from a dry-run command.
 * @param {object} [config] - plugin config.
 * @param {readonly unknown[]} [presets] - declarations (defaults to the measured set).
 * @returns {{errors: string[], active: Array<{id: string, specifier: string, config: object}>, ignored: string[]}} the plan.
 */
export function planApplications(config = {}, presets = PRESETS) {
  const errors = []
  const active = []
  const ignored = []

  const declared = validatePresets(presets)
  errors.push(...declared.errors)

  const enabled = configValue(config, 'presets', {}) ?? {}
  const packages = configValue(config, 'packages', {}) ?? {}
  const vendorConfig = configValue(config, 'vendorConfig', {}) ?? {}

  if (enabled !== null && typeof enabled !== 'object') errors.push('presets must be an object of { id: boolean }')
  const byId = new Map(presets.map((preset) => [preset.id, preset]))
  for (const [id, on] of Object.entries(enabled)) {
    if (!byId.has(id)) {
      errors.push(`unknown preset "${id}" (declared: ${[...byId.keys()].join(', ')})`)
      continue
    }
    if (on !== true) {
      ignored.push(id)
      continue
    }
    const preset = byId.get(id)
    const override = packages?.[id]
    active.push({
      id,
      specifier: typeof override === 'string' && override !== '' ? override : preset.package,
      config: (vendorConfig?.[id] ?? {}),
    })
  }

  return { errors, active, ignored }
}

/**
 * Apply the preset plan: mount every active preset's plugin as a child, and
 * return a disposer that unmounts exactly those children.
 *
 * Failures are isolated: one unimportable package or one throwing child must
 * not take the other presets down. With `strict` on (default), an invalid
 * declaration throws before anything is mounted.
 * @param {object} ctx - cordis context (uses `plugin` and `logger`).
 * @param {object} [config] - plugin config.
 * @param {readonly unknown[]} [presets] - declarations (tests inject a fixture set).
 * @returns {Promise<() => void>} the disposer releasing every mounted child.
 */
export async function apply(ctx, config = {}, presets = PRESETS) {
  const strict = configValue(config, 'strict', true) !== false
  const warn = (message) => {
    try { ctx?.logger?.warn?.(message) } catch { /* logging is advisory */ }
  }

  // Resolve vendor modules through the DSH profile: the router's own package
  // cannot resolve the @nolit links (measured), and the bridges need the
  // vendors' own auth/catalog parsers.
  const profileDir = configValue(config, 'profileDir', undefined)
  const packages = { ...(configValue(config, 'packages', {}) ?? {}) }
  let modules = configValue(config, 'vendorModules', undefined)
  if (modules === undefined && typeof profileDir === 'string' && profileDir !== '') {
    try {
      const loaded = await loadVendorModules({ profileDir })
      modules = loaded.modules
      for (const [id, url] of Object.entries(loaded.packageUrls)) {
        if (packages[id] === undefined) packages[id] = url
      }
      for (const error of loaded.errors) warn(`dsh-custom-router: vendor module "${error.vendor}" unavailable: ${error.message}`)
    } catch (error) {
      warn(`dsh-custom-router: vendor modules could not be loaded from ${profileDir}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  let vendorProbes = configValue(config, 'vendorProbes', undefined)
  if (vendorProbes === undefined && modules !== undefined) {
    try {
      vendorProbes = createVendorBridges({ modules })
    } catch (error) {
      warn(`dsh-custom-router: vendor bridges unavailable: ${error instanceof Error ? error.message : String(error)}`)
      vendorProbes = {}
    }
  }

  const plan = planApplications({
    presets: configValue(config, 'presets', {}),
    packages,
    strict,
    vendorConfig: configValue(config, 'vendorConfig', {}),
  }, presets)

  if (strict && plan.errors.length > 0) {
    throw new Error(`dsh-custom-router: invalid preset plan:\n- ${plan.errors.join('\n- ')}`)
  }
  for (const error of plan.errors) warn(`dsh-custom-router: ${error}`)

  const mounted = []
  for (const item of plan.active) {
    try {
      const module = await import(item.specifier)
      const plugin = module?.default ?? module
      if (typeof plugin !== 'function' && (plugin === null || typeof plugin?.apply !== 'function')) {
        warn(`dsh-custom-router: preset "${item.id}" resolves to a module without apply(); skipping`)
        continue
      }
      const fiber = ctx.plugin(plugin, item.config)
      mounted.push({ id: item.id, fiber })
    } catch (error) {
      warn(`dsh-custom-router: preset "${item.id}" failed to mount: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  // Runtime seam for the rest of the body: routing, probing, merging.
  try {
    ctx?.provide?.('customRouter', {
      presets,
      vendorProbes: vendorProbes ?? {},
      route: (query) => resolveRoute(query, presets),
      probe: (preset, options = {}) => probePreset(preset, {
        ...options,
        vendorProbes: vendorProbes ?? {},
        vendorConfig: configValue(config, 'vendorConfig', {}),
      }),
      merge: (layers) => mergeCatalog(layers),
    })
  } catch (error) {
    warn(`dsh-custom-router: runtime seam not provided: ${error instanceof Error ? error.message : String(error)}`)
  }

  return () => {
    for (const { id, fiber } of mounted.reverse()) {
      try {
        fiber?.dispose?.()
      } catch (error) {
        warn(`dsh-custom-router: preset "${id}" failed to dispose: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }
}
