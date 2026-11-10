/**
 * Contract tests for the Phase B (B-1) stream contract, lifecycle and the
 * extracted OpenAI-mapping helpers.
 *
 * What is pinned here:
 *   - the descriptor is frozen data and states the three measured wire facts;
 *   - the lifecycle owner holds exactly ONE AbortController, forwards the
 *     caller's abort, and leaves no listener behind;
 *   - `readEvent` maps one decoded payload to `{ parts, usage, finish }` and
 *     nothing else;
 *   - `classifyText` holds back a marker split across two deltas and emits one
 *     tool call (the legacy classifier path, owner decision D-4);
 *   - `mapFinish` / `usageFrom` delegate to the extracted helpers;
 *   - two hook sets are independent: no state leaks between streams.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { getEventListeners } from 'node:events'

import { createStreamLifecycle } from '../lib/stream-lifecycle.js'
import {
  OPENCODE_DESCRIPTOR,
  createStreamHooks,
  mapFinish,
  usageFrom,
} from '../lib/stream-contract.js'
import {
  finishFromOpenAi,
  reasoningAccounting,
  usageFromOpenAi,
} from '../lib/openai-mapping.js'
import { createDisplayGate } from '../lib/display-gate.js'
import * as http from '../lib/http.js'

const TOOL_NAMES = new Set(['bash', 'run_code'])

// --- descriptor ---

test('the descriptor is frozen and states the three measured wire facts', () => {
  assert.equal(Object.isFrozen(OPENCODE_DESCRIPTOR), true)
  assert.equal(OPENCODE_DESCRIPTOR.toolCallShape, 'fragmented')
  assert.equal(OPENCODE_DESCRIPTOR.usage.totalFormula, 'prompt+output')
  assert.equal(OPENCODE_DESCRIPTOR.malformedRecord, 'fail')
  assert.equal(Object.isFrozen(OPENCODE_DESCRIPTOR.usage), true)
  assert.throws(() => {
    'use strict'
    OPENCODE_DESCRIPTOR.toolCallShape = 'complete'
  })
})

// --- lifecycle ---

test('a caller abort propagates to the stream signal', () => {
  const caller = new AbortController()
  const lifecycle = createStreamLifecycle(caller.signal)
  assert.equal(lifecycle.signal.aborted, false)
  assert.equal(lifecycle.disposed, false)
  caller.abort(new Error('caller cancelled'))
  assert.equal(lifecycle.signal.aborted, true)
  assert.equal(lifecycle.aborted, true)
  assert.equal(lifecycle.signal.reason?.message, 'caller cancelled')
})

test('an already-aborted caller signal aborts the stream synchronously', () => {
  const caller = new AbortController()
  caller.abort('already gone')
  const lifecycle = createStreamLifecycle(caller.signal)
  assert.equal(lifecycle.signal.aborted, true)
  assert.equal(lifecycle.signal.reason, 'already gone')
})

test('dispose removes the caller listener, so a late abort never reaches the stream', () => {
  const caller = new AbortController()
  const lifecycle = createStreamLifecycle(caller.signal)
  assert.equal(getEventListeners(caller.signal, 'abort').length, 1)
  lifecycle.dispose()
  assert.equal(getEventListeners(caller.signal, 'abort').length, 0)
  // A late caller abort must not abort the stream after dispose.
  caller.abort('too late')
  assert.equal(lifecycle.signal.aborted, false)
  assert.equal(lifecycle.disposed, true)
})

test('dispose does not abort the stream: a normal completion stays distinguishable', () => {
  const lifecycle = createStreamLifecycle(undefined)
  lifecycle.dispose()
  assert.equal(lifecycle.signal.aborted, false)
  assert.equal(lifecycle.disposed, true)
})

test('abort and dispose are idempotent, and dispose never throws', () => {
  const caller = new AbortController()
  const lifecycle = createStreamLifecycle(caller.signal)
  lifecycle.abort('first')
  lifecycle.abort('second')
  assert.equal(lifecycle.signal.aborted, true)
  assert.equal(lifecycle.signal.reason, 'first')
  assert.doesNotThrow(() => lifecycle.dispose())
  assert.doesNotThrow(() => lifecycle.dispose())
  assert.equal(lifecycle.disposed, true)
})

test('a lifecycle without a caller signal still owns one controller', () => {
  const lifecycle = createStreamLifecycle(undefined)
  assert.equal(lifecycle.signal.aborted, false)
  lifecycle.abort('internal')
  assert.equal(lifecycle.signal.aborted, true)
})

// --- readEvent ---

test('a text delta becomes one text part', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  const record = hooks.readEvent({ choices: [{ delta: { content: 'hello' } }] })
  assert.deepEqual(record, { parts: [{ kind: 'text', text: 'hello' }] })
})

test('a reasoning delta is read from reasoning_content', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  const record = hooks.readEvent({ choices: [{ delta: { reasoning_content: 'think' } }] })
  assert.deepEqual(record, { parts: [{ kind: 'reasoning', text: 'think' }] })
})

test('a reasoning delta is read from the alias fields too', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  assert.deepEqual(
    hooks.readEvent({ choices: [{ delta: { reasoning: 'alias' } }] }),
    { parts: [{ kind: 'reasoning', text: 'alias' }] },
  )
  assert.deepEqual(
    hooks.readEvent({ choices: [{ delta: { reasoning_text: 'alias2' } }] }),
    { parts: [{ kind: 'reasoning', text: 'alias2' }] },
  )
})

test('the configured reasoning field wins over the aliases', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES, reasoningField: 'thought' })
  const record = hooks.readEvent({ choices: [{ delta: { thought: 'route field', reasoning_content: 'alias' } }] })
  assert.deepEqual(record, { parts: [{ kind: 'reasoning', text: 'route field' }] })
})

test('a fragmented tool call keeps the wire ordinal and only this delta arguments', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  const first = hooks.readEvent({
    choices: [{
      delta: {
        tool_calls: [{ index: 0, id: 'call_1', function: { name: 'bash', arguments: '' } }],
      },
    }],
  })
  assert.deepEqual(first, {
    parts: [{ kind: 'tool-call', index: 0, id: 'call_1', name: 'bash', argumentsDelta: '' }],
  })

  // A later fragment carries no id and no name: the pipe owns the accumulation.
  const later = hooks.readEvent({
    choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"command":"ls"}' } }] } }],
  })
  assert.deepEqual(later, {
    parts: [{ kind: 'tool-call', index: 0, argumentsDelta: '{"command":"ls"}' }],
  })
})

test('two parallel tool calls keep their own wire ordinals', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  const record = hooks.readEvent({
    choices: [{
      delta: {
        tool_calls: [
          { index: 0, id: 'call_a', function: { name: 'bash', arguments: '' } },
          { index: 1, id: 'call_b', function: { name: 'run_code', arguments: '' } },
        ],
      },
    }],
  })
  assert.deepEqual(record.parts.map((part) => part.index), [0, 1])
  assert.deepEqual(record.parts.map((part) => part.id), ['call_a', 'call_b'])
})

test('the part vocabulary is the pipe vocabulary, not the mapper vocabulary', () => {
  // `mapChatDelta` names the ordinal `ordinal` and the slice `arguments`; the
  // pipe reads `index` and `argumentsDelta`. A raw pass-through would make every
  // fragment look like ordinal 0.
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  const record = hooks.readEvent({
    choices: [{ delta: { tool_calls: [{ index: 7, function: { arguments: 'X' } }] } }],
  })
  assert.equal(record.parts[0].index, 7)
  assert.equal(record.parts[0].argumentsDelta, 'X')
  assert.equal(record.parts[0].ordinal, undefined)
})

test('a usage-only event carries the raw usage and no parts', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  const record = hooks.readEvent({
    choices: [],
    usage: { prompt_tokens: 100, completion_tokens: 20 },
  })
  assert.deepEqual(record, { usage: { prompt_tokens: 100, completion_tokens: 20 } })
})

test('a finish_reason becomes the finish value', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  const record = hooks.readEvent({ choices: [{ delta: {}, finish_reason: 'tool_calls' }] })
  assert.deepEqual(record, { finish: 'tool_calls' })
})

test('an event that carries nothing this provider cares about is undefined', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  assert.equal(hooks.readEvent({ choices: [{ delta: {} }] }), undefined)
  assert.equal(hooks.readEvent({}), undefined)
})

test('a payload that is not an object is a protocol defect, never a silent skip', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  const record = hooks.readEvent(null)
  assert.equal(record.defect.code, 'PROTOCOL_DEFECT')
  assert.equal(typeof record.defect.message, 'string')
})

test('empty fields are omitted from the record', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  const record = hooks.readEvent({
    choices: [{ delta: { content: 'x' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1 },
  })
  assert.deepEqual(Object.keys(record).sort(), ['finish', 'parts', 'usage'])
  assert.equal(record.usage.prompt_tokens, 1)
})

test('usage via readEvent is the raw provider object, not the mapped buckets', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  const record = hooks.readEvent({ usage: { prompt_tokens: 7 } })
  assert.deepEqual(record.usage, { prompt_tokens: 7 })
})

// --- classifyText (the legacy path) ---

test('classifyText holds back a marker split across two calls and emits one tool call', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  const first = hooks.classifyText('Now:\n[tool ca')
  const second = hooks.classifyText('ll bash #call_7]: {"command":"ls -la"}\n')
  const calls = [...first, ...second].filter((part) => part.kind === 'tool-call')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'bash')
  assert.equal(calls[0].id, 'call_7')
  assert.deepEqual(JSON.parse(calls[0].arguments), { command: 'ls -la' })
  const shown = [...first, ...second].filter((part) => part.kind === 'text').map((part) => part.text).join('')
  assert.equal(shown.includes('[tool call'), false)
  assert.equal(shown.includes('[tool ca'), false)
})

test('classifyText passes plain prose through as text', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  assert.deepEqual(hooks.classifyText('Hello.'), [{ kind: 'text', text: 'Hello.' }])
  assert.deepEqual(hooks.classifyText(''), [])
})

test('classifyText drops a call whose tool is not declared', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  const parts = hooks.classifyText('x\n[tool call rm_rf #call_1]: {"path":"/"}\n')
  assert.equal(parts.filter((part) => part.kind === 'tool-call').length, 0)
})

test('a recovered call gets its own ordinal, never a wire ordinal', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  const recovered = hooks.classifyText('Now:\n[tool call bash #call_7]: {"command":"ls"}\n')
    .find((part) => part.kind === 'tool-call')
  assert.equal(typeof recovered.index, 'number')
  assert.equal(recovered.index < 0, true, 'a recovered call must not borrow a wire ordinal')

  // Two recovered calls must not collide with each other either.
  const second = hooks.classifyText('Then:\n[tool call bash #call_8]: {"command":"pwd"}\n')
    .find((part) => part.kind === 'tool-call')
  assert.notEqual(recovered.index, second.index)
})

test('flush drains what the classifier still holds at end of stream', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  // An unterminated thinking block is held until the stream ends.
  assert.deepEqual(hooks.classifyText('<thinking>still going'), [])
  const flushed = hooks.flush()
  assert.deepEqual(flushed, [{ kind: 'reasoning', text: 'still going' }])
  // The drain happens once: a second flush has nothing left.
  assert.deepEqual(hooks.flush(), [])
})

// --- mapFinish / usageFrom delegate to the extracted helpers ---

test('mapFinish delegates to finishFromOpenAi', () => {
  assert.deepEqual(mapFinish('tool_calls'), finishFromOpenAi('tool_calls'))
  assert.deepEqual(mapFinish('length'), finishFromOpenAi('length'))
  assert.deepEqual(mapFinish(null), finishFromOpenAi(null))
  assert.deepEqual(mapFinish('content_filter'), finishFromOpenAi('content_filter'))
})

test('usageFrom delegates to usageFromOpenAi', () => {
  const raw = { prompt_tokens: 100, prompt_tokens_details: { cached_tokens: 40 }, completion_tokens: 20 }
  assert.deepEqual(usageFrom(raw), usageFromOpenAi(raw))
  assert.deepEqual(usageFrom(raw), {
    inputTokens: 60,
    outputTokens: 20,
    cacheReadTokens: 40,
    cacheWriteTokens: 0,
    totalTokens: 120,
  })
})

test('the hook set exposes the same delegates', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  assert.deepEqual(hooks.mapFinish('stop'), finishFromOpenAi('stop'))
  assert.deepEqual(hooks.usageFrom({ prompt_tokens: 2, completion_tokens: 1 }), usageFromOpenAi({ prompt_tokens: 2, completion_tokens: 1 }))
})

test('the extracted helpers keep their behaviour and stay reachable through http.js', () => {
  assert.deepEqual(http.usageFromOpenAi({ prompt_tokens: 5, completion_tokens: 2 }), {
    inputTokens: 5,
    outputTokens: 2,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    totalTokens: 7,
  })
  assert.deepEqual(http.finishFromOpenAi('tool_calls'), { kind: 'tool-calls' })
  assert.equal(http.reasoningAccounting(null).state, 'not-reported')
  assert.equal(http.reasoningAccounting({ completion_tokens_details: { reasoning_tokens: 42 } }).state, 'reported')
})

// --- independence of two hook sets ---

test('two hook sets are independent: no state leaks between streams', () => {
  const first = createStreamHooks({ toolNames: TOOL_NAMES })
  const second = createStreamHooks({ toolNames: TOOL_NAMES })
  assert.notEqual(first, second)

  // The first stream holds a marker back; the second must not see it.
  const held = first.classifyText('Now:\n[tool ca')
  assert.equal(held.filter((part) => part.kind === 'tool-call').length, 0)
  assert.deepEqual(second.classifyText('plain text'), [{ kind: 'text', text: 'plain text' }])

  // The first stream completes its call; the second stream's classifier is still clean.
  const completed = first.classifyText('ll bash #call_7]: {"command":"ls"}\n')
  assert.equal(completed.filter((part) => part.kind === 'tool-call').length, 1)
  assert.equal(second.classifyText('x\n[tool call rm_rf #c]: {"p":1}\n').filter((part) => part.kind === 'tool-call').length, 0)
})

test('two hook sets do not share the classifier instance', () => {
  const first = createStreamHooks({ toolNames: TOOL_NAMES })
  const second = createStreamHooks({ toolNames: TOOL_NAMES })
  first.classifyText('[thinking]held')
  // The second stream's classifier starts in the TEXT state: a plain text delta
  // comes back as text, not as an unterminated reasoning block.
  assert.deepEqual(second.classifyText('hello'), [{ kind: 'text', text: 'hello' }])
})

// --- the display gate: recovered calls are decided at end of stream ---

test('a recovered call that duplicates a structured call is dropped as an echo', () => {
  const gate = createDisplayGate({ toolNames: TOOL_NAMES })
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES, gate })

  // The structured call arrived as a wire field.
  hooks.onPart({ kind: 'tool-call', id: 'call_7', name: 'bash', arguments: '{"command":"ls"}' })
  // The same call was also written into the text by the route.
  const classified = hooks.classifyText('Now:\n[tool call bash #call_7]: {"command":"ls"}\n')

  // With a gate the recovered call is never emitted directly.
  assert.equal(classified.filter((part) => part.kind === 'tool-call').length, 0)
  const flushed = hooks.flush()
  assert.equal(flushed.filter((part) => part.kind === 'tool-call').length, 0)
  assert.equal(gate.stats.echo, 1)
})

test('a recovered call with an undeclared name is never promoted', () => {
  // The classifier knows one tool more than the gate does, so the candidate
  // reaches the gate and the gate drops it.
  const gate = createDisplayGate({ toolNames: TOOL_NAMES })
  const hooks = createStreamHooks({ toolNames: new Set([...TOOL_NAMES, 'rm_rf']), gate })

  hooks.classifyText('x\n[tool call rm_rf #call_1]: {"path":"/"}\n')
  const flushed = hooks.flush()
  assert.equal(flushed.filter((part) => part.kind === 'tool-call').length, 0)
  assert.equal(gate.stats.undeclared, 1)
  assert.equal(gate.stats.promoted, 0)
})

test('a recovered call with the same name but different arguments is superseded', () => {
  const gate = createDisplayGate({ toolNames: TOOL_NAMES })
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES, gate })

  hooks.onPart({ kind: 'tool-call', id: 'call_1', name: 'bash', arguments: '{"command":"ls"}' })
  hooks.classifyText('Now:\n[tool call bash #call_2]: {"command":"pwd"}\n')
  const flushed = hooks.flush()
  assert.equal(flushed.filter((part) => part.kind === 'tool-call').length, 0)
  assert.equal(gate.stats.superseded, 1)
  assert.equal(gate.stats.promoted, 0)
})

test('a recovered call with a declared name and no structured peer is promoted', () => {
  const gate = createDisplayGate({ toolNames: TOOL_NAMES })
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES, gate })

  hooks.classifyText('Now:\n[tool call bash #call_7]: {"command":"ls"}\n')
  const flushed = hooks.flush()
  const calls = flushed.filter((part) => part.kind === 'tool-call')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'bash')
  assert.equal(calls[0].index <= -1, true, 'a promoted call must not borrow a wire ordinal')
  assert.equal(calls[0].argumentsDelta, '{"command":"ls"}')
  assert.equal(gate.stats.promoted, 1)
})

test('two structured calls fed through onPart both reach the settle', () => {
  const gate = createDisplayGate({ toolNames: TOOL_NAMES })
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES, gate })

  hooks.onPart({ kind: 'tool-call', id: 'call_1', name: 'bash', arguments: '{"command":"ls"}' })
  hooks.onPart({ kind: 'tool-call', id: 'call_2', name: 'run_code', arguments: '{"code":"1"}' })
  hooks.classifyText('a\n[tool call bash #call_1]: {"command":"ls"}\nb\n[tool call run_code #call_2]: {"code":"1"}\n')
  const flushed = hooks.flush()
  assert.equal(flushed.filter((part) => part.kind === 'tool-call').length, 0)
  assert.equal(gate.stats.echo, 2)
  assert.equal(gate.stats.promoted, 0)
})

test('without a gate, classifyText still returns the recovered calls', () => {
  const hooks = createStreamHooks({ toolNames: TOOL_NAMES })
  const parts = hooks.classifyText('Now:\n[tool call bash #call_7]: {"command":"ls"}\n')
  const calls = parts.filter((part) => part.kind === 'tool-call')
  assert.equal(calls.length, 1)
  assert.equal(calls[0].name, 'bash')
  assert.equal(calls[0].index < 0, true)
})
