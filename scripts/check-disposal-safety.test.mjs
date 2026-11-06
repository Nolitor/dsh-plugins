#!/usr/bin/env node
/**
 * Tests for scripts/check-disposal-safety.mjs.
 *
 * A gate that has only ever been run on green code proves nothing (F-54). Each case below
 * builds a fixture tree in a temp directory, claims a lifecycle the fixture contradicts, and
 * asserts the gate exits non-zero with the expected reason. The final case asserts the
 * matching green fixture passes, so a gate that always fails is caught too.
 *
 * Run: node --test scripts/check-disposal-safety.test.mjs
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const gate = new URL('./check-disposal-safety.mjs', import.meta.url).pathname

/**
 * Build a throwaway workspace + throwaway DSH home.
 * `tracks` are {dir, pkg} under a `dsh-` prefixed directory; `archived`/`staged` are the same shape.
 * `profiles` are {name, dependencies, bundles, links:[pkgName]}.
 */
function fixture({ tracks = [], archived = [], staged = [], profiles = [] }) {
  const base = mkdtempSync(join(tmpdir(), 'disposal-'))
  const root = join(base, 'ws')
  const home = join(base, 'home')
  mkdirSync(root, { recursive: true })

  const writePkg = (dir, pkg) => {
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  }

  for (const t of tracks) {
    writePkg(join(root, 'dsh-' + t.dir), t.pkg)
    for (const file of t.files ?? []) {
      const path = join(root, 'dsh-' + t.dir, file.path)
      mkdirSync(join(path, '..'), { recursive: true })
      writeFileSync(path, file.text)
    }
  }
  for (const t of archived) {
    writePkg(join(root, 'archive', 'dsh-' + t.dir), t.pkg)
    writeFileSync(join(root, 'archive', 'dsh-' + t.dir, 'README.md'), t.readme ?? '')
  }
  for (const t of staged) writePkg(join(root, 'staging', 'dsh-' + t.dir), t.pkg)

  for (const p of profiles) {
    const dir = join(home, '.dsh/profiles', p.name)
    mkdirSync(dir, { recursive: true })
    writeFileSync(
      join(dir, 'package.json'),
      JSON.stringify(
        { name: 'p', dependencies: Object.fromEntries((p.dependencies ?? []).map((n) => [n, 'link:/x'])), dsh: { profile: { bundles: p.bundles ?? [] } } },
        null,
        2,
      ),
    )
    for (const link of p.links ?? []) {
      const scope = join(dir, 'node_modules/@nolit')
      mkdirSync(scope, { recursive: true })
      const target = join(root, 'dsh-' + link, )
      if (p.brokenLinks?.includes(link)) {
        symlinkSync(join(base, 'does-not-exist'), join(scope, link))
      } else {
        mkdirSync(target, { recursive: true })
        symlinkSync(target, join(scope, link))
      }
    }
  }
  return { base, root, home }
}

function run(f) {
  try {
    const out = execFileSync(process.execPath, [gate, '--json'], {
      env: { ...process.env, DSH_DISPOSAL_ROOT: f.root, DSH_DISPOSAL_HOME: f.home },
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    })
    return { code: 0, out }
  } catch (error) {
    return { code: error.status ?? 1, out: (error.stdout ?? '') + (error.stderr ?? '') }
  }
}

