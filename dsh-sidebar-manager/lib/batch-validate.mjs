/**
 * Batch validation for grouped renames (Phase 1 safety pre-requisite).
 *
 * A group-wide rename (`{GROUP}-00-*` -> `{GROUP}-01-*`) is a sequence of
 * per-workspace 2PC relocations. Before the first byte is written this module
 * proves, read-only, that every session binding involved would survive:
 *
 *   - each target directory is a legal, free path (no traversal, no collision)
 *   - every session log satisfies `projectKey(header.cwd) == its directory`
 *   - every projcache `identity.cwd` agrees with its log header
 *   - the flat workspace set is disjoint from the planned targets
 *   - a two-member index swap is detected (needs a staging path, not a rename)
 *
 * It never mutates the registry or the filesystem.
 */
import fs from 'node:fs'
import path from 'node:path'
import { encodeSegment, projcachePath, projectKey, readLogFile } from './session-log.mjs'

const RESERVED_SEGMENTS = new Set(['.', '..'])

/** A physical directory segment is legal when it is a single, non-traversing name. */
export function validateSegment(segment) {
  const codes = []
  if (typeof segment !== 'string' || segment.trim() === '') {
    codes.push({ code: 'FOLDER_BLANK' })
    return codes
  }
  if (segment.includes('/') || segment.includes('\\')) codes.push({ code: 'FOLDER_SEPARATOR', segment })
  if (RESERVED_SEGMENTS.has(segment)) codes.push({ code: 'FOLDER_DOT', segment })
  if (segment.includes('\0')) codes.push({ code: 'FOLDER_NUL', segment })
  if (segment !== segment.trim()) codes.push({ code: 'FOLDER_WHITESPACE', segment })
  // Guard the L13 finding: projectKey() is not injective for deep names because
  // '/' and '-' collapse to the same readable form. Two distinct targets that
  // share a projectKey would share one session directory.
  if (encodeSegment(segment) === '') codes.push({ code: 'FOLDER_UNENCODABLE', segment })
  return codes
}

/** `{GROUP}-{INDEX}-{SUB}` shape check, used only as a proposal/consistency aid. */
export function parseGroupedName(name) {
  if (typeof name !== 'string') return { grouped: false, reason: 'not-a-string' }
  const parts = name.split('-')
  if (parts.length < 3) return { grouped: false, reason: 'too-few-segments' }
  const index = parts[1]
  if (!/^\d{2,3}$/.test(index)) return { grouped: false, reason: 'index-not-numeric' }
  const group = parts[0]
  const sub = parts.slice(2).join('-')
  if (group === '' || sub === '') return { grouped: false, reason: 'empty-segment' }
  return { grouped: true, group, index, sub }
}

