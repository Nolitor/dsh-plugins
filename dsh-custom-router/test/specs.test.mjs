/**
 * Specs gate tests. Every fixture is written to a fresh `mkdtemp` tree so the
 * suite never reads or depends on the real `specs/` data.
 */
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_WATCH_MAX_AGE_DAYS,
  PRICING_KIND_TO_BILLING_MODE,
  WATCH_LOCK_PATH,
  ageDays,
  checkFreshness,
  checkPresetMirror,
  checkWatchBaseline,
  loadSpecs,
  loadWatchBaseline,
  renderReport,
  validateSpecs,
} from '../scripts/verify-specs.mjs'
import { matrixUpdatedAt, renderMatrix } from '../scripts/build-spec-matrix.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const VERIFY = resolve(HERE, '..', 'scripts', 'verify-specs.mjs')
const BUILD = resolve(HERE, '..', 'scripts', 'build-spec-matrix.mjs')
const NOW = '2026-04-01'

const dirs = []
test.after(() => {
  for (const dir of dirs) rmSync(dir, { recursive: true, force: true })
})

function tempRoot() {
  const root = mkdtempSync(join(tmpdir(), 'dsh-specs-'))
  dirs.push(root)
  return root
}

function writeJson(path, value) {
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}

const protocol = (id, extra = {}) => ({
  id,
  revision: 1,
  verifiedAt: '2026-03-02',
  ttlDays: 90,
  docs: 'https://example.test/protocol',
  streaming: 'sse',
  canonical: { text: 'choices[].delta.content' },
  capabilities: { tools: true, reasoning: true, usage: true, cache: true, structuredOutput: true, vision: true },
  adapters: ['vendor/fake/lib/adapter.js'],
  ...extra,
})

const provider = (id, extra = {}) => ({
  id,
  preset: id,
  status: 'active',
  protocol: 'wire-a',
  docs: 'https://example.test/provider',
  verifiedAt: '2026-03-02',
  ttlDays: 90,
  endpoint: 'https://api.example.test/v1',
  models: [`${id}-model`],
  capabilities: { tools: true, reasoning: ['low', 'high'], usage: true, cache: false, structuredOutput: true, vision: false },
  pricing: id,
  ...extra,
})

const pricing = (id, extra = {}) => ({
  provider: id,
  kind: 'free',
  source: 'owner',
  verifiedAt: '2026-03-02',
  ttlDays: 30,
  ...extra,
})

/** Build a complete, valid fixture tree; `overrides` replace whole collections. */
function fixture(overrides = {}) {
  const root = tempRoot()
  const specs = {
    protocols: [protocol('wire-a'), protocol('wire-b', { adapters: [] })],
    providers: [provider('alpha')],
    pricing: [pricing('alpha')],
    ...overrides,
  }
  for (const kind of ['protocols', 'providers', 'pricing']) {
    mkdirSync(join(root, 'specs', kind), { recursive: true })
    specs[kind].forEach((doc, index) => {
      const id = kind === 'pricing' ? doc.provider : doc.id
      writeJson(join(root, 'specs', kind, `${id ?? index}.json`), doc)
    })
  }
  return { root, specs }
}

// ------------------------------------------------------------------ ageDays

test('ageDays: whole days, floor, and invalid input', () => {
  assert.equal(ageDays('2026-04-01', '2026-04-01'), 0)
  assert.equal(ageDays('2026-01-01', '2026-04-01'), 90)
  assert.equal(ageDays('2026-01-01', '2026-04-02'), 91)
  assert.equal(ageDays('2026-04-02', '2026-04-01'), -1)
  assert.throws(() => ageDays('not-a-date', NOW), /invalid verifiedAt/)
  assert.throws(() => ageDays('2026-03-02', 'nope'), /invalid now/)
})

// ------------------------------------------------------------------ freshness

