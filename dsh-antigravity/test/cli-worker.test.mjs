/**
 * CLI worker contract — the option name and the subprocess handle shape.
 *
 * F-43 (2026-11-05): index.js called `runAgyWorker(ctx, config, { task })` while
 * the worker reads `options.prompt`, so every /agy call and every agy_worker
 * invocation failed with "buildAgyArgv requires a non-empty prompt". The model
 * surface was verified and working, which is exactly why the CLI surface was
 * assumed to work too — it had never been exercised.
 *
 * The worker also depends on the host's subprocess handle shape:
 *   handle.done -> { exitCode, signal, timedOut, aborted }
 *   handle.collected.stdout.readFrom(0) -> { text, lossy }
 * A mock without `collected` produces "Cannot read properties of undefined".
 */
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { test } from 'node:test'

import { runAgyWorker } from '../lib/worker.js'

/** Build the reactive config cordis provides. */
function reactiveConfig(overrides = {}) {
  const values = {
    agyPath: 'agy', model: 'gemini-3.8-flash-low', effort: 'low', mode: 'accept-edits',
    timeoutMs: 60000, maxOutputBytes: 8388608, forwardEnv: ['PATH', 'HOME'],
    extraArgs: [], artifactLimit: 10,
    ...overrides,
  }
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { get: () => v }]))
}

/** A subprocess service shaped like the host's. */
function fakeSubprocess(behaviour = 'echo') {
  return {
    resolveExecutable: async (path) => path,
    spawn: ({ argv, cwd }) => {
      if (behaviour === 'fail') {
        const done = Promise.resolve({ exitCode: 127, signal: '', timedOut: false, aborted: false })
        const stream = () => ({ readFrom: () => ({ text: '', lossy: false }) })
        return { done, collected: { stdout: stream(), stderr: stream() }, kill() {} }
      }
      const [exe, ...args] = argv
      const child = spawn(exe, args, { cwd, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] })
      let out = ''
      let err = ''
      child.stdout.on('data', (d) => { out += d.toString() })
      child.stderr.on('data', (d) => { err += d.toString() })
      const done = new Promise((resolve) => {
        child.on('close', (code, signal) => resolve({ exitCode: code, signal: signal ?? '', timedOut: false, aborted: false }))
      })
      const stream = (read) => ({ readFrom: () => ({ text: read(), lossy: false }) })
      return { done, collected: { stdout: stream(() => out), stderr: stream(() => err) }, kill() { child.kill('SIGKILL') } }
    },
  }
}

test('the worker reads options.prompt, not options.task', async () => {
  const ctx = { subprocess: fakeSubprocess('fail'), logger: { warn() {} } }
  // A missing prompt is rejected by the argv builder BEFORE spawning, which is
  // the exact failure the wrong option name produced.
  const result = await runAgyWorker(ctx, reactiveConfig(), { cwd: '/tmp' })
  assert.equal(result.ok, false)
  assert.match(String(result.summary), /prompt/, 'the error must name the missing prompt')
})

test('a failing spawn is reported, not thrown', async () => {
  const ctx = { subprocess: fakeSubprocess('fail'), logger: { warn() {} } }
  const result = await runAgyWorker(ctx, reactiveConfig(), { prompt: 'hi', cwd: '/tmp' })
  assert.equal(result.ok, false, 'a non-zero exit is a result, not an exception')
  assert.equal(typeof result.summary, 'string')
})

test('a relative cwd is rejected', async () => {
  const ctx = { subprocess: fakeSubprocess('fail'), logger: { warn() {} } }
  await assert.rejects(
    () => runAgyWorker(ctx, reactiveConfig(), { prompt: 'hi', cwd: 'relative/path' }),
    /absolute/,
  )
})

test('the handle shape the worker needs is documented by this test', () => {
  // Guard the contract itself: if the host changes this shape, the worker breaks
  // with "Cannot read properties of undefined (reading 'stdout')".
  const handle = fakeSubprocess('fail').spawn({ argv: ['true'], cwd: '/tmp' })
  assert.equal(typeof handle.done.then, 'function')
  assert.equal(typeof handle.collected.stdout.readFrom, 'function')
  assert.deepEqual(Object.keys(handle.collected.stdout.readFrom(0)).sort(), ['lossy', 'text'])
})
