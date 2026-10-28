/**
 * Sidebar Manager — Host transaction core.
 *
 * Two-phase design across a DSH restart:
 *   Phase A (online): validate guards, snapshot backups, write a journal,
 *     rewrite session logs to the new cwd/projectKey, then return
 *     `restartRequired: true`. Registry membership is NOT mutated because the
 *     workspace service caches session headers until the next process start.
 *   Phase B (next boot, plugin apply): after the registry re-indexed headers
 *     from disk, attach/detach sessions, create/remove workspaces, and mark the
 *     journal committed.
 *
 * Public services only: connection, workspaceRegistry, sessionPersistence,
 * agents, sessions. Filesystem work is limited to the DSH home (sessions,
 * projcache, backup, sidebar-manager state).
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import {
  buildCloned,
  buildRelocated,
  expectedLogPath,
  findLogFile,
  patchProjcache,
  projcachePath,
  projectKey,
  readLogFile,
  verifyCloned,
  verifyRelocated,
} from './session-log.mjs'
import { buildGroupedView, listGroups, readGroups, refreshFingerprint, repointWorkspace, upsertGroup, assignMember, removeMember, planSidebarOrder } from './groups.mjs'
import { validateBatchRename, verifyBatchOutcome, parseGroupedName } from './batch-validate.mjs'
import { buildHqTree } from './hq-tree.mjs'
import { promoteHq, previewHq } from './hq-promote.mjs'
import { planBatchRename, applyBatchRename, readBatchJournal, recoverBatchRename } from './batch-rename.mjs'
import { classifyOrphanLogs } from './orphan-classifier.mjs'
import { auditResidentBudget, checkCrossGroupFork } from './harness-diet.mjs'
import { auditSubagentArtifacts } from './subagent-guard.mjs'
import { runPromotionGate } from './promotion-gate.mjs'
import { buildAdvisoryReport, evaluateMutation } from './contract-advisory.mjs'
import { assertGovernanceTarget, DEPRECATED_WORKSPACES } from './workspace-lifecycle.mjs'

const DEFAULT_PROJECTS_ROOT = path.join(os.homedir(), 'Workspace', 'projects')
const JOURNAL_DIR = 'journal'

function dshHome() {
  const configured = process.env.DSH_HOME
  return configured && configured.trim() !== '' ? configured : path.join(os.homedir(), '.dsh')
}

export function resolveOptions(config = {}) {
  // `dshHome` is overridable so tests and dry runs can be rooted in a throwaway
  // directory. Without this, an explicit temp root still resolved the DSH home
  // from the ambient environment and wrote to the *live* ~/.dsh.
  const home =
    typeof config.dshHome === 'string' && config.dshHome.trim() !== '' ? config.dshHome : dshHome()
  return {
    dshHome: home,
    backupDir: config.backupDir || path.join(home, 'backup'),
    stateDir: config.stateDir || path.join(home, 'sidebar-manager'),
    projectsRoot: config.projectsRoot || DEFAULT_PROJECTS_ROOT,
    allowExternalPaths: config.allowExternalPaths === true,
    trashRetentionDays:
      Number.isInteger(config.trashRetentionDays) && config.trashRetentionDays >= 0
        ? config.trashRetentionDays
        : 30,
  }
}

function json(body, status = 200) {
  return Response.json(body, { status })
}

function blocker(code, extra = {}) {
  return { code, ...extra }
}

function blocked(blockerCodes, extra = {}) {
  return json({ ok: false, blockerCodes, blockers: blockerCodes.map((entry) => entry.code), ...extra }, 409)
}

function newTxid(kind) {
  return `${kind}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
}

function normalize(value) {
  return path.resolve(value).replace(/\\/g, '/').toLowerCase()
}

function samePath(left, right) {
  return normalize(left) === normalize(right)
}

function isAbsolutePath(value) {
  return typeof value === 'string' && (path.isAbsolute(value) || path.win32.isAbsolute(value))
}

function isUnder(root, target) {
  const base = normalize(root).replace(/\/+$/, '')
  const candidate = normalize(target)
  return candidate === base || candidate.startsWith(`${base}/`)
}

function slug(value) {
  const text = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, '-')
    .replace(/^-+|-+$/g, '')
  return text === '' ? 'new-project' : text
}

function liveSessionIds(ctx, ids) {
  const agents = ctx.get('agents')
  const sessions = ctx.get('sessions')
  return ids.filter((id) => Boolean(agents?.get(id) ?? sessions?.get(id)))
}

async function listHeaders(ctx) {
  const persistence = ctx.get('sessionPersistence')
  if (persistence === undefined) throw new Error('sessionPersistence is unavailable')
  return (await persistence.list()).map((snapshot) => snapshot.header)
}

function isArchived(ctx, sessionId) {
  return ctx.get('workspaceRegistry')?.archivedSessionIds?.includes(sessionId) === true
}

function readWorkspaceFile(options) {
  const file = path.join(options.dshHome, 'storages', 'workspace.json')
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function defaultWorkspaceId(options) {
  return readWorkspaceFile(options)?.global?.defaultWorkspaceId
}

function journalFile(options) {
  return path.join(options.stateDir, JOURNAL_DIR, 'pending.json')
}

function readJournal(options) {
  const file = journalFile(options)
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : undefined
}

function writeJournal(options, journal) {
  const file = journalFile(options)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temp, `${JSON.stringify(journal, null, 2)}\n`)
  fs.renameSync(temp, file)
}

function stateFile(options) {
  return path.join(options.stateDir, 'state.json')
}

function readState(options) {
  try {
    const state = JSON.parse(fs.readFileSync(stateFile(options), 'utf8'))
    return { archivedWorkspaces: {}, ...state }
  } catch {
    return { archivedWorkspaces: {} }
  }
}

function writeState(options, state) {
  fs.mkdirSync(options.stateDir, { recursive: true })
  const file = stateFile(options)
  const temp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temp, `${JSON.stringify(state, null, 2)}\n`)
  fs.renameSync(temp, file)
}

function backupSession(options, backupDir, id, header) {
  const log = findLogFile(options.dshHome, id) ?? expectedLogPath(options.dshHome, header?.cwd ?? '', id)
  if (fs.existsSync(log)) {
    const target = path.join(backupDir, 'sessions', projectKey(header?.cwd ?? ''), id, 'session.v4.jsonl.zstd')
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(log, target)
  }
  const cache = projcachePath(options.dshHome, id)
  if (fs.existsSync(cache)) {
    const target = path.join(backupDir, 'projcache', `${id}.json`)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(cache, target)
  }
}

function workspaceFilePath(options) {
  return path.join(options.dshHome, 'storages', 'workspace.json')
}

/**
 * Snapshot ONLY the registry records this transaction can touch.
 *
 * Replaces the historical whole-file copy. UTM invariant 4 forbids restoring
 * `workspace.json` wholesale because any workspace registered after the backup
 * would be silently erased (see INCIDENT-2026-10-24-workspace-json). The
 * snapshot keeps the pre-image of the individual records plus the global order
 * array, so rollback can put back exactly what it changed.
 */
export function backupWorkspaceRecords(options, backupDir, { workspaceIds = [] } = {}) {
  const file = workspaceFilePath(options)
  if (!fs.existsSync(file)) return
  const document = JSON.parse(fs.readFileSync(file, 'utf8'))
  const workspaces = document?.tables?.workspaces ?? {}
  const records = {}
  for (const id of workspaceIds) {
    if (id === undefined || id === null) continue
    if (workspaces[id] !== undefined) records[id] = workspaces[id]
  }
  const snapshot = {
    unit: document?.unit,
    defaultWorkspaceId: document?.global?.defaultWorkspaceId,
    workspaceIds: document?.global?.workspaceIds ?? [],
    records,
  }
  fs.mkdirSync(backupDir, { recursive: true })
  fs.writeFileSync(path.join(backupDir, 'workspace-records.json'), `${JSON.stringify(snapshot, null, 2)}\n`)
}

function readWorkspaceDocument(options) {
  const file = workspaceFilePath(options)
  if (!fs.existsSync(file)) return undefined
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function writeWorkspaceDocument(options, document) {
  const file = workspaceFilePath(options)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temp, `${JSON.stringify(document, null, 2)}\n`)
  fs.renameSync(temp, file)
}

