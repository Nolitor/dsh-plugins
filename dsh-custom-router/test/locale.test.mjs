/**
 * Locale parity and metadata tests for @nolit/dsh-custom-router.
 *
 * locale/*.json are the source of truth; scripts/gen-locale.mjs bakes them
 * into lib/locale-table.js and scripts/build-client.mjs bakes that table into
 * lib/client.js. These tests guard the three links in that chain.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const LOCALES = ['en', 'ko', 'zh']
const read = (path) => readFileSync(join(root, path), 'utf8')
const table = (locale) => JSON.parse(read('locale/' + locale + '.json'))

test('every locale carries every key of the English table', () => {
  const en = Object.keys(table('en'))
  assert.ok(en.length > 0)
  for (const locale of LOCALES) {
    const keys = Object.keys(table(locale))
    const missing = en.filter((key) => !keys.includes(key))
    assert.deepEqual(missing, [], locale + '.json is missing keys')
    const extra = keys.filter((key) => !en.includes(key))
    assert.deepEqual(extra, [], locale + '.json has keys English does not')
  }
})

test('no locale value is empty', () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(table(locale))) {
      if (key === 'meta') {
        assert.equal(typeof value, 'object', locale + '.meta must be an object')
        for (const field of ['title', 'description']) {
          assert.equal(typeof value[field], 'string', locale + '.meta.' + field + ' must be a string')
          assert.notEqual(value[field].trim(), '', locale + '.meta.' + field + ' must not be empty')
        }
        continue
      }
      assert.equal(typeof value, 'string', locale + '.' + key + ' must be a string')
      assert.notEqual(value.trim(), '', locale + '.' + key + ' must not be empty')
    }
  }
})

test('the display name and description are declared per locale', () => {
  assert.equal(table('en').meta.title, 'Custom Router')
  assert.equal(table('ko').meta.title, '커스텀 라우터')
  assert.equal(table('zh').meta.title, '自定义路由器')
  for (const locale of LOCALES) {
    assert.equal(typeof table(locale).meta.description, 'string')
    assert.notEqual(table(locale).meta.description.trim(), '')
  }
})

test('the package name never appears as a user-visible string', () => {
  for (const locale of LOCALES) {
    for (const [key, value] of Object.entries(table(locale))) {
      if (key === 'meta') {
        for (const field of ['title', 'description']) {
          assert.equal(value[field].includes('@nolit/dsh-custom-router'), false, locale + '.meta.' + field)
        }
        continue
      }
      assert.equal(value.includes('@nolit/dsh-custom-router'), false, locale + '.' + key)
    }
  }
})

test('the generated locale table carries all three dictionaries', async () => {
  const generated = await import(join(root, 'lib', 'locale-table.js'))
  assert.deepEqual(generated.LOCALES, LOCALES)
  for (const locale of LOCALES) {
    assert.deepEqual(Object.keys(generated.I18N[locale]).sort(), Object.keys(table('en')).sort())
  }
})

test('the built client carries the baked dictionaries and no placeholder', () => {
  const client = read('lib/client.js')
  assert.equal(client.includes('__CR_I18N__'), false, 'the placeholder must not survive the build')
  assert.match(client, /const I18N = \{/)
  for (const locale of LOCALES) {
    assert.match(client, new RegExp('"' + locale + '": \\{'))
  }
  assert.match(client, /"title": "Custom Router"/)
  assert.match(client, /"title": "커스텀 라우터"/)
  assert.match(client, /"title": "自定义路由器"/)
})

test('the generated table is in sync with the JSON sources', async () => {
  const generated = await import(join(root, 'lib', 'locale-table.js') + '?v=' + Date.now())
  for (const locale of LOCALES) {
    assert.deepEqual(generated.I18N[locale], table(locale))
  }
})
