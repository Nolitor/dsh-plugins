/**
 * Legacy / orphan session-log classifier.
 *
 * Read-only by design: it NEVER moves, rewrites, or deletes a session log. It
 * produces a label set that the Workspace Manager can display so disconnected
 * history is visible instead of silently missing from every group row.
 *
 * Classification (first match wins):
 *   bound            - the session id is listed in a workspace's sessionIds (the
 *                      registry's actual membership; cwd alone is NOT membership)
 *   unregistered     - valid binding, but no workspace lists this session id
 *   legacy-orphan    - unregistered and older than the registration window
 *   binding-mismatch - the log's directory disagrees with its header cwd (needs manual review)
 *   unreadable       - the log could not be parsed
 */
import fs from 'node:fs'
import path from 'node:path'
import { encodeSegment, projcachePath, projectKey, readLogFile } from './session-log.mjs'

function norm(value) {
  return typeof value === 'string' ? path.resolve(value).replace(/\\/g, '/').toLowerCase() : ''
}

function listLogs(dshHome) {
  const root = path.join(dshHome, 'sessions')
  if (!fs.existsSync(root)) return []
  const out = []
  for (const project of fs.readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const projectDir = path.join(root, project.name)
    for (const session of fs.readdirSync(projectDir, { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const logPath = path.join(projectDir, session.name, 'session.v4.jsonl.zstd')
      if (fs.existsSync(logPath)) {
        out.push({ projectDirName: project.name, sessionDirName: session.name, logPath })
      }
    }
  }
  return out
}

/**
 * @param {object} input
 * @param {string} input.dshHome
 * @param {Array<{id:string,path:string,title:string,sessionIds?:string[]}>} input.workspaces
 * @param {number} [input.nowMs] - injectable clock for deterministic tests
 * @param {number} [input.legacyAgeDays] - logs older than this are "legacy"
 */
export function classifyOrphanLogs({ dshHome, workspaces = [], nowMs = Date.now(), legacyAgeDays = 30 }) {
  const ownedSessionIds = new Set()
  const cwdByWorkspace = new Map()
  for (const workspace of workspaces) {
    cwdByWorkspace.set(norm(workspace.path), workspace)
    for (const sessionId of workspace.sessionIds ?? []) ownedSessionIds.add(sessionId)
  }

  const entries = []
  for (const log of listLogs(dshHome)) {
    let header
    try {
      header = readLogFile(log.logPath).header ?? {}
    } catch (error) {
      entries.push({
        sessionId: log.sessionDirName,
        cwd: undefined,
        label: 'unreadable',
        path: log.logPath,
        reason: error instanceof Error ? error.message : String(error),
      })
      continue
    }
    const expectedKey = projectKey(header.cwd ?? '')
    const keyMatches = expectedKey === log.projectDirName
    const idMatches = encodeSegment(header.id ?? '') === log.sessionDirName
    const owner = cwdByWorkspace.get(norm(header.cwd ?? ''))
    // Membership is by session id. A directory shared by several workspaces must
    // not make every log in it look "bound" (audit A: 31 logs vs 8 registered).
    const registered = ownedSessionIds.has(header.id)
    const createdAt = header.createdAt === undefined ? undefined : Date.parse(header.createdAt)
    const ageDays = Number.isFinite(createdAt) ? Math.floor((nowMs - createdAt) / 86_400_000) : undefined

    let label
    let reason
    if (!keyMatches || !idMatches) {
      label = 'binding-mismatch'
      reason = keyMatches ? 'session id does not match its directory' : 'header cwd does not match its directory'
    } else if (registered) {
      label = 'bound'
      reason = owner === undefined ? 'session id is referenced by a workspace' : `owned by ${owner.title}`
    } else if (ageDays !== undefined && ageDays >= legacyAgeDays) {
      label = 'legacy-orphan'
      reason = `unregistered and ${ageDays} days old`
    } else {
      label = 'unregistered'
      reason = 'valid log with no workspace record'
    }

    const cacheFile = projcachePath(dshHome, header.id ?? '')
    entries.push({
      sessionId: header.id,
      cwd: header.cwd,
      title: header.title,
      createdAt: header.createdAt,
      ageDays,
      label,
      reason,
      path: log.logPath,
      projectDirName: log.projectDirName,
      hasProjcache: fs.existsSync(cacheFile),
    })
  }

  const counts = {}
  for (const entry of entries) counts[entry.label] = (counts[entry.label] ?? 0) + 1
  const byCwd = {}
  const byCwdDetail = {}
  for (const entry of entries) {
    if (entry.label === 'bound') continue
    const key = entry.cwd ?? '(unknown)'
    byCwd[key] = (byCwd[key] ?? 0) + 1
    byCwdDetail[key] = byCwdDetail[key] ?? {}
    byCwdDetail[key][entry.label] = (byCwdDetail[key][entry.label] ?? 0) + 1
  }

  return {
    total: entries.length,
    counts,
    byCwd,
    byCwdDetail,
    disconnected: entries.filter((entry) => entry.label !== 'bound'),
    entries,
    destructive: false,
    note: 'Labeling only. No log was moved, rewritten, or deleted.',
  }
}
