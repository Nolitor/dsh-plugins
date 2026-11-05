/**
 * The tiering pass inside the plugin: what the plugin writes to the session
 * when a turn pushes old tool outputs out of the working window.
 */
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { apply, resolveConfig } from '../lib/index.js'

/**
 * A throwaway TokenEconomizer state root for one test.
 *
 * The plugin exports a session log under its state root on `agent/created`; without an
 * override that root defaults to the live `~/.tokeneconomizer` and the write fails
 * (or worse, lands live). Isolate it per test and remove it afterwards.
 *
 * @param {object} t - the node:test context, used for cleanup.
 * @returns {string} the temporary state root.
 */
function isolatedState (t) {
  const home = mkdtempSync(join(tmpdir(), 'te-tiering-state-'))
  t.after(() => rmSync(home, { recursive: true, force: true }))
  return home
}

/**
 * A session stub with the surface the harness exposes: the nodes, the event at
 * a node, the derived message, and the append that replaces one.
 * @param {object[]} events - the committed events.
 * @returns {object} the session stub.
 */
function fakeSession (events) {
  const appended = []
  const seqs = events.map((_, index) => index + 1)
  return {
    appended,
    header: { id: 'session-1', version: 4, createdAt: 1, cwd: '/tmp' },
    snapshotEvents: () => events,
    deriveMessages: () => [],
    surface: { nodes: new Set(seqs) },
    eventAt (seq) {
      return events[seq - 1]
    },
    deriveEventMessage (event) {
      return event.data.message
    },
    append (type, data, options) {
      appended.push({ type, data, options })
      return { seq: events.length + appended.length }
    },
  }
}

/**
 * A Context stub with the services the plugin asks for.
 * @returns {object} the context stub.
 */
function fakeContext () {
  const listeners = new Map()
  return {
    listeners,
    tools: { definitions: () => [{ name: 'bash' }] },
    systemPrompt: { context () {}, section () {} },
    tokenMeter: { estimateMessage: () => 1000 },
    on (event, listener) {
      listeners.set(event, listener)
      return () => {}
    },
  }
}

/**
 * An agent stub whose scope records the plugin's listeners.
 * @param {object} session - the session stub.
 * @returns {object} the agent stub.
 */
function fakeAgent (session) {
  const handlers = new Map()
  return {
    id: 'session-1',
    session,
    ctx: {
      systemPrompt: { context () {}, section () {} },
      tools: { restrict () {} },
      on (event, listener) {
        const list = handlers.get(event) ?? []
        list.push(listener)
        handlers.set(event, list)
        return () => {}
      },
    },
    handlers,
    inject () {},
    cancel () {},
  }
}

const BIG = 'L'.repeat(9000)

test('a turn grades the outputs that fell out of the working window', async (t) => {
  const result = {
    type: 'tool/result',
    data: {
      turn: 1,
      step: 1,
      message: {
        role: 'tool',
        source: { kind: 'tool', callId: 'call-1' },
        toolCallId: 'call-1',
        content: [{ type: 'text', text: BIG }],
      },
    },
  }
  const session = fakeSession([result])
  const agent = fakeAgent(session)
  const ctx = fakeContext()
  apply(ctx, { stateHome: isolatedState(t) })
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const requestHandlers = agent.handlers.get('agent/request') ?? []
  assert.ok(requestHandlers.length > 0, 'the plugin grades before a request is assembled')

  // Turn 20 puts turn 1 into the cold tier. The request waterfall is the first
  // point after the turn/start append where a surface rewrite is legal.
  for (const handler of requestHandlers) {
    await handler({ agent, turn: 20, step: 0, signal: new AbortController().signal }, async () => ({}))
  }

  const pruned = session.appended.filter((entry) => entry.type === 'compaction/prune')
  const replaced = session.appended.filter((entry) => entry.type === 'tool/result')
  assert.equal(pruned.length, 1, 'the shadowed node is priced')
  assert.equal(replaced.length, 1, 'the node is replaced on the surface')
  assert.deepEqual(replaced[0].options.surfaceOp, { op: 'replace', startSeq: 1, endSeq: 1 })
  const text = replaced[0].data.message.content[0].text
  assert.ok(text.startsWith('[tokeneconomizer]'), 'the replacement carries the plugin marker')
  assert.ok(text.includes('cold tier'))
  assert.ok(text.length < 500, 'the model-visible output is a pointer, not the output')
})

test('the newest turns are left untouched', async (t) => {
  const result = {
    type: 'tool/result',
    data: {
      turn: 20,
      step: 1,
      message: {
        role: 'tool',
        source: { kind: 'tool', callId: 'call-1' },
        toolCallId: 'call-1',
        content: [{ type: 'text', text: BIG }],
      },
    },
  }
  const session = fakeSession([result])
  const agent = fakeAgent(session)
  const ctx = fakeContext()
  apply(ctx, { stateHome: isolatedState(t) })
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  for (const handler of agent.handlers.get('agent/request') ?? []) {
    await handler({ agent, turn: 20, step: 0, signal: new AbortController().signal }, async () => ({}))
  }
  assert.equal(session.appended.length, 0, 'a hot output is never replaced')
})

test('the tier boundaries are validated', () => {
  assert.throws(() => resolveConfig({ tierWarmTurns: 3, tierHotTurns: 5 }), /tierWarmTurns/)
  assert.equal(resolveConfig({ tierHotTurns: 5, tierWarmTurns: 15 }).tierWarmTurns, 15)
  assert.equal(resolveConfig({}).tiering, true)
})
