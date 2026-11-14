#!/usr/bin/env node
/**
 * Deprecation audit for the DSH seams this plugin consumes.
 *
 * The plugin is built against symbols owned by upstream packages. When an
 * upstream release marks one of those symbols `@deprecated` — or removes it —
 * the plugin keeps working until it silently breaks. This script is the
 * build-time detector: it reads the installed DSH type declarations, checks a
 * declared list of consumed seams, and fails when one is gone or newly
 * deprecated without an acknowledgement.
 *
 * Read-only: it never writes to the install or the workspace.
 *
 * Usage:
 *   node scripts/audit-deprecations.mjs [--json] [--baseline <file>]
 *
 * Exit codes:
 *   0  every seam is present and none is newly deprecated
 *   1  a consumed seam is missing, or deprecated while allowDeprecated is false
 *   2  the DSH install root cannot be found
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import process from 'node:process'

/**
 * How far above a declaration to look for the doc block that documents it.
 * The search stops at the block's own opening `/**`, so a short block never
 * borrows a neighbouring declaration's tags.
 */
const DEPRECATION_LOOKBACK = 60

const DEFAULT_INSTALL_DIR = '/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh'

/**
 * Seams this plugin consumes. A seam that upstream deprecates must either be
 * migrated away from or acknowledged here with `allowDeprecated: true` and a
 * migration note, so the deprecation is a decision instead of a surprise.
 *
 * `allowDeprecated: true` is never a deletion of the check: the seam is still
 * inspected, still reported as WARN, and its `justification` is printed so the
 * reason for the exception is visible rather than implied.
 */
export const SEAMS = [
  {
    id: 'session.eventAt',
    package: '@deepseek-ai/dsh-session',
    symbol: 'eventAt',
    allowDeprecated: true,
    migration: 'docs/ARCHITECTURE.md',
    justification: 'No replacement reader exists in 0.2.2-rc.3; upstream keeps 20+ live calls with "migration deferred". Call sites: lib/index.js:1047, :1091.'
  },
  {
    id: 'session.snapshotEvents',
    package: '@deepseek-ai/dsh-session',
    symbol: 'snapshotEvents',
    allowDeprecated: true,
    migration: 'docs/ARCHITECTURE.md',
    justification: 'Required for the full durable log (shadowed events included); the surface exposes sequence numbers only. Call site: lib/index.js:1589.'
  },
  {
    id: 'session.deriveMessages',
    package: '@deepseek-ai/dsh-session',
    symbol: 'deriveMessages',
    allowDeprecated: false,
    migration: null
  },
  {
    id: 'session.append',
    package: '@deepseek-ai/dsh-session',
    symbol: 'append',
    allowDeprecated: false,
    migration: null
  },
  {
    id: 'agent.pre-step',
    package: '@deepseek-ai/dsh-agent',
    symbol: 'agent/pre-step',
    allowDeprecated: false,
    migration: null
  },
  {
    id: 'tools.restrict',
    package: '@deepseek-ai/dsh-tools',
    symbol: 'restrict',
    allowDeprecated: false,
    migration: null
  },
  {
    id: 'systemPrompt.context',
    package: '@deepseek-ai/dsh-system-prompt',
    symbol: 'context',
    allowDeprecated: false,
    migration: null
  }
]

function parseArgs(argv) {
  const options = { json: false, baseline: null }
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i]
    if (arg === '--json') {
      options.json = true
    } else if (arg === '--baseline') {
      const value = argv[i + 1]
      if (value === undefined || value.startsWith('--')) {
        throw new Error('--baseline requires a file path')
      }
      options.baseline = value
      i += 1
    } else if (arg === '--help' || arg === '-h') {
      process.stdout.write('usage: audit-deprecations.mjs [--json] [--baseline <file>]\n')
      process.exit(0)
    } else {
      throw new Error(`unknown argument: ${arg}`)
    }
  }
  return options
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * A declaration is a line whose first meaningful token is the symbol, in any
 * of the shapes the generated declarations use (method, property, quoted
 * event key). Matching the line prefix keeps `context` from matching every
 * `context:` parameter elsewhere in the file.
 */
function declarationPattern(symbol) {
  const quoted = /[/-]/.test(symbol)
  const token = quoted ? `['"]${escapeRegExp(symbol)}['"]` : escapeRegExp(symbol)
  return new RegExp(`^\\s*(?:readonly\\s+|static\\s+|private\\s+|protected\\s+|declare\\s+)*${token}\\s*[?<(:=]`)
}

function collectTypeFiles(packageDir) {
  const typesDir = join(packageDir, 'lib', 'types')
  if (!existsSync(typesDir)) return []
  const files = []
  for (const entry of readdirSync(typesDir, { withFileTypes: true })) {
    if (entry.isFile() && entry.name.endsWith('.d.ts')) {
      files.push(join(typesDir, entry.name))
    } else if (entry.isDirectory()) {
      const nested = join(typesDir, entry.name)
      for (const child of readdirSync(nested, { withFileTypes: true })) {
        if (child.isFile() && child.name.endsWith('.d.ts')) files.push(join(nested, child.name))
      }
    }
  }
  return files.sort()
}

/** True when the doc block immediately above line `index` carries @deprecated. */
function isDeprecatedAt(lines, index) {
  const stop = Math.max(0, index - DEPRECATION_LOOKBACK)
  for (let j = index - 1; j >= stop; j -= 1) {
    const line = lines[j]
    if (line.includes('@deprecated')) return true
    // The block that documents this declaration opened here: its tags are all
    // we may consider, so an earlier declaration's doc block is out of scope.
    if (line.trimStart().startsWith('/**')) return false
  }
  return false
}

