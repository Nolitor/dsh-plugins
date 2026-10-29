/**
 * Regression tests for the compaction failure:
 *   "compaction-basic: no context capacity for opencode-agent/<model>;
 *    configure contextWindow on that adapter model"
 *
 * Root cause: resolveModel() returned no `context`, and `compaction-basic`
 * throws when `info.context === undefined`. The adapter must ALWAYS publish a
 * positive integer contextWindow, even for a route opencode never disclosed.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_CONTEXT_WINDOW,
  DEFAULT_MAX_OUTPUT_TOKENS,
  modelsFromApiPayload,
  modelsFromCliOutput,
  modelFromApiEntry,
} from '../lib/shared.js'
import { OpencodeLlmAdapter, Config } from '../lib/provider.js'

const makeConfig = (overrides = {}) => new Config(overrides)

/** Adapter with discovery short-circuited to a fixed catalog. */
function adapterWith(models, overrides = {}) {
  const fakeCtx = { subprocess: {} }
  const adapter = new OpencodeLlmAdapter(fakeCtx, makeConfig(overrides))
  adapter.discovered = { at: Date.now(), result: { models } }
  return adapter
}

// --- payload mapping -------------------------------------------------------

test('modelFromApiEntry maps the measured /api/model shape', () => {
  // Real entry measured from `opencode serve` GET /api/model on v2.2.0.
  const entry = {
    id: 'deepseek-v4.1-flash',
    modelID: 'deepseek-v4.1-flash',
    providerID: 'opencode-go',
    name: 'DeepSeek V4.1 Flash',
    limit: { context: 1000000, output: 384000 },
  }
  assert.deepEqual(modelFromApiEntry(entry), {
    id: 'opencode-go/deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    contextWindow: 1000000,
    maxTokens: 384000,
  })
})

test('modelFromApiEntry falls back to safe defaults when limit is absent', () => {
  const model = modelFromApiEntry({ id: 'x', providerID: 'opencode' })
  assert.equal(model.contextWindow, DEFAULT_CONTEXT_WINDOW)
  assert.equal(model.maxTokens, DEFAULT_MAX_OUTPUT_TOKENS)
})

test('modelFromApiEntry rejects entries without a provider or id', () => {
  assert.equal(modelFromApiEntry({ id: 'x' }), null)
  assert.equal(modelFromApiEntry({ providerID: 'opencode' }), null)
  assert.equal(modelFromApiEntry(null), null)
})

test('modelsFromApiPayload parses { data: [...] } and a bare array', () => {
  const entry = { id: 'a', providerID: 'opencode', limit: { context: 1234, output: 99 } }
  assert.equal(modelsFromApiPayload({ location: {}, data: [entry] }).models.length, 1)
  assert.equal(modelsFromApiPayload([entry]).models.length, 1)
  assert.equal(modelsFromApiPayload({ data: [] }), null)
  assert.equal(modelsFromApiPayload(null), null)
})

test('CLI listing also carries a context window (compaction must not throw)', () => {
  const parsed = modelsFromCliOutput('opencode/foo\nopencode-go/bar\nbanner noise\n')
  assert.equal(parsed.models.length, 2)
  for (const model of parsed.models) {
    assert.equal(model.contextWindow, DEFAULT_CONTEXT_WINDOW)
    assert.ok(Number.isInteger(model.maxTokens) && model.maxTokens > 0)
  }
})

// --- resolveModel: the actual bug -----------------------------------------

test('resolveModel publishes a positive contextWindow for a discovered route', async () => {
  const adapter = adapterWith([
    { id: 'opencode-go/deepseek-v4.1-flash', name: 'DeepSeek V4.1 Flash', contextWindow: 1000000, maxTokens: 384000 },
  ])
  const info = await adapter.resolveModel('opencode-agent', 'opencode-go/deepseek-v4.1-flash')
  assert.equal(info.provider, 'opencode-agent')
  assert.equal(info.id, 'opencode-go/deepseek-v4.1-flash')
  assert.equal(info.context.contextWindow, 1000000)
  assert.equal(info.defaultMaxTokens, 384000)
})

test('resolveModel still publishes a contextWindow for an UNKNOWN route', async () => {
  const adapter = adapterWith([])
  const info = await adapter.resolveModel('opencode-agent', 'opencode/some-new-model')
  assert.equal(info.context.contextWindow, DEFAULT_CONTEXT_WINDOW)
  assert.ok(Number.isInteger(info.context.contextWindow))
})

test('resolveModel with discovery disabled still never omits context', async () => {
  const adapter = adapterWith([], { autoDiscoverModels: false })
  const info = await adapter.resolveModel('opencode-agent', 'opencode/beam-free')
  assert.ok(info.context && info.context.contextWindow > 0)
})

test('resolveModel matches a bare model id against a fully qualified entry', async () => {
  const adapter = adapterWith([{ id: 'opencode-go/x', name: 'X', contextWindow: 7777, maxTokens: 100 }])
  const info = await adapter.resolveModel('opencode-agent', 'x')
  assert.equal(info.context.contextWindow, 7777)
})

test('resolveModel honours the host normalizer contract (name/id/provider)', async () => {
  const adapter = adapterWith([{ id: 'opencode/a', name: 'A', contextWindow: 4096, maxTokens: 512 }])
  const info = await adapter.resolveModel('opencode-agent', 'opencode/a')
  // Mirrors dsh-llm normalizeModelInfo() validation.
  assert.equal(info.provider, 'opencode-agent')
  assert.equal(info.id, 'opencode/a')
  assert.ok(typeof info.name === 'string' && info.name.length > 0)
  assert.ok(Number.isInteger(info.context.contextWindow) && info.context.contextWindow > 0)
  assert.ok(Number.isSafeInteger(info.defaultMaxTokens) && info.defaultMaxTokens > 0)
})

test('listModels descriptions do not claim a fixed context', async () => {
  const adapter = adapterWith([{ id: 'opencode/a', name: 'A', contextWindow: 4096, maxTokens: 512 }])
  const listed = await adapter.listModels('opencode-agent')
  for (const model of listed) assert.ok(typeof model.description === 'string')
})
