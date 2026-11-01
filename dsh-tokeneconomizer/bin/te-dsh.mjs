#!/usr/bin/env node
/**
 * Operator command line for @nolit/dsh-tokeneconomizer.
 *
 *   te-dsh bootstrap [--source <checkout>] [--sha <commit>] [--home <state root>]
 *       Materialize the patched TokenEconomizer core, write `bin/te` and `bin/te-hook`, and
 *       verify that `te --host dsh` answers. See scripts/bootstrap.mjs.
 *
 *   te-dsh cold-start [--dsh-home <dir>] [--limit N] [--all] [--dry-run] [--reimport]
 *                     [--only <repoKey>] [--include-missing]
 *       Decompress every finished DSH session and fold it into the engine, so what earlier
 *       sessions taught is available before the next one starts. Sessions modified in the last
 *       minute are skipped unless `--all`, because the harness may still be writing them.
 *       Skipped by default: a session this state root already folded, one that already has a
 *       record carrying turns, and one whose working directory no longer exists (a throwaway
 *       test tree). `--reimport` forces the first two, `--include-missing` forces the third.
 *       `--only <repoKey>` migrates one repository, as printed by `te-dsh cold-start --dry-run`.
 *       A full run folds oldest-first; `--limit` folds the newest N.
 *
 *   te-dsh purge [--exports] [--state] [--all] [--dry-run] [--yes]
 *       Remove this plugin's engine state. `--exports` removes the decompressed session copies,
 *       `--state` removes the engine's per-repository state and the launchers. The state-root
 *       directory itself stays, and DSH's own session logs are never touched.
 *
 *   te-dsh status [--cwd <dir>]
 *       Print `te --host dsh status --json` for a directory.
 *
 *   te-dsh doctor
 *       Report which launchers and patch are in place, without changing anything.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { importExport, launchers, stateRoot } from '../lib/bridge.js'
import { repoIdentity } from '../lib/repokey.js'
import { main as bootstrapMain, PINNED_SHA, verify } from '../scripts/bootstrap.mjs'

const argv = process.argv.slice(2)
const command = argv[0] ?? 'status'

/**
 * Read one flag value.
 * @param {string} name - flag including dashes.
 * @param {string} [fallback] - value when absent.
 * @returns {string | undefined} the value.
 */
const flag = (name, fallback) => {
  const i = argv.indexOf(name)
  return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
}

/**
 * `<DSH_HOME>`, else `~/.dsh` — where the harness keeps profiles and sessions.
 * @returns {string} absolute path.
 */
function dshHome() {
  return resolve(flag('--dsh-home') || process.env.DSH_HOME?.trim() || join(homedir(), '.dsh'))
}

/**
 * Every stored session log, newest first.
 * @param {string} home - DSH home.
 * @returns {{ path: string, project: string, id: string, mtime: number }[]} log files.
 */
export function listSessionLogs(home) {
  const root = join(home, 'sessions')
  const out = []
  if (!existsSync(root)) return out
  for (const project of readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    const dir = join(root, project.name)
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue
      const sessionDir = join(dir, entry.name)
      let files
      try {
        files = readdirSync(sessionDir).filter((f) => /^session\..*\.jsonl\.zstd$/.test(f))
      } catch {
        continue
      }
      for (const file of files) {
        const path = join(sessionDir, file)
        try {
          out.push({ path, project: project.name, id: entry.name, mtime: statSync(path).mtimeMs })
        } catch {
          /* vanished between listing and stat */
        }
      }
    }
  }
  return out.sort((a, b) => b.mtime - a.mtime)
}

/**
 * Session records this state root already holds, keyed by session id.
 *
 * `folded.json` is not the only place a session can be recorded: a session that ended without
 * being folded still has a `sessions/<id>.json` carrying its `turns`. Importing it would reset
 * that record to `turns: []`, so the migration checks the record too.
 * @param {string} root - the state root.
 * @returns {Map<string, object>} session id to record.
 */
