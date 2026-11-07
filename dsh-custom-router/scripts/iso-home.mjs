#!/usr/bin/env node
/**
 * Isolated `DSH_HOME` builder for the custom-router E2E gate.
 *
 * The router mounts vendor packages out of the live web profile (`@nolit/…`
 * links live in `~/.dsh/profiles/web/node_modules`). Booting that profile in
 * place would write the owner's live home — session logs, the session-search
 * index, per-profile caches. So this module builds a throwaway home that is a
 * *faithful copy* of the live profile and boots THAT instead:
 *
 *   1. `mkdtemp` under `${TMPDIR:-/tmp}/dsh-router-e2e-` (see note below);
 *   2. copy `package.json`, `cordis.yml`, `cordis.patch.yml`;
 *   3. symlink the live profile's `node_modules` (read-only: the vendors are
 *      `link:` dependencies, so resolution must run through the real tree);
 *   4. rewrite every absolute path under `homeRoot` (`~/.dsh`, i.e.
 *      `dirname(dirname(profileDir))`) to the temp home — a copied patch that
 *      still names `~/.dsh/session-search.db` writes the live index;
 *   5. drop the three vendor bundles from the copied `dsh.profile.bundles`, so
 *      the router is the only thing that mounts them (a profile that keeps the
 *      bundles AND mounts the router registers everything twice);
 *   6. drop the four id-targeted vendor rows from the copied patch — but parse
 *      their `config` FIRST and return it, so the router hands each vendor the
 *      configuration the live profile was actually running;
 *   7. add preset-id aliases next to the row ids, because the seam scopes
 *      `vendorConfig` differently in its two call sites: `probe()` reads
 *      `vendorConfig[preset.id]` (`antigravity`), `apply()` reads
 *      `vendorConfig[entry.row]` (`dsh-antigravity`). Supplying both is the
 *      only shape that serves both without a third table.
 *
 * Measured contract note: `fs.mkdtemp` templates must end in exactly six `X`
 * characters *or no X at all*. Passing the shell-style `dsh-router-e2e-XXXXXX`
 * makes Node append six more characters AND print
 * `Warning: mkdtemp() templates ending with X are not portable` (measured
 * 2026-11-08: `/tmp/dsh-router-e2e-XXXXXXVI3vsN`). The template used here is
 * therefore `dsh-router-e2e-`, which yields
 * `${TMPDIR:-/tmp}/dsh-router-e2e-<6 random chars>` — the same layout the
 * documented `mktemp -d …-XXXXXX` produces, without the warning.
 *
 * Secrets: the copied patch can carry a provider `apiKey` (DeepInfra does) and
 * the vendor rows can carry OAuth material. Those values are returned only
 * inside `vendorConfig`, never printed, and never written outside the temp
 * home. Nothing in this module logs a config value.
 *
 * `dsh-isolation: read-only-live-home` — this module READS the live profile and
 * writes only inside its throwaway home; it never launches `dsh`.
 *
 * @module @nolit/dsh-custom-router/scripts/iso-home
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

/** Patch row ids whose rows target the router's vendor packages. */
export const VENDOR_ROWS = Object.freeze([
  'dsh-antigravity',
  'dsh-deepinfra',
  'dsh-opencode-v2',
  'dsh-opencode-v2-http',
])

/** `dsh.profile.bundles` entries that would mount the same vendors a second time. */
export const VENDOR_BUNDLES = Object.freeze([
  '@nolit/dsh-deepinfra',
  '@nolit/dsh-opencode-v2',
  '@nolit/dsh-antigravity',
])

/**
 * Preset id → row id. `probe()` scopes by preset id and `apply()` by row id, so
 * `vendorConfig` must answer both keys.
 */
export const PRESET_ALIASES = Object.freeze({
  antigravity: 'dsh-antigravity',
  deepinfra: 'dsh-deepinfra',
  opencode: 'dsh-opencode-v2',
})

/** Profile files copied into the isolated home. */
const PROFILE_FILES = Object.freeze(['package.json', 'cordis.yml', 'cordis.patch.yml'])

/**
 * Resolve the installed `dsh` package root from the CLI on PATH.
 * @returns {string} absolute package root (the directory holding `lib/`).
 * @throws {Error} when `dsh` is not on PATH.
 */
export function dshRoot() {
  const bin = execFileSync('bash', ['-lc', 'command -v dsh'], { encoding: 'utf8' }).trim()
  if (bin === '') throw new Error('dsh is not on PATH')
  return resolve(dirname(realpathSync(bin)), '..')
}

/**
 * The live web profile this harness copies (read-only).
 * @returns {string} absolute profile directory.
 */
export function defaultProfileDir() {
  return resolve(homedir(), '.dsh', 'profiles', 'web')
}

/** Load the `yaml` package the boot itself uses, so parse and stringify agree. */
function loadYaml(root = dshRoot()) {
  const require = createRequire(join(root, 'package.json'))
  return require('yaml')
}

/**
 * Rewrite every absolute `homeRoot` occurrence in one copied file.
 * @param {string} file - copied file path.
 * @param {string} homeRoot - live home root (`~/.dsh`).
 * @param {string} home - temp home root.
 * @returns {number} how many occurrences were rewritten.
 */
function rewriteHomePaths(file, homeRoot, home) {
  const before = readFileSync(file, 'utf8')
  const after = before.split(homeRoot).join(home)
  const count = before === after ? 0 : before.split(homeRoot).length - 1
  if (count > 0) writeFileSync(file, after)
  return count
}

