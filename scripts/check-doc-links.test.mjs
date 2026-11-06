/**
 * Regression tests for the documentation gates.
 *
 * Owner instruction 2026-11-06: the doc split broke 607 links before a gate caught it (F-53).
 * These tests make the gate itself verifiable, so a future edit to the parser or the resolver
 * cannot quietly turn it into a no-op that always passes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { execFileSync } from 'node:child_process'

const repo = new URL('..', import.meta.url).pathname

/** Build a throwaway tree that looks like the workspace the gate expects. */
function sandbox() {
  const dir = mkdtempSync(join(tmpdir(), 'doc-gate-'))
  mkdirSync(join(dir, 'scripts'), { recursive: true })
  mkdirSync(join(dir, 'docs'), { recursive: true })
  for (const f of ['check-doc-links.mjs', 'doc-index.mjs']) {
    writeFileSync(join(dir, 'scripts', f), readFileSync(join(repo, 'scripts', f)))
  }
  return dir
}
const run = (dir, script, args = []) => {
  try {
    return { code: 0, out: execFileSync(process.execPath, [join(dir, 'scripts', script), ...args], { cwd: dir, encoding: 'utf8', stdio: 'pipe' }) }
  } catch (e) {
    return { code: e.status ?? 1, out: (e.stdout ?? '') + (e.stderr ?? '') }
  }
}
const write = (dir, rel, body) => {
  mkdirSync(join(dir, rel, '..'), { recursive: true })
  writeFileSync(join(dir, rel), body)
}
const HEADER = (o = {}) => `<!-- skeleton:
version: 1.0
kind: ${o.kind ?? 'spec'}
status: ${o.status ?? 'active'}
updated: ${o.updated ?? '2026-11-06'}
summary: ${o.summary ?? 'A test document.'}
${o.lifecycle ? `lifecycle: ${o.lifecycle}\n` : ''}-->`

