import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Config, apply as applyHttp } from '../lib/http.js'

/** A cordis-like context: undeclared service reads throw. */
function cordisLike(services) {
  const state = { warnings: [], infos: [], registrations: [] }
  const base = {
    logger: {
      warn: (line) => state.warnings.push(line),
      info: (line) => state.infos.push(line),
      debug: () => {},
    },
    on: () => {},
    get: () => undefined,
    effect: (fn) => { state.effects = (state.effects ?? 0) + 1; return fn },
    ...services,
  }
  const ctx = new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop in target) return target[prop]
      return (() => { throw new Error(`cannot get property "${String(prop)}" without inject`) })()
    },
  })
  return { ctx, state }
}

test('mounting the http entry on a cordis-like context does not throw', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-apply-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const { ctx, state } = cordisLike({
      llm: {
        registerAdapter: (providers) => {
          state.registrations.push(...providers)
          return { dispose: () => {} }
        },
        listProviders: () => [],
      },
      subprocess: {},
      sessions: { get: () => undefined },
      connection: {},
      settings: {},
    })
    assert.doesNotThrow(() => {
      const dispose = applyHttp(ctx, Config({ attachToDaemon: false, spawnServer: false, autoDiscoverModels: false }))
      if (typeof dispose === 'function') dispose()
    })
    assert.deepEqual(state.registrations, ['opencode-http-agent'])
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('modelServing:false releases the route instead of registering', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-apply-off-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const { ctx, state } = cordisLike({
      llm: {
        registerAdapter: (providers) => {
          state.registrations.push(...providers)
          return { dispose: () => {} }
        },
        listProviders: () => [],
      },
      subprocess: {},
      sessions: { get: () => undefined },
      connection: {},
      settings: {},
    })
    const dispose = applyHttp(ctx, Config({
      modelServing: false,
      attachToDaemon: false,
      spawnServer: false,
      autoDiscoverModels: false,
    }))
    if (typeof dispose === 'function') dispose()
    assert.deepEqual(state.registrations, [])
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
