/**
 * CLI dispatch control plane — the two duties this module exists for.
 *
 * These tests pin BEHAVIOR, not implementation shape:
 *   1. a restricted preset or sandbox mode refuses the tool call through the
 *      same `{kind:'deny'}` vocabulary the shipped policy plugins use, so the
 *      model sees an ordinary tool error and no argv is ever built;
 *   2. a dispatched handle is reclaimed when its owning session is disposed, so
 *      no external CLI worker outlives the session that asked for it.
 *
 * The gate is exercised through a REAL `ctx.on('tools/pre-execute', …)`
 * dispatch, not by calling the listener directly: waterfall ordering and the
 * `next()` contract are what the host actually depends on.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  CliWorkerRegistry,
  DISPATCH_DENIED_REASON,
  bindLifecycle,
  cliWorkerTools,
  decideDispatch,
  gateConfig,
  installDispatchGate,
  resolveDispatchPolicy,
  sessionOf,
} from '../lib/dispatch-gate.js'
import { PRESETS } from '../lib/presets.js'

/**
 * A cordis-like host: `provide`/`get`, an event table with `on`/`emit`, and a
 * `waterfall` that dispatches a listener chain exactly as the tools pipeline
 * does (each listener receives `(arg, next)`; the first non-`next()` value wins).
 *
 * The suite uses this instead of `@deepseek-ai/cordis` because the track does
 * not depend on the host package, and the contract being tested here is the
 * listener chain, not Fiber lifecycle.
 * @returns {object} the fake host.
 */
function fakeHost() {
  const services = new Map()
  const listeners = new Map()
  return {
    services,
    provide: (name, value) => services.set(name, value),
    get: (name) => services.get(name),
    on(name, handler, options = {}) {
      const list = listeners.get(name) ?? []
      if (options.prepend) list.unshift(handler)
      else list.push(handler)
      listeners.set(name, list)
      return () => {
        const current = listeners.get(name) ?? []
        listeners.set(name, current.filter((entry) => entry !== handler))
      }
    },
    emit(name, ...args) {
      for (const listener of listeners.get(name) ?? []) listener(...args)
    },
    async waterfall(name, arg, fallback) {
      const chain = [...(listeners.get(name) ?? [])]
      const dispatch = async (index) => {
        if (index >= chain.length) return fallback()
        return chain[index](arg, () => dispatch(index + 1))
      }
      return dispatch(0)
    },
  }
}

/** A session stand-in with a stable identity. */
function fakeSession(id = 'session-1') {
  return { id, header: { cwd: '/tmp/workspace' } }
}

// ---------------------------------------------------------------------------
// 1. Admission
// ---------------------------------------------------------------------------

test('the denial reason is the exact operator-facing sentence', () => {
  assert.equal(DISPATCH_DENIED_REASON, 'Disallowed: CLI worker invocation blocked under restricted sandbox/preset')
})

test('minimal and ptc presets are restricted; standard and cordis are not', () => {
  for (const preset of ['minimal', 'ptc']) {
    assert.deepEqual(decideDispatch({ preset, sandboxMode: 'danger-full-access' }), {
      allowed: false,
      causes: [`preset "${preset}"`],
    }, `${preset} must hard-block external dispatch`)
  }
  for (const preset of ['standard', 'cordis']) {
    assert.deepEqual(decideDispatch({ preset, sandboxMode: 'danger-full-access' }), {
      allowed: true,
      causes: [],
    }, `${preset} must dispatch under full access`)
  }
})

test('only read-only is restricted by sandbox; workspace-write is ordinary', () => {
  const verdict = decideDispatch({ preset: 'standard', sandboxMode: 'read-only' })
  assert.equal(verdict.allowed, false)
  assert.match(verdict.causes.join(' '), /sandbox "read-only"/)
  // MEASURED 2026-11-10: the live deployment default is workspace-write. It is a
  // work mode, not a confinement boundary for dispatch.
  for (const preset of ['standard', 'cordis']) {
    assert.equal(
      decideDispatch({ preset, sandboxMode: 'workspace-write' }).allowed,
      true,
      `${preset} + workspace-write must dispatch`,
    )
  }
  assert.equal(decideDispatch({ preset: 'standard', sandboxMode: 'danger-full-access' }).allowed, true)
})

