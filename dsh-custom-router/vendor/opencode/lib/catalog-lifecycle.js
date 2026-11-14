/**
 * The OpenCode adapter's catalog lifecycle: cold seed, demand reads, optional
 * background poll, and change announcement.
 *
 * The cache mechanics are the router's one module (`../../../lib/catalog-cache.js`,
 * `createCatalogCache`): freshness window, single-flight probe,
 * stale-while-revalidate, the "a failed refresh never becomes fresh data" rule,
 * and the durable snapshot. This file adds only what is OpenCode-specific and
 * actually used by its callers:
 *
 *   - `seed()` — load the snapshot synchronously during activation, so the first
 *     `listModels()` answers in microseconds instead of awaiting `opencode serve`;
 *   - `start()`/`stop()` — the optional warm snapshot; the router cache is pure
 *     and owns no timers, so the poll lives here;
 *   - the **signature gate** — a fresh probe is always persisted (freshness is
 *     real information), but only a catalog whose CONTENTS differ is announced
 *     to connected clients;
 *   - the "an empty catalog is not an answer" rule — a probe that resolves to
 *     nothing keeps the previous catalog instead of publishing emptiness, which
 *     is how one bad poll used to blank the picker for a whole TTL.
 *
 * The path rule, the content signature, and the on-disk format stay in
 * `./catalog-file.js`, because the verdict, spend, and sidecar caches share the
 * path rule too.
 *
 * @module @nolit/dsh-opencode-v2/catalog-lifecycle
 */
import { createCatalogCache } from '../../../lib/catalog-cache.js'
import { catalogSnapshotFs, signatureOf } from './catalog-file.js'

/** Internal marker: the probe ran fine but produced no usable catalog. */
class CatalogUnavailable extends Error {
  constructor() {
    super('probe returned no usable catalog')
    this.name = 'CatalogUnavailable'
  }
}

/**
 * Build the lifecycle over a probe and a snapshot path.
 *
 * @param {{
 *   probe: (signal?: AbortSignal) => Promise<{ models?: object[] } | null | undefined>,
 *   path: string,
 *   cacheMs: () => number,
 *   syncMs: () => number,
 *   onChanged?: (models: object[]) => void,
 *   now?: () => number,
 *   warn?: (message: string) => void,
 * }} options Probe, snapshot path, timings, and change notification.
 * @returns {{
 *   seed: () => object | null,
 *   current: () => { at: number, result: object, source: string } | null,
 *   prime: (result: object, at?: number) => void,
 *   read: (signal?: AbortSignal) => Promise<object | null>,
 *   refresh: (signal?: AbortSignal) => Promise<object | null>,
 *   lastError: unknown,
 *   start: () => void,
 *   stop: () => void,
 *   path: string,
 * }} Lifecycle handle.
 */
export function createCatalogLifecycle({ probe, path, cacheMs, syncMs, onChanged, now, warn }) {
  const log = typeof warn === 'function' ? warn : () => {}
  /** Diagnostics of the most recent failed probe; cleared by the next usable one. */
  let lastError

  const cache = createCatalogCache({
    fetch: async (signal) => {
      let result
      try {
        result = await probe(signal)
      } catch (error) {
        lastError = error
        throw error
      }
      if (!result || !Array.isArray(result.models) || result.models.length === 0) {
        lastError = new CatalogUnavailable()
        throw lastError
      }
      lastError = undefined
      return result
    },
    ttlMs: cacheMs,
    path,
    fs: catalogSnapshotFs(),
    source: 'probe',
    now,
    warn: (message) => {
      // An empty answer is "no news", not an outage: warning about it every poll
      // would train the operator to ignore the line that does matter.
      if (message.includes('no usable catalog')) return
      log(message)
    },
    onChanged: (value, previous) => {
      if (signatureOf(previous) === signatureOf(value)) return
      const models = value?.models
      if (Array.isArray(models)) onChanged?.(models)
    },
  })

  /** @type {ReturnType<typeof setInterval> | null} */
  let timer = null

  /**
   * The last known catalog and when it was measured, without touching the clock.
   *
   * @returns {{ at: number, result: object, source: string } | null} Cached catalog, or null before any seed/probe.
   */
  function current() {
    const record = cache.snapshot()
    if (record === null) return null
    return { at: record.savedAt, result: record.value, source: record.source }
  }

  /**
   * Probe once and publish the result.
   *
   * The write is a barrier here, not fire-and-forget: the previous
   * implementation awaited its persist inside refresh, so a caller that wakes up
   * from a refresh has a durable snapshot. `flush()` is the cache's write
   * barrier for exactly that ordering.
   *
   * @param {AbortSignal} [signal] Caller lifetime.
   * @returns {Promise<object | null>} Fresh catalog, or null when the probe failed or answered nothing usable.
   */
  async function refresh(signal) {
    const value = await cache.refresh(signal)
    const written = await cache.flush()
    if (written) lastPersisted = true
    // A failed attempt leaves the previous catalog in memory; the caller must
    // still be told "this refresh did not work" rather than be handed stale data
    // as if it were fresh.
    if (lastError !== undefined) return null
    return value === undefined ? null : value
  }

  /** Whether a snapshot write has completed at least once. */
  let lastPersisted = false

  return {
    seed() {
      const seeded = cache.load()
      return seeded === undefined ? null : current()
    },
    current,
    prime(result, at) {
      cache.prime(result, at)
    },
    async read(signal) {
      const value = await cache.read(signal)
      return value === undefined ? null : value
    },
    refresh,
    /** Await the most recent snapshot write. */
    flush() {
      return cache.flush()
    },
    persisted() {
      return lastPersisted
    },
    get lastError() {
      return lastError
    },
    start() {
      const every = Number(syncMs())
      if (!Number.isFinite(every) || every <= 0 || timer !== null) return
      void refresh()
      timer = setInterval(() => void refresh(), every)
      if (typeof timer.unref === 'function') timer.unref()
    },
    stop() {
      if (timer === null) return
      clearInterval(timer)
      timer = null
    },
    get path() {
      return path
    },
  }
}
