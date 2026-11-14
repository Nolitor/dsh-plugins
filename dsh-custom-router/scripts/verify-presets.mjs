#!/usr/bin/env node
/**
 * Preset drift gate (owner decision 2026-11-07): the router's preset
 * declarations must match what the provider plugins ACTUALLY do at runtime.
 *
 * Why: hand-copied tables are how the vendor manuals drifted (a `/worker`
 * command that never existed, a `/opencode` command that is really `/ocode`, a
 * `modelServing` switch that opencode did not have). A measurement is only
 * trustworthy if something mechanical compares it every time.
 *
 * What it does, in an ISOLATED `DSH_HOME` (never the live profile):
 *   0. STATIC half first — compares `PRESETS`, the browser `MODEL_PRESETS` and
 *      every locale (lib/preset-drift.js), plus the generated artefacts. This
 *      needs no boot and catches the two SILENT failures (no settings tab, no
 *      usage card) that the runtime half structurally cannot see;
 *   1. copies the profile manifest + patch and symlinks `node_modules`;
 *   2. boots the profile through the host's public `profile-boot` entry;
 *   3. reads the live registries — providers, tools, commands;
 *   4. imports each provider's `Config` schema and reads its boolean switches;
 *   5. diffs everything against `lib/presets.js` and exits non-zero on any gap.
 *
 * Usage:
 *   node scripts/verify-presets.mjs [--profile-dir <dir>] [--patch <file>] [--keep] [--static-only]
 *
 * Exit codes: 0 clean, 1 drift found, 2 the harness could not run.
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { copyFileSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

import { PRESETS, validatePresets } from '../lib/presets.js'
import { checkDeriveMirror, checkGeneratedArtifacts, checkPresetRegistry, readLocales, readModelPresets } from '../lib/preset-drift.js'
import { checkDeclarationFields } from '../lib/preset-schema.js'
import { presetSettings } from '../lib/preset-derive.js'

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 || index + 1 >= argv.length ? null : argv[index + 1]
}
const KEEP = argv.includes('--keep')
const STATIC_ONLY = argv.includes('--static-only')
const PROFILE_DIR = resolve(flag('--profile-dir') ?? join(homedir(), '.dsh', 'profiles', 'web'))
const DEFAULT_PATCH = join(homedir(), '.local', 'share', 'dsh', 'cordis.local-bridge.patch.yml')
const PATCH = flag('--patch') ?? DEFAULT_PATCH

const problems = []

// ------------------------------------------------------- static half (no boot)
// A stale bundle would make the static checks pass against code the page never
// runs, so the artefact check comes first: everything after it can then trust
// that `lib/client.js` is what `lib/client.src.js` builds to.
const artifacts = checkGeneratedArtifacts()
for (const problem of artifacts.problems) problems.push(`artifacts: ${problem}`)
const mirror = checkDeriveMirror()
for (const problem of mirror.problems) problems.push(`mirror: ${problem}`)

let staticVerdict
try {
  staticVerdict = checkPresetRegistry({
    presets: PRESETS,
    descriptors: readModelPresets(),
    locales: readLocales(),
    // The derivation is supplied so the gate can prove each descriptor IS the
    // derived one (STANDARD §4 steps 2–3), not merely consistent with it.
    derive: presetSettings,
  })
  for (const problem of staticVerdict.problems) problems.push(`registry: ${problem}`)
} catch (error) {
  problems.push(`registry: could not evaluate lib/client.js: ${error instanceof Error ? error.message : String(error)}`)
}

// ---------------------------------------------------- dead-field static report
// The declaration surface is checked for fields with NO measured consumer. A
// field nobody measured is an ERROR (a new dead field is exactly the drift this
// wave measured); a field already listed in DECLARATION_DEAD_FIELDS is a
// WARNING, because every current preset declares some and turning them into
// failures would break the tree instead of reporting it.
const fieldWarnings = []
let fieldErrors = 0
for (const preset of PRESETS) {
  const report = checkDeclarationFields(preset)
  fieldErrors += report.errors.length
  for (const error of report.errors) problems.push(`declaration: ${preset.id}: ${error}`)
  for (const warning of report.warnings) fieldWarnings.push(`${preset.id}: ${warning}`)
}

process.stdout.write(
  `static registry: ${staticVerdict ? (staticVerdict.ok ? 'OK' : `${staticVerdict.problems.length} problem(s)`) : 'FAILED'}` +
    ` (${PRESETS.length} presets, ${staticVerdict ? readModelPresets().length : 0} descriptors, ${Object.keys(readLocales()).length} locales)\n`,
)
process.stdout.write(
  `static fields  : ${fieldErrors === 0 ? 'OK' : `${fieldErrors} unknown field(s)`}` +
    ` (${fieldWarnings.length} declared-but-dead field warning(s) across ${PRESETS.length} presets)\n`,
)
for (const warning of fieldWarnings) process.stdout.write(`dead field: ${warning}\n`)

if (STATIC_ONLY) {
  reportAndExit()
}

// ------------------------------------------------------------ dynamic half

const fail = (message) => {
  process.stderr.write(`verify-presets: ${message}\n`)
  process.exit(2)
}

/** Resolve the installed dsh package root from the CLI on PATH. */
function dshRoot() {
  let bin
  try {
    bin = execFileSync('bash', ['-lc', 'command -v dsh'], { encoding: 'utf8' }).trim()
  } catch {
    fail('dsh is not on PATH; pass it or run inside the harness environment')
  }
  const real = realpathSync(bin)
  // .../node_modules/@deepseek-ai/dsh/lib/bin.js → package root
  return resolve(dirname(real), '..')
}

