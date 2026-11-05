#!/usr/bin/env node
/**
 * cleanup-orphan-sessions — plan, and (with owner approval) quarantine, orphan session logs.
 *
 * WHAT THIS CLEANS: session logs under `$DSH_HOME/sessions/` that no workspace lists
 * (the sidebar's "그룹 없음" / unregistered section). Workspaces, groups, settings and
 * bound sessions are never touched. The removal is a MOVE into
 * `$DSH_HOME/quarantine-backups/orphan-sessions-<stamp>/`, never a `rm`.
 *
 * CLASSIFICATION (first match wins; only `A` is removable):
 *   A tmp-test  : classifier says `unregistered`/`legacy-orphan`, header cwd is under
 *                 /tmp (or macOS temp), that cwd no longer exists, and the log has no
 *                 child marker. Safe to move.
 *   B child     : the classifier labels it `child` (header parentSession /
 *                 origin "subagent" / delegationDepth > 0) — linked to a live parent
 *                 session, NOT an orphan. KEEP.
 *   C real-log  : any other cwd (an existing project directory) or a manual-review
 *                 label (`binding-mismatch`, `unreadable`). KEEP.
 *   unreadable  : the header cannot be parsed. KEEP (needs manual review).
 *
 * The classifier in `dsh-sidebar-manager/lib/orphan-classifier.mjs` is the reporting
 * authority for labels (`bound` / `unregistered` / `legacy-orphan` / `binding-mismatch`
 * / `unreadable`). This script runs it read-only and adds the A/B/C safety class on top;
 * a label other than `bound` is not by itself permission to delete.
 *
 * SAFETY:
 *   - dry-run by default; `--apply` also requires `--approve <digest>` from that dry run;
 *   - refuses to run against a directory that is not a DSH home;
 *   - a write failure (for example the read-only agent sandbox) is reported as a clear
 *     "run as the DSH service user" error instead of a crash;
 *   - after applying it re-runs the classifier and prints the before → after counts.
 *
 * USAGE (the agent only runs the dry run):
 *   node scripts/cleanup-orphan-sessions.mjs                 # plan (no changes)
 *   node scripts/cleanup-orphan-sessions.mjs --json          # machine-readable plan
 *   node scripts/cleanup-orphan-sessions.mjs --apply --approve <digest>
 *   node scripts/cleanup-orphan-sessions.mjs --home /path/to/dsh-home   # inspection only
 *
 * A linked child session is never proposed: the classifier reports it as `child`
 * (header parentSession / origin "subagent" / delegationDepth > 0), and only a log
 * labelled `unregistered`/`legacy-orphan` can enter the removable class.
 *
 * See docs/ORPHAN-SESSION-CLEANUP.md for the measured plan and the approval command.
 *
 * @module scripts/cleanup-orphan-sessions
 */
import { createHash } from 'node:crypto'
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmdirSync, statSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'

import { classifyOrphanLogs } from '../dsh-sidebar-manager/lib/orphan-classifier.mjs'
import { projcachePath, readLogFile } from '../dsh-sidebar-manager/lib/session-log.mjs'

const argv = process.argv.slice(2)
const JSON_OUT = argv.includes('--json')
const APPLY = argv.includes('--apply')
const approveIndex = argv.indexOf('--approve')
const APPROVE = approveIndex >= 0 ? argv[approveIndex + 1] : undefined
const homeIndex = argv.indexOf('--home')
/** Explicit --home (inspection/tests) or the environment home. */
const CLI_HOME = resolve(homeIndex >= 0 && argv[homeIndex + 1] ? argv[homeIndex + 1] : (process.env.DSH_HOME ?? join(homedir(), '.dsh')))

/** Read the workspace registry, tolerating both the live shape and an older array shape. */
function readWorkspaces(home) {
  const file = join(home, 'storages', 'workspace.json')
  const document = JSON.parse(readFileSync(file, 'utf8'))
  const table = document?.tables?.workspaces
  if (table && typeof table === 'object') return Object.entries(table).map(([id, workspace]) => ({ id, ...workspace }))
  if (Array.isArray(document?.workspaces)) return document.workspaces
  throw new Error(`unrecognised workspace registry shape in ${file}`)
}

