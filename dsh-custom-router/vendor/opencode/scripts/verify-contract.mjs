#!/usr/bin/env node
/**
 * verify-contract.mjs — external-contract check for the vendored OpenCode adapter.
 *
 * The adapter talks to a local `opencode serve` control plane. Every `/api/...`
 * endpoint it calls is part of an *external* contract owned upstream, not by this
 * package: if OpenCode renames or drops one, the adapter breaks at runtime with no
 * compile-time signal. This script freezes the upstream surface into a fixture and
 * fails when the adapter reaches for a path the upstream spec does not document.
 *
 * Zero dependencies, fully offline. The fixture — not the 880 KB spec — is the
 * source of truth; it carries the spec's sha256 so drift is attributable.
 *
 *   node scripts/verify-contract.mjs      # exit 1 on any undocumented endpoint
 *
 * Fixture: ../../test/fixtures/opencode-openapi-paths.json
 *   { source, openapi, fetchedAt, sha256, paths: [sorted path keys] }
 */

import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

const PKG_ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const LIB_DIR = join(PKG_ROOT, 'lib')
const FIXTURE = join(PKG_ROOT, '..', '..', 'test', 'fixtures', 'opencode-openapi-paths.json')

/**
 * `/api/local/...` is NOT an OpenCode endpoint. It is the DSH-side namespace this
 * adapter registers on the *host* (see lib/http.js `ctx.server` register with
 * `path: /api/local/opencode-v2/${suffix}`) and that its own browser half calls
 * (lib/client.js). It has no counterpart in the upstream spec by design, so it is
 * excluded from the external-contract check rather than counted as drift.
 */
const SELF_SERVED_PREFIXES = ['/api/local/']

const fail = (message) => {
  console.error(`FAIL: ${message}`)
  process.exit(1)
}

// ---------------------------------------------------------------------------
// Fixture
// ---------------------------------------------------------------------------

const readFixture = () => {
  let raw
  try {
    raw = readFileSync(FIXTURE, 'utf8')
  } catch (error) {
    fail(`cannot read fixture ${FIXTURE}: ${error.message}`)
  }
  let fixture
  try {
    fixture = JSON.parse(raw)
  } catch (error) {
    fail(`fixture is not valid JSON: ${error.message}`)
  }
  if (typeof fixture.sha256 !== 'string' || !/^[0-9a-f]{64}$/.test(fixture.sha256)) {
    fail(`fixture.sha256 must be 64 lowercase hex chars, got ${JSON.stringify(fixture.sha256)}`)
  }
  if (!Array.isArray(fixture.paths) || fixture.paths.length === 0) {
    fail('fixture.paths must be a non-empty array')
  }
  if (!fixture.paths.every((p) => typeof p === 'string' && p.length > 0)) {
    fail('fixture.paths must contain only non-empty strings')
  }
  if (new Set(fixture.paths).size !== fixture.paths.length) {
    fail('fixture.paths contains duplicates')
  }
  const sorted = [...fixture.paths].sort()
  if (fixture.paths.some((path, index) => path !== sorted[index])) {
    fail('fixture.paths is not sorted ascending')
  }
  return fixture
}

// ---------------------------------------------------------------------------
// Source scan
// ---------------------------------------------------------------------------

/**
 * Blank out `//` and `/* *\/` comments while preserving byte offsets, so a match
 * index still maps to the real line number. Commented prose mentions endpoints the
 * adapter does not call (e.g. a doc line naming a path from an older API); only
 * live code counts as usage. Strings are left untouched — that is where the
 * endpoint literals live.
 */
const stripComments = (source) => {
  const blank = (ch) => (ch === '\n' ? '\n' : ' ')
  let out = ''
  let state = 'code'
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    const next = source[i + 1]
    if (state === 'code') {
      if (ch === '/' && next === '/') { out += '  '; state = 'line'; i += 1; continue }
      if (ch === '/' && next === '*') { out += '  '; state = 'block'; i += 1; continue }
      if (ch === "'" || ch === '"' || ch === '`') { out += ch; state = ch; continue }
      out += ch
      continue
    }
    if (state === 'line') {
      if (ch === '\n') { out += '\n'; state = 'code'; continue }
      out += ' '
      continue
    }
    if (state === 'block') {
      if (ch === '*' && next === '/') { out += '  '; state = 'code'; i += 1; continue }
      out += blank(ch)
      continue
    }
    // inside a quoted string / template literal
    if (ch === '\\') { out += ch + (next ?? ''); i += 1; continue }
    if (ch === state) { out += ch; state = 'code'; continue }
    out += ch
  }
  return out
}

