/**
 * OpenCode v2 provider — router dispatch control plane integration.
 *
 * Same two contracts as the AGY provider, pinned at the provider level: a
 * restricted session is refused before any argv exists, and a spawned handle is
 * registered so a torn-down session cannot leak the process. A standalone mount
 * (no router) must behave exactly as before.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OpenCodeSubagentProvider } from '../lib/subagent.js'

const SIGNAL = new AbortController().signal
const EXISTING_ABSOLUTE = process.execPath
const DENIED = 'Disallowed: CLI worker invocation blocked under restricted sandbox/preset'

/** A subprocess double recording every spawn. */
function fakeSubprocess() {
  const spawned = []
  return {
    spawned,
    spawn(spec) {
      spawned.push(spec)
      const read = (text) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy: false }) })
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        stdin: { on() {}, end() {} },
        collected: { stdout: read(''), stderr: read('') },
        terminate() {},
      }
    },
  }
}

/** Build a provider over the fake subprocess service. */
function makeProvider(config = {}) {
  const subprocess = fakeSubprocess()
  const provider = new OpenCodeSubagentProvider('opencode', { subprocess }, {
    opencodePath: EXISTING_ABSOLUTE,
    model: 'opencode-go/minimax-m3.1-flash#low',
    auto: true,
    agent: '',
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
  const { provider, subprocess } = makeProvider({
    gate: () => ({ allowed: false, causes: ['sandbox "read-only"'] }),
  })
  assert.throws(
    () => provider.start(startRequest()),
    (error) => error instanceof Error && error.message.includes(DENIED) && error.message.includes('read-only'),
  )
  assert.equal(subprocess.spawned.length, 0)
})

test('a denied gate also covers the auto:true autonomous flag', () => {
  // `auto: true` is the config that makes the child approve its own actions. It
  // must be unreachable: the denial happens before argv (which carries --auto)
  // is ever built, so no flag can resurrect the run.
  const { provider, subprocess } = makeProvider({
    auto: true,
    gate: () => ({ allowed: false, causes: ['preset "minimal"'] }),
  })
  assert.throws(() => provider.start(startRequest()), /Disallowed:/)
  assert.equal(subprocess.spawned.length, 0, '--auto never reaches a process')
})

test('the gate receives the parent Agent identity', () => {
  const seen = []
  const { provider } = makeProvider({ gate: (parent) => { seen.push(parent); return { allowed: true, causes: [] } } })
  const parent = { session: { id: 'parent-session' } }
  const run = provider.start(startRequest(parent))
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
  assert.equal(subprocess.spawned.length, 1)
  run.dispose()
})

test('a spawned handle is registered with the router registry', () => {
  const tracked = []
  const { provider } = makeProvider({ track: (owner, handle, label) => { tracked.push({ owner, handle, label }); return () => {} } })
  const parent = { session: { id: 'track-session' } }
  const run = provider.start(startRequest(parent))
  assert.equal(tracked.length, 1)
  assert.equal(tracked[0].owner, parent)
  assert.equal(tracked[0].label, 'opencode subagent')
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
