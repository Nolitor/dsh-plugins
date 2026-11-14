/**
 * The three mechanisms, driven end to end through the plugin's real entry point.
 *
 * These are the writes the plugin makes that a reader has to be able to attribute: a cold-tier
 * rewrite (recorded as `surface-rewrite` + `tier-decision`), a tool-prune application (recorded
 * as `toolprune-applied` — the record whose absence made `untool_applied: []` the measured state
 * across the whole ledger), and the loop guard's decision when no judge can vote on it.
 *
 * The fakes below are faithful to the shapes the harness really exposes: `surface.nodes` is an
 * array of seqs, a replacement splices the node, `tools.restrict({ deny })` removes the denied
 * names from the scoped view, and `appendPluginRecord` is reached as a module function through
 * `ctx.get('session')` — DSH's `Session` has no such method.
 */
import assert from 'node:assert/strict'
import { chmodSync, mkdtempSync, mkdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { RECORD_NAMES, readRecords, recordsOfType } from '../lib/attribution.js'
import { apply } from '../lib/index.js'
import { PLUGIN_PRUNE_MARKER } from '../lib/tiering.js'

/** The harness's own pruner marker, quoted from `dsh-compaction-tool-result-pruner`. */
const HARNESS_PRUNE_MARKER = '\n\n[... tool result middle pruned ...]\n\n'

/** A tool output well past `TIER_DEFAULTS.minChars`, so it is worth rewriting. */
const BIG = 'L'.repeat(9000)

/**
 * One throwaway TokenEconomizer state root.
 * @returns {string} the directory.
 */
function stateHome() {
  return mkdtempSync(join(tmpdir(), 'te-mechanisms-'))
}

/**
 * Write one executable launcher that answers with a fixed JSON object.
 * @param {string} dir - directory to install it in.
 * @param {string} name - file name.
 * @param {object} answer - the last JSON line the launcher prints.
 * @returns {string} the launcher path.
 */
function launcher(dir, name, answer) {
  const path = join(dir, name)
  writeFileSync(path, [
    '#!/bin/sh',
    'cat >/dev/null 2>&1 || true',
    `printf '%s\\n' '${JSON.stringify(answer)}'`,
    '',
  ].join('\n'))
  chmodSync(path, 0o755)
  return path
}

/**
 * A session whose log and surface are folded from each other, like the harness's.
 *
 * `append` commits a surface event and returns its seq; a `surfaceOp` replacement splices the
 * node it names; `appendPluginRecord` is exposed only through the ctx service, as on the real
 * host.
 * @param {object[]} seed - the events the session starts with.
 * @returns {object} the fake session, with its `log` for assertions.
 */
function fakeSession(seed) {
  const log = seed.map((event, index) => ({ ...event, seq: index, options: { surfaceOp: 'append' } }))
  const nodes = []
  for (const entry of log) nodes.push(entry.seq)
  return {
    log,
    header: { id: 'session-1', version: 4, createdAt: 1, cwd: '/tmp' },
    snapshotEvents: () => log,
    deriveMessages: () => [],
    surface: { nodes },
    eventAt(seq) {
      return log[seq]
    },
    deriveEventMessage(event) {
      return event.data.message
    },
    append(type, data, options) {
      const entry = { type, data, options, seq: log.length }
      log.push(entry)
      const op = options && options.surfaceOp
      if (op && op !== 'append') {
        const start = nodes.indexOf(op.startSeq)
        const end = nodes.indexOf(op.endSeq)
        if (start !== -1 && end !== -1) nodes.splice(start, end - start + 1, entry.seq)
      }
      return entry
    },
  }
}

/**
 * A Context stub carrying the services the plugin injects, plus the record appender.
 * @param {object[]} visible - the tool names the assembly registers.
 * @returns {object} the context stub.
 */
function fakeContext(visible) {
  const listeners = new Map()
  return {
    listeners,
    tools: {
      definitions: () => visible.map((name) => ({ name })),
    },
    systemPrompt: { context() {}, section() {} },
    tokenMeter: { estimateMessage: () => 1000 },
    get(id) {
      if (id !== 'session') return undefined
      return {
        appendPluginRecord(session, type, data) {
          const entry = { type, data, seq: session.log.length, time: Date.now(), ignorable: true }
          session.log.push(entry)
          return entry.seq
        },
      }
    },
    on(event, listener) {
      listeners.set(event, listener)
      return () => {}
    },
  }
}

/**
 * An Agent stub whose own scope records what the plugin registers on it.
 * @param {object} session - the fake session.
 * @param {string[]} visible - the tool names visible to this agent.
 * @param {object} [options] - `restrictThrows` makes the lever fail.
 * @returns {object} the agent stub.
 */
function fakeAgent(session, visible, options = {}) {
  const handlers = new Map()
  const visibleNames = [...visible]
  const calls = { restrict: [], injected: [], cancelled: [] }
  return {
    id: 'session-1',
    session,
    calls,
    ctx: {
      systemPrompt: { context() {}, section() {} },
      tools: {
        definitions: () => visibleNames.map((name) => ({ name })),
        restrict(filter) {
          if (options.restrictThrows) throw new Error('unknown tool name')
          calls.restrict.push(filter)
          for (const name of filter.deny ?? []) {
            const index = visibleNames.indexOf(name)
            if (index !== -1) visibleNames.splice(index, 1)
          }
        },
      },
      get() {
        return undefined
      },
      on(event, listener) {
        const list = handlers.get(event) ?? []
        list.push(listener)
        handlers.set(event, list)
        return () => {}
      },
    },
    handlers,
    inject(message) {
      calls.injected.push(message)
    },
    cancel(cause, cancelOptions) {
      calls.cancelled.push({ cause, options: cancelOptions })
    },
  }
}

/**
 * One committed `tool/result` event, in the shape the harness writes.
 * @param {string} text - the message text.
 * @param {number} turn - the turn that produced it.
 * @returns {object} the event.
 */
function toolResult(text, turn) {
  return {
    type: 'tool/result',
    data: {
      turn,
      step: 1,
      message: {
        role: 'tool',
        source: { kind: 'tool', callId: 'call-1' },
        toolCallId: 'call-1',
        content: [{ type: 'text', text }],
      },
    },
  }
}

/**
 * Collect everything written to stderr while a function runs.
 * @param {Function} run - the function to run.
 * @returns {Promise<string>} the captured output.
 */
async function captureStderr(run) {
  const original = process.stderr.write.bind(process.stderr)
  const written = []
  process.stderr.write = (chunk) => {
    written.push(String(chunk))
    return true
  }
  try {
    await run()
  } finally {
    process.stderr.write = original
  }
  return written.join('')
}

/** A launcher pair that answers `{}`: the engine is present but says nothing. */
function silentEngine(dir) {
  return { te: launcher(dir, 'te', {}), hook: launcher(dir, 'hook', {}) }
}

test('cold node replaced and surface-rewrite reason is tier:cold', async () => {
  const home = stateHome()
  const session = fakeSession([toolResult(BIG, 1)])
  const visible = ['bash', 'read', 'todo_write']
  const ctx = fakeContext(visible)
  const agent = fakeAgent(session, visible)
  const engine = silentEngine(home)
  apply(ctx, { stateHome: home, tePath: engine.te, hookPath: engine.hook })
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const stepHandlers = agent.handlers.get('agent/pre-step') ?? []
  assert.ok(stepHandlers.length > 0, 'the tiering pass is registered at step preparation')
  // Turn 20 pushes turn 1 out of the warm window and into the cold tier.
  for (const handler of stepHandlers) {
    await handler({ agent, turn: 20, step: 0, signal: new AbortController().signal }, async () => ({}))
  }

  const rewrites = recordsOfType(session.log, RECORD_NAMES.SURFACE_REWRITE)
  assert.equal(rewrites.length, 1, 'the rewrite that landed is recorded exactly once')
  assert.equal(rewrites[0].data.tier, 'cold')
  assert.equal(rewrites[0].data.reason, 'tier:cold', 'the reason names the cold tier')
  assert.ok(rewrites[0].data.charsBefore > rewrites[0].data.charsAfter, 'the rewrite is a saving')

  // The decision record is the other half of the pair, and it names the policy that graded it.
  const decisions = recordsOfType(session.log, RECORD_NAMES.TIER_DECISION)
  assert.equal(decisions.length, 1, 'the decision exists next to the write')
  assert.equal(decisions[0].data.tier, 'cold')
  assert.equal(decisions[0].data.reason, 'tier:cold')
  assert.match(decisions[0].data.policyHash, /^[0-9a-f]{40}$/)

  // The model-visible node carries the plugin's own marker, not the harness's.
  const replaced = session.log.filter((entry) => entry.type === 'tool/result').at(-1)
  const text = replaced.data.message.content[0].text
  assert.ok(text.includes(PLUGIN_PRUNE_MARKER), 'the replacement carries the plugin marker')
  assert.ok(!text.includes(HARNESS_PRUNE_MARKER), 'the harness marker is never reused')
  assert.ok(text.length < BIG.length)
})

test('pruned tool result carries toolprune-applied with pairedRewriteSeq', async () => {
  const home = stateHome()
  const proposal = ['bash', 'todo_write', 'not_a_registered_tool']
  const engine = {
    te: launcher(home, 'te', { toolprune: { mode: 'auto', proposal, proposalId: 'proposal-7' } }),
    hook: launcher(home, 'hook', {}),
  }
  const visible = ['bash', 'read', 'todo_write']
  const session = fakeSession([])
  const ctx = fakeContext(visible)
  const agent = fakeAgent(session, visible)
  apply(ctx, { stateHome: home, tePath: engine.te, hookPath: engine.hook })
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  // The restriction really was applied, and it named only tools this assembly registers:
  // DSH rejects a restriction containing an unknown name, so the proposal is intersected.
  assert.deepEqual(agent.calls.restrict, [{ deny: ['bash', 'todo_write'] }])

  const applied = recordsOfType(session.log, RECORD_NAMES.TOOLPRUNE_APPLIED)
  assert.equal(applied.length, 1, 'the applied lever is recorded — the measured-empty defect is closed')
  const record = applied[0].data
  assert.deepEqual(record.tools, ['bash', 'todo_write'])
  assert.deepEqual(record.visibleIntersection, ['bash', 'todo_write'], 'the unknown name is dropped')
  assert.equal(record.countBefore, 3)
  assert.equal(record.countAfter, 1, 'the denied tools left the visible set')
  assert.ok(record.countAfter < record.countBefore)
  assert.equal(record.proposalId, 'proposal-7')
  assert.match(record.repoKey, /^\S+$/)
  assert.ok(Number.isFinite(record.time))
  // `pairedRewriteSeq` belongs to the surface-prune record, not the tool mask: a tool mask
  // removes names from the listing and writes no `tool/result` replacement. The join here is
  // the log order — the applied record is the last thing written for this session start.
  assert.equal(applied[0].seq, session.log.length - 1)
  assert.ok(session.log.slice(0, applied[0].seq).every((entry) => entry.type !== RECORD_NAMES.TOOLPRUNE_APPLIED))
})

test('no-judge path fires and is marked degraded', async () => {
  const home = stateHome()
  const engine = silentEngine(home)
  const visible = ['bash', 'read']
  const session = fakeSession([])
  const ctx = fakeContext(visible)
  // The judge seam is absent: `ctx.get('loopguard/judge')` answers undefined, which is exactly
  // what a deployment whose side call fails with ACCOUNT_SIGN_IN_REQUIRED looks like.
  const agent = fakeAgent(session, visible)
  apply(ctx, { stateHome: home, tePath: engine.te, hookPath: engine.hook })
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const post = agent.handlers.get('tools/post-execute') ?? []
  assert.ok(post.length > 0)
  const exec = { name: 'bash', callId: 'c1', arguments: { command: 'pytest -q' }, agent }
  const result = { isError: true, content: [{ type: 'text', text: 'Error: command failed' }] }

  const logged = await captureStderr(async () => {
    for (const callId of ['c1', 'c2', 'c3']) {
      await post[0]({ ...exec, callId }, result, async () => ({ kind: 'accept' }))
    }
  })

  const decisions = recordsOfType(session.log, RECORD_NAMES.TIER_DECISION)
  assert.equal(decisions.length, 1, 'the guard decision is recorded, not just acted on')
  assert.equal(decisions[0].data.reason, 'loopguard:repeat:degraded', 'the degradation is in the reason')
  assert.match(decisions[0].data.policyHash, /^[0-9a-f]{40}$/)

  // The redirect itself is unchanged: the same bail-out prompt and the same cancel.
  assert.equal(agent.calls.cancelled.length, 1)
  assert.deepEqual(agent.calls.cancelled[0].cause, { kind: 'hook', reason: 'tokeneconomizer/loop-breaker' })
  assert.equal(agent.calls.cancelled[0].options.keepInbox, true)

  // And the degradation reached a human-readable channel, twice over: the one-time probe notice
  // and the trip line carrying `degraded=true`. Never silent.
  assert.match(logged, /loopguard: judge unavailable/)
  assert.match(logged, /loop-breaker: tool=bash consecutive-failures=3/)
  assert.match(logged, /degraded=true/)
})

test('the plugin marker is distinct from the harness PRUNE_MARKER', () => {
  assert.equal(typeof PLUGIN_PRUNE_MARKER, 'string')
  assert.notEqual(PLUGIN_PRUNE_MARKER, HARNESS_PRUNE_MARKER)
  assert.ok(!PLUGIN_PRUNE_MARKER.includes('tool result middle pruned'), 'the harness wording is never reused')
  assert.ok(!PLUGIN_PRUNE_MARKER.includes(HARNESS_PRUNE_MARKER.trim()))
  assert.ok(!HARNESS_PRUNE_MARKER.includes(PLUGIN_PRUNE_MARKER))
  // The harness marker is whitespace-framed; the plugin's is not, so the two are separable in
  // a log by a single `includes` on the content.
  assert.ok(HARNESS_PRUNE_MARKER.startsWith('\n\n'))
  assert.ok(!PLUGIN_PRUNE_MARKER.startsWith('\n'))
  assert.match(PLUGIN_PRUNE_MARKER, /tokeneconomizer/)
})

test('a failing restrict writes no applied record and says so once', async () => {
  const home = stateHome()
  const engine = {
    te: launcher(home, 'te', { toolprune: { proposal: ['bash'] } }),
    hook: launcher(home, 'hook', {}),
  }
  const visible = ['bash', 'read']
  const session = fakeSession([])
  const ctx = fakeContext(visible)
  const agent = fakeAgent(session, visible, { restrictThrows: true })
  apply(ctx, { stateHome: home, tePath: engine.te, hookPath: engine.hook })

  const logged = await captureStderr(async () => {
    await ctx.listeners.get('agent/created')({ agent, source: 'startup' })
  })

  assert.equal(recordsOfType(session.log, RECORD_NAMES.TOOLPRUNE_APPLIED).length, 0, 'nothing applied, nothing claimed')
  assert.match(logged, /toolprune: restrict rejected/)
  assert.match(logged, /no tool was masked/)
  // The one-time path: the message is written once, not once per name.
  assert.equal(logged.match(/toolprune: restrict rejected/g).length, 1)
  assert.deepEqual(readRecords(session.log), [])
})
