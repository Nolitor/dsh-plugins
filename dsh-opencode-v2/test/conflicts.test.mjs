/**
 * Contract tests for the autonomous-router conflict guard and native mount.
 *
 * No host, no network, no ~/.dsh: the `llm` registry is a small fake that
 * reproduces the measured host semantics (provider ids, DUPLICATE_ADAPTER,
 * `llm/adapters-updated` on registration/release).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CONFLICT_POLICIES,
  LEGACY_OPENCODE_PROVIDERS,
  decideRouterConflict,
  detectRouterConflicts,
  normalizeConflictPolicy,
  registeredProviderIds,
} from '../lib/conflicts.js'
import {
  Config,
  OpencodeHttpAdapter,
  addUsage,
  apply,
  usageFromTokens,
} from '../lib/http.js'
import { DEFAULT_TURN_MAX_TOKENS } from '../lib/shared.js'

function fakeCtx(initialProviders = []) {
  const state = {
    providers: initialProviders.map((id) => ({ id, name: id })),
    registrations: [],
    directory: [],
    warnings: [],
    listeners: new Map(),
    effects: [],
    releases: 0,
  }
  const emit = (event) => {
    for (const listener of state.listeners.get(event) ?? []) listener()
  }
  const ctx = {
    llm: {
      listProviders: () => state.providers.map((provider) => ({ ...provider })),
      registerAdapter(providers, adapter) {
        for (const id of providers) {
          if (state.providers.some((provider) => provider.id === id)) {
            throw new Error(`an adapter for provider "${id}" is already registered`)
          }
          state.providers.push({ id, name: 'OpenCode (HTTP)' })
        }
        state.registrations.push({ providers: [...providers], adapter })
        emit('llm/adapters-updated')
        const release = Object.assign(
          () => {
            state.releases += 1
            state.providers = state.providers.filter((provider) => !providers.includes(provider.id))
            emit('llm/adapters-updated')
          },
          { replace() {} },
        )
        return release
      },
      registerConfigurableProviders(entries) {
        state.directory.push(...entries)
        return () => {}
      },
    },
    on(event, listener) {
      const list = state.listeners.get(event) ?? []
      list.push(listener)
      state.listeners.set(event, list)
    },
    effect(fn) {
      state.effects.push(fn)
    },
    logger: {
      warn: (message) => state.warnings.push(String(message)),
      info: () => {},
    },
    emit: () => {},
    get: () => undefined,
  }
  return { ctx, state, emit }
}

async function withTempDir(fn) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-ocv2-conflicts-'))
  try {
    return await fn(dir)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
}

function configFor(dir, overrides = {}) {
  return Config({
    catalogPath: join(dir, 'oc-models.json'),
    sessionMapPath: join(dir, 'oc-sessions.json'),
    catalogSyncMs: 0,
    autoDiscoverModels: false,
    attachToDaemon: false,
    spawnServer: false,
    ...overrides,
  })
}

test('conflict policy normalizes unknown values to warn', () => {
  assert.deepEqual([...CONFLICT_POLICIES], ['warn', 'stand-down'])
  assert.deepEqual([...LEGACY_OPENCODE_PROVIDERS], ['opencode-go', 'opencode'])
  assert.equal(normalizeConflictPolicy(' warn '), 'warn')
  assert.equal(normalizeConflictPolicy('STAND-DOWN'), 'stand-down')
  assert.equal(normalizeConflictPolicy('takeover'), 'warn')
  assert.equal(normalizeConflictPolicy(undefined), 'warn')
})

test('a broken registry reads as no providers instead of throwing', () => {
  assert.deepEqual(registeredProviderIds({ listProviders: () => { throw new Error('dead') } }), [])
  assert.deepEqual(registeredProviderIds({}), [])
  assert.deepEqual(registeredProviderIds({ listProviders: () => [{ id: 'a' }, { id: 'a' }, {}] }), ['a'])
})

test('detectRouterConflicts separates legacy and self registrations', () => {
  const llm = { listProviders: () => [{ id: 'opencode-go' }, { id: 'deepseek-account' }] }
  const conflict = detectRouterConflicts(llm, 'opencode-http-agent')
  assert.deepEqual(conflict.legacyProviders, ['opencode-go'])
  assert.equal(conflict.ownProviderRegistered, false)

  const own = detectRouterConflicts({ listProviders: () => [{ id: 'opencode-http-agent' }] }, 'opencode-http-agent')
  assert.equal(own.ownProviderRegistered, true)
})

test('decideRouterConflict: clear, warn, stand-down, and hard duplicate', () => {
  const clear = decideRouterConflict({ ownProvider: 'opencode-http-agent', legacyProviders: [], ownProviderRegistered: false }, 'warn')
  assert.equal(clear.action, 'serve')
  assert.equal(clear.warning, null)

  const warn = decideRouterConflict({ ownProvider: 'opencode-http-agent', legacyProviders: ['opencode-go'], ownProviderRegistered: false }, 'warn')
  assert.equal(warn.action, 'serve')
  assert.match(warn.warning, /legacy OpenCode provider "opencode-go"/)
  assert.match(warn.warning, /stand-down/)

  const standDown = decideRouterConflict({ ownProvider: 'opencode-http-agent', legacyProviders: ['opencode', 'opencode-go'], ownProviderRegistered: false }, 'stand-down')
  assert.equal(standDown.action, 'stand-down')
  assert.match(standDown.warning, /yielding the OpenCode namespace/)

  const duplicate = decideRouterConflict({ ownProvider: 'opencode-http-agent', legacyProviders: ['opencode-go'], ownProviderRegistered: true }, 'warn')
  assert.equal(duplicate.action, 'skip')
  assert.equal(duplicate.code, 'DUPLICATE_OWN_PROVIDER')
})

test('apply registers the native adapter when the namespace is clear', async () => {
  await withTempDir(async (dir) => {
    const { ctx, state } = fakeCtx()
    const dispose = apply(ctx, configFor(dir))
    assert.equal(state.registrations.length, 1)
    assert.deepEqual(state.registrations[0].providers, ['opencode-http-agent'])
    assert.equal(state.registrations[0].adapter.standDown, false)
    assert.deepEqual(state.directory.map((entry) => entry.provider), ['opencode-http-agent'])
    assert.deepEqual(state.warnings, [])
    dispose()
    assert.equal(state.releases, 1)
  })
})

test("apply with conflictPolicy 'warn' serves and warns about llm-pi-ai routes", async () => {
  await withTempDir(async (dir) => {
    const { ctx, state } = fakeCtx(['opencode-go', 'opencode'])
    const dispose = apply(ctx, configFor(dir, { conflictPolicy: 'warn' }))
    assert.equal(state.registrations.length, 1)
    assert.ok(state.warnings.some((line) => /legacy OpenCode provider "opencode-go", "opencode"/.test(line)))
    dispose()
  })
})

test("apply with conflictPolicy 'stand-down' yields without registering", async () => {
  await withTempDir(async (dir) => {
    const { ctx, state } = fakeCtx(['opencode-go'])
    const dispose = apply(ctx, configFor(dir, { conflictPolicy: 'stand-down' }))
    assert.equal(state.registrations.length, 0)
    assert.ok(state.warnings.some((line) => /yielding the OpenCode namespace/.test(line)))
    dispose()
  })
})

test('a second instance with the same provider id skips instead of throwing', async () => {
  await withTempDir(async (dir) => {
    const { ctx, state } = fakeCtx(['opencode-http-agent'])
    assert.doesNotThrow(() => {
      const dispose = apply(ctx, configFor(dir))
      dispose()
    })
    assert.equal(state.registrations.length, 0)
    assert.ok(state.warnings.some((line) => /already registered by another instance/.test(line)))
  })
})

test('stand-down reconciles dynamically as the registry changes', async () => {
  await withTempDir(async (dir) => {
    const { ctx, state, emit } = fakeCtx()
    const dispose = apply(ctx, configFor(dir, { conflictPolicy: 'stand-down' }))
    assert.equal(state.registrations.length, 1)

    state.providers.push({ id: 'opencode-go', name: 'opencode-go' })
    emit('llm/adapters-updated')
    assert.equal(state.releases, 1)
    assert.equal(state.registrations[0].adapter.standDown, true)
    assert.ok(state.providers.every((provider) => provider.id !== 'opencode-http-agent'))

    state.providers = state.providers.filter((provider) => provider.id !== 'opencode-go')
    emit('llm/adapters-updated')
    assert.equal(state.registrations.length, 2)
    assert.equal(state.registrations[1].adapter.standDown, false)
    dispose()
  })
})

test('native resolveModel exports OpenCode variants as host reasoning efforts', async () => {
  await withTempDir(async (dir) => {
    const adapter = new OpencodeHttpAdapter({}, configFor(dir, { autoDiscoverModels: true }))
    adapter.discover = async () => ({
      models: [
        {
          id: 'opencode-go/deepseek-v4.1-flash',
          name: 'DeepSeek V4.1 Flash (Go)',
          contextWindow: 1000000,
          maxTokens: 384000,
          variants: ['high', 'low', 'max'],
        },
        {
          id: 'opencode-go/mimo-v2.6-flash',
          name: 'MiMo V2.6 Flash (Go)',
          contextWindow: 1048576,
          maxTokens: 131072,
        },
      ],
    })
    const resolved = await adapter.resolveModel('opencode-http-agent', 'opencode-go/deepseek-v4.1-flash')
    assert.deepEqual(resolved.reasoning.efforts.map((effort) => effort.id), ['low', 'high', 'max'])
    assert.equal(resolved.context.contextWindow, 1000000)
    // Reservation, not capability: see DEFAULT_TURN_MAX_TOKENS.
    assert.equal(resolved.defaultMaxTokens, DEFAULT_TURN_MAX_TOKENS)

    const bare = await adapter.resolveModel('opencode-http-agent', 'opencode-go/mimo-v2.6-flash')
    assert.equal(bare.reasoning, undefined, 'a route without variants advertises no levels')
    adapter.dispose()
  })
})

test('usage aggregation stays disjoint and totals every bucket', () => {
  const first = usageFromTokens({ input: 11, output: 4, reasoning: 9, cache: { read: 4096, write: 0 } })
  assert.deepEqual(first, {
    inputTokens: 11,
    outputTokens: 4,
    reasoningTokens: 9,
    cacheReadTokens: 4096,
    cacheWriteTokens: 0,
    totalTokens: 4120,
  })
  const sum = addUsage(first, usageFromTokens({ input: 2, output: 1, reasoning: 0, cache: { read: 10, write: 5 } }))
  assert.equal(sum.inputTokens, 13)
  assert.equal(sum.outputTokens, 5)
  assert.equal(sum.reasoningTokens, 9)
  assert.equal(sum.cacheReadTokens, 4106)
  assert.equal(sum.cacheWriteTokens, 5)
  assert.equal(sum.totalTokens, 13 + 5 + 9 + 4106 + 5)
})
