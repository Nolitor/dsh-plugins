#!/usr/bin/env node
/**
 * Custom-router E2E mount gate — the committed, repeatable acceptance check.
 *
 * Boots a REAL DSH web profile in an isolated `DSH_HOME`, mounts the router
 * body into it, and compares what the host actually registered against the
 * measured baseline of the live profile. The point is the seam, not the exit
 * code: a router that "mounts" but registers nothing must fail here.
 *
 * Flow:
 *   1. `buildIsolatedHome()` (see `iso-home.mjs`) copies the live profile into a
 *      `mkdtemp` home, re-roots every absolute path, drops the vendor bundles and
 *      the four vendor patch rows, and returns their configs;
 *   2. boot through the host's own public entry — `<dshRoot>/lib/profile-boot.js`
 *      `runProfile()` — with the environment snapshot `loadLayeredEnv()` builds.
 *      A plain `Map` is NOT a valid snapshot: `launchedThroughSsh()` calls
 *      `environment.getFrom(...)`, so two rows abort with
 *      `TypeError: environment.getFrom is not a function` (measured);
 *   3. mount `dsh-custom-router/lib/index.js` by absolute file URL (the script
 *      lives outside the profile's dependency tree, so a bare specifier cannot
 *      resolve it);
 *   4. poll for the baseline set, up to `SETTLE_TIMEOUT_MS`, and record how long
 *      it took to settle;
 *   5. print `profileContext` (name / dir / installAnchor) — proof the boot ran
 *      against the TEMP home, not the live one;
 *   6. print a parity table per registry with `missing` and `extra` against
 *      `.runtime-measure/custom-router-e2e/baseline-web.json`;
 *   7. exercise the seam: `route()`, `probe()` for every preset (informational,
 *      capped), a synthetic 3-layer `merge()`, and `bindUsage()` — which is NOT
 *      on the seam (measured) and must be imported from `lib/usage.js`;
 *   8. capture the boot's stderr into `.runtime-measure/custom-router-e2e/mount.log`.
 *
 * Exit codes: 0 exact parity, 1 parity drift, 2 the harness could not run.
 *
 * Usage:
 *   node scripts/verify-mount.mjs [--keep] [--baseline <file>] [--profile-dir <dir>]
 *
 * `--keep` leaves the temp home on disk for inspection (it prints the path).
 *
 * @module @nolit/dsh-custom-router/scripts/verify-mount
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { VENDOR_BUNDLES, VENDOR_ROWS, buildIsolatedHome, dshRoot } from './iso-home.mjs'

/** Bundle that would make the profile mount the router from config instead of this gate. */
const ROUTER_BUNDLE = '@nolit/dsh-custom-router'

/** Repository root, resolved from this file (scripts/ → package → repo). */
const REPO_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..')
/** Package root (`dsh-custom-router/`). */
const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const DEFAULT_BASELINE = join(REPO_ROOT, '.runtime-measure', 'custom-router-e2e', 'baseline-web.json')
const LOG_DIR = join(REPO_ROOT, '.runtime-measure', 'custom-router-e2e')
const LOG_PATH = join(LOG_DIR, 'mount.log')

/** Registries compared against the baseline. */
const REGISTRIES = Object.freeze([
  ['providers', (ctx) => ctx.get('llm').listProviders().map((provider) => provider.id)],
  ['tools', (ctx) => ctx.get('tools').definitions().map((tool) => tool.name)],
  ['commands', (ctx) => ctx.get('commands').list().map((command) => command.name)],
])

/** Per-preset probe budget; a probe that overruns is reported, not fatal. */
const PROBE_TIMEOUT_MS = 8000
/** How long the registries may take to reach the baseline before we call it. */
const SETTLE_TIMEOUT_MS = 15000

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 || index + 1 >= argv.length ? fallback : argv[index + 1]
}
const KEEP = argv.includes('--keep')
const BASELINE_PATH = resolve(flag('--baseline', DEFAULT_BASELINE))
const PROFILE_DIR = flag('--profile-dir', undefined)

/** Report a harness-level failure (exit 2) with the real error text. */
const fail = (message) => {
  process.stderr.write(`verify-mount: ${message}\n`)
  process.exit(2)
}

if (!existsSync(BASELINE_PATH)) {
  fail(`baseline not found: ${BASELINE_PATH} (run the live probe first; this gate compares against it)`)
}
const BASELINE = JSON.parse(readFileSync(BASELINE_PATH, 'utf8'))
for (const [key] of REGISTRIES) {
  if (!Array.isArray(BASELINE[key])) fail(`baseline ${BASELINE_PATH} has no "${key}" array`)
}

