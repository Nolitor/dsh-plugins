#!/usr/bin/env node
/**
 * Skeleton indexer for DSH Plugins documentation — workspace + per-subproject.
 *
 * Owner instruction 2026-11-06: shared-docs are split so each document lives in the
 * subproject it belongs to, and every subproject indexes and manages its own docs.
 * This script therefore writes three kinds of index:
 *
 *   workspace      INDEX.md + docs/SKELETON.md   rules/policy + shared reports only
 *   subproject     dsh-<track>/docs/INDEX.md     that track's own documents
 *   pending        pending-docs/INDEX.md          docs with an undecided lifecycle
 *
 * The header block is the contract. A missing header is reported as MISSING so drift is
 * visible instead of silent. `lifecycle:` is additionally required inside pending-docs/.
 *
 * Run: node scripts/doc-index.mjs [--check] [--quiet]
 *   --check  exit 1 if any doc is missing a required header or an index is stale
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, statSync } from 'node:fs'
import { join, relative, dirname, posix } from 'node:path'

const root = new URL('..', import.meta.url).pathname
const KINDS = ['rule', 'boot', 'spec', 'report', 'measurement', 'policy', 'design', 'reference', 'readme', 'index']
const STATUSES = ['active', 'reference', 'historical', 'completed', 'measured', 'implemented', 'draft', 'superseded', 'archived', 'unknown']
export const LIFECYCLES = ['unpromoted', 'unimplemented', 'deprecated', 'undecided']

/** A pointer stub stands in for a document that moved to another harness. */
const isStub = (row) => /^> \*\*MOVED — this is a pointer stub, not the document\.\*\*/m.test(
  readFileSync(join(root, row.rel), 'utf8'))

/** Generated outputs are not source documents. */
const GENERATED = new Set(['INDEX.md', 'docs/SKELETON.md', 'pending-docs/INDEX.md'])
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.runtime-measure', '.verify', 'prototype-windows', 'prototype-harness',
  'market', 'locale', 'test', 'lib', 'scripts', 'artifacts', 'staging', 'verification', 'dist', 'build', '.cache', 'vendor',
])

function walk(dir, out = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue
    const full = join(dir, entry.name)
    if (entry.isDirectory()) { if (!SKIP_DIRS.has(entry.name)) walk(full, out) }
    else if (entry.name.endsWith('.md')) out.push(full)
  }
  return out
}

/** Parse the leading `<!-- skeleton: ... -->` block. */
export function parseSkeleton(text) {
  const match = text.match(/<!--\s*skeleton:([\s\S]*?)-->/)
  if (!match) return null
  const fields = {}
  for (const line of match[1].split('\n')) {
    const m = line.match(/^\s*([a-z-]+):\s*(.*)$/)
    if (m) fields[m[1]] = m[2].trim()
  }
  const required = ['version', 'kind', 'status', 'updated', 'summary']
  const missing = required.filter((k) => !fields[k])
  return missing.length ? { ...fields, __missing: missing } : fields
}

const all = walk(root).filter((f) => !GENERATED.has(relative(root, f)))
  .filter((f) => {
    const first = relative(root, f).split('/')[0]
    return !(first.startsWith('dsh-') && existsSync(join(root, first, '.git')))
  })
const rows = []
for (const file of all) {
  const rel = relative(root, file)
  const text = readFileSync(file, 'utf8')
  const skel = parseSkeleton(text)
  rows.push({ rel, lines: text.split('\n').length, skeleton: skel, missing: skel?.__missing })
}

/** Which subproject owns a repo-relative path. */
function ownerOf(rel) {
  const first = rel.split('/')[0]
  if (first.startsWith('dsh-')) return first
  if (first === 'pending-docs') return 'pending-docs'
  return null
}
/** A track that is a git submodule is a separate repository: we must not write into it. */
function isSubmodule(name) {
  return existsSync(join(root, name, '.git'))
}
const ALL_TRACKS = [...new Set(readdirSync(root, { withFileTypes: true })
  .filter((e) => e.isDirectory() && e.name.startsWith('dsh-') && !e.name.startsWith('.'))
  .map((e) => e.name))].filter((t) => existsSync(join(root, t, 'package.json'))).sort()
const SUBMODULES = ALL_TRACKS.filter(isSubmodule)
const TRACKS = ALL_TRACKS.filter((t) => !isSubmodule(t))

