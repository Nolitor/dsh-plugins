/**
 * Unit tests for lib/shared.js against the measured opencode v2.2.0 surface.
 * No network, no real `opencode` child, no ~/.dsh access: the subprocess seam
 * is a local fake.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  JsonRunParser,
  UNSUPPORTED_V2_FLAGS,
  buildRunArgv,
  fetchUsage,
  forwardedEnv,
  disambiguateModelNames,
  classifyWire,
  completionTokensField,
  isOpenAiChatPackage,
  modelFromApiEntry,
  modelsFromApiPayload,
  modelsFromCliOutput,
  sendPrompt,
  stderrTail,
  stripUnsupportedFlags,
  usageFromSessionExport,
} from '../lib/shared.js'

// ---------------------------------------------------------------------------
// argv
// ---------------------------------------------------------------------------

test('buildRunArgv emits only flags: no prompt, no `--` marker (prompt goes to stdin)', () => {
  assert.deepEqual(buildRunArgv({}), ['run'])
})

test('buildRunArgv never puts a prompt-shaped value into argv', () => {
  const argv = buildRunArgv({ model: 'opencode/x' })
  assert.ok(!argv.includes('--'))
  assert.ok(!argv.some((a) => typeof a === 'string' && a.includes(' ')))
  // Even a flag-looking prompt cannot reach argv: there is no prompt parameter.
  assert.deepEqual(argv, ['run', '-m', 'opencode/x'])
})

test('buildRunArgv never emits --attach or --pure, even when the flags are passed', () => {
  const argv = buildRunArgv({ attach: 'http://127.0.0.1:4096', pure: true, model: 'opencode/x' })
  assert.ok(!argv.includes('--attach'))
  assert.ok(!argv.some((a) => a.startsWith('--attach=')))
  assert.ok(!argv.includes('--pure'))
  assert.ok(!argv.includes('http://127.0.0.1:4096'))
  assert.deepEqual(argv, ['run', '-m', 'opencode/x'])
})

test('buildRunArgv carries the v2-only flags in documented order', () => {
  const argv = buildRunArgv({
    model: 'opencode/deepseek-v4.1-flash-free',
    agent: 'build',
    auto: true,
    fork: true,
    session: 'ses_abc',
    thinking: true,
    title: 'a title',
    files: ['/tmp/a.txt', '/tmp/b.txt'],
    format: 'json',
    extraArgs: ['--log-level', 'warn'],
  })
  assert.deepEqual(argv, [
    'run',
    '-m', 'opencode/deepseek-v4.1-flash-free',
    '--agent', 'build',
    '--auto',
    '--fork',
    '-s', 'ses_abc',
    '--thinking',
    '--title', 'a title',
    '-f', '/tmp/a.txt',
    '-f', '/tmp/b.txt',
    '--format', 'json',
    '--log-level', 'warn',
  ])
})

test('buildRunArgv prefers --session over --continue and omits format for "default"', () => {
  assert.deepEqual(buildRunArgv({ session: 'ses_1', continueLast: true, format: 'default' }), ['run', '-s', 'ses_1'])
  assert.deepEqual(buildRunArgv({ continueLast: true }), ['run', '-c'])
})

test('buildRunArgv itself strips attach/pure from extraArgs (P2-1 regression)', () => {
  assert.deepEqual(buildRunArgv({ extraArgs: ['--attach', 'http://x', '--pure'] }), ['run'])
  assert.deepEqual(buildRunArgv({ extraArgs: ['--pure=1', '--attach=http://y', '-v'] }), ['run', '-v'])
  // Idempotent: pre-sanitised input gives the same argv as unsanitised input.
  const raw = ['--log-level', 'warn', '--attach', 'http://x', '--pure']
  assert.deepEqual(
    buildRunArgv({ extraArgs: raw }),
    buildRunArgv({ extraArgs: stripUnsupportedFlags(raw) }),
  )
})

// ---------------------------------------------------------------------------
// stdin prompt delivery (spawn E2BIG regression)
// ---------------------------------------------------------------------------

test('sendPrompt writes the whole prompt and closes stdin', () => {
  const written = []
  let ended = false
  const handle = {
    stdin: {
      on() {},
      end(text) {
        ended = true
        written.push(text)
      },
    },
  }
  assert.equal(sendPrompt(handle, 'hello'), true)
  assert.equal(ended, true)
  assert.deepEqual(written, ['hello'])
})

test('sendPrompt carries a prompt far beyond the 128 KiB argv limit', () => {
  const big = 'x'.repeat(300 * 1024)
  let received = ''
  const handle = { stdin: { on() {}, end: (text) => { received = text } } }
  assert.equal(sendPrompt(handle, big), true)
  assert.equal(received.length, big.length)
})

test('sendPrompt reports false instead of throwing when stdin is absent or broken', () => {
  assert.equal(sendPrompt(null, 'x'), false)
  assert.equal(sendPrompt({}, 'x'), false)
  assert.equal(sendPrompt({ stdin: {} }, 'x'), false)
  const broken = {
    stdin: {
      on() {},
      end() {
        throw new Error('EPIPE')
      },
    },
  }
  assert.equal(sendPrompt(broken, 'x'), false)
})


test('stripUnsupportedFlags removes stale attach/pure from extraArgs only', () => {
  assert.deepEqual(
    stripUnsupportedFlags(['--log-level', 'warn', '--attach', 'http://x', '--pure', '--attach=http://y', '--pure=1']),
    ['--log-level', 'warn'],
  )
  assert.deepEqual(UNSUPPORTED_V2_FLAGS, ['--attach', '--pure'])
})

// ---------------------------------------------------------------------------
// event parser
// ---------------------------------------------------------------------------

const line = (obj) => JSON.stringify(obj) + '\n'

test('parser diffs cumulative text snapshots into deltas and keeps the session id', () => {
  const parser = new JsonRunParser()
  const carry = { buffer: '' }
  const events = []
  events.push(...parser.feed(line({ type: 'step_start', sessionID: 'ses_1', part: { id: 'prt_s', type: 'step-start' } }), carry))
  events.push(...parser.feed(line({ type: 'text', sessionID: 'ses_1', part: { id: 'prt_t', type: 'text', text: 'Hel' } }), carry))
  events.push(...parser.feed(line({ type: 'text', sessionID: 'ses_1', part: { id: 'prt_t', type: 'text', text: 'Hello, ' } }), carry))
  events.push(...parser.feed(line({ type: 'text', sessionID: 'ses_1', part: { id: 'prt_t', type: 'text', text: 'Hello, world' } }), carry))
  parser.finish(carry)

  assert.deepEqual(events, [
    { kind: 'text', partId: 'prt_t', delta: 'Hel' },
    { kind: 'text', partId: 'prt_t', delta: 'lo, ' },
    { kind: 'text', partId: 'prt_t', delta: 'world' },
  ])
  const summary = parser.summary()
  assert.equal(summary.text, 'Hello, world')
  assert.equal(summary.sessionId, 'ses_1')
  assert.equal(summary.sawEvents, true)
})

test('parser emits reasoning deltas separately from text deltas', () => {
  const parser = new JsonRunParser()
  const carry = { buffer: '' }
  const events = []
  events.push(...parser.feed(line({ type: 'step_start', sessionID: 'ses_2', part: { id: 'prt_s', type: 'step-start' } }), carry))
  events.push(...parser.feed(line({ type: 'reasoning', sessionID: 'ses_2', part: { id: 'prt_r_reasoning-0', type: 'reasoning', text: 'Let me ' } }), carry))
  events.push(...parser.feed(line({ type: 'reasoning', sessionID: 'ses_2', part: { id: 'prt_r_reasoning-0', type: 'reasoning', text: 'Let me think.' } }), carry))
  events.push(...parser.feed(line({ type: 'text', sessionID: 'ses_2', part: { id: 'prt_r_text-0', type: 'text', text: 'Answer' } }), carry))
  const summary = parser.finish(carry)

  assert.deepEqual(events, [
    { kind: 'reasoning', partId: 'prt_r_reasoning-0', delta: 'Let me ' },
    { kind: 'reasoning', partId: 'prt_r_reasoning-0', delta: 'think.' },
    { kind: 'text', partId: 'prt_r_text-0', delta: 'Answer' },
  ])
  assert.equal(summary.reasoning, 'Let me think.')
  assert.equal(summary.text, 'Answer')
  assert.deepEqual(summary.events, events)
})

test('parser handles a split line across chunks (carry buffer)', () => {
  const parser = new JsonRunParser()
  const carry = { buffer: '' }
  const body = line({ type: 'text', sessionID: 'ses_3', part: { id: 'p', type: 'text', text: 'abc' } })
  const events = [
    ...parser.feed(body.slice(0, 20), carry),
    ...parser.feed(body.slice(20, 45), carry),
    ...parser.feed(body.slice(45), carry),
  ]
  parser.finish(carry)
  assert.deepEqual(events, [{ kind: 'text', partId: 'p', delta: 'abc' }])
  assert.equal(parser.summary().sessionId, 'ses_3')
})

test('parser tolerates malformed lines and non-object events without dying', () => {
  const parser = new JsonRunParser()
  const carry = { buffer: '' }
  const events = []
  for (const raw of ['', '   ', 'not json{', '[1,2,3]', 'null', '"str"', '{"no":"type"}']) {
    events.push(...parser.feed(raw + '\n', carry))
  }
  events.push(...parser.feed(line({ type: 'text', sessionID: 'ses_4', part: { id: 'p', type: 'text', text: 'ok' } }), carry))
  const summary = parser.finish(carry)
  assert.deepEqual(events, [{ kind: 'text', partId: 'p', delta: 'ok' }])
  assert.equal(summary.sawEvents, true)
})

test('parser flushes an unterminated trailing line on finish', () => {
  const parser = new JsonRunParser()
  const carry = { buffer: '' }
  parser.feed(line({ type: 'text', sessionID: 'ses_5', part: { id: 'p', type: 'text', text: 'tail' } }).trimEnd(), carry)
  const summary = parser.finish(carry)
  assert.equal(summary.text, 'tail')
  assert.equal(carry.buffer, '')
})

test('parser collects error events with a readable message', () => {
  const parser = new JsonRunParser()
  const carry = { buffer: '' }
  parser.feed(line({ type: 'error', error: { name: 'ProviderModelNotFoundError', data: { providerID: 'x' } } }), carry)
  parser.feed(line({ type: 'error', error: 'plain string error' }), carry)
  parser.feed(line({ type: 'error', error: { data: { message: 'nested message' } } }), carry)
  const summary = parser.finish(carry)
  assert.equal(summary.errors.length, 3)
  assert.match(summary.errors[0], /ProviderModelNotFoundError/)
  assert.equal(summary.errors[1], 'plain string error')
  assert.equal(summary.errors[2], 'nested message')
})

test('parser still tolerates a legacy step_finish usage event', () => {
  const parser = new JsonRunParser()
  const carry = { buffer: '' }
  parser.feed(line({ type: 'step_finish', part: { tokens: { input: 12, output: 7 }, cost: 0.001 } }), carry)
  parser.feed(line({ type: 'step_finish', part: { tokens: { input: 3, output: 1 } } }), carry)
  const summary = parser.finish(carry)
  assert.equal(summary.inputTokens, 15)
  assert.equal(summary.outputTokens, 8)
  assert.equal(summary.cost, 0.001)
})

// Measured on opencode v2.2.0: a run that USES a tool emits `step_finish`
// carrying that step's tokens. It is a per-step total, never a whole-run one,
// so it stays a fallback and never replaces the `session export` usage.
test('parser records a tool-using step\'s per-step step_finish tokens without treating them as the run total', () => {
  const parser = new JsonRunParser()
  const carry = { buffer: '' }
  parser.feed(line({ type: 'step_start', sessionID: 'ses_7', part: { id: 's1', type: 'step-start' } }), carry)
  parser.feed(line({
    type: 'step_finish',
    sessionID: 'ses_7',
    part: {
      id: 's1',
      type: 'step-finish',
      reason: 'tool-calls',
      cost: 0,
      tokens: { input: 55, output: 19, reasoning: 38, cache: { read: 5056, write: 0 } },
    },
  }), carry)
  parser.feed(line({ type: 'step_start', sessionID: 'ses_7', part: { id: 's2', type: 'step-start' } }), carry)
  parser.feed(line({ type: 'text', sessionID: 'ses_7', part: { id: 't', type: 'text', text: 'DONE' } }), carry)
  const summary = parser.finish(carry)
  // The tool step's own counters are kept.
  assert.equal(summary.inputTokens, 55)
  assert.equal(summary.outputTokens, 19)
  assert.equal(summary.text, 'DONE')
  // The final text step contributes no step_finish, so the sum covers only the
  // tool step. It is therefore not the whole run's usage, which the
  // `session export` fetch supplies instead.
  assert.equal(summary.inputTokens, 55)
  assert.equal(summary.outputTokens, 19)
  assert.equal(summary.sessionId, 'ses_7')
})

test('parser reports zero tokens when no step_finish is ever emitted (the v2 case)', () => {
  const parser = new JsonRunParser()
  const carry = { buffer: '' }
  parser.feed(line({ type: 'step_start', sessionID: 'ses_6', part: { id: 's', type: 'step-start' } }), carry)
  parser.feed(line({ type: 'text', sessionID: 'ses_6', part: { id: 't', type: 'text', text: 'hi' } }), carry)
  const summary = parser.finish(carry)
  assert.equal(summary.inputTokens, 0)
  assert.equal(summary.outputTokens, 0)
  assert.equal(summary.sawEvents, true)
})

test('parser separates part ids and joins them in first-seen order', () => {
  const parser = new JsonRunParser()
  const carry = { buffer: '' }
  parser.feed(line({ type: 'text', sessionID: 's', part: { id: 'a', type: 'text', text: 'A1' } }), carry)
  parser.feed(line({ type: 'text', sessionID: 's', part: { id: 'b', type: 'text', text: 'B1' } }), carry)
  parser.feed(line({ type: 'text', sessionID: 's', part: { id: 'a', type: 'text', text: 'A1A2' } }), carry)
  const summary = parser.finish(carry)
  assert.equal(summary.text, 'A1A2B1')
})

// ---------------------------------------------------------------------------
// usage mapping
// ---------------------------------------------------------------------------

const measuredExport = {
  info: {
    cost: 0,
    tokens: { input: 1005, output: 4, reasoning: 9, cache: { read: 4096, write: 0 } },
    outcome: 'succeeded',
    model: { id: 'mimo-v2.6-flash', providerID: 'opencode-go', variant: 'default' },
  },
  messages: [],
}

test('usageFromSessionExport maps the measured payload field-by-field', () => {
  const usage = usageFromSessionExport(measuredExport)
  assert.deepEqual(usage, {
    inputTokens: 1005,
    outputTokens: 4,
    reasoningTokens: 9,
    cacheReadTokens: 4096,
    cacheWriteTokens: 0,
    totalTokens: 1005 + 4 + 9 + 4096 + 0,
  })
})

test('usageFromSessionExport total is the disjoint sum, including cache write', () => {
  const usage = usageFromSessionExport({
    info: { tokens: { input: 10, output: 20, reasoning: 30, cache: { read: 40, write: 50 } } },
  })
  assert.equal(usage.totalTokens, 150)
})

test('usageFromSessionExport defaults absent counters to 0 and rejects garbage', () => {
  assert.deepEqual(usageFromSessionExport({ info: { tokens: { input: 1 } } }), {
    inputTokens: 1,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 1,
  })
  assert.equal(usageFromSessionExport(null), null)
  assert.equal(usageFromSessionExport({}), null)
  assert.equal(usageFromSessionExport({ info: {} }), null)
  assert.equal(usageFromSessionExport('nope'), null)
})

test('usageFromSessionExport treats negative/NaN counters as 0', () => {
  const usage = usageFromSessionExport({
    info: { tokens: { input: -5, output: 'x', reasoning: Number.NaN, cache: { read: 3 } } },
  })
  assert.deepEqual(usage, {
    inputTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    cacheReadTokens: 3,
    cacheWriteTokens: 0,
    totalTokens: 3,
  })
})

// ---------------------------------------------------------------------------
// fetchUsage / captureCli over a fake subprocess seam
// ---------------------------------------------------------------------------

/**
 * Minimal fake ctx.subprocess: records every spawn and replays scripted
 * results. No child process is ever created.
 */
