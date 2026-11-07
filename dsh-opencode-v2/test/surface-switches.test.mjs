/**
 * Unified surface switches (2026-11-07): `enabled` is the master, `cli` gates
 * the delegation tool + `/ocode` + `cli_worker`, and `subagent` keeps owning the
 * delegation provider alone. Mirrors `dsh-antigravity`'s switch names.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../lib/index.js'

/** A config object exposing schemastery Volatiles (`.get()` readers). */
function fakeConfig(values = {}) {
  return new Proxy({}, {
    get(_target, key) {
      return { get: () => values[key] }
    },
  })
}

/** Build a host context that records every registration. */
function hostContext() {
  const tools = []
  const commands = []
  const providers = []
  const ctx = {
    tools: {
      get: () => undefined,
      register(definition) { tools.push(definition) },
    },
    logger: { warn() {} },
    subprocess: {},
    inject(services, callback) {
      if (services[0] === 'commands') {
        callback({ commands: { register(definition) { commands.push(definition) } } })
      } else if (services[0] === 'subagents') {
        callback({
          subagents: {
            getProvider: () => undefined,
            registerProvider(provider) { providers.push(provider); return () => {} },
          },
        })
      }
    },
  }
  return { ctx, tools, commands, providers }
}

test('defaults keep all three index surfaces', async () => {
  const { ctx, tools, commands, providers } = hostContext()
  await apply(ctx, fakeConfig({ workerEnabled: true }))
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['cli_worker', 'opencode'])
  assert.deepEqual(commands.map((command) => command.name), ['ocode'])
  assert.equal(providers.length, 1)
})

test('master enabled:false removes every index surface', async () => {
  const { ctx, tools, commands, providers } = hostContext()
  await apply(ctx, fakeConfig({ enabled: false }))
  assert.equal(tools.length, 0)
  assert.equal(commands.length, 0)
  assert.equal(providers.length, 0)
})

test('cli:false removes the tool and /ocode but keeps the subagent provider', async () => {
  const { ctx, tools, commands, providers } = hostContext()
  await apply(ctx, fakeConfig({ cli: false, subagent: true }))
  assert.equal(tools.length, 0)
  assert.equal(commands.length, 0)
  assert.equal(providers.length, 1)
})

test('subagent:false keeps the CLI surface', async () => {
  const { ctx, tools, commands, providers } = hostContext()
  await apply(ctx, fakeConfig({ subagent: false, workerEnabled: true }))
  assert.deepEqual(tools.map((tool) => tool.name).sort(), ['cli_worker', 'opencode'])
  assert.deepEqual(commands.map((command) => command.name), ['ocode'])
  assert.equal(providers.length, 0)
})
