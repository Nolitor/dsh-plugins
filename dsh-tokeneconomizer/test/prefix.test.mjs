/**
 * The KV-cache-safe prefix slot and its guard.
 *
 * The pinned rules are a prompt section, so their text is part of the request's first message.
 * The guard reports a mid-session change of that message instead of letting it pass unnoticed.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createPrefixGuard, DEFAULT_PINNED_RULES_ORDER, PINNED_SECTION_NAME, pinnedSection } from '../lib/prefix.js'

test('the pinned rules are a section, not a context', () => {
  const section = pinnedSection('keep the prefix stable', DEFAULT_PINNED_RULES_ORDER)
  assert.equal(section.name, PINNED_SECTION_NAME)
  assert.equal(section.order, DEFAULT_PINNED_RULES_ORDER)
  assert.equal(section.text, 'keep the prefix stable')
  assert.equal(section.interpolate, false)
  assert.equal(section.complete, undefined)
})

test('the first observation records the baseline', () => {
  const guard = createPrefixGuard()
  const verdict = guard.observe('system prompt')
  assert.deepEqual(verdict, { first: true, changed: false })
  assert.equal(guard.changes, 0)
})

test('an unchanged system message is not reported', () => {
  const guard = createPrefixGuard()
  guard.observe('system prompt')
  assert.deepEqual(guard.observe('system prompt'), { first: false, changed: false })
  assert.equal(guard.changes, 0)
})

test('a changed system message is reported', () => {
  const guard = createPrefixGuard()
  guard.observe('system prompt')
  assert.deepEqual(guard.observe('system prompt v2'), { first: false, changed: true })
  assert.equal(guard.changes, 1)
})