test('link gate: a resolving relative link passes', () => {
  const dir = sandbox()
  try {
    write(dir, 'docs/A.md', `# A\n\n${HEADER()}\n\n[to B](./B.md)\n`)
    write(dir, 'docs/B.md', `# B\n\n${HEADER()}\n\nback: [A](./A.md)\n`)
    const r = run(dir, 'check-doc-links.mjs')
    assert.equal(r.code, 0, r.out)
    assert.match(r.out, /every relative link resolves/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('link gate: a dangling relative link fails', () => {
  const dir = sandbox()
  try {
    write(dir, 'docs/A.md', `# A\n\n${HEADER()}\n\n[gone](./MISSING.md)\n`)
    const r = run(dir, 'check-doc-links.mjs')
    assert.equal(r.code, 1)
    assert.match(r.out, /BROKEN docs\/A\.md -> \.\/MISSING\.md/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('link gate: a link that escapes one level too far fails', () => {
  // the exact F-53 shape: a one-level-deep file using ../../ instead of ../
  const dir = sandbox()
  try {
    write(dir, 'docs/RULES.md', `# R\n\n${HEADER({ kind: 'rule' })}\n`)
    write(dir, 'dsh-track/CHANGELOG.md', `# C\n\n${HEADER({ kind: 'report' })}\n\n[rules](../../docs/RULES.md)\n`)
    const r = run(dir, 'check-doc-links.mjs')
    assert.equal(r.code, 1)
    assert.match(r.out, /BROKEN dsh-track\/CHANGELOG\.md/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('link gate: external urls and anchors are not resolved as files', () => {
  const dir = sandbox()
  try {
    write(dir, 'docs/A.md', `# A\n\n${HEADER()}\n\n[x](https://example.com/x.md) [y](#section) [z](/abs/path.md)\n`)
    const r = run(dir, 'check-doc-links.mjs')
    assert.equal(r.code, 0, r.out)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('index gate: pending doc without a lifecycle fails', () => {
  const dir = sandbox()
  try {
    write(dir, 'docs/RULES.md', `# R\n\n${HEADER({ kind: 'rule' })}\n`)
    write(dir, 'pending-docs/unpromoted/X.md', `# X\n\n${HEADER()}\n`)
    const r = run(dir, 'doc-index.mjs', ['--check'])
    assert.equal(r.code, 1)
    assert.match(r.out, /missing lifecycle/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('index gate: lifecycle that disagrees with its folder fails', () => {
  const dir = sandbox()
  try {
    write(dir, 'docs/RULES.md', `# R\n\n${HEADER({ kind: 'rule' })}\n`)
    write(dir, 'pending-docs/deprecated/X.md', `# X\n\n${HEADER({ lifecycle: 'unpromoted' })}\n`)
    const r = run(dir, 'doc-index.mjs', ['--check'])
    assert.equal(r.code, 1)
    assert.match(r.out, /lifecycle "unpromoted" but file is in deprecated\//)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('index gate: an unknown kind or status is a failure', () => {
  const dir = sandbox()
  try {
    write(dir, 'docs/A.md', `# A\n\n${HEADER({ kind: 'ver' })}\n`)
    const r = run(dir, 'doc-index.mjs', ['--check'])
    assert.equal(r.code, 1)
    assert.match(r.out, /unknown kind "ver"/)
  } finally { rmSync(dir, { recursive: true, force: true }) }
})

test('the real workspace passes both gates', () => {
  const r1 = execFileSync(process.execPath, [join(repo, 'scripts', 'doc-index.mjs'), '--check'], { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
  assert.match(r1, /OK: \d+ workspace docs/)
  const r2 = execFileSync(process.execPath, [join(repo, 'scripts', 'check-doc-links.mjs'), '--quiet'], { cwd: repo, encoding: 'utf8', stdio: 'pipe' })
  assert.match(r2, /checked \d+ relative links/)
})

test('move gate: a stub whose destination is missing fails', () => {
  // check-doc-moves resolves destinations against the projects root, two levels above the repo,
  // so the sandbox has to sit at <projects>/<id>/repo for the test to exercise the real layout.
  // the real repo is two levels below projects: .../projects/dsh-workspace/dsh-plugins
  const projects = mkdtempSync(join(tmpdir(), 'doc-gate-projects-'))
  const dir = join(projects, 'ws', 'repo')
  const dest = 'some-harness/docs/X.md'
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'check-doc-moves.mjs'), readFileSync(join(repo, 'scripts', 'check-doc-moves.mjs')))
    write(dir, 'pending-docs/deprecated/X.md', `# X — (moved)

> **MOVED — this is a pointer stub, not the document.**
>
> The authoritative copy now lives at **\`${dest}\`**.
> SHA-256: \`${'0'.repeat(64)}\`
> Original path here: \`pending-docs/deprecated/X.md\`
`)
    const r = run(dir, 'check-doc-moves.mjs')
    assert.equal(r.code, 1)
    assert.match(r.out, /destination does not exist/)
  } finally { rmSync(projects, { recursive: true, force: true }) }
})

test('move gate: a stub whose destination digest changed fails', () => {
  // the real repo is two levels below projects: .../projects/dsh-workspace/dsh-plugins
  const projects = mkdtempSync(join(tmpdir(), 'doc-gate-projects-'))
  const dir = join(projects, 'ws', 'repo')
  const dest = 'some-harness/docs/X.md'
  try {
    mkdirSync(join(dir, 'scripts'), { recursive: true })
    writeFileSync(join(dir, 'scripts', 'check-doc-moves.mjs'), readFileSync(join(repo, 'scripts', 'check-doc-moves.mjs')))
    write(projects, dest, '# X\n\nthe real document\n')
    write(dir, 'pending-docs/deprecated/X.md', `# X — (moved)

> **MOVED — this is a pointer stub, not the document.**
>
> The authoritative copy now lives at **\`${dest}\`**.
> SHA-256: \`${'0'.repeat(64)}\`
> Original path here: \`pending-docs/deprecated/X.md\`
`)
    const r = run(dir, 'check-doc-moves.mjs')
    assert.equal(r.code, 1)
    assert.match(r.out, /destination digest changed/)
  } finally { rmSync(projects, { recursive: true, force: true }) }
})
