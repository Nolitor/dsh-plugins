/**
 * Local HTTP routes behind the Antigravity settings section and usage chip.
 *
 * The web seam is `ctx.connection.fetch.register` — measured in the installed
 * host and proven by the DeepInfra and OpenCode v2 tracks. `connection.register`
 * does not exist. A profile with no `connection` service (headless) simply gets
 * no panel routes; the model surface is unaffected.
 *
 * EVERY handler returns a WHATWG `Response`. The seam's `fetch(route)` is typed
 * `(request: Request) => Promise<Response>`; returning a plain object made the
 * carrier answer 400 with an empty body while the route itself was registered
 * (measured 2026-11-05: settings section showed "Could not save: HTTP 400").
 * DeepInfra wraps every handler in its `json()` helper for the same reason.
 *
 * Nothing here writes to the CLI credential file, and the client secret is never
 * echoed back.
 *
 * @module @nolit/dsh-antigravity/server
 */
import { groupByBase } from './catalog.js'
import { configValue } from './settings.js'

/** Settings namespace the host derives for this row (the Cordis entry id). */
export const SETTINGS_ID = 'dsh-antigravity'

/**
 * Build a JSON `Response`.
 * @param data - JSON-serializable payload.
 * @param status - HTTP status.
 * @returns a WHATWG Response.
 */
export function json(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  })
}

/**
 * Write one patch through the host settings service.
 *
 * The plugin config is a Cordis accessor, not a mutable object: the previous
 * implementation called `config[key].set(...)`, which does not exist on the
 * host's config wrapper, so every toggle reported success while changing
 * nothing. `settings.update(rowId, patch)` is the seam the host actually owns
 * (measured in dsh-deepinfra).
 *
 * @param settings - the scoped `settings` service, when available.
 * @param patch - fields to persist.
 * @returns true when the write was accepted.
 */
async function persist(settings, patch) {
  if (typeof settings?.update !== 'function') return false
  await settings.update(SETTINGS_ID, patch)
  return true
}

/** Family labels used when the client has no locale entry for the kind. */
const FAMILY_LABELS = {
  gemini: 'Gemini Models',
  'claude-gpt': 'Claude and GPT models',
  argon: 'Gemini 4 Argon',
  other: 'Other models',
}

/** Family order in the settings list, mirroring the account's usage groups. */
const FAMILY_ORDER = ['gemini', 'claude-gpt', 'argon', 'other']

/**
 * Which usage family a model id belongs to.
 *
 * The Antigravity usage page groups limits as Gemini / Claude-and-GPT / Gemini 4
 * Argon (measured 2026-11-05). Those families also share one quota reset window,
 * which is the signal we can read from `fetchAvailableModels`.
 * @param id - raw model id.
 * @returns the family kind.
 */
function familyOf(id) {
  if (String(id).startsWith('gemini-4-argon')) return 'argon'
  if (String(id).startsWith('claude-') || String(id).startsWith('gpt-')) return 'claude-gpt'
  if (String(id).startsWith('gemini-')) return 'gemini'
  return 'other'
}

/**
 * Group the flat catalog into the same families the usage page shows, then into
 * BASE models: reasoning levels are model-id suffixes and must not become
 * separate rows here. A base model's checkbox owns every variant id, so the
 * saved `enabledModels` set stays valid for the picker.
 *
 * @param entries - flat catalog entries from `parseCatalog`.
 * @param enabledModels - the saved id allow-list; empty means all.
 * @returns one group per family/reset window, each with base-model rows.
 */
