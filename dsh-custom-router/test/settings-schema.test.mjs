/**
 * Settings-schema contract tests.
 *
 * These pin the projection the host settings service and the browser dashboard
 * depend on:
 *   - the schema is exported (without it the row is not configurable and the
 *     dashboard's `configForms.get('dsh-custom-router')` answers unavailable);
 *   - `presets`, `vendorConfig` and `usage` are volatile, so a settings write to
 *     those paths is ACCEPTED, while mount-time fields are not;
 *   - secret fields declare `role('secret')` so their values never ride a wire;
 *   - a read of the live config shape keeps unknown row keys and adds no
 *     default the operator never set.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import { Config } from '../lib/index.js'
import { VendorRow } from '../lib/settings-schema.js'

/** The live row config as measured in `~/.dsh/profiles/web/cordis.patch.yml`. */
const LIVE = Object.freeze({
  strict: true,
  presets: { antigravity: true, deepinfra: true, opencode: true },
  vendorConfig: {
    'dsh-antigravity': {
      enabled: true,
      modelServing: true,
      cliWorker: true,
      usagePill: true,
      clientSecret: '',
      refreshToken: '',
      enabledModels: ['gemini-3.8-flash-low'],
      workerEnabled: true,
    },
    'dsh-deepinfra': {
      apiKey: 'sk-di-live-key',
      turnMaxTokens: 16384,
      enabledModels: ['deepseek-ai/DeepSeek-V4.1-Flash-1017'],
    },
    'dsh-opencode-v2': { model: 'opencode-go/minimax-m3.1-flash#low' },
    'dsh-opencode-v2-http': { activePlan: 'go', attachToDaemon: true, conflictPolicy: 'warn' },
  },
})

/** Dereference a schema JSON tree's root node. */
function rootOf(schema) {
  const json = schema.toJSON()
  return json.refs[json.uid]
}

/** The meta of one named field of a schema's root object. */
function fieldMeta(schema, name) {
  const json = schema.toJSON()
  const root = rootOf(schema)
  const ref = root.dict?.[name]
  return ref === undefined ? undefined : json.refs[ref]
}

test('the plugin exports a Config schema for the settings service', () => {
  assert.equal(typeof Config, 'function')
  assert.equal(typeof Config.toJSON, 'function')
  const root = rootOf(Config)
  assert.equal(root.type, 'object')
  for (const field of ['strict', 'presets', 'vendorConfig', 'usage', 'packages', 'profileDir', 'installAnchor']) {
    assert.ok(root.dict[field] !== undefined, `Config is missing "${field}"`)
  }
})

test('the live row config validates and keeps its unknown row keys', () => {
  const parsed = Config(LIVE)
  const rows = parsed.vendorConfig.get()
  assert.deepEqual(Object.keys(rows).sort(), Object.keys(LIVE.vendorConfig).sort())
  // Keys the schema does not name must survive the projection, or a vendor
  // row's own options would silently disappear from the view.
  assert.equal(rows['dsh-deepinfra'].turnMaxTokens, 16384)
  assert.equal(rows['dsh-deepinfra'].apiKey, 'sk-di-live-key')
  assert.equal(rows['dsh-opencode-v2-http'].conflictPolicy, 'warn')
  assert.deepEqual(parsed.presets.get(), LIVE.presets)
})

test('switches and measurements are volatile; mount-time fields are not', () => {
  for (const field of ['presets', 'vendorConfig', 'usage']) {
    assert.equal(fieldMeta(Config, field)?.meta?.volatile, true, `${field} must be volatile for a settings write`)
  }
  for (const field of ['strict', 'packages', 'profileDir', 'installAnchor']) {
    assert.notEqual(fieldMeta(Config, field)?.meta?.volatile, true, `${field} must stay non-volatile`)
  }
})

test('secret fields declare role=secret and are redacted from a read', () => {
  for (const field of ['apiKey', 'password', 'clientSecret', 'refreshToken']) {
    assert.equal(fieldMeta(VendorRow, field)?.meta?.role, 'secret', `${field} must be role('secret')`)
  }
  // Non-secret row options must NOT be redacted, or the dashboard loses them.
  for (const field of ['enabled', 'modelServing', 'activePlan', 'enabledModels']) {
    assert.notEqual(fieldMeta(VendorRow, field)?.meta?.role, 'secret', `${field} must not be a secret`)
  }
})

test('no row field carries a default that would materialise on a live row', () => {
  const json = VendorRow.toJSON()
  const root = rootOf(VendorRow)
  for (const [field, ref] of Object.entries(root.dict)) {
    const node = json.refs[ref]
    if (node?.meta?.role === 'secret') continue
    assert.equal(node?.meta?.default, undefined, `row field "${field}" must have no default`)
  }
  // A row that only sets one switch must not gain the others.
  const parsed = Config({ vendorConfig: { 'dsh-antigravity': { modelServing: false } } })
  assert.deepEqual(parsed.vendorConfig.get()['dsh-antigravity'], { modelServing: false })
})

test('usage measurements project the dashboard fields and stay absent when empty', () => {
  const parsed = Config({
    usage: {
      antigravity: {
        measuredAt: '2026-11-08T00:00:00.000Z',
        windows: [{ id: '5h', percent: 42, resetsAt: '2026-11-08T05:00:00.000Z' }],
        serving: { modelCount: 12, health: 'healthy' },
      },
      deepinfra: { spend: 12.5, requests: 42, inputTokens: 1000, outputTokens: 200, inputRate: 0.5, outputRate: 1.5 },
    },
  })
  const usage = parsed.usage.get()
  assert.equal(usage.antigravity.windows[0].percent, 42)
  assert.equal(usage.antigravity.serving.modelCount, 12)
  assert.equal(usage.deepinfra.spend, 12.5)
  // A dict resolves to an empty record when absent; what matters is that it
  // carries no ROW and no fabricated measurement.
  assert.deepEqual(Config({}).usage.get(), {})
})

test('an absent vendorConfig resolves to an empty record, never a default row set', () => {
  const parsed = Config({ strict: true })
  assert.deepEqual(parsed.vendorConfig.get(), {})
  assert.equal(parsed.vendorConfig.get()['dsh-antigravity'], undefined)
})