test('an unknown mode is not silently treated as full access', () => {
  // The shipped vocabulary has three modes. A caller that passes a fourth is
  // asking the gate to guess, and guessing "allowed" is the failure this test
  // exists to prevent: the restriction set is explicit, so an unknown value is
  // simply not in it.
  const verdict = decideDispatch({ preset: 'standard', sandboxMode: 'custom-mode' })
  assert.equal(verdict.allowed, true)
  // ...but the preset rule still fires independently.
  assert.equal(decideDispatch({ preset: 'minimal', sandboxMode: 'custom-mode' }).allowed, false)
})

test('both restrictions are reported together, not just the first', () => {
  const verdict = decideDispatch({ preset: 'minimal', sandboxMode: 'read-only' })
  assert.equal(verdict.allowed, false)
  assert.equal(verdict.causes.length, 2)
  assert.match(verdict.causes[0], /preset "minimal"/)
  assert.match(verdict.causes[1], /sandbox "read-only"/)
})

test('session facts come from the services that own them', () => {
  const session = fakeSession()
  const host = fakeHost()
  host.provide('agentPresets', { presetForSession: () => 'minimal' })
  host.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only', workspaceRoot: '/tmp/workspace' }) })
  const facts = resolveDispatchPolicy(host, session)
  assert.equal(facts.preset, 'minimal')
  assert.equal(facts.sandboxMode, 'read-only')
  assert.equal(facts.restricted, true)
})

test('a host without the preset service still enforces the sandbox rule', () => {
  const host = fakeHost()
  host.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only' }) })
  const facts = resolveDispatchPolicy(host, fakeSession())
  assert.equal(facts.preset, null)
  assert.equal(facts.restricted, true)
})

test('a host without the preset service allows workspace-write', () => {
  const host = fakeHost()
  host.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write' }) })
  const facts = resolveDispatchPolicy(host, fakeSession())
  assert.equal(facts.restricted, false)
})

test('a throwing projection fails closed rather than granting dispatch', () => {
  const host = fakeHost()
  host.provide('agentPresets', { presetForSession: () => { throw new Error('projection unavailable') } })
  host.provide('sandboxPolicy', { resolve: () => { throw new Error('policy unavailable') } })
  const facts = resolveDispatchPolicy(host, fakeSession())
  // Neither fact could be measured. The preset rule cannot fire, so this case
  // is only safe because the CALLER checks `deploymentConfines()`; the unit
  // contract is that the throw is contained and no bogus value is invented.
  assert.equal(facts.preset, null)
  assert.equal(facts.sandboxMode, null)
})

test('the CLI worker tool set is derived from the preset declarations', () => {
  const tools = cliWorkerTools(PRESETS)
  for (const name of ['agy_worker', 'agy_cli', 'cli_worker', 'opencode']) {
    assert.equal(tools.has(name), true, `${name} must be gated`)
  }
  // In-process delegation is NOT gated here: the child session inherits the
  // sandbox and is already inside the boundary.
  assert.equal(tools.has('subagent_antigravity'), false)
  assert.equal(tools.has('subagent_opencode'), false)
})

test('a preset that renames its CLI tool is gated without editing this module', () => {
  const tools = cliWorkerTools([{ surfaces: { cli: { toolName: 'custom_cli' }, tools: ['custom_cli'] } }])
  assert.equal(tools.has('custom_cli'), true)
})

test('the gate is ON by default and can only be turned off explicitly', () => {
  assert.equal(gateConfig({}).enabled, true)
  assert.equal(gateConfig({ cliDispatchGate: { enabled: false } }).enabled, false)
  assert.deepEqual(gateConfig({}).restrictedModes, ['read-only'])
  assert.deepEqual(
    gateConfig({ cliDispatchGate: { restrictedModes: ['read-only'] } }).restrictedModes,
    ['read-only'],
  )
})

