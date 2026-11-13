/** Vendor module loader: every provider resolves from the package, never the profile. */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  installAnchorFromExecPath,
  loadVendorModules,
  resolutionChain,
  resolveThroughChain,
} from '../lib/vendor-modules.js'

// Phase E (2026-11-13): OpenCode joined Antigravity and DeepInfra in the
// vendored slot, so a profile that cannot resolve the legacy link must still
// load every provider. The fake resolver therefore serves NOTHING.
function fakeResolve(profileDir, specifier) {
  throw new Error(`Cannot find module '${specifier}'`)
}

test('every provider loads from the vendored slot, even with an empty profile', async () => {
  const seen = []
  const { modules, packageUrls, errors } = await loadVendorModules({
    profileDir: '/profile',
    resolvePackage: fakeResolve,
    importModule: async (url) => { seen.push(url); return { url } },
  })
  assert.deepEqual(errors, [])
  assert.match(modules.antigravity.auth.url, /\/vendor\/antigravity\/lib\/auth\.js$/)
  assert.match(modules.antigravity.settings.url, /\/vendor\/antigravity\/lib\/settings\.js$/)
  assert.match(modules.antigravity.catalog.url, /\/vendor\/antigravity\/lib\/catalog\.js$/)
  // The measured regression Phase E removes: these used to be '/v/opencode/…'
  // (resolved from the profile). They must now be the package's own vendor dir.
  assert.match(modules.opencode.http.url, /\/vendor\/opencode\/lib\/http\.js$/)
  assert.match(modules.opencode.shared.url, /\/vendor\/opencode\/lib\/shared\.js$/)
  assert.match(packageUrls.opencode, /\/vendor\/opencode\/lib\/index\.js$/)
  assert.match(packageUrls.deepinfra, /\/vendor\/deepinfra\/lib\/index\.js$/)
  assert.equal(seen.some((url) => url.startsWith('file:///profile')), false, 'nothing is read from the profile')
})

test('a missing vendor is reported, the others still load', async () => {
  const importModule = async (url) => {
    if (url.includes('/vendor/antigravity/')) throw new Error('absent')
    return { url }
  }
  const { modules, errors } = await loadVendorModules({ profileDir: '/p', resolvePackage: fakeResolve, importModule })
  assert.equal(modules.antigravity, undefined)
  assert.equal(modules.opencode.http !== undefined, true)
  assert.deepEqual(errors.map((error) => error.vendor), ['antigravity'])
})

test('a profile dir is mandatory', async () => {
  await assert.rejects(() => loadVendorModules({}), /profileDir/)
})

// ---- ordered anchor chain (2026-11-07) ------------------------------------
// `@deepseek-ai/dsh-tool-subagent` ships with DSH, not with any profile, so it
// needs the install anchor. These pin the ORDER and the failure evidence.

test('the chain is profile → installAnchor → extras → execPath', () => {
  const chain = resolutionChain({
    profileDir: '/profiles/web',
    installAnchor: '/install/dsh/package.json',
    anchors: ['/extra/package.json'],
  })
  assert.deepEqual(chain.map((item) => item.label), ['profile', 'installAnchor', 'anchor1', 'execPath'])
  assert.equal(chain[0].anchor, '/profiles/web/package.json')
  assert.equal(chain[1].anchor, '/install/dsh/package.json')
})

test('a host package resolves through the install anchor when the profile cannot', () => {
  const resolve = (anchor, specifier) => {
    if (anchor.startsWith('/profiles')) throw new Error(`Cannot find module '${specifier}'`)
    return '/install/dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js'
  }
  const verdict = resolveThroughChain({
    profileDir: '/profiles/web',
    installAnchor: '/install/dsh/package.json',
    specifier: '@deepseek-ai/dsh-tool-subagent',
    resolve,
  })
  assert.equal(verdict.ok, true)
  assert.equal(verdict.label, 'installAnchor')
  assert.equal(verdict.path, '/install/dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js')
})

test('a profile package resolves through the profile first', () => {
  const resolve = () => '/vendor/antigravity/lib/index.js'
  const verdict = resolveThroughChain({ profileDir: '/profiles/web', specifier: '@nolit/dsh-antigravity', resolve })
  assert.equal(verdict.label, 'profile')
})

test('an unresolved row reports every attempt, with its anchor and error', () => {
  const resolve = (anchor, specifier) => { throw new Error(`Cannot find module '${specifier}' from ${anchor}`) }
  const verdict = resolveThroughChain({ profileDir: '/p', installAnchor: '/i/package.json', specifier: 'ghost', resolve })
  assert.equal(verdict.ok, false)
  assert.deepEqual(verdict.attempts.map((attempt) => attempt.label), ['profile', 'installAnchor', 'execPath'])
  for (const attempt of verdict.attempts) assert.match(attempt.error, /Cannot find module/)
})

test('a file: URL or absolute path needs no anchor', () => {
  for (const specifier of ['file:///tmp/fixture.mjs', '/abs/path/vendor.mjs']) {
    const verdict = resolveThroughChain({ specifier, resolve: () => { throw new Error('must not be called') } })
    assert.equal(verdict.ok, true)
    assert.equal(verdict.label, 'literal')
    assert.equal(verdict.path, specifier)
  }
})

test('the execPath anchor is a fallback, not the primary', () => {
  assert.match(installAnchorFromExecPath('/opt/node/bin/node'), /@deepseek-ai\/dsh\/package\.json$/)
  const chain = resolutionChain({ profileDir: '/p' })
  assert.equal(chain[0].label, 'profile')
  assert.equal(chain.at(-1).label, 'execPath')
})
