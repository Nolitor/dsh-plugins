/**
 * The two-value identity model for a DSH session.
 *
 * A session header is immutable: it "retains the original project". The directory a session is
 * working in, however, changes, and the harness reports every change as a separate
 * `working-directory/change` event. Conflating the two is the bug this module exists to end.
 *
 * - `projectDir` is the immutable anchor taken from the session header `cwd`. It partitions the
 *   ledger, the tool-evidence buckets, the engine repository key, and the recall scope.
 * - `liveDir` is the directory in force right now, taken from `working-directory/change`. It is
 *   what operations that touch the actual filesystem must use.
 *
 * Resolution is a precedence, not a guess: a record already persisted for this project wins
 * verbatim, otherwise the anchor is derived from the git remote (stable across clones), else from
 * the checkout path, else from the directory itself. A header with no `cwd` is `unanchored`: there
 * is no anchor to persist, so no key is minted and nothing throws.
 */

import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

import { BY_PATH, BY_REMOTE, repoIdentity } from './repokey.js'

/** The schema version of a persisted identity record. */
export const IDENTITY_SCHEMA_VERSION = 1

/** Where identity records live under the TokenEconomizer state root. */
const IDENTITY_DIR = 'identities'

/**
 * Resolve a path to its canonical absolute form.
 * @param {unknown} input - the path candidate.
 * @returns {{ path: string | null, warning: string | null }} the canonical path, or null.
 */
function canonicalPath (input) {
  if (typeof input !== 'string' || !input.trim()) return { path: null, warning: null }
  const absolute = resolve(input)
  try {
    return { path: realpathSync(absolute), warning: null }
  } catch {
    return { path: absolute, warning: `cannot canonicalize ${absolute}; using the lexical path` }
  }
}

/**
 * Whether two recorded project directories name the same directory.
 * @param {unknown} left - one project directory.
 * @param {unknown} right - the other project directory.
 * @returns {boolean} true when both canonicalize to the same path.
 */
function sameProject (left, right) {
  const a = canonicalPath(left).path
  const b = canonicalPath(right).path
  return Boolean(a) && a === b
}

/**
 * Flatten any persisted-records container into a list of records.
 *
 * Callers keep their records in a `Map`, an array, or a plain object; all three are accepted so
 * the fast path never depends on one caller's shape.
 * @param {unknown} value - the container.
 * @returns {object[]} the records, best effort.
 */
function listRecords (value) {
  const records = []
  if (!value) return records
  if (value instanceof Map) {
    for (const entry of value.values()) {
      if (entry && typeof entry === 'object') records.push(entry)
    }
    return records
  }
  if (Array.isArray(value)) {
    for (const entry of value) {
      if (entry && typeof entry === 'object') records.push(entry)
    }
    return records
  }
  if (typeof value === 'object') {
    for (const [key, entry] of Object.entries(value)) {
      if (entry && typeof entry === 'object') {
        records.push(entry.identityKey ? entry : { ...entry, identityKey: key })
      }
    }
  }
  return records
}

/**
 * The anchor for a project directory: the repository root when there is one, else the directory.
 * @param {string} start - the session header `cwd`.
 * @param {Record<string, string | undefined>} env - environment to read the git ceilings from.
 * @returns {{ projectDir: string | null, resolvedBy: string, engineRepoKey: string | null,
 *   warnings: string[] }} the anchored identity pieces.
 */
function anchorFor (start, env) {
  const warnings = []
  const canonicalStart = canonicalPath(start)
  if (canonicalStart.warning) warnings.push(canonicalStart.warning)
  if (!canonicalStart.path) {
    return { projectDir: null, resolvedBy: 'unanchored', engineRepoKey: null, warnings }
  }
  const identity = repoIdentity(canonicalStart.path, env)
  const canonicalRoot = canonicalPath(identity.root)
  if (canonicalRoot.warning) warnings.push(canonicalRoot.warning)
  const projectDir = canonicalRoot.path || canonicalStart.path
  const resolvedBy = identity.how === BY_REMOTE ? 'git-remote' : identity.how === BY_PATH ? 'git-path' : 'dir'
  return { projectDir, resolvedBy, engineRepoKey: identity.key, warnings }
}

