#!/usr/bin/env node
/**
 * Materialize the patched TokenEconomizer core and write the two launchers the plugin uses.
 *
 * The engine stays upstream's code. This script clones one pinned commit into the
 * TokenEconomizer state root, applies `patch/0001-add-dsh-host.patch` (the DSH host adapter, the
 * DSH session reader, the headless side call, the two bridge commands), and writes:
 *
 *   <state root>/bin/te        -> the vendored checkout's `plugin/scripts/te`
 *   <state root>/bin/te-hook   -> the vendored checkout's `plugin/scripts/te-hook`
 *
 * Nothing under a system Python installation, another agent's home, or the user's repository is
 * modified. Re-running is safe: an already-applied patch is detected and left alone.
 *
 * Usage:
 *   node scripts/bootstrap.mjs [--source <checkout>] [--sha <commit>] [--force]
 *   node scripts/bootstrap.mjs --verify-only
 *
 * Windows is not supported by the POSIX launchers; run the verification from WSL.
 */
import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Files the patch adds; a refresh removes them before re-applying a changed patch. */
export const ADDED_FILES = ['tokeneconomizer/trace/dsh.py', 'tests/test_dsh_trace.py']

/** Upstream commit this package's patch was produced against and verified on. */
export const UPSTREAM = 'https://github.com/microsoft/TokenEconomizer.git'
export const PINNED_SHA = '6141bb9251a7d5cccc1b97ae340c7b872108292c'

const HERE = dirname(fileURLToPath(import.meta.url))
const PATCH = join(HERE, '..', 'patch', '0001-add-dsh-host.patch')

/**
 * The state root, matching `paths.state_root` in the engine.
 * @param {Record<string, string | undefined>} [env] - environment to read.
 * @returns {string} absolute state root.
 */
export function stateRoot(env = process.env) {
  const home = env.TOKENECONOMIZER_HOME
  return home && home.trim() ? resolve(home) : join(homedir(), '.tokeneconomizer')
}

/**
 * Run one command and return its trimmed stdout.
 * @param {string} program - executable.
 * @param {string[]} args - arguments.
 * @param {{ cwd?: string, env?: object, allowFailure?: boolean }} [options] - process options.
 * @returns {{ ok: boolean, out: string }} outcome.
 */
