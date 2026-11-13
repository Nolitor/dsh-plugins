/**
 * Reasoning levels (사고력) for the `opencode-agent` route.
 *
 * OpenCode v2.2.0 exposes a route's levels as model `variants`, selected on the
 * wire with `-m provider/model#variant` (`run --help`). The host shows the
 * prompt's thinking selector only for a model whose exact resolution returns
 * `reasoning` (`buildModelCatalog` in dsh-api-session-controller), and it
 * rejects an explicit effort when the adapter advertises none, so both halves
 * are covered here: advertise per route, and put the choice on argv.
 *
 * Measured v2.2.0: 45 models, 35 with variants; ids low/medium/high/xhigh/max/
 * none/minimal/thinking. An unknown variant fails the run with
 * "Variant unavailable for <provider>/<model>: <id>", so ids are passed verbatim.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  modelFromApiEntry,
  modelsFromApiPayload,
  reasoningEffortsFromVariants,
  withVariant,
} from '../lib/shared.js'
import { OpencodeLlmAdapter, Config } from '../lib/provider.js'

const RUN_STREAM =
  [
    { type: 'step_start', sessionID: 'ses_x', part: { id: 'p1', type: 'step-start' } },
    { type: 'reasoning', sessionID: 'ses_x', part: { id: 'r1', type: 'reasoning', text: 'Why.' } },
    { type: 'text', sessionID: 'ses_x', part: { id: 't1', type: 'text', text: 'Done' } },
  ]
    .map((event) => JSON.stringify(event))
    .join('\n') + '\n'

/** Fake ctx.subprocess: records argv, replays one scripted child. */
function fakeCtx(script) {
  const calls = []
  let next = 0
  return {
    calls,
    subprocess: {
      async resolveExecutable(name) {
        return `/fake/bin/${name}`
      },
      spawn(request) {
        calls.push({ argv: [...request.argv] })
        const entry = script[next++] ?? { exitCode: 0, stdout: '' }
        const collected = {
          stdout: { readFrom: () => ({ text: entry.stdout ?? '', lossy: false }) },
          stderr: { readFrom: () => ({ text: entry.stderr ?? '', lossy: false }) },
        }
        const done = Promise.resolve({ exitCode: entry.exitCode ?? 0, signal: null })
        return {
          collected,
          done,
          stdout: (async function* () {
            if (entry.stdout) yield new TextEncoder().encode(entry.stdout)
            await done
          })(),
          terminate() {},
          waitForExit: async () => true,
        }
      },
    },
  }
}

function fakeConfig(values) {
  const cache = new Map()
  return new Proxy(
    {},
    {
      get(_t, key) {
        if (!cache.has(key)) {
          const value = values[key]
          cache.set(key, { get: () => (Array.isArray(value) ? [...value] : value) })
        }
        return cache.get(key)
      },
    },
  )
}

function makeAdapter(discovered, overrides = {}) {
  const config = fakeConfig({
    opencodePath: 'opencode',
    auto: true,
    attach: '',
    pure: false,
    thinking: true,
    cwd: '/tmp',
    timeoutMs: 1800000,
    stderrMaxBytes: 65536,
    forwardEnv: ['PATH'],
    extraArgs: [],
    models: [{ id: 'default', opencodeModel: '', name: 'OpenCode (config default)' }],
    brief: 'BRIEF',
    localSessionTitles: false,
    autoDiscoverModels: true,
    discoveryTimeoutMs: 60000,
    discoveryCacheMs: 300000,
    // A throwaway catalog path. Without it the store falls back to
    // `$DSH_HOME/cache/opencode-models.json` — the OPERATOR'S live snapshot — so
    // `discover()` answered from a seeded live catalog and never called the
    // probe the test counts (measured 2026-11-13: probes was 0, passing in CI
    // and failing on a developer machine).
    catalogPath: join(mkdtempSync(join(tmpdir(), 'dsh-oc-catalog-')), 'opencode-models.json'),
    exportTimeoutMs: 0,
    ...overrides,
  })
  const ctx = fakeCtx([{ exitCode: 0, stdout: RUN_STREAM }])
  const adapter = new OpencodeLlmAdapter(ctx, config)
  if (discovered) adapter.catalog.prime({ models: discovered })
  return { adapter, ctx, config }
}

async function collect(iterable) {
  const out = []
  for await (const chunk of iterable) out.push(chunk)
  return out
}

const FLASH = {
  id: 'opencode-go/deepseek-v4.1-flash',
  name: 'DeepSeek V4.1 Flash',
  contextWindow: 1000000,
  maxTokens: 384000,
  variants: ['low', 'high', 'max'],
}

