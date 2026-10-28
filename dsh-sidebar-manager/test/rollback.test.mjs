/**
 * Regression test for audit finding L4: rollback used to restore workspace.json
 * WHOLESALE, silently erasing any workspace registered after the backup.
 * Record-level rollback must preserve concurrent registrations.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { resolveOptions, backupWorkspaceRecords, restoreWorkspaceRecords } from '../lib/transaction.mjs'

function makeHome() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rollback-test-'))
  const options = resolveOptions({
    dshHome: path.join(root, 'dsh-home'),
    backupDir: path.join(root, 'backup'),
    stateDir: path.join(root, 'state'),
    projectsRoot: path.join(root, 'projects'),
  })
  if (path.resolve(options.dshHome) === path.resolve(os.homedir(), '.dsh')) {
    throw new Error('refusing to run against the live ~/.dsh')
  }
  fs.mkdirSync(path.join(options.dshHome, 'storages'), { recursive: true })
  return { root, options }
}

function writeWorkspaceFile(options, document) {
  const file = path.join(options.dshHome, 'storages', 'workspace.json')
  fs.writeFileSync(file, `${JSON.stringify(document, null, 2)}\n`)
}

function readWorkspaceFile(options) {
  return JSON.parse(fs.readFileSync(path.join(options.dshHome, 'storages', 'workspace.json'), 'utf8'))
}

const baseDocument = () => ({
  unit: { name: 'workspace', version: 2 },
  global: { initialized: true, defaultWorkspaceId: 'ws-default', workspaceIds: ['ws-default', 'ws-a'], archivedSessionIds: [] },
  tables: {
    workspaces: {
      'ws-default': { path: '/p/default', title: 'Default', sessionIds: [] },
      'ws-a': { path: '/p/A', title: 'A-00-Core', sessionIds: ['s1'] },
    },
  },
})

test('rollback preserves a workspace registered after the backup', () => {
  const { options } = makeHome()
  writeWorkspaceFile(options, baseDocument())
  const backupDir = path.join(options.backupDir, 'tx1')
  backupWorkspaceRecords(options, backupDir, { workspaceIds: ['ws-a'] })

  // Concurrent change: a new workspace is registered while the tx is in flight,
  // and ws-a is mutated as part of the failing transaction.
  const during = readWorkspaceFile(options)
  during.tables.workspaces['ws-concurrent'] = { path: '/p/Concurrent', title: 'C', sessionIds: [] }
  during.global.workspaceIds.push('ws-concurrent')
  during.tables.workspaces['ws-a'] = { path: '/p/A-renamed', title: 'A-01-Core', sessionIds: ['s1'] }
  writeWorkspaceFile(options, during)

  const result = restoreWorkspaceRecords(options, backupDir)
  const after = readWorkspaceFile(options)

  assert.ok(after.tables.workspaces['ws-concurrent'], 'concurrent workspace must survive rollback')
  assert.ok(after.global.workspaceIds.includes('ws-concurrent'), 'order must keep concurrent entries')
  assert.deepEqual(after.tables.workspaces['ws-a'], baseDocument().tables.workspaces['ws-a'], 'txed record is restored')
  assert.deepEqual(result.restored, ['ws-a'])
})

test('rollback restores a record deleted during the transaction', () => {
  const { options } = makeHome()
  writeWorkspaceFile(options, baseDocument())
  const backupDir = path.join(options.backupDir, 'tx2')
  backupWorkspaceRecords(options, backupDir, { workspaceIds: ['ws-a'] })

  const during = readWorkspaceFile(options)
  delete during.tables.workspaces['ws-a']
  during.global.workspaceIds = during.global.workspaceIds.filter((id) => id !== 'ws-a')
  writeWorkspaceFile(options, during)

  restoreWorkspaceRecords(options, backupDir)
  const after = readWorkspaceFile(options)
  assert.ok(after.tables.workspaces['ws-a'], 'deleted record must be re-created')
  assert.ok(after.global.workspaceIds.includes('ws-a'), 'order entry must be restored')
})

test('rollback leaves untouched records byte-identical', () => {
  const { options } = makeHome()
  writeWorkspaceFile(options, baseDocument())
  const before = readWorkspaceFile(options)
  const backupDir = path.join(options.backupDir, 'tx3')
  backupWorkspaceRecords(options, backupDir, { workspaceIds: ['ws-a'] })
  restoreWorkspaceRecords(options, backupDir)
  const after = readWorkspaceFile(options)
  assert.deepEqual(after, before)
})

test('a snapshot of a different workspace never clobbers the target record', () => {
  const { options } = makeHome()
  writeWorkspaceFile(options, baseDocument())
  const backupDir = path.join(options.backupDir, 'tx4')
  backupWorkspaceRecords(options, backupDir, { workspaceIds: ['ws-default'] })
  const during = readWorkspaceFile(options)
  during.tables.workspaces['ws-a'].title = 'Changed by another tx'
  writeWorkspaceFile(options, during)
  restoreWorkspaceRecords(options, backupDir)
  const after = readWorkspaceFile(options)
  assert.equal(after.tables.workspaces['ws-a'].title, 'Changed by another tx', 'unrelated record untouched')
})

test('missing snapshot is a no-op, not a crash', () => {
  const { options } = makeHome()
  writeWorkspaceFile(options, baseDocument())
  const result = restoreWorkspaceRecords(options, path.join(options.backupDir, 'nope'))
  assert.ok(result.skipped.includes('no-snapshot'))
  assert.deepEqual(readWorkspaceFile(options), baseDocument())
})
