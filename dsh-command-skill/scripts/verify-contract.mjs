#!/usr/bin/env node
/**
 * Report whether the live wiring still matches the cross-project contract.
 *
 * This package registers nothing, so its only executable duty is to make the
 * boundary visible: which interrupt surfaces are mounted, whether the absolute
 * module URL still resolves, and whether both halves are present in the live
 * resolved configuration.
 *
 * Read-only. Never writes to ~/.dsh or any repository.
 */

import { existsSync, readFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'

const CONTRACT_VERSION = 1
const CORE = '/home/minami/Workspace/projects/total_skill/src/interrupt-core.js'
const REASONS = '/home/minami/Workspace/projects/total_skill/src/reasons.js'
const PROFILE = process.env.DSH_PROFILE ?? 'web'

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
try {
  dump = execFileSync('dsh', ['--profile', PROFILE, '--dump-config'], {
    encoding: 'utf8', timeout: 200000, stdio: ['ignore', 'pipe', 'ignore'],
  })
} catch (error) {
  add('dsh --dump-config runs', false, String(error?.message ?? error))
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