test('freshness: an age equal to ttlDays is still fresh', () => {
  const specs = {
    protocols: [protocol('wire-a')],
    providers: [provider('alpha')],
    pricing: [pricing('alpha')], // exactly 30d old at NOW
  }
  assert.equal(ageDays('2026-03-02', NOW), 30)
  const result = checkFreshness(specs, NOW)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
  assert.deepEqual(result.stale, [])
})

test('freshness: one day past the TTL is stale (provider and pricing fail)', () => {
  const specs = {
    protocols: [protocol('wire-a')],
    // provider default ttl is 90d, so drop its own ttl to 30 to make 31d genuinely stale
    providers: [provider('alpha', { verifiedAt: '2026-03-01', ttlDays: 30 })],
    pricing: [pricing('alpha', { verifiedAt: '2026-03-01' })], // ttl 30 -> 31d stale
  }
  const result = checkFreshness(specs, NOW)
  assert.equal(result.stale.length, 2)
  assert.ok(result.errors.some((error) => error.startsWith('providers/alpha') && /31d old/.test(error)))
  assert.ok(result.errors.some((error) => error.startsWith('pricing/alpha') && /31d old/.test(error)))
  assert.deepEqual(result.warnings, [])
})

test('freshness: a stale protocol is a failure only when an adapter serves it', () => {
  const served = checkFreshness({ protocols: [protocol('wire-a', { verifiedAt: '2025-12-01' })] }, NOW) // 121d > 90
  assert.equal(served.errors.length, 1)
  assert.match(served.errors[0], /protocols\/wire-a/)
  assert.equal(served.stale[0].level, 'error')

  const unserved = checkFreshness({ protocols: [protocol('wire-b', { adapters: [], verifiedAt: '2025-12-01' })] }, NOW)
  assert.deepEqual(unserved.errors, [])
  assert.equal(unserved.warnings.length, 1)
  assert.match(unserved.warnings[0], /no adapter serves this protocol/)
  assert.equal(unserved.stale[0].level, 'warning')
})

test('freshness: default TTLs are protocol 90 / provider 90 / pricing 30', () => {
  const specs = {
    protocols: [protocol('wire-a', { ttlDays: undefined, verifiedAt: '2026-01-01' })],
    providers: [provider('alpha', { ttlDays: undefined, verifiedAt: '2026-01-01' })], // 90d -> fresh
    pricing: [pricing('alpha', { ttlDays: undefined, verifiedAt: '2026-01-01' })], // 90d > 30 -> stale
  }
  const result = checkFreshness(specs, NOW)
  // protocol 90d and provider 90d are exactly at their default TTL -> fresh;
  // pricing's 30d default makes the same age stale, which is always a failure.
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /pricing\/alpha: verifiedAt 2026-01-01 is 90d old \(ttl 30d\)/)
  assert.equal(result.stale.length, 1)
  assert.equal(result.stale[0].kind, 'pricing')
  assert.equal(result.stale[0].ttlDays, 30)
})

test('freshness: an invalid verifiedAt is a hard error', () => {
  const result = checkFreshness({ providers: [provider('alpha', { verifiedAt: 'yesterday' })] }, NOW)
  assert.equal(result.errors.length, 1)
  assert.match(result.errors[0], /invalid verifiedAt/)
})

// ------------------------------------------------------------------ watch baseline

/** Write a watch baseline into a fixture root. */
function writeLock(root, value) {
  writeJson(join(root, WATCH_LOCK_PATH), value)
}

test('watch baseline: a fresh lock is OK and reports its age', () => {
  const result = checkWatchBaseline({ generatedAt: '2026-03-20T00:00:00.000Z' }, NOW)
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
  assert.equal(result.watch.ok, true)
  assert.equal(result.watch.age, 12)
  assert.equal(result.watch.maxAgeDays, DEFAULT_WATCH_MAX_AGE_DAYS)
  assert.equal(DEFAULT_WATCH_MAX_AGE_DAYS, 14)
})

