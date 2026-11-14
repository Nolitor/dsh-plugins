/**
 * Catalog snapshot lifecycle: synchronous cold seed, stale-while-revalidate,
 * durable refresh, and change notification.
 *
 * The behaviour under test is what the Web model picker depends on: the first
 * `session/modelCatalog` after boot must not wait for the OpenCode daemon, and a
 * changed catalog must reach connected clients without a manual refresh.
 *
 * Retargeted 2026-11-14 when `lib/catalog-cache.js` was folded into the router's
 * one cache (`../../../lib/catalog-cache.js`, `createCatalogCache`): the removed
 * `CatalogStore`/`CatalogLifecycle` classes were this module's own internals, so
 * the tests that constructed them now construct `createCatalogLifecycle` with a
 * snapshot PATH instead of a store double. The shared behaviour they pin — cold
 * seed, single-flight, stale-while-revalidate, announce-only-on-change — is
 * unchanged, and none of those assertions was relaxed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CATALOG_FILE_VERSION,
  catalogSignature,
  readCatalogSnapshot,
  resolveCatalogPath,
  writeCatalogSnapshot,
} from '../lib/catalog-file.js'
import { createCatalogLifecycle } from '../lib/catalog-lifecycle.js'
import { OpencodeHttpAdapter, Config as HttpConfig } from '../lib/http.js'

const MODEL = { id: 'opencode-go/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 1000000, maxTokens: 384000 }

/** Temp directory per test, removed afterwards. */
async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-catalog-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/**
 * Seed a snapshot file the way a previous boot would have left it, and return
 * the path. This replaces the removed `CatalogStore` double: the lifecycle now
 * writes through its own fs seam, so asserting on the FILE is what actually pins
 * the durable path (and the format an operator already has on disk).
 */
async function seeded(dir, snapshot = { savedAt: 1, source: 'probe', models: [MODEL] }) {
  const path = join(dir, 'opencode-models.json')
  await writeCatalogSnapshot(path, snapshot)
  return path
}

/** Number of catalog rows currently on disk, or 0 when there is no file yet. */
async function persistedRows(path) {
  const snapshot = readCatalogSnapshot(path)
  return snapshot === null ? 0 : snapshot.models.length
}

test('resolveCatalogPath prefers explicit config, then the profile, then DSH_HOME', () => {
  assert.equal(resolveCatalogPath({ explicit: '/x/y.json', profileDir: '/p', dshHome: '/h' }), '/x/y.json')
  assert.equal(resolveCatalogPath({ profileDir: '/p', dshHome: '/h' }), '/p/opencode-models.json')
  assert.equal(resolveCatalogPath({ dshHome: '/h' }), '/h/cache/opencode-models.json')
  assert.equal(resolveCatalogPath({}), '')
  assert.equal(resolveCatalogPath({ profileDir: '/p', fileName: 'opencode-models-cli.json' }), '/p/opencode-models-cli.json')
})

test('catalogSignature changes with ids, names, context, and variants', () => {
  const base = catalogSignature([MODEL])
  assert.equal(catalogSignature([{ ...MODEL }]), base)
  assert.notEqual(catalogSignature([{ ...MODEL, name: 'Renamed' }]), base)
  assert.notEqual(catalogSignature([{ ...MODEL, contextWindow: 32768 }]), base)
  assert.notEqual(catalogSignature([{ ...MODEL, variants: ['high'] }]), base)
  assert.notEqual(catalogSignature([]), base)
})

test('a snapshot round-trips and rejects foreign or malformed files', async (t) => {
  const dir = await tempDir(t)
  const path = join(dir, 'opencode-models.json')
  assert.equal(readCatalogSnapshot(path), null)

  await writeCatalogSnapshot(path, { savedAt: 123, source: 'probe', models: [MODEL] })
  assert.deepEqual(readCatalogSnapshot(path), { savedAt: 123, source: 'probe', models: [MODEL] })

  await writeFile(path, '{"version":999,"savedAt":1,"models":[{"id":"x"}]}')
  assert.equal(readCatalogSnapshot(path), null)

  await writeFile(path, 'not json')
  assert.equal(readCatalogSnapshot(path), null)

  await writeFile(path, JSON.stringify({ version: CATALOG_FILE_VERSION, savedAt: 1, models: [] }))
  assert.equal(readCatalogSnapshot(path), null, 'an empty catalog is not a usable snapshot')
})

