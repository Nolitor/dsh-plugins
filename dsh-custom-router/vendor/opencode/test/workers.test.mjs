/**
 * Unit tests for the built-in `cli_worker` module: argv builders, backend
 * parsers, artifact globbing, and one end-to-end run against a stub subprocess
 * service (a real node child, so stdin delivery and cancellation are exercised).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { WORKER_BACKENDS, buildWorkerArgv, parseWorkerOutput } from '../lib/workers/backends.js'
import { collectArtifacts, globToRegExp } from '../lib/workers/artifacts.js'
import { runWorker } from '../lib/workers/run.js'
import { renderWorkerResult, workerOutputSchema, workerParameters } from '../lib/workers/index.js'

/** Config stub with the getters `runWorker` reads. */
function stubConfig(overrides = {}) {
  const values = {
    workerTimeoutMs: 5000,
    workerMaxOutputBytes: 65536,
    workerArtifactLimit: 10,
    forwardEnv: ['PATH', 'HOME'],
    opencodePath: 'opencode',
    ...overrides,
  }
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, { get: () => value }]))
}

/**
 * Subprocess service stub that runs `script` under the current node, buffering
 * output the way the collected-stdio contract does.
 * @param {string} script - node -e source used for every spawn.
 */
function stubSubprocess(script) {
  return {
    async resolveExecutable() {
      return process.execPath
    },
    spawn(spec) {
      const child = spawn(process.execPath, ['-e', script], {
        cwd: spec.cwd,
        env: { ...process.env, ...spec.env },
        stdio: ['pipe', 'pipe', 'pipe'],
      })
      let stdout = ''
      let stderr = ''
      child.stdout.on('data', (chunk) => {
        stdout += chunk
      })
      child.stderr.on('data', (chunk) => {
        stderr += chunk
      })
      const done = new Promise((resolve) => {
        child.on('close', (exitCode, signal) => resolve({ exitCode, signal }))
      })
      spec.signal?.addEventListener('abort', () => child.kill('SIGKILL'), { once: true })
      return {
        stdin: child.stdin,
        done,
        collected: {
          stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) },
          stderr: { readFrom: () => ({ text: stderr, nextOffset: stderr.length, lossy: false }) },
        },
      }
    },
  }
}

test('backend list is the three documented CLI families', () => {
  assert.deepEqual([...WORKER_BACKENDS], ['opencode', 'codex', 'claude'])
})

test('argv builders keep the prompt out of argv and pass the route', () => {
  assert.deepEqual(buildWorkerArgv('opencode', { executable: '/bin/opencode', model: 'opencode/beam-free' }), [
    '/bin/opencode',
    'run',
    '--format',
    'json',
    '--thinking',
    '--auto',
    '--standalone',
    '-m',
    'opencode/beam-free',
  ])
  assert.deepEqual(buildWorkerArgv('codex', { executable: '/bin/codex' }), ['/bin/codex', 'exec', '--json', '--skip-git-repo-check', '-'])
  assert.deepEqual(buildWorkerArgv('claude', { executable: '/bin/claude', model: 'sonnet' }), [
    '/bin/claude',
    '-p',
    '--output-format',
    'json',
    '--model',
    'sonnet',
  ])
})

test('unknown backend fails loud', () => {
  assert.throws(() => buildWorkerArgv('aider', { executable: 'aider' }), /unknown cli_worker backend "aider"/)
})

test('opencode parser assembles text parts and sums step usage', () => {
  const stdout = [
    JSON.stringify({ type: 'text', part: { id: 'p1', text: 'hello ' } }),
    JSON.stringify({ type: 'text', part: { id: 'p1', text: 'hello world' } }),
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 12, output: 3 } } }),
    JSON.stringify({ type: 'step_finish', part: { tokens: { input: 4, output: 2 } } }),
  ].join('\n')
  const parsed = parseWorkerOutput('opencode', stdout)
  assert.equal(parsed.summary, 'hello world')
  assert.equal(parsed.usage.inputTokens, 16)
  assert.equal(parsed.usage.outputTokens, 5)
})

test('opencode parser surfaces a provider error event', () => {
  const stdout = JSON.stringify({
    type: 'error',
    error: { type: 'provider.free-limit', message: 'Free usage limit reached.', status: 429 },
  })
  const parsed = parseWorkerOutput('opencode', stdout)
  assert.equal(parsed.summary, '')
  assert.equal(parsed.errors.length, 1)
  assert.match(parsed.errors[0], /Free usage limit reached/)
})

test('codex parser returns the last agent message and turn usage', () => {
  const stdout = [
    JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'thinking' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'first' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'final answer' } }),
    JSON.stringify({ type: 'turn.completed', usage: { input_tokens: 100, output_tokens: 42 } }),
  ].join('\n')
  const parsed = parseWorkerOutput('codex', stdout)
  assert.equal(parsed.summary, 'final answer')
  assert.deepEqual(parsed.usage, { inputTokens: 100, outputTokens: 42 })
})

