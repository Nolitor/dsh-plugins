/**
 * HQ tree derivation tests: control-tower identification, module rollup,
 * system-first ordering, proposal groups, and ungrouped fallthrough.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveOptions } from '../lib/transaction.mjs'
import { readGroups, upsertGroup, assignMember } from '../lib/groups.mjs'
import { buildHqTree } from '../lib/hq-tree.mjs'

function makeOptions() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'hqtree-'))
  const options = resolveOptions({
    dshHome: path.join(root, 'dsh-home'),
    backupDir: path.join(root, 'backup'),
    stateDir: path.join(root, 'state'),
    projectsRoot: path.join(root, 'projects'),
  })
  fs.mkdirSync(options.stateDir, { recursive: true })
  return options
}

const W = (id, title, sessionCount = 0) => ({ id, path: `/p/${title}`, title, sessionCount })

test('hq: identifies the {GROUP}-00-{MAIN} control tower', () => {
  const options = makeOptions()
  upsertGroup(options, { groupId: 'g-utm', label: 'UTM', index: '00' })
  const workspaces = [W('hq', 'UTM-00-Core'), W('m1', 'UTM-01-Gate'), W('m2', 'UTM-02-Release')]
  for (const workspace of workspaces) {
    assignMember(options, { workspaceId: workspace.id, groupId: 'g-utm', path: workspace.path, title: workspace.title })
  }
  const tree = buildHqTree({ workspaces, document: readGroups(options).document })
  const utm = tree.groups.find((group) => group.groupId === 'g-utm')
  assert.equal(utm.hq.workspace.title, 'UTM-00-Core')
  assert.deepEqual(utm.modules.map((entry) => entry.sub), ['Gate', 'Release'])
  assert.equal(utm.complete, true)
})

test('hq: sorts modules by INDEX numerically, not lexically', () => {
  const options = makeOptions()
  upsertGroup(options, { groupId: 'g', label: 'G' })
  const workspaces = [W('a', 'G-02-C'), W('b', 'G-10-B'), W('c', 'G-01-A')]
  for (const workspace of workspaces) {
    assignMember(options, { workspaceId: workspace.id, groupId: 'g', order: 99, path: workspace.path, title: workspace.title })
  }
  const tree = buildHqTree({ workspaces, document: readGroups(options).document })
  assert.deepEqual(tree.groups[0].modules.map((entry) => entry.sub), ['A', 'C', 'B'])
})

test('hq: system groups render before project groups', () => {
  const options = makeOptions()
  upsertGroup(options, { groupId: 'g-proj', label: 'Proj', order: 0 })
  upsertGroup(options, { groupId: 'core', label: 'Core', order: 5, kind: 'system', pinTop: true })
  const workspaces = [W('p', 'PROJ-00-X'), W('s', 'SYS')]
  assignMember(options, { workspaceId: 'p', groupId: 'g-proj', path: '/p/PROJ-00-X', title: 'PROJ-00-X' })
  assignMember(options, { workspaceId: 's', groupId: 'core', path: '/p/SYS', title: 'SYS' })
  const tree = buildHqTree({ workspaces, document: readGroups(options).document })
  assert.equal(tree.groups[0].groupId, 'core')
  assert.equal(tree.groups[1].groupId, 'g-proj')
})

test('hq: a group without an HQ is flagged but still rendered', () => {
  const options = makeOptions()
  upsertGroup(options, { groupId: 'g', label: 'G' })
  assignMember(options, { workspaceId: 'm', groupId: 'g', path: '/p/G-01-A', title: 'G-01-A' })
  const tree = buildHqTree({ workspaces: [W('m', 'G-01-A')], document: readGroups(options).document })
  assert.equal(tree.groups[0].hq, null)
  assert.equal(tree.groups[0].complete, false)
  assert.equal(tree.groups[0].modules.length, 1)
})

test('hq: unregistered but well-named workspaces surface as proposals', () => {
  const options = makeOptions()
  // No groups configured at all.
  const workspaces = [W('d0', 'DSH-00-Plugins'), W('d1', 'DSH-01-Notify'), W('x', 'misc')]
  const tree = buildHqTree({ workspaces, document: readGroups(options).document })
  const proposed = tree.groups.find((group) => group.proposed === true)
  assert.ok(proposed, 'a proposed group is derived from the naming convention')
  assert.equal(proposed.label, 'DSH')
  assert.equal(proposed.hq.workspace.title, 'DSH-00-Plugins')
  assert.deepEqual(proposed.modules.map((entry) => entry.sub), ['Notify'])
  assert.deepEqual(tree.ungrouped.map((workspace) => workspace.id), ['x'])
  assert.equal(tree.totals.proposed, 1)
})

test('hq: fingerprint fallback finds a member after its id changed', () => {
  const options = makeOptions()
  upsertGroup(options, { groupId: 'g', label: 'G' })
  assignMember(options, { workspaceId: 'old-id', groupId: 'g', path: '/p/G-00-HQ', title: 'G-00-HQ' })
  const tree = buildHqTree({
    workspaces: [W('new-id', 'G-00-HQ')],
    document: readGroups(options).document,
  })
  const group = tree.groups.find((candidate) => candidate.groupId === 'g')
  assert.equal(group.hq.workspace.id, 'new-id')
  assert.equal(group.hq.matchedBy, 'fingerprint')
})

test('hq: session counts roll up across HQ and modules', () => {
  const options = makeOptions()
  upsertGroup(options, { groupId: 'g', label: 'G' })
  const workspaces = [W('hq', 'G-00-HQ', 7), W('m1', 'G-01-A', 3), W('m2', 'G-02-B', 2)]
  for (const workspace of workspaces) {
    assignMember(options, { workspaceId: workspace.id, groupId: 'g', path: workspace.path, title: workspace.title })
  }
  const tree = buildHqTree({ workspaces, document: readGroups(options).document })
  assert.equal(tree.groups[0].sessionCount, 12)
  assert.equal(tree.groups[0].workspaceCount, 3)
})