/**
 * Build a throwaway, self-referential copy of a live DSH profile.
 *
 * @param {object} [options] - `{ profileDir?, tmpRoot?, yaml? }`.
 * @param {string} [options.profileDir] - live profile to copy (default: `~/.dsh/profiles/web`).
 * @param {string} [options.tmpRoot] - parent for the temp home (default: `$TMPDIR` or `/tmp`).
 * @param {object} [options.yaml] - injected YAML implementation (tests).
 * @returns {{
 *   home: string,
 *   profileOut: string,
 *   vendorConfig: Record<string, object>,
 *   missingRows: string[],
 *   droppedBundles: string[],
 *   removedRowIds: string[],
 *   keptRowIds: string[],
 *   disposed: () => boolean,
 *   dispose: () => void,
 * }} the isolated home and its disposal.
 * @throws {Error} with the offending absolute path when a required file is absent,
 *   or when the patch is not a row array (silently keeping the vendor rows would
 *   mount every vendor twice).
 */
export function buildIsolatedHome(options = {}) {
  const source = resolve(options.profileDir ?? defaultProfileDir())
  const yaml = options.yaml ?? loadYaml()

  for (const name of PROFILE_FILES) {
    const file = join(source, name)
    if (!existsSync(file)) throw new Error(`iso-home: required profile file is missing: ${file}`)
  }
  const sourceModules = join(source, 'node_modules')
  if (!existsSync(sourceModules)) throw new Error(`iso-home: live profile has no node_modules to link: ${sourceModules}`)

  const tmpRoot = (options.tmpRoot ?? process.env.TMPDIR ?? '/tmp').trim() || '/tmp'
  const home = mkdtempSync(join(tmpRoot, 'dsh-router-e2e-'))
  const profileOut = join(home, 'profiles', 'web')
  const homeRoot = dirname(dirname(source))

  let disposed = false
  const dispose = () => {
    if (disposed) return
    disposed = true
    rmSync(home, { recursive: true, force: true })
  }

  try {
    mkdirSync(profileOut, { recursive: true })

    // 1. Copy the three manifest files, then re-root every absolute home path.
    for (const name of PROFILE_FILES) copyFileSync(join(source, name), join(profileOut, name))
    for (const name of PROFILE_FILES) rewriteHomePaths(join(profileOut, name), homeRoot, home)

    // 2. Link the live dependency tree (the vendors are `link:` dependencies).
    symlinkSync(sourceModules, join(profileOut, 'node_modules'), 'dir')

    // 3. Parse the copied patch: read the vendor rows BEFORE dropping them.
    const patchPath = join(profileOut, 'cordis.patch.yml')
    const rows = yaml.parse(readFileSync(patchPath, 'utf8'))
    if (!Array.isArray(rows)) {
      throw new Error(`iso-home: ${join(source, 'cordis.patch.yml')} is not a YAML row array (got ${typeof rows}); refusing to build a home that would mount the vendors twice`)
    }

    const byId = new Map()
    for (const row of rows) {
      if (row !== null && typeof row === 'object' && typeof row.id === 'string') byId.set(row.id, row)
    }

    /** @type {Record<string, object>} */
    const vendorConfig = {}
    const missingRows = []
    for (const id of VENDOR_ROWS) {
      const row = byId.get(id)
      if (row === undefined) {
        missingRows.push(id)
        continue
      }
      vendorConfig[id] = row.config ?? {}
    }
    // 4. Preset-id aliases: the seam's probe() scopes by preset.id, its apply() by row.
    for (const [presetId, rowId] of Object.entries(PRESET_ALIASES)) {
      if (vendorConfig[rowId] !== undefined) vendorConfig[presetId] ??= vendorConfig[rowId]
    }

    const removedRowIds = rows
      .filter((row) => row !== null && typeof row === 'object' && VENDOR_ROWS.includes(row.id))
      .map((row) => row.id)
    const kept = rows.filter((row) => !(row !== null && typeof row === 'object' && VENDOR_ROWS.includes(row.id)))
    writeFileSync(patchPath, yaml.stringify(kept))

    // 5. Drop the vendor bundles so only the router mounts them.
    const pkgPath = join(profileOut, 'package.json')
    const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
    const bundles = pkg?.dsh?.profile?.bundles
    if (!Array.isArray(bundles)) {
      throw new Error(`iso-home: ${join(source, 'package.json')} has no dsh.profile.bundles array`)
    }
    const droppedBundles = bundles.filter((name) => VENDOR_BUNDLES.includes(name))
    pkg.dsh.profile.bundles = bundles.filter((name) => !VENDOR_BUNDLES.includes(name))
    writeFileSync(pkgPath, `${JSON.stringify(pkg, null, 2)}\n`)

    return {
      home,
      profileOut,
      vendorConfig,
      missingRows,
      droppedBundles,
      removedRowIds,
      keptRowIds: kept.filter((row) => row !== null && typeof row === 'object' && typeof row.id === 'string').map((row) => row.id),
      disposed: () => disposed,
      dispose,
    }
  } catch (error) {
    dispose()
    throw error
  }
}

// `node scripts/iso-home.mjs` builds and immediately disposes a home: a smoke
// test for the copy step that never boots anything and prints no config value.
if (process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop())) {
  const built = buildIsolatedHome()
  process.stdout.write(`iso-home: ok ${built.profileOut}\n`)
  process.stdout.write(`iso-home: vendorConfig rows ${VENDOR_ROWS.filter((id) => built.vendorConfig[id] !== undefined).join(', ') || '(none)'}\n`)
  if (built.missingRows.length > 0) process.stdout.write(`iso-home: rows missing from the live patch: ${built.missingRows.join(', ')}\n`)
  process.stdout.write(`iso-home: bundles dropped ${built.droppedBundles.length}/${VENDOR_BUNDLES.length}\n`)
  built.dispose()
  process.stdout.write(`iso-home: disposed ${!built.disposed()}\n`)
}
