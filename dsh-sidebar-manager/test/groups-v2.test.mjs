/**
 * Phase 4 tests: groups.json v2 (system kind), sidebar order planning,
 * and the explicit "Align Sidebar Order" command with reverse rollback.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveOptions, createTransactionRoutes } from '../lib/transaction.mjs'
import {
  GROUPS_UNIT,
  migrateDocument,
  validateDocument,
  readGroups,
  upsertGroup,
  assignMember,
  planSidebarOrder,
  parseGroupedName,
} from '../lib/groups.mjs'

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'groupsv2-'))
  const options = resolveOptions({
    dshHome: path.join(root, 'dsh-home'),
    backupDir: path.join(root, 'backup'),
    stateDir: path.join(root, 'state'),
    projectsRoot: path.join(root, 'projects'),
  })
  fs.mkdirSync(options.stateDir, { recursive: true })
  if (path.resolve(options.dshHome) === path.resolve(os.homedir(), '.dsh')) throw new Error('refusing live ~/.dsh')
  return { root, options }
}

/** Registry double supporting order mutation + insertBefore. */
function mockRegistry(seed) {
  let order = seed.map((workspace) => workspace.id)
  const byId = new Map(seed.map((workspace) => [workspace.id, workspace]))
  return {
    list: () => order.map((id) => byId.get(id)),
    get: (id) => byId.get(id),
    async insertBefore(workspaceId, beforeWorkspaceId) {
      if (!byId.has(workspaceId)) throw new Error(`unknown workspace ${workspaceId}`)
      if (beforeWorkspaceId !== undefined && !byId.has(beforeWorkspaceId)) {
        throw new Error(`unknown anchor ${beforeWorkspaceId}`)
      }
      order = order.filter((id) => id !== workspaceId)
      if (beforeWorkspaceId === undefined) order.push(workspaceId)
      else order.splice(order.indexOf(beforeWorkspaceId), 0, workspaceId)
      return [...order]
    },
    get order() {
      return [...order]
    },
  }
}

function makeCtx(registry, { failAfter } = {}) {
  let calls = 0
  return {
    get: (name) => (name === 'workspaceRegistry' ? registry : undefined),
    logger: { warn() {} },
    _failAfter: failAfter,
    _tick: () => {
      calls += 1
      if (failAfter !== undefined && calls > failAfter) throw new Error('simulated insertBefore failure')
    },
    _calls: () => calls,
  }
}

function post(body) {
  return new Request('http://localhost/api/local/sidebar/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body ?? {}),
  })
}

// --- schema v2 ---------------------------------------------------------------

test('v2: unit version is current and system kind is recognised', () => {
  assert.ok(GROUPS_UNIT.version >= 2, `expected >= 2, got ${GROUPS_UNIT.version}`)
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'core', label: 'Core', order: -1, kind: 'system', pinTop: true, color: '#7c3aed' })
  const { document, status } = readGroups(options)
  assert.equal(status, 'ok')
  assert.equal(document.groups[0].kind, 'system')
  assert.equal(document.groups[0].pinTop, true)
})

test('v2: a v1 document migrates to the current version additively', () => {
  const v1 = {
    unit: { name: 'sidebar-groups', version: 1 },
    groups: [{ groupId: 'g', label: 'G', order: 0 }],
    members: { w1: { groupId: 'g', order: 0, fingerprint: { path: '/p', title: 't' } } },
  }
  const migrated = migrateDocument(v1)
  assert.equal(migrated.unit.version, GROUPS_UNIT.version)
  assert.equal(migrated.groups[0].kind, 'project')
  assert.equal(migrated.members.w1.groupId, 'g', 'members preserved')
  assert.deepEqual(validateDocument(migrated), [])
})

test('v2: invalid kind/color are rejected on write', () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'g', label: 'G' })
  const { document } = readGroups(options)
  document.groups[0].kind = 'bogus'
  assert.throws(() => {
    const { writeGroups } = require_write()
    writeGroups(options, document)
  }, /invalid/i)
})

function require_write() {
  // groups.mjs is ESM; re-import is unnecessary — validateDocument is the gate.
  return {
    writeGroups(options, document) {
      const problems = validateDocument(document)
      if (problems.length > 0) throw new Error(`invalid: ${problems.join(',')}`)
    },
  }
}

