/**
 * Protocol conformance: one recorded google-generative-sse stream through the
 * router binding that speaks it, plus the request-side thoughtSignature rule.
 *
 * Two independent promises are pinned here.
 *
 * RESPONSE: Gemini's wire streams WHOLE parts, not deltas — a frame carries a
 * complete `{ text }` or a complete `{ functionCall }` — and `usageMetadata` is
 * cumulative across frames. The Antigravity binding re-standardizes that once
 * (`vendor/antigravity/lib/stream-contract.js`) and the shared `lib/stream` pipe
 * owns the block lifecycle, so the recorded bytes must land on the same
 * canonical semantic view every other wire produces.
 *
 * REQUEST: the opaque `thoughtSignature` is a PART-level sibling of
 * `functionCall`, never a field inside it. That is the 2026-11-14 fix; nesting it
 * is HTTP 400, measured live:
 *
 *   Unknown name "thoughtSignature" at
 *   'request.contents[5].parts[0].function_call': Cannot find field.
 *
 * The signature must survive a replay (Gemini 3/4 reject the NEXT request when a
 * replayed call is missing it), so the assertion has two halves: the signature
 * IS present on a signed call, and it is never reachable at
 * `functionCall.thoughtSignature`.
 *
 * Covered: reasoning parts (`thought: true`), text parts, a whole `functionCall`,
 * the finish reason, and cumulative usage buckets (input / output / cache-read /
 * reasoning / total). Not covered: vendor HTTP, retries, catalog/pricing facts.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

import { normalizeStream, readSseEvents } from '../../lib/stream/index.js'
import { STREAM_DESCRIPTOR, STREAM_HOOKS } from '../../vendor/antigravity/lib/stream-contract.js'
import { toContents } from '../../vendor/antigravity/lib/wire.js'

/** One recorded google-generative-sse SSE body (frames wrapped in `{ response }`). */
const FIXTURE = readFileSync(new URL('./fixtures/google-generative-sse.sse', import.meta.url), 'utf8')

/**
 * Drive the real Antigravity binding over the recorded fixture.
 *
 * The hook set is pure (`STREAM_HOOKS`), so one shared object is correct here —
 * unlike a stateful provider's per-stream factory.
 *
 * @returns {Promise<object[]>} every normalized chunk, in wire order.
 */
async function chunksOf(body = FIXTURE) {
  const chunks = []
  for await (const chunk of normalizeStream({
    events: readSseEvents(new Response(body).body, { malformed: STREAM_DESCRIPTOR.malformedRecord }),
    descriptor: STREAM_DESCRIPTOR,
    hooks: STREAM_HOOKS,
    signal: undefined,
  })) chunks.push(chunk)
  return chunks
}

/**
 * Collapse raw stream chunks onto the canonical semantic view.
 *
 * Mirrors the other conformance fixtures so the three wires are directly
 * comparable; the tool-call `thoughtSignature` is carried in a separate field
 * because it is wire-specific, not part of the shared chunk contract's required
 * shape.
 *
 * @param {object[]} chunks - normalized chunks from the binding.
 * @returns {object} the canonical semantic view.
 */
function project(chunks) {
  const view = { reasoning: '', text: '', tool: null, finish: null, usage: null }
  for (const chunk of chunks) {
    if (chunk.type === 'reasoning-delta') view.reasoning += chunk.text
    else if (chunk.type === 'text-delta') view.text += chunk.text
    else if (chunk.type === 'block-end' && chunk.block?.type === 'tool-call') {
      view.tool = {
        id: chunk.block.id,
        name: chunk.block.name,
        arguments: chunk.block.arguments,
        thoughtSignature: chunk.block.thoughtSignature,
      }
    } else if (chunk.type === 'finish') view.finish = chunk.reason
    else if (chunk.type === 'usage') view.usage = { ...chunk.usage }
  }
  return view
}

/** One assistant turn that replayed a signed tool call, and one unsigned call. */
const REPLAY_MESSAGES = Object.freeze([
  Object.freeze({ role: 'user', content: 'go' }),
  Object.freeze({
    role: 'assistant',
    content: [
      Object.freeze({
        type: 'tool-call',
        id: 'call_g1',
        name: 'lookup',
        arguments: '{"q":"x"}',
        thoughtSignature: 'sig_replay_1',
      }),
    ],
  }),
  Object.freeze({
    role: 'assistant',
    content: [
      Object.freeze({ type: 'tool-call', id: 'call_g2', name: 'lookup', arguments: '{"q":"y"}' }),
    ],
  }),
])

