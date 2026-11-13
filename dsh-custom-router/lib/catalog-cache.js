/**
 * One model-catalog cache: TTL, single-flight fetch, explicit invalidation, and
 * a durable snapshot with stale-while-revalidate.
 *
 * This supersedes three measured implementations inside this package:
 *
 *   - `vendor/antigravity/lib/index.js:200-291` — `createCatalog`: in-memory
 *     cache + single-flight + a stale fallback, but the TTL value is re-read
 *     from config on every call and a failed refresh silently rewrites an empty
 *     catalog (so one bad poll blanks the picker until the TTL expires).
 *   - `vendor/deepinfra/lib/index.js:209-237` — `invalidateCatalog` +
 *     `catalogReader`: no in-flight dedupe (N concurrent panel reads N probes)
 *     and a stale error refreshes only `fetchedAt`, extending the life of
 *     questionable data by another full TTL.
 *   - `vendor/opencode/lib/catalog-cache.js` — the durable half: atomic
 *     snapshot writes, a versioned file, and a refresh lifecycle. That module
 *     is a class bound to fs, a probe, and a timer; this one is the seam only.
 *
 * Shared contract (deliberately narrow):
 *   - `read()` answers from memory when the entry is younger than `ttlMs`;
 *   - a miss with a previous value answers stale immediately and revalidates in
 *     the background (never blocks the model picker on a probe);
 *   - a cold miss awaits one probe, and every concurrent caller awaits that
 *     same attempt (`single-flight`);
 *   - a failed probe keeps the previous value and is reported through `lastError`
 *     instead of being camouflaged as fresh data;
 *   - `invalidate()` drops the in-memory entry so the next read probes again;
 *   - `load()` seeds memory synchronously from the snapshot, `snapshot()`
 *     returns the value to persist, and `persist()` writes it atomically.
 *
 * Pure: no fs, no timers, no fetch. The caller injects `fetch`, `fs`, the
 * snapshot `path`, and the clock, so this module runs identically in a plugin
 * and in a test.
 *
 * @module @nolit/dsh-custom-router/catalog-cache
 */

/** On-disk format version; a mismatch discards the snapshot instead of guessing. */
export const CATALOG_SNAPSHOT_VERSION = 1

/** Default freshness window: 15 minutes (the measured default TTL). */
export const DEFAULT_CATALOG_TTL_MS = 900_000

/**
 * Build a catalog cache.
 *
 * @param {object} options Cache construction.
 * @param {(signal?: AbortSignal) => Promise<unknown>} options.fetch
 *   Probe; resolves to the catalog value. Called at most once per refresh.
 * @param {number | (() => number)} [options.ttlMs] Freshness window in
 *   milliseconds; a function is re-read on every call so a settings change
 *   applies without rebuilding the cache. Non-positive disables the TTL, so
 *   every read is a miss.
 * @param {() => number} [options.now] Clock, for tests.
 * @param {(value: unknown, previous: unknown) => void} [options.onChanged]
 *   Called after a successful probe whose value replaced a different one.
 * @param {(message: string) => void} [options.warn] Diagnostic sink.
 * @param {string} [options.path] Snapshot file; empty/omitted disables the file.
 * @param {{ readFileSync: Function, mkdir: Function, writeFile: Function, rename: Function }} [options.fs]
 *   Injected filesystem; required for `load()`/`persist()` when `path` is set.
 * @param {string} [options.source] Provenance label stored in the snapshot.
 * @returns {{
 *   read: (signal?: AbortSignal) => Promise<unknown>,
 *   refresh: (signal?: AbortSignal) => Promise<unknown>,
 *   invalidate: () => void,
 *   prime: (value: unknown, at?: number) => void,
 *   load: () => unknown,
 *   snapshot: () => { version: number, savedAt: number, source: string, value: unknown } | null,
 *   persist: () => Promise<boolean>,
 *   flush: () => Promise<boolean>,
 *   stats: () => { hits: number, misses: number, probes: number, failures: number, stale: number },
 *   lastError: () => unknown,
 *   current: () => unknown,
 *   pending: () => Promise<unknown> | null,
 *   get path() { return string },
 * }} Cache handle.
 */
