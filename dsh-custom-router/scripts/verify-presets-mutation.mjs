#!/usr/bin/env node
/**
 * Mutation harness for the preset drift gate.
 *
 * WHY THIS EXISTS
 * A drift gate is only worth its runtime if it FAILS on the drift it claims to
 * cover. `verify-presets.mjs` boots a live profile, so proving that property by
 * editing real files would mean corrupting a mounted plugin five times over.
 * This harness instead injects each documented drift class into an in-memory
 * copy of the two registries and asserts that the static half of the gate —
 * `checkPresetRegistry()` — reports it.
 *
 * The drift classes are exactly the five in
 * `docs/PRESET-REGISTRY-STANDARD.md` §2, plus the descriptor fields the
 * normative contract in §3 requires. A new drift class is added here FIRST:
 * a gate without a mutation case is a claim without evidence.
 *
 * Usage:
 *   node scripts/verify-presets-mutation.mjs [--verbose]
 *
 * Exit codes: 0 every mutation was caught, 1 at least one survived (a gap),
 *             2 the harness could not run.
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

import { PRESETS } from '../lib/presets.js'
import { PRESETS as DECLARED } from '../lib/presets.js'
import { checkDeriveMirror, checkGeneratedArtifacts, checkPresetRegistry, readModelPresets } from '../lib/preset-drift.js'
import { presetSettings } from '../lib/preset-derive.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const VERBOSE = process.argv.includes('--verbose')

/**
 * Each mutation receives a throwaway copy of both registries and returns the
 * damaged copy. The copy is deep-cloned per case, so cases never interact.
 * @param {object} input - `{ presets, descriptors, locales }`.
 * @returns {object} the mutated input.
 */
const MUTATIONS = [
  {
    id: 'M1-backend-preset-without-ui-descriptor',
    // STANDARD §2 row 2: the settings page renders MODEL_PRESETS.map(...), so a
    // missing descriptor is silently absent — no tab, no error anywhere.
    why: 'a fourth PRESETS entry with no MODEL_PRESETS descriptor (silent: no tab)',
    apply: (input) => {
      input.presets.push({
        ...clone(input.presets[0]),
        id: 'fnord',
        providerId: 'fnord',
        row: 'dsh-fnord',
        entries: [{ row: 'dsh-fnord' }],
      })
      return input
    },
  },
  {
    id: 'M2-descriptor-without-preset',
    // The reverse direction: a tab that writes a row nothing mounts.
    why: 'a MODEL_PRESETS descriptor whose id has no PRESETS entry',
    apply: (input) => {
      input.descriptors.push({ ...clone(input.descriptors[0]), id: 'ghost', row: 'dsh-ghost' })
      return input
    },
  },
  {
    id: 'M3-descriptor-row-not-declared-by-preset',
    // STANDARD §2 row 1/2 join: the save path writes this row's enabledModels.
    why: 'a descriptor writing a row the preset never declares (typo class)',
    apply: (input) => {
      input.descriptors[0].row = 'dsh-antigravity-typo'
      return input
    },
  },
  {
    id: 'M4-descriptor-without-usage-routes',
    // STANDARD §2 row 3: fetchUsageFeeds is a literal array, so a preset with no
    // usage entry gets no dashboard card and no warning.
    why: 'a preset with no usage route (silent: no usage card)',
    apply: (input) => {
      input.descriptors[1].usageRoutes = []
      return input
    },
  },
  {
    id: 'M5-usage-route-not-a-local-panel-route',
    // A usage route must be a local panel path; an upstream URL would be POSTed
    // with the operator's credentials by the dashboard.
    why: 'a usage route pointing outside /api/local/',
    apply: (input) => {
      input.descriptors[0].usageRoutes[0].path = 'https://cloudcode-pa.googleapis.com/v1/x'
      return input
    },
  },
  {
    id: 'M6-label-key-missing-from-a-locale',
    // STANDARD §2 row 5: the tab renders the raw key via the t() fallback.
    why: 'a labelKey absent from locale/ko.json (silent: raw key rendered)',
    apply: (input) => {
      delete input.locales.ko.vendorAntigravity
      return input
    },
  },
  {
    id: 'M7-catalog-route-not-local',
    why: 'a catalog route that is not a /api/local/ panel route',
    apply: (input) => {
      input.descriptors[0].route = '/api/elsewhere/models'
      return input
    },
  },
  {
    id: 'M8-descriptor-load-not-a-function',
    why: 'a descriptor whose load() is missing or not callable',
    apply: (input) => {
      delete input.descriptors[2].load
      return input
    },
  },
  {
    id: 'M9-duplicate-descriptor-id',
    why: 'two descriptors sharing one id (one tab wins silently)',
    apply: (input) => {
      input.descriptors.push({ ...clone(input.descriptors[0]) })
      return input
    },
  },
  {
    id: 'M10-metered-flag-on-a-subscription-preset',
    // Guard the reverse direction of the metered rule: only a pay-per-token
    // preset carries the price block.
    why: 'a subscription preset declaring metered: true (invented price block)',
    apply: (input) => {
      input.descriptors[0].metered = true
      return input
    },
  },

  // ---- rc.16: the DERIVED registry -------------------------------------
  {
    id: 'M11-derived-facts-not-from-the-declaration',
    // STANDARD §4 steps 2–3: the descriptor must be a FUNCTION of the backend
    // declaration. A page-side fact that the derivation did not produce is
    // exactly the second registry rc.16 removed, and it is silent.
    why: 'a descriptor fact the derivation would not produce (a hand-copied row/route)',
    apply: (input) => {
      input.descriptors[0].row = 'dsh-antigravity-old'
      return input
    },
  },
  {
    id: 'M12-catalog-route-taken-from-the-usage-feed',
    // The measured defect that blanked the OpenCode tab: the catalog route and
    // the first usage route are different questions.
    why: 'a catalog route derived from the first usage route instead of the model list',
    apply: (input) => {
      input.descriptors[1].route = input.descriptors[1].usageRoutes[0].path
      input.descriptors[1]._usageOnly = true
      return input
    },
  },
  {
    id: 'M13-metered-not-derived-from-billing',
    why: 'metered flipped against the declared billing mode',
    apply: (input) => {
      const deepinfra = input.descriptors.find((descriptor) => descriptor.id === 'deepinfra')
      deepinfra.metered = false
      return input
    },
  },
]

