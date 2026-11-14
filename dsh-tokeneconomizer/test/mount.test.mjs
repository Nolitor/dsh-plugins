/**
 * Loading and registration contract, without a running harness.
 *
 * The module is imported under the same resolver the DSH loader uses for harness packages, so a
 * missing export, a broken `Config` schema, or a listener that throws while composing a scope
 * fails here rather than in a user's session. The engine is absent in this test (its launchers
 * point at an empty directory), which is also the fail-open path: a session must compose its
 * scope with no engine at all.
 *
 * The host-local, in-memory features are exercised here through the same stubs: the dedup
 * policy, the pinned prompt slot, the loop breaker, and the thinking watchdog.
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { apply, DEFAULTS, isHeadless, name, resolveConfig, rootSessionsView } from '../lib/index.js'

/**
 * Launcher pair that records every engine invocation instead of running the Python engine.
 *
 * An absent engine fails open to `{}`, which is indistinguishable from a hook that was never
 * called — so the fail-open path alone cannot prove "a subagent makes zero engine calls". These
 * launchers write one line per process the plugin actually spawns, which turns that claim into a
 * counted fact. Each invocation appends its argv and its stdin payload, so the lifecycle event
 * (`hook_event_name`) is assertable too, not just the count.
 * @param {string} dir - the state root to install the launchers under.
 * @returns {{ te: string, hook: string, calls: (which: string) => object[], launches: () => number }}
 *   the launcher paths and the recorded calls.
 */
function countingLaunchers(dir) {
  const logDir = join(dir, 'engine-calls')
  mkdirSync(logDir, { recursive: true })
  const install = (label) => {
    const path = join(dir, label)
    const log = join(logDir, `${label}.log`)
    // The last line is the JSON answer a real launcher would print; `{}` changes nothing.
    writeFileSync(path, [
      '#!/bin/sh',
      `payload=$(cat 2>/dev/null || true)`,
      `printf '%s\\n' "$*" >> "${log}"`,
      `printf '%s\\n' "$payload" >> "${log}.payload"`,
      `printf '%s\\n' '{}'`,
      '',
    ].join('\n'), { mode: 0o755 })
    return { path, log }
  }
  const te = install('te')
  const hook = install('hook')
  const lines = (file) => (existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : [])
  return {
    te: te.path,
    hook: hook.path,
    /** The argv of every invocation of one launcher. */
    calls(which) {
      return lines(which === 'te' ? te.log : hook.log)
    },
    /** The parsed stdin payloads of every hook invocation. */
    payloads() {
      return lines(hook.log).map((_, index) => {
        try {
          return JSON.parse(lines(`${hook.log}.payload`)[index] ?? '{}')
        } catch {
          return {}
        }
      })
    },
    /** Total engine processes spawned, both launchers. Zero means "no engine at all". */
    launches() {
      return lines(te.log).length + lines(hook.log).length
    },
  }
}

/**
 * A Context stub that records listeners and the tool definitions it advertises.
 * @returns {object} a minimal Cordis-like context.
 */
function fakeContext() {
  const listeners = new Map()
  return {
    listeners,
    tools: { definitions: () => [{ name: 'bash' }, { name: 'read' }, { name: 'todo_write' }] },
    on(event, listener) {
      listeners.set(event, listener)
      return () => listeners.delete(event)
    },
  }
}

/**
 * An Agent stub whose scope records every registration the plugin makes.
 * @param {string} id - session id.
 * @param {string} cwd - session directory.
 * @returns {object} the agent stub.
 */
function fakeAgent(id, cwd) {
  const calls = { context: [], sections: [], restrict: [], listeners: [], handlers: new Map(), injected: [], cancelled: [] }
  const messages = []
  return {
    id,
    calls,
    messages,
    session: {
      header: { id, version: 4, createdAt: 1, cwd },
      snapshotEvents: () => [{ type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } }],
      deriveMessages: () => messages,
    },
    ctx: {
      systemPrompt: {
        context(entry) {
          calls.context.push(entry)
        },
        section(entry) {
          calls.sections.push(entry)
        },
      },
      tools: {
        restrict(filter) {
          calls.restrict.push(filter)
        },
      },
      on(event, listener) {
        calls.listeners.push(event)
        const handlers = calls.handlers.get(event) ?? []
        handlers.push(listener)
        calls.handlers.set(event, handlers)
        return () => {}
      },
    },
    inject(message) {
      calls.injected.push(message)
    },
    cancel(cause, options) {
      calls.cancelled.push({ cause, options })
    },
  }
}