test('the pre-execute gate denies a CLI worker call under a restricted session', async () => {
  const ctx = fakeHost()
  const session = fakeSession()
  ctx.provide('agentPresets', { presetForSession: () => 'minimal' })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only' }) })
  ctx.provide('shell', { sandboxMode: 'read-only' })
  const dispose = installDispatchGate(ctx, { presets: PRESETS })
  try {
    const decision = await ctx.waterfall('tools/pre-execute', { name: 'agy_worker', agent: { session } }, () => ({ kind: 'allow' }))
    assert.equal(decision.kind, 'deny')
    assert.match(decision.reason, /Disallowed: CLI worker invocation blocked under restricted sandbox\/preset/)
    assert.match(decision.reason, /preset "minimal"/)
    assert.match(decision.reason, /sandbox "read-only"/)
  } finally {
    dispose()
  }
})

test('the pre-execute gate allows the same call under full access', async () => {
  const ctx = fakeHost()
  const session = fakeSession()
  ctx.provide('agentPresets', { presetForSession: () => 'standard' })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'danger-full-access' }) })
  ctx.provide('shell', { sandboxMode: 'danger-full-access' })
  const dispose = installDispatchGate(ctx, { presets: PRESETS })
  try {
    const decision = await ctx.waterfall('tools/pre-execute', { name: 'agy_worker', agent: { session } }, () => ({ kind: 'allow' }))
    assert.equal(decision.kind, 'allow')
  } finally {
    dispose()
  }
})

test('the pre-execute gate denies every CLI worker under ptc, even with full access', async () => {
  const ctx = fakeHost()
  const session = fakeSession()
  ctx.provide('agentPresets', { presetForSession: () => 'ptc' })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'danger-full-access' }) })
  ctx.provide('shell', { sandboxMode: 'danger-full-access' })
  const dispose = installDispatchGate(ctx, { presets: PRESETS })
  try {
    for (const tool of ['agy_worker', 'agy_cli', 'cli_worker', 'opencode']) {
      const decision = await ctx.waterfall(
        'tools/pre-execute',
        { name: tool, agent: { session } },
        () => ({ kind: 'allow' }),
      )
      assert.equal(decision.kind, 'deny', `${tool} must be denied under ptc`)
      assert.match(decision.reason, /preset "ptc"/)
    }
  } finally {
    dispose()
  }
})

test('the pre-execute gate allows a standard session on workspace-write', async () => {
  // MEASURED 2026-11-10: workspace-write is the deployment default. It must not
  // withdraw the CLI surface from the ordinary work mode.
  const ctx = fakeHost()
  const session = fakeSession()
  ctx.provide('agentPresets', { presetForSession: () => 'standard' })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'workspace-write' }) })
  ctx.provide('shell', { sandboxMode: 'workspace-write' })
  const dispose = installDispatchGate(ctx, { presets: PRESETS })
  try {
    for (const tool of ['agy_worker', 'agy_cli', 'cli_worker', 'opencode']) {
      const decision = await ctx.waterfall(
        'tools/pre-execute',
        { name: tool, agent: { session } },
        () => ({ kind: 'allow' }),
      )
      assert.equal(decision.kind, 'allow', `${tool} must dispatch on standard + workspace-write`)
    }
  } finally {
    dispose()
  }
})

test('the gate still denies read-only under an otherwise-allowed preset', async () => {
  const ctx = fakeHost()
  const session = fakeSession()
  ctx.provide('agentPresets', { presetForSession: () => 'cordis' })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only' }) })
  ctx.provide('shell', { sandboxMode: 'read-only' })
  const dispose = installDispatchGate(ctx, { presets: PRESETS })
  try {
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      { name: 'cli_worker', agent: { session } },
      () => ({ kind: 'allow' }),
    )
    assert.equal(decision.kind, 'deny')
    assert.match(decision.reason, /sandbox "read-only"/)
  } finally {
    dispose()
  }
})

