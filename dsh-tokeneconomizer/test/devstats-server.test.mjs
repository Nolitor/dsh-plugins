/**
 * The devstats host route: read-only camera over the session map.
 *
 * The payload must carry counts and names only — never prompt text, tool arguments, or tool
 * output — and a request must not mutate the live session state. Registration is optional: a
 * host without the connection seam (headless) keeps the plugin mounted with the surface inert.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  DEVSTATS_PATH,
  createDevStatsServer,
  json,
  registerDevStatsRoutes,
  safeEvents,
} from '../lib/devstats-server.js'

/** One committed event with a stable shape. */
function event(type, seq, time, data) {
  return { type, seq, time, data }
}

/** A session log with one turn, one step, one tool call whose output is secret. */
function log() {
  return [
    event('turn/start', 0, 1000, { turn: 1 }),
    event('request/context', 1, 1001, { provider: 'p', model: 'm', contextWindow: 1000 }),
    event('step/start', 2, 1010, { turn: 1, step: 1 }),
    event('tool/call', 3, 1011, { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"cat secret"}' }),
    event('tool/result', 4, 1051, {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        source: { kind: 'tool', callId: 'c1' },
        content: [{ type: 'text', text: 'TOP-SECRET-OUTPUT' }],
        isError: false,
      },
    }),
    event('assistant/message', 5, 1060, {
      turn: 1,
      step: 1,
      usage: { inputTokens: 10, outputTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 0 },
      stream: [{ type: 'text-chunks', time0: 1020, texts: ['ASSISTANT-TEXT'] }],
    }),
    event('step/end', 6, 1070, { turn: 1, step: 1 }),
    event('turn/end', 7, 1080, { turn: 1 }),
  ]
}

/**
 * One live session state shaped like the plugin's own.
 * @param {string} id - session id.
 * @param {Array<object>} events - the session log.
 * @param {object} [stats] - counter overrides.
 * @returns {object} the state.
 */
function stateOf(id, events, stats = {}) {
  return {
    sid: id,
    cwd: '/repo/' + id,
    turn: 1,
    requests: 1,
    tiered: 2,
    closed: false,
    recallDone: true,
    dedup: { size: 3 },
    stats: {
      mode: 'apply',
      startedAt: 900,
      updatedAt: 1080,
      dedupHits: 4,
      dedupSavedChars: 500,
      tierShadowTokens: 700,
      breakerTrips: 1,
      watchdogWarns: 2,
      watchdogInterrupts: 0,
      toolCalls: 1,
      toolErrors: 0,
      notices: 3,
      pinned: true,
      thinkInCode: true,
      ...stats,
    },
    agent: {
      session: {
        header: { id, createdAt: 800, cwd: '/repo/' + id, origin: 'user' },
        snapshotEvents: () => events,
      },
    },
  }
}

/** A sessions map with two entries. */
function sessionsOf() {
  return new Map([
    ['a', stateOf('a', log())],
    ['b', stateOf('b', log())],
  ])
}

test('the list carries per-session totals and the plugin ledger', () => {
  const server = createDevStatsServer({ sessions: sessionsOf() })
  const payload = server.describe({})
  assert.equal(payload.ok, true)
  assert.equal(payload.sessions.length, 2)
  const row = payload.sessions[0]
  assert.equal(row.totals.steps, 1)
  assert.equal(row.totals.contextCumulative, 30)
  assert.equal(row.ledger.dedup.hits, 4)
  assert.equal(row.ledger.tiering.replacements, 2)
  assert.equal(row.live, true)
})

test('the selected session gets per-turn and per-step rows', () => {
  const server = createDevStatsServer({ sessions: sessionsOf() })
  const payload = server.describe({ sessionId: 'b' })
  assert.equal(payload.detail.sessionId, 'b')
  assert.equal(payload.detail.turns.length, 1)
  const step = payload.detail.turns[0].steps[0]
  assert.equal(step.contextTokens, 30)
  assert.equal(step.calls[0].name, 'bash')
  assert.equal(step.calls[0].ms, 40)
  assert.equal(step.calls[0].resultChars, 17)
  assert.equal(payload.detail.totals.toolMs, 40)
  assert.equal(payload.detail.ledger.mode, 'apply')
})