// ---------------------------------------------------------------------------
// 1. Isolated home
// ---------------------------------------------------------------------------
let isolated
try {
  isolated = buildIsolatedHome(PROFILE_DIR === undefined ? {} : { profileDir: PROFILE_DIR })
} catch (error) {
  fail(`could not build the isolated home: ${error instanceof Error ? error.message : String(error)}`)
}
const { home, profileOut, vendorConfig, missingRows, droppedBundles, removedRowIds, keptRowIds } = isolated
process.env.DSH_HOME = home
process.env.TOKENECONOMIZER_HOME = join(home, 'tk-home')

// ---------------------------------------------------------------------------
// 1b. Prove the rewrite actually happened — BEFORE booting.
//
// This gate's whole claim is "the router mounted these vendors". That claim is
// only distinguishable from "the profile mounted the vendor bundles at boot" if
// the copied profile provably no longer carries them. So re-read the copied
// files from disk (not the in-memory builder result) and fail fast.
// ---------------------------------------------------------------------------
const YAML = (() => {
  try {
    return createRequire(join(dshRoot(), 'package.json'))('yaml')
  } catch (error) {
    fail(`could not load the host's yaml: ${error instanceof Error ? error.message : String(error)}`)
  }
})()

const isolationErrors = []

// (1) Bundles: the vendor bundles are gone and the router bundle is not the thing
//     that mounted them (it must be absent — this gate mounts the body directly).
const copiedPkg = JSON.parse(readFileSync(join(profileOut, 'package.json'), 'utf8'))
const copiedBundles = copiedPkg?.dsh?.profile?.bundles
if (!Array.isArray(copiedBundles)) {
  isolationErrors.push(`copied package.json has no dsh.profile.bundles array (${join(profileOut, 'package.json')})`)
} else {
  for (const name of VENDOR_BUNDLES) {
    if (copiedBundles.includes(name)) isolationErrors.push(`vendor bundle still in the copied package.json: ${name}`)
  }
  if (copiedBundles.includes(ROUTER_BUNDLE)) {
    // Not a bug to fix silently: it would mean the profile, not this script,
    // mounted the router, and the parity below would prove nothing.
    isolationErrors.push(`copied package.json still lists ${ROUTER_BUNDLE}; this gate mounts the router body itself, so a profile-level row would make the result unattributable`)
  }
}

// (2) Patch rows: none of the four vendor ids survive, including the one this
//     script dropped second-hand, and the removal was not a silent no-op.
let copiedRows = []
try {
  copiedRows = YAML.parse(readFileSync(join(profileOut, 'cordis.patch.yml'), 'utf8'))
} catch (error) {
  isolationErrors.push(`copied cordis.patch.yml does not parse: ${error instanceof Error ? error.message : String(error)}`)
}
if (!Array.isArray(copiedRows)) {
  isolationErrors.push(`copied cordis.patch.yml is not a YAML row array (got ${typeof copiedRows})`)
} else {
  const survivingIds = copiedRows.filter((row) => row !== null && typeof row === 'object').map((row) => row.id)
  for (const id of VENDOR_ROWS) {
    if (survivingIds.includes(id)) isolationErrors.push(`vendor patch row still present in the copied patch: ${id}`)
  }
  // A no-op drop must be visible: every row the live patch had must be accounted
  // for as either removed or kept.
  if (removedRowIds.length === 0) {
    isolationErrors.push(`no vendor patch row was removed from the copied patch (expected some of: ${VENDOR_ROWS.join(', ')}) — the drop was a silent no-op`)
  }
  for (const id of removedRowIds) {
    if (!VENDOR_ROWS.includes(id)) isolationErrors.push(`removed a row that is not a declared vendor row: ${id}`)
  }
  const removedButStillPresent = removedRowIds.filter((id) => survivingIds.includes(id))
  if (removedButStillPresent.length > 0) {
    isolationErrors.push(`rows reported as removed are still in the file: ${removedButStillPresent.join(', ')}`)
  }
}

if (isolated.missingRows.length === 0 && removedRowIds.length !== VENDOR_ROWS.length) {
  isolationErrors.push(`expected all ${VENDOR_ROWS.length} vendor rows in the live patch, removed ${removedRowIds.length} (${removedRowIds.join(', ') || 'none'})`)
}

if (isolationErrors.length > 0) {
  mkdirSync(LOG_DIR, { recursive: true })
  writeFileSync(LOG_PATH, '')
  if (!KEEP) isolated.dispose()
  fail(`the isolated home is not vendor-free — refusing to attribute anything to the router:\n  - ${isolationErrors.join('\n  - ')}`)
}

mkdirSync(LOG_DIR, { recursive: true })
writeFileSync(LOG_PATH, '')

