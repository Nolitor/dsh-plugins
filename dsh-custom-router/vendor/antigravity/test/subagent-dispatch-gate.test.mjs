/**
 * Antigravity provider — router dispatch control plane integration.
 *
 * Two contracts are pinned here, both at the PROVIDER level rather than at the
 * router's tool gate:
 *
 *   1. A restricted session is refused in `start()` before any argv is built.
 *      The router refuses the TOOL call first, but a direct `ctx.subagents`
 *      caller reaches the provider with no tool in the path, and a vendor mounted
 *      without the router has no tool gate at all. The provider is therefore the
 *      last place the rule can be enforced.
 *   2. A spawned handle is registered with the router registry, so a worker
 *      whose session is torn down while the run is in flight is still reclaimable.
 *
 * Neither behaviour may exist when the router is absent: a standalone mount must
 * keep working exactly as before.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AntigravitySubagentProvider } from '../lib/subagent.js'

const SIGNAL = new AbortController().signal
const EXISTING_ABSOLUTE = process.execPath
const DENIED = 'Disallowed: CLI worker invocation blocked under restricted sandbox/preset'

/**
 * A subprocess double recording every spawn.
 * @returns {object} the service plus its spawn record.
 */
function fakeSubprocess() {
  const spawned = []
  return {
    spawned,
    spawn(spec) {
      spawned.push(spec)
      const read = (text) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy: false }) })
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: { stdout: read('{"status":"SUCCESS","text":"ok"}'), stderr: read('') },
        terminate() {},
      }
    },
  }
}

/**
 * Build a provider over the fake subprocess service.
 * @param {object} [config] - extra provider config (gate/track live here).
 * @returns {{provider: object, subprocess: object}} the fixture.
 */
function makeProvider(config = {}) {
  const subprocess = fakeSubprocess()
  const provider = new AntigravitySubagentProvider('antigravity', { subprocess }, {
    agyPath: EXISTING_ABSOLUTE,
    model: 'gemini-3.8-flash-low',
    effort: 'low',
    mode: 'accept-edits',
    timeoutMs: 60000,
    disposeGraceMs: 1000,
    env: {},
    ...config,
  })
  return { provider, subprocess }
}

/** A minimal start request carrying a parent Agent. */
function startRequest(parent = { session: { id: 's1' } }) {
  return { parent, cwd: '/tmp/project', prompt: [{ type: 'text', text: 'do the thing' }], signal: SIGNAL }
}

test('a denied gate refuses in start() before any process is spawned', () => {
  const gateCalls = []
  const { provider, subprocess } = makeProvider({
    gate: (parent) => { gateCalls.push(parent); return { allowed: false, causes: ['preset "minimal"'] } },
  })
  assert.throws(
    () => provider.start(startRequest()),
    (error) => error instanceof Error && error.message.includes(DENIED) && error.message.includes('preset "minimal"'),
  )
  assert.equal(subprocess.spawned.length, 0, 'nothing may be spawned on a denial')
  assert.equal(gateCalls.length, 1, 'the gate is consulted with the parent agent')
})

test('the gate receives the parent Agent identity', () => {
  const seen = []
  const { provider } = makeProvider({ gate: (parent) => { seen.push(parent); return { allowed: true, causes: [] } } })
  const parent = { session: { id: 'parent-session' } }
  const run = provider.start(startRequest(parent))
  assert.equal(seen.length, 1)
  assert.equal(seen[0], parent)
  run.dispose()
})

test('an allowed gate spawns normally', () => {
  const { provider, subprocess } = makeProvider({ gate: () => ({ allowed: true, causes: [] }) })
  const run = provider.start(startRequest())
  assert.equal(subprocess.spawned.length, 1)
  run.dispose()
})

test('a missing gate (standalone mount) spawns without consulting anything', () => {
  const { provider, subprocess } = makeProvider()
  const run = provider.start(startRequest())
  assert.equal(subprocess.spawned.length, 1, 'a vendor mounted without the router is unchanged')
  run.dispose()
})

test('a spawned handle is registered with the router registry', () => {
  const tracked = []
  const { provider } = makeProvider({ track: (owner, handle, label) => { tracked.push({ owner, handle, label }); return () => {} } })
  const parent = { session: { id: 'track-session' } }
  const run = provider.start(startRequest(parent))
  assert.equal(tracked.length, 1)
  assert.equal(tracked[0].owner, parent, 'the handle is filed under the parent agent')
  assert.equal(tracked[0].label, 'agy subagent')
  assert.equal(typeof tracked[0].handle.terminate, 'function')
  run.dispose()
})

test('dispose releases the registry record', async () => {
  let released = 0
  const { provider } = makeProvider({ track: () => () => { released += 1 } })
  const run = provider.start(startRequest())
  await run.dispose()
  assert.equal(released, 1)
})

test('a throwing track does not fail the run', () => {
  const { provider, subprocess } = makeProvider({ track: () => { throw new Error('registry closed') } })
  const run = provider.start(startRequest())
  assert.equal(subprocess.spawned.length, 1)
  run.dispose()
})

test('the provider does not re-wrap the identity before consulting the gate', () => {
  // The provider passes `request.parent` (an Agent) straight to `config.gate`.
  // A wrapper that re-wraps it (`{agent:{session:...}}`) silently loses the
  // session and turns a restricted run into an allowed one. Assert the raw
  // argument identity, so the wrapper cannot be inserted again unnoticed.
  const seen = []
  const { provider } = makeProvider({ gate: (subject) => { seen.push(subject); return { allowed: true, causes: [] } } })
  const parent = { session: { id: 'raw-identity' } }
  const run = provider.start(startRequest(parent))
  assert.equal(seen.length, 1)
  assert.equal(seen[0], parent, 'the gate receives the parent agent itself, not a wrapper')
  assert.equal(seen[0].agent, undefined, 'the argument is not double-wrapped')
  run.dispose()
})