function samePathLike(left, right) {
  const norm = (value) => path.resolve(value).replace(/\\/g, '/').toLowerCase()
  return norm(left) === norm(right)
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
 * Build a read-only inventory of every real session binding on disk.
 * `ok` is true only when every log's directory matches its header cwd.
 */
export function auditSessionBindings(dshHome) {
  const findings = []
  let ok = 0
  for (const entry of listLogs(dshHome)) {
    try {
      const log = readLogFile(entry.logPath)
      const header = log.header ?? {}
      const expectedKey = projectKey(header.cwd ?? '')
      const idMatches = encodeSegment(header.id ?? '') === entry.sessionDirName
      const keyMatches = expectedKey === entry.projectDirName
      const cacheFile = projcachePath(dshHome, header.id ?? '')
      let cacheMatches = null
      if (fs.existsSync(cacheFile)) {
        try {
          const document = JSON.parse(fs.readFileSync(cacheFile, 'utf8'))
          const cached = document?.record?.identity?.cwd
          cacheMatches = cached === undefined ? null : samePathLike(cached, header.cwd ?? '')
        } catch {
          cacheMatches = false
        }
      }
      if (idMatches && keyMatches && cacheMatches !== false) {
        ok += 1
      } else {
        findings.push({
          code: 'BINDING_MISMATCH',
          sessionId: header.id,
          cwd: header.cwd,
          idMatches,
          keyMatches,
          cacheMatches,
          path: entry.logPath,
        })
      }
    } catch (error) {
      findings.push({ code: 'LOG_UNREADABLE', path: entry.logPath, error: error instanceof Error ? error.message : String(error) })
    }
  }
  return { total: ok + findings.length, ok, findings }
}

/**
 * Validate a proposed batch rename without touching anything.
 *
 * @param {object} input
 * @param {string} input.dshHome
 * @param {Array<{workspaceId?:string, currentPath:string, targetPath:string}>} input.moves
 * @param {Array<string|number|{id:string|number,path?:string}>} [input.registeredIds]
 *   ids that must remain attached; a `path` may be supplied for cross-checks.
 * @returns {{ok:boolean, blockers:Array<object>, warnings:Array<object>, sessionAudit:object}}
 */
export function validateBatchRename({ dshHome, moves = [], registeredIds = [] }) {
  const blockers = []
  const warnings = []

  if (!Array.isArray(moves) || moves.length === 0) {
    blockers.push({ code: 'BATCH_EMPTY' })
  }

  const targets = new Map()
  for (const move of moves) {
    const currentPath = String(move?.currentPath ?? '')
    const targetPath = String(move?.targetPath ?? '')
    if (currentPath === '') blockers.push({ code: 'CURRENT_PATH_REQUIRED' })
    if (targetPath === '') {
      blockers.push({ code: 'TARGET_PATH_REQUIRED' })
      continue
    }
    for (const segCode of validateSegment(path.basename(targetPath))) {
      blockers.push({ ...segCode, targetPath })
    }
    // Two planned moves must not share a projectKey (session dir collision).
    const key = projectKey(targetPath)
    if (targets.has(key)) {
      blockers.push({ code: 'TARGET_KEY_COLLISION', key, a: targets.get(key), b: targetPath })
    } else {
      targets.set(key, targetPath)
    }
    // A target already occupied on disk diverges from this batch's intent, unless
    // it is the source of another move in the same batch (a swap).
    if (fs.existsSync(targetPath) && !moves.some((other) => samePathLike(other?.currentPath ?? '', targetPath))) {
      blockers.push({ code: 'TARGET_EXISTS', targetPath })
    }
    if (samePathLike(currentPath, targetPath)) blockers.push({ code: 'SAME_PATH', targetPath })
    if (!fs.existsSync(currentPath)) {
      warnings.push({ code: 'SOURCE_MISSING', currentPath })
    }
  }

  // A target that is another workspace's CURRENT directory is a swap hazard even
  // when that workspace is not part of the batch: renaming onto it would either
  // collide or orphan the occupant. Such a batch needs an explicit staging path.
  const swapPairs = []
  const occupantPaths = new Map(
    (Array.isArray(registeredIds) ? registeredIds : [])
      .filter((entry) => typeof entry === 'object' && entry !== null && typeof entry.path === 'string')
      .map((entry) => [String(entry.id), entry.path]),
  )
  for (const move of moves) {
    for (const other of moves) {
      if (move === other) continue
      if (samePathLike(move.targetPath ?? '', other.currentPath ?? '')) swapPairs.push([move.currentPath, move.targetPath])
    }
    for (const [occupantId, occupantPath] of occupantPaths) {
      if (String(move.workspaceId ?? '') === occupantId) continue
      if (samePathLike(move.targetPath ?? '', occupantPath)) {
        swapPairs.push({ currentPath: move.currentPath, targetPath: move.targetPath, occupiedBy: occupantId })
      }
    }
  }
  if (swapPairs.length > 0) {
    blockers.push({ code: 'BATCH_SWAP_REQUIRES_STAGING', pairs: swapPairs })
  }

  // Every registered workspace that is not part of the batch must keep its record.
  const plannedIds = new Set(moves.map((move) => String(move?.workspaceId ?? '')).filter((id) => id !== ''))
  for (const entry of registeredIds) {
    const id = String(typeof entry === 'object' && entry !== null ? entry.id : entry)
    if (id === '') continue
    const planned = moves.some((move) => String(move?.workspaceId ?? '') === id)
    if (!planned) warnings.push({ code: 'REGISTERED_OUTSIDE_BATCH', workspaceId: id })
  }
  if (plannedIds.size !== moves.filter((move) => String(move?.workspaceId ?? '') !== '').length) {
    blockers.push({ code: 'DUPLICATE_WORKSPACE_ID_IN_BATCH' })
  }

  const sessionAudit = auditSessionBindings(dshHome)
  if (sessionAudit.findings.length > 0) {
    // Do not fail the batch for pre-existing unrelated damage; surface it so the
    // operator can exclude those sessions from the batch.
    for (const finding of sessionAudit.findings) {
      warnings.push({ code: 'PREEXISTING_BINDING_ISSUE', ...finding })
    }
  }

  return {
    ok: blockers.length === 0,
    blockers,
    warnings,
    sessionAudit: { total: sessionAudit.total, ok: sessionAudit.ok, issues: sessionAudit.findings.length },
    targets: [...targets.values()],
  }
}

/**
 * Verify a finished batch: every involved session must still resolve to a
 * directory whose name matches its header cwd, and must still be attached to a
 * live workspace record.
 */
export function verifyBatchOutcome({ dshHome, workspaceIds = [] }) {
  const audit = auditSessionBindings(dshHome)
  const involved = new Set(workspaceIds.map((id) => String(id)))
  const problems =
    involved.size === 0
      ? audit.findings
      : audit.findings.filter((finding) => finding.sessionId === undefined || involved.has(String(finding.sessionId)))
  return {
    ok: problems.length === 0,
    total: audit.total,
    healthy: audit.ok,
    problems,
  }
}