// ---------------------------------------------------------------------------
// 2. Boot through the host's public entry
// ---------------------------------------------------------------------------
const ROOT = (() => {
  try {
    return dshRoot()
  } catch (error) {
    fail(`could not resolve the dsh installation: ${error instanceof Error ? error.message : String(error)}`)
  }
})()

/** Resolve a host package through the installation (the boot's own dependency tree). */
const hostRequire = createRequire(join(ROOT, 'package.json'))

const bootLog = []
let ctx
let shutdown
try {
  const { loadLayeredEnv } = await import(pathToFileURL(hostRequire.resolve('@deepseek-ai/dsh-app-boot')).href)
  const { runProfile } = await import(pathToFileURL(join(ROOT, 'lib', 'profile-boot.js')).href)

  // Capture the boot's stderr: it carries the "did not activate" diagnostics.
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
  mkdirSync(LOG_DIR, { recursive: true })
  writeFileSync(LOG_PATH, bootLog.join(''))
  if (!KEEP) isolated.dispose()
  fail(`could not boot the isolated profile: ${error instanceof Error ? error.stack ?? error.message : String(error)}`)
}

// ---------------------------------------------------------------------------
// 3. Mount the router body by absolute file URL
// ---------------------------------------------------------------------------
const snapshot = () => Object.fromEntries(REGISTRIES.map(([key, read]) => [key, [...read(ctx)].sort()]))

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

// ---------------------------------------------------------------------------
// 4. Poll until the baseline set appears (or the budget runs out)
// ---------------------------------------------------------------------------
const startedAt = Date.now()
let after = snapshot()
const reached = () => REGISTRIES.every(([key]) => BASELINE[key].every((name) => after[key].includes(name)))
while (!reached() && Date.now() - startedAt < SETTLE_TIMEOUT_MS) {
  await new Promise((resume) => setTimeout(resume, 200))
  after = snapshot()
}
const settledMs = Date.now() - startedAt

// ---------------------------------------------------------------------------
// 5–6. Context + parity report
// ---------------------------------------------------------------------------
const out = []
const line = (text = '') => out.push(text)

const profileContext = ctx.get('profileContext')
line('[profileContext]')
line(`  name          = ${profileContext?.name}`)
line(`  dir           = ${profileContext?.dir}`)
line(`  installAnchor = ${profileContext?.installAnchor}`)
line(`  home          = ${profileContext?.home}`)
line(`  isolated      = ${profileContext?.home === home ? 'yes (temp home)' : `NO — expected ${home}`}`)

if (missingRows.length > 0) {
  line(`\n[vendorConfig] rows absent from the live patch: ${missingRows.join(', ')}`)
}
line(`[vendorConfig] keys: ${Object.keys(vendorConfig).join(', ') || '(none)'}`)
// (4) Attribution record: which rows this gate removed, so a silent no-op is visible.
line(`[isolation] bundles dropped (${droppedBundles.length}/${VENDOR_BUNDLES.length}): ${droppedBundles.join(', ') || '(none)'}`)
line(`[isolation] patch rows removed (${removedRowIds.length}/${VENDOR_ROWS.length}): ${removedRowIds.join(', ') || '(none)'}`)
line(`[isolation] vendor ids surviving in the copied profile: none (asserted before boot)`)
line(`[isolation] vendor entries in the copied patch after the drop: 0 of ${keptRowIds.length + removedRowIds.length} live rows kept ${keptRowIds.length}`)
line(`[mount] ${mountError === undefined ? 'ok' : `FAILED: ${mountError instanceof Error ? mountError.message : String(mountError)}`}`)
line(`[settle] ${settledMs}ms ${settledMs >= SETTLE_TIMEOUT_MS && !reached() ? `(TIMEOUT after ${SETTLE_TIMEOUT_MS}ms)` : ''}`.trimEnd())

let drift = 0
for (const [key, read] of REGISTRIES) {
  const expected = [...BASELINE[key]].sort()
  const got = after[key]
  const missing = expected.filter((name) => !got.includes(name))
  const extra = got.filter((name) => !expected.includes(name))
  // (3) Set equality, not just length: the same count with a swapped member is drift.
  const sameSet = missing.length === 0 && extra.length === 0 && got.length === expected.length
  if (!sameSet) drift++
  line('')
  line(`[${key}] expected ${expected.length}, got ${got.length} — set ${sameSet ? 'EQUAL' : 'DIFFERS'}`)
  line(`  value:   ${got.join(', ') || '(none)'}`)
  line(`  missing: ${missing.join(', ') || '(none)'}`)
  line(`  extra:   ${extra.join(', ') || '(none)'}`)
}