/**
 * Deliver one session event to the plugin's session listener.
 * @param {object} agent - the agent stub.
 * @param {object} event - the committed session event.
 * @returns {void}
 */
function emit(agent, event) {
  const handlers = agent.calls.handlers.get('session/event') ?? []
  for (const handler of handlers) handler(agent.session, event)
}

/**
 * Run one tool call through the plugin's post-execute policy.
 * @param {object} agent - the agent stub.
 * @param {object} exec - the tool execution identity.
 * @param {object} result - the normalized outcome.
 * @param {object} [decision] - the downstream decision.
 * @returns {Promise<object>} the decision the plugin returned.
 */
async function postExecute(agent, exec, result, decision = { kind: 'accept' }) {
  const handlers = agent.calls.handlers.get('tools/post-execute') ?? []
  const handler = handlers[0]
  return handler(exec, result, async () => decision)
}

/**
 * One tool call logged by the loop.
 * @param {string} callId - the call identity.
 * @param {number} step - the step that owns the call.
 * @returns {object} the committed session event.
 */
function toolCall(callId, step) {
  return { type: 'tool/call', data: { turn: 1, step, callId, name: 'bash', arguments: '{}' } }
}

/**
 * Collect everything written to stderr while a function runs.
 * @param {Function} run - the function to run.
 * @returns {Promise<string>} the captured output.
 */
async function captureStderr(run) {
  const original = process.stderr.write.bind(process.stderr)
  const lines = []
  process.stderr.write = (chunk) => {
    lines.push(String(chunk))
    return true
  }
  try {
    await run()
  } finally {
    process.stderr.write = original
  }
  return lines.join('')
}

/**
 * Wait for the given number of milliseconds.
 * @param {number} ms - the wait.
 * @returns {Promise<void>} resolves after the wait.
 */
function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

test('the module exports the loader contract', () => {
  assert.equal(name, 'dsh-tokeneconomizer')
  assert.equal(DEFAULTS.microskills, true)
  const resolved = resolveConfig({ microskills: false, headless: 'never' })
  assert.equal(resolved.microskills, false)
  assert.equal(resolved.headless, 'never')
  assert.throws(() => resolveConfig({ headless: 'sometimes' }), /headless/)
  assert.throws(() => resolveConfig({ hookTimeouts: 1 }), /unknown setting/)
  assert.throws(() => resolveConfig({ hookTimeoutMs: 'soon' }), /hookTimeoutMs/)
})

test('the host-local settings are validated', () => {
  assert.equal(resolveConfig({}).dedup, true)
  // Advisory by default: only an explicit `interrupt` may end a turn.
  assert.equal(resolveConfig({}).watchdogAction, 'interrupt')
  assert.equal(resolveConfig({}).mode, 'apply')
  // A child gets the memory levers by default, and the switch is a real boolean setting.
  assert.equal(DEFAULTS.subagentMemory, true)
  assert.equal(resolveConfig({}).subagentMemory, true)
  assert.equal(resolveConfig({ subagentMemory: false }).subagentMemory, false)
  assert.throws(() => resolveConfig({ subagentMemory: 'no' }), /subagentMemory/)
  assert.throws(() => resolveConfig({ mode: 'off' }), /mode/)
  // The warning point is derived from the budget, so a short budget clamps it instead of failing.
  assert.equal(resolveConfig({ watchdogThresholdMs: 20 }).watchdogWarnMs, 10)
  assert.equal(resolveConfig({}).watchdogWarnMs, 300000)
  assert.throws(() => resolveConfig({ watchdogAction: 'sometimes' }), /watchdogAction/)
  assert.throws(() => resolveConfig({ watchdogProgress: 'sometimes' }), /watchdogProgress/)
  assert.throws(() => resolveConfig({ dedup: 'yes' }), /dedup/)
  assert.throws(() => resolveConfig({ dedupMinChars: 0 }), /dedupMinChars/)
  assert.throws(() => resolveConfig({ loopBreakerThreshold: 1 }), /loopBreakerThreshold/)
  assert.throws(() => resolveConfig({ loopBreakerWindow: 1 }), /loopBreakerWindow/)
  assert.throws(() => resolveConfig({ watchdogThresholdMs: -1 }), /watchdogThresholdMs/)
  assert.throws(() => resolveConfig({ pinnedRulesOrder: -1000 }), /pinnedRulesOrder/)
  assert.throws(() => resolveConfig({ pinnedRulesOrder: 1.5 }), /pinnedRulesOrder/)
  assert.equal(resolveConfig({ pinnedRulesOrder: 0 }).pinnedRulesOrder, 0)
})

