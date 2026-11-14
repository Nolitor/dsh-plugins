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
 *   te-dsh update --check [--branch main] [--remote <url>] [--timeout-ms N]
 *       Compare the pinned upstream commit this package patches against the branch head that
 *       `git ls-remote` reports, and print the distance when a local checkout can measure it.
 *       Read-only: nothing is fetched, checked out, or written. Exit `0` when the pin is the
 *       head, `1` when an update is available, `2` when the check could not run (offline, no
 *       git, a timeout) — the failure is reported as JSON, never as a crash. Without `--check`
 *       the same comparison runs, exits `0`, and adds the command that would apply it.
 *
 *   te-dsh doctor
 *       Report which launchers and patch are in place, without changing anything.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { zstdDecompressSync } from 'node:zlib'

import { importExport, launchers, stateRoot } from '../lib/bridge.js'
import { DEFAULTS, MANIFEST_VERSION } from '../lib/index.js'
import { repoIdentity } from '../lib/repokey.js'
import { main as bootstrapMain, PINNED_SHA, UPSTREAM, verify } from '../scripts/bootstrap.mjs'

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
    // Every entry is a path the engine or this plugin actually writes; `ho` was a two-character
    // typo of `hosts` that purged nothing and would have deleted an unrelated directory named
    // `ho` if one ever appeared in the state root. Removed 2026-11-13 against the live tree.
    for (const entry of ['repos', 'sessions', 'hosts', 'index.json', 'bin', 'vendor', 'errors.log', 'diagnostics.json']) {
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
 *
 * The report answers three questions that were previously unanswerable from one place: the
 * install (launchers, vendored tree, pinned commit), the PLUGIN's own configuration keys
 * (every key the plugin supports and what it currently resolves to), and the engine's
 * canonical repository key for this directory compared with the key the plugin's identity
 * model computes. The third is the one that can silently re-partition a repository's history,
 * so a mismatch is reported loudly rather than folded into a summary line.
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
  observed.manifest = manifestReport()
  observed.config = configReport()
  observed.identity = identityReport(bins.root)
  process.stdout.write(`${JSON.stringify(observed, null, 2)}\n`)
  return observed.te.exists && observed.hook.exists ? 0 : 1
}

/**
 * The plugin's own package manifest, as the doctor sees it.
 *
 * The manifest version is the plugin's contract with the host, and the host does not enforce
 * it (measured: the installed `dsh-package-manifest` README says loaders do not enforce
 * `dsh.manifestVersion`). So the doctor reads it and reports the comparison itself.
 * @returns {object} the manifest report.
 */
function manifestReport () {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const declared = manifest?.dsh?.manifestVersion ?? null
    return {
      name: manifest?.name ?? null,
      version: manifest?.version ?? null,
      manifestVersion: declared,
      expected: MANIFEST_VERSION,
      ok: declared === null || declared === MANIFEST_VERSION,
      detail: declared === null
        ? 'the manifest declares no manifest version'
        : declared === MANIFEST_VERSION
          ? `manifest version ${declared} is the one this build understands`
          : `the manifest declares ${declared}; this build understands ${MANIFEST_VERSION}`,
    }
  } catch (error) {
    return { ok: false, detail: `the package manifest could not be read: ${error.message}` }
  }
}

/**
 * Every configuration key the plugin supports, and what it resolves to right now.
 *
 * The key list is the plugin's own `DEFAULTS`; the values come from the external settings
 * file, which wins over the composed Cordis config (a patch `config` replaces the whole
 * config, so a layer underneath could never win a key). A key the operator overrode is
 * marked, so "why is this on" is answerable without reading code.
 * @returns {object} the config report.
 */
function configReport () {
  const keys = Object.keys(DEFAULTS)
  const values = {}
  const overridden = []
  for (const key of keys) {
    const raw = rawSetting(key)
    values[key] = raw
    if (raw !== DEFAULTS[key]) overridden.push(key)
  }
  return {
    keys,
    defaults: { ...DEFAULTS },
    values,
    overridden,
    detail: overridden.length === 0
      ? 'every key is at its default'
      : `${overridden.length} key(s) differ from the default: ${overridden.join(', ')}`,
  }
}

