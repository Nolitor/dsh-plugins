#!/usr/bin/env node
/**
 * Bake the preset declarations into `lib/client.src.js`.
 *
 * WHY A BAKE
 * The browser half must not carry a second hand-written registry (STANDARD §4
 * steps 2–3). It needs, at minimum, the declaration it renders — a `labelKey`
 * and a `route` cannot be invented in a page. Serialising the backend `PRESETS`
 * into the source at build time means:
 *
 *   - the claim "the browser registry is DERIVED" is true by construction: the
 *     declarations inside the bundle are literally `lib/presets.js`'s output,
 *     and `docs`/tests can compare the two byte for byte;
 *   - an id-only preset needs NO edit in this file — only a `node
 *     scripts/build-presets.mjs` (already part of `npm run build`);
 *   - the derivation itself lives once, in `lib/preset-derive.js`, mirrored into
 *     `lib/client.src.js` by `scripts/sync-derive.mjs`, and both copies are
 *     compared with `lib/preset-derive.js` by the drift gate.
 *
 * The JSON is emitted as a frozen literal with a JSON-COERCED payload, so an
 * operator could inject it safely: nothing in a declaration is executable.
 */
import { readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PRESETS } from '../lib/presets.js'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const srcPath = join(root, 'lib', 'client.src.js')

/**
 * The one line the bake rewrites — a WHOLE line, terminator included.
 *
 * The trailing `\n?` is load-bearing. A match that stops before the newline
 * (`.*$`, which is what this regex used to be) makes a bake that replaces it
 * with `declarationSource()` — a string that *ends* with `\n` — insert one
 * extra newline on every run: `lib/client.src.js` grew an exact +1 byte per
 * `node scripts/build-presets.mjs`, measured 185404 → 185405 → 185406.
 * Owning the terminator means line-in, line-out and the bake is a fixed point.
 * `\n?` (not `\n`) also matches a file whose declaration is its last line
 * without a final newline. The indent is `[ \t]*`, not `\s*`, so the match can
 * never start on the preceding blank line and eat its newline.
 */
export const DECLARATION_LINE = /^[ \t]*const PRESET_DECLARATIONS = .*\n?/m

/**
 * The single normalisation both the gate and the bake call.
 *
 * This is the fix for the defect *class*: `declarationsAreCurrent()` used to
 * compare `current === declarationSource().replace(/\n$/, '')` (strip the
 * newline) while `bakePresetDeclarations()` inserted the raw newline-bearing
 * string. Two hand-written expressions of "the same" line meant the gate could
 * never see what the bake actually wrote. Now exactly one function defines the
 * canonical line text, and both callers go through it.
 *
 * A declaration line is one whole line: it ends with exactly one newline,
 * whether it was matched from a file (terminator maybe absent) or derived.
 * @param {string} line - a matched or derived declaration line.
 * @returns {string} the same line with exactly one trailing newline.
 */
export function normalizeDeclarationLine(line) {
  return `${String(line).replace(/\n+$/, '')}\n`
}

/**
 * The declarations a browser half renders, as plain JSON.
 *
 * Only fields a page can use are kept; functions and host objects never reach
 * the bundle. `check` compares this list to `PRESETS`, so a dropped field is a
 * gate failure rather than a silently blank tab.
 * @param {readonly object[]} presets - declarations.
 * @returns {object[]} serialisable declarations.
 */
export function browserDeclarations(presets = PRESETS) {
  return presets.map((preset) => ({
    id: preset.id,
    name: preset.name,
    kind: preset.kind,
    row: preset.row,
    providerId: preset.providerId,
    // Optional: only a preset whose catalog route differs from its usage feeds
    // declares it; the derivation falls back to a measured route otherwise.
    ...(typeof preset.catalogRoute === 'string' ? { catalogRoute: preset.catalogRoute } : {}),
    catalog: { layers: preset.catalog?.layers ?? [] },
    // The surfaces the page renders a label for, plus the flattened names the
    // provider card lists. `model` is a boolean-ish fact (`{adapter: true}`), so
    // the projection keeps it: it is what tells the page a preset has a route.
    surfaces: {
      model: preset.surfaces?.model ?? null,
      subagent: preset.surfaces?.subagent ?? null,
      cli: preset.surfaces?.cli ?? null,
      batch: preset.surfaces?.batch ?? null,
      skill: preset.surfaces?.skill ?? null,
      tools: preset.surfaces?.tools ?? [],
      commands: preset.surfaces?.commands ?? [],
    },
    switches: preset.switches ?? [],
    usage: {
      record: preset.usage?.record,
      plan: preset.usage?.plan,
      billing: preset.usage?.billing ?? {},
      routes: preset.usage?.routes ?? [],
    },
  }))
}

/** Format the assignment line for the current declarations (one whole line). */
export function declarationSource(presets = PRESETS) {
  const literal = JSON.stringify(browserDeclarations(presets))
  return normalizeDeclarationLine(
    `    const PRESET_DECLARATIONS = Object.freeze(JSON.parse(?))`.replace('?', JSON.stringify(literal)),
  )
}

/**
 * Whether a client source already carries the declarations `presets` derive.
 *
 * Compares through `normalizeDeclarationLine()`, the same helper the bake
 * writes through, so the gate and the bake cannot disagree about the line.
 * @param {string} source - `lib/client.src.js` text.
 * @param {readonly object[]} [presets] - declarations to derive from.
 * @returns {boolean} true when the baked line already equals the derived one.
 */
export function declarationsAreCurrent(source, presets = PRESETS) {
  const current = DECLARATION_LINE.exec(String(source ?? ''))?.[0]
  if (current === undefined) return false
  return normalizeDeclarationLine(current) === declarationSource(presets)
}

/**
 * Rewrite `lib/client.src.js` in place with the current declarations.
 *
 * Idempotent by construction: the match is a whole line and the replacement is
 * a whole line, so on an already-baked file `next === source`, no write happens,
 * and `changed` is `false`.
 * @param {object} [options] - `{ presets?, srcPath? }`.
 * @returns {{changed: boolean, count: number}} what happened.
 */
export function bakePresetDeclarations(options = {}) {
  const path = options.srcPath ?? srcPath
  const presets = options.presets ?? PRESETS
  const source = readFileSync(path, 'utf8')
  const line = normalizeDeclarationLine(declarationSource(presets))
  if (!DECLARATION_LINE.test(source)) {
    throw new Error('build-presets: client.src.js has no "const PRESET_DECLARATIONS = …" line')
  }
  const next = source.replace(DECLARATION_LINE, () => line)
  if (next === source) return { changed: false, count: presets.length }
  writeFileSync(path, next)
  return { changed: true, count: presets.length }
}

// `node scripts/build-presets.mjs` bakes; `--check` verifies without writing.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  if (process.argv.includes('--check')) {
    const source = readFileSync(srcPath, 'utf8')
    if (!declarationsAreCurrent(source)) {
      process.stderr.write('build-presets: client.src.js is STALE versus lib/presets.js — run node scripts/build-presets.mjs\n')
      process.exit(1)
    }
    process.stdout.write(`build-presets: current (${browserDeclarations().length} declarations)\n`)
  } else {
    const result = bakePresetDeclarations()
    process.stdout.write(`build-presets: ${result.changed ? 'wrote' : 'unchanged'} (${result.count} declarations)\n`)
  }
}