test('headless detection reads the profile argv', () => {
  assert.equal(isHeadless('auto', ['node', 'dsh', 'headless', 'task']), true)
  assert.equal(isHeadless('auto', ['node', 'dsh', '--profile', 'headless']), true)
  assert.equal(isHeadless('auto', ['node', 'dsh', 'web']), false)
  assert.equal(isHeadless('always', ['node', 'dsh', 'web']), true)
  assert.equal(isHeadless('never', ['node', 'dsh', 'headless']), false)
})

test('an agent scope composes with no engine present', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-mount-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'missing-te'), hookPath: join(home, 'missing-hook') })
  const created = ctx.listeners.get('agent/created')
  assert.equal(typeof created, 'function')
  assert.equal(typeof ctx.listeners.get('agent/disposed'), 'function')

  const agent = fakeAgent('session-1', home)
  await created({ agent, source: 'startup' })
  // The brief and the SessionStart hook both fail open (no engine), so no facts are injected
  // and no mask is applied; the per-agent lifecycle listeners are still registered.
  assert.deepEqual(agent.calls.context, [])
  assert.deepEqual(agent.calls.restrict, [])
  assert.ok(agent.calls.listeners.includes('session/event'))
  assert.ok(agent.calls.listeners.includes('tools/result'))
})

test('subagent gets the in-memory levers but no engine', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-sub-'))
  const engine = countingLaunchers(home)
  apply(ctx, { stateHome: home, tePath: engine.te, hookPath: engine.hook })
  const agent = fakeAgent('session-sub', home)
  agent.session.header.origin = 'subagent'
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  // The memory path IS mounted: a child session burns the same context and calls the same
  // tools, and its bill lands on the parent. `tools/post-execute` carries dedup, tiering and the
  // loop breaker; `session/event` carries the watchdog, the prefix guard and the call index.
  assert.notDeepEqual(agent.calls.listeners, [])
  assert.ok(agent.calls.listeners.includes('tools/post-execute'))
  assert.ok(agent.calls.listeners.includes('session/event'))
  // The rest of the in-memory path, so a later refactor cannot quietly drop one of them:
  // `agent/pre-step` is the tiering waterfall and `tools/result` is the loop guard's trace.
  assert.ok(agent.calls.listeners.includes('agent/pre-step'), 'tiering must still run for a child')
  assert.ok(agent.calls.listeners.includes('tools/result'), 'the tool-result trace must still run')

  // The engine path is NOT: microskills (a prompt context) and toolprune (a tool restriction)
  // are answers only the engine can give, so a child that never asks gets neither.
  assert.deepEqual(agent.calls.context, [])
  assert.deepEqual(agent.calls.restrict, [])

  // And no engine process was spawned for it: not SessionStart, not the brief `te` call.
  assert.equal(engine.launches(), 0, 'a subagent must make zero engine calls')
})