/**
 * Restore ONLY the records in the snapshot. Records created after the snapshot
 * are left untouched; records present in the snapshot but missing now are
 * re-created; the order array is restored only if every original member still
 * exists (otherwise we would drop concurrently-added workspaces from the order).
 */
export function restoreWorkspaceRecords(options, backupDir) {
  const source = path.join(backupDir, 'workspace-records.json')
  if (!fs.existsSync(source)) return { restored: [], skipped: ['no-snapshot'], preserved: [] }
  const snapshot = JSON.parse(fs.readFileSync(source, 'utf8'))
  const document = readWorkspaceDocument(options)
  if (document === undefined) return { restored: [], skipped: ['no-workspace-json'], preserved: [] }
  document.tables = document.tables ?? {}
  document.tables.workspaces = document.tables.workspaces ?? {}
  const restored = []
  const preserved = []
  for (const [id, record] of Object.entries(snapshot.records ?? {})) {
    const current = document.tables.workspaces[id]
    if (current === undefined) {
      document.tables.workspaces[id] = record
      restored.push(id)
    } else if (JSON.stringify(current) !== JSON.stringify(record)) {
      document.tables.workspaces[id] = record
      restored.push(id)
    } else {
      preserved.push(id)
    }
  }
  const currentOrder = document.global?.workspaceIds ?? []
  const snapshotOrder = snapshot.workspaceIds ?? []
  const allPresent = snapshotOrder.every((id) => document.tables.workspaces[id] !== undefined)
  if (allPresent) {
    const appended = currentOrder.filter((id) => !snapshotOrder.includes(id))
    document.global = document.global ?? {}
    document.global.workspaceIds = [...snapshotOrder, ...appended]
  }
  writeWorkspaceDocument(options, document)
  return { restored, skipped: [], preserved }
}

function restoreSession(options, backupDir, id, cwd) {
  const source = path.join(backupDir, 'sessions', projectKey(cwd), id, 'session.v4.jsonl.zstd')
  if (!fs.existsSync(source)) return
  const target = expectedLogPath(options.dshHome, cwd, id)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.copyFileSync(source, target)
  const cache = path.join(backupDir, 'projcache', `${id}.json`)
  if (fs.existsSync(cache)) {
    const targetCache = projcachePath(options.dshHome, id)
    fs.mkdirSync(path.dirname(targetCache), { recursive: true })
    fs.copyFileSync(cache, targetCache)
  }
}

function relocateSession(options, id, oldCwd, newCwd, txid) {
  const source = findLogFile(options.dshHome, id) ?? expectedLogPath(options.dshHome, oldCwd, id)
  if (!fs.existsSync(source)) throw new Error(`session log not found for ${id}`)
  const target = expectedLogPath(options.dshHome, newCwd, id)
  if (fs.existsSync(target)) throw new Error(`target log already exists for ${id}`)
  const log = readLogFile(source)
  if (log.tornStart !== undefined) throw new Error(`session log has a torn tail: ${id}`)
  const out = buildRelocated(log, newCwd)
  fs.mkdirSync(path.dirname(target), { recursive: true })
  const staging = `${target}.tmp-${txid}`
  fs.writeFileSync(staging, out)
  verifyRelocated(log, out, newCwd, id)
  fs.renameSync(staging, target)
  const committed = readLogFile(target)
  if (committed.header.cwd !== newCwd) throw new Error(`relocated header cwd mismatch for ${id}`)
  patchProjcache(projcachePath(options.dshHome, id), newCwd)
  return { source, target }
}

function removeFileBestEffort(file) {
  try {
    fs.rmSync(file, { force: true })
  } catch {
    /* best effort */
  }
}

function removeEmptyProjectDir(options, cwd) {
  try {
    const dir = path.join(options.dshHome, 'sessions', projectKey(cwd))
    if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) fs.rmdirSync(dir)
  } catch {
    /* best effort */
  }
}

async function rollbackJournal(options, journal) {
  const registryRestore = restoreWorkspaceRecords(options, journal.backupDir)
  if (journal.dirRenamed === true && fs.existsSync(journal.newPath) && !fs.existsSync(journal.oldPath)) {
    fs.renameSync(journal.newPath, journal.oldPath)
  }
  const newProjectDir = path.join(options.dshHome, 'sessions', projectKey(journal.newPath))
  fs.rmSync(newProjectDir, { recursive: true, force: true })
  for (const id of journal.allSessions ?? [journal.sessionId].filter(Boolean)) {
    restoreSession(options, journal.backupDir, id, journal.oldPath)
  }
  removeEmptyProjectDir(options, journal.newPath)
  journal.state = 'rolledback'
  writeJournal(options, journal)
}

async function finalizeMove(ctx, options, journal) {
  const registry = ctx.get('workspaceRegistry')
  const target = registry.get(journal.targetWorkspaceId)
  if (target === undefined) throw new Error(`target workspace missing: ${journal.targetWorkspaceId}`)
  if (!target.record.sessionIds.includes(journal.sessionId)) await target.attachSession(journal.sessionId)
  for (const workspace of registry.list()) {
    if (String(workspace.id) === String(target.id)) continue
    if (workspace.record.sessionIds.includes(journal.sessionId)) await workspace.detachSession(journal.sessionId)
  }
  journal.state = 'committed'
  writeJournal(options, journal)
  return { state: 'committed' }
}

async function finalizeFork(ctx, options, journal) {
  const registry = ctx.get('workspaceRegistry')
  const target = registry.get(journal.targetWorkspaceId)
  if (target === undefined) throw new Error(`fork workspace missing: ${journal.targetWorkspaceId}`)
  if (!target.record.sessionIds.includes(journal.sessionId)) await target.attachSession(journal.sessionId)
  for (const workspace of registry.list()) {
    if (String(workspace.id) === String(target.id)) continue
    if (workspace.record.sessionIds.includes(journal.sessionId)) await workspace.detachSession(journal.sessionId)
  }
  journal.state = 'committed'
  writeJournal(options, journal)
  return { state: 'committed' }
}

async function finalizeRename(ctx, options, journal) {
  const registry = ctx.get('workspaceRegistry')
  let target = registry.list().find((workspace) => samePath(workspace.path, journal.newPath))
  if (target === undefined) target = await registry.create(journal.newPath, journal.title)
  if (journal.accounted.length > 0) {
    for (const id of journal.accounted) {
      if (!target.record.sessionIds.includes(id)) await target.attachSession(id)
    }
  }
  await target.setTitle(journal.title)
  if (journal.beforeWorkspaceId !== undefined && registry.get(journal.beforeWorkspaceId) !== undefined) {
    await registry.insertBefore(target.id, journal.beforeWorkspaceId)
  } else if (journal.orderIndex !== undefined) {
    await registry.insertBefore(target.id, undefined)
  }
  const old = registry.get(journal.oldWorkspaceId)
  if (old !== undefined) {
    for (const id of journal.accounted) {
      if (old.record.sessionIds.includes(id)) await old.detachSession(id)
    }
    await registry.delete(journal.oldWorkspaceId)
  }
  fs.rmSync(path.join(options.dshHome, 'sessions', projectKey(journal.oldPath)), { recursive: true, force: true })
  // The registry id changes here, so any virtual-group membership must follow it
  // or the workspace silently drops out of its group. Best-effort: never let a
  // grouping defect block a completed file transaction.
  try {
    repointWorkspace(options, {
      fromId: journal.oldWorkspaceId,
      toId: String(target.id),
      path: journal.newPath,
      title: journal.title,
    })
  } catch (error) {
    ctx.logger?.warn?.('group repoint failed after rename; membership may be stale', error)
  }
  journal.state = 'committed'
  writeJournal(options, journal)
  return { state: 'committed', newWorkspaceId: String(target.id) }
}

