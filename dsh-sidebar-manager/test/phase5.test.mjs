/**
 * Phase 5: HQ promotion, transactional batch rename, orphan classifier,
 * harness diet conventions, and the new routes.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import { resolveOptions, createTransactionRoutes } from '../lib/transaction.mjs'
import { upsertGroup, readGroups, assignMember } from '../lib/groups.mjs'
import { hqTitle, previewHq, scaffoldHq, renderCapsule, promoteHq } from '../lib/hq-promote.mjs'
import { planBatchRename, applyBatchRename, readBatchJournal, recoverBatchRename, stagingPath } from '../lib/batch-rename.mjs'
import { classifyOrphanLogs } from '../lib/orphan-classifier.mjs'
import { estimateTokens, auditResidentBudget, detectDuplicatedCapsule, checkCrossGroupFork, DIET_BUDGETS } from '../lib/harness-diet.mjs'
import { isSubagentHeader, attributeSession, auditSubagentArtifacts, verifyCaptureGuard } from '../lib/subagent-guard.mjs'
import { gateG1, gateG2, gateG3, gateG4, gateG6, runPromotionGate } from '../lib/promotion-gate.mjs'
import { lifecycleStatus, assertGovernanceTarget, activeGovernanceTargets } from '../lib/workspace-lifecycle.mjs'

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'phase5-'))
  const projects = path.join(root, 'projects')
  fs.mkdirSync(projects, { recursive: true })
  const options = resolveOptions({
    dshHome: path.join(root, 'dsh-home'),
    backupDir: path.join(root, 'backup'),
    stateDir: path.join(root, 'state'),
    projectsRoot: projects,
  })
  fs.mkdirSync(options.stateDir, { recursive: true })
  if (path.resolve(options.dshHome) === path.resolve(os.homedir(), '.dsh')) throw new Error('refusing live ~/.dsh')
  return { root, options, projects }
}

function makeRegistry(seed = []) {
  const byId = new Map(seed.map((w) => [w.id, { ...w, sessionIds: w.sessionIds ?? [] }]))
  return {
    list: () => [...byId.values()],
    get: (id) => byId.get(id),
    async create(p, title) {
      const id = `ws-${byId.size + 1}`
      const rec = { id, path: p, title, sessionIds: [], record: { sessionIds: [] } }
      byId.set(id, rec)
      return { ...rec, attachSession: async (sid) => { rec.sessionIds.push(sid) } }
    },
  }
}

const post = (body) =>
  new Request('http://localhost/x', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) })

// --- HQ promotion ------------------------------------------------------------

test('hq: title follows the {GROUP}-00-{MAIN} convention', () => {
  assert.equal(hqTitle('UTM', 'Core'), 'UTM-00-Core')
  assert.equal(hqTitle('UTM', ''), 'UTM-00-HQ')
})

test('hq: preview rejects an empty group and detects an existing title', () => {
  const { options } = makeRoot()
  assert.equal(previewHq({ group: '', projectsRoot: options.projectsRoot }).ok, false)
  const conflict = previewHq({ group: 'UTM', projectsRoot: options.projectsRoot, existingTitles: ['utm-00-hq'] })
  assert.ok(conflict.blockers.some((entry) => entry.code === 'TITLE_CONFLICT'))
})

test('hq: scaffold creates CAPSULE.md and a marker idempotently', () => {
  const { options } = makeRoot()
  const planned = previewHq({ group: 'UTM', main: 'Core', projectsRoot: options.projectsRoot })
  const first = scaffoldHq({ ...planned, group: 'UTM' })
  assert.deepEqual(first.created.sort(), ['.dsh-hq.json', 'CAPSULE.md'])
  const second = scaffoldHq({ ...planned, group: 'UTM' })
  assert.deepEqual(second.created, [], 'second scaffold is a no-op')
})

test('hq: capsule stays within the 400-token budget', () => {
  const capsule = renderCapsule({ group: 'UTM', title: 'UTM-00-Core', modules: ['UTM-01-Gate'], specs: ['spec.md'] })
  assert.ok(estimateTokens(capsule) <= DIET_BUDGETS.groupCapsule, `capsule too large: ${estimateTokens(capsule)}`)
  assert.ok(capsule.includes('UTM-00-Core'))
})

test('hq: promoteHq runs dry-run without creating anything', async () => {
  const { options, projects } = makeRoot()
  const registry = makeRegistry()
  const ctx = { get: (n) => (n === 'workspaceRegistry' ? registry : undefined), logger: { warn() {} } }
  const result = await promoteHq({
    ctx, options, group: 'UTM', main: 'Core', dryRun: true,
    previewPromotion: async () => ({ ok: true }),
    applyPromotion: async () => ({ ok: true }),
  })
  assert.equal(result.ok, true)
  assert.equal(result.wouldCreate, true)
  assert.equal(fs.existsSync(path.join(projects, 'UTM-00-Core')), false)
})

test('hq: promoteHq scaffolds first, then stops when the promotion preview blocks', async () => {
  const { options, projects } = makeRoot()
  const ctx = { get: () => makeRegistry(), logger: { warn() {} } }
  let applied = false
  const result = await promoteHq({
    ctx, options, group: 'UTM', main: 'Core',
    previewPromotion: async () => ({ ok: false, blockerCodes: ['PATH_REQUIRED'], blockers: [] }),
    applyPromotion: async () => { applied = true; return { ok: true } },
  })
  assert.equal(result.ok, false)
  assert.equal(result.stage, 'promotion-preview')
  // mode:"existing" needs the directory to exist, so the scaffold runs first.
  assert.ok(fs.existsSync(path.join(projects, 'UTM-00-Core', 'CAPSULE.md')))
  assert.equal(applied, false, 'apply must not run when the preview blocks')
})

test('hq: promoteHq registers an existing scaffolded HQ end to end', async () => {
  const { options, projects } = makeRoot()
  const ctx = { get: () => makeRegistry(), logger: { warn() {} } }
  let appliedWith
  const result = await promoteHq({
    ctx, options, group: 'Core', main: 'System',
    previewPromotion: async () => ({ ok: true }),
    applyPromotion: async (_ctx, _options, body) => { appliedWith = body; return { ok: true, workspaceId: 'ws-hq' } },
  })
  assert.equal(result.ok, true)
  assert.equal(result.workspaceId, 'ws-hq')
  assert.equal(appliedWith.mode, 'existing')
  assert.ok(fs.existsSync(path.join(projects, 'Core-00-System', 'CAPSULE.md')))
})

// --- batch rename ------------------------------------------------------------

test('batch: plan detects a swap and requires staging', () => {
  const { options, projects } = makeRoot()
  const a = path.join(projects, 'A-00-X'); const b = path.join(projects, 'A-01-Y')
  fs.mkdirSync(a, { recursive: true }); fs.mkdirSync(b, { recursive: true })
  const plan = planBatchRename({
    dshHome: options.dshHome,
    moves: [
      { workspaceId: 'w1', currentPath: a, targetPath: b },
      { workspaceId: 'w2', currentPath: b, targetPath: a },
    ],
  })
  assert.equal(plan.requiresStaging, true)
})

test('batch: apply renames through staging and commits the journal', async () => {
  const { options, projects } = makeRoot()
  const src = path.join(projects, 'A-00-Old'); const dst = path.join(projects, 'A-00-New')
  fs.mkdirSync(src, { recursive: true }); fs.writeFileSync(path.join(src, 'f.txt'), 'x')
  const plan = planBatchRename({ dshHome: options.dshHome, moves: [{ workspaceId: 'w1', currentPath: src, targetPath: dst }] })
  assert.equal(plan.ok, true, JSON.stringify(plan.blockers))
  const result = await applyBatchRename({
    options, plan,
    io: {
      snapshot: () => ({ ok: 1 }),
      restore: () => {},
      relocateWorkspace: async () => ({ moved: 0 }),
      repointGroup: async () => {},
    },
  })
  assert.equal(result.ok, true)
  assert.equal(fs.existsSync(path.join(dst, 'f.txt')), true)
  assert.equal(fs.existsSync(src), false)
  assert.equal(readBatchJournal(options).state, 'committed')
})

test('batch: a mid-flight failure rolls back files and snapshot', async () => {
  const { options, projects } = makeRoot()
  const src = path.join(projects, 'A-00-Old'); const dst = path.join(projects, 'A-00-New')
  fs.mkdirSync(src, { recursive: true })
  const plan = planBatchRename({ dshHome: options.dshHome, moves: [{ workspaceId: 'w1', currentPath: src, targetPath: dst }] })
  let restored = false
  const result = await applyBatchRename({
    options, plan,
    io: {
      snapshot: () => ({}),
      restore: () => { restored = true },
      relocateWorkspace: async () => { throw new Error('boom') },
      repointGroup: async () => {},
    },
  })
  assert.equal(result.ok, false)
  assert.equal(result.state, 'rolledback')
  assert.equal(restored, true)
  assert.equal(fs.existsSync(src), true, 'original directory restored')
  assert.equal(fs.existsSync(dst), false)
})

test('batch: boot recovery rolls back a non-terminal journal', () => {
  const { options, projects } = makeRoot()
  const src = path.join(projects, 'A-00-Old'); const moved = path.join(projects, 'A-00-New')
  fs.mkdirSync(moved, { recursive: true })
  fs.mkdirSync(path.join(options.stateDir, 'journal'), { recursive: true })
  fs.writeFileSync(
    path.join(options.stateDir, 'journal', 'batch.json'),
    JSON.stringify({ txid: 't', kind: 'rename-batch', state: 'files-ready', completed: [{ workspaceId: 'w1', from: src, to: moved }], staged: [] }),
  )
  const result = recoverBatchRename({ options, io: {} })
  assert.equal(result.state, 'rolledback')
  assert.equal(fs.existsSync(src), true)
})

test('batch: stagingPath is distinct from its target', () => {
  assert.notEqual(stagingPath('/p/A-00-X', 'tx'), '/p/A-00-X')
})

// --- orphan classifier -------------------------------------------------------

test('orphans: classification is read-only and reports counts', () => {
  const { options } = makeRoot()
  const result = classifyOrphanLogs({ dshHome: options.dshHome, workspaces: [] })
  assert.equal(result.destructive, false)
  assert.equal(result.total, 0)
  assert.deepEqual(result.counts, {})
})

// --- harness diet ------------------------------------------------------------

test('diet: token estimate is CJK-aware', () => {
  assert.equal(estimateTokens('a'.repeat(400)), 100)
  assert.ok(estimateTokens('가'.repeat(400)) > 400)
})

test('diet: budget audit flags an oversized AGENTS.md', () => {
  const { projects } = makeRoot()
  const sub = path.join(projects, 'UTM-01-Gate')
  fs.mkdirSync(sub, { recursive: true })
  fs.writeFileSync(path.join(sub, 'AGENTS.md'), 'x'.repeat(4000)) // ~1000 tokens > 600
  const result = auditResidentBudget({ subDir: sub })
  assert.equal(result.ok, false)
  assert.ok(result.violations.some((v) => v.code === 'BUDGET_EXCEEDED'))
})

test('diet: compliant sub-module passes', () => {
  const { projects } = makeRoot()
  const sub = path.join(projects, 'UTM-01-Gate')
  fs.mkdirSync(sub, { recursive: true })
  fs.writeFileSync(path.join(sub, 'AGENTS.md'), 'x'.repeat(800)) // ~200 tokens
  fs.writeFileSync(path.join(sub, 'BOOT_CARD.md'), 'x'.repeat(400)) // ~100 tokens
  const result = auditResidentBudget({ subDir: sub })
  assert.equal(result.ok, true)
  assert.ok(result.resident < DIET_BUDGETS.residentTotal)
})

test('diet: duplicated capsule headings are detected', () => {
  const { projects } = makeRoot()
  const capsule = path.join(projects, 'CAPSULE.md')
  fs.writeFileSync(capsule, '# G\n## Invariants\n## Sub-modules\n')
  const sub = path.join(projects, 'sub')
  fs.mkdirSync(sub, { recursive: true })
  fs.writeFileSync(path.join(sub, 'AGENTS.md'), '# sub\n## Invariants\n')
  assert.equal(detectDuplicatedCapsule(sub, capsule).duplicated, true)
})

test('diet: cross-group fork is blocked, same-group allowed', () => {
  assert.equal(checkCrossGroupFork({ sourceGroupId: 'g1', targetGroupId: 'g1' }).ok, true)
  const blocked = checkCrossGroupFork({ sourceGroupId: 'g1', targetGroupId: 'g2' })
  assert.equal(blocked.ok, false)
  assert.equal(blocked.code, 'CROSS_GROUP_FORK')
})

// --- routes ------------------------------------------------------------------

test('route: groups/orphans is read-only', async () => {
  const { options } = makeRoot()
  const ctx = { get: () => makeRegistry(), logger: { warn() {} } }
  const routes = createTransactionRoutes(ctx, options)
  const body = await (await routes['groups/orphans'](post({}))).json()
  assert.equal(body.ok, true)
  assert.equal(body.destructive, false)
})

test('route: groups/diet rejects a path outside projectsRoot', async () => {
  const { options } = makeRoot()
  const ctx = { get: () => makeRegistry(), logger: { warn() {} } }
  const routes = createTransactionRoutes(ctx, options)
  const response = await routes['groups/diet'](post({ subDir: '/etc' }))
  assert.equal(response.status, 409)
})

test('route: groups/hq/preview is read-only and validates the group', async () => {
  const { options, projects } = makeRoot()
  const ctx = { get: () => makeRegistry(), logger: { warn() {} } }
  const routes = createTransactionRoutes(ctx, options)
  const bad = await (await routes['groups/hq/preview'](post({ group: '' }))).json()
  assert.equal(bad.ok, false)
  const good = await (await routes['groups/hq/preview'](post({ group: 'UTM', main: 'Core' }))).json()
  assert.equal(good.ok, true)
  assert.equal(fs.existsSync(path.join(projects, 'UTM-00-Core')), false, 'preview creates nothing')
})

test('route: workspace/batch-rename/plan returns validation without mutating', async () => {
  const { options, projects } = makeRoot()
  const a = path.join(projects, 'A-00-X')
  fs.mkdirSync(a, { recursive: true })
  const ctx = { get: () => makeRegistry(), logger: { warn() {} } }
  const routes = createTransactionRoutes(ctx, options)
  const body = await (await routes['workspace/batch-rename/plan'](post({ moves: [{ workspaceId: 'w', currentPath: a, targetPath: path.join(projects, 'A-00-Y') }] }))).json()
  assert.equal(body.ok, true)
  assert.equal(fs.existsSync(path.join(projects, 'A-00-Y')), false)
})

test('route: groups/fork-policy blocks a cross-group fork', async () => {
  const { options } = makeRoot()
  upsertGroup(options, { groupId: 'g1', label: 'G1' })
  upsertGroup(options, { groupId: 'g2', label: 'G2' })
  assignMember(options, { workspaceId: 's', groupId: 'g1', path: '/p/s', title: 'S' })
  assignMember(options, { workspaceId: 't', groupId: 'g2', path: '/p/t', title: 'T' })
  const ctx = { get: () => makeRegistry(), logger: { warn() {} } }
  const routes = createTransactionRoutes(ctx, options)
  const body = await (await routes['groups/fork-policy'](post({ sourceWorkspaceId: 's', targetWorkspaceId: 't' }))).json()
  assert.equal(body.ok, false)
  assert.equal(body.code, 'CROSS_GROUP_FORK')
  assert.equal(readGroups(options).document.members.s.groupId, 'g1', 'policy check does not mutate')
})

// --- sub-agent guard (audit item 4) -----------------------------------------

test('subagent: origin=subagent is recognised even without a parent pointer', () => {
  assert.equal(isSubagentHeader({ origin: 'subagent' }), true)
  assert.equal(isSubagentHeader({ parentSession: 'p', delegationDepth: 1 }), true)
  assert.equal(isSubagentHeader({}), false)
})

test('subagent: inherits the parent workspace, never promotes independently', () => {
  const index = new Map([['session-parent', 'ws-1']])
  const inherited = attributeSession({ header: { origin: 'subagent', parentSession: 'session-parent', delegationDepth: 1 }, sessionToWorkspace: index })
  assert.equal(inherited.kind, 'subagent-inherited')
  assert.equal(inherited.workspaceId, 'ws-1')
})

test('subagent: unknown parent is reported, not silently dropped', () => {
  const decision = attributeSession({ header: { origin: 'subagent', parentSession: 'nope' }, sessionToWorkspace: new Map() })
  assert.equal(decision.kind, 'subagent-unattributed')
  assert.equal(decision.workspaceId, undefined)
})

test('subagent: a user session is classified primary', () => {
  const decision = attributeSession({ header: {}, sessionToWorkspace: new Map() })
  assert.equal(decision.kind, 'primary')
})

test('subagent: capture guard detects a newly leaked artifact', () => {
  const before = [{ sessionId: 'a', attributedWorkspaceId: 'ws' }]
  const clean = verifyCaptureGuard({ before, after: [...before, { sessionId: 'b', attributedWorkspaceId: 'ws' }] })
  assert.equal(clean.ok, true)
  const leaked = verifyCaptureGuard({ before, after: [...before, { sessionId: 'c', parentSession: 'x', attributedWorkspaceId: undefined }] })
  assert.equal(leaked.ok, false)
  assert.equal(leaked.leaked[0].sessionId, 'c')
})

test('subagent: audit over an empty home is empty and non-destructive', () => {
  const { options } = makeRoot()
  const result = auditSubagentArtifacts({ dshHome: options.dshHome, workspaces: [] })
  assert.equal(result.total, 0)
  assert.equal(result.destructive, false)
})

// --- promotion gate G1-G6 (audit item 6) -------------------------------------

test('gate: G1 reports GATE_NO_REPO outside a git work tree', () => {
  const { projects } = makeRoot()
  const result = gateG1({ root: projects })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'GATE_NO_REPO')
})

test('gate: G2 without a repo reports GATE_SKELETON_INVALID', () => {
  const { projects } = makeRoot()
  const result = gateG2({ root: projects })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'GATE_SKELETON_INVALID')
})

test('gate: G3 fails closed when the skeleton manifest is absent', () => {
  const { projects } = makeRoot()
  const result = gateG3({ root: projects })
  assert.equal(result.ok, false)
  assert.equal(result.code, 'GATE_SKELETON_HASH_MISMATCH')
})

test('gate: G4 defers execution in preview mode and honours .upm/gate.json', () => {
  const { projects } = makeRoot()
  fs.mkdirSync(path.join(projects, '.upm'), { recursive: true })
  fs.writeFileSync(path.join(projects, '.upm', 'gate.json'), JSON.stringify({ requiredGates: ['true'] }))
  const deferred = gateG4({ root: projects, runTests: false })
  assert.equal(deferred.ok, true)
  assert.equal(deferred.skipped, true)
  assert.deepEqual(deferred.required, ['true'])
  const executed = gateG4({ root: projects, runTests: true })
  assert.equal(executed.ok, true)
})

test('gate: G6 requires AGENTS.md + promotion-capsule.json', () => {
  const { projects } = makeRoot()
  const missing = gateG6({ root: projects })
  assert.equal(missing.ok, false)
  assert.equal(missing.code, 'GATE_CONTEXT_INVALID')
  fs.writeFileSync(path.join(projects, 'AGENTS.md'), '# agents\n')
  fs.writeFileSync(path.join(projects, 'promotion-capsule.json'), JSON.stringify({ ok: true }))
  const present = gateG6({ root: projects })
  assert.equal(present.ok, true, JSON.stringify(present.problems))
})

test('gate: G6 flags a secret pattern in an instruction file', () => {
  const { projects } = makeRoot()
  fs.writeFileSync(path.join(projects, 'AGENTS.md'), 'token: sk-ABCDEFGHIJKLMNOPQRSTUVWXYZ\n')
  fs.writeFileSync(path.join(projects, 'promotion-capsule.json'), JSON.stringify({ ok: true }))
  const result = gateG6({ root: projects })
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((p) => p.includes('possible secret')))
})

test('gate: full run reports blocker codes and never throws', () => {
  const { projects } = makeRoot()
  const result = runPromotionGate({ root: projects })
  assert.equal(result.ok, false)
  assert.ok(result.blockerCodes.includes('GATE_NO_REPO'))
  assert.equal(result.results.length, 6)
})

test('route: promotion/gate rejects a root outside projectsRoot', async () => {
  const { options } = makeRoot()
  const ctx = { get: () => makeRegistry(), logger: { warn() {} } }
  const routes = createTransactionRoutes(ctx, options)
  const response = await routes['promotion/gate'](post({ root: '/etc' }))
  assert.equal(response.status, 409)
})

// --- workspace lifecycle / deprecated target exclusion -----------------------

test('lifecycle: minamiv21 is recorded as awaiting decommission and excluded', () => {
  const resolved = lifecycleStatus({ path: '/home/minami/Workspace/projects/minamiv21' })
  assert.equal(resolved.excluded, true)
  assert.equal(resolved.status, 'awaiting-decommission')
  assert.equal(resolved.record.successor, 'DSH (DeepSeek Harness)')
})

test('lifecycle: active DSH workspaces are not excluded', () => {
  for (const p of ['/home/minami/Workspace/projects/Core-00-System', '/home/minami/Workspace/projects/dsh-workspace']) {
    assert.equal(lifecycleStatus({ path: p }).excluded, false, p)
  }
})

test('lifecycle: the governance guard refuses a deprecated target', () => {
  const guarded = assertGovernanceTarget({ path: '/home/minami/Workspace/projects/minamiv21' })
  assert.equal(guarded.ok, false)
  assert.equal(guarded.code, 'TARGET_DEPRECATED')
})

test('lifecycle: eligible target list excludes deprecated trees only', () => {
  const targets = activeGovernanceTargets([
    { id: '1', title: 'Core-00-System', path: '/p/Core-00-System' },
    { id: '2', title: 'minamiv21', path: '/p/minamiv21' },
  ])
  assert.deepEqual(targets.map((t) => t.id), ['1'])
})

test('route: promotion/gate refuses a deprecated target instead of auditing it', async () => {
  const { options } = makeRoot()
  // Place a deprecated-named tree inside projectsRoot so the path check passes.
  const deprecated = path.join(options.projectsRoot, 'minamiv21')
  fs.mkdirSync(deprecated, { recursive: true })
  const ctx = { get: () => makeRegistry(), logger: { warn() {} } }
  const routes = createTransactionRoutes(ctx, options)
  const response = await routes['promotion/gate'](post({ root: deprecated }))
  assert.equal(response.status, 409)
  const body = await response.json()
  assert.equal(body.skipped, true)
  assert.equal(body.blockerCodes[0], 'TARGET_DEPRECATED')
})
