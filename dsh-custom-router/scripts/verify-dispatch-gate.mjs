/**
 * Live-process verification for the two duties.
 *
 * Run: node scripts/verify-dispatch-gate.mjs
 *
 * PART 1 (refusal) needs no child process: it asserts that a restricted session
 * never reaches a spawn. PART 2 (reclamation) spawns a REAL long-lived process
 * through the same registry the router uses and proves it is gone after the
 * session is reclaimed -- a claim a stub cannot support.
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { isAlive, sleep } from './verify-lib.mjs'

import {
  CliWorkerRegistry,
  DISPATCH_DENIED_REASON,
  decideDispatch,
  gateConfig,
  installDispatchGate,
} from '../lib/dispatch-gate.js'
import { PRESETS } from '../lib/presets.js'

const results = []
const record = (name, ok, detail) => {
  results.push({ name, ok, detail })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `\n        ${detail}` : ''}`)
}

/** A cordis-like host for the gate (no host package dependency). */
function fakeHost() {
  const services = new Map()
  const listeners = new Map()
  return {
    provide: (name, value) => services.set(name, value),
    get: (name) => services.get(name),
    on(name, handler, options = {}) {
      const list = listeners.get(name) ?? []
      if (options.prepend) list.unshift(handler)
      else list.push(handler)
      listeners.set(name, list)
      return () => listeners.set(name, (listeners.get(name) ?? []).filter((e) => e !== handler))
    },
    emit(name, ...args) { for (const l of listeners.get(name) ?? []) l(...args) },
    async waterfall(name, arg, fallback) {
      const chain = [...(listeners.get(name) ?? [])]
      const dispatch = async (i) => (i >= chain.length ? fallback() : chain[i](arg, () => dispatch(i + 1)))
      return dispatch(0)
    },
  }
}

// ---------------------------------------------------------------------------
// PART 1 -- refusal under restricted parameters, with a spawn counter
// ---------------------------------------------------------------------------

console.log('\n=== PART 1: restricted dispatch is refused before any spawn ===\n')

/**
 * Install the gate over a host whose sessions report `preset`/`mode`, then run
 * every CLI-worker tool name through the real pre-execute chain while counting
 * how many times a tool BODY would have run.
 */
async function probeRestricted({ preset, mode, label }) {
  const host = fakeHost()
  host.provide('agentPresets', { presetForSession: () => preset })
  host.provide('sandboxPolicy', { resolve: () => ({ mode }) })
  host.provide('shell', { sandboxMode: mode })
  const dispose = installDispatchGate(host, { presets: PRESETS })
  const session = { id: `s-${preset}-${mode}`, header: { cwd: '/tmp' } }
  const denied = []
  const allowed = []
  let bodyRuns = 0
  try {
    for (const tool of ['agy_worker', 'agy_cli', 'cli_worker', 'opencode']) {
      const decision = await host.waterfall(
        'tools/pre-execute',
        { name: tool, agent: { session } },
        () => { bodyRuns += 1; return { kind: 'allow' } },
      )
      if (decision.kind === 'deny') denied.push({ tool, reason: decision.reason })
      else allowed.push(tool)
    }
  } finally {
    dispose()
  }
  return { denied, allowed, bodyRuns, label }
}

const cases = [
  { preset: 'minimal', mode: 'danger-full-access', expect: 'preset' },
  { preset: 'minimal', mode: 'workspace-write', expect: 'both' },
  { preset: 'standard', mode: 'workspace-write', expect: 'sandbox' },
  { preset: 'standard', mode: 'read-only', expect: 'sandbox' },
]
for (const testCase of cases) {
  const outcome = await probeRestricted(testCase)
  const allDenied = outcome.denied.length === 4 && outcome.allowed.length === 0
  const exact = outcome.denied.every((entry) => entry.reason.startsWith(DISPATCH_DENIED_REASON))
  record(
    `refused: preset=${testCase.preset} mode=${testCase.mode}`,
    allDenied && exact && outcome.bodyRuns === 0,
    `denied=${outcome.denied.length}/4 bodyRuns=${outcome.bodyRuns}${outcome.denied[0] ? ` | ${outcome.denied[0].reason}` : ''}`,
  )
}

