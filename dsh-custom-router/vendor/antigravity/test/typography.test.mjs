/**
 * Typography contract — DSH-STYLE-DEPENDENT, not fixed pixels.
 *
 * CORRECTION to docs/PLUGIN-STYLE-STANDARD.md (measured 2026-11-05):
 *
 * The standard says "a plugin surface must state font-size:14px; line-height:22px
 * on its own root" and that DSH "defines no font-size token". The second half is
 * wrong, and the first half therefore hardcodes a size the user can change.
 *
 * Measured in the shipped stylesheet and the theme client:
 *
 *   body{--dsh-content-font-delta:calc(var(--dsh-content-font-size,14px) - 14px);
 *        --dsh-content-font-size-secondary:min(calc(var(--dsh-content-font-size,14px) - 1px),
 *                                              max(13px, calc(var(--dsh-content-font-size,14px) - 2px)));
 *        --dsh-content-font-delta-secondary:calc(var(--dsh-content-font-size-secondary) - 13px);}
 *
 * and `dsh-client-ui-theme` FONT_SIZE_SPECS sets `--dsh-content-font-size` at
 * runtime (default 14, range 10..22, user-configurable; this profile sets 13).
 * Native components consume it exactly this way:
 *
 *   ._bubble_...{font-size:var(--dsh-content-font-size,14px);
 *                line-height:calc(22px + var(--dsh-content-font-delta,0px))}
 *   ._compact_...{font-size:var(--dsh-content-font-size-secondary,13px);
 *                 line-height:calc(20px + var(--dsh-content-font-delta-secondary,0px))}
 *
 * So a plugin that hardcodes 14px ignores the user's font-size setting and
 * renders at the wrong size as soon as it is not the default.
 *
 * These tests therefore require the TOKEN form, with the DSH fallback so the
 * surface still renders if a variable is absent.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const source = readFileSync(join(root, 'lib', 'client.js'), 'utf8')
const css = source.slice(source.indexOf('const CSS = ['), source.indexOf("].join('')"))

/** Extract one rule body by selector. */
function rule(selector) {
  const index = css.indexOf(selector + '{')
  if (index === -1) return undefined
  return css.slice(index + selector.length + 1, css.indexOf('}', index))
}

test('root follows the live content size, not a fixed 14px', () => {
  const body = rule('.agSection')
  assert.ok(body, '.agSection rule is missing')
  assert.match(body, /font-size:var\(--dsh-content-font-size,14px\)/,
    'the root must track --dsh-content-font-size so the user font setting applies')
  assert.match(body, /line-height:calc\(22px \+ var\(--dsh-content-font-delta,0px\)\)/,
    'line-height must grow with the size delta')
})

test('secondary text uses the derived secondary token', () => {
  for (const selector of ['.agHint', '.agRowHint', '.agStatLabel']) {
    const body = rule(selector)
    assert.ok(body, selector + ' is missing')
    assert.match(body, /font-size:var\(--dsh-content-font-size-secondary,13px\)/, selector)
  }
})

test('no hardcoded font-size anywhere in the sheet', () => {
  // A literal px size cannot follow the user's setting; every size must be a
  // var() with the DSH fallback.
  const literals = [...css.matchAll(/font-size:(?!var\(|calc\()([^;}]+)/g)].map((m) => m[1])
  assert.deepEqual(literals, [], 'hardcoded sizes: ' + literals.join(', '))
})

test('no hardcoded colours — only --dsw tokens', () => {
  assert.deepEqual(css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? [], [])
  assert.equal(/rgba?\(/.test(css), false)
})

test('no bare element selectors that could leak', () => {
  assert.equal(/(^|\})\s*(body|html|:root)\s*\{/.test(css), false,
    'a plugin must never size body/html/:root')
})

test('font family is inherited, never replaced', () => {
  for (const declaration of css.match(/font-family:[^;}]+/g) ?? []) {
    assert.equal(declaration.replace(/\s/g, ''), 'font-family:inherit', 'got: ' + declaration)
  }
})
