/**
 * The synthetic `OpenCode (config default)` model row is GONE.
 *
 * WHAT IT WAS
 *   Both vendored OpenCode adapters used to carry ONE synthetic entry in
 *   their `models` config table (`id: 'default'`, named after the OpenCode
 *   configuration default) and prepended it to the picker list under the
 *   `OpenCode Go (direct)` provider group. It was NOT a model id: the backend
 *   serves no route by that name, so the row was a phantom in the dropdown.
 *
 * WHAT STAYS
 *   The `default` PSEUDO-ROUTE still resolves server-side. `defaultModel`
 *   (http.js) and the empty `-m` value (provider.js) are unchanged, so a
 *   session that selects the pseudo-id still reaches the configured route on
 *   the wire. Only the ADVERTISEMENT is gone.
 *
 * This is the track-level negative proof: the row must not come back in the
 * config default, in the discovered-catalog list, or in the fallback list.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { Config as HttpConfig, OpencodeHttpAdapter } from '../vendor/opencode/lib/http.js'
import { Config as CliConfig, OpencodeLlmAdapter } from '../vendor/opencode/lib/provider.js'

/** The removed label, kept here so the assertion names what it forbids. */
const REMOVED_LABEL = 'OpenCode (config default)'

/** A served route of the active plan, so the plan gate lets it through. */
const GO_ROUTE = 'opencode-go/minimax-m3.1-flash'

/** One throwaway path per test, so nothing reads or writes live state. */
function tempPath(name) {
  return join(mkdtempSync(join(tmpdir(), 'dsh-router-default-row-')), name)
}

test('neither adapter config table seeds a row any more', () => {
  assert.deepEqual(
    HttpConfig({}).models.get(),
    [],
    'the HTTP adapter config must not seed the synthetic row',
  )
  assert.deepEqual(
    CliConfig({}).models.get(),
    [],
    'the CLI adapter config must not seed the synthetic row',
  )
})

test('the HTTP adapter never lists the synthetic row beside the served catalog', async () => {
  const adapter = new OpencodeHttpAdapter(
    { logger: { warn() {} } },
    HttpConfig({
      autoDiscoverModels: true,
      // A fresh, long-lived cache keeps the lifecycle from revalidating, so the
      // test never reaches the network or a live `opencode serve`.
      discoveryCacheMs: 3600000,
      catalogSyncMs: 0,
      catalogPath: tempPath('opencode-models.json'),
      knownModelsPath: tempPath('opencode-known-models.json'),
      rankingPath: tempPath('opencode-ranking.json'),
    }),
    { providerId: 'opencode-http-agent' },
  )
  adapter.catalog.prime({ models: [{ id: GO_ROUTE, name: 'MiniMax M3.1 Flash' }] })

  const listed = await adapter.listModels('opencode-http-agent')
  assert.deepEqual(
    listed.map((model) => model.id),
    [GO_ROUTE],
    'the served catalog is the whole list',
  )
  assert.ok(
    !listed.some((model) => model.name === REMOVED_LABEL),
    'no row carries the removed label',
  )
})

test('the HTTP adapter fallback list is empty when no route is configured', async () => {
  const adapter = new OpencodeHttpAdapter(
    { logger: { warn() {} } },
    HttpConfig({
      autoDiscoverModels: false,
      catalogPath: tempPath('opencode-models.json'),
      knownModelsPath: tempPath('opencode-known-models.json'),
      rankingPath: tempPath('opencode-ranking.json'),
    }),
    { providerId: 'opencode-http-agent' },
  )
  const listed = await adapter.listModels('opencode-http-agent')
  assert.deepEqual(listed, [], 'an empty config table lists nothing, not a phantom row')
})

test('the CLI adapter never lists the synthetic row beside the served catalog', async () => {
  const adapter = new OpencodeLlmAdapter(
    { subprocess: {} },
    CliConfig({
      autoDiscoverModels: true,
      discoveryCacheMs: 3600000,
      catalogSyncMs: 0,
      catalogPath: tempPath('opencode-models.json'),
      knownModelsPath: tempPath('opencode-known-models.json'),
    }),
  )
  adapter.catalog.prime({ models: [{ id: GO_ROUTE, name: 'MiniMax M3.1 Flash' }] })

  const listed = await adapter.listModels('opencode-agent')
  assert.deepEqual(
    listed.map((model) => model.id),
    [GO_ROUTE],
    'the served catalog is the whole list',
  )
  assert.ok(
    !listed.some((model) => model.name === REMOVED_LABEL),
    'no row carries the removed label',
  )
})