function fakeCtx(script = []) {
  const calls = []
  let next = 0
  return {
    calls,
    subprocess: {
      async resolveExecutable(name) {
        return `/fake/bin/${name}`
      },
      spawn(request) {
        const entry = script[next++] ?? { exitCode: 0, stdout: '' }
        calls.push({ argv: [...request.argv], cwd: request.cwd, env: { ...request.env } })
        const chunks = { stdout: { readFrom: () => ({ text: entry.stdout ?? '' }) }, stderr: { readFrom: () => ({ text: entry.stderr ?? '' }) } }
        return {
          collected: chunks,
          done: Promise.resolve({ exitCode: entry.exitCode ?? 0, signal: null }),
          terminate() {},
          waitForExit: async () => true,
        }
      },
    },
  }
}

test('fetchUsage spawns `session export <sid>` and returns mapped usage', async () => {
  const ctx = fakeCtx([{ exitCode: 0, stdout: JSON.stringify(measuredExport) }])
  const usage = await fetchUsage({
    ctx,
    opencodePath: 'opencode',
    sessionId: 'ses_abc',
    env: { HOME: '/fake' },
    cwd: '/tmp',
  })
  assert.equal(ctx.calls.length, 1)
  assert.deepEqual(ctx.calls[0].argv, ['/fake/bin/opencode', 'session', 'export', 'ses_abc'])
  assert.equal(ctx.calls[0].cwd, '/tmp')
  assert.deepEqual(ctx.calls[0].env, { HOME: '/fake' })
  assert.equal(usage.inputTokens, 1005)
  assert.equal(usage.cacheReadTokens, 4096)
  assert.equal(usage.totalTokens, 5114)
})

