/**
 * v3: descriptive roles, upstream links, and SELECTIVE advisory policies.
 *
 * The invariant under test: metadata never blocks. Roles/policies produce
 * observations and soft rejections, and workflow routes stay unaffected.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveOptions, createTransactionRoutes } from '../lib/transaction.mjs'
import {
  GROUPS_UNIT,
  MEMBER_ROLES,
  MEMBER_POLICIES,
  upsertGroup,
  assignMember,
  readGroups,
  validateDocument,
  migrateDocument,
  mutateGroups,
} from '../lib/groups.mjs'
import {
  observeWorkspace,
  evaluateMutation,
  evaluateWorktreePreflight,
  buildAdvisoryReport,
} from '../lib/contract-advisory.mjs'

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'adv-v3-'))
  const projects = path.join(root, 'projects')
  fs.mkdirSync(projects, { recursive: true })
  const options = resolveOptions({
    dshHome: path.join(root, 'dsh-home'),
    backupDir: path.join(root, 'backup'),
    stateDir: path.join(root, 'state'),
    projectsRoot: projects,
  })
  fs.mkdirSync(options.stateDir, { recursive: true })
  return { root, options, projects }
}

function makeRegistry(seed = []) {
  const byId = new Map(seed.map((w) => [w.id, w]))
  return { list: () => [...byId.values()], get: (id) => byId.get(id) }
}

const post = (body) =>
  new Request('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

/** Set a member policy through the documented mutation path. */
function setMemberPolicy(options, id, patch) {
  return mutateGroups(options, (document) => {
    document.members[id] = { ...(document.members[id] ?? {}), ...patch }
    return true
  })
}

// --- schema ------------------------------------------------------------------

test('v3: version is 3 and role/policy vocabularies are declared', () => {
  assert.equal(GROUPS_UNIT.version, 3)
  assert.deepEqual(MEMBER_ROLES, ['contract', 'implementation'])
  assert.deepEqual(MEMBER_POLICIES, ['read-only', 'self-contained'])
})

test('v3: role and policy are accepted and validated', () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'core', label: 'Core', kind: 'system' })
  assignMember(options, { workspaceId: 'w1', groupId: 'core', path: '/p/A', title: 'A' })
  setMemberPolicy(options, 'w1', { role: 'contract', policy: { access: 'read-only', reason: 'canonical' } })
  const { document, status } = readGroups(options)
  assert.equal(status, 'ok')
  assert.equal(document.members.w1.role, 'contract')
  assert.equal(document.members.w1.policy.access, 'read-only')
})

test('v3: an unknown role or policy value is rejected', () => {
  const problems = validateDocument({
    unit: { name: 'sidebar-groups', version: 3 },
    groups: [{ groupId: 'core', label: 'Core', kind: 'system' }],
    members: { w1: { groupId: 'core', role: 'overlord', policy: { access: 'godmode' } } },
  })
  assert.ok(problems.some((p) => p.includes('member-role-invalid')))
  assert.ok(problems.some((p) => p.includes('member-policy-access-invalid')))
})

test('v3: upstream must reference an existing system group and cannot self-reference', () => {
  const problems = validateDocument({
    unit: { name: 'sidebar-groups', version: 3 },
    groups: [
      { groupId: 'core', label: 'Core', kind: 'system' },
      { groupId: 'proj', label: 'Proj', kind: 'project', upstream: { contractGroupId: 'nope' } },
      { groupId: 'self', label: 'Self', kind: 'project', upstream: { contractGroupId: 'self' } },
    ],
    members: {},
  })
  assert.ok(problems.some((p) => p.includes('group-upstream-unknown')))
  assert.ok(problems.some((p) => p.includes('group-upstream-self')))
})

test('v3: a v2 document migrates additively and keeps behaviour', () => {
  const v2 = {
    unit: { name: 'sidebar-groups', version: 2 },
    groups: [{ groupId: 'g', label: 'G', order: 0, kind: 'project' }],
    members: { w1: { groupId: 'g', order: 0, fingerprint: { path: '/p', title: 'T' } } },
  }
  const migrated = migrateDocument(v2)
  assert.equal(migrated.unit.version, 3)
  assert.equal(migrated.members.w1.role, undefined, 'role stays absent = no policy')
  assert.deepEqual(validateDocument(migrated), [])
})

