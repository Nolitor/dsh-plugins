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
 * WHAT IS ASSERTED PER ROUTE
 *   - the route is registered at its documented path
 *   - both calls answer 200 with JSON
 *   - the forced call's payload is a real catalog (non-empty rows, or a documented
 *     empty-with-error state that is reported rather than hidden)
 *
 * Exit codes: 0 every mounted route answered, 1 a route failed, 2 the harness could
 * not run. A vendor whose route is absent (its row did not mount) is reported as
 * SKIP and does not fail the gate — a missing optional surface is data.
 *
 * Usage: node scripts/verify-refresh-routes.mjs [--keep] [--profile-dir <dir>]
 *
 * @module @nolit/dsh-custom-router/scripts/verify-refresh-routes
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

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
 * The routes this gate speaks to, and how to read a row count out of each answer.
 *
 * A route is listed with the payload field that proves it carries a CATALOG, not
 * an error object: `models` for the flat routes, `groups` for Antigravity (whose
 * rows are grouped by usage family).
 */
const ROUTES = Object.freeze([
  { preset: 'antigravity', path: '/api/local/dsh-antigravity/models', rows: (body) => (Array.isArray(body?.groups) ? body.groups.reduce((sum, group) => sum + (Array.isArray(group?.models) ? group.models.length : 0), 0) : 0) },
  { preset: 'opencode', path: '/api/local/opencode-v2/model-settings', rows: (body) => (Array.isArray(body?.models) ? body.models.length : 0) },
  { preset: 'deepinfra', path: '/api/local/deepinfra/models', rows: (body) => (Array.isArray(body?.models) ? body.models.length : 0) },
])

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
    presets: { antigravity: true, deepinfra: true, opencode: true },
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

let failures = 0
line('')
for (const spec of ROUTES) {
  const plain = await call(spec.path, false)
  if (plain.skipped === true) {
    line(`[${spec.preset}] SKIP — route not mounted (${spec.path})`)
    continue
  }
  const forced = await call(spec.path, true)
  const plainRows = plain.body === undefined ? -1 : spec.rows(plain.body)
  const forcedRows = forced.body === undefined ? -1 : spec.rows(forced.body)
  const ok = plain.status === 200 && forced.status === 200 && plain.body !== undefined && forced.body !== undefined
  if (!ok) failures += 1
  line(`[${spec.preset}] ${ok ? 'PASS' : 'FAIL'} ${spec.path}`)
  line(`   plain  : HTTP ${plain.status} rows=${plainRows} (${plain.ms}ms)`)
  line(`   forced : HTTP ${forced.status} rows=${forcedRows} (${forced.ms}ms)`)
  // The forced answer must be a catalog, not an error object dressed as one.
  if (forced.body !== undefined && forcedRows === 0) {
    const note = forced.body?.error ?? forced.body?.err ?? forced.body?.catalogError ?? forced.body?.discoveryError
    line(`   forced payload carries no rows${note === undefined ? '' : ' — reported: ' + String(note).slice(0, 120)}`)
  }
  if (forced.body?.models === undefined && forced.body?.groups === undefined) {
    line(`   forced payload keys: ${Object.keys(forced.body ?? {}).join(', ')}`)
  }
  // Name the grouped base rows: a catalog that answered but omitted Hydrogen would
  // still be "200 with rows", so the gate reports WHAT it read, not just how many.
  // DeepInfra publishes a per-row `promotion`; a row with none MUST NOT read as
  // a 0% discount (the client bug fixed on 2026-11-13). Count both sides here so
  // a live regression is visible without opening the browser.
  // OpenCode serves ONE plan per tab. A Hydrogen route exists on the Zen plan,
  // so a Go-scoped answer legitimately omits it; report the plan split rather
  // than letting "no hydrogen" read as a catalog defect.
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
  if (Array.isArray(forced.body?.groups)) {
    const bases = forced.body.groups.flatMap((group) => (Array.isArray(group?.models) ? group.models.map((model) => model.id) : []))
    line(`   bases  : ${bases.join(', ')}`)
    line(`   hydrogen present: ${bases.some((id) => /hydrogen/.test(String(id)))}`)
  }
}

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
  line(`\nFAIL — ${failures} route(s) did not answer`)
  process.exit(1)
}
line('\nPASS — every mounted model route answered a plain and a forced read')
process.exit(0)