test('watch baseline: a baseline older than the maximum is a warning, visible by default', () => {
  const result = checkWatchBaseline({ generatedAt: '2026-03-01T00:00:00.000Z' }, NOW)
  assert.deepEqual(result.errors, [])
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /baseline generatedAt 2026-03-01T00:00:00.000Z is 31d old \(max 14d\) — run npm run spec:watch/)
  assert.equal(result.watch.ok, false)
})

test('watch baseline: --strict-watch turns staleness and a missing lock into errors', () => {
  const stale = checkWatchBaseline({ generatedAt: '2026-03-01T00:00:00.000Z' }, NOW, { strict: true })
  assert.equal(stale.warnings.length, 0)
  assert.equal(stale.errors.length, 1)
  assert.match(stale.errors[0], /run npm run spec:watch/)

  const missing = checkWatchBaseline(null, NOW, { strict: true })
  assert.equal(missing.errors.length, 1)
  assert.match(missing.errors[0], /no specs\/upstream\.lock\.json baseline/)

  // Report-only by default: an offline/keyless machine still passes.
  const soft = checkWatchBaseline(null, NOW)
  assert.deepEqual(soft.errors, [])
  assert.equal(soft.warnings.length, 1)
  assert.equal(soft.watch.ok, false)
})

test('watch baseline: the maximum age is overridable and a lock without generatedAt is broken', () => {
  const relaxed = checkWatchBaseline({ generatedAt: '2026-02-01T00:00:00.000Z' }, NOW, { maxAgeDays: 120 })
  assert.equal(relaxed.watch.ok, true)

  const broken = checkWatchBaseline({ entries: {} }, NOW)
  assert.equal(broken.errors.length, 1)
  assert.match(broken.errors[0], /has no "generatedAt"/)
})

test('watch baseline: a lock stamped after the reference clock is 0d, never negative', () => {
  const result = checkWatchBaseline({ generatedAt: '2026-04-02T00:00:00.000Z' }, NOW)
  assert.equal(result.watch.age, 0)
  assert.equal(result.watch.ok, true)
})

test('renderReport: prints the watch line before the specs summary', () => {
  const fresh = renderReport({ ok: true, errors: [], warnings: [], files: {}, watch: { generatedAt: 'x', age: 3, maxAgeDays: 14, ok: true } })
  assert.match(fresh, /^watch: generatedAt x, 3d old \(max 14d\) — OK$/m)
  const missing = renderReport({ ok: true, errors: [], warnings: [], files: {}, watch: { generatedAt: null, age: null, maxAgeDays: 14, ok: false } })
  assert.match(missing, /^watch: no baseline \(max 14d\) — MISSING$/m)
})

test('loadWatchBaseline: missing is null, unparseable is a read error', () => {
  const root = tempRoot()
  assert.deepEqual(loadWatchBaseline(root), { lock: null, path: join(root, WATCH_LOCK_PATH), error: null })

  writeJson(join(root, WATCH_LOCK_PATH), { generatedAt: '2026-03-20T00:00:00.000Z' })
  const loaded = loadWatchBaseline(root)
  assert.equal(loaded.error, null)
  assert.equal(loaded.lock.generatedAt, '2026-03-20T00:00:00.000Z')

  writeFileSync(join(root, WATCH_LOCK_PATH), '{ not json')
  assert.match(loadWatchBaseline(root).error, /^specs\/upstream\.lock\.json: /)
})

// ------------------------------------------------------------------ validation

test('validateSpecs: clean fixture has no errors or warnings', async () => {
  const { specs, root } = fixture()
  const result = await validateSpecs(specs, { root }) // fixture has no lib/presets.js
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
})

