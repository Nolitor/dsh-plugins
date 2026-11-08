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
 *   1. copies the profile manifest + patch and symlinks `node_modules`;
 *   2. boots the profile through the host's public `profile-boot` entry;
 *   3. reads the live registries — providers, tools, commands;
 *   4. imports each provider's `Config` schema and reads its boolean switches;
 *   5. diffs everything against `lib/presets.js` and exits non-zero on any gap.
 *
 * Usage:
 *   node scripts/verify-presets.mjs [--profile-dir <dir>] [--patch <file>] [--keep]
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

const argv = process.argv.slice(2)
const flag = (name, fallback) => {
  const index = argv.indexOf(name)
  return index === -1 || index + 1 >= argv.length ? fallback : argv[index + 1]
}
const KEEP = argv.includes('--keep')
const PROFILE_DIR = resolve(flag('--profile-dir', join(homedir(), '.dsh', 'profiles', 'web')))
const DEFAULT_PATCH = join(homedir(), '.local', 'share', 'dsh', 'cordis.local-bridge.patch.yml')
const PATCH = flag('--patch', DEFAULT_PATCH)

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

const problems = []
try {
  const providers = new Set(ctx.get('llm').listProviders().map((provider) => provider.id))
  const tools = new Set(ctx.get('tools').definitions().map((tool) => tool.name))
  const commands = new Set(ctx.get('commands').list().map((command) => command.name))

  const declared = validatePresets(PRESETS)
  for (const error of declared.errors) problems.push(`declaration: ${error}`)

  for (const preset of PRESETS) {
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

  process.stdout.write(`providers: ${[...providers].join(', ')}\n`)
  process.stdout.write(`commands: ${[...commands].join(', ')}\n`)
  process.stdout.write(`tools: ${[...tools].join(', ')}\n`)
} catch (error) {
  problems.push(`runtime read failed: ${error instanceof Error ? error.message : String(error)}`)
} finally {
  try { ctx?.fiber?.dispose?.() } catch { /* disposal is best effort */ }
  if (!KEEP) rmSync(home, { recursive: true, force: true })
}

if (problems.length > 0) {
  process.stderr.write(`\nDRIFT (${problems.length}):\n`)
  for (const problem of problems) process.stderr.write(`  - ${problem}\n`)
  process.exit(1)
}
process.stdout.write('\nOK: every preset declaration matches the runtime registries\n')
process.exit(0)
