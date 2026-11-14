/**
 * Preset common data model — the standard schema a new provider must fill.
 *
 * Owner requirement (2026-11-07): a preset must answer, in a standard shape,
 *   - is it a **JSON declaration** (data only) or an **NPM package** (code-backed)?
 *   - how does it authenticate: **API key**, **web auth**, or **local socket**?
 *   - what **endpoint protocol** and transport does it speak?
 *
 * The model below is measured, not invented:
 *   - protocols and transports: `dsh-llm-pi-ai` `PROTOCOLS` / `transport`
 *     (`openai-completions`, `openai-responses`, `anthropic-messages`;
 *     `sse`, `websocket`, `websocket-cached`, `auto`) plus the two Google wires
 *     a vendor route speaks (`google-generative-sse` for Antigravity's
 *     `v1internal:streamGenerateContent`, `google-generative-ai` for the
 *     `generateContent` family);
 *   - auth sources: the credentials service's two spaces (`CredentialRef` =
 *     env/store value, `CredentialRecord` = grant) plus vendor token files and
 *     a daemon control-plane credential (`GET /api/credential`);
 *   - local endpoints: OpenAI-compatible localhost servers (measured 8080/8081).
 *
 * Pure module: constants, one validator, one JSON Schema mirror. It registers
 * nothing and reads no host context.
 *
 * @module @nolit/dsh-custom-router/preset-schema
 */

/** How the preset is delivered. */
export const PRESET_KINDS = Object.freeze(['package', 'declaration'])

/**
 * Wire protocols the host itself implements (routable through PiAiAdapter).
 *
 * MEASURED, do not extend on request alone: `dsh-llm-pi-ai` (0.2.2-rc.1) builds
 * its route table as three entries and its Config validates `api` against
 * `z.union(supportedProtocols())`. A fourth name here would let a `route:'pi-ai'`
 * preset pass this validator and then fail to mount in the host — a false green,
 * which is exactly what the drift gate exists to prevent.
 */
export const DSH_PROTOCOLS = Object.freeze([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
])

/**
 * Every wire protocol a preset may name (host-native plus measured vendor wires).
 *
 * The vendor wires are served by a `route: 'own'` adapter, not by the host, so
 * they belong here and NOT in {@link DSH_PROTOCOLS}: `google-generative-sse` is
 * Antigravity's `v1internal:streamGenerateContent`, `google-generative-ai` is
 * the `generateContent`/`streamGenerateContent` family a Google-compatible
 * vendor endpoint speaks.
 */
export const WIRE_PROTOCOLS = Object.freeze([...DSH_PROTOCOLS, 'google-generative-sse', 'google-generative-ai'])

/** Host transport modes. */
export const TRANSPORTS = Object.freeze(['sse', 'websocket', 'websocket-cached', 'auto'])

/** Endpoint shapes. */
export const ENDPOINT_MODES = Object.freeze(['http', 'local-http', 'daemon'])

/** Who serves the wire. */
export const WIRE_SERVERS = Object.freeze(['pi-ai', 'own'])

/** Authentication families. */
export const AUTH_MODES = Object.freeze(['api-key', 'web-auth', 'local-socket', 'none'])

/** Where a credential comes from, in precedence order. */
export const AUTH_SOURCES = Object.freeze([
  'secret-field',
  'env',
  'credential-ref',
  'token-file',
  'daemon-endpoint',
])

/** Catalog sourcing. */
export const CATALOG_MODES = Object.freeze(['live', 'cached', 'static'])

/**
 * Catalog synchronization layers, lowest precedence first (owner decision
 * 2026-11-07): 1) the upstream pi-ai static snapshot as the default fallback,
 * 2) a live API/web-auth probe for endpoints that advertise their models,
 * 3) manual preset/local overrides for local models and new prices.
 */
export const CATALOG_LAYERS = Object.freeze(['upstream', 'probe', 'override'])

/** Probe kinds the router can run. */
export const PROBE_KINDS = Object.freeze(['api', 'web-auth'])

/**
 * Listing shapes the probe executor can normalize. `vendor` means the endpoint
 * answers a provider-specific RPC the vendor plugin already owns; the router
 * does not re-implement that parser.
 */
export const PROBE_SHAPES = Object.freeze(['openai', 'anthropic', 'vendor'])

/** Input modalities pi-ai models declare. */
export const MODEL_INPUT_MODALITIES = Object.freeze(['text', 'image'])

/** Plan availability states. */
export const PLAN_STATES = Object.freeze(['available', 'unavailable'])

