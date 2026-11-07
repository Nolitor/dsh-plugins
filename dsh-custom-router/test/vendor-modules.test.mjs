/** Vendor module loader: resolves through the profile and imports file URLs. */
import test from 'node:test'
import assert from 'node:assert/strict'

import {
  installAnchorFromExecPath,
  loadVendorModules,
  resolutionChain,
  resolveThroughChain,
} from '../lib/vendor-modules.js'

const FILES = new Map([
  ['@nolit/dsh-antigravity/auth', '/v/antigravity/lib/auth.js'],
  ['@nolit/dsh-antigravity/settings', '/v/antigravity/lib/settings.js'],
  ['@nolit/dsh-antigravity/catalog', '/v/antigravity/lib/catalog.js'],
  ['@nolit/dsh-antigravity', '/v/antigravity/lib/index.js'],
  ['@nolit/dsh-opencode-v2/package.json', '/v/opencode/package.json'],
  ['@nolit/dsh-opencode-v2/http', '/v/opencode/lib/http.js'],
  ['@nolit/dsh-opencode-v2', '/v/opencode/lib/index.js'],
  ['@nolit/dsh-deepinfra', '/v/deepinfra/lib/index.js'],
])

function fakeResolve(profileDir, specifier) {
  if (!FILES.has(specifier)) throw new Error(`Cannot find module '${specifier}'`)
  return FILES.get(specifier)
}

test('loads every bridged vendor through the profile resolver', async () => {
  const seen = []
  const { modules, packageUrls, errors } = await loadVendorModules({
    profileDir: '/profile',
    resolvePackage: fakeResolve,
    importModule: async (url) => { seen.push(url); return { url } },
  })
  assert.deepEqual(errors, [])
  assert.equal(modules.antigravity.auth.url, 'file:///v/antigravity/lib/auth.js')
  assert.equal(modules.opencode.http.url, 'file:///v/opencode/lib/http.js')
  assert.equal(modules.opencode.shared.url, 'file:///v/opencode/lib/shared.js')
  assert.equal(packageUrls.deepinfra, 'file:///v/deepinfra/lib/index.js')
  assert.equal(seen.includes('file:///v/opencode/lib/shared.js'), true)
})

test('a missing vendor is reported, the others still load', async () => {
  const resolvePackage = (profileDir, specifier) => {
    if (specifier.startsWith('@nolit/dsh-antigravity')) throw new Error('absent')
    return fakeResolve(profileDir, specifier)
  }
  const { modules, errors } = await loadVendorModules({ profileDir: '/p', resolvePackage, importModule: async (url) => ({ url }) })
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

test('a vendor package still resolves through the profile first', () => {
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
