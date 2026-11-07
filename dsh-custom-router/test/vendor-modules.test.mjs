/** Vendor module loader: resolves through the profile and imports file URLs. */
import test from 'node:test'
import assert from 'node:assert/strict'

import { loadVendorModules } from '../lib/vendor-modules.js'

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