/** Structured deep clone that keeps functions by reference. */
function clone(value) {
  if (Array.isArray(value)) return value.map(clone)
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const [key, item] of Object.entries(value)) out[key] = clone(item)
    return out
  }
  return value
}

/** Build the pristine input the gate is run against. */
function pristine() {
  const locales = {}
  for (const name of ['en', 'ko', 'zh']) {
    locales[name] = JSON.parse(readFileSync(join(root, 'locale', name + '.json'), 'utf8'))
  }
  return { presets: clone(PRESETS), descriptors: clone(readModelPresets()), locales }
}

// ------------------------------------------------------------------ baseline

const cases = []
let failures = 0

const base = pristine()
const baseline = checkPresetRegistry({ ...base, derive: presetSettings })
if (!baseline.ok) {
  process.stderr.write('verify-presets-mutation: the UNMUTATED registries already fail the gate:\n')
  for (const problem of baseline.problems) process.stderr.write('  - ' + problem + '\n')
  process.exit(2)
}
if (base.descriptors.length !== base.presets.length) {
  process.stderr.write(
    'verify-presets-mutation: harness cannot run — ' +
      base.descriptors.length + ' descriptors vs ' + base.presets.length + ' presets\n',
  )
  process.exit(2)
}

// ----------------------------------------------------------------- mutations

for (const mutation of MUTATIONS) {
  const input = mutation.apply(pristine())
  const verdict = checkPresetRegistry({ ...input, derive: presetSettings })
  const caught = !verdict.ok
  // A case must be caught for the RIGHT reason: the reported problem has to
  // mention the preset it damaged, otherwise a mutation could "pass" because an
  // unrelated check happened to trip.
  const relevant = verdict.problems.filter((problem) => /fnord|ghost|typo|elsewhere|antigravity|deepinfra|opencode|labelKey|usage|locale/i.test(problem))
  cases.push({ id: mutation.id, why: mutation.why, caught, relevant })
  if (!caught) failures += 1
  if (VERBOSE || !caught) {
    process.stdout.write((caught ? 'caught   ' : 'SURVIVED ') + mutation.id + '\n')
    process.stdout.write('         ' + mutation.why + '\n')
    for (const problem of relevant.slice(0, 3)) process.stdout.write('         → ' + problem + '\n')
  }
}

// --------------------------------------------- derived-registry (file) cases
// These mutate FILES, not in-memory registries: the claim "the browser registry
// is derived" is a property of the sources, so it is proven on a temp copy.

/**
 * Run the file-level checks against a temp copy of the package.
 * @param {(root: string) => void} mutate - damages the copy.
 * @returns {{caught: boolean, problems: string[], id: string}} the verdict.
 */
