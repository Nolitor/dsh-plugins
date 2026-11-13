/**
 * Server half of the DeepInfra plugin: the local HTTP routes the client panel and
 * the composer chip call, plus the ledger instance they read.
 *
 * Route surface, mirroring the opencode-v2 shape exactly so one client pattern
 * serves both plugins:
 *
 *   POST /api/local/deepinfra/cost/session     { sessionId }  -> one session's spend
 *   POST /api/local/deepinfra/cost/summary     {}             -> every session
 *   POST /api/local/deepinfra/cost/reset       { sessionId? }  -> clear one/all
 *   POST /api/local/deepinfra/setup            {}             -> credential + catalog state
 *   POST /api/local/deepinfra/setup/apply      { apiKey?, baseURL?, turnMaxTokens?, defaultEffort? }
 *
 * Registration is via `ctx.connection` (the host's route seam). A host without it
 * still boots this plugin; only the panel is inert, and the adapter keeps serving.
 *
 * @module @nolit/dsh-deepinfra/server
 */
import { homedir } from 'node:os'
import { join } from 'node:path'

import { COST_FILE_NAME, createCostLedger, createCostStore, formatCost, parseCost, pickSession } from './cost.js'
import { API_KEY_ENV, configValue, maskKey, resolveCredentials } from './settings.js'
import { fetchLiveMetrics, pricesOf, promotionOf } from './catalog.js'

/**
 * Resolve where the spend ledger lives.
 *
 * Explicit setting, then `$DSH_HOME`, then the profile directory, then the user
 * home. Never the process working directory: a plugin's state must not depend on
 * where dsh happened to be started (the lesson opencode-v2 records).
 *
 * @param {{ explicit?: string, dshHome?: string, profileDir?: string }} options
 * @returns {string} absolute path to the ledger file.
 */
export function resolveLedgerPath({ explicit, dshHome, profileDir, homeDir } = {}) {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  // $DSH_HOME is the ONLY reliable root: the live web service exports it, and it
  // is what the profile directory is derived from. `ctx.profileDir` is NOT a
  // service the web profile exposes (measured), so relying on it silently put the
  // ledger in a path nobody reads.
  if (typeof dshHome === 'string' && dshHome.length > 0) return join(dshHome, COST_FILE_NAME)
  if (typeof profileDir === 'string' && profileDir.length > 0) return join(profileDir, COST_FILE_NAME)
  return join(homeDir ?? homedir(), '.dsh', COST_FILE_NAME)
}

/**
 * Build the server half.
 *
 * @param {object} options
 * @param {object} options.ctx - cordis context.
 * @param {object} options.config - live plugin config.
 * @param {object} options.catalog - `{ list, resolve }` reader.
 * @param {string} options.profileDir - profile directory, when known.
 * @param {object} [options.log] - `{ warn }`.
 * @returns {{ ledger: object, routes: object, recordCost: Function, dispose: Function }}
 */
