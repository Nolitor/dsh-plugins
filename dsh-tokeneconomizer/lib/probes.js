// Capability probes for DSH seams. This module only REPORTS capability: it
// implements, patches, and caches nothing. DSH exposes no probe API, so discovery
// is a static catalog (SEAM_CATALOG) plus per-session runtime lookup. A missing
// contract-tier seam is a loud compatibility fault; a missing internal-tier seam
// only degrades. No runtime imports outside node: builtins.

/**
 * @typedef {'contract'|'internal'} Tier
 * @typedef {{ ok: boolean, tier: Tier, deprecated: boolean, reason: string }} ProbeResult
 * @typedef {{ ok: boolean, tier: Tier, deprecated: boolean, reason: string, arity: number }} AppendProbeResult
 */

const HOOK_KEYS = ['on', 'hooks', 'events', 'emit', 'listeners']

/** Session module id assumed by the appendPluginRecord/pluginRecordOf probes. */
export const SESSION_MODULE_ID = 'session'

/**
 * The seven seams this plugin cares about. `probe` is a message, not a function:
 * rows are data so callers can render/serialize them without evaluating anything.
 *
 * @type {ReadonlyArray<{ id: string, tier: Tier, deprecated: boolean, probe: string }>}
 */
export const SEAM_CATALOG = Object.freeze([
  {
    id: 'agent/pre-step',
    tier: 'contract',
    deprecated: false,
    probe: 'ctx event surface has the hook'
  },
  {
    id: 'agent/request',
    tier: 'contract',
    deprecated: true,
    probe: 'ctx event surface has the hook'
  },
  {
    id: 'session.surface',
    tier: 'contract',
    deprecated: false,
    probe: 'session.surface is an object with nodes'
  },
  {
    id: 'appendPluginRecord',
    tier: 'contract',
    deprecated: false,
    probe: 'the session module exports the function'
  },
  {
    id: 'pluginRecordOf',
    tier: 'contract',
    deprecated: false,
    probe: 'the session module exports the function'
  },
  {
    id: 'working-directory/change',
    tier: 'contract',
    deprecated: false,
    probe: 'observable as a session event type'
  },
  {
    id: 'session.append single-event overload',
    tier: 'internal',
    deprecated: false,
    probe: 'arity/shape check'
  }
])

/** @type {Map<string, { tier: Tier, deprecated: boolean }>} */
const CATALOG_INDEX = new Map(
  SEAM_CATALOG.map(row => [row.id, { tier: row.tier, deprecated: row.deprecated }])
)

/**
 * @param {string} id
 * @param {Partial<{ tier: Tier, deprecated: boolean }>} [fallback]
 */
function metaFor (id, fallback) {
  try {
    const row = CATALOG_INDEX.get(id)
    if (row) return { tier: row.tier, deprecated: row.deprecated }
  } catch {}
  return {
    tier: fallback?.tier ?? 'internal',
    deprecated: fallback?.deprecated ?? false
  }
}

/**
 * Build a result object, preferring catalog metadata for known ids.
 * @param {string} id
 * @param {boolean} ok
 * @param {string} reason
 * @param {Tier} [fallbackTier]
 */
function result (id, ok, reason, fallbackTier) {
  const { tier, deprecated } = metaFor(id, fallbackTier ? { tier: fallbackTier } : undefined)
  return { ok, tier, deprecated, reason }
}

/**
 * Probe an exported function on a module/object.
 *
 * @param {unknown} obj module namespace or plain object (may be undefined/null)
 * @param {string} fnName exported name to look for
 * @returns {ProbeResult}
 */
export function probeFn (obj, fnName) {
  try {
    const id = String(fnName)
    if (obj === undefined || obj === null) {
      return result(id, false, `object is ${String(obj)}; cannot look up "${id}"`)
    }
    if (typeof fnName !== 'string' || fnName === '') {
      return result(id, false, 'function name is empty or not a string')
    }
    let value
    try {
      value = obj[fnName]
    } catch (err) {
      return result(id, false, `lookup of "${id}" threw: ${describeError(err)}`)
    }
    if (value === undefined) {
      return result(id, false, `"${id}" is not exported`)
    }
    if (typeof value !== 'function') {
      return result(id, false, `"${id}" is exported but is ${typeof value}, not a function`)
    }
    if (value.length !== undefined && typeof value.length !== 'number') {
      return result(id, false, `"${id}" has a non-numeric arity`)
    }
    return result(id, true, `"${id}" is exported as a function (arity ${value.length})`)
  } catch (err) {
    return result('unknown', false, `probeFn failed without throwing outward: ${describeError(err)}`)
  }
}

