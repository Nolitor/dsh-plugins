import test from 'node:test'
import assert from 'node:assert/strict'

import {
  SEAM_CATALOG,
  probeAll,
  probeCtx,
  probeFn,
  probeSessionAppendOverload
} from '../lib/probes.js'

const visited = new Set()

function mark (id) {
  visited.add(id)
  return id
}

const HOOK_IDS = ['agent/pre-step', 'agent/request']

function makeCtx (overrides = {}) {
  const services = {
    'agent/pre-step': { handler: true },
    'agent/request': { handler: true },
    session: {
      append: function append (events) { return events },
      appendPluginRecord: function appendPluginRecord () {},
      pluginRecordOf: function pluginRecordOf () {},
      surface: { nodes: [] }
    },
    ...overrides
  }
  return {
    eventTypes: ['working-directory/change', ...HOOK_IDS],
    get (id) {
      return services[id]
    }
  }
}

test('probeFn returns false for undefined object, not throw', () => {
  const res = probeFn(undefined, 'appendPluginRecord')
  assert.equal(res.ok, false)
  assert.equal(typeof res.reason, 'string')
  assert.ok(res.reason.length > 0)
  assert.equal(res.tier, 'contract')
  assert.equal(res.deprecated, false)
  mark('appendPluginRecord')
})

test('probeFn reports absent and non-function exports honestly', () => {
  assert.equal(probeFn({}, 'nope').ok, false)
  assert.equal(probeFn({ nope: 42 }, 'nope').ok, false)
  assert.equal(probeFn(null, 'nope').ok, false)
  const fnRes = probeFn({ appendPluginRecord: function appendPluginRecord () {} }, 'appendPluginRecord')
  assert.equal(fnRes.ok, true)
  mark('appendPluginRecord')
})

test('probeFn is catalog-aware for pluginRecordOf', () => {
  const ok = probeFn({ pluginRecordOf: function pluginRecordOf (r) { return r } }, 'pluginRecordOf')
  assert.deepEqual(
    { ok: ok.ok, tier: ok.tier, deprecated: ok.deprecated },
    { ok: true, tier: 'contract', deprecated: false }
  )
  const missing = probeFn({}, 'pluginRecordOf')
  assert.equal(missing.ok, false)
  assert.equal(missing.tier, 'contract')
  mark('pluginRecordOf')
})

test('deprecated seam reports deprecated: true', () => {
  const ctx = makeCtx()
  const res = probeCtx(ctx, 'agent/request')
  assert.equal(res.deprecated, true)
  assert.equal(res.tier, 'contract')
  assert.equal(res.ok, true)
  mark('agent/request')
})

test('non-deprecated seam reports deprecated: false', () => {
  const res = probeCtx(makeCtx(), 'agent/pre-step')
  assert.equal(res.deprecated, false)
  assert.equal(res.ok, true)
  mark('agent/pre-step')
})

test('probeCtx handles a missing ctx', () => {
  for (const bad of [undefined, null]) {
    const res = probeCtx(bad, 'agent/pre-step')
    assert.equal(res.ok, false)
    assert.equal(typeof res.reason, 'string')
  }
  mark('agent/pre-step')
})

test('probeCtx works when ctx.get is missing', () => {
  const flat = { 'agent/pre-step': function preStep () {} }
  const res = probeCtx(flat, 'agent/pre-step')
  assert.equal(res.ok, true)
  mark('agent/pre-step')
})

test('probeCtx returns absent when ctx.get yields undefined', () => {
  const res = probeCtx({ get: () => undefined }, 'agent/pre-step')
  assert.equal(res.ok, false)
  mark('agent/pre-step')
})

test('ctx with service object present but method missing returns ok: false', () => {
  const ctx = {
    get (id) {
      if (id === 'session') return { surface: { nodes: [] } }
      return undefined
    }
  }
  const res = probeFn(ctx.get('session'), 'appendPluginRecord')
  assert.equal(res.ok, false)
  mark('appendPluginRecord')
})

test('probeSessionAppendOverload distinguishes 3-arg from array form', () => {
  const threeArg = function append (type, payload, options) { return [type, payload, options] }
  const arrayForm = function append (events) { return events }

  const yes = probeSessionAppendOverload(threeArg)
  assert.equal(yes.ok, true)
  assert.equal(yes.arity, 3)
  assert.equal(yes.tier, 'internal')
  assert.equal(yes.deprecated, false)

  const no = probeSessionAppendOverload(arrayForm)
  assert.equal(no.ok, false)
  assert.equal(no.arity, 1)

  const garbage = probeSessionAppendOverload(undefined)
  assert.equal(garbage.ok, false)
  assert.equal(garbage.arity, 0)
  mark('session.append single-event overload')
})

test('session.surface probe requires an object with nodes', () => {
  const good = probeAll(makeCtx())['session.surface']
  assert.equal(good.ok, true)
  mark('session.surface')

  const bad = probeAll({ get: () => ({ surface: {} }) })['session.surface']
  assert.equal(bad.ok, false)
  mark('session.surface')
})

test('working-directory/change is probed as an event type', () => {
  const present = probeAll(makeCtx())['working-directory/change']
  assert.equal(present.ok, true)
  mark('working-directory/change')

  const absent = probeAll({ get: () => ({}) , eventTypes: [] })['working-directory/change']
  assert.equal(absent.ok, false)
  mark('working-directory/change')
})

test('probeAll returns a result for every catalog id and never throws', () => {
  const all = probeAll(makeCtx())
  const ids = Object.keys(all)
  assert.equal(ids.length, SEAM_CATALOG.length)
  for (const row of SEAM_CATALOG) {
    assert.ok(row.id in all, `probeAll missing ${row.id}`)
    assert.equal(typeof all[row.id].ok, 'boolean')
    assert.ok(all[row.id].tier === 'contract' || all[row.id].tier === 'internal')
    assert.equal(typeof all[row.id].deprecated, 'boolean')
    mark(row.id)
  }

  const degenerate = probeAll(undefined)
  assert.equal(Object.keys(degenerate).length, SEAM_CATALOG.length)
  for (const id of Object.keys(degenerate)) {
    assert.equal(degenerate[id].ok, false)
    mark(id)
  }
})

test('every seam catalog entry is exercised by at least one assertion', () => {
  const catalogIds = SEAM_CATALOG.map(row => row.id)
  assert.equal(catalogIds.length, 7)
  for (const id of catalogIds) {
    assert.ok(visited.has(id), `seam "${id}" was never probed by a test assertion`)
  }
  assert.equal(visited.size, catalogIds.length)
})

test('catalog rows carry the declared contract/internal tier split', () => {
  const byId = new Map(SEAM_CATALOG.map(row => [row.id, row]))
  assert.equal(byId.get('agent/pre-step').tier, 'contract')
  assert.equal(byId.get('agent/request').deprecated, true)
  assert.equal(byId.get('session.append single-event overload').tier, 'internal')
  assert.equal(byId.size, 7)
  for (const row of SEAM_CATALOG) {
    assert.equal(typeof row.probe, 'string')
    assert.equal(typeof row.deprecated, 'boolean')
    assert.ok(row.tier === 'contract' || row.tier === 'internal')
  }
})

test('probes never cache across calls', () => {
  const first = probeCtx({ get: () => ({ handler: true }) }, 'agent/pre-step')
  const second = probeCtx({ get: () => undefined }, 'agent/pre-step')
  assert.equal(first.ok, true)
  assert.equal(second.ok, false)
})
