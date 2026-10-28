/**
 * Transactional batch rename (`rename-batch` journal).
 *
 * A group-wide physical rename is a sequence of per-workspace relocations. This
 * module drives that sequence with:
 *
 *   1. pre-flight validation  (lib/batch-validate.mjs — read-only)
 *   2. a journal written BEFORE any mutation, recording the full plan and an
 *      ordered record of what has been done so far
 *   3. staged directory renames  (two-phase: source -> staging -> target) so a
 *      swap (`A->B` while `B->A`) never collides
 *   4. session log relocation + projcache patch per affected session
 *   5. atomic group-membership re-point after each workspace completes
 *   6. reverse rollback on any failure
 *
 * Live safety: this module never touches the registry directly. The caller
 * passes in the audited relocation/repoint primitives, so the boot finalizer and
 * the record-level workspace.json rollback stay the single source of truth.
 */
import fs from 'node:fs'
import path from 'node:path'
import { validateBatchRename } from './batch-validate.mjs'

export const BATCH_TERMINAL_STATES = new Set(['committed', 'rolledback'])

function journalFile(options) {
  return path.join(options.stateDir, 'journal', 'batch.json')
}

export function readBatchJournal(options) {
  try {
    return JSON.parse(fs.readFileSync(journalFile(options), 'utf8'))
  } catch {
    return undefined
  }
}

export function writeBatchJournal(options, journal) {
  const file = journalFile(options)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const temp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(temp, `${JSON.stringify(journal, null, 2)}\n`)
  fs.renameSync(temp, file)
}

/** A staging path that provably does not exist yet. */
export function stagingPath(targetPath, txid) {
  return `${targetPath}.__staging-${txid}`
}

/**
 * Plan a batch rename: validate + order the moves so a directory is never
 * renamed onto an occupied path. Detects swaps and routes them through staging.
 */
export function planBatchRename({ dshHome, moves = [], registeredIds = [] }) {
  const validation = validateBatchRename({ dshHome, moves, registeredIds })
  const targets = new Set(moves.map((move) => path.resolve(move.targetPath)))
  const sources = new Set(moves.map((move) => path.resolve(move.currentPath)))
  const swaps = []
  for (const move of moves) {
    if (sources.has(path.resolve(move.targetPath))) swaps.push(move.workspaceId)
  }
  return {
    ...validation,
    swaps,
    requiresStaging: swaps.length > 0,
    ordered: moves.map((move) => ({
      workspaceId: move.workspaceId,
      currentPath: path.resolve(move.currentPath),
      targetPath: path.resolve(move.targetPath),
    })),
    targetSet: [...targets],
  }
}

/**
 * Execute a planned batch rename.
 *
 * @param {object} input
 * @param {object} input.options - resolveOptions() result
 * @param {object} input.plan - output of planBatchRename (must be ok)
 * @param {object} input.io - injected primitives:
 *   - relocateWorkspace({workspaceId, from, to, txid}) => { workspacesMoved }
 *   - repointGroup({workspaceId, from, to, title}) => void
 *   - snapshot() => any, restore(snapshot) => void
 * @param {boolean} [input.dryRun]
 */
