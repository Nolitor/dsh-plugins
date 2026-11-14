/**
 * Where an OpenCode catalog snapshot lives, what identifies its contents, and
 * the exact on-disk format it keeps.
 *
 * The cache itself is the router's one module (`lib/catalog-cache.js`): TTL,
 * single-flight probe, stale answer, and "a failed refresh never becomes fresh
 * data" all belong there. This file keeps only what is genuinely OpenCode-side:
 *
 *   - `resolveCatalogPath` — the explicit -> profile -> `$DSH_HOME` rule, shared
 *     by the catalog, the verdict snapshot, the spend ledger, and the two
 *     sidecar caches, so all of them land in one directory;
 *   - `catalogSignature` — the content identity that decides whether a changed
 *     catalog is worth announcing to connected clients;
 *   - the snapshot record, and the seam that adapts it to the router cache.
 *
 * **The on-disk shape did not change** when `catalog-cache.js` was folded into
 * the router module: a file written by the previous implementation is still
 * `{ version: 1, savedAt, source, models }`, and still loads. The router cache
 * stores the probe result under `value`, so {@link catalogSnapshotFs} translates
 * `value.models` <-> `models` in both directions instead of rewriting operator
 * state on upgrade.
 *
 * @module @nolit/dsh-opencode-v2/catalog-file
 */
import { readFileSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** On-disk format version; a mismatch discards the snapshot instead of guessing. */
export const CATALOG_FILE_VERSION = 1

/** Default name of a profile's catalog snapshot for one transport. */
export const CATALOG_FILE_NAME = 'opencode-models.json'

/**
 * Resolve where a profile keeps its catalog snapshot.
 *
 * Explicit configuration wins; otherwise the active profile directory owns the
 * file (one snapshot per deployment), and a host without a profile (tests,
 * headless embedders) falls back under `$DSH_HOME`.
 *
 * @param {{ explicit?: string, profileDir?: string, dshHome?: string, fileName?: string }} options
 *   Path sources, most specific first.
 * @returns {string} Absolute path of the snapshot file.
 */
export function resolveCatalogPath({ explicit, profileDir, dshHome, fileName = CATALOG_FILE_NAME }) {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  if (typeof profileDir === 'string' && profileDir.length > 0) return join(profileDir, fileName)
  if (typeof dshHome === 'string' && dshHome.length > 0) return join(dshHome, 'cache', fileName)
  // No profile and no DSH_HOME: keep the catalog in memory rather than writing
  // into the process working directory.
  return ''
}

/**
 * Stable identity of a catalog's contents.
 *
 * Refresh writes are skipped and clients are not notified when this string is
 * unchanged, so a no-op poll costs one probe and nothing else.
 *
 * Modalities and the route's reasoning field are part of the identity: a route
 * that starts accepting images, or that renames its reasoning field, changes what
 * the picker offers and what the stream reader looks for, so a snapshot that
 * differs only there must not be treated as "unchanged".
 *
 * The wire identity (`package`) and the `compatibility` declaration are part of
 * it for the same reason: the same model id can move from an OpenAI chat package
 * to an Anthropic one, and the request builder's behaviour changes with it.
 *
 * @param {readonly { id: string, name?: string, contextWindow?: number, maxTokens?: number, variants?: readonly string[], inputModalities?: readonly string[], reasoningField?: string, package?: string, compatibility?: Record<string, unknown>, unverifiedWire?: boolean }[]} models
 * @returns {string} Deterministic signature.
 */
export function catalogSignature(models) {
  return models
    .map((model) =>
      [
        model.id,
        model.name ?? '',
        model.contextWindow ?? '',
        model.maxTokens ?? '',
        (model.variants ?? []).join('|'),
        (model.inputModalities ?? []).join('|'),
        model.reasoningField ?? '',
        model.package ?? '',
        stableCompatibility(model.compatibility),
        model.unverifiedWire === true ? 'unverified' : '',
      ].join('\u0000'),
    )
    .join('\u0001')
}

/**
 * Signature of a probe result, tolerating the `undefined`/`null` a cold or
 * failed read answers with.
 *
 * @param {{ models?: object[] } | null | undefined} result Catalog, if any.
 * @returns {string} Deterministic signature; empty for a missing catalog.
 */
export function signatureOf(result) {
  const models = result?.models
  return Array.isArray(models) ? catalogSignature(models) : ''
}

/**
 * Key-sorted serialization of a `compatibility` declaration.
 *
 * Sorted so a declaration that differs only in key insertion order keeps the
 * same identity; a different value or key changes it.
 *
 * @param {unknown} compatibility
 * @returns {string} Stable one-line form, empty when absent.
 */
function stableCompatibility(compatibility) {
  if (!compatibility || typeof compatibility !== 'object' || Array.isArray(compatibility)) return ''
  return Object.keys(compatibility)
    .sort()
    .map((key) => `${key}=${JSON.stringify(compatibility[key])}`)
    .join(',')
}

/**
 * Parse a snapshot body without throwing: a malformed, version-mismatched, or
 * empty catalog is simply "no snapshot".
 *
 * @param {string} text File body.
 * @returns {{ savedAt: number, source: string, models: object[] } | null} Usable snapshot, or null.
 */
function parseSnapshot(text) {
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    /* a torn write or a foreign file is not a catalog */
    return null
  }
  if (!parsed || parsed.version !== CATALOG_FILE_VERSION) return null
  if (!Array.isArray(parsed.models) || parsed.models.length === 0) return null
  if (!Number.isFinite(parsed.savedAt)) return null
  return {
    savedAt: parsed.savedAt,
    source: typeof parsed.source === 'string' ? parsed.source : 'unknown',
    models: parsed.models,
  }
}