/**
 * Validate one row. `scope` adds requirements that only apply in that scope:
 *  - tracks/pending: header required
 *  - pending: lifecycle required and folder must agree with it
 */
function validate(row, scope) {
  const problems = []
  if (!row.skeleton) { problems.push('no skeleton header'); return problems }
  if (row.missing) problems.push('missing ' + row.missing.join(', '))
  const s = row.skeleton
  if (s.kind && !KINDS.includes(s.kind)) problems.push(`unknown kind "${s.kind}"`)
  if (s.status && !STATUSES.includes(s.status)) problems.push(`unknown status "${s.status}"`)
  if (scope === 'workspace' && row.rel.split('/')[0].startsWith('dsh-')) return [] // never workspace-owned
  if (scope === 'pending' || row.rel.startsWith('pending-docs/')) {
    // pending-docs/README.md documents the subproject itself; it is not filed under a bucket.
    if (row.rel === 'pending-docs/README.md') return problems
    // A pointer stub is not a pending document: the authority moved to a parent harness.
    if (row.rel.startsWith('pending-docs/') && isStub(row)) return problems
    const folder = row.rel.split('/')[1]
    if (!s.lifecycle) problems.push('missing lifecycle (pending-docs requires one of ' + LIFECYCLES.join('|') + ')')
    else if (!LIFECYCLES.includes(s.lifecycle)) problems.push(`unknown lifecycle "${s.lifecycle}"`)
    else if (folder !== s.lifecycle) problems.push(`lifecycle "${s.lifecycle}" but file is in ${folder}/`)
  }
  return problems
}

// ---------------------------------------------------------------- workspace --
const workspaceRows = rows.filter((r) => !ownerOf(r.rel) && !r.rel.startsWith('bootcards/'))
const bootRows = rows.filter((r) => r.rel.startsWith('bootcards/'))
const boot = bootRows.filter((r) => r.skeleton && !r.missing).sort((a, b) => b.rel.localeCompare(a.rel))
const wsGood = workspaceRows.filter((r) => validate(r, 'workspace').length === 0)
const wsBad = workspaceRows.filter((r) => validate(r, 'workspace').length > 0)
  .map((r) => ({ ...r, problems: validate(r, 'workspace') }))

const relFromDocs = (rel) => {
  const p = posix.relative('docs', rel)
  return p.startsWith('.') ? p : './' + p
}

function skeletonMd() {
  const byKind = new Map()
  for (const r of wsGood) {
    const kind = KINDS.includes(r.skeleton.kind) ? r.skeleton.kind : 'other'
    if (!byKind.has(kind)) byKind.set(kind, [])
    byKind.get(kind).push(r)
  }
  const order = [...KINDS, 'other'].filter((k) => byKind.has(k))
  let md = `# Documentation Skeleton Index — workspace

> Generated by \`node scripts/doc-index.mjs\`. Do not edit by hand.
> One line per document: **version · kind · status · updated · summary**.
> This index covers **workspace-level** docs only: rules, policy, and the reports that span
> several tracks. Every subproject indexes its own documents in \`dsh-<track>/docs/INDEX.md\`.

## Reading chain

\`\`\`
~/.dsh/AGENTS.md              global rules   (every session, auto-loaded)
  -> docs/RULES.md            detailed rules (this project, read on demand)
     -> docs/SKELETON.md      this index: workspace docs only
        -> dsh-<track>/docs/INDEX.md   that subproject's own documents
           -> bootcards/<ts>.md        dated session card (latest only, by default)
\`\`\`

## Subprojects

| Subproject | Document index |
| :--- | :--- |
`
  for (const t of TRACKS) md += `| \`${t}/\` | [${t}/docs/INDEX.md](../${t}/docs/INDEX.md) |\n`
  for (const t of SUBMODULES) md += `| \`${t}/\` (submodule) | separate repository — read \`${t}/README.md\` there |\n`
  md += `| \`pending-docs/\` | [pending-docs/INDEX.md](../pending-docs/INDEX.md) — 미승격 · 미구현 · 폐기 · 미정 |\n\n`
  for (const kind of order) {
    md += `## ${kind}\n\n`
    for (const r of byKind.get(kind).sort((a, b) => b.skeleton.updated.localeCompare(a.skeleton.updated))) {
      const s = r.skeleton
      md += `- **${s.version}** · ${s.status} · ${s.updated} · [${r.rel}](${relFromDocs(r.rel)})\n  ${s.summary}\n`
    }
    md += '\n'
  }
  if (boot.length) {
    md += `## boot (newest 5 of ${boot.length})\n\n`
    for (const r of boot.slice(0, 5)) {
      md += `- **${r.skeleton.status}** · ${r.rel.replace('bootcards/', '')} · [card](${posix.relative('docs', r.rel)})\n  ${r.skeleton.summary}\n`
    }
    md += '\n'
  }
  if (wsBad.length) {
    md += `## MISSING HEADER (${wsBad.length}) — fix before release\n\n`
    for (const r of wsBad) md += `- [${r.rel}](${relFromDocs(r.rel)}) — ${r.problems.join('; ')}\n`
    md += '\n'
  }
  md += `---\n\n${wsGood.length} workspace docs (${boot.length} boot cards), ${wsBad.length} with problems, ${TRACKS.length} subprojects.\n`
  return md
}

