#!/usr/bin/env node
/**
 * Standalone verification CLI for the shared downstream stream pipe.
 *
 * WHY THIS EXISTS: the pipe is a library, so `npm test` only proves its unit
 * behaviour. It cannot prove the thing that actually matters for a shared
 * component — that it dispatches correctly with **none of the vendor plugins
 * loadable**. This script blocks every vendor module at resolution and then
 * drives the real pipe through two independent provider hook sets.
 *
 * Usage:
 *   node scripts/verify-stream.mjs           # human report, exit 1 on failure
 *   node scripts/verify-stream.mjs --json    # machine-readable
 *   npm run verify:stream                    # same as the first form
 *
 * @module @nolit/dsh-custom-router/scripts/verify-stream
 */
import { registerHooks } from 'node:module'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const HERE = dirname(fileURLToPath(import.meta.url))
const ENTRIES = ['dsh-antigravity', 'dsh-deepinfra', 'dsh-opencode-v2']
const FORBIDDEN = ENTRIES.map((name) => new RegExp(name))
const attempted = []

// Refuse at resolution, not after import: a vendor module that is merely
// imported is already a coupling, even if nothing calls it.
registerHooks({
  resolve(specifier, context, nextResolve) {
    if (FORBIDDEN.some((re) => re.test(specifier))) {
      attempted.push(specifier)
      throw new Error(`vendor module must not load: ${specifier}`)
    }
    return nextResolve(specifier, context)
  },
})

const { normalizeStream, readSseEvents, CODES } = await import(join(HERE, '..', 'lib', 'stream', 'index.js'))

/** Split an SSE body into awkward byte-boundary chunks. */
function sseStream(text, splitAt = 7) {
  const bytes = new TextEncoder().encode(text)
  const parts = []
  for (let i = 0; i < bytes.length; i += splitAt) parts.push(bytes.slice(i, i + splitAt))
  return new ReadableStream({
    start(controller) {
      for (const part of parts) controller.enqueue(part)
      controller.close()
    },
  })
}

const frame = (payload) => `data: ${JSON.stringify(payload)}\n\n`
const DONE = 'data: [DONE]\n\n'

/** OpenAI-shaped provider: fragmented calls, reasoning folded into completion. */
const providerA = {
  descriptor: { toolCallShape: 'fragmented', usage: { totalFormula: 'prompt+output' }, malformedRecord: 'fail' },
  hooks: {
    // Measured OpenAI shape: the trailing usage frame carries NO choices, and a
    // finish frame may carry usage too. Both are reported from one payload, so
    // the hook never drops usage just because a choice was present.
    readEvent(payload) {
      const choice = payload?.choices?.[0]
      const parts = []
      if (choice !== undefined) {
        const delta = choice.delta ?? {}
        if (delta.reasoning_content) parts.push({ kind: 'reasoning', text: delta.reasoning_content })
        if (delta.content) parts.push({ kind: 'text', text: delta.content })
        for (const call of delta.tool_calls ?? []) {
          parts.push({
            kind: 'tool-call',
            index: call.index,
            id: call.id,
            name: call.function?.name,
            argumentsDelta: call.function?.arguments ?? '',
          })
        }
      }
      if (parts.length === 0 && choice === undefined && payload?.usage === undefined) return undefined
      return {
        parts,
        ...(payload?.usage === undefined ? {} : { usage: payload.usage }),
        ...(choice?.finish_reason ? { finish: choice.finish_reason } : {}),
      }
    },
  },
}

/** Gemini-shaped provider: whole calls, thoughts counted separately. */
const providerB = {
  descriptor: { toolCallShape: 'complete', usage: { totalFormula: 'prompt+output+reasoning' }, malformedRecord: 'fail' },
  hooks: {
    readEvent(payload) {
      const candidate = payload?.response?.candidates?.[0]
      if (candidate === undefined) return undefined
      const parts = []
      for (const part of candidate.content?.parts ?? []) {
        if (part.functionCall) {
          parts.push({
            kind: 'tool-call',
            id: part.functionCall.id,
            name: part.functionCall.name,
            arguments: part.functionCall.args ?? {},
          })
        } else if (part.thought === true) {
          parts.push({ kind: 'reasoning', text: part.text })
        } else if (typeof part.text === 'string') {
          parts.push({ kind: 'text', text: part.text })
        }
      }
      return {
        parts,
        ...(payload.response.usageMetadata ? { usage: payload.response.usageMetadata } : {}),
        ...(candidate.finishReason ? { finish: candidate.finishReason } : {}),
      }
    },
    usageFrom(raw) {
      return {
        inputTokens: (raw.promptTokenCount ?? 0) - (raw.cachedContentTokenCount ?? 0),
        outputTokens: raw.candidatesTokenCount ?? 0,
        ...(raw.cachedContentTokenCount ? { cacheReadTokens: raw.cachedContentTokenCount } : {}),
        ...(raw.thoughtsTokenCount ? { reasoningTokens: raw.thoughtsTokenCount } : {}),
        ...(raw.totalTokenCount ? { totalTokens: raw.totalTokenCount } : {}),
      }
    },
  },
}

