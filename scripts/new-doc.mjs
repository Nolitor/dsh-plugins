#!/usr/bin/env node
/**
 * Create a new documentation file with the mandatory skeleton header.
 *
 * Usage:
 *   node scripts/new-doc.mjs <path> --kind <kind> --summary "one line" [--version 1.0] [--status draft]
 *
 * Example:
 *   node scripts/new-doc.mjs docs/FOO.md --kind spec --summary "What FOO specifies." --status draft
 *
 * Refuses to overwrite an existing file. Run `npm run docs:index` afterwards.
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'

const KINDS = ['rule', 'boot', 'spec', 'report', 'measurement', 'policy', 'readme', 'index']
const STATUSES = ['active', 'reference', 'historical', 'completed', 'measured', 'draft']

const root = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
const path = args[0]
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}

if (!path || path.startsWith('--')) {
  console.error('usage: node scripts/new-doc.mjs <path> --kind <kind> --summary "line" [--version 1.0] [--status draft]')
  process.exit(2)
}
const kind = flag('kind')
const summary = flag('summary')
const version = flag('version', '1.0')
const status = flag('status', 'draft')
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

if (!kind || !summary) { console.error('error: --kind and --summary are required'); process.exit(2) }
if (!KINDS.includes(kind)) { console.error(`error: --kind must be one of ${KINDS.join(', ')}`); process.exit(2) }
if (!STATUSES.includes(status)) { console.error(`error: --status must be one of ${STATUSES.join(', ')}`); process.exit(2) }
if (summary.length > 140) { console.error(`error: --summary must be <= 140 chars (got ${summary.length})`); process.exit(2) }

const file = join(root, path)
if (existsSync(file)) { console.error(`error: ${path} already exists (refusing to overwrite)`); process.exit(1) }
mkdirSync(dirname(file), { recursive: true })

const title = path
  .replace(/^docs\//, '')
  .replace(/\.md$/, '')
  .replace(/^[-_]+|[-_]+$/g, '')
  .replace(/[-_]+/g, ' ')
const body = `# ${title}

<!-- skeleton:
version: ${version}
kind: ${kind}
status: ${status}
updated: ${today}
summary: ${summary}
-->

## Overview

TODO.

## Details

TODO.

## References

- [docs/RULES.md](${relative(dirname(file), join(root, 'docs/RULES.md'))})
`
writeFileSync(file, body)
console.log(`created ${path} (kind=${kind}, status=${status})`)
console.log('next: npm run docs:index')
