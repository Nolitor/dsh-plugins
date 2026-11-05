/**
 * Legacy / orphan session-log classifier.
 *
 * Read-only by design: it NEVER moves, rewrites, or deletes a session log. It
 * produces a label set that the Workspace Manager can display so disconnected
 * history is visible instead of silently missing from every group row.
 *
 * Classification (first match wins):
 *   binding-mismatch - the log's directory disagrees with its header cwd (needs manual review)
 *   bound            - the session id is listed in a workspace's sessionIds (the
 *                      registry's actual membership; cwd alone is NOT membership)
 *   child            - a LINKED CHILD session (header parentSession, origin
 *                      "subagent", or delegationDepth > 0) that is not bound. It is
 *                      connected to a live parent session, NOT an orphan, and must
 *                      never be offered for cleanup.
 *   legacy-orphan    - unregistered, not a child, and older than the registration window
 *   unregistered     - valid binding, not bound, not a child, inside the window
 *   unreadable       - the log could not be parsed
 *
 * `disconnected` (the cleanup-facing number) counts labels other than `bound` and
 * `child`: a linked child is missing from the workspace rows but is not abandoned.
 */
import fs from 'node:fs'
import path from 'node:path'
import { encodeSegment, projcachePath, projectKey, readLogFile } from './session-log.mjs'

/**
 * Whether a header describes a linked child session.
 *
 * Measured on the live home (2026-11-05): 20 unregistered logs are children of a live
 * session — `origin: "subagent"`, `parentSession: "session-…"`, `delegationDepth: 1`.
 * They are not orphans. Any one of the three markers is enough; a standalone orphan
 * has `delegationDepth: 0` and no parent.
 *
 * @param {object} header - session log header.
 * @returns {{ child: boolean, parentSession?: string, origin?: string, delegationDepth?: number }} the link facts.
 */
function linkedChildOf(header) {
  const parentSession = typeof header.parentSession === 'string' && header.parentSession !== '' ? header.parentSession : undefined
  const origin = typeof header.origin === 'string' && header.origin !== '' ? header.origin : undefined
  const depth = Number(header.delegationDepth)
  const delegationDepth = Number.isFinite(depth) ? depth : undefined
  return {
    child: parentSession !== undefined || origin === 'subagent' || (delegationDepth !== undefined && delegationDepth > 0),
    ...(parentSession === undefined ? {} : { parentSession }),
    ...(origin === undefined ? {} : { origin }),
    ...(delegationDepth === undefined ? {} : { delegationDepth }),
  }
}

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

    const link = linkedChildOf(header)
    let label
    let reason
    if (!keyMatches || !idMatches) {
      label = 'binding-mismatch'
      reason = keyMatches ? 'session id does not match its directory' : 'header cwd does not match its directory'
    } else if (registered) {
      label = 'bound'
      reason = owner === undefined ? 'session id is referenced by a workspace' : `owned by ${owner.title}`
    } else if (link.child) {
      label = 'child'
      const source = link.parentSession !== undefined
        ? `parent ${link.parentSession}`
        : link.origin === 'subagent' ? 'origin subagent' : `delegationDepth ${link.delegationDepth}`
      reason = `linked child session (${source}); not an orphan`
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
      ...(label === 'child' ? { parentSession: link.parentSession, origin: link.origin, delegationDepth: link.delegationDepth } : {}),
    })
  }

  const counts = {}
  for (const entry of entries) counts[entry.label] = (counts[entry.label] ?? 0) + 1
  const byCwd = {}
  const byCwdDetail = {}
  for (const entry of entries) {
    if (entry.label === 'bound' || entry.label === 'child') continue
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
    // Cleanup-facing count: a linked child is connected to a live parent, not abandoned.
    disconnected: entries.filter((entry) => entry.label !== 'bound' && entry.label !== 'child'),
    linkedChildren: entries.filter((entry) => entry.label === 'child').length,
    entries,
    destructive: false,
    note: 'Labeling only. No log was moved, rewritten, or deleted.',
  }
}