test('validateSpecs: missing protocol / pricing references are hard errors', async () => {
  const { specs } = fixture({
    providers: [provider('alpha', { protocol: 'wire-gone', pricing: 'price-gone' })],
  })
  const result = await validateSpecs(specs)
  assert.ok(result.errors.some((error) => /protocol "wire-gone" not found/.test(error)))
  assert.ok(result.errors.some((error) => /pricing "price-gone" not found/.test(error)))
})

test('validateSpecs: a pricing provider that does not exist is a hard error', async () => {
  const { specs } = fixture({ pricing: [pricing('ghost')] })
  const result = await validateSpecs(specs)
  assert.ok(result.errors.some((error) => /^pricing\/ghost[^:]*: provider "ghost" not found/.test(error)), result.errors.join('\n'))
})

test('validateSpecs: required fields, status enum, capabilities, models, docs', async () => {
  const { specs } = fixture({
    providers: [
      provider('alpha', { status: 'retired', models: [], docs: '', capabilities: undefined, protocol: undefined }),
    ],
  })
  const result = await validateSpecs(specs)
  const joined = result.errors.join('\n')
  assert.match(joined, /"status" must be one of active\|preview\|deprecated\|disabled/)
  assert.match(joined, /"models" must be a non-empty array/)
  assert.match(joined, /"docs" must be a non-empty string/)
  assert.match(joined, /"capabilities" must be an object/)
  assert.match(joined, /missing "protocol"/)
})

test('validateSpecs: duplicate ids across a collection are rejected', async () => {
  const { specs } = fixture({ protocols: [protocol('wire-a'), protocol('wire-a')] })
  const result = await validateSpecs(specs)
  assert.ok(result.errors.some((error) => /protocols: duplicate id "wire-a"/.test(error)))
})

test('validateSpecs: PRICING files are keyed by "provider", not "id" (regression)', async () => {
  // A valid pricing doc carries no `id`; reading only `doc.id` made every
  // provider reference look missing.
  const { root } = fixture()
  const specs = loadSpecs({ root })
  assert.equal(specs.pricing[0].value.id, undefined)
  assert.equal(specs.pricing[0].value.provider, 'alpha')
  const result = await validateSpecs(specs, { root })
  assert.deepEqual(result.errors, [])
})

test('validateSpecs: preset soft-check is skipped when lib/presets.js is absent', async () => {
  const { specs, root } = fixture({ providers: [provider('alpha', { preset: 'not-a-preset' })] })
  const result = await validateSpecs(specs, { root }) // no lib/presets.js there
  assert.deepEqual(result.errors, [])
  assert.deepEqual(result.warnings, [])
})

test('validateSpecs: unknown preset is a soft warning when lib/presets.js parses', async () => {
  const { specs, root } = fixture({ providers: [provider('alpha', { preset: 'not-a-preset' })] })
  writeFileSync(join(root, 'package.json'), '{ "type": "module" }\n')
  mkdirSync(join(root, 'lib'), { recursive: true })
  writeFileSync(join(root, 'lib', 'presets.js'), "export const PRESETS = [{ id: 'alpha' }]\n")
  const result = await validateSpecs(specs, { root })
  assert.deepEqual(result.errors, [])
  assert.equal(result.warnings.length, 1)
  assert.match(result.warnings[0], /preset "not-a-preset" not found in lib\/presets\.js/)
})

// ------------------------------------------------------------------ loading

test('loadSpecs: missing specs directories are load errors, not throws', () => {
  const root = tempRoot()
  const specs = loadSpecs({ root })
  assert.equal(specs.errors.length, 3)
  assert.ok(specs.errors.every((error) => /missing directory/.test(error)))
  assert.deepEqual(specs.protocols, [])
})

test('loadSpecs: an unparseable JSON file is reported in errors', () => {
  const root = tempRoot()
  mkdirSync(join(root, 'specs', 'protocols'), { recursive: true })
  mkdirSync(join(root, 'specs', 'providers'), { recursive: true })
  mkdirSync(join(root, 'specs', 'pricing'), { recursive: true })
  writeFileSync(join(root, 'specs', 'protocols', 'broken.json'), '{ not json')
  const specs = loadSpecs({ root })
  assert.equal(specs.errors.length, 1)
  assert.match(specs.errors[0], /protocols\/broken\.json/)
})