/**
 * Collect the `parts` arrays of every `contents` entry as `{ role, parts }`.
 * @param {object[]} messages - DSH request messages.
 * @returns {{role: string, parts: object[]}[]} the provider-side contents.
 */
function contentsOf(messages) {
  const { contents } = toContents(messages, undefined)
  return contents
}

/**
 * Find the part carrying one functionCall, by call id.
 * @param {object[]} contents - provider contents.
 * @param {string} id - the call id to find.
 * @returns {{turn: object, part: object, partIndex: number}} the located part.
 */
function partFor(contents, id) {
  for (const turn of contents) {
    const partIndex = turn.parts.findIndex((part) => part?.functionCall?.id === id)
    if (partIndex !== -1) return { turn, part: turn.parts[partIndex], partIndex }
  }
  throw new Error(`no part carries functionCall id ${id}`)
}

/**
 * Recursively locate every key path equal to `key`.
 *
 * The negative half of the request rule must prove absence, not merely "the
 * top-level key is elsewhere": a nested `functionCall.thoughtSignature` would
 * still be HTTP 400, so the assertion walks the whole subtree.
 *
 * @param {unknown} node - value to search.
 * @param {string} key - the property name to hunt for.
 * @param {string} [path] - path accumulated so far, for the message.
 * @returns {string[]} every dotted path where `key` occurs.
 */
function pathsOfKey(node, key, path = '') {
  const found = []
  if (Array.isArray(node)) {
    node.forEach((child, index) => {
      found.push(...pathsOfKey(child, key, `${path}[${index}]`))
    })
    return found
  }
  if (node === null || typeof node !== 'object') return found
  for (const [name, value] of Object.entries(node)) {
    const here = path === '' ? name : `${path}.${name}`
    if (name === key) found.push(here)
    found.push(...pathsOfKey(value, key, here))
  }
  return found
}

test('the google-generative-sse stream normalizes onto the pinned canonical view', async () => {
  const view = project(await chunksOf())

  // Pinned literally, not just "it parses": a dropped thought part, an
  // unstringified `args` object, or an invented total must fail here.
  assert.deepEqual(view, {
    reasoning: 'think ',
    text: 'answer',
    tool: {
      id: 'call_g1',
      name: 'lookup',
      arguments: '{"q":"x"}',
      thoughtSignature: 'sig_replay_1',
    },
    finish: { kind: 'tool-calls' },
    usage: {
      // promptTokenCount 120 INCLUDES the 20 cached tokens, so the shared writer
      // splits the cache out instead of double-counting it.
      inputTokens: 100,
      outputTokens: 30,
      cacheReadTokens: 20,
      reasoningTokens: 5,
      // totalTokenCount 155 agrees with prompt+output+reasoning (120+30+5), which
      // is the Gemini formula — a provider total that did not reconcile is dropped.
      totalTokens: 155,
    },
  })
})

test('the fixture exercises every signal the conformance view reads', async () => {
  const chunks = await chunksOf()
  const view = project(chunks)

  assert.notEqual(view.reasoning, '', 'a `thought: true` part must become reasoning')
  assert.notEqual(view.text, '', 'a plain `{ text }` part must become text')
  assert.ok(view.tool?.id && view.tool?.name && view.tool?.arguments, 'the whole functionCall must arrive')

  // This wire sends COMPLETE calls: the block is opened and finished by one
  // frame, so the arguments string is produced by the pipe's single stringify.
  assert.equal(view.tool.arguments, '{"q":"x"}', 'args must arrive as a raw JSON string, not an object')
  assert.ok(
    chunks.filter((chunk) => chunk.type === 'tool-call-delta').length === 1,
    'a complete call must emit exactly one tool-call-delta (no fragment ordinals)',
  )

  // Gemini reports STOP on a turn that only called a tool; the pipe promotes an
  // observed tool call from `stop` to `tool-calls`, so the host cannot tell the
  // wires apart.
  assert.deepEqual(view.finish, { kind: 'tool-calls' }, 'STOP after a functionCall must promote to tool-calls')

  assert.equal(view.usage?.cacheReadTokens, 20, 'cachedContentTokenCount must be its own bucket')
  assert.equal(view.usage?.reasoningTokens, 5, 'thoughtsTokenCount must be reported as reasoning')
  assert.equal(view.usage?.totalTokens, 155, 'a reconciling provider total must be preserved')

  // Cumulative, never summed: the LAST frame's usageMetadata is the turn total.
  assert.equal(view.usage?.outputTokens, 30, 'usageMetadata must be taken as cumulative, not added up')
})

