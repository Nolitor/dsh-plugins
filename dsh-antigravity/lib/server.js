/**
 * Local HTTP routes behind the Antigravity settings section and usage chip.
 *
 * The web seam is `ctx.connection.fetch.register` — measured in the installed
 * host and proven by the DeepInfra and OpenCode v2 tracks. `connection.register`
 * does not exist. A profile with no `connection` service (headless) simply gets
 * no panel routes; the model surface is unaffected.
 *
 * Every handler answers with plain JSON. Nothing here writes to the CLI
 * credential file, and the client secret is never echoed back.
 *
 * @module @nolit/dsh-antigravity/server
 */
import { configValue } from './settings.js'

/** Route suffix -> handler. Prefixed with `/api/local/<plugin>/`. */
function createRoutes({ config, catalog, endpointOf }) {
  return {
    /** Panel bootstrap: switches, account, catalog and quota in one call. */
    info: async () => {
      const account = await catalog.account().catch(() => undefined)
      return {
        switches: {
          enabled: configValue(config, 'enabled') !== false,
          modelServing: configValue(config, 'modelServing') !== false,
          cliWorker: configValue(config, 'cliWorker') !== false,
          usagePill: configValue(config, 'usagePill') !== false,
        },
        account: account ?? null,
        endpoint: { baseUrl: endpointOf().baseUrl, project: endpointOf().project },
      }
    },

    /** Persist one or more surface switches. Only known keys are accepted. */
    switches: async (request) => {
      const body = await request.json?.().catch(() => ({})) ?? {}
      const allowed = ['enabled', 'modelServing', 'cliWorker', 'usagePill']
      const applied = {}
      for (const key of allowed) {
        if (typeof body?.[key] !== 'boolean') continue
        const holder = config[key]
        if (holder && typeof holder.set === 'function') holder.set(body[key])
        applied[key] = body[key]
      }
      return { ok: true, applied }
    },

    /** Live catalog with quota and the current enable state. */
    models: async () => {
      const all = await catalog.all().catch(() => [])
      const enabled = configValue(config, 'enabledModels') ?? []
      const rows = all.map((entry) => ({
        id: entry.id,
        name: entry.name,
        contextWindow: entry.maxInputTokens ?? null,
        maxOutputTokens: entry.maxOutputTokens ?? null,
        supportsThinking: entry.supportsThinking === true,
        quotaRemaining: entry.quota?.remaining ?? null,
        quotaReset: entry.quota?.resetTime ?? null,
        enabled: enabled.length === 0 ? true : enabled.includes(entry.id),
      }))
      return { models: rows, total: rows.length }
    },

    /** Persist which model ids the picker advertises. */
    'models/apply': async (request) => {
      const body = await request.json?.().catch(() => ({})) ?? {}
      const next = Array.isArray(body?.enabled) ? body.enabled.filter((id) => typeof id === 'string') : []
      const holder = config.enabledModels
      if (holder && typeof holder.set === 'function') holder.set(next)
      return { ok: true, enabled: next }
    },

    /** Usage counters accumulated by this plugin from real turns. */
    usage: async ({ ledger }) => ledger?.summary?.() ?? { requests: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0 },
  }
}

/**
 * Register the panel routes on the web seam.
 * @param ctx - cordis context.
 * @param deps - `{ config, catalog, endpointOf, pluginName }`.
 * @returns a disposer, or undefined when the seam is unavailable.
 */
export function registerRoutes(ctx, deps) {
  let connection
  try {
    connection = ctx.connection
  } catch {
    connection = undefined
  }
  const register = connection?.fetch?.register
  if (typeof register !== 'function') {
    ctx?.logger?.warn?.(deps.pluginName + ': connection seam exposes no fetch.register; settings panel routes unavailable')
    return undefined
  }

  const ledger = createLedger()
  const routes = createRoutes(deps)
  const releases = []
  for (const [suffix, handler] of Object.entries(routes)) {
    try {
      const release = register.call(connection.fetch, {
        path: '/api/local/' + deps.pluginName.replace('@nolit/', '') + '/' + suffix,
        handler: (request) => handler(request, { ledger }),
      })
      if (typeof release === 'function') releases.push(release)
    } catch (error) {
      ctx?.logger?.warn?.(deps.pluginName + ': could not register ' + suffix + ': ' + (error instanceof Error ? error.message : String(error)))
    }
  }
  return () => {
    for (const release of releases.reverse()) {
      try {
        release()
      } catch {
        // Already released.
      }
    }
  }
}

/**
 * In-memory usage counters for the chip and the panel.
 *
 * Deliberately process-local: the subscription has no per-call price, so a
 * dollar figure would be invented. Token counts and request counts are measured.
 * @returns a ledger with `record` and `summary`.
 */
export function createLedger() {
  const state = { requests: 0, inputTokens: 0, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0 }
  return {
    record(usage) {
      if (!usage) return
      state.requests += 1
      state.inputTokens += Number(usage.inputTokens) || 0
      state.outputTokens += Number(usage.outputTokens) || 0
      state.reasoningTokens += Number(usage.reasoningTokens) || 0
      state.cacheReadTokens += Number(usage.cacheReadTokens) || 0
    },
    summary() {
      return { ...state }
    },
    reset() {
      for (const key of Object.keys(state)) state[key] = 0
    },
  }
}
