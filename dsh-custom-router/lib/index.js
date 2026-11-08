/**
 * Custom Router — plugin body (preset application).
 *
 * The router applies **preset declarations** instead of re-implementing
 * providers. A preset names the loader rows it owns; activating it mounts each
 * row's plugin as a child of this one (`ctx.plugin`), and deactivation disposes
 * exactly those children. The router therefore
 *   - never calls `ctx.llm.registerAdapter` itself (R0 stays intact),
 *   - never carries a second route table, retry loop or credential reader,
 *   - owns only the decision of *which preset is mounted*.
 *
 * Configuration is a plain object (the Cordis schema lands with the bundle row):
 *
 *   {
 *     strict?: boolean,               // throw when a declaration is invalid (default true)
 *     presets?: { [id]: boolean },    // which presets to mount (default: none)
 *     packages?: { [id]: string },    // module override for the preset's own package
 *     vendorConfig?: { [row]: object }, // per-ROW plugin Config handed to the child
 *     profileDir?: string,            // profile whose node_modules holds the @nolit links
 *     installAnchor?: string          // DSH install package.json (host-shared rows)
 *   }
 *
 * `vendorConfig` is keyed by **row**, not by preset id: one preset can mount
 * several rows, and those rows carry different live configs (the two OpenCode
 * rows are the measured case). The probe layer still scopes by preset id, which
 * asks a different question ("which preset owns this credential"), so both key
 * sets may be present in the same object without colliding.
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
import { loadVendorModules, resolveFromAnchor, resolveThroughChain } from './vendor-modules.js'
import { CliWorkerRegistry, bindLifecycle, decideDispatch, gateConfig, installDispatchGate, resolveDispatchPolicy, sessionOf } from './dispatch-gate.js'

/** Plugin name used by the loader. */
export const name = '@nolit/dsh-custom-router'

/**
 * Config schema for the loader row and the settings service.
 *
 * MANDATORY and EXPORTED (measured 2026-11-08): without it the settings service
 * reports the row as not configurable, the browser dashboard's
 * `ctx.configForms.get('dsh-custom-router')` answers `unavailable`, and the
 * Plugins list shows the raw package name with no display text. See
 * `settings-schema.js` for the volatile/secret split.
 */
export { Config } from './settings-schema.js'

/**
 * Services the body needs. It reads none: presets are data and the mounted
 * vendor plugins acquire their own services through their own `inject`.
 */
export const inject = []

