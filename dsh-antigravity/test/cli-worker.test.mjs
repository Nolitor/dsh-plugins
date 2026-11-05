/**
 * CLI worker contract — `/agy` and `agy_worker` run a MANAGED child session.
 *
 * Owner decision 2026-11-05: the CLI worker must not spawn a bare `agy`
 * process, because that process is invisible to the harness and the work does
 * not appear as a tracked child session (measured symptom: sessions piling up
 * in the sidebar's ungrouped bucket). The worker now calls
 * `ctx.subagents.startActivation` with the provider this plugin registers and
 * returns the child session id immediately; the answer arrives as a completion
 * notice.
 *
 * These tests pin the activation spec, the no-bare-process rule, the clear
 * failure when the subagent seam/provider/agent is missing, and that the
 * read-only `/agy models` listing still works.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config, apply } from '../lib/index.js'
import {
  CliDelegationError,
  DEFAULT_SUBAGENT_PROVIDER,
  cliProviderName,
  labelFromPrompt,
  startCliChild,
} from '../lib/cli-activation.js'

const SIGNAL = new AbortController().signal

/** A parent Agent stub: the activation seam only forwards it. */
function parentAgent(cwd = '/tmp/project') {
  return { session: { header: { cwd } } }
}

/** Build the reactive config cordis provides. */
function reactiveConfig(overrides = {}) {
  const values = {
    agyPath: 'agy', model: 'gemini-3.8-flash-low', effort: 'low', mode: 'accept-edits',
    timeoutMs: 60000, maxOutputBytes: 8388608, forwardEnv: ['PATH', 'HOME'],
    extraArgs: [], artifactLimit: 10, subagentProviderName: 'antigravity',
    ...overrides,
  }
  return Object.fromEntries(Object.entries(values).map(([k, v]) => [k, { get: () => v }]))
}

/**
 * A subagent service double that records activations and keeps provider state.
 * @param {object} [options] - behaviour switches.
 * @returns {object} the service and its recorder.
 */
function fakeSubagents(options = {}) {
  const activations = []
  const providers = []
  let registered = options.providerRegistered === false ? '' : 'antigravity'
  return {
    activations,
    providers,
    registerProvider(provider) {
      providers.push(provider)
      if (!options.ignoreRegistration) registered = provider.name
      return () => { registered = '' }
    },
    getProvider(name) {
      return registered === name ? { name } : undefined
    },
    async startActivation(spec) {
      activations.push(spec)
      if (options.failWith) throw options.failWith
      return {
        childId: `child-${activations.length}`,
        messageId: `message-${activations.length}`,
        result: Promise.resolve({ output: [{ type: 'text', text: 'later' }] }),
        dispose: async () => {},
      }
    },
  }
}

/**
 * Mount the real plugin against a mock cordis context.
 * @param {object} [options] - mount options.
 * @returns {object} mock context, registered surfaces, and spawn/activation records.
 */
function mountPlugin(options = {}) {
  const spawned = []
  const subagents = options.subagents ?? fakeSubagents(options.subagentsOptions)
  const ctx = {
    llm: { registerAdapter: () => () => {} },
    tools: { get: () => undefined, register: (tool) => { ctx.tools.registered.push(tool); return () => {} } },
    commands: { get: () => undefined, register: (command) => { ctx.commands.registered.push(command); return () => {} } },
    subprocess: {
      resolveExecutable: async (path) => path,
      spawn: (spec) => {
        spawned.push(spec)
        return modelsHandle('gemini-3.8-flash-low')
      },
    },
    logger: { warn() {}, debug() {} },
    emit() {},
  }
  ctx.tools.registered = []
  ctx.commands.registered = []
  if (options.subagents !== null) ctx.subagents = subagents
  const config = Config(options.config ?? {})
  apply(ctx, config)
  return { ctx, config, subagents, spawned, tool: ctx.tools.registered[0], command: ctx.commands.registered[0] }
}

/** A subprocess handle shaped like the host's, for `agy models`. */
function modelsHandle(stdout) {
  const stream = { readFrom: () => ({ text: stdout, nextOffset: stdout.length, lossy: false }) }
  return {
    done: Promise.resolve({ exitCode: 0, signal: null }),
    collected: { stdout: stream, stderr: { readFrom: () => ({ text: '', nextOffset: 0, lossy: false }) } },
    terminate() {},
  }
}

