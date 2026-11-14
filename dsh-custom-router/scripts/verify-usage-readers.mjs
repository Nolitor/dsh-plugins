#!/usr/bin/env node
/**
 * `USAGE_READERS` gate (`ARCHITECTURE-LAYERED.md` §6.3, follow-up R4).
 *
 * A preset declares `usage.routes[].normalize` as a NAME (`'normalizeOpencodeUsage'`).
 * That name is looked up in a hand-written table inside the browser bundle
 * (`lib/client.src.js` / the built `lib/client.js`), and an unknown name throws
 * `unknown usage reader: …` only when the dashboard first reads a live feed.
 * Nothing failed at build or CI time, so a rename in one place and not the other
 * shipped a broken usage card — the exact silent failure the static registry
 * gate exists to prevent.
 *
 * This gate closes it from both sides:
 *   - every declared name must exist in the table (no runtime throw);
 *   - every table entry must be declared by at least one preset (no dead reader);
 *   - the name must resolve to a real function in the bundle (no `undefined`);
 *   - `lib/client.src.js` and the built `lib/client.js` must agree (a stale
 *     artefact is otherwise invisible — the page runs `client.js`).
 *
 * Usage:
 *   node scripts/verify-usage-readers.mjs            # check the real tree
 *   node scripts/verify-usage-readers.mjs --json     # machine-readable result
 *
 * Exit codes: 0 clean, 1 gate failure, 2 the gate could not run.
 */
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PRESETS } from '../lib/presets.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** The bundle files that must declare the same table. */
export const BUNDLES = Object.freeze(['lib/client.src.js', 'lib/client.js'])

/**
 * Extract the `USAGE_READERS` table's own keys from one bundle source.
 *
 * Deliberately a brace-matching scan rather than a full parse: the bundle is a
 * CommonJS factory served to the browser, so it cannot be `import`ed, and the
 * table is the only shape this gate needs. A missing table is an error, not an
 * empty result.
 *
 * @param {string} source - bundle text.
 * @returns {{ keys: string[], error?: string }} the keys in declaration order.
 */
export function usageReaderKeys(source) {
  const marker = 'const USAGE_READERS = Object.freeze({'
  const start = source.indexOf(marker)
  if (start === -1) return { keys: [], error: 'USAGE_READERS table not found' }
  const open = start + marker.length - 1
  let depth = 0
  let end = -1
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]
    if (char === '{') depth += 1
    else if (char === '}') {
      depth -= 1
      if (depth === 0) {
        end = index
        break
      }
    }
  }
  if (end === -1) return { keys: [], error: 'USAGE_READERS table is unterminated' }
  const body = source.slice(open + 1, end)
  const keys = []
  // Top-level keys only: a nested `key:` sits at a deeper brace depth.
  let nesting = 0
  for (const line of body.split('\n')) {
    const key = /^\s{4,8}([A-Za-z_$][\w$]*)\s*:/.exec(line)
    if (nesting === 0 && key !== null) keys.push(key[1])
    for (const char of line) {
      if (char === '{' || char === '(' || char === '[') nesting += 1
      else if (char === '}' || char === ')' || char === ']') nesting -= 1
    }
  }
  if (keys.length === 0) return { keys: [], error: 'USAGE_READERS table declares no reader' }
  // The identifiers the table's VALUES reference, e.g. the helper each arrow
  // wrapper delegates to. A key can be present and still point at a renamed
  // helper, which would throw only on a live dashboard read.
  const referenced = [...new Set([...body.matchAll(/\b(normalize[A-Za-z0-9_$]*)/g)].map((match) => match[1]))]
  return { keys, referenced }
}

/** Every `usage.routes[].normalize` a preset declares, with its origin. */
export function declaredReaderNames(presets = PRESETS) {
  const out = []
  for (const preset of presets) {
    const routes = Array.isArray(preset?.usage?.routes) ? preset.usage.routes : []
    for (const route of routes) {
      out.push({ preset: preset.id, path: route?.path, normalize: route?.normalize })
    }
  }
  return out
}

