/**
 * Preset derivation seam — the ONE place a browser preset descriptor is built.
 *
 * WHY (STANDARD §4 steps 2–3)
 * `lib/presets.js` answers *what gets mounted*; the settings page needs a second
 * answer, *what gets rendered*. Before rc.16 those were two hand-authored
 * registries joined only by `id`, so a new preset had to be written twice and a
 * forgotten second copy failed **silently** (no tab, no usage card). rc.14 built
 * a gate that makes the two disagree LOUDLY; this module removes the second
 * copy altogether.
 *
 * HOW
 * A preset declares its backend facts once. Everything the browser renders is
 * DERIVED from those facts by two pure functions:
 *
 *   - `presetSettings(preset)` → the vendor-agnostic facts the dashboard uses:
 *     `labelKey`, `planKey`, `metered`, `row`, `route`, `usageRoutes`, `kind`,
 *     `surface` (a plain data map of the preset's declared surfaces);
 *   - `presetUi(id, overrides)` → a complete descriptor: the derived facts
 *     merged with a UI-only hook (`load`, `saveValue`, `renderRowExtras`) that a
 *     page must own because it returns elements, never data.
 *
 * Adding an id-only preset therefore produces a tab and a usage card with no
 * second edit. The single case that still needs a hook is the M2-spec catalog
 * UI shape (that guest repo registers its own descriptors); it supplies only
 * the hook and inherits everything else.
 *
 * THE HOST SEAM
 * `lib/index.js` serves the derived facts on the `customRouter` service as
 * `presetSettings` (data only, frozen, no functions that carry browser code),
 * so a page reads the same derivation the backend validated instead of a
 * hand-copied table. `lib/client.src.js` keeps the derivation as its build-time
 * source (the loader evaluates the bundle as a plain script and cannot import
 * an ESM module), so there are still exactly two copies of this FILE — never of
 * the registry.
 *
 * COMPATIBILITY (measured, non-negotiable)
 * The derivation only ever READS the declaration; it never renames a row, a
 * `vendorConfig` key, a switch or a credential field. A saved profile therefore
 * keeps resolving:
 *   - `row`        → `preset.row`                     (the loader row, e.g. `dsh-opencode-v2`)
 *   - `route`      → `preset.usage.routes[0].path`    (the measured catalog route)
 *   - `usageRoutes`→ `preset.usage.routes`            (order preserved: it is the contract)
 *   - `metered`    → `preset.usage.billing.mode === 'pay-per-token'`
 *   - `labelKey`   → `preset.id` → measured locale key (else `vendor<Camel(id)>`)
 *   - `planKey`    → billing mode → measured plan key
 * A profile that carries an OLD key shape (`vendorConfig[presetId]` instead of a
 * row id) keeps working through `index.js`'s `presetScopedConfig` fallback,
 * which this module does not touch.
 *
 * Pure module: no host context, no I/O, no registration.
 *
 * @module @nolit/dsh-custom-router/preset-derive
 */

// MIRROR-BEGIN
// Everything below, up to MIRROR-END, is byte-identical (modulo comments and
// `export`) to the DERIVED PRESET REGISTRY block of `lib/client.src.js`.
// `scripts/sync-derive.mjs` writes that block from here; `checkDeriveMirror()`
// in `lib/preset-drift.js` fails the gate on any drift.

/**
 * Locale keys, measured from `locale/*.json` (rc.15).
 *
 * A value is a locale key, not a translation: the caller renders it through
 * `t()`. A preset absent here is not an error — it receives the conventional
 * `vendor<Camel(id)>` / billing-derived keys, and the drift gate reports any key
 * that no locale carries (the silent raw-key render, STANDARD §2 #5).
 */
export const MEASURED_LABELS = Object.freeze({
  antigravity: Object.freeze({ labelKey: 'vendorAntigravity', planKey: 'planSubscription' }),
  opencode: Object.freeze({ labelKey: 'vendorOpenCode', planKey: 'planOpenCode' }),
  deepinfra: Object.freeze({ labelKey: 'vendorDeepInfra', planKey: 'planPayAsYouGo' }),
})

/**
 * Billing mode → default plan label key.
 *
 * These are the keys rc.15 used, so a derived descriptor is byte-identical to
 * the hand-written one it replaces; the table exists so a NEW billing mode has
 * a sensible default instead of a raw key.
 */
export const BILLING_PLAN_KEYS = Object.freeze({
  subscription: 'planSubscription',
  flat: 'planFlat',
  'pay-per-token': 'planPayAsYouGo',
  none: 'planOther',
})

/**
 * Surface names a preset may declare, in descriptor order.
 *
 * Data only: a page maps each to a localized label. Keeping this a data map
 * (rather than a boolean) is what lets a page render "this preset has no CLI
 * surface" without a vendor branch.
 */
export const SURFACE_NAMES = Object.freeze(['model', 'subagent', 'cli', 'batch', 'skill'])

/** Turn `opencode-go` / `dsh-opencode-v2` into `OpencodeGo`. */
function camelOf(id) {
  return String(id)
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join('')
}

/**
 * The label key a preset's tab and dashboard card render.
 * @param {object} preset - one declaration.
 * @returns {string} a locale key.
 */
export function labelKeyOf(preset) {
  const measured = MEASURED_LABELS[preset?.id]
  if (measured !== undefined) return measured.labelKey
  return 'vendor' + camelOf(preset?.id ?? 'preset')
}

/**
 * The plan/vendor label key a preset's usage block renders.
 * @param {object} preset - one declaration.
 * @returns {string} a locale key.
 */