test('the gate ignores an unrelated tool entirely', async () => {
  const ctx = fakeHost()
  ctx.provide('agentPresets', { presetForSession: () => 'minimal' })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only' }) })
  const dispose = installDispatchGate(ctx, { presets: PRESETS })
  try {
    // `bash` is not a CLI worker: a restricted session may still run one, and
    // the sandbox (not this gate) is what confines it.
    const decision = await ctx.waterfall('tools/pre-execute', { name: 'bash', agent: { session: fakeSession() } }, () => ({ kind: 'allow' }))
    assert.equal(decision.kind, 'allow')
  } finally {
    dispose()
  }
})

test('an earlier decision still wins: the gate calls next() when it allows', async () => {
  const ctx = fakeHost()
  ctx.provide('agentPresets', { presetForSession: () => 'standard' })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'danger-full-access' }) })
  ctx.provide('shell', { sandboxMode: 'danger-full-access' })
  const dispose = installDispatchGate(ctx, { presets: PRESETS })
  try {
    const decision = await ctx.waterfall(
      'tools/pre-execute',
      { name: 'agy_worker', agent: { session: fakeSession() } },
      () => ({ kind: 'deny', reason: 'a later policy denied this' }),
    )
    assert.equal(decision.kind, 'deny')
    assert.match(decision.reason, /later policy/)
  } finally {
    dispose()
  }
})

test('a configured-off gate installs nothing and warns', () => {
  const warnings = []
  const ctx = fakeHost()
  const dispose = installDispatchGate(ctx, {
    presets: PRESETS,
    config: { cliDispatchGate: { enabled: false } },
    warn: (message) => warnings.push(message),
  })
  dispose()
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /CLI dispatch gate is disabled/)
})

// ---------------------------------------------------------------------------
// 2. Reclamation
// ---------------------------------------------------------------------------

/**
 * A handle stand-in that records terminations.
 * @returns {{handle: object, terminated: number, settle: () => void}} the fixture.
 */
function fakeHandle() {
  const state = { terminated: 0 }
  let settle
  const done = new Promise((resolve) => { settle = resolve })
  const handle = {
    done,
    terminate: () => { state.terminated += 1 },
  }
  return {
    handle,
    get terminated() { return state.terminated },
    settle: () => settle({ exitCode: 0, signal: null }),
  }
}

test('a tracked handle is terminated when its session is reclaimed', () => {
  const registry = new CliWorkerRegistry(fakeHost())
  const session = fakeSession()
  const worker = fakeHandle()
  registry.track(session, worker.handle, 'agy subagent')
  assert.equal(registry.size, 1)

  const reclaimed = registry.reclaimSession(session, 'session disposed')
  assert.equal(reclaimed, 1)
  assert.equal(worker.terminated, 1)
  assert.equal(registry.size, 0)
})

test('reclaiming one session never touches another session\'s worker', () => {
  const registry = new CliWorkerRegistry(fakeHost())
  const first = fakeSession('session-a')
  const second = fakeSession('session-b')
  const workerA = fakeHandle()
  const workerB = fakeHandle()
  registry.track(first, workerA.handle, 'agy subagent')
  registry.track(second, workerB.handle, 'opencode subagent')

  registry.reclaimSession(first, 'session disposed')
  assert.equal(workerA.terminated, 1)
  assert.equal(workerB.terminated, 0, 'the other session is still alive')
  assert.equal(registry.size, 1)
})

test('release is idempotent and a settled handle leaves no record behind', async () => {
  const registry = new CliWorkerRegistry(fakeHost())
  const worker = fakeHandle()
  const release = registry.track(fakeSession(), worker.handle, 'agy subagent')
  assert.equal(registry.size, 1)

  release()
  release()
  assert.equal(registry.size, 0)

  // A handle that settles on its own must also drop its record: a long session
  // would otherwise accumulate one dead entry per call.
  const second = fakeHandle()
  registry.track(fakeSession('session-c'), second.handle, 'opencode subagent')
  second.settle()
  await new Promise((resolve) => setImmediate(resolve))
  assert.equal(registry.size, 0)
})

