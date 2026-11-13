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

/** The one line the bake rewrites. */
export const DECLARATION_LINE = /^\s*const PRESET_DECLARATIONS = .*$/m

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

/** Format the assignment line for the current declarations. */
export function declarationSource(presets = PRESETS) {
  const literal = JSON.stringify(browserDeclarations(presets))
  return `    const PRESET_DECLARATIONS = Object.freeze(JSON.parse(?))\n`.replace('?', JSON.stringify(literal))
}

/**
 * Whether a client source already carries the declarations `presets` derive.
 *
 * `declarationSource()` ends with the assignment line's trailing newline, while
 * `DECLARATION_LINE` (`/m`, `.*$`) never captures it. Comparing the raw strings
 * made `--check` fail forever on a semantically identical tree (measured
 * 2026-11-13), so the gate could no longer tell real drift from its own newline.
 * @param {string} source - `lib/client.src.js` text.
 * @param {readonly object[]} [presets] - declarations to derive from.
 * @returns {boolean} true when the baked line already equals the derived one.
 */
export function declarationsAreCurrent(source, presets = PRESETS) {
  const current = DECLARATION_LINE.exec(String(source ?? ''))?.[0]
  if (current === undefined) return false
  return current === declarationSource(presets).replace(/\n$/, '')
}

/**
 * Rewrite `lib/client.src.js` in place with the current declarations.
 * @param {object} [options] - `{ presets?, srcPath? }`.
 * @returns {{changed: boolean, count: number}} what happened.
 */
export function bakePresetDeclarations(options = {}) {
  const path = options.srcPath ?? srcPath
  const presets = options.presets ?? PRESETS
  const source = readFileSync(path, 'utf8')
  const line = declarationSource(presets)
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