export function planKeyOf(preset) {
  const measured = MEASURED_LABELS[preset?.id]
  if (measured !== undefined) return measured.planKey
  const mode = preset?.usage?.billing?.mode
  return BILLING_PLAN_KEYS[mode] ?? 'planSubscription'
}

/**
 * Whether a preset is billed per token (the only case that renders a price
 * block and a promotion count).
 *
 * Derived from the declared billing mode so a descriptor can never disagree
 * with what the backend bills — the cross-check the drift gate used to make
 * between two hand-written copies.
 * @param {object} preset - one declaration.
 * @returns {boolean} true for pay-per-token billing.
 */
export function meteredOf(preset) {
  return preset?.usage?.billing?.mode === 'pay-per-token'
}

/**
 * The catalog route the settings tab loads — the route that LISTS MODELS.
 *
 * STANDARD §3 defines `catalogRoute` as *"local panel route that lists the
 * catalog"*, and the descriptor's `route` field is that, not the usage card's
 * route. The two differ for OpenCode, whose FIRST usage route is the plan window
 * (`/plan-usage`) while its catalog lives on `/model-settings` — conflating them
 * made the tab render an empty list while the usage card still worked.
 *
 * A preset that declares no catalog route but reports usage inherits its LAST
 * usage route: a vendor's usage feed ends on the catalog read it already
 * performs. The remaining fallbacks are the probe layer's endpoint and the
 * conventional `/api/local/<row>/models`, so an id-only preset always opens a
 * real route instead of `undefined`.
 * @param {object} preset - one declaration.
 * @returns {string} a `/api/local/…` route.
 */
export function catalogRouteOf(preset) {
  const local = (value) => typeof value === 'string' && value.startsWith('/api/local/')
  if (local(preset?.catalogRoute)) return preset.catalogRoute
  const routes = Array.isArray(preset?.usage?.routes) ? preset.usage.routes : []
  for (const layer of Array.isArray(preset?.catalog?.layers) ? preset.catalog.layers : []) {
    if (local(layer?.endpoint)) return layer.endpoint
  }
  const last = [...routes].reverse().find((route) => local(route?.path))
  if (last !== undefined) return last.path
  return '/api/local/' + (preset?.row ?? 'preset') + '/models'
}

/**
 * The ordered usage routes the dashboard and the refresh bus iterate.
 *
 * Order is part of the contract (opencode: plan first, then catalog), so this
 * is a copy that preserves it, never a set.
 * @param {object} preset - one declaration.
 * @returns {Array<{path: string, normalize: string}>} the routes (empty when none).
 */
export function usageRoutesOf(preset) {
  const routes = Array.isArray(preset?.usage?.routes) ? preset.usage.routes : []
  return routes.map((route) => Object.freeze({ path: route.path, normalize: route.normalize }))
}

/**
 * A vendor-agnostic, data-only description of a preset's declared surfaces.
 *
 * A page decides only what to render; it never asks "is this opencode?".
 * @param {object} preset - one declaration.
 * @returns {Record<string, object>} surface → data (never undefined).
 */
export function surfacesOf(preset) {
  const declared = preset?.surfaces ?? {}
  const output = {}
  for (const name of SURFACE_NAMES) {
    const value = declared[name]
    output[name] = value === null || value === undefined ? Object.freeze({}) : value
  }
  // Tools/commands are the flattened, uniqueness-checked names the dashboard
  // lists on the provider card.
  output.tools = Object.freeze(Array.isArray(declared.tools) ? [...declared.tools] : [])
  output.commands = Object.freeze(Array.isArray(declared.commands) ? [...declared.commands] : [])
  return Object.freeze(output)
}

/**
 * Derive every browser-facing fact from one declaration.
 *
 * This is the single source the host seam publishes and the page consumes.
 * @param {object} preset - one declaration from `lib/presets.js`.
 * @returns {Readonly<object>} the derived settings (frozen; no functions).
 */
export function presetSettings(preset) {
  return Object.freeze({
    id: preset?.id,
    name: preset?.name,
    kind: preset?.kind,
    row: preset?.row,
    providerId: preset?.providerId,
    labelKey: labelKeyOf(preset),
    planKey: planKeyOf(preset),
    metered: meteredOf(preset),
    route: catalogRouteOf(preset),
    usageRoutes: Object.freeze(usageRoutesOf(preset)),
    surface: surfacesOf(preset),
  })
}

/**
 * Derive the settings for every preset, in declaration order.
 * @param {readonly object[]} presets - declarations (defaults to nothing).
 * @returns {ReadonlyArray<object>} one frozen settings object per preset.
 */
export function presetSettingsList(presets = []) {
  return Object.freeze(presets.map((preset) => presetSettings(preset)))
}

/**
 * Build one browser descriptor: derived facts plus the page-owned UI hook.
 *
 * A hook is the ONLY thing a page may add. It is namespaced under `ui` so it can
 * never shadow a derived fact — a descriptor that declared its own `row` would
 * silently reintroduce the second registry this module removes.
 * @param {object} preset - one declaration.
 * @param {{load?: Function, saveValue?: Function, renderRowExtras?: Function}} [ui] - page hooks.
 * @returns {Readonly<object>} a frozen descriptor.
 */
export function presetUi(preset, ui = {}) {
  const settings = presetSettings(preset)
  const collisions = Object.keys(ui).filter((key) => key in settings)
  if (collisions.length > 0) {
    throw new Error(
      `preset "${settings.id}": ui hook(s) ${collisions.join(', ')} collide with a derived fact; `
      + 'a page may only supply load/saveValue/renderRowExtras',
    )
  }
  return Object.freeze({ ...settings, ...ui })
}

// MIRROR-END
