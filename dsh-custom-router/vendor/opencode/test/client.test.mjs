/**
 * Contract tests for the browser half (`lib/client.js`).
 *
 * The client is served to the browser as-is and is never imported by the host, so
 * nothing else would catch a class name that the stylesheet does not define, an
 * i18n key missing from one language, or a reintroduced hardcoded colour that
 * breaks dark mode and the native settings theme.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

const SRC = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')

/** The injected stylesheet, parsed back out of the module. */
function stylesheet() {
  const match = SRC.match(/const CSS = ("(?:[^"\\]|\\.)*")/)
  assert.ok(match, 'the client must define its stylesheet as a single CSS constant')
  return JSON.parse(match[1])
}

test('the stylesheet is injected through one data-plugin-css tag', () => {
  assert.match(SRC, /data-plugin-css/, 'the tag id keeps a reload from duplicating the stylesheet')
  assert.match(SRC, /document\.head\.appendChild/, 'the stylesheet must actually be mounted')
  assert.match(SRC, /querySelector\('style\[data-plugin-css=/, 'it must check before injecting')
})

test('every class the view uses is defined by the stylesheet', () => {
  const css = stylesheet()
  const defined = new Set([...css.matchAll(/\.([a-zA-Z][a-zA-Z0-9]*)/g)].map((m) => m[1]))
  const used = new Set()
  for (const match of SRC.matchAll(/className: '([^']+)'/g)) {
    for (const name of match[1].split(/\s+/)) used.add(name)
  }
  const missing = [...used].filter((name) => name && !defined.has(name))
  assert.deepEqual(missing, [], 'a class used by the view must exist in the stylesheet')
})

test('the view uses the native design tokens and no hardcoded colours', () => {
  const css = stylesheet()
  const view = SRC.slice(SRC.indexOf('function OpenCodeModelSection'))
  const literals = (text) => (text.match(/rgba?\(|#[0-9a-fA-F]{3,8}\b/g) ?? [])
  assert.deepEqual(literals(css), [], 'the stylesheet must be themed through --dsw-* tokens')
  assert.deepEqual(literals(view), [], 'the view must not inline colours')
  const tokens = new Set([...css.matchAll(/var\(--dsw-[a-z0-9-]+\)/g)].map((m) => m[0]))
  assert.ok(tokens.size >= 8, 'cards, borders, labels and radii all come from tokens')
})

test('Korean and English dictionaries define the same keys', () => {
  const koStart = SRC.indexOf('      ko: {')
  const enStart = SRC.indexOf('      en: {')
  const end = SRC.indexOf('// ===== I18N END')
  const keysIn = (block) => new Set([...block.matchAll(/^\s+([a-zA-Z][a-zA-Z0-9]*):\s+'/gm)].map((m) => m[1]))
  const ko = keysIn(SRC.slice(koStart, enStart))
  const en = keysIn(SRC.slice(enStart, end))
  assert.ok(ko.size > 20, 'the dictionary is the source of truth for the tab')
  assert.deepEqual([...ko].sort(), [...en].sort(), 'both languages must stay in parity')
})

test('every t() key the view calls exists in both dictionaries', () => {
  const koStart = SRC.indexOf('      ko: {')
  const enStart = SRC.indexOf('      en: {')
  const end = SRC.indexOf('// ===== I18N END')
  const keysIn = (block) => new Set([...block.matchAll(/^\s+([a-zA-Z][a-zA-Z0-9]*):\s+'/gm)].map((m) => m[1]))
  const ko = keysIn(SRC.slice(koStart, enStart))
  const en = keysIn(SRC.slice(enStart, end))
  const called = new Set([...SRC.matchAll(/\bt\('([a-zA-Z]+)'/g)].map((m) => m[1]))
  called.delete('style')
  assert.deepEqual([...called].filter((key) => !ko.has(key)), [], 'no Korean gap')
  assert.deepEqual([...called].filter((key) => !en.has(key)), [], 'no English gap')
})

test('the panel still registers exactly one settings section', () => {
  assert.equal((SRC.match(/name: 'settings\.section'/g) ?? []).length, 1)
  assert.match(SRC, /id: 'opencode-v2'/)
  assert.match(SRC, /order: 60/)
  assert.deepEqual(JSON.parse(JSON.stringify([...SRC.matchAll(/const inject = (\[[^\]]*\])/g)].map((m) => m[1]))), ["['slots', 'locale']"])
})