const OPTIONS = {
  provider: 'opencode-agent',
  model: 'opencode-go/deepseek-v4.1-flash',
  messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }],
}

// --- discovered variants -> host reasoning metadata ------------------------

test('/api/model variants survive entry mapping as ids', () => {
  // Real entry measured from `opencode serve` GET /api/model on v2.2.0.
  const model = modelFromApiEntry({
    id: 'deepseek-v4.1-flash',
    modelID: 'deepseek-v4.1-flash',
    providerID: 'opencode-go',
    name: 'DeepSeek V4.1 Flash',
    limit: { context: 1000000, output: 384000 },
    variants: [
      { id: 'low', settings: { reasoningEffort: 'low' } },
      { id: 'high', settings: { reasoningEffort: 'high' } },
      { id: 'max', settings: { reasoningEffort: 'max' } },
    ],
  })
  assert.deepEqual(model.variants, ['low', 'high', 'max'])
})

test('a route without variants carries no variants field', () => {
  const model = modelFromApiEntry({ id: 'big-pickle', providerID: 'opencode', variants: [] })
  assert.equal('variants' in model, false)
  const noField = modelFromApiEntry({ id: 'x', providerID: 'opencode' })
  assert.equal('variants' in noField, false)
})

test('modelsFromApiPayload keeps variants for every entry that has them', () => {
  const parsed = modelsFromApiPayload({
    data: [
      { id: 'a', providerID: 'opencode', variants: [{ id: 'high' }] },
      { id: 'b', providerID: 'opencode' },
    ],
  })
  assert.deepEqual(parsed.models[0].variants, ['high'])
  assert.equal('variants' in parsed.models[1], false)
})

test('reasoningEffortsFromVariants orders levels least to greatest with display names', () => {
  const efforts = reasoningEffortsFromVariants(['max', 'none', 'high', 'low', 'medium', 'xhigh', 'minimal'])
  assert.deepEqual(
    efforts.map((effort) => effort.id),
    ['none', 'minimal', 'low', 'medium', 'high', 'xhigh', 'max'],
  )
  assert.deepEqual(
    efforts.map((effort) => effort.name),
    ['None', 'Minimal', 'Low', 'Medium', 'High', 'Extra high', 'Max'],
  )
})

test('reasoningEffortsFromVariants dedupes and appends unknown ids in payload order', () => {
  const efforts = reasoningEffortsFromVariants(['thinking', 'high', 'high', '', null, 'brand-new'])
  assert.deepEqual(
    efforts.map((effort) => effort.id),
    ['high', 'thinking', 'brand-new'],
  )
  // An id with no label keeps itself so a future OpenCode level is still selectable.
  assert.equal(efforts.at(-1).name, 'brand-new')
})

// --- resolveModel: what the prompt's thinking selector reads --------------

test('resolveModel advertises the route variants as reasoning efforts', async () => {
  const { adapter } = makeAdapter([FLASH])
  const info = await adapter.resolveModel('opencode-agent', 'opencode-go/deepseek-v4.1-flash')
  assert.deepEqual(info.reasoning?.efforts.map((effort) => effort.id), ['low', 'high', 'max'])
  // Host semantics: absence of defaultEffort preserves OpenCode's own default.
  assert.equal('defaultEffort' in info.reasoning, false)
})

test('resolveModel omits reasoning for a route with no variants', async () => {
  const { adapter } = makeAdapter([{ ...FLASH, id: 'opencode/big-pickle', variants: undefined }])
  const info = await adapter.resolveModel('opencode-agent', 'opencode/big-pickle')
  assert.equal('reasoning' in info, false)
})

test('the default pseudo-route inherits its configured model variants', async () => {
  const { adapter } = makeAdapter([FLASH], {
    models: [{ id: 'default', opencodeModel: 'opencode-go/deepseek-v4.1-flash', name: '' }],
  })
  const info = await adapter.resolveModel('opencode-agent', 'default')
  assert.equal(info.id, 'default')
  assert.deepEqual(info.reasoning?.efforts.map((effort) => effort.id), ['low', 'high', 'max'])
})

test('an undiscovered route advertises no levels rather than inventing them', async () => {
  const { adapter } = makeAdapter(null)
  const info = await adapter.resolveModel('opencode-agent', 'opencode/unknown')
  assert.equal('reasoning' in info, false)
  assert.ok(info.context.contextWindow > 0)
})

