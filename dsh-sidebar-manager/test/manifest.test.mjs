/**
 * Manifest conformance gate — verified against the authoritative internal spec:
 * dsh-plugins/docs/dsh-plugin-runtime-spec.md §2.1 (Manifest v1).
 *
 * These assertions lock the fields the runtime actually reads so a future edit
 * cannot silently drop the bundle patch, the client platform, or the exports shape.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '..')
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))

test('manifest: spec §2.1 required fields are present', () => {
  assert.equal(manifest.dsh?.manifestVersion, 1, 'dsh.manifestVersion must be 1')
  assert.equal(typeof manifest.dsh?.bundle?.patch, 'string', 'dsh.bundle.patch is required for a bundle')
  assert.equal(manifest.dsh?.client?.platform, 'web', 'dsh.client.platform must be "web"')
})

test('manifest: bundle patch file exists and is an array-shaped YAML layer', () => {
  const patchPath = path.join(root, manifest.dsh.bundle.patch)
  assert.ok(fs.existsSync(patchPath), `bundle patch missing: ${patchPath}`)
  const body = fs.readFileSync(patchPath, 'utf8')
  const meaningful = body.split('\n').filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
  assert.ok(meaningful.length > 0, 'patch layer must not be empty')
})

test('manifest: exports expose "." and "./client" as default-shaped entries', () => {
  for (const key of ['.', './client']) {
    const entry = manifest.exports?.[key]
    assert.ok(entry !== undefined, `exports["${key}"] must exist`)
    assert.equal(typeof entry, 'object', `exports["${key}"] should use the { default } shape`)
    assert.equal(typeof entry.default, 'string', `exports["${key}"].default must be a path`)
    const target = path.join(root, entry.default)
    assert.ok(fs.existsSync(target), `exports["${key}"] target missing: ${target}`)
  }
})

test('manifest: client inject edges are declared and ordered', () => {
  const inject = manifest.dsh?.client?.inject
  assert.ok(Array.isArray(inject), 'dsh.client.inject must be an array')
  assert.equal(new Set(inject).size, inject.length, 'inject edges must be unique')
  // The workspace browser is the surface we extend; it must be a declared edge.
  assert.ok(
    inject.includes('@deepseek-ai/dsh-client-ui-workspace'),
    'the sidebar browser package must be a declared inject edge',
  )
})

test('manifest: engines.dsh pins the verified runtime window', () => {
  assert.match(manifest.engines?.dsh ?? '', /^>=0\.2\.2-alpha\.2 <0\.3\.0$/)
  assert.match(manifest.engines?.node ?? '', /^>=24/)
})

test('manifest: every file listed for publishing exists', () => {
  for (const entry of manifest.files ?? []) {
    if (entry.includes('*')) continue
    assert.ok(fs.existsSync(path.join(root, entry)), `published file missing: ${entry}`)
  }
})

test('client: group accent falls back to theme seats instead of a bare hex', () => {
  const source = fs.readFileSync(path.join(root, 'lib/client.js'), 'utf8')
  // The system group must resolve through a theme seat variable.
  assert.match(
    source,
    /var\(--dsw-alias-state-business-primary, currentColor\)/,
    'system accent must bind to a theme seat, not a hardcoded color',
  )
  // Group accents must be computed, not read directly from a stored hex.
  assert.match(source, /function groupAccent\(/)
  assert.ok(
    !/style:\s*\{[^}]*color:\s*'#[0-9a-fA-F]{6}'/.test(source),
    'no inline hardcoded hex colors in style objects',
  )
  // No DOM/CSS injection hacks (directive: native sidebar stays vanilla).
  for (const banned of ['MutationObserver', 'querySelector', 'injectStylesheet', 'data-row-key', 'YDXeBa']) {
    assert.ok(!source.includes(banned), `client must not use "${banned}"`)
  }
})