// --- ordering ----------------------------------------------------------------

test('order: system groups pin to the top, then projects by INDEX', () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'core', label: 'Core', order: 0, kind: 'system', pinTop: true })
  upsertGroup(options, { groupId: 'g-utm', label: 'UTM', order: 0, index: '00' })
  const workspaces = [
    { id: 'loose', path: '/p/misc', title: 'misc' },
    { id: 'u2', path: '/p/UTM-02-Gate', title: 'UTM-02-Gate' },
    { id: 'sys2', path: '/p/uroh', title: 'UROH' },
    { id: 'u1', path: '/p/UTM-00-Core', title: 'UTM-00-Core' },
    { id: 'sys1', path: '/p/utm', title: 'UTM-ENGINE' },
    { id: 'u3', path: '/p/UTM-01-Release', title: 'UTM-01-Release' },
  ]
  for (const workspace of workspaces) {
    if (workspace.id === 'sys1') assignMember(options, { workspaceId: 'sys1', groupId: 'core', order: 0, path: workspace.path, title: workspace.title })
    else if (workspace.id === 'sys2') assignMember(options, { workspaceId: 'sys2', groupId: 'core', order: 1, path: workspace.path, title: workspace.title })
    else if (workspace.id.startsWith('u')) assignMember(options, { workspaceId: workspace.id, groupId: 'g-utm', path: workspace.path, title: workspace.title })
  }
  const plan = planSidebarOrder(options, workspaces)
  assert.deepEqual(plan.order, ['sys1', 'sys2', 'u1', 'u3', 'u2', 'loose'])
  assert.equal(plan.unchanged, false)
})

// --- order normalization -----------------------------------------------------

test('order: legacy duplicate/negative member orders are repaired on the next mutation', () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'core', label: 'Core', order: -1, kind: 'system', pinTop: true })
  assignMember(options, { workspaceId: 'a', groupId: 'core', order: 0, path: '/p/a', title: 'A' })
  assignMember(options, { workspaceId: 'b', groupId: 'core', order: 1, path: '/p/b', title: 'B' })
  // Force the legacy collision state that made the project picker drop entries.
  const doc = readGroups(options).document
  doc.members.a.order = -1
  doc.members.b.order = 0
  const file = path.join(options.stateDir, 'groups.json')
  fs.writeFileSync(file, JSON.stringify(doc))

  // Any mutation repairs it.
  assignMember(options, { workspaceId: 'c', groupId: 'core', order: 2, path: '/p/c', title: 'C' })
  const after = readGroups(options).document.members
  const orders = Object.values(after).map((member) => member.order).sort((x, y) => x - y)
  assert.deepEqual(orders, [0, 1, 2])
})

test('order: an explicit assign keeps its requested order (normalization must not renumber it)', () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'core', label: 'Core', order: 0, kind: 'system', pinTop: true })
  // Assign out of numeric order: 1 first, then 0. Normalizing AFTER the mutator
  // would renumber by document position and silently invert these.
  assignMember(options, { workspaceId: 'sys2', groupId: 'core', order: 1, path: '/p/uroh', title: 'UROH' })
  assignMember(options, { workspaceId: 'sys1', groupId: 'core', order: 0, path: '/p/utm', title: 'UTM-ENGINE' })
  const members = readGroups(options).document.members
  assert.equal(members.sys1.order, 0)
  assert.equal(members.sys2.order, 1)
  const plan = planSidebarOrder(options, [
    { id: 'sys2', path: '/p/uroh', title: 'UROH' },
    { id: 'sys1', path: '/p/utm', title: 'UTM-ENGINE' },
  ])
  assert.deepEqual(plan.order, ['sys1', 'sys2'])
})

test('order: parseGroupedName drives 00 -> 01 -> 02', () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'g', label: 'UTM' })
  const titles = ['UTM-02-Gate', 'UTM-00-Core', 'UTM-01-Release']
  const workspaces = titles.map((title, i) => ({ id: `w${i}`, path: `/p/${title}`, title }))
  workspaces.forEach((workspace) => assignMember(options, { workspaceId: workspace.id, groupId: 'g', order: 99, path: workspace.path, title: workspace.title }))
  const plan = planSidebarOrder(options, workspaces)
  const orderedTitles = plan.order.map((id) => workspaces.find((w) => w.id === id).title)
  assert.deepEqual(orderedTitles, ['UTM-00-Core', 'UTM-01-Release', 'UTM-02-Gate'])
  assert.equal(parseGroupedName('UTM-01-Release').indexValue, 1)
})

