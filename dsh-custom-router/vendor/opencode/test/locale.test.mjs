import assert from 'node:assert/strict'
import { test } from 'node:test'
import { readFileSync } from 'node:fs'

const root = new URL('..', import.meta.url)
const read = (path) => readFileSync(new URL(path, root), 'utf8')

test('the plugin card is localised: English default plus Korean', () => {
  const en = JSON.parse(read('locale/en.json'))
  const ko = JSON.parse(read('locale/ko.json'))
  assert.equal(en.meta.title, 'Opencode v2 Agent')
  assert.ok(en.meta.description.length > 20)
  assert.equal(ko.meta.title, '오픈코드 v2 에이전트')
  assert.match(ko.meta.description, /어댑터|서브에이전트/)
  assert.notEqual(en.meta.title, ko.meta.title, 'Korean must not fall back to the English title')
})

test('the browser half carries both language tables and the locale service', () => {
  const client = read('lib/client.js')
  assert.match(client, /nav: '오픈코드 V2'/)
  assert.match(client, /nav: 'OpenCode V2'/)
  assert.match(client, /const inject = \[['"]slots['"], ['"]locale['"]\]/)
  assert.match(client, /ctx\.locale\?\.getSnapshot/)
})