test('agy_worker starts a tracked child instead of spawning a bare process', async () => {
  const { tool, subagents, spawned } = mountPlugin()
  assert.equal(tool.name, 'agy_worker')
  const agent = parentAgent()
  const value = await tool.execute({ task: 'fix the build' }, { agent, signal: SIGNAL })

  assert.deepEqual(value, {
    kind: 'activation',
    subagentId: 'child-1',
    provider: 'antigravity',
    label: 'fix the build',
    status: 'started',
  })
  assert.equal(spawned.length, 0, 'the worker must not spawn agy directly')
  const spec = subagents.activations[0]
  assert.equal(spec.provider, 'antigravity')
  assert.equal(spec.label, 'fix the build')
  assert.equal(spec.delivery, 'parent')
  assert.equal(spec.signal, SIGNAL)
  assert.equal(spec.request.parent, agent)
  assert.deepEqual(spec.request.prompt, [{ type: 'text', text: 'fix the build' }])
  assert.equal('cwd' in spec.request, false, 'omitted cwd inherits the parent directory')
})

test('agy_worker forwards an explicit cwd to the activation request', async () => {
  const { tool, subagents } = mountPlugin()
  await tool.execute({ task: 'do it', cwd: '/tmp/other' }, { agent: parentAgent(), signal: SIGNAL })
  assert.equal(subagents.activations[0].request.cwd, '/tmp/other')
})

test('/agy starts a child session and reports the id plus the notice semantics', async () => {
  const { command, subagents, spawned } = mountPlugin()
  const result = await command.handler({ rawInput: 'run the tests', agent: parentAgent(), signal: SIGNAL })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /started Antigravity child session child-1 \(antigravity\)/)
  assert.match(result.text, /completion notice/)
  assert.equal(spawned.length, 0)
  assert.equal(subagents.activations[0].request.prompt[0].text, 'run the tests')
})

test('/agy models still works and is the only direct process', async () => {
  const { command, spawned, subagents } = mountPlugin()
  const result = await command.handler({ rawInput: 'models', agent: parentAgent(), signal: SIGNAL })
  assert.equal(result.kind, 'success')
  assert.match(result.text, /gemini-3\.8-flash-low/)
  assert.equal(spawned.length, 1, 'the models listing spawns the read-only agy models process')
  assert.deepEqual(spawned[0].argv, ['agy', 'models'])
  assert.equal(subagents.activations.length, 0, 'listing starts no child session')
})

test('/agy help and bare /agy print usage without starting a child', async () => {
  const { command, subagents } = mountPlugin()
  for (const rawInput of ['', 'help']) {
    const result = await command.handler({ rawInput, agent: parentAgent(), signal: SIGNAL })
    assert.equal(result.kind, 'success')
    assert.match(result.text, /Usage: \/agy/)
  }
  assert.equal(subagents.activations.length, 0)
})

test('a missing subagent service fails clearly and spawns nothing', async () => {
  const { tool, spawned } = mountPlugin({ subagents: null })
  assert.equal(tool.name, 'agy_worker')
  await assert.rejects(
    () => tool.execute({ task: 'fix the build' }, { agent: parentAgent(), signal: SIGNAL }),
    (error) => {
      assert.ok(error instanceof CliDelegationError)
      assert.match(error.message, /managed child session/)
      assert.match(error.message, /subagent service/)
      assert.match(error.message, /No process was spawned/)
      return true
    },
  )
  assert.equal(spawned.length, 0, 'no fallback bare process')
})

test('a missing registered provider fails clearly and spawns nothing', async () => {
  const { tool, spawned } = mountPlugin({
    subagentsOptions: { providerRegistered: false, ignoreRegistration: true },
  })
  await assert.rejects(
    () => tool.execute({ task: 'fix the build' }, { agent: parentAgent(), signal: SIGNAL }),
    /needs the registered subagent provider "antigravity"/,
  )
  assert.equal(spawned.length, 0)
})

test('the subagent switch off leaves the CLI surfaces mounted but calls fail clearly', async () => {
  const { command, tool, subagents } = mountPlugin({
    config: { subagent: false },
    subagentsOptions: { providerRegistered: false, ignoreRegistration: true },
  })
  assert.ok(tool, 'the tool stays registered so the error is visible')
  const result = await command.handler({ rawInput: 'do it', agent: parentAgent(), signal: SIGNAL })
  assert.equal(result.kind, 'error')
  assert.match(result.text, /subagent provider "antigravity"/)
  assert.equal(subagents.activations.length, 0)
})