export function groupModels(entries, enabledModels = []) {
  const buckets = new Map()
  for (const entry of entries ?? []) {
    const kind = familyOf(entry.id)
    const reset = entry.quota?.resetTime ?? 'none'
    const key = kind + '|' + reset
    let bucket = buckets.get(key)
    if (bucket === undefined) {
      bucket = { kind, reset, entries: [] }
      buckets.set(key, bucket)
    }
    bucket.entries.push(entry)
  }
  const groups = []
  for (const bucket of buckets.values()) {
    const bases = groupByBase(bucket.entries)
    const models = bases.map((base) => {
      const variants = base.members.map((member) => member.id)
      return {
        id: base.id,
        name: base.name,
        variants,
        enabled: enabledModels.length === 0 || variants.every((id) => enabledModels.includes(id)),
      }
    })
    const quota = bucket.entries.map((entry) => entry.quota).filter(Boolean)
    const remaining = quota.length > 0
      ? Math.min(...quota.map((entry) => entry.remaining))
      : null
    groups.push({
      kind: bucket.kind,
      label: FAMILY_LABELS[bucket.kind] ?? FAMILY_LABELS.other,
      quotaRemaining: remaining,
      quotaReset: quota[0]?.resetTime ?? null,
      limits: [],
      models,
    })
  }
  groups.sort((left, right) => FAMILY_ORDER.indexOf(left.kind) - FAMILY_ORDER.indexOf(right.kind))
  return groups
}

/**
 * Map an API quota group label to the family kind used by the model list.
 * @param label - `Gemini Models`, `Claude and GPT models`, `Gemini 4 Argon`.
 * @returns the kind, or `other`.
 */
function familyKindOfLabel(label) {
  const text = String(label ?? '')
  if (/argon/i.test(text)) return 'argon'
  if (/claude|gpt/i.test(text)) return 'claude-gpt'
  if (/gemini/i.test(text)) return 'gemini'
  return 'other'
}

/**
 * Attach the account's weekly / 5-hour buckets to the model groups.
 *
 * The summary RPC was measured 2026-11-05: it returns exactly the three groups
 * the Antigravity usage page shows, with a `window` of `weekly` or `5h`.
 *
 * @param groups - result of `groupModels`.
 * @param summary - `retrieveUserQuotaSummary` body, or undefined.
 * @returns the same groups with `limits` filled.
 */
export function attachQuota(groups, summary) {
  const byKind = new Map()
  for (const source of summary?.groups ?? []) {
    byKind.set(familyKindOfLabel(source.displayName), source)
  }
  for (const group of groups) {
    const source = byKind.get(group.kind)
    group.limits = (source?.buckets ?? []).map((bucket) => ({
      window: bucket.window,
      remainingFraction: bucket.remainingFraction,
      resetTime: bucket.resetTime,
      description: bucket.description,
    }))
  }
  return groups
}

/** Route suffix -> handler. Prefixed with `/api/local/<plugin>/`. */
function createRoutes({ config, catalog, endpointOf, ledger, settings, installed, invalidate, quota, onModelsApplied }) {
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
        // What the host actually holds right now, so a toggle can be verified
        // without guessing from a cached picker.
        installed: installed?.() ?? null,
        usage: ledger.summary(),
      }
    },

    /** Persist one or more surface switches. Only known keys are accepted. */
    switches: async (request) => {
      const body = await request.json?.().catch(() => ({})) ?? {}
      const allowed = ['enabled', 'modelServing', 'cliWorker', 'usagePill']
      const patch = {}
      for (const key of allowed) {
        if (typeof body?.[key] === 'boolean') patch[key] = body[key]
      }
      if (Object.keys(patch).length === 0) return json({ error: 'no supported switch in the request' }, 400)
      if (!(await persist(settings, patch))) {
        return json({ error: 'this host exposes no settings service; edit the profile patch instead' }, 409)
      }
      return json({ ok: true, applied: patch })
    },

    /**
     * Live catalog grouped like the account's usage page: family -> base model.
     * Effort suffixes are hidden; a base row owns all of its variants.
     */
    models: async () => {
      const all = await catalog.all().catch(() => [])
      const enabled = configValue(config, 'enabledModels') ?? []
      const summary = await quota?.().catch(() => undefined)
      const groups = attachQuota(groupModels(all, enabled), summary)
      const total = groups.reduce((count, group) => count + group.models.length, 0)
      const enabledCount = groups.reduce(
        (count, group) => count + group.models.filter((model) => model.enabled).length,
        0,
      )
      const flat = all.map((entry) => ({
        id: entry.id,
        name: entry.name,
        contextWindow: entry.maxInputTokens ?? null,
        maxOutputTokens: entry.maxOutputTokens ?? null,
        supportsThinking: entry.supportsThinking === true,
        quotaRemaining: entry.quota?.remaining ?? null,
        quotaReset: entry.quota?.resetTime ?? null,
        enabled: enabled.length === 0 ? true : enabled.includes(entry.id),
      }))
      return { groups, total, enabled: enabledCount, models: flat }
    },

    /** Persist which model ids the picker advertises. */
    'models/apply': async (request) => {
      const body = await request.json?.().catch(() => ({})) ?? {}
      const next = Array.isArray(body?.enabled) ? body.enabled.filter((id) => typeof id === 'string') : []
      if (!(await persist(settings, { enabledModels: next }))) {
        return json({ error: 'this host exposes no settings service; edit the profile patch instead' }, 409)
      }
      invalidate?.()
      // DSH has already persisted the allow-list. Mirror that exact list to the
      // optional OpenCodex serving surface; never copy credentials here.
      if (typeof onModelsApplied === 'function') {
        try {
          await onModelsApplied(next)
        } catch (error) {
          return json({ ok: false, enabled: next, error: error instanceof Error ? error.message : String(error) }, 502)
        }
      }
      return json({ ok: true, enabled: next })
    },

    /** Usage counters accumulated by this plugin from real turns. */
    usage: async () => ledger.summary(),
  }
}

