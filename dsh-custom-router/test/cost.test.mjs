/**
 * Cost arithmetic mirrors upstream pi-ai `calculateCost()` because the DSH
 * wrapper drops `usage.cost` (measured 2026-11-07).
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { calculateCost, normalizeUsage, ratesFor } from '../lib/cost.js'

const RATES = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }

test('rates are per 1M tokens', () => {
  const cost = calculateCost(RATES, { input: 1_000_000, output: 1_000_000 })
  assert.equal(cost.input, 10)
  assert.equal(cost.output, 50)
  assert.equal(cost.total, 60)
  assert.equal(cost.totalFromProvider, false)
})

test('cache reads and writes bill at their own rates', () => {
  const cost = calculateCost(RATES, { input: 0, output: 0, cacheRead: 1_000_000, cacheWrite: 1_000_000 })
  assert.equal(cost.cacheRead, 1)
  assert.equal(cost.cacheWrite, 12.5)
  assert.equal(cost.total, 13.5)
})

test('a 1h cache write bills at 2x the input rate', () => {
  const cost = calculateCost(RATES, { input: 0, output: 0, cacheWrite: 1_000_000, cacheWrite1h: 1_000_000 })
  assert.equal(cost.cacheWrite, 20)
})

test('tiers apply by total input tokens and the highest threshold wins', () => {
  const tiered = {
    ...RATES,
    tiers: [
      { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25, inputTokensAbove: 1_000 },
      { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5, inputTokensAbove: 10_000 },
    ],
  }
  assert.equal(ratesFor(tiered, 500).input, 10)
  assert.equal(ratesFor(tiered, 2_000).input, 5)
  assert.equal(ratesFor(tiered, 20_000).input, 2)
  assert.equal(calculateCost(tiered, { input: 2_000 }).input, 0.01)
})

test('normalizeUsage clamps the 1h write to the written total and fills zeros', () => {
  assert.deepEqual(normalizeUsage({ inputTokens: 3, outputTokens: 4, cacheWrite: 10, cacheWrite1h: 20 }), {
    input: 3, output: 4, cacheRead: 0, cacheWrite: 10, cacheWrite1h: 10,
  })
  assert.deepEqual(normalizeUsage({}), { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cacheWrite1h: 0 })
})

test('a missing cost record fails loud', () => {
  assert.throws(() => calculateCost(null, {}), /cost record/)
  assert.throws(() => calculateCost({ input: 1 }, {}), /cost\.output must be a non-negative number/)
})