export async function finalizePending(ctx, options = resolveOptions()) {
  // Promotion journals live in their own directory so a crashed promotion never
  // collides with the move/fork/rename journal lifecycle below.
  const promotion = await finalizePendingPromotion(ctx, options)
  if (promotion.state !== 'none') return { kind: 'promotion', ...promotion }

  const journal = readJournal(options)
  if (journal === undefined) return { state: 'none' }
  if (journal.state === 'committed' || journal.state === 'rolledback') return { state: journal.state }
  if (journal.state === 'prepared' || journal.state === 'dir-renamed') {
    await rollbackJournal(options, journal)
    if (journal.kind === 'fork' && journal.createdWorkspaceId !== undefined) {
      const registry = ctx.get('workspaceRegistry')
      const created = registry.get(journal.createdWorkspaceId)
      if (created !== undefined) await registry.delete(created.id)
    }
    return { state: 'rolledback' }
  }
  if (journal.state !== 'files-ready') return { state: journal.state }
  if (journal.kind === 'move') return finalizeMove(ctx, options, journal)
  if (journal.kind === 'fork') return finalizeFork(ctx, options, journal)
  if (journal.kind === 'rename') return finalizeRename(ctx, options, journal)
  throw new Error(`unknown journal kind: ${journal.kind}`)
}

async function previewMove(ctx, body) {
  const registry = ctx.get('workspaceRegistry')
  const headers = await listHeaders(ctx)
  const header = headers.find((entry) => entry.id === body.sessionId)
  const target = typeof body.targetWorkspaceId === 'string' ? registry.get(body.targetWorkspaceId) : undefined
  const current = header === undefined ? undefined : await registry.resolveByPath(header.cwd)
  const liveCount = header === undefined ? 0 : liveSessionIds(ctx, [header.id]).length
  const blockerCodes = []
  if (header === undefined) blockerCodes.push(blocker('SESSION_MISSING'))
  if (target === undefined) blockerCodes.push(blocker('WORKSPACE_MISSING'))
  if (current !== undefined && target !== undefined && String(current.id) === String(target.id)) blockerCodes.push(blocker('SAME_WORKSPACE'))
  if (liveCount > 0) blockerCodes.push(blocker('SESSION_LIVE', { count: liveCount }))
  if (target !== undefined && !fs.existsSync(target.path)) blockerCodes.push(blocker('WORKSPACE_DIR_MISSING', { path: target.path }))
  return {
    ok: blockerCodes.length === 0,
    affectedSessionCount: header === undefined ? 0 : 1,
    liveSessionCount: liveCount,
    oldPath: header?.cwd,
    newPath: target?.path,
    workspaceTitle: target?.title,
    targetWorkspaceId: target === undefined ? undefined : String(target.id),
    blockerCodes,
  }
}

async function previewRename(ctx, options, body) {
  const registry = ctx.get('workspaceRegistry')
  const workspace = registry.get(body.workspaceId)
  if (workspace === undefined) return { ok: false, affectedSessionCount: 0, blockerCodes: [blocker('WORKSPACE_MISSING')] }
  const headers = await listHeaders(ctx)
  const affected = headers.filter((header) => samePath(header.cwd, workspace.path))
  const liveCount = liveSessionIds(ctx, affected.map((header) => header.id)).length
  const folderRename = body.folderRename === true
  const folderName = String(body.folderName ?? '').trim()
  const newPath = path.join(path.dirname(workspace.path), folderName)
  const blockerCodes = []
  if (String(body.title ?? '').trim() === '') blockerCodes.push(blocker('TITLE_BLANK'))
  if (folderRename && folderName === '') blockerCodes.push(blocker('FOLDER_BLANK'))
  if (folderRename && (folderName.includes('/') || folderName.includes('\\') || folderName === '.' || folderName === '..')) {
    blockerCodes.push(blocker('FOLDER_INVALID'))
  }
  if (folderRename && defaultWorkspaceId(options) === String(workspace.id)) blockerCodes.push(blocker('DEFAULT_WORKSPACE'))
  if (folderRename && samePath(workspace.path, newPath)) blockerCodes.push(blocker('SAME_PATH'))
  if (folderRename && fs.existsSync(newPath)) blockerCodes.push(blocker('TARGET_EXISTS', { path: newPath }))
  if (folderRename && liveCount > 0) blockerCodes.push(blocker('SESSION_LIVE', { count: liveCount }))
  return {
    ok: blockerCodes.length === 0,
    affectedSessionCount: affected.length,
    liveSessionCount: liveCount,
    oldPath: workspace.path,
    newPath: folderRename ? newPath : workspace.path,
    workspaceTitle: String(body.title ?? workspace.title),
    workspaceId: String(workspace.id),
    blockerCodes,
  }
}

async function previewFork(ctx, options, body) {
  const headers = await listHeaders(ctx)
  const header = headers.find((entry) => entry.id === body.sessionId)
  const title = String(body.title ?? '').trim()
  const requested = typeof body.path === 'string' ? body.path.trim() : ''
  const suggested = path.join(options.projectsRoot, slug(title || body.sessionId || 'fork'))
  const targetPath = requested === '' ? suggested : requested
  const liveCount = header === undefined ? 0 : liveSessionIds(ctx, [header.id]).length
  const blockerCodes = []
  if (header === undefined) blockerCodes.push(blocker('SESSION_MISSING'))
  if (title === '') blockerCodes.push(blocker('TITLE_BLANK'))
  if (!isAbsolutePath(targetPath)) blockerCodes.push(blocker('PATH_ABSOLUTE'))
  if (isAbsolutePath(targetPath) && !options.allowExternalPaths && !isUnder(options.projectsRoot, targetPath)) {
    blockerCodes.push(blocker('EXTERNAL_PATH'))
  }
  if (isAbsolutePath(targetPath) && fs.existsSync(targetPath)) {
    const stats = fs.statSync(targetPath)
    if (!stats.isDirectory() || fs.readdirSync(targetPath).length > 0) {
      blockerCodes.push(blocker('TARGET_EXISTS', { path: targetPath }))
    }
  }
  if (liveCount > 0) blockerCodes.push(blocker('SESSION_LIVE', { count: liveCount }))
  return {
    ok: blockerCodes.length === 0,
    affectedSessionCount: header === undefined ? 0 : 1,
    liveSessionCount: liveCount,
    oldPath: header?.cwd,
    newPath: targetPath,
    workspaceTitle: title,
    suggestedPath: suggested,
    blockerCodes,
  }
}

async function handlePurge(ctx, options, body) {
  const registry = ctx.get('workspaceRegistry')
  const id = String(body.sessionId ?? '')
  if (id === '') return blocked([blocker('SESSION_MISSING')])
  const headers = await listHeaders(ctx)
  const header = headers.find((entry) => entry.id === id)
  if (header === undefined) return blocked([blocker('SESSION_MISSING')])
  if (!isArchived(ctx, id)) return blocked([blocker('NOT_ARCHIVED')])
  const live = liveSessionIds(ctx, [id])
  if (live.length > 0) return blocked([blocker('SESSION_LIVE', { count: live.length })])

  const txid = newTxid('purge')
  const backupDir = path.join(options.backupDir, txid)
  fs.mkdirSync(backupDir, { recursive: true })
  backupWorkspaceRecords(options, backupDir, {
    workspaceIds: registry.list().filter((item) => item.record.sessionIds.includes(id)).map((item) => item.id),
  })
  backupSession(options, backupDir, id, header)

  await registry.unarchiveSession(id)
  await registry.unpinSession(id)
  for (const workspace of registry.list()) {
    if (workspace.record.sessionIds.includes(id)) await workspace.detachSession(id)
  }
  const log = findLogFile(options.dshHome, id)
  if (log !== undefined) fs.rmSync(path.dirname(log), { recursive: true, force: true })
  removeFileBestEffort(projcachePath(options.dshHome, id))
  removeEmptyProjectDir(options, header.cwd)
  return json({ ok: true, deleted: true, backupDir })
}

