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
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { apply, DEFAULTS, isHeadless, name, resolveConfig } from '../lib/index.js'

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
  assert.equal(resolveConfig({}).watchdogAction, 'interrupt')
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

test('a subagent session is not given its own economy', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-sub-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y') })
  const agent = fakeAgent('session-sub', home)
  agent.session.header.origin = 'subagent'
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })
  assert.deepEqual(agent.calls.listeners, [])
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
  assert.equal(agent.calls.sections[0].text, 'stay on task')
  assert.equal(agent.calls.sections[0].order, 50)
  assert.equal(agent.calls.sections[0].interpolate, false)
  // The learned facts stay a context: they belong to the runtime snapshot, not to the system slot.
  assert.deepEqual(agent.calls.context, [])
})

test('no pinned rules means no section', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-nopinned-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y') })
  const agent = fakeAgent('session-nopinned', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })
  assert.deepEqual(agent.calls.sections, [])
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

test('a step without progress trips the watchdog', async () => {
  const ctx = fakeContext()
  const home = mkdtempSync(join(tmpdir(), 'te-dsh-watchdog-'))
  apply(ctx, { stateHome: home, tePath: join(home, 'x'), hookPath: join(home, 'y'), watchdogThresholdMs: 20 })
  const agent = fakeAgent('session-watchdog', home)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })

  const output = await captureStderr(async () => {
    emit(agent, { type: 'turn/start', data: { turn: 1 } })
    await wait(80)
  })
  assert.match(output, /watchdog: no progress/)
  assert.equal(agent.calls.cancelled.length, 1)
  assert.deepEqual(agent.calls.cancelled[0].cause, { kind: 'hook', reason: 'tokeneconomizer/watchdog' })
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
  assert.match(output, /watchdog: no progress/)
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
