/**
 * Unit tests for the host-facing halves (lib/index.js, lib/provider.js).
 * The subprocess seam is faked; no child process, network, or ~/.dsh access.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { register } from 'node:module'
import { spawnSync } from 'node:child_process'

/**
 * The host supplies `@deepseek-ai/dsh-tools` (and schemastery). Map it onto the
 * installed profile copy if the plugin checkout has no node_modules of its own;
 * this is read-only resolution, not an install.
 */
const DSH_TOOLS_STUB = new URL('./helpers/dsh-tools-stub.mjs', import.meta.url).href
try {
  await import('@deepseek-ai/dsh-tools')
} catch {
  register(
    'data:text/javascript,' +
      encodeURIComponent(
        `export async function resolve(spec, context, next) {
           if (spec === '@deepseek-ai/dsh-tools') return { url: ${JSON.stringify(DSH_TOOLS_STUB)}, shortCircuit: true }
           return next(spec, context)
         }`,
      ),
    import.meta.url,
  )
}

import * as tool from '../lib/index.js'
import * as provider from '../lib/provider.js'
import { DEFAULT_MODEL } from '../lib/index.js'
import { buildRunArgv } from '../lib/shared.js'

// ---------------------------------------------------------------------------
// Fake config: schemastery Volatiles are just .get() readers over a fixed map.
// ---------------------------------------------------------------------------
function fakeConfig(values) {
  const cache = new Map()
  return new Proxy(
    {},
    {
      get(_t, key) {
        if (!cache.has(key)) {
          const value = values[key]
          cache.set(key, { get: () => (Array.isArray(value) ? [...value] : value) })
        }
        return cache.get(key)
      },
    },
  )
}

/** Fake ctx.subprocess that records spawns and replays scripted children. */
function fakeCtx(script = []) {
  const calls = []
  let next = 0
  const ctx = {
    calls,
    subprocess: {
      async resolveExecutable(name) {
        return `/fake/bin/${name}`
      },
      spawn(request) {
        const entry = script[next++] ?? { exitCode: 0, stdout: '', stderr: '' }
        const record = { argv: [...request.argv], cwd: request.cwd, env: { ...request.env }, stdin: entry.stdin ?? null }
        calls.push(record)
        const collected = {
          stdout: { readFrom: () => ({ text: entry.stdout ?? '', lossy: false }) },
          stderr: { readFrom: () => ({ text: entry.stderr ?? '', lossy: false }) },
        }
        const chunks = entry.stdoutChunks ?? (entry.stdout ? [entry.stdout] : [])
        const done = Promise.resolve({ exitCode: entry.exitCode ?? 0, signal: entry.signal ?? null })
        return {
          argv: request.argv,
          collected,
          done,
          stdin: request.stdio?.stdin === 'pipe'
            ? { end: (text) => { record.stdin = String(text) }, on: () => {} }
            : undefined,
          stdout: (async function* () {
            for (const chunk of chunks) yield new TextEncoder().encode(chunk)
            await done
          })(),
          terminate() {},
          waitForExit: async () => true,
        }
      },
    },
  }
  return ctx
}

const jsonl = (events) => events.map((e) => JSON.stringify(e) + '\n').join('')

const RUN_STREAM = jsonl([
  { type: 'step_start', sessionID: 'ses_run', part: { id: 'prt_s', type: 'step-start' } },
  { type: 'reasoning', sessionID: 'ses_run', part: { id: 'prt_r', type: 'reasoning', text: 'Think.' } },
  { type: 'text', sessionID: 'ses_run', part: { id: 'prt_t', type: 'text', text: 'Hello' } },
  { type: 'text', sessionID: 'ses_run', part: { id: 'prt_t', type: 'text', text: 'Hello world' } },
])

const EXPORTED = JSON.stringify({
  info: { tokens: { input: 1005, output: 4, reasoning: 9, cache: { read: 4096, write: 0 } } },
})

// ---------------------------------------------------------------------------
// Config / schema surface
// ---------------------------------------------------------------------------