/**
 * Read one plugin setting as the plugin itself resolves it.
 *
 * The external settings file wins over the Cordis config. The file is read here rather than
 * through the plugin's module so the doctor can report a deployment whose plugin never mounted.
 * @param {string} key - the setting name.
 * @returns {unknown} the resolved value.
 */
function rawSetting (key) {
  const fromFile = settingsFileValues()
  if (Object.hasOwn(fromFile, key)) return fromFile[key]
  return DEFAULTS[key]
}

/**
 * The external settings file's values, read once per doctor run.
 *
 * A missing or unreadable file is an empty object: the doctor reports the defaults, which is
 * what the plugin would use.
 * @returns {Record<string, unknown>} the file's values.
 */
let cachedSettingsFile = null
function settingsFileValues () {
  if (cachedSettingsFile !== null) return cachedSettingsFile
  cachedSettingsFile = {}
  try {
    const home = process.env.DSH_HOME ?? join(homedir(), '.dsh')
    const path = process.env.TE_CONFIG ?? join(home, 'tokeneconomizer.json')
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      cachedSettingsFile = parsed
    }
  } catch {
    cachedSettingsFile = {}
  }
  return cachedSettingsFile
}

/**
 * The engine's canonical repository key for this directory, compared with the plugin's.
 *
 * The engine keys a repository by its own canonicalization (the path or remote it derives),
 * and the plugin's identity model derives its own key. When the two disagree, one repository
 * is recorded under two keys — the history silently splits, and the engine's evidence for one
 * half never reaches the other. The engine's live layout under `repos/` is the authority: this
 * compares the computed key with the directories the engine actually holds.
 * @param {string} root - the TokenEconomizer state root.
 * @returns {object} the identity report.
 */
