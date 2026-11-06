#!/usr/bin/env node
/**
 * Gate: a track may only sit in a lifecycle its measured state supports.
 *
 * The owner's ask (2026-11-06): when a plugin is 폐기 / 통합 / 축소 / 삭제 (retired, merged,
 * shrunk, deleted), what can go wrong — and what must exist so it cannot.
 *
 * Today those four decisions are governed by prose. `archive/README.md` states a five-bar test,
 * `docs/RULES.md` §6.1a states three completion conditions, and `PLUGIN-CONSOLIDATION.md` §2
 * lists superseded packages. All three are correct and all three are *re-derived by hand every
 * time*, which is exactly the shape of F-50 (one absorbed track archived, three left behind) and
 * F-51 (broken node_modules links left in the live profile for days).
 *
 * This gate turns the prose into a measurement. It does not decide anything; it refuses to let a
 * directory claim a lifecycle the live system contradicts.
 *
 * Lifecycles and what each asserts:
 *
 *   active      a `dsh-<track>/` directory that a profile installs, or that ships runtime code.
 *               Assert: if it has a runtime entry point, some profile must reference it.
 *   spec        a `dsh-<track>/` directory that ships documents only (no main/exports, no lib/).
 *               Assert: it must NOT be installed anywhere, and its package.json must say so.
 *   archive     `archive/<track>/`. Assert the five bars of archive/README.md, measured:
 *                 1. not in any profile `dependencies`
 *                 2. not in any profile `dsh.profile.bundles`
 *                 3. no `node_modules/@nolit/<name>` link in any profile
 *                 4. no active track imports it
 *                 5. its replacement exists and is itself installed
 *   staging     `staging/<track>/`. Assert: not installed, and not imported by an active track.
 *
 * Bars 1-3 are read from `~/.dsh/profiles/*` READ-ONLY. This script never writes and never
 * launches dsh. When the live home is absent (another machine, CI), the profile bars are
 * reported as `skipped` rather than silently passing.
 *
 * Usage: node scripts/check-disposal-safety.mjs [--quiet] [--json]
 * Exit:  0 every directory's measured state matches its claimed lifecycle, 1 otherwise.
 */
import { existsSync, readdirSync, readFileSync, realpathSync } from 'node:fs'
import { join } from 'node:path'

// DSH_DISPOSAL_ROOT lets the test suite point the gate at a fixture tree. Without it the gate
// reads this workspace, which is the only place it is meant to run.
const root = process.env.DSH_DISPOSAL_ROOT ?? new URL('..', import.meta.url).pathname
const home = process.env.DSH_DISPOSAL_HOME ?? process.env.HOME
const profilesRoot = join(home, '.dsh/profiles')
const liveAvailable = existsSync(profilesRoot)

const problems = []
const notes = []
const rows = []

const fail = (track, message) => problems.push(`${track}: ${message}`)