// --- advisory (never blocking) -----------------------------------------------

test('advisory: implementation artifacts in a contract node are a NOTICE, not a block', () => {
  const { projects } = makeRoot()
  const dir = path.join(projects, 'Core-00-System')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'CAPSULE.md'), '# capsule\n')
  fs.writeFileSync(path.join(dir, 'package.json'), '{}')
  fs.mkdirSync(path.join(dir, 'node_modules'), { recursive: true })
  const result = observeWorkspace({ workspace: { id: 'w', path: dir, title: 'Core-00-System', role: 'contract' } })
  assert.equal(result.observations.length, 1)
  assert.equal(result.observations[0].code, 'ARTIFACTS_IN_CONTRACT_NODE')
  assert.equal(result.observations[0].level, 'notice')
  // Nothing was removed.
  assert.ok(fs.existsSync(path.join(dir, 'package.json')))
  assert.ok(fs.existsSync(path.join(dir, 'node_modules')))
})

test('advisory: a clean contract node produces no observations', () => {
  const { projects } = makeRoot()
  const dir = path.join(projects, 'Core-00-System')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'CAPSULE.md'), '# capsule\n')
  const result = observeWorkspace({ workspace: { id: 'w', path: dir, title: 'Core', role: 'contract' } })
  assert.deepEqual(result.observations, [])
})

test('advisory: report is explicitly non-blocking', () => {
  const report = buildAdvisoryReport({ workspaces: [], document: { members: {} } })
  assert.equal(report.advisory, true)
  assert.equal(report.blocking, false)
  assert.equal(report.ok, true)
})

test('advisory: .agents/worktrees in a contract node is a NOTICE, not a block', () => {
  const { projects } = makeRoot()
  const dir = path.join(projects, 'Core-00-System')
  fs.mkdirSync(path.join(dir, '.agents', 'worktrees', 'dsh-abc'), { recursive: true })
  const result = observeWorkspace({ workspace: { id: 'w', path: dir, title: 'Core-00-System', role: 'contract' } })
  const worktree = result.observations.find((observation) => observation.code === 'WORKTREE_ARTIFACT_IN_CONTRACT_NODE')
  assert.ok(worktree, 'worktree observation must be present')
  assert.equal(worktree.level, 'notice')
  assert.equal(worktree.blocking, undefined)
  assert.ok(fs.existsSync(path.join(dir, '.agents', 'worktrees', 'dsh-abc')))
})

test('worktree preflight: policy mismatch is advisory and non-blocking', () => {
  const result = evaluateWorktreePreflight({
    target: { id: 'core-spec', title: 'Core-00-System', policy: { access: 'read-only' } },
    originWorkspaceId: 'utm',
    worktreePath: '/repo/.agents/worktrees/dsh-abc',
  })
  assert.equal(result.ok, true)
  assert.equal(result.advisory, true)
  assert.equal(result.blocking, false)
  assert.equal(result.allowed, false)
  assert.equal(result.observation.code, 'WORKTREE_POLICY_ADVISORY')
})

test('worktree preflight: same-context request is allowed', () => {
  const result = evaluateWorktreePreflight({
    target: { id: 'core-spec', title: 'Core-00-System', policy: { access: 'read-only' } },
    originWorkspaceId: 'core-spec',
  })
  assert.equal(result.allowed, true)
  assert.equal(result.blocking, false)
  assert.equal(result.observation.code, 'WORKTREE_CONTEXT_ALLOWED')
})

// --- selective policies -------------------------------------------------------

test('policy read-only: mutation from another workspace is soft-rejected', () => {
  const verdict = evaluateMutation({
    target: { id: 'core-spec', title: 'Core-00-System', policy: { access: 'read-only' } },
    originWorkspaceId: 'utm',
    action: 'write',
  })
  assert.equal(verdict.allowed, false)
  assert.equal(verdict.softRejection.code, 'POLICY_READ_ONLY')
  assert.equal(verdict.softRejection.level, 'policy')
})