function identityReport (root) {
  const cwd = process.cwd()
  let computed = ''
  let how = ''
  try {
    const identity = repoIdentity(cwd)
    computed = identity.key
    how = identity.how
  } catch (error) {
    return { ok: false, computed: null, detail: `the repository key could not be computed: ${error.message}` }
  }
  const reposDir = join(root, 'repos')
  let live = []
  try {
    live = readdirSync(reposDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  } catch {
    live = []
  }
  const present = live.includes(computed)
  return {
    ok: present,
    computed,
    how,
    live,
    detail: present
      ? `the engine holds this repository under ${computed}`
      : live.length === 0
        ? `the engine holds no repository under ${root}/repos`
        : `the engine holds ${live.join(', ')} but this directory computes ${computed}`,
  }
}

/**
 * Ask the remote for one branch head, without touching any local repository.
 *
 * `git ls-remote` is the only read-only way to answer "is the pin still the head"; it opens no
 * checkout, writes no ref, and works from any directory. Every failure mode is a value, not a
 * throw: a machine with no network, no `git`, a hanging TLS handshake, or an auth prompt all
 * become `{ ok: false, detail }` so `update --check` can report them and keep the caller's shell
 * intact.
 * @param {object} options - the query.
 * @param {string} options.remote - repository URL.
 * @param {string} options.branch - branch name, without `refs/heads/`.
 * @param {number} [options.timeoutMs] - bound on the whole subprocess.
 * @returns {{ ok: boolean, sha?: string, detail?: string }} the head, or why it is unknown.
 */
export function remoteHead(options) {
  const timeoutMs = options.timeoutMs ?? 15_000
  const ref = `refs/heads/${options.branch}`
  try {
    const result = spawnSync('git', ['ls-remote', options.remote, ref], {
      encoding: 'utf8',
      timeout: timeoutMs,
      // An unconfigured credential helper or a private mirror must never block on a prompt:
      // a check that hangs is worse than a check that fails.
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0', GIT_ASKPASS: 'true', SSH_ASKPASS: 'true' },
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    if (result.error) {
      const code = result.error.code ?? 'error'
      return { ok: false, detail: code === 'ETIMEDOUT' ? `timed out after ${timeoutMs} ms` : `git failed: ${code}` }
    }
    if (result.status !== 0) {
      const stderr = String(result.stderr ?? '').trim().split('\n').filter(Boolean).pop() ?? ''
      return { ok: false, detail: `git ls-remote exited ${result.status}${stderr ? `: ${stderr}` : ''}` }
    }
    const line = String(result.stdout ?? '').split('\n').find((entry) => entry.trim().endsWith(ref))
    if (!line) return { ok: false, detail: `the remote has no ${ref}` }
    const sha = line.trim().split(/\s+/)[0]
    if (!/^[0-9a-f]{40}$/.test(sha)) return { ok: false, detail: 'the remote answered a malformed object id' }
    return { ok: true, sha }
  } catch (error) {
    return { ok: false, detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * How far the pin trails a target commit, when a local checkout can say.
 *
 * The vendored tree is cloned with `--filter=blob:none` and may be shallow, so the target commit
 * is often absent. That is reported as `null` rather than guessed: "unknown distance" is honest,
 * a fabricated `0` would read as "up to date".
 * @param {string} tree - a local checkout.
 * @param {string} from - the older commit.
 * @param {string} to - the newer commit.
 * @returns {{ behind: number | null, detail?: string }} the distance, or why it is unknown.
 */
export function localDistance(tree, from, to) {
  if (!existsSync(tree)) return { behind: null, detail: 'no vendored checkout' }
  try {
    for (const sha of [from, to]) {
      const probe = spawnSync('git', ['-C', tree, 'cat-file', '-e', `${sha}^{commit}`], {
        encoding: 'utf8',
        timeout: 10_000,
        stdio: ['ignore', 'ignore', 'ignore'],
      })
      if (probe.status !== 0) return { behind: null, detail: `the checkout does not hold ${sha.slice(0, 8)}` }
    }
    const counted = spawnSync('git', ['-C', tree, 'rev-list', '--count', `${from}..${to}`], {
      encoding: 'utf8',
      timeout: 10_000,
    })
    if (counted.status !== 0) return { behind: null, detail: 'rev-list failed' }
    const behind = Number(String(counted.stdout).trim())
    return Number.isFinite(behind) ? { behind } : { behind: null, detail: 'rev-list printed no count' }
  } catch (error) {
    return { behind: null, detail: error instanceof Error ? error.message : String(error) }
  }
}

/**
 * `te-dsh update`: is the pinned upstream commit still the branch head?
 *
 * With `--check` this is a read-only report: exit `0` when the pin is the head, `1` when an
 * update is available, `2` when the question could not be answered. Without `--check` it keeps
 * exit `0` and prints the command that would move the pin, because "an update exists" is not a
 * failure of the installation.
 * @returns {number} exit code.
 */
function update() {
  const checkOnly = argv.includes('--check')
  const remote = flag('--remote', UPSTREAM)
  const branch = flag('--branch', 'main')
  const timeoutMs = Number(flag('--timeout-ms', '15000')) || 15_000
  const head = remoteHead({ remote, branch, timeoutMs })
  if (!head.ok) {
    // Offline, no git, a blocked port, a private mirror: the installation is unchanged and the
    // reason is data. The exit code says "could not check", never "out of date".
    process.stdout.write(`${JSON.stringify({
      check: true,
      ok: false,
      pinned: PINNED_SHA,
      remote,
      branch,
      updateAvailable: null,
      detail: head.detail,
      hint: 'no ref was fetched and nothing was written; re-run when the remote is reachable',
    }, null, 2)}\n`)
    return 2
  }
  const same = head.sha === PINNED_SHA
  const tree = join(launchers(withHome()).root, 'vendor', `TokenEconomizer-${PINNED_SHA.slice(0, 8)}`)
  const distance = same
    ? { behind: 0 }
    : localDistance(tree, PINNED_SHA, head.sha)
  const observed = {
    check: true,
    ok: true,
    pinned: PINNED_SHA,
    upstreamHead: head.sha,
    branch,
    remote,
    updateAvailable: !same,
    commitsBehind: distance.behind,
    ...(distance.detail ? { distanceDetail: distance.detail } : {}),
    vendor: { path: tree, exists: existsSync(tree) },
  }
  if (same) {
    observed.detail = 'the pin is the branch head'
  } else {
    observed.detail = distance.behind === null
      ? 'the branch head moved past the pin; the distance is unknown without a fetch'
      : `the branch head is ${distance.behind} commit(s) ahead of the pin`
    observed.next = `te-dsh bootstrap --sha ${head.sha}` + (distance.behind === null ? '  (after fetching that commit)' : '')
  }
  process.stdout.write(`${JSON.stringify(observed, null, 2)}\n`)
  if (!checkOnly) return 0
  return same ? 0 : 1
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
    case 'update':
      return update()
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
