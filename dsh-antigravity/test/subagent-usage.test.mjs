/**
 * Antigravity subagent provider — model selection and usage accounting.
 *
 * Three contracts are pinned here:
 *
 *   1. A request-level `agentOptions` selection reaches `agy` as its argv.
 *      The tool layer (dsh-tool-subagent) validates that route against the
 *      Session's model-selection allowlist BEFORE it builds the request, so the
 *      provider's only job is to prefer the request over its configured default.
 *   2. The provider resolves `agy` to an absolute path without spawning, so a
 *      missing CLI fails before a child is created.
 *   3. A completed run records the CLI envelope's `usage` exactly once, and a
 *      run that never completed records nothing at all.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { AntigravitySubagentProvider, buildSubagentArgv, toSubagentTokenUsage } from '../lib/subagent.js'
import { createLedger } from '../lib/server.js'

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
 * @param {object} [options] - `{ canned, recorded, config }`.
 * @returns {{ provider: object, subprocess: object, calls: object[] }} the provider and its records.
 */
function makeProvider(options = {}) {
  const calls = []
  const subprocess = fakeSubprocess(options.canned)
  const provider = new AntigravitySubagentProvider('antigravity', { subprocess }, {
    agyPath: EXISTING_ABSOLUTE,
    model: 'gemini-3.8-flash-low',
    effort: 'low',
    mode: 'accept-edits',
    timeoutMs: 60000,
    disposeGraceMs: 1000,
    env: {},
    recordUsage: (usage) => calls.push(usage),
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

/** One CLI envelope, with usage in the CLI's own snake_case field names. */
function envelope(usage) {
  return JSON.stringify({ response: 'the answer', status: 'SUCCESS', usage })
}

test('capabilities advertise agentOptions so the tool may pass a child route', () => {
  const { provider } = makeProvider()
  assert.equal(provider.capabilities.agentOptions, true)
})

test('an envelope with usage is mapped to TokenUsage and recorded once', async () => {
  const { provider, calls } = makeProvider({
    canned: {
      stdout: envelope({ input_tokens: 120, output_tokens: 34, thinking_tokens: 7, cache_read_tokens: 80 }),
    },
  })
  const run = provider.start(startRequest())
  const settled = await run.result
  await run.dispose()

  assert.equal(settled.stopReason, 'completed')
  assert.deepEqual(settled.output, [{ type: 'text', text: 'the answer' }])
  assert.equal(calls.length, 1, 'usage is recorded exactly once per completed run')
  assert.deepEqual(calls[0], { inputTokens: 120, outputTokens: 34, reasoningTokens: 7, cacheReadTokens: 80 })
})

test('zero-valued optional buckets are omitted, not reported as zero', async () => {
  const { provider, calls } = makeProvider({
    canned: { stdout: envelope({ input_tokens: 5, output_tokens: 2, thinking_tokens: 0 }) },
  })
  const settled = await provider.start(startRequest()).result

  assert.equal(settled.stopReason, 'completed')
  assert.deepEqual(calls[0], { inputTokens: 5, outputTokens: 2 })
  assert.equal('reasoningTokens' in calls[0], false, 'a zero reasoning bucket is omitted')
  assert.equal('cacheReadTokens' in calls[0], false, 'a zero cache bucket is omitted')
})

test('an envelope without usage records nothing', async () => {
  const { provider, calls } = makeProvider({
    canned: { stdout: JSON.stringify({ response: 'no accounting', status: 'SUCCESS' }) },
  })
  const settled = await provider.start(startRequest()).result

  assert.equal(settled.stopReason, 'completed')
  assert.deepEqual(settled.output, [{ type: 'text', text: 'no accounting' }])
  assert.equal(calls.length, 0, 'a run with no measured usage must not touch the ledger')
})

test('a non-zero exit records nothing', async () => {
  const { provider, calls } = makeProvider({
    canned: {
      stdout: envelope({ input_tokens: 99, output_tokens: 99 }),
      stderr: 'agy: boom',
      exitCode: 1,
    },
  })
  const settled = await provider.start(startRequest()).result

  assert.equal(settled.stopReason, 'error')
  assert.match(settled.diagnostic, /boom/)
  assert.equal(calls.length, 0, 'a failed child did no completed work')
})

test('an ERROR envelope records nothing even though the process exited zero', async () => {
  const { provider, calls } = makeProvider({
    canned: {
      stdout: JSON.stringify({
        response: '',
        status: 'ERROR',
        error: 'quota exhausted',
        usage: { input_tokens: 12, output_tokens: 1 },
      }),
    },
  })
  const settled = await provider.start(startRequest()).result

  assert.equal(settled.stopReason, 'error')
  assert.equal(calls.length, 0)
})

test('the request model override reaches the argv instead of the configured default', async () => {
  const { provider, subprocess } = makeProvider()
  // A base model id, because a level-suffixed id deliberately takes no
  // `--effort` flag (the CLI rejects the conflicting pair).
  const run = provider.start(startRequest({ agentOptions: { provider: 'antigravity', model: 'gemini-3.8-pro', reasoningEffort: 'high' } }))
  await run.result
  await run.dispose()

  const argv = subprocess.spawned[0].argv
  assert.ok(argv.includes('--model'))
  assert.equal(argv[argv.indexOf('--model') + 1], 'gemini-3.8-pro')
  assert.equal(argv[argv.indexOf('--effort') + 1], 'high', 'the request effort overrides the configured one')
  assert.equal(argv.includes('gemini-3.8-flash-low'), false, 'the configured default is not used')
  assert.equal(argv[0], EXISTING_ABSOLUTE, 'the executable is the resolved absolute path')
})

test('without a request override the configured model and effort are used', async () => {
  // A base model id, so the configured effort actually reaches argv; a
  // suffixed id encodes its level and suppresses the flag.
  const { provider, subprocess } = makeProvider({ config: { model: 'gemini-3.8-pro', effort: 'medium' } })
  await provider.start(startRequest()).result

  const argv = subprocess.spawned[0].argv
  assert.equal(argv[argv.indexOf('--model') + 1], 'gemini-3.8-pro')
  assert.equal(argv[argv.indexOf('--effort') + 1], 'medium')
})

test('a model id that encodes its level takes no --effort flag', () => {
  const argv = buildSubagentArgv({ executable: 'agy', prompt: 'p', model: 'gemini-3.8-flash-low', effort: 'high', mode: 'accept-edits' })
  assert.equal(argv.includes('--effort'), false, 'the CLI rejects a conflicting level flag')
})

test('a missing agy fails loudly before any child is spawned', () => {
  const emptyPath = ''
  const savedPath = process.env.PATH
  process.env.PATH = emptyPath
  try {
    const { provider, subprocess } = makeProvider({ config: { agyPath: '/nonexistent/agy-does-not-exist' } })
    assert.throws(
      () => provider.start(startRequest()),
      /antigravity subagent: agy CLI not found \(set agyPath or add it to PATH\)/,
    )
    assert.equal(subprocess.spawned.length, 0, 'resolution is side-effect free: nothing spawns')
  } finally {
    process.env.PATH = savedPath
  }
})

test('a configured relative agyPath falls back to the PATH search', () => {
  const { provider, subprocess } = makeProvider({ config: { agyPath: 'agy' } })
  // `agy` may or may not be installed on the machine running the suite; either
  // way the failure mode is a thrown error, never a bogus argv.
  let thrown
  try {
    provider.start(startRequest())
  } catch (error) {
    thrown = error
  }
  if (thrown) {
    assert.match(thrown.message, /agy CLI not found/)
    assert.equal(subprocess.spawned.length, 0)
  } else {
    assert.ok(subprocess.spawned[0].argv[0].includes('agy'), 'the resolved path names an agy binary')
  }
})

test('the TokenUsage mapper ignores an empty or malformed usage object', () => {
  assert.equal(toSubagentTokenUsage(undefined), undefined)
  assert.equal(toSubagentTokenUsage(null), undefined)
  assert.equal(toSubagentTokenUsage({}), undefined)
  assert.equal(toSubagentTokenUsage({ input_tokens: 0, output_tokens: 0 }), undefined)
  assert.deepEqual(toSubagentTokenUsage({ inputTokens: 3, outputTokens: 4 }), { inputTokens: 3, outputTokens: 4 })
})

test('the shared ledger accepts the mapped usage verbatim', async () => {
  const ledger = createLedger()
  const { provider } = makeProvider({
    canned: { stdout: envelope({ input_tokens: 10, output_tokens: 4, cache_read_tokens: 6 }) },
    config: { recordUsage: (usage) => ledger.record(usage) },
  })
  await provider.start(startRequest()).result

  assert.deepEqual(ledger.summary(), {
    requests: 1,
    inputTokens: 10,
    outputTokens: 4,
    reasoningTokens: 0,
    cacheReadTokens: 6,
  })
})
