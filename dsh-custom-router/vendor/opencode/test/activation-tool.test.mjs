/**
 * Tool/command integration: the `opencode` tool and `/ocode` delegate to a
 * managed child session and return the child id immediately.
 *
 * Measured symptom this pins (owner, 2026-11-05): a bare `opencode run` process
 * belongs to no DSH session, so its work surfaced as an orphan ("그룹 없음").
 * The registered surfaces must therefore call `subagents.startActivation` with
 * this package's provider and `delivery: 'parent'`; the bare spawn path is only
 * reachable through `DSH_OPENCODE_SPAWN_FALLBACK=1`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, outputSchema } from '../lib/index.js'
import { FALLBACK_ENV } from '../lib/delegation.js'

/** A config object exposing schemastery Volatiles (`.get()` readers). */
function fakeConfig(values = {}) {
  return new Proxy({}, {
    get(_target, key) {
      return { get: () => values[key] }
    },
  })
}

/**
 * A subagents service that records the activation spec.
 * @param {{ childId?: string, providerFound?: boolean }} [options] - overrides.
 * @returns {object} the recording service.
 */
function fakeSubagents(options = {}) {
  const starts = []
  const provider = { name: 'opencode' }
  return {
    starts,
    getProvider: () => (options.providerFound === false ? undefined : provider),
    registerProvider: () => () => {},
    async startActivation(spec) {
      starts.push(spec)
      return {
        childId: options.childId ?? 'child-42',
        result: new Promise(() => {}),
        dispose: async () => {},
      }
    },
  }
}

/** Fake subprocess seam: one scripted successful `opencode` run or `models` listing. */
function fakeSubprocess(stdout = '') {
  const calls = []
  return {
    calls,
    async resolveExecutable(name) {
      return `/fake/bin/${name}`
    },
    spawn(request) {
      calls.push({ argv: [...request.argv] })
      return {
        argv: request.argv,
        done: Promise.resolve({ exitCode: 0, signal: null }),
        collected: {
          stdout: { readFrom: () => ({ text: stdout, lossy: false }) },
          stderr: { readFrom: () => ({ text: '', lossy: false }) },
        },
        stdin: { end() {}, on() {} },
      }
    },
  }
}

/**
 * Build a host context for `apply()`.
 * @param {{ subagents?: object|null, subprocess?: object }} [options] - injected services.
 * @returns {{ctx: object, tools: object[], commands: object[]}} the context and registrations.
 */
function hostContext(options = {}) {
  const tools = []
  const commands = []
  const ctx = {
    tools: {
      get: () => undefined,
      register(definition) { tools.push(definition) },
    },
    logger: { warn() {} },
    subprocess: options.subprocess,
    inject(services, callback) {
      if (services[0] === 'commands') callback({ commands: { register(definition) { commands.push(definition) } } })
      // A null `subagents` models a host without the service: the deferred
      // injection never runs, exactly like a headless composition.
      else if (services[0] === 'subagents' && options.subagents !== null && options.subagents !== undefined) {
        callback({ subagents: options.subagents })
      }
    },
  }
  return { ctx, tools, commands }
}

/** One parent agent identity; only reference equality matters. */
const PARENT = Object.freeze({ session: { id: 'parent-1' } })

test('the tool output is the activation shape, not a bare-run report', () => {
  const schema = outputSchema()
  assert.deepEqual(Object.keys(schema.properties).sort(), ['kind', 'provider', 'subagentId', 'summary'])
  assert.deepEqual(schema.properties.kind.enum, ['activation', 'fallback'])
  assert.equal(schema.additionalProperties, false)
})

test('the opencode tool starts a child session and returns its id immediately', async () => {
  const subagents = fakeSubagents()
  const { ctx, tools } = hostContext({ subagents })
  await apply(ctx, fakeConfig({ subagent: true, subagentProviderName: 'opencode' }))
  assert.equal(tools.length, 1)

  const controller = new AbortController()
  const value = await tools[0].execute(
    { prompt: 'do the task', title: 'Fix parser' },
    { agent: PARENT, signal: controller.signal },
  )
  assert.deepEqual(value, { kind: 'activation', subagentId: 'child-42', provider: 'opencode', summary: '' })
  assert.equal(subagents.starts.length, 1)
  const spec = subagents.starts[0]
  assert.equal(spec.provider, 'opencode')
  assert.equal(spec.label, 'Fix parser')
  assert.equal(spec.delivery, 'parent')
  assert.equal(spec.signal, controller.signal)
  assert.equal(spec.request.parent, PARENT)
  assert.deepEqual(spec.request.prompt, [{ type: 'text', text: 'do the task' }])
  assert.equal(Object.hasOwn(spec.request, 'cwd'), false)

  const rendered = tools[0].output.render({}, value)[0].text
  assert.match(rendered, /child-42/)
  assert.match(rendered, /completion notice/)
})

test('an explicit cwd rides the activation request', async () => {
  const subagents = fakeSubagents()
  const { ctx, tools } = hostContext({ subagents })
  await apply(ctx, fakeConfig({}))
  await tools[0].execute({ prompt: 'p', cwd: '/repo/sub' }, { agent: PARENT, signal: new AbortController().signal })
  assert.equal(subagents.starts[0].request.cwd, '/repo/sub')
})

test('per-call overrides are refused in child mode, never silently dropped', async () => {
  const subagents = fakeSubagents()
  const { ctx, tools } = hostContext({ subagents })
  await apply(ctx, fakeConfig({}))
  await assert.rejects(
    () => tools[0].execute(
      { prompt: 'p', model: 'opencode/x', agent: 'build' },
      { agent: PARENT, signal: new AbortController().signal },
    ),
    (error) => /managed child session/.test(error.message)
      && /"model"/.test(error.message)
      && /"agent"/.test(error.message)
      && /plugin config/.test(error.message),
  )
  assert.equal(subagents.starts.length, 0)
})

