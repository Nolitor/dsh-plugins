/**
 * `opencode serve` discovery — the contract that feeds context windows AND
 * reasoning levels to the model catalog.
 *
 * Measured defect (v0.1.1): the probe spawned `serve` with a collect-mode stdout
 * (`{ maxBytes }`) and then read `handle.stdout`. `dsh-subprocess` exposes that
 * raw stream only for `stdout: 'pipe'` (types.d.ts:159), so `handle.stdout` was
 * `undefined`, discovery always returned null, and every route silently fell
 * back to the 32768-token floor with **no** variants — which is exactly why the
 * prompt had no thinking levels.
 *
 * These tests pin both halves: the spawn disposition and the banner/parsing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { discoverModelsViaServe, parseServeBanner } from '../lib/provider.js'

/** Fake ctx.subprocess: records the spawn request and replays a banner stream. */
function serveCtx(chunks, options = {}) {
  const calls = []
  const ctx = {
    calls,
    subprocess: {
      async resolveExecutable(name) {
        return `/fake/bin/${name}`
      },
      spawn(request) {
        calls.push(request)
        const done = Promise.resolve({ exitCode: options.exitCode ?? 0, signal: null })
        const stdout = options.noStream
          ? undefined
          : (async function* () {
              for (const chunk of chunks) yield new TextEncoder().encode(chunk)
              if (options.hang) await new Promise((resolve) => setTimeout(resolve, 5000))
              await done
            })()
        return {
          stdout,
          collected: {
            stderr: { readFrom: () => ({ text: '', lossy: false }) },
          },
          done,
          terminate() {},
          waitForExit: async () => true,
        }
      },
    },
  }
  return ctx
}

const BANNER = 'server listening on http://127.0.0.1:42111\nserver password hunter2\n'
const PAYLOAD = {
  data: [
    {
      id: 'deepseek-v4.1-flash',
      modelID: 'deepseek-v4.1-flash',
      providerID: 'opencode-go',
      name: 'DeepSeek V4.1 Flash',
      limit: { context: 1000000, output: 384000 },
      variants: [{ id: 'low' }, { id: 'high' }, { id: 'max' }],
    },
  ],
}

function withFetch(handler, run) {
  const original = globalThis.fetch
  globalThis.fetch = handler
  return run().finally(() => {
    globalThis.fetch = original
  })
}

// --- pure banner parsing ---------------------------------------------------

test('parseServeBanner extracts port and password from the measured banner', () => {
  assert.deepEqual(parseServeBanner(BANNER), { port: 42111, password: 'hunter2' })
})

test('parseServeBanner accepts a banner without a password and rejects partial text', () => {
  assert.deepEqual(parseServeBanner('server listening on http://127.0.0.1:5\n'), { port: 5, password: '' })
  assert.equal(parseServeBanner('server listening on http://127.0.0.1'), null)
  assert.equal(parseServeBanner(''), null)
})

// --- spawn disposition + payload mapping -----------------------------------

test('discovery spawns serve with stdout: "pipe" (collect mode has no readable stream)', async () => {
  const ctx = serveCtx([BANNER])
  await withFetch(
    async () => ({ ok: true, json: async () => PAYLOAD }),
    () => discoverModelsViaServe(ctx, { opencodePath: 'opencode', envNames: ['PATH'], cwd: '/tmp', timeoutMs: 5000 }),
  )
  const request = ctx.calls[0]
  assert.equal(request.argv[1], 'serve')
  assert.equal(request.stdio.stdout, 'pipe')
  assert.equal(request.stdio.stdin, 'ignore')
  // stderr stays bounded collection: serve logs would otherwise flood the host.
  assert.equal(typeof request.stdio.stderr, 'object')
})

test('discovery maps variants and limits from the live /api/model payload', async () => {
  const ctx = serveCtx([BANNER])
  const result = await withFetch(
    async (url, init) => {
      assert.match(url, /^http:\/\/127\.0\.0\.1:42111\/api\/model$/)
      assert.equal(init.headers.authorization, `Basic ${Buffer.from('opencode:hunter2').toString('base64')}`)
      return { ok: true, json: async () => PAYLOAD }
    },
    () => discoverModelsViaServe(ctx, { opencodePath: 'opencode', envNames: ['PATH'], cwd: '/tmp', timeoutMs: 5000 }),
  )
  assert.deepEqual(result.models[0], {
    id: 'opencode-go/deepseek-v4.1-flash',
    name: 'DeepSeek V4.1 Flash',
    inputModalities: ['text'],
    contextWindow: 1000000,
    maxTokens: 384000,
    variants: ['low', 'high', 'max'],
  })
})

test('discovery reads a banner split across chunks', async () => {
  const ctx = serveCtx(['server listening on http://127.0.0.1:4211', '1\nserver pass', 'word hunter2\n'])
  const result = await withFetch(
    async () => ({ ok: true, json: async () => PAYLOAD }),
    () => discoverModelsViaServe(ctx, { opencodePath: 'opencode', envNames: ['PATH'], cwd: '/tmp', timeoutMs: 5000 }),
  )
  assert.equal(result.models.length, 1)
})

// --- regression pins -------------------------------------------------------

test('discovery without a readable stdout returns null instead of inventing a catalog', async () => {
  const ctx = serveCtx([BANNER], { noStream: true })
  const result = await withFetch(
    async () => ({ ok: true, json: async () => PAYLOAD }),
    () => discoverModelsViaServe(ctx, { opencodePath: 'opencode', envNames: ['PATH'], cwd: '/tmp', timeoutMs: 5000 }),
  )
  assert.equal(result, null)
})

test('discovery gives up on its own readiness budget instead of hanging', async () => {
  const ctx = serveCtx([], { hang: true })
  const started = Date.now()
  const result = await withFetch(
    async () => ({ ok: true, json: async () => PAYLOAD }),
    () => discoverModelsViaServe(ctx, { opencodePath: 'opencode', envNames: ['PATH'], cwd: '/tmp', timeoutMs: 60 }),
  )
  assert.equal(result, null)
  assert.ok(Date.now() - started < 2000, 'readiness budget must bound the wait')
})

test('discovery returns null when /api/model is not ok', async () => {
  const ctx = serveCtx([BANNER])
  const result = await withFetch(
    async () => ({ ok: false, json: async () => ({}) }),
    () => discoverModelsViaServe(ctx, { opencodePath: 'opencode', envNames: ['PATH'], cwd: '/tmp', timeoutMs: 5000 }),
  )
  assert.equal(result, null)
})