test('fetchUsage returns null on non-zero exit, bad JSON, missing id, and throw', async () => {
  assert.equal(
    await fetchUsage({ ctx: fakeCtx([{ exitCode: 1, stdout: '' }]), opencodePath: 'opencode', sessionId: 's', env: {} }),
    null,
  )
  assert.equal(
    await fetchUsage({ ctx: fakeCtx([{ exitCode: 0, stdout: 'not json' }]), opencodePath: 'opencode', sessionId: 's', env: {} }),
    null,
  )
  assert.equal(await fetchUsage({ ctx: fakeCtx([]), opencodePath: 'opencode', sessionId: '', env: {} }), null)
  const throwing = {
    subprocess: {
      async resolveExecutable() {
        throw new Error('ENOENT')
      },
    },
  }
  assert.equal(await fetchUsage({ ctx: throwing, opencodePath: 'opencode', sessionId: 's', env: {} }), null)
  assert.equal(await fetchUsage({ ctx: null, opencodePath: 'opencode', sessionId: 's', env: {} }), null)
})

test('fetchUsage spawns nothing when the export JSON lacks tokens', async () => {
  const ctx = fakeCtx([{ exitCode: 0, stdout: JSON.stringify({ info: { outcome: 'succeeded' } }) }])
  assert.equal(await fetchUsage({ ctx, opencodePath: 'opencode', sessionId: 's', env: {} }), null)
  assert.equal(ctx.calls.length, 1)
})