/**
 * Probe a ctx-provided event/hook surface by seam name.
 *
 * - missing ctx -> ok:false
 * - ctx.get missing -> treat ctx itself as the surface and scan it
 * - ctx.get present -> ctx.get(name) is the optional-service lookup; undefined means absent
 *
 * @param {unknown} ctx
 * @param {string} name seam id, e.g. 'agent/pre-step'
 * @returns {ProbeResult}
 */
export function probeCtx (ctx, name) {
  try {
    const id = typeof name === 'string' ? name : String(name)
    if (ctx === undefined || ctx === null) {
      return result(id, false, `ctx is ${String(ctx)}; cannot probe "${id}"`)
    }
    if (typeof ctx !== 'object' && typeof ctx !== 'function') {
      return result(id, false, `ctx is ${typeof ctx}; cannot probe "${id}"`)
    }

    let lookup
    try {
      lookup = ctx.get
    } catch (err) {
      return result(id, false, `reading ctx.get threw: ${describeError(err)}`)
    }

    if (typeof lookup === 'function') {
      let service
      try {
        service = lookup.call(ctx, id)
      } catch (err) {
        // A ctx.get that rejects an unknown service means "absent", not a fault.
        return result(id, false, `ctx.get("${id}") threw: ${describeError(err)}`)
      }
      if (service === undefined || service === null) {
        return result(id, false, `ctx.get("${id}") returned ${String(service)}`)
      }
      if (typeof service === 'function') {
        return result(id, true, `ctx.get("${id}") returned a function`)
      }
      if (typeof service === 'object') {
        return result(id, true, `ctx.get("${id}") returned an object service`)
      }
      return result(id, true, `ctx.get("${id}") returned a ${typeof service} service`)
    }

    // No ctx.get: fall back to a direct scan of the hook surface.
    const hook = findHook(ctx, id)
    if (hook === undefined) {
      return result(id, false, `ctx has no ctx.get and no hook surface for "${id}"`)
    }
    if (typeof hook !== 'function') {
      return result(id, false, `hook for "${id}" is ${typeof hook}, not a function`)
    }
    return result(id, true, `ctx event surface exposes "${id}"`)
  } catch (err) {
    return result('unknown', false, `probeCtx failed without throwing outward: ${describeError(err)}`)
  }
}

/**
 * Probe the undeclared 3-argument (single-event) overload of `session.append`.
 * The declared contract is the array form; the 3-arg form is internal-tier.
 *
 * @param {unknown} appendFn
 * @returns {AppendProbeResult}
 */
export function probeSessionAppendOverload (appendFn) {
  const id = 'session.append single-event overload'
  const fail = (reason, arity = 0) => {
    const { tier, deprecated } = metaFor(id, { tier: 'internal' })
    return { ok: false, tier, deprecated, reason, arity }
  }
  try {
    if (typeof appendFn !== 'function') {
      return fail(`append is ${typeof appendFn}, not a function`)
    }
    const arity = typeof appendFn.length === 'number' ? appendFn.length : 0
    if (arity >= 3) {
      return {
        ...metaFor(id, { tier: 'internal' }),
        ok: true,
        reason: `append declares ${arity} parameters; single-event overload present`,
        arity
      }
    }
    if (arity === 2) {
      // Shape check: a 2-arg append may still accept a single event plus options.
      return {
        ...metaFor(id, { tier: 'internal' }),
        ok: false,
        reason: 'append declares 2 parameters; only the array form is declared',
        arity
      }
    }
    return {
      ...metaFor(id, { tier: 'internal' }),
      ok: false,
      reason: `append declares ${arity} parameter(s); single-event overload not observable via arity`,
      arity
    }
  } catch (err) {
    return fail(`probeSessionAppendOverload failed: ${describeError(err)}`)
  }
}

/**
 * Probe every catalog seam against a ctx. Never throws; unknown ids stay absent
 * rather than aborting the sweep.
 *
 * @param {unknown} ctx
 * @returns {Record<string, ProbeResult>}
 */
