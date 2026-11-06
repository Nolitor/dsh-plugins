#!/usr/bin/env node
/**
 * Gate: every pointer stub still points at a real document, with the recorded digest.
 *
 * Owner instruction 2026-11-06: seven documents moved out of dsh-plugins to the harness that
 * owns them, leaving a pointer stub per old path so no link breaks. A stub is only useful while
 * the destination exists AND is the copy the stub claims it is; otherwise the "authority"
 * pointer leads a reader to a missing file, or to a file that has silently diverged from the
 * digest recorded when the move happened.
 *
 * The failure this prevents is the one that already happened once: a move that reported success
 * while the destination could not be written at all (root filesystem read-only). Every stub
 * claimed an authoritative copy that did not exist for hours.
 *
 * Stub contract (written by staging/doc-migration/apply.sh):
 *   - first line: `> **MOVED — this is a pointer stub, not the document.**`
 *   - `The authoritative copy now lives at **`<repo-relative path>`**`
 *   - `SHA-256: `<64 hex chars>``
 *   - `Original path here: `<repo-relative stub path>``
 *
 * The destination path is resolved against the *projects* directory (the parent of this
 * workspace), because a stub may name a document in a sibling harness such as Core-00-System.
 * The original path is used for the reverse check: a stub whose own destination has since been
 * re-homed can never be silently orphaned.
 *
 * Usage: node scripts/check-doc-moves.mjs [--quiet]
 * Exit: 0 every stub resolves and matches, 1 otherwise.
 */
import { readFileSync, readdirSync, existsSync } from 'node:fs'
import { join, relative, dirname } from 'node:path'
import { createHash } from 'node:crypto'

const root = new URL('..', import.meta.url).pathname.replace(/\/$/, '')
const projects = dirname(dirname(root)) // .../Workspace/projects
const SKIP_DIRS = new Set(['node_modules', '.git', '.runtime-measure', '.verify', 'staging', 'artifacts', '.cache', 'dist', 'build'])

function walk(dir, out = []) {
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.name.startsWith('.')) continue
    const full = join(dir, e.name)
    if (e.isDirectory()) { if (!SKIP_DIRS.has(e.name)) walk(full, out) }
    else if (e.name.endsWith('.md')) out.push(full)
  }
  return out
}

const STUB = /^> \*\*MOVED — this is a pointer stub, not the document\.\*\*$/m
const DEST = /authoritative copy now lives at \*\*`([^`]+)`\*\*/i
const DIGEST = /SHA-256:\s*`([0-9a-f]{64})`/i
const SELF = /Original path here:\s*`([^`]+)`/i

const problems = []
let stubs = 0

for (const file of walk(root)) {
  const text = readFileSync(file, 'utf8')
  if (!STUB.test(text)) continue
  stubs++
  const rel = relative(root, file)
  const dest = text.match(DEST)?.[1]
  const digest = text.match(DIGEST)?.[1]
  const self = text.match(SELF)?.[1]
  if (!dest) { problems.push(`${rel}: stub has no destination`); continue }
  if (!digest) { problems.push(`${rel}: stub has no SHA-256 digest`); continue }
  if (self && self !== rel) problems.push(`${rel}: records "Original path here: ${self}" but is at ${rel}`)
  const destAbs = join(projects, dest)
  if (!existsSync(destAbs)) {
    problems.push(`${rel}: destination does not exist -> ${dest}`)
    continue
  }
  const actual = createHash('sha256').update(readFileSync(destAbs)).digest('hex')
  if (actual !== digest) problems.push(`${rel}: destination digest changed -> ${dest} (recorded ${digest.slice(0, 12)}…, actual ${actual.slice(0, 12)}…)`)
}

const quiet = process.argv.includes('--quiet')
if (problems.length) {
  console.error(`FAIL: ${problems.length} broken pointer stub(s) of ${stubs}:`)
  for (const p of problems) console.error('  ' + p)
  process.exit(1)
}
if (!quiet) console.log(`OK: ${stubs} pointer stub(s) resolve to a matching destination copy`)
