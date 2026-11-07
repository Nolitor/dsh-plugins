import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { collectArtifacts, globToRegExp, resolveArtifactDir } from '../lib/artifacts.js'
import {
  BackendResolutionError,
  emptyResult,
  resolveBackend,
  runLocalWorker,
} from '../lib/worker.js'

/**
 * Config shaped like the schema output, with the fields these tests read.
 * @param {object} [overrides] - top-level overrides.
 * @returns {object} config object.
 */
function makeConfig(overrides = {}) {
  return {
    enabled: true,
    toolName: 'delegate_local',
    backend: 'auto',
    autoOrder: ['antigravity', 'opencode', 'codex', 'claude'],
    timeoutMs: 600000,
    maxOutputBytes: 65536,
    artifactLimit: 100,
    artifactDir: '',
    disposeGraceMs: 50,
    locale: 'en',
    forwardEnv: ['PATH'],
    yieldToProviders: {},
    yieldToMountedTool: true,
    backends: {
      antigravity: { enabled: true, path: 'agy', model: 'gemini-3.8-flash-low', effort: 'low', mode: 'accept-edits', timeoutMs: 0, auto: true, extraArgs: [] },
      opencode: { enabled: true, path: 'opencode', model: '', effort: '', mode: '', timeoutMs: 0, auto: true, extraArgs: [] },
      codex: { enabled: true, path: 'codex', model: '', effort: '', mode: '', timeoutMs: 0, auto: true, extraArgs: [] },
      claude: { enabled: true, path: 'claude', model: '', effort: '', mode: '', timeoutMs: 0, auto: true, extraArgs: [] },
    },
    ...overrides,
  }
}

/**
 * A fake subprocess service that records spawn specs.
 * @param {object} options - fake behaviour.
 * @returns {object} fake service and call recorder.
 */
function fakeSubprocess(options = {}) {
  const spawns = []
  const resolvable = options.resolvable ?? new Set(['agy', 'opencode'])
  const stdout = options.stdout ?? ''
  const stderr = options.stderr ?? ''
  const service = {
    async resolveExecutable(command) {
      if (!resolvable.has(command)) throw new Error(`"${command}" was not found in PATH`)
      return `/fake/bin/${command}`
    },
    spawn(spec) {
      spawns.push(spec)
      let written = ''
      let settle
      const done = new Promise((resolve) => {
        settle = resolve
      })
      if (options.neverSettles) {
        spec.signal?.addEventListener('abort', () => settle({ exitCode: null, signal: 'SIGTERM' }))
      } else {
        settle({ exitCode: options.exitCode ?? 0, signal: options.signal ?? null })
      }
      return {
        stdin: {
          on() {},
          end(text) {
            written += text
          },
          get written() {
            return written
          },
        },
        collected: {
          stdout: { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: options.lossy ?? false }) },
          stderr: { readFrom: () => ({ text: stderr, nextOffset: stderr.length, lossy: false }) },
        },
        done,
        terminate() {},
      }
    },
  }
  return { service, spawns }
}

const SIGNAL = new AbortController().signal

test('resolveBackend: explicit backend names its executable', async () => {
  const { service } = fakeSubprocess()
  const resolved = await resolveBackend({ ctx: { subprocess: service }, config: makeConfig(), requested: 'antigravity', cwd: '/tmp', signal: SIGNAL })
  assert.deepEqual(resolved, { backend: 'antigravity', executable: '/fake/bin/agy', requested: 'antigravity' })
})

test('resolveBackend: an explicit missing backend lists the measured miss', async () => {
  const { service } = fakeSubprocess({ resolvable: new Set(['agy']) })
  await assert.rejects(
    () => resolveBackend({ ctx: { subprocess: service }, config: makeConfig(), requested: 'claude', cwd: '/tmp', signal: SIGNAL }),
    (error) => {
      assert.ok(error instanceof BackendResolutionError)
      assert.match(error.message, /claude \("claude"\): .*not found/)
      assert.equal(error.attempts.length, 1)
      return true
    },
  )
})

test('resolveBackend: auto picks the first resolvable backend in the configured order', async () => {
  const { service } = fakeSubprocess({ resolvable: new Set(['codex']) })
  const resolved = await resolveBackend({ ctx: { subprocess: service }, config: makeConfig(), requested: 'auto', cwd: '/tmp', signal: SIGNAL })
  assert.equal(resolved.backend, 'codex')
  assert.equal(resolved.executable, '/fake/bin/codex')
})

