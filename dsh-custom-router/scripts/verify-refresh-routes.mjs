#!/usr/bin/env node
/**
 * Live route check for the model-serving refresh contract — ISOLATED.
 *
 * WHY THIS EXISTS
 *   The `?refresh=1` bypass shipped with unit tests that used stub catalogs, so
 *   "the cache is dropped" was proven only against a fixture. The owner asked for
 *   a live measurement, and a fixture cannot prove that a REAL vendor route (a
 *   network fetch, a daemon probe, a durable cache file) actually re-reads.
 *
 * WHAT IT DOES
 *   Boots the real `web` profile into a throwaway `DSH_HOME` (through `iso-home.mjs`,
 *   the same helper `verify-mount.mjs` uses, so the live home is never touched),
 *   mounts the router body, then calls each vendor's model route twice through the
 *   host's own route table:
 *
 *     plain POST          -> answered from the vendor's cache (no invalidation)
 *     POST ?refresh=1     -> must drop the cache before reading
 *
 *   A route that is mounted is not a route that works (F-45), so this calls the
 *   real handler and inspects the real `Response`.
 *
 * WHAT IS ASSERTED PER ROUTE (the table lives in `refresh-expectations.mjs`)
 *   - the route is registered at its documented path — all FOUR presets, so an
 *     absent route is a failure, not a skip: these are the serving path now
 *   - both calls answer 200 with JSON
 *   - the payload keeps the preset's expected model rows on BOTH reads: a Claude
 *     and a Gemini base row (plus the Hydrogen lane) for Antigravity, a served
 *     row for OpenCode and DeepInfra, and `k-exaone_v2.5` for EXAONE
 *
 * Exit codes: 0 every expectation held, 1 an expected route fact is missing, 2 the harness could
 * not run.
 *
 * Usage: node scripts/verify-refresh-routes.mjs [--keep] [--profile-dir <dir>]
 *
 * @module @nolit/dsh-custom-router/scripts/verify-refresh-routes
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { ROUTES, evaluateRefresh } from './refresh-expectations.mjs'
import { buildIsolatedHome, dshRoot } from './iso-home.mjs'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 || index + 1 >= argv.length ? fallback : argv[index + 1]
}
const KEEP = argv.includes('--keep')
const PROFILE_DIR = flag('--profile-dir', undefined)
const LOG_DIR = resolve(PACKAGE_ROOT, '..', '.runtime-measure', 'custom-router-refresh')
const LOG_PATH = join(LOG_DIR, 'routes.log')

const fail = (message) => {
  process.stderr.write(`verify-refresh-routes: ${message}\n`)
  process.exit(2)
}

/**
 * The routes this gate speaks to live in `refresh-expectations.mjs` (pure, unit
 * tested): the four presets, and the model rows each one must keep serving. A
 * route that disappears or stops listing its expected row fails this gate —
 * "registered" and "mounted" are not "still serving the right route".
 */
// ---------------------------------------------------------------------------
// 1. Isolated home (the live `~/.dsh` is never opened for writing)
// ---------------------------------------------------------------------------
let isolated
try {
  isolated = buildIsolatedHome(PROFILE_DIR === undefined ? {} : { profileDir: PROFILE_DIR })
} catch (error) {
  fail(`could not build the isolated home: ${error instanceof Error ? error.message : String(error)}`)
}
const { home, profileOut, vendorConfig } = isolated
process.env.DSH_HOME = home
process.env.TOKENECONOMIZER_HOME = join(home, 'tk-home')

mkdirSync(LOG_DIR, { recursive: true })
writeFileSync(LOG_PATH, '')

// ---------------------------------------------------------------------------
// 2. Boot the real profile and mount the router body
// ---------------------------------------------------------------------------
const ROOT = (() => {
  try {
    return dshRoot()
  } catch (error) {
    fail(`could not resolve the dsh installation: ${error instanceof Error ? error.message : String(error)}`)
  }
})()
const hostRequire = createRequire(join(ROOT, 'package.json'))