test('loadSpecs: reads the fixture tree', () => {
  const { root } = fixture()
  const specs = loadSpecs({ root })
  assert.deepEqual(specs.errors, [])
  assert.equal(specs.protocols.length, 2)
  assert.equal(specs.providers.length, 1)
  assert.equal(specs.pricing.length, 1)
  assert.ok(specs.files.providers.includes('specs/providers/alpha.json'))
})

// ------------------------------------------------------------------ report

test('renderReport: compact counts plus error and warning lines', () => {
  const report = renderReport({
    ok: false,
    errors: ['boom'],
    warnings: ['meh'],
    files: { protocols: ['a'], providers: ['b', 'c'], pricing: [] },
  })
  assert.match(report, /^error: boom\nwarn:  meh\n/)
  assert.match(report, /2 providers/)
  assert.match(report, /FAILED/)
})

// ------------------------------------------------------------------ matrix

test('matrixUpdatedAt: newest verifiedAt across collections', () => {
  assert.equal(
    matrixUpdatedAt({
      protocols: [{ verifiedAt: '2026-03-02' }],
      providers: [{ verifiedAt: '2026-05-09' }],
      pricing: [{ verifiedAt: '2026-04-01' }],
    }),
    '2026-05-09',
  )
  assert.equal(matrixUpdatedAt({}), '')
})

test('renderMatrix: skeleton header, provider ordering and derived cells', () => {
  const specs = {
    protocols: [protocol('wire-a')],
    providers: [
      provider('beta', { models: ['b1', 'b2'], verifiedAt: '2026-03-02' }),
      provider('alpha', {
        capabilities: { tools: false, reasoning: false, usage: true, cache: true, structuredOutput: false, vision: true },
        verifiedAt: '2026-01-01', // 90d at NOW -> fresh
      }),
    ],
    pricing: [pricing('alpha'), { provider: 'beta', kind: 'pay-per-token', source: 'catalog', verifiedAt: '2026-03-02', ttlDays: 30 }],
  }
  const matrix = renderMatrix(specs, { now: NOW })
  const lines = matrix.split('\n')

  assert.equal(lines[0], '<!-- skeleton:')
  assert.deepEqual(lines.slice(1, 7), [
    'version: 1.0',
    'kind: measurement',
    'status: active',
    'updated: 2026-03-02',
    'summary: Generated compatibility matrix for the Custom Router presets, protocols, capabilities and pricing sources.',
    '-->',
  ])
  assert.ok(matrix.includes('\n# Compatibility Matrix\n'))
  assert.ok(matrix.includes('| Provider | Protocol | Models | Tools | Reasoning | Usage | Cache | Structured | Vision | Pricing | Last verified | Stale |'))
  assert.ok(lines.some((line) => line.includes('Generated by')))

  const alphaIndex = matrix.indexOf('| alpha |')
  const betaIndex = matrix.indexOf('| beta |')
  assert.ok(alphaIndex > 0 && betaIndex > alphaIndex, 'rows are ordered by provider id')
  assert.ok(matrix.includes('| alpha | wire-a | alpha-model | no | — | yes | yes | no | yes | free (owner) | 2026-01-01 | — |'))
  assert.ok(matrix.includes('| beta | wire-a | b1, b2 | yes | low, high | yes | no | yes | no | pay-per-token (catalog) | 2026-03-02 | — |'))
})