// ---------------------------------------------------------------------------
// misc helpers
// ---------------------------------------------------------------------------

test('modelsFromCliOutput parses provider/model lines and skips banners', () => {
  const text = ['Available models:', 'opencode-go/a', '', 'opencode/b#variant', 'warning: x', 'not-a-route'].join('\n')
  // The CLI lists ids only; every entry now also carries the conservative
  // context floor so `compaction-basic` never sees a route without a window.
  assert.deepEqual(modelsFromCliOutput(text), {
    models: [
      { id: 'opencode-go/a', name: 'opencode-go/a', contextWindow: 32768, maxTokens: 8192 },
      { id: 'opencode/b#variant', name: 'opencode/b#variant', contextWindow: 32768, maxTokens: 8192 },
    ],
  })
  assert.equal(modelsFromCliOutput('nothing here'), null)
})

test('forwardedEnv skips unset names and stderrTail clamps', () => {
  process.env.DSH_OCV2_PROBE = 'yes'
  try {
    assert.deepEqual(forwardedEnv(['DSH_OCV2_PROBE', 'DSH_OCV2_MISSING_XYZ']), { DSH_OCV2_PROBE: 'yes' })
  } finally {
    delete process.env.DSH_OCV2_PROBE
  }
  assert.equal(stderrTail('  abc  '), 'abc')
  assert.equal(stderrTail('x'.repeat(500), 10), 'x'.repeat(10))
})


