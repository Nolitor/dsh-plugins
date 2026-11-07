/**
 * OpenCode bridge: daemon `/api/model` with Basic auth; reuses the vendor's
 * authHeader / serviceStateCandidates / modelsFromApiPayload.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { costFromDaemon, createOpencodeProbe, readDaemonState, toCatalogModel } from '../lib/bridges/opencode.js'
import { ProbeError } from '../lib/probe.js'

function fakeModules() {
  return {
    http: {
      authHeader: (password) => `Basic ${Buffer.from(`opencode:${password}`).toString('base64')}`,
      serviceStateCandidates: (configured) => [configured, '/home/u/.local/state/opencode/service.json'].filter(Boolean),
    },
    // Mimic the vendor parser's OUTPUT shape (modelFromApiEntry), not the raw payload.
    shared: {
      modelsFromApiPayload: (payload) => (Array.isArray(payload?.data)
        ? {
            models: payload.data.map((entry) => ({
              id: entry.id,
              name: entry.name ?? entry.id,
              inputModalities: entry.inputModalities ?? ['text'],
              contextWindow: entry.limit?.context,
              maxTokens: entry.limit?.output,
            })),
          }
        : null),
    },
  }
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
const STATE = JSON.stringify({ url: 'http://127.0.0.1:4096', password: 'pw' })

test('the probe reads the daemon state file when no slot is given', async () => {
  const seen = []
  const fetchImpl = async (url, init) => { seen.push({ url, init }); return json({ data: [{ id: 'opencode/go-1', name: 'Go 1', limit: { context: 200000, output: 8000 }, inputModalities: ['text', 'image'] }] }) }
  const probe = createOpencodeProbe({ modules: fakeModules(), fetchImpl, readFile: async () => STATE })
  const result = await probe({}, { vendorConfig: {} })
  assert.equal(seen[0].url, 'http://127.0.0.1:4096/api/model')
  assert.equal(seen[0].init.headers.authorization, `Basic ${Buffer.from('opencode:pw').toString('base64')}`)
  assert.equal(result.models[0].contextWindow, 200000)
  assert.deepEqual(result.models[0].input, ['text', 'image'])
})

test('explicit baseUrl/password and extraHeaders win', async () => {
  const seen = []
  const probe = createOpencodeProbe({ modules: fakeModules(), fetchImpl: async (url, init) => { seen.push({ url, init }); return json({ data: [] }) } })
  await probe({}, { vendorConfig: { baseUrl: 'http://127.0.0.1:5000', password: 'x', extraHeaders: { 'x-proxy': 'oc' } } })
  assert.equal(seen[0].url, 'http://127.0.0.1:5000/api/model')
  assert.equal(seen[0].init.headers['x-proxy'], 'oc')
})

test('no daemon at all is a ProbeError with a hint', async () => {
  const probe = createOpencodeProbe({ modules: fakeModules(), fetchImpl: async () => json({}), readFile: async () => { throw new Error('ENOENT') } })
  await assert.rejects(() => probe({}, { vendorConfig: {} }), (error) => error instanceof ProbeError && /serviceFile/.test(error.message))
})

test('an unexpected payload is refused', async () => {
  const probe = createOpencodeProbe({ modules: fakeModules(), fetchImpl: async () => json({ nope: true }) })
  await assert.rejects(() => probe({}, { vendorConfig: { baseUrl: 'http://x', password: 'p' } }), (error) => error instanceof ProbeError && /unexpected payload/.test(error.message))
})

test('readDaemonState skips broken files and returns the first valid one', async () => {
  const state = await readDaemonState(['/a.json', '/b.json'], async (path) => {
    if (path === '/a.json') throw new Error('missing')
    return STATE
  })
  assert.deepEqual(state, { url: 'http://127.0.0.1:4096', password: 'pw', path: '/b.json' })
})

test('readDaemonState skips a state file whose daemon is not running', async () => {
  // Measured 2026-11-08 against the live daemon: the vendor's own attach path
  // (`ServerManager.attachCandidate`) skips a state file whose pid is not
  // running and tries the NEXT candidate. This reader used to return the first
  // file that parsed, so a stale entry shadowed the live daemon.
  const STALE = JSON.stringify({ url: 'http://127.0.0.1:1', pid: 999999, password: 'x' })
  const LIVE = JSON.stringify({ url: 'http://127.0.0.1:4096', pid: 4242, password: 'pw' })
  const state = await readDaemonState(['/stale.json', '/live.json'], async (path) => {
    if (path === '/stale.json') return STALE
    return LIVE
  }, (pid) => pid === 4242)
  assert.deepEqual(state, { url: 'http://127.0.0.1:4096', password: 'pw', path: '/live.json' })
})

test('readDaemonState accepts a state file without a pid', async () => {
  const state = await readDaemonState(['/a.json'], async () => JSON.stringify({ url: 'http://127.0.0.1:4096', password: 'pw' }), () => false)
  assert.deepEqual(state, { url: 'http://127.0.0.1:4096', password: 'pw', path: '/a.json' })
})

test('readDaemonState treats pid 0 as "no pid" and accepts the file', async () => {
  // Measured 2026-11-08: the vendor's own attach path guards with a falsy
  // `if (state.pid)`, so pid 0 skips the liveness check entirely and the file
  // is adopted (the daemon is then validated by the `/api/model` request).
  // `process.kill(0, 0)` also does not throw, so a check would have said
  // "alive" anyway — the two readings agree here.
  const state = await readDaemonState(['/a.json'], async () => JSON.stringify({ url: 'http://127.0.0.1:4096', pid: 0, password: 'pw' }), () => false)
  assert.deepEqual(state, { url: 'http://127.0.0.1:4096', password: 'pw', path: '/a.json' })
})

test('readDaemonState skips a state file whose pid is a string', async () => {
  // Measured 2026-11-08: `process.kill('4242', 0)` throws ESRCH (no such
  // process) and `process.kill('abc', 0)` throws ERR_INVALID_ARG_TYPE, so the
  // vendor's `process.kill` guard THROWS and the vendor SKIPS the file. The
  // bridge mirrors that: a truthy pid that is not a positive integer is not a
  // pid, and the file is skipped rather than adopted unchecked.
  const probed = []
  const state = await readDaemonState(['/a.json', '/b.json'], async (path) => {
    if (path === '/a.json') return JSON.stringify({ url: 'http://127.0.0.1:1', pid: '4242', password: 'x' })
    return JSON.stringify({ url: 'http://127.0.0.1:4096', pid: 4242, password: 'pw' })
  }, (pid) => { probed.push(pid); return pid === 4242 })
  assert.deepEqual(state, { url: 'http://127.0.0.1:4096', password: 'pw', path: '/b.json' })
  // The string pid was never handed to the liveness probe: it is not a pid.
  assert.deepEqual(probed, [4242])
})

test('readDaemonState returns undefined when every candidate is stale', async () => {
  const state = await readDaemonState(['/a.json', '/b.json'], async (path) => {
    if (path === '/a.json') return JSON.stringify({ url: 'http://127.0.0.1:1', pid: 999999, password: 'x' })
    return JSON.stringify({ url: 'http://127.0.0.1:2', pid: '4242', password: 'y' })
  }, () => false)
  assert.equal(state, undefined)
})

test('readDaemonState accepts a live pid and rejects a dead one', async () => {
  const LIVE = JSON.stringify({ url: 'http://127.0.0.1:4096', pid: 4242, password: 'pw' })
  const DEAD = JSON.stringify({ url: 'http://127.0.0.1:1', pid: 999999, password: 'x' })
  const alive = (pid) => pid === 4242
  assert.deepEqual(
    await readDaemonState(['/live.json'], async () => LIVE, alive),
    { url: 'http://127.0.0.1:4096', password: 'pw', path: '/live.json' },
  )
  assert.equal(await readDaemonState(['/dead.json'], async () => DEAD, alive), undefined)
})

test('toCatalogModel keeps the measured fields', () => {
  // `variants: ['high']` is a reasoning LEVEL, so the route states reasoning
  // support (measured rule, 2026-11-08).
  assert.deepEqual(toCatalogModel({ id: 'p/m', name: 'M', contextWindow: 10, maxTokens: 5, inputModalities: ['text'], reasoningField: 'reasoning_content', variants: ['high'] }), {
    id: 'p/m', name: 'M', input: ['text'], contextWindow: 10, maxTokens: 5, reasoningField: 'reasoning_content', variants: ['high'], reasoning: true,
  })
})

test('toCatalogModel reports reasoning only when the route states it', () => {
  // Measured 2026-11-08 (53 live routes): a route advertises reasoning through a
  // level other than `none` or through `compatibility.reasoningField`. When it
  // states neither, the flag is OMITTED so the upstream layer's own value
  // survives the field-level merge instead of being overwritten with `false`.
  assert.equal(toCatalogModel({ id: 'p/m', variants: ['none'] }).reasoning, undefined)
  assert.equal(toCatalogModel({ id: 'p/m', variants: [] }).reasoning, undefined)
  assert.equal(toCatalogModel({ id: 'p/m', variants: ['none', 'high'] }).reasoning, true)
  assert.equal(toCatalogModel({ id: 'p/m', variants: [], reasoningField: 'reasoning_content' }).reasoning, true)
  assert.equal('reasoning' in toCatalogModel({ id: 'p/m' }), false)
})

test('costFromDaemon maps the measured price record', () => {
  // Measured 2026-11-08 (daemon v2.2.6): rates are US$ per 1M tokens; a tier
  // carries `tier.size`, which is the router's `inputTokensAbove`.
  assert.deepEqual(costFromDaemon([{ input: 0.834, output: 2.501, cache: { read: 0.042, write: 0 } }]), {
    input: 0.834, output: 2.501, cacheRead: 0.042, cacheWrite: 0,
  })
  assert.deepEqual(costFromDaemon([
    { input: 0.1, output: 0.5, cache: { read: 0.01, write: 0.125 } },
    { tier: { type: 'context', size: 100000 }, input: 0.5, output: 2.5, cache: { read: 0.05, write: 0.625 } },
  ]), {
    input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125,
    tiers: [{ inputTokensAbove: 100000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 }],
  })
  // A free route is a real all-zero record, not an absent one.
  assert.deepEqual(costFromDaemon([{ input: 0, output: 0, cache: { read: 0, write: 0 } }]), {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
  })
  assert.equal(costFromDaemon([]), undefined)
  assert.equal(costFromDaemon(undefined), undefined)
  // An incomplete record is dropped, never padded with a fabricated 0:
  // `calculateCost()` throws on a missing rate.
  assert.equal(costFromDaemon([{ input: 1, output: 2 }]), undefined)
})

test('costFromDaemon never fabricates a 0 from a non-number rate', () => {
  // Measured 2026-11-08: `Number(value)` turns `null` into 0, `''` into 0,
  // `false` into 0 and `[]` into 0 — so a rate the daemon never stated became
  // a REAL zero rate, contradicting the "an incomplete record is dropped,
  // never padded with 0" contract (a fabricated 0 under-bills silently, and
  // `calculateCost()` then prices the request at zero instead of failing).
  // Only a finite number is a rate; everything else drops the record.
  const withRate = (input) => [{ input, output: 2, cache: { read: 0, write: 0 } }]
  for (const value of [null, '', false, [], '0.5', '1', NaN, Infinity, -1]) {
    assert.equal(costFromDaemon(withRate(value)), undefined, `rate ${JSON.stringify(value)} must not become a cost record`)
  }
  // The same rule applies to the cache rates and to the output rate.
  assert.equal(costFromDaemon([{ input: 1, output: null, cache: { read: 0, write: 0 } }]), undefined)
  assert.equal(costFromDaemon([{ input: 1, output: 2, cache: { read: '', write: 0 } }]), undefined)
  assert.equal(costFromDaemon([{ input: 1, output: 2, cache: { read: 0, write: null } }]), undefined)
  // A REAL zero rate is still a rate: a free route is not an absent one.
  assert.deepEqual(costFromDaemon([{ input: 0, output: 0, cache: { read: 0, write: 0 } }]), {
    input: 0, output: 0, cacheRead: 0, cacheWrite: 0,
  })
})

test('costFromDaemon emits only context tiers', () => {
  // Measured 2026-11-08 from the opencode binary's own billing function
  // (`py(e, a)`), whose tier filter is
  //   `e.filter((d) => d.tier?.type === "context" && s > d.tier.size)`:
  // only a tier whose type is exactly "context" is a context tier. Measured
  // over the live 53-route payload, "context" is the only tier type present,
  // so a tier of any other type is a shape the daemon does not bill by
  // context and must not become a router tier.
  const base = { input: 0.1, output: 0.5, cache: { read: 0.01, write: 0.125 } }
  const tierRates = { input: 0.5, output: 2.5, cache: { read: 0.05, write: 0.625 } }
  assert.equal(costFromDaemon([base, { tier: { type: 'image', size: 5 }, ...tierRates }]).tiers, undefined)
  assert.equal(costFromDaemon([base, { tier: { size: 5 }, ...tierRates }]).tiers, undefined)
  assert.equal(costFromDaemon([base, { tier: { type: 'Context', size: 5 }, ...tierRates }]).tiers, undefined)
  // A context tier is still emitted, with `tier.size` as `inputTokensAbove`.
  assert.deepEqual(costFromDaemon([base, { tier: { type: 'context', size: 100000 }, ...tierRates }]).tiers, [
    { inputTokensAbove: 100000, input: 0.5, output: 2.5, cacheRead: 0.05, cacheWrite: 0.625 },
  ])
})

test('costFromDaemon keeps the first tier of a duplicated tier size', () => {
  // The duplicate-size contract was undefined; it is now "first wins".
  // Measured 2026-11-08: the daemon's own billing sorts the matching tiers
  // by `tier.size` DESCENDING and takes `[0]`, and its `toSorted` is STABLE,
  // so it keeps the FIRST of a tied group. The router's own selector
  // (`lib/cost.js` `ratesFor`) agrees — it only replaces the matched rates on
  // a STRICT `inputTokensAbove > matchedThreshold`, so the first tier of a
  // tied group wins. Both measured rules keep the first, so the bridge keeps
  // the first too.
  const base = { input: 0.1, output: 0.5, cache: { read: 0.01, write: 0.125 } }
  const first = { tier: { type: 'context', size: 100000 }, input: 11, output: 11, cache: { read: 0.1, write: 0.1 } }
  const second = { tier: { type: 'context', size: 100000 }, input: 22, output: 22, cache: { read: 0.2, write: 0.2 } }
  assert.deepEqual(costFromDaemon([base, first, second]).tiers, [
    { inputTokensAbove: 100000, input: 11, output: 11, cacheRead: 0.1, cacheWrite: 0.1 },
  ])
  // The tie resolves by ARRAY ORDER, so a swapped array keeps the other one.
  assert.deepEqual(costFromDaemon([base, second, first]).tiers, [
    { inputTokensAbove: 100000, input: 22, output: 22, cacheRead: 0.2, cacheWrite: 0.2 },
  ])
  // Distinct sizes are all kept, ascending.
  assert.deepEqual(costFromDaemon([
    base,
    { tier: { type: 'context', size: 200000 }, input: 3, output: 3, cache: { read: 0, write: 0 } },
    { tier: { type: 'context', size: 100000 }, input: 2, output: 2, cache: { read: 0, write: 0 } },
  ]).tiers.map((tier) => tier.inputTokensAbove), [100000, 200000])
})

test('toCatalogModel carries the daemon price record when the raw entry has one', () => {
  const model = toCatalogModel({ id: 'opencode-go/hy4', name: 'Hy4', contextWindow: 1048576, maxTokens: 65536, inputModalities: ['text', 'image'] }, {
    cost: [{ input: 0.834, output: 2.501, cache: { read: 0.042, write: 0 } }],
  })
  assert.deepEqual(model.cost, { input: 0.834, output: 2.501, cacheRead: 0.042, cacheWrite: 0 })
})

test('the probe hands the daemon price record to every parsed route', async () => {
  // Measured 2026-11-08: the vendor parser drops `cost`, so the bridge indexes
  // the raw entries by `${providerID}/${modelID}` and maps the price itself.
  const payload = {
    data: [
      { providerID: 'opencode-go', id: 'hy4', modelID: 'hy4', name: 'Hy4', limit: { context: 1048576, output: 65536 }, capabilities: { input: ['text', 'image'] }, variants: [{ id: 'high' }], cost: [{ input: 0.834, output: 2.501, cache: { read: 0.042, write: 0 } }] },
      { providerID: 'opencode', id: 'beam-free', modelID: 'beam-free', name: 'Beam Free', limit: { context: 262144, output: 131072 }, capabilities: { input: ['text'] }, variants: [], cost: [{ input: 0, output: 0, cache: { read: 0, write: 0 } }] },
    ],
  }
  const modules = {
    http: { authHeader: () => 'Basic x', serviceStateCandidates: () => [] },
    shared: {
      modelsFromApiPayload: (body) => ({
        models: body.data.map((entry) => ({
          id: `${entry.providerID}/${entry.modelID}`,
          name: entry.name,
          inputModalities: entry.capabilities.input.includes('image') ? ['text', 'image'] : ['text'],
          contextWindow: entry.limit.context,
          maxTokens: entry.limit.output,
          variants: entry.variants.map((v) => v.id),
        })),
      }),
    },
  }
  const probe = createOpencodeProbe({ modules, fetchImpl: async () => json(payload) })
  const result = await probe({}, { vendorConfig: { baseUrl: 'http://x', password: 'p' } })
  assert.equal(result.models.length, 2)
  assert.deepEqual(result.models[0].cost, { input: 0.834, output: 2.501, cacheRead: 0.042, cacheWrite: 0 })
  assert.deepEqual(result.models[1].cost, { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 })
  assert.equal(result.models[0].reasoning, true)
  assert.equal(result.models[1].reasoning, undefined)
})