/**
 * Read a snapshot without throwing: a missing, unreadable, malformed, or
 * version-mismatched file is simply "no snapshot".
 *
 * @param {string} path Snapshot path.
 * @returns {{ savedAt: number, source: string, models: object[] } | null}
 *   Last good catalog, or null when the file cannot be trusted.
 */
export function readCatalogSnapshot(path) {
  let text
  try {
    text = readFileSync(path, 'utf8')
  } catch {
    /* no snapshot yet: the first probe will create one */
    return null
  }
  return parseSnapshot(text)
}

/**
 * Persist a snapshot atomically, resolving on the rename.
 *
 * @param {string} path Snapshot path.
 * @param {{ savedAt: number, source: string, models: object[] }} snapshot Catalog to store.
 * @returns {Promise<void>} Resolution after the new file replaces the old one.
 */
export async function writeCatalogSnapshot(path, snapshot) {
  const body = JSON.stringify({ version: CATALOG_FILE_VERSION, ...snapshot })
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${process.pid}.tmp`
  await writeFile(temporary, body, 'utf8')
  await rename(temporary, path)
}

/**
 * Filesystem seam for the router cache (`createCatalogCache({ fs })`).
 *
 * The router cache speaks its own record (`{ version, savedAt, source, value }`);
 * this adapter keeps the FILE at the measured OpenCode shape
 * (`{ version, savedAt, source, models }`), so upgrading does not invalidate a
 * snapshot an operator already has on disk. Reads translate forward, writes
 * translate back; an unusable file is handed over as `{}` — i.e. "no snapshot" —
 * so the cache does one cold probe instead of trusting it.
 *
 * @returns {{ readFileSync: Function, mkdir: Function, writeFile: Function, rename: Function }} Injected fs.
 */
export function catalogSnapshotFs() {
  return {
    readFileSync(file) {
      let text
      try {
        text = readFileSync(file, 'utf8')
      } catch (error) {
        throw error
      }
      const snapshot = parseSnapshot(text)
      if (snapshot === null) return '{}'
      return JSON.stringify({
        version: CATALOG_FILE_VERSION,
        savedAt: snapshot.savedAt,
        source: snapshot.source,
        value: { models: snapshot.models },
      })
    },
    mkdir,
    async writeFile(file, text) {
      let record
      try {
        record = JSON.parse(text)
      } catch {
        record = null
      }
      const models = record?.value?.models
      if (!Array.isArray(models)) {
        // Nothing usable to store: leave the previous file alone.
        return
      }
      await writeFile(
        file,
        JSON.stringify({
          version: CATALOG_FILE_VERSION,
          savedAt: record.savedAt,
          source: record.source,
          models,
        }),
        'utf8',
      )
    },
    rename,
  }
}