export function createCatalogCache(options = {}) {
  const probe = options.fetch
  if (typeof probe !== 'function') throw new TypeError('createCatalogCache needs fetch()')
  const now = typeof options.now === 'function' ? options.now : Date.now
  const warn = typeof options.warn === 'function' ? options.warn : () => {}
  const onChanged = typeof options.onChanged === 'function' ? options.onChanged : undefined
  const ttlMs = typeof options.ttlMs === 'function' ? options.ttlMs : () => options.ttlMs
  const snapshotPath = typeof options.path === 'string' ? options.path : ''
  const fileSystem = options.fs
  const source = typeof options.source === 'string' && options.source.length > 0 ? options.source : 'fetch'

  /** @type {{ value: unknown, at: number, source: string } | null} */
  let state = null
  /** @type {Promise<unknown> | null} */
  let inflight = null
  /** @type {Promise<boolean>} */
  let lastPersist = Promise.resolve(false)
  let lastError
  const counters = { hits: 0, misses: 0, probes: 0, failures: 0, stale: 0 }

  /**
   * Resolve the freshness window for this call.
   *
   * @returns {number} Milliseconds; negative when unreadable.
   */
  function ttl() {
    const value = Number(ttlMs())
    return Number.isFinite(value) ? value : DEFAULT_CATALOG_TTL_MS
  }

  /**
   * Whether the in-memory entry is still fresh.
   *
   * @returns {boolean} True when a read can answer without a probe.
   */
  function fresh() {
    if (state === null) return false
    const window = ttl()
    if (window <= 0) return false
    return now() - state.at < window
  }

  /**
   * Probe once and publish the result.
   *
   * Concurrent callers share one attempt. A failure leaves the previous value
   * in place and records `lastError`; it is never presented as fresh.
   *
   * @param {AbortSignal} [signal] Caller lifetime.
   * @returns {Promise<unknown>} Fresh value, or the previous value after a failure.
   */
  async function refresh(signal) {
    if (inflight !== null) return inflight
    counters.probes += 1
    inflight = (async () => {
      let value
      try {
        value = await probe(signal)
      } catch (error) {
        counters.failures += 1
        lastError = error
        warn(`model catalog probe failed: ${error instanceof Error ? error.message : String(error)}`)
        return state === null ? undefined : state.value
      }
      lastError = undefined
      const previous = state
      state = { value, at: now(), source }
      // Fire-and-forget: the in-memory value is authoritative for this process,
      // and a slow disk must not delay the model picker. `flush()` is the write
      // barrier for a caller that needs the file before it answers.
      lastPersist = persist()
      if (onChanged && (previous === null || previous.value !== value)) {
        try {
          onChanged(value, previous?.value)
        } catch (error) {
          warn(`model catalog change listener failed: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
      return value
    })().finally(() => {
      inflight = null
    })
    return inflight
  }

  /**
   * Read the catalog.
   *
   * Fresh: answer from memory. Stale with a previous value: answer stale now and
   * revalidate in the background. Cold or invalidated: await the probe.
   *
   * @param {AbortSignal} [signal] Caller lifetime for the cold path.
   * @returns {Promise<unknown>} Catalog value, or `undefined` when a cold probe failed.
   */
  async function read(signal) {
    if (fresh()) {
      counters.hits += 1
      return state.value
    }
    if (state !== null) {
      counters.stale += 1
      counters.hits += 1
      // Stale-while-revalidate: the caller never waits on an unproven probe.
      void refresh(signal)
      return state.value
    }
    counters.misses += 1
    return refresh(signal)
  }

  /** Drop the in-memory entry so the next read probes again. */
  function invalidate() {
    state = null
  }

  /**
   * Publish a value without probing.
   *
   * @param {unknown} value Catalog to publish.
   * @param {number} [at] Freshness timestamp; defaults to now.
   * @returns {void}
   */
  function prime(value, at = now()) {
    state = { value, at, source: 'primed' }
  }

  /**
   * Snapshot record to persist, or null when nothing is cached.
   *
   * @returns {{ version: number, savedAt: number, source: string, value: unknown } | null} Serializable record.
   */
  function snapshot() {
    if (state === null) return null
    return { version: CATALOG_SNAPSHOT_VERSION, savedAt: state.at, source: state.source, value: state.value }
  }

  /**
   * Seed memory from the durable snapshot, synchronously.
   *
   * A missing, unreadable, malformed, or version-mismatched file is "no
   * snapshot": a cold boot then awaits one probe instead of trusting a foreign
   * file.
   *
   * @returns {unknown} Seeded value, or `undefined` when nothing usable was found.
   */
  function load() {
    if (snapshotPath === '' || typeof fileSystem?.readFileSync !== 'function') return undefined
    let text
    try {
      text = fileSystem.readFileSync(snapshotPath, 'utf8')
    } catch {
      /* no snapshot yet: the first probe will create one */
      return undefined
    }
    let parsed
    try {
      parsed = JSON.parse(text)
    } catch {
      return undefined
    }
    if (!parsed || parsed.version !== CATALOG_SNAPSHOT_VERSION) return undefined
    if (!Number.isFinite(parsed.savedAt) || !('value' in parsed)) return undefined
    state = {
      value: parsed.value,
      at: parsed.savedAt,
      source: typeof parsed.source === 'string' ? parsed.source : 'snapshot',
    }
    return state.value
  }

  /**
   * Write the snapshot atomically (temp file + rename), best-effort.
   *
   * @returns {Promise<boolean>} True when a file was written.
   */
  async function persist() {
    const record = snapshot()
    if (record === null) return false
    if (snapshotPath === '' || typeof fileSystem?.writeFile !== 'function') return false
    try {
      await fileSystem.mkdir(dirnameOf(snapshotPath), { recursive: true })
      const temporary = `${snapshotPath}.${process.pid}.tmp`
      await fileSystem.writeFile(temporary, JSON.stringify(record), 'utf8')
      if (typeof fileSystem.rename === 'function') await fileSystem.rename(temporary, snapshotPath)
      return true
    } catch (error) {
      warn(`model catalog snapshot write failed: ${error instanceof Error ? error.message : String(error)}`)
      return false
    }
  }

  /**
   * Await the most recent snapshot write.
   *
   * Publish paths persist without blocking the caller, so this is the barrier
   * for shutdown, a test, or a route that must not answer before the file is
   * durable.
   *
   * @returns {Promise<boolean>} Whether that write reached the file.
   */
  function flush() {
    return lastPersist
  }

  return {
    read,
    refresh,
    invalidate,
    prime,
    load,
    snapshot,
    persist,
    flush,
    stats: () => ({ ...counters }),
    lastError: () => lastError,
    current: () => (state === null ? undefined : state.value),
    pending: () => inflight,
    get path() {
      return snapshotPath
    },
  }
}

/**
 * Parent directory of a path, without importing `node:path`.
 *
 * The snapshot seam must stay import-free so a browser-side caller can bundle
 * it; POSIX and Windows separators are both accepted.
 *
 * @param {string} path Snapshot path.
 * @returns {string} Parent directory, or '.' when there is none.
 */
function dirnameOf(path) {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  if (index <= 0) return index === 0 ? '/' : '.'
  return path.slice(0, index)
}