const isTmpPath = (cwd) => typeof cwd === 'string' && (cwd.startsWith('/tmp/') || cwd.startsWith('/var/folders/'))

/**
 * Safety class for one unbound session log.
 * @param {object} entry - classifier entry.
 * @returns {{ kind: string, verdict: 'REMOVE'|'KEEP', cwdExists: boolean, isSubagent: boolean }}
 */
function safetyOf(entry) {
  let header = {}
  try { header = readLogFile(entry.path).header ?? {} } catch { return { kind: 'unreadable', verdict: 'KEEP', cwdExists: false, isChild: false } }
  const cwdExists = typeof entry.cwd === 'string' && existsSync(entry.cwd)
  // Belt and braces: the classifier labels linked children `child`, and the header
  // markers are re-checked here so a stale classifier can never propose a child.
  const headerChild = typeof header.parentSession === 'string' && header.parentSession !== ''
    || header.origin === 'subagent'
    || (Number.isFinite(Number(header.delegationDepth)) && Number(header.delegationDepth) > 0)
  const isChild = entry.label === 'child' || headerChild
  if (isChild) return { kind: 'B-child', verdict: 'KEEP', cwdExists, isChild }
  // A log the classifier flags for manual review (binding mismatch / unreadable) is
  // never a removal candidate, even if its cwd happens to be a deleted temp path.
  const reviewable = entry.label === 'unregistered' || entry.label === 'legacy-orphan'
  if (!reviewable) return { kind: 'C-real-log', verdict: 'KEEP', cwdExists, isChild }
  if (isTmpPath(entry.cwd) && !cwdExists) return { kind: 'A-tmp-test', verdict: 'REMOVE', cwdExists, isChild }
  return { kind: 'C-real-log', verdict: 'KEEP', cwdExists, isChild }
}

/** Build the plan without changing anything. */
export function buildPlan({ home = CLI_HOME } = {}) {
  if (!existsSync(join(home, 'storages', 'workspace.json'))) {
    throw new Error(`not a DSH home (no storages/workspace.json): ${home}`)
  }
  const workspaces = readWorkspaces(home)
  const classified = classifyOrphanLogs({ dshHome: home, workspaces })
  const unbound = classified.entries.filter((entry) => entry.label !== 'bound')
  const rows = unbound.map((entry) => {
    const safety = safetyOf(entry)
    return {
      sessionId: entry.sessionId,
      label: entry.label,
      reason: entry.reason,
      cwd: entry.cwd,
      createdAt: entry.createdAt,
      kind: safety.kind,
      verdict: safety.verdict,
      cwdExists: safety.cwdExists,
      isSubagent: safety.isSubagent,
      bytes: statSync(entry.path).size,
      path: entry.path,
      projectDirName: entry.projectDirName,
    }
  })
  const digest = createHash('sha256')
    .update(JSON.stringify(rows.map((row) => [row.sessionId, row.verdict])))
    .digest('hex')
    .slice(0, 16)
  return {
    home,
    measuredAt: new Date().toISOString(),
    workspaces: workspaces.length,
    logs: classified.entries.length,
    classifierCounts: classified.counts ?? {},
    candidates: rows.length,
    counts: {
      remove: rows.filter((row) => row.verdict === 'REMOVE').length,
      keepChildren: rows.filter((row) => row.kind === 'B-child').length,
      keepReal: rows.filter((row) => row.kind === 'C-real-log').length,
      keepUnreadable: rows.filter((row) => row.kind === 'unreadable').length,
      bytes: rows.filter((row) => row.verdict === 'REMOVE').reduce((sum, row) => sum + row.bytes, 0),
    },
    digest,
    rows,
  }
}