/**
 * `/api` followed by one or more path segments. A segment is either a literal
 * (`provider`, `v2`), a spec-style placeholder (`{id}`) or a template expression
 * (`${encodeURIComponent(providerId)}`). The trailing `\/?` is captured so a
 * prefix predicate (`path.startsWith('/api/provider/')`) can be told apart from a
 * complete path.
 */
const ENDPOINT_RE = /\/api\/(?:[A-Za-z0-9_.~-]+|\$\{[^}]*\}|\{[^}]*\})(?:\/(?:[A-Za-z0-9_.~-]+|\$\{[^}]*\}|\{[^}]*\}))*\/?/g

/** Any `{...}` / `${...}` placeholder becomes `{p}`; matching then compares shapes. */
const normalizePlaceholders = (path) => path.replace(/\$\{[^}]*\}|\{[^}]*\}/g, '{p}')

const lineAt = (text, index) => {
  let line = 1
  for (let i = 0; i < index; i += 1) if (text[i] === '\n') line += 1
  return line
}

const scanSources = () => {
  const files = readdirSync(LIB_DIR).filter((name) => name.endsWith('.js')).sort()
  if (files.length === 0) fail(`no lib/*.js sources found under ${LIB_DIR}`)

  const used = new Map() // normalized path -> { raw, hits: [] }
  const skipped = [] // { raw, file, line, reason }

  for (const file of files) {
    const stripped = stripComments(readFileSync(join(LIB_DIR, file), 'utf8'))
    const displayName = relative(PKG_ROOT, join(LIB_DIR, file)).split('\\').join('/')
    for (const match of stripped.matchAll(ENDPOINT_RE)) {
      const raw = match[0]
      const line = lineAt(stripped, match.index)
      if (raw.endsWith('/')) {
        // `startsWith('/api/provider/')` — a prefix test, not a request path.
        skipped.push({ raw, file: displayName, line, reason: 'prefix literal' })
        continue
      }
      if (SELF_SERVED_PREFIXES.some((prefix) => raw.startsWith(prefix))) {
        skipped.push({ raw, file: displayName, line, reason: 'self-served host route' })
        continue
      }
      const normalized = normalizePlaceholders(raw)
      if (!used.has(normalized)) used.set(normalized, { raw, hits: [] })
      const entry = used.get(normalized)
      if (!entry.hits.some((hit) => hit.file === displayName && hit.line === line)) {
        entry.hits.push({ file: displayName, line })
      }
    }
  }
  return { used, skipped }
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

const main = () => {
  const fixture = readFixture()
  const documented = new Map(fixture.paths.map((path) => [normalizePlaceholders(path), path]))
  const { used, skipped } = scanSources()

  const rows = [...used.entries()]
    .map(([normalized, entry]) => ({
      used: entry.raw,
      normalized,
      specPath: documented.get(normalized) ?? null,
      hits: entry.hits,
    }))
    .sort((a, b) => a.normalized.localeCompare(b.normalized))

  const undocumented = rows.filter((row) => row.specPath === null)

  const width = Math.max(5, ...rows.map((row) => row.normalized.length))
  const pad = (value) => value.padEnd(width)
  console.log(`fixture  : ${relative(process.cwd(), FIXTURE)}`)
  console.log(`spec     : ${fixture.source} (OpenAPI ${fixture.openapi}, fetched ${fixture.fetchedAt})`)
  console.log(`sha256   : ${fixture.sha256}`)
  console.log(`paths    : ${fixture.paths.length}`)
  console.log('')
  console.log(`${pad('ENDPOINT')}  STATUS        SPEC PATH                     USED AT`)
  console.log(`${'-'.repeat(width)}  ------------  ----------------------------  -------`)
  for (const row of rows) {
    const status = row.specPath === null ? 'UNDOCUMENTED' : 'documented'
    const spec = row.specPath === null ? '—' : row.specPath
    const where = row.hits.map((hit) => `${hit.file}:${hit.line}`).join(', ')
    console.log(`${pad(row.normalized)}  ${status.padEnd(12)}  ${spec.padEnd(28)}  ${where}`)
  }
  if (skipped.length > 0) {
    console.log('')
    console.log('not counted as upstream endpoints:')
    for (const item of skipped) {
      console.log(`  ${item.raw}  (${item.reason})  ${item.file}:${item.line}`)
    }
  }
  console.log('')

  if (rows.length === 0) fail('no /api/... endpoint literals found in lib/*.js')
  if (undocumented.length > 0) {
    console.error(`FAIL: ${undocumented.length} endpoint(s) used but not documented in the OpenAPI fixture:`)
    for (const row of undocumented) {
      const where = row.hits.map((hit) => `${hit.file}:${hit.line}`).join(', ')
      console.error(`  - ${row.used}  (${where})`)
    }
    process.exit(1)
  }

  console.log(`OK: ${fixture.paths.length} endpoints documented, ${rows.length} used, 0 undocumented`)
}

main()