/**
 * Resolve the identity of one session. Appends no session record: the caller appends.
 * @param {object} sessionHeader - the immutable session header (`cwd`, `parentSession`, ...).
 * @param {string} [liveCwd] - the current directory from `working-directory/change`.
 * @param {Map | object[] | object} [persistedRecords] - identity records already persisted.
 * @param {{ env?: Record<string, string | undefined>, identityKey?: string, time?: number }} [options]
 *   environment, a previously persisted key hint, and an injectable clock.
 * @returns {object} the identity record, with a `warning` field when anything failed or moved.
 */
export function resolveIdentity (sessionHeader, liveCwd, persistedRecords, options = {}) {
  const env = options.env ?? process.env
  const header = sessionHeader && typeof sessionHeader === 'object' ? sessionHeader : {}
  const time = Number.isFinite(options.time) ? options.time : Date.now()
  const base = {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    parentSession: header.parentSession ?? null,
    delegationDepth:
      Number.isInteger(header.delegationDepth) && header.delegationDepth > 0 ? header.delegationDepth : 0,
  }
  const persisted = listRecords(persistedRecords)
  const previousKey = typeof options.identityKey === 'string' && options.identityKey ? options.identityKey : null
  const headerCwd = typeof header.cwd === 'string' && header.cwd.trim() ? header.cwd.trim() : ''
  const liveSource = typeof liveCwd === 'string' && liveCwd.trim() ? liveCwd.trim() : headerCwd
  const liveCanonical = canonicalPath(liveSource)

  // 6. unanchored: a header without `cwd` has no anchor to persist. Never throw.
  if (!headerCwd) {
    return {
      ...base,
      identityKey: null,
      projectDir: null,
      liveDir: liveCanonical.path,
      resolvedBy: 'unanchored',
      engineRepoKey: null,
      moved: false,
      unanchored: true,
      time,
      warning: 'session header carries no cwd; identity is unanchored',
    }
  }

  const anchored = anchorFor(headerCwd, env)
  const warnings = [...anchored.warnings]
  if (liveCanonical.warning) warnings.push(liveCanonical.warning)
  const projectDir = anchored.projectDir
  const engineRepoKey = anchored.engineRepoKey
  const resolvedBy = anchored.resolvedBy

  // 1. persisted fast path: a record already persisted for this project wins verbatim.
  const samePath = persisted.find(entry => projectDir && sameProject(entry.projectDir, projectDir)) || null
  const persistedRecord =
    persisted.find(entry => entry.identityKey === engineRepoKey && entry.identityKey && sameProject(entry.projectDir, projectDir)) ||
    samePath ||
    null
  if (persistedRecord) {
    const merged = {
      ...persistedRecord,
      schemaVersion: IDENTITY_SCHEMA_VERSION,
      resolvedBy: 'persisted',
      liveDir: liveCanonical.path ?? persistedRecord.liveDir ?? projectDir,
      time,
    }
    if (warnings.length) merged.warning = warnings.concat(persistedRecord.warning ? [persistedRecord.warning] : []).join('; ')
    return merged
  }

  // 7. moved: the same identity was persisted under a different project path.
  const movedFrom =
    persisted.find(
      entry =>
        entry.identityKey &&
        entry.projectDir &&
        (entry.identityKey === engineRepoKey || (previousKey && entry.identityKey === previousKey)) &&
        !sameProject(entry.projectDir, projectDir),
    ) || null
  if (movedFrom) {
    const from = canonicalPath(movedFrom.projectDir).path || movedFrom.projectDir
    return {
      ...base,
      identityKey: engineRepoKey,
      projectDir,
      liveDir: liveCanonical.path ?? projectDir,
      resolvedBy,
      engineRepoKey,
      moved: true,
      unanchored: false,
      previousProjectDir: from,
      time,
      warning: `project moved: identity ${engineRepoKey} was anchored at ${from}, re-adopted at ${projectDir}`,
    }
  }

  const record = {
    ...base,
    identityKey: engineRepoKey,
    projectDir,
    liveDir: liveCanonical.path ?? projectDir,
    resolvedBy,
    engineRepoKey,
    moved: false,
    unanchored: false,
    time,
  }
  if (warnings.length) record.warning = warnings.join('; ')
  return record
}

