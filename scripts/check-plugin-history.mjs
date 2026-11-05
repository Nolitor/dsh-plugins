#!/usr/bin/env node
/**
 * Gate: every plugin track owns its history.
 *
 * Owner instruction 2026-11-04: plugin history belongs in dsh-<track>/CHANGELOG.md, not in
 * boot cards or AGENTS.md (docs/RULES.md section 6.1). Without a check, the rule decays into
 * advice the moment a new plugin is added - which is exactly how eight of eleven tracks ended
 * up with no history at all.
 *
 * Also enforces section 6.2: a plugin that depends on a moving upstream must own a
 * compatibility record. Today only the LLM adapters do; the list is explicit so adding one is
 * a decision rather than an oversight.
 *
 * Usage: node scripts/check-plugin-history.mjs
 * Exit: 0 all tracks have history, 1 otherwise.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const NEEDS_COMPAT = new Set(['dsh-opencode-v2'])
const REQUIRED = ['CHANGELOG.md']

const failures = []
const checked = []

for (const entry of readdirSync(root, { withFileTypes: true })) {
  if (!entry.isDirectory()) continue
  // archive/ holds absorbed tracks that no profile installs (owner instruction 2026-11-05):
  // they keep their CHANGELOG as history but are not active tracks this gate must police.
  if (entry.name === 'archive' || entry.name === 'staging') continue
  if (!entry.name.startsWith('dsh-')) continue
  const dir = join(root, entry.name)
  const pkgPath = join(dir, 'package.json')
  if (!existsSync(pkgPath)) continue
  // Another section's uncommitted track is not this gate's business (single-writer rule).
  try {
    execFileSync('git', ['ls-files', '--error-unmatch', join(entry.name, 'package.json')], { cwd: root, stdio: 'ignore' })
  } catch {
    console.log('  skip ' + entry.name + ' (untracked: another section is working there)')
    continue
  }
  let pkg
  try {
    pkg = JSON.parse(readFileSync(pkgPath, 'utf8'))
  } catch (error) {
    failures.push(entry.name + ': package.json is not valid JSON (' + error.message + ')')
    continue
  }
  checked.push(entry.name + ' (' + pkg.name + '@' + pkg.version + ')')
  for (const file of REQUIRED) {
    const path = join(dir, file)
    if (!existsSync(path)) {
      failures.push(entry.name + ': missing ' + file + ' - plugin history is mandatory (RULES 6.1)')
      continue
    }
    const text = readFileSync(path, 'utf8')
    // RULES section 6: a tracked document starts with a title, THEN the skeleton block.
    const head = text.split('\n').slice(0, 6).join('\n')
    if (!head.startsWith('# ') || !head.includes('<!-- skeleton:')) {
      failures.push(entry.name + '/' + file + ': must start with a # title then the skeleton header')
    }
    if (text.split('\n').length < 10) {
      failures.push(entry.name + '/' + file + ': too thin to be a history')
    }
  }
  if (NEEDS_COMPAT.has(entry.name) && !existsSync(join(dir, 'UPSTREAM-COMPAT.md'))) {
    failures.push(entry.name + ': missing UPSTREAM-COMPAT.md - this track depends on a moving upstream (RULES 6.2)')
  }
}

console.log('checked ' + checked.length + ' plugin tracks')
for (const line of checked) console.log('  ok ' + line)
if (failures.length > 0) {
  console.error('\n' + failures.length + ' problem(s):')
  for (const line of failures) console.error('  FAIL ' + line)
  process.exit(1)
}
console.log('\nevery plugin track owns its history')