/**
 * Whether the bundle actually defines a function for a reader name.
 *
 * A key can point at a name that was renamed in the body (or at a helper that
 * never existed); the table would then hold `undefined` and throw at call time.
 * Accepts both shapes the bundle uses: `function name(` and `exports.name =`.
 *
 * @param {string} source - bundle text.
 * @param {string} name - reader name.
 * @returns {boolean} true when the name resolves to a definition.
 */
export function readerIsDefined(source, name) {
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|\\n)\\s*(?:async\\s+)?function\\s+${escaped}\\s*\\(`).test(source) ||
    new RegExp(`\\bexports\\.${escaped}\\s*=`).test(source)
}

/**
 * Compare every declared reader name against one bundle's table.
 *
 * Pure: takes the sources, returns problems, so a mutation test can hand it a
 * doctored bundle and prove the gate fires.
 *
 * @param {{ presets?: object[], bundles?: Record<string, string> }} input - tree to check.
 * @returns {{ problems: string[], checked: { presets: number, routes: number, readers: string[] } }} verdict.
 */
export function checkUsageReaders(input = {}) {
  const presets = input.presets ?? PRESETS
  const bundles = input.bundles ?? Object.fromEntries(
    BUNDLES.map((file) => [file, readFileSync(join(ROOT, file), 'utf8')]),
  )
  const problems = []
  const declared = declaredReaderNames(presets)
  if (declared.length === 0) problems.push('no preset declares a usage route — the gate would be vacuous')

  const keysByName = {}
  for (const [file, source] of Object.entries(bundles)) {
    const { keys, referenced = [], error } = usageReaderKeys(source)
    if (error !== undefined) {
      problems.push(`${file}: ${error}`)
      continue
    }
    keysByName[file] = keys
    const known = new Set(keys)
    for (const entry of declared) {
      if (typeof entry.normalize !== 'string' || entry.normalize === '') {
        problems.push(`${entry.preset}: usage route "${entry.path}" declares no reader name`)
        continue
      }
      if (!known.has(entry.normalize)) {
        problems.push(
          `${entry.preset}: usage route "${entry.path}" names reader "${entry.normalize}", ` +
            `which is NOT in USAGE_READERS (${keys.join(', ')}) — this throws at runtime`,
        )
      }
    }
    const used = new Set(declared.map((entry) => entry.normalize))
    for (const key of keys) {
      if (!used.has(key)) problems.push(`${file}: USAGE_READERS entry "${key}" is declared by no preset (dead reader)`)
    }
    for (const key of keys) {
      if (!readerIsDefined(source, key)) problems.push(`${file}: USAGE_READERS entry "${key}" does not resolve to a function`)
    }
    for (const name of referenced) {
      if (!readerIsDefined(source, name)) {
        problems.push(`${file}: USAGE_READERS references "${name}", which has no function definition — the entry throws at call time`)
      }
    }
  }

  // A stale artefact would make every check above pass against a bundle the
  // page never runs, so the two tables must be identical.
  const names = Object.keys(keysByName)
  if (names.length > 1) {
    const reference = keysByName[names[0]]
    for (const file of names.slice(1)) {
      const candidate = keysByName[file]
      const same = reference.length === candidate.length && reference.every((key, index) => key === candidate[index])
      if (!same) problems.push(`${file}: USAGE_READERS table differs from ${names[0]} ([${candidate.join(', ')}] vs [${reference.join(', ')}])`)
    }
  }
  return {
    problems,
    checked: { presets: presets.length, routes: declared.length, readers: keysByName[names[0]] ?? [] },
  }
}

/** CLI entry: report the verdict and exit. */
function main() {
  const json = process.argv.includes('--json')
  let verdict
  try {
    verdict = checkUsageReaders()
  } catch (error) {
    process.stderr.write(`verify-usage-readers: could not run: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
  if (json) {
    process.stdout.write(JSON.stringify(verdict, null, 1) + '\n')
  } else {
    process.stdout.write(
      `usage readers : ${verdict.problems.length === 0 ? 'OK' : `${verdict.problems.length} problem(s)`}` +
        ` (${verdict.checked.presets} presets, ${verdict.checked.routes} routes, ${verdict.checked.readers.length} readers: ${verdict.checked.readers.join(', ')})\n`,
    )
    for (const problem of verdict.problems) process.stderr.write(`  - ${problem}\n`)
  }
  process.exit(verdict.problems.length === 0 ? 0 : 1)
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main()
