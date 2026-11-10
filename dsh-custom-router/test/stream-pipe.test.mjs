import test from 'node:test'
import assert from 'node:assert/strict'
import { normalizeStream, CODES } from '../lib/stream/index.js'

/** A provider-shaped fixture: one payload -> one normalized record. */
function hooksFor(map, overrides = {}) {
  return { readEvent: (payload) => map(payload), ...overrides }
}

async function* payloads(...items) {
  for (const item of items) yield item
}

async function collect(stream) {
  const out = []
  for await (const chunk of stream) out.push(chunk)
  return out
}

const run = (items, descriptor = {}, hooks = {}) =>
  collect(normalizeStream({
    events: payloads(...items),
    descriptor,
    hooks: hooksFor((payload) => payload, hooks),
  }))

const shape = (chunks) => chunks.map((chunk) => {
  if (chunk.type === 'block-end') return `${chunk.type}:${chunk.index}:${chunk.block.type}:${chunk.block.text ?? chunk.block.name}`
  if (chunk.type === 'finish') return `${chunk.type}:${chunk.reason.kind}:${chunk.reason.failure?.code ?? ''}`
  if (chunk.type === 'usage') return `${chunk.type}:${chunk.usage.totalTokens ?? '-'}`
  if (chunk.type === 'block-start') return `${chunk.type}:${chunk.index}:${chunk.blockType}`
  return `${chunk.type}:${chunk.index}:${chunk.text ?? chunk.argumentsDelta}`
})

test('text, reasoning and a tool call land in first-seen order', async () => {
  const chunks = await run([
    { parts: [{ kind: 'reasoning', text: 'think' }] },
    { parts: [{ kind: 'text', text: 'hello' }] },
    { parts: [{ kind: 'tool-call', index: 0, id: 'c1', name: 'bash', argumentsDelta: '{"a":1}' }] },
    { finish: 'tool_calls' },
  ])
  assert.deepEqual(shape(chunks), [
    'block-start:0:reasoning',
    'reasoning-delta:0:think',
    'block-start:1:text',
    'text-delta:1:hello',
    'block-start:2:tool-call',
    'tool-call-delta:2:{"a":1}',
    'block-end:0:reasoning:think',
    'block-end:1:text:hello',
    'block-end:2:tool-call:bash',
    'finish:tool-calls:',
  ])
})

test('block-end carries the fully accumulated block, never a placeholder', async () => {
  const chunks = await run([
    { parts: [{ kind: 'text', text: 'ab' }] },
    { parts: [{ kind: 'text', text: 'cd' }] },
  ])
  const end = chunks.find((chunk) => chunk.type === 'block-end')
  assert.deepEqual(end.block, { type: 'text', text: 'abcd' })
})

test('usage is emitted strictly before the terminal finish and nothing follows it', async () => {
  const chunks = await run([
    { parts: [{ kind: 'text', text: 'x' }] },
    { usage: { prompt_tokens: 10, completion_tokens: 2 }, finish: 'stop' },
  ])
  const kinds = chunks.map((chunk) => chunk.type)
  assert.ok(kinds.indexOf('block-end') < kinds.indexOf('usage'))
  assert.equal(kinds.at(-1), 'finish')
  assert.equal(kinds.indexOf('usage'), kinds.length - 2)
})

test('indexes are allocated first-seen, not from fixed constants', async () => {
  const first = await run([{ parts: [{ kind: 'text', text: 'a' }] }, { parts: [{ kind: 'reasoning', text: 'r' }] }])
  assert.deepEqual(first.filter((c) => c.type === 'block-start').map((c) => [c.index, c.blockType]), [[0, 'text'], [1, 'reasoning']])

  const second = await run([{ parts: [{ kind: 'reasoning', text: 'r' }] }, { parts: [{ kind: 'text', text: 'a' }] }])
  assert.deepEqual(second.filter((c) => c.type === 'block-start').map((c) => [c.index, c.blockType]), [[0, 'reasoning'], [1, 'text']])
})