test('no subagents service: a clear refusal, and no process is spawned', async () => {
  const { ctx, tools } = hostContext({ subagents: null, subprocess: fakeSubprocess('should not run') })
  await apply(ctx, fakeConfig({}))
  await assert.rejects(
    () => tools[0].execute({ prompt: 'p' }, { agent: PARENT, signal: new AbortController().signal }),
    (error) => /Refusing to spawn an untracked opencode process/.test(error.message)
      && error.message.includes(FALLBACK_ENV),
  )
  assert.equal(ctx.subprocess.calls.length, 0, 'the refusal must not call subprocess.spawn')
})

test('a host without the provider refuses instead of delegating to a stranger', async () => {
  const subagents = fakeSubagents({ providerFound: false })
  const { ctx, tools } = hostContext({ subagents })
  await apply(ctx, fakeConfig({}))
  await assert.rejects(
    () => tools[0].execute({ prompt: 'p' }, { agent: PARENT, signal: new AbortController().signal }),
    (error) => /not registered/.test(error.message),
  )
  assert.equal(subagents.starts.length, 0)
})

test('the documented emergency fallback still works only under its env switch', async () => {
  const previous = process.env[FALLBACK_ENV]
  process.env[FALLBACK_ENV] = '1'
  try {
    const subprocess = fakeSubprocess('')
    const { ctx, tools } = hostContext({ subagents: null, subprocess })
    await apply(ctx, fakeConfig({
      forwardEnv: [],
      opencodePath: 'opencode',
      model: 'opencode-go/minimax-m3.1-flash#low',
      agent: '',
      auto: true,
      thinking: true,
      title: '',
      timeoutMs: 1000,
      maxOutputBytes: 1024,
      exportTimeoutMs: 0,
      extraArgs: [],
      attach: '',
      pure: false,
    }))
    const value = await tools[0].execute(
      { prompt: 'p', model: 'opencode/x' },
      { agent: PARENT, signal: new AbortController().signal },
    )
    assert.equal(value.kind, 'fallback')
    assert.equal(value.subagentId, '')
    assert.equal(value.provider, 'opencode')
    assert.match(value.summary, /finished successfully/)
    assert.equal(subprocess.calls.length, 1, 'fallback runs the legacy binary once')
    const rendered = tools[0].output.render({}, value)[0].text
    assert.match(rendered, new RegExp(FALLBACK_ENV + '=1'))
    assert.match(rendered, /will not appear as a child session/)
  } finally {
    if (previous === undefined) delete process.env[FALLBACK_ENV]
    else process.env[FALLBACK_ENV] = previous
  }
})

test('/ocode starts a child session and reports the id', async () => {
  const subagents = fakeSubagents({ childId: 'child-77' })
  const { ctx, commands } = hostContext({ subagents })
  await apply(ctx, fakeConfig({}))
  assert.equal(commands.length, 1)
  assert.equal(commands[0].name, 'ocode')

  const result = await commands[0].handler({
    rawInput: ' refactor the parser ',
    agent: PARENT,
    signal: new AbortController().signal,
    attachments: [],
    commandId: 'cmd-1',
  })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /child-77/)
  assert.match(result.text, /completion notice/)
  assert.equal(subagents.starts.length, 1)
  assert.equal(subagents.starts[0].request.parent, PARENT)
  assert.deepEqual(subagents.starts[0].request.prompt, [{ type: 'text', text: 'refactor the parser' }])
})

test('/ocode rejects per-run overrides in child mode', async () => {
  const subagents = fakeSubagents()
  const { ctx, commands } = hostContext({ subagents })
  await apply(ctx, fakeConfig({}))
  const result = await commands[0].handler({
    rawInput: '--model opencode/x do it',
    agent: PARENT,
    signal: new AbortController().signal,
    attachments: [],
    commandId: 'cmd-2',
  })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /--model/)
  assert.match(result.text, /plugin config/)
  assert.equal(subagents.starts.length, 0)
})

test('/ocode models still lists the CLI catalog without starting a session', async () => {
  const subagents = fakeSubagents()
  const subprocess = fakeSubprocess('opencode-go/beam-free\nopencode-go/mimo-v2.6-flash\n')
  const { ctx, commands } = hostContext({ subagents, subprocess })
  await apply(ctx, fakeConfig({ forwardEnv: [], opencodePath: 'opencode' }))
  const result = await commands[0].handler({
    rawInput: 'models',
    agent: PARENT,
    signal: new AbortController().signal,
    attachments: [],
    commandId: 'cmd-3',
  })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /opencode-go\/beam-free/)
  assert.equal(subagents.starts.length, 0, 'a catalog read creates no child session')
  assert.equal(subprocess.calls.length, 1)
  assert.deepEqual(subprocess.calls[0].argv.slice(1), ['models'])
})

test('/ocode without the service is an error, not a spawn', async () => {
  const { ctx, commands } = hostContext({ subagents: null, subprocess: fakeSubprocess('') })
  await apply(ctx, fakeConfig({}))
  const result = await commands[0].handler({
    rawInput: 'do it',
    agent: PARENT,
    signal: new AbortController().signal,
    attachments: [],
    commandId: 'cmd-4',
  })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /Refusing to spawn an untracked opencode process/)
  assert.equal(ctx.subprocess.calls.length, 0)
})