async function handleArchiveWorkspace(ctx, options, body) {
  const registry = ctx.get('workspaceRegistry')
  const id = String(body.workspaceId ?? '')
  const workspace = registry.get(id)
  if (workspace === undefined) return blocked([blocker('WORKSPACE_MISSING')])
  if (defaultWorkspaceId(options) === id) return blocked([blocker('DEFAULT_WORKSPACE')])
  const headers = await listHeaders(ctx)
  const affected = headers.filter((header) => samePath(header.cwd, workspace.path))
  const live = liveSessionIds(ctx, affected.map((header) => header.id))
  if (live.length > 0) return blocked([blocker('SESSION_LIVE', { count: live.length })])

  const order = registry.list()
  const orderIndex = order.findIndex((entry) => String(entry.id) === id)
  const beforeWorkspaceId = orderIndex >= 0 ? order[orderIndex + 1]?.id : undefined
  const state = readState(options)
  state.archivedWorkspaces[id] = {
    workspaceId: id,
    path: workspace.path,
    title: workspace.title,
    sessionIds: [...workspace.record.sessionIds],
    allSessionIds: affected.map((header) => header.id),
    orderIndex,
    beforeWorkspaceId: beforeWorkspaceId === undefined ? undefined : String(beforeWorkspaceId),
    archivedAt: new Date().toISOString(),
  }
  writeState(options, state)
  const archived = []
  try {
    for (const header of affected) {
      if (!isArchived(ctx, header.id)) {
        await registry.archiveSession(header.id)
        archived.push(header.id)
      }
    }
    await registry.delete(id)
  } catch (error) {
    for (const sessionId of archived) {
      try {
        await registry.unarchiveSession(sessionId)
      } catch {
        /* best effort */
      }
    }
    delete state.archivedWorkspaces[id]
    writeState(options, state)
    throw error
  }
  return json({ ok: true, archived: true, workspaceId: id })
}

async function handleArchivedList(ctx, options) {
  const state = readState(options)
  const items = Object.values(state.archivedWorkspaces).sort(
    (left, right) => (left.orderIndex ?? 0) - (right.orderIndex ?? 0),
  )
  return json({ ok: true, items })
}

async function handleRestoreWorkspace(ctx, options, body) {
  const registry = ctx.get('workspaceRegistry')
  const id = String(body.workspaceId ?? '')
  const state = readState(options)
  const entry = state.archivedWorkspaces[id]
  if (entry === undefined) return blocked([blocker('ARCHIVE_MISSING')])
  if (!fs.existsSync(entry.path)) {
    try {
      fs.mkdirSync(entry.path, { recursive: true })
    } catch {
      return blocked([blocker('WORKSPACE_DIR_MISSING', { path: entry.path })])
    }
  }
  let workspace = registry.list().find((item) => samePath(item.path, entry.path))
  if (workspace === undefined) workspace = await registry.create(entry.path, entry.title)
  await workspace.setTitle(entry.title)
  for (const sessionId of entry.allSessionIds ?? entry.sessionIds) {
    if (isArchived(ctx, sessionId)) {
      try {
        await registry.unarchiveSession(sessionId)
      } catch {
        /* the session may already be gone */
      }
    }
  }
  for (const sessionId of entry.sessionIds) {
    if (!workspace.record.sessionIds.includes(sessionId)) await workspace.attachSession(sessionId)
  }
  if (entry.beforeWorkspaceId !== undefined && registry.get(entry.beforeWorkspaceId) !== undefined) {
    await registry.insertBefore(workspace.id, entry.beforeWorkspaceId)
  } else if (entry.orderIndex !== undefined) {
    await registry.insertBefore(workspace.id, undefined)
  }
  delete state.archivedWorkspaces[id]
  writeState(options, state)
  try {
    repointWorkspace(options, {
      fromId: id,
      toId: String(workspace.id),
      path: workspace.path,
      title: workspace.title,
    })
  } catch (error) {
    ctx.logger?.warn?.('group repoint failed after restore; membership may be stale', error)
  }
  return json({ ok: true, restored: true, workspaceId: String(workspace.id) })
}

function sessionHeaderFor(headers, id) {
  return headers.find((header) => header.id === id)
}

function previewBlocked(result) {
  return blocked(result.blockerCodes ?? [], {
    affectedSessionCount: result.affectedSessionCount,
    liveSessionCount: result.liveSessionCount,
    oldPath: result.oldPath,
    newPath: result.newPath,
    workspaceTitle: result.workspaceTitle,
  })
}

async function handleMove(ctx, options, body) {
  const result = await previewMove(ctx, body)
  if (!result.ok) return previewBlocked(result)
  const headers = await listHeaders(ctx)
  const header = sessionHeaderFor(headers, body.sessionId)
  const txid = newTxid('move')
  const backupDir = path.join(options.backupDir, txid)
  fs.mkdirSync(backupDir, { recursive: true })
  backupWorkspaceRecords(options, backupDir, {
    workspaceIds: [
      ...registry.list().filter((item) => item.record.sessionIds.includes(header.id)).map((item) => item.id),
      body.targetWorkspaceId,
    ].filter((value) => value !== undefined),
  })
  backupSession(options, backupDir, header.id, header)
  const journal = {
    txid,
    kind: 'move',
    state: 'prepared',
    sessionId: header.id,
    oldPath: header.cwd,
    newPath: result.newPath,
    targetWorkspaceId: result.targetWorkspaceId,
    backupDir,
  }
  writeJournal(options, journal)
  try {
    const moved = relocateSession(options, header.id, header.cwd, result.newPath, txid)
    journal.oldLog = path.dirname(moved.source)
    fs.rmSync(path.dirname(moved.source), { recursive: true, force: true })
    removeEmptyProjectDir(options, header.cwd)
    journal.state = 'files-ready'
    writeJournal(options, journal)
    return json({ ok: true, restartRequired: true, txid })
  } catch (error) {
    await rollbackJournal(options, journal)
    throw error
  }
}

async function handleRenameFolder(ctx, options, body) {
  const result = await previewRename(ctx, options, body)
  if (!result.ok) return previewBlocked(result)
  const registry = ctx.get('workspaceRegistry')
  const workspace = registry.get(body.workspaceId)
  if (body.folderRename !== true) {
    await workspace.setTitle(String(body.title))
    try {
      refreshFingerprint(options, { workspaceId: workspace.id, path: workspace.path, title: String(body.title) })
    } catch (error) {
      ctx.logger?.warn?.('group fingerprint refresh failed after title change', error)
    }
    return json({ ok: true, restartRequired: false })
  }
  const headers = await listHeaders(ctx)
  const affected = headers.filter((header) => samePath(header.cwd, workspace.path))
  const order = registry.list()
  const orderIndex = order.findIndex((entry) => String(entry.id) === String(workspace.id))
  const beforeWorkspaceId = orderIndex >= 0 ? order[orderIndex + 1]?.id : undefined
  const txid = newTxid('rename')
  const backupDir = path.join(options.backupDir, txid)
  fs.mkdirSync(backupDir, { recursive: true })
  backupWorkspaceRecords(options, backupDir, { workspaceIds: [workspace.id] })
  for (const header of affected) backupSession(options, backupDir, header.id, header)
  const journal = {
    txid,
    kind: 'rename',
    state: 'prepared',
    workspaceId: String(workspace.id),
    oldPath: workspace.path,
    newPath: result.newPath,
    title: String(body.title),
    accounted: [...workspace.record.sessionIds],
    allSessions: affected.map((header) => header.id),
    oldWorkspaceId: String(workspace.id),
    beforeWorkspaceId: beforeWorkspaceId === undefined ? undefined : String(beforeWorkspaceId),
    orderIndex,
    backupDir,
  }
  writeJournal(options, journal)
  try {
    fs.renameSync(workspace.path, result.newPath)
    journal.dirRenamed = true
    journal.state = 'dir-renamed'
    writeJournal(options, journal)
    for (const header of affected) relocateSession(options, header.id, workspace.path, result.newPath, txid)
    fs.rmSync(path.join(options.dshHome, 'sessions', projectKey(workspace.path)), { recursive: true, force: true })
    journal.state = 'files-ready'
    writeJournal(options, journal)
    return json({ ok: true, restartRequired: true, txid })
  } catch (error) {
    await rollbackJournal(options, journal)
    throw error
  }
}

function cloneProjcache(options, sourceId, childId, targetCwd) {
  const source = projcachePath(options.dshHome, sourceId)
  if (!fs.existsSync(source)) return false
  const target = projcachePath(options.dshHome, childId)
  const document = JSON.parse(fs.readFileSync(source, 'utf8'))
  if (document.record?.identity) document.record.identity.cwd = targetCwd
  if (document.record?.rows?.workingDirectory) document.record.rows.workingDirectory.val = targetCwd
  fs.mkdirSync(path.dirname(target), { recursive: true })
  fs.writeFileSync(target, `${JSON.stringify(document, null, 2)}\n`)
  return true
}

