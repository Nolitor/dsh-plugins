/**
 * Durable model-catalog snapshot + its refresh lifecycle.
 *
 * The catalog is what the Web model picker reads (`session/modelCatalog` →
 * `LlmAdapter.listModels`). A cold DSH boot used to await a live probe
 * (`GET /api/model` or one `opencode models` child) before it could answer, and
 * a probe that failed left the picker empty until the daemon came back.
 *
 * This module keeps the last good catalog in a small JSON file:
 *   - `CatalogStore.load()` runs synchronously during plugin activation, so the
 *     first `listModels()` answers from memory in microseconds;
 *   - a probe result rewrites the file atomically (temp file + rename);
 *   - a changed catalog notifies the host so every connected client refetches
 *     (`ctx.emit('llm/models-updated', providerId)`).
 *
 * Freshness is deliberately *not* a timer on the read path: `read()` returns the
 * cached catalog immediately and revalidates in the background once it is older
 * than `cacheMs` (stale-while-revalidate). The optional sync timer keeps the
 * snapshot warm even when nobody opens the picker.
 *
 * @module @nolit/dsh-opencode-v2/catalog
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
 * @param {readonly { id: string, name?: string, contextWindow?: number, maxTokens?: number, variants?: readonly string[], inputModalities?: readonly string[], reasoningField?: string }[]} models
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
      ].join('\u0000'),
    )
    .join('\u0001')
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
 * Last-good catalog cache with background revalidation.
 *
 * One instance owns one adapter's catalog: the in-memory result, the durable
 * snapshot, the single-flight probe, and the "changed" notification.
 */
export class CatalogLifecycle {
  #probe
  #store
  #cacheMs
  #syncMs
  #onChanged
  #warn
  #now
  #timer
  #refreshing
  #state
  #lastError

  /**
   * @param {{
   *   probe: (signal?: AbortSignal) => Promise<{ models: object[] } | null>,
   *   store: { load: () => ({ savedAt: number, source: string, models: object[] } | null), save: (snapshot: { savedAt: number, source: string, models: object[] }) => Promise<void> },
   *   cacheMs: () => number,
   *   syncMs: () => number,
   *   onChanged?: (models: object[]) => void,
   *   now?: () => number,
   *   warn?: (message: string) => void,
   * }} options Probe, persistence, timing, and change notification.
   */
  constructor({ probe, store, cacheMs, syncMs, onChanged, now, warn }) {
    this.#probe = probe
    this.#store = store
    this.#cacheMs = cacheMs
    this.#onChanged = onChanged
    this.#now = now ?? Date.now
    this.#warn = warn ?? (() => {})
    this.#syncMs = syncMs
    this.#state = null
    this.#refreshing = null
    this.#timer = null
  }