test('a missing calling agent is rejected before starting a child', async () => {
  const { tool } = mountPlugin()
  await assert.rejects(
    () => tool.execute({ task: 'do it' }, { signal: SIGNAL }),
    /needs the calling agent/,
  )
})

test('an empty task is rejected before starting a child', async () => {
  const { tool, subagents } = mountPlugin()
  await assert.rejects(
    () => tool.execute({ task: '   ' }, { agent: parentAgent(), signal: SIGNAL }),
    /non-empty task/,
  )
  assert.equal(subagents.activations.length, 0)
})

test('an activation start failure surfaces with its cause', async () => {
  const failure = new Error('provider refused the activation')
  const { tool } = mountPlugin({ subagentsOptions: { failWith: failure } })
  await assert.rejects(
    () => tool.execute({ task: 'do it' }, { agent: parentAgent(), signal: SIGNAL }),
    (error) => {
      assert.ok(error instanceof CliDelegationError)
      assert.match(error.message, /could not start the Antigravity child session/)
      assert.match(error.message, /provider refused the activation/)
      assert.equal(error.cause, failure)
      return true
    },
  )
})

test('label helper keeps a bounded single-line label and the provider name is configurable', () => {
  assert.equal(labelFromPrompt('first line\nsecond line'), 'first line')
  assert.equal(labelFromPrompt('   '), 'agy task')
  const long = 'x'.repeat(200)
  const label = labelFromPrompt(long)
  assert.ok(label.length <= 80)
  assert.match(label, /…$/)
  assert.equal(cliProviderName(reactiveConfig()), DEFAULT_SUBAGENT_PROVIDER)
  assert.equal(cliProviderName(reactiveConfig({ subagentProviderName: 'antigravity-2' })), 'antigravity-2')
})

test('startCliChild returns the activation facts without waiting for the result', async () => {
  const subagents = fakeSubagents()
  const services = { subagents }
  const agent = parentAgent()
  const activation = await startCliChild({ services, config: reactiveConfig(), prompt: 'task', agent, signal: SIGNAL })
  assert.deepEqual(
    { childId: activation.childId, provider: activation.provider, label: activation.label },
    { childId: 'child-1', provider: 'antigravity', label: 'task' },
  )
  assert.equal(subagents.activations[0].delivery, 'parent')
})

test('the registered provider runs agy through the injected subprocess service', async () => {
  const { subagents, spawned } = mountPlugin({ subagentsOptions: { providerRegistered: false } })
  const provider = subagents.providers[0]
  assert.ok(provider, 'the antigravity provider registers')
  assert.equal(provider.name, 'antigravity')
  const run = provider.start({
    cwd: '/tmp/project',
    prompt: [{ type: 'text', text: 'run the child' }],
    signal: SIGNAL,
  })
  assert.equal(spawned.length, 1, 'the provider spawns agy for the child')
  assert.deepEqual(spawned[0].argv.slice(0, 3), ['agy', '-p', 'run the child'])
  const settled = await run.result
  assert.equal(settled.stopReason, 'completed')
  await run.dispose()
})

test('the provider is not registered without the subprocess service', () => {
  const subagents = fakeSubagents()
  const ctx = {
    llm: { registerAdapter: () => () => {} },
    tools: { get: () => undefined, register: () => () => {} },
    commands: { get: () => undefined, register: () => () => {} },
    subagents,
    logger: { warn() {}, debug() {} },
    emit() {},
  }
  apply(ctx, Config({}))
  assert.equal(subagents.providers.length, 0, 'no provider can run agy without subprocess')
})

test('the read-only models listing keeps the documented subprocess handle shape', () => {
  const handle = modelsHandle('gemini-3.8-flash-low')
  assert.equal(typeof handle.done.then, 'function')
  assert.equal(typeof handle.collected.stdout.readFrom, 'function')
  assert.deepEqual(
    Object.keys(handle.collected.stdout.readFrom(0)).sort(),
    ['lossy', 'nextOffset', 'text'],
    'host SubprocessOutputRead carries text, nextOffset and lossy',
  )
})