export function engineRecords(root) {
  const records = new Map()
  const repos = join(root, 'repos')
  if (!existsSync(repos)) return records
  for (const repo of readdirSync(repos, { withFileTypes: true })) {
    if (!repo.isDirectory()) continue
    const dir = join(repos, repo.name, 'dsh', 'sessions')
    if (!existsSync(dir)) continue
    for (const file of readdirSync(dir)) {
      if (!file.endsWith('.json')) continue
      try {
        records.set(file.slice(0, -5), JSON.parse(readFileSync(join(dir, file), 'utf8')))
      } catch {
        /* an unreadable record is reported as absent, not as a migration blocker */
      }
    }
  }
  return records
}

/**
 * Session ids this state root already folded, across every repository it knows.
 *
 * The engine records a fold in `repos/<key>/<host>/folded.json` and refuses to fold the same id
 * twice. Importing an already-folded session would still rewrite its `sessions/<id>.json` record
 * (an import starts from `turns: []`), so the check happens here, before the export is handed to
 * `te dsh-import` — which is what makes re-running a migration safe.
 * @param {string} root - the state root.
 * @returns {Set<string>} folded session ids.
 */
export function foldedIds(root) {
  const ids = new Set()
  const repos = join(root, 'repos')
  if (!existsSync(repos)) return ids
  for (const entry of readdirSync(repos, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const file = join(repos, entry.name, 'dsh', 'folded.json')
    if (!existsSync(file)) continue
    try {
      const folded = JSON.parse(readFileSync(file, 'utf8'))
      for (const id of Object.keys(folded ?? {})) ids.add(id)
    } catch {
      /* an unreadable ledger is not a reason to skip the migration */
    }
  }
  return ids
}

/**
 * Remove this plugin's engine state, keeping the state-root directory itself.
 *
 * `<root>` is emptied rather than deleted: the shell is what the launchers resolve against, and
 * removing it would make the next bootstrap start from nothing. DSH's own session logs are not
 * touched — the plugin does not own them, so the injected blocks and pruned surfaces already
 * written into a transcript stay with DSH.
 * @returns {number} exit code.
 */
function purge() {
  const root = launchers(withHome()).root
  const dry = argv.includes('--dry-run')
  const wantsExports = argv.includes('--exports')
  const wantsState = argv.includes('--state') || argv.includes('--all')
  const targets = []
  if (wantsExports || argv.includes('--all')) targets.push(join(root, 'dsh-sessions'))
  if (wantsState) {
    for (const entry of ['repos', 'sessions', 'hosts', 'index.json', 'ho', 'bin', 'vendor', 'errors.log', 'diagnostics.json']) {
      targets.push(join(root, entry))
    }
  }
  if (targets.length === 0) {
    process.stdout.write(`${JSON.stringify({
      root,
      nothing: 'pass --exports, --state, or --all; nothing was deleted',
      hint: 'te-dsh purge --all --dry-run  shows the plan first',
    }, null, 2)}\n`)
    return 0
  }
  const plan = targets.map((target) => {
    let bytes = 0
    let files = 0
    const walk = (path) => {
      let stat
      try {
        stat = statSync(path)
      } catch {
        return
      }
      if (!stat.isDirectory()) {
        files += 1
        bytes += stat.size
        return
      }
      for (const entry of readdirSync(path, { withFileTypes: true })) walk(join(path, entry.name))
    }
    walk(target)
    return { path: target, files, bytes, present: existsSync(target) }
  })
  const dshLogs = 'not touched: DSH owns ~/.dsh/sessions'
  if (dry) {
    process.stdout.write(`${JSON.stringify({ root, dryRun: true, plan, dshLogs }, null, 2)}\n`)
    return 0
  }
  if (!argv.includes('--yes')) {
    process.stdout.write(`${JSON.stringify({
      root,
      dryRun: true,
      plan,
      next: 're-run with --yes to delete',
      dshLogs,
    }, null, 2)}\n`)
    return 1
  }
  for (const target of targets) rmSync(target, { recursive: true, force: true })
  process.stdout.write(`${JSON.stringify({ root, deleted: targets, dshLogs }, null, 2)}\n`)
  return 0
}

/**
 * The working directory recorded in one stored session log's header.
 * @param {string} source - `session.v*.jsonl.zstd`.
 * @returns {string} the cwd, or an empty string when the header has none.
 */
export function sessionCwd(source) {
  try {
    const raw = zstdDecompressSync(readFileSync(source)).toString('utf8')
    const header = JSON.parse(raw.split('\n')[0] ?? '{}')
    return typeof header.cwd === 'string' ? header.cwd : ''
  } catch {
    return ''
  }
}

/**
 * Decompress one stored log into the export the engine reads.
 * @param {string} source - `session.v*.jsonl.zstd`.
 * @param {string} dir - export directory.
 * @returns {{ path: string, id: string, cwd: string, events: number }} export facts.
 */
export function exportFromStore(source, dir) {
  const raw = zstdDecompressSync(readFileSync(source)).toString('utf8')
  const lines = raw.split('\n').filter(Boolean)
  let header = {}
  try {
    header = JSON.parse(lines[0] ?? '{}')
  } catch {
    throw new Error(`${source}: the first line is not the session header`)
  }
  if (header.type !== 'session' || !header.id) {
    throw new Error(`${source}: no session header`)
  }
  mkdirSync(dir, { recursive: true, mode: 0o700 })
  const path = join(dir, `${header.id}.jsonl`)
  writeFileSync(path, `${lines.join('\n')}\n`, { mode: 0o600 })
  return { path, id: String(header.id), cwd: header.cwd ?? '', events: lines.length - 1 }
}

/**
 * `te-dsh cold-start`.
 * @returns {Promise<number>} exit code.
 */
async function coldStart() {
  if (typeof zstdDecompressSync !== 'function') {
    process.stderr.write('te-dsh: this Node has no zstd decoder (need >= 22.15); use the harness Node\n')
    return 1
  }
  const bins = launchers(withHome())
  if (!existsSync(bins.te) || !existsSync(bins.hook)) {
    process.stderr.write(`te-dsh: no launchers in ${join(bins.root, 'bin')}; `
      + 'run `te-dsh bootstrap` first\n')
    return 1
  }
  const exportDir = join(bins.root, 'dsh-sessions')
  const limit = Number(flag('--limit', '0')) || 0
  const all = argv.includes('--all')
  const dry = argv.includes('--dry-run')
  const reimport = argv.includes('--reimport')
  const includeMissing = argv.includes('--include-missing')
  const only = flag('--only', '')
  const freshS = 60_000
  // A migration must not re-import what the engine already folded: `te dsh-import` rewrites the
  // session record before the fold, and an already-folded session would keep that rewritten
  // record (turns/nudges/aborts reset). Skipping here is what makes install-time migration and a
  // disable→enable cycle idempotent.
  const alreadyFolded = reimport ? new Set() : foldedIds(bins.root)
  // `folded.json` is not the only evidence of prior work: a session that ended without being
  // folded still has a record with its `turns`, and importing it would reset that record.
  const records = reimport ? new Map() : engineRecords(bins.root)
  // A full migration applies evidence oldest-first, the order it happened in; a bounded run takes
  // the newest sessions, which are the ones a person just worked in.
  const ordered = limit ? listSessionLogs(dshHome()) : listSessionLogs(dshHome()).reverse()
  const logs = ordered
  const results = []
  let folded = 0
  let skippedFolded = 0
  for (const log of logs) {
    if (limit && results.length >= limit) break
    const age = Date.now() - log.mtime
    if (!all && age < freshS) {
      results.push({ session: log.id, skipped: 'recently active' })
      continue
    }
    const prior = records.get(log.id)
    if (prior && Array.isArray(prior.turns) && prior.turns.length > 0) {
      skippedFolded += 1
      results.push({ session: log.id, skipped: 'already recorded', turns: prior.turns.length })
      continue
    }
    // A session whose working directory is gone is a run of a directory that no longer exists --
    // typically a throwaway test tree. Folding it would create a repository that never was and
    // feed its noise into the tool-prune evidence.
    if (!includeMissing && !existsSync(sessionCwd(log.path))) {
      skippedFolded += 1
      results.push({ session: log.id, skipped: 'working directory gone' })
      continue
    }
    if (only) {
      let key = ''
      try {
        key = repoIdentity(sessionCwd(log.path)).key
      } catch {
        key = ''
      }
      if (key !== only) {
        skippedFolded += 1
        results.push({ session: log.id, skipped: `not in --only ${only}` })
        continue
      }
    }
    if (alreadyFolded.has(log.id)) {
      skippedFolded += 1
      results.push({ session: log.id, skipped: 'already folded' })
      continue
    }
    let exported
    try {
      exported = exportFromStore(log.path, exportDir)
    } catch (error) {
      results.push({ session: log.id, skipped: String(error.message) })
      continue
    }
    if (dry) {
      results.push({ session: exported.id, cwd: exported.cwd, events: exported.events, dry: true })
      continue
    }
    // The state root this command was told to use, not the process's default: a cold start
    // into an isolated home must not write the user's live state.
    const answer = await importExport(bins, exported.path, exported.cwd || process.cwd(), {
      env: withHome(),
    })
    results.push({
      session: exported.id,
      cwd: exported.cwd,
      events: exported.events,
      folded: answer?.folded ?? null,
      record: answer?.record ?? null,
      error: answer ? undefined : 'te dsh-import failed',
    })
    if (answer?.folded) folded += 1
  }
  process.stdout.write(`${JSON.stringify({ sessions: results.length, folded, skippedFolded, results }, null, 2)}\n`)
  return 0
}

/**
 * `te-dsh status`.
 * @returns {Promise<number>} exit code.
 */
async function status() {
  const bins = launchers(withHome())
  const cwd = resolve(flag('--cwd', process.cwd()))
  const out = await import('../lib/bridge.js').then(({ statusJson }) =>
    statusJson(bins, cwd, { env: withHome() }))
  process.stdout.write(`${JSON.stringify(out ?? { error: 'te status failed' }, null, 2)}\n`)
  return out ? 0 : 1
}

/**
 * `te-dsh doctor`: what is in place, without changing anything.
 * @returns {number} exit code.
 */
function doctor() {
  const bins = launchers(withHome())
  const tree = join(bins.root, 'vendor', `TokenEconomizer-${PINNED_SHA.slice(0, 8)}`)
  const observed = {
    stateRoot: bins.root,
    te: { path: bins.te, exists: existsSync(bins.te) },
    hook: { path: bins.hook, exists: existsSync(bins.hook) },
    vendor: { path: tree, exists: existsSync(tree) },
    sha: PINNED_SHA,
  }
  if (observed.vendor.exists) {
    try {
      observed.vendor.head = execFileSync('git', ['-C', tree, 'rev-parse', 'HEAD'], {
        encoding: 'utf8',
      }).trim()
    } catch {
      observed.vendor.head = null
    }
    const checked = verify(bins, { root: bins.root, cwd: process.cwd() })
    observed.verified = checked.ok
    observed.detail = checked.detail
  }
  process.stdout.write(`${JSON.stringify(observed, null, 2)}\n`)
  return observed.te.exists && observed.hook.exists ? 0 : 1
}

/**
 * The environment with this command's `--home`, when given.
 * @returns {Record<string, string | undefined>} environment.
 */
function withHome() {
  const home = flag('--home')
  return home ? { ...process.env, TOKENECONOMIZER_HOME: home } : process.env
}

/**
 * Dispatch one subcommand.
 * @returns {Promise<number>} exit code.
 */
async function main() {
  switch (command) {
    case 'bootstrap':
      return bootstrapMain(argv.slice(1))
    case 'cold-start':
      return coldStart()
    case 'purge':
      return purge()
    case 'status':
      return status()
    case 'doctor':
      return doctor()
    case '-h':
    case '--help':
    case 'help':
      process.stdout.write(readFileSync(new URL(import.meta.url), 'utf8').split('*/')[0] + '*/\n')
      return 0
    default:
      process.stderr.write(`te-dsh: unknown command ${command}\n`)
      return 2
  }
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname)) {
  process.exitCode = await main()
}

export { main, stateRoot }