/** Runtime revision of the applied-config shape. */
export const PRESET_RUNTIME_VERSION = 2

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
 * The entries one preset mounts, normalised for back-compat.
 *
 * A preset that predates `entries` (or an operator's hand-written declaration)
 * mounts exactly one row: its own package under its own row id.
 * @param {object} preset - a preset declaration.
 * @returns {Array<{row: string, specifier: string, config: object}>} normalised entries.
 */
export function presetEntries(preset) {
  // A declaration preset mounts nothing by definition. The validator already
  // rejects one that carries a package or entries, but this export is callable
  // with an unvalidated declaration, so the rule is enforced here too.
  if (preset?.kind === 'declaration') return []
  const declared = Array.isArray(preset?.entries) ? preset.entries : []
  if (declared.length === 0) {
    if (typeof preset?.package !== 'string' || preset.package === '') return []
    return [{ row: preset.row, specifier: preset.package, config: {} }]
  }
  return declared.map((entry) => ({
    row: entry.row,
    specifier: typeof entry.specifier === 'string' && entry.specifier !== '' ? entry.specifier : preset.package,
    config: entry.config ?? {},
  }))
}

/**
 * Merge the two config sources one entry can have.
 *
 * `entry.config` is the **static, non-secret** config the preset declares (the
 * two host-shared `@deepseek-ai/dsh-tool-subagent` rows). `vendorConfig[row]` is
 * the **operator's live** config. They are merged shallowly with the live layer
 * last, so an operator can override a declared default while a declared default
 * still applies when the profile says nothing. A key the operator sets to
 * `undefined` is skipped rather than erasing the declared value.
 *
 * MEASURED HAZARD — a Cordis **reactive** config is not a plain object. It is
 * `{ get(): object, [write](value): void }`, and spreading it yields
 * `{ get: <fn>, [write]: <fn> }`: the child receives that accessor object as
 * its own `get` field instead of the values it wraps ("garbage", measured
 * 2026-11-08). A getter object is therefore handed through **by identity** as
 * the child's config slot — Cordis reads it itself — and only plain objects are
 * shallow-merged. Declared defaults cannot be merged into a reactive slot
 * without destroying the reactivity the operator relies on, so a reactive live
 * config wins outright; that is the layer with the live values in it anyway.
 * @param {object} entry - normalised entry.
 * @param {object} vendorConfig - config keyed by row id.
 * @returns {object} the merged config, or the reactive accessor unchanged.
 */
export function entryConfig(entry, vendorConfig = {}) {
  const live = vendorConfig !== null && typeof vendorConfig === 'object' ? vendorConfig[entry?.row] : undefined
  // Reactive Cordis config: pass the accessor through untouched (identity kept).
  if (live !== null && typeof live === 'object' && typeof live.get === 'function') return live
  const declared = entry?.config ?? {}
  const merged = { ...declared }
  for (const [key, value] of Object.entries(live ?? {})) {
    if (value !== undefined) merged[key] = value
  }
  return merged
}

/**
 * Plan which presets to mount, without importing or mounting anything.
 * Pure: safe to unit-test and to call from a dry-run command.
 * @param {object} [config] - plugin config.
 * @param {readonly unknown[]} [presets] - declarations (defaults to the measured set).
 * @returns {{errors: string[], active: Array<{id: string, specifier: string, config: object, entries: Array<{row: string, specifier: string, config: object}>}>, rows: Array<{preset: string, row: string, specifier: string, config: object}>, ignored: string[]}} the plan.
 */
export function planApplications(config = {}, presets = PRESETS) {
  const errors = []
  const active = []
  const rows = []
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
    const overrideSpecifier = typeof override === 'string' && override !== '' ? override : undefined

    // A package override swaps the preset's OWN package. A shared host row
    // (`@deepseek-ai/dsh-tool-subagent`) is not the vendor's package and cannot
    // be swapped this way, so it keeps its declared specifier.
    const entries = presetEntries(preset).map((entry) => ({
      preset: id,
      row: entry.row,
      specifier: entry.specifier === preset.package && overrideSpecifier !== undefined
        ? overrideSpecifier
        : entry.specifier,
      config: entryConfig(entry, vendorConfig),
    }))
    rows.push(...entries)
    active.push({
      id,
      specifier: overrideSpecifier ?? preset.package,
      // rc.2 back-compat FALLBACK only. Precedence: the ROW key wins (the
      // measured shape — one preset mounts several rows with different live
      // configs), and `vendorConfig[preset.id]` is consulted only when no row
      // key exists for this preset at all. A preset-id slot is the old
      // single-row keying; without this fallback an rc.2 profile reports `{}`.
      config: presetScopedConfig(preset, vendorConfig),
      entries,
    })
  }

  // Cross-preset duplicate row ids: two presets claiming one loader row would
  // mount the same settings namespace twice. Rejected here (the plan is the
  // gate that runs even when `validatePresets` is bypassed).
  const rowOwners = new Map()
  for (const row of rows) {
    const owner = rowOwners.get(row.row)
    if (owner !== undefined && owner !== row.preset) {
      errors.push(`row "${row.row}" is declared by both "${owner}" and "${row.preset}" (one loader row, one owner)`)
    } else {
      rowOwners.set(row.row, row.preset)
    }
  }

  return { errors, active, rows, ignored }
}

/**
 * The preset-scoped config slot, with the rc.2 fallback.
 *
 * Precedence, in one line: **the preset's own row key wins; `vendorConfig[preset.id]`
 * is the fallback when that row key is absent.**
 *
 * The measured shape is row-keyed (`vendorConfig['dsh-opencode-v2-http']`),
 * because one preset mounts several rows carrying different live configs, and
 * `plan.rows[]` is where those per-row slots belong. rc.2 keyed the same object
 * by preset id alone, so a profile written then has only `vendorConfig['opencode']`;
 * reading just row keys would hand back `{}` and report a configured preset as
 * unconfigured.
 * @param {object} preset - the preset declaration.
 * @param {object} vendorConfig - config keyed by row id (measured), or by preset id (rc.2).
 * @returns {object} the scoped config (never undefined; reactive accessors pass through).
 */