async function drive(provider, body, options = {}) {
  const chunks = []
  for await (const chunk of normalizeStream({
    events: readSseEvents(sseStream(body), options),
    descriptor: provider.descriptor,
    hooks: provider.hooks,
    ...(options.signal ? { signal: options.signal } : {}),
  })) chunks.push(chunk)
  return chunks
}

const shape = (chunks) => chunks.map((chunk) => {
  if (chunk.type === 'finish') {
    return `finish:${chunk.reason.kind}${chunk.reason.failure ? ':' + chunk.reason.failure.code : ''}`
  }
  if (chunk.type === 'usage') {
    const u = chunk.usage
    return `usage:${u.inputTokens}/${u.outputTokens}/${u.reasoningTokens ?? 0}/${u.cacheReadTokens ?? 0}/${u.totalTokens ?? '-'}`
  }
  if (chunk.type === 'block-end') return `block-end:${chunk.index}:${chunk.block.type}`
  if (chunk.type === 'block-start') return `block-start:${chunk.index}:${chunk.blockType}`
  return `${chunk.type}:${chunk.index}`
})

const cases = []
const check = (name, fn) => cases.push([name, fn])

check('provider A dispatches reasoning, text and a fragmented tool call', async () => {
  const body = [
    frame({ choices: [{ delta: { reasoning_content: 'plan' } }] }),
    frame({ choices: [{ delta: { content: 'hi' } }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, id: 'c1', function: { name: 'bash', arguments: '{"a"' } }] } }] }),
    frame({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: ':1}' } }] } }] }),
    frame({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] }),
    // No total_tokens on the wire: the pipe must NOT invent one from a subset.
    frame({ usage: { prompt_tokens: 100, completion_tokens: 20, prompt_tokens_details: { cached_tokens: 80 }, completion_tokens_details: { reasoning_tokens: 5 } } }),
    DONE,
  ].join('')
  const chunks = await drive(providerA, body)
  const actual = shape(chunks)
  const expected = [
    'block-start:0:reasoning',
    'reasoning-delta:0',
    'block-start:1:text',
    'text-delta:1',
    'block-start:2:tool-call',
    'tool-call-delta:2',
    'tool-call-delta:2',
    'block-end:0:reasoning',
    'block-end:1:text',
    'block-end:2:tool-call',
    'usage:20/20/5/80/-',
    'finish:tool-calls',
  ]
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(`shape mismatch\n  expected ${JSON.stringify(expected)}\n  actual   ${JSON.stringify(actual)}`)
  }
  const call = chunks.find((c) => c.type === 'block-end' && c.block.type === 'tool-call')
  if (call.block.arguments !== '{"a":1}') throw new Error(`arguments not accumulated: ${call.block.arguments}`)
  if (call.block.name !== 'bash') throw new Error(`name lost: ${call.block.name}`)
})

check('provider B dispatches whole calls and its own usage writer', async () => {
  const body = [
    frame({ response: { candidates: [{ content: { parts: [{ text: 'think', thought: true }, { text: 'ans' }] } }] } }),
    frame({
      response: {
        candidates: [{ content: { parts: [{ functionCall: { id: 'g1', name: 'read_file', args: { path: '/tmp/x' } } }] }, finishReason: 'STOP' }],
        usageMetadata: { promptTokenCount: 18, candidatesTokenCount: 32, thoughtsTokenCount: 655, cachedContentTokenCount: 0, totalTokenCount: 705 },
      },
    }),
    DONE,
  ].join('')
  const chunks = await drive(providerB, body)
  if (chunks.at(-1).reason.kind !== 'tool-calls') throw new Error(`finish was ${chunks.at(-1).reason.kind}`)
  const calls = chunks.filter((c) => c.type === 'tool-call-delta')
  if (calls.length !== 1) throw new Error(`complete call split into ${calls.length} deltas`)
  if (calls[0].argumentsDelta !== '{"path":"/tmp/x"}') throw new Error(`arguments: ${calls[0].argumentsDelta}`)
  const usage = chunks.find((c) => c.type === 'usage').usage
  const expected = { inputTokens: 18, outputTokens: 32, reasoningTokens: 655, totalTokens: 705 }
  if (JSON.stringify(usage) !== JSON.stringify(expected)) {
    throw new Error(`usage mismatch: ${JSON.stringify(usage)}`)
  }
})