test('claude parser reads the result envelope and degrades to raw text', () => {
  const parsed = parseWorkerOutput('claude', JSON.stringify({ type: 'result', result: 'done', usage: { input_tokens: 7, output_tokens: 9 } }))
  assert.equal(parsed.summary, 'done')
  assert.deepEqual(parsed.usage, { inputTokens: 7, outputTokens: 9 })
  assert.deepEqual(parseWorkerOutput('claude', 'plain text'), {
    summary: 'plain text',
    usage: { inputTokens: 0, outputTokens: 0 },
    errors: [],
  })
})

test('glob patterns cover depth, segments, and single characters', () => {
  assert.ok(globToRegExp('dist/**/*.js').test('dist/a/b/c.js'))
  assert.ok(globToRegExp('dist/**/*.js').test('dist/c.js'))
  assert.ok(!globToRegExp('dist/**/*.js').test('src/c.js'))
  assert.ok(globToRegExp('*.md').test('README.md'))
  assert.ok(!globToRegExp('*.md').test('docs/README.md'))
  assert.ok(globToRegExp('src/?.ts').test('src/a.ts'))
  assert.ok(!globToRegExp('src/?.ts').test('src/ab.ts'))
})

test('artifact collection reports matches, misses, and the limit', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'worker-artifacts-'))
  try {
    await mkdir(join(cwd, 'dist'), { recursive: true })
    await writeFile(join(cwd, 'dist', 'a.js'), 'a')
    await writeFile(join(cwd, 'dist', 'b.js'), 'bb')
    const collected = await collectArtifacts({ cwd, patterns: ['dist/*.js', 'dist/*.css'], limit: 1 })
    assert.equal(collected.artifacts.length, 1)
    assert.equal(collected.artifacts[0].bytes, 1)
    assert.match(collected.artifacts[0].sha256, /^[0-9a-f]{64}$/)
    assert.deepEqual(collected.missing, ['dist/*.css'])
    assert.equal(collected.skipped, 1)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runWorker delivers the task on stdin and collects artifacts', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'worker-run-'))
  try {
    const script = `
      let task = ''
      process.stdin.on('data', (chunk) => { task += chunk })
      process.stdin.on('end', () => {
        require('node:fs').writeFileSync('out.txt', task.trim())
        process.stdout.write(JSON.stringify({ type: 'text', part: { id: 'p', text: 'task=' + task.trim() } }) + '\\n')
        process.stdout.write(JSON.stringify({ type: 'step_finish', part: { tokens: { input: 3, output: 2 } } }) + '\\n')
      })
    `
    const result = await runWorker({ subprocess: stubSubprocess(script) }, stubConfig(), {
      backend: 'opencode',
      task: 'write the file',
      cwd,
      collect: ['*.txt'],
    })
    assert.equal(result.ok, true)
    assert.equal(result.summary, 'task=write the file')
    assert.equal(result.inputTokens, 3)
    assert.equal(result.outputTokens, 2)
    assert.equal(result.artifacts.length, 1)
    assert.equal(result.artifacts[0].path, 'out.txt')
    assert.equal(result.artifacts[0].bytes, 'write the file'.length)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runWorker reports a timeout as a terminated call', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'worker-timeout-'))
  try {
    const result = await runWorker({ subprocess: stubSubprocess('setTimeout(() => {}, 60000)') }, stubConfig({ workerTimeoutMs: 100 }), {
      backend: 'codex',
      task: 'never finishes',
      cwd,
    })
    assert.equal(result.ok, false)
    assert.equal(result.timedOut, true)
    assert.equal(result.exitCode, -1)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('runWorker rejects a relative cwd before spawning', async () => {
  await assert.rejects(
    runWorker({ subprocess: stubSubprocess('') }, stubConfig(), { backend: 'claude', task: 'x', cwd: 'relative/path' }),
    /requires an absolute "cwd"/,
  )
})

test('tool schema and parameters stay in sync with the backend list', () => {
  const config = stubConfig({ workerBackend: 'opencode' })
  const parameters = workerParameters(config)
  assert.deepEqual(parameters.backend.enum, [...WORKER_BACKENDS])
  assert.equal(parameters.task.required, true)
  const schema = workerOutputSchema()
  assert.equal(schema.additionalProperties, false)
  assert.equal(schema.properties.artifacts.items.additionalProperties, false)
  assert.equal(schema.properties.ok.required, true)
})

test('renderers surface failures, artifacts, and missing globs', () => {
  const text = renderWorkerResult({
    ok: false,
    backend: 'codex',
    exitCode: 2,
    timedOut: false,
    truncated: false,
    summary: '',
    artifacts: [{ path: 'a.txt', bytes: 3, sha256: 'f'.repeat(64) }],
    missing: ['*.css'],
    skipped: 0,
    inputTokens: 1,
    outputTokens: 2,
    stderrTail: 'boom',
  })
  assert.match(text, /codex worker exited with code 2/)
  assert.match(text, /a\.txt \(3 B/)
  assert.match(text, /no match for: \*\.css/)
  assert.match(text, /boom/)
})

test('codex accepts a sandbox mode and a reasoning effort', () => {
  assert.deepEqual(
    buildWorkerArgv('codex', { executable: '/bin/codex', model: 'gpt-5-codex', effort: 'high', mode: 'workspace-write' }),
    [
      '/bin/codex',
      'exec',
      '--json',
      '--skip-git-repo-check',
      '--model',
      'gpt-5-codex',
      '--sandbox',
      'workspace-write',
      '-c',
      'model_reasoning_effort=high',
      '-',
    ],
  )
})

test('claude accepts a permission mode and rejects an unknown one', () => {
  assert.deepEqual(buildWorkerArgv('claude', { executable: '/bin/claude', mode: 'plan' }), [
    '/bin/claude',
    '-p',
    '--output-format',
    'json',
    '--permission-mode',
    'plan',
  ])
  assert.throws(
    () => buildWorkerArgv('claude', { executable: '/bin/claude', mode: 'nope' }),
    /permission mode/,
  )
})

test('a run reports elapsed time, prompt bytes and the stdin transport', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'worker-facts-'))
  try {
    const script = `
      let task = ''
      process.stdin.on('data', (chunk) => { task += chunk })
      process.stdin.on('end', () => {
        process.stdout.write(JSON.stringify({ type: 'text', part: { id: 'p', text: 'ok' } }) + '\\n')
      })
    `
    const result = await runWorker({ subprocess: stubSubprocess(script) }, stubConfig(), {
      backend: 'opencode',
      task: 'port the facts',
      cwd,
    })
    assert.equal(result.promptTransport, 'stdin')
    assert.equal(result.promptBytes, Buffer.byteLength('port the facts'))
    assert.ok(result.elapsedMs >= 0)
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})

test('a disabled backend never spawns and reports the gate', async () => {
  const spawned = []
  const subprocess = {
    async resolveExecutable() { return process.execPath },
    spawn(spec) { spawned.push(spec); throw new Error('must not spawn') },
  }
  const result = await runWorker({ subprocess }, stubConfig({ workerDisabledBackends: ['opencode'] }), {
    backend: 'opencode',
    task: 'x',
    cwd: '/tmp',
  })
  assert.equal(result.errorKind, 'disabled')
  assert.equal(result.ok, false)
  assert.match(result.diagnostic, /workerDisabledBackends/)
  assert.equal(spawned.length, 0)
})

test('a backend served by a mounted provider yields instead of spawning', async () => {
  const spawned = []
  const subprocess = {
    async resolveExecutable() { return process.execPath },
    spawn(spec) { spawned.push(spec); throw new Error('must not spawn') },
  }
  const subagents = { getProvider: (name) => (name === 'opencode' ? { name } : undefined) }
  const result = await runWorker({ subprocess, subagents }, stubConfig({ yieldToProviders: { opencode: 'opencode' } }), {
    backend: 'opencode',
    task: 'x',
    cwd: '/tmp',
  })
  assert.equal(result.errorKind, 'provider-mounted')
  assert.equal(result.yieldedProvider, 'opencode')
  assert.equal(spawned.length, 0)
})

test('per-backend path, model, effort and mode reach the child', async () => {
  const cwd = await mkdtemp(join(tmpdir(), 'worker-backend-config-'))
  try {
    const spawned = []
    const subprocess = {
      async resolveExecutable(name) { spawned.push({ resolved: name }); return process.execPath },
      spawn(spec) {
        spawned.push(spec)
        return {
          done: Promise.resolve({ exitCode: 0, signal: null }),
          collected: {
            stdout: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
            stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) },
          },
        }
      },
    }
    await runWorker({ subprocess }, stubConfig({
      workerBackendPaths: { codex: '/opt/codex' },
      workerBackendModels: { codex: 'gpt-5-codex' },
      workerBackendEfforts: { codex: 'high' },
      workerBackendModes: { codex: 'read-only' },
    }), { backend: 'codex', task: 'x', cwd })
    assert.equal(spawned[0].resolved, '/opt/codex')
    const argv = spawned[1].argv
    assert.ok(argv.includes('gpt-5-codex'))
    assert.ok(argv.includes('read-only'))
    assert.ok(argv.includes('model_reasoning_effort=high'))
  } finally {
    await rm(cwd, { recursive: true, force: true })
  }
})