test('renderMatrix: stale column shows "<n>d" for a stale provider', () => {
  const specs = {
    protocols: [protocol('wire-a')],
    providers: [provider('alpha', { verifiedAt: '2026-01-01' })], // 90d, fresh
    pricing: [pricing('alpha')],
  }
  assert.match(renderMatrix(specs, { now: NOW }), /\| 2026-01-01 \| — \|$/m)

  specs.providers = [provider('alpha', { verifiedAt: '2025-12-01' })] // 121d
  assert.match(renderMatrix(specs, { now: NOW }), /\| 2025-12-01 \| 121d \|$/m)
})

test('renderMatrix: a provider without ttlDays uses the 90d default for the Stale column', () => {
  const specs = {
    protocols: [protocol('wire-a')],
    providers: [provider('alpha', { verifiedAt: '2025-01-01', ttlDays: undefined })], // 455d > 90
    pricing: [pricing('alpha')],
  }
  assert.match(renderMatrix(specs, { now: NOW }), /\| 2025-01-01 \| 455d \|$/m)
})

test('renderMatrix: Stale agrees with the gate — stale PRICING marks the row', () => {
  const specs = {
    protocols: [protocol('wire-a')],
    providers: [provider('alpha', { verifiedAt: '2026-03-30' })], // 2d, fresh
    pricing: [{ provider: 'alpha', kind: 'live-catalog', source: 'https://c', verifiedAt: '2026-03-20', ttlDays: 7 }], // 12d > 7
  }
  const result = checkFreshness(specs, NOW)
  assert.equal(result.errors.length, 1, 'the gate fails this row')
  assert.match(renderMatrix(specs, { now: NOW }), /\| 2026-03-30 \| 12d \|$/m)
})

test('renderMatrix: deterministic for the same input', () => {
  const { specs } = fixture()
  assert.equal(renderMatrix(specs, { now: NOW }), renderMatrix(specs, { now: NOW }))
})

// ------------------------------------------------------------------ CLI

function run(script, args) {
  return spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' })
}

test('CLI verify-specs: clean fixture exits 0', () => {
  const { root } = fixture()
  const result = run(VERIFY, ['--root', root, '--now', NOW])
  assert.equal(result.status, 0, result.stderr)
  assert.match(result.stdout, /2 protocols, 1 providers, 1 pricing — OK/)
})

test('CLI verify-specs: hard errors exit 1, and --warn downgrades to 0', () => {
  const { root } = fixture({ providers: [provider('alpha', { protocol: 'wire-gone' })] })
  const failing = run(VERIFY, ['--root', root, '--now', NOW])
  assert.equal(failing.status, 1)
  assert.match(failing.stdout, /error: .*wire-gone/)

  const warned = run(VERIFY, ['--root', root, '--now', NOW, '--warn'])
  assert.equal(warned.status, 0)
})

test('CLI verify-specs: stale data exits 1, --warn keeps it report-only', () => {
  const { root } = fixture({ providers: [provider('alpha')], pricing: [pricing('alpha', { verifiedAt: '2026-01-01' })] })
  assert.equal(run(VERIFY, ['--root', root, '--now', NOW]).status, 1)
  assert.equal(run(VERIFY, ['--root', root, '--now', NOW, '--warn']).status, 0)
})

test('CLI verify-specs: --json emits the documented shape', () => {
  const { root } = fixture({ pricing: [pricing('alpha', { verifiedAt: '2026-01-01' })] })
  const result = run(VERIFY, ['--root', root, '--now', NOW, '--json'])
  assert.equal(result.status, 1)
  const parsed = JSON.parse(result.stdout)
  assert.deepEqual(Object.keys(parsed).sort(), ['errors', 'files', 'now', 'ok', 'stale', 'warnings', 'watch'])
  assert.equal(parsed.ok, false)
  assert.equal(parsed.now, NOW)
  assert.equal(parsed.stale.length, 1)
  assert.ok(parsed.files.pricing.includes('specs/pricing/alpha.json'))
})

