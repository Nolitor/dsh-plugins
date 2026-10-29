/**
 * Catalog snapshot lifecycle: synchronous cold seed, stale-while-revalidate,
 * durable refresh, and change notification.
 *
 * The behaviour under test is what the Web model picker depends on: the first
 * `session/modelCatalog` after boot must not wait for the OpenCode daemon, and a
 * changed catalog must reach connected clients without a manual refresh.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CATALOG_FILE_VERSION,
  CatalogLifecycle,
  CatalogStore,
  catalogSignature,
  readCatalogSnapshot,
  resolveCatalogPath,
  writeCatalogSnapshot,
} from '../lib/catalog-cache.js'
import { OpencodeHttpAdapter, Config as HttpConfig } from '../lib/http.js'

const MODEL = { id: 'opencode-go/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 1000000, maxTokens: 384000 }

/** Temp directory per test, removed afterwards. */
async function tempDir(t) {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-catalog-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  return dir
}

/** In-memory store double recording writes. */
function memoryStore(initial = null) {
  const store = {
    saved: [],
    load: () => initial,
    save(snapshot) {
      store.saved.push(snapshot)
      return Promise.resolve()
    },
  }
  return store
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

test('CatalogStore with no path stays in memory', async () => {
  const store = new CatalogStore('')
  assert.equal(store.load(), null)
  await store.save({ savedAt: 1, source: 'probe', models: [MODEL] })
})

test('a seeded catalog answers synchronously while a probe is still running', async () => {
  let probing = 0
  const lifecycle = new CatalogLifecycle({
    probe: () => {
      probing += 1
      return new Promise(() => {})
    },
    store: memoryStore({ savedAt: 1, source: 'probe', models: [MODEL] }),
    cacheMs: () => 300000,
    syncMs: () => 0,
    now: () => 10,
  })
  lifecycle.seed()

  const result = await lifecycle.read()
  assert.deepEqual(result?.models, [MODEL])
  assert.equal(probing, 0, 'a fresh seed must not start a probe')
})

test('a stale seed revalidates in the background exactly once', async () => {
  let probes = 0
  const store = memoryStore({ savedAt: 1, source: 'probe', models: [MODEL] })
  const lifecycle = new CatalogLifecycle({
    probe: async () => {
      probes += 1
      await new Promise((resolve) => setTimeout(resolve, 5))
      return { models: [MODEL] }
    },
    store,
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

test('refresh persists the catalog and announces only real changes', async () => {
  const store = memoryStore()
  let changes = 0
  let now = 1000
  let catalog = [MODEL]
  const lifecycle = new CatalogLifecycle({
    probe: async () => ({ models: catalog }),
    store,
    cacheMs: () => 300000,
    syncMs: () => 0,
    onChanged: () => {
      changes += 1
    },
    now: () => now,
  })

  await lifecycle.refresh()
  assert.equal(changes, 1, 'the first catalog is a change from nothing')
  assert.equal(store.saved.length, 1)

  now = 2000
  await lifecycle.refresh()
  assert.equal(changes, 1, 'an identical catalog must not notify clients')
  assert.equal(store.saved.length, 2, 'freshness is still persisted')

  catalog = [{ ...MODEL, name: 'DeepSeek V4.1 Flash (Go)' }]
  await lifecycle.refresh()
  assert.equal(changes, 2)
  assert.equal(store.saved.at(-1).models[0].name, 'DeepSeek V4.1 Flash (Go)')
})

test('a failed probe keeps the last good catalog and reports the reason', async () => {
  const store = memoryStore({ savedAt: 1, source: 'probe', models: [MODEL] })
  const warnings = []
  const lifecycle = new CatalogLifecycle({
    probe: async () => {
      throw new Error('daemon state unreadable')
    },
    store,
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
  let probes = 0
  const lifecycle = new CatalogLifecycle({
    probe: async () => {
      probes += 1
      return { models: [MODEL] }
    },
    store: memoryStore(),
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
  assert.equal(listed[1].name, MODEL.name, 'the snapshot answers before the boot probe lands')

  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.deepEqual(emitted, [['llm/models-updated', 'opencode-http-agent']])
  const saved = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(saved.version, CATALOG_FILE_VERSION)
  assert.equal(saved.models[0].name, 'Renamed Model')
})
