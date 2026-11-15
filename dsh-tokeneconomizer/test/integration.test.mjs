/**
 * End-to-end bridge test: a bootstrapped engine, a fake DSH agent, real hook processes.
 *
 * Skipped unless `TE_DSH_TEST_HOME` names a state root produced by `scripts/bootstrap.mjs` (that
 * is, a root with `bin/te`, `bin/te-hook` and the patched core). It then drives one whole session
 * — created, prompt turn, one tool result, turn end, disposal — and requires the engine to have
 * folded and priced it. The plugin's own scope is a stub: this test is about the process
 * boundary, not about DSH's services.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { apply } from '../lib/index.js'

const engineHome = process.env.TE_DSH_TEST_HOME
const skip = engineHome ? false : 'set TE_DSH_TEST_HOME to a bootstrapped TokenEconomizer state root'

/**
 * Ask the engine what it knows about a directory.
 * @param {string} home - state root.
 * @param {string} cwd - repository directory.
 * @returns {object} `te status --json`.
 */
function status(home, cwd) {
  const out = execFileSync(join(home, 'bin', 'te'), ['--host', 'dsh', '--cwd', cwd, 'status', '--json'], {
    encoding: 'utf8',
    // The engine may spawn `dsh --profile headless`; hand it the test's throwaway home.
    env: { ...process.env, TOKENECONOMIZER_HOME: home, DSH_HOME: process.env.DSH_HOME },
  })
  return JSON.parse(out.slice(out.indexOf('{')))
}

/**
 * Build one fake DSH agent whose scope records registrations.
 * @param {string} id - session id.
 * @param {string} cwd - session directory.
 * @returns {object} the agent and its recorded registrations.
 */
function fakeAgent(id, cwd) {
  const calls = { listeners: new Map(), injected: [] }
  const events = [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'user/message', seq: 1, time: 2, data: {
      id: 'u1', role: 'user', content: [{ type: 'text', text: 'run the suite' }],
      source: { kind: 'user' },
    } },
    { type: 'assistant/message', seq: 2, time: 3, data: {
      turn: 1, step: 1,
      message: { id: 'a1', role: 'assistant',
        content: [{ type: 'text', text: 'running' }],
        source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-v4.1-flash' } },
      usage: { inputTokens: 500, outputTokens: 25, totalTokens: 525, cacheReadTokens: 0 },
    } },
    { type: 'tool/call', seq: 3, time: 4, data: {
      turn: 1, step: 1, callId: 'c1', name: 'bash',
      arguments: JSON.stringify({ command: 'python -m pytest -q' }),
    } },
    { type: 'tool/result', seq: 4, time: 5, data: {
      turn: 1, step: 1,
      message: { id: 't1', role: 'tool', toolCallId: 'c1', isError: false,
        content: [{ type: 'text', text: '1 passed in 0.2s' }],
        source: { kind: 'tool', callId: 'c1' } },
    } },
    { type: 'turn/end', seq: 5, time: 6, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const agent = {
    id,
    calls,
    session: { header: { id, version: 4, createdAt: 1, cwd }, snapshotEvents: () => events },
    ctx: {
      systemPrompt: { context: (entry) => calls.context?.push(entry) },
      tools: { restrict: (filter) => calls.restrict?.push(filter) },
      on: (event, listener) => {
        calls.listeners.set(event, listener)
        return () => calls.listeners.delete(event)
      },
    },
    inject: (message) => calls.injected.push(message),
  }
  calls.context = []
  calls.restrict = []
  return agent
}

test('one session crosses the bridge and is folded', { skip }, async (t) => {
  const stateHome = mkdtempSync(join(tmpdir(), 'dsh-te-e2e-state-'))
  const repo = mkdtempSync(join(tmpdir(), 'dsh-te-e2e-repo-'))
  // The engine spawns `dsh --profile headless` for side calls, so this test must own a
  // throwaway DSH_HOME. Without it the call writes the owner's live session log under
  // cwd = /tmp/te-*, which shows up as an orphan in the sidebar (measured 2026-11-05).
  const isolatedDshHome = mkdtempSync(join(tmpdir(), 'dsh-te-e2e-dsh-home-'))
  const previousDshHome = process.env.DSH_HOME
  const previousTeHome = process.env.TOKENECONOMIZER_HOME
  process.env.DSH_HOME = isolatedDshHome
  process.env.TOKENECONOMIZER_HOME = stateHome
  t.after(() => {
    if (previousDshHome === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previousDshHome
    if (previousTeHome === undefined) delete process.env.TOKENECONOMIZER_HOME
    else process.env.TOKENECONOMIZER_HOME = previousTeHome
    rmSync(isolatedDshHome, { recursive: true, force: true })
  })
  const ctx = { listeners: new Map(), tools: { definitions: () => [{ name: 'bash' }] } }
  ctx.on = (event, listener) => {
    ctx.listeners.set(event, listener)
    return () => ctx.listeners.delete(event)
  }
  // The engine root holds the launchers; the state root is fresh, so the fold below is the
  // only record the engine can produce.
  apply(ctx, {
    stateHome,
    tePath: join(engineHome, 'bin', 'te'),
    hookPath: join(engineHome, 'bin', 'te-hook'),
  })

  const agent = fakeAgent('session-e2e-0001', repo)
  await ctx.listeners.get('agent/created')({ agent, source: 'startup' })
  for (const event of agent.session.snapshotEvents()) {
    if (event.type === 'turn/end') continue
    agent.calls.listeners.get('session/event')(agent.session, event)
  }
  const exec = { agent, callId: 'c1', name: 'bash', arguments: { command: 'python -m pytest -q' } }
  agent.calls.listeners.get('tools/result')(exec, {
    isError: false,
    content: [{ type: 'text', text: '1 passed in 0.2s' }],
  })
  agent.calls.listeners.get('session/event')(agent.session, {
    type: 'turn/end', seq: 5, time: 6, data: { turn: 1, reason: { kind: 'completed' } },
  })
  ctx.listeners.get('agent/disposed')({ agent })

  const exportPath = join(stateHome, 'dsh-sessions', 'session-e2e-0001.jsonl')
  await waitFor(() => existsSync(exportPath), 15000)
  assert.ok(readFileSync(exportPath, 'utf8').includes('"type":"tool/call"'))

  // `SessionEnd` hands the session to a detached fold; wait for it to land.
  const folded = await waitFor(() => {
    try {
      return status(stateHome, repo).ledger.sessions >= 1
    } catch {
      return false
    }
  }, 30000)
  assert.equal(folded, true, 'the session was not folded into the ledger')
  const view = status(stateHome, repo)
  assert.equal(view.host, 'dsh')
  assert.equal(view.ledger.sessions, 1)
  assert.equal(view.ledger.priced_sessions, 1)
})

/**
 * Poll a predicate until it holds or the budget expires.
 * @param {() => boolean} predicate - condition to wait for.
 * @param {number} timeoutMs - budget.
 * @returns {Promise<boolean>} whether it held.
 */
async function waitFor(predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    if (predicate()) return true
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
  return predicate()
}
