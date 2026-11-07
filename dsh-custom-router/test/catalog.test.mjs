/**
 * 3-layer catalog merge (owner decision 2026-11-07): upstream static snapshot →
 * API/web-auth probe → manual preset/local override, merged field by field with
 * 3 > 2 > 1 precedence and provenance recorded per model.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { findModel, mergeCatalog, mergeCost } from '../lib/catalog.js'

const UPSTREAM = {
  source: 'upstream',
  models: [{ id: 'm1', name: 'Upstream M1', contextWindow: 1000, maxTokens: 100, cost: { input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25 } }],
}
const PROBE = { source: 'probe', models: [{ id: 'm1', contextWindow: 2000 }, { id: 'm2', name: 'Probe M2' }] }
const OVERRIDE = { source: 'override', pricing: [{ modelId: 'm1', cost: { input: 3 } }], models: [{ id: 'local-1', name: 'Local', contextWindow: 8192 }] }

test('layers merge field by field with override > probe > upstream', () => {
  const { models, errors } = mergeCatalog([UPSTREAM, PROBE, OVERRIDE])
  assert.deepEqual(errors, [])
  const m1 = findModel(models, 'm1')
  assert.equal(m1.name, 'Upstream M1')          // untouched by probe/override
  assert.equal(m1.contextWindow, 2000)          // probe won
  assert.equal(m1.cost.input, 3)                // override won
  assert.equal(m1.cost.output, 2)               // upstream kept the other rates
  assert.equal(m1.source, 'override')
  assert.deepEqual(m1.layers, ['upstream', 'probe', 'override'])
})

test('a later layer creates a model the earlier layers never described', () => {
  const { models } = mergeCatalog([UPSTREAM, OVERRIDE])
  assert.equal(findModel(models, 'local-1').contextWindow, 8192)
})

test('pricing-only overrides patch a model without replacing it', () => {
  const { models } = mergeCatalog([UPSTREAM, { source: 'override', pricing: [{ modelId: 'm1', cost: { output: 9 } }] }])
  const m1 = findModel(models, 'm1')
  assert.equal(m1.cost.output, 9)
  assert.equal(m1.cost.input, 1)
  assert.equal(m1.contextWindow, 1000)
})

test('mergeCost ignores undefined fields and replaces tiers when given', () => {
  const merged = mergeCost({ input: 1, output: 2, cacheRead: 0.1, cacheWrite: 1.25, tiers: [{ input: 0, output: 0, cacheRead: 0, cacheWrite: 0, inputTokensAbove: 10 }] }, { output: 4, tiers: [] })
  assert.equal(merged.input, 1)
  assert.equal(merged.output, 4)
  assert.deepEqual(merged.tiers, [])
})

test('an out-of-order layer list is a validation error', () => {
  const { errors } = mergeCatalog([OVERRIDE, PROBE])
  assert.match(errors.join(' '), /ordered upstream → probe → override/)
})

test('an unknown layer source is rejected', () => {
  const { errors } = mergeCatalog([{ source: 'remote', models: [] }])
  assert.match(errors.join(' '), /unknown source/)
})
