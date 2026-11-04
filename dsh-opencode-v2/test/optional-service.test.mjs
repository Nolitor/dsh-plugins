/**
 * Regression: cordis contexts THROW on an undeclared service read.
 *
 * Measured 2026-11-04 on the live web profile. `dsh-opencode-v2-http` injects
 * `['llm','subprocess','sessions','connection','settings']`; the exclusion guard
 * read `ctx?.tools`. Optional chaining does not help — the throw happens on the
 * property read — so the row died and the profile booted with
 * "dsh: warning: 1 entry did not activate".
 *
 * Every test here uses a proxy that behaves like cordis, because a plain object
 * cannot reproduce the defect (which is exactly why the first version passed the
 * suite and failed in production).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { optionalService, optionalServices } from '../lib/optional-service.js'

/**
 * A cordis-like context: properties present on the target are readable, anything
 * else throws "cannot get property "<name>" without inject".
 *
 * @param {object} services - the services this "plugin" may read.
 * @returns {object} the proxied context.
 */
export function cordisLike(services = {}) {
  return new Proxy(services, {
    get(target, prop) {
      if (typeof prop === 'symbol' || prop in target) return target[prop]
      throw new Error(`cannot get property "${String(prop)}" without inject`)
    },
  })
}

test('a plain object cannot reproduce the cordis defect, a proxy can', () => {
  const services = { logger: console }
  const proxy = cordisLike(services)
  assert.equal(proxy.logger, console)
  assert.throws(() => proxy.tools, /cannot get property "tools" without inject/)
  // Optional chaining does NOT save it — that was the production failure.
  assert.throws(() => proxy?.tools, /without inject/)
})

test('optionalService returns undefined instead of throwing', () => {
  const ctx = cordisLike({ llm: { listProviders: () => [] } })
  assert.equal(optionalService(ctx, 'tools'), undefined)
  assert.deepEqual(optionalService(ctx, 'llm'), { listProviders: ctx.llm.listProviders })
  assert.equal(optionalService(ctx, ''), undefined)
  assert.equal(optionalService(null, 'tools'), undefined)
  assert.equal(optionalService(undefined, 'tools'), undefined)
})

test('optionalServices reads a mixed set without throwing', () => {
  const ctx = cordisLike({ llm: { listProviders: () => [] } })
  const got = optionalServices(ctx, ['llm', 'tools', 'sessions'])
  assert.deepEqual(Object.keys(got).sort(), ['llm', 'sessions', 'tools'])
  assert.equal(got.tools, undefined)
  assert.equal(got.sessions, undefined)
  assert.ok(got.llm)
  assert.deepEqual(optionalServices(ctx, undefined), {})
})

test('a service that is present but null is not confused with a missing one', () => {
  const ctx = cordisLike({ tools: null })
  assert.equal(optionalService(ctx, 'tools'), null)
})