test('a subagent stays off the engine across a whole turn lifecycle', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-sub-life-'))
  const engine = countingLaunchers(home)
  apply(ctx, { stateHome: home, tePath: engine.te, hookPath: engine.hook })
  const agent = fakeAgent('session-sub-life', home)
  agent.session.header.origin = 'subagent'
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  // Drive every lifecycle edge that reaches an engine call in a root session: the prompt turn
  // (UserPromptSubmit), a tool result (PostToolUse), and the turn end (Stop + export).
  emit(agent, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'do it' }] } })
  emit(agent, { type: 'turn/start', data: { turn: 1 } })
  emit(agent, toolCall('c1', 1))
  agent.calls.handlers.get('tools/result')?.forEach((handler) => {
    handler(
      { name: 'bash', callId: 'c1', arguments: { command: 'ls' }, agent },
      { isError: false, content: [{ type: 'text', text: 'x'.repeat(400) }] },
    )
  })
  emit(agent, { type: 'turn/end', data: { turn: 1 } })
  await wait(60)
  // SessionEnd, which finishes the export and hands the session to a detached `te fold`.
  ctx.listeners.get('agent/disposed')({ agent })
  await wait(60)

  assert.equal(engine.calls('te').length, 0, 'no `te` process for a subagent')
  assert.equal(engine.calls('hook').length, 0, 'no `te-hook` process for a subagent')
  assert.equal(engine.launches(), 0)
  // No export either: a child transcript in dsh-sessions/ would be folded a second time.
  assert.equal(existsSync(join(home, 'dsh-sessions')), false, 'a subagent writes no session export')
})

test('a subagent still deduplicates a repeated tool output', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-sub-dedup-'))
  const engine = countingLaunchers(home)
  apply(ctx, { stateHome: home, tePath: engine.te, hookPath: engine.hook })
  const agent = fakeAgent('session-sub-dedup', home)
  agent.session.header.origin = 'subagent'
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const output = 'y'.repeat(400)
  emit(agent, toolCall('c1', 3))
  const first = await postExecute(
    agent,
    { name: 'bash', callId: 'c1', arguments: { command: 'ls' }, agent },
    { isError: false, content: [{ type: 'text', text: output }] },
  )
  assert.equal(first.content, undefined, 'the first occurrence keeps its full text')

  emit(agent, toolCall('c2', 7))
  let second = null
  const logged = await captureStderr(async () => {
    second = await postExecute(
      agent,
      { name: 'bash', callId: 'c2', arguments: { command: 'ls' }, agent },
      { isError: false, content: [{ type: 'text', text: output }] },
    )
  })
  // The saving is real in a child: the model-visible copy becomes a pointer to step 3.
  assert.equal(second.kind, 'accept')
  assert.equal(second.content.length, 1)
  assert.match(second.content[0].text, /^\[Output identical to step 3 \(hash: [0-9a-f]{12}\), content omitted to save context\]$/)
  assert.match(logged, /\[tokeneconomizer\] dedup: tool=bash repeated-output replaced hits=2 first-step=3/)
  // The dedup ran entirely in memory: it needed no engine process to do it.
  assert.equal(engine.launches(), 0)
})

test('a subagent still runs the loop breaker and the watchdog', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-sub-loop-'))
  const engine = countingLaunchers(home)
  apply(ctx, {
    stateHome: home,
    tePath: engine.te,
    hookPath: engine.hook,
    watchdogThresholdMs: 20,
    watchdogAction: 'interrupt',
  })
  const agent = fakeAgent('session-sub-loop', home)
  agent.session.header.origin = 'subagent'
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const exec = { name: 'bash', callId: 'c1', arguments: { command: 'pytest -q' }, agent }
  const result = { isError: true, content: [{ type: 'text', text: 'Error: command failed' }] }
  await captureStderr(async () => {
    for (const callId of ['c1', 'c2', 'c3']) {
      emit(agent, toolCall(callId, 3))
      await postExecute(agent, { ...exec, callId }, result)
    }
  })
  assert.equal(agent.calls.cancelled.length, 1, 'the breaker trips inside a subagent too')
  assert.deepEqual(agent.calls.cancelled[0].cause, { kind: 'hook', reason: 'tokeneconomizer/loop-breaker' })

  // The watchdog is armed from the same event stream.
  const watch = await captureStderr(async () => {
    emit(agent, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'next' }] } })
    emit(agent, { type: 'turn/start', data: { turn: 2 } })
    await wait(80)
  })
  assert.match(watch, /made no progress/)
  assert.equal(engine.launches(), 0)
})

