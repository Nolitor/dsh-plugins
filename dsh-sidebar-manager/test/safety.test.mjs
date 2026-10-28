/**
 * Phase 1-3 safety tests: record-level rollback, groups.json registry,
 * batch rename validation. Everything runs in a throwaway temp DSH home.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveOptions } from '../lib/transaction.mjs'
import {
  readGroups,
  writeGroups,
  validateDocument,
  upsertGroup,
  assignMember,
  resolveMember,
  repointWorkspace,
  refreshFingerprint,
  buildGroupedView,
  removeMember,
  GROUPS_UNIT,
} from '../lib/groups.mjs'
import { validateBatchRename, auditSessionBindings, validateSegment, parseGroupedName } from '../lib/batch-validate.mjs'

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'safety-test-'))
  fs.mkdirSync(path.join(root, 'projects'), { recursive: true })
  const options = resolveOptions({
    dshHome: path.join(root, 'dsh-home'),
    backupDir: path.join(root, 'backup'),
    stateDir: path.join(root, 'state'),
    projectsRoot: path.join(root, 'projects'),
  })
  if (path.resolve(options.dshHome) === path.resolve(os.homedir(), '.dsh')) {
    throw new Error('refusing to run against the live ~/.dsh')
  }
  fs.mkdirSync(options.dshHome, { recursive: true })
  fs.mkdirSync(options.stateDir, { recursive: true })
  return { root, options }
}

// --- groups.json schema -----------------------------------------------------

test('groups: absent file yields an empty, valid document', () => {
  const { options } = makeRoot()
  const result = readGroups(options)
  assert.equal(result.status, 'absent')
  assert.deepEqual(result.problems, [])
  assert.deepEqual(result.document.groups, [])
  assert.deepEqual(result.document.members, {})
})

test('groups: write is atomic and round-trips', () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'g-dsh', label: 'DSH', order: 0, index: '00' })
  const { document, status } = readGroups(options)
  assert.equal(status, 'ok')
  assert.equal(document.unit.name, GROUPS_UNIT.name)
  assert.equal(document.groups.length, 1)
  const leftovers = fs.readdirSync(options.stateDir).filter((name) => name.includes('.tmp-'))
  assert.deepEqual(leftovers, [], 'no temp files should remain')
})

test('groups: invalid documents are refused on write', () => {
  const { options } = makeRoot()
  assert.throws(() => writeGroups(options, { unit: { name: 'x', version: 9 }, groups: [], members: {} }), /invalid/i)
})

test('groups: validateDocument catches duplicate group ids and unknown member groups', () => {
  const problems = validateDocument({
    unit: { ...GROUPS_UNIT },
    groups: [
      { groupId: 'g', label: 'G', order: 0 },
      { groupId: 'g', label: 'G2', order: 1 },
    ],
    members: { ws1: { groupId: 'missing' } },
  })
  assert.ok(problems.some((p) => p.includes('duplicate')))
  assert.ok(problems.some((p) => p.includes('member-group-unknown')))
})

test('groups: corrupt file degrades to empty rather than throwing', () => {
  const { options } = makeRoot()
  fs.writeFileSync(path.join(options.stateDir, 'groups.json'), '{not json')
  const result = readGroups(options)
  assert.equal(result.status, 'corrupt')
  assert.deepEqual(result.document.groups, [])
  assert.ok(result.problems.length > 0)
})

// --- identity: id + (path,title) fallback -----------------------------------

test('groups: resolveMember prefers id, then falls back to (path,title)', () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'g-dsh', label: 'DSH' })
  assignMember(options, {
    workspaceId: 'ws-old',
    groupId: 'g-dsh',
    path: '/tmp/projects/DSH-00-Core',
    title: 'DSH-00-Core',
  })
  assert.equal(resolveMember(options, { workspaceId: 'ws-old' }).matchedBy, 'id')
  const byFingerprint = resolveMember(options, {
    workspaceId: 'ws-unknown',
    path: '/tmp/projects/DSH-00-Core',
    title: 'DSH-00-Core',
  })
  assert.equal(byFingerprint.matchedBy, 'fingerprint')
  assert.equal(byFingerprint.workspaceId, 'ws-old')
  assert.equal(resolveMember(options, { workspaceId: 'nope', path: '/x', title: 'y' }), undefined)
})

test('groups: repointWorkspace follows an id change and is idempotent', () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'g-dsh', label: 'DSH' })
  assignMember(options, { workspaceId: 'ws-old', groupId: 'g-dsh', path: '/p/A', title: 'A' })
  const moved = repointWorkspace(options, { fromId: 'ws-old', toId: 'ws-new', path: '/p/B', title: 'B' })
  assert.equal(moved.result.repointed, true)
  const { document } = readGroups(options)
  assert.equal(document.members['ws-old'], undefined)
  assert.equal(document.members['ws-new'].groupId, 'g-dsh')
  assert.equal(document.members['ws-new'].fingerprint.title, 'B')
  const again = repointWorkspace(options, { fromId: 'ws-old', toId: 'ws-new' })
  assert.equal(again.result.repointed, false)
})

test('groups: title-only rename refreshes the fingerprint without changing the id', () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'g', label: 'G' })
  assignMember(options, { workspaceId: 'ws1', groupId: 'g', path: '/p/A', title: 'A' })
  refreshFingerprint(options, { workspaceId: 'ws1', title: 'A-renamed' })
  const { document } = readGroups(options)
  assert.equal(document.members.ws1.fingerprint.title, 'A-renamed')
})

test('groups: grouped view keeps empty groups and exposes ungrouped items', () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'g1', label: 'One', order: 0 })
  upsertGroup(options, { groupId: 'g2', label: 'Two', order: 1 })
  assignMember(options, { workspaceId: 'w1', groupId: 'g1', path: '/p/1', title: '1' })
  const view = buildGroupedView(options, [
    { id: 'w1', path: '/p/1', title: '1' },
    { id: 'w2', path: '/p/2', title: '2' },
  ])
  const one = view.groups.find((g) => g.groupId === 'g1')
  const two = view.groups.find((g) => g.groupId === 'g2')
  assert.equal(one.items.length, 1)
  assert.equal(two.empty, true, 'empty groups stay visible')
  assert.equal(view.ungrouped.length, 1)
  assert.equal(view.ungrouped[0].id, 'w2')
})

test('groups: a stale id is reported when matched by fingerprint', () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'g', label: 'G' })
  assignMember(options, { workspaceId: 'ws-old', groupId: 'g', path: '/p/A', title: 'A' })
  const view = buildGroupedView(options, [{ id: 'ws-live', path: '/p/A', title: 'A' }])
  assert.equal(view.groups[0].items.length, 1)
  assert.equal(view.staleIdHint.length, 1)
  assert.equal(view.staleIdHint[0].liveId, 'ws-live')
})

test('groups: removeMember is idempotent', () => {
  const { options } = makeRoot()
  assert.equal(removeMember(options, 'nope').result.removed, false)
})

// --- batch validation -------------------------------------------------------

test('batch: segment validator rejects traversal and separators', () => {
  assert.deepEqual(validateSegment('DSH-00-Core'), [])
  assert.ok(validateSegment('..').some((e) => e.code === 'FOLDER_DOT'))
  assert.ok(validateSegment('a/b').some((e) => e.code === 'FOLDER_SEPARATOR'))
  assert.ok(validateSegment('   ').some((e) => e.code === 'FOLDER_BLANK'))
})

test('batch: name parser recognises the convention and rejects opaque names', () => {
  assert.equal(parseGroupedName('DSH-00-Core').group, 'DSH')
  assert.equal(parseGroupedName('DSH-01-Gate').index, '01')
  assert.equal(parseGroupedName('DSH-01-Promotion-Gate').sub, 'Promotion-Gate')
  assert.equal(parseGroupedName('UTM').grouped, false)
  assert.equal(parseGroupedName('release-harness').grouped, false)
})

test('batch: dry-run blocks an occupied target and a swap', () => {
  const { root, options } = makeRoot()
  const a = path.join(options.projectsRoot, 'A-00-Core')
  const b = path.join(options.projectsRoot, 'A-01-Sub')
  fs.mkdirSync(a, { recursive: true })
  fs.mkdirSync(b, { recursive: true })
  const occupied = validateBatchRename({
    dshHome: options.dshHome,
    moves: [{ workspaceId: 'w1', currentPath: a, targetPath: b }],
    // b belongs to another registered workspace, so moving onto it is a swap.
    registeredIds: [
      { id: 'w1', path: a },
      { id: 'w2', path: b },
    ],
  })
  assert.equal(occupied.ok, false)
  assert.ok(occupied.blockers.some((entry) => entry.code === 'BATCH_SWAP_REQUIRES_STAGING'))

  const collision = validateBatchRename({
    dshHome: options.dshHome,
    moves: [
      { workspaceId: 'w1', currentPath: a, targetPath: path.join(root, 'T-00-X') },
      { workspaceId: 'w2', currentPath: b, targetPath: path.join(root, 'T-00-X') },
    ],
  })
  assert.equal(collision.ok, false)
  assert.ok(collision.blockers.some((entry) => entry.code === 'TARGET_EXISTS' || entry.code === 'TARGET_KEY_COLLISION'))
})

test('batch: dry-run is read-only and reports zero mutations', () => {
  const { options } = makeRoot()
  const dir = path.join(options.projectsRoot, 'A-00-Core')
  fs.mkdirSync(dir, { recursive: true })
  const before = fs.readdirSync(options.projectsRoot).sort()
  const result = validateBatchRename({
    dshHome: options.dshHome,
    moves: [{ workspaceId: 'w1', currentPath: dir, targetPath: path.join(options.projectsRoot, 'A-02-Core') }],
  })
  assert.equal(result.ok, true, JSON.stringify(result.blockers))
  assert.deepEqual(fs.readdirSync(options.projectsRoot).sort(), before)
  assert.equal(fs.existsSync(path.join(options.projectsRoot, 'A-02-Core')), false)
})

test('batch: empty batch is blocked', () => {
  const { options } = makeRoot()
  assert.equal(validateBatchRename({ dshHome: options.dshHome, moves: [] }).ok, false)
})

test('batch: session audit tolerates an empty DSH home', () => {
  const { options } = makeRoot()
  const audit = auditSessionBindings(options.dshHome)
  assert.equal(audit.total, 0)
  assert.deepEqual(audit.findings, [])
})
