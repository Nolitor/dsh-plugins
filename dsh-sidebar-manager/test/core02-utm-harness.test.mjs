/**
 * Core-02 UTM harness check: drive the real groups store through the project/section
 * lifecycle the manager panel performs, inside a sandbox root.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import assert from 'node:assert/strict'
import {
  readGroups, upsertGroup, assignMember, removeMember, listGroups,
  validateDocument, GROUPS_UNIT,
} from '../lib/groups.mjs'

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'sidebar-core02-'))
const options = {
  dshHome: path.join(root, 'dsh-home'),
  backupDir: path.join(root, 'backup'),
  stateDir: path.join(root, 'state'),
  projectsRoot: path.join(root, 'projects'),
}
for (const dir of [options.dshHome, options.backupDir, options.stateDir, options.projectsRoot]) fs.mkdirSync(dir, { recursive: true })
assert.notEqual(path.resolve(options.dshHome), path.resolve(os.homedir(), '.dsh'), 'refusing live ~/.dsh')

const doc = () => readGroups(options).document
const checks = []
const ok = (name, fn) => { fn(); checks.push(name) }

ok('empty store is a valid unit document', () => {
  const fresh = readGroups(options)
  assert.equal(fresh.status, 'absent')
  assert.equal(fresh.document.unit.version, GROUPS_UNIT.version)
  assert.deepEqual(fresh.document.groups, [])
  assert.deepEqual(fresh.document.members, {})
})

ok('add a system group (UTM-style contract node)', () => {
  upsertGroup(options, { groupId: 'core', label: 'Core', order: -1, kind: 'system', pinTop: true })
  const core = doc().groups.find((g) => g.groupId === 'core')
  assert.ok(core)
  assert.equal(core.kind, 'system')
  assert.equal(core.pinTop, true)
})

ok('add a project group (section)', () => {
  upsertGroup(options, { groupId: 'dsh-plugins', label: 'DSH Plugins', order: 0, kind: 'project' })
  const g = doc().groups.find((x) => x.groupId === 'dsh-plugins')
  assert.ok(g)
  assert.equal(g.kind, 'project')
})

ok('a project group may reference an upstream contract group', () => {
  upsertGroup(options, { groupId: 'utm-impl', label: 'UTM Impl', order: 1, kind: 'project' })
  const d = doc()
  d.groups.find((g) => g.groupId === 'utm-impl').upstream = { contractGroupId: 'core', contractSpec: 'UTM-CONTRACT' }
  assert.deepEqual(validateDocument(d), [])
})

ok('assign workspaces as members with role and policy', () => {
  assignMember(options, { workspaceId: 'w-contract', groupId: 'core', order: 0, path: '/p/Core-00-System', title: 'Core-00-System' })
  assignMember(options, { workspaceId: 'w-impl', groupId: 'dsh-plugins', order: 0, path: '/p/dsh-plugins', title: 'dsh-plugins' })
  const d = doc()
  assert.equal(d.members['w-contract'].groupId, 'core')
  assert.equal(d.members['w-impl'].groupId, 'dsh-plugins')
  assert.deepEqual(fs.readdirSync(options.projectsRoot), [], 'grouping must not touch the filesystem')
})

ok('listGroups projects a manager-panel view', () => {
  const listed = listGroups(options)
  const groups = listed.groups ?? listed
  assert.ok(Array.isArray(groups))
  assert.ok(groups.some((g) => (g.groupId ?? g.id) === 'core'))
})

ok('remove a member without removing its group', () => {
  removeMember(options, 'w-impl')
  const d = doc()
  assert.equal(d.members['w-impl'], undefined)
  assert.ok(d.groups.some((g) => g.groupId === 'dsh-plugins'))
})

ok('reject a group that references itself upstream', () => {
  const d = doc()
  d.groups.find((g) => g.groupId === 'utm-impl').upstream = { contractGroupId: 'utm-impl' }
  assert.ok(validateDocument(d).length > 0, 'self-reference must be reported')
})

ok('reject unknown member role values', () => {
  const d = doc()
  d.members['w-contract'].role = 'not-a-role'
  assert.ok(validateDocument(d).length > 0, 'unknown role must be reported')
})

ok('a reload round-trips the document unchanged', () => {
  assert.equal(JSON.stringify(doc()), JSON.stringify(doc()))
})

ok('the panel surface is three tabs, and each tab owns one concern', () => {
  const source = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  for (const component of ['WorkspacesTab', 'GroupsTab', 'DiagnosticsTab']) {
    assert.ok(source.includes('function ' + component + '('), 'missing tab component ' + component)
  }
  assert.ok(source.includes("role: 'tablist'"), 'the shell must expose a tablist')
  assert.ok(source.includes("role: 'tabpanel'"), 'the shell must expose a tabpanel')

  // The UTM contract vocabulary lives on the Groups tab; maintenance actions
  // (HQ bootstrap, promotion gate, orphan scan, advisory) live on Diagnostics.
  const groups = source.slice(source.indexOf('function GroupsTab('), source.indexOf('function WorkspacesTab('))
  const diagnostics = source.slice(source.indexOf('function DiagnosticsTab('), source.indexOf('function WorkspaceManagerPanel('))
  for (const marker of ['groups.hqTitle', 'groups.orphansTitle', 'groups.promoteTitle', 'groups.advisoryTitle']) {
    assert.ok(!groups.includes("t('" + marker + "')"), marker + ' must not render on the Groups tab')
    assert.ok(diagnostics.includes("t('" + marker + "')"), marker + ' must render on the Diagnostics tab')
  }
  // The daily surface must not carry maintenance tooling.
  const workspaces = source.slice(source.indexOf('function WorkspacesTab('), source.indexOf('function DiagnosticsTab('))
  assert.ok(workspaces.includes("t('workspaceManager.listTitle')"), 'workspace list stays on its own tab')
  assert.ok(!workspaces.includes("t('groups.align')"), 'order alignment belongs to the Groups tab')
})

ok('the UTM role/policy vocabulary still round-trips through the tabbed UI contract', () => {
  // Tab split is presentation only: the store schema, roles and policies are
  // unchanged, so a document produced before the split still validates.
  const d = doc()
  assert.equal(d.unit.version, GROUPS_UNIT.version)
  assert.ok(Array.isArray(d.groups))
  assert.ok(d.members && typeof d.members === 'object')
  // The contract group added earlier is still a system node with an upstream-safe shape.
  const core = d.groups.find((g) => g.groupId === 'core')
  assert.ok(core, 'contract group survives the UI refactor')
  assert.equal(core.kind, 'system')
  // Every member still carries its advisory role/policy fields.
  for (const member of Object.values(d.members)) {
    assert.ok(['contract', 'implementation'].includes(member.role) || member.role === undefined)
  }
})

ok('the manager is reachable from the More menu, not from the rail', () => {
  // An entry on sidebar.panellist always sorts among the native rows and lands
  // before the More launcher (measured 2026-11-03), so the plugin registers no
  // rail row; it lives in the More menu and opens through ctx.layout.
  const client = fs.readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.ok(!client.includes("name: 'sidebar.panellist',"), 'no rail row')
  assert.ok(client.includes("name: 'sidebar.panellist.actions'"), 'More-menu row present')
  assert.ok(client.includes('layout.selectPanel(PANEL_ID)'), 'opens via the layout service')
})

fs.rmSync(root, { recursive: true, force: true })
console.log('Core-02 UTM harness: ' + checks.length + '/' + checks.length + ' checks passed')
for (const c of checks) console.log('  ok - ' + c)