export async function applyBatchRename({ options, plan, io, dryRun = false }) {
  if (plan.ok !== true) {
    return { ok: false, stage: 'validation', blockerCodes: plan.blockers.map((entry) => entry.code), blockers: plan.blockers }
  }
  if (dryRun) {
    return { ok: true, dryRun: true, mutations: 0, ordered: plan.ordered, requiresStaging: plan.requiresStaging }
  }

  const txid = `batch-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const snapshot = io.snapshot()
  const journal = {
    txid,
    kind: 'rename-batch',
    state: 'prepared',
    createdAt: new Date().toISOString(),
    ordered: plan.ordered,
    requiresStaging: plan.requiresStaging,
    completed: [],
    staged: [],
    repointed: [],
    errors: [],
  }
  writeBatchJournal(options, journal)

  try {
    // Phase 1: park every rename source in a staging directory so swaps are safe.
    for (const move of plan.ordered) {
      if (!fs.existsSync(move.currentPath)) continue
      const staged = stagingPath(move.currentPath, txid)
      fs.renameSync(move.currentPath, staged)
      journal.staged.push({ workspaceId: move.workspaceId, from: move.currentPath, staged })
      journal.state = 'staged'
      writeBatchJournal(options, journal)
    }

    // Phase 2: move each staged directory to its final target.
    for (const move of plan.ordered) {
      const record = journal.staged.find((entry) => entry.workspaceId === move.workspaceId)
      if (record === undefined) continue
      fs.mkdirSync(path.dirname(move.targetPath), { recursive: true })
      fs.renameSync(record.staged, move.targetPath)
      journal.completed.push({ workspaceId: move.workspaceId, from: move.currentPath, to: move.targetPath })
      journal.state = 'files-ready'
      writeBatchJournal(options, journal)
    }

    // Phase 3: relocate session bindings, then re-point group membership.
    for (const move of plan.ordered) {
      const result = await io.relocateWorkspace({
        workspaceId: move.workspaceId,
        from: move.currentPath,
        to: move.targetPath,
        txid,
      })
      await io.repointGroup({ workspaceId: move.workspaceId, from: move.currentPath, to: move.targetPath, result })
      journal.repointed.push(move.workspaceId)
      writeBatchJournal(options, journal)
    }

    journal.state = 'committed'
    journal.committedAt = new Date().toISOString()
    writeBatchJournal(options, journal)
    return { ok: true, txid, state: 'committed', completed: journal.completed.length }
  } catch (error) {
    journal.errors.push(error instanceof Error ? error.message : String(error))
    journal.state = 'rolling-back'
    writeBatchJournal(options, journal)
    const rollback = rollbackBatchRename({ options, journal, io, snapshot, txid })
    return {
      ok: false,
      txid,
      state: 'rolledback',
      error: journal.errors[0],
      rollback,
    }
  }
}

/** Reverse every completed stage; restore the injected snapshot last. */
export function rollbackBatchRename({ options, journal, io, snapshot, txid }) {
  const errors = []
  // Undo final targets back to their originals.
  for (const entry of [...journal.completed].reverse()) {
    try {
      if (fs.existsSync(entry.to)) {
        fs.mkdirSync(path.dirname(entry.from), { recursive: true })
        fs.renameSync(entry.to, entry.from)
      }
    } catch (error) {
      errors.push(`unrename ${entry.workspaceId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  // Un-stage anything still parked.
  for (const entry of [...journal.staged].reverse()) {
    try {
      if (fs.existsSync(entry.staged) && !fs.existsSync(entry.from)) fs.renameSync(entry.staged, entry.from)
    } catch (error) {
      errors.push(`unstage ${entry.workspaceId}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  try {
    io.restore(snapshot)
  } catch (error) {
    errors.push(`restore snapshot: ${error instanceof Error ? error.message : String(error)}`)
  }
  journal.state = 'rolledback'
  journal.rolledBackAt = new Date().toISOString()
  journal.rollbackErrors = errors
  writeBatchJournal(options, journal)
  void txid
  return { ok: errors.length === 0, errors }
}

/**
 * Boot recovery: a journal left in a non-terminal state means the process died
 * mid-batch. Roll it back before anything else reads the registry.
 */
export function recoverBatchRename({ options, io }) {
  const journal = readBatchJournal(options)
  if (journal === undefined) return { state: 'none' }
  if (BATCH_TERMINAL_STATES.has(journal.state)) return { state: journal.state }
  const errors = []
  for (const entry of [...(journal.completed ?? [])].reverse()) {
    try {
      if (fs.existsSync(entry.to) && !fs.existsSync(entry.from)) {
        fs.mkdirSync(path.dirname(entry.from), { recursive: true })
        fs.renameSync(entry.to, entry.from)
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  for (const entry of [...(journal.staged ?? [])].reverse()) {
    try {
      if (fs.existsSync(entry.staged) && !fs.existsSync(entry.from)) fs.renameSync(entry.staged, entry.from)
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error))
    }
  }
  journal.state = 'rolledback'
  journal.recoveredAt = new Date().toISOString()
  journal.rollbackErrors = errors
  writeBatchJournal(options, journal)
  return { state: 'rolledback', txid: journal.txid, errors }
}
