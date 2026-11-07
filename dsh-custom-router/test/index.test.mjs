/**
 * Preset application body: the router decides WHICH preset mounts and delegates
 * the mounting to the provider package's own plugin via `ctx.plugin`.
 * It must never register an adapter itself (R0).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, planApplications } from '../lib/index.js'
import { PRESETS } from '../lib/presets.js'

const FIXTURE = new URL('./fixtures/vendor.mjs', import.meta.url).href

/** A cordis-like context recording child mounts. */
function fakeCtx() {
  const mounted = []
  return {
    mounted,
    logger: { warn() {} },
    plugin(plugin, config) {
      const entry = { plugin, config, disposed: false }
      mounted.push(entry)
      return { dispose: () => { entry.disposed = true } }
    },
  }
}

test('nothing mounts unless a preset is explicitly enabled', () => {
  const plan = planApplications({})
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(plan.active, [])
})

test('enabling a preset plans its package as the child plugin', () => {
  const plan = planApplications({ presets: { antigravity: true } })
  assert.deepEqual(plan.errors, [])
  assert.equal(plan.active.length, 1)
  assert.equal(plan.active[0].id, 'antigravity')
  assert.equal(plan.active[0].specifier, '@nolit/dsh-antigravity')
})

test('a package override wins over the declared package', () => {
  const plan = planApplications({ presets: { antigravity: true }, packages: { antigravity: FIXTURE } })
  assert.equal(plan.active[0].specifier, FIXTURE)
})

test('an unknown preset id is a plan error', () => {
  const plan = planApplications({ presets: { 'not-a-provider': true } })
  assert.equal(plan.errors.length, 1)
  assert.match(plan.errors[0], /unknown preset/)
})

test('an invalid declaration is reported through the plan', () => {
  const brokenPreset = structuredClone(PRESETS[0])
  brokenPreset.endpoint.protocol = ''
  const broken = [brokenPreset]
  const plan = planApplications({}, broken)
  assert.equal(plan.errors.length > 0, true)
})

test('apply mounts each active preset once and disposes exactly those children', async () => {
  const ctx = fakeCtx()
  const dispose = await apply(ctx, {
    presets: { antigravity: true, opencode: true },
    packages: { antigravity: FIXTURE, opencode: FIXTURE },
  })
  assert.equal(ctx.mounted.length, 2)
  assert.equal(ctx.mounted[0].config !== undefined, true)
  dispose()
  assert.equal(ctx.mounted.every((entry) => entry.disposed), true)
})

test('strict invalid declarations throw before mounting anything', async () => {
  const ctx = fakeCtx()
  await assert.rejects(
    () => apply(ctx, { presets: { ghost: true } }),
    /invalid preset plan/,
  )
  assert.equal(ctx.mounted.length, 0)
})

test('a mount failure is isolated to that preset', async () => {
  const ctx = fakeCtx()
  const dispose = await apply(ctx, {
    presets: { antigravity: true, opencode: true },
    packages: {
      antigravity: 'file:///nonexistent/vendor.mjs',
      opencode: FIXTURE,
    },
    strict: false,
  })
  assert.equal(ctx.mounted.length, 1)
  dispose()
})

test('the body exports no adapter registration of its own', async () => {
  const source = await import('node:fs/promises').then((fs) => fs.readFile(new URL('../lib/index.js', import.meta.url), 'utf8'))
  // Compare CODE only: the module comment legitimately names the host APIs it refuses to use.
  const code = source
    .split('\n')
    .filter((line) => !/^\s*(\*|\/\*|\/\/)/.test(line))
    .join('\n')
  assert.equal(/registerAdapter/.test(code), false)
  assert.equal(/ctx\.llm/.test(code), false)
})

test('apply provides the runtime seam with routing, probing and merging', async () => {
  const ctx = fakeCtx()
  const provided = []
  ctx.provide = (name, service) => provided.push({ name, service })
  await apply(ctx, {
    presets: { antigravity: true },
    packages: { antigravity: FIXTURE },
    vendorModules: {},
  })
  const seam = provided.find((entry) => entry.name === 'customRouter')
  assert.ok(seam)
  assert.equal(seam.service.route('deepinfra/x').preset.id, 'deepinfra')
  assert.equal(typeof seam.service.probe, 'function')
  assert.equal(typeof seam.service.merge, 'function')
  assert.equal(seam.service.vendorProbes.deepinfra !== undefined, true)
})