test('an empty path keeps the catalog in memory and writes no file', async () => {
  let probes = 0
  const lifecycle = createCatalogLifecycle({
    probe: async () => {
      probes += 1
      return { models: [MODEL] }
    },
    path: '',
    cacheMs: () => 300000,
    syncMs: () => 0,
  })
  assert.equal(lifecycle.seed(), null, 'nothing to seed without a path')
  assert.deepEqual((await lifecycle.read())?.models, [MODEL])
  assert.equal(probes, 1)
  // No path, no snapshot: the second read is served from memory.
  assert.deepEqual((await lifecycle.read())?.models, [MODEL])
  assert.equal(probes, 1)
})

test('a seeded catalog answers synchronously while a probe is still running', async (t) => {
  const dir = await tempDir(t)
  const path = await seeded(dir)
  let probing = 0
  const lifecycle = createCatalogLifecycle({
    probe: () => {
      probing += 1
      return new Promise(() => {})
    },
    path,
    cacheMs: () => 300000,
    syncMs: () => 0,
    now: () => 10,
  })
  lifecycle.seed()

  const result = await lifecycle.read()
  assert.deepEqual(result?.models, [MODEL])
  assert.equal(probing, 0, 'a fresh seed must not start a probe')
})

test('a stale seed revalidates in the background exactly once', async (t) => {
  const dir = await tempDir(t)
  const path = await seeded(dir)
  let probes = 0
  const lifecycle = createCatalogLifecycle({
    probe: async () => {
      probes += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { models: [MODEL] }
    },
    path,
    cacheMs: () => 1000,
    syncMs: () => 0,
    now: () => 5000,
  })
  lifecycle.seed()
  const results = await Promise.all([lifecycle.read(), lifecycle.read(), lifecycle.read()])
  assert.ok(results.every((result) => result?.models.length === 1))
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(probes, 1)
})

test('refresh persists the catalog and announces only real changes', async (t) => {
  const dir = await tempDir(t)
  const path = join(dir, 'opencode-models.json')
  let changes = 0
  let now = 1000
  let catalog = [MODEL]
  const lifecycle = createCatalogLifecycle({
    probe: async () => ({ models: catalog }),
    path,
    cacheMs: () => 300000,
    syncMs: () => 0,
    onChanged: () => {
      changes += 1
    },
    now: () => now,
  })

  await lifecycle.refresh()
  assert.equal(changes, 1, 'the first catalog is a change from nothing')
  assert.equal(await persistedRows(path), 1)

  now = 2000
  await lifecycle.refresh()
  assert.equal(changes, 1, 'an identical catalog must not notify clients')
  assert.equal(await persistedRows(path), 1, 'freshness is still persisted')
  assert.equal(readCatalogSnapshot(path).savedAt, 2000, 'the write refreshed the timestamp')

  catalog = [{ ...MODEL, name: 'DeepSeek V4.1 Flash (Go)' }]
  await lifecycle.refresh()
  assert.equal(changes, 2)
  assert.equal(readCatalogSnapshot(path).models[0].name, 'DeepSeek V4.1 Flash (Go)')
})

test('a failed probe keeps the last good catalog and reports the reason', async (t) => {
  const dir = await tempDir(t)
  const path = await seeded(dir)
  const warnings = []
  const lifecycle = createCatalogLifecycle({
    probe: async () => {
      throw new Error('daemon state unreadable')
    },
    path,
    cacheMs: () => 0,
    syncMs: () => 0,
    warn: (message) => warnings.push(message),
  })
  lifecycle.seed()
  const result = await lifecycle.refresh()
  assert.equal(result, null)
  assert.deepEqual(lifecycle.current().result.models, [MODEL])
  assert.match(lifecycle.lastError.message, /daemon state unreadable/)
  assert.match(warnings[0], /model catalog probe failed/)
})

test('start() refreshes immediately, repeats on the timer, and stop() clears it', async (t) => {
  const dir = await tempDir(t)
  let probes = 0
  const lifecycle = createCatalogLifecycle({
    probe: async () => {
      probes += 1
      return { models: [MODEL] }
    },
    path: join(dir, 'opencode-models.json'),
    cacheMs: () => 300000,
    syncMs: () => 10,
  })
  lifecycle.start()
  t.after(() => lifecycle.stop())
  await new Promise((resolve) => setTimeout(resolve, 45))
  assert.ok(probes >= 3, `expected periodic probes, saw ${probes}`)
  lifecycle.stop()
  const settled = probes
  await new Promise((resolve) => setTimeout(resolve, 30))
  assert.equal(probes, settled, 'stop() must clear the timer')
})