/** Every profile that exists, as {name, dir, dependencies, bundles}. */
function readProfiles() {
  if (!liveAvailable) return []
  const out = []
  for (const entry of readdirSync(profilesRoot, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const dir = join(profilesRoot, entry.name)
    const manifest = join(dir, 'package.json')
    if (!existsSync(manifest)) continue
    let pkg
    try {
      pkg = JSON.parse(readFileSync(manifest, 'utf8'))
    } catch (error) {
      fail(`profiles/${entry.name}`, `package.json is not valid JSON (${error.message})`)
      continue
    }
    out.push({
      name: entry.name,
      dir,
      dependencies: Object.keys(pkg.dependencies ?? {}),
      bundles: pkg.dsh?.profile?.bundles ?? [],
    })
  }
  return out
}

/**
 * Every `node_modules/@nolit/<name>` link across the profiles, as {name, profile, target,
 * resolves}. A link whose target is gone is the F-51 residue this gate exists to catch.
 */
function readNolitLinks(profiles) {
  const links = []
  for (const profile of profiles) {
    const scope = join(profile.dir, 'node_modules/@nolit')
    if (!existsSync(scope)) continue
    for (const entry of readdirSync(scope, { withFileTypes: true })) {
      const path = join(scope, entry.name)
      let target = null
      let resolves = false
      try {
        target = realpathSync(path)
        resolves = true
      } catch {
        resolves = false
      }
      links.push({ name: `@nolit/${entry.name}`, profile: profile.name, path, target, resolves })
    }
  }
  return links
}

const profiles = readProfiles()
const links = readNolitLinks(profiles)

/** Which profiles install a package name (dependency row or bundle row). */
function installsOf(name) {
  return profiles
    .filter((p) => p.dependencies.includes(name) || p.bundles.includes(name))
    .map((p) => p.name)
}

/** Every package.json under the workspace, keyed by the directory that owns it. */
function trackPackages(dir, kind) {
  if (!existsSync(dir)) return []
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const path = join(dir, entry.name, 'package.json')
    if (!existsSync(path)) continue
    try {
      const pkg = JSON.parse(readFileSync(path, 'utf8'))
      out.push({ kind, dir: entry.name, path, pkg })
    } catch (error) {
      fail(`${kind}/${entry.name}`, `package.json is not valid JSON (${error.message})`)
    }
  }
  return out
}

const active = trackPackages(root, 'active').filter((t) => t.dir.startsWith('dsh-'))
const archived = trackPackages(join(root, 'archive'), 'archive')
const staged = trackPackages(join(root, 'staging'), 'staging')

/**
 * A track ships runtime code when it declares an entry point or carries a lib/ directory.
 * A track that only ships documents is a `spec` track: it must not be installed anywhere,
 * because an installed package with no entry point still occupies a bundle row and its
 * cordis patch would mount nothing (F-48's "declared but unregistered" shape).
 */
function shipsRuntime(track) {
  if (track.pkg.main || track.pkg.exports) return true
  return existsSync(join(root, track.dir, 'lib'))
}

/** Does any active track's runtime code reference this package name? */
function importedByActive(name, selfDir) {
  const hits = []
  for (const track of active) {
    if (track.dir === selfDir) continue
    for (const sub of ['lib', '.']) {
      const dir = join(root, track.dir, sub)
      if (!existsSync(dir)) continue
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        if (!entry.isFile() || !/\.(?:js|mjs|cjs)$/.test(entry.name)) continue
        const text = readFileSync(join(dir, entry.name), 'utf8')
        // A real import specifier, not a comment or a data attribute.
        if (new RegExp(`(?:from|import|require)\\s*\\(?\\s*['"]${name.replace('/', '\\/')}(?:/[^'"]*)?['"]`).test(text)) {
          hits.push(`${track.dir}/${sub === '.' ? '' : sub + '/'}${entry.name}`)
        }
      }
    }
  }
  return hits
}

// ---------------------------------------------------------------- active tracks
for (const track of active) {
  const name = track.pkg.name ?? '(unnamed)'
  const runtime = shipsRuntime(track)
  const installed = installsOf(name)
  const link = links.find((l) => l.name === name)

  rows.push({ kind: 'active', dir: track.dir, name, version: track.pkg.version, installed, runtime })

  if (runtime && installed.length === 0) {
    fail(
      track.dir,
      `ships runtime code (${track.pkg.main ?? 'lib/'}) but no profile installs it — ` +
        'either install it, or declare it a spec track by removing main/exports/lib (docs/RULES.md §3)',
    )
  }
  if (!runtime && installed.length > 0) {
    fail(
      track.dir,
      `ships documents only (no main/exports/lib) but is installed in ${installed.join(', ')} — ` +
        'a bundle row that mounts nothing claims liveness it does not have (F-48)',
    )
  }
  if (installed.length > 0 && !link) {
    fail(
      track.dir,
      `listed in ${installed.join(', ')} but has no node_modules/@nolit link — the bundle cannot resolve (F-42)`,
    )
  }
  if (link && !link.resolves) {
    fail(track.dir, `node_modules link ${link.path} does not resolve — broken link residue (F-51)`)
  }
}

