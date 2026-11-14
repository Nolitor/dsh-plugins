/**
 * The two-value identity model: an immutable `projectDir` anchor from the session header, and a
 * mutable `liveDir` from `working-directory/change`. Every state root here is a temporary directory,
 * so the real `~/.tokeneconomizer` is never touched.
 */
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'

import {
  IDENTITY_SCHEMA_VERSION,
  adoptLegacyKey,
  identityKeyOf,
  readIdentity,
  resolveIdentity,
  writeIdentity,
} from '../lib/identity.js'
import { LEGACY_REPO_KEY_SOURCE, repoKeyOf } from '../lib/repokey-bridge.js'

/**
 * A fresh state root under the platform temporary directory.
 * @returns {string} the state root.
 */
function stateHome() {
  return mkdtempSync(join(tmpdir(), 'te-identity-state-'))
}

/**
 * Whether real `git` is usable here, so the repository tests can skip instead of failing falsely.
 * @returns {boolean} true when `git --version` runs.
 */
function hasGit() {
  try {
    execFileSync('git', ['--version'], { stdio: 'ignore' })
    return true
  } catch {
    return false
  }
}

/**
 * Environment that keeps the temporary repositories independent of the developer's git settings.
 * @returns {Record<string, string>} the environment.
 */
function gitEnv() {
  return {
    ...process.env,
    GIT_AUTHOR_NAME: 'TokenEconomizer Test',
    GIT_AUTHOR_EMAIL: 'test@example.invalid',
    GIT_COMMITTER_NAME: 'TokenEconomizer Test',
    GIT_COMMITTER_EMAIL: 'test@example.invalid',
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_CEILING_DIRECTORIES: tmpdir(),
  }
}

/**
 * Create a real git repository with one commit.
 * @param {string} [remote] - an `origin` URL to record.
 * @returns {string} the repository root.
 */
function makeRepo(remote) {
  const root = mkdtempSync(join(tmpdir(), 'te-identity-repo-'))
  const env = gitEnv()
  execFileSync('git', ['init', '-q'], { cwd: root, env, stdio: 'ignore' })
  writeFileSync(join(root, 'README.md'), '# fixture\n', 'utf8')
  execFileSync('git', ['add', '.'], { cwd: root, env, stdio: 'ignore' })
  execFileSync('git', ['commit', '-q', '-m', 'fixture'], { cwd: root, env, stdio: 'ignore' })
  if (remote) execFileSync('git', ['remote', 'add', 'origin', remote], { cwd: root, env, stdio: 'ignore' })
  return root
}

test('identity resolves once and returns the persisted record verbatim', () => {
  const state = stateHome()
  const project = mkdtempSync(join(tmpdir(), 'te-identity-plain-'))
  const stored = {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    identityKey: 'anchor-key',
    projectDir: project,
    liveDir: project,
    resolvedBy: 'git-remote',
    engineRepoKey: 'anchor-key',
    parentSession: 'parent-1',
    delegationDepth: 2,
    moved: false,
    unanchored: false,
    time: 1,
  }
  writeIdentity(state, stored)
  const records = new Map([[stored.identityKey, readIdentity(state, stored.identityKey)]])
  const record = resolveIdentity({ cwd: project }, join(project, 'elsewhere'), records, {
    env: gitEnv(),
    identityKey: 'anchor-key',
    time: 2,
  })
  assert.equal(record.resolvedBy, 'persisted')
  assert.equal(record.identityKey, 'anchor-key')
  assert.equal(record.parentSession, 'parent-1')
  assert.equal(record.engineRepoKey, 'anchor-key')
  assert.equal(record.projectDir, project)
  assert.equal(record.liveDir, join(project, 'elsewhere'))
  assert.equal(record.time, 2)
})

test('subdirectory session anchors at repo root', t => {
  if (!hasGit()) {
    t.skip('git is unavailable in this test environment')
    return
  }
  const root = makeRepo('git@example.invalid:Owner/Repo.git')
  const nested = join(root, 'packages', 'inner')
  mkdirSync(nested, { recursive: true })
  const record = resolveIdentity({ cwd: nested }, nested, new Map(), { env: gitEnv() })
  assert.equal(record.projectDir, root)
  assert.equal(record.resolvedBy, 'git-remote')
  assert.equal(record.moved, false)
  assert.equal(record.unanchored, false)
  assert.equal(record.engineRepoKey, repoKeyOf(root, gitEnv()))
})

test('rename re-adopts under new path with moved:true', t => {
  if (!hasGit()) {
    t.skip('git is unavailable in this test environment')
    return
  }
  const root = makeRepo()
  const state = stateHome()
  const first = resolveIdentity({ cwd: root }, root, new Map(), { env: gitEnv() })
  assert.equal(first.moved, false)
  writeIdentity(state, first)
  const previous = readIdentity(state, first.identityKey)
  assert.ok(previous)

  const movedTo = `${root}-renamed`
  renameSync(root, movedTo)
  const records = new Map([[previous.identityKey, previous]])
  const second = resolveIdentity({ cwd: movedTo }, movedTo, records, {
    env: gitEnv(),
    identityKey: previous.identityKey,
  })
  assert.equal(second.moved, true)
  assert.equal(second.previousProjectDir, root)
  assert.equal(second.projectDir, movedTo)
  assert.match(second.warning, /project moved/)
})

test('unanchored when the header has no cwd', () => {
  const record = resolveIdentity({}, '/tmp', new Map(), { env: gitEnv() })
  assert.equal(record.identityKey, null)
  assert.equal(record.projectDir, null)
  assert.equal(record.resolvedBy, 'unanchored')
  assert.equal(record.unanchored, true)
  assert.equal(identityKeyOf(record), null)
  assert.equal(record.engineRepoKey, null)
  assert.match(record.warning, /no cwd/)
})

test('writes and reads back the persisted record', () => {
  const state = stateHome()
  const project = mkdtempSync(join(tmpdir(), 'te-identity-write-'))
  const record = {
    schemaVersion: IDENTITY_SCHEMA_VERSION,
    identityKey: 'write-key',
    projectDir: project,
    liveDir: project,
    resolvedBy: 'dir',
    engineRepoKey: 'write-key',
    parentSession: null,
    delegationDepth: 0,
    moved: false,
    unanchored: false,
    time: 7,
  }
  const path = writeIdentity(state, record)
  assert.equal(path, join(state, 'identities', 'write-key.json'))
  assert.deepEqual(JSON.parse(readFileSync(path, 'utf8')), record)
  assert.deepEqual(readIdentity(state, 'write-key'), record)
  assert.equal(readIdentity(state, 'missing-key'), null)
  assert.equal(writeIdentity(state, { ...record, identityKey: null }), null)
})

test('adoption shim records the legacy key', () => {
  const state = stateHome()
  const key = 'legacy-owner-key'
  const path = adoptLegacyKey(state, key, 'dsh-plugins-4806902e1d')
  assert.equal(path, join(state, 'identities', `${key}.json`))
  const record = readIdentity(state, key)
  assert.deepEqual(record.legacyKeys, ['dsh-plugins-4806902e1d'])
  adoptLegacyKey(state, key, 'other-key')
  adoptLegacyKey(state, key, 'dsh-plugins-4806902e1d')
  assert.deepEqual(readIdentity(state, key).legacyKeys, ['dsh-plugins-4806902e1d', 'other-key'])
  assert.equal(LEGACY_REPO_KEY_SOURCE, 'lib/repokey.js:236')
})
