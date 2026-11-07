/**
 * Usage binding: adapter usage → cost → billing → UsageReading[] (tokens + quota
 * windows), with locale-aware displays and `unknown` kept visible.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { findPreset } from '../lib/presets.js'
import { bindUsage, formatReading, normalizeWindow, tokenReadings, usageReading, windowReadings } from '../lib/usage.js'

const COST = { input: 10, output: 50, cacheRead: 1, cacheWrite: 12.5 }

test('quota windows become percent readings with limited state', () => {
  const readings = windowReadings([
    { label: 'weekly', percent: 8, limited: false, resetsAt: 123 },
    { label: '5h', percent: 100, limited: true },
  ], { service: 'antigravity', measuredAt: 5 })
  assert.equal(readings.length, 2)
  assert.equal(readings[0].kind, 'percent-consumed')
  assert.equal(readings[0].window, 'weekly')
  assert.equal(readings[0].limited, false)
  assert.equal(readings[0].resetsAt, 123)
  assert.equal(readings[1].limited, true)
  assert.equal(readings[1].measuredAt, 5)
})

test('remainingFraction stays a fraction, not a converted percent', () => {
  const [reading] = windowReadings([{ label: 'quota', remainingFraction: 0.64 }])
  assert.equal(reading.kind, 'fraction-remaining')
  assert.equal(reading.value, 0.64)
  assert.equal(reading.unit, 'fraction')
  assert.match(reading.display, /64% remaining/)
})

test('display strings are locale aware', () => {
  const en = usageReading({ kind: 'percent-consumed', value: 2, window: '5h', service: 'antigravity' })
  const ko = usageReading({ kind: 'percent-consumed', value: 2, window: '5h', service: 'antigravity', locale: 'ko' })
  assert.equal(en.display, '5h 2% used')
  assert.equal(ko.display, '5h 2% 사용')
  assert.equal(formatReading({ kind: 'usd-amount', value: 0.25, service: 'x', window: null }, 'en'), '$0.2500')
})

test('token readings are one per disjoint bucket', () => {
  const readings = tokenReadings({ input: 10, output: 20, cacheRead: 0, cacheWrite: 5 }, { service: 's', source: 'usage' })
  assert.deepEqual(readings.map((reading) => reading.source), ['usage.input', 'usage.output', 'usage.cacheWrite'])
})

test('bindUsage on a covered subscription bills zero and lists windows', () => {
  const bound = bindUsage({
    preset: findPreset('antigravity'),
    usage: { inputTokens: 1000, outputTokens: 500 },
    verdict: { verdict: 'match', windows: [{ label: 'weekly', percent: 8 }], measuredAt: 7 },
    modelCost: COST,
  })
  assert.equal(bound.billing.billed, 0)
  assert.equal(bound.billing.covered, true)
  assert.equal(bound.cost.total > 0, true)
  assert.equal(bound.readings.some((reading) => reading.window === 'weekly'), true)
})

test('bindUsage on an unknown plan adds an unavailable reading, not a zero claim', () => {
  const bound = bindUsage({
    preset: findPreset('opencode'),
    usage: { inputTokens: 10, outputTokens: 5 },
    verdict: { verdict: 'unknown', windows: [] },
    modelCost: COST,
  })
  assert.equal(bound.billing.billed, null)
  const gap = bound.readings.find((reading) => reading.confidence === 'unavailable')
  assert.ok(gap)
  assert.match(gap.display, /unavailable/)
})

test('bindUsage on pay-per-token bills the estimate', () => {
  const bound = bindUsage({
    preset: findPreset('deepinfra'),
    usage: { inputTokens: 1_000_000 },
    verdict: { verdict: 'no-plan-service', windows: [] },
    modelCost: COST,
  })
  assert.equal(bound.billing.billed, 10)
  assert.equal(bound.billing.confidence, 'estimated')
})

test('window aliases normalize the measured labels', () => {
  assert.equal(normalizeWindow('rolling'), '5h')
  assert.equal(normalizeWindow('7d'), 'weekly')
  assert.equal(normalizeWindow('30d'), 'monthly')
})
