#!/usr/bin/env node
/**
 * .SYNOPSIS
 *   Prove a plugin track is actually publishable to npm, before `npm publish`.
 *
 * .DESCRIPTION
 *   The workspace declared `"source": { "type": "npm" }` in every market/index.json
 *   while none of those packages existed on the registry (measured 2026-11-06:
 *   all three returned HTTP 404). The runtime spec already warns that a market
 *   entry of type npm which is not published makes the Discover install fail.
 *
 *   Prose did not stop that drift, so this gate measures it. It packs the track
 *   for real, unpacks the tarball, and proves the package works FROM THE TARBALL
 *   rather than from the source tree -- because the tarball is what consumers get.
 *   That distinction is not academic: `dsh-sidebar-manager` shipped a tarball
 *   missing `lib/promotion-gate.mjs` and `lib/subagent-guard.mjs`, which
 *   `lib/transaction.mjs` imports, so it crashed with ERR_MODULE_NOT_FOUND on
 *   install while every source-tree test stayed green.
 *
 *   Checks, in order:
 *     1. metadata      name format, version, private, scoped-access, prerelease tag need
 *     2. files[]       every entry resolves; every tracked file is shipped or explained
 *     3. import graph  every relative import from a shipped file resolves inside the tarball
 *     4. host entry    `import()` of package.json#main succeeds from the tarball
 *     5. links         relative markdown links resolve inside the tarball
 *     6. market        market/index.json version == package.json version, source type
 *
 * .USAGE
 *   node scripts/check-npm-publishable.mjs              # every track with a market entry
 *   node scripts/check-npm-publishable.mjs dsh-notify   # one track
 *   node scripts/check-npm-publishable.mjs --json
 *
 * .EXIT
 *   0 all checks pass, 1 at least one blocking defect, 2 the gate itself failed.
 *
 * .NOTES
 *   Read-only with respect to the repository: it packs into a throwaway temp dir
 *   and never writes to the track or to artifacts/. It never publishes and never
 *   touches the network.
 */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, readdirSync, existsSync, statSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'

const root = resolve(new URL('..', import.meta.url).pathname)
const args = process.argv.slice(2)
const asJson = args.includes('--json')
const only = args.filter((a) => !a.startsWith('--'))

/** Files npm always includes, whatever `files[]` says. */
const ALWAYS_SHIPPED = new Set(['package.json', 'README.md', 'README', 'LICENSE', 'LICENCE', 'COPYING'])
/** Track-level documents that legitimately stay out of the published tarball. */
const TRACK_ONLY = [
  /^PROVENANCE\.md$/,
  /^CHANGELOG(\.ko)?\.md$/,
  /^COMMITS-PENDING\.md$/,
  /^RECOVERY-NOTES\.md$/,
  /^INCIDENT-.*\.md$/,
  /^NOTICE$/,
  /^release\.manifest\.json$/,
  /^\.gitattributes$/,
  /^prototype-.*\//,
  /^\.gitignore$/,
]

const problems = []
const notes = []
const fail = (track, code, detail) => problems.push({ track, code, detail })
const note = (track, detail) => notes.push({ track, detail })

function tracks() {
  return readdirSync(root, { withFileTypes: true })
    .filter((e) => e.isDirectory() && e.name.startsWith('dsh-'))
    .map((e) => e.name)
    .filter((name) => existsSync(join(root, name, 'package.json')))
    .filter((name) => existsSync(join(root, name, 'market', 'index.json')))
    .filter((name) => only.length === 0 || only.includes(name))
}

function packAndExtract(track) {
  const dir = join(root, track)
  const tmp = mkdtempSync(join(tmpdir(), 'npm-publishable-'))
  let tarball
  try {
    const out = execFileSync('npm', ['pack', '--pack-destination', tmp, '--silent'], {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    tarball = join(tmp, out.trim().split('\n').pop())
    execFileSync('tar', ['-xzf', tarball, '-C', tmp])
  } catch (error) {
    rmSync(tmp, { recursive: true, force: true })
    throw new Error('npm pack failed: ' + (error.stderr || error.message).toString().trim())
  }
  return { tmp, tarball, pkgDir: join(tmp, 'package') }
}

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else if (entry.isFile()) out.push(full)
  }
  return out
}

function globToRegExp(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&')
  return new RegExp('^' + escaped.replace(/\*/g, '[^/]*').replace(/\?/g, '[^/]') + '$')
}

