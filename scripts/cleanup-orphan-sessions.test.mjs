/**
 * Tests for scripts/cleanup-orphan-sessions.mjs against a synthetic DSH_HOME.
 *
 * The real cleanup runs against the owner's home and is dry-run only here, so the
 * classification and the quarantine move are proven on a fixture: bound/subagent/
 * real-project/unreadable logs are KEEP, a /tmp log whose cwd is gone is REMOVE, and
 * apply moves exactly that one into `quarantine-backups` (never deletes).
 *
 * Run: node --test scripts/cleanup-orphan-sessions.test.mjs
 */
import assert from 'node:assert/strict'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { test } from 'node:test'
import zlib from 'node:zlib'

import { applyPlan, buildPlan } from './cleanup-orphan-sessions.mjs'
import { encodeSegment, projectKey } from '../dsh-sidebar-manager/lib/session-log.mjs'

/** One synthetic session log whose header frame is exactly one JSONL line. */
function writeLog(home, cwd, id, header = {}) {
  const dir = join(home, 'sessions', projectKey(cwd), encodeSegment(id))
  mkdirSync(dir, { recursive: true })
  const line = JSON.stringify({ id, version: 4, createdAt: Date.now(), cwd, ...header }) + '\n'
  writeFileSync(join(dir, 'session.v4.jsonl.zstd'), zlib.zstdCompressSync(Buffer.from(line, 'utf8')))
}

/** Build a DSH home with one log of every class. */
function buildFixture() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-cleanup-fixture-'))
  const home = join(root, 'home')
  mkdirSync(join(home, 'storages'), { recursive: true })
  const liveCwd = join(root, 'project')
  mkdirSync(liveCwd, { recursive: true })
  const tmpAlive = mkdtempSync(join(tmpdir(), 'dsh-cleanup-alive-'))
  writeLog(home, join(tmpdir(), 'dsh-cleanup-gone-' + Date.now()), 'session-gone', { title: 'tmp gone' })
  writeLog(home, tmpAlive, 'session-tmp-alive', { title: 'tmp alive' })
  writeLog(home, liveCwd, 'session-real', { title: 'real' })
  writeLog(home, liveCwd, 'session-sub', { title: 'sub', parentSession: 'session-parent' })
  writeLog(home, liveCwd, 'session-bound', { title: 'bound' })
  mkdirSync(join(home, 'sessions', 'broken', 'session-broken'), { recursive: true })
  writeFileSync(join(home, 'sessions', 'broken', 'session-broken', 'session.v4.jsonl.zstd'), 'not zstd')
  writeFileSync(join(home, 'storages', 'workspace.json'), JSON.stringify({
    unit: { name: 'workspace', version: 2 },
    global: { workspaceIds: ['w1'] },
    tables: { workspaces: { w1: { path: liveCwd, title: 'fixture', sessionIds: ['session-bound'] } } },
  }, null, 2))
  return {
    root,
    home,
    liveCwd,
    dispose() {
      rmSync(root, { recursive: true, force: true })
      rmSync(tmpAlive, { recursive: true, force: true })
    },
  }
}

test('only a tmp-test log whose cwd is gone is a removal candidate', (t) => {
  const fixture = buildFixture()
  t.after(() => fixture.dispose())
  const plan = buildPlan({ home: fixture.home })
  assert.equal(plan.logs, 6)
  assert.equal(plan.candidates, 5, 'the bound log is not a candidate')
  assert.equal(plan.counts.remove, 1)
  assert.equal(plan.counts.keepChildren, 1)
  assert.equal(plan.counts.keepReal, 2)
  assert.equal(plan.counts.keepUnreadable, 1)
  assert.deepEqual(plan.rows.filter((row) => row.verdict === 'REMOVE').map((row) => row.sessionId), ['session-gone'])
  assert.match(plan.digest, /^[0-9a-f]{16}$/)
})

test('a directory that is not a DSH home is refused', () => {
  const root = mkdtempSync(join(tmpdir(), 'dsh-cleanup-notahome-'))
  try {
    assert.throws(() => buildPlan({ home: root }), /not a DSH home/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test('apply moves only the candidate into quarantine and keeps every other log', (t) => {
  const fixture = buildFixture()
  t.after(() => fixture.dispose())
  const plan = buildPlan({ home: fixture.home })
  const result = applyPlan(plan)
  assert.equal(result.moved, 1)
  assert.ok(result.backupDir && existsSync(result.backupDir), 'quarantine directory must exist')
  // The moved log is in quarantine, not deleted.
  assert.equal(existsSync(join(result.backupDir, 'sessions', '--tmp-dsh-cleanup-gone--', 'session-gone', 'session.v4.jsonl.zstd')) ||
    readdirSync(join(result.backupDir, 'sessions')).length === 1, true)
  const kept = readdirSync(join(fixture.home, 'sessions'), { recursive: true })
    .filter((name) => String(name).endsWith('session.v4.jsonl.zstd'))
  assert.equal(kept.length, 5, 'all KEEP logs remain')
  assert.ok(existsSync(join(result.backupDir, 'workspace.json')), 'registry snapshot is backed up')
  const after = buildPlan({ home: fixture.home })
  assert.equal(after.counts.remove, 0, 're-measure finds nothing left to remove')
  assert.equal(after.logs, 5)
})
