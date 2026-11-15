/**
 * The two contracts added 2026-11-13 that a packaged copy has to keep.
 *
 * 1. The interrupt registry is found, not hardcoded. The bridge used to carry the owner's
 *    absolute `file:///home/minami/...` URL as its only default, so an installed copy recorded
 *    nothing and said so nowhere.
 * 2. `dsh-te update --check` answers "is the pin still the branch head?" without fetching,
 *    without writing, and without hanging on a credential prompt.
 *
 * Both are tested against synthetic checkouts and a local bare repository, so neither needs the
 * network, the owner's home layout, or the live state root.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import { interruptRootCandidates, resolveInterruptSources } from '../lib/interrupt-bridge.js'
import { localDistance, remoteHead } from '../bin/dsh-te.mjs'

/** A throwaway directory that is removed when the test's scope ends. */
function scratch(t) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-te-paths-'))
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  return dir
}

/**
 * Materialize a fake registry checkout.
 * @param {string} root - directory to write under.
 * @returns {string} the root.
 */
function fakeRegistry(root) {
  mkdirSync(join(root, 'src'), { recursive: true })
  writeFileSync(join(root, 'src', 'interrupt-core.js'), 'export const interrupts = { requestInterrupt: () => true, snapshot: () => ({ reason: \'x\' }) }\n')
  writeFileSync(join(root, 'src', 'reasons.js'), 'export const interruptIssuer = () => \'issuer\'\nexport const interruptSkipWording = () => \'wording\'\n')
  return root
}

test('an explicit DSH_INTERRUPT_ROOT is searched before any convention', (t) => {
  const root = fakeRegistry(join(scratch(t), 'checkout'))
  const sources = resolveInterruptSources({ env: { DSH_INTERRUPT_ROOT: root, HOME: '/nonexistent' } })
  assert.equal(sources.found, true)
  assert.equal(sources.root, root)
  assert.match(sources.coreUrl, /^file:\/\/.*interrupt-core\.js$/)
  assert.match(sources.reasonsUrl, /^file:\/\/.*reasons\.js$/)
})

test('the explicit module URLs still win, pair or not', (t) => {
  const root = fakeRegistry(join(scratch(t), 'checkout'))
  const paired = resolveInterruptSources({
    env: {},
    coreUrl: `file://${join(root, 'src', 'interrupt-core.js')}`,
    reasonsUrl: `file://${join(root, 'src', 'reasons.js')}`,
  })
  assert.equal(paired.found, true)
  assert.equal(paired.root, null, 'an explicit pair is not attributed to a discovered root')

  // Half a pair must not silently borrow the other half from a discovered checkout: that would
  // mix two versions of the contract.
  const half = resolveInterruptSources({ env: {}, coreUrl: `file://${join(root, 'src', 'interrupt-core.js')}` })
  assert.equal(half.found, false)
  assert.equal(half.reasonsUrl, '')
  assert.match(String(half.detail), /only one of the two/)
})

test('no checkout anywhere resolves to an unloaded recorder, not a throw', (t) => {
  // The roots are replaced outright: this machine HAS a real sibling checkout, so a discovery
  // run here would find it and the test would pass for the wrong reason. Only the empty case is
  // under test — no checkout, no throw, an explicit reason.
  const empty = join(scratch(t), 'nothing-here')
  const sources = resolveInterruptSources({ env: {}, roots: [empty] })
  assert.equal(sources.found, false)
  assert.equal(sources.coreUrl, '')
  assert.equal(sources.reasonsUrl, '')
  assert.match(String(sources.detail), /no interrupt registry checkout/)

  // And the real discovery on this machine is either a complete pair or nothing: never half.
  const live = resolveInterruptSources({ env: {} })
  assert.equal(live.found, Boolean(live.coreUrl && live.reasonsUrl))
})

test('the candidate list is deduplicated and ends at the conventional home layout', () => {
  const env = { DSH_INTERRUPT_ROOT: '/tmp/one', HOME: '/home/somebody' }
  const candidates = interruptRootCandidates(env)
  assert.equal(candidates[0], '/tmp/one')
  assert.ok(candidates.includes(join('/home/somebody', 'Workspace', 'projects', 'total_skill')))
  assert.equal(new Set(candidates).size, candidates.length, 'no candidate is repeated')
})

test('a shipped source file carries no absolute home path', async () => {
  // The regression this guards is measurable: the previous default spelled one owner's home
  // into the package. Measured over the shipped sources only — tests and docs may quote it.
  const { readFileSync } = await import('node:fs')
  for (const file of ['lib/interrupt-bridge.js', 'bin/dsh-te.mjs', 'scripts/bootstrap.mjs']) {
    const text = readFileSync(new URL(`../${file}`, import.meta.url), 'utf8')
    assert.ok(!text.includes('file:///home/'), `${file} still carries an absolute home path`)
  }
})

/** A local bare repository with one commit on `main`, so `ls-remote` needs no network. */
function bareRepo(t) {
  const dir = scratch(t)
  const work = join(dir, 'work')
  const bare = join(dir, 'remote.git')
  mkdirSync(work, { recursive: true })
  const git = (args, cwd) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
  git(['init', '--quiet', '--initial-branch=main'], work)
  git(['config', 'user.email', 't@example.invalid'], work)
  git(['config', 'user.name', 'test'], work)
  writeFileSync(join(work, 'README.md'), 'one\n')
  git(['add', '.'], work)
  git(['commit', '--quiet', '-m', 'one'], work)
  git(['clone', '--quiet', '--bare', work, bare], dir)
  return { bare, work, sha: git(['rev-parse', 'HEAD'], work), git }
}

test('remoteHead reads a real branch head from a local remote', (t) => {
  const { bare, sha } = bareRepo(t)
  const answer = remoteHead({ remote: bare, branch: 'main' })
  assert.equal(answer.ok, true)
  assert.equal(answer.sha, sha)
})

test('remoteHead reports a missing ref instead of inventing one', (t) => {
  const { bare } = bareRepo(t)
  const answer = remoteHead({ remote: bare, branch: 'no-such-branch' })
  assert.equal(answer.ok, false)
  assert.match(String(answer.detail), /no refs\/heads\/no-such-branch/)
})

test('remoteHead turns an unreachable remote into a value, never an exception', () => {
  // A file: URL that does not exist is the offline case with no network and no timeout cost.
  const answer = remoteHead({ remote: '/nonexistent/nope.git', branch: 'main' })
  assert.equal(answer.ok, false)
  assert.ok(answer.detail.length > 0)
})

test('localDistance counts how far a pin trails the head it can see', (t) => {
  const { work, sha, git } = bareRepo(t)
  writeFileSync(join(work, 'README.md'), 'two\n')
  git(['commit', '--quiet', '-am', 'two'], work)
  const head = git(['rev-parse', 'HEAD'], work)
  const ahead = localDistance(work, sha, head)
  assert.equal(ahead.behind, 1)
  const same = localDistance(work, head, head)
  assert.equal(same.behind, 0)
})

test('localDistance says unknown, not zero, when the checkout lacks a commit', (t) => {
  const { work } = bareRepo(t)
  const answer = localDistance(work, 'f'.repeat(40), '0'.repeat(40))
  assert.equal(answer.behind, null)
  assert.match(String(answer.detail), /does not hold/)
  const missing = localDistance(join(work, 'nope'), 'a'.repeat(40), 'b'.repeat(40))
  assert.equal(missing.behind, null)
  assert.equal(missing.detail, 'no vendored checkout')
})