test('green fixture passes', () => {
  const f = fixture({
    tracks: [{ dir: 'alpha', pkg: { name: '@nolit/dsh-alpha', version: '0.0.1-rc.1', main: 'lib/index.js' } }],
    profiles: [{ name: 'web', dependencies: ['@nolit/dsh-alpha'], bundles: ['@nolit/dsh-alpha'], links: ['dsh-alpha'] }],
  })
  try {
    const { code, out } = run(f)
    assert.equal(code, 0, out)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('active runtime track that no profile installs fails', () => {
  const f = fixture({
    tracks: [{ dir: 'alpha', pkg: { name: '@nolit/dsh-alpha', version: '0.0.1-rc.1', main: 'lib/index.js' } }],
    profiles: [{ name: 'web' }],
  })
  try {
    const { code, out } = run(f)
    assert.notEqual(code, 0)
    assert.match(out, /ships runtime code .* but no profile installs it/)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('doc-only track that IS installed fails', () => {
  const f = fixture({
    tracks: [{ dir: 'spec', pkg: { name: '@nolit/dsh-spec', version: '0.0.1-rc.1' } }],
    profiles: [{ name: 'web', dependencies: ['@nolit/dsh-spec'], bundles: ['@nolit/dsh-spec'], links: ['dsh-spec'] }],
  })
  try {
    const { code, out } = run(f)
    assert.notEqual(code, 0)
    assert.match(out, /ships documents only/)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('archived track still in a profile bundle fails (bar 1/2, the F-50 defect)', () => {
  const f = fixture({
    archived: [{ dir: 'gone', pkg: { name: '@nolit/dsh-gone', version: '0.0.1-rc.1' }, readme: 'absorbed into @nolit/dsh-alpha' }],
    profiles: [{ name: 'web', bundles: ['@nolit/dsh-gone'] }],
  })
  try {
    const { code, out } = run(f)
    assert.notEqual(code, 0)
    assert.match(out, /bar 1\/2: still installed/)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('archived track with a surviving node_modules link fails (bar 3, the F-51 defect)', () => {
  const f = fixture({
    archived: [{ dir: 'gone', pkg: { name: '@nolit/dsh-gone', version: '0.0.1-rc.1' }, readme: 'absorbed into @nolit/dsh-alpha' }],
    profiles: [{ name: 'web', links: ['dsh-gone'] }],
  })
  try {
    const { code, out } = run(f)
    assert.notEqual(code, 0)
    assert.match(out, /bar 3:/)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('archived track still imported by an active track fails (bar 4)', () => {
  const f = fixture({
    tracks: [
      {
        dir: 'alpha',
        pkg: { name: '@nolit/dsh-alpha', version: '0.0.1-rc.1', main: 'lib/index.js' },
        files: [{ path: 'lib/index.js', text: "import x from '@nolit/dsh-gone/helper'\n" }],
      },
    ],
    archived: [{ dir: 'gone', pkg: { name: '@nolit/dsh-gone', version: '0.0.1-rc.1' }, readme: 'absorbed into @nolit/dsh-alpha' }],
    profiles: [{ name: 'web', dependencies: ['@nolit/dsh-alpha'], bundles: ['@nolit/dsh-alpha'], links: ['dsh-alpha'] }],
  })
  try {
    const { code, out } = run(f)
    assert.notEqual(code, 0)
    assert.match(out, /bar 4: still imported by/)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('archived track whose README names no replacement fails (bar 5)', () => {
  const f = fixture({
    archived: [{ dir: 'gone', pkg: { name: '@nolit/dsh-gone', version: '0.0.1-rc.1' }, readme: 'old stuff, kept around' }],
    profiles: [{ name: 'web' }],
  })
  try {
    const { code, out } = run(f)
    assert.notEqual(code, 0)
    assert.match(out, /bar 5: README.md does not name the replacement/)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('staged code that is installed fails', () => {
  const f = fixture({
    staged: [{ dir: 'beta', pkg: { name: '@nolit/dsh-beta', version: '0.0.1-rc.1' } }],
    profiles: [{ name: 'web', dependencies: ['@nolit/dsh-beta'] }],
  })
  try {
    const { code, out } = run(f)
    assert.notEqual(code, 0)
    assert.match(out, /staged code is installed/)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('broken @nolit link fails even when no track claims it (F-51)', () => {
  const f = fixture({
    profiles: [{ name: 'web', links: ['dsh-ghost'], brokenLinks: ['dsh-ghost'] }],
  })
  try {
    const { code, out } = run(f)
    assert.notEqual(code, 0)
    assert.match(out, /broken @nolit link/)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})

test('absent live home is skipped, not silently passed', () => {
  // A doc-only track with no profile to install it is green on the profile bars. With no live
  // home the gate must report zero profiles read rather than inventing a pass or a failure.
  const f = fixture({
    tracks: [{ dir: 'spec', pkg: { name: '@nolit/dsh-spec', version: '0.0.1-rc.1' } }],
  })
  try {
    const emptyHome = join(f.base, 'empty-home')
    const text = execFileSync(process.execPath, [gate, '--json'], {
      env: { ...process.env, DSH_DISPOSAL_ROOT: f.root, DSH_DISPOSAL_HOME: emptyHome },
      encoding: 'utf8',
    })
    const parsed = JSON.parse(text)
    assert.equal(parsed.profiles.length, 0, 'no live home means zero profiles are read')
    assert.equal(parsed.ok, true)
  } finally {
    rmSync(f.base, { recursive: true, force: true })
  }
})