/** Build an isolated DSH_HOME from the given profile. */
function buildIsolatedHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-presets-'))
  const profileOut = join(home, 'profiles', 'web')
  execFileSync('mkdir', ['-p', profileOut])
  for (const name of ['package.json', 'cordis.yml', 'cordis.patch.yml']) {
    const source = join(PROFILE_DIR, name)
    if (!existsSync(source)) fail(`missing ${source}`)
    copyFileSync(source, join(profileOut, name))
  }
  symlinkSync(join(PROFILE_DIR, 'node_modules'), join(profileOut, 'node_modules'))
  // Keep the boot away from live state: rewrite every absolute home path.
  const homeRoot = dirname(dirname(PROFILE_DIR))
  const patchPath = join(profileOut, 'cordis.patch.yml')
  const rewritten = readFileSync(patchPath, 'utf8').split(homeRoot).join(home)
  writeFileSync(patchPath, rewritten)
  return { home, profileOut }
}

/** Read one module's boolean switch fields. */
async function booleanSwitches(profileOut, specifier) {
  const require = createRequire(join(profileOut, 'package.json'))
  let file
  if (specifier === '@nolit/dsh-custom-router/vendor/antigravity') {
    file = fileURLToPath(new URL('../vendor/antigravity/lib/index.js', import.meta.url))
  } else if (specifier === '@nolit/dsh-custom-router/vendor/deepinfra') {
    file = fileURLToPath(new URL('../vendor/deepinfra/lib/index.js', import.meta.url))
  } else {
    try {
      file = require.resolve(specifier)
    } catch {
      fail(`cannot resolve ${specifier} from the isolated profile`)
    }
  }
  const module = await import(pathToFileURL(file).href)
  const Config = module.Config
  if (Config === undefined || Config.dict === undefined) return []
  return Object.entries(Config.dict)
    .filter(([, schema]) => String(schema).includes('boolean'))
    .map(([name]) => name)
}

const { home, profileOut } = buildIsolatedHome()
const patchFiles = PATCH && existsSync(PATCH) ? [PATCH] : []
process.env.DSH_HOME = home

let ctx
try {
  const root = dshRoot()
  const { runProfile } = await import(pathToFileURL(join(root, 'lib', 'profile-boot.js')).href)
  const environment = new Map(Object.entries(process.env).map(([key, value]) => [key, { value, source: 'process' }]))
  ;({ ctx } = await runProfile({
    environment,
    profile: 'web',
    patchFiles,
    args: ['--no-open', '--port', '0', '--host', '127.0.0.1'],
  }))
} catch (error) {
  if (!KEEP) rmSync(home, { recursive: true, force: true })
  fail(`could not boot the isolated profile: ${error instanceof Error ? error.message : String(error)}`)
}

