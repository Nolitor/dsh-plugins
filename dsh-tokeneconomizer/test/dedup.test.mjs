/**
 * Tool-result hash deduplication, in memory only.
 *
 * These tests cover the store in isolation: what it remembers, what it replaces, and what it
 * never keeps. No engine, no session, no filesystem.
 */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'

import { createDedupStore, hashText, pointerText, SHORT_HASH_CHARS } from '../lib/dedup.js'

/** A repeated output long enough to be worth replacing. */
const LONG = 'x'.repeat(400)

test('the first occurrence of an output is kept', () => {
  const store = createDedupStore()
  assert.equal(store.observe(LONG, 3), undefined)
  assert.equal(store.size, 1)
})

test('a repeated output is replaced by a pointer to the first step', () => {
  const store = createDedupStore()
  store.observe(LONG, 3)
  const repeat = store.observe(LONG, 9)
  assert.ok(repeat)
  assert.equal(repeat.step, 3)
  assert.equal(repeat.count, 2)
  assert.equal(
    repeat.text,
    `[Output identical to step 3 (hash: ${hashText(LONG).slice(0, SHORT_HASH_CHARS)}), content omitted to save context]`,
  )
})

test('every later occurrence cites the first step', () => {
  const store = createDedupStore()
  store.observe(LONG, 3)
  store.observe(LONG, 9)
  const third = store.observe(LONG, 12)
  assert.ok(third)
  assert.equal(third.step, 3)
  assert.equal(third.count, 3)
})

test('a different output is not a repetition', () => {
  const store = createDedupStore()
  store.observe(LONG, 3)
  assert.equal(store.observe('y'.repeat(400), 4), undefined)
  assert.equal(store.size, 2)
})

test('an output below the minimum length is never replaced', () => {
  const store = createDedupStore({ minChars: 200 })
  assert.equal(store.observe('short', 1), undefined)
  assert.equal(store.observe('short', 2), undefined)
  assert.equal(store.size, 0)
})

test('the digest of a text is its SHA-256 and is stable', () => {
  const digest = hashText(LONG)
  assert.equal(digest, createHash('sha256').update(LONG, 'utf8').digest('hex'))
  assert.equal(hashText(LONG), digest)
  assert.notEqual(hashText('other'), digest)
})

test('the pointer quotes a short hash and never the output', () => {
  const pointer = pointerText(4, hashText(LONG))
  assert.match(pointer, /^\[Output identical to step 4 \(hash: [0-9a-f]{12}\), content omitted to save context\]$/)
  assert.ok(!pointer.includes(LONG))
})

test('the store keeps no raw output and stays within its budget', () => {
  const store = createDedupStore({ maxEntries: 4 })
  for (let index = 0; index < 10; index += 1) {
    store.observe(`${index}-${LONG}`, index)
  }
  assert.equal(store.size, 4)
})

test('clearing the store forgets every digest', () => {
  const store = createDedupStore()
  store.observe(LONG, 1)
  store.clear()
  assert.equal(store.size, 0)
  assert.equal(store.observe(LONG, 2), undefined)
})
