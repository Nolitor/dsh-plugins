/**
 * Durable DSH-session → OpenCode-session map.
 *
 * The OpenCode HTTP route keeps one OpenCode session per DSH session so that a
 * continued conversation sends only the new user text and reuses the server's
 * prefix cache. The adapter instance can outlive a DSH process (attach mode, a
 * shared `opencode service`, or a host restart that leaves the daemon alive),
 * so the map is persisted next to the model snapshot and reloaded on
 * construction. A stale id is harmless: adoption re-validates it with
 * `GET /api/session/{id}` and falls back to creating a new session.
 *
 * Writes are best-effort and atomic (temp file + rename); a failed write never
 * fails a generation.
 */
import { mkdirSync, readFileSync } from 'node:fs'
import { rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

/** Schema version of the persisted file. */
export const SESSION_MAP_VERSION = 1

/** File name used when the host resolves a path from the active profile. */
export const SESSION_MAP_FILE_NAME = 'opencode-sessions.json'

/**
 * One persisted mapping. `directory` is the OpenCode session's creation
 * directory; a resumed DSH session in another directory must not adopt it.
 *
 * @typedef {{ sessionID: string, modelKey?: string, directory?: string }} SessionEntry
 */

/**
 * Load the persisted map, tolerating a missing, unreadable, or foreign file.
 *
 * @param {string} path Absolute file path, or '' for an in-memory-only map.
 * @returns {Record<string, SessionEntry>}
 */
function loadEntries(path) {
  if (!path) return {}
  try {
    const raw = readFileSync(path, 'utf8')
    if (!raw.trim()) return {}
    const parsed = JSON.parse(raw)
    if (parsed?.version !== SESSION_MAP_VERSION || typeof parsed.sessions !== 'object') return {}
    return parsed.sessions ?? {}
  } catch {
    /* missing or invalid state is the cold-start case, not an error */
    return {}
  }
}

/**
 * Persisted DSH-session → OpenCode-session map.
 */
export class SessionMap {
  /** @type {Record<string, SessionEntry>} */
  #entries

  /** @type {string} */
  #path

  /** @type {Promise<void> | null} */
  #writing = null

  /** @type {boolean} */
  #dirty = false

  /**
   * @param {string} path Absolute file path, or '' to keep the map in memory.
   */
  constructor(path) {
    this.#path = path
    this.#entries = loadEntries(path)
  }

  /** Number of persisted mappings. */
  get size() {
    return Object.keys(this.#entries).length
  }

  /**
   * @param {string} key DSH session id.
   * @returns {SessionEntry | null}
   */
  get(key) {
    if (!key) return null
    const entry = this.#entries[key]
    return entry && typeof entry.sessionID === 'string' ? entry : null
  }

  /**
   * Remember one mapping and schedule a flush.
   *
   * @param {string} key DSH session id.
   * @param {SessionEntry} entry
   */
  set(key, entry) {
    if (!key || !entry?.sessionID) return
    this.#entries[key] = entry
    this.flush()
  }

  /**
   * Drop one mapping (stale session id or model switch failure).
   *
   * @param {string} key DSH session id.
   */
  delete(key) {
    if (!key || !(key in this.#entries)) return
    delete this.#entries[key]
    this.flush()
  }

  /**
   * Serialize one atomic write. Concurrent callers coalesce onto the write in
   * flight and a later `set`/`delete` marks the map dirty for one more pass.
   */
  flush() {
    this.#dirty = true
    if (this.#writing) return
    this.#writing = (async () => {
      try {
        while (this.#dirty) {
          this.#dirty = false
          if (!this.#path) continue
          const body = JSON.stringify({ version: SESSION_MAP_VERSION, sessions: this.#entries }, null, 2)
          const temp = `${this.#path}.tmp`
          try {
            mkdirSync(dirname(this.#path), { recursive: true })
            await writeFile(temp, `${body}\n`, 'utf8')
            await rename(temp, this.#path)
          } catch {
            /* best effort: the in-memory map stays authoritative for this process */
          }
        }
      } finally {
        this.#writing = null
      }
    })()
  }
}