test('advertised efforts satisfy the host normalizer contract', async () => {
  // Mirrors dsh-llm normalizeModelInfo(): non-empty list, unique non-empty ids
  // and names, and a defaultEffort (when present) inside the list.
  const { adapter } = makeAdapter([FLASH])
  const info = await adapter.resolveModel('opencode-agent', FLASH.id)
  const seen = new Set()
  assert.ok(info.reasoning.efforts.length > 0)
  for (const effort of info.reasoning.efforts) {
    assert.ok(typeof effort.id === 'string' && effort.id.length > 0)
    assert.ok(typeof effort.name === 'string' && effort.name.length > 0)
    assert.equal(seen.has(effort.id), false)
    seen.add(effort.id)
  }
})

// --- wire mapping: -m provider/model#variant ------------------------------

test('withVariant composes, replaces an existing suffix, and no-ops without a level', () => {
  assert.equal(withVariant('opencode-go/deepseek-v4.1-flash', 'high'), 'opencode-go/deepseek-v4.1-flash#high')
  assert.equal(withVariant('opencode/x#low', 'high'), 'opencode/x#high')
  assert.equal(withVariant('opencode/x', ''), 'opencode/x')
  assert.equal(withVariant('', 'high'), '')
})

test('stream puts the selected level on -m for a concrete route', async () => {
  const { adapter, ctx } = makeAdapter([FLASH])
  await collect(adapter.stream({ ...OPTIONS, reasoningEffort: 'high' }))
  const argv = ctx.calls[0].argv
  assert.ok(argv.includes('-m'))
  assert.ok(argv.includes('opencode-go/deepseek-v4.1-flash#high'))
  assert.ok(argv.includes('--thinking'))
})

test('stream leaves -m unsuffixed when no level was chosen', async () => {
  const { adapter, ctx } = makeAdapter([FLASH])
  await collect(adapter.stream(OPTIONS))
  const argv = ctx.calls[0].argv
  const at = argv.indexOf('-m')
  assert.equal(argv[at + 1], 'opencode-go/deepseek-v4.1-flash')
})

test('stream applies the level to the default route resolved model', async () => {
  const { adapter, ctx } = makeAdapter([FLASH], {
    models: [{ id: 'default', opencodeModel: 'opencode-go/deepseek-v4.1-flash', name: '' }],
  })
  await collect(adapter.stream({ ...OPTIONS, model: 'default', reasoningEffort: 'max' }))
  assert.ok(ctx.calls[0].argv.includes('opencode-go/deepseek-v4.1-flash#max'))
})

// --- catalog build: one discovery per generation, not one per route --------

test('concurrent route resolution shares one discovery probe', async () => {
  const { adapter } = makeAdapter(null)
  let probes = 0
  // The host resolves every advertised model at once when it builds the
  // prompt's catalog; each resolution must not start its own `opencode serve`.
  adapter.discoverOnce = async () => {
    probes += 1
    await new Promise((resolve) => setTimeout(resolve, 5))
    // Mirrors the real probe: it caches its own result.
    adapter.catalog.prime({ models: [FLASH] })
    return adapter.catalog.current().result
  }
  const infos = await Promise.all(
    Array.from({ length: 8 }, () => adapter.resolveModel('opencode-agent', FLASH.id)),
  )
  assert.equal(probes, 1)
  assert.ok(infos.every((info) => info.reasoning?.efforts.length === 3))

  // Cached for discoveryCacheMs: a later resolution reuses the same catalog.
  await adapter.resolveModel('opencode-agent', FLASH.id)
  assert.equal(probes, 1)
})

test('stream rejects a level the route does not advertise before spawning', async () => {
  const { adapter, ctx } = makeAdapter([{ ...FLASH, id: 'opencode/big-pickle', variants: undefined }])
  const chunks = await collect(adapter.stream({
    ...OPTIONS,
    model: 'opencode/big-pickle',
    reasoningEffort: 'high',
  }))
  assert.equal(ctx.calls.length, 0)
  assert.deepEqual(chunks, [{
    type: 'finish',
    reason: {
      kind: 'error',
      failure: {
        code: 'UNSUPPORTED_REASONING_EFFORT',
        message: 'provider "opencode-agent" model "opencode/big-pickle" does not support reasoning effort "high" (advertised: none)',
      },
    },
  }])
})

test('stream rejects a stale level on a route that advertises other levels', async () => {
  const { adapter, ctx } = makeAdapter([FLASH])
  const chunks = await collect(adapter.stream({ ...OPTIONS, reasoningEffort: 'xhigh' }))
  assert.equal(ctx.calls.length, 0)
  const failure = chunks.at(-1)?.reason?.failure
  assert.equal(failure?.code, 'UNSUPPORTED_REASONING_EFFORT')
  assert.match(failure.message, /advertised: low, high, max\)$/)
})
