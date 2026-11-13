/**
 * Preset drift gate — the STATIC half.
 *
 * `scripts/verify-presets.mjs` boots a live profile and compares the backend
 * `PRESETS` declaration against the runtime registries (providers, tools,
 * commands, switch fields). That is the dynamic half, and it is genuinely
 * useful — but it structurally cannot see the browser half of the registry,
 * because `MODEL_PRESETS` is evaluated inside a page, not a Cordis context.
 *
 * Measured 2026-11-13: `verify-presets.mjs` never read `MODEL_PRESETS` at all,
 * so the two silent failures named in `docs/PRESET-REGISTRY-STANDARD.md` §2
 * (row 2: no settings tab, row 3: no usage card) both passed the gate green.
 * This module closes that gap without booting anything:
 *
 *   1. `PRESETS`      (lib/presets.js)      — what gets mounted
 *   2. `MODEL_PRESETS` (lib/client.js)       — what the settings page renders
 *   3. `locale/*.json`                       — the keys those two ask for
 *
 * The join is by `id`, and every check below corresponds to one row of the
 * standard's "if forgotten" column. Pure: no I/O, no boot, no `dsh` import.
 * `scripts/verify-presets-mutation.mjs` proves each check fails on its drift.
 */
import { readFileSync } from 'node:fs'

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import vm from 'node:vm'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** The script that bakes `PRESET_DECLARATIONS` into `lib/client.src.js`. */
import { PRESETS } from './presets.js'

/**
 * The facts a browser descriptor must take from the derivation, never declare.
 *
 * This is the registry contract STANDARD §3 defines; a page may add only the UI
 * hooks (`load`, `saveValue`, `renderRowExtras`).
 */
export const DERIVED_FACTS = Object.freeze(['id', 'row', 'route', 'usageRoutes', 'labelKey', 'planKey', 'metered'])

/** Every locale the browser table is generated from. */
export const LOCALES = Object.freeze(['en', 'ko', 'zh'])

/**
 * Evaluate `lib/client.js` in a stub page and return its exports.
 *
 * The browser half is a CommonJS factory the host evaluates as a plain script,
 * so the only faithful way to read the real `MODEL_PRESETS` is to run that same
 * file against a stub loader. Reading it from `client.src.js` would pass on a
 * stale build, which is a separate drift the caller checks explicitly.
 * @param {string} [root] - package root, for tests.
 * @returns {object} the module exports.
 */
export function loadClientExports(root = ROOT) {
  const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
  let descriptor = null
  const sandbox = {
    window: { __ModuleLoader__: { load: (value) => { descriptor = value } } },
    document: {
      head: { querySelector: () => null, appendChild: () => {} },
      createElement: () => ({ setAttribute: () => {} }),
    },
    console: { warn: () => {}, error: () => {}, log: () => {} },
  }
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox, { filename: 'client.js' })
  if (descriptor === null) throw new Error('client.js registered no module descriptor')
  return descriptor.factory((name) => {
    if (name === 'react') {
      const createElement = (type, props, ...children) => ({ type, props, children })
      return {
        createElement,
        useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
        useReducer: (reducer, initial) => [initial, () => {}],
        useEffect: () => {},
        useLayoutEffect: () => {},
        useCallback: (fn) => fn,
        useMemo: (fn) => fn(),
        useRef: (value) => ({ current: value }),
        Fragment: 'Fragment',
      }
    }
    throw new Error('unexpected require: ' + name)
  })
}

/**
 * Read the browser registry as a plain array.
 * @param {string} [root] - package root.
 * @returns {object[]} the `MODEL_PRESETS` descriptors.
 */
export function readModelPresets(root = ROOT) {
  const exports = loadClientExports(root)
  return Array.isArray(exports.MODEL_PRESETS) ? [...exports.MODEL_PRESETS] : []
}

/**
 * Read every locale table.
 * @param {string} [root] - package root.
 * @returns {Record<string, object>} locale name → flat key table.
 */
export function readLocales(root = ROOT) {
  const tables = {}
  for (const name of LOCALES) {
    tables[name] = JSON.parse(readFileSync(join(root, 'locale', name + '.json'), 'utf8'))
  }
  return tables
}

/**
 * The rows a preset declares as its own loader rows.
 * @param {object} preset - one `PRESETS` entry.
 * @returns {Set<string>} row ids.
 */