test('subagentMemory false restores no economy of its own for a child', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-sub-off-'))
  const engine = countingLaunchers(home)
  apply(ctx, {
    stateHome: home,
    tePath: engine.te,
    hookPath: engine.hook,
    subagentMemory: false,
  })
  const agent = fakeAgent('session-sub-off', home)
  agent.session.header.origin = 'subagent'
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  // Nothing at all is registered for the child, which is the historical behaviour.
  assert.deepEqual(agent.calls.listeners, [])
  assert.deepEqual(agent.calls.context, [])
  assert.deepEqual(agent.calls.restrict, [])
  assert.deepEqual(agent.calls.sections, [], 'not even the pinned section')
  assert.equal(engine.launches(), 0)

  // The switch is honoured for children only: a root session in the same plugin still mounts.
  const root = fakeAgent('session-root-on', home)
  await ctx.listeners.get('agent/created')({ agent: root, source: 'startup' })
  assert.ok(root.calls.listeners.includes('tools/post-execute'))
  assert.ok(root.calls.listeners.includes('session/event'))
})

test('the root session keeps its full engine lifecycle', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-root-engine-'))
  const engine = countingLaunchers(home)
  apply(ctx, { stateHome: home, tePath: engine.te, hookPath: engine.hook })
  const agent = fakeAgent('session-root', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  // SessionStart: one `te` brief and one `te-hook` SessionStart.
  assert.equal(engine.calls('te').length, 1, 'the root session still asks for its brief')
  const startPayloads = engine.payloads()
  assert.equal(startPayloads.length, 1)
  assert.equal(startPayloads[0].hook_event_name, 'SessionStart')

  emit(agent, { type: 'turn/start', data: { turn: 1 } })
  emit(agent, { type: 'turn/end', data: { turn: 1 } })
  await wait(60)
  const events = engine.payloads().map((payload) => payload.hook_event_name)
  assert.ok(events.includes('UserPromptSubmit'), 'the root session still opens a guard turn')
  assert.ok(events.includes('Stop'), 'the root session still closes a guard turn')
  assert.ok(agent.calls.listeners.includes('tools/post-execute'))
  assert.ok(agent.calls.listeners.includes('session/event'))
})

test('subagentMemory is declared in the bundle patch, not only in the code', () => {
  // `watchdog` was once declared, validated and documented with no reader, and the same could
  // happen here: a key that exists in DEFAULTS but is absent from the bundle patch is dropped the
  // moment any profile overrides a single key (a patch `config` replaces the whole config), and
  // the child would silently fall back to the code default. Pin the declaration.
  const yml = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  assert.match(yml, /^\s+subagentMemory:\s*true\s*$/m)
})

test('every DEFAULTS key is declared in the bundle patch', () => {
  // The drift this catches is silent by construction: the plugin keeps working with a code
  // default, so nothing fails until an operator wonders why their override did nothing.
  const yml = readFileSync(new URL('../cordis.patch.yml', import.meta.url), 'utf8')
  const declared = new Set()
  for (const match of yml.matchAll(/^\s{8}([a-z][A-Za-z0-9]*):/gm)) declared.add(match[1])
  const missing = Object.keys(DEFAULTS).filter((key) => !declared.has(key))
  assert.deepEqual(missing, [], 'cordis.patch.yml is missing: ' + missing.join(', '))
})

test('devstats lists root sessions only, never a child as a sibling', async () => {
  const sessions = new Map()
  const root = { sid: 'root', subagent: false, cwd: '/repo' }
  const child = { sid: 'child', subagent: true, cwd: '/repo' }
  sessions.set('root', root)
  sessions.set('child', child)
  const view = rootSessionsView(sessions)
  // Counting a child's turns as a top-level session is the same double count the engine path
  // avoids, only in the statistics surface.
  assert.deepEqual(view.values().map((state) => state.sid), ['root'])
  assert.equal(view.size, 1)
  assert.equal(view.get('root'), root)
  assert.equal(view.get('child'), undefined)
  // The real map still holds both: the child keeps its memory levers, it is only off camera.
  assert.equal(sessions.size, 2)
})

test('the observers are registered before the session brief resolves', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-timing-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y') })
  const agent = fakeAgent('session-timing', home)
  const created = ctx.listeners.get('agent/created')
  const pending = created({ agent, source: 'startup' })
  assert.ok(agent.calls.listeners.includes('tools/post-execute'))
  assert.ok(agent.calls.listeners.includes('session/event'))
  await pending
})

