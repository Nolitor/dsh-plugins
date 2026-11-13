/**
 * @nolit/dsh-exaone — an EXAONE API Platform model route for DeepSeek Harness.
 *
 * Registers ONE provider route (`exaone`) whose adapter calls
 * `POST https://api.exaone.ai/v1/chat/completions` directly. There is no daemon,
 * no spawn, and no credential store: the only moving part is one bearer key.
 *
 * Credential precedence is UI-first: a key saved in the router settings
 * (`vendorConfig['dsh-exaone'].apiKey`, a schemastery role('secret') field) wins,
 * and `EXAONE_API_KEY` from the environment is the fallback.
 *
 * Facts read from docs.exaone.ai (2026-11-13):
 *   - base URL `https://api.exaone.ai`, OpenAI-compatible `/v1/chat/completions`
 *   - model `k-exaone_v2.5`, context 524,288 tokens, text only
 *   - reasoning always on; `reasoning_effort` low | high | max (default max)
 *   - tool calling and structured outputs are advertised features
 *
 * @module @nolit/dsh-exaone
 */
import Schema from '@deepseek-ai/schemastery'

import { EXAONEAdapter } from './adapter.js'
import {
  CONTEXT_WINDOW,
  DEFAULT_EFFORT,
  DEFAULT_TURN_MAX_TOKENS,
  PROVIDER_ID,
  describeModels,
} from './catalog.js'
import { DEFAULT_BASE_URL } from './wire.js'

/**
 * Credential precedence, as one pure rule so it can be tested without a host:
 * an explicitly configured key wins, then the DSH credential-store value, then
 * the ambient environment. A blank never wins.
 *
 * @param {unknown} uiKey - value from the settings `apiKey` field.
 * @param {unknown} storedKey - value resolved from the DSH credential store.
 * @param {unknown} envKey - ambient environment fallback.
 * @returns {string} the key to use, or '' when none is configured.
 */
export function keyPrecedence(uiKey, storedKey, envKey) {
  const explicit = typeof uiKey === 'string' ? uiKey.trim() : ''
  if (explicit.length > 0) return explicit
  if (typeof storedKey === 'string' && storedKey.trim().length > 0) return storedKey.trim()
  return typeof envKey === 'string' ? envKey.trim() : ''
}

/** This plugin's entry name; also its settings namespace. */
export const name = 'dsh-exaone'

/** The provider route this plugin owns. */
export { PROVIDER_ID }

/** Only `llm` is mandatory; the panel route is deferred on `connection`. */
export const inject = ['llm']

/**
 * Config schema.
 *
 * `apiKey` is a write-only secret: the settings service redacts it on every
 * read, so the browser learns only whether a value is set.
 */
export const Config = Schema.object({
  /** Provider base URL. Override only for a compatible gateway. */
  baseUrl: Schema.string().default(DEFAULT_BASE_URL).description('EXAONE base URL (OpenAI-compatible).').volatile(),
  /** Bearer credential. Empty falls back to EXAONE_API_KEY. */
  apiKey: Schema.string().default('').role('secret').description('EXAONE API key. Leave empty to use credentialRef, then EXAONE_API_KEY.').volatile(),
  /**
   * DSH credential-store reference (an env-var-shaped name in
   * `~/.dsh/.credentials.yaml` -> `refs:`). The store owns the value; the
   * profile carries only this name.
   */
  credentialRef: Schema.string().default('EXAONE_API_KEY').description('DSH credential-store ref used when apiKey is empty.').volatile(),
  /** Completion tokens one turn reserves. */
  turnMaxTokens: Schema.number().default(DEFAULT_TURN_MAX_TOKENS).description('Completion tokens one turn reserves.').volatile(),
  /** Default reasoning effort: low | high | max. */
  defaultEffort: Schema.string().default(DEFAULT_EFFORT).description('Default reasoning effort: low|high|max.').volatile(),
  /** Advertise only this model id when non-empty. */
  enabledModels: Schema.array(Schema.string()).default([]).description('Only advertise these model ids (empty = all).').volatile(),
})

/**
 * Read one config field without assuming the schema is materialised.
 * @param {unknown} config - plugin config.
 * @param {string} key - field name.
 * @returns {unknown} the live value.
 */
function configValue(config, key) {
  const entry = config?.[key]
  if (entry !== null && typeof entry === 'object' && typeof entry.get === 'function') {
    const value = entry.get()
    return value === undefined ? undefined : value
  }
  return entry
}

/**
 * Read a string config field with a fallback.
 * @param {unknown} config - plugin config.
 * @param {string} key - field name.
 * @param {string} fallback - value used when unset.
 * @returns {string} the value.
 */
function stringAt(config, key, fallback) {
  const value = configValue(config, key)
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : fallback
}

/**
 * Read a service without an `inject` declaration, mirroring the vendored
 * DeepInfra guard: a bare property read of a service the plugin did not inject
 * throws inside cordis, so the credential store is optional by construction.
 *
 * @param {object} ctx - cordis context.
 * @param {string} name - service name.
 * @returns {*} the service, or undefined when not injected.
 */
function optional(ctx, name) {
  try {
    return ctx?.[name]
  } catch {
    return undefined
  }
}