test('policy read-only: mutation from its OWN context is allowed', () => {
  const verdict = evaluateMutation({
    target: { id: 'core-spec', title: 'Core-00-System', policy: { access: 'read-only' } },
    originWorkspaceId: 'core-spec',
    action: 'write',
  })
  assert.equal(verdict.allowed, true)
})

test('policy self-contained: external mutation is soft-rejected, internal allowed', () => {
  const target = { id: 'uroh', title: 'Core-99-UROH', policy: { access: 'self-contained' } }
  const external = evaluateMutation({ target, originWorkspaceId: 'utm', action: 'reconcile' })
  assert.equal(external.allowed, false)
  assert.equal(external.softRejection.code, 'POLICY_SELF_CONTAINED')
  const internal = evaluateMutation({ target, originWorkspaceId: 'uroh', action: 'reconcile' })
  assert.equal(internal.allowed, true)
})

test('policy: an undeclared workspace has no restrictions', () => {
  const verdict = evaluateMutation({ target: { id: 'free', title: 'Free' }, originWorkspaceId: 'other', action: 'write' })
  assert.equal(verdict.allowed, true)
  assert.equal(verdict.softRejection, undefined)
})

// --- routes stay non-blocking -------------------------------------------------

test('route: groups/advisory always returns 200 and is non-blocking', async () => {
  const { options, projects } = makeRoot()
  const dir = path.join(projects, 'Core-00-System')
  fs.mkdirSync(dir, { recursive: true })
  fs.writeFileSync(path.join(dir, 'package.json'), '{}')
  upsertGroup(options, { groupId: 'core', label: 'Core', kind: 'system' })
  const registry = makeRegistry([{ id: 'w1', path: dir, title: 'Core-00-System', record: { sessionIds: [] } }])
  const ctx = { get: (n) => (n === 'workspaceRegistry' ? registry : undefined), logger: { warn() {} } }
  const routes = createTransactionRoutes(ctx, options)
  const response = await routes['groups/advisory'](post())
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.blocking, false)
})

test('route: groups/mutation-check returns 200 with an explicit soft rejection', async () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'core', label: 'Core', kind: 'system' })
  assignMember(options, { workspaceId: 'w1', groupId: 'core', path: '/p/A', title: 'A' })
  setMemberPolicy(options, 'w1', { role: 'contract', policy: { access: 'read-only' } })
  const registry = makeRegistry([{ id: 'w1', path: '/p/A', title: 'A', record: { sessionIds: [] } }])
  const ctx = { get: (n) => (n === 'workspaceRegistry' ? registry : undefined), logger: { warn() {} } }
  const routes = createTransactionRoutes(ctx, options)
  const response = await routes['groups/mutation-check'](post({ targetWorkspaceId: 'w1', originWorkspaceId: 'other', action: 'write' }))
  assert.equal(response.status, 200, 'policy is advisory, never a hard block')
  const body = await response.json()
  assert.equal(body.allowed, false)
  assert.equal(body.softRejection.code, 'POLICY_READ_ONLY')
})

test('non-blocking: workflow routes never consult role or policy', () => {
  const source = fs.readFileSync(path.join(process.cwd(), 'lib', 'transaction.mjs'), 'utf8')
  // The mutation handlers must not reference the advisory module.
  const handlerNames = ['handleRenameFolder', 'handleMove', 'applyPromotion', 'handleOrderApply']
  for (const name of handlerNames) {
    const start = source.indexOf(`function ${name}`)
    assert.notEqual(start, -1, `${name} missing`)
    const nextFn = source.indexOf('\nasync function ', start + 10)
    const body = source.slice(start, nextFn === -1 ? start + 4000 : nextFn)
    assert.ok(!/evaluateMutation|softRejection/.test(body), `${name} must not enforce policy`)
  }
})
