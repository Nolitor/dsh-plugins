#!/usr/bin/env node
/**
 * Per-subproject documentation gate.
 *
 * Owner instruction 2026-11-06: each subproject must index and manage its own documents.
 * This is the command a track runs from its own directory (`npm run docs:check`):
 *
 *   node ../../scripts/doc-index-track.mjs           # regenerate this track's docs/INDEX.md
 *   node ../../scripts/doc-index-track.mjs --check    # fail if it is stale (CI gate)
 *
 * It reuses the workspace indexer so one rule produces every index — there is no second
 * header parser to drift. The track is inferred from the current working directory, which
 * makes it impossible to rewrite a sibling track's index by accident (single-writer rule).
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import { basename, join, resolve } from 'node:path'

const here = resolve(process.cwd())
const track = basename(here)
const root = resolve(here, '..')
const indexer = join(root, 'scripts', 'doc-index.mjs')

if (!existsSync(join(here, 'package.json'))) {
  console.error(`error: ${here} has no package.json — run this from a dsh-<track>/ directory`)
  process.exit(2)
}
if (!existsSync(indexer)) {
  console.error(`error: ${indexer} not found — is this a standalone copy of the track?`)
  process.exit(2)
}

const check = process.argv.includes('--check')
const outputFile = join(here, 'docs', 'INDEX.md')
const before = existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : null

execFileSync(process.execPath, [indexer, '--quiet'], { cwd: root, stdio: 'inherit' })

const after = existsSync(outputFile) ? readFileSync(outputFile, 'utf8') : null
if (after === null) {
  console.error(`error: ${track}/docs/INDEX.md was not generated — is docs/ missing?`)
  process.exit(1)
}

if (check) {
  if (before !== after) {
    console.error(`FAIL: ${track}/docs/INDEX.md is stale — run npm run docs:index in this track`)
    process.exit(1)
  }
  console.log(`OK: ${track}/docs/INDEX.md is up to date.`)
} else {
  console.log(`${before === after ? 'unchanged' : 'updated'}: ${track}/docs/INDEX.md`)
}