test('tool and provider export the row-id plugin names', () => {
  assert.equal(tool.name, 'dsh-opencode-v2')
  assert.equal(provider.name, 'dsh-opencode-v2-provider')
  assert.deepEqual(tool.inject, ['tools', 'subprocess'])
  assert.deepEqual(provider.inject, ['llm', 'subprocess'])
})

test('default model is an opencode/... route, never bare', () => {
  assert.equal(DEFAULT_MODEL, 'opencode/deepseek-v4.1-flash-free')
  assert.match(DEFAULT_MODEL, /^opencode\//)
})

test('legacy attach/pure config keys still validate (old profile rows keep loading)', () => {
  const parsed = tool.Config({ attach: 'http://x:4096', pure: true, model: DEFAULT_MODEL })
  // schemastery wraps each field in a Volatile accessor.
  assert.equal(parsed.attach.get(), 'http://x:4096')
  assert.equal(parsed.pure.get(), true)
  const parsedProvider = provider.Config({ attach: 'http://y', pure: true })
  assert.equal(parsedProvider.attach.get(), 'http://y')
  assert.equal(parsedProvider.pure.get(), true)
})

test('tool config defaults: thinking on, auto on, opencode model route, full forwardEnv', () => {
  const parsed = tool.Config({})
  assert.equal(parsed.thinking.get(), true)
  assert.equal(parsed.auto.get(), true)
  assert.equal(parsed.model.get(), DEFAULT_MODEL)
  for (const key of ['PATH', 'HOME', 'USER', 'XDG_CONFIG_HOME', 'XDG_DATA_HOME', 'XDG_CACHE_HOME', 'OPENCODE_CONFIG', 'OPENCODE_SERVER_USERNAME', 'OPENCODE_SERVER_PASSWORD']) {
    assert.ok(parsed.forwardEnv.get().includes(key), `forwardEnv must include ${key}`)
  }
})

test('provider config defaults keep upstream keys plus exportTimeoutMs', () => {
  const parsed = provider.Config({})
  assert.equal(parsed.exportTimeoutMs.get(), 60000)
  assert.equal(parsed.localSessionTitles.get(), true)
  assert.equal(parsed.autoDiscoverModels.get(), true)
  assert.deepEqual(parsed.models.get(), [{ id: 'default', opencodeModel: '', name: 'OpenCode (config default)' }])
})

// ---------------------------------------------------------------------------
// Tool: argv built from CONFIG (the path that must never leak attach/pure)
// ---------------------------------------------------------------------------

/**
 * Reproduce the exact spawn the tool hands to the subprocess, from a config.
 * Calls runOpencode through the real code path with a fake seam.
 * Returns `{ argv, stdin }` — the prompt must arrive on stdin, never argv.
 */
async function toolSpawn(configValues, options = {}) {
  const config = fakeConfig({
    opencodePath: 'opencode',
    auto: true,
    model: DEFAULT_MODEL,
    agent: '',
    attach: '',
    pure: false,
    thinking: true,
    title: '',
    timeoutMs: 600000,
    maxOutputBytes: 1048576,
    forwardEnv: ['PATH'],
    extraArgs: [],
    exportTimeoutMs: 60000,
    ...configValues,
  })
  const ctx = fakeCtx([{ exitCode: 0, stdout: RUN_STREAM }, { exitCode: 0, stdout: EXPORTED }])
  await tool.runOpencode(ctx, config, { prompt: 'hi', cwd: '/tmp', ...options })
  return ctx.calls[0]
}

test('tool argv ignores an attach/pure config and emits neither flag', async () => {
  const { argv } = await toolSpawn({ attach: 'http://127.0.0.1:4096', pure: true })
  assert.ok(!argv.includes('--attach'), 'no --attach')
  assert.ok(!argv.includes('--pure'), 'no --pure')
  assert.ok(!argv.includes('http://127.0.0.1:4096'), 'attach value must not leak as a bare arg')
  assert.deepEqual(argv, ['/fake/bin/opencode', ...buildRunArgv({ model: DEFAULT_MODEL, auto: true, thinking: true, format: 'json' })])
})

test('tool argv strips attach/pure that a user smuggled into extraArgs', async () => {
  const { argv } = await toolSpawn({ extraArgs: ['--attach', 'http://x', '--pure', '--log-level', 'warn'] })
  assert.ok(!argv.includes('--attach'))
  assert.ok(!argv.includes('--pure'))
  assert.ok(argv.includes('warn'))
})

test('tool argv carries thinking/title/files/model overrides', async () => {
  const { argv } = await toolSpawn({}, { model: 'opencode/other', title: 'T', files: ['/a', '/b'], thinking: false })
  assert.ok(argv.includes('-m') && argv.includes('opencode/other'))
  assert.ok(argv.includes('--title') && argv.includes('T'))
  assert.equal(argv.filter((a) => a === '-f').length, 2)
  assert.ok(!argv.includes('--thinking'))
  // The prompt is on stdin, so no `--` marker and no message token in argv.
  assert.ok(!argv.includes('--'))
  assert.ok(!argv.includes('hi'))
})

test('tool delivers the prompt on stdin (spawn E2BIG regression)', async () => {
  const { argv, stdin } = await toolSpawn()
  assert.equal(stdin, 'hi')
  assert.ok(!argv.includes('hi'), 'prompt must never be an argv element')
})

// ---------------------------------------------------------------------------
// Tool: result shape + usage over-fetch
// ---------------------------------------------------------------------------

async function runTool(configValues, script) {
  const config = fakeConfig({
    opencodePath: 'opencode', auto: true, model: DEFAULT_MODEL, agent: '', attach: '', pure: false,
    thinking: true, title: '', timeoutMs: 600000, maxOutputBytes: 1048576, forwardEnv: ['PATH'],
    extraArgs: [], exportTimeoutMs: 60000, ...configValues,
  })
  const ctx = fakeCtx(script)
  const result = await tool.runOpencode(ctx, config, { prompt: 'hi', cwd: '/tmp' })
  return { result, ctx }
}

test('runOpencode returns exactly the schema key set (additionalProperties:false)', async () => {
  const { result } = await runTool({}, [{ exitCode: 0, stdout: RUN_STREAM }, { exitCode: 0, stdout: EXPORTED }])
  const allowed = new Set(['ok', 'exitCode', 'signal', 'timedOut', 'truncated', 'sessionId', 'inputTokens', 'outputTokens', 'stdout', 'stderr'])
  for (const key of Object.keys(result)) {
    if (key === 'usage') continue // internal; toOutput() strips it
    assert.ok(allowed.has(key), `unexpected result key ${key}`)
  }
  const canonical = tool.toOutput(result)
  assert.deepEqual(Object.keys(canonical).sort(), [...allowed].sort())
  assert.equal(tool.outputSchema().additionalProperties, false)
})

test('tool tokens come from session export, not from the run stream', async () => {
  const { result, ctx } = await runTool({}, [{ exitCode: 0, stdout: RUN_STREAM }, { exitCode: 0, stdout: EXPORTED }])
  assert.equal(ctx.calls.length, 2)
  assert.deepEqual(ctx.calls[1].argv, ['/fake/bin/opencode', 'session', 'export', 'ses_run'])
  assert.equal(result.inputTokens, 1005)
  assert.equal(result.outputTokens, 4)
  assert.equal(result.usage.reasoningTokens, 9)
  assert.equal(result.usage.cacheReadTokens, 4096)
  assert.equal(result.usage.totalTokens, 5114)
  assert.equal(result.stdout, 'Hello world')
  assert.equal(result.sessionId, 'ses_run')
  assert.equal(result.ok, true)
})

test('tool keeps the assembled reasoning out of the final text but parses it', async () => {
  const { result } = await runTool({}, [{ exitCode: 0, stdout: RUN_STREAM }, { exitCode: 0, stdout: EXPORTED }])
  assert.equal(result.stdout, 'Hello world')
  assert.ok(!result.stdout.includes('Think.'))
})

test('tool still succeeds when session export fails, reporting 0 tokens instead of guessing', async () => {
  const { result } = await runTool({}, [{ exitCode: 0, stdout: RUN_STREAM }, { exitCode: 1, stdout: '' }])
  assert.equal(result.ok, true)
  assert.equal(result.inputTokens, 0)
  assert.equal(result.outputTokens, 0)
  assert.equal(result.usage, null)
})

test('tool marks a non-zero exit as not ok and surfaces event errors', async () => {
  const stream = jsonl([
    { type: 'step_start', sessionID: 's', part: { id: 'p', type: 'step-start' } },
    { type: 'error', error: { message: 'provider.no-route' } },
  ])
  const { result } = await runTool({ exportTimeoutMs: 0 }, [{ exitCode: 1, stdout: stream, stderr: 'boom' }])
  assert.equal(result.ok, false)
  assert.equal(result.exitCode, 1)
  assert.match(result.stderr, /provider\.no-route/)
  assert.match(result.stderr, /boom/)
})

test('tool flags timeout without crashing', async () => {
  const config = fakeConfig({
    opencodePath: 'opencode', auto: true, model: DEFAULT_MODEL, agent: '', attach: '', pure: false,
    thinking: true, title: '', timeoutMs: 1, maxOutputBytes: 1048576, forwardEnv: [],
    extraArgs: [], exportTimeoutMs: 0,
  })
  // A child that never resolves within timeoutMs.
  const ctx = {
    subprocess: {
      async resolveExecutable(n) { return `/fake/${n}` },
      spawn() {
        const done = new Promise((resolve) => setTimeout(() => resolve({ exitCode: 0, signal: null }), 30))
        return {
          collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } },
          done, terminate() {}, waitForExit: async () => true,
        }
      },
    },
  }
  const result = await tool.runOpencode(ctx, config, { prompt: 'x', cwd: '/tmp' })
  assert.equal(result.timedOut, true)
  assert.equal(result.ok, false)
})

