/**
 * Subagent allowlist contract tests.
 *
 * The allowlist is a HOST-owned settings namespace, so the router ships the
 * default in TWO places and these tests pin that they agree:
 *
 *   - `lib/allowlist.js` — the default as DATA;
 *   - `cordis.patch.yml` — the default as the bundle layer a fresh profile
 *     mounts.
 *
 * The second pin is the one that matters: a default that lives only in a
 * module never reaches a fresh profile, and the failure is silent (children
 * simply cannot pick a model). The YAML is read with the HOST's own parser
 * (`yaml` from the DSH install tree), so the file this test reads is the file
 * the loader parses.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

import { ALLOWLIST_ROW_ID, ALLOWLIST_ROW_NAME, DEFAULT_ALLOWED_MODELS, defaultAllowlistConfig, isAllowedByDefault } from '../lib/allowlist.js'

const PACKAGE_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Resolve a host package from the DSH installation.
 *
 * The router's own tree carries no YAML parser; the Host's does. The install
 * tree is located through the `dsh` CLI on PATH — the same anchor the router
 * uses at mount.
 * @param {string} specifier - the package specifier.
 * @returns {string} an absolute file path.
 */
function resolveHostPackage(specifier) {
  const bin = execFileSync('bash', ['-lc', 'command -v dsh'], { encoding: 'utf8' }).trim()
  if (bin === '') throw new Error('dsh is not on PATH')
  const root = resolve(dirname(require('node:fs').realpathSync(bin)), '..')
  return createRequire(join(root, 'package.json')).resolve(specifier)
}

const require = createRequire(import.meta.url)

test('the default allowlist carries the EXAONE route', () => {
  assert.ok(isAllowedByDefault('exaone', 'k-exaone_v2.5'),
    'exaone/k-exaone_v2.5 must be allowed by default — the measured refusal was "child LLM route \\"exaone/k-exaone_v2.5\\" is not allowed for this Session"')
})

test('the default allowlist names the provider ids the presets declare', () => {
  // The provider id is the route a child asks for; a typo here silently
  // refuses the route at runtime.
  const expected = new Set(['antigravity', 'opencode-http-agent', 'deepinfra', 'exaone'])
  for (const route of DEFAULT_ALLOWED_MODELS) {
    assert.ok(expected.has(route.provider), `unexpected provider id "${route.provider}"`)
  }
})

test('the default allowlist has no duplicate route', () => {
  const keys = DEFAULT_ALLOWED_MODELS.map((route) => `${route.provider}/${route.model}`)
  assert.equal(new Set(keys).size, keys.length, 'the host row rejects a repeated route')
})

test('the default config is the host row\'s shape', () => {
  const config = defaultAllowlistConfig()
  assert.equal(config.enabled, true)
  assert.ok(Array.isArray(config.allowedModels))
  assert.ok(config.allowedModels.length > 0, 'an enabled row with an empty list is refused by the host')
  for (const route of config.allowedModels) {
    assert.equal(typeof route.provider, 'string')
    assert.equal(typeof route.model, 'string')
    assert.ok(route.provider.length > 0)
    assert.ok(route.model.length > 0)
  }
})

test('the bundle patch states the SAME default the module declares', async () => {
  const { parse } = await import(resolveHostPackage('yaml'))
  const text = readFileSync(join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8')
  const rows = parse(text)
  const row = rows.find((entry) => entry.id === ALLOWLIST_ROW_ID)
  assert.ok(row !== undefined, `the bundle patch must state the "${ALLOWLIST_ROW_ID}" row`)
  assert.equal(row.name, ALLOWLIST_ROW_NAME)
  assert.equal(row.config.enabled, true)
  assert.deepEqual(row.config.allowedModels, DEFAULT_ALLOWED_MODELS.map((route) => ({ ...route })),
    'the bundle patch and lib/allowlist.js must state the same routes — the module is the data, the patch is what a fresh profile mounts')
})

test('the bundle patch states the EXAONE route in the host\'s route shape', async () => {
  const { parse } = await import(resolveHostPackage('yaml'))
  const text = readFileSync(join(PACKAGE_ROOT, 'cordis.patch.yml'), 'utf8')
  const rows = parse(text)
  const row = rows.find((entry) => entry.id === ALLOWLIST_ROW_ID)
  const exaone = row.config.allowedModels.filter((route) => route.provider === 'exaone')
  assert.deepEqual(exaone, [{ provider: 'exaone', model: 'k-exaone_v2.5' }])
})