export function run(program, args, options = {}) {
  try {
    const out = execFileSync(program, args, {
      cwd: options.cwd,
      env: options.env ?? process.env,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { ok: true, out: out.trim() }
  } catch (error) {
    if (options.allowFailure) {
      return { ok: false, out: String(error?.stdout ?? '').trim() }
    }
    throw error
  }
}

/**
 * Whether the patch is already applied to a checkout.
 * @param {string} tree - checkout root.
 * @returns {boolean} true when reversing the patch would succeed.
 */
export function alreadyApplied(tree) {
  return run('git', ['-C', tree, 'apply', '--reverse', '--check', PATCH], { allowFailure: true }).ok
}

/**
 * Clone (or copy) the pinned core and apply the DSH patch.
 * @param {{ root?: string, source?: string, sha?: string }} [options] - state root and source.
 * @returns {{ tree: string, applied: boolean }} the checkout and whether this run applied it.
 */
export function refresh(tree) {
  run('git', ['-C', tree, 'reset', '--hard', '--quiet', 'HEAD'])
  for (const file of ADDED_FILES) {
    const path = join(tree, file)
    if (existsSync(path)) rmSync(path)
  }
}

export function vendor(options = {}) {
  const root = options.root ?? stateRoot()
  const sha = options.sha ?? PINNED_SHA
  const tree = join(root, 'vendor', `TokenEconomizer-${sha.slice(0, 8)}`)
  mkdirSync(dirname(tree), { recursive: true, mode: 0o700 })
  if (!existsSync(tree)) {
    if (options.source) {
      run('git', ['clone', '--quiet', resolve(options.source), tree])
    } else {
      run('git', ['clone', '--quiet', '--filter=blob:none', UPSTREAM, tree])
    }
  }
  const head = run('git', ['-C', tree, 'rev-parse', 'HEAD']).out
  if (head !== sha) {
    // A pinned commit needs a full-enough history; a shallow clone is deepened rather than
    // silently checking out a different tree.
    run('git', ['-C', tree, 'fetch', '--quiet', '--depth', '1', 'origin', sha], {
      allowFailure: true,
    })
    run('git', ['-C', tree, 'checkout', '--quiet', sha])
  }
  if (alreadyApplied(tree)) return { tree, applied: false }
  if (!run('git', ['-C', tree, 'apply', '--check', PATCH], { allowFailure: true }).ok) {
    // The tree holds an earlier version of the patch: a newer package must not stack a second
    // patch on it, and must not silently leave the old one in place either.
    if (!options.refresh) {
      throw new Error(`${tree} carries a different patch; re-run with --refresh to reset and `
        + 'apply this package\'s patch')
    }
    refresh(tree)
  }
  run('git', ['-C', tree, 'apply', '--verbose', PATCH])
  return { tree, applied: true }
}

/**
 * Write the two launchers, private to the owner.
 * @param {string} root - state root.
 * @param {string} tree - patched checkout.
 * @returns {{ te: string, hook: string }} launcher paths.
 */
export function writeLaunchers(root, tree) {
  const bin = join(root, 'bin')
  mkdirSync(bin, { recursive: true, mode: 0o700 })
  const te = join(bin, 'te')
  const hook = join(bin, 'te-hook')
  writeFileSync(te, `#!/bin/sh\n# Written by @nolit/dsh-tokeneconomizer: the patched TokenEconomizer CLI.\nexec ${JSON.stringify(join(tree, 'plugin', 'scripts', 'te'))} "$@"\n`, { mode: 0o700 })
  writeFileSync(hook, `#!/bin/sh\n# Written by @nolit/dsh-tokeneconomizer: the patched TokenEconomizer hook dispatcher.\nexec ${JSON.stringify(join(tree, 'plugin', 'scripts', 'te-hook'))} "$@"\n`, { mode: 0o700 })
  chmodSync(te, 0o700)
  chmodSync(hook, 0o700)
  return { te, hook }
}

/**
 * Prove the launchers reach the DSH host: `te --host dsh status --json` must answer as `dsh`.
 * @param {{ te: string }} bins - launcher paths.
 * @param {{ root?: string, cwd?: string }} [options] - state root and directory.
 * @returns {{ ok: boolean, detail: string }} the verification outcome.
 */
export function verify(bins, options = {}) {
  const cwd = options.cwd ?? process.cwd()
  const env = {
    ...process.env,
    ...(options.root ? { TOKENECONOMIZER_HOME: options.root } : {}),
    PYTHONUTF8: '1',
  }
  const result = run(bins.te, ['--host', 'dsh', '--cwd', cwd, 'status', '--json'], {
    env,
    allowFailure: true,
  })
  if (!result.ok) return { ok: false, detail: result.out || 'te status exited nonzero' }
  try {
    const status = JSON.parse(result.out.slice(result.out.indexOf('{')))
    if (status.host !== 'dsh') return { ok: false, detail: `host is ${status.host}` }
    return { ok: true, detail: `${status.repo} (${status.state})` }
  } catch {
    return { ok: false, detail: 'te status did not answer JSON' }
  }
}

/**
 * Bootstrap entry point.
 * @param {string[]} argv - command-line arguments.
 * @returns {number} process exit code.
 */
export function main(argv = process.argv.slice(2)) {
  const flag = (name, fallback = undefined) => {
    const i = argv.indexOf(name)
    return i >= 0 && argv[i + 1] ? argv[i + 1] : fallback
  }
  const root = stateRoot({ ...process.env, ...(flag('--home') ? { TOKENECONOMIZER_HOME: flag('--home') } : {}) })
  const source = flag('--source')
  const sha = flag('--sha', PINNED_SHA)
  if (argv.includes('--verify-only')) {
    const bins = {
      te: join(root, 'bin', 'te'),
      hook: join(root, 'bin', 'te-hook'),
    }
    const checked = verify(bins, { root })
    process.stdout.write(`${JSON.stringify({ ok: checked.ok, detail: checked.detail })}\n`)
    return checked.ok ? 0 : 1
  }
  const { tree, applied } = vendor({ root, source, sha, refresh: argv.includes('--refresh') })
  const launchers = writeLaunchers(root, tree)
  const checked = verify(launchers, { root })
  // Install-time migration: fold the sessions that ran before this plugin was mounted, so the
  // first new session already has evidence. Bounded on purpose — a fold may run the engine's
  // paid proposer, so the default takes the newest sessions only and a full pass stays an
  // explicit operator decision (`dsh-te cold-start --all`).
  let migration = { skipped: 'verification failed' }
  if (checked.ok) {
    if (argv.includes('--no-migrate')) {
      migration = { skipped: '--no-migrate' }
    } else {
      const limit = flag('--migrate-limit', '20')
      const result = spawnSync(process.execPath, [
        join(HERE, '..', 'bin', 'dsh-te.mjs'),
        'cold-start',
        '--limit', limit,
        '--home', root,
      ], { encoding: 'utf8', timeout: 600_000 })
      migration = {
        limit: Number(limit),
        status: result.status,
        folded: /"folded":\s*(\d+)/.exec(result.stdout ?? '')?.[1] ?? null,
        skippedFolded: /"skippedFolded":\s*(\d+)/.exec(result.stdout ?? '')?.[1] ?? null,
        stderr: (result.stderr ?? '').trim() || undefined,
        next: 'dsh-te cold-start --all  migrates every remaining session',
      }
    }
  }
  process.stdout.write(`${JSON.stringify({
    tree,
    sha,
    applied,
    launchers,
    verified: checked.ok,
    detail: checked.detail,
    migration,
  }, null, 2)}\n`)
  return checked.ok ? 0 : 1
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exitCode = main()
}