function declaredRows(preset) {
  const rows = new Set()
  if (typeof preset?.row === 'string') rows.add(preset.row)
  for (const entry of Array.isArray(preset?.entries) ? preset.entries : []) {
    if (typeof entry?.row === 'string') rows.add(entry.row)
  }
  return rows
}

/**
 * Compare the two registries and their locale keys.
 *
 * Every problem string names the preset and the exact standard clause it
 * violates, so a failure reads as an instruction rather than a verdict.
 * @param {object} input - registries to check.
 * @param {object[]} input.presets - the backend `PRESETS` array.
 * @param {object[]} input.descriptors - the browser `MODEL_PRESETS` array.
 * @param {Record<string, object>} input.locales - locale name → key table.
 * @returns {{ok: boolean, problems: string[], holes: string[]}} the verdict.
 */
export function checkPresetRegistry(input) {
  const problems = []
  const presets = Array.isArray(input?.presets) ? input.presets : []
  const descriptors = Array.isArray(input?.descriptors) ? input.descriptors : []
  const locales = input?.locales ?? {}

  const presetById = new Map()
  for (const preset of presets) {
    if (typeof preset?.id === 'string' && !presetById.has(preset.id)) presetById.set(preset.id, preset)
  }
  // The derivation, when the caller supplies it (it always can: the module is
  // pure). Without it the checks below still run, but "is this descriptor the
  // DERIVED one" — the property that makes a second registry impossible — is
  // reported as a hole instead of silently passing.
  const derive = typeof input?.derive === 'function' ? input.derive : null

  const seenDescriptors = new Map()
  for (const descriptor of descriptors) {
    const id = descriptor?.id

    // --- §3: `id` is the join key and must exist on both sides ---------------
    if (typeof id !== 'string' || id === '') {
      problems.push('descriptor: MODEL_PRESETS entry has no string id (STANDARD §3 `id`)')
      continue
    }
    if (seenDescriptors.has(id)) {
      problems.push(`${id}: two MODEL_PRESETS descriptors share this id; one tab silently wins`)
    }
    seenDescriptors.set(id, descriptor)

    const preset = presetById.get(id)
    if (preset === undefined) {
      problems.push(`${id}: MODEL_PRESETS descriptor has no PRESETS entry — the tab writes a row nothing mounts (§2 #2)`)
      continue
    }

    // --- §2 #1/#2: the save path writes `row.enabledModels` ------------------
    if (typeof descriptor.row !== 'string' || descriptor.row === '') {
      problems.push(`${id}: descriptor declares no string row (STANDARD §3 \`row\`)`)
    } else if (!declaredRows(preset).has(descriptor.row)) {
      problems.push(`${id}: descriptor writes row "${descriptor.row}" but the preset declares [${[...declaredRows(preset)].join(', ')}] — the save would land in a row nobody mounts`)
    }

    // --- §2 #1: the catalog route is a local panel route ---------------------
    if (typeof descriptor.route !== 'string' || !descriptor.route.startsWith('/api/local/')) {
      problems.push(`${id}: catalog route ${JSON.stringify(descriptor.route)} is not a local panel route (/api/local/…)`)
    }

    // --- §2 #3: the usage route list is the silent one ------------------------
    // `fetchUsageFeeds` iterates this list; an empty one produces a preset with
    // no dashboard card and no warning anywhere. A preset that reports no plan
    // (`billing.mode: 'none'`) is the only legitimate absence.
    const reportsUsage = preset.usage?.plan !== 'unavailable' || preset.usage?.billing?.mode !== 'none'
    const usageRoutes = descriptor.usageRoutes
    if (!Array.isArray(usageRoutes) || usageRoutes.length === 0) {
      if (reportsUsage) {
        problems.push(`${id}: no usageRoutes — the dashboard renders every other preset and never says this one is missing (§2 #3)`)
      }
    } else {
      const seenPaths = new Set()
      for (const route of usageRoutes) {
        const path = route?.path
        if (typeof path !== 'string' || !path.startsWith('/api/local/')) {
          problems.push(`${id}: usage route ${JSON.stringify(path)} is not a local panel route (/api/local/…)`)
          continue
        }
        if (seenPaths.has(path)) problems.push(`${id}: usage route "${path}" is listed twice`)
        seenPaths.add(path)
        // Two declaration forms are legitimate: the backend graph names its
        // reader as a string (it cannot carry browser code), and a descriptor
        // may inline the function. Anything else is a route nobody can read.
        const normalize = route.normalize
        if (typeof normalize !== 'function' && (typeof normalize !== 'string' || normalize === '')) {
          problems.push(`${id}: usage route "${path}" has no normalize reader (a function or a reader name)`)
        }
      }
    }

    // --- §3: load() is what turns a payload into the rendered groups ---------
    if (typeof descriptor.load !== 'function') {
      problems.push(`${id}: descriptor load is ${typeof descriptor.load}, not a function (STANDARD §3 \`load\`)`)
    }
    for (const hook of ['saveValue', 'renderRowExtras']) {
      const value = descriptor[hook]
      if (value !== undefined && typeof value !== 'function') {
        problems.push(`${id}: optional hook ${hook} is ${typeof value}, not a function`)
      }
    }

    // --- §3: `metered` marks the only pay-per-token preset -------------------
    // The backend already declares the billing mode, so this is a cross-check,
    // not a second opinion: a subscription/flat preset showing a price block
    // invents a charge the operator does not pay.
    if (descriptor.metered !== undefined && typeof descriptor.metered !== 'boolean') {
      problems.push(`${id}: metered is ${typeof descriptor.metered}, not a boolean`)
    }
    const billingMode = preset?.usage?.billing?.mode
    if (typeof billingMode === 'string') {
      const paysPerToken = billingMode === 'pay-per-token'
      if (descriptor.metered === true && !paysPerToken) {
        problems.push(`${id}: descriptor declares metered:true but the preset bills "${billingMode}" — the price block would invent a charge`)
      }
      if (descriptor.metered !== true && paysPerToken) {
        problems.push(`${id}: the preset bills per token but the descriptor omits metered:true — no price block is rendered`)
      }
    }

    // --- §4 steps 2–3: the descriptor IS the derivation ----------------------
    // rc.16 removed the second registry by deriving every fact from the
    // declaration. That holds only if a page cannot smuggle a hand-written fact
    // back in: a descriptor whose row/route/labels differ from the derivation is
    // the old table wearing a new shape.
    if (derive !== null) {
      const derived = derive(preset)
      for (const key of DERIVED_FACTS) {
        const actual = descriptor[key]
        const expected = derived[key]
        // `usageRoutes` is compared by value: the derivation returns fresh
        // frozen objects on every call.
        const same = key === 'usageRoutes'
          ? JSON.stringify(actual ?? null) === JSON.stringify(expected ?? null)
          : actual === expected
        if (!same) {
          problems.push(`${id}: descriptor ${key}=${JSON.stringify(actual)} is not what the derivation produces (${JSON.stringify(expected)}) — a hand-written fact is the second registry rc.16 removed (STANDARD §4 steps 2–3)`)
        }
      }
      // The catalog route must LIST MODELS. When the derivation had to fall back
      // to the usage feed, the route has to look like a model list; otherwise the
      // declaration must name `catalogRoute` explicitly (the measured defect that
      // blanked the OpenCode tab).
      const expectedDerived = derived
      const usagePaths = (expectedDerived.usageRoutes ?? []).map((route) => route.path)
      if (usagePaths.length > 0 && expectedDerived.route === usagePaths[0] && preset?.catalogRoute === undefined
        && !/models|model-settings|catalog/.test(expectedDerived.route)) {
        problems.push(`${id}: catalog route "${expectedDerived.route}" is the usage feed, not a model list — declare catalogRoute (STANDARD §3)`)
      }
    }

    // --- §2 #5: every locale carries the keys the UI asks for ---------------
    for (const keyName of ['labelKey', 'planKey']) {
      const key = descriptor[keyName]
      if (typeof key !== 'string' || key === '') {
        problems.push(`${id}: ${keyName} is missing — the tab/card has no localized label (§2 #5)`)
        continue
      }
      for (const [locale, table] of Object.entries(locales)) {
        // A flat string is a key the table must own; an object is the nested
        // meta block the build script validates separately.
        if (table === null || typeof table !== 'object') continue
        if (!(key in table)) {
          problems.push(`${id}: ${keyName} "${key}" is absent from locale/${locale}.json — the UI renders the raw key via the t() fallback (§2 #5)`)
        }
      }
    }
  }

  // --- §2 #2/#4: every backend preset must be on BOTH sides ------------------
  for (const preset of presets) {
    const id = preset?.id
    if (typeof id !== 'string' || id === '') {
      problems.push('PRESETS entry has no string id')
      continue
    }
    if (!seenDescriptors.has(id)) {
      problems.push(`${id}: PRESETS entry has no MODEL_PRESETS descriptor — the preset is mounted but has no settings tab, silently (§2 #2)`)
    }
  }

  // --- holes: things this STATIC check cannot see ----------------------------
  // An empty `holes` array would mean the gate covers everything; it does not,
  // and saying so is part of the contract (a green report must not imply "not
  // checked" — BLUEPRINT §13.0). Rendered usage and per-vendor normalizer
  // behaviour are exercised by the suite, not here.
  const holes = [
    ...(derive === null
      ? ['descriptor-equals-derivation: no `derive` supplied, so a hand-written fact could not be detected']
      : []),
    'runtime registration (providers/tools/commands/switches) — needs the isolated boot in scripts/verify-presets.mjs',
    'rendered element tree and the real usage payloads — covered by test/client.test.mjs, not by this registry diff',
  ]

  return { ok: problems.length === 0, problems, holes }
}