try {
  const providers = new Set(ctx.get('llm').listProviders().map((provider) => provider.id))
  const tools = new Set(ctx.get('tools').definitions().map((tool) => tool.name))
  const commands = new Set(ctx.get('commands').list().map((command) => command.name))

  const declared = validatePresets(PRESETS)
  for (const error of declared.errors) problems.push(`declaration: ${error}`)

  // A declared-but-not-enabled preset mounts nothing by design (the dashboard's
  // "Add provider" writes `presets.<id>: true`). The static half already
  // validated its declaration, descriptor and locale keys; calling its absence
  // from the runtime registries drift would make every new opt-in preset fail
  // the gate until the operator enables it.
  const enabledPresets = new Set(
    Array.isArray(ctx.get('customRouter')?.enabledPresets)
      ? ctx.get('customRouter').enabledPresets
      : PRESETS.map((preset) => preset.id),
  )
  const skipped = []

  for (const preset of PRESETS) {
    if (!enabledPresets.has(preset.id)) {
      skipped.push(preset.id)
      continue
    }
    if (!providers.has(preset.providerId)) {
      problems.push(`${preset.id}: provider "${preset.providerId}" is not registered at runtime`)
    }
    // Tools/commands a gated-off surface also disables in the vendor. `gates`
    // exists because one vendor switch can guard more than `cli.toolName`
    // (measured: OpenCode's `cliOn` guards the `opencode` tool, `/ocode` and the
    // `cli_worker` batch). Declaring the extra names keeps the drift gate strict
    // instead of relaxing it.
    const gatedSurfaces = [preset.surfaces.cli, preset.surfaces.batch]
      .filter((surface) => surface && surface.default === false)
    const gatedOffTools = new Set(
      gatedSurfaces.flatMap((surface) => [surface.toolName, ...(Array.isArray(surface.gates) ? surface.gates : [])]),
    )
    const gatedOffCommands = new Set(
      gatedSurfaces.map((surface) => surface.commandName).filter((name) => typeof name === 'string'),
    )
    for (const tool of preset.surfaces.tools) {
      if (gatedOffTools.has(tool)) continue
      if (!tools.has(tool)) problems.push(`${preset.id}: tool "${tool}" is declared but not registered`)
    }
    for (const command of preset.surfaces.commands) {
      if (gatedOffCommands.has(command)) continue
      if (!commands.has(command)) problems.push(`${preset.id}: command "/${command}" is declared but not registered`)
    }
    for (const surface of [preset.surfaces.cli, preset.surfaces.batch]) {
      if (!surface) continue
      // A gated tool with `default: false` is expected to be ABSENT from a
      // default profile; the gate exists precisely so it is opt-in.
      const gatedOff = surface.default === false
      if (!gatedOff && !tools.has(surface.toolName)) {
        problems.push(`${preset.id}: CLI tool "${surface.toolName}" is declared but not registered`)
      }
      if (gatedOff && tools.has(surface.toolName)) {
        problems.push(`${preset.id}: CLI tool "${surface.toolName}" is declared off by default but IS registered`)
      }
      if ('commandName' in surface && !gatedOff && !commands.has(surface.commandName)) {
        problems.push(`${preset.id}: CLI command "/${surface.commandName}" is declared but not registered`)
      }
      if ('commandName' in surface && gatedOff && commands.has(surface.commandName)) {
        problems.push(`${preset.id}: CLI command "/${surface.commandName}" is declared off by default but IS registered`)
      }
    }

    const byModule = new Map()
    for (const item of preset.switches) {
      if (!byModule.has(item.module)) byModule.set(item.module, [])
      byModule.get(item.module).push(item.name)
    }
    for (const [moduleName, names] of byModule) {
      const specifier = moduleName === 'http' ? `${preset.package}/http` : preset.package
      const available = await booleanSwitches(profileOut, specifier)
      for (const name of names) {
        if (!available.includes(name)) {
          problems.push(`${preset.id}: switch "${name}" is declared on ${moduleName} but is not a boolean field there`)
        }
      }
    }
  }

  if (skipped.length > 0) process.stdout.write(`disabled presets (not checked at runtime): ${skipped.join(', ')}\n`)
  process.stdout.write(`providers: ${[...providers].join(', ')}\n`)
  process.stdout.write(`commands: ${[...commands].join(', ')}\n`)
  process.stdout.write(`tools: ${[...tools].join(', ')}\n`)
} catch (error) {
  problems.push(`runtime read failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  try { ctx?.fiber?.dispose?.() } catch { /* disposal is best effort */ }
  if (!KEEP) rmSync(home, { recursive: true, force: true })
}

reportAndExit()

/**
 * Print the verdict and exit.
 *
 * One tail for both halves: a static failure must not be hidden behind a boot,
 * and a boot failure must not be reported as a clean run.
 * @returns {never} exits the process.
 */
function reportAndExit() {
  if (problems.length > 0) {
    process.stderr.write(`\nDRIFT (${problems.length}):\n`)
    for (const problem of problems) process.stderr.write(`  - ${problem}\n`)
    process.exit(1)
  }
  // A green report states its blind spots rather than implying full coverage.
  // The runtime hole is only a hole when the boot half did not run; printing it
  // after a successful boot would understate what the command just checked.
  for (const hole of staticVerdict?.holes ?? []) {
    if (!STATIC_ONLY && /runtime registration/.test(hole)) continue
    process.stdout.write(`not checked here: ${hole}\n`)
  }
  process.stdout.write(
    '\nOK: preset declarations, the browser registry, the locales and the runtime registries all agree\n',
  )
  process.exit(0)
}