/**
 * Billing models, measured from the three providers:
 *   - `subscription` — a paid plan covers usage (Antigravity: 5h/weekly/monthly windows);
 *   - `flat`         — a fixed plan with a per-request allowance (OpenCode go/zen);
 *   - `pay-per-token`— catalog rates bill every token (DeepInfra);
 *   - `none`         — an unauthenticated local endpoint with no billing (loopback presets).
 */
export const BILLING_MODES = Object.freeze(['subscription', 'flat', 'pay-per-token', 'none'])

/** Plan verdicts (PLAN-AND-USAGE-SPEC §1.4). `unknown` is a visible state, never a zero. */
export const PLAN_VERDICTS = Object.freeze(['match', 'mismatch', 'throttled', 'unknown', 'no-plan-service'])

/** CLI worker shapes. */
export const CLI_SHAPES = Object.freeze(['async', 'sync'])

/**
 * Every declaration field with a MEASURED runtime consumer.
 *
 * WHY THIS EXISTS (measured 2026-11-14): a preset could declare a field that
 * nothing reads and every gate stayed green — the declaration looked like a
 * contract while half of it was documentation. `auth.mode`, `auth.sources`,
 * `endpoint.mode/route/transport/chatPath`, `catalog.mode`, the probe layer's
 * `kind`/`ttlMs` and `surfaces.skill` are all validated by this module and
 * projected to the browser, but no runtime path consumes them: changing one
 * changes nothing that runs.
 *
 * A field is listed here only with the evidence RECORDED, so the next reader
 * can re-measure instead of trusting the list:
 *   - `usage.billing.windows` → `lib/plan.js readDeclaredWindows()` (added in
 *     the same wave this list was written; it was dead before that, and the
 *     `usage.js` comment at its call site says so);
 *   - `endpoint.baseUrl` → `lib/index.js probeOptions()` and
 *     the vendored adapter entry modules, which build the request URL;
 *   - `catalog.layers[].endpoint` → `lib/probe.js` (`probeUrl`);
 *   - `catalog.layers[].shape` → `lib/probe.js` (vendor vs generic executor);
 *   - `catalog.layers[].namespace` → `lib/probe.js` (`ctx.llm.discoverModels`);
 *   - `catalog.layers[].models` → `lib/index.js mergeCatalog`, `lib/catalog.js`.
 *
 * The list is EXHAUSTIVE and closed: a new field must arrive with a consumer
 * and an entry here, which is the point. `DECLARATION_DEAD_FIELDS` names the
 * remainder that is still accepted for compatibility, with the reason it is
 * dead, so the report can be read as a to-do list rather than a mystery.
 */
export const DECLARATION_RUNTIME_FIELDS = Object.freeze([
  'id',
  'name',
  'kind',
  'package',
  'row',
  'entries',
  'entries[].row',
  'entries[].specifier',
  // `entry.config` is merged and handed to the mounted child verbatim
  // (lib/index.js entryConfig), so its KEYS belong to the child plugin and are
  // validated by that child's own Config schema, not here.
  'entries[].config.*',
  'providerId',
  'modelPrefixes',
  'catalogRoute',
  // Consumed by lib/index.js + lib/catalog.js/probe.js.
  'catalog.layers',
  'catalog.layers[].source',
  'catalog.layers[].endpoint',
  'catalog.layers[].shape',
  'catalog.layers[].namespace',
  // A model ROW's keys are governed by `validateCatalogModel()` (its own
  // schema, whose fields the catalog merge validates and the pipe reads), so
  // the subtree is delegated rather than re-listed here.
  'catalog.layers[].models.*',
  'catalog.layers[].pricing',
  // Consumed by lib/index.js probeOptions().
  'endpoint.baseUrl',
  // Consumed by lib/probe.js/plan.js/usage.js and the descriptor derivation.
  'usage.record',
  'usage.plan',
  'usage.billing',
  'usage.billing.mode',
  'usage.billing.windows',
  // readDeclaredWindows() reads `row?.label` (a bare string is also accepted).
  'usage.billing.windows[].label',
  'usage.routes',
  'usage.routes[].path',
  'usage.routes[].normalize',
  // Consumed by lib/preset-derive.js and scripts/verify-presets.mjs.
  'switches',
  'switches[].name',
  'switches[].module',
  'switches[].role',
  'switches[].default',
  'surfaces',
  'surfaces.model',
  'surfaces.model.adapter',
  'surfaces.model.factory',
  'surfaces.subagent',
  'surfaces.subagent.toolRow',
  'surfaces.subagent.toolName',
  'surfaces.subagent.maxDepth',
  'surfaces.cli',
  'surfaces.cli.shape',
  'surfaces.cli.toolName',
  'surfaces.cli.commandName',
  'surfaces.cli.gates',
  'surfaces.batch',
  'surfaces.batch.shape',
  'surfaces.batch.toolName',
  'surfaces.batch.gate',
  'surfaces.batch.default',
  'surfaces.tools',
  'surfaces.commands',
])