/**
 * Register the panel routes on the web seam.
 * @param ctx - cordis context.
 * @param deps - `{ config, catalog, endpointOf, ledger, pluginName }`.
 * @param scoped - scoped context that owns `connection` and `settings`.
 * @returns a disposer, or undefined when the seam is unavailable.
 */
export function registerRoutes(ctx, deps, scoped) {
  // The ROOT context does not own `connection`: cordis throws on an undeclared
  // service read, and even a guarded read returns undefined on the web profile.
  // The routes must be registered from a SCOPED context obtained with
  // `ctx.inject(['connection','settings'], fn)` — the pattern dsh-deepinfra
  // measured (its panel answered 404 while its unit suite stayed green).
  let connection = scoped?.connection
  if (connection === undefined) {
    try {
      connection = ctx.connection
    } catch {
      connection = undefined
    }
  }
  const settings = scoped?.settings
  const register = connection?.fetch?.register
  if (typeof register !== 'function') {
    ctx?.logger?.warn?.(deps.pluginName + ': connection seam exposes no fetch.register; settings panel routes unavailable')
    return undefined
  }

  const ledger = deps.ledger ?? createLedger()
  const routes = createRoutes({ ...deps, ledger, settings, onModelsApplied: deps.onModelsApplied })
  const releases = []
  for (const [suffix, handler] of Object.entries(routes)) {
    try {
      // The route descriptor field is `fetch`, NOT `handler`. Measured 2026-11-05:
      // `handler` is silently ignored by the router, so the route never registers
      // and every panel request answers 404 while the plugin itself looks healthy.
      // `methods` and `requestBody` are part of the descriptor too.
      const registerOne = () => register.call(connection.fetch, {
        path: '/api/local/' + deps.pluginName.replace('@nolit/', '') + '/' + suffix,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            const result = await handler(request)
            // The carrier requires a Response. A plain object reaches the bridge
            // as an invalid payload and is answered with 400.
            return result instanceof Response ? result : json(result)
          } catch (error) {
            ctx?.logger?.warn?.(deps.pluginName + ': ' + suffix + ' failed: ' + (error instanceof Error ? error.message : String(error)))
            return json({ error: error instanceof Error ? error.message : String(error) }, 500)
          }
        },
      })
      // ctx.effect ties the registration to the plugin lifetime; without it a
      // reload leaves the previous route mounted.
      const release = typeof ctx.effect === 'function'
        ? ctx.effect(registerOne, deps.pluginName + ': ' + suffix)
        : registerOne()
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