test('the payload never carries prompt text, tool arguments or tool output', () => {
  const server = createDevStatsServer({ sessions: sessionsOf() })
  const text = JSON.stringify(server.describe({ sessionId: 'a' }))
  assert.equal(text.includes('TOP-SECRET-OUTPUT'), false, 'tool output leaked')
  assert.equal(text.includes('cat secret'), false, 'tool arguments leaked')
  assert.equal(text.includes('ASSISTANT-TEXT'), false, 'assistant text leaked')
})

test('a request does not mutate the live state', () => {
  const states = sessionsOf()
  const before = JSON.stringify([...states.values()])
  const server = createDevStatsServer({ sessions: states })
  server.describe({})
  server.describe({ sessionId: 'a' })
  assert.equal(JSON.stringify([...states.values()]), before)
})

test('a projection reader adds the DSH cut; a missing one is not an error', () => {
  let asked = null
  const reader = (session) => {
    asked = session
    return { asOfSeq: 7, values: { tokenUsage: { uncachedInputTokens: 10, outputTokens: 5, cacheReadTokens: 20, cacheWriteTokens: 0 } } }
  }
  const withReader = createDevStatsServer({ sessions: sessionsOf(), readProjections: reader }).describe({ sessionId: 'a' })
  assert.equal(withReader.detail.dshProjections.asOfSeq, 7)
  assert.equal(asked.header.id, 'a')
  assert.equal(withReader.source.projections, true)

  const without = createDevStatsServer({ sessions: sessionsOf() }).describe({ sessionId: 'a' })
  assert.equal(without.detail.dshProjections, null)
  assert.equal(without.source.projections, false)
})

test('a throwing projection reader degrades to no projections', () => {
  const server = createDevStatsServer({
    sessions: sessionsOf(),
    readProjections: () => { throw new Error('registry gone') },
  })
  assert.equal(server.describe({ sessionId: 'a' }).detail.dshProjections, null)
})

test('the route answers the list for an empty or malformed body', async () => {
  const server = createDevStatsServer({ sessions: sessionsOf() })
  const request = new Request('http://localhost' + DEVSTATS_PATH, { method: 'POST', body: 'not json' })
  const response = await server.routes.devstats(request)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('content-type'), 'application/json; charset=utf-8')
  const payload = await response.json()
  assert.equal(payload.ok, true)
  assert.equal(payload.sessions.length, 2)
})

test('json() returns a WHATWG Response, which the seam requires', () => {
  const response = json({ ok: true }, 500)
  assert.equal(response instanceof Response, true)
  assert.equal(response.status, 500)
  assert.equal(response.headers.get('cache-control'), 'no-store')
})

test('safeEvents survives a disposed session', () => {
  assert.deepEqual(safeEvents({}), [])
  assert.deepEqual(safeEvents({ snapshotEvents: () => { throw new Error('closed') } }), [])
  assert.equal(safeEvents({ snapshotEvents: () => [{ type: 'x' }] }).length, 1)
})

test('route registration uses the connection seam and the POST-only path', () => {
  const captured = []
  const connection = {
    fetch: {
      register(options) {
        captured.push(options)
        return () => {}
      },
    },
  }
  const ctx = {
    effects: [],
    effect(fn) { this.effects.push(fn) },
    get(name) { return name === 'connection' ? connection : undefined },
  }
  const server = createDevStatsServer({ sessions: sessionsOf() })
  const registered = registerDevStatsRoutes({ ctx, server })
  assert.deepEqual(registered, ['devstats'])
  assert.equal(captured.length, 1)
  assert.equal(captured[0].path, DEVSTATS_PATH)
  assert.deepEqual(captured[0].methods, ['POST'])
  assert.equal(captured[0].requestBody, 'buffered')
  // The disposal rides the caller's effect: one function that removes the route.
  assert.equal(ctx.effects.length, 1)
  assert.equal(typeof ctx.effects[0](), 'function')
})

test('registration is a no-op without a connection service', () => {
  const server = createDevStatsServer({ sessions: sessionsOf() })
  assert.deepEqual(registerDevStatsRoutes({ ctx: {}, server }), [])
  assert.deepEqual(registerDevStatsRoutes({
    ctx: { fetch: {} },
    server,
  }), [])
})