/**
 * Declared-and-validated fields with NO runtime consumer (measured 2026-11-14).
 *
 * These are accepted — existing presets declare them and the JSON Schema
 * mirrors them — but changing one changes nothing that runs. They are reported
 * by `checkDeclarationFields()` so the gap stays visible; the alternative
 * (rejecting them outright) would fail every current declaration and turn a
 * report into an outage.
 *
 * `surfaces.skill` is the one entry that is NOT plainly dead: the type is
 * validated and it is projected to the browser, but no surface in this package
 * renders or dispatches it, so no preset may rely on it today.
 */
export const DECLARATION_DEAD_FIELDS = Object.freeze({
  'auth.mode': 'validated and projected; no runtime path reads it (auth is resolved vendor-side from config/env)',
  'auth.sources': 'validated and projected; no runtime path reads it',
  'endpoint.mode': 'validated; no runtime path branches on it (transport is per-vendor code)',
  'endpoint.protocol': 'mounted into the descriptor and the JSON Schema; the adapter is selected by the vendor package, not by this field',
  'endpoint.route': 'validated (pi-ai vs own); the row specifier decides the mount, not this field',
  'endpoint.transport': 'validated; the vendored adapters hard-code their transport',
  'endpoint.chatPath': 'validated; each vendored adapter hard-codes its chat path',
  'catalog.mode': 'validated (live/cached/static); the probe layer list decides discovery',
  'catalog.layers[].kind': 'validated as probe kind; lib/probe.js branches on `shape`, not `kind`',
  'catalog.layers[].ttlMs': 'validated; lib/catalog-cache.js takes its ttl from the caller, not from the declaration',
  'catalog.layers[].providers': 'validated; mergeCatalog() reads only models/pricing from a layer',
  'usage.billing.service': 'validated; lib/usage.js uses `usage.record` as the service label',
  'surfaces.model.factory': 'contract-only: required by lib/driver/contract.js, which no preset declaration feeds today',
  'surfaces.cli.gates': 'validated and projected; the CLI gate list is registered vendor-side',
  'surfaces.skill': 'validated and projected to the browser; no surface renders or dispatches it',
})

const SCOPED_PACKAGE = /^@[a-z0-9-]+\/[a-z0-9-]+(?:\/[a-z0-9-]+)*$/
const KEBAB = /^[a-z][a-z0-9-]*$/
const CAMEL = /^[a-z][a-zA-Z0-9]*$/

/**
 * Validate the common part of a preset declaration.
 * Pure: no host context, no registration, no I/O.
 * @param {unknown} preset - candidate declaration.
 * @returns {{ok: boolean, errors: string[]}} validation verdict.
 */