test('the pinned rules are mounted as a prompt section', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-pinned-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y'), pinnedRules: 'stay on task' })
  const agent = fakeAgent('session-pinned', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })
  assert.equal(agent.calls.sections.length, 1)
  // The person's rules come first, then the constant routing guidance; both are constants, so the
  // composed text cannot drift between requests.
  assert.ok(agent.calls.sections[0].text.startsWith('stay on task'))
  assert.match(agent.calls.sections[0].text, /write one short script/)
  assert.equal(agent.calls.sections[0].order, 50)
  assert.equal(agent.calls.sections[0].interpolate, false)
  // The learned facts stay a context: they belong to the runtime snapshot, not to the system slot.
  assert.deepEqual(agent.calls.context, [])
})

test('no pinned rules still mounts the Think-in-Code routing, and thinkInCode off mounts nothing', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-nopinned-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y') })
  const agent = fakeAgent('session-nopinned', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })
  // The routing guidance is a constant, so the section exists even with no configured rules.
  assert.equal(agent.calls.sections.length, 1)
  assert.match(agent.calls.sections[0].text, /write one short script/)
  assert.equal(agent.calls.sections[0].interpolate, false)

  const off = fakeContext()
  const offHome = mkdtempSync(join(tmpdir(), 'te-dsh-nopinned-off-'))
  apply(off, {
    stateHome: offHome,
    tePath: join(offHome, 'x'),
    hookPath: join(offHome, 'y'),
    thinkInCode: false,
  })
  const offAgent = fakeAgent('session-nopinned-off', offHome)
  await off.listeners.get('agent/created')({ agent: offAgent, source: 'startup' })
  assert.deepEqual(offAgent.calls.sections, [])
})

test('a repeated tool output is replaced by a pointer', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-dedup-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y') })
  const agent = fakeAgent('session-dedup', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const output = 'y'.repeat(400)
  emit(agent, toolCall('c1', 3))
  const first = await postExecute(
    agent,
    { name: 'bash', callId: 'c1', arguments: { command: 'ls' }, agent },
    { isError: false, content: [{ type: 'text', text: output }] },
  )
  assert.equal(first.content, undefined)

  emit(agent, toolCall('c2', 7))
  let logged = ''
  let second = null
  logged = await captureStderr(async () => {
    second = await postExecute(
      agent,
      { name: 'bash', callId: 'c2', arguments: { command: 'ls' }, agent },
      { isError: false, content: [{ type: 'text', text: output }] },
    )
  })
  assert.equal(second.kind, 'accept')
  assert.equal(second.content.length, 1)
  assert.match(second.content[0].text, /^\[Output identical to step 3 \(hash: [0-9a-f]{12}\), content omitted to save context\]$/)
  assert.match(logged, /\[tokeneconomizer\] dedup: tool=bash repeated-output replaced hits=2 first-step=3 hash=[0-9a-f]{12}/)
})

test('a failed tool result is never replaced', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-failed-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y') })
  const agent = fakeAgent('session-failed', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const output = 'z'.repeat(400)
  for (const callId of ['c1', 'c2']) {
    emit(agent, toolCall(callId, 3))
    const decision = await postExecute(
      agent,
      { name: 'bash', callId, arguments: { command: 'ls' }, agent },
      { isError: true, content: [{ type: 'text', text: output }] },
    )
    assert.equal(decision.content, undefined)
  }
})

test('a decision carrying a canonical value is left untouched', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-value-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y') })
  const agent = fakeAgent('session-value', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const output = 'w'.repeat(400)
  emit(agent, toolCall('c1', 3))
  await postExecute(
    agent,
    { name: 'bash', callId: 'c1', arguments: { command: 'ls' }, agent },
    { isError: false, content: [{ type: 'text', text: output }] },
  )
  emit(agent, toolCall('c2', 7))
  const decision = await postExecute(
    agent,
    { name: 'bash', callId: 'c2', arguments: { command: 'ls' }, agent },
    { isError: false, content: [{ type: 'text', text: output }] },
    { kind: 'accept', value: { ok: true } },
  )
  assert.deepEqual(decision, { kind: 'accept', value: { ok: true } })
})

