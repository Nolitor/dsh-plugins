/**
 * Dual-mount guard: the router must never mount one provider twice, and a
 * model-only vendor must never occupy a tool or command name.
 *
 * The measured facts this pins (2026-11-10):
 *   - `vendor/opencode` is the real OpenCode package, owned by the router;
 *     `dsh-opencode-v2` is now only a re-export shim over it;
 *   - a preset's rows all resolve to that preset's own package (or to the host
 *     shared subagent row), so a switch of mount target cannot leave one row
 *     pointing at the old package;
 *   - the vendored copy is `private: true` and reachable only through the
 *     router's `./vendor/opencode*` exports, every one of which exists on disk;
 *   - DeepInfra occupies no tool and no command name, which is precisely what
 *     lets a model slot coexist with CLI surfaces without a registry collision.
 *
 * Deterministic on purpose: JSON files and `existsSync` only — no network, no
 * `~/.dsh` read, no mount.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'

import { PRESETS, TOOL_SUBAGENT_ROW, validateEntries } from '../lib/presets.js'
import { effectiveSurfaceNames } from '../lib/driver/contract.js'
import { DEEPINFRA_DRIVER } from '../vendor/deepinfra/lib/driver.js'

/** The router package root (`dsh-custom-router/`), resolved from this file. */
const ROUTER_ROOT = new URL('../', import.meta.url)
/** The shim track root (`dsh-opencode-v2/`), a sibling of the router. */
const SHIM_ROOT = new URL('../../dsh-opencode-v2/', import.meta.url)

/** Read and parse one JSON file by URL. */
function readJson(url) {
  return JSON.parse(readFileSync(url, 'utf8'))
}

/**
 * Resolve an export target (`./lib/x.js`) against a package root.
 * Accepts both the string form and the `{ default }` condition form.
 */
function targetOf(value) {
  if (typeof value === 'string') return value
  if (value !== null && typeof value === 'object' && typeof value.default === 'string') return value.default
  return undefined
}