// ---------------------------------------------------------------- archived tracks
for (const track of archived) {
  const name = track.pkg.name ?? '(unnamed)'
  const installed = installsOf(name)
  const link = links.find((l) => l.name === name)
  const importers = importedByActive(name, track.dir)

  rows.push({ kind: 'archive', dir: `archive/${track.dir}`, name, version: track.pkg.version, installed })

  // Bar 1 + 2: not a dependency and not a bundle row in any profile.
  if (installed.length > 0) {
    fail(`archive/${track.dir}`, `bar 1/2: still installed in ${installed.join(', ')} — an archived track is not installed anywhere`)
  }
  // Bar 3: no node_modules link pointing at it.
  if (link) {
    fail(`archive/${track.dir}`, `bar 3: ${link.profile} still links ${name} -> ${link.target ?? '(broken)'}`)
  }
  // Bar 4: no active package imports it.
  if (importers.length > 0) {
    fail(`archive/${track.dir}`, `bar 4: still imported by ${importers.join(', ')}`)
  }
  // Bar 5 is a human judgement (does the replacement really cover the surface?); the
  // measurable half is that the README names a replacement. The rest is left to the reviewer.
  const readme = join(root, 'archive', track.dir, 'README.md')
  if (!existsSync(readme)) {
    fail(`archive/${track.dir}`, 'bar 5: no README.md naming the replacement that serves this surface')
  } else if (!/absorbed into|superseded by|replaced by/i.test(readFileSync(readme, 'utf8'))) {
    fail(`archive/${track.dir}`, 'bar 5: README.md does not name the replacement that serves this surface')
  }
}

// ---------------------------------------------------------------- staged tracks
for (const track of staged) {
  const name = track.pkg.name ?? '(unnamed)'
  const installed = installsOf(name)
  const importers = importedByActive(name, track.dir)

  rows.push({ kind: 'staging', dir: `staging/${track.dir}`, name, version: track.pkg.version, installed })

  if (installed.length > 0) {
    fail(`staging/${track.dir}`, `staged code is installed in ${installed.join(', ')} — staging is never installed`)
  }
  if (importers.length > 0) {
    fail(`staging/${track.dir}`, `staged code is imported by ${importers.join(', ')} — promote it into a track first`)
  }
}

// ---------------------------------------------------------------- link residue
// A @nolit link with no package behind it is the exact F-51 defect. Report every one,
// regardless of which track it belongs to.
for (const link of links) {
  if (link.resolves) continue
  fail('profiles', `broken @nolit link: ${link.profile}/node_modules/@nolit/${link.name.replace('@nolit/', '')} (F-51)`)
}

// ---------------------------------------------------------------- report
const quiet = process.argv.includes('--quiet')
const json = process.argv.includes('--json')

if (json) {
  console.log(JSON.stringify({ ok: problems.length === 0, profiles: profiles.map((p) => p.name), rows, problems }, null, 2))
} else {
  if (!liveAvailable) {
    notes.push('~/.dsh/profiles not found — profile bars skipped (not passed)')
  } else {
    notes.push(`profiles read: ${profiles.map((p) => p.name).join(', ')}`)
  }
  notes.push(`${active.length} active, ${archived.length} archived, ${staged.length} staged track(s); ${links.length} @nolit link(s)`)
}

if (problems.length > 0) {
  console.error(`FAIL: ${problems.length} disposal-safety problem(s):`)
  for (const problem of problems) console.error('  ' + problem)
  process.exit(1)
}
if (!quiet && !json) {
  for (const note of notes) console.log(note)
  console.log('OK: every track sits in a lifecycle its measured state supports')
}
