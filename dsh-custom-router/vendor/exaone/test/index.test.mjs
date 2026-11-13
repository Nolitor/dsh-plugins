/**
 * EXAONE plugin surface: the registered route, the models-panel route and config
 * defaults.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { Config, PROVIDER_ID, apply, name } from '../lib/index.js'

/** A cordis-shaped host that records registrations and the panel route. */
function fakeCtx({ withConnection = true } = {}) {
  const registered = []
  const routes = []
  const disposers = []
  const ctx = {
    llm: {
      registerAdapter(ids, adapter) {
        registered.push({ ids, adapter })
        return () => {}
      },
    },
    logger: { warn() {} },
    effect(run) {
      const disposer = run()
      if (typeof disposer === 'function') disposers.push(disposer)
      return () => {}
    },
    inject(deps, callback) {
      if (!withConnection || !deps.includes('connection')) return
      const scoped = {
        connection: {
          fetch: {
            register(spec) {
              routes.push(spec)
              return () => {}
            },
          },
        },
        effect(run) { run() },
      }
      callback(scoped)
    },
  }
  return { ctx, registered, routes, disposers }
}

test('the plugin registers exactly the exaone route', () => {
  const { ctx, registered } = fakeCtx()
  apply(ctx, { apiKey: 'k', enabledModels: [] })
  assert.equal(name, 'dsh-exaone')
  assert.equal(PROVIDER_ID, 'exaone')
  assert.equal(registered.length, 1)
  assert.deepEqual(registered[0].ids, ['exaone'])
  assert.equal(registered[0].adapter.providerInfo('exaone').name, 'EXAONE')
})

test('the models route answers the declared model and its enabled state', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx, { apiKey: 'k', enabledModels: [] })
  assert.equal(routes.length, 1)
  assert.equal(routes[0].path, '/api/local/dsh-exaone/models')
  const response = await routes[0].fetch(new Request('http://localhost' + routes[0].path, { method: 'POST', body: '{}' }))
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert.equal(payload.total, 1)
  assert.equal(payload.models[0].id, 'k-exaone_v2.5')
  assert.equal(payload.models[0].contextWindow, 524288)
  assert.equal(payload.models[0].reasoning, true)
  assert.equal(payload.models[0].enabled, true)
})

test('an explicit enabledModels list is reflected in the panel', async () => {
  const { ctx, routes } = fakeCtx()
  apply(ctx, { apiKey: 'k', enabledModels: ['some-other-model'] })
  const payload = await (await routes[0].fetch(new Request('http://localhost' + routes[0].path, { method: 'POST' }))).json()
  assert.equal(payload.models.length, 1)
  assert.equal(payload.models[0].enabled, false)
  assert.deepEqual(payload.enabled, [])
  assert.equal(payload.total, 1)
})

test('the config defaults match the documented platform facts', () => {
  const config = Config({})
  const value = (field) => (field !== null && typeof field === 'object' && typeof field.get === 'function' ? field.get() : field)
  assert.equal(value(config.baseUrl), 'https://api.exaone.ai/v1')
  assert.equal(value(config.apiKey), '')
  assert.equal(value(config.turnMaxTokens), 16384)
  assert.equal(value(config.defaultEffort), 'max')
  assert.deepEqual([...value(config.enabledModels)], [])
})

test('a host without the connection seam still registers the adapter', () => {
  const { ctx, registered, routes } = fakeCtx({ withConnection: false })
  apply(ctx, { apiKey: 'k' })
  assert.equal(registered.length, 1)
  assert.equal(routes.length, 0)
})