async function handleFork(ctx, options, body) {
  const result = await previewFork(ctx, options, body)
  if (!result.ok) return previewBlocked(result)
  const registry = ctx.get('workspaceRegistry')
  const headers = await listHeaders(ctx)
  const sourceHeader = sessionHeaderFor(headers, body.sessionId)
  const sourceLog = findLogFile(options.dshHome, body.sessionId)
  if (sourceHeader === undefined || sourceLog === undefined) return blocked([blocker('SESSION_MISSING')])
  const targetPath = result.newPath
  fs.mkdirSync(targetPath, { recursive: true })

  const txid = newTxid('fork')
  const backupDir = path.join(options.backupDir, txid)
  let workspace
  let journal
  try {
    const log = readLogFile(sourceLog)
    if (log.tornStart !== undefined) throw new Error(`source session log has a torn tail: ${body.sessionId}`)
    const childId = `session-${crypto.randomUUID()}`
    const childTarget = expectedLogPath(options.dshHome, targetPath, childId)
    if (fs.existsSync(childTarget)) throw new Error(`fork target log already exists: ${childId}`)
    workspace = await registry.create(targetPath, String(body.title))
    fs.mkdirSync(backupDir, { recursive: true })
    backupWorkspaceRecords(options, backupDir, { workspaceIds: [workspace.id] })
    journal = {
      txid,
      kind: 'fork',
      state: 'prepared',
      sessionId: childId,
      parentSessionId: body.sessionId,
      oldPath: sourceHeader.cwd,
      newPath: targetPath,
      targetWorkspaceId: String(workspace.id),
      createdWorkspaceId: String(workspace.id),
      backupDir,
    }
    writeJournal(options, journal)

    const out = buildCloned(log, { id: childId, cwd: targetPath, createdAt: Date.now() })
    verifyCloned(log, out, childId, targetPath)
    fs.mkdirSync(path.dirname(childTarget), { recursive: true })
    const staging = `${childTarget}.tmp-${txid}`
    fs.writeFileSync(staging, out)
    fs.renameSync(staging, childTarget)
    cloneProjcache(options, body.sessionId, childId, targetPath)

    journal.state = 'files-ready'
    writeJournal(options, journal)
    return json({ ok: true, restartRequired: true, txid, sessionId: childId, workspaceId: String(workspace.id) })
  } catch (error) {
    if (journal !== undefined) await rollbackJournal(options, journal)
    if (workspace !== undefined) {
      try {
        await registry.delete(workspace.id)
      } catch {
        /* best effort */
      }
    }
    throw error
  }
}

async function readBody(request) {
  try {
    return await request.json()
  } catch {
    return {}
  }
}

// ---------------------------------------------------------------------------
// Promotion engine (ported from UPM `provider-dsh/lib/promotion.mjs`).
//
// A promotion registers an existing directory as a DSH workspace and attaches
// same-cwd sessions that are not yet accounted. Only the `existing` mode is
// ported: it needs no restart, so the whole transaction commits inline and the
// journal exists purely as crash recovery.
//
// The registry owns the durable mutation; this module only serializes it with a
// lock and leaves a journal so a crash between create and attach is retryable on
// the next boot. It deliberately requires NO UTM governance ledger: verdict G1-G6,
// quarantine and cube isolation live in the offline UTM core, so the engine runs
// on the local journal alone (graceful degradation) and reports which governance
// signals were unavailable instead of pretending they passed.
// ---------------------------------------------------------------------------

const PROMOTION_JOURNAL_DIR = 'promotion'
const PROMOTION_TERMINAL_STATES = new Set(['committed', 'rolledback'])
const PROMOTION_MODES = ['existing']

function promotionJournalFile(options) {
  return path.join(options.stateDir, PROMOTION_JOURNAL_DIR, 'pending.json')
}

function readPromotionJournal(options) {
  const file = promotionJournalFile(options)
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return undefined
  }
}

function writePromotionJournal(options, journal) {
  const file = promotionJournalFile(options)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  journal.updatedAt = new Date().toISOString()
  const temp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temp, `${JSON.stringify(journal, null, 2)}\n`)
  fs.renameSync(temp, file)
}

/** Cross-process lock so two promotion/apply calls cannot interleave. */
function acquirePromotionLock(options, txid) {
  const file = path.join(options.stateDir, PROMOTION_JOURNAL_DIR, 'lock.json')
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const ttl = 60_000
  try {
    const held = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (held?.txid !== txid && Number(held?.expiresAt ?? 0) > Date.now()) return false
  } catch {
    /* no lock file, or unreadable => acquire */
  }
  const temp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temp, `${JSON.stringify({ txid, acquiredAt: Date.now(), expiresAt: Date.now() + ttl })}\n`)
  fs.renameSync(temp, file)
  return true
}

function releasePromotionLock(options, txid) {
  const file = path.join(options.stateDir, PROMOTION_JOURNAL_DIR, 'lock.json')
  try {
    const held = JSON.parse(fs.readFileSync(file, 'utf8'))
    if (held?.txid === txid) fs.rmSync(file, { force: true })
  } catch {
    /* already gone */
  }
}

/** Candidate sessions in creation order, then by id, so attach order is stable. */
function sortCandidates(headers) {
  return [...headers].sort((left, right) => {
    const byTime = Number(left.createdAt ?? 0) - Number(right.createdAt ?? 0)
    return byTime === 0 ? String(left.id).localeCompare(String(right.id)) : byTime
  })
}

function accountedMap(registry) {
  const accounted = new Map()
  for (const workspace of registry.list()) {
    for (const sessionId of workspace.record.sessionIds) accounted.set(sessionId, String(workspace.id))
  }
  return accounted
}

/**
 * Resolve the target directory. Canonicalization is `realpath` based so a
 * symlinked path and its target compare equal, and a missing directory is a
 * blocker rather than a silent `registry.create` on a phantom path.
 */
function canonicalizeTarget(requestedPath) {
  let canonical
  try {
    canonical = fs.realpathSync(requestedPath)
  } catch {
    return { code: 'PATH_UNRESOLVABLE', path: requestedPath }
  }
  try {
    if (!fs.statSync(canonical).isDirectory()) return { code: 'PATH_NOT_DIRECTORY', path: requestedPath }
  } catch {
    return { code: 'PATH_UNRESOLVABLE', path: requestedPath }
  }
  return { canonicalPath: canonical }
}

function normalizeTitle(value) {
  const text = String(value ?? '').trim()
  return text === '' ? undefined : text
}

function defaultTitle(canonicalPath) {
  return path.basename(canonicalPath) || canonicalPath
}

/**
 * Read-only verdict. Every blocker is collected (never thrown) so the UI can
 * show the complete reason set in one round trip.
 */