function presetScopedConfig(preset, vendorConfig) {
  const scoped = vendorConfig !== null && typeof vendorConfig === 'object' ? vendorConfig : {}
  const byRow = scoped[preset.row]
  if (byRow !== undefined) return byRow
  const legacy = scoped[preset.id]
  if (legacy !== undefined) return legacy
  return {}
}

/**
 * Read the host's `profileContext` service, tolerating its absence.
 * @param {object} ctx - cordis context.
 * @returns {{name?: string, dir?: string, installAnchor?: string}|undefined} the context.
 */
function readProfileContext(ctx) {
  try {
    return ctx?.get?.('profileContext')
  } catch {
    return undefined
  }
}

/**
 * The bundle packages this process already started.
 *
 * `profileContext.startedBundles` is the host's own list (measured available;
 * the live web profile reports the vendor bundles). Reading it is how the router
 * notices that a preset's package is ALREADY mounted: a profile edited by hand
 * (or a half-applied live edit) can list both the vendor bundle and this router,
 * and the host would then see duplicate provider/tool registrations.
 * @param {object} profileContext - the host's profile context, if any.
 * @returns {string[]} started bundle package names (empty when unknown).
 */
function bundleNames(profileContext) {
  const bundles = profileContext?.startedBundles
  if (!Array.isArray(bundles)) return []
  return bundles.filter((name) => typeof name === 'string' && name !== '')
}

/**
 * Default the probe options from the preset itself.
 *
 * A probe layer declares only `endpoint` (a path); the host it belongs to is
 * declared once, as `preset.endpoint.baseUrl`. Without this the generic probe
 * executor receives no `baseUrl` and fails with
 * `INVALID_PROBE: probe needs a baseUrl` — measured on deepinfra, whose layer is
 * a standard OpenAI listing (`shape: 'openai'`) and therefore correctly routed
 * to the generic executor rather than a vendor bridge.
 *
 * Precedence: the caller's explicit option wins, then the preset declaration,
 * then (for the key only) the preset-scoped `vendorConfig` slot.
 * @param {object} preset - preset declaration.
 * @param {object} options - caller options.
 * @param {object} vendorConfig - config keyed by preset id (probe scope).
 * @returns {object} probe options.
 */
function probeOptions(preset, options, vendorConfig) {
  const scoped = (vendorConfig !== null && typeof vendorConfig === 'object' ? vendorConfig[preset?.id] : undefined) ?? {}
  const declaredBase = preset?.endpoint?.baseUrl
  const baseUrl = options.baseUrl
    ?? (typeof declaredBase === 'string' && declaredBase !== '' ? declaredBase : undefined)
  const apiKey = options.apiKey ?? (typeof scoped?.apiKey === 'string' ? scoped.apiKey : undefined)
  return {
    ...options,
    ...(baseUrl === undefined ? {} : { baseUrl }),
    ...(apiKey === undefined ? {} : { apiKey }),
  }
}

/**
 * Apply the preset plan: mount every active preset's rows as children, and
 * return a disposer that unmounts exactly those children.
 *
 * Failures are isolated per ROW: one unimportable package or one throwing child
 * must not take the other rows down (the two OpenCode rows are independent — a
 * missing `/http` row must still leave the CLI surface mounted). With `strict`
 * on (default), an invalid declaration throws before anything is mounted.
 * @param {object} ctx - cordis context (uses `plugin`, `get` and `logger`).
 * @param {object} [config] - plugin config.
 * @param {readonly unknown[]} [presets] - declarations (tests inject a fixture set).
 * @returns {Promise<() => void>} the disposer releasing every mounted child.
 */
