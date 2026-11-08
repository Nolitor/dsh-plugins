/**
 * Model-id resolution — the base id is NOT a served model.
 *
 * Measured 2026-11-05 against the live account: sending `gemini-3.8-flash` or
 * `gpt-oss-120b` returns 404 NOT_FOUND. Only the suffixed ids exist
 * (`gemini-3.8-flash-low/-medium/-high`, `gpt-oss-120b-medium`).
 *
 * Because the catalog groups those ids into one base model for DSH, EVERY request
 * must be mapped back to a served id — including when the caller passes no
 * reasoning effort at all. The first implementation short-circuited on a missing
 * effort and sent the bare base id, so the default path failed with 404 while the
 * effort path worked.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { modelForEffort } from '../lib/wire.js'

const AVAILABLE = [
  'gemini-3.8-flash-low',
  'gemini-3.8-flash-medium',
  'gemini-3.8-flash-high',
  'gpt-oss-120b-medium',
  'gemini-2.5-pro',
]

test('no effort still resolves to a served suffixed id', () => {
  const resolved = modelForEffort('gemini-3.8-flash', undefined, AVAILABLE)
  assert.notEqual(resolved, 'gemini-3.8-flash', 'the bare base id returns 404')
  assert.ok(AVAILABLE.includes(resolved), 'resolved id must be one the account serves')
})

test('an effort selects the matching suffix', () => {
  assert.equal(modelForEffort('gemini-3.8-flash', 'high', AVAILABLE), 'gemini-3.8-flash-high')
  assert.equal(modelForEffort('gemini-3.8-flash', 'low', AVAILABLE), 'gemini-3.8-flash-low')
  assert.equal(modelForEffort('gemini-3.8-flash', 'medium', AVAILABLE), 'gemini-3.8-flash-medium')
})

test('a single-variant model resolves to that variant', () => {
  assert.equal(modelForEffort('gpt-oss-120b', undefined, AVAILABLE), 'gpt-oss-120b-medium')
})

test('a model with no suffix variants is returned unchanged', () => {
  assert.equal(modelForEffort('gemini-2.5-pro', undefined, AVAILABLE), 'gemini-2.5-pro')
})

test('an already-suffixed id is preserved', () => {
  assert.equal(modelForEffort('gemini-3.8-flash-high', undefined, AVAILABLE), 'gemini-3.8-flash-high')
})

test('an unserved effort falls back to a served variant, never the bare base', () => {
  const resolved = modelForEffort('gemini-3.8-flash', 'max', ['gemini-3.8-flash-low'])
  assert.equal(resolved, 'gemini-3.8-flash-low')
})

test('an unknown catalog keeps a suffixed id rather than inventing one', () => {
  assert.equal(modelForEffort('gemini-3.8-flash', 'high', []), 'gemini-3.8-flash-high')
})