/** Scan one package for a symbol and whether its doc block is deprecated. */
function inspectSeam(installDir, seam) {
  const packageDir = join(installDir, 'node_modules', seam.package)
  if (!existsSync(packageDir)) {
    return { present: false, deprecated: false, where: null, reason: `package not installed: ${seam.package}` }
  }
  const files = collectTypeFiles(packageDir)
  if (files.length === 0) {
    return { present: false, deprecated: false, where: null, reason: `no type declarations under ${seam.package}/lib/types` }
  }
  const pattern = declarationPattern(seam.symbol)
  let present = false
  let deprecated = false
  let where = null
  for (const file of files) {
    const lines = readFileSync(file, 'utf8').split('\n')
    for (let i = 0; i < lines.length; i += 1) {
      if (!pattern.test(lines[i])) continue
      present = true
      where ??= `${file}:${i + 1}`
      if (isDeprecatedAt(lines, i)) deprecated = true
      if (deprecated) break
    }
    if (deprecated) break
  }
  return {
    present,
    deprecated,
    where,
    reason: present ? null : `symbol not found in ${seam.package}/lib/types/*.d.ts`
  }
}

function readBaseline(file) {
  if (!existsSync(file)) throw new Error(`baseline file not found: ${file}`)
  const parsed = JSON.parse(readFileSync(file, 'utf8'))
  const entries = Array.isArray(parsed) ? parsed : (parsed.knownFailures ?? [])
  const keys = new Set()
  for (const entry of entries) {
    if (typeof entry === 'string') keys.add(entry)
    else if (entry && typeof entry === 'object' && typeof entry.id === 'string') {
      keys.add(entry.kind ? `${entry.id}:${entry.kind}` : entry.id)
    }
  }
  return keys
}

function run(argv) {
  let options
  try {
    options = parseArgs(argv)
  } catch (error) {
    process.stderr.write(`audit-deprecations: ${error.message}\n`)
    return 2
  }

  const installDir = process.env.DSH_INSTALL_DIR || DEFAULT_INSTALL_DIR
  if (!existsSync(join(installDir, 'node_modules'))) {
    const message = `DSH install root not found: ${installDir}`
    if (options.json) {
      process.stdout.write(`${JSON.stringify({ ok: false, installRoot: installDir, error: message, seams: [] }, null, 2)}\n`)
    } else {
      process.stdout.write(`FATAL ${message}\n`)
    }
    process.stderr.write(`audit-deprecations: ${message}\n`)
    return 2
  }

  let baseline
  try {
    baseline = options.baseline ? readBaseline(options.baseline) : null
  } catch (error) {
    process.stderr.write(`audit-deprecations: ${error.message}\n`)
    return 2
  }

  const results = []
  for (const seam of SEAMS) {
    const found = inspectSeam(installDir, seam)
    let status
    let kind = null
    let reason = found.reason

    if (!found.present) {
      status = 'FAIL'
      kind = 'missing'
    } else if (found.deprecated && !seam.allowDeprecated) {
      status = 'FAIL'
      kind = 'deprecated'
      reason = 'deprecated but not allowed (add a migration, then allowDeprecated)'
    } else if (found.deprecated) {
      status = 'WARN'
      kind = 'deprecated-allowed'
      reason = `deprecated (allowed — ${seam.justification ?? 'NO JUSTIFICATION RECORDED'}); migration: ${seam.migration ?? 'NONE RECORDED'}`
    } else {
      status = 'ok'
    }

    const known = baseline !== null && kind !== null &&
      (baseline.has(`${seam.id}:${kind}`) || baseline.has(seam.id))
    const failing = status === 'FAIL' && !known

    results.push({
      id: seam.id,
      package: seam.package,
      symbol: seam.symbol,
      allowDeprecated: seam.allowDeprecated,
      migration: seam.migration,
      justification: seam.justification ?? null,
      present: found.present,
      deprecated: found.deprecated,
      where: found.where,
      status,
      kind,
      reason: reason ?? null,
      baselined: known,
      failing
    })
  }

  const failures = results.filter((result) => result.failing)
  const warnings = results.filter((result) => result.status === 'WARN')
  const exitCode = failures.length > 0 ? 1 : 0

  if (options.json) {
    process.stdout.write(`${JSON.stringify({
      ok: exitCode === 0,
      installRoot: installDir,
      seams: results,
      failures: failures.map((result) => result.id),
      warnings: warnings.map((result) => result.id),
      exitCode
    }, null, 2)}\n`)
  } else {
    for (const result of results) {
      if (result.status === 'ok') process.stdout.write(`ok ${result.id}\n`)
      else if (result.status === 'WARN') process.stdout.write(`WARN ${result.id}: ${result.reason}\n`)
      else if (result.baselined) process.stdout.write(`ok ${result.id}: baselined ${result.kind}\n`)
      else process.stdout.write(`FAIL ${result.id}: ${result.reason}\n`)
    }
    if (warnings.length > 0) {
      process.stdout.write(`\n${warnings.length} allowed deprecation(s); schedule the migration.\n`)
    }
    if (failures.length > 0) {
      process.stdout.write(`\n${failures.length} failing seam(s) out of ${results.length}. Migrate or acknowledge.\n`)
    }
  }

  return exitCode
}

/**
 * Run only when invoked as a script. Importing this module (the seam-list test
 * does) must read `SEAMS` without auditing the install or setting an exit code.
 */
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.exitCode = run(process.argv.slice(2))
}