export function validatePresetModel(preset) {
  const errors = []
  const add = (message) => errors.push(message)
  if (preset === null || typeof preset !== 'object') return { ok: false, errors: ['preset must be an object'] }

  if (typeof preset.id !== 'string' || !KEBAB.test(preset.id)) add('id must be a kebab-case identifier')
  if (preset.name !== undefined && typeof preset.name !== 'string') add('name must be a string when present')
  if (typeof preset.row !== 'string' || !KEBAB.test(preset.row)) add('row must be a loader row id')
  // STANDARD §3 `catalogRoute`: optional, because it is DERIVABLE. It exists so
  // a preset whose catalog and usage feeds live on different routes (OpenCode:
  // `/model-settings` vs `/plan-usage`) states the right one instead of the
  // derivative guessing. When present it must already be a local panel route.
  if (preset.catalogRoute !== undefined
    && (typeof preset.catalogRoute !== 'string' || !preset.catalogRoute.startsWith('/api/local/'))) {
    add('catalogRoute must be a local panel route (/api/local/…) when present')
  }
  if (typeof preset.providerId !== 'string' || preset.providerId === '') add('providerId must be a non-empty string')
  if (preset.modelPrefixes !== undefined) {
    if (!Array.isArray(preset.modelPrefixes) || preset.modelPrefixes.length === 0) {
      add('modelPrefixes must be a non-empty array when present')
    } else {
      for (const prefix of preset.modelPrefixes) {
        if (typeof prefix !== 'string' || prefix === '' || prefix.includes('/')) {
          add('every model prefix must be a non-empty string without "/"')
        }
      }
      if (new Set(preset.modelPrefixes).size !== preset.modelPrefixes.length) add('modelPrefixes contains a duplicate')
    }
  }
  if (!PRESET_KINDS.includes(preset.kind)) add(`kind must be one of ${PRESET_KINDS.join(', ')}`)

  // Delivery: a package preset names its package; a declaration preset must not.
  if (preset.kind === 'package') {
    if (typeof preset.package !== 'string' || !SCOPED_PACKAGE.test(preset.package)) {
      add('a package preset requires a scoped package name')
    }
  } else if (preset.kind === 'declaration' && preset.package !== undefined) {
    add('a declaration preset must not name a package')
  }

  const endpoint = preset.endpoint
  if (endpoint === null || typeof endpoint !== 'object') {
    add('endpoint must be an object')
  } else {
    if (!ENDPOINT_MODES.includes(endpoint.mode)) add(`endpoint.mode must be one of ${ENDPOINT_MODES.join(', ')}`)
    if (!WIRE_PROTOCOLS.includes(endpoint.protocol)) {
      add(`endpoint.protocol must be one of ${WIRE_PROTOCOLS.join(', ')}`)
    }
    if (!WIRE_SERVERS.includes(endpoint.route)) {
      add(`endpoint.route must be one of ${WIRE_SERVERS.join(', ')}`)
    }
    if (endpoint.route === 'pi-ai' && !DSH_PROTOCOLS.includes(endpoint.protocol)) {
      add(`endpoint.route "pi-ai" requires a host protocol (${DSH_PROTOCOLS.join(', ')})`)
    }
    if (endpoint.transport !== undefined && !TRANSPORTS.includes(endpoint.transport)) {
      add(`endpoint.transport must be one of ${TRANSPORTS.join(', ')}`)
    }
    const url = endpoint.baseUrl
    if (typeof url !== 'string') {
      add('endpoint.baseUrl must be a string')
    } else if (endpoint.mode === 'daemon') {
      // A daemon base URL is resolved at runtime; empty is allowed.
      if (url !== '' && !/^https?:\/\//.test(url)) add('endpoint.baseUrl must be empty or http(s) for a daemon')
    } else if (!/^https?:\/\//.test(url)) {
      add('endpoint.baseUrl must be an http(s) URL')
    }
    if (endpoint.chatPath !== undefined && (typeof endpoint.chatPath !== 'string' || !endpoint.chatPath.startsWith('/'))) {
      add('endpoint.chatPath must start with "/"')
    }
  }

  const auth = preset.auth
  if (auth === null || typeof auth !== 'object') {
    add('auth must be an object')
  } else {
    if (!AUTH_MODES.includes(auth.mode)) add(`auth.mode must be one of ${AUTH_MODES.join(', ')}`)
    if (!Array.isArray(auth.sources)) {
      add('auth.sources must be an array (precedence order)')
    } else {
      if (auth.mode !== 'none' && auth.sources.length === 0) {
        add(`auth.mode "${auth.mode}" requires at least one source`)
      }
      if (auth.mode === 'none' && auth.sources.length > 0) add('auth.mode "none" must not declare sources')
      for (const source of auth.sources) {
        if (source === null || typeof source !== 'object') { add('auth sources must be objects'); continue }
        if (!AUTH_SOURCES.includes(source.kind)) add(`auth source kind must be one of ${AUTH_SOURCES.join(', ')}`)
        if (source.kind === 'secret-field' && (typeof source.name !== 'string' || !CAMEL.test(source.name))) {
          add('a secret-field source requires a camelCase field name')
        }
        if ((source.kind === 'env' || source.kind === 'credential-ref') && (typeof source.name !== 'string' || source.name === '')) {
          add(`a ${source.kind} source requires a name`)
        }
        if ((source.kind === 'token-file' || source.kind === 'daemon-endpoint')
          && (typeof source.name !== 'string' || source.name === '')) {
          add(`a ${source.kind} source requires a path or endpoint name`)
        }
      }
      if (auth.mode === 'local-socket' && !['local-http', 'daemon'].includes(endpoint?.mode)) {
        add('auth.mode "local-socket" requires endpoint.mode "local-http" or "daemon"')
      }
      if (auth.mode === 'web-auth' && !auth.sources.some((source) =>
        ['token-file', 'daemon-endpoint', 'credential-ref'].includes(source?.kind))) {
        add('auth.mode "web-auth" requires a token-file, daemon-endpoint or credential-ref source')
      }
    }
  }

  const catalog = preset.catalog
  if (catalog === null || typeof catalog !== 'object') {
    add('catalog must be an object')
  } else {
    if (!CATALOG_MODES.includes(catalog.mode)) add(`catalog.mode must be one of ${CATALOG_MODES.join(', ')}`)
    const layers = catalog.layers
    if (!Array.isArray(layers) || layers.length === 0) {
      add('catalog.layers must be a non-empty array (upstream → probe → override)')
    } else {
      const seen = new Set()
      for (const layer of layers) {
        if (layer === null || typeof layer !== 'object') { add('catalog layers must be objects'); continue }
        if (!CATALOG_LAYERS.includes(layer.source)) add(`catalog layer source must be one of ${CATALOG_LAYERS.join(', ')}`)
        if (seen.has(layer.source)) add(`catalog layer "${layer.source}" is declared twice`)
        seen.add(layer.source)
        if (layer.source === 'upstream') {
          if (layer.providers !== undefined && (!Array.isArray(layer.providers)
            || layer.providers.some((provider) => typeof provider !== 'string' || provider === ''))) {
            add('upstream.providers must be an array of non-empty provider ids')
          }
        }
        if (layer.source === 'probe') {
          if (!PROBE_KINDS.includes(layer.kind)) add(`probe.kind must be one of ${PROBE_KINDS.join(', ')}`)
          if (layer.shape !== undefined && !PROBE_SHAPES.includes(layer.shape)) {
            add(`probe.shape must be one of ${PROBE_SHAPES.join(', ')}`)
          }
          if (typeof layer.endpoint !== 'string' || !layer.endpoint.startsWith('/')) {
            add('probe.endpoint must start with "/"')
          }
          if (layer.ttlMs !== undefined && (typeof layer.ttlMs !== 'number' || layer.ttlMs <= 0)) {
            add('probe.ttlMs must be a positive number')
          }
          if (layer.namespace !== undefined && (typeof layer.namespace !== 'string' || layer.namespace === '')) {
            add('probe.namespace must be a non-empty string when present')
          }
        }
        if (layer.source === 'override') {
          const models = layer.models ?? []
          const pricing = layer.pricing ?? []
          if (!Array.isArray(models)) add('override.models must be an array')
          if (!Array.isArray(pricing)) add('override.pricing must be an array')
          if (models.length === 0 && pricing.length === 0) {
            add('override layer needs models and/or pricing')
          }
          for (const model of models) errors.push(...validateCatalogModel(model, { partialCost: true }).map((error) => `override model: ${error}`))
          for (const item of pricing) {
            if (item === null || typeof item !== 'object' || typeof item.modelId !== 'string' || item.modelId === '') {
              add('override.pricing entries need a modelId')
              continue
            }
            if (item.cost === undefined) add(`override.pricing "${item.modelId}" needs a cost`)
            else errors.push(...validateModelCost(item.cost, { partial: true }).map((error) => `override.pricing "${item.modelId}": ${error}`))
          }
        }
      }
      if (layers[0]?.source !== 'upstream') {
        // Not fatal: a provider absent from pi-ai (antigravity, deepinfra) has no fallback.
        // The order rule below is the normative part.
      }
      const positions = layers.map((layer) => CATALOG_LAYERS.indexOf(layer?.source)).filter((index) => index >= 0)
      for (let i = 1; i < positions.length; i += 1) {
        if (positions[i] < positions[i - 1]) add('catalog.layers must be ordered upstream → probe → override')
      }
    }
    if (preset.kind === 'declaration') {
      if (catalog.mode !== 'static') add('a declaration preset requires catalog.mode "static"')
      if (!Array.isArray(catalog.layers) || !catalog.layers.some((layer) => layer?.source === 'override')) {
        add('a declaration preset requires an override layer with its model list')
      }
    }
  }

  if (preset.usage === null || typeof preset.usage !== 'object') {
    add('usage must be an object')
  } else {
    if (typeof preset.usage.record !== 'string' || preset.usage.record === '') add('usage.record must be a non-empty string')
    if (!PLAN_STATES.includes(preset.usage.plan)) add(`usage.plan must be one of ${PLAN_STATES.join(', ')}`)
    // `usage.routes` is the ordered list the dashboard and the refresh bus
    // iterate. It is REQUIRED for a preset that reports usage, and forbidden
    // for one that does not (`plan: 'unavailable'` + `billing.mode: 'none'` =
    // a loopback server with no plan to read): a preset that claims a usage
    // surface without a route is exactly the silent failure the drift gate
    // exists to catch.
    const reportsUsage = preset.usage.plan !== 'unavailable' || preset.usage.billing?.mode !== 'none'
    const routes = preset.usage.routes
    if (routes === undefined || routes === null) {
      if (reportsUsage) add('usage.routes is required when the preset reports usage (plan/billing are not "unavailable"/"none")')
    } else if (!Array.isArray(routes) || routes.length === 0) {
      add('usage.routes must be a non-empty ordered array of { path, normalize }')
    } else {
      if (!reportsUsage) add('a preset with billing.mode "none" must not declare usage routes')
      const seen = new Set()
      for (const route of routes) {
        if (route === null || typeof route !== 'object') {
          add('every usage route must be an object')
          continue
        }
        if (typeof route.path !== 'string' || !route.path.startsWith('/api/local/')) {
          add(`usage route path must be a local panel route (/api/local/…), got ${JSON.stringify(route.path)}`)
        } else {
          if (seen.has(route.path)) add(`usage route "${route.path}" is listed twice`)
          seen.add(route.path)
        }
        if (typeof route.normalize !== 'string' || route.normalize === '') {
          add(`usage route "${route.path}" must name its normalize function`)
        }
      }
    }
    const billing = preset.usage.billing
    if (billing !== undefined) {
      if (billing === null || typeof billing !== 'object') {
        add('usage.billing must be an object')
      } else {
        if (!BILLING_MODES.includes(billing.mode)) add(`billing.mode must be one of ${BILLING_MODES.join(', ')}`)
        if (billing.service !== undefined && (typeof billing.service !== 'string' || billing.service === '')) {
          add('billing.service must be a non-empty string when present')
        }
        if (billing.windows !== undefined) {
          if (!Array.isArray(billing.windows) || billing.windows.length === 0) {
            add('billing.windows must be a non-empty array when present')
          } else {
            for (const window of billing.windows) {
              if (window === null || typeof window !== 'object' || typeof window.label !== 'string' || window.label === '') {
                add('every billing window needs a label')
              }
            }
          }
        }
      }
    }
  }

  return { ok: errors.length === 0, errors }
}

/**
 * Every leaf path a declaration actually sets, e.g. `usage.billing.mode`.
 *
 * Leaves, not containers: `endpoint` alone says nothing about which of its
 * fields is read, and the dead-field question is asked per leaf. Arrays of
 * objects are described by their first element (`entries[].row`) because the
 * shape is what the allowlist names, not the values.
 * @param {unknown} value - declaration (or sub-object).
 * @param {string} [prefix] - path accumulated so far.
 * @param {Set<string>} [out] - sink.
 * @returns {Set<string>} the leaf paths.
 */
export function declarationLeafPaths(value, prefix = '', out = new Set()) {
  if (Array.isArray(value)) {
    // An array of objects is described by its element SHAPE (`entries[].row`);
    // an array of scalars (or an empty one) is a leaf at its own path, so a
    // dead list field cannot hide behind "it is a container".
    if (value.some((item) => item !== null && typeof item === 'object')) {
      for (const item of value) {
        if (item !== null && typeof item === 'object') declarationLeafPaths(item, `${prefix}[]`, out)
      }
    } else if (prefix !== '') {
      out.add(prefix)
    }
    return out
  }
  if (value !== null && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      const path = prefix === '' ? key : `${prefix}.${key}`
      if (child !== null && typeof child === 'object') declarationLeafPaths(child, path, out)
      else out.add(path)
    }
    return out
  }
  if (prefix !== '') out.add(prefix)
  return out
}

