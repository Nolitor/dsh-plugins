/**
 * The read-only host route behind the developer statistics surface.
 *
 * One route, one POST: `/api/local/tokeneconomizer/devstats`. It answers with
 *   1. a list of the sessions this process has observed, each with the derived per-turn/per-step
 *      totals and this plugin's own ledger counters, and
 *   2. for the selected session, the per-turn and per-step rows.
 *
 * Everything is derived on demand from the durable DSH session ledger
 * (`session.snapshotEvents()`) and from the in-memory counters the plugin already keeps. Nothing
 * is written: no file, no session event, no settings key. The route is a camera, not a lever.
 *
 * The derivation is cached per session state and invalidated by the last event's sequence number
 * and the event count, so repeated reads of an idle session do not re-fold its whole log.
 *
 * @module @nolit/dsh-tokeneconomizer/devstats-server
 */
import { deriveSessionDevStats, ledgerOf } from './devstats.js'

/** Path suffix the client calls; the full path is `/api/local/tokeneconomizer/devstats`. */
export const DEVSTATS_PATH = '/api/local/tokeneconomizer/devstats'

/** Sessions listed in one response. */
export const MAX_LISTED_SESSIONS = 20

/**
 * One WHATWG Response carrying JSON — the seam every local route handler must return.
 * @param {object} body - JSON-serializable payload.
 * @param {number} [status] - HTTP status.
 * @returns {Response} the response.
 */
export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
  })
}

/**
 * Read a session's committed events without letting a disposed session throw.
 * @param {object} session - the DSH session.
 * @returns {Array<object>} committed events, or an empty array.
 */
export function safeEvents(session) {
  try {
    const events = session?.snapshotEvents?.()
    return Array.isArray(events) ? events : []
  } catch {
    return []
  }
}

/**
 * Create the devstats route.
 * @param {{
 *   sessions: Map<string, object>,
 *   readProjections?: (session: object) => object | null,
 *   log?: { warn: (text: string) => void },
 * }} options - the live session map and an optional projection reader.
 * @returns {{ routes: Record<string, (request: Request) => Promise<Response>>, describe: (body?: object) => object }} the route set.
 */