function indexMd() {
  let md = `# Documentation Index — workspace

> Generated by \`node scripts/doc-index.mjs\`. Do not edit by hand.
> ${wsGood.length} workspace document(s). Compact view: [docs/SKELETON.md](docs/SKELETON.md).
> Per-subproject indexes: ${TRACKS.map((t) => `[${t}](${t}/docs/INDEX.md)`).join(' · ')} · [pending-docs](pending-docs/INDEX.md)

## Workspace documents

| Version | Kind | Status | Updated | Lines | Document | Summary |
|---|---|---|---|---|---|---|
`
  for (const r of [...wsGood].sort((a, b) => a.rel.localeCompare(b.rel))) {
    const s = r.skeleton
    md += `| ${s.version} | ${s.kind} | ${s.status} | ${s.updated} | ${r.lines} | [${r.rel}](${r.rel}) | ${s.summary} |\n`
  }
  md += `\n## Subprojects\n\n| Subproject | Docs | Index |\n|---|---|---|\n`
  for (const t of TRACKS) {
    const n = rows.filter((r) => ownerOf(r.rel) === t).length
    md += `| \`${t}/\` | ${n} | [docs/INDEX.md](${t}/docs/INDEX.md) |\n`
  }
  if (SUBMODULES.length) {
    md += `\n### Separate repositories (submodules)\n\n`
    md += `These tracks are their own git repositories. They keep and index their own documents; this\n`
    md += `workspace does not write into them.\n\n| Subproject | How to read its docs |\n|---|---|\n`
    for (const t of SUBMODULES) md += `| \`${t}/\` | \`${t}/docs/INDEX.md\` if present, else \`${t}/README.md\` (owned by that repo) |\n`
  }
  const pn = rows.filter((r) => r.rel.startsWith('pending-docs/')).length
  md += `| \`pending-docs/\` | ${pn} | [INDEX.md](pending-docs/INDEX.md) |\n`
  if (wsBad.length) {
    md += `\n### Missing or invalid skeleton header\n\n`
    for (const r of wsBad) md += `- [${r.rel}](${r.rel}) — ${r.problems.join('; ')}\n`
  }
  return md
}

