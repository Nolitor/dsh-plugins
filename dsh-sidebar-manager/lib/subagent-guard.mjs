/**
 * Sub-agent capture / verification guard.
 *
 * Empirical finding (2026-10-25 audit): of 60 unregistered session logs, 59 (98%)
 * carry `origin: "subagent"` with a `parentSession` that IS a registered session,
 * and 48 (80%) hold a single event frame (no turn content). They are delegation
 * artifacts, not lost user work.
 *
 * The promotion spec already states the rule (UTM-PROMOTION-GATE-SPEC §3.1-6:
 * "subagent 독립 승격 금지 — 부모 cube의 derived scope 유지"). This module turns
 * that invariant into an executable guard:
 *
 *   - a sub-agent log is NEVER promoted as an independent workspace;
 *   - it is attributed to its parent session's workspace instead;
 *   - unattributable sub-agent logs are reported, never silently dropped.
 *
 * Everything here is read-only.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { readLogFile } from './session-log.mjs'

/** Is this header a delegation artifact rather than a user session? */
export function isSubagentHeader(header = {}) {
  return header.origin === 'subagent' || (header.parentSession !== undefined && (header.delegationDepth ?? 0) > 0)
}

/**
 * Classify a log into an attribution decision.
 *
 * @param {object} input
 * @param {object} input.header
 * @param {Map<string, string>} input.sessionToWorkspace - sessionId -> workspaceId
 * @returns {{kind:string, workspaceId?:string, reason:string}}
 */
export function attributeSession({ header, sessionToWorkspace }) {
  const isSub = isSubagentHeader(header)
  if (!isSub) {
    return { kind: 'primary', reason: 'originates from a user session' }
  }
  const parent = header.parentSession
  if (parent === undefined) {
    return { kind: 'subagent-orphan', reason: 'sub-agent log without a parent pointer' }
  }
  const workspaceId = sessionToWorkspace.get(parent)
  if (workspaceId === undefined) {
    // Walk one more level: a nested sub-agent may point at another sub-agent.
    const grand = sessionToWorkspace.get(`session-${parent}`)
    if (grand !== undefined) return { kind: 'subagent-inherited', workspaceId: grand, parent, reason: 'nested delegation inherits the root workspace' }
    return { kind: 'subagent-unattributed', parent, reason: 'parent session is not registered to any workspace' }
  }
  return { kind: 'subagent-inherited', workspaceId, parent, reason: 'inherits the parent session workspace' }
}

/** Build sessionId -> workspaceId from registry records. */
export function sessionWorkspaceIndex(workspaces = []) {
  const index = new Map()
  for (const workspace of workspaces) {
    for (const sessionId of workspace.sessionIds ?? []) index.set(sessionId, String(workspace.id ?? workspace.workspaceId))
  }
  return index
}

/**
 * Audit every session log on disk and return per-log attribution.
 * @param {{dshHome?:string, workspaces:Array}} input
 */
export function auditSubagentArtifacts({ dshHome, workspaces = [] }) {
  const root = dshHome ?? path.join(os.homedir(), '.dsh')
  const index = sessionWorkspaceIndex(workspaces)
  const registered = new Set(index.keys())
  const sessionsDir = path.join(root, 'sessions')
  const entries = []
  if (fs.existsSync(sessionsDir)) {
    for (const project of fs.readdirSync(sessionsDir, { withFileTypes: true })) {
      if (!project.isDirectory()) continue
      const projectDir = path.join(sessionsDir, project.name)
      for (const session of fs.readdirSync(projectDir, { withFileTypes: true })) {
        if (!session.isDirectory()) continue
        const file = path.join(projectDir, session.name, 'session.v4.jsonl.zstd')
        if (!fs.existsSync(file)) continue
        let header
        try {
          header = readLogFile(file).header ?? {}
        } catch {
          continue
        }
        const isRegistered = registered.has(header.id)
        if (isRegistered) continue
        const decision = attributeSession({ header, sessionToWorkspace: index })
        entries.push({
          sessionId: header.id,
          cwd: header.cwd,
          parentSession: header.parentSession,
          delegationDepth: header.delegationDepth,
          origin: header.origin,
          agentPreset: header.agentPreset,
          createdAt: header.createdAt,
          label: decision.kind,
          attributedWorkspaceId: decision.workspaceId,
          reason: decision.reason,
          path: file,
        })
      }
    }
  }
  const counts = {}
  for (const entry of entries) counts[entry.label] = (counts[entry.label] ?? 0) + 1
  const attributable = entries.filter((entry) => entry.attributedWorkspaceId !== undefined)
  return {
    total: entries.length,
    counts,
    attributable: attributable.length,
    unattributable: entries.length - attributable.length,
    entries,
    destructive: false,
    rule: 'sub-agent logs are attributed to the parent workspace and never promoted independently',
  }
}

/**
 * Verification guard for a future capture: given a fresh run, assert that no new
 * sub-agent log drifts outside a parent workspace.
 */
export function verifyCaptureGuard({ before, after }) {
  const known = new Set(before.map((entry) => entry.sessionId))
  const fresh = after.filter((entry) => !known.has(entry.sessionId))
  const leaked = fresh.filter((entry) => entry.attributedWorkspaceId === undefined)
  return {
    ok: leaked.length === 0,
    newArtifacts: fresh.length,
    attributed: fresh.length - leaked.length,
    leaked: leaked.map((entry) => ({ sessionId: entry.sessionId, parentSession: entry.parentSession, reason: entry.reason })),
  }
}
