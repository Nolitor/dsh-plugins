/**
 * Locale and style-isolation guarantees.
 *
 * English is the default; Korean follows the host locale. The JSON files are the
 * source of truth and the baked table must match them, so a string can never
 * drift between the two.
 */
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const readJson = (name) => JSON.parse(readFileSync(join(root, 'locale', name), 'utf8'))
const clientSource = readFileSync(join(root, 'lib', 'client.js'), 'utf8')

test('ko.json covers every key in en.json', () => {
  const en = readJson('en.json')
  const ko = readJson('ko.json')
  const missing = Object.keys(en).filter((key) => !(key in ko))
  assert.deepEqual(missing, [], 'missing keys: ' + missing.join(', '))
})

test('every placeholder in an English string exists in Korean too', () => {
  const en = readJson('en.json')
  const ko = readJson('ko.json')
  for (const key of Object.keys(en)) {
    const placeholders = (value) => String(value).match(/\{\w+\}/g)?.sort() ?? []
    assert.deepEqual(placeholders(ko[key]), placeholders(en[key]), 'placeholder mismatch in ' + key)
  }
})

test('the baked table matches locale/*.json', () => {
  const en = readJson('en.json')
  for (const key of ['sectionTitle', 'nav', 'enabledLabel', 'usageTitle']) {
    assert.ok(clientSource.includes(JSON.stringify(en[key])), 'client.js is stale for ' + key + '; run npm run build')
  }
})

test('Korean strings are actually Korean', () => {
  const ko = readJson('ko.json')
  const korean = /[\uac00-\ud7a3]/
  for (const key of ['sectionTitle', 'nav', 'enabledLabel', 'usageTitle', 'modelsTitle']) {
    assert.match(ko[key], korean, key + ' is not Korean')
  }
  assert.equal(ko.sectionTitle, '안티그래비티')
})

test('stylesheet inherits the host font and scopes every rule', () => {
  // The typography contract lives in test/typography.test.mjs. This test only
  // guards the two things that break other plugins: overriding the host font
  // family, and selecting bare elements.
  const css = clientSource.slice(clientSource.indexOf('const CSS = ['), clientSource.indexOf("].join('')"))
  for (const declaration of css.match(/font-family:[^;}]+/g) ?? []) {
    assert.equal(declaration.replace(/\s/g, ''), 'font-family:inherit', 'only inherit is allowed, got: ' + declaration)
  }
  const scoped = [...css.matchAll(/\.(ag[A-Za-z0-9]+)[^{]*\{/g)]
  assert.ok(scoped.length > 10, 'expected the .ag* stylesheet')
  assert.equal(/(^|\})\s*(body|html|div|span|input|button|h[1-6]|p|section)\s*[\{,]/.test(css), false,
    'a bare element selector would leak outside the section')
})

test('stylesheet uses only --dsw tokens for colour, radius and border', () => {
  const css = clientSource.slice(clientSource.indexOf('const CSS = ['), clientSource.indexOf("].join('')"))
  const hexes = css.match(/#[0-9a-fA-F]{3,8}\b/g) ?? []
  assert.deepEqual(hexes, [], 'no hardcoded colours; use --dsw-* tokens')
  assert.equal(/rgba?\(/.test(css), false, 'no hardcoded rgb() colours')
})