/**
 * The stable key of an identity record.
 * @param {object | null} record - the record.
 * @returns {string | null} the key, or null for an unanchored record.
 */
export function identityKeyOf (record) {
  const key = record && typeof record.identityKey === 'string' ? record.identityKey : ''
  return key || null
}

/**
 * The file a record for one key is persisted to.
 * @param {string} stateRoot - the TokenEconomizer state root.
 * @param {string} key - the identity key.
 * @returns {string} the absolute record path.
 */
function recordPath (stateRoot, key) {
  return join(stateRoot, IDENTITY_DIR, `${key}.json`)
}

/**
 * Read the persisted identity record for one key.
 * @param {string} stateRoot - the TokenEconomizer state root.
 * @param {string} identityKey - the identity key.
 * @returns {object | null} the record, or null when there is no record for that key.
 */
export function readIdentity (stateRoot, identityKey) {
  if (typeof stateRoot !== 'string' || !stateRoot || typeof identityKey !== 'string' || !identityKey) return null
  let text
  try {
    text = readFileSync(recordPath(stateRoot, identityKey), 'utf8')
  } catch {
    return null
  }
  let parsed
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  if (!parsed || typeof parsed !== 'object' || parsed.schemaVersion !== IDENTITY_SCHEMA_VERSION) return null
  return parsed
}

/**
 * Persist an identity record under its own key.
 * @param {string} stateRoot - the TokenEconomizer state root.
 * @param {object} record - the record to persist.
 * @returns {string | null} the written path, or null when the record has no key.
 */
export function writeIdentity (stateRoot, record) {
  if (typeof stateRoot !== 'string' || !stateRoot) return null
  if (!record || typeof record !== 'object') return null
  const key = identityKeyOf(record)
  if (!key) return null
  const path = recordPath(stateRoot, key)
  mkdirSync(join(stateRoot, IDENTITY_DIR), { recursive: true })
  const stored = { ...record, schemaVersion: IDENTITY_SCHEMA_VERSION }
  writeFileSync(path, `${JSON.stringify(stored, null, 2)}\n`, 'utf8')
  return path
}

/**
 * Record that a legacy engine key belongs to an identity.
 *
 * The engine key is persisted data, not a re-derivation: see `lib/repokey-bridge.js`, where the
 * engine's own canonicalization is marked unverifiable from this host. This shim only writes the
 * association down; it never claims the key equals what the engine would compute.
 * @param {string} stateRoot - the TokenEconomizer state root.
 * @param {string} identityKey - the identity the legacy key belongs to.
 * @param {string} legacyKey - the engine repository key being adopted.
 * @returns {string | null} the written path, or null when the arguments are unusable.
 */
export function adoptLegacyKey (stateRoot, identityKey, legacyKey) {
  if (typeof identityKey !== 'string' || !identityKey) return null
  if (typeof legacyKey !== 'string' || !legacyKey) return null
  const existing = readIdentity(stateRoot, identityKey)
  const legacyKeys = Array.isArray(existing?.legacyKeys) ? existing.legacyKeys : []
  const record = existing
    ? { ...existing, legacyKeys: legacyKeys.includes(legacyKey) ? legacyKeys : [...legacyKeys, legacyKey] }
    : {
        schemaVersion: IDENTITY_SCHEMA_VERSION,
        identityKey,
        projectDir: null,
        liveDir: null,
        resolvedBy: 'persisted',
        engineRepoKey: legacyKey,
        parentSession: null,
        delegationDepth: 0,
        moved: false,
        unanchored: false,
        time: Date.now(),
        legacyKeys: [legacyKey],
      }
  return writeIdentity(stateRoot, record)
}
