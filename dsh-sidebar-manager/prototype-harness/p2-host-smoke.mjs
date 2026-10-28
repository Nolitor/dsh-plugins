#!/usr/bin/env node
/**
 * P2 host smoke test — no DSH runtime required.
 *
 * Exercises the transaction route table with in-memory Workspace/Session
 * services and a temporary DSH_HOME. It covers the preview guards and the
 * no-journal finalizer path; the file-layer transaction itself is covered by
 * tools/p0-relocate-spike.mjs and tools/p0b-workspace-rename-spike.mjs.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh-p2-smoke-'))
process.env.DSH_HOME = path.join(root, 'dsh-home')
const projectsRoot = path.join(root, 'projects')
const alphaPath = path.join(projectsRoot, 'alpha')
const betaPath = path.join(projectsRoot, 'beta')
fs.mkdirSync(alphaPath, { recursive: true })
fs.mkdirSync(betaPath, { recursive: true })
fs.mkdirSync(path.join(process.env.DSH_HOME, 'storages'), { recursive: true })

const sessionId = 'session-smoke-1'
const headers = [{ id: sessionId, cwd: alphaPath, version: 4 }]
const alpha = {
  id: 'ws-alpha',
  path: alphaPath,
  title: 'Alpha',
  record: { path: alphaPath, title: 'Alpha', sessionIds: [sessionId] },
}
const beta = {
  id: 'ws-beta',
  path: betaPath,
  title: 'Beta',
  record: { path: betaPath, title: 'Beta', sessionIds: [] },
}
const registry = {
  archivedSessionIds: [],
  list: () => [alpha, beta],
  get: (id) => (id === 'ws-alpha' ? alpha : id === 'ws-beta' ? beta : undefined),
  resolveByPath: async (value) => (value === alphaPath ? alpha : value === betaPath ? beta : undefined),
  archiveSession: async () => {},
  unarchiveSession: async () => {},
  unpinSession: async () => {},
  delete: async () => true,
  create: async (value, title) => ({ id: 'ws-new', path: value, title, record: { path: value, title, sessionIds: [] } }),
  insertBefore: async () => [],
}
const live = new Set()
const ctx = {
  logger: { info() {}, warn() {}, error() {} },
  get(name) {
    if (name === 'workspaceRegistry') return registry
    if (name === 'sessionPersistence') return { list: async () => headers.map((header) => ({ header })) }
    if (name === 'agents') return { get: (id) => (live.has(id) ? {} : undefined) }
    if (name === 'sessions') return { get: (id) => (live.has(id) ? {} : undefined) }
    if (name === 'sessionController') return { fork: async () => ({ sessionId: 'session-child' }) }
    if (name === 'connection') return { fetch: { register() {} } }
    return undefined
  },
}

fs.writeFileSync(
  path.join(process.env.DSH_HOME, 'storages', 'workspace.json'),
  JSON.stringify({
    global: { defaultWorkspaceId: 'ws-alpha', workspaceIds: ['ws-alpha', 'ws-beta'] },
    tables: {
      workspaces: {
        'ws-alpha': alpha.record,
        'ws-beta': beta.record,
      },
    },
  }),
)

const { createTransactionRoutes, finalizePending, resolveOptions } = await import(
  new URL('../dsh-sidebar-manager/lib/transaction.mjs', import.meta.url).href
)
const options = resolveOptions({ projectsRoot })
const routes = createTransactionRoutes(ctx, options)
const call = async (route, body) => {
  const response = await routes[route]({ json: async () => body })
  return { status: response.status, body: await response.json() }
}
const checks = []
const check = (name, ok, detail = '') => checks.push({ name, ok: ok === true, ...(detail ? { detail } : {}) })
const codes = (body) => (body.blockerCodes ?? []).map((entry) => entry.code)

let result = await call('session/move/preview', { sessionId, targetWorkspaceId: 'ws-beta' })
check('move preview ok', result.body.ok === true, JSON.stringify(result.body))
check('move preview count', result.body.affectedSessionCount === 1)

result = await call('session/move/preview', { sessionId, targetWorkspaceId: 'ws-alpha' })
check('move same workspace blocked', codes(result.body).includes('SAME_WORKSPACE'))

live.add(sessionId)
result = await call('session/move/preview', { sessionId, targetWorkspaceId: 'ws-beta' })
check('move live session blocked', codes(result.body).includes('SESSION_LIVE'))
live.delete(sessionId)

result = await call('workspace/rename-folder/preview', {
  workspaceId: 'ws-alpha',
  title: 'Alpha 2',
  folderName: 'alpha-renamed',
  folderRename: true,
})
check('rename default workspace blocked', codes(result.body).includes('DEFAULT_WORKSPACE'))

const existing = path.join(projectsRoot, 'alpha-renamed')
fs.mkdirSync(existing, { recursive: true })
result = await call('workspace/rename-folder/preview', {
  workspaceId: 'ws-beta',
  title: 'Beta',
  folderName: 'alpha-renamed',
  folderRename: true,
})
check('rename target exists blocked', codes(result.body).includes('TARGET_EXISTS'))

result = await call('session/fork-to-workspace/preview', {
  sessionId,
  title: 'Beta Fork',
  path: path.join(projectsRoot, 'beta-fork'),
})
check('fork preview ok', result.body.ok === true, JSON.stringify(result.body))

result = await call('session/fork-to-workspace/preview', {
  sessionId,
  title: 'Outside',
  path: path.join(root, 'outside'),
})
check('fork external path blocked', codes(result.body).includes('EXTERNAL_PATH'))

result = await call('session/purge', { sessionId })
check('purge of non-archived session blocked', result.status === 409 && codes(result.body).includes('NOT_ARCHIVED'))

const finalized = await finalizePending(ctx, options)
check('no journal finalizer is a no-op', finalized.state === 'none')

result = await call('workspace/archived', {})
check('archived workspace list is empty', result.status === 200 && Array.isArray(result.body.items) && result.body.items.length === 0)

// --- boot finalizer: move ---------------------------------------------------
const journalDir = path.join(options.stateDir, 'journal')
fs.mkdirSync(journalDir, { recursive: true })
const journalFile = path.join(journalDir, 'pending.json')
const attached = []
const detached = []
const deleted = []
const inserted = []
beta.record.sessionIds = []
beta.attachSession = async (id) => {
  attached.push(id)
  beta.record.sessionIds = [id, ...beta.record.sessionIds]
}
alpha.detachSession = async (id) => {
  detached.push(id)
  alpha.record.sessionIds = alpha.record.sessionIds.filter((entry) => entry !== id)
}
fs.writeFileSync(journalFile, JSON.stringify({
  txid: 'move-smoke',
  kind: 'move',
  state: 'files-ready',
  sessionId,
  oldPath: alphaPath,
  newPath: betaPath,
  targetWorkspaceId: 'ws-beta',
  backupDir: path.join(root, 'backup', 'move-smoke'),
}))
const moved = await finalizePending(ctx, options)
check('move finalizer commits', moved.state === 'committed')
check('move finalizer attaches target', attached.includes(sessionId))
check('move finalizer detaches source', detached.includes(sessionId))

// --- boot finalizer: rename -------------------------------------------------
const gammaPath = path.join(projectsRoot, 'gamma')
const created = []
const gamma = {
  id: 'ws-gamma',
  path: gammaPath,
  title: 'Gamma',
  record: { path: gammaPath, title: 'Gamma', sessionIds: [] },
  async attachSession(id) {
    this.record.sessionIds = [id, ...this.record.sessionIds]
  },
  async setTitle(value) {
    this.title = value
    this.record.title = value
  },
}
registry.create = async (value, title) => {
  created.push({ value, title })
  return gamma
}
registry.insertBefore = async (id, beforeId) => {
  inserted.push({ id, beforeId })
  return []
}
registry.delete = async (id) => {
  deleted.push(id)
  return true
}
fs.writeFileSync(journalFile, JSON.stringify({
  txid: 'rename-smoke',
  kind: 'rename',
  state: 'files-ready',
  workspaceId: 'ws-alpha',
  oldWorkspaceId: 'ws-alpha',
  oldPath: alphaPath,
  newPath: gammaPath,
  title: 'Gamma',
  accounted: [sessionId],
  allSessions: [sessionId],
  beforeWorkspaceId: 'ws-beta',
  orderIndex: 0,
  backupDir: path.join(root, 'backup', 'rename-smoke'),
}))
const renamed = await finalizePending(ctx, options)
check('rename finalizer commits', renamed.state === 'committed')
check('rename finalizer creates workspace', created.length === 1 && created[0].title === 'Gamma')
check('rename finalizer attaches session', gamma.record.sessionIds.includes(sessionId))
check('rename finalizer restores order', inserted.some((entry) => entry.beforeId === 'ws-beta'))
check('rename finalizer deletes old workspace', deleted.includes('ws-alpha'))

const failed = checks.filter((entry) => !entry.ok)
console.log(JSON.stringify({ ok: failed.length === 0, root, checks, failed: failed.length }, null, 2))
fs.rmSync(root, { recursive: true, force: true })
if (failed.length > 0) process.exitCode = 1