test('dispose reclaims everything and refuses later registration', () => {
  const registry = new CliWorkerRegistry(fakeHost())
  const first = fakeHandle()
  const second = fakeHandle()
  registry.track(fakeSession('a'), first.handle, 'agy subagent')
  registry.track(fakeSession('b'), second.handle, 'opencode subagent')

  assert.equal(registry.dispose('router unloaded'), 2)
  assert.equal(first.terminated, 1)
  assert.equal(second.terminated, 1)
  assert.equal(registry.size, 0)

  // A caller that still holds the seam after unload must not leak a process.
  const late = fakeHandle()
  const release = registry.track(fakeSession('c'), late.handle, 'agy subagent')
  assert.equal(late.terminated, 1, 'a late handle is terminated immediately')
  release()
})

test('a throwing terminate does not block the remaining reclamation', () => {
  const warnings = []
  const registry = new CliWorkerRegistry(fakeHost(), { warn: (message) => warnings.push(message) })
  const broken = { done: new Promise(() => {}), terminate: () => { throw new Error('EPERM') } }
  const healthy = fakeHandle()
  registry.track(fakeSession('a'), broken, 'agy subagent')
  registry.track(fakeSession('b'), healthy.handle, 'opencode subagent')

  assert.equal(registry.dispose('router unloaded'), 1)
  assert.equal(healthy.terminated, 1)
  assert.equal(registry.size, 0)
})

test('the lifecycle binding reclaims on agent/disposed and session/disposed', () => {
  const ctx = fakeHost()
  const registry = new CliWorkerRegistry(ctx)
  const unbind = bindLifecycle(ctx, registry)

  const session = fakeSession('session-x')
  const worker = fakeHandle()
  registry.track(session, worker.handle, 'agy subagent')

  ctx.emit('agent/disposed', { agent: { session } })
  assert.equal(worker.terminated, 1, 'agent disposal reclaims the worker')

  const other = fakeHandle()
  const second = fakeSession('session-y')
  registry.track(second, other.handle, 'opencode subagent')
  ctx.emit('session/disposed', second)
  assert.equal(other.terminated, 1, 'session disposal reclaims the worker')

  unbind()
  assert.equal(registry.size, 0)
})

// ---------------------------------------------------------------------------
// 3. Schema interaction -- the fail-open path this suite exists to prevent
// ---------------------------------------------------------------------------

test('a schema-materialised empty list does not turn the gate off', () => {
  // MEASURED: `new Config({})` yields `{ restrictedPresets: [], restrictedModes: [] }`.
  // An empty list cannot mean "restrict nothing" for a field the operator never
  // set, or every profile written before this row existed would be unprotected.
  const gate = gateConfig({ cliDispatchGate: { restrictedPresets: [], restrictedModes: [] } })
  assert.equal(gate.enabled, true)
  assert.deepEqual(gate.restrictedPresets, ['minimal', 'ptc'])
  assert.deepEqual(gate.restrictedModes, ['read-only'])
  assert.equal(decideDispatch({ preset: 'minimal', sandboxMode: 'read-only' }, gate).allowed, false)
})

test('an explicitly narrowed restriction list is honored', () => {
  const gate = gateConfig({ cliDispatchGate: { restrictedModes: ['read-only'] } })
  assert.deepEqual(gate.restrictedModes, ['read-only'])
  assert.equal(decideDispatch({ preset: 'standard', sandboxMode: 'workspace-write' }, gate).allowed, true)
})

// ---------------------------------------------------------------------------
// 4. Identity normalization -- Agent vs Session
// ---------------------------------------------------------------------------

test('a worker tracked through its parent Agent is reclaimed through its Session', () => {
  // MEASURED: providers hold `request.parent` (Agent); lifecycle edges deliver a
  // Session. If the registry keyed on whichever object arrived, reclamation would
  // never match and every worker would leak.
  const registry = new CliWorkerRegistry(fakeHost())
  const session = fakeSession('identity-1')
  const agent = { session }
  const worker = fakeHandle()

  registry.track(agent, worker.handle, 'agy subagent')
  assert.equal(registry.size, 1)
  assert.equal(registry.reclaimSession(session, 'session disposed'), 1)
  assert.equal(worker.terminated, 1)
})

