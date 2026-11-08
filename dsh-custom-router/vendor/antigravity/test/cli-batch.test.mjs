/**
 * Synchronous batch tool (`agy_cli`) contract.
 *
 * Owner decision 1(a), 2026-11-07: the synchronous one-shot worker of
 * `@nolit/dsh-subagent-local` moves into the provider plugins. These tests pin
 * the ported result facts (exit facts, disjoint usage, artifacts, prompt
 * transport), the argv-limit rejection, and the explicit opt-in gate: the
 * tracked-child `agy_worker` stays the default, and `agy_cli` only exists when
 * `cliBatch` is true.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config, apply } from '../lib/index.js'
import {
  BATCH_TOOL_NAME,
  batchOutputSchema,
  batchParameters,
  emptyBatchResult,
  renderBatchResult,
  runBatch,
} from '../lib/cli-batch.js'

const SIGNAL = new AbortController().signal
const ENVELOPE = JSON.stringify({
  conversation_id: 'c-1',
  status: 'done',
  response: 'finished the batch',
  usage: { input_tokens: 11, output_tokens: 7, thinking_tokens: 3, cache_read_tokens: 5 },
})

/** Config stub with the fields `runBatch` reads. */
function configStub(overrides = {}) {
  return {
    agyPath: 'agy',
    model: 'gemini-3.8-flash-2',
    effort: 'low',
    mode: 'accept-edits',
    timeoutMs: 5000,
    maxOutputBytes: 65536,
    artifactLimit: 5,
    forwardEnv: ['PATH'],
    extraArgs: [],
    ...overrides,
  }
}

/**
 * Subprocess stub with one canned response.
 * @param {{stdout?: string, exitCode?: number, stderr?: string}} reply - canned outcome.
 * @returns {object} the service and its spawn recorder.
 */
function stubSubprocess(reply = {}) {
  const spawned = []
  const stdout = reply.stdout ?? ENVELOPE
  const stderr = reply.stderr ?? ''
  return {
    spawned,
    async resolveExecutable(path) {
      return `/resolved/${path}`
    },
    spawn(spec) {
      spawned.push(spec)
      return {
        done: Promise.resolve({ exitCode: reply.exitCode ?? 0, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) },
          stderr: { readFrom: () => ({ text: stderr, nextOffset: stderr.length, lossy: false }) },
        },
        terminate() {},
      }
    },
  }
}

test('runBatch returns the measured facts for one synchronous call', async () => {
  const subprocess = stubSubprocess()
  const result = await runBatch({
    services: { subprocess },
    config: configStub(),
    task: 'build the thing',
    cwd: '/tmp',
    signal: SIGNAL,
  })

  assert.equal(result.ok, true)
  assert.equal(result.backend, 'antigravity')
  assert.equal(result.summary, 'finished the batch')
  assert.deepEqual(result.usage, { inputTokens: 11, outputTokens: 7, thinkingTokens: 3, cacheReadTokens: 5 })
  assert.equal(result.promptTransport, 'argv')
  assert.equal(result.promptBytes, Buffer.byteLength('build the thing'))
  assert.equal(result.exitCode, 0)
  assert.equal(result.executable, '/resolved/agy')
  assert.ok(result.elapsedMs >= 0)
  assert.equal(subprocess.spawned.length, 1)
  // The task rides beside `-p`; stdin stays closed.
  assert.equal(subprocess.spawned[0].argv[1], '-p')
  assert.equal(subprocess.spawned[0].argv[2], 'build the thing')
  assert.equal(subprocess.spawned[0].stdio.stdin, 'ignore')
})

test('a task over the argv limit fails as a diagnostic, not a truncated prompt', async () => {
  const subprocess = stubSubprocess()
  const result = await runBatch({
    services: { subprocess },
    config: configStub(),
    task: 'x'.repeat(131073),
    cwd: '/tmp',
    signal: SIGNAL,
  })

  assert.equal(result.ok, false)
  assert.match(result.diagnostic, /capped at/)
  assert.equal(subprocess.spawned.length, 0)
})

test('a non-envelope stdout degrades to raw text and says so', async () => {
  const subprocess = stubSubprocess({ stdout: 'not json', stderr: 'warn' })
  const result = await runBatch({
    services: { subprocess },
    config: configStub(),
    task: 'do it',
    cwd: '/tmp',
    signal: SIGNAL,
  })

  assert.equal(result.ok, true)
  assert.equal(result.summary, 'not json')
  assert.match(result.diagnostic, /not a JSON envelope/)
  assert.equal(result.stderrTail, 'warn')
})

test('empty result carries every schema field', () => {
  const schema = batchOutputSchema()
  const empty = emptyBatchResult('why')
  for (const key of Object.keys(schema.properties)) assert.ok(key in empty, `missing ${key}`)
  assert.equal(empty.diagnostic, 'why')
  assert.equal(renderBatchResult(empty).includes('why'), true)
})

test('the batch tool name is never a reserved subagent name', () => {
  assert.equal(BATCH_TOOL_NAME, 'agy_cli')
  assert.equal(BATCH_TOOL_NAME.startsWith('subagent'), false)
  assert.deepEqual(Object.keys(batchParameters()).sort(), ['collect', 'cwd', 'effort', 'mode', 'model', 'task', 'timeoutMs'].sort())
})

/**
 * Mount the real plugin against a mock host.
 * @param {object} config - plugin config overrides.
 * @returns {object} the mock context and registered tool names.
 */
function mountPlugin(config = {}) {
  const subprocess = stubSubprocess()
  const ctx = {
    llm: { registerAdapter: () => () => {} },
    tools: {
      registered: [],
      get: () => undefined,
      register(tool) {
        ctx.tools.registered.push(tool)
        return () => {}
      },
    },
    commands: { get: () => undefined, register: () => () => {} },
    subprocess,
    subagents: { getProvider: () => undefined, registerProvider: () => () => {} },
    logger: { warn() {}, debug() {} },
    emit() {},
  }
  apply(ctx, Config(config))
  return { ctx, subprocess }
}

test('agy_cli is off by default and appears when cliBatch is enabled', () => {
  const off = mountPlugin()
  assert.deepEqual(off.ctx.tools.registered.map((tool) => tool.name), ['agy_worker'])

  const on = mountPlugin({ cliBatch: true })
  assert.deepEqual(on.ctx.tools.registered.map((tool) => tool.name).sort(), ['agy_cli', 'agy_worker'])
})

test('a mounted provider makes the batch tool yield instead of spawning', async () => {
  const subprocess = stubSubprocess()
  const result = await runBatch({
    services: {
      subprocess,
      subagents: { getProvider: (name) => (name === 'antigravity' ? { name } : undefined) },
    },
    config: configStub({ batchYieldToProvider: 'antigravity' }),
    task: 'do it',
    cwd: '/tmp',
    signal: SIGNAL,
  })

  assert.equal(result.errorKind, 'provider-mounted')
  assert.equal(result.yieldedProvider, 'antigravity')
  assert.match(result.diagnostic, /mounted provider/)
  assert.equal(result.ok, false)
  assert.equal(subprocess.spawned.length, 0)
})