test('a blocked call stays blocked', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-block-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y') })
  const agent = fakeAgent('session-block', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })
  emit(agent, toolCall('c1', 3))
  const decision = await postExecute(
    agent,
    { name: 'bash', callId: 'c1', arguments: { command: 'ls' }, agent },
    { isError: false, content: [{ type: 'text', text: 'x'.repeat(400) }] },
    { kind: 'block', feedback: [{ type: 'text', text: 'no' }] },
  )
  assert.equal(decision.kind, 'block')
})

test('consecutive identical failures stop the turn and ask for guidance', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-loop-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y') })
  const agent = fakeAgent('session-loop', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const exec = { name: 'bash', callId: 'c1', arguments: { command: 'pytest -q' }, agent }
  const result = { isError: true, content: [{ type: 'text', text: 'Error: command failed' }] }
  for (const callId of ['c1', 'c2']) {
    emit(agent, toolCall(callId, 3))
    await postExecute(agent, { ...exec, callId }, result)
  }
  assert.equal(agent.calls.cancelled.length, 0)

  emit(agent, toolCall('c3', 3))
  await captureStderr(async () => {
    await postExecute(agent, { ...exec, callId: 'c3' }, result)
  })
  assert.equal(agent.calls.injected.length, 1)
  assert.match(agent.calls.injected[0].content[0].text, /failed 3 times in a row/)
  assert.equal(agent.calls.cancelled.length, 1)
  assert.deepEqual(agent.calls.cancelled[0].cause, { kind: 'hook', reason: 'tokeneconomizer/loop-breaker' })
  assert.deepEqual(agent.calls.cancelled[0].options, { keepInbox: true })
})

test('a new user message clears the loop chain', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-reset-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y') })
  const agent = fakeAgent('session-reset', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const exec = { name: 'bash', callId: 'c1', arguments: { command: 'pytest -q' }, agent }
  const result = { isError: true, content: [{ type: 'text', text: 'Error: command failed' }] }
  emit(agent, toolCall('c1', 3))
  await postExecute(agent, exec, result)
  emit(agent, toolCall('c2', 3))
  await postExecute(agent, { ...exec, callId: 'c2' }, result)
  emit(agent, { type: 'user/message', data: { source: { kind: 'user' }, content: [{ type: 'text', text: 'try again' }] } })
  emit(agent, toolCall('c3', 3))
  await postExecute(agent, { ...exec, callId: 'c3' }, result)
  assert.equal(agent.calls.cancelled.length, 0)
})

test('watchdogAction warn is advisory and never interrupts the turn', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-watchdog-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y'), watchdogThresholdMs: 20, watchdogAction: 'warn' })
  const agent = fakeAgent('session-watchdog', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const output = await captureStderr(async () => {
    emit(agent, { type: 'turn/start', data: { turn: 1 } })
    await wait(80)
  })
  assert.match(output, /made no progress/)
  // The default is advisory: the turn keeps running, and the warning reaches the transcript so a
  // person watching the Web GUI actually sees it.
  assert.equal(agent.calls.cancelled.length, 0)
  assert.ok(agent.calls.injected.some(m => /made no progress/.test(m.content[0].text)))
})

test('watchdogAction interrupt is the opt-in that stops the turn', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-watchdog-int-'))
  apply(ctx, {
    stateHome: home,
    tePath: join(home, 'x'),
    hookPath: join(home, 'y'),
    watchdogThresholdMs: 20,
    watchdogAction: 'interrupt',
  })
  const agent = fakeAgent('session-watchdog-int', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const output = await captureStderr(async () => {
    emit(agent, { type: 'turn/start', data: { turn: 1 } })
    await wait(80)
  })
  assert.match(output, /made no progress/)
  assert.equal(agent.calls.cancelled.length, 1)
  assert.deepEqual(agent.calls.cancelled[0].cause, { kind: 'hook', reason: 'watchdog_timeout' })
})