const permissive = await probeRestricted({ preset: 'standard', mode: 'danger-full-access', label: 'full' })
record(
  'allowed: standard preset + full access still dispatches (control)',
  permissive.allowed.length === 4 && permissive.denied.length === 0 && permissive.bodyRuns === 4,
  `allowed=${permissive.allowed.length}/4 bodyRuns=${permissive.bodyRuns}`,
)

// ---------------------------------------------------------------------------
// PART 2 -- reclamation of a REAL process
// ---------------------------------------------------------------------------

console.log('\n=== PART 2: a live external worker is reclaimed on session end ===\n')

/** Spawn a real long-lived child and wrap it in the handle shape the seam gives. */
function spawnWorker() {
  const child = spawn(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { stdio: 'ignore', detached: false })
  const done = new Promise((resolve) => {
    child.on('exit', (exitCode, signal) => resolve({ exitCode, signal: signal ? String(signal) : null }))
    child.on('error', () => resolve({ exitCode: null, signal: null }))
  })
  return {
    pid: child.pid,
    handle: {
      done,
      terminate: () => { try { child.kill('SIGTERM') } catch { /* already gone */ } },
    },
  }
}

// 2a. agent/disposed reclaims -- tracked through the AGENT (the identity the
// delegation providers actually hold), reclaimed through the SESSION.
{
  const host = fakeHost()
  const registry = new CliWorkerRegistry(host)
  const { bindLifecycle } = await import('../lib/dispatch-gate.js')
  const unbind = bindLifecycle(host, registry)
  const session = { id: 'live-session', header: { cwd: '/tmp' } }
  const worker = spawnWorker()
  await sleep(150)
  const beforeAlive = isAlive(worker.pid)
  registry.track({ session }, worker.handle, 'verify worker')
  host.emit('agent/disposed', { agent: { session } })
  await sleep(400)
  const afterAlive = isAlive(worker.pid)
  unbind()
  record(
    'agent/disposed terminates the tracked external process',
    beforeAlive && !afterAlive,
    `pid ${worker.pid}: alive-before=${beforeAlive} alive-after=${afterAlive} tracked=${registry.size}`,
  )
}

// 2b. two sessions: only the ended one's worker dies
{
  const host = fakeHost()
  const registry = new CliWorkerRegistry(host)
  const { bindLifecycle } = await import('../lib/dispatch-gate.js')
  const unbind = bindLifecycle(host, registry)
  const ended = { id: 'ended', header: { cwd: '/tmp' } }
  const alive = { id: 'alive', header: { cwd: '/tmp' } }
  const workerA = spawnWorker()
  const workerB = spawnWorker()
  await sleep(150)
  registry.track(ended, workerA.handle, 'worker-a')
  registry.track(alive, workerB.handle, 'worker-b')
  host.emit('session/disposed', ended)
  await sleep(400)
  const aAlive = isAlive(workerA.pid)
  const bAlive = isAlive(workerB.pid)
  unbind()
  registry.dispose('verify done')
  await sleep(300)
  record(
    'only the ended session\'s worker dies; the live one is untouched',
    !aAlive && bAlive,
    `ended-worker alive=${aAlive} live-worker alive=${bAlive}`,
  )
  record('cleanup: the surviving worker is reaped on registry dispose', !isAlive(workerB.pid), `pid ${workerB.pid}`)
}