/**
 * Static dead-field report for one declaration.
 *
 * TWO severities, deliberately different:
 *   - a field that is in NEITHER list is an ERROR: it is a field nobody has
 *     ever measured a consumer for, which is exactly the class this gate
 *     exists to stop — the declaration would grow a contract nothing honours;
 *   - a field listed in `DECLARATION_DEAD_FIELDS` is a WARNING: it is accepted
 *     for compatibility (every current preset declares some), so failing on it
 *     would replace a report with an outage.
 * This split keeps the gate usable on the current tree while making a NEW dead
 * field impossible to add silently. The message always names the field path,
 * so the fix is copy-paste visible.
 * @param {unknown} preset - candidate declaration.
 * @returns {{ok: boolean, errors: string[], warnings: string[]}} the report.
 */
export function checkDeclarationFields(preset) {
  const errors = []
  const warnings = []
  if (preset === null || typeof preset !== 'object') return { ok: false, errors: ['preset must be an object'], warnings }

  // `auth.sources[].kind` and `auth.sources[].name` are one field shape; the
  // allowlist names the container once (`auth.sources`), so both sides are
  // compared with the array markers removed.
  const plain = (path) => path.replace(/\[\]/g, '')
  const runtime = new Set(DECLARATION_RUNTIME_FIELDS.map(plain))
  const dead = new Map(Object.entries(DECLARATION_DEAD_FIELDS).map(([key, reason]) => [plain(key), reason]))

  /** The dead reason (or null) of the nearest listed ancestor of `path`. */
  const deadReasonOf = (path) => {
    const parts = plain(path).split('.')
    for (let end = parts.length; end > 0; end -= 1) {
      const prefix = parts.slice(0, end).join('.')
      if (dead.has(prefix)) return dead.get(prefix)
    }
    return null
  }

  for (const path of declarationLeafPaths(preset)) {
    const reason = deadReasonOf(path)
    // A listed DEAD ancestor settles its whole subtree as dead, never as live:
    // a dead container cannot vouch for its children.
    if (reason !== null) {
      warnings.push(`dead declaration field "${path}": ${reason}`)
      continue
    }
    // A `.*` entry settles every key beneath it (a delegated subtree).
    const starred = plain(path).split('.').map((_, index, all) => all.slice(0, index + 1).join('.') + '.*')
    if (runtime.has(plain(path)) || starred.some((candidate) => runtime.has(candidate))) continue
    errors.push(
      `unknown declaration field "${path}": no measured runtime consumer — add one and list it in ` +
        'DECLARATION_RUNTIME_FIELDS (lib/preset-schema.js), or remove the field',
    )
  }
  return { ok: errors.length === 0, errors, warnings }
}

