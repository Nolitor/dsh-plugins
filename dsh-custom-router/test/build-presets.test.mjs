/**
 * The preset-declaration derive gate.
 *
 * `check:derive` is the only thing that catches `lib/client.src.js` drifting
 * from `lib/presets.js`. It must not fail on a byte-identical tree (the
 * 2026-11-13 regression: `declarationSource()` ends with the line's newline
 * while the `/m` line regex never captures it) and it must still catch a real
 * declaration change.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { DECLARATION_LINE, declarationsAreCurrent } from '../scripts/build-presets.mjs'

const SRC = new URL('../lib/client.src.js', import.meta.url)

test('the checked-in client source satisfies the derive gate', () => {
  assert.equal(declarationsAreCurrent(readFileSync(SRC, 'utf8')), true)
})

test('a real declaration change is still detected', () => {
  const source = readFileSync(SRC, 'utf8')
  const current = DECLARATION_LINE.exec(source)?.[0]
  assert.ok(current, 'client.src.js must carry the declarations line')
  const drifted = source.replace(current, current.replace('antigravity', 'antigravity-drift'))
  assert.notEqual(drifted, source)
  assert.equal(declarationsAreCurrent(drifted), false)
})

test('a source without the declarations line is not current', () => {
  assert.equal(declarationsAreCurrent('// no declarations here\n'), false)
  assert.equal(declarationsAreCurrent(undefined), false)
})