test('a worker tracked through its Session is reclaimed through its Agent', () => {
  const registry = new CliWorkerRegistry(fakeHost())
  const session = fakeSession('identity-2')
  const worker = fakeHandle()
  registry.track(session, worker.handle, 'opencode subagent')
  assert.equal(registry.reclaimSession({ session }, 'agent disposed'), 1)
  assert.equal(worker.terminated, 1)
})

test('the same worker registered via both identities is filed once', () => {
  const registry = new CliWorkerRegistry(fakeHost())
  const session = fakeSession('identity-3')
  const agent = { session }
  const worker = fakeHandle()
  registry.track(agent, worker.handle, 'first')
  registry.track(session, worker.handle, 'second')
  // Both records share the same Session key, so one disposal reclaims both.
  assert.equal(registry.reclaimSession(session, 'disposed'), 2)
  assert.equal(registry.size, 0)
})

test('sessionOf prefers the Agent shape and returns nothing for a bare object', () => {
  const session = fakeSession('identity-4')
  assert.equal(sessionOf({ session }), session)
  assert.equal(sessionOf(session), session)
  assert.equal(sessionOf({ id: 'not-a-session' }), undefined)
  assert.equal(sessionOf(null), undefined)
})

// ---------------------------------------------------------------------------
// 5. The REAL provider -> router chain (the defect unit tests missed)
// ---------------------------------------------------------------------------

test('the provider wrapper must not double-wrap the identity', () => {
  // MEASURED REGRESSION (2026-11-08): the vendor config hook was written as
  //   gate: (session) => dispatch.gate({ agent: { session } })
  // while the provider already calls `config.gate(request.parent)` with an
  // AGENT. That produced `{ agent: { session: Agent } }`, which `sessionOf`
  // normalized to `undefined`, which made a restricted session read as
  // unrestricted -- a silent FAIL-OPEN that every provider-level unit test
  // passed, because they stubbed `gate` directly and never exercised the
  // wrapper.
  const session = fakeSession('chain-1')
  const agent = { session }
  assert.equal(sessionOf(agent), session, 'an agent normalizes to its session')

  // The double-wrapped shape the buggy wrapper produced MUST ALSO resolve: a
  // wiring mistake may not degrade into "no session", because that is
  // indistinguishable from "no restriction".
  assert.equal(sessionOf({ agent: { session: agent } }), session, 'a wrapped agent still resolves')
  assert.equal(sessionOf({ agent }), session)
  // The walk is bounded and refuses cyclic or unrelated input.
  const cyclic = { id: 'cycle' }
  cyclic.agent = cyclic
  assert.equal(sessionOf(cyclic), undefined)
})

test('a restricted session is refused through the wired provider chain', () => {
  // Reproduce the shipped wiring: router seam -> vendor wrapper -> provider.
  const ctx = fakeHost()
  ctx.provide('agentPresets', { presetForSession: () => 'minimal' })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'read-only' }) })
  const gateCfg = gateConfig({})

  // The router's `cliDispatch.gate` verb.
  const routerGate = (subject) => decideDispatch(resolveDispatchPolicy(ctx, sessionOf(subject?.agent ?? subject)), gateCfg)
  // The vendor config hook (post-fix: pass through unwrapped).
  const vendorHook = (subject) => routerGate(subject)

  const session = fakeSession('chain-2')
  const agent = { session }        // what the provider actually passes
  const verdict = vendorHook(agent)
  assert.equal(verdict.allowed, false, 'a minimal/read-only session must be refused end to end')
  assert.match(verdict.causes.join(' '), /preset "minimal"/)
})

test('the same chain allows a full-access session', () => {
  const ctx = fakeHost()
  ctx.provide('agentPresets', { presetForSession: () => 'standard' })
  ctx.provide('sandboxPolicy', { resolve: () => ({ mode: 'danger-full-access' }) })
  const gateCfg = gateConfig({})
  const routerGate = (subject) => decideDispatch(resolveDispatchPolicy(ctx, sessionOf(subject?.agent ?? subject)), gateCfg)
  const vendorHook = (subject) => routerGate(subject)
  assert.equal(vendorHook({ session: fakeSession('chain-3') }).allowed, true)
})
