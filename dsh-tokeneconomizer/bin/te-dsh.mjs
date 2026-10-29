#!/usr/bin/env node
/**
 * Operator command line for @nolit/dsh-tokeneconomizer.
 *
 *   te-dsh bootstrap [--source <checkout>] [--sha <commit>] [--home <state root>]
 *       Materialize the patched TokenEconomizer core, write `bin/te` and `bin/te-hook`, and
 *       verify that `te --host dsh` answers. See scripts/bootstrap.mjs.
 *
 *   te-dsh cold-start [--dsh-home <dir>] [--limit N] [--all] [--dry-run]
 *       Decompress every finished DSH session and fold it into the engine, so what earlier
 *       sessions taught is available before the next one starts. Sessions modified in the last
 *       minute are skipped unless `--all`, because the harness may still be writing them.
 *
 *   te-dsh status [--cwd <dir>]
 *       Print `te --host dsh status --json` for a directory.
 *
 *   te-dsh doctor
 *       Report which launchers and patch are in place, without changing anything.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { importExport, launchers, stateRoot } from '../lib/bridge.js'
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
  const freshS = 60_000
  const logs = listSessionLogs(dshHome())
  const results = []
  let folded = 0
  for (const log of logs) {
    if (limit && results.length >= limit) break
    const age = Date.now() - log.mtime
    if (!all && age < freshS) {
      results.push({ session: log.id, skipped: 'recently active' })
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
  process.stdout.write(`${JSON.stringify({ sessions: results.length, folded, results }, null, 2)}\n`)
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