test('resolveBackend: a disabled backend is skipped by auto', async () => {
  const config = makeConfig()
  config.backends.antigravity.enabled = false
  const { service } = fakeSubprocess({ resolvable: new Set(['opencode']) })
  const resolved = await resolveBackend({ ctx: { subprocess: service }, config, requested: 'auto', cwd: '/tmp', signal: SIGNAL })
  assert.equal(resolved.backend, 'opencode')
})

test('resolveBackend: unknown explicit backend is a RangeError', async () => {
  const { service } = fakeSubprocess()
  await assert.rejects(
    () => resolveBackend({ ctx: { subprocess: service }, config: makeConfig(), requested: 'gemini', cwd: '/tmp', signal: SIGNAL }),
    RangeError,
  )
})

test('runLocalWorker: stdin backends spawn with a pipe and deliver the task there', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-local-'))
  try {
    const { service, spawns } = fakeSubprocess({
      stdout: JSON.stringify({ type: 'text', part: { id: 'p', text: 'answer' } }),
    })
    const result = await runLocalWorker({
      ctx: { subprocess: service },
      config: makeConfig(),
      task: 'SECRET TASK',
      cwd: workspace,
      backend: 'opencode',
      signal: SIGNAL,
    })
    assert.equal(result.ok, true)
    assert.equal(result.backend, 'opencode')
    assert.equal(result.summary, 'answer')
    assert.equal(spawns.length, 1)
    const spec = spawns[0]
    assert.equal(spec.signal instanceof AbortSignal, true)
    assert.equal(spec.stdio.stdin, 'pipe')
    assert.equal(spec.stdio.stdout.maxBytes, 65536)
    assert.equal(spec.argv.some((argument) => argument.includes('SECRET TASK')), false)
    assert.equal(result.promptTransport, 'stdin')
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('runLocalWorker: argv backends spawn with ignored stdin and carry the task in argv', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-local-'))
  try {
    const { service, spawns } = fakeSubprocess({
      stdout: JSON.stringify({ status: 'SUCCESS', response: 'agy answer', usage: { input_tokens: 3 } }),
    })
    const result = await runLocalWorker({
      ctx: { subprocess: service },
      config: makeConfig(),
      task: 'SECRET TASK',
      cwd: workspace,
      backend: 'antigravity',
      signal: SIGNAL,
    })
    assert.equal(result.ok, true)
    assert.equal(result.promptTransport, 'argv')
    assert.equal(result.summary, 'agy answer')
    assert.equal(spawns[0].stdio.stdin, 'ignore')
    assert.equal(spawns[0].argv.includes('SECRET TASK'), true)
    assert.equal(result.usage.inputTokens, 3)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('runLocalWorker: a deadline reports timedOut and never claims success', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-local-'))
  try {
    const { service } = fakeSubprocess({ neverSettles: true })
    const result = await runLocalWorker({
      ctx: { subprocess: service },
      config: makeConfig({ timeoutMs: 25 }),
      task: 'slow task',
      cwd: workspace,
      backend: 'opencode',
      signal: SIGNAL,
    })
    assert.equal(result.timedOut, true)
    assert.equal(result.ok, false)
    assert.match(result.diagnostic, /timed out after 25 ms/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('runLocalWorker: bounded output marks truncation from a lossy reader', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-local-'))
  try {
    const { service } = fakeSubprocess({ stdout: 'tail only', lossy: true, resolvable: new Set(['claude']) })
    const result = await runLocalWorker({
      ctx: { subprocess: service },
      config: makeConfig(),
      task: 'task',
      cwd: workspace,
      backend: 'claude',
      signal: SIGNAL,
    })
    assert.equal(result.truncated, true)
    assert.equal(result.ok, true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('runLocalWorker: a relative cwd is refused before spawning', async () => {
  const { service, spawns } = fakeSubprocess()
  const result = await runLocalWorker({
    ctx: { subprocess: service },
    config: makeConfig(),
    task: 'task',
    cwd: 'relative/path',
    backend: 'opencode',
    signal: SIGNAL,
  })
  assert.equal(result.ok, false)
  assert.match(result.diagnostic, /absolute cwd/)
  assert.equal(spawns.length, 0)
})

test('runLocalWorker: a spawn failure becomes a diagnostic result, not a throw', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-local-'))
  try {
    const service = {
      async resolveExecutable() {
        return '/fake/bin/opencode'
      },
      spawn() {
        throw new Error('execve E2BIG')
      },
    }
    const result = await runLocalWorker({
      ctx: { subprocess: service },
      config: makeConfig(),
      task: 'task',
      cwd: workspace,
      backend: 'opencode',
      signal: SIGNAL,
    })
    assert.equal(result.ok, false)
    assert.match(result.diagnostic, /failed to start opencode: execve E2BIG/)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('artifactDir: a configured relative directory receives bounded run files', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-local-'))
  try {
    const { service } = fakeSubprocess({
      stdout: JSON.stringify({ status: 'SUCCESS', response: 'done' }),
      stderr: 'noise',
    })
    const result = await runLocalWorker({
      ctx: { subprocess: service },
      config: makeConfig({ artifactDir: 'delegate-artifacts' }),
      task: 'task',
      cwd: workspace,
      backend: 'antigravity',
      signal: SIGNAL,
    })
    assert.ok(result.artifactDir.startsWith(join(workspace, 'delegate-artifacts')))
    assert.equal(await readFile(join(result.artifactDir, 'stdout.txt'), 'utf8'), JSON.stringify({ status: 'SUCCESS', response: 'done' }))
    assert.equal(await readFile(join(result.artifactDir, 'stderr.txt'), 'utf8'), 'noise')
    const persisted = JSON.parse(await readFile(join(result.artifactDir, 'result.json'), 'utf8'))
    assert.equal(persisted.ok, true)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('artifactDir: an escaping path is rejected', () => {
  assert.equal(resolveArtifactDir('/work', ''), null)
  assert.equal(resolveArtifactDir('/work', 'run'), '/work/run')
  assert.throws(() => resolveArtifactDir('/work', '../outside'), RangeError)
  assert.throws(() => resolveArtifactDir('/work', '/etc'), RangeError)
})

test('collectArtifacts: matches are hashed and gaps are reported', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-local-'))
  try {
    await mkdir(join(workspace, 'dist/a'), { recursive: true })
    await writeFile(join(workspace, 'dist/a/app.js'), 'console.log(1)\n')
    await writeFile(join(workspace, 'README.md'), '# hi\n')
    const collected = await collectArtifacts(workspace, ['dist/**/*.js', '*.md', 'none/*.map'], 10)
    assert.deepEqual(collected.artifacts.map((file) => file.path).sort(), ['README.md', 'dist/a/app.js'])
    assert.equal(collected.artifacts[0].sha256.length, 64)
    assert.deepEqual(collected.missing, ['none/*.map'])
    assert.equal(collected.skipped, 0)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('collectArtifacts: the limit is counted as skipped, never silently dropped', async () => {
  const workspace = await mkdtemp(join(tmpdir(), 'dsh-local-'))
  try {
    for (const name of ['a.js', 'b.js', 'c.js']) await writeFile(join(workspace, name), 'x')
    const collected = await collectArtifacts(workspace, ['*.js'], 2)
    assert.equal(collected.artifacts.length, 2)
    assert.equal(collected.skipped, 1)
  } finally {
    await rm(workspace, { recursive: true, force: true })
  }
})

test('globToRegExp: recursive, single-segment and literal patterns match as documented', () => {
  assert.ok(globToRegExp('dist/**/*.js').test('dist/a/b/c.js'))
  assert.ok(globToRegExp('dist/**/*.js').test('dist/c.js'))
  assert.ok(globToRegExp('*.md').test('README.md'))
  assert.equal(globToRegExp('*.md').test('docs/README.md'), false)
  assert.ok(globToRegExp('a+b.txt').test('a+b.txt'))
})

test('emptyResult carries every canonical field', () => {
  const result = emptyResult('codex')
  assert.equal(result.ok, false)
  assert.equal(result.backend, 'codex')
  assert.equal(result.promptTransport, 'stdin')
  assert.deepEqual(Object.keys(result.usage).sort(), ['cacheReadTokens', 'inputTokens', 'outputTokens', 'thinkingTokens'])
  for (const key of ['artifacts', 'missing']) assert.ok(Array.isArray(result[key]))
})