test('an argument-only fragment stays silent until the call has identity', async () => {
  const chunks = await run([
    { parts: [{ kind: 'tool-call', index: 0, argumentsDelta: '{"a":' }] },
    { parts: [{ kind: 'tool-call', index: 0, id: 'c1', name: 'bash', argumentsDelta: '1}' }] },
    { finish: 'tool_calls' },
  ])
  assert.deepEqual(shape(chunks), [
    'block-start:0:tool-call',
    'tool-call-delta:0:{"a":1}',
    'block-end:0:tool-call:bash',
    'finish:tool-calls:',
  ])
})

test('a nameless call that never gains identity is not emitted at all', async () => {
  const chunks = await run([{ parts: [{ kind: 'tool-call', index: 0, argumentsDelta: '{}' }] }])
  assert.deepEqual(shape(chunks), ['finish:error:EMPTY_RESPONSE'])
})

test('a complete-shape provider emits one delta and one block per whole call', async () => {
  const chunks = await run([
    { parts: [{ kind: 'tool-call', id: 'g1', name: 'read_file', arguments: { path: '/tmp/x' } }] },
    { parts: [{ kind: 'tool-call', id: 'g2', name: 'list', arguments: '{}' }] },
    { finish: 'STOP' },
  ], { toolCallShape: 'complete' })
  const deltas = chunks.filter((chunk) => chunk.type === 'tool-call-delta')
  assert.deepEqual(deltas.map((chunk) => [chunk.id, chunk.name, chunk.argumentsDelta]), [
    ['g1', 'read_file', '{"path":"/tmp/x"}'],
    ['g2', 'list', '{}'],
  ])
  assert.equal(chunks.filter((chunk) => chunk.type === 'block-end').length, 2)
  assert.equal(chunks.at(-1).reason.kind, 'tool-calls')
})

test('a mapped stop is promoted to tool-calls when a tool block closed', async () => {
  const chunks = await run([
    { parts: [{ kind: 'tool-call', index: 0, id: 'c1', name: 'bash', argumentsDelta: '{}' }] },
    { finish: 'STOP' },
  ])
  assert.deepEqual(chunks.at(-1).reason, { kind: 'tool-calls' })
})

test('an empty completion is one in-band terminal error, with usage first', async () => {
  const chunks = await run([{ usage: { prompt_tokens: 5, completion_tokens: 0 }, finish: 'stop' }])
  assert.deepEqual(shape(chunks), ['usage:-', 'finish:error:EMPTY_RESPONSE'])
})

test('a filtered finish is an error even when text streamed', async () => {
  const chunks = await run([{ parts: [{ kind: 'text', text: 'partial' }] }, { finish: 'content_filter' }])
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, CODES.CONTENT_FILTERED)
})

test('a cut preserves the partial blocks and keeps the original cause', async () => {
  const stream = normalizeStream({
    events: (async function* () {
      yield { parts: [{ kind: 'text', text: 'so far' }] }
      throw Object.assign(new Error('socket hang up'), { code: 'ECONNRESET' })
    })(),
    hooks: hooksFor((payload) => payload),
  })
  const chunks = await collect(stream)
  assert.equal(chunks.find((chunk) => chunk.type === 'block-end').block.text, 'so far')
  assert.equal(chunks.at(-1).reason.kind, 'error')
  assert.equal(chunks.at(-1).reason.failure.code, 'ECONNRESET')
  assert.equal(chunks.at(-1).reason.failure.message, 'socket hang up')
})

test('an aborted signal closes blocks and ends as aborted, never as a clean stop', async () => {
  const controller = new AbortController()
  const stream = normalizeStream({
    events: (async function* () {
      yield { parts: [{ kind: 'text', text: 'x' }] }
      controller.abort()
      yield { parts: [{ kind: 'text', text: 'y' }] }
    })(),
    hooks: hooksFor((payload) => payload),
    signal: controller.signal,
  })
  const chunks = await collect(stream)
  assert.equal(chunks.at(-1).reason.kind, 'aborted')
  assert.equal(chunks.at(-1).reason.failure.code, CODES.ABORTED)
})

test('a provider defect fails by default and is skippable only through the hook', async () => {
  await assert.rejects(
    async () => run([{ defect: { code: CODES.PROTOCOL_DEFECT, message: 'bad payload' } }]),
    (error) => error.code === CODES.PROTOCOL_DEFECT,
  )
  const skipped = await run(
    [{ defect: { code: CODES.PROTOCOL_DEFECT, message: 'bad payload' } }, { parts: [{ kind: 'text', text: 'ok' }] }],
    {},
    { onMalformed: () => 'skip' },
  )
  assert.equal(skipped.at(-1).reason.kind, 'stop')
  assert.equal(skipped.find((chunk) => chunk.type === 'block-end').block.text, 'ok')
})