/** Validate one catalog model entry (the merged/override shape). */
export function validateCatalogModel(model, { partialCost = false } = {}) {
  const errors = []
  if (model === null || typeof model !== 'object') return ['model must be an object']
  if (typeof model.id !== 'string' || model.id === '') errors.push('id must be a non-empty string')
  if (model.name !== undefined && typeof model.name !== 'string') errors.push('name must be a string')
  if (model.contextWindow !== undefined && (typeof model.contextWindow !== 'number' || model.contextWindow <= 0)) {
    errors.push('contextWindow must be a positive number')
  }
  if (model.maxTokens !== undefined && (typeof model.maxTokens !== 'number' || model.maxTokens <= 0)) {
    errors.push('maxTokens must be a positive number')
  }
  if (model.input !== undefined && (!Array.isArray(model.input)
    || model.input.some((modality) => !MODEL_INPUT_MODALITIES.includes(modality)))) {
    errors.push(`input must be an array of ${MODEL_INPUT_MODALITIES.join(', ')}`)
  }
  if (model.reasoning !== undefined && typeof model.reasoning !== 'boolean') errors.push('reasoning must be a boolean')
  if (model.cost !== undefined) errors.push(...validateModelCost(model.cost, { partial: partialCost }).map((error) => `cost: ${error}`))
  return errors
}