const bootLog = []
let ctx
let shutdown
try {
  const { loadLayeredEnv } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-app-boot')).href)
  const { runProfile } = await import(pathToFileURL(join(ROOT, 'lib', 'profile-boot.js')).href)
  const stderrWrite = process.stderr.write.bind(process.stderr)
  process.stderr.write = (chunk, ...rest) => {
    bootLog.push(String(chunk))
    return true
  }
  try {
    const environment = loadLayeredEnv('dsh')
    ;({ ctx, shutdown } = await runProfile({
      environment,
      profile: 'web',
      patchFiles: [],
      args: ['--no-open', '--port', '0', '--host', '127.0.0.1'],
    }))
  } finally {
    process.stderr.write = stderrWrite
  }
} catch (error) {
  writeFileSync(LOG_PATH, bootLog.join(''))
  if (!KEEP) isolated.dispose()
  fail(`could not boot the isolated profile: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
}

let mountError
try {
  const plugin = await import(pathToFileURL(join(PACKAGE_ROOT, 'lib', 'index.js')).href)
  await ctx.plugin(plugin, {
    strict: true,
    profileDir: profileOut,
    presets: { antigravity: true, deepinfra: true, opencode: true, exaone: true },
    vendorConfig,
  })
} catch (error) {
  mountError = error
}

const out = []
const line = (text = '') => {
  out.push(text)
  process.stdout.write(text + '\n')
}

line(`[home] ${home}`)
line(`[mount] ${mountError === undefined ? 'ok' : `FAILED: ${mountError instanceof Error ? mountError.message : String(mountError)}`}`)

// The route table the host actually composed. Reading it — rather than trusting
// the plugin's own claim — is what F-45 demands: a registered route is not a
// working route, and an unregistered one is not mounted at all.
const connection = ctx.get('connection')
const fetchRoutes = connection?.fetchRoutes
if (!(fetchRoutes instanceof Map)) {
  writeFileSync(LOG_PATH, bootLog.join(''))
  if (!KEEP) isolated.dispose()
  fail('the host connection exposes no fetchRoutes map; the route table cannot be measured')
}
line(`[routes] registered: ${[...fetchRoutes.keys()].filter((path) => path.startsWith('/api/local/')).join(', ') || '(none)'}`)

// ---------------------------------------------------------------------------
// 3. Call each route: plain, then forced
// ---------------------------------------------------------------------------
const call = async (path, force) => {
  const route = fetchRoutes.get(path)
  if (route === undefined) return { skipped: true }
  const url = 'http://127.0.0.1' + path + (force ? '?refresh=1' : '')
  const started = Date.now()
  const response = await route.fetch(new Request(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{}',
  }))
  const text = await response.text()
  let body
  try {
    body = JSON.parse(text)
  } catch {
    body = undefined
  }
  return { status: response.status, body, text, ms: Date.now() - started }
}

// Read every route first (plain, then forced), then judge the reads as data.
const reads = []
for (const spec of ROUTES) {
  const plain = await call(spec.path, false)
  const forced = plain.skipped === true ? { skipped: true } : await call(spec.path, true)
  reads.push({ preset: spec.preset, plain, forced })
}

const verdict = evaluateRefresh(reads)
let failures = verdict.failures.length
const readByPreset = new Map(reads.map((read) => [read.preset, read]))
line('')
for (const [index, result] of verdict.results.entries()) {
  const spec = ROUTES[index]
  const forced = readByPreset.get(result.preset)?.forced
  if (!result.present) {
    // The verdict owns the reason: "not mounted" and "never read" are
    // different regressions and the log must say which one happened.
    line(`[${result.preset}] FAIL — ${result.failures[0] ?? `route ${result.path} did not answer`}`)
    continue
  }
  line(`[${result.preset}] ${result.ok ? 'PASS' : 'FAIL'} ${result.path}`)
  line(`   plain  : HTTP ${result.plain.status} rows=${result.plain.rows} (${result.plain.ms}ms)`)
  line(`   forced : HTTP ${result.forced.status} rows=${result.forced.rows} (${result.forced.ms}ms)`)
  for (const check of result.checks) {
    // The two reads are reported separately: a lane that is served from the
    // cache but gone after the forced re-read is a stale cache, and the
    // message says which read lost it.
    line(`   ${check.ok ? 'ok  ' : 'MISS'}  ${check.label} (plain: ${check.plain ? 'yes' : 'no'} / forced: ${check.forced ? 'yes' : 'no'})`)
  }
  if (forced.body !== undefined && result.forced.rows === 0) {
    const note = forced.body?.error ?? forced.body?.err ?? forced.body?.catalogError ?? forced.body?.discoveryError
    line(`   forced payload carries no rows${note === undefined ? '' : ' — reported: ' + String(note).slice(0, 120)}`)
  }
  if (forced.body?.models === undefined && forced.body?.groups === undefined) {
    line(`   forced payload keys: ${Object.keys(forced.body ?? {}).join(', ')}`)
  }
  // Name the grouped base rows: a catalog that answered but omitted a lane would
  // still be "200 with rows", so the gate reports WHAT it read, not just how many.
  if (Array.isArray(forced.body?.models) && spec.preset === 'opencode') {
    const plans = {}
    for (const model of forced.body.models) {
      const plan = String(model?.plan ?? 'unknown')
      plans[plan] = (plans[plan] ?? 0) + 1
    }
    line(`   activePlan: ${forced.body.activePlan ?? '(none)'} | rows by plan: ${JSON.stringify(plans)} | otherPlanCount: ${forced.body.otherPlanCount ?? '(none)'}`)
    line(`   hydrogen in this plan's rows: ${forced.body.models.some((model) => /hydrogen/.test(String(model?.route ?? model?.id ?? '')))}`)
  }
  if (Array.isArray(forced.body?.models) && spec.preset === 'deepinfra') {
    const withPromo = forced.body.models.filter((model) => model?.promotion !== null && typeof model?.promotion === 'object').length
    const nullPromo = forced.body.models.filter((model) => model?.promotion === null || model?.promotion === undefined).length
    line(`   promotion: ${withPromo} discounted, ${nullPromo} at list price (of ${forced.body.models.length})`)
    line(`   response carries a promotion count: ${forced.body.promotionCount ?? '(none)'}`)
  }
  if (Array.isArray(forced.body?.models) && spec.preset === 'exaone') {
    line(`   models: ${forced.body.models.map((model) => String(model?.id)).join(', ')}`)
  }
  if (Array.isArray(forced.body?.groups)) {
    const bases = forced.body.groups.flatMap((group) => (Array.isArray(group?.models) ? group.models.map((model) => model.id) : []))
    line(`   bases  : ${bases.join(', ')}`)
    line(`   hydrogen present: ${bases.some((id) => /hydrogen/.test(String(id)))}`)
  }
}

line('')
line(`[expected] preset routes present: ${verdict.present}/${verdict.expected}`)
for (const failure of verdict.failures) line(`   MISSING ${failure}`)

writeFileSync(LOG_PATH, bootLog.join(''))
line('')
line(`[log] ${LOG_PATH}`)

try {
  shutdown?.()
} catch {
  /* the process is exiting */
}
if (!KEEP) isolated.dispose()

if (failures > 0) {
  line(`\nFAIL — ${failures} expected route fact(s) missing`)
  process.exit(1)
}
line('\nPASS — all four preset routes answered and kept their expected model rows')
process.exit(0)