export function createServer({ ctx, config, catalog, profileDir, log = { warn() {} }, onModelsApplied, invalidateCatalog }) {
  /**
   * Services handed by the deferred sub-context, when the plugin mounted its
   * panel through `ctx.inject([...])`. Reading the ROOT ctx in that case returns
   * a service the root does not own, which is how a saved key was rejected with
   * "this host exposes no settings service".
   */
  let scope = null

  /**
   * Services used by the panel routes, preferring the deferred sub-context.
   *
   * `ctx.inject(['connection','settings'], …)` hands a scoped context that owns
   * both services; the root context does not. Reading the root for `settings` is
   * what produced "this host exposes no settings service" on a real save.
   *
   * @returns {{ settings: object|undefined, connection: object|undefined }}
   */
  const services = () => {
    if (scope !== null) return { settings: scope.settings, connection: scope.connection }
    const read = (name) => {
      try {
        return ctx?.[name]
      } catch {
        return undefined
      }
    }
    return { settings: read('settings'), connection: read('connection') }
  }
  const ledgerPath = resolveLedgerPath({ dshHome: process.env.DSH_HOME, profileDir })
  const store = createCostStore({ path: ledgerPath })
  // Name the path once at construction: a ledger nobody can find is how "usage is
  // zero" looked like a parsing bug when the file was simply never written where
  // anyone looked.
  log.warn('dsh-deepinfra: usage ledger at ' + ledgerPath)
  const ledger = createCostLedger({ store })

  /**
   * Record one request's cost. Called by the adapter on every completed stream.
   *
   * Never throws: bookkeeping must not fail a generation.
   *
   * @param {object} options - the harness request (provides sessionId and model).
   * @param {object} rawUsage - the provider's raw usage object.
   * @param {number} [turn] - the DSH turn this request belongs to, when known.
   */
  const recordCost = (options, rawUsage, turn, pricing, requestId) => {
    try {
      if (rawUsage === null || typeof rawUsage !== 'object') return
      // `pricing` is the catalog row's price list, which lets the ledger store the
      // LIST figure beside the BILLED one.
      const cost = parseCost(rawUsage, pricing)
      const attributed = Number.isInteger(turn) ? turn : options?.turn
      // The provider's request id travels with the record: it is the only key that
      // can later map a local row to an authoritative invoice line.
      if (typeof requestId === 'string' && requestId.length > 0) cost.requestId = requestId
      ledger.record(options?.sessionId === undefined ? undefined : String(options.sessionId), options?.model, cost, attributed)
    } catch (error) {
      log.warn('dsh-deepinfra: cost bookkeeping failed: ' + (error instanceof Error ? error.message : String(error)))
    }
  }

  const json = (body, status = 200) => new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })

  /**
   * Whether one request asks for a cache bypass (`?refresh=1`).
   * @param {Request} request - the route request.
   * @returns {boolean} true when the client asked for a fresh upstream answer.
   */
  const isForced = (request) => {
    try {
      return new URL(request?.url ?? 'http://localhost/').searchParams.get('refresh') === '1'
    } catch {
      return false
    }
  }

  /**
   * Read a JSON request body, tolerating an empty one.
   * @param {Request} request - the incoming request.
   * @returns {Promise<object>} the parsed body, or {}.
   */
  const bodyOf = async (request) => {
    try {
      const text = await request.text()
      if (typeof text !== 'string' || text.trim().length === 0) return {}
      const parsed = JSON.parse(text)
      return parsed !== null && typeof parsed === 'object' ? parsed : {}
    } catch {
      return {}
    }
  }

  /** Describe the live credential and catalog state for the settings card. */
  const describeSetup = async () => {
    const credentials = resolveCredentials(config)
    let models = []
    let catalogError = null
    try {
      models = await catalog.list('deepinfra')
    } catch (error) {
      catalogError = error instanceof Error ? error.message : String(error)
    }
    const summary = ledger.summary()
    return {
      // The key itself never leaves the process (failure ledger F-12): the panel
      // gets the source and a masked tail so it can say what is in force.
      apiKey: maskKey(credentials.apiKey),
      apiKeySource: credentials.apiKeySource,
      apiKeyEnvName: API_KEY_ENV,
      hasApiKey: credentials.apiKey.length > 0,
      baseURL: credentials.baseURL,
      baseURLSource: credentials.baseURLSource,
      turnMaxTokens: Number(configValue(config, 'turnMaxTokens')) || 16384,
      defaultEffort: String(configValue(config, 'defaultEffort') ?? ''),
      catalogCount: Array.isArray(models) ? models.length : 0,
      promotionalCount: Array.isArray(models) ? models.filter((entry) => promotionOf(entry) !== null).length : 0,
      catalogError,
      // Platform-wide throughput. Reported separately from account usage so the two
      // are never confused: these numbers describe the whole fleet.
      platform: await fetchLiveMetrics(String(configValue(config, 'baseURL') ?? 'https://api.deepinfra.com').replace(/\/v1\/openai$/, '')),
      usage: {
        sessions: summary.sessions,
        requests: summary.requests,
        // billed = what DeepInfra charged; list = the same tokens at catalog price.
        costUsd: summary.costUsd,
        listCostUsd: summary.listCostUsd ?? 0,
        recent: summary.recent.slice(0, 10),
      },
    }
  }

  /**
   * Describe every served route for the settings panel.
   *
   * Each row carries what the operator needs to CHOOSE: the exact id, context,
   * reasoning support, the effective price, and whether it is promotional. The
   * enabled subset comes from live config, so a save round-trips.
   *
   * @returns {Promise<object>} `{ models, enabled }`.
   */
  const describeModels = async () => {
    const entries = await catalog.entries().catch(() => [])
    const enabled = configValue(config, 'enabledModels')
    const allowed = Array.isArray(enabled) ? enabled : []
    const models = (Array.isArray(entries) ? entries : []).map((entry) => {
      const tags = Array.isArray(entry.metadata?.tags) ? entry.metadata.tags : []
      const prices = pricesOf(entry)
      return {
        id: entry.id,
        contextWindow: Number(entry.metadata?.context_length) || null,
        vision: tags.includes('vision') || tags.includes('vlm'),
        reasoning: tags.includes('reasoning') || tags.includes('reasoning_effort'),
        // A promotion is derived from metadata.discount: the catalog has no
        // featured/promo tag, only capability tags.
        promotion: prices.promotion,
        price: { input: prices.input, output: prices.output, listInput: prices.listInput, listOutput: prices.listOutput },
        enabled: allowed.length === 0 ? true : allowed.includes(entry.id),
      }
    })
    // Promotional routes first (deepest discount first), then the rest, so the
    // operator sees the offers without hunting.
    models.sort((left, right) => {
      const lp = left.promotion === null ? 0 : left.promotion.discount
      const rp = right.promotion === null ? 0 : right.promotion.discount
      if (rp !== lp) return rp - lp
      return String(left.id).localeCompare(String(right.id))
    })
    return {
      models,
      enabled: allowed,
      promotionCount: models.filter((m) => m.promotion !== null).length,
      total: models.length,
    }
  }

  const routes = {
    /**
     * Every served route, for the settings panel.
     *
     * `?refresh=1` drops the 30-minute catalog cache first, so the panel's
     * refresh button reaches the provider instead of replaying a stale answer.
     * @param {Request} request - the route request.
     */
    models: async (request) => {
      if (isForced(request)) invalidateCatalog?.()
      return json(await describeModels())
    },
    'models/apply': async (request) => {
      const body = await bodyOf(request)
      if (!Array.isArray(body.enabled)) return json({ error: 'expected { enabled: string[] }' }, 400)
      // NO minimum. The operator chooses exactly which models the prompt may
      // offer, and "one model only" is a legitimate intent. An earlier MIN_KEEP=5
      // guard was removed on instruction 2026-11-05: it blocked precisely the
      // selection the operator wanted. `[]` means "serve everything"; any
      // non-empty list is honoured verbatim.
      const settings = services().settings
      if (typeof settings?.update !== 'function') {
        return json({ error: 'this host exposes no settings service; edit the profile patch instead', ...(await describeModels()) }, 409)
      }
      const enabledModels = body.enabled.filter((id) => typeof id === 'string' && id.length > 0)
      await settings.update('dsh-deepinfra', { enabledModels })
      if (typeof onModelsApplied === 'function') {
        try {
          await onModelsApplied(enabledModels)
        } catch (error) {
          return json({ ok: false, enabled: enabledModels, error: error instanceof Error ? error.message : String(error) }, 502)
        }
      }
      return json(await describeModels())
    },
    'cost/session': async (request) => {
      const body = await bodyOf(request)
      const summary = ledger.summary()
      const entry = pickSession(summary, body.sessionId)
      return json({
        session: entry,
        text: formatCost(entry),
        // The aggregate is returned beside the session so the chip can show a real
        // running total before the DOM's session id resolves.
        totals: { sessions: summary.sessions, requests: summary.requests, costUsd: summary.costUsd },
      })
    },
    'cost/summary': async () => json(ledger.summary()),
    'cost/reset': async (request) => {
      const body = await bodyOf(request)
      ledger.reset(typeof body.sessionId === 'string' && body.sessionId.length > 0 ? body.sessionId : undefined)
      return json(ledger.summary())
    },
    setup: async () => json(await describeSetup()),
    'setup/apply': async (request) => {
      const body = await bodyOf(request)
      const settings = services().settings
      if (typeof settings?.update !== 'function') {
        // A host without the settings service can still run the plugin: report why
        // the write could not land instead of throwing at the operator.
        return json({ error: 'this host exposes no settings service; edit the profile patch instead', ...(await describeSetup()) }, 409)
      }
      const patch = {}
      if (typeof body.apiKey === 'string') patch.apiKey = body.apiKey.trim()
      if (typeof body.baseURL === 'string' && body.baseURL.trim().length > 0) patch.baseURL = body.baseURL.trim()
      if (Number.isFinite(Number(body.turnMaxTokens)) && Number(body.turnMaxTokens) > 0) patch.turnMaxTokens = Math.trunc(Number(body.turnMaxTokens))
      if (typeof body.defaultEffort === 'string') patch.defaultEffort = body.defaultEffort
      if (Object.keys(patch).length === 0) return json({ error: 'no supported field in the request' }, 400)
      await settings.update('dsh-deepinfra', patch)
      return json(await describeSetup())
    },
  }

  /**
   * Register every route on the host's connection seam.
   * @returns {void}
   */
  const dispose = (scoped) => {
    if (scoped !== undefined && scoped !== null) scope = scoped
    // The deferred sub-context guarantees `connection`; the root does not own it
    // at apply() time, which is what produced four 404s before the deferral.
    const connection = services().connection
    if (connection === null || connection === undefined) {
      log.warn('dsh-deepinfra: host has no connection service; the settings panel routes are unavailable')
      return
    }
    // The seam is ctx.connection.fetch.register — measured in the installed host
    // and in the reference plugin. `connection.register` does not exist; guessing
    // it produced four 404s on the live page while every unit test passed.
    const register = connection.fetch?.register
    if (typeof register !== 'function') {
      log.warn('dsh-deepinfra: connection seam exposes no register function; panel routes unavailable')
      return
    }
    for (const [suffix, handler] of Object.entries(routes)) {
      try {
        ctx.effect(
          () => register.call(connection.fetch, {
            path: '/api/local/deepinfra/' + suffix,
            methods: ['POST'],
            requestBody: 'buffered',
            fetch: async (request) => {
              try {
                return await handler(request)
              } catch (error) {
                log.warn('dsh-deepinfra: ' + suffix + ' failed: ' + (error instanceof Error ? error.message : String(error)))
                return json({ error: error instanceof Error ? error.message : String(error) }, 500)
              }
            },
          }),
          'dsh-deepinfra: ' + suffix,
        )
      } catch (error) {
        log.warn('dsh-deepinfra: could not register ' + suffix + ': ' + (error instanceof Error ? error.message : String(error)))
      }
    }
  }

  return { ledger, routes, recordCost, describeSetup, dispose }
}
