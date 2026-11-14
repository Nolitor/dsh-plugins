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

test('the track follows the owner version and the rc.1 runtime floor', () => {
  // Owner decision 2026-11-05: every @nolit track is normalized to 0.0.1-rc.N, and rc.1 needs
  // Node >= 24.9. Both are packaging facts, so they are pinned rather than left to review.
  assert.equal(pkg.version, '0.0.1-rc.8')
  assert.equal(pkg.engines.node, '>=24.9')
  assert.equal(pkg.dsh.manifestVersion, 1)
})

test('the browser half is declared: a ./client export and the rc.1 client manifest', () => {
  assert.equal(pkg.exports['./client'].default, './lib/client.js')
  assert.equal(pkg.dsh.client.platform, 'web')
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-ui-settings'))
  assert.ok(pkg.dsh.client.inject.includes('@deepseek-ai/dsh-client-locale'))
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

test('the display title the DSH plugin inventory reads is English in en.json', () => {
  const en = JSON.parse(readFileSync(`${root}locale/en.json`, 'utf8'))
  const ko = JSON.parse(readFileSync(`${root}locale/ko.json`, 'utf8'))
  // The host reads locale/<language>.json per language, so the English file must carry an
  // English title; the Korean file keeps the Korean one. Measured before this change: en.json
  // carried the Korean title, so the English inventory showed a Korean plugin name.
  assert.equal(en.meta.title, 'TokenEconomizer (MS tokeneconomizer)')
  assert.equal(ko.meta.title, '토큰절약기(MS tokeneconomizer)')
  assert.equal(/[가-힣]/.test(en.meta.title), false, 'the English title must not be Korean')
  assert.equal(/[가-힣]/.test(ko.meta.title), true, 'the Korean title must be Korean')
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

test('the operator and statistics entry points exist', () => {
  for (const file of [
    'bin/te-dsh.mjs',
    'scripts/bootstrap.mjs',
    'lib/index.js',
    'lib/bridge.js',
    'lib/devstats.js',
    'lib/devstats-server.js',
    'lib/client.js',
  ]) {
    assert.ok(existsSync(`${root}${file}`), `${file} is missing`)
  }
})

test('the published tarball carries the history the history rule requires', () => {
  // Measured 2026-11-13: `files[]` listed lib, bin, scripts, patch, the bundle patch, README,
  // locale and docs — but not CHANGELOG.md, so `npm pack` produced 28 files with no history in
  // them. The rule (docs/RULES.md 6.1) was satisfied in the working tree and violated in the
  // artifact, the same class as F-55. A directory entry would not cover it: the file is at the
  // package root, so the entry has to name it.
  assert.ok(existsSync(`${root}CHANGELOG.md`), 'CHANGELOG.md is missing from the track')
  assert.ok(
    pkg.files.includes('CHANGELOG.md'),
    'package.json files[] must name CHANGELOG.md, or npm never ships the history',
  )
  // The same gap class applies to the readme: npm always includes it, but the entry documents
  // intent, and removing it would silently drop the file from a future pack.
  assert.ok(pkg.files.includes('README.md'), 'files[] must keep README.md')
})

test('the interrupt registry is located, never spelled into the artifact', () => {
  // The bridge used to carry `file:///home/<owner>/...` as its default. That is one workstation
  // written into a published package: an installed copy or another user resolved nothing and the
  // interrupt was silently unrecorded. The default must come from discovery.
  const bridge = readFileSync(`${root}lib/interrupt-bridge.js`, 'utf8')
  assert.doesNotMatch(
    bridge,
    /file:\/\/\/home\//,
    'no absolute home path may be hardcoded in the bridge',
  )
  assert.match(bridge, /export function interruptRootCandidates/, 'discovery is exported')
  assert.match(bridge, /export function resolveInterruptSources/, 'resolution is exported')
  assert.match(bridge, /DSH_INTERRUPT_CORE_URL/, 'the documented override still wins')
  assert.match(bridge, /DSH_INTERRUPT_ROOT/, 'a checkout root can be named explicitly')
})
