/**
 * Subagent resilience: orphan cleanup and partial-artifact salvage.
 *
 * Two measured failures motivated this module (2026-11-05):
 *
 *  - A parent turn could end in error while its background children kept
 *    running. Item 4 of the owner's 2026-11-05 instruction names that as an
 *    orphan: nothing collects the child, yet it keeps spending quota.
 *  - A child that died mid-track lost nothing on disk, but the parent had no
 *    record of what the child had produced, so it re-ran the whole track
 *    (measured: 56 duplicate tool calls / 7.8 min after one HTTP 451). A
 *    salvage manifest makes the surviving files discoverable and keeps the
 *    failure evidence next to them.
 *
 * Both behaviors are opt-out through the adapter config so an operator can
 * disable them without editing the plugin.
 *
 * @module @nolit/dsh-opencode-v2/resilience
 */
import { mkdir, readdir, stat, writeFile } from 'node:fs/promises'
import { homedir } from 'node:os'
import { join, relative, sep } from 'node:path'

import { optionalService } from './optional-service.js'

/** Directories a salvage walk never enters. */
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.cache', '.turbo', '.next'])

/** Defaults for a bounded walk; a failed child must not turn into a disk scan. */
const DEFAULT_MAX_FILES = 200
const DEFAULT_MAX_DEPTH = 8
const DEFAULT_MAX_ENTRIES = 20000

/**
 * Resolve the directory salvage manifests are written to.
 *
 * Follows the plugin's state convention: an explicit config path wins, then
 * `$DSH_HOME/opencode-v2/salvage`, then `~/.dsh/opencode-v2/salvage`.
 *
 * @param {string} explicit - `salvageDir` config value.
 * @returns {string} absolute directory.
 */
export function resolveSalvageDir(explicit = '') {
  if (typeof explicit === 'string' && explicit.trim().length > 0) return explicit.trim()
  const home = process.env.DSH_HOME || join(homedir(), '.dsh')
  return join(home, 'opencode-v2', 'salvage')
}

/**
 * Walk a workspace and collect files modified at or after `sinceMs`.
 *
 * @param {string} cwd - workspace root.
 * @param {{sinceMs?: number, maxFiles?: number, maxDepth?: number, maxEntries?: number, signal?: AbortSignal}} [options]
 * @returns {Promise<{files: {path: string, bytes: number, mtimeMs: number}[], truncated: boolean}>}
 */
export async function collectChangedFiles(cwd, options = {}) {
  const sinceMs = Number(options.sinceMs) || 0
  const maxFiles = Math.max(1, Number(options.maxFiles) || DEFAULT_MAX_FILES)
  const maxDepth = Math.max(0, Number(options.maxDepth) ?? DEFAULT_MAX_DEPTH)
  const maxEntries = Math.max(1, Number(options.maxEntries) || DEFAULT_MAX_ENTRIES)

  const files = []
  let seen = 0
  let truncated = false
  const queue = [{ dir: cwd, depth: 0 }]

  while (queue.length > 0) {
    const { dir, depth } = queue.shift()
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (options.signal?.aborted) return { files, truncated: true }
      seen += 1
      if (seen > maxEntries) return { files, truncated: true }
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth >= maxDepth || SKIP_DIRECTORIES.has(entry.name)) continue
        queue.push({ dir: full, depth: depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      let info
      try {
        info = await stat(full)
      } catch {
        continue
      }
      if (info.mtimeMs < sinceMs) continue
      if (files.length >= maxFiles) return { files, truncated: true }
      files.push({ path: relative(cwd, full).split(sep).join('/'), bytes: info.size, mtimeMs: Math.round(info.mtimeMs) })
    }
  }
  files.sort((left, right) => left.path.localeCompare(right.path))
  return { files, truncated }
}

/**
 * The live descendant Agents of one root session, at any depth.
 *
 * Mirrors the shipped subagent archive admission: lineage is read from the
 * durable header (`parentSession` + `origin: 'subagent'`), so a damaged chain
 * that loops is visited once.
 *
 * @param {{list: () => Array<{id: string, status?: string, session?: {header?: object}}>}} agents - agent registry.
 * @param {string} rootId - session whose descendants are collected.
 * @returns {Array<object>} running descendant Agents.
 */