check('an absent total stays absent; an agreeing total is preserved', async () => {
  const run = (usage) => drive(providerA, frame({ choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }], usage }) + DONE)
  const absent = await run({ prompt_tokens: 100, completion_tokens: 20 })
  if (absent.find((c) => c.type === 'usage').usage.totalTokens !== undefined) {
    throw new Error('an absent total was invented')
  }
  const agreeing = await run({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 })
  if (agreeing.find((c) => c.type === 'usage').usage.totalTokens !== 120) {
    throw new Error('an agreeing total was dropped')
  }
  const wrong = await run({ prompt_tokens: 100, completion_tokens: 20, total_tokens: 999 })
  if (wrong.find((c) => c.type === 'usage').usage.totalTokens !== undefined) {
    throw new Error('an inconsistent total was repaired instead of omitted')
  }
})

check('the hook system is per-provider: same core, different shape', async () => {
  if (providerA.descriptor.toolCallShape === providerB.descriptor.toolCallShape) {
    throw new Error('the two providers must differ on toolCallShape')
  }
  const chunks = await drive(providerB, frame({ response: { candidates: [{ content: { parts: [{ text: 'x' }] }, finishReason: 'STOP' }] } }))
  if (chunks.at(-1).reason.kind !== 'stop') throw new Error('shared core changed shape')
})

check('a filtered finish is an error with a code, through the shared table', async () => {
  const chunks = await drive(providerB, frame({ response: { candidates: [{ content: { parts: [{ text: 'p' }] }, finishReason: 'SAFETY' }] } }))
  const reason = chunks.at(-1).reason
  if (reason.kind !== 'error' || reason.failure.code !== CODES.CONTENT_FILTERED) {
    throw new Error(`filtered finish mapped to ${JSON.stringify(reason)}`)
  }
})

check('an empty completion is in-band, not thrown', async () => {
  const chunks = await drive(providerB, frame({ response: { candidates: [{ content: { parts: [] }, finishReason: 'STOP' }] } }))
  const reason = chunks.at(-1).reason
  if (reason.kind !== 'error' || reason.failure.code !== CODES.EMPTY_RESPONSE) {
    throw new Error(`empty completion mapped to ${JSON.stringify(reason)}`)
  }
})

check('abort ends as aborted through the shared terminal policy', async () => {
  const controller = new AbortController()
  controller.abort()
  const chunks = []
  for await (const chunk of normalizeStream({
    events: readSseEvents(sseStream(frame({ choices: [{ delta: { content: 'x' } }] })), { signal: controller.signal }),
    descriptor: providerA.descriptor,
    hooks: providerA.hooks,
    signal: controller.signal,
  })) chunks.push(chunk)
  if (chunks.at(-1).reason.kind !== 'aborted') throw new Error(`abort mapped to ${chunks.at(-1).reason.kind}`)
})

const json = process.argv.includes('--json')
const results = []
let pass = 0
for (const [name, fn] of cases) {
  try {
    await fn()
    results.push({ name, ok: true })
    pass += 1
    if (!json) console.log(`ok   ${name}`)
  } catch (error) {
    results.push({ name, ok: false, error: error?.message ?? String(error) })
    if (!json) {
      console.log(`FAIL ${name}`)
      console.log(`     ${error?.message ?? error}`)
    }
  }
}

const ok = pass === cases.length && attempted.length === 0
if (json) {
  console.log(JSON.stringify({ ok, passed: pass, total: cases.length, vendorLoads: attempted, results }, null, 2))
} else {
  console.log('')
  console.log(`dispatch cases : ${pass}/${cases.length}`)
  console.log(`vendor loads   : ${attempted.length} (must be 0)`)
  if (attempted.length > 0) console.log(`attempted      : ${attempted.join(', ')}`)
  console.log(ok
    ? 'RESULT: the shared pipe dispatched standalone with zero vendor modules'
    : 'RESULT: FAILED')
}
process.exit(ok ? 0 : 1)
