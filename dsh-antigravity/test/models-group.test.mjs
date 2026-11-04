import assert from 'node:assert/strict'
import { test } from 'node:test'

import { groupModels } from '../lib/server.js'

/** Minimal flat catalog rows with the quota reset windows measured on the account. */
const entries = [
  { id: 'gemini-3.8-flash-high', name: 'Gemini 3.8 Flash (High)', quota: { remaining: 0.99247545, resetTime: '2026-11-04T21:37:02Z' } },
  { id: 'gemini-3.8-flash-medium', name: 'Gemini 3.8 Flash (Medium)', quota: { remaining: 0.99247545, resetTime: '2026-11-04T21:37:02Z' } },
  { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)', quota: { remaining: 0.99247545, resetTime: '2026-11-04T21:37:02Z' } },
  { id: 'gemini-2.5-pro', name: 'Gemini 2.5 Pro', quota: { remaining: 0.99247545, resetTime: '2026-11-04T21:37:02Z' } },
  { id: 'claude-sonnet-5-5-low', name: 'Claude Sonnet 5.5 (Low)', quota: { remaining: 0.999808, resetTime: '2026-11-04T23:23:40Z' } },
  { id: 'gpt-oss-120b-medium', name: 'GPT-OSS 120B (Medium)', quota: { remaining: 0.999808, resetTime: '2026-11-04T23:23:40Z' } },
  { id: 'gemini-4-argon-low', name: 'Gemini 4 Argon (Low)', quota: { remaining: 1, resetTime: '2026-11-11T21:24:14Z' } },
]

test('the settings list groups by usage family and hides effort suffixes', () => {
  const groups = groupModels(entries, [])
  assert.deepEqual(groups.map((group) => group.kind), ['gemini', 'claude-gpt', 'argon'])
  const gemini = groups.find((group) => group.kind === 'gemini')
  assert.deepEqual(gemini.models.map((model) => model.id), ['gemini-3.8-flash', 'gemini-2.5-pro'])
  assert.deepEqual(gemini.models[0].variants, ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low'])
  assert.equal(gemini.models[0].name, 'Gemini 3.8 Flash', 'the effort suffix is not part of the name')
  assert.ok(gemini.models.every((model) => model.enabled), 'no allow-list means every model')
})

test('a base model is enabled only when all of its variants are allowed', () => {
  const groups = groupModels(entries, ['gemini-3.8-flash-low', 'gemini-3.8-flash-medium'])
  const gemini = groups.find((group) => group.kind === 'gemini')
  assert.equal(gemini.models[0].enabled, false, 'a partial variant set is not a full model')
  const full = groupModels(entries, ['gemini-3.8-flash-low', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-high'])
  assert.equal(full.find((group) => group.kind === 'gemini').models[0].enabled, true)
})

test('the group quota is the minimum remaining across its models', () => {
  const groups = groupModels([
    { id: 'gemini-3.8-flash-low', name: 'Gemini 3.8 Flash (Low)', quota: { remaining: 0.5, resetTime: 'r' } },
    { id: 'gemini-3.5-flash', name: 'Gemini 3.5 Flash', quota: { remaining: 0.9, resetTime: 'r' } },
  ])
  assert.equal(groups[0].quotaRemaining, 0.5)
  assert.equal(groups[0].quotaReset, 'r')
})