test('a provider can override the finish table without editing the core', async () => {
  const chunks = await run(
    [{ parts: [{ kind: 'text', text: 'x' }] }, { finish: 'quota_wall' }],
    {},
    { mapFinish: (value) => ({ kind: 'error', failure: { code: 'QUOTA', message: `custom: ${value}` } }) },
  )
  assert.equal(chunks.at(-1).reason.failure.code, 'QUOTA')
})

test('a provider can supply its own usage writer without editing the core', async () => {
  const chunks = await run(
    [{ usage: { weird: 1 } }, { parts: [{ kind: 'text', text: 'x' }] }],
    {},
    { usageFrom: (raw) => ({ inputTokens: raw.weird, outputTokens: 0 }) },
  )
  assert.deepEqual(chunks.find((chunk) => chunk.type === 'usage').usage, { inputTokens: 1, outputTokens: 0 })
})

test('classifyText is the only hook that can turn text into a tool call', async () => {
  const withHook = await run(
    [{ parts: [{ kind: 'text', text: '[tool call bash #1]: {}' }] }, { finish: 'stop' }],
    {},
    { classifyText: () => ([{ kind: 'tool-call', index: 0, id: 't1', name: 'bash', argumentsDelta: '{}' }]) },
  )
  assert.ok(withHook.some((chunk) => chunk.type === 'tool-call-delta'))

  const wireOnly = await run([{ parts: [{ kind: 'text', text: '[tool call bash #1]: {}' }] }, { finish: 'stop' }])
  assert.equal(wireOnly.some((chunk) => chunk.type === 'tool-call-delta'), false)
  assert.equal(wireOnly.find((chunk) => chunk.type === 'block-end').block.text, '[tool call bash #1]: {}')
})

test('a pass-through pipeline needs no hooks beyond readEvent', async () => {
  const chunks = await run([{ parts: [{ kind: 'text', text: 'plain' }] }, { finish: 'stop' }])
  assert.deepEqual(shape(chunks), ['block-start:0:text', 'text-delta:0:plain', 'block-end:0:text:plain', 'finish:stop:'])
})

test('the pipeline refuses to run without a provider mapping', async () => {
  await assert.rejects(async () => collect(normalizeStream({ events: payloads() })), TypeError)
  await assert.rejects(async () => collect(normalizeStream({ events: payloads(), hooks: {} })), TypeError)
})

test('an unknown tool-call shape is refused instead of guessed', async () => {
  await assert.rejects(
    async () => collect(normalizeStream({ events: payloads(), hooks: hooksFor((p) => p), descriptor: { toolCallShape: 'quantum' } })),
    TypeError,
  )
})

test('the pipeline holds no registry: it emits chunks and nothing else', async () => {
  const chunks = await run([{ parts: [{ kind: 'text', text: 'x' }] }, { finish: 'stop' }])
  const allowed = new Set(['block-start', 'text-delta', 'reasoning-delta', 'tool-call-delta', 'block-end', 'usage', 'finish'])
  for (const chunk of chunks) assert.ok(allowed.has(chunk.type), chunk.type)
})

test('createHooks is called exactly once with { descriptor, signal } and its readEvent is used', async () => {
  const descriptor = { toolCallShape: 'fragmented' }
  const controller = new AbortController()
  const calls = []
  const reads = []
  const chunks = await collect(normalizeStream({
    events: payloads(
      { parts: [{ kind: 'text', text: 'a' }] },
      { parts: [{ kind: 'text', text: 'b' }] },
      { finish: 'stop' },
    ),
    descriptor,
    signal: controller.signal,
    createHooks: (context) => {
      calls.push(context)
      return {
        readEvent: (payload) => {
          reads.push(payload)
          return payload
        },
      }
    },
  }))
  assert.equal(calls.length, 1)
  assert.equal(calls[0].descriptor, descriptor)
  assert.equal(calls[0].signal, controller.signal)
  assert.equal(reads.length, 3)
  assert.equal(chunks.at(-1).reason.kind, 'stop')
})