function coveredBy(relPath, files) {
  if (ALWAYS_SHIPPED.has(relPath)) return true
  for (const raw of files) {
    const entry = raw.replace(/\/$/, '')
    if (entry.includes('*')) {
      if (globToRegExp(entry).test(relPath)) return true
      // `docs/*.md` should also match `docs/sub/x.md`? No -- npm does not either.
    } else if (relPath === entry || relPath.startsWith(entry + '/')) {
      return true
    }
  }
  return false
}

function checkTrack(track) {
  const dir = join(root, track)
  const pkg = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8'))
  const market = JSON.parse(readFileSync(join(dir, 'market', 'index.json'), 'utf8'))

  // --- 1. metadata -----------------------------------------------------------
  const nameOk = /^(@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(pkg.name)
  if (!nameOk) fail(track, 'metadata', `package name "${pkg.name}" is not a valid npm name`)

  if (pkg.private === true) fail(track, 'metadata', 'package.json sets "private": true -- npm refuses to publish')

  const scoped = pkg.name.startsWith('@')
  const access = pkg.publishConfig?.access
  if (scoped && access !== 'public') {
    fail(
      track,
      'metadata',
      `scoped package needs publishConfig.access="public" (measured: ${access ?? 'absent'}); ` +
        'without it npm publishes restricted and the market install cannot resolve it',
    )
  }

  const prerelease = /-/.test(pkg.version)
  if (prerelease) {
    note(
      track,
      `version ${pkg.version} is a prerelease: npm publish REQUIRES --tag <name> ` +
        '(verified: plain `npm publish --dry-run` exits with "You must specify a tag using --tag when publishing a prerelease version"), ' +
        'and the version will NOT get the `latest` dist-tag, so a bare `npm i <pkg>` will not resolve it',
    )
  }

  if (pkg.engines?.node && !/^>=?\s*\d/.test(pkg.engines.node)) {
    fail(track, 'metadata', `engines.node "${pkg.engines.node}" is not a comparable range`)
  }

  // --- 2..5. the tarball -----------------------------------------------------
  let packed
  try {
    packed = packAndExtract(track)
  } catch (error) {
    fail(track, 'pack', error.message)
    return
  }

  try {
    const shipped = walk(packed.pkgDir).map((f) => relative(packed.pkgDir, f).split('\\').join('/'))
    const files = pkg.files ?? []

    // every files[] entry must resolve in the source tree
    for (const entry of files) {
      // `!pattern` is an npm exclusion, not a path that must exist.
      if (entry.startsWith('!')) continue
      const bare = entry.replace(/\/$/, '')
      if (bare.includes('*')) {
        const re = globToRegExp(bare)
        const dirPart = dirname(bare)
        const base = dirPart === '.' ? dir : join(dir, dirPart)
        const hit = existsSync(base) && readdirSync(base).some((n) => re.test(dirPart === '.' ? n : join(dirPart, n)))
        if (!hit) fail(track, 'files[]', `glob "${entry}" matches nothing in the source tree`)
      } else if (!existsSync(join(dir, bare))) {
        fail(track, 'files[]', `"${entry}" does not exist in the source tree`)
      }
    }

    // every tracked file must be shipped or explicitly excused
    const tracked = execFileSync('git', ['ls-files', '.'], { cwd: dir, encoding: 'utf8' })
      .split('\n')
      .filter(Boolean)
    for (const rel of tracked) {
      if (shipped.includes(rel)) continue
      if (TRACK_ONLY.some((re) => re.test(rel))) continue
      if (!coveredBy(rel, files)) {
        fail(track, 'files[]', `tracked file "${rel}" is neither in files[] nor an excused track-only document`)
      }
    }

    // --- 3. import graph inside the tarball ----------------------------------
    const shippedSet = new Set(shipped)
    for (const rel of shipped) {
      if (!rel.endsWith('.js') && !rel.endsWith('.mjs')) continue
      const text = readFileSync(join(packed.pkgDir, rel), 'utf8')
      const specifiers = [
        ...text.matchAll(/(?:^|[^\w$.])(?:import|export)\s+(?:[^'"()]*?\s+from\s+)?['"]([^'"]+)['"]/g),
        ...text.matchAll(/\bimport\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
        ...text.matchAll(/\brequire\s*\(\s*['"]([^'"]+)['"]\s*\)/g),
      ].map((m) => m[1])

      for (const spec of specifiers) {
        if (!spec.startsWith('.') && !spec.startsWith('/')) continue
        const target = resolve(dirname(join(packed.pkgDir, rel)), spec)
        const candidates = [target, target + '.js', target + '.mjs', join(target, 'index.js'), join(target, 'index.mjs')]
        const hit = candidates.find((c) => existsSync(c))
        if (!hit) {
          fail(
            track,
            'import-graph',
            `"${rel}" imports "${spec}" which is not in the tarball -- this package crashes on install with ERR_MODULE_NOT_FOUND`,
          )
          continue
        }
        const shippedTarget = relative(packed.pkgDir, hit).split('\\').join('/')
        if (!shippedSet.has(shippedTarget)) {
          fail(track, 'import-graph', `"${rel}" imports "${spec}" which resolves outside the published file set`)
        }
      }
    }

    // --- 4. the host entry must load from the tarball ------------------------
    if (pkg.main) {
      const mainPath = join(packed.pkgDir, pkg.main)
      if (!existsSync(mainPath)) {
        fail(track, 'host-entry', `package.json#main "${pkg.main}" is not in the tarball`)
      } else {
        try {
          execFileSync(process.execPath, ['-e', `import(${JSON.stringify(pathToFileURL(mainPath).href)})`], {
            cwd: packed.pkgDir,
            stdio: 'pipe',
            timeout: 30_000,
          })
        } catch (error) {
          const detail = (error.stderr || error.message).toString().split('\n').slice(0, 4).join(' ').trim()
          fail(track, 'host-entry', `importing "${pkg.main}" from the tarball failed: ${detail}`)
        }
      }
    }

    // --- 5. relative markdown links -----------------------------------------
    for (const rel of shipped) {
      if (!rel.endsWith('.md')) continue
      const text = readFileSync(join(packed.pkgDir, rel), 'utf8')
      for (const match of text.matchAll(/\]\(([^)#\s][^)]*)\)/g)) {
        let target = match[1].trim()
        // `[x](<path with spaces>)` is ordinary markdown; the angle brackets are
        // delimiters, not part of the path.
        if (target.startsWith('<') && target.endsWith('>')) target = target.slice(1, -1).trim()
        if (/^(https?:|mailto:|#|\/)/.test(target)) continue
        const clean = target.split('#')[0].split('?')[0]
        if (!clean) continue
        if (!existsSync(resolve(dirname(join(packed.pkgDir, rel)), clean))) {
          fail(track, 'links', `"${rel}" links to "${target}" which does not exist in the tarball`)
        }
      }
    }

    // --- 6. market agreement ------------------------------------------------
    const marketPlugin = (market.plugins ?? []).find((p) => p.name === pkg.name)
    if (!marketPlugin) {
      fail(track, 'market', `market/index.json does not list "${pkg.name}"`)
    } else {
      const versions = (marketPlugin.versions ?? []).map((v) => v.version)
      if (!versions.includes(pkg.version)) {
        fail(track, 'market', `market lists ${versions.join(', ')} but package.json is ${pkg.version}`)
      }
      const current = (marketPlugin.versions ?? []).find((v) => v.version === pkg.version)
      const sourceType = current?.source?.type
      if (sourceType !== 'npm') {
        fail(track, 'market', `market version ${pkg.version} declares source.type="${sourceType ?? 'absent'}" -- expected "npm" for a package this gate certifies`)
      }
    }

    note(track, `tarball: ${relative(tmpdir(), packed.tarball).split('\\').join('/')} (${shipped.length} files)`)
  } finally {
    rmSync(packed.tmp, { recursive: true, force: true })
  }
}

let failed = false
try {
  const list = tracks()
  if (list.length === 0) {
    console.error('check-npm-publishable: no tracks matched')
    process.exit(2)
  }
  for (const track of list) checkTrack(track)

  if (asJson) {
    console.log(JSON.stringify({ tracks: list, problems, notes }, null, 2))
  } else {
    console.log(`checked ${list.length} publishable track(s): ${list.join(', ')}`)
    for (const n of notes) console.log(`  note ${n.track}: ${n.detail}`)
    if (problems.length > 0) {
      console.error(`\n${problems.length} blocking problem(s):`)
      for (const p of problems) console.error(`  FAIL [${p.code}] ${p.track}: ${p.detail}`)
    } else {
      console.log('\nevery track is publishable: metadata, files[], import graph, host entry, links and market agree')
    }
  }
  failed = problems.length > 0
} catch (error) {
  console.error('check-npm-publishable: gate error -- ' + error.message)
  process.exit(2)
}
process.exit(failed ? 1 : 0)