/** Turn one export target into an absolute URL under `root`. */
function resolveTarget(root, target) {
  return new URL(target.replace(/^\.\//, ''), root)
}

/** The measured presets keyed by id, for readable failure messages. */
const presetIds = PRESETS.map((preset) => preset.id)

test('preset ids are unique', () => {
  assert.ok(PRESETS.length > 0, 'at least one preset is declared')
  for (const preset of PRESETS) {
    assert.equal(typeof preset.id, 'string', 'every preset names an id')
    assert.notEqual(preset.id, '', 'a preset id is never empty')
  }

  const duplicates = presetIds.filter((id, index) => presetIds.indexOf(id) !== index)
  assert.deepEqual(duplicates, [], `duplicate preset ids: ${duplicates.join(', ')}`)
  assert.equal(new Set(presetIds).size, presetIds.length)
})

test('entry row ids are unique within each preset and validate cleanly', () => {
  for (const preset of PRESETS) {
    assert.ok(Array.isArray(preset.entries), `${preset.id}: entries is an array`)

    const rows = preset.entries.map((entry) => entry.row)
    const duplicates = rows.filter((row, index) => rows.indexOf(row) !== index)
    assert.deepEqual(duplicates, [], `${preset.id}: entry rows declared twice: ${duplicates.join(', ')}`)
    assert.equal(new Set(rows).size, rows.length, `${preset.id}: entry rows are unique`)

    // Same rule as the module's own validator, so the guard fails with the
    // contract's wording if the head count or shape ever drifts.
    assert.deepEqual(validateEntries(preset), [], `${preset.id}: validateEntries must accept the preset`)
  }
})

test('no two presets declare the same package', () => {
  const declared = PRESETS.map((preset) => preset.package)
  for (const [index, pkg] of declared.entries()) {
    assert.equal(typeof pkg, 'string', `${presetIds[index]}: package is a string`)
    assert.notEqual(pkg, '', `${presetIds[index]}: package is non-empty`)
  }

  const duplicates = declared.filter((pkg, index) => declared.indexOf(pkg) !== index)
  assert.deepEqual(
    duplicates,
    [],
    `two presets mount the same package, so one provider would mount twice: ${[...new Set(duplicates)].join(', ')}`,
  )
  assert.equal(new Set(declared).size, declared.length)
})

test('the opencode preset anchors every row on its own package or the host row', () => {
  const preset = PRESETS.find((candidate) => candidate.id === 'opencode')
  assert.ok(preset, 'the opencode preset is declared')
  assert.equal(TOOL_SUBAGENT_ROW, '@deepseek-ai/dsh-tool-subagent', 'the host shared row id is pinned')

  for (const entry of preset.entries) {
    // An omitted specifier defaults to the preset's own package; normalise it
    // here so the rule reads the same as the mount loop does.
    const specifier = typeof entry.specifier === 'string' && entry.specifier !== ''
      ? entry.specifier
      : preset.package

    const onOwnPackage = specifier === preset.package
    const onOwnSubpath = specifier.startsWith(`${preset.package}/`)
    const onHostRow = specifier === TOOL_SUBAGENT_ROW

    assert.ok(
      onOwnPackage || onOwnSubpath || onHostRow,
      `row "${entry.row}" points at "${specifier}", outside "${preset.package}" — a half-switched mount`,
    )
  }
})

test('router exports expose the vendored opencode package and the driver contract, and every target exists', () => {
  const pkg = readJson(new URL('package.json', ROUTER_ROOT))
  assert.equal(pkg.name, '@nolit/dsh-custom-router', 'the router package identity is pinned')

  const exportsMap = pkg.exports ?? {}
  for (const key of ['./vendor/opencode', './vendor/opencode/http', './driver/contract']) {
    assert.ok(key in exportsMap, `package.json exports is missing "${key}"`)
  }

  const vendorEntries = Object.entries(exportsMap).filter(([key]) => key.startsWith('./vendor/opencode'))
  assert.ok(vendorEntries.length > 0, 'the vendored opencode package is exported')

  for (const [key, value] of vendorEntries) {
    const target = targetOf(value)
    assert.equal(typeof target, 'string', `export "${key}" has no default target`)
    assert.ok(target.startsWith('./'), `export "${key}" target must be a relative path, got "${target}"`)

    const absolute = resolveTarget(ROUTER_ROOT, target)
    assert.ok(existsSync(absolute), `export "${key}" targets "${target}", which does not exist on disk`)
  }
})

test('the vendored opencode package is private and never published separately', () => {
  const pkg = readJson(new URL('vendor/opencode/package.json', ROUTER_ROOT))
  assert.equal(pkg.private, true, 'vendor/opencode must stay private: it ships inside the router')
  assert.equal(typeof pkg.name, 'string', 'the vendored package still declares its name')
})

test('the dsh-opencode-v2 shim re-exports only existing lib modules', () => {
  const pkg = readJson(new URL('package.json', SHIM_ROOT))
  assert.equal(pkg.name, '@nolit/dsh-opencode-v2', 'the shim package identity is pinned')

  const exportsMap = pkg.exports ?? {}
  const libExports = Object.entries(exportsMap)
    .map(([key, value]) => ({ key, target: targetOf(value) }))
    .filter(({ target }) => typeof target === 'string' && /^\.\/lib\/[^/]+\.js$/.test(target))

  assert.equal(libExports.length, 7, 'the shim re-exports exactly seven lib modules')

  for (const { key, target } of libExports) {
    const absolute = resolveTarget(SHIM_ROOT, target)
    assert.ok(existsSync(absolute), `shim export "${key}" targets "${target}", which does not exist on disk`)

    // The shim is a re-export by definition: a lib file that starts holding its
    // own copy is the drift this guard exists to catch.
    const source = readFileSync(absolute, 'utf8')
    assert.match(
      source,
      /^export \* from '@nolit\/dsh-custom-router\/vendor\/opencode/,
      `shim module "${target}" is not a re-export of the vendored package`,
    )
  }
})

test('every shim export target exists, including the locale JSON', () => {
  const pkg = readJson(new URL('package.json', SHIM_ROOT))
  for (const [key, value] of Object.entries(pkg.exports ?? {})) {
    const target = targetOf(value)
    if (typeof target !== 'string') continue
    assert.ok(existsSync(resolveTarget(SHIM_ROOT, target)), `shim export "${key}" -> "${target}" is missing`)
  }
})

test('the shim locale copies do not drift from the vendored locale', () => {
  for (const name of ['en.json', 'ko.json']) {
    const fromShim = readJson(new URL(`locale/${name}`, SHIM_ROOT))
    const fromVendor = readJson(new URL(`vendor/opencode/locale/${name}`, ROUTER_ROOT))
    assert.deepEqual(fromShim, fromVendor, `${name} drifted between the shim and the vendored copy`)
  }
})

test('the model-only DeepInfra vendor occupies no tool or command name', () => {
  assert.equal(DEEPINFRA_DRIVER.id, 'deepinfra', 'the driver identity is pinned')

  // The property that lets a model slot coexist with CLI surfaces: a driver
  // that names no tool and no command cannot collide in either registry.
  assert.deepEqual(effectiveSurfaceNames(DEEPINFRA_DRIVER), { tools: [], commands: [] })

  const preset = PRESETS.find((candidate) => candidate.id === DEEPINFRA_DRIVER.id)
  assert.ok(preset, 'a preset owns the same id as the driver')
  assert.deepEqual([...preset.surfaces.tools], [], 'the DeepInfra preset declares no tool')
  assert.deepEqual([...preset.surfaces.commands], [], 'the DeepInfra preset declares no command')
})
