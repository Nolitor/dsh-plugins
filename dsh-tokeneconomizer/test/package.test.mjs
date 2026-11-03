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

test('the side call keeps its Session inside the throwaway directory', () => {
  // Regression guard, measured 2026-11-03: a side call that let DSH persist at its default
  // root left one permanent session directory per call under ~/.dsh/sessions/--tmp-te-side-*,
  // at a cwd TemporaryDirectory had already deleted -- 119 of 130 session directories, nearly
  // all of them the loop guard's judge. The fix re-roots session-persistence-jsonl per call.
  assert.ok(patch.includes('--patch'), 'the side call does not pass its overlay')

  const hunk = patch.slice(patch.indexOf('def dsh_call('))
  // Both stores leak independently: the Session log (sessions/) and the per-session
  // projection-cache row (storages/) are written at the persistence roots.
  // Match the executable tuple, not the prose: the docstring also names both ids, so a
  // loose match would pass even with the writes removed (measured: it did).
  assert.match(hunk, /\("session-persistence-jsonl", "sessions"\)/,
    'dsh_call does not re-root persistence')
  assert.match(hunk, /\("storage-json", "storages"\)/,
    'dsh_call does not re-root the projection cache')
  assert.match(hunk, /TemporaryDirectory/, 'dsh_call lost its throwaway directory')
})

test('the operator entry points exist', () => {
  for (const file of ['bin/te-dsh.mjs', 'scripts/bootstrap.mjs', 'lib/index.js', 'lib/bridge.js']) {
    assert.ok(existsSync(`${root}${file}`), `${file} is missing`)
  }
})