test('CLI verify-specs: --strict-watch fails a stale baseline; the default only warns', () => {
  const { root } = fixture()
  writeLock(root, { generatedAt: '2026-01-01T00:00:00.000Z' })

  const soft = run(VERIFY, ['--root', root, '--now', NOW])
  assert.equal(soft.status, 0, soft.stderr)
  assert.match(soft.stdout, /warn: .*run npm run spec:watch/)
  assert.match(soft.stdout, /watch: .*STALE/)

  const strict = run(VERIFY, ['--root', root, '--now', NOW, '--strict-watch'])
  assert.equal(strict.status, 1)
  assert.match(strict.stdout, /error: .*run npm run spec:watch/)

  const relaxed = run(VERIFY, ['--root', root, '--now', NOW, '--strict-watch', '--watch-max-age', '365'])
  assert.equal(relaxed.status, 0, relaxed.stderr)
})

test('CLI verify-specs: --watch-max-age rejects a non-integer', () => {
  assert.equal(run(VERIFY, ['--watch-max-age', 'soon']).status, 2)
  assert.equal(run(VERIFY, ['--watch-max-age']).status, 2)
})

test('CLI verify-specs: missing specs tree exits 2', () => {
  const root = tempRoot()
  const result = run(VERIFY, ['--root', root, '--now', NOW])
  assert.equal(result.status, 2)
  assert.match(result.stderr, /missing directory/)
})

test('CLI verify-specs: bad usage exits 2', () => {
  assert.equal(run(VERIFY, ['--now', 'April 1']).status, 2)
  assert.equal(run(VERIFY, ['--root']).status, 2)
})

test('CLI build-spec-matrix: writes, then --check passes, then detects drift', () => {
  const { root } = fixture()
  const out = join(root, 'docs', 'COMPATIBILITY-MATRIX.md')

  const written = run(BUILD, ['--root', root, '--out', out, '--now', NOW])
  assert.equal(written.status, 0, written.stderr)
  assert.ok(existsSync(out))
  const first = readFileSync(out, 'utf8')
  assert.ok(first.startsWith('<!-- skeleton:\nversion: 1.0\nkind: measurement\nstatus: active\n'), first.slice(0, 120))

  const current = run(BUILD, ['--root', root, '--out', out, '--now', NOW, '--check'])
  assert.equal(current.status, 0, current.stderr)

  writeFileSync(out, `${first}\n| drifted | row |`)
  const drifted = run(BUILD, ['--root', root, '--out', out, '--now', NOW, '--check'])
  assert.equal(drifted.status, 1)
  assert.match(drifted.stderr, /out of date — run npm run specs:build/)

  const missing = run(BUILD, ['--root', root, '--out', join(root, 'docs', 'nope.md'), '--now', NOW, '--check'])
  assert.equal(missing.status, 1)
  assert.match(missing.stderr, /missing .* run npm run specs:build/)
})

test('CLI build-spec-matrix: --check without --out targets docs/COMPATIBILITY-MATRIX.md', () => {
  const { root } = fixture()
  assert.equal(run(BUILD, ['--root', root, '--now', NOW]).status, 0)
  assert.ok(existsSync(join(root, 'docs', 'COMPATIBILITY-MATRIX.md')))
  assert.equal(run(BUILD, ['--root', root, '--now', NOW, '--check']).status, 0)
})

// --------------------------------------------------- spec ↔ preset mirror
// MEASURED GAP (2026-11-14): mutating `specs/providers/deepinfra.json` to a
// wrong endpoint, protocol or model exited 0. The specs layer is a second
// registry; these tests are the proof that it can no longer contradict the
// runtime declaration silently.