export function runningDescendants(agents, rootId) {
  const childrenOf = new Map()
  for (const agent of agents.list()) {
    const header = agent?.session?.header
    if (!header || header.parentSession === undefined || header.origin !== 'subagent') continue
    const siblings = childrenOf.get(header.parentSession) ?? []
    siblings.push(agent)
    childrenOf.set(header.parentSession, siblings)
  }
  const running = []
  const pending = [rootId]
  const visited = new Set()
  while (pending.length > 0) {
    const parentId = pending.shift()
    if (visited.has(parentId)) continue
    visited.add(parentId)
    for (const child of childrenOf.get(parentId) ?? []) {
      if (child.status === 'running') running.push(child)
      pending.push(child.id)
    }
  }
  return running
}

/**
 * Whether any ancestor of a child is absent from the live agent registry.
 *
 * @param {{list: () => Array<{id: string}>}} agents - agent registry.
 * @param {object} child - Agent carrying `session.header`.
 * @returns {boolean} true for a true orphan.
 */
export function isOrphan(agents, child) {
  const live = new Set(agents.list().map((agent) => agent.id))
  const seen = new Set()
  let parentId = child?.session?.header?.parentSession
  while (typeof parentId === 'string' && parentId.length > 0) {
    if (seen.has(parentId)) return false
    seen.add(parentId)
    if (!live.has(parentId)) return true
    const parent = agents.list().find((agent) => agent.id === parentId)
    parentId = parent?.session?.header?.parentSession
  }
  return false
}

/**
 * Cancel one Agent without letting a teardown failure escape the sweep.
 *
 * @param {object} child - Agent with `cancel`.
 * @param {Function} log - host logger.
 * @returns {boolean} whether the cancellation was issued.
 */
function cancelChild(child, log) {
  try {
    child.cancel?.({ kind: 'parent' })
    return true
  } catch (error) {
    log(`resilience: cancelling subagent "${child?.id ?? '?'}" failed: ${error instanceof Error ? error.message : String(error)}`)
    return false
  }
}

/**
 * Write one salvage manifest for a child whose turn failed.
 *
 * The manifest is additive evidence: files stay where the child wrote them, and
 * the JSON (plus a small Markdown twin) names what survived and why the turn
 * ended. Persistence failures are logged, never thrown into the session.
 *
 * @param {{session: object, event: object}} input - failing session and its turn/end event.
 * @param {{dir?: string, maxFiles?: number, cwd?: string}} [options] - storage bounds.
 * @param {Function} log - host logger.
 * @returns {Promise<string|null>} the manifest path, or null when nothing was written.
 */
