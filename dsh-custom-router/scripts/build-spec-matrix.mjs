#!/usr/bin/env node
/**
 * Generate `docs/COMPATIBILITY-MATRIX.md` from the living specs.
 *
 * The matrix is a MEASUREMENT of `specs/{protocols,providers,pricing}`, never
 * hand-edited: a wrong cell means a spec file is wrong, not the table.
 *
 * Usage:
 *   node scripts/build-spec-matrix.mjs [--root <dir>] [--out <file>] [--now YYYY-MM-DD]
 *   node scripts/build-spec-matrix.mjs --check
 *
 * Exit codes: 0 written / current, 1 --check found drift (or specs failed to
 * load), 2 usage error.
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { ageDays, DEFAULT_TTL, loadSpecs } from './verify-specs.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
export const DEFAULT_ROOT = resolve(HERE, '..')
export const DEFAULT_OUT = join('docs', 'COMPATIBILITY-MATRIX.md')

const SUMMARY =
  'Generated compatibility matrix for the Custom Router presets, protocols, capabilities and pricing sources.'

const docOf = (entry) => (entry && typeof entry === 'object' && 'value' in entry ? entry.value : entry)
/** Pricing files are keyed by `provider`; every other collection by `id`. */
const idOf = (entry, kind) => {
  const doc = docOf(entry)
  if (!doc || typeof doc !== 'object' || Array.isArray(doc)) return undefined
  return kind === 'pricing' ? doc.provider ?? doc.id : doc.id
}
const isPlainObject = (value) => !!value && typeof value === 'object' && !Array.isArray(value)

/** Newest `verifiedAt` across every spec document (empty string when none). */
export function matrixUpdatedAt(specs) {
  let newest = ''
  for (const kind of ['protocols', 'providers', 'pricing']) {
    for (const entry of specs?.[kind] ?? []) {
      const verifiedAt = docOf(entry)?.verifiedAt
      if (typeof verifiedAt === 'string' && verifiedAt > newest) newest = verifiedAt
    }
  }
  return newest
}

/** Protocol-level capabilities overridden by the provider's own block. */
function capabilitiesOf(provider, protocol) {
  return { ...(isPlainObject(protocol?.capabilities) ? protocol.capabilities : {}), ...(isPlainObject(provider?.capabilities) ? provider.capabilities : {}) }
}

const flag = (value) => (value === true ? 'yes' : 'no')

function reasoningCell(value) {
  if (Array.isArray(value)) return value.length === 0 ? '—' : value.join(', ')
  if (value === true) return 'yes'
  return '—'
}

/**
 * Render the matrix markdown. Deterministic for a given specs set and clock:
 * providers are ordered by id and every cell is derived, not stored.
 * @param {{protocols?: object[], providers?: object[], pricing?: object[], __now?: string}} specs
 * @param {{now?: string}} [options]
 */
export function renderMatrix(specs, options = {}) {
  const now = options.now ?? specs?.__now ?? new Date().toISOString().slice(0, 10)
  const protocols = new Map((specs?.protocols ?? []).map((entry) => [idOf(entry, 'protocols'), docOf(entry)]))
  const pricing = new Map((specs?.pricing ?? []).map((entry) => [idOf(entry, 'pricing'), docOf(entry)]))

  const rows = (specs?.providers ?? [])
    .map(docOf)
    .filter(isPlainObject)
    .sort((left, right) => String(left.id).localeCompare(String(right.id)))
    .map((provider) => {
      const protocol = protocols.get(provider.protocol)
      const price = pricing.get(provider.pricing)
      const caps = capabilitiesOf(provider, protocol)
      // The Stale cell must agree with `verify-specs`: a row is stale when the
      // provider itself, its pricing, or a SERVED protocol is past its TTL.
      // The cell shows the largest age so the worst offender is visible.
      let stale = '—'
      try {
        let worst = 0
        let any = false
        const consider = (doc, kind) => {
          if (!isPlainObject(doc)) return
          const ttlDays = Number.isInteger(doc.ttlDays) && doc.ttlDays > 0 ? doc.ttlDays : DEFAULT_TTL[kind]
          const age = ageDays(doc.verifiedAt, now)
          if (age > ttlDays && age > worst) worst = age
          if (age > ttlDays) any = true
        }
        consider(provider, 'providers')
        consider(price, 'pricing')
        if (Array.isArray(protocol?.adapters) && protocol.adapters.length > 0) consider(protocol, 'protocols')
        if (any) stale = `${worst}d`
      } catch {
        stale = '?'
      }
      const models = Array.isArray(provider.models) ? provider.models.join(', ') : '—'
      const priceCell = price ? `${price.kind ?? '?'} (${price.source ?? '—'})` : '—'
      return [
        provider.id,
        provider.protocol ?? '—',
        models,
        flag(caps.tools),
        reasoningCell(caps.reasoning),
        flag(caps.usage),
        flag(caps.cache),
        flag(caps.structuredOutput),
        flag(caps.vision),
        priceCell,
        provider.verifiedAt ?? '—',
        stale,
      ]
    })

  const lines = [
    '<!-- skeleton:',
    'version: 1.0',
    'kind: measurement',
    'status: active',
    `updated: ${matrixUpdatedAt(specs) || now}`,
    `summary: ${SUMMARY}`,
    '-->',
    '',
    '# Compatibility Matrix',
    '',
    `Generated by \`scripts/build-spec-matrix.mjs\` from \`specs/\` — do not edit by hand. Regenerate with \`npm run specs:build\`.`,
    '',
    '| Provider | Protocol | Models | Tools | Reasoning | Usage | Cache | Structured | Vision | Pricing | Last verified | Stale |',
    '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |',
    ...rows.map((cells) => `| ${cells.map((cell) => String(cell).replaceAll('|', '\\|')).join(' | ')} |`),
    '',
  ]
  return lines.join('\n')
}

// ------------------------------------------------------------------ CLI

function fail(message) {
  console.error(`build-spec-matrix: ${message}`)
  return 2
}

function main(argv) {
  const take = (name) => {
    const index = argv.indexOf(name)
    if (index === -1) return undefined
    const value = argv[index + 1]
    if (!value || value.startsWith('--')) return null
    return value
  }

  const root = take('--root')
  const out = take('--out')
  const now = take('--now')
  if (root === null) return fail('--root requires a directory')
  if (out === null) return fail('--out requires a file path')
  if (now === null || (now !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(now))) return fail('--now requires YYYY-MM-DD')

  const base = resolve(root ?? DEFAULT_ROOT)
  const target = out ? resolve(out) : join(base, DEFAULT_OUT)
  const check = argv.includes('--check')

  const specs = loadSpecs({ root: base })
  if (specs.errors.length > 0) {
    for (const error of specs.errors) console.error(`error: ${error}`)
    return 1
  }

  const rendered = renderMatrix(specs, now ? { now } : {})

  if (check) {
    if (!existsSync(target)) {
      console.error(`build-spec-matrix: missing ${target} — run npm run specs:build`)
      return 1
    }
    if (readFileSync(target, 'utf8') !== rendered) {
      console.error(`build-spec-matrix: ${target} is out of date — run npm run specs:build`)
      return 1
    }
    console.log(`spec-matrix: current (${target})`)
    return 0
  }

  mkdirSync(dirname(target), { recursive: true })
  writeFileSync(target, rendered)
  console.log(`spec-matrix: wrote ${target}`)
  return 0
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  process.exit(main(process.argv.slice(2)))
}
