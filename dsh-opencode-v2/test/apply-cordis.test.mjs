/**
 * Entry-level regression: `apply()` must survive a cordis-like context.
 *
 * The unit tests around `optionalService` prove the helper works. This file proves
 * the ENTRY uses it — i.e. that mounting `dsh-opencode-v2-http` on a context which
 * throws for undeclared services no longer takes the row down.
 *
 * Measured 2026-11-04: the live profile booted with
 * "dsh: warning: 1 entry did not activate / dsh-opencode-v2-http:
 *  Error: cannot get property \"tools\" without inject".
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Config, apply as applyHttp } from '../lib/http.js'
import { apply as applyBeta } from '../../dsh-opencode-v2-beta/lib/index.js'

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
    // `ctx.get(name)` is a METHOD on the cordis context itself
    // (ReflectService.get), not a service — it is readable without `inject` and
    // returns undefined for an unknown name.
    get: () => undefined,
    // `ctx.effect(fn, label)` is core cordis machinery (lifecycle), readable
    // without `inject` — the same class of member as `on`/`get`.
    effect: (fn) => { state.effects = (state.effects ?? 0) + 1; return fn },
    ...services,
  }
  const ctx = new Proxy(base, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop in target) return target[prop]
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  })
  return { ctx, state }
}

function isolatedHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-apply-'))
  return home
}

test('mounting the http entry on a cordis-like context does not throw', () => {
  const home = isolatedHome()
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    // Exactly the services the entry injects; `tools` is deliberately absent,
    // because it is not in its `inject` list.
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

test('the beta entry survives a context that provides NO services at all', () => {
  const home = isolatedHome()
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = home
  try {
    const { ctx, state } = cordisLike({})
    assert.doesNotThrow(() => applyBeta(ctx, {}))
    // It either activates and reports, or stands down with a warning — never throws.
    assert.ok(state.infos.length + state.warnings.length > 0, 'the entry must say what it did')
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})