// ---------------------------------------------------------------------------
// 7. The seam
// ---------------------------------------------------------------------------
const seam = ctx.get('customRouter')
line('')
line(`[seam] keys: ${seam === undefined ? 'MISSING' : Object.keys(seam).join(', ')}`)
if (seam !== undefined) {
  try {
    const routed = seam.route('antigravity/gemini-3.8-flash-low')
    // The result carries `modelId` (the matched reference) — not a `model` object.
    line(`[seam] route('antigravity/gemini-3.8-flash-low') -> ok=${routed?.ok} preset=${routed?.preset?.id} modelId=${routed?.modelId} matchedBy=${routed?.matchedBy}`)
  } catch (error) {
    line(`[seam] route threw: ${error instanceof Error ? error.message : String(error)}`)
  }

  // Informational: a probe needs a live account/daemon, so a failure is data,
  // not a gate failure — the vendor config is only proven mountable here.
  for (const preset of seam.presets ?? []) {
    const probeStarted = Date.now()
    let timer
    try {
      const result = await Promise.race([
        seam.probe(preset),
        new Promise((_, reject) => {
          timer = setTimeout(() => reject(new Error(`timeout after ${PROBE_TIMEOUT_MS}ms`)), PROBE_TIMEOUT_MS)
        }),
      ])
      const models = Array.isArray(result?.models) ? result.models.length : 0
      const errors = Array.isArray(result?.errors) ? result.errors.length : 0
      line(`[seam] probe(${preset.id}) -> ${models} models, ${errors} errors (${Date.now() - probeStarted}ms)`)
    } catch (error) {
      line(`[seam] probe(${preset.id}) -> ${error instanceof Error ? error.message : String(error)} (${Date.now() - probeStarted}ms)`)
    } finally {
      clearTimeout(timer)
    }
  }

  try {
    const merged = seam.merge([
      { source: 'upstream', models: [{ id: 'synthetic-1', name: 'upstream-1', cost: { input: 1, output: 1, cacheRead: 0, cacheWrite: 0 } }] },
      { source: 'probe', models: [{ id: 'synthetic-1', name: 'probe-1', cost: { output: 2 } }] },
      { source: 'override', models: [{ id: 'synthetic-1', name: 'override-1' }] },
    ])
    const entry = merged?.models?.find((model) => model.id === 'synthetic-1')
    line(`[seam] merge(3 layers) -> name=${entry?.name} source=${entry?.source} layers=${entry?.layers?.join('→')} cost.input=${entry?.cost?.input} cost.output=${entry?.cost?.output}`)
    if ((merged?.errors?.length ?? 0) > 0) line(`[seam] merge errors: ${merged.errors.join('; ')}`)
  } catch (error) {
    line(`[seam] merge threw: ${error instanceof Error ? error.message : String(error)}`)
  }
}

// `bindUsage` is NOT on the seam (measured 2026-11-08: the seam exposes
// presets/vendorProbes/route/probe/merge only), so the gate measures the module.
try {
  const { bindUsage } = await import(pathToFileURL(join(PACKAGE_ROOT, 'lib', 'usage.js')).href)
  const preset = (seam?.presets ?? []).find((item) => item.id === 'antigravity')
  const bound = bindUsage({
    preset,
    usage: { inputTokens: 1200, outputTokens: 340 },
    verdict: { state: 'available', windows: [] },
  })
  line(`[usage] bindUsage -> input=${bound?.usage?.input} output=${bound?.usage?.output} readings=${bound?.readings?.length} billing=${bound?.billing?.confidence ?? 'n/a'}`)
} catch (error) {
  line(`[usage] bindUsage threw: ${error instanceof Error ? error.message : String(error)}`)
}

// ---------------------------------------------------------------------------
// 8. Logs, teardown, verdict
// ---------------------------------------------------------------------------
const activationWarnings = bootLog.join('').match(/did not activate/g)?.length ?? 0
line('')
line(`[boot] stderr lines captured: ${bootLog.join('').split('\n').filter(Boolean).length}; "did not activate" warnings: ${activationWarnings}`)

mkdirSync(LOG_DIR, { recursive: true })
writeFileSync(LOG_PATH, bootLog.join(''))
line(`[log] ${LOG_PATH}`)

try {
  await shutdown?.shutdown?.(0)
} catch { /* teardown is best effort */ }
try { ctx?.fiber?.dispose?.() } catch { /* disposal is best effort */ }

if (isolated.disposed() === false && !KEEP) isolated.dispose()
if (KEEP) line(`[keep] temp home left at ${home}`)

const passed = drift === 0 && mountError === undefined
line('')
line(passed ? 'PARITY: PASS' : 'PARITY: FAIL')
process.stdout.write(`${out.join('\n')}\n`)
process.exit(passed ? 0 : 1)