test('the HTTP adapter serves the snapshot without the daemon, then swaps in a fresh catalog', async (t) => {
  const dir = await tempDir(t)
  const path = join(dir, 'opencode-models.json')
  await writeCatalogSnapshot(path, { savedAt: 1, source: 'probe', models: [MODEL] })

  const emitted = []
  const ctx = { emit: (name, provider) => emitted.push([name, provider]) }
  const config = new HttpConfig({
    catalogPath: path,
    catalogSyncMs: 0,
    discoveryCacheMs: 300000,
    autoDiscoverModels: true,
  })
  const adapter = new OpencodeHttpAdapter(ctx, config, { providerId: 'opencode-http-agent' })
  t.after(() => adapter.dispose())

  adapter.discoverOnce = async () => ({ models: [{ ...MODEL, name: 'Renamed Model' }] })
  adapter.warmStart()
  const listed = await adapter.listModels('opencode-http-agent')
  assert.equal(listed[0].name, MODEL.name, 'the snapshot answers before the boot probe lands')

  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(emitted, [['llm/models-updated', 'opencode-http-agent']])
  const saved = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(saved.version, CATALOG_FILE_VERSION)
  assert.equal(saved.models[0].name, 'Renamed Model')
})

test('catalogSignature changes when the wire package or compatibility changes', () => {
  // The same model id can move from an OpenAI chat package to an Anthropic one;
  // a snapshot that differs only there must invalidate, because the request
  // builder's behaviour (completion field, cache markers) changes with it.
  const base = catalogSignature([MODEL])
  assert.notEqual(catalogSignature([{ ...MODEL, package: '@opencode/ai/providers/anthropic' }]), base)
  assert.notEqual(
    catalogSignature([{ ...MODEL, package: '@opencode/ai/providers/openai-compatible' }]),
    base,
  )
  const compatible = catalogSignature([{ ...MODEL, package: '@opencode/ai/providers/openai-compatible' }])
  assert.notEqual(
    catalogSignature([{ ...MODEL, package: '@opencode/ai/providers/openai-compatible', compatibility: { cacheFormat: 'anthropic' } }]),
    compatible,
  )
  // Key order is not identity; a value change is.
  assert.equal(
    catalogSignature([{ ...MODEL, compatibility: { cacheFormat: 'anthropic', streamUsage: false } }]),
    catalogSignature([{ ...MODEL, compatibility: { streamUsage: false, cacheFormat: 'anthropic' } }]),
  )
  assert.notEqual(
    catalogSignature([{ ...MODEL, compatibility: { streamUsage: false } }]),
    catalogSignature([{ ...MODEL, compatibility: { streamUsage: true } }]),
  )
  assert.notEqual(catalogSignature([{ ...MODEL, unverifiedWire: true }]), base)
})

test('an existing on-disk snapshot keeps loading, and a refresh keeps the measured format', async (t) => {
  // COMPATIBILITY GATE (2026-11-14). Folding `lib/catalog-cache.js` into the
  // router's `createCatalogCache` changed the record the cache speaks internally
  // (`value` instead of `models`). An operator's profile already holds a
  // `{ version: 1, savedAt, source, models }` file, so the fs seam must translate
  // rather than invalidate it: otherwise the first boot after an upgrade would
  // ignore the last good catalog and wait on the daemon again — the exact cold
  // start this module exists to prevent.
  const dir = await tempDir(t)
  const path = join(dir, 'opencode-models.json')
  const legacy = { version: CATALOG_FILE_VERSION, savedAt: 12345, source: 'probe', models: [MODEL] }
  await writeFile(path, JSON.stringify(legacy))

  let probes = 0
  const lifecycle = createCatalogLifecycle({
    probe: async () => {
      probes += 1
      return { models: [{ ...MODEL, name: 'Renamed Model' }] }
    },
    path,
    cacheMs: () => 300000,
    syncMs: () => 0,
    now: () => 13000,
  })

  const seededRecord = lifecycle.seed()
  assert.deepEqual(seededRecord?.result.models, [MODEL], 'the legacy file still seeds the cache')
  assert.equal(seededRecord.at, 12345, 'the snapshot keeps its own freshness stamp')
  const read = await lifecycle.read()
  assert.deepEqual(read?.models, [MODEL])
  assert.equal(probes, 0, 'a legacy snapshot must not cause a cold probe')

  await lifecycle.refresh()
  const written = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(written.version, CATALOG_FILE_VERSION)
  assert.deepEqual(written.models, [{ ...MODEL, name: 'Renamed Model' }], 'the measured on-disk key is still `models`')
  assert.equal(written.value, undefined, 'the internal record shape must not leak into the operator file')
})
