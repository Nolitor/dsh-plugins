/**
 * OpenCode subagent provider — model selection, path resolution and usage.
 *
 * The owner's three patches (2026-11-08):
 *   1. a request-level model beats the configured default (`-m` on the argv);
 *   2. the configured CLI path is resolved to an absolute one before spawning;
 *   3. a completed run records its `step_finish` token usage exactly once.
 *
 * Usage is a STEP event in the run NDJSON (`step_finish`), never a whole-run
 * total, so these tests pin the summing behaviour and the one-row rule.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { OpenCodeSubagentProvider, resolveExecutable } from '../lib/subagent.js'

const SIGNAL = new AbortController().signal

/** An absolute path that exists on every supported host, so resolution is a no-op. */
const EXISTING_ABSOLUTE = process.execPath

/**
 * A subprocess service double that answers `spawn` with a canned child.
 * @param {object} [canned] - `{ stdout, exitCode }` for the fake child.
 * @returns {object} the service plus its spawn record.
 */
function fakeSubprocess(canned = {}) {
  const spawned = []
  return {
    spawned,
    spawn(spec) {
      spawned.push(spec)
      const stdout = canned.stdout ?? ''
      const read = (text) => ({ readFrom: () => ({ text, nextOffset: text.length, lossy: false }) })
      return {
        done: Promise.resolve({ exitCode: canned.exitCode ?? 0, signal: null }),
        collected: { stdout: read(stdout), stderr: read(canned.stderr ?? '') },
        terminate() {},
      }
    },
  }
}

/**
 * Build the provider over a fake subprocess service.
 * @param {object} [options] - `{ canned, config }`.
 * @returns {{ provider: object, subprocess: object, calls: object[] }} the provider and its records.
 */
function makeProvider(options = {}) {
  const calls = []
  const subprocess = fakeSubprocess(options.canned)
  const provider = new OpenCodeSubagentProvider('opencode', { subprocess }, {
    opencodePath: EXISTING_ABSOLUTE,
    model: 'opencode-go/default#low',
    agent: '',
    auto: false,
    timeoutMs: 60000,
    disposeGraceMs: 1000,
    env: {},
    recordUsage: (payload) => calls.push(payload),
    ...options.config,
  })
  return { provider, subprocess, calls }
}

/** Build a minimal start request. */
function startRequest(extra = {}) {
  return {
    cwd: '/tmp/project',
    prompt: [{ type: 'text', text: 'do the thing' }],
    signal: SIGNAL,
    ...extra,
  }
}

/** One run NDJSON line. */
const line = (event) => JSON.stringify(event) + '\n'

test('capabilities allow a per-request model selection', () => {
  const { provider } = makeProvider()
  assert.equal(provider.capabilities.agentOptions, true)
})

test('a request model override reaches the argv as -m', async () => {
  const { provider, subprocess } = makeProvider({
    canned: { stdout: line({ type: 'text', part: { id: 'p1', text: 'ok' } }) },
  })
  const run = provider.start(startRequest({ agentOptions: { model: 'opencode-go/expensive#high' } }))
  await run.result
  const argv = subprocess.spawned[0].argv
  assert.equal(argv[argv.indexOf('-m') + 1], 'opencode-go/expensive#high')
})

test('the configured default model is used when the request names none', async () => {
  const { provider, subprocess } = makeProvider({
    canned: { stdout: line({ type: 'text', part: { id: 'p1', text: 'ok' } }) },
  })
  const run = provider.start(startRequest())
  await run.result
  const argv = subprocess.spawned[0].argv
  assert.equal(argv[argv.indexOf('-m') + 1], 'opencode-go/default#low')
})

test('a completed run records the summed step_finish usage exactly once', async () => {
  const stdout = [
    line({ type: 'text', part: { id: 'p1', text: 'answer' } }),
    line({ type: 'step_finish', part: { tokens: { input: 10, output: 2, reasoning: 1, cache: { read: 5, write: 3 } } } }),
    line({ type: 'step_finish', tokens: { input: 4, output: 1, cache: { read: 0 } } }),
  ].join('')
  const { provider, calls } = makeProvider({ canned: { stdout } })
  const run = provider.start(startRequest())
  await run.result
  assert.equal(calls.length, 1, 'one row per completed run')
  assert.equal(calls[0].model, 'opencode-go/default#low')
  assert.deepEqual(calls[0].usage, { input: 14, output: 3, reasoning: 1, cacheRead: 5, cacheWrite: 3 })
})

test('a run that reports no usage records nothing', async () => {
  const stdout = line({ type: 'text', part: { id: 'p1', text: 'answer' } })
  const { provider, calls } = makeProvider({ canned: { stdout } })
  const run = provider.start(startRequest())
  await run.result
  assert.equal(calls.length, 0, 'no fabricated zero row')
})

test('a non-zero exit records nothing', async () => {
  const stdout = line({ type: 'step_finish', tokens: { input: 1, output: 1 } })
  const { provider, calls } = makeProvider({ canned: { stdout, exitCode: 1 } })
  const run = provider.start(startRequest())
  const settled = await run.result
  assert.equal(settled.stopReason, 'error')
  assert.equal(calls.length, 0)
})

test('resolveExecutable returns an absolute path for a PATH name and throws for a missing one', () => {
  const resolved = resolveExecutable('node')
  assert.ok(resolved.startsWith('/') || /^[A-Za-z]:\\/.test(resolved), 'absolute: ' + resolved)
  assert.throws(() => resolveExecutable('definitely-not-a-real-cli-xyz'), /opencode CLI not found/)
})
