/**
 * Catalog mapping: Antigravity's per-effort MODEL IDS become DSH's one-model
 * plus reasoning.efforts.
 *
 * Measured shape of fetchAvailableModels (2026-11-05): one entry per suffixed id
 * (gemini-3.8-flash-low / -medium / -high), each with displayName, maxTokens,
 * maxOutputTokens, supportsImages, supportsThinking, quotaInfo.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  groupByBase,
  parseAccount,
  parseCatalog,
  splitEffort,
  toModelInfo,
  toResolvedModelInfo,
} from '../lib/catalog.js'

const PAYLOAD = {
  models: {
    'gemini-3.8-flash-low': { displayName: 'Gemini 3.8 Flash (Low)', maxTokens: 1048576, maxOutputTokens: 65536, supportsImages: true, supportsThinking: true, quotaInfo: { remainingFraction: 0.98 } },
    'gemini-3.8-flash-medium': { displayName: 'Gemini 3.8 Flash (Medium)', maxTokens: 1048576, maxOutputTokens: 65536, supportsImages: true, supportsThinking: true },
    'gemini-3.8-flash-high': { displayName: 'Gemini 3.8 Flash (High)', maxTokens: 1048576, maxOutputTokens: 65536, supportsImages: true, supportsThinking: true },
    'gpt-oss-120b-medium': { displayName: 'GPT-OSS 120B (Medium)', maxTokens: 131072, maxOutputTokens: 32768, supportsThinking: true },
    'tab_flash_lite_preview': { displayName: 'Tab' },
    'chat_23310': { displayName: 'Chat' },
  },
  tabModelIds: [],
  mqueryModelIds: ['chat_23310'],
}

test('utility routes are filtered out', () => {
  const ids = parseCatalog(PAYLOAD).map((entry) => entry.id)
  assert.equal(ids.includes('tab_flash_lite_preview'), false)
  assert.equal(ids.includes('chat_23310'), false)
})

test('per-effort ids collapse into one base model', () => {
  const groups = groupByBase(parseCatalog(PAYLOAD))
  const flash = groups.find((group) => group.id === 'gemini-3.8-flash')
  assert.ok(flash, 'the three flash ids must group into one model')
  assert.deepEqual(flash.efforts, ['low', 'medium', 'high'], 'efforts are ordered least to greatest')
  assert.equal(flash.name, 'Gemini 3.8 Flash', 'the level suffix is stripped from the display name')
})

test('a model without an effort suffix keeps its single level', () => {
  const groups = groupByBase(parseCatalog(PAYLOAD))
  const oss = groups.find((group) => group.id === 'gpt-oss-120b')
  assert.deepEqual(oss.efforts, ['medium'])
})

test('LlmModelInfo carries no contextWindow (it belongs to resolved info)', () => {
  const groups = groupByBase(parseCatalog(PAYLOAD))
  const info = toModelInfo('antigravity', groups.find((g) => g.id === 'gemini-3.8-flash'))
  assert.deepEqual(Object.keys(info).sort(), ['id', 'inputModalities', 'name', 'provider'])
  assert.equal('contextWindow' in info, false)
  assert.equal('reasoningEfforts' in info, false, 'that field does not exist in the contract')
})

test('LlmResolvedModelInfo uses context.contextWindow and reasoning.efforts', () => {
  const groups = groupByBase(parseCatalog(PAYLOAD))
  const resolved = toResolvedModelInfo('antigravity', groups.find((g) => g.id === 'gemini-3.8-flash'))
  assert.deepEqual(resolved.context, { contextWindow: 1048576 })
  assert.deepEqual(resolved.reasoning.efforts, [
    { id: 'low', name: 'Low' },
    { id: 'medium', name: 'Medium' },
    { id: 'high', name: 'High' },
  ])
  assert.equal(resolved.reasoning.defaultEffort, 'low', 'the picker defaults to the lowest level')
  assert.equal('contextWindow' in resolved, false, 'context must be nested')
})

test('a model without image support omits inputModalities', () => {
  const groups = groupByBase(parseCatalog(PAYLOAD))
  const info = toModelInfo('antigravity', groups.find((g) => g.id === 'gpt-oss-120b'))
  assert.equal('inputModalities' in info, false, 'an explicit omission is a negative capability')
})

test('defaultMaxTokens is absent unless the caller supplies a turn policy', () => {
  const groups = groupByBase(parseCatalog(PAYLOAD))
  const oss = groups.find((g) => g.id === 'gpt-oss-120b')
  // maxOutputTokens is CAPACITY, not a per-turn reservation. Advertising it would
  // reserve the whole output window for every turn (the DeepInfra track hit the
  // same trap). A cap appears only when the caller sets one, clamped to capacity.
  assert.equal(toResolvedModelInfo('antigravity', oss).defaultMaxTokens, undefined)
  assert.equal(toResolvedModelInfo('antigravity', oss, { defaultMaxTokens: 999999 }).defaultMaxTokens, 32768)
  assert.equal(toResolvedModelInfo('antigravity', oss, { defaultMaxTokens: 1024 }).defaultMaxTokens, 1024)
})

test('splitEffort handles unsuffixed ids', () => {
  assert.deepEqual(splitEffort('gemini-2.5-pro'), { base: 'gemini-2.5-pro', effort: undefined })
  assert.deepEqual(splitEffort('claude-sonnet-5-5-high'), { base: 'claude-sonnet-5-5', effort: 'high' })
})

test('account parses project and tier', () => {
  const account = parseAccount({ cloudaicompanionProject: 'aicode-consumers', currentTier: { id: 'free-tier', name: 'Antigravity' } })
  assert.equal(account.project, 'aicode-consumers')
  assert.equal(account.tier, 'free-tier')
})

test('duplicate display names are disambiguated with the model id', () => {
  const groups = groupByBase(parseCatalog({
    models: {
      'gemini-2.5-flash': { displayName: 'Gemini 3.5 Flash Lite' },
      'gemini-2.5-flash-lite': { displayName: 'Gemini 3.5 Flash Lite' },
      'gemini-2.5-pro': { displayName: 'Gemini 2.5 Pro' },
    },
  }))
  const names = Object.fromEntries(groups.map((group) => [group.id, group.name]))
  assert.equal(names['gemini-2.5-flash'], 'Gemini 3.5 Flash Lite (gemini-2.5-flash)')
  assert.equal(names['gemini-2.5-flash-lite'], 'Gemini 3.5 Flash Lite (gemini-2.5-flash-lite)')
  assert.equal(names['gemini-2.5-pro'], 'Gemini 2.5 Pro', 'a unique name is left alone')
})