export async function apply(ctx, config = {}, presets = PRESETS) {
  const strict = configValue(config, 'strict', true) !== false
  const warn = (message) => {
    try { ctx?.logger?.warn?.(message) } catch { /* logging is advisory */ }
  }

  // The profile holds the `@nolit` links; the install anchor holds the host's
  // own packages. Neither is discoverable from the router's own path (measured),
  // and `profileContext` is the host's own answer when the caller omits both.
  const profileContext = readProfileContext(ctx)
  const profileDir = configValue(config, 'profileDir', undefined) ?? profileContext?.dir
  const installAnchor = configValue(config, 'installAnchor', undefined) ?? profileContext?.installAnchor
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
  let released = false
  // The resolver is injectable so a unit test never reaches the real install
  // tree through the `execPath` fallback (which would make the suite depend on
  // the machine that runs it).
  const startedBundles = bundleNames(profileContext)

  /**
   * A stable description of one planned child.
   *
   * Volatile settings edits do not re-run this plugin's apply(); the host emits
   * `app-boot/config-reload` after recomposition. Comparing this fingerprint is
   * how the router notices that a child row's config actually changed and
   * remounts ONLY that child. The fingerprint stays in memory and is never
   * logged: it contains the row config, including write-only credentials.
   * @param {object} item - one plan row.
   * @returns {string} stable in-memory fingerprint.
   */
  const fingerprint = (item) => JSON.stringify([item.preset, item.row, item.specifier, item.config])

  /**
   * Resolve and mount one planned row.
   * @param {object} item - one plan row.
   * @returns {Promise<object|undefined>} the mounted fixture, or undefined.
   */
  const mountRow = async (item) => {
    // The router's own bundle owns the vendored provider subpaths
    // (`@nolit/dsh-custom-router/vendor/...`). Those must not be mistaken for a
    // separately started vendor bundle. Only a DIFFERENT started bundle blocks.
    const owner = startedBundles.find((bundle) => bundle !== name && (item.specifier === bundle || item.specifier.startsWith(`${bundle}/`)))
    if (owner !== undefined) {
      warn(`dsh-custom-router: row "${item.row}" of preset "${item.preset}" skipped: "${owner}" is already a started bundle (mounting it twice would duplicate its registrations)`)
      return undefined
    }
    const resolve = configValue(config, 'resolve', resolveFromAnchor)
    const resolution = resolveThroughChain({
      profileDir,
      installAnchor,
      specifier: item.specifier,
      resolve,
    })
    if (!resolution.ok) {
      warn(`dsh-custom-router: row "${item.row}" of preset "${item.preset}" could not be resolved: ${item.specifier}\n${resolution.attempts.map((attempt) => `  ${attempt.label} (${attempt.anchor}): ${attempt.error.split('\n')[0]}`).join('\n')}`)
      return undefined
    }
    try {
      const module = await import(resolution.path)
      const plugin = module?.default ?? module
      if (typeof plugin !== 'function' && (plugin === null || typeof plugin?.apply !== 'function')) {
        warn(`dsh-custom-router: row "${item.row}" resolves to a module without apply(); skipping`)
        return undefined
      }
      const fiber = ctx.plugin(plugin, item.config)
      // MEASURED (cordis 4.0.5): `ctx.plugin()` does NOT throw when the child's
      // apply rejects. It records the error and settles the fiber at state 3, so
      // a try/catch around the call alone is dead code for exactly the failure
      // this seam must survive (a duplicate registration). Awaiting the fiber
      // rethrows that startup error, which makes the report real.
      await fiber
      return { id: item.row, preset: item.preset, specifier: item.specifier, fingerprint: fingerprint(item), fiber }
    } catch (error) {
      warn(`dsh-custom-router: row "${item.row}" of preset "${item.preset}" failed to mount: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /** Dispose one mounted row without letting a bad child block the rest. */
  const disposeEntry = (entry) => {
    try {
      entry?.fiber?.dispose?.()
    } catch (error) {
      warn(`dsh-custom-router: row "${entry?.id}" failed to dispose: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Reconcile the mounted children against the CURRENT volatile config.
   *
   * This is not a reload of the router: rows whose fingerprint did not change
   * stay mounted. A master-off disposes all rows of that preset; a changed
   * layer switch disposes and remounts only that row so the child's own gate
   * sees the new value immediately.
   * @returns {Promise<void>} settlement.
   */
  const reconcile = async () => {
    if (released) return
    const currentPlan = planApplications({
      presets: configValue(config, 'presets', {}),
      packages: configValue(config, 'packages', {}),
      strict,
      vendorConfig: configValue(config, 'vendorConfig', {}),
    }, presets)
    for (const error of currentPlan.errors) warn(`dsh-custom-router: ${error}`)
    const desired = new Map(currentPlan.rows.map((item) => [item.row, item]))
    for (const entry of [...mounted]) {
      const next = desired.get(entry.id)
      if (next !== undefined && next.preset === entry.preset && fingerprint(next) === entry.fingerprint) continue
      disposeEntry(entry)
      const index = mounted.indexOf(entry)
      if (index >= 0) mounted.splice(index, 1)
    }
    for (const [row, item] of desired) {
      if (mounted.some((entry) => entry.id === row)) continue
      const entry = await mountRow(item)
      if (entry !== undefined && !released) mounted.push(entry)
    }
  }

  // CLI dispatch control plane. Installed BEFORE the rows are mounted so a
  // vendor that registers its tool during its own apply() is already covered,
  // and installed once, not per row.
  const registry = new CliWorkerRegistry(ctx, { warn })
  const gateCfg = gateConfig(config)
  const disposeGate = installDispatchGate(ctx, { presets, config, warn })
  const unbindLifecycle = bindLifecycle(ctx, registry)

  await reconcile()

  // Runtime seam for the rest of the body: routing, probing, merging. The
  // closure rereads volatile config, so a probe after a settings edit uses the
  // current row data rather than the mount-time snapshot.
  const currentVendorConfig = () => configValue(config, 'vendorConfig', {})
  try {
    ctx?.provide?.('customRouter', {
      presets,
      vendorProbes: vendorProbes ?? {},
      route: (query) => resolveRoute(query, presets),
      probe: (preset, options = {}) => probePreset(preset, probeOptions(preset, {
        ...options,
        vendorProbes: vendorProbes ?? {},
        vendorConfig: currentVendorConfig(),
      }, currentVendorConfig())),
      merge: (layers) => mergeCatalog(layers),
      // CLI-worker control plane. Vendor rows reach this through the deferred
      // `inject(['customRouter'])` seam (measured: a child's plain `ctx.get()`
      // does not see a service provided by its parent fiber; `inject` does),
      // so one registry and one gate serve every vendor mounted here.
      cliDispatch: {
        registry,
        // Every verb accepts an Agent OR a Session: the delegation providers hold
        // the parent Agent, the lifecycle edges deliver a Session, and a tool
        // execution carries both. `sessionOf` is the single normalization point,
        // so a worker tracked through one identity is reclaimable through the
        // other.
        gate: (subject) => {
          const session = sessionOf(subject?.agent ?? subject)
          return decideDispatch(resolveDispatchPolicy(ctx, session), gateCfg)
        },
        track: (owner, handle, label) => registry.track(owner, handle, label),
        reclaim: (owner, reason) => registry.reclaimSession(owner, reason),
      },
    })
  } catch (error) {
    warn(`dsh-custom-router: runtime seam not provided: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Volatile settings writes retain this config object but do not invoke apply()
  // again. The host emits this event after the recomposition, which is when the
  // row diff above can actually remount changed children.
  let reconcileChain = Promise.resolve()
  const scheduleReconcile = () => {
    reconcileChain = reconcileChain.then(() => reconcile()).catch((error) => {
      warn(`dsh-custom-router: switch reconcile failed: ${error instanceof Error ? error.message : String(error)}`)
    })
    return reconcileChain
  }
  let offReload
  try {
    offReload = ctx?.on?.('app-boot/config-reload', scheduleReconcile)
  } catch (error) {
    warn(`dsh-custom-router: config-reload listener unavailable: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Release in reverse mount order (a later child may depend on an earlier
  // one), over a COPY: `reverse()` mutates in place, which would corrupt the
  // list for a second call. `released` makes the disposer idempotent, so a
  // double unload (loader teardown plus an explicit call) is a no-op rather
  // than a second dispose of already-disposed fibers.
  return () => {
    if (released) return
    released = true
    try { offReload?.() } catch { /* already released */ }
    // Reclaim before unmounting: a vendor row's unload disposes its own handles,
    // but an external process whose handle already left that row's scope (a
    // timed-out delegation, a background CLI worker) has no owner left to reap
    // it. The registry is the only list of those.
    try { disposeGate() } catch { /* already released */ }
    try { unbindLifecycle() } catch { /* already released */ }
    try { registry.dispose('router unloaded') } catch { /* already released */ }
    for (const entry of [...mounted].reverse()) disposeEntry(entry)
    mounted.length = 0
  }
}