export async function writeSalvageManifest(input, options = {}, log = () => {}) {
  const session = input?.session
  const event = input?.event
  const id = typeof session?.id === 'string' ? session.id : ''
  if (id === '') return null
  const header = session.header ?? {}
  const cwd = typeof options.cwd === 'string' && options.cwd.length > 0 ? options.cwd : header.cwd
  const createdAt = Number(header.createdAt) || 0
  const reason = event?.data?.reason ?? {}
  const message = reason?.error?.message ?? reason?.failure?.message ?? reason?.error?.code ?? 'turn failed'
  const dir = resolveSalvageDir(options.dir)

  let changed = { files: [], truncated: false }
  if (typeof cwd === 'string' && cwd.length > 0) {
    changed = await collectChangedFiles(cwd, {
      sinceMs: createdAt,
      maxFiles: options.maxFiles,
    })
  }

  const manifest = {
    version: 1,
    kind: 'subagent-salvage',
    childSessionId: id,
    parentSessionId: header.parentSession ?? null,
    cwd: cwd ?? null,
    failedAt: new Date(Number(event?.time) || Date.now()).toISOString(),
    reason: {
      kind: reason?.kind ?? 'error',
      code: reason?.error?.code ?? reason?.failure?.code ?? null,
      message: String(message).slice(0, 2000),
    },
    files: changed.files,
    truncated: changed.truncated,
    // The transcript itself is durable in the DSH session store; the manifest
    // points at it by id so a log purge is the only way to lose it.
    sessionLogHint: `DSH session store entry ${id} (session.v4.jsonl.zstd)`,
  }

  const target = join(dir, `${id}.json`)
  const markdown = join(dir, `${id}.md`)
  try {
    await mkdir(dir, { recursive: true })
    await writeFile(target, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8')
  } catch (error) {
    log(`resilience: salvage manifest for "${id}" could not be written: ${error instanceof Error ? error.message : String(error)}`)
    return null
  }

  // The Markdown twin is for a human (or a parent model) scanning the directory:
  // it names what survived without requiring JSON parsing.
  const lines = [
    `# Partial artifacts — ${id}`,
    '',
    `- parent: ${manifest.parentSessionId ?? '(none)'}`,
    `- cwd: ${manifest.cwd ?? '(unknown)'}`,
    `- failed at: ${manifest.failedAt}`,
    `- reason: ${manifest.reason.code ?? manifest.reason.kind} — ${manifest.reason.message}`,
    `- files changed since the child started: ${manifest.files.length}${manifest.truncated ? ' (truncated)' : ''}`,
    '',
    '## Files',
    '',
    ...manifest.files.map((file) => `- \`${file.path}\` (${file.bytes} B, mtime ${new Date(file.mtimeMs).toISOString()})`),
    manifest.files.length === 0 ? '- (none observed)' : '',
    '',
  ]
  try {
    await writeFile(markdown, lines.join('\n'), 'utf8')
  } catch {
    /* the JSON is the durable record; the twin is advisory */
  }
  return target
}

/**
 * Install the two resilience listeners and the orphan sweep.
 *
 * @param {object} ctx - cordis context carrying `agents`/`sessions` optionally.
 * @param {object} config - adapter config (schemastery accessors).
 * @param {(message: string) => void} log - host logger.
 * @returns {{dispose: () => void, sweep: () => number}} test seams.
 */
export function installResilience(ctx, config, log = () => {}) {
  // `ctx.get(name)` is the dependency-free read: unlike `ctx[name]` it does not
  // throw for a service this plugin did not declare in `inject`, so an agent-less
  // host degrades to "no cleanup" instead of a dead route.
  const readService = (name) => {
    try {
      return ctx?.get?.(name) ?? optionalService(ctx, name)
    } catch {
      return optionalService(ctx, name)
    }
  }
  const agents = readService('agents')
  const cleanupEnabled = agents !== undefined && (config.orphanCleanup?.get?.() ?? true)
  const salvageEnabled = config.salvage?.get?.() ?? true
  const sweepMs = Math.max(5000, Number(config.orphanSweepMs?.get?.()) || 60000)
  const salvageDir = config.salvageDir?.get?.() ?? ''
  const salvageMaxFiles = Number(config.salvageMaxFiles?.get?.()) || DEFAULT_MAX_FILES

  const onEvent = (session, event) => {
    if (event?.type !== 'turn/end') return
    const reason = event?.data?.reason
    const failed = reason?.kind === 'error' || reason?.kind === 'aborted'
    const isChild = session?.header?.origin === 'subagent'

    if (salvageEnabled && failed && isChild) {
      // Fire-and-forget: the turn is already ending and the manifest cannot
      // change its outcome.
      void writeSalvageManifest({ session, event }, { dir: salvageDir, maxFiles: salvageMaxFiles }, log)
    }
    // A failed turn at any depth abandons its running descendants; a child that
    // is being cancelled may itself own grandchildren.
    if (cleanupEnabled && failed) {
      for (const child of runningDescendants(agents, session.id)) {
        if (cancelChild(child, log)) log(`resilience: cancelled orphan "${child.id}" after parent "${session.id}" failed`)
      }
    }
  }
  try {
    ctx?.on?.('session/event', onEvent)
  } catch (error) {
    log(`resilience: session/event listener could not be installed: ${error instanceof Error ? error.message : String(error)}`)
  }

  const sweep = () => {
    if (!cleanupEnabled) return 0
    let cancelled = 0
    for (const child of agents.list()) {
      const header = child?.session?.header
      if (header?.origin !== 'subagent' || child.status !== 'running') continue
      if (!isOrphan(agents, child)) continue
      if (cancelChild(child, log)) {
        cancelled += 1
        log(`resilience: cancelled orphan subagent "${child.id}" (parent is not live)`)
      }
    }
    return cancelled
  }
  const timer = setInterval(sweep, sweepMs)
  if (typeof timer?.unref === 'function') timer.unref()

  return {
    sweep,
    dispose: () => clearInterval(timer),
  }
}
