/**
 * Disable semantics.
 *
 * The requirement is that switching a surface off REMOVES it rather than hiding
 * a broken thing: no provider route, no command, no tool, no panel routes. These
 * tests mount the plugin against a mock cordis context and assert what was
 * registered with each switch combination.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config, apply, PROVIDER_ID } from '../lib/index.js'

/** Build a mock context recording every registration. */
function mockContext() {
  const registered = { providers: [], tools: [], commands: [], routes: [], subagents: [] }
  const ctx = {
    subagents: { registerProvider: (provider) => { registered.subagents.push(provider.name); return () => {} } },
    llm: { registerAdapter: (providers) => { registered.providers.push(...providers); return () => {} } },
    tools: { get: () => undefined, register: (tool) => { registered.tools.push(tool.name) } },
    commands: { get: () => undefined, register: (command) => { registered.commands.push(command.name); return () => {} } },
    connection: {
      fetch: {
        register: ({ path }) => { registered.routes.push(path); return () => {} },
      },
    },
    subprocess: { resolveExecutable: async () => 'agy', spawn: () => { throw new Error('not used') } },
    logger: { warn() {}, debug() {} },
    emit() {},
  }
  return { ctx, registered }
}

/** Apply with a config built from overrides. */
function mount(overrides) {
  const { ctx, registered } = mockContext()
  const config = Config({ ...overrides })
  apply(ctx, config)
  return registered
}

test('all switches on registers every surface', () => {
  const r = mount({})
  assert.deepEqual(r.providers, [PROVIDER_ID])
  assert.ok(r.commands.includes('agy'))
  assert.ok(r.tools.includes('agy_worker'))
  assert.ok(r.routes.length > 0)
  assert.deepEqual(r.subagents, ['antigravity'], 'the delegation provider registers')
})

test('master off removes every surface', () => {
  const r = mount({ enabled: false })
  assert.deepEqual(r.providers, [], 'no provider route when disabled')
  assert.deepEqual(r.commands, [], 'no /agy command when disabled')
  assert.deepEqual(r.tools, [], 'no agy_worker tool when disabled')
  assert.deepEqual(r.routes, [], 'no panel routes when disabled')
  assert.deepEqual(r.subagents, [], 'no subagent provider when disabled')
})

test('subagent off removes only the delegation provider', () => {
  const r = mount({ subagent: false })
  assert.deepEqual(r.subagents, [])
  assert.deepEqual(r.providers, [PROVIDER_ID], 'the model route stays')
  assert.ok(r.commands.includes('agy'), 'the CLI stays')
})

test('modelServing off removes only the route', () => {
  const r = mount({ modelServing: false })
  assert.deepEqual(r.providers, [])
  assert.ok(r.commands.includes('agy'), 'CLI surface stays')
  assert.ok(r.routes.length > 0, 'panel still needed for the switch itself')
})

test('cliWorker off removes only the command and tool', () => {
  const r = mount({ cliWorker: false })
  assert.deepEqual(r.providers, [PROVIDER_ID], 'model surface stays')
  assert.deepEqual(r.commands, [])
  assert.deepEqual(r.tools, [])
})

test('usagePill off keeps routes so the section can still toggle it back', () => {
  const r = mount({ usagePill: false })
  assert.ok(r.routes.length > 0)
  assert.deepEqual(r.providers, [PROVIDER_ID])
})

test('workerEnabled off removes the tool but keeps the command', () => {
  const r = mount({ workerEnabled: false })
  assert.deepEqual(r.tools, [])
  assert.ok(r.commands.includes('agy'))
})

test('disposer releases every registered surface', () => {
  let released = 0
  const ctx = {
    llm: { registerAdapter: () => () => { released += 1 } },
    tools: { get: () => undefined, register: () => {} },
    commands: { get: () => undefined, register: () => () => { released += 1 } },
    connection: { fetch: { register: () => () => { released += 1 } } },
    subprocess: {},
    logger: { warn() {} },
    emit() {},
  }
  const dispose = apply(ctx, Config({}))
  assert.equal(typeof dispose, 'function')
  dispose()
  assert.ok(released >= 3, 'each surface released once')
})