// --------------------------------------------------------------- subproject --
/** One compact index per subproject, written to <track>/docs/INDEX.md. */
function trackIndexMd(track) {
  const own = rows.filter((r) => ownerOf(r.rel) === track)
  const good = [], bad = []
  for (const r of own) {
    const problems = validate(r, 'track')
    if (problems.length) bad.push({ ...r, problems })
    else good.push(r)
    }
  const pkgPath = join(root, track, 'package.json')
  let pkg = {}
  try { pkg = JSON.parse(readFileSync(pkgPath, 'utf8')) } catch { /* manifest is checked elsewhere */ }
  const title = pkg.name || track
  const byKind = new Map()
  for (const r of good) {
    const kind = KINDS.includes(r.skeleton.kind) ? r.skeleton.kind : 'other'
    if (!byKind.has(kind)) byKind.set(kind, [])
    byKind.get(kind).push(r)
  }
  const order = [...KINDS, 'other'].filter((k) => byKind.has(k))
  let md = `# ${title} — Documentation Index

<!-- skeleton:
version: 1.0
kind: index
status: active
updated: ${today()}
summary: Generated per-subproject index for ${title}: every document this track owns, one line each.
-->

> Generated by \`node scripts/doc-index.mjs\`. Do not edit by hand.
> ${good.length} document(s) owned by \`${track}/\`. ${bad.length} with header problems.
> Package \`${pkg.name || '?'}@${pkg.version || '?'}\` · history: [CHANGELOG.md](../CHANGELOG.md) · workspace rules:
> [docs/RULES.md](../../docs/RULES.md) §6.1b.
>
> **Every document for this subproject lives in this track, not in the workspace \`docs/\`.**
> Run \`npm run docs:check\` here (or \`npm run docs:check:all\` at the root) after adding a doc.

## Summary

| Version | Kind | Status | Updated | Document | Summary |
|---|---|---|---|---|---|
`
  for (const r of [...good].sort((a, b) => a.rel.localeCompare(b.rel))) {
    const s = r.skeleton
    const relFromDocsDir = posix.relative(posix.join(track, 'docs'), r.rel)
    md += `| ${s.version} | ${s.kind} | ${s.status} | ${s.updated} | [${posix.basename(r.rel)}](${relFromDocsDir}) | ${s.summary} |\n`
  }
  md += '\n'
  for (const kind of order) {
    md += `## ${kind}\n\n`
    for (const r of byKind.get(kind).sort((a, b) => b.skeleton.updated.localeCompare(a.skeleton.updated))) {
      const s = r.skeleton
      const link = posix.relative(posix.join(track, 'docs'), r.rel)
      md += `- **${s.version}** · ${s.status} · ${s.updated} · [${posix.basename(r.rel)}](${link})\n  ${s.summary}\n`
    }
    md += '\n'
  }
  if (bad.length) {
    md += `## MISSING HEADER (${bad.length}) — fix before release\n\n`
    for (const r of bad) {
      const link = posix.relative(posix.join(track, 'docs'), r.rel)
      md += `- [${r.rel}](${link}) — ${r.problems.join('; ')}\n`
    }
    md += '\n'
  }
  return md
}

// ------------------------------------------------------------------ pending --
function lifecycleIndexMd() {
  const own = rows.filter((r) => r.rel.startsWith('pending-docs/'))
  const good = [], bad = [], moved = []
  for (const r of own) {
    if (r.rel !== 'pending-docs/README.md' && isStub(r)) { moved.push(r); continue }
    const problems = validate(r, 'pending')
    if (problems.length) bad.push({ ...r, problems })
    else good.push(r)
  }
  const LABEL = {
    unpromoted: '미승격 — implemented and measured, but not promoted to a live profile',
    unimplemented: '미구현 — designed or measured, no code shipped',
    deprecated: '폐기 — superseded, kept only as evidence',
    undecided: '미정 — nobody has decided what this is yet',
  }
  let md = `# Pending Documents — 미승격 · 미구현 · 폐기 · 미정

<!-- skeleton:
version: 1.0
kind: index
status: active
updated: ${today()}
summary: Home for shared docs whose lifecycle is not "active track doc": unpromoted, unimplemented, deprecated, or undecided. One folder per state, one index.
-->

> Generated by \`node scripts/doc-index.mjs\`. Do not edit by hand.
> ${good.length} pending document(s), ${bad.length} with problems.
>
> This subproject exists so an undecided document has an explicit, greppable home instead of
> drifting into the workspace \`docs/\` and pretending to be a rule. **A document here is not a
> rule and not a commitment.** Moving a document out requires a decision and a one-line note in
> [HISTORY.md](../HISTORY.md); moving one in is free. Authority: [docs/RULES.md](../docs/RULES.md) §6.2.

## 상태 정의

| Lifecycle | 의미 | 오너 결정 |
| :--- | :--- | :--- |
| \`unpromoted\` | 구현·실측 완료. 라이브 프로파일에 올리지 않음 | 승격 여부 대기 |
| \`unimplemented\` | 설계/실측만 존재. 코드 없음 | 착수 여부 대기 |
| \`deprecated\` | 대체됨. 증거로만 보존 | 폐기 확정 |
| \`undecided\` | 성격 미정. 분류 자체가 안 됨 | 분류 대기 |

`
  for (const lc of LIFECYCLES) {
    const group = good.filter((r) => r.skeleton.lifecycle === lc)
    md += `## ${lc} (${group.length}) — ${LABEL[lc]}\n\n`
    if (!group.length) { md += `_없음._\n\n`; continue }
    md += `| Version | Kind | Status | Updated | Document | Summary |\n|---|---|---|---|---|---|\n`
    for (const r of group.sort((a, b) => a.rel.localeCompare(b.rel))) {
      const s = r.skeleton
      const link = posix.relative('pending-docs', r.rel)
      md += `| ${s.version} | ${s.kind} | ${s.status} | ${s.updated} | [${posix.basename(r.rel)}](${link}) | ${s.summary} |\n`
    }
    md += '\n'
  }
  if (moved.length) {
    md += `## Moved out of dsh-plugins (${moved.length}) — pointer stubs only\n\n`
    md += `These subjects proved to belong to a parent harness, so the authority moved there on\n`
    md += `2026-11-06 (owner instruction). What remains here is a stub that keeps old links alive.\n`
    md += `**Edit the destination, never the stub.**\n\n`
    md += `| Stub | Authoritative copy now lives at |\n|---|---|\n`
    for (const r of moved.sort((a, b) => a.rel.localeCompare(b.rel))) {
      const text = readFileSync(join(root, r.rel), 'utf8')
      const m = text.match(/authoritative copy now lives at \*\*`([^`]+)`\*\*/i)
      md += `| [${posix.basename(r.rel)}](${posix.relative('pending-docs', r.rel)}) | \`${m ? m[1] : 'unknown'}\` |\n`
    }
    md += '\n'
  }
  if (bad.length) {
    md += `## MISSING/INVALID (${bad.length}) — fix before release\n\n`
    for (const r of bad) md += `- [${r.rel}](${posix.relative('pending-docs', r.rel)}) — ${r.problems.join('; ')}\n`
    md += '\n'
  }
  return md
}

