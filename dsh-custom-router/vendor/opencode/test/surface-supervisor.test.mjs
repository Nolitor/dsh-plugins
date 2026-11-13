/**
 * The surface supervisor (BLUEPRINT Phase C1/C2/C6).
 *
 * The defect this suite pins is ledger F-46: the plugin registered its surfaces
 * ONCE, so flipping `cli`/`enabled` in a live session changed nothing until
 * `dsh-web.service` restarted. The supervisor re-runs an idempotent `syncAll`
 * on `app-boot/config-reload`, which is the event the host emits after a
 * settings write is recomposed.
 *
 * What is asserted:
 *   1. `syncAll` is IDEMPOTENT — two reloads do not register a tool twice
 *      (a duplicate tool registration aborts the whole row);
 *   2. a `cli` flip takes effect live, in both directions, with no restart;
 *   3. `enabled:false` withdraws every surface and `enabled:true` restores them;
 *   4. the reload listener is registered and released with the plugin.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { apply } from '../lib/index.js'

/**
 * A config whose volatile values can be CHANGED while the plugin is live.
 *
 * This is the whole point: a real settings write mutates the volatile value and
 * the host then emits `app-boot/config-reload`. A frozen config could not model
 * that, and the pre-supervisor bug was invisible with a frozen one.
 * @param {Record<string, unknown>} values - live switch values.
 * @returns {{config: object, set: (name: string, value: unknown) => void}} config and its mutator.
 */
function liveConfig(values) {
  const state = { ...values }
  const config = new Proxy({}, { get: (_target, key) => ({ get: () => state[key] }) })
  return { config, set: (name, value) => { state[name] = value } }
}

/**
 * A host context that records registrations and lets a test fire an event.
 *
 * `tools` is a real registry with `get()`, so the supervisor's conflict guard
 * and its idempotence can both be exercised; `commands` arrives through
 * deferred injection, exactly like the live host composes it.
 */
function hostContext() {
  const registry = new Map()
  const state = { tools: [], commands: [], providers: [], warnings: [], listeners: new Map(), released: [] }
  const ctx = {
    tools: {
      get: (name) => registry.get(name),
      register(definition) {
        if (registry.has(definition.name)) throw new Error(`tool "${definition.name}" is already registered`)
        registry.set(definition.name, definition)
        state.tools.push(definition.name)
        return () => {
          registry.delete(definition.name)
          state.released.push(definition.name)
        }
      },
    },
    logger: { warn: (message) => state.warnings.push(String(message)) },
    subprocess: {},
    on(event, listener) {
      const list = state.listeners.get(event) ?? []
      list.push(listener)
      state.listeners.set(event, list)
      return () => {
        state.listeners.set(event, (state.listeners.get(event) ?? []).filter((entry) => entry !== listener))
      }
    },
    async emit(event) {
      for (const listener of state.listeners.get(event) ?? []) await listener()
    },
    inject(services, callback) {
      if (services[0] === 'commands') {
        callback({
          commands: {
            register(definition) {
              state.commands.push(definition.name)
              return () => { state.released.push('/' + definition.name) }
            },
          },
        })
      } else if (services[0] === 'subagents') {
        callback({
          subagents: {
            getProvider: () => undefined,
            registerProvider(provider) {
              state.providers.push(provider)
              return () => {}
            },
          },
        })
      }
      // `tools` and `customRouter` deliberately answer nothing: the supervisor
      // must work through the registry it declares and the optional reader.
    },
  }
  return { ctx, state, registry }
}

test('surfaces are claimed exactly once — reloads do not duplicate a registration', async () => {
  const { ctx, state } = hostContext()
  const { config } = liveConfig({ workerEnabled: true })
  await apply(ctx, config)
  assert.deepEqual([...state.tools].sort(), ['cli_worker', 'opencode'])
  assert.deepEqual(state.commands, ['ocode'])

  // Two reloads with an unchanged config: the guard is `parts`, not a hope.
  await ctx.emit('app-boot/config-reload')
  await ctx.emit('app-boot/config-reload')
  assert.deepEqual([...state.tools].sort(), ['cli_worker', 'opencode'], 'no tool may be registered twice')
  assert.deepEqual(state.commands, ['ocode'])
  assert.equal(state.providers.length, 1)
  assert.deepEqual(state.warnings, [])
})

test('F-46: flipping `cli` off and on takes effect live, with no restart', async () => {
  const { ctx, state, registry } = hostContext()
  const { config, set } = liveConfig({ workerEnabled: true })
  await apply(ctx, config)
  assert.ok(registry.has('opencode'))

  // OFF — the delegation tool and `/ocode` leave; the provider stays.
  set('cli', false)
  await ctx.emit('app-boot/config-reload')
  assert.equal(registry.has('opencode'), false, 'the tool must be withdrawn live')
  assert.equal(registry.has('cli_worker'), false, 'the worker belongs to the CLI surface')
  assert.equal(state.providers.length, 1, 'the subagent provider is independent of `cli`')

  // ON again — the same row restores them without a remount.
  set('cli', true)
  await ctx.emit('app-boot/config-reload')
  assert.ok(registry.has('opencode'), 'the tool must come back live')
  assert.ok(registry.has('cli_worker'))
})

test('the master switch withdraws every surface and restores them', async () => {
  const { ctx, state, registry } = hostContext()
  const { config, set } = liveConfig({ workerEnabled: true })
  await apply(ctx, config)

  set('enabled', false)
  await ctx.emit('app-boot/config-reload')
  assert.equal(registry.size, 0, 'nothing may stay registered under the master switch')
  assert.equal(state.commands.length, 1, 'a command is registered once and released, not re-registered')

  set('enabled', true)
  await ctx.emit('app-boot/config-reload')
  assert.deepEqual([...registry.keys()].sort(), ['cli_worker', 'opencode'])
})

test('the reload listener is released with the plugin', async () => {
  const { ctx, state } = hostContext()
  const { config } = liveConfig({ workerEnabled: true })
  const dispose = await apply(ctx, config)
  assert.equal((state.listeners.get('app-boot/config-reload') ?? []).length, 1)
  dispose()
  assert.equal((state.listeners.get('app-boot/config-reload') ?? []).length, 0, 'a disposed plugin must not answer reloads')
  assert.equal(state.tools.filter((name) => state.released.includes(name)).length, state.tools.length, 'every tool is released')
})

test('a duplicate `opencode` tool is yielded, never fatal — and the rest still loads', async () => {
  const { ctx, state, registry } = hostContext()
  // A legacy plugin already owns the name.
  registry.set('opencode', { name: 'opencode' })
  const { config } = liveConfig({ workerEnabled: true })
  await apply(ctx, config)
  assert.deepEqual(state.commands, ['ocode'], 'the command half still loads')
  assert.ok(registry.has('cli_worker'), 'the worker half still loads')
  assert.ok(state.warnings.some((warning) => /already registered/.test(warning)))
})
