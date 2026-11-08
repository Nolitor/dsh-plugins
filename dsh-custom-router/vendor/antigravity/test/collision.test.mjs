/**
 * Coexistence with the older antigravity plugins.
 *
 * The live profile may still mount @nolit/dsh-antigravity-cli, which owns the
 * same /agy command and agy_worker tool. A duplicate name aborts the whole
 * plugin row on the host, so this plugin must YIELD instead of throwing: the
 * model surface and the settings section must still come up.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { Config, apply, PROVIDER_ID } from '../lib/index.js'

test('a pre-existing /agy command and agy_worker tool are yielded, not fatal', () => {
  const registered = { providers: [], commands: [], tools: [], routes: [], warnings: [] }
  const ctx = {
    llm: { registerAdapter: (providers) => { registered.providers.push(...providers); return () => {} } },
    tools: { get: (name) => (name === 'agy_worker' ? { name } : undefined), register: (tool) => { registered.tools.push(tool.name) } },
    commands: { get: (name) => (name === 'agy' ? { name } : undefined), register: (command) => { registered.commands.push(command.name); return () => {} } },
    connection: { fetch: { register: ({ path }) => { registered.routes.push(path); return () => {} } } },
    subprocess: {},
    logger: { warn: (msg) => registered.warnings.push(msg), debug() {} },
    emit() {},
  }
  assert.doesNotThrow(() => apply(ctx, Config({})))
  assert.deepEqual(registered.providers, [PROVIDER_ID], 'model surface still registers')
  assert.deepEqual(registered.commands, [], 'command yielded to the existing owner')
  assert.deepEqual(registered.tools, [], 'tool yielded to the existing owner')
  assert.ok(registered.routes.length > 0, 'settings section still available')
  assert.equal(registered.warnings.length, 2, 'both yields are reported')
})

test('a throwing tool registry does not take the plugin down', () => {
  const ctx = {
    llm: { registerAdapter: () => () => {} },
    tools: { get: () => undefined, register: () => { throw new Error('duplicate tool') } },
    commands: { get: () => undefined, register: () => () => {} },
    connection: { fetch: { register: () => () => {} } },
    subprocess: {},
    logger: { warn() {}, debug() {} },
    emit() {},
  }
  assert.doesNotThrow(() => apply(ctx, Config({})))
})

test('headless profile without connection still serves the model route', () => {
  const providers = []
  const ctx = {
    llm: { registerAdapter: (p) => { providers.push(...p); return () => {} } },
    logger: { warn() {}, debug() {} },
    emit() {},
  }
  assert.doesNotThrow(() => apply(ctx, Config({})))
  assert.deepEqual(providers, [PROVIDER_ID])
})
