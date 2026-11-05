#!/usr/bin/env node
/**
 * Report whether the live wiring still matches the cross-project contract.
 *
 * This package registers nothing, so its only executable duty is to make the
 * boundary visible: which interrupt surfaces are mounted, whether the absolute
 * module URL still resolves, and whether both halves are present in the live
 * resolved configuration.
 *
 * Read-only against the live home: `dsh --dump-config` composes a profile and writes
 * `cordis.yml`, so the dump runs against a temporary DSH_HOME built from a COPY of the
 * live profile (the live tree is only read, never written). See
 * docs/DSH-HOME-ISOLATION.md.
 */

import { existsSync, readFileSync, writeFileSync, mkdtempSync, mkdirSync, copyFileSync, symlinkSync, rmSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'

const CONTRACT_VERSION = 1
const CORE = '/home/minami/Workspace/projects/total_skill/src/interrupt-core.js'
const REASONS = '/home/minami/Workspace/projects/total_skill/src/reasons.js'
const PROFILE = process.env.DSH_PROFILE ?? 'web'
/** Live home. Read-only: the dump below never runs against it. */
const LIVE_HOME = process.env.DSH_HOME ?? join(homedir(), '.dsh')

/**
 * Compose the profile in a throwaway DSH_HOME built from a copy of the live profile.
 *
 * `dsh --profile <name> --dump-config` calls prepareProfile(), which WRITES
 * `profiles/<name>/cordis.yml`. Pointing it at the live home would mutate the owner's
 * tree (measured 2026-11-05: EROFS in the sandbox, a real write outside it). The copy
 * is complete enough to resolve the same bundle rows: package.json, cordis.yml, the
 * patch layer, and a symlink to the already-installed node_modules.
 *
 * @param {string} profile - profile directory name.
 * @returns {{ home: string, dispose: () => void }} the isolated home and its cleanup.
 */
function isolateProfile(profile) {
  const liveProfile = join(LIVE_HOME, 'profiles', profile)
  if (!existsSync(join(liveProfile, 'package.json'))) {
    throw new Error('live profile not found: ' + liveProfile)
  }
  const home = mkdtempSync(join(tmpdir(), 'dsh-contract-'))
  const dest = join(home, 'profiles', profile)
  mkdirSync(dest, { recursive: true })
  for (const name of ['package.json', 'cordis.yml', 'cordis.patch.yml']) {
    const from = join(liveProfile, name)
    if (existsSync(from)) copyFileSync(from, join(dest, name))
  }
  // Any absolute `$HOME/.dsh` value in the patch (for example the session-search index
  // path) must point at the throwaway home, so a composed service cannot write live state.
  const patchPath = join(dest, 'cordis.patch.yml')
  if (existsSync(patchPath)) {
    const patch = readFileSync(patchPath, 'utf8')
    if (patch.includes(LIVE_HOME)) {
      writeFileSync(patchPath, patch.split(LIVE_HOME).join(home))
    }
  }
  const liveModules = join(liveProfile, 'node_modules')
  if (existsSync(liveModules)) symlinkSync(liveModules, join(dest, 'node_modules'))
  return { home, dispose: () => rmSync(home, { recursive: true, force: true }) }
}

/** Lazy fs import kept out of the top-level statement list for readability. */
function awaitImportFs() {
}


const checks = []
const add = (name, ok, detail = '') => checks.push({ name, ok, detail })

// 1. The two modules the bridge imports by absolute path must exist.
add('interrupt-core.js resolves', existsSync(CORE), CORE)
add('reasons.js resolves', existsSync(REASONS), REASONS)

// 2. A contract version marker is what makes compatibility checkable, not assumed.
let contractMajor = null
try {
  const src = readFileSync(CORE, 'utf8')
  const m = /export\s+const\s+CONTRACT\s*=\s*\{[^}]*major\s*:\s*(\d+)/.exec(src)
  contractMajor = m ? Number(m[1]) : null
} catch { /* reported by the existence check above */ }
add(
  'interrupt-core exports CONTRACT.major',
  contractMajor === CONTRACT_VERSION,
  contractMajor === null ? 'absent — handshake is assumed, not checked' : 'major=' + String(contractMajor),
)

// 3. Both halves must be mounted in the resolved profile.
let dump = ''
let isolated
try {
  isolated = isolateProfile(PROFILE)
  dump = execFileSync('dsh', ['--profile', PROFILE, '--dump-config'], {
    encoding: 'utf8',
    timeout: 200000,
    stdio: ['ignore', 'pipe', 'ignore'],
    env: { ...process.env, DSH_HOME: isolated.home },
  })
} catch (error) {
  add('dsh --dump-config runs (isolated DSH_HOME)', false, String(error?.message ?? error))
} finally {
  isolated?.dispose()
}
add('skill plugin row present', dump.includes('dsh-skill-interrupt'))
add('tokeneconomizer row present', dump.includes('tokeneconomizer-dsh'))

// 4. The values the contract names must be the ones actually resolved.
const tier = /tierMinChars:\s*(\d+)/.exec(dump)
const action = /watchdogAction:\s*(\w+)/.exec(dump)
add('tierMinChars resolved', tier !== null, tier ? tier[1] : 'absent')
add(
  'watchdogAction is interrupt',
  action !== null && action[1] === 'interrupt',
  action ? action[1] : 'absent',
)

const failed = checks.filter((c) => !c.ok)
for (const c of checks) {
  process.stdout.write((c.ok ? 'ok   ' : 'FAIL ') + c.name + (c.detail ? ' — ' + c.detail : '') + '\n')
}
process.stdout.write('\ncontract v' + CONTRACT_VERSION + ': ' + (checks.length - failed.length) + '/' + checks.length + ' checks pass\n')

// A contract mismatch is reported, never thrown at the caller: this script exists
// to make the boundary visible, and a non-zero exit keeps it usable as a gate.
process.exit(failed.length === 0 ? 0 : 1)