export async function previewPromotion(ctx, options, body = {}) {
  const mode = String(body.mode ?? 'existing')
  const blockers = []
  if (!PROMOTION_MODES.includes(mode)) {
    blockers.push(blocker('UNSUPPORTED_MODE', { mode, supported: PROMOTION_MODES }))
  }

  const requestedPath = typeof body.path === 'string' ? body.path.trim() : ''
  let canonicalPath
  if (requestedPath === '') {
    blockers.push(blocker('PATH_REQUIRED'))
  } else if (!isAbsolutePath(requestedPath)) {
    blockers.push(blocker('PATH_NOT_ABSOLUTE', { path: requestedPath }))
  } else {
    const resolved = canonicalizeTarget(requestedPath)
    if (resolved.code !== undefined) blockers.push(blocker(resolved.code, { path: resolved.path }))
    else canonicalPath = resolved.canonicalPath
  }

  if (canonicalPath !== undefined && options.allowExternalPaths !== true && !isUnder(options.projectsRoot, canonicalPath)) {
    blockers.push(blocker('PATH_OUTSIDE_ROOT', { path: canonicalPath, root: options.projectsRoot }))
  }

  const registry = ctx.get('workspaceRegistry')
  if (registry === undefined) throw new Error('workspaceRegistry is unavailable')
  const workspaces = registry.list()

  const existing =
    canonicalPath === undefined ? undefined : workspaces.find((workspace) => samePath(workspace.path, canonicalPath))

  const defaultWorkspaceIdValue = defaultWorkspaceId(options)
  const defaultWorkspace =
    defaultWorkspaceIdValue === undefined ? undefined : registry.get(defaultWorkspaceIdValue)
  if (canonicalPath !== undefined && defaultWorkspace !== undefined && samePath(defaultWorkspace.path, canonicalPath)) {
    blockers.push(blocker('DEFAULT_WORKSPACE', { workspaceId: String(defaultWorkspace.id) }))
  }

  let title
  if (existing !== undefined) {
    title = existing.title
  } else if (canonicalPath !== undefined) {
    title = normalizeTitle(body.title) ?? defaultTitle(canonicalPath)
    if (title === undefined) blockers.push(blocker('TITLE_BLANK'))
    else if (workspaces.some((workspace) => String(workspace.title).toLowerCase() === title.toLowerCase())) {
      blockers.push(blocker('TITLE_CONFLICT', { title }))
    }
  }

  const headers = await listHeaders(ctx)
  const accounted = accountedMap(registry)
  const sameCwd =
    canonicalPath === undefined ? [] : headers.filter((header) => typeof header.cwd === 'string' && samePath(header.cwd, canonicalPath))
  const candidates = []
  const alreadyAttached = []
  for (const header of sameCwd) {
    const owner = accounted.get(header.id)
    if (owner === undefined) candidates.push(header)
    else if (existing !== undefined && owner === String(existing.id)) alreadyAttached.push(header.id)
    else blockers.push(blocker('SESSION_ALREADY_ACCOUNTED', { sessionId: header.id, workspaceId: owner }))
  }
  const ordered = sortCandidates(candidates)

  return {
    ok: blockers.length === 0,
    mode,
    path: requestedPath,
    canonicalPath,
    title,
    workspaceId: existing === undefined ? undefined : String(existing.id),
    alreadyRegistered: existing !== undefined,
    candidateSessionIds: ordered.map((header) => header.id),
    alreadyAttachedSessionIds: sortCandidates(sameCwd.filter((header) => alreadyAttached.includes(header.id))).map(
      (header) => header.id,
    ),
    blockerCodes: blockers.map((entry) => entry.code),
    blockers,
    effects: {
      restartRequired: false,
      ui: existing === undefined ? 'immediate' : 'none',
      sessionIdPreserved: true,
    },
    // Graceful degradation: the offline UTM core cannot supply a gate verdict.
    // Reported explicitly so callers never mistake "not evaluated" for "passed".
    governance: { gate: 'unavailable', source: 'offline', quarantined: false },
  }
}

/**
 * Attach candidates to a workspace, refusing any session already owned
 * elsewhere. `attachSession` is the only durable mutation performed here.
 */
async function attachCandidates(registry, workspace, candidateSessionIds) {
  const attached = []
  for (const sessionId of candidateSessionIds) {
    if (workspace.record.sessionIds.includes(sessionId)) continue
    const owner = registry
      .list()
      .find((entry) => String(entry.id) !== String(workspace.id) && entry.record.sessionIds.includes(sessionId))
    if (owner !== undefined) {
      throw new Error(`SESSION_ALREADY_ACCOUNTED: session ${sessionId} is already accounted by workspace ${owner.id}`)
    }
    await workspace.attachSession(sessionId)
    attached.push(sessionId)
  }
  return attached
}

/**
 * Apply the ported 2PC sequence:
 *   lock -> preview -> journal(prepared) -> registry.create -> journal(workspace-ready)
 *   -> attach each candidate -> journal(committed) -> release lock
 * A throw after the journal exists leaves it in place for the boot finalizer.
 */
export async function applyPromotion(ctx, options, body = {}) {
  const mode = String(body.mode ?? 'existing')
  if (!PROMOTION_MODES.includes(mode)) {
    return { ok: false, status: 409, blockerCodes: ['UNSUPPORTED_MODE'], blockers: [blocker('UNSUPPORTED_MODE', { mode, supported: PROMOTION_MODES })] }
  }

  const txid = newTxid('promotion')
  if (!acquirePromotionLock(options, txid)) {
    return { ok: false, status: 409, blockerCodes: ['LOCK_HELD'], blockers: [blocker('LOCK_HELD')] }
  }

  try {
    const preview = await previewPromotion(ctx, options, body)
    if (!preview.ok) return { ok: false, status: 409, blockerCodes: preview.blockerCodes, blockers: preview.blockers, preview }

    const registry = ctx.get('workspaceRegistry')
    let workspace = preview.alreadyRegistered ? registry.get(preview.workspaceId) : undefined
    const journal = {
      txid,
      kind: 'promotion',
      mode: 'existing',
      state: 'prepared',
      target: { path: preview.canonicalPath, title: preview.title },
      candidateSessionIds: [...preview.candidateSessionIds],
      workspaceId: null,
      createdWorkspace: false,
      createdAt: new Date().toISOString(),
    }
    writePromotionJournal(options, journal)

    const beforeIds = new Set(registry.list().map((entry) => String(entry.id)))
    if (workspace === undefined) workspace = await registry.create(preview.canonicalPath, preview.title)
    journal.workspaceId = String(workspace.id)
    journal.createdWorkspace = !beforeIds.has(String(workspace.id))
    journal.state = 'workspace-ready'
    writePromotionJournal(options, journal)

    journal.attachedSessionIds = await attachCandidates(registry, workspace, preview.candidateSessionIds)
    journal.state = 'committed'
    writePromotionJournal(options, journal)

    return {
      ok: true,
      status: 200,
      mode: 'existing',
      txid,
      workspaceId: String(workspace.id),
      title: workspace.title,
      canonicalPath: preview.canonicalPath,
      created: journal.createdWorkspace,
      alreadyRegistered: preview.alreadyRegistered,
      attachedSessionIds: journal.attachedSessionIds,
      alreadyAttachedSessionIds: preview.alreadyAttachedSessionIds,
      restartRequired: false,
    }
  } finally {
    releasePromotionLock(options, txid)
  }
}

/**
 * Boot recovery for a promotion that crashed between `create` and `attach`.
 * Idempotent: re-resolves the workspace by id, then by path, then creates it.
 * A failure keeps the journal so the next boot retries.
 */
export async function finalizePendingPromotion(ctx, options) {
  const journal = readPromotionJournal(options)
  if (journal === undefined) return { state: 'none' }
  if (PROMOTION_TERMINAL_STATES.has(journal.state)) return { state: journal.state }
  if (journal.state !== 'prepared' && journal.state !== 'workspace-ready') return { state: journal.state }

  if (!acquirePromotionLock(options, journal.txid)) return { state: 'locked' }

  try {
    const registry = ctx.get('workspaceRegistry')
    let workspace = journal.workspaceId === null ? undefined : registry.get(journal.workspaceId)
    if (workspace === undefined) {
      workspace = registry.list().find((entry) => samePath(entry.path, journal.target.path))
    }
    if (workspace === undefined) workspace = await registry.create(journal.target.path, journal.target.title)
    journal.workspaceId = String(workspace.id)
    journal.state = 'workspace-ready'
    writePromotionJournal(options, journal)

    journal.attachedSessionIds = await attachCandidates(registry, workspace, journal.candidateSessionIds ?? [])
    journal.state = 'committed'
    writePromotionJournal(options, journal)
    return { state: 'committed', workspaceId: String(workspace.id), attachedSessionIds: journal.attachedSessionIds }
  } catch (error) {
    ctx.logger?.warn?.('promotion finalizer failed; journal retained', error)
    return { state: 'failed', error: error instanceof Error ? error.message : String(error) }
  } finally {
    releasePromotionLock(options, journal.txid)
  }
}

/**
 * Read-only grouped view of the registry for the sidebar/panel. Never mutates.
 */
function handleGroupedView(ctx, options) {
  const registry = ctx.get('workspaceRegistry')
  const workspaces = registry.list().map((workspace) => ({
    id: String(workspace.id),
    path: workspace.path,
    title: workspace.title,
    sessionCount: workspace.record?.sessionIds?.length ?? 0,
  }))
  const { document, status, problems } = readGroups(options)
  const tree = buildHqTree({ workspaces, document })
  const order = planSidebarOrder(options, workspaces)
  return json({
    ok: true,
    status,
    problems,
    schemaVersion: document.unit?.version,
    ...tree,
    order: { moves: order.moves.length, unchanged: order.unchanged },
    groupsFlat: buildGroupedView(options, workspaces).groups,
  })
}

/**
 * Dry-run a batch rename: validate every target and every session binding with
 * NO filesystem or registry mutation. This is the Phase-3 gate that must pass
 * before any real movement is attempted.
 */