// 2c. router unload reclaims everything
{
  const host = fakeHost()
  const registry = new CliWorkerRegistry(host)
  const workers = [spawnWorker(), spawnWorker(), spawnWorker()]
  await sleep(150)
  for (const [index, worker] of workers.entries()) {
    registry.track({ id: `dispose-${index}`, header: { cwd: '/tmp' } }, worker.handle, `worker-${index}`)
  }
  const before = workers.map((worker) => isAlive(worker.pid))
  registry.dispose('verify unload')
  await sleep(400)
  const after = workers.map((worker) => isAlive(worker.pid))
  record(
    'router unload reclaims every tracked worker',
    before.every(Boolean) && !after.some(Boolean),
    `before=${JSON.stringify(before)} after=${JSON.stringify(after)}`,
  )
}

// 2d. a settled handle never leaks a record
{
  const registry = new CliWorkerRegistry(fakeHost())
  const child = spawn(process.execPath, ['-e', 'process.exit(0)'], { stdio: 'ignore' })
  const done = new Promise((resolve) => child.on('exit', () => resolve({ exitCode: 0, signal: null })))
  registry.track({ id: 'short', header: { cwd: '/tmp' } }, { done, terminate: () => {} }, 'short')
  await done
  await sleep(100)
  record('a settled worker leaves no registry record', registry.size === 0, `size=${registry.size}`)
}

// ---------------------------------------------------------------------------
// PART 3 -- the SHIPPED provider + wrapper, end to end
// ---------------------------------------------------------------------------

console.log('\n=== PART 3: shipped provider honours the gate (spawn count must be 0) ===\n')

{
  // The defect this part exists for: the router and the provider were each
  // correct, but the WIRING between them double-wrapped the identity, so a
  // restricted session was allowed. Provider-level tests stubbed `gate`, so they
  // passed; only the real chain catches it.
  const { AntigravitySubagentProvider } = await import('../vendor/antigravity/lib/subagent.js')
  const { sessionOf, decideDispatch, gateConfig: gc, resolveDispatchPolicy } = await import('../lib/dispatch-gate.js')

  const services = new Map()
  const ctx = { get: (name) => services.get(name) }
  services.set('agentPresets', { presetForSession: () => 'minimal' })
  services.set('sandboxPolicy', { resolve: () => ({ mode: 'read-only' }) })
  const cfg = gc({})

  const dispatch = {
    gate: (subject) => decideDispatch(resolveDispatchPolicy(ctx, sessionOf(subject?.agent ?? subject)), cfg),
    track: () => () => {},
  }
  let spawned = 0
  const subprocess = {
    spawn() {
      spawned += 1
      return {
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } },
        terminate() {},
      }
    },
  }
  const provider = new AntigravitySubagentProvider('antigravity', { subprocess }, {
    agyPath: process.execPath,
    model: 'gemini-3.8-flash-low',
    effort: 'low',
    mode: 'accept-edits',
    timeoutMs: 1000,
    disposeGraceMs: 100,
    env: {},
    // Verbatim the shipped wiring from vendor/antigravity/lib/index.js.
    gate: (subject) => dispatch.gate?.(subject),
    track: (owner, handle, label) => dispatch.track?.(owner, handle, label),
  })
  const parent = { session: { id: 'e2e', header: { cwd: '/tmp' } } }
  let refused = false
  let message = ''
  try {
    provider.start({ parent, cwd: '/tmp', prompt: [{ type: 'text', text: 'x' }], signal: new AbortController().signal })
  } catch (error) {
    refused = true
    message = error instanceof Error ? error.message : String(error)
  }
  record(
    'the shipped provider refuses before spawning (wiring included)',
    refused && spawned === 0 && message.includes(DISPATCH_DENIED_REASON),
    `refused=${refused} spawned=${spawned} | ${message}`,
  )
}

// ---------------------------------------------------------------------------
// Summary
// ---------------------------------------------------------------------------

const failed = results.filter((entry) => !entry.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length > 0) {
  for (const entry of failed) console.log(`  FAILED: ${entry.name} — ${entry.detail}`)
  process.exit(1)
}
process.exit(0)