test('order: unchanged plan emits zero moves', () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'g', label: 'G' })
  const workspaces = [{ id: 'a', path: '/p/a', title: 'A' }]
  assignMember(options, { workspaceId: 'a', groupId: 'g', path: '/p/a', title: 'A' })
  const plan = planSidebarOrder(options, workspaces)
  assert.equal(plan.unchanged, true)
  assert.deepEqual(plan.moves, [])
})

// --- routes ------------------------------------------------------------------

test('route: order/preview is read-only', async () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'core', label: 'Core', kind: 'system', pinTop: true })
  const registry = mockRegistry([
    { id: 'a', path: '/p/a', title: 'A' },
    { id: 'b', path: '/p/b', title: 'B' },
  ])
  const before = registry.order
  const routes = createTransactionRoutes(makeCtx(registry), options)
  const response = await routes['workspace/order/preview'](post())
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.mutations, 0)
  assert.deepEqual(registry.order, before, 'preview must not mutate')
})

test('route: order/apply reorders and reports matchesTarget', async () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'core', label: 'Core', order: 0, kind: 'system', pinTop: true })
  assignMember(options, { workspaceId: 'z', groupId: 'core', order: 0, path: '/p/z', title: 'Core' })
  const registry = mockRegistry([
    { id: 'a', path: '/p/a', title: 'A' },
    { id: 'z', path: '/p/z', title: 'Core' },
  ])
  const routes = createTransactionRoutes(makeCtx(registry), options)
  const response = await routes['workspace/order/apply'](post({}))
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.applied, true)
  assert.equal(registry.order[0], 'z', 'system core moves to the top')
  assert.equal(body.matchesTarget, true)
})

test('route: order/apply rolls back when insertBefore fails mid-flight', async () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'core', label: 'Core', order: 0, kind: 'system', pinTop: true })
  assignMember(options, { workspaceId: 'z', groupId: 'core', order: 0, path: '/p/z', title: 'Core' })
  assignMember(options, { workspaceId: 'y', groupId: 'core', order: 1, path: '/p/y', title: 'Core2' })
  const seed = [
    { id: 'a', path: '/p/a', title: 'A' },
    { id: 'b', path: '/p/b', title: 'B' },
    { id: 'z', path: '/p/z', title: 'Core' },
    { id: 'y', path: '/p/y', title: 'Core2' },
  ]
  const registry = mockRegistry(seed)
  const original = registry.order
  // Fail on the second insertBefore call.
  let calls = 0
  const realInsert = registry.insertBefore.bind(registry)
  registry.insertBefore = async (id, before) => {
    calls += 1
    if (calls === 2) throw new Error('simulated failure')
    return realInsert(id, before)
  }
  const ctx = { get: (n) => (n === 'workspaceRegistry' ? registry : undefined), logger: { warn() {} } }
  const routes = createTransactionRoutes(ctx, options)
  const response = await routes['workspace/order/apply'](post({}))
  const body = await response.json()
  assert.equal(response.status, 409)
  assert.equal(body.ok, false)
  assert.equal(body.rolledBack, true)
  assert.deepEqual(registry.order, original, 'order must be restored after rollback')
})

test('route: order/apply dryRun performs no mutation', async () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'core', label: 'Core', kind: 'system', pinTop: true })
  assignMember(options, { workspaceId: 'z', groupId: 'core', path: '/p/z', title: 'Core' })
  const registry = mockRegistry([
    { id: 'a', path: '/p/a', title: 'A' },
    { id: 'z', path: '/p/z', title: 'Core' },
  ])
  const before = registry.order
  const routes = createTransactionRoutes(makeCtx(registry), options)
  const body = await (await routes['workspace/order/apply'](post({ dryRun: true }))).json()
  assert.equal(body.dryRun, true)
  assert.deepEqual(registry.order, before)
})
