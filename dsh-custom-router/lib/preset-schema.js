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
 *     `sse`, `websocket`, `websocket-cached`, `auto`) plus the Google wire the
 *     Antigravity route speaks (`google-generative-sse`);
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

/** Wire protocols the host itself implements (routable through PiAiAdapter). */
export const DSH_PROTOCOLS = Object.freeze([
  'openai-completions',
  'openai-responses',
  'anthropic-messages',
])

/** Every wire protocol a preset may name (host-native plus measured vendor wires). */
export const WIRE_PROTOCOLS = Object.freeze([...DSH_PROTOCOLS, 'google-generative-sse'])

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
 */
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
    kind: { enum: ['package', 'declaration'] },
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
        mode: { enum: ['http', 'local-http', 'daemon'] },
        protocol: { enum: ['openai-completions', 'openai-responses', 'anthropic-messages', 'google-generative-sse'] },
        route: { enum: ['pi-ai', 'own'] },
        baseUrl: { type: 'string' },
        chatPath: { type: 'string', pattern: '^/' },
        transport: { enum: ['sse', 'websocket', 'websocket-cached', 'auto'] },
      },
    },
    auth: {
      type: 'object',
      required: ['mode', 'sources'],
      properties: {
        mode: { enum: ['api-key', 'web-auth', 'local-socket', 'none'] },
        sources: {
          type: 'array',
          items: {
            type: 'object',
            required: ['kind'],
            properties: {
              kind: { enum: ['secret-field', 'env', 'credential-ref', 'token-file', 'daemon-endpoint'] },
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
        mode: { enum: ['live', 'cached', 'static'] },
        layers: {
          type: 'array',
          minItems: 1,
          items: {
            type: 'object',
            required: ['source'],
            properties: {
              source: { enum: ['upstream', 'probe', 'override'] },
              providers: { type: 'array', items: { type: 'string' } },
              kind: { enum: ['api', 'web-auth'] },
              shape: { enum: ['openai', 'anthropic', 'vendor'] },
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
        plan: { enum: ['available', 'unavailable'] },
        billing: {
          type: 'object',
          required: ['mode'],
          properties: {
            mode: { enum: ['subscription', 'flat', 'pay-per-token', 'none'] },
            service: { type: 'string' },
            windows: { type: 'array', items: { type: 'object', required: ['label'] } },
          },
        },
      },
    },
  },
})