  /** Load the durable snapshot synchronously; call once during activation. */
  seed() {
    if (this.#state !== null) return this.#state
    const snapshot = this.#store.load()
    if (snapshot === null) return null
    this.#state = { at: snapshot.savedAt, result: { models: snapshot.models }, source: snapshot.source }
    return this.#state
  }

  /**
   * Current catalog without I/O.
   *
   * @returns {{ at: number, result: { models: object[] }, source: string } | null}
   *   Last known catalog and its provenance, or null before any seed/probe.
   */
  current() {
    return this.#state
  }

  /**
   * Seed an in-memory catalog without a probe or a file.
   *
   * Hosts that receive a catalog from somewhere other than {@link refresh}
   * (tests, warm hand-off between generations) use this instead of writing a
   * snapshot first.
   *
   * @param {{ models: object[] }} result Catalog to publish.
   * @param {number} [at] Freshness timestamp; defaults to now.
   * @returns {void}
   */
  prime(result, at = this.#now()) {
    this.#state = { at, result, source: 'primed' }
  }

  /** Whether the current catalog is older than the configured freshness window. */
  #stale() {
    if (this.#state === null) return true
    const cacheMs = Math.max(0, this.#cacheMs())
    return cacheMs === 0 || this.#now() - this.#state.at >= cacheMs
  }

  /** Diagnostic of the most recent failed probe, cleared by the next usable result. */
  get lastError() {
    return this.#lastError
  }

  /**
   * Read the catalog, awaiting a probe only when nothing is cached yet.
   *
   * A stale cache answers immediately and revalidates in the background, so the
   * model picker never waits on the OpenCode daemon after the first snapshot.
   *
   * @param {AbortSignal} [signal] Caller lifetime for the cold-path probe.
   * @returns {Promise<{ models: object[] } | null>} Current catalog.
   */
  async read(signal) {
    const state = this.#state ?? this.seed()
    if (state === null) return this.refresh(signal)
    if (this.#stale()) void this.refresh()
    return state.result
  }

  /**
   * Probe once (single-flight) and publish the result.
   *
   * @param {AbortSignal} [signal] Caller lifetime; resolution still updates the shared cache.
   * @returns {Promise<{ models: object[] } | null>} Fresh catalog, or null when the probe failed or returned nothing usable.
   */
  async refresh(signal) {
    if (this.#refreshing !== null) return this.#refreshing
    this.#refreshing = (async () => {
      let result
      try {
        result = await this.#probe(signal)
      } catch (error) {
        this.#lastError = error
        this.#warn(`model catalog probe failed: ${error instanceof Error ? error.message : String(error)}`)
        return null
      }
      if (!result || !Array.isArray(result.models) || result.models.length === 0) return null
      this.#lastError = undefined
      const changed = this.#state === null || catalogSignature(this.#state.result.models) !== catalogSignature(result.models)
      this.#state = { at: this.#now(), result, source: 'probe' }
      await this.#persist()
      if (changed) this.#notify(result.models)
      return result
    })().finally(() => {
      this.#refreshing = null
    })
    return this.#refreshing
  }

  async #persist() {
    if (this.#state === null) return
    try {
      await this.#store.save({ savedAt: this.#state.at, source: this.#state.source, models: this.#state.result.models })
    } catch (error) {
      this.#warn(`model catalog snapshot write failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  #notify(models) {
    try {
      this.#onChanged?.(models)
    } catch (error) {
      this.#warn(`model catalog change listener failed: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  /**
   * Keep the snapshot warm: refresh now when stale, then every `syncMs`.
   *
   * A non-positive `syncMs` disables the timer; the stale-read path still
   * revalidates on demand.
   */
  start() {
    const every = this.#syncMs()
    if (!Number.isFinite(every) || every <= 0 || this.#timer !== null) return
    void this.refresh()
    this.#timer = setInterval(() => void this.refresh(), every)
    if (typeof this.#timer.unref === 'function') this.#timer.unref()
  }

  /** Stop the sync timer; an in-flight refresh keeps running. */
  stop() {
    if (this.#timer === null) return
    clearInterval(this.#timer)
    this.#timer = null
  }
}

/**
 * Filesystem-backed store for one adapter's snapshot.
 *
 * `load` is synchronous because activation must not await I/O; `save` is async
 * and best-effort — the in-memory catalog is authoritative for the process.
 */
export class CatalogStore {
  #path

  /** @param {string} path Snapshot path. */
  constructor(path) {
    this.#path = path
  }

  /** @returns {string} Snapshot path. */
  get path() {
    return this.#path
  }

  /** @returns {{ savedAt: number, source: string, models: object[] } | null} */
  load() {
    if (this.#path === '') return null
    return readCatalogSnapshot(this.#path)
  }

  /**
   * @param {{ savedAt: number, source: string, models: object[] }} snapshot
   * @returns {Promise<void>} Resolution after the write, or immediately when no path is configured.
   */
  save(snapshot) {
    if (this.#path === '') return Promise.resolve()
    return writeCatalogSnapshot(this.#path, snapshot)
  }
}