test('renderResult prints a usage line and the session continuation hint', () => {
  const text = tool.renderResult({
    ok: true, exitCode: 0, signal: '', timedOut: false, truncated: false,
    sessionId: 'ses_abc', inputTokens: 1005, outputTokens: 4, stdout: 'answer', stderr: '',
    usage: { inputTokens: 1005, outputTokens: 4, reasoningTokens: 9, cacheReadTokens: 4096, cacheWriteTokens: 0, totalTokens: 5114 },
  })
  assert.match(text, /opencode finished successfully\./)
  assert.match(text, /\[session: ses_abc — pass as "session" to continue\]/)
  assert.match(text, /usage: input 1005 output 4 reasoning 9 cache read 4096 cache write 0 total 5114/)
  assert.match(text, /answer/)
})

test('renderResult omits the usage line when usage is unknown', () => {
  const text = tool.renderResult({ ok: false, exitCode: 2, signal: '', timedOut: false, truncated: true, sessionId: '', stdout: 'x', stderr: 'e' })
  assert.doesNotMatch(text, /usage:/)
  assert.match(text, /exited with code 2/)
  assert.match(text, /output truncated/)
})

// ---------------------------------------------------------------------------
// Provider: streaming chunks
// ---------------------------------------------------------------------------

test('eventsToChunks puts reasoning on its own index and never reuses text index 0', () => {
  const chunks = provider.eventsToFullChunks([
    { kind: 'reasoning', partId: 'r', delta: 'Why' },
    { kind: 'reasoning', partId: 'r', delta: ' not' },
    { kind: 'text', partId: 't', delta: 'Ans' },
    { kind: 'text', partId: 't', delta: 'wer' },
  ])
  const reasoning = chunks.filter((c) => c.type === 'reasoning-delta')
  const text = chunks.filter((c) => c.type === 'text-delta')
  assert.deepEqual(reasoning.map((c) => c.index), [provider.REASONING_INDEX, provider.REASONING_INDEX])
  assert.deepEqual(text.map((c) => c.index), [0, 0])
  assert.notEqual(provider.REASONING_INDEX, 0)
  assert.deepEqual(
    chunks.filter((c) => c.type === 'block-end').map((c) => [c.index, c.block.type, c.block.text]),
    [[provider.REASONING_INDEX, 'reasoning', 'Why not'], [0, 'text', 'Answer']],
  )
})