test('modelsFromApiPayload disambiguates identical names served by two providers', () => {
  const payload = {
    data: [
      { providerID: 'opencode', id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', limit: { context: 200000 } },
      { providerID: 'opencode-go', id: 'deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', limit: { context: 1000000 } },
      { providerID: 'opencode', id: 'beam-free', name: 'Beam Free', limit: { context: 200000 } },
    ],
  }
  const { models } = modelsFromApiPayload(payload)
  assert.deepEqual(
    models.map((model) => model.name),
    ['DeepSeek V4.1 Flash (Zen)', 'DeepSeek V4.1 Flash (Go)', 'Beam Free'],
  )
  assert.deepEqual(disambiguateModelNames([{ id: 'a/x', name: 'X' }]), [{ id: 'a/x', name: 'X' }])
})

test('modelsFromApiPayload drops routes the server marks disabled', () => {
  const payload = {
    data: [
      { providerID: 'opencode', id: 'live', name: 'Live', enabled: true, status: 'active' },
      { providerID: 'opencode', id: 'off', name: 'Off', enabled: false, status: 'active' },
      { providerID: 'opencode', id: 'gone', name: 'Gone', enabled: true, status: 'disabled' },
    ],
  }
  const { models } = modelsFromApiPayload(payload)
  assert.deepEqual(models.map((model) => model.id), ['opencode/live'])
})

// ---------------------------------------------------------------------------
// Ingress Protocol Guard (G1/G2): package + compatibility retention
// ---------------------------------------------------------------------------

test('modelFromApiEntry keeps the package and the compatibility declaration', () => {
  // Measured 2026-11-10 on the live catalog: `opencode/claude-opus-5-5` is served
  // by `@opencode/ai/providers/anthropic`, not by an OpenAI chat wire.
  const model = modelFromApiEntry({
    id: 'claude-opus-5-5',
    providerID: 'opencode',
    name: 'Claude Opus 5.5',
    package: '@opencode/ai/providers/anthropic',
    limit: { context: 1000000, output: 128000 },
    compatibility: {
      reasoningField: 'reasoning_content',
      maxTokensField: 'max_completion_tokens',
      streamUsage: false,
      cacheFormat: 'anthropic',
      requireFinishReason: true,
      requireReasoning: false,
      supportsPromptCacheKey: true,
      requireAssistantAfterTool: false,
    },
  })
  assert.equal(model.package, '@opencode/ai/providers/anthropic')
  assert.deepEqual(model.compatibility, {
    reasoningField: 'reasoning_content',
    maxTokensField: 'max_completion_tokens',
    streamUsage: false,
    cacheFormat: 'anthropic',
    requireFinishReason: true,
    requireReasoning: false,
    supportsPromptCacheKey: true,
    requireAssistantAfterTool: false,
  })
  // The legacy flat field stays for every existing reader.
  assert.equal(model.reasoningField, 'reasoning_content')
})

test('modelFromApiEntry omits package/compatibility when the entry has none', () => {
  const model = modelFromApiEntry({ id: 'x', providerID: 'opencode' })
  assert.equal('package' in model, false)
  assert.equal('compatibility' in model, false)
})

test('compatibility keeps only boolean/string values for its known keys', () => {
  const model = modelFromApiEntry({
    id: 'x',
    providerID: 'opencode',
    compatibility: { maxTokensField: 42, streamUsage: 'false', cacheFormat: null, requireReasoning: true },
  })
  assert.deepEqual(model.compatibility, { streamUsage: 'false', requireReasoning: true })
})

test('allowDynamicPassthrough keeps unknown compatibility keys and package families', () => {
  const entry = {
    id: 'x',
    providerID: 'opencode',
    package: '@opencode/ai/providers/some-future-wire',
    compatibility: { cacheFormat: 'anthropic', supportsThinkingBlockBinding: true, wire: 'future' },
  }
  // Default: pass through.
  const kept = modelFromApiEntry(entry)
  assert.deepEqual(kept.compatibility, {
    cacheFormat: 'anthropic',
    supportsThinkingBlockBinding: true,
    wire: 'future',
  })
  // Explicit opt-out: only the known keys survive.
  const stripped = modelFromApiEntry(entry, { allowDynamicPassthrough: false })
  assert.deepEqual(stripped.compatibility, { cacheFormat: 'anthropic' })
})

test('isOpenAiChatPackage accepts the chat wires and rejects every other family', () => {
  for (const id of [
    '@opencode/ai/providers/openai',
    '@opencode/ai/providers/openai/chat',
    '@opencode/ai/providers/openai-compatible',
    '@opencode/ai/providers/azure/chat',
    '@opencode/ai/providers/azure-openai/chat',
  ]) {
    assert.equal(isOpenAiChatPackage(id), true, id)
  }
  for (const id of [
    '@opencode/ai/providers/anthropic',
    '@opencode/ai/providers/anthropic-compatible',
    '@opencode/ai/providers/openai/responses',
    '@opencode/ai/providers/google',
    '@opencode/ai/providers/google-vertex',
    '@opencode/ai/providers/mistral',
  ]) {
    assert.equal(isOpenAiChatPackage(id), false, id)
  }
  // Unknown/absent: allowed, and the caller marks it unverified.
  assert.equal(isOpenAiChatPackage(undefined), true)
  assert.equal(isOpenAiChatPackage(''), true)
  assert.equal(isOpenAiChatPackage(null), true)
})

test('completionTokensField follows the route declaration, never both', () => {
  assert.equal(completionTokensField({ compatibility: { maxTokensField: 'max_completion_tokens' } }), 'max_completion_tokens')
  assert.equal(completionTokensField({ compatibility: {} }), 'max_tokens')
  assert.equal(completionTokensField(null), 'max_tokens')
  // rawBypass keeps the historical field.
  assert.equal(completionTokensField({ compatibility: { maxTokensField: 'max_completion_tokens' } }, { rawBypass: true }), 'max_tokens')
})

test('modelsFromApiPayload keeps an anthropic-package route and marks it unverified', () => {
  // Advisory by default: the facade may translate a chat body, so the route is
  // advertised with `unverifiedWire` rather than hidden.
  const parsed = modelsFromApiPayload({
    data: [
      { id: 'claude-opus-5-5', providerID: 'opencode', name: 'Claude Opus 5.5', package: '@opencode/ai/providers/anthropic' },
      { id: 'free-unknown', providerID: 'opencode', name: 'Free Unknown' },
      { id: 'beam-free', providerID: 'opencode', name: 'Beam Free', package: '@opencode/ai/providers/openai-compatible' },
    ],
  })
  assert.deepEqual(parsed.models.map((model) => model.id), [
    'opencode/claude-opus-5-5',
    'opencode/free-unknown',
    'opencode/beam-free',
  ])
  assert.equal(parsed.models[0].unverifiedWire, true)
  assert.equal(parsed.models[0].package, '@opencode/ai/providers/anthropic')
  // An entry that declares no package is a known-unknown, not a verified chat wire.
  assert.equal('unverifiedWire' in parsed.models[1], false)
  assert.equal('unverifiedWire' in parsed.models[2], false)
})

test('modelsFromApiPayload hides an unsupported-package route only under strictWire', () => {
  const payload = {
    data: [
      { id: 'claude-opus-5-5', providerID: 'opencode', name: 'Claude Opus 5.5', package: '@opencode/ai/providers/anthropic' },
      { id: 'beam-free', providerID: 'opencode', name: 'Beam Free', package: '@opencode/ai/providers/openai-compatible' },
    ],
  }
  const strict = modelsFromApiPayload(payload, { strictWire: true })
  assert.deepEqual(strict.models.map((model) => model.id), ['opencode/beam-free'])
})

test('classifyWire separates a confirmed chat wire from a known foreign one and an unknown one', () => {
  assert.equal(classifyWire('@opencode/ai/providers/openai-compatible'), 'chat')
  assert.equal(classifyWire('@opencode/ai/providers/openai/chat'), 'chat')
  assert.equal(classifyWire('@opencode/ai/providers/azure/chat'), 'chat')
  assert.equal(classifyWire('@opencode/ai/providers/anthropic'), 'unsupported')
  assert.equal(classifyWire('@opencode/ai/providers/anthropic-compatible'), 'unsupported')
  assert.equal(classifyWire('@opencode/ai/providers/openai/responses'), 'unsupported')
  assert.equal(classifyWire('@opencode/ai/providers/google'), 'unsupported')
  assert.equal(classifyWire('@opencode/ai/providers/google-vertex'), 'unsupported')
  // A server newer than this adapter: never refused, only marked.
  assert.equal(classifyWire('@opencode/ai/providers/brand-new-wire'), 'unknown')
  assert.equal(classifyWire(undefined), 'unknown')
  assert.equal(classifyWire(''), 'unknown')
})