test('a slow tool is caught by its own budget instead of holding the turn open', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-watchdog-suspend-'))
  apply(ctx, {
    stateHome: home,
    tePath: join(home, 'x'),
    hookPath: join(home, 'y'),
    watchdogThresholdMs: 1000,
    watchdogToolThresholdMs: 20,
    watchdogAction: 'interrupt',
  })
  const agent = fakeAgent('session-watchdog-suspend', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const output = await captureStderr(async () => {
    emit(agent, { type: 'turn/start', data: { turn: 1 } })
    emit(agent, toolCall('slow', 1))
    // The turn budget (1000 ms) is held; the 20 ms tool budget is what expires.
    await wait(80)
  })
  assert.equal(agent.calls.cancelled.length, 1)
  assert.deepEqual(agent.calls.cancelled[0].cause, { kind: 'hook', reason: 'watchdog_timeout' })
  assert.match(output, /tool call made no progress/)
})

test('a watch that only warns does not interrupt the turn', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-warnonly-'))
  apply(ctx, {
    stateHome: home,
    tePath: join(home, 'x'),
    hookPath: join(home, 'y'),
    watchdogThresholdMs: 20,
    watchdogAction: 'warn',
  })
  const agent = fakeAgent('session-warn', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const output = await captureStderr(async () => {
    emit(agent, { type: 'turn/start', data: { turn: 1 } })
    await wait(80)
  })
  assert.match(output, /made no progress/)
  assert.equal(agent.calls.cancelled.length, 0)
})

test('a changed system prompt is reported once', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-prefix-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y') })
  const agent = fakeAgent('session-prefix', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  agent.messages.push({ role: 'system', content: [{ type: 'text', text: 'first' }] })
  emit(agent, { type: 'system/message', data: { message: { role: 'system', content: [] } } })
  agent.messages[0] = { role: 'system', content: [{ type: 'text', text: 'second' }] }
  const output = await captureStderr(async () => {
    emit(agent, { type: 'system/message', data: { message: { role: 'system', content: [] } } })
  })
  assert.match(output, /system prompt changed mid-session/)
})

test('every host-local event writes a diagnostic line', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-diagnostics-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y'), watchdogThresholdMs: 20 })
  const agent = fakeAgent('session-diagnostics', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const output = 'q'.repeat(400)
  const logged = await captureStderr(async () => {
    emit(agent, toolCall('c1', 3))
    await postExecute(
      agent,
      { name: 'bash', callId: 'c1', arguments: { command: 'ls' }, agent },
      { isError: false, content: [{ type: 'text', text: output }] },
    )
    emit(agent, toolCall('c2', 7))
    await postExecute(
      agent,
      { name: 'bash', callId: 'c2', arguments: { command: 'ls' }, agent },
      { isError: false, content: [{ type: 'text', text: output }] },
    )

    const failure = { isError: true, content: [{ type: 'text', text: 'Error: command failed' }] }
    for (const callId of ['f1', 'f2', 'f3']) {
      emit(agent, toolCall(callId, 8))
      await postExecute(
        agent,
        { name: 'bash', callId, arguments: { command: 'pytest -q' }, agent },
        failure,
      )
    }

    agent.messages.push({ role: 'system', content: [{ type: 'text', text: 'first' }] })
    emit(agent, { type: 'system/message', data: { message: { role: 'system', content: [] } } })
    agent.messages[0] = { role: 'system', content: [{ type: 'text', text: 'second' }] }
    emit(agent, { type: 'system/message', data: { message: { role: 'system', content: [] } } })

    emit(agent, { type: 'turn/start', data: { turn: 1 } })
    await wait(80)
  })

  assert.match(logged, /\[tokeneconomizer\] dedup: /)
  assert.match(logged, /\[tokeneconomizer\] loop-breaker: /)
  assert.match(logged, /\[tokeneconomizer\] prefix: /)
  assert.match(logged, /\[tokeneconomizer\] watchdog: /)
})

test('disposing the agent stops the watchdog', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-dispose-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y'), watchdogThresholdMs: 20 })
  const agent = fakeAgent('session-dispose', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })
  emit(agent, { type: 'turn/start', data: { turn: 1 } })
  ctx.listeners.get('agent/disposed')({ agent })
  const output = await captureStderr(async () => {
    await wait(80)
  })
  assert.equal(output, '')
  assert.equal(agent.calls.cancelled.length, 0)
})