test('a replayed thoughtSignature is a PART-level sibling of functionCall', () => {
  const contents = contentsOf(REPLAY_MESSAGES)
  const { part } = partFor(contents, 'call_g1')

  // The exact shape the API accepts, pinned literally.
  assert.deepEqual(part, {
    functionCall: { name: 'lookup', args: { q: 'x' }, id: 'call_g1' },
    thoughtSignature: 'sig_replay_1',
  })

  // The signature survives the replay: without it the NEXT request is 400
  // ("Function call is missing a thought_signature...").
  assert.equal(part.thoughtSignature, 'sig_replay_1', 'the signature must be replayed on the part')
  assert.equal(Object.prototype.hasOwnProperty.call(part, 'thoughtSignature'), true)

  // The measured failure, spelled out: the signature is NOT a field of the call.
  assert.deepEqual(
    Object.keys(part).sort(),
    ['functionCall', 'thoughtSignature'],
    'the part must carry exactly the sibling keys',
  )
  assert.deepEqual(
    Object.keys(part.functionCall).sort(),
    ['args', 'id', 'name'],
    'functionCall must carry only name/args/id',
  )
  assert.equal(
    Object.prototype.hasOwnProperty.call(part.functionCall, 'thoughtSignature'),
    false,
    'thoughtSignature inside functionCall is HTTP 400: '
      + `Unknown name "thoughtSignature" at 'request.contents[N].parts[0].function_call': Cannot find field.`,
  )

  // Deep proof, not just the top level: no `thoughtSignature` may appear
  // ANYWHERE beneath a functionCall, at any depth.
  assert.deepEqual(
    pathsOfKey(part.functionCall, 'thoughtSignature'),
    [],
    'no thoughtSignature key may be reachable under functionCall',
  )
  assert.deepEqual(
    pathsOfKey(part.functionCall, 'thought_signature'),
    [],
    'nor the snake_case spelling',
  )

  // And across the whole request subtree: exactly ONE occurrence, and it is the
  // signed call's PART. Pinned at the same depth as the measured 400 —
  // `request.contents[5].parts[0]...` — so a regression that moved the key to the
  // turn, to a sibling part, or one level deeper still fails.
  assert.deepEqual(
    pathsOfKey(contents, 'thoughtSignature'),
    ['[1].parts[0].thoughtSignature'],
    'the signature must occur exactly once, on the signed call\'s part',
  )
})

test('an unsigned tool call carries no thoughtSignature key at all', () => {
  const contents = contentsOf(REPLAY_MESSAGES)
  const { part } = partFor(contents, 'call_g2')

  // Absence, not a `null`/`undefined` value: an explicit empty key is still a
  // field the API would reject, and would also replay as a fake signature.
  assert.deepEqual(part, { functionCall: { name: 'lookup', args: { q: 'y' }, id: 'call_g2' } })
  assert.equal(
    Object.prototype.hasOwnProperty.call(part, 'thoughtSignature'),
    false,
    'an unsigned call must not carry the key at all',
  )
  assert.deepEqual(pathsOfKey(part, 'thoughtSignature'), [], 'no signature may appear on an unsigned call')
  assert.deepEqual(pathsOfKey(part.functionCall, 'thoughtSignature'), [], 'nor inside its functionCall')
})

test('a malformed record fails instead of truncating the turn', async () => {
  const broken = 'data: {"response":{"candidates":[}}\n\n'
  await assert.rejects(async () => {
    await chunksOf(broken)
  }, (error) => error?.code === 'PROTOCOL_DEFECT' || /undecodable|malformed/i.test(String(error?.message)))
})
