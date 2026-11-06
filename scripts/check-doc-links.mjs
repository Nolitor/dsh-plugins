#!/usr/bin/env node
/**
 * Gate: every relative markdown link resolves.
 *
 * Owner instruction 2026-11-06: documents are split per subproject. A move that leaves a
 * dangling link is silent rot — the reader hits a 404 in the one place they went for truth.
 * This gate walks every tracked *.md (skipping vendor/evidence trees), resolves each relative
 * link against the file's own directory, and fails on a missing target.
 *
 * Usage: node scripts/check-doc-links.mjs [--quiet]
 * Exit: 0 all links resolve, 1 otherwise.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname, relative, posix } from 'node:path'

const root = new URL('..', import.meta.url).pathname
// Must stay identical to SKIP_DIRS in scripts/doc-index.mjs. When the two diverge, the link gate
// checks documents the indexer never lists (measured 2026-11-06: 198 vs 195, the difference being
// three untracked *.template.md files under dsh-sidebar-manager/lib/templates/), so a "green"
// link gate says nothing about the documents the index claims to cover. One list, one answer.
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.runtime-measure', '.verify', 'prototype-windows', 'prototype-harness',
  'market', 'locale', 'test', 'lib', 'scripts', 'artifacts', 'staging', 'verification', 'dist', 'build', '.cache',
])
// A submodule is a separate repository: this workspace does not own its documents (RULES §6.1b).
const isSubmodule = (dir) => existsSync(join(dir, '.git'))
// link targets that are legitimately not files in this repo
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|\/|#)/i

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) {
      if (SKIP_DIRS.has(e.name)) continue
      if (isSubmodule(full)) continue
      walk(full, out)
    } else if (e.name.endsWith('.md')) out.push(full)
  }
  return out
}

const LINK = /\]\(\s*([^)\s]+)\s*\)/g
const broken = []
let checked = 0

for (const file of walk(root)) {
  const rel = relative(root, file)
  const text = readFileSync(file, 'utf8')
  const dir = dirname(rel)
  for (const m of text.matchAll(LINK)) {
    const target = m[1]
    if (EXTERNAL.test(target)) continue
    const pathPart = target.split('#')[0]
    if (!pathPart) continue
    // guard against placeholder text such as (path/to/file.md)
    if (/[<>*]/.test(pathPart)) continue
    const resolved = posix.normalize(posix.join(dir === '.' ? '' : dir, pathPart))
    checked++
    if (!existsSync(join(root, resolved))) broken.push(`${rel} -> ${target}`)
  }
}

const quiet = process.argv.includes('--quiet')
console.log(`checked ${checked} relative links across ${walk(root).length} documents`)
if (broken.length) {
  console.error(`\n${broken.length} broken link(s):`)
  for (const b of broken) console.error('  BROKEN ' + b)
  process.exit(1)
}
if (!quiet) console.log('every relative link resolves')