/**
 * Read a positive number config field with a fallback.
 * @param {unknown} config - plugin config.
 * @param {string} key - field name.
 * @param {number} fallback - value used when unset.
 * @returns {number} the value.
 */
function numberAt(config, key, fallback) {
  const value = Number(configValue(config, key))
  return Number.isFinite(value) && value > 0 ? value : fallback
}

/**
 * Register the provider route and the models-panel route.
 * @param {object} ctx - cordis context.
 * @param {object} config - validated plugin config.
 */
export function apply(ctx, config) {
  const log = {
    warn: (message) => {
      try {
        ctx?.logger?.warn?.(message)
      } catch {
        /* logging is advisory */
      }
    },
  }

  // The host credential store is the managed path: the value lives in
  // `~/.dsh/.credentials.yaml` under `refs:`. An unresolvable ref is a warning
  // plus the env fallback, never a crash and never a logged value.
  let storedKey = ''
  const credentialRefName = () => stringAt(config, 'credentialRef', 'EXAONE_API_KEY').trim()
  const resolveStoredKey = async () => {
    const ref = credentialRefName()
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(ref)) return ''
    try {
      // `get(name)` reads a mounted service WITHOUT an inject requirement
      // (cordis:1345). A bare property read of a service this plugin does not
      // inject throws "cannot get property ... without inject" (cordis:1257),
      // and swallowing that error silently disabled the key. Both presets
      // inject only `llm`, so this accessor is the correct one.
      // strict=false: return the provider even while its fiber is still
      // activating (a plugin apply() can run first — measured 2026-11-14).
      const credentials = ctx?.get?.('credentials', false)
      const found = await credentials?.resolve?.(ref)
      return typeof found?.value === 'string' ? found.value : ''
    } catch (error) {
      log.warn('dsh-exaone: credential ref "' + ref + '" could not be resolved: ' + (error instanceof Error ? error.message : String(error)))
      return ''
    }
  }
  const refreshStoredKey = () => { void resolveStoredKey().then((value) => { storedKey = value }) }
  // MEASURED 2026-11-14: `ctx.get(name, strict)` returns undefined while the
  // providing fiber is not yet active, and a plugin `apply()` can run before the
  // credentials service is. A single eager attempt therefore left the key empty
  // for the whole process (live DeepInfra child: `HTTP 401: missing API key`).
  // `ctx.inject([...])` is cordis's deferred sub-context: the callback runs as
  // soon as the service is available, which is the correct mount seam.
  refreshStoredKey()
  try {
    ctx?.inject?.(['credentials'], (scoped) => {
      refreshStoredKey()
      scoped?.on?.('credentials/reference-updated', (ref) => {
        if (ref === undefined || ref === credentialRefName()) refreshStoredKey()
      })
    })
  } catch {
    /* an older host without deferred inject keeps the eager attempt */
  }

  /** Live settings: a key saved in the UI applies on the next request. */
  const settings = () => {
    const uiKey = stringAt(config, 'apiKey', '')
    const envKey = typeof process.env.EXAONE_API_KEY === 'string' ? process.env.EXAONE_API_KEY.trim() : ''
    const enabled = configValue(config, 'enabledModels')
    return {
      baseUrl: stringAt(config, 'baseUrl', DEFAULT_BASE_URL),
      // Precedence: explicit UI key -> DSH credential store -> env.
      apiKey: keyPrecedence(uiKey, storedKey, envKey),
      maxTokens: numberAt(config, 'turnMaxTokens', DEFAULT_TURN_MAX_TOKENS),
      defaultEffort: stringAt(config, 'defaultEffort', DEFAULT_EFFORT),
      enabledModels: Array.isArray(enabled) ? enabled : [],
    }
  }

  const adapter = new EXAONEAdapter({
    settings,
    fetchImpl: (...args) => globalThis.fetch(...args),
    log,
  })

  // Effect-based registration: disposal is owned by the fiber, and a duplicate
  // route throws instead of silently shadowing (hard mount failure by design).
  const registration = ctx.llm.registerAdapter([PROVIDER_ID], adapter)
  ctx.effect?.(() => () => registration?.())

  /** The models-panel payload at request time, so a saved selection is read live. */
  const modelsPayload = () => describeModels({ enabledModels: configValue(config, 'enabledModels') })

  // The router's models tab POSTs to this route. `connection.fetch.register` is
  // the measured seam (see the vendored DeepInfra server); a host without it
  // still serves models, only the tab's list is inert.
  try {
    ctx.inject?.(['connection'], (scoped) => {
      const register = scoped?.connection?.fetch?.register
      if (typeof register !== 'function') {
        log.warn('dsh-exaone: connection seam exposes no register function; models panel unavailable')
        return
      }
      scoped.effect?.(() => register.call(scoped.connection.fetch, {
        path: '/api/local/dsh-exaone/models',
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async () => new Response(JSON.stringify(modelsPayload()), {
          status: 200,
          headers: { 'content-type': 'application/json; charset=utf-8' },
        }),
      }), 'dsh-exaone: models')
    })
  } catch (error) {
    log.warn('dsh-exaone: models panel route unavailable: ' + (error instanceof Error ? error.message : String(error)))
  }
}

export { EXAONEAdapter } from './adapter.js'
export { CONTEXT_WINDOW } from './catalog.js'