export function probeAll (ctx) {
  /** @type {Record<string, ProbeResult>} */
  const out = {}
  const session = safeSessionModule(ctx)
  for (const row of SEAM_CATALOG) {
    try {
      out[row.id] = probeOne(row.id, ctx, session)
    } catch (err) {
      out[row.id] = result(row.id, false, `unhandled probe failure: ${describeError(err)}`)
    }
  }
  return out
}

/**
 * @param {string} id
 * @param {unknown} ctx
 * @param {unknown} session
 * @returns {ProbeResult}
 */
function probeOne (id, ctx, session) {
  switch (id) {
    case 'agent/pre-step':
    case 'agent/request':
      return probeCtx(ctx, id)
    case 'session.surface': {
      const surface = safeGet(ctx, 'surface') ?? safeGet(session, 'surface')
      if (surface === undefined || surface === null) {
        return result(id, false, 'session.surface is absent')
      }
      if (typeof surface !== 'object') {
        return result(id, false, `session.surface is ${typeof surface}, not an object`)
      }
      if (!('nodes' in surface) && surface.nodes === undefined) {
        return result(id, false, 'session.surface has no nodes')
      }
      return result(id, true, 'session.surface is an object with nodes')
    }
    case 'appendPluginRecord':
    case 'pluginRecordOf':
      return probeFn(session, id)
    case 'working-directory/change': {
      const types = safeEventTypes(ctx)
      if (types === undefined) {
        return result(id, false, 'ctx exposes no event type list to inspect')
      }
      if (!types.includes(id)) {
        return result(id, false, `event type "${id}" is not registered`)
      }
      return result(id, true, `event type "${id}" is observable`)
    }
    case 'session.append single-event overload': {
      const append = safeGet(session, 'append') ?? safeGet(ctx, 'append')
      const probe = probeSessionAppendOverload(append)
      return {
        ok: probe.ok,
        tier: probe.tier,
        deprecated: probe.deprecated,
        reason: probe.reason
      }
    }
    default:
      return result(id, false, `no probe implementation for "${id}"`)
  }
}

/**
 * Resolve the session module: ctx.get('session') first, then ctx.session.
 * @param {unknown} ctx
 * @returns {unknown}
 */
function safeSessionModule (ctx) {
  try {
    const get = safeGet(ctx, 'get')
    if (typeof get === 'function') {
      try {
        const viaGet = get.call(ctx, SESSION_MODULE_ID)
        if (viaGet !== undefined && viaGet !== null) return viaGet
      } catch {}
    }
    return safeGet(ctx, 'session')
  } catch {
    return undefined
  }
}

/**
 * @param {unknown} ctx
 * @returns {string[]|undefined}
 */
function safeEventTypes (ctx) {
  const candidate =
    safeGet(ctx, 'eventTypes') ??
    safeGet(ctx, 'events') ??
    safeGet(safeGet(ctx, 'surface'), 'eventTypes')
  if (Array.isArray(candidate)) return candidate.map(String)
  if (candidate instanceof Set) return [...candidate].map(String)
  if (candidate && typeof candidate === 'object') return Object.keys(candidate)
  return undefined
}

/**
 * @param {unknown} obj
 * @param {string} name
 * @returns {unknown}
 */
function safeGet (obj, name) {
  try {
    if (obj === undefined || obj === null) return undefined
    if (typeof obj !== 'object' && typeof obj !== 'function') return undefined
    return obj[name]
  } catch {
    return undefined
  }
}

/**
 * Look up a hook on the ctx hook surface, trying `name` and its trailing segment.
 * @param {unknown} ctx
 * @param {string} name
 * @returns {unknown}
 */
function findHook (ctx, name) {
  const tail = name.includes('/') ? name.slice(name.lastIndexOf('/') + 1) : name
  const candidates = [name, tail]
  for (const key of candidates) {
    const direct = safeGet(ctx, key)
    if (typeof direct === 'function') return direct
  }
  for (const container of HOOK_KEYS) {
    const surface = safeGet(ctx, container)
    if (!surface) continue
    for (const key of candidates) {
      const hook = safeGet(surface, key)
      if (hook !== undefined) return hook
    }
  }
  return undefined
}

/**
 * @param {unknown} err
 * @returns {string}
 */
function describeError (err) {
  try {
    if (err instanceof Error) return err.message || err.name
    return String(err)
  } catch {
    return 'unknown error'
  }
}
