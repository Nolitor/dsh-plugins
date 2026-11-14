/**
 * The preset-declaration bake and its derive gate.
 *
 * Two defect classes are pinned here, both measured on 2026-11-13/14:
 *
 *   1. The bake was NOT idempotent. `DECLARATION_LINE` (`/m`, `.*$`) stopped
 *      before the line terminator while `declarationSource()` ended with `\n`,
 *      so each bake inserted one extra newline: `lib/client.src.js` grew an
 *      exact +1 byte per run (measured 185404 → 185405 → 185406 over three
 *      runs, source otherwise unchanged).
 *   2. The gate and the bake normalised the line differently — the gate did
 *      `.replace(/\n$/, '')` — which is why `--check` passed while the bake was
 *      corrupting the file. The gate must never again be able to disagree with
 *      what the bake writes; both go through `normalizeDeclarationLine()`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  DECLARATION_LINE,
  bakePresetDeclarations,
  declarationSource,
  declarationsAreCurrent,
  normalizeDeclarationLine,
} from '../scripts/build-presets.mjs'

const SRC = new URL('../lib/client.src.js', import.meta.url)
const source = () => readFileSync(SRC, 'utf8')
const sha256 = (buf) => createHash('sha256').update(buf).digest('hex')

test('the checked-in client source satisfies the derive gate', () => {
  assert.equal(declarationsAreCurrent(source()), true)
})

test('a real declaration change is still detected', () => {
  const text = source()
  const current = DECLARATION_LINE.exec(text)?.[0]
  assert.ok(current, 'client.src.js must carry the declarations line')
  const drifted = text.replace(current, current.replace('antigravity', 'antigravity-drift'))
  assert.notEqual(drifted, source)
  assert.equal(declarationsAreCurrent(drifted), false)
})

test('a source without the declarations line is not current', () => {
  assert.equal(declarationsAreCurrent('// no declarations here\n'), false)
  assert.equal(declarationsAreCurrent(undefined), false)
})

test('the declaration regex owns its line terminator', () => {
  // A whole-line match: line in, line out. This is what makes the bake a fixed
  // point; `.*$` (the old form) returned the line WITHOUT its `\n`.
  const matched = DECLARATION_LINE.exec('a\n    const PRESET_DECLARATIONS = X\nb')?.[0]
  assert.equal(matched, '    const PRESET_DECLARATIONS = X\n')

  // A file whose declaration is its last line, with no final newline, must
  // still match — otherwise the bake would throw on such a file.
  assert.equal(
    DECLARATION_LINE.exec('a\nconst PRESET_DECLARATIONS = X')?.[0],
    'const PRESET_DECLARATIONS = X',
  )

  // The indent class is `[ \t]*`, so a blank line above the declaration is
  // never swallowed into the match.
  assert.equal(
    DECLARATION_LINE.exec('a\n\n    const PRESET_DECLARATIONS = X\nb')?.[0],
    '    const PRESET_DECLARATIONS = X\n',
  )
})

test('normalizeDeclarationLine is idempotent and ends in exactly one newline', () => {
  const line = declarationSource()
  assert.match(line, /[^\n]\n$/)
  assert.equal(normalizeDeclarationLine(line), line)
  assert.equal(normalizeDeclarationLine('x'), 'x\n')
  assert.equal(normalizeDeclarationLine('x\n'), 'x\n')
  assert.equal(normalizeDeclarationLine('x\n\n\n'), 'x\n')
  // Derived and matched forms agree — the property the old code violated.
  assert.equal(normalizeDeclarationLine(DECLARATION_LINE.exec(source())[0]), declarationSource())
})

test('baking twice changes nothing the second time', (t) => {
  // REAL REGRESSION, on a real file: the temp copy must not be re-read into
  // shape by any other fixture, and `srcPath` keeps `lib/client.src.js` out of
  // reach of the test entirely.
  const dir = mkdtempSync(join(tmpdir(), 'dsh-build-presets-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const copy = join(dir, 'client.src.js')
  copyFileSync(SRC, copy)

  // First bake over a copy of the checked-in (already baked) file: stable.
  const before = readFileSync(copy)
  const first = bakePresetDeclarations({ srcPath: copy })
  const afterFirst = readFileSync(copy)
  assert.deepEqual(afterFirst, before, 'a bake over an already-baked file must not rewrite it')
  assert.equal(first.changed, false)
  assert.equal(first.count, 4)

  // The regression proper: bake twice, the second call reports `changed: false`
  // and the bytes are unchanged. Under the defect this grew +1 byte per call.
  const second = bakePresetDeclarations({ srcPath: copy })
  const afterSecond = readFileSync(copy)
  assert.equal(second.changed, false)
  assert.equal(sha256(afterSecond), sha256(before))
  assert.equal(afterSecond.length, before.length)
})

test('a stale file is repaired in exactly one bake, then stays fixed', (t) => {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-build-presets-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const copy = join(dir, 'client.src.js')

  // Overwrite the declaration line with a genuinely stale declaration but keep
  // the file structurally valid, exactly as `lib/presets.js` drift would leave it.
  const text = source()
  const current = DECLARATION_LINE.exec(text)[0]
  const stale = current.replace('antigravity', 'antigravity-drift')
  writeFileSync(copy, text.replace(current, stale))

  assert.equal(declarationsAreCurrent(readFileSync(copy, 'utf8')), false)

  const first = bakePresetDeclarations({ srcPath: copy })
  assert.equal(first.changed, true)
  assert.equal(declarationsAreCurrent(readFileSync(copy, 'utf8')), true)
  assert.equal(readFileSync(copy, 'utf8'), text, 'one bake restores the exact original bytes')

  // And from there it is a fixed point, not a slow leak.
  const repaired = readFileSync(copy)
  const second = bakePresetDeclarations({ srcPath: copy })
  assert.equal(second.changed, false)
  assert.deepEqual(readFileSync(copy), repaired)
})

test('the checked-in client source is already canonical, so a re-bake is identity', () => {
  // Guards the shipped artifact without a temp file: the line on disk must
  // already equal the canonical form the bake writes. If it does not, the very
  // next bake would rewrite the file — the +1-byte leak in miniature.
  const text = source()
  const matched = DECLARATION_LINE.exec(text)?.[0]
  assert.ok(matched, 'client.src.js must carry the declarations line')
  assert.equal(normalizeDeclarationLine(matched), matched)
  assert.equal(text.replace(DECLARATION_LINE, () => normalizeDeclarationLine(matched)), text)
})