export function createDevStatsServer({ sessions, readProjections, log = { warn() {} } }) {
  /** state -> { lastSeq, count, value } derivation cache. */
  const cache = new WeakMap()

  /**
   * Per-turn/per-step derivation of one session, cached until its log grows.
   * @param {object} state - the plugin's per-agent state.
   * @returns {{ events: Array<object>, derived: object }} the cached derivation.
   */
  const derivedOf = (state) => {
    const events = safeEvents(state.agent?.session)
    const last = events.length > 0 ? events[events.length - 1]?.seq : null
    const cached = cache.get(state)
    if (cached !== undefined && cached.lastSeq === last && cached.count === events.length) {
      return { events, derived: cached.value }
    }
    const derived = deriveSessionDevStats(events)
    cache.set(state, { lastSeq: last, count: events.length, value: derived })
    return { events, derived }
  }

  /**
   * The safe identity block of one session.
   * @param {object} state - the plugin's per-agent state.
   * @returns {object} the session summary.
   */
  const summaryOf = (state) => {
    const { derived } = derivedOf(state)
    const header = state.agent?.session?.header ?? {}
    return {
      id: String(state.sid ?? header.id ?? ''),
      cwd: typeof state.cwd === 'string' ? state.cwd : (typeof header.cwd === 'string' ? header.cwd : null),
      createdAt: typeof header.createdAt === 'number' ? header.createdAt : null,
      origin: typeof header.origin === 'string' ? header.origin : null,
      live: state.closed !== true,
      updatedAt: Math.max(
        derived.observed.lastTime ?? 0,
        ledgerOf(state).updatedAt ?? 0,
      ),
      totals: derived.totals,
      ledger: ledgerOf(state),
    }
  }

  /**
   * The projection block, when the composition has a projection registry with these units.
   * A missing registry is the normal headless case, not an error.
   * @param {object} state - the plugin's per-agent state.
   * @returns {object | null} `{asOfSeq, values}` or null.
   */
  const projectionsOf = (state) => {
    if (typeof readProjections !== 'function') return null
    const session = state.agent?.session
    if (session === undefined || session === null) return null
    try {
      return readProjections(session)
    } catch {
      return null
    }
  }

  /**
   * Pick the requested session, or the most recently updated one.
   * @param {unknown} sessionId - requested id.
   * @returns {object | undefined} the matching state.
   */
  const pick = (sessionId) => {
    const wanted = typeof sessionId === 'string' && sessionId ? sessionId : ''
    const states = [...sessions.values()].filter((state) => state !== null && typeof state === 'object')
    if (wanted) return states.find((state) => String(state.sid) === wanted)
    let newest
    let newestAt = -1
    for (const state of states) {
      const { derived } = derivedOf(state)
      const at = Math.max(derived.observed.lastTime ?? 0, ledgerOf(state).updatedAt ?? 0)
      if (at >= newestAt) {
        newestAt = at
        newest = state
      }
    }
    return newest
  }

  /**
   * Build the whole answer.
   * @param {object} [body] - the request body (`{ sessionId }`).
   * @returns {object} the payload.
   */
  const describe = (body = {}) => {
    const selected = pick(body?.sessionId)
    const listed = [...sessions.values()]
      .filter((state) => state !== null && typeof state === 'object')
      .map((state) => summaryOf(state))
      .sort((a, b) => (b.updatedAt ?? 0) - (a.updatedAt ?? 0))
      .slice(0, MAX_LISTED_SESSIONS)
    const payload = {
      ok: true,
      generatedAt: Date.now(),
      source: {
        eventLedger: 'dsh.session-events',
        pluginLedger: 'tokeneconomizer.in-memory',
        projections: typeof readProjections === 'function',
      },
      sessions: listed,
    }
    if (selected !== undefined) {
      const { derived } = derivedOf(selected)
      payload.detail = {
        sessionId: String(selected.sid),
        session: summaryOf(selected),
        turns: derived.turns,
        totals: derived.totals,
        truncated: derived.truncated,
        observed: derived.observed,
        ledger: ledgerOf(selected),
        dshProjections: projectionsOf(selected),
      }
    }
    return payload
  }

  /**
   * One route handler. A malformed body still answers the list (the selector is optional).
   * @param {Request} request - the buffered request.
   * @returns {Promise<Response>} the response.
   */
  const handler = async (request) => {
    let body = {}
    try {
      body = await request.json()
    } catch {
      body = {}
    }
    if (body === null || typeof body !== 'object') body = {}
    try {
      return json(describe(body))
    } catch (error) {
      log.warn('devstats: ' + (error instanceof Error ? error.message : String(error)))
      return json({ ok: false, error: 'devstats derivation failed' }, 500)
    }
  }

  return { routes: { devstats: handler }, describe }
}

/**
 * Register the devstats route on the host's connection seam.
 *
 * Registration is deliberately optional: a host without `connection` (a headless one-shot, a unit
 * test stub) boots the plugin with the statistics surface inert instead of failing the row.
 * @param {{
 *   ctx: object,
 *   scoped?: object,
 *   server: { routes: Record<string, Function> },
 *   log?: { warn: (text: string) => void },
 * }} options - the plugin context, the deferred sub-context, and the route factory result.
 * @returns {string[]} the registered route names.
 */
export function registerDevStatsRoutes({ ctx, scoped, server, log = { warn() {} } }) {
  const connection = scoped?.connection ?? (typeof ctx?.get === 'function' ? safeGet(ctx, 'connection') : undefined)
  if (connection === undefined || connection === null) return []
  const register = connection.fetch?.register
  if (typeof register !== 'function') return []
  const registered = []
  for (const [name, route] of Object.entries(server.routes)) {
    try {
      const dispose = register.call(connection.fetch, {
        path: DEVSTATS_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          try {
            return await route(request)
          } catch (error) {
            log.warn('devstats: ' + (error instanceof Error ? error.message : String(error)))
            return json({ ok: false, error: 'devstats route failed' }, 500)
          }
        },
      })
      if (typeof ctx?.effect === 'function') {
        ctx.effect(() => () => dispose?.(), 'tokeneconomizer: devstats route')
      }
      registered.push(name)
    } catch (error) {
      log.warn('devstats: could not register the statistics route: '
        + (error instanceof Error ? error.message : String(error)))
    }
  }
  return registered
}

/**
 * Read one optional service without throwing on an undeclared read.
 * @param {object} ctx - the context.
 * @param {string} name - service name.
 * @returns {unknown} the service, or undefined.
 */
function safeGet(ctx, name) {
  try {
    return ctx.get(name)
  } catch {
    return undefined
  }
}