async function collect(iterable) {
  const out = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

function makeAdapter(script, overrides = {}) {
  const config = fakeConfig({
    opencodePath: 'opencode', auto: true, attach: '', pure: false, thinking: true, cwd: '/tmp',
    timeoutMs: 1800000, stderrMaxBytes: 65536, forwardEnv: ['PATH'], extraArgs: [],
    models: [{ id: 'default', opencodeModel: '', name: 'OpenCode (config default)' }],
    brief: 'BRIEF', localSessionTitles: false, autoDiscoverModels: false,
    discoveryTimeoutMs: 60000, discoveryCacheMs: 300000, exportTimeoutMs: 60000, ...overrides,
  })
  const ctx = fakeCtx(script)
  return { adapter: new provider.OpencodeLlmAdapter(ctx, config), ctx }
}

const OPTIONS = { provider: 'opencode-agent', model: 'default', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }] }

test('provider stream: true streaming with reasoning on a distinct index, usage, then finish', async () => {
  const { adapter } = makeAdapter([
    { exitCode: 0, stdoutChunks: [RUN_STREAM.slice(0, 100), RUN_STREAM.slice(100)] },
    { exitCode: 0, stdout: EXPORTED },
  ])
  const chunks = await collect(adapter.stream(OPTIONS))
  const types = chunks.map((c) => c.type)
  assert.equal(types.at(-1), 'finish')
  assert.deepEqual(chunks.at(-1).reason, { kind: 'stop' })
  assert.ok(types.includes('usage'))
  assert.ok(types.includes('reasoning-delta'))
  // exactly one block-start per index, and both indices are closed before usage
  const starts = chunks.filter((c) => c.type === 'block-start')
  assert.deepEqual(starts.map((c) => [c.index, c.blockType]).sort(), [[0, 'text'], [1, 'reasoning']].sort())
  const ends = chunks.filter((c) => c.type === 'block-end')
  assert.deepEqual(ends.map((c) => c.index).sort(), [0, 1])
  const usageAt = types.indexOf('usage')
  assert.ok(ends.every((end) => chunks.indexOf(end) < usageAt), 'blocks close before usage')
  const usage = chunks.find((c) => c.type === 'usage').usage
  assert.deepEqual(usage, {
    inputTokens: 1005, outputTokens: 4, reasoningTokens: 9,
    cacheReadTokens: 4096, cacheWriteTokens: 0, totalTokens: 5114,
  })
})

