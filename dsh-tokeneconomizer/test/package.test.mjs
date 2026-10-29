/**
 * Package identity and packaging contract: the plugin name the loader reports is the one the
 * bundle row mounts, the engine window matches the running generation, and the patch this
 * package ships is the DSH host adapter.
 */
import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { test } from 'node:test'

const root = new URL('..', import.meta.url).pathname
const pkg = JSON.parse(readFileSync(`${root}package.json`, 'utf8'))
const patch = readFileSync(`${root}patch/0001-add-dsh-host.patch`, 'utf8')
const bundle = readFileSync(`${root}cordis.patch.yml`, 'utf8')

test('package name is the track identity', () => {
  assert.equal(pkg.name, '@nolit/dsh-tokeneconomizer')
})

test('the running DSH prerelease is inside the declared window', () => {
  assert.match(pkg.engines.dsh, /^>=0\.2\.2-alpha\.2 <0\.3\.0$/)
})

test('the bundle row mounts the plugin under its exported name', () => {
  assert.match(bundle, /id: tokeneconomizer-dsh/)
  assert.match(bundle, /name: '@nolit\/dsh-tokeneconomizer'/)
})

test('the shipped patch carries the DSH host, reader, side call and bridge commands', () => {
  for (const needed of [
    'tokeneconomizer/trace/dsh.py',
    'class DSH(Host)',
    'def dsh_call(',
    'def cmd_dsh_session(',
    'def cmd_dsh_import(',
  ]) {
    assert.ok(patch.includes(needed), `patch is missing ${needed}`)
  }
})

test('every hook call hands the bridge its launcher pair, not a bare path', () => {
  const index = readFileSync(`${root}lib/index.js`, 'utf8')
  assert.doesNotMatch(index, /\bhook\(bins\.hook/)
  assert.doesNotMatch(index, /\bhook\(bins\.te/)
})

test('the display title the DSH plugin inventory reads is the Korean title', () => {
  const en = JSON.parse(readFileSync(`${root}locale/en.json`, 'utf8'))
  const ko = JSON.parse(readFileSync(`${root}locale/ko.json`, 'utf8'))
  assert.equal(en.meta.title, '토큰절약기(MS tokeneconomizer)')
  assert.equal(ko.meta.title, en.meta.title)
  assert.equal(pkg.exports['./locale/en.json'], './locale/en.json')
  assert.equal(pkg.exports['./locale/ko.json'], './locale/ko.json')
  assert.ok(pkg.files.includes('locale/'))
})

test('the operator entry points exist', () => {
  for (const file of ['bin/te-dsh.mjs', 'scripts/bootstrap.mjs', 'lib/index.js', 'lib/bridge.js']) {
    assert.ok(existsSync(`${root}${file}`), `${file} is missing`)
  }
})