/**
 * Validate one price record (rates per 1M tokens + optional tiers).
 * `partial` accepts an overlay that patches only some rates (a preset override);
 * a complete record used for billing still requires all four.
 */
export function validateModelCost(cost, { partial = false } = {}) {
  const errors = []
  if (cost === null || typeof cost !== 'object') return ['cost must be an object']
  const fields = ['input', 'output', 'cacheRead', 'cacheWrite']
  for (const field of fields) {
    if (cost[field] === undefined) {
      if (!partial) errors.push(`${field} must be a non-negative number`)
      continue
    }
    if (typeof cost[field] !== 'number' || cost[field] < 0) errors.push(`${field} must be a non-negative number`)
  }
  if (partial && fields.every((field) => cost[field] === undefined) && cost.tiers === undefined) {
    errors.push('a partial cost record must set at least one rate')
  }
  if (cost.tiers !== undefined) {
    if (!Array.isArray(cost.tiers)) errors.push('tiers must be an array')
    else for (const tier of cost.tiers) {
      if (tier === null || typeof tier !== 'object') { errors.push('tier must be an object'); continue }
      for (const field of ['input', 'output', 'cacheRead', 'cacheWrite', 'inputTokensAbove']) {
        if (typeof tier[field] !== 'number' || tier[field] < 0) errors.push(`tier.${field} must be a non-negative number`)
      }
    }
  }
  return errors
}

/**
 * JSON Schema mirror of {@link validatePresetModel}, for external tools and
 * documentation. Draft-07 subset; the JS validator stays the source of truth.
 *
 * Every `enum` below is DERIVED from the exported constant array it mirrors
 * (never hand-copied): a hand-copied enum is a second source of truth that
 * silently disagrees the first time a wire is added, which is the drift class
 * `verify:presets` is meant to catch. Spread at construction keeps the schema
 * a plain JSON value (frozen arrays are fine for `Object.freeze`).
 */
