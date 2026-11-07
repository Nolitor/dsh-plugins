/** Bridge registry: three handlers when modules exist, deepinfra always. */
import test from 'node:test'
import assert from 'node:assert/strict'

import { BRIDGED_VENDORS, createVendorBridges } from '../lib/bridges/index.js'

const antigravityModules = {
  auth: { TokenProvider: class { async get() { return 't' } } },
  settings: { resolveEndpoint: () => ({ baseUrl: '', project: 'p', userAgent: 'ua' }) },
  catalog: { parseCatalog: () => [] },
}
const opencodeModules = {
  http: { authHeader: () => 'Basic x', serviceStateCandidates: () => [] },
  shared: { modelsFromApiPayload: () => ({ models: [] }) },
}

test('the registry exposes every bridged vendor', () => {
  assert.deepEqual([...BRIDGED_VENDORS], ['antigravity', 'opencode', 'deepinfra'])
})

test('with both vendor module sets, three handlers exist', () => {
  const bridges = createVendorBridges({ modules: { antigravity: antigravityModules, opencode: opencodeModules } })
  assert.deepEqual(Object.keys(bridges).sort(), ['antigravity', 'deepinfra', 'opencode'])
  for (const handler of Object.values(bridges)) assert.equal(typeof handler, 'function')
})

test('without vendor modules only the standard deepinfra bridge exists', () => {
  const bridges = createVendorBridges({ modules: {} })
  assert.deepEqual(Object.keys(bridges), ['deepinfra'])
})