function fileCase(id, mutate, run) {
  const dir = mkdtempSync(join(tmpdir(), 'cr-gate-'))
  try {
    mkdirSync(join(dir, 'lib'), { recursive: true })
    mkdirSync(join(dir, 'locale'), { recursive: true })
    for (const name of ['preset-derive.js', 'preset-drift.js', 'presets.js', 'preset-schema.js', 'client.src.js', 'client.js', 'locale-table.js']) {
      copyFileSync(join(root, 'lib', name), join(dir, 'lib', name))
    }
    for (const name of ['en', 'ko', 'zh']) copyFileSync(join(root, 'locale', name + '.json'), join(dir, 'locale', name + '.json'))
    if (mutate !== undefined) mutate(dir)
    const verdict = run(dir)
    return { id, caught: !verdict.ok, problems: verdict.problems }
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const fileCases = []
fileCases.push(fileCase('F1-hand-written-descriptor-table', (dir) => {
  const path = join(dir, 'lib', 'client.src.js')
  const source = readFileSync(path, 'utf8')
  writeFileSync(path, source.replace(
    'const MODEL_PRESETS = Object.freeze(deriveModelPresets(PRESET_DECLARATIONS))',
    "const MODEL_PRESETS = Object.freeze([{ id: 'antigravity' }])",
  ))
}, checkGeneratedArtifacts))

fileCases.push(fileCase('F2-stale-baked-declarations', (dir) => {
  const path = join(dir, 'lib', 'client.src.js')
  const source = readFileSync(path, 'utf8')
  const reread = DECLARED.map((preset) => ({ ...preset, usage: { ...preset.usage, billing: { mode: 'none' } } }))
  const literal = JSON.stringify(JSON.stringify(reread))
  writeFileSync(path, source.replace(/const PRESET_DECLARATIONS = Object\.freeze\(JSON\.parse\(".*"\)\)/, 'const PRESET_DECLARATIONS = Object.freeze(JSON.parse(' + literal + '))'))
}, checkGeneratedArtifacts))

fileCases.push(fileCase('F3-derivation-mirror-drift', (dir) => {
  const path = join(dir, 'lib', 'client.src.js')
  const source = readFileSync(path, 'utf8')
  writeFileSync(path, source.replace("return 'vendor' + camelOf(preset?.id ?? 'preset')", "return 'vendor' + camelOf(preset?.id ?? 'preset') + 'X'"))
}, checkDeriveMirror))

fileCases.push(fileCase('F4-descriptor-fact-not-derived', (dir) => {
  const declaration = { ...DECLARED[0], row: 'dsh-elsewhere' }
  const descriptor = presetSettings(declaration)
  return checkPresetRegistry({
    presets: [DECLARED[0]],
    descriptors: [{ ...descriptor, row: 'dsh-elsewhere' }],
    locales: { en: JSON.parse(readFileSync(join(dir, 'locale', 'en.json'), 'utf8')) },
  })
}, (dir) => checkPresetRegistry({
  presets: [{ ...DECLARED[0] }],
  descriptors: [{ ...presetSettings(DECLARED[0]), row: 'dsh-elsewhere' }],
  locales: { en: JSON.parse(readFileSync(join(dir, 'locale', 'en.json'), 'utf8')) },
})))

const fileFailures = fileCases.filter((item) => !item.caught)
if (VERBOSE || fileFailures.length > 0) {
  for (const item of fileCases) {
    process.stdout.write((item.caught ? 'caught   ' : 'SURVIVED ') + item.id + '\n')
    for (const problem of item.problems.slice(0, 2)) process.stdout.write('         → ' + problem + '\n')
  }
}

// -------------------------------------------------------------------- report

const caughtCount = cases.length - failures + fileCases.filter((item) => item.caught).length
const total = cases.length + fileCases.length
process.stdout.write('\npreset drift-gate mutation: ' + caughtCount + '/' + total + ' drift classes caught\n')
for (const item of [...cases, ...fileCases]) {
  const mark = item.caught ? 'caught  ' : 'SURVIVED'
  process.stdout.write('  ' + mark + ' ' + item.id + '\n')
}

if (failures + fileFailures.length > 0) {
  process.stderr.write('\nGATE GAP: ' + (failures + fileFailures.length) + ' drift class(es) pass the gate unnoticed\n')
  process.exit(1)
}
process.stdout.write('\nOK: every documented drift class is rejected by the gate\n')
process.exit(0)
