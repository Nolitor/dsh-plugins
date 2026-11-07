/**
 * Preset application body: the router decides WHICH preset mounts and delegates
 * the mounting to the provider package's own plugin via `ctx.plugin`.
 * It must never register an adapter itself (R0).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { apply, entryConfig, planApplications, presetEntries } from '../lib/index.js'
import { PRESETS } from '../lib/presets.js'

const FIXTURE = new URL('./fixtures/vendor.mjs', import.meta.url).href
const BOOM = new URL('./fixtures/vendor-boom.mjs', import.meta.url).href

/**
 * A cordis-like context recording child mounts.
 *
 * `plugin()` mirrors the MEASURED cordis 4.0.5 behavior rather than a friendly
 * simplification: it returns a thenable fiber and never throws for an
 * asynchronous apply failure. The fiber settles at state 3 and only `await
 * fiber` / `fiber.await()` rethrows. Without that fidelity the mount seam's
 * real defect (a dead try/catch) cannot be tested at all.
 * @param {object} [options] - `{ startedBundles? }` exposed through `get('profileContext')`.
 * @returns {object} the fake context.
 */
function fakeCtx({ startedBundles } = {}) {
  const mounted = []
  const warnings = []
  return {
    mounted,
    warnings,
    logger: { warn: (message) => warnings.push(String(message)) },
    get: (service) => (service === 'profileContext' && startedBundles !== undefined
      ? { name: 'fake', startedBundles }
      : undefined),
    plugin(plugin, config) {
      const entry = { plugin, config, disposed: false, disposeCalls: 0, state: 1 }
      const applyFn = typeof plugin === 'function' ? plugin : plugin?.apply
      const settled = Promise.resolve()
        .then(() => applyFn.call(plugin, {}, config))
        .then(
          () => { entry.state = 2 },
          (error) => { entry.state = 3; throw error },
        )
      // A failed child rejects `settled`; the mount loop may legitimately finish
      // with nobody awaiting a rejected entry, so mark it as observed.
      settled.catch(() => {})
      // Mirror cordis exactly: the RAW fiber is not thenable (only `await()`
      // and `dispose()`), and `ctx.plugin()` returns a separate thenable
      // WRAPPER. Making the raw object thenable is an infinite self-resolution
      // loop — measured as an OOM, not a test failure.
      const raw = {
        get state() { return entry.state },
        await: () => settled.then(() => raw),
        dispose: () => {
          entry.disposed = true
          entry.disposeCalls += 1
          entry.state = 4
        },
      }
      const wrapped = Object.create(raw)
      wrapped.then = (onFulfilled, onRejected) => raw.await().then(onFulfilled, onRejected)
      entry.fiber = raw
      mounted.push(entry)
      return wrapped
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
    // antigravity mounts 2 rows, opencode 3. `packages` swaps each preset's own
    // package; the shared host rows resolve through the injected resolver so the
    // suite never depends on this machine's install tree.
    resolve: () => FIXTURE,
  })
  assert.equal(ctx.mounted.length, 5)
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

test('a mount failure is isolated to that row', async () => {
  const ctx = fakeCtx()
  const dispose = await apply(ctx, {
    presets: { antigravity: true },
    packages: { antigravity: FIXTURE },
    // The first row resolves to the fixture; the second (the shared subagent
    // row) is unresolvable, so exactly one child mounts.
    resolve: (_anchor, specifier) => {
      if (specifier === '@nolit/dsh-antigravity') return FIXTURE
      throw new Error(`Cannot find module '${specifier}'`)
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
    resolve: () => FIXTURE,
    vendorModules: {},
  })
  const seam = provided.find((entry) => entry.name === 'customRouter')
  assert.ok(seam)
  assert.equal(seam.service.route('deepinfra/x').preset.id, 'deepinfra')
  assert.equal(typeof seam.service.probe, 'function')
  assert.equal(typeof seam.service.merge, 'function')
  assert.equal(seam.service.vendorProbes.deepinfra !== undefined, true)
})

// ---- entries: multi-row mounting, row-keyed config (2026-11-07) ------------

test('the plan expands a multi-row preset into one row per entry', () => {
  const plan = planApplications({ presets: { opencode: true } })
  assert.deepEqual(plan.errors, [])
  assert.deepEqual(plan.rows.map((row) => row.row), [
    'dsh-opencode-v2',
    'dsh-opencode-v2-http',
    'tool-subagent-opencode',
  ])
  // The preset-level package/row stay for back-compat.
  assert.equal(plan.active[0].specifier, '@nolit/dsh-opencode-v2')
})

test('mount config is looked up by entry.row, not by preset id', () => {
  // The measured live shape: the two opencode rows carry DIFFERENT configs, and
  // the /http row is the one with opencodePath/cwd/defaultModel.
  const vendorConfig = {
    'dsh-opencode-v2': { opencodePath: '/index/opencode' },
    'dsh-opencode-v2-http': { opencodePath: '/http/opencode', defaultModel: 'opencode-go/minimax-m3.1-flash' },
  }
  const plan = planApplications({ presets: { opencode: true }, vendorConfig })
  const byRow = new Map(plan.rows.map((row) => [row.row, row.config]))
  assert.equal(byRow.get('dsh-opencode-v2').opencodePath, '/index/opencode')
  assert.equal(byRow.get('dsh-opencode-v2-http').opencodePath, '/http/opencode')
  assert.equal(byRow.get('dsh-opencode-v2-http').defaultModel, 'opencode-go/minimax-m3.1-flash')
  // The shared subagent row takes its declared config when the profile is silent.
  assert.equal(byRow.get('tool-subagent-opencode').toolName, 'subagent_opencode')
})

test('declared entry config and live row config merge, live winning', () => {
  const merged = entryConfig(
    { row: 'tool-subagent-opencode', config: { provider: 'opencode', toolName: 'subagent_opencode', maxDepth: 'provider-managed' } },
    { 'tool-subagent-opencode': { toolName: 'subagent_custom', modelSelection: true, provider: undefined } },
  )
  assert.equal(merged.provider, 'opencode')
  assert.equal(merged.toolName, 'subagent_custom')
  assert.equal(merged.maxDepth, 'provider-managed')
  assert.equal(merged.modelSelection, true)
  // An undefined live value must not erase a declared default.
  assert.equal(merged.provider, 'opencode')
})

test('a preset without entries mounts its own package as one row', () => {
  const legacy = structuredClone(PRESETS[2])
  delete legacy.entries
  assert.deepEqual(presetEntries(legacy), [{ row: legacy.row, specifier: legacy.package, config: {} }])
  assert.deepEqual(presetEntries({ kind: 'declaration', row: 'x', entries: [] }), [])
})

test('apply mounts every row of a multi-row preset', async () => {
  const ctx = fakeCtx()
  const dispose = await apply(ctx, {
    presets: { opencode: true },
    resolve: () => FIXTURE,
    vendorModules: {},
    vendorConfig: { 'dsh-opencode-v2-http': { opencodePath: '/http/opencode' } },
  })
  assert.equal(ctx.mounted.length, 3)
  const configs = ctx.mounted.map((entry) => entry.config)
  assert.equal(configs[1].opencodePath, '/http/opencode')
  assert.equal(configs[2].toolName, 'subagent_opencode')
  dispose()
  assert.equal(ctx.mounted.every((entry) => entry.disposed), true)
})

test('the probe seam defaults baseUrl from the preset endpoint', async () => {
  const ctx = fakeCtx()
  const provided = []
  ctx.provide = (name, service) => provided.push({ name, service })
  await apply(ctx, {
    presets: { deepinfra: true },
    resolve: () => FIXTURE,
    vendorModules: {},
    vendorConfig: { deepinfra: { apiKey: 'k' } },
  })
  const seam = provided.find((entry) => entry.name === 'customRouter').service
  const seen = []
  const fetchImpl = async (url) => {
    seen.push(url)
    return { ok: true, status: 200, async json() { return { data: [{ id: 'deepinfra-1' }] } } }
  }
  const preset = seam.presets.find((item) => item.id === 'deepinfra')
  const result = await seam.probe(preset, { fetchImpl })
  // Before this default the generic executor failed with
  // `INVALID_PROBE: probe needs a baseUrl` and reported 0 models.
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.models.map((model) => model.id), ['deepinfra-1'])
  assert.equal(seen[0].startsWith('https://api.deepinfra.com/v1/openai/models'), true)
})

// ---- mount seam: activation failures, idempotent disposal (2026-11-08) ------

test('a child whose apply throws is reported and does not abort the remaining rows', async () => {
  const ctx = fakeCtx()
  // Row 1 of antigravity is its own package; row 2 is the shared subagent row.
  // Both resolve to the throwing fixture, so the first failure must not swallow
  // row 2 — and a SECOND preset after it must still mount.
  const dispose = await apply(ctx, {
    presets: { antigravity: true, deepinfra: true },
    resolve: () => BOOM,
    vendorModules: {},
  })
  assert.equal(ctx.mounted.length, 3) // two antigravity rows + one deepinfra row
  assert.equal(ctx.mounted.every((entry) => entry.state === 3), true)
  assert.equal(
    ctx.warnings.filter((line) => /failed to mount: duplicate provider registration/.test(line)).length,
    3,
  )
  // A failed child is not an active one: it must never join the disposer.
  dispose()
  assert.equal(ctx.mounted.every((entry) => entry.disposeCalls === 0), true)
})

test('a partially failed row set releases only the children that mounted', async () => {
  const ctx = fakeCtx()
  // The preset's own row mounts; the /http row fails; the shared row mounts
  // again. Only rows 1 and 3 may be disposed.
  const dispose = await apply(ctx, {
    presets: { opencode: true },
    resolve: (_anchor, specifier) => (specifier === '@nolit/dsh-opencode-v2/http' ? BOOM : FIXTURE),
    vendorModules: {},
  })
  assert.equal(ctx.mounted.length, 3)
  assert.deepEqual(ctx.mounted.map((entry) => entry.state), [2, 3, 2])
  dispose()
  assert.deepEqual(ctx.mounted.map((entry) => entry.disposeCalls), [1, 0, 1])
})

test('dispose is idempotent and releases children in reverse mount order', async () => {
  const ctx = fakeCtx()
  const order = []
  const originalPlugin = ctx.plugin
  ctx.plugin = (plugin, config) => {
    const index = ctx.mounted.length // the index this child will occupy
    const fiber = originalPlugin(plugin, config)
    const inherited = fiber.dispose
    fiber.dispose = () => {
      order.push(index)
      return inherited()
    }
    return fiber
  }
  const dispose = await apply(ctx, {
    presets: { opencode: true },
    resolve: () => FIXTURE,
    vendorModules: {},
  })
  assert.equal(ctx.mounted.length, 3)
  dispose()
  // Reverse mount order: the LAST mounted child is released first.
  assert.deepEqual(order, [2, 1, 0])
  dispose() // a second call is a no-op, not a second dispose of each child
  dispose()
  assert.deepEqual(ctx.mounted.map((entry) => entry.disposeCalls), [1, 1, 1])
  assert.deepEqual(order, [2, 1, 0])
})

test('a dispose failure is reported and does not stop the other rows', async () => {
  const ctx = fakeCtx()
  const dispose = await apply(ctx, {
    presets: { opencode: true },
    resolve: () => FIXTURE,
    vendorModules: {},
  })
  // The middle child throws on dispose.
  ctx.mounted[1].fiber.dispose = () => {
    ctx.mounted[1].disposeCalls += 1
    throw new Error('namespace already gone')
  }
  dispose()
  assert.equal(ctx.mounted.every((entry) => entry.disposeCalls === 1), true)
  assert.match(ctx.warnings.join('\n'), /failed to dispose: namespace already gone/)
})

// ---- config merge: reactive slots and the rc.2 fallback (2026-11-08) -------

test('a reactive config slot is passed through by identity, not spread into garbage', () => {
  // Measured Cordis shape: `{ get(values), [write](value) }`. Spreading it made
  // the child receive `{ get: <fn> }` as its own config — the wrapped values
  // were gone entirely.
  const reactive = { get: () => ({ opencodePath: '/live/opencode' }), [Symbol.for('write')](value) {} }
  const merged = entryConfig({ row: 'dsh-opencode-v2', config: { declared: true } }, { 'dsh-opencode-v2': reactive })
  assert.equal(merged, reactive)
  assert.equal(typeof merged.get, 'function')
  assert.deepEqual(merged.get(), { opencodePath: '/live/opencode' })
  // The garbage shape the defect produced must not come back.
  assert.equal(Object.hasOwn(merged, 'get') && Object.keys(merged).length > 1, false)
})

test('only plain objects are merged; a declared default survives a silent profile', () => {
  assert.deepEqual(
    entryConfig({ row: 'r', config: { provider: 'p', toolName: 't' } }, { r: { toolName: 'live' } }),
    { provider: 'p', toolName: 'live' },
  )
  assert.deepEqual(entryConfig({ row: 'r', config: { provider: 'p' } }, {}), { provider: 'p' })
  assert.deepEqual(entryConfig({ row: 'r', config: null }, null), {})
})

test('active[].config prefers the row key and falls back to the rc.2 preset-id key', () => {
  // Row key wins (the measured shape).
  const byRow = planApplications({ presets: { opencode: true }, vendorConfig: { 'dsh-opencode-v2': { opencodePath: '/row' } } })
  assert.deepEqual(byRow.active[0].config, { opencodePath: '/row' })

  // rc.2 back-compat: only the preset-id key exists, and it must still surface.
  const legacy = planApplications({ presets: { opencode: true }, vendorConfig: { opencode: { opencodePath: '/legacy' } } })
  assert.deepEqual(legacy.active[0].config, { opencodePath: '/legacy' })

  // Both present: the row key wins, the preset-id slot is only the fallback.
  const both = planApplications({
    presets: { opencode: true },
    vendorConfig: { 'dsh-opencode-v2': { opencodePath: '/row' }, opencode: { opencodePath: '/legacy' } },
  })
  assert.deepEqual(both.active[0].config, { opencodePath: '/row' })

  // A reactive slot passes through here too.
  const reactive = { get: () => ({ opencodePath: '/live' }) }
  const live = planApplications({ presets: { opencode: true }, vendorConfig: { 'dsh-opencode-v2': reactive } })
  assert.equal(live.active[0].config, reactive)
})

// ---- duplicate-mount guard: startedBundles (2026-11-08) -------------------

test('a preset already started as a bundle is skipped with a warning; the rest mount', async () => {
  // Measured live shape: the web profile lists '@nolit/dsh-antigravity'. A
  // partial live-profile edit can therefore leave the vendor bundle enabled
  // while this router also mounts it — a duplicate registration.
  const ctx = fakeCtx({ startedBundles: ['@nolit/dsh-base', '@nolit/dsh-antigravity'] })
  const dispose = await apply(ctx, {
    presets: { antigravity: true, opencode: true, deepinfra: true },
    resolve: () => FIXTURE,
    vendorModules: {},
  })
  // antigravity's own row is skipped; its SHARED subagent row is a different
  // package ('@deepseek-ai/dsh-tool-subagent'), so it still mounts. opencode's
  // three rows and deepinfra's one also mount: 5 in total.
  assert.equal(ctx.mounted.length, 5)
  const skipped = ctx.warnings.filter((line) => /already a started bundle/.test(line))
  assert.equal(skipped.length, 1)
  assert.match(skipped[0], /"@nolit\/dsh-antigravity" is already a started bundle/)
  assert.match(skipped[0], /row "dsh-antigravity"/)
  dispose()
  assert.equal(ctx.mounted.every((entry) => entry.disposed), true)
})

test('a subpath specifier of a started bundle is skipped too', async () => {
  // '@nolit/dsh-opencode-v2/http' belongs to the '@nolit/dsh-opencode-v2' bundle:
  // a prefix match, not an equality match.
  const ctx = fakeCtx({ startedBundles: ['@nolit/dsh-opencode-v2'] })
  await apply(ctx, {
    presets: { opencode: true },
    resolve: () => FIXTURE,
    vendorModules: {},
  })
  // Both vendor rows are skipped (exact and subpath). The shared subagent row
  // is a different package and mounts.
  assert.equal(ctx.mounted.length, 1)
  const skipped = ctx.warnings.filter((line) => /already a started bundle/.test(line))
  assert.equal(skipped.length, 2)
  assert.match(ctx.warnings.join('\n'), /row "dsh-opencode-v2" of preset "opencode" skipped/)
  assert.match(ctx.warnings.join('\n'), /row "dsh-opencode-v2-http" of preset "opencode" skipped/)
  assert.match(ctx.warnings.join('\n'), /"@nolit\/dsh-opencode-v2" is already a started bundle/)
})

test('an unrelated started bundle does not block any row', async () => {
  const ctx = fakeCtx({ startedBundles: ['@deepseek-ai/dsh-base', '@nolit/dsh-notify'] })
  await apply(ctx, { presets: { deepinfra: true }, resolve: () => FIXTURE, vendorModules: {} })
  assert.equal(ctx.mounted.length, 1)
  assert.equal(ctx.warnings.filter((line) => /started bundle/.test(line)).length, 0)
})