test('provider stream: deltas are split across chunks but assembled exactly once', async () => {
  const { adapter } = makeAdapter([
    { exitCode: 0, stdoutChunks: [RUN_STREAM.slice(0, 90), RUN_STREAM.slice(90, 180), RUN_STREAM.slice(180)] },
    { exitCode: 0, stdout: EXPORTED },
  ])
  const chunks = await collect(adapter.stream(OPTIONS))
  assert.equal(chunks.filter((c) => c.type === 'text-delta').map((c) => c.text).join(''), 'Hello world')
  assert.equal(chunks.filter((c) => c.type === 'reasoning-delta').map((c) => c.text).join(''), 'Think.')
  assert.equal(chunks.filter((c) => c.type === 'block-start').length, 2)
  assert.equal(chunks.filter((c) => c.type === 'block-end').length, 2)
})

test('provider stream omits usage entirely when session export fails', async () => {
  const { adapter } = makeAdapter([
    { exitCode: 0, stdout: RUN_STREAM },
    { exitCode: 1, stdout: '' },
  ])
  const chunks = await collect(adapter.stream(OPTIONS))
  assert.ok(!chunks.some((c) => c.type === 'usage'), 'no fabricated usage')
  assert.deepEqual(chunks.at(-1).reason, { kind: 'stop' })
})

test('provider stream maps a non-zero exit to OPENCODE_EXIT with the stderr tail', async () => {
  const { adapter } = makeAdapter([{ exitCode: 3, stdout: '', stderr: 'Unrecognized flag --attach' }], { exportTimeoutMs: 0 })
  const chunks = await collect(adapter.stream(OPTIONS))
  const finish = chunks.at(-1)
  assert.equal(finish.type, 'finish')
  assert.equal(finish.reason.kind, 'error')
  assert.equal(finish.reason.failure.code, 'OPENCODE_EXIT')
  assert.match(finish.reason.failure.message, /Unrecognized flag --attach/)
})