function today() {
  return new Date(Date.now() + 9 * 3600 * 1000).toISOString().slice(0, 10)
}

// -------------------------------------------------------------------- gates --
const outputs = [
  [join(root, 'INDEX.md'), indexMd()],
  [join(root, 'docs/SKELETON.md'), skeletonMd()],
  [join(root, 'pending-docs/INDEX.md'), lifecycleIndexMd()],
  ...TRACKS.map((t) => [join(root, t, 'docs/INDEX.md'), trackIndexMd(t)]),
]

/** Workspace-level documents that are missing a header are a hard failure. */
const pendingBad = rows.filter((r) => r.rel.startsWith('pending-docs/')).filter((r) => validate(r, 'pending').length)
const wsBadCount = wsBad.length

const check = process.argv.includes('--check')
const quiet = process.argv.includes('--quiet')
if (check) {
  const stale = []
  for (const [file, next] of outputs) {
    const prev = existsSync(file) ? readFileSync(file, 'utf8') : ''
    if (prev !== next) stale.push(relative(root, file))
  }
  if (wsBadCount) console.error(`FAIL: ${wsBadCount} workspace doc(s) missing/invalid skeleton header: ${wsBad.map((r) => `${r.rel} (${r.problems.join('; ')})`).join(', ')}`)
  if (pendingBad.length) console.error(`FAIL: ${pendingBad.length} pending doc(s) missing/invalid header or lifecycle: ${pendingBad.map((r) => `${r.rel} (${validate(r, 'pending').join('; ')})`).join(', ')}`)
  if (stale.length) console.error(`FAIL: stale index file(s): ${stale.join(', ')} — run npm run docs:index`)
  if (!wsBadCount && !pendingBad.length && !stale.length) {
    if (!quiet) console.log(`OK: ${wsGood.length} workspace docs, ${rows.filter((r) => r.rel.startsWith('pending-docs/')).length} pending, ${TRACKS.length} subproject indexes up to date.`)
  }
  process.exit(wsBadCount || pendingBad.length || stale.length ? 1 : 0)
}

for (const [file, body] of outputs) {
  const prev = existsSync(file) ? readFileSync(file, 'utf8') : ''
  if (prev !== body) writeFileSync(file, body)
}
if (!quiet) {
  console.log(`workspace: ${wsGood.length} docs (${wsBadCount} problems) -> INDEX.md, docs/SKELETON.md`)
  console.log(`pending-docs: ${rows.filter((r) => r.rel.startsWith('pending-docs/')).length} docs (${pendingBad.length} problems) -> pending-docs/INDEX.md`)
  for (const t of TRACKS) {
    const n = rows.filter((r) => ownerOf(r.rel) === t).length
    console.log(`  ${t}: ${n} docs -> ${t}/docs/INDEX.md`)
  }
}
