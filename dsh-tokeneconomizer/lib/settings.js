/**
 * External settings file for the TokenEconomizer plugin.
 *
 * The plugin's 35 options live in three places today: the code defaults, the bundle
 * patch, and (rarely) the profile patch. Changing one means editing a package. This
 * module reads a JSON file so an operator can retune the plugin without touching either
 * repository.
 *
 * ## Why a file above the Cordis layer
 *
 * A Cordis patch `config` REPLACES the whole config rather than merging
 * (`dsh-app-boot/lib/index.js:3261`: "A patch config replaces the whole config"). A
 * composed profile therefore carries a complete 35-key object, and a layer *underneath*
 * it could never win a single key. The file is merged ON TOP of the resolved Cordis
 * config instead.
 *
 * ## Why not ctx.settings
 *
 * `@deepseek-ai/dsh-settings` projects only schemastery `.volatile()` Config fields, and
 * this plugin exports no Config: DSH reports the row as `"status":"absent"`. A settings
 * form would also persist into the profile patch, which by the rule above resets the
 * other 34 keys.
 *
 * ## Failure policy
 *
 * A throw inside `apply()` costs the ENTIRE plugin (measured: `warning: 1 entry did not
 * activate`, exit code 0, no GUI banner). Nothing here throws on bad input: an
 * unreadable, malformed, wrong-typed or future-versioned file yields the defaults plus
 * one warning per rejected key.
 *
 * Runtime imports are `node:` builtins only. A new package import would fail at mount:
 * this package's `node_modules/@deepseek-ai/` symlinks are dangling.
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/** The schema version this module understands. A newer file is ignored whole. */
export const SETTINGS_VERSION = 1

/** Environment variable naming an explicit settings path (debugging and tests). */
export const SETTINGS_PATH_ENV = 'TE_CONFIG'

/**
 * Resolve the DSH home the settings file lives in.
 *
 * Read at call time, not import time: a test that rewrites `DSH_HOME` between mounts
 * must see its own value.
 * @returns {string} absolute-ish home path.
 */
export function dshHome () {
  const home = process.env.DSH_HOME
  if (typeof home === 'string' && home.length > 0) return home
  const userHome = process.env.HOME ?? ''
  return join(userHome, '.dsh')
}

/**
 * Where the settings file is expected.
 * @returns {string} the resolved path.
 */
export function settingsPath () {
  const explicit = process.env[SETTINGS_PATH_ENV]
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  return join(dshHome(), 'tokeneconomizer.json')
}

/**
 * Read and shape the settings file.
 *
 * Never throws. Every rejection is reported through the returned `problems` list and
 * costs only the offending key, because a single bad value must not silently reset the
 * other 34 nor stop the plugin from mounting.
 * @param {object} [options] - overrides, mainly for tests.
 * @param {string} [options.path] - explicit file path.
 * @param {(text: string) => void} [options.warn] - warning sink.
 * @returns {{ values: object, problems: string[], path: string, present: boolean }}
 *   the accepted values, why anything was rejected, and where it looked.
 */
export function readSettingsFile (options = {}) {
  const path = options.path ?? settingsPath()
  const warn = options.warn ?? (() => {})
  const problems = []
  const fail = (detail) => {
    problems.push(detail)
    warn(`settings: ${detail}`)
    return { values: {}, problems, path, present: false }
  }

  if (!existsSync(path)) return { values: {}, problems, path, present: false }

  let raw
  try {
    raw = readFileSync(path, 'utf8')
  } catch (error) {
    return fail(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }

  let parsed
  try {
    parsed = JSON.parse(raw)
  } catch (error) {
    return fail(`not valid JSON in ${path}: ${error instanceof Error ? error.message : String(error)}`)
  }

  if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return fail(`${path} must contain a JSON object`)
  }

  // A file from a future schema is ignored whole rather than read with today's rules:
  // guessing at semantics is how a config silently inverts its meaning.
  const version = parsed.version
  if (version !== undefined && version !== SETTINGS_VERSION) {
    return fail(`version ${String(version)} is not ${SETTINGS_VERSION}; ignoring the file`)
  }

  const values = {}
  for (const [key, value] of Object.entries(parsed)) {
    if (key === 'version') continue
    // A nested object is a shape this module does not read: the flat camelCase names are
    // the same ones the Cordis row uses, so there is no translation table to drift.
    if (value !== null && typeof value === 'object') {
      problems.push(`${key}: nested objects are not supported, use the flat key`)
      warn(`settings: ${key} ignored (nested object)`)
      continue
    }
    values[key] = value
  }

  return { values, problems, path, present: true }
}

/**
 * Merge file values on top of an already-resolved config, validating each key.
 *
 * `validate` is the plugin's own per-key order (its strict `resolveConfig`), reused as an
 * ORACLE rather than restated: a key is accepted only if resolving it alone succeeds. That
 * keeps one validator in the codebase and makes this layer incapable of admitting a value
 * the Cordis layer would reject.
 * @param {object} base - the resolved Cordis config.
 * @param {object} values - candidate values from the file.
 * @param {(candidate: object) => object} validate - the strict resolver.
 * @param {(text: string) => void} [warn] - warning sink.
 * @returns {object} the merged config.
 */
export function mergeSettings (base, values, validate, warn = () => {}) {
  const merged = { ...base }
  for (const [key, value] of Object.entries(values ?? {})) {
    if (!(key in base)) {
      warn(`settings: unknown setting ${key} ignored`)
      continue
    }
    let accepted
    try {
      accepted = validate({ [key]: value })
    } catch (error) {
      warn(`settings: ${key} rejected (${error instanceof Error ? error.message : String(error)})`)
      continue
    }
    const next = accepted[key]
    if (base[key] !== next) {
      // The operator should know which layer answered, because a later Cordis change
      // will look ineffective.
      warn(`settings: ${key}=${JSON.stringify(next)} from file shadows the composed value`)
    }
    merged[key] = next
  }
  return merged
}