test('provider stream maps a timeout to OPENCODE_TIMEOUT', async () => {
  // A child that outlives the (1 ms) budget: `done` resolves well after the
  // AbortSignal.timeout() fires.
  const ctx = {
    subprocess: {
      async resolveExecutable(n) {
        return `/fake/${n}`
      },
      spawn() {
        return {
          collected: { stdout: { readFrom: () => ({ text: '' }) }, stderr: { readFrom: () => ({ text: '' }) } },
          done: new Promise((resolve) => setTimeout(() => resolve({ exitCode: 0, signal: null }), 40)),
          stdin: { on() {}, end() {} },
          stdout: (async function* () {})(),
          terminate() {},
          waitForExit: async () => true,
        }
      },
    },
  }
  const config = fakeConfig({
    opencodePath: 'opencode', auto: true, attach: '', pure: false, thinking: true, cwd: '/tmp',
    timeoutMs: 1, stderrMaxBytes: 65536, forwardEnv: [], extraArgs: [],
    models: [{ id: 'default', opencodeModel: '', name: 'd' }], brief: 'b',
    localSessionTitles: false, autoDiscoverModels: false, exportTimeoutMs: 0,
  })
  const adapter = new provider.OpencodeLlmAdapter(ctx, config)
  const chunks = await collect(adapter.stream(OPTIONS))
  const finish = chunks.at(-1)
  assert.equal(finish.reason.kind, 'error')
  assert.equal(finish.reason.failure.code, 'OPENCODE_TIMEOUT')
})

test('provider stream never throws when the executable cannot be resolved', async () => {
  const config = fakeConfig({ opencodePath: 'nope', forwardEnv: [], models: [], brief: 'b', localSessionTitles: false, timeoutMs: 10, cwd: '', exportTimeoutMs: 0 })
  const ctx = {
    subprocess: {
      async resolveExecutable() {
        throw new Error('ENOENT opencode')
      },
    },
  }
  const adapter = new provider.OpencodeLlmAdapter(ctx, config)
  const chunks = await collect(adapter.stream(OPTIONS))
  assert.equal(chunks.at(-1).type, 'finish')
  assert.equal(chunks.at(-1).reason.failure.code, 'OPENCODE_SPAWN')
})

/**
 * P0-2 regression: `handle.done` REJECTS (spawn failure). `stream()` must
 * attach its handler before consuming stdout, or the host's fail-loud
 * installer turns the unhandled rejection into `process.exit(1)`.
 *
 * Run OUT OF PROCESS: an in-process `unhandledRejection` listener changes
 * Node's semantics and would make a buggy adapter look healthy. A child that
 * dies nonzero is exactly the production failure.
 */
test('P0-2: stream() with a rejecting done() exits cleanly out of process', () => {
  const child = spawnSync(process.execPath, [new URL('./helpers/spawn-fail-child.mjs', import.meta.url).pathname], {
    encoding: 'utf8',
    timeout: 30000,
  })
  assert.equal(
    child.status,
    0,
    `child must exit 0 (no unhandled rejection); got ${child.status}\nstderr:\n${child.stderr}`,
  )
  const parsed = JSON.parse(child.stdout)
  assert.deepEqual(parsed.types, ['finish'])
  assert.equal(parsed.finishKind, 'error')
  assert.equal(parsed.code, 'OPENCODE_SPAWN')
})

test('provider stream: a synchronously throwing spawn() still yields OPENCODE_SPAWN', async () => {
  const ctx = {
    subprocess: {
      async resolveExecutable(n) {
        return `/fake/${n}`
      },
      spawn() {
        throw new Error('spawn threw synchronously')
      },
    },
  }
  const config = fakeConfig({
    opencodePath: 'opencode', thinking: true, cwd: '', forwardEnv: [], extraArgs: [], models: [],
    brief: 'b', localSessionTitles: false, timeoutMs: 10, stderrMaxBytes: 100, exportTimeoutMs: 0,
  })
  const chunks = await collect(new provider.OpencodeLlmAdapter(ctx, config).stream(OPTIONS))
  assert.equal(chunks.at(-1).reason.failure.code, 'OPENCODE_SPAWN')
})

