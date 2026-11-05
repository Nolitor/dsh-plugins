import assert from 'node:assert/strict'
import { test } from 'node:test'

import { toTokenUsage } from '../lib/usage.js'
import { parseCatalog, parseAccount, splitEffort, groupByBase } from '../lib/catalog.js'

test('prompt tokens are split into uncached input and cache read', () => {
  const usage = toTokenUsage({ promptTokenCount: 1000, candidatesTokenCount: 20, cachedContentTokenCount: 800, totalTokenCount: 1020 })
  assert.equal(usage.inputTokens, 200)
  assert.equal(usage.cacheReadTokens, 800)
  assert.equal(usage.outputTokens, 20)
})

test('reasoning tokens are reported separately, not added to output', () => {
  const usage = toTokenUsage({ promptTokenCount: 18, candidatesTokenCount: 32, thoughtsTokenCount: 655, totalTokenCount: 705 })
  assert.equal(usage.outputTokens, 32)
  assert.equal(usage.reasoningTokens, 655)
  assert.equal(usage.totalTokens, 705)
})

test('no metadata yields undefined', () => {
  assert.equal(toTokenUsage(undefined), undefined)
  assert.equal(toTokenUsage({}), undefined)
})

test('catalog filters utility routes', () => {
  const entries = parseCatalog({
    models: {
      'gemini-3.8-flash-low': { displayName: 'Gemini 3.8 Flash (Low)', maxTokens: 1000000, maxOutputTokens: 65536, quotaInfo: { remainingFraction: 0.98 } },
      'tab_flash_lite_preview': { displayName: 'Tab' },
      'chat_23310': { displayName: 'Chat' },
    },
    tabModelIds: [],
    mqueryModelIds: ['chat_23310'],
  })
  const ids = entries.map((e) => e.id)
  assert.deepEqual(ids, ['gemini-3.8-flash-low'])
  assert.equal(entries[0].quota.remaining, 0.98)
})

test('account parses project and tier', () => {
  const account = parseAccount({ cloudaicompanionProject: 'aicode-consumers', currentTier: { id: 'free-tier', name: 'Antigravity' } })
  assert.equal(account.project, 'aicode-consumers')
  assert.equal(account.tier, 'free-tier')
})

test('splitEffort separates the picker suffix', () => {
  assert.deepEqual(splitEffort('gemini-3.8-flash-low'), { base: 'gemini-3.8-flash', effort: 'low' })
  assert.deepEqual(splitEffort('gpt-oss-120b-medium'), { base: 'gpt-oss-120b', effort: 'medium' })
  assert.deepEqual(splitEffort('claude-sonnet-5-5'), { base: 'claude-sonnet-5-5', effort: undefined })
})

test('groupByBase collects efforts per base model', () => {
  const groups = groupByBase([
    { id: 'gemini-3.8-flash-low' },
    { id: 'gemini-3.8-flash-high' },
  ])
  assert.deepEqual(groups.get('gemini-3.8-flash').efforts.sort(), ['high', 'low'])
})