function printPlan(plan) {
  console.log('DSH_HOME              :', plan.home)
  console.log('workspaces            :', plan.workspaces)
  console.log('session logs          :', plan.logs, '| classifier:', JSON.stringify(plan.classifierCounts))
  console.log('unbound (no workspace):', plan.candidates)
  console.log('  REMOVE tmp-test     :', plan.counts.remove, '(' + (plan.counts.bytes / 1048576).toFixed(2) + ' MiB)')
  console.log('  KEEP linked child   :', plan.counts.keepChildren)
  console.log('  KEEP real project   :', plan.counts.keepReal)
  console.log('  KEEP unreadable     :', plan.counts.keepUnreadable)
  const remove = plan.rows.filter((row) => row.verdict === 'REMOVE')
  if (remove.length > 0) {
    console.log('\nWOULD MOVE to quarantine (owner approval required):')
    for (const row of remove) console.log(`  ${row.sessionId}  cwd=${row.cwd}  ${row.bytes} B  label=${row.label}`)
  }
  const keep = plan.rows.filter((row) => row.verdict === 'KEEP')
  if (keep.length > 0) {
    console.log('\nKEEP (not touched):')
    for (const row of keep) console.log(`  ${row.sessionId}  ${row.kind}  cwd=${row.cwd}`)
  }
  console.log('\nplan digest:', plan.digest)
  if (!APPLY) console.log('DRY RUN — nothing changed. Owner: re-run with --apply --approve ' + plan.digest)
}

/** Quarantine the removable sessions. Never deletes; moves into a backup folder. */
export function applyPlan(plan) {
  const HOME = plan.home
  const targets = plan.rows.filter((row) => row.verdict === 'REMOVE')
  if (targets.length === 0) return { moved: 0, backupDir: null, remaining: plan.candidates }
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  const backupDir = join(HOME, 'quarantine-backups', 'orphan-sessions-' + stamp)
  try {
    mkdirSync(backupDir, { recursive: true, mode: 0o700 })
  } catch (error) {
    throw new Error(
      `cannot create ${backupDir}: ${error.message}\n` +
      'This session cannot write the DSH home (agent sandbox). Run the command as the DSH service user.',
    )
  }
  const registry = join(HOME, 'storages', 'workspace.json')
  copyFileSync(registry, join(backupDir, 'workspace.json'))
  const emptiedDirs = new Set()
  let moved = 0
  for (const row of targets) {
    const from = join(HOME, 'sessions', row.projectDirName, row.sessionId)
    const to = join(backupDir, 'sessions', row.projectDirName, row.sessionId)
    mkdirSync(join(to, '..'), { recursive: true })
    renameSync(from, to)
    moved++
    emptiedDirs.add(row.projectDirName)
    const cache = projcachePath(HOME, row.sessionId)
    if (existsSync(cache)) {
      mkdirSync(join(backupDir, 'projcache'), { recursive: true })
      renameSync(cache, join(backupDir, 'projcache', row.sessionId + '.json'))
    }
  }
  let removedDirs = 0
  for (const dir of emptiedDirs) {
    const path = join(HOME, 'sessions', dir)
    try {
      if (readdirSync(path).length === 0) { rmdirSync(path); removedDirs++ }
    } catch { /* a directory that still has other sessions stays */ }
  }
  const after = classifyOrphanLogs({ dshHome: HOME, workspaces: readWorkspaces(HOME) })
  return { moved, removedDirs, backupDir, remaining: (after.entries ?? []).filter((entry) => entry.label !== 'bound').length, after: after.counts ?? {} }
}

// ---------------------------------------------------------------------------
// CLI (only when executed directly; the functions above are importable for tests).
// ---------------------------------------------------------------------------
const isMain = process.argv[1] !== undefined && import.meta.url.endsWith(process.argv[1].split('/').pop())
if (isMain) {
  const plan = buildPlan()
  if (JSON_OUT) console.log(JSON.stringify(plan, null, 2))
  else printPlan(plan)

  if (!APPLY) process.exitCode = 0
  else if (APPROVE !== plan.digest) {
    console.error(`\nREFUSED: --approve must equal the dry-run digest (${plan.digest}).`)
    process.exitCode = 2
  } else {
    const result = applyPlan(plan)
    console.log('\nAPPLIED (moved to quarantine, nothing deleted)')
    console.log('  moved sessions :', result.moved)
    console.log('  removed dirs   :', result.removedDirs ?? 0)
    console.log('  backup         :', result.backupDir)
    console.log('  unbound after  :', result.remaining, '| classifier:', JSON.stringify(result.after))
  }
}