test('provider argv: never attach/pure, -m from resolveOpencodeModel, --thinking when configured', async () => {
  const { adapter, ctx } = makeAdapter([{ exitCode: 0, stdout: RUN_STREAM }], { exportTimeoutMs: 0, attach: 'http://x', pure: true })
  await collect(adapter.stream(OPTIONS))
  const argv = ctx.calls[0].argv
  assert.ok(!argv.includes('--attach'))
  assert.ok(!argv.includes('--pure'))
  assert.ok(argv.includes('--thinking'))
  assert.ok(!argv.includes('-m'), 'default -> config default -> no -m')
  // The flattened transcript rides on stdin; argv ends at the last flag.
  assert.ok(!argv.includes('--'))
  assert.ok(ctx.calls[0].stdin.includes('<transcript>'), 'prompt must be written to stdin')
})

test('resolveOpencodeModel: table hit uses opencodeModel; unknown route passes verbatim', () => {
  const table = [
    { id: 'default', opencodeModel: '', name: 'd' },
    { id: 'fast', opencodeModel: 'opencode/deepseek-v4.1-flash-free', name: 'f' },
  ]
  assert.equal(provider.resolveOpencodeModel('default', table), '')
  assert.equal(provider.resolveOpencodeModel('fast', table), 'opencode/deepseek-v4.1-flash-free')
  assert.equal(provider.resolveOpencodeModel('opencode-go/mimo-v2.6-flash', table), 'opencode-go/mimo-v2.6-flash')
})

test('provider local session titles answer without spawning opencode', async () => {
  const { adapter, ctx } = makeAdapter([], { localSessionTitles: true })
  const chunks = await collect(
    adapter.stream({
      provider: 'opencode-agent', model: 'default', purpose: 'session-title',
      messages: [{ role: 'user', content: [{ type: 'text', text: 'Fix the parser bug' }] }],
    }),
  )
  assert.equal(ctx.calls.length, 0)
  assert.deepEqual(chunks.map((c) => c.type), ['block-start', 'text-delta', 'block-end', 'finish'])
  assert.equal(chunks[1].text, 'Fix the parser bug')
})

test('sessionTitleText unwraps the host title-request JSON framing', () => {
  const frame =
    'Generate the session title from this JSON array of human messages:' +
    JSON.stringify([{ role: 'user', content: [{ type: 'text', text: 'Refactor the runtime spec' }] }])
  assert.equal(provider.sessionTitleText([{ role: 'user', content: [{ type: 'text', text: frame }] }]), 'Refactor the runtime spec')
  assert.equal(provider.sessionTitleText([{ role: 'user', content: [{ type: 'text', text: 'plain' }] }]), 'plain')
  assert.equal(provider.sessionTitleText([]), 'OpenCode session')
})

test('provider apply registers the route and its settings namespace', () => {
  const registered = []
  const providers = []
  const ctx = {
    llm: {
      registerAdapter(names, adapter) { registered.push({ names, adapter }) },
      registerConfigurableProviders(list) { providers.push(...list) },
    },
  }
  provider.apply(ctx, fakeConfig({}))
  assert.deepEqual(registered[0].names, ['opencode-agent'])
  assert.equal(providers[0].provider, 'opencode-agent')
  assert.equal(providers[0].settingsNs, 'dsh-opencode-v2-provider')
})

test('tool apply registers the opencode tool and the /opencode command', async () => {
  const tools = []
  const commands = []
  const ctx = {
    tools: { register(def) { tools.push(def) } },
    inject(services, callback) {
      assert.deepEqual(services, ['commands'])
      callback({ commands: { register(def) { commands.push(def) } } })
    },
  }
  // `defineTool` is resolved from the host at apply() time; await the promise.
  await tool.apply(ctx, fakeConfig({}))
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'opencode')
  assert.ok(tools[0].parameters.prompt.required)
  for (const added of ['thinking', 'title', 'files']) assert.ok(tools[0].parameters[added], `missing param ${added}`)
  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, 'opencode')
})
