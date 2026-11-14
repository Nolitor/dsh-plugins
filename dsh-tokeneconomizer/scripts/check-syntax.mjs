/**
 * Syntax-check every JavaScript module this package ships.
 *
 * The `check` script used to name each file explicitly, so a new module was silently
 * unchecked until someone remembered to extend the list — identity.js, repokey-bridge.js
 * and probes.js were all added without being covered. Walking the tree instead means a new
 * file is checked the moment it exists.
 *
 * Scope: `lib/` (flat and nested), `bin/`, `scripts/`. Tests are exercised by `npm test`,
 * not by this script. The workspace-root scripts/ directory is not part of this package.
 */
import { execFileSync } from 'node:child_process'
import { readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'

const ROOT = new URL('..', import.meta.url).pathname
const ROOTS = ['lib', 'bin', 'scripts']
const EXTENSIONS = ['.js', '.mjs']

/** Collect every JavaScript module under one directory, recursively. */
function collect (dir) {
  const found = []
  let entries
  try {
    entries = readdirSync(dir)
  } catch {
    return found
  }
  for (const entry of entries) {
    if (entry === 'node_modules') continue
    const path = join(dir, entry)
    const stats = statSync(path)
    if (stats.isDirectory()) {
      found.push(...collect(path))
      continue
    }
    if (EXTENSIONS.some((ext) => entry.endsWith(ext))) found.push(path)
  }
  return found
}

const files = ROOTS.flatMap((root) => collect(join(ROOT, root))).sort()
if (files.length === 0) {
  process.stderr.write('check: no JavaScript modules found — the walk is wrong\n')
  process.exit(1)
}

let failed = 0
for (const file of files) {
  try {
    execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    failed += 1
    process.stderr.write(`check: ${file.replace(ROOT, '')}\n${error.stderr?.toString() ?? ''}\n`)
  }
}

if (failed > 0) {
  process.stderr.write(`check: ${failed} of ${files.length} file(s) failed\n`)
  process.exit(1)
}
console.log(`check: ${files.length} module(s) parse`)