async function handleBatchDryRun(ctx, options, body) {
  const registry = ctx.get('workspaceRegistry')
  const moves = Array.isArray(body.moves) ? body.moves : []
  const registered = registry.list().map((workspace) => ({ id: String(workspace.id), path: workspace.path }))
  const result = validateBatchRename({
    dshHome: options.dshHome,
    moves: moves.map((move) => ({
      workspaceId: move.workspaceId === undefined ? undefined : String(move.workspaceId),
      currentPath: String(move.currentPath ?? ''),
      targetPath: String(move.targetPath ?? ''),
    })),
    registeredIds: registered,
  })
  return json({
    ok: result.ok,
    dryRun: true,
    mutations: 0,
    blockers: result.blockers,
    blockerCodes: result.blockers.map((entry) => entry.code),
    warnings: result.warnings,
    sessionAudit: result.sessionAudit,
    naming: moves.map((move) => ({
      workspaceId: move.workspaceId === undefined ? undefined : String(move.workspaceId),
      target: path.basename(String(move.targetPath ?? '')),
      parsed: parseGroupedName(path.basename(String(move.targetPath ?? ''))),
    })),
  })
}

/**
 * Preview the "Align Sidebar Order" command. Read-only: computes the target order
 * (system cores first, then groups by `{INDEX}`, then ungrouped) and the minimal
 * insertBefore chain without touching the registry.
 */
function handleOrderPreview(ctx, options) {
  const registry = ctx.get('workspaceRegistry')
  const workspaces = registry.list().map((workspace) => ({
    id: String(workspace.id),
    path: workspace.path,
    title: workspace.title,
  }))
  const plan = planSidebarOrder(options, workspaces)
  return json({
    ok: true,
    preview: true,
    mutations: 0,
    unchanged: plan.unchanged,
    moves: plan.moves,
    targetOrder: plan.order,
    groups: plan.groups,
    titles: Object.fromEntries(workspaces.map((workspace) => [workspace.id, workspace.title])),
  })
}

/**
 * Apply the sidebar order via `registry.insertBefore`, accumulating an inverse
 * chain so a mid-flight failure can be rolled back in reverse.
 *
 * Safety: each step records the order as it was BEFORE the call. On failure we
 * replay those orders backwards. Every call is the official Remote-backed
 * registry mutation, so no session log or workspace record is rewritten.
 */
async function handleOrderApply(ctx, options, body = {}) {
  const registry = ctx.get('workspaceRegistry')
  const workspaces = registry.list().map((workspace) => ({
    id: String(workspace.id),
    path: workspace.path,
    title: workspace.title,
  }))
  const plan = planSidebarOrder(options, workspaces)
  if (plan.unchanged) {
    return json({ ok: true, applied: false, unchanged: true, targetOrder: plan.order })
  }
  if (body.dryRun === true) {
    return json({ ok: true, dryRun: true, applied: false, moves: plan.moves, targetOrder: plan.order })
  }

  const history = []
  const snapshotOrder = () => registry.list().map((workspace) => String(workspace.id))
  try {
    for (const move of plan.moves) {
      history.push({ before: snapshotOrder(), move })
      await registry.insertBefore(move.workspaceId, move.beforeWorkspaceId)
    }
  } catch (error) {
    const rollbackErrors = []
    for (const entry of [...history].reverse()) {
      try {
        const { before } = entry
        // Re-assert the recorded pre-move order by walking it left to right.
        const working = registry.list().map((workspace) => String(workspace.id))
        for (let target = 0; target < before.length; target += 1) {
          if (working[target] === before[target]) continue
          const at = working.indexOf(before[target])
          if (at === -1) continue
          working.splice(at, 1)
          working.splice(target, 0, before[target])
          await registry.insertBefore(before[target], working[target + 1])
        }
      } catch (rollbackError) {
        rollbackErrors.push(rollbackError instanceof Error ? rollbackError.message : String(rollbackError))
      }
    }
    ctx.logger?.warn?.('sidebar order apply failed; rolled back', { error, rollbackErrors })
    return json(
      {
        ok: false,
        applied: false,
        rolledBack: rollbackErrors.length === 0,
        error: error instanceof Error ? error.message : String(error),
        rollbackErrors,
      },
      409,
    )
  }

  const finalOrder = snapshotOrder()
  const matches = finalOrder.length === plan.order.length && finalOrder.every((id, i) => id === plan.order[i])
  return json({
    ok: true,
    applied: true,
    moves: plan.moves.length,
    targetOrder: plan.order,
    finalOrder,
    matchesTarget: matches,
  })
}

/** HQ generation: preview is read-only; apply scaffolds then promotes. */
async function handleHqPromote(ctx, options, body = {}) {
  const registry = ctx.get('workspaceRegistry')
  const existingTitles = registry.list().map((workspace) => workspace.title)
  if (body.group === undefined || String(body.group).trim() === '') {
    return json({ ok: false, blockerCodes: ['GROUP_REQUIRED'], blockers: [{ code: 'GROUP_REQUIRED' }] }, 409)
  }
  // Legacy groups may already have an HQ; never create a duplicate.
  if (body.dryRun === true) {
    const planned = previewHq({
      group: body.group,
      main: body.main,
      projectsRoot: options.projectsRoot,
      existingTitles,
    })
    return json({ ok: planned.ok, dryRun: true, mutations: 0, ...planned })
  }
  const result = await promoteHq({
    ctx,
    options,
    group: body.group,
    main: body.main,
    previewPromotion,
    applyPromotion,
    dryRun: false,
  })
  if (result.ok !== true) {
    return json({ ok: false, ...result }, 409)
  }
  // Register the new HQ in the group ledger so the tree shows it immediately.
  try {
    const { document } = readGroups(options)
    const group = document.groups.find((entry) => entry.label === body.group || entry.groupId === body.groupId)
    if (group !== undefined && result.workspaceId !== undefined) {
      assignMember(options, {
        workspaceId: result.workspaceId,
        groupId: group.groupId,
        order: 0,
        path: result.targetPath,
        title: result.title,
      })
    }
  } catch (error) {
    ctx.logger?.warn?.('HQ created but group membership was not recorded', error)
  }
  return json({ ok: true, ...result })
}

/** Orphan/legacy log classification (read-only, never destructive). */
function handleOrphanAudit(ctx, options, body = {}) {
  const registry = ctx.get('workspaceRegistry')
  const workspaces = registry.list().map((workspace) => ({
    id: String(workspace.id),
    path: workspace.path,
    title: workspace.title,
    sessionIds: workspace.record?.sessionIds ?? [],
  }))
  const result = classifyOrphanLogs({
    dshHome: options.dshHome,
    workspaces,
    legacyAgeDays: Number.isInteger(body.legacyAgeDays) ? body.legacyAgeDays : 30,
  })
  if (body.verbose === true) return json({ ok: true, ...result })
  const { entries, ...summary } = result
  return json({ ok: true, ...summary })
}

/** Resident-context budget audit for one sub-module. */
function handleDietAudit(options, body = {}) {
  const subDir = typeof body.subDir === 'string' ? body.subDir : options.projectsRoot
  if (!isUnder(options.projectsRoot, subDir) && options.allowExternalPaths !== true) {
    return json({ ok: false, blockerCodes: ['PATH_OUTSIDE_ROOT'], blockers: [{ code: 'PATH_OUTSIDE_ROOT', path: subDir }] }, 409)
  }
  const groupCapsulePath =
    typeof body.groupCapsulePath === 'string'
      ? body.groupCapsulePath
      : body.group === undefined
        ? undefined
        : path.join(options.projectsRoot, 'docs', 'groups', String(body.group), 'CAPSULE.md')
  const toolRegistryPath =
    typeof body.toolRegistryPath === 'string'
      ? body.toolRegistryPath
      : path.join(options.projectsRoot, 'docs', 'shared', 'TOOL-REGISTRY.md')
  const result = auditResidentBudget({ subDir, groupCapsulePath, toolRegistryPath })
  return json({ ok: result.ok, ...result })
}

/** Cross-group fork guard used by the fork preview. */
function handleForkPolicy(options, body = {}) {
  const { document } = readGroups(options)
  const groupOf = (workspaceId) => {
    const member = document.members[String(workspaceId ?? '')]
    return member === undefined ? undefined : member.groupId
  }
  const result = checkCrossGroupFork({
    sourceGroupId: groupOf(body.sourceWorkspaceId),
    targetGroupId: groupOf(body.targetWorkspaceId),
  })
  return json({ ok: result.ok, ...result })
}