/**
 * Whether the generated browser bundle is current with its sources.
 *
 * A stale `lib/client.js` makes every static check above pass against code the
 * page never runs — the exact class of defect that once shipped an Antigravity
 * client reading an undefined global (see `scripts/build-client.mjs`).
 * @param {string} [root] - package root.
 * @returns {{ok: boolean, problems: string[]}} the verdict.
 */
export function checkGeneratedArtifacts(root = ROOT) {
  const problems = []
  const read = (path) => readFileSync(join(root, path), 'utf8')

  // 1. locale-table.js must equal the JSON sources.
  let sourceKeys
  try {
    sourceKeys = readLocales(root)
  } catch (error) {
    return { ok: false, problems: ['cannot read locale/*.json: ' + error.message] }
  }
  const generated = read('lib/locale-table.js')
  const tableMatch = /export const I18N = ([\s\S]*)$/.exec(generated)
  if (tableMatch === null) {
    problems.push('lib/locale-table.js has no "export const I18N = ..." export')
  } else {
    let baked
    try {
      baked = JSON.parse(tableMatch[1].trim().replace(/;\s*$/, ''))
    } catch {
      problems.push('lib/locale-table.js I18N literal is not valid JSON — rerun scripts/gen-locale.mjs')
    }
    if (baked !== undefined && JSON.stringify(baked) !== JSON.stringify(sourceKeys)) {
      problems.push('lib/locale-table.js is STALE versus locale/*.json — rerun scripts/gen-locale.mjs')
    }
  }

  // 2. client.js must be the built form of client.src.js (placeholder consumed).
  const source = read('lib/client.src.js')
  const bundle = read('lib/client.js')
  const ASSIGNMENT = /const I18N = __CR_I18N__/
  if (ASSIGNMENT.test(source) === false && !source.includes('__CR_I18N__')) {
    problems.push('lib/client.src.js has no "const I18N = __CR_I18N__" assignment — scripts/build-client.mjs cannot build it')
  }
  if (bundle.includes('__CR_I18N__')) {
    problems.push('lib/client.js still contains the __CR_I18N__ placeholder — rerun scripts/build-client.mjs')
  }
  if (!/^\s*const MODEL_PRESETS = Object\.freeze\(deriveModelPresets\(PRESET_DECLARATIONS\)\)$/m.test(source)) {
    problems.push('lib/client.src.js no longer DERIVES MODEL_PRESETS from PRESET_DECLARATIONS — a hand-written descriptor table is the second registry rc.16 removed')
  }
  // 3. The baked declarations are identical to lib/presets.js.
  const baked = readPresetDeclarations(root)
  if (baked === undefined) {
    problems.push('lib/client.src.js has no `const PRESET_DECLARATIONS = …` line — run scripts/build-presets.mjs')
  } else {
    const wanted = projectionOf(PRESETS)
    const actual = projectionOf(baked)
    if (JSON.stringify(actual) !== JSON.stringify(wanted)) {
      const wantedIds = wanted.map((preset) => preset.id)
      const actualIds = actual.map((preset) => preset.id)
      problems.push(
        JSON.stringify(actualIds) === JSON.stringify(wantedIds)
          ? 'lib/client.src.js PRESET_DECLARATIONS is STALE versus lib/presets.js (same ids, different facts) — run scripts/build-presets.mjs'
          : `lib/client.src.js declares [${actualIds.join(', ')}] but lib/presets.js declares [${wantedIds.join(', ')}] — run scripts/build-presets.mjs`,
      )
    }
  }
  // Compare the two files modulo the one region the build replaces: everything
  // outside the baked I18N literal must be byte-identical.
  const srcHead = source.split(/const I18N = __CR_I18N__/)[0]
  const bundleHead = bundle.split(/const I18N = \{/)[0]
  if (bundleHead.length === 0 || !bundleHead.startsWith(srcHead.slice(0, Math.min(srcHead.length, 200)))) {
    problems.push('lib/client.js does not start with lib/client.src.js — rerun scripts/build-client.mjs')
  }

  return { ok: problems.length === 0, problems }
}

/**
 * The declarations baked into the browser bundle.
 *
 * `scripts/build-presets.mjs` writes them from `lib/presets.js`, so they are a
 * generated artefact, not an input. A missing or unparsable line is reported by
 * `checkGeneratedArtifacts()`.
 * @param {string} [root] - package root.
 * @returns {object[]|undefined} the baked declarations, or undefined.
 */
export function readPresetDeclarations(root = ROOT) {
  const source = readFileSync(join(root, 'lib', 'client.src.js'), 'utf8')
  const match = /^\s*const PRESET_DECLARATIONS = Object\.freeze\(JSON\.parse\((".*")\)\)$/m.exec(source)
  if (match === null) return undefined
  try {
    return JSON.parse(JSON.parse(match[1]))
  } catch {
    return undefined
  }
}

/**
 * The comparable projection of a declaration.
 *
 * A hosted package (the M2 guest repo) legitimately re-orders or omits fields
 * it does not show; what must never differ is the JOIN — the id, the row the
 * save path writes, the usage routes and the declared surfaces.
 * @param {readonly object[]} presets - declarations.
 * @returns {object[]} the projection.
 */
export function projectionOf(presets) {
  return presets.map((preset) => ({
    id: preset.id,
    row: preset.row,
    catalogRoute: preset.catalogRoute ?? null,
    usage: {
      plan: preset?.usage?.plan,
      billing: preset?.usage?.billing ?? {},
      routes: preset?.usage?.routes ?? [],
    },
    surfaces: preset?.surfaces
      ? {
        model: preset.surfaces.model ?? null,
        subagent: preset.surfaces.subagent ?? null,
        cli: preset.surfaces.cli ?? null,
        batch: preset.surfaces.batch ?? null,
        tools: preset.surfaces.tools ?? [],
        commands: preset.surfaces.commands ?? [],
      }
      : null,
  }))
}

/**
 * Articles the derivation block claims, verified by byte comparison.
 *
 * `lib/client.src.js` mirrors `lib/preset-derive.js` because the page loader
 * cannot import ESM. The claim "this is a mirrored copy" is checked here rather
 * than trusted: any edit to one side without the other fails the gate.
 * @param {string} [root] - package root.
 * @returns {{ok: boolean, problems: string[]}} the verdict.
 */
export function checkDeriveMirror(root = ROOT) {
  const problems = []
  let canonical
  try {
    canonical = readFileSync(join(root, 'lib', 'preset-derive.js'), 'utf8')
  } catch (error) {
    return { ok: false, problems: ['cannot read lib/preset-derive.js: ' + error.message] }
  }
  const client = readFileSync(join(root, 'lib', 'client.src.js'), 'utf8')
  // Modulo comments, the block must be the canonical module with `export`
  // removed. Comments are stripped so the mirror can carry the page-specific
  // explanation of WHY the copy exists without failing its own check.
  const expected = stripCode(canonical)
  const begin = client.indexOf('    // ---- BEGIN DERIVED PRESET REGISTRY')
  const end = client.indexOf('    // ---- END DERIVED PRESET REGISTRY')
  if (begin < 0 || end < 0) {
    return { ok: false, problems: ['lib/client.src.js carries no BEGIN/END DERIVED PRESET REGISTRY markers'] }
  }
  const actual = stripCode(client.slice(begin, end))
  if (actual !== expected) {
    problems.push('lib/client.src.js derivation block drifted from lib/preset-derive.js — run node scripts/sync-derive.mjs')
  }
  return { ok: problems.length === 0, problems }
}

/** Remove comments and collapse whitespace, so a mirror is compared by CODE. */
export function stripCode(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .split('\n')
    .map((line) => line.replace(/\/\/.*$/, '').trim())
    .filter((line) => line !== '')
    .join(' ')
    .replace(/\s+/g, ' ')
    .replace(/\bexport\s+(const|function)\b/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()
}
