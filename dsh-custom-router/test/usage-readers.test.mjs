/**
 * `USAGE_READERS` gate — the CI half of follow-up R4.
 *
 * The gate exists because the name a preset declares (`usage.routes[].normalize`)
 * is joined at RUNTIME against a hand-written table in the browser bundle. An
 * unknown name threw `unknown usage reader: …` only on the operator's dashboard,
 * never in a build or test. These tests pin both directions: the shipped tree
 * passes, and every documented failure class fails with a message naming the
 * preset.
 *
 * `scripts/verify-usage-readers.mjs` runs the same checker as a wired gate.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PRESETS } from '../lib/presets.js'
import {
  BUNDLES,
  checkUsageReaders,
  declaredReaderNames,
  readerIsDefined,
  usageReaderKeys,
} from '../scripts/verify-usage-readers.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const REAL_BUNDLES = Object.fromEntries(BUNDLES.map((file) => [file, readFileSync(join(ROOT, file), 'utf8')]))

/** Replace a preset's routes without touching the shipped declarations. */
function withRoutes(normalize, presetId = 'antigravity') {
  const presets = PRESETS.map((preset) =>
    preset.id !== presetId
      ? preset
      : { ...preset, usage: { ...preset.usage, routes: [{ path: '/api/example', normalize }] } },
  )
  return checkUsageReaders({ presets, bundles: REAL_BUNDLES })
}

test('the shipped tree passes: every declared reader name exists in the table', () => {
  const verdict = checkUsageReaders({ presets: PRESETS, bundles: REAL_BUNDLES })
  assert.deepEqual(verdict.problems, [])
  assert.equal(verdict.checked.presets, 4)
  assert.equal(verdict.checked.routes, 4)
  assert.deepEqual(verdict.checked.readers, ['normalizeAntigravityUsage', 'normalizeOpencodeUsage', 'normalizeDeepinfraUsage'])
})

test('every declared route names a reader, and every reader is declared by a route', () => {
  const declared = declaredReaderNames(PRESETS)
  assert.equal(declared.length, 4)
  assert.ok(declared.every((entry) => typeof entry.normalize === 'string' && entry.normalize.length > 0), JSON.stringify(declared))
  const { keys } = usageReaderKeys(REAL_BUNDLES['lib/client.src.js'])
  assert.deepEqual(new Set(declared.map((entry) => entry.normalize)), new Set(keys))
})

test('both bundles declare the same table, so the artefact cannot go stale silently', () => {
  for (const file of BUNDLES) assert.deepEqual(usageReaderKeys(REAL_BUNDLES[file]).keys, usageReaderKeys(REAL_BUNDLES[BUNDLES[0]]).keys, file)
})

// ------------------------------------------------------------------ mutations

test('mutation: a preset naming an unknown reader FAILS and names the preset', () => {
  const verdict = withRoutes('normalizeNoSuchUsage')
  // Two findings per bundle, by design: the undeclared name AND the table entry
  // it abandoned. Both name the preset or the entry they came from.
  const unknown = verdict.problems.filter((problem) => /normalizeNoSuchUsage/.test(problem))
  assert.equal(unknown.length, BUNDLES.length, JSON.stringify(verdict.problems))
  for (const message of unknown) {
    assert.match(message, /antigravity/, message)
    assert.match(message, /NOT in USAGE_READERS/, message)
  }
  const dead = verdict.problems.filter((problem) => /normalizeAntigravityUsage/.test(problem) && /dead reader/.test(problem))
  assert.equal(dead.length, BUNDLES.length, JSON.stringify(verdict.problems))
})

test('mutation: a near-miss rename (case difference) FAILS', () => {
  for (const name of ['normalizeopencodeusage', 'normalizeOpencodeUsag', 'normalizeOpencodeUsageX']) {
    const verdict = withRoutes(name)
    assert.ok(verdict.problems.length > 0, `${name} must not resolve to a reader`)
  }
})

test('mutation: the original two-way failure survives a whole-preset rename', () => {
  // The real regression: rename the table entry, leave the declaration alone.
  const renamed = { ...REAL_BUNDLES }
  for (const file of BUNDLES) renamed[file] = REAL_BUNDLES[file].replaceAll('normalizeOpencodeUsage:', 'normalizeOpencodeLedger:')
  const verdict = checkUsageReaders({ presets: PRESETS, bundles: renamed })
  assert.ok(verdict.problems.some((problem) => /opencode/.test(problem) && /NOT in USAGE_READERS/.test(problem)), JSON.stringify(verdict.problems))
  assert.ok(verdict.problems.some((problem) => /normalizeOpencodeLedger/.test(problem) && /dead reader/.test(problem)), JSON.stringify(verdict.problems))
})

test('mutation: a table key with no preset behind it FAILS (dead reader)', () => {
  const extra = { ...REAL_BUNDLES }
  for (const file of BUNDLES) extra[file] = REAL_BUNDLES[file].replace('normalizeAntigravityUsage:', 'normalizeGhostUsage: normalizeAntigravityUsage,')
  const verdict = checkUsageReaders({ presets: PRESETS, bundles: extra })
  assert.ok(verdict.problems.some((problem) => /normalizeGhostUsage/.test(problem)), JSON.stringify(verdict.problems))
})

test('mutation: a key pointing at a non-existent helper FAILS', () => {
  const broken = { ...REAL_BUNDLES }
  for (const file of BUNDLES) {
    broken[file] = REAL_BUNDLES[file].replace(
      'normalizeDeepinfraUsage: (payloads) => normalizeDeepinfraUsage(payloads[0]),',
      'normalizeDeepinfraUsage: (payloads) => normalizeDeepinfraCost(payloads[0]),',
    )
  }
  const verdict = checkUsageReaders({ presets: PRESETS, bundles: broken })
  assert.ok(verdict.problems.some((problem) => /normalizeDeepinfraCost/.test(problem)), JSON.stringify(verdict.problems))
})

test('mutation: a stale built bundle FAILS the parity check', () => {
  const stale = { ...REAL_BUNDLES }
  stale['lib/client.js'] = REAL_BUNDLES['lib/client.js'].replace('normalizeDeepinfraUsage:', 'normalizeDeepinfraOld:')
  const verdict = checkUsageReaders({ presets: PRESETS, bundles: stale })
  assert.ok(verdict.problems.some((problem) => /differs from/.test(problem)), JSON.stringify(verdict.problems))
})

test('mutation: a table with no readers FAILS instead of passing vacuously', () => {
  const empty = { 'lib/client.src.js': 'const USAGE_READERS = Object.freeze({})\n', 'lib/client.js': 'const USAGE_READERS = Object.freeze({})\n' }
  const verdict = checkUsageReaders({ presets: PRESETS, bundles: empty })
  assert.ok(verdict.problems.some((problem) => /no reader/.test(problem)), JSON.stringify(verdict.problems))
})

test('mutation: a tree with no declared route FAILS instead of passing vacuously', () => {
  const presets = PRESETS.map((preset) => ({ ...preset, usage: { ...preset.usage, routes: [] } }))
  const verdict = checkUsageReaders({ presets, bundles: REAL_BUNDLES })
  assert.ok(verdict.problems.some((problem) => /vacuous/.test(problem)), JSON.stringify(verdict.problems))
})

test('readerIsDefined accepts both bundle definition shapes and rejects a missing name', () => {
  const source = REAL_BUNDLES['lib/client.src.js']
  assert.equal(readerIsDefined(source, 'normalizeAntigravityUsage'), true)
  assert.equal(readerIsDefined(source, 'normalizeAntigravityUsageMissing'), false)
})