test('createHooks gives one state object per stream, so classifyText can count across deltas', async () => {
  const seen = []
  const chunks = await collect(normalizeStream({
    events: payloads(
      { parts: [{ kind: 'text', text: 'first' }] },
      { parts: [{ kind: 'text', text: 'second' }] },
      { finish: 'stop' },
    ),
    createHooks: () => {
      let deltas = 0
      return {
        readEvent: (payload) => payload,
        classifyText: (text) => {
          deltas += 1
          seen.push([text, deltas])
          return deltas === 1 ? undefined : [{ kind: 'tool-call', index: 0, id: 't1', name: 'bash', argumentsDelta: '{}' }]
        },
      }
    },
  }))
  assert.deepEqual(seen, [['first', 1], ['second', 2]])
  assert.equal(chunks.filter((chunk) => chunk.type === 'text-delta').map((c) => c.text).join(''), 'first')
  assert.ok(chunks.some((chunk) => chunk.type === 'tool-call-delta'))
})

test('two concurrent streams from one factory keep independent state', async () => {
  const shared = async (label) => collect(normalizeStream({
    events: payloads(
      { parts: [{ kind: 'text', text: `${label}1` }] },
      { parts: [{ kind: 'text', text: `${label}2` }] },
      { finish: 'stop' },
    ),
    createHooks: () => {
      let deltas = 0
      return {
        readEvent: (payload) => payload,
        classifyText: () => {
          deltas += 1
          return deltas === 2 ? [{ kind: 'tool-call', index: 0, id: `t_${label}`, name: 'bash', argumentsDelta: '{}' }] : undefined
        },
      }
    },
  }))
  const [left, right] = await Promise.all([shared('a'), shared('b')])
  assert.equal(left.filter((chunk) => chunk.type === 'text-delta').map((c) => c.text).join(''), 'a1')
  assert.equal(right.filter((chunk) => chunk.type === 'text-delta').map((c) => c.text).join(''), 'b1')
  assert.deepEqual(left.filter((chunk) => chunk.type === 'tool-call-delta').map((c) => c.id), ['t_a'])
  assert.deepEqual(right.filter((chunk) => chunk.type === 'tool-call-delta').map((c) => c.id), ['t_b'])
})

test('a throwing createHooks propagates before any chunk is produced', async () => {
  const emitted = []
  const stream = normalizeStream({
    events: payloads({ parts: [{ kind: 'text', text: 'never' }] }),
    createHooks: () => { throw new Error('classifier init failed') },
  })
  await assert.rejects(
    async () => {
      for await (const chunk of stream) emitted.push(chunk)
    },
    (error) => error instanceof Error && error.message === 'classifier init failed',
  )
  assert.deepEqual(emitted, [])
})

test('a createHooks result without readEvent is refused by name', async () => {
  await assert.rejects(
    async () => collect(normalizeStream({ events: payloads(), createHooks: () => ({}) })),
    (error) => error instanceof TypeError && /createHooks/.test(error.message),
  )
})

test('the legacy hooks-only path is untouched and still refuses a missing readEvent', async () => {
  const hooks = hooksFor((payload) => payload, { classifyText: () => undefined })
  const chunks = await collect(normalizeStream({
    events: payloads({ parts: [{ kind: 'text', text: 'legacy' }] }, { finish: 'stop' }),
    descriptor: {},
    hooks,
  }))
  assert.deepEqual(shape(chunks), ['block-start:0:text', 'text-delta:0:legacy', 'block-end:0:text:legacy', 'finish:stop:'])
  await assert.rejects(
    async () => collect(normalizeStream({ events: payloads(), hooks: {} })),
    (error) => error instanceof TypeError && /hooks\.readEvent/.test(error.message),
  )
})


test('an early break releases the ReadableStream lock', async () => {
  const { readSseEvents } = await import('../lib/stream/index.js')
  let cancelled = false
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode('data: {"n":1}\n\ndata: {"n":2}\n\n'))
    },
    cancel() { cancelled = true },
  })
  const seen = []
  for await (const event of readSseEvents(stream)) {
    seen.push(event)
    break
  }
  assert.deepEqual(seen, [{ n: 1 }])
  assert.equal(stream.locked, false, 'the reader lock must be released on early break')
  assert.equal(cancelled, true)
})