/** One preset + the matching spec triple, as the mirror sees them. */
function mirrorFixture(presetExtra = {}, specExtra = {}, pricingExtra = {}) {
  const preset = {
    id: 'alpha',
    endpoint: { mode: 'http', protocol: 'wire-a', baseUrl: 'https://api.example.test/v1' },
    usage: { billing: { mode: 'pay-per-token' } },
    catalog: { layers: [{ source: 'override', models: [{ id: 'alpha-model' }] }] },
    ...presetExtra,
  }
  const specs = {
    providers: [{ file: 'alpha.json', value: provider('alpha', { protocol: 'wire-a', endpoint: 'https://api.example.test/v1', models: ['alpha-model'], ...specExtra }) }],
    pricing: [{ file: 'alpha.json', value: pricing('alpha', { kind: 'live-catalog', ...pricingExtra }) }],
  }
  return { preset, specs }
}

test('checkPresetMirror: a matching spec passes', () => {
  const { preset, specs } = mirrorFixture()
  const verdict = checkPresetMirror(specs, { presets: [preset] })
  assert.deepEqual(verdict.errors, [])
})

test('checkPresetMirror: a wrong endpoint is a hard error (measured gap)', () => {
  const { preset, specs } = mirrorFixture({}, { endpoint: 'https://api.example.test/v9' })
  const errors = checkPresetMirror(specs, { presets: [preset] }).errors
  assert.ok(errors.some((error) => /names endpoint .* but the preset serves/.test(error)), errors.join('\n'))
})

test('checkPresetMirror: a wrong protocol is a hard error (measured gap)', () => {
  const { preset, specs } = mirrorFixture({}, { protocol: 'wire-b' })
  const errors = checkPresetMirror(specs, { presets: [preset] }).errors
  assert.ok(errors.some((error) => /names protocol "wire-b" but the preset speaks "wire-a"/.test(error)), errors.join('\n'))
})

test('checkPresetMirror: a wrong model id is a hard error (measured gap)', () => {
  const { preset, specs } = mirrorFixture({}, { models: ['alpha-model-v9'] })
  const errors = checkPresetMirror(specs, { presets: [preset] }).errors
  assert.match(errors.join('\n'), /does not list it/)
  assert.match(errors.join('\n'), /the preset does not declare/)
})

test('checkPresetMirror: a pricing kind that contradicts the billing mode is a hard error', () => {
  // `free` → `none`, while the preset declares `pay-per-token`.
  const { preset, specs } = mirrorFixture({}, {}, { kind: 'free' })
  const errors = checkPresetMirror(specs, { presets: [preset] }).errors
  assert.ok(errors.some((error) => /kind "free" maps to billing "none" but the preset declares usage\.billing\.mode "pay-per-token"/.test(error)), errors.join('\n'))
})

test('checkPresetMirror: a missing provider spec is a hard error', () => {
  const { preset, specs } = mirrorFixture()
  specs.providers = []
  const errors = checkPresetMirror(specs, { presets: [preset] }).errors
  assert.match(errors.join('\n'), /no specs\/providers\/alpha\.json/)
})

test('checkPresetMirror: a daemon preset has no base URL to compare', () => {
  const { preset, specs } = mirrorFixture(
    { endpoint: { mode: 'daemon', protocol: 'wire-a', baseUrl: '' } },
    { endpoint: 'daemon (resolved at runtime)' },
  )
  const verdict = checkPresetMirror(specs, { presets: [preset] })
  assert.deepEqual(verdict.errors, [], 'a daemon base URL is resolved at runtime, never mirrored')
})

test('checkPresetMirror: the kind→billing table covers exactly the measured vocabulary', () => {
  assert.deepEqual({ ...PRICING_KIND_TO_BILLING_MODE }, {
    subscription: 'subscription',
    flat: 'flat',
    'live-catalog': 'pay-per-token',
    free: 'none',
    none: 'none',
  })
})

test('checkPresetMirror: no presets means no mirror check, never a crash', () => {
  assert.deepEqual(checkPresetMirror({ providers: [], pricing: [] }, { presets: [] }), { errors: [], warnings: [] })
  assert.deepEqual(checkPresetMirror({ providers: [], pricing: [] }), { errors: [], warnings: [] })
})
