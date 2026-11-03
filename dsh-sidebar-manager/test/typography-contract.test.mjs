/**
 * Typography contract for plugin surfaces.
 *
 * DSH ships no font-size token and sets none on <body>, so the UA default (16px)
 * is what any surface that omits font-size inherits. Every native surface states
 * its size explicitly (measured: Settings dialog = 14px x20 / 12px x11), so a
 * plugin that leaves it unset renders visibly larger than the rest of the UI.
 *
 * Measured 2026-11-03 before the fix: the sidebar panel root and its inputs
 * computed to 16px, and the notify section root to 16px with 12px buttons.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

test('the panel root pins the native UI baseline instead of inheriting 16px', () => {
  const at = source.indexOf('panelPage: {')
  assert.ok(at > 0, 'panelPage style must exist')
  const block = source.slice(at, source.indexOf('},', at))
  assert.match(block, /fontSize: 14/, 'panel root must state 14px like native surfaces')
  assert.match(block, /lineHeight: '22px'/, 'panel root must state the native 22px line height')
})

test('form controls state their own font size', () => {
  for (const key of ['plain: {', 'field: {']) {
    const at = source.indexOf(key)
    assert.ok(at > 0, key + ' must exist')
    const block = source.slice(at, source.indexOf('},', at))
    assert.match(block, /fontSize: 13/, key + ' must not inherit the 16px default')
  }
})

test('no literal 16px leaks into the panel', () => {
  assert.ok(!/fontSize: 16/.test(source), 'a 16px rule would reintroduce the mismatch')
})