const ENUMS = Object.freeze({
  PRESET_KINDS: [...PRESET_KINDS],
  ENDPOINT_MODES: [...ENDPOINT_MODES],
  WIRE_PROTOCOLS: [...WIRE_PROTOCOLS],
  WIRE_SERVERS: [...WIRE_SERVERS],
  TRANSPORTS: [...TRANSPORTS],
  AUTH_MODES: [...AUTH_MODES],
  AUTH_SOURCES: [...AUTH_SOURCES],
  CATALOG_MODES: [...CATALOG_MODES],
  CATALOG_LAYERS: [...CATALOG_LAYERS],
  PROBE_KINDS: [...PROBE_KINDS],
  PROBE_SHAPES: [...PROBE_SHAPES],
  PLAN_STATES: [...PLAN_STATES],
  BILLING_MODES: [...BILLING_MODES],
})

export const PRESET_JSON_SCHEMA = Object.freeze({
  $schema: 'http://json-schema.org/draft-07/schema#',
  $id: 'https://nolit.dev/dsh-custom-router/preset.schema.json',
  title: 'Custom Router Provider Preset',
  type: 'object',
  required: ['id', 'row', 'providerId', 'kind', 'endpoint', 'auth', 'catalog', 'usage'],
  additionalProperties: true,
  properties: {
    id: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
    name: { type: 'string' },
    kind: { enum: ENUMS.PRESET_KINDS },
    package: { type: 'string', pattern: '^@[a-z0-9-]+/[a-z0-9-]+(?:/[a-z0-9-]+)*$' },
    row: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
    entries: {
      type: 'array',
      description: 'Loader rows this preset mounts. `row` is the settings namespace; `specifier` defaults to the preset package.',
      items: {
        type: 'object',
        required: ['row'],
        properties: {
          row: { type: 'string', pattern: '^[a-z][a-z0-9-]*$' },
          specifier: { type: 'string', minLength: 1 },
          config: { type: 'object' },
        },
      },
    },
    providerId: { type: 'string', minLength: 1 },
    modelPrefixes: { type: 'array', minItems: 1, items: { type: 'string', pattern: '^[^/]+$' } },
    endpoint: {
      type: 'object',
      required: ['mode', 'protocol', 'route', 'baseUrl'],
      properties: {
        mode: { enum: ENUMS.ENDPOINT_MODES },
        protocol: { enum: ENUMS.WIRE_PROTOCOLS },
        route: { enum: ENUMS.WIRE_SERVERS },
        baseUrl: { type: 'string' },
        chatPath: { type: 'string', pattern: '^/' },
        transport: { enum: ENUMS.TRANSPORTS },
      },
    },
    auth: {
      type: 'object',
      required: ['mode', 'sources'],
      properties: {
        mode: { enum: ENUMS.AUTH_MODES },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            required: ['kind'],
            properties: {
              kind: { enum: ENUMS.AUTH_SOURCES },
              name: { type: 'string' },
            },
          },
        },
      },
    },
    catalog: {
      type: 'object',
      required: ['mode', 'layers'],
      properties: {
        mode: { enum: ENUMS.CATALOG_MODES },
        layers: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['source'],
            properties: {
              source: { enum: ENUMS.CATALOG_LAYERS },
              providers: { type: 'array', items: { type: 'string' } },
              kind: { enum: ENUMS.PROBE_KINDS },
              shape: { enum: ENUMS.PROBE_SHAPES },
              namespace: { type: 'string' },
              endpoint: { type: 'string', pattern: '^/' },
              ttlMs: { type: 'number' },
              models: { type: 'array', items: { type: 'object', required: ['id'] } },
              pricing: {
                type: 'array',
                items: {
                  type: 'object',
                  required: ['modelId', 'cost'],
                  properties: { modelId: { type: 'string' }, cost: { type: 'object' } },
                },
              },
            },
          },
        },
      },
    },
    usage: {
      type: 'object',
      required: ['record', 'plan'],
      properties: {
        record: { type: 'string', minLength: 1 },
        plan: { enum: ENUMS.PLAN_STATES },
        billing: {
          type: 'object',
          required: ['mode'],
          properties: {
            mode: { enum: ENUMS.BILLING_MODES },
            service: { type: 'string' },
            windows: { type: 'array', items: { type: 'object', required: ['label'] } },
          },
        },
      },
    },
  },
})
