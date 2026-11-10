/**
 * Typography contract for plugin surfaces.
 *
 * The UI used to live in an inline style object with fixed pixel sizes, so the
 * user's font-size preference (--dsh-content-font-size / --dsh-content-font-delta)
 * could not reach it. Every rule now lives in one scoped stylesheet and states
 * its size through the content tokens.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const source = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

const cssStart = source.indexOf('const CSS = [')
const cssEnd = source.indexOf("].join('')", cssStart)
const css = source.slice(cssStart, cssEnd)

/** The declaration block of one `.sm*` class. */
function block(selector) {
  const at = css.indexOf(selector + '{')
  assert.ok(at > 0, 'missing rule ' + selector)
  return css.slice(at, css.indexOf('}', at))
}

test('the stylesheet is one scoped tag keyed by this package', () => {
  assert.ok(source.includes("const CSS_TAG = '@nolit/dsh-sidebar-manager'"), 'the tag key names this package')
  assert.ok(source.includes("style.setAttribute('data-plugin-css', CSS_TAG)"), 'the tag carries data-plugin-css')
  assert.ok(source.includes('function ensureStyle()'), 'the stylesheet is injected once')
})

test('no rule targets a bare element selector', () => {
  // A rule that starts with a tag name would leak into the host UI.
  const entries = [...css.matchAll(/^\s*'(.*)',?\s*$/gm)].map((match) => match[1])
  assert.ok(entries.length > 20, 'the stylesheet is a list of rule strings, got ' + entries.length)
  for (const entry of entries) {
    const selectors = entry.split('{')[0]
    assert.ok(selectors.length > 0, 'empty selector in: ' + entry)
    for (const part of selectors.split(',')) {
      const trimmed = part.trim()
      assert.ok(
        trimmed.startsWith('.sm') || trimmed.startsWith('@media'),
        'selector must start with a .sm class or a media query, got: ' + trimmed,
      )
    }
  }
})

test('the panel root states the content token size, not a fixed pixel', () => {
  const rule = block('.smPage')
  assert.match(rule, /font-size:var\(--dsh-content-font-size,14px\)/)
  assert.match(rule, /line-height:calc\(22px \+ var\(--dsh-content-font-delta,0px\)\)/)
})

test('form controls state their own size through the secondary token', () => {
  for (const selector of ['.smPlainButton', '.smPrimaryButton', '.smField']) {
    const rule = block(selector)
    assert.match(rule, /font-size:var\(--dsh-content-font-size-secondary,13px\)/, selector + ' must not inherit the root size')
  }
})

test('no fixed font-size remains in the stylesheet', () => {
  // Every size is either a content token or a deliberate delta on one.
  for (const match of css.matchAll(/font-size:([^;}]+)/g)) {
    const value = match[1]
    assert.ok(
      value.includes('--dsh-content-font-size') || value.includes('calc('),
      'font-size must be token-based, got: ' + value,
    )
  }
})

test('no fixed font-size remains in an inline style object', () => {
  assert.ok(!/fontSize:/.test(source), 'the inline style object must not state a pixel size')
})

test('no literal hex colour remains in the stylesheet', () => {
  const hexes = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
  assert.deepEqual(hexes, [], 'every colour must be a --dsw-* token')
})

test('borders use the host hairline token on a token colour', () => {
  for (const match of css.matchAll(/border:\s*([^;}]+)/g)) {
    const value = match[1]
    if (value === '0' || value === '0 0') continue
    assert.match(value, /^var\(--dsh-hairline-width,1px\) solid var\(--dsw-/, 'border must be the host hairline token on a token, got: ' + value)
  }
})

test('the page title keeps the native 20px/500/28px spec on the content delta', () => {
  const rule = block('.smPageTitle')
  assert.match(rule, /font-weight:500/)
  assert.match(rule, /font-size:calc\(20px \+ var\(--dsh-content-font-delta,0px\)\)/)
  assert.match(rule, /line-height:calc\(28px \+ var\(--dsh-content-font-delta,0px\)\)/)
})

test('the section title is 18px/600 on the content delta', () => {
  const rule = block('.smSectionTitle')
  assert.match(rule, /font-weight:600/)
  assert.match(rule, /font-size:calc\(18px \+ var\(--dsh-content-font-delta,0px\)\)/)
})

test('session menu rows keep the native 13px/400/20px spec on the secondary token', () => {
  const rule = block('.smMenuItem')
  assert.match(rule, /font-size:var\(--dsh-content-font-size-secondary,13px\)/)
  assert.match(rule, /font-weight:400/)
  assert.match(rule, /line-height:calc\(20px \+ var\(--dsh-content-font-delta-secondary,0px\)\)/)
  assert.ok(!/font: 'inherit'/.test(rule), "font: 'inherit' is what produced 16px")
})

// --- 2026-11-11 regression gate ------------------------------------------------
// The 2026-11-08 token migration (86cfb66) shipped the hairline as a `.5px`
// literal, which ignores the host's device-pixel-ratio correction. These two
// checks are deliberately blunt: they fail the build the moment a literal or a
// missing CJK wrap rule comes back, without any rendering required.

test('REGRESSION GATE: no .5px hairline literal exists in the stylesheet', () => {
  const literals = css.match(/\.5px/g) ?? []
  assert.deepEqual(
    literals,
    [],
    'hairline width must come from var(--dsh-hairline-width,1px), never a .5px literal',
  )
})

test('REGRESSION GATE: the root container keeps Korean words together', () => {
  const root = block('.smPage')
  assert.match(root, /word-break:keep-all/, 'the root must wrap on word boundaries (CJK)')
  assert.match(root, /overflow-wrap:break-word/, 'the root must still break a single long token')
})
