/**
 * Catalog cache: TTL hit/miss, single-flight dedupe, invalidation, stale-while-
 * revalidate ordering, and a snapshot round-trip in a real temp directory.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import * as fsPromises from 'node:fs/promises'
import * as nodeFs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { CATALOG_SNAPSHOT_VERSION, createCatalogCache, DEFAULT_CATALOG_TTL_MS } from '../lib/catalog-cache.js'

/** Filesystem seam matching the module's injected fs contract. */
const FS = {
  readFileSync: nodeFs.readFileSync,
  mkdir: fsPromises.mkdir,
  writeFile: fsPromises.writeFile,
  rename: fsPromises.rename,
}

/** Controllable clock. */
function clock(start = 1_000) {
  let value = start
  return {
    now: () => value,
    advance: (ms) => {
      value += ms
      return value
    },
  }
}

/** Temp directory removed when the test finishes. */
function tempDir(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-catalog-cache-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

test('the default TTL matches the measured fifteen minutes', () => {
  assert.equal(DEFAULT_CATALOG_TTL_MS, 900_000)
  assert.equal(CATALOG_SNAPSHOT_VERSION, 1)
})

test('a cold read probes once and a fresh read serves from memory', async () => {
  const time = clock()
  let calls = 0
  const cache = createCatalogCache({
    fetch: async () => {
      calls += 1
      return { entries: [{ id: 'm1' }] }
    },
    ttlMs: 1000,
    now: time.now,
  })

  assert.deepEqual(await cache.read(), { entries: [{ id: 'm1' }] })
  assert.equal(calls, 1)
  assert.equal(cache.stats().misses, 1)

  time.advance(999)
  assert.deepEqual(await cache.read(), { entries: [{ id: 'm1' }] })
  assert.equal(calls, 1)
  assert.equal(cache.stats().hits, 1)

  // At the TTL boundary the entry is stale: the read answers the old value and
  // revalidates in the background.
  time.advance(1)
  assert.deepEqual(await cache.read(), { entries: [{ id: 'm1' }] })
  await cache.pending()
  assert.equal(calls, 2)
  assert.equal(cache.stats().stale, 1)
})

test('a ttl function is re-read on every call, and 0 disables the TTL', async () => {
  const time = clock()
  let calls = 0
  let ttl = 1000
  const cache = createCatalogCache({
    fetch: async () => {
      calls += 1
      return calls
    },
    ttlMs: () => ttl,
    now: time.now,
  })

  assert.equal(await cache.read(), 1)
  ttl = 60_000
  time.advance(500)
  assert.equal(await cache.read(), 1)
  assert.equal(calls, 1)

  // A non-positive TTL disables the freshness window: every read answers the
  // previous value and revalidates in the background.
  ttl = 0
  assert.equal(await cache.read(), 1)
  await cache.pending()
  assert.equal(calls, 2)
  assert.equal(await cache.read(), 2)
  await cache.pending()
  assert.equal(calls, 3)
})

test('concurrent cold reads share one in-flight probe', async () => {
  let calls = 0
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const cache = createCatalogCache({
    fetch: async () => {
      calls += 1
      await gate
      return 'catalog'
    },
    ttlMs: 1000,
  })

  const reads = [cache.read(), cache.read(), cache.read()]
  await Promise.resolve()
  assert.equal(calls, 1)
  release()
  assert.deepEqual(await Promise.all(reads), ['catalog', 'catalog', 'catalog'])
  assert.equal(calls, 1)
  await cache.pending()
  assert.equal(calls, 1)

  // A stale read also joins the running revalidation rather than starting one.
  const second = cache.refresh()
  const third = cache.refresh()
  assert.equal(calls, 2, 'a concurrent refresh must not start a second probe')
  await Promise.all([second, third])
  assert.equal(calls, 2)
})

test('a failed probe keeps the previous value and reports the error', async () => {
  const time = clock()
  const warn = []
  let calls = 0
  const cache = createCatalogCache({
    fetch: async () => {
      calls += 1
      if (calls === 1) return { entries: [{ id: 'good' }] }
      throw new Error('probe down')
    },
    ttlMs: 10,
    now: time.now,
    warn: (message) => warn.push(message),
  })

  assert.deepEqual(await cache.read(), { entries: [{ id: 'good' }] })
  time.advance(50)
  // Stale value answers immediately; the failing revalidation changes nothing.
  assert.deepEqual(await cache.read(), { entries: [{ id: 'good' }] })
  await cache.pending()
  assert.deepEqual(cache.current(), { entries: [{ id: 'good' }] })
  assert.equal(cache.lastError()?.message, 'probe down')
  assert.equal(cache.stats().failures, 1)
  assert.match(warn.join('\n'), /probe down/)

  // A cold probe failure resolves undefined rather than throwing at the caller.
  const cold = createCatalogCache({
    fetch: async () => {
      throw new Error('no route')
    },
    warn: (message) => warn.push(message),
  })
  assert.equal(await cold.read(), undefined)
  assert.equal(cold.current(), undefined)
})

test('invalidate drops the entry so the next read probes again', async () => {
  const time = clock()
  let calls = 0
  const cache = createCatalogCache({
    fetch: async () => {
      calls += 1
      return calls
    },
    ttlMs: 900_000,
    now: time.now,
  })

  assert.equal(await cache.read(), 1)
  assert.equal(await cache.read(), 1)
  assert.equal(calls, 1)
  cache.invalidate()
  assert.equal(cache.current(), undefined)
  assert.equal(await cache.read(), 2)
  assert.equal(calls, 2)
})

test('onChanged fires only when the value actually changed, and prime skips the probe', async () => {
  const time = clock()
  const seen = []
  let probeValue = 'a'
  let calls = 0
  const cache = createCatalogCache({
    fetch: async () => {
      calls += 1
      return probeValue
    },
    ttlMs: 0,
    now: time.now,
    onChanged: (value, previous) => seen.push([value, previous]),
  })

  await cache.read()
  assert.deepEqual(seen, [['a', undefined]])
  // ttl 0 means every read is stale: it answers the previous value and probes
  // in the background, so an unchanged value must not notify.
  assert.equal(await cache.read(), 'a')
  await cache.pending()
  assert.equal(calls, 2)
  assert.equal(seen.length, 1, 'an unchanged value must not notify')

  probeValue = 'b'
  assert.equal(await cache.read(), 'a', 'a stale read answers the previous value')
  await cache.pending()
  assert.deepEqual(seen[1], ['b', 'a'])

  cache.prime({ entries: [] }, 5)
  assert.deepEqual(cache.current(), { entries: [] })
  assert.deepEqual(cache.snapshot(), { version: CATALOG_SNAPSHOT_VERSION, savedAt: 5, source: 'primed', value: { entries: [] } })
  // A primed value is read from memory (ttl 0 still answers it immediately,
  // then revalidates) instead of blocking on a cold probe.
  const before = calls
  assert.deepEqual(await cache.read(), { entries: [] })
  await cache.pending()
  assert.equal(calls, before + 1)
})

test('the snapshot round-trips through a temp directory', async (t) => {
  const dir = tempDir(t)
  const path = join(dir, 'nested', 'catalog.json')
  const writer = createCatalogCache({
    fetch: async () => ({ entries: [{ id: 'm1' }, { id: 'm2' }] }),
    ttlMs: 1000,
    now: clock(42_000).now,
    path,
    fs: FS,
    source: 'probe',
  })

  assert.equal(writer.snapshot(), null)
  assert.equal(await writer.persist(), false)

  assert.deepEqual(await writer.read(), { entries: [{ id: 'm1' }, { id: 'm2' }] })
  assert.equal(await writer.flush(), true)
  const onDisk = JSON.parse(readFileSync(path, 'utf8'))
  assert.equal(onDisk.version, CATALOG_SNAPSHOT_VERSION)
  assert.equal(onDisk.savedAt, 42_000)
  assert.equal(onDisk.source, 'probe')

  // A fresh process seeds synchronously and answers without probing.
  let probes = 0
  const reader = createCatalogCache({
    fetch: async () => {
      probes += 1
      return { entries: [] }
    },
    ttlMs: 1000,
    now: clock(42_500).now,
    path,
    fs: FS,
  })
  assert.deepEqual(reader.load(), { entries: [{ id: 'm1' }, { id: 'm2' }] })
  assert.deepEqual(await reader.read(), { entries: [{ id: 'm1' }, { id: 'm2' }] })
  assert.equal(probes, 0)
})

test('a stale snapshot still answers immediately, then revalidates', async (t) => {
  const dir = tempDir(t)
  const path = join(dir, 'catalog.json')
  writeFileSync(
    path,
    JSON.stringify({ version: CATALOG_SNAPSHOT_VERSION, savedAt: 1_000, source: 'snapshot', value: { entries: [{ id: 'old' }] } }),
    'utf8',
  )

  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  let probes = 0
  const cache = createCatalogCache({
    fetch: async () => {
      probes += 1
      await gate
      return { entries: [{ id: 'new' }] }
    },
    ttlMs: 1000,
    now: clock(60_000).now,
    path,
    fs: FS,
  })

  assert.deepEqual(cache.load(), { entries: [{ id: 'old' }] })
  // Ordering: the stale value is returned while the probe is still blocked.
  assert.deepEqual(await cache.read(), { entries: [{ id: 'old' }] })
  assert.equal(probes, 1)
  assert.equal(cache.stats().stale, 1)
  release()
  await cache.pending()
  assert.deepEqual(cache.current(), { entries: [{ id: 'new' }] })
  // The revalidation rewrote the durable snapshot for the next boot.
  assert.equal(await cache.flush(), true)
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')).value, { entries: [{ id: 'new' }] })
})

test('an untrusted snapshot file is ignored instead of guessing', async (t) => {
  const dir = tempDir(t)
  let probes = 0
  const make = (path) =>
    createCatalogCache({
      fetch: async () => {
        probes += 1
        return 'live'
      },
      ttlMs: 5,
      path,
      fs: FS,
    })

  const malformed = join(dir, 'malformed.json')
  writeFileSync(malformed, '{not json', 'utf8')
  assert.equal(make(malformed).load(), undefined)

  const wrongVersion = join(dir, 'version.json')
  writeFileSync(wrongVersion, JSON.stringify({ version: 99, savedAt: 1, value: 'old' }), 'utf8')
  assert.equal(make(wrongVersion).load(), undefined)

  const noValue = join(dir, 'novalue.json')
  writeFileSync(noValue, JSON.stringify({ version: CATALOG_SNAPSHOT_VERSION, savedAt: 1 }), 'utf8')
  assert.equal(make(noValue).load(), undefined)

  const missing = join(dir, 'absent.json')
  const cache = make(missing)
  assert.equal(cache.load(), undefined)
  assert.equal(cache.current(), undefined)
  assert.equal(await cache.read(), 'live')
  assert.equal(probes, 1)

  // No path configured: the snapshot seam is inert, not a crash.
  const memoryOnly = createCatalogCache({ fetch: async () => 'x', ttlMs: 1 })
  assert.equal(memoryOnly.load(), undefined)
  assert.equal(await memoryOnly.persist(), false)
  assert.equal(memoryOnly.path, '')
})

test('createCatalogCache refuses a missing fetch', () => {
  assert.throws(() => createCatalogCache({}), TypeError)
})