export function createTransactionRoutes(ctx, options) {
  const safe = (handler) => async (request) => {
    try {
      return await handler(request)
    } catch (error) {
      ctx.logger?.warn?.('sidebar-manager route failed', error)
      return json({ ok: false, error: error instanceof Error ? error.message : String(error) }, 500)
    }
  }
  return {
    'session/move/preview': safe(async (request) => json(await previewMove(ctx, await readBody(request)))),
    'workspace/rename-folder/preview': safe(async (request) =>
      json(await previewRename(ctx, options, await readBody(request))),
    ),
    'session/fork-to-workspace/preview': safe(async (request) =>
      json(await previewFork(ctx, options, await readBody(request))),
    ),

    'session/purge': safe(async (request) => handlePurge(ctx, options, await readBody(request))),
    'session/move': safe(async (request) => handleMove(ctx, options, await readBody(request))),
    'workspace/archived': safe(async () => handleArchivedList(ctx, options)),
    'workspace/archive': safe(async (request) => handleArchiveWorkspace(ctx, options, await readBody(request))),
    'workspace/restore': safe(async (request) => handleRestoreWorkspace(ctx, options, await readBody(request))),
    'workspace/rename-folder': safe(async (request) => handleRenameFolder(ctx, options, await readBody(request))),
    'session/fork-to-workspace': safe(async (request) => handleFork(ctx, options, await readBody(request))),

    'promotion/preview': safe(async (request) => json(await previewPromotion(ctx, options, await readBody(request)))),
    'promotion/apply': safe(async (request) => {
      const result = await applyPromotion(ctx, options, await readBody(request))
      const { status, ...payload } = result
      return json(payload, payload.ok ? 200 : (status ?? 409))
    }),
    'promotion/status': safe(async () => json({ ok: true, journal: readPromotionJournal(options) ?? null })),
    'groups/list': safe(async () => json({ ok: true, ...listGroups(options) })),
    'groups/view': safe(async () => handleGroupedView(ctx, options)),
    'groups/upsert': safe(async (request) => {
      const body = await readBody(request)
      const result = upsertGroup(options, {
        groupId: body.groupId,
        label: body.label,
        order: body.order,
        index: body.index,
      })
      return json({ ok: true, ...result })
    }),
    'groups/assign': safe(async (request) => {
      const body = await readBody(request)
      const result = assignMember(options, {
        workspaceId: String(body.workspaceId ?? ''),
        groupId: body.groupId,
        order: body.order,
        path: body.path,
        title: body.title,
      })
      return json({ ok: true, ...result })
    }),
    'groups/remove': safe(async (request) => {
      const body = await readBody(request)
      return json({ ok: true, ...removeMember(options, String(body.workspaceId ?? '')) })
    }),
    'groups/hq/preview': safe(async (request) => handleHqPromote(ctx, options, { ...(await readBody(request)), dryRun: true })),
    'groups/hq/promote': safe(async (request) => handleHqPromote(ctx, options, await readBody(request))),
    'groups/orphans': safe(async (request) => handleOrphanAudit(ctx, options, await readBody(request))),
    'promotion/gate': safe(async (request) => {
      const body = await readBody(request)
      const root = typeof body.root === 'string' && body.root.trim() !== '' ? body.root : options.projectsRoot
      if (!isUnder(options.projectsRoot, root) && options.allowExternalPaths !== true) {
        return json({ ok: false, blockerCodes: ['PATH_OUTSIDE_ROOT'], blockers: [{ code: 'PATH_OUTSIDE_ROOT', path: root }] }, 409)
      }
      // Governance gates target ACTIVE DSH workspaces only. Deprecated trees
      // (e.g. minamiv21, awaiting decommission) must not be audited as if they
      // were live standards — doing so yields meaningless G3/G6 failures.
      const eligibility = assertGovernanceTarget({ path: root, title: body.title })
      if (!eligibility.ok) {
        return json(
          { ok: false, skipped: true, blockerCodes: [eligibility.code], blockers: [{ code: eligibility.code, detail: eligibility.detail }], status: eligibility.status, record: eligibility.record },
          409,
        )
      }
      // Preview by default: G2 does not write and G4 does not execute tests.
      const result = runPromotionGate({ root, write: body.write === true, runTests: body.runTests === true })
      return json({ ok: result.ok, ...result })
    }),
    'workspace/lifecycle': safe(async () => {
      const registry = ctx.get('workspaceRegistry')
      const workspaces = registry.list().map((workspace) => ({
        id: String(workspace.id),
        title: workspace.title,
        path: workspace.path,
      }))
      const { activeGovernanceTargets: eligible } = await import('./workspace-lifecycle.mjs')
      return json({
        ok: true,
        deprecated: DEPRECATED_WORKSPACES,
        eligibleTargets: eligible(workspaces).map((workspace) => ({ id: workspace.id, title: workspace.title })),
        excludedTargets: workspaces
          .filter((workspace) => !eligible([workspace]).length)
          .map((workspace) => ({ id: workspace.id, title: workspace.title })),
      })
    }),
    'groups/advisory': safe(async () => {
      const registry = ctx.get('workspaceRegistry')
      const workspaces = registry.list().map((workspace) => ({
        id: String(workspace.id),
        path: workspace.path,
        title: workspace.title,
      }))
      const { document } = readGroups(options)
      return json(buildAdvisoryReport({ workspaces, document }))
    }),
    'groups/mutation-check': safe(async (request) => {
      const body = await readBody(request)
      const registry = ctx.get('workspaceRegistry')
      const target = registry.get(String(body.targetWorkspaceId ?? ''))
      if (target === undefined) {
        return json({ ok: false, code: 'WORKSPACE_MISSING', detail: 'target workspace not found' }, 404)
      }
      const { document } = readGroups(options)
      const member = document.members[String(target.id)] ?? {}
      const verdict = evaluateMutation({
        target: { id: String(target.id), title: target.title, policy: member.policy },
        originWorkspaceId: body.originWorkspaceId === undefined ? undefined : String(body.originWorkspaceId),
        action: typeof body.action === 'string' ? body.action : 'write',
      })
      // Advisory soft rejection: HTTP 200 with an explicit verdict, never a hard block.
      return json({
        ok: true,
        advisory: true,
        allowed: verdict.allowed,
        softRejection: verdict.softRejection,
        policy: member.policy?.access,
        role: member.role,
      })
    }),
    'groups/subagents': safe(async () => {
      const registry = ctx.get('workspaceRegistry')
      const workspaces = registry.list().map((workspace) => ({
        id: String(workspace.id),
        sessionIds: workspace.record?.sessionIds ?? [],
      }))
      const result = auditSubagentArtifacts({ dshHome: options.dshHome, workspaces })
      const { entries, ...summary } = result
      return json({ ok: true, ...summary })
    }),
    'groups/diet': safe(async (request) => handleDietAudit(options, await readBody(request))),
    'groups/fork-policy': safe(async (request) => handleForkPolicy(options, await readBody(request))),
    'workspace/batch-rename/plan': safe(async (request) => {
      const body = await readBody(request)
      const registry = ctx.get('workspaceRegistry')
      const plan = planBatchRename({
        dshHome: options.dshHome,
        moves: Array.isArray(body.moves) ? body.moves : [],
        registeredIds: registry.list().map((workspace) => ({ id: String(workspace.id), path: workspace.path })),
      })
      return json({ ok: plan.ok, ...plan })
    }),
    'workspace/batch-rename/status': safe(async () => json({ ok: true, journal: readBatchJournal(options) ?? null })),
    'workspace/order/preview': safe(async () => handleOrderPreview(ctx, options)),
    'workspace/order/apply': safe(async (request) => handleOrderApply(ctx, options, await readBody(request))),
    'workspace/batch-rename/dry-run': safe(async (request) => handleBatchDryRun(ctx, options, await readBody(request))),
    'workspace/batch-rename/verify': safe(async (request) => {
      const body = await readBody(request)
      const result = verifyBatchOutcome({ dshHome: options.dshHome, workspaceIds: body.workspaceIds ?? [] })
      return json({ ok: result.ok, ...result })
    }),
  }
}
