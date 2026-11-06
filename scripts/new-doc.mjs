#!/usr/bin/env node
/**
 * Create a new document with the mandatory skeleton header, in the right home.
 *
 * Owner instruction 2026-11-06 (docs/RULES.md §6): a document about one package belongs in
 * that package's docs/, and an undecided shared document belongs in pending-docs/. This tool
 * refuses to create a workspace-root doc, which is how the old flat pile grew.
 *
 * Usage:
 *   node scripts/new-doc.mjs <path> --kind <kind> --summary "one line" [options]
 *
 * Homes and their required/forbidden options:
 *   dsh-<track>/docs/X.md            --kind --summary [--version --status]
 *   pending-docs/<lifecycle>/X.md    --kind --summary --lifecycle <lc>   (must match the folder)
 *   docs/X.md                        --kind --summary [--version --status]   (rules/policy only)
 *
 * Examples:
 *   node scripts/new-doc.mjs dsh-opencode-v2/docs/ROUTE-RETRY.md --kind spec --summary "How route retries are bounded."
 *   node scripts/new-doc.mjs pending-docs/undecided/NEW-IDEA.md --kind design --summary "An idea not yet classified." --lifecycle undecided
 *   node scripts/new-doc.mjs docs/NEW-RULE.md --kind rule --summary "A rule that spans every track."
 *
 * Refuses to overwrite. Run `npm run docs:index` afterwards.
 */
import { writeFileSync, existsSync, mkdirSync } from 'node:fs'
import { dirname, join, relative, posix } from 'node:path'

const KINDS = ['rule', 'boot', 'spec', 'report', 'measurement', 'policy', 'design', 'reference', 'readme', 'index']
const STATUSES = ['active', 'reference', 'historical', 'completed', 'measured', 'implemented', 'draft', 'superseded', 'archived']
const LIFECYCLES = ['unpromoted', 'unimplemented', 'deprecated', 'undecided']

const root = new URL('..', import.meta.url).pathname
const args = process.argv.slice(2)
const path = args[0]
const flag = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const usage = 'usage: node scripts/new-doc.mjs <path> --kind <kind> --summary "line" [--version 1.0] [--status draft] [--lifecycle <lc>]'

if (!path || path.startsWith('--')) { console.error(usage); process.exit(2) }

const kind = flag('kind')
const summary = flag('summary')
const version = flag('version', '1.0')
const status = flag('status', 'draft')
const lifecycle = flag('lifecycle')
const today = new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)

if (!kind || !summary) { console.error('error: --kind and --summary are required'); process.exit(2) }
if (!KINDS.includes(kind)) { console.error(`error: --kind must be one of ${KINDS.join(', ')}`); process.exit(2) }
if (!STATUSES.includes(status)) { console.error(`error: --status must be one of ${STATUSES.join(', ')}`); process.exit(2) }
if (summary.length > 140) { console.error(`error: --summary must be <= 140 chars (got ${summary.length})`); process.exit(2) }

// --- decide the home and enforce it -----------------------------------------
const segments = path.split('/')
const first = segments[0]
const isPending = first === 'pending-docs'
const isTrack = first.startsWith('dsh-')
const isWorkspaceDocs = first === 'docs'

if (!isPending && !isTrack && !isWorkspaceDocs) {
  console.error(`error: ${path} has no valid home.`)
  console.error('  a package document goes in dsh-<track>/docs/')
  console.error('  an undecided shared document goes in pending-docs/<lifecycle>/')
  console.error('  only rules/policy that span every track go in docs/')
  process.exit(2)
}
if (isTrack && segments[1] !== 'docs') {
  console.error(`error: a track document must live in ${first}/docs/, not ${path}`)
  console.error('  (README.md and CHANGELOG.md at the track root are not created by this tool)')
  process.exit(2)
}
if (isWorkspaceDocs && !['rule', 'policy', 'index', 'reference'].includes(kind)) {
  console.error(`error: docs/ is for rules and policy. kind "${kind}" does not belong there.`)
  console.error('  a package document goes in dsh-<track>/docs/; an undecided shared document goes in pending-docs/')
  process.exit(2)
}
if (isPending) {
  if (!lifecycle) { console.error(`error: pending-docs requires --lifecycle (${LIFECYCLES.join('|')})`); process.exit(2) }
  if (!LIFECYCLES.includes(lifecycle)) { console.error(`error: --lifecycle must be one of ${LIFECYCLES.join(', ')}`); process.exit(2) }
  if (segments[1] !== lifecycle) {
    console.error(`error: --lifecycle ${lifecycle} does not match the folder pending-docs/${segments[1] ?? ''}/`)
    console.error(`  move the path to pending-docs/${lifecycle}/ or change --lifecycle`)
    process.exit(2)
  }
}

const file = join(root, path)
if (existsSync(file)) { console.error(`error: ${path} already exists (refusing to overwrite)`); process.exit(1) }
mkdirSync(dirname(file), { recursive: true })

// title: the filename only, humanised — never the directory (that is the package, not the title)
const title = posix
  .basename(path, '.md')
  .replace(/^[-_]+|[-_]+$/g, '')
  .replace(/[-_]+/g, ' ')

const relDepth = posix.dirname(path) === '.' ? 0 : posix.dirname(path).split('/').length
const rulesLink = posix.relative(posix.dirname(path), 'docs/RULES.md')

const lifecycleLine = isPending ? `lifecycle: ${lifecycle}\n` : ''
const banner = isPending
  ? `\n> **Lifecycle: \`${lifecycle}\`** — pending, not authority. Say what would move this document out.\n`
  : ''

const body = `# ${title}

<!-- skeleton:
version: ${version}
kind: ${kind}
status: ${status}
updated: ${today}
summary: ${summary}
${lifecycleLine}-->
${banner}
## Overview

TODO.

## Exit condition

${isPending ? 'What would promote, implement, or replace this document? (pending-docs requires this)' : 'n/a — this document has an active home.'}

## References

- [docs/RULES.md](${rulesLink})
`
writeFileSync(file, body)
console.log(`created ${path} (kind=${kind}, status=${status}${isPending ? `, lifecycle=${lifecycle}` : ''})`)
console.log('next: npm run docs:index' + (isTrack ? `  (or: cd ${first} && npm run docs:index)` : ''))
