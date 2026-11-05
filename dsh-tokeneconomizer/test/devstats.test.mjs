/**
 * Developer statistics derivation: pure fold of the DSH session event ledger.
 *
 * The fixtures copy the event shapes measured in a real rc.1 session log
 * (`~/.dsh/sessions/.../session.v4.jsonl.zstd`, decompressed 2026-11-05):
 *
 *   step/start       { turn, step }
 *   request/context  { provider, model, contextWindow }
 *   assistant/message{ turn, step, message, usage, stream }
 *   tool/call        { turn, step, callId, name, arguments }
 *   tool/result      { turn, step, message: { content, isError, source: { callId } } }
 *   step/end         { turn, step }
 *
 * The assertions pin the DSH ledger vocabulary: the prompt buckets are disjoint and the counted
 * step event is `step/end`, so a failed or cancelled step still lands a row.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  cacheHitOf,
  deriveSessionDevStats,
  firstTokenTime,
  ledgerOf,
  textOf,
  usageBuckets,
} from '../lib/devstats.js'

/** One stream with a reasoning span starting 40ms after the step, as the harness records it. */
function stream(firstTokenAt) {
  return [
    { type: 'chunk', time: firstTokenAt - 5, chunk: { type: 'block-start', index: 1, blockType: 'reasoning' } },
    { type: 'reasoning-chunks', time0: firstTokenAt, index: 1, dt: [1, 2], texts: ['a', 'b'] },
    { type: 'chunk', time: firstTokenAt + 30, chunk: { type: 'usage' } },
  ]
}

/** One tool result message. */
function toolResult(callId, text, isError = false) {
  return {
    role: 'tool',
    source: { kind: 'tool', callId },
    toolCallId: callId,
    content: [{ type: 'text', text }],
    isError,
  }
}

/**
 * A fixture log with two turns and three steps.
 * @returns {Array<object>} the committed events.
 */
function fixture() {
  return [
    { type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } },
    { type: 'request/header', seq: 1, time: 1001, data: { header: { config: { provider: 'p', model: 'm' } } } },
    { type: 'request/context', seq: 2, time: 1002, data: { provider: 'p', model: 'm', contextWindow: 200000 } },
    { type: 'step/start', seq: 3, time: 1010, data: { turn: 1, step: 1 } },
    { type: 'assistant/message', seq: 4, time: 1060, data: { turn: 1, step: 1, usage: { inputTokens: 1000, outputTokens: 400, cacheReadTokens: 600, cacheWriteTokens: 0, reasoningTokens: 120, totalTokens: 2000 }, stream: stream(1050) } },
    { type: 'tool/call', seq: 5, time: 1061, data: { turn: 1, step: 1, callId: 'c1', name: 'bash', arguments: '{"command":"ls"}' } },
    { type: 'tool/result', seq: 6, time: 1121, data: { turn: 1, step: 1, message: toolResult('c1', 'x'.repeat(250)) } },
    { type: 'step/end', seq: 7, time: 1130, data: { turn: 1, step: 1 } },
    { type: 'step/start', seq: 8, time: 1140, data: { turn: 1, step: 2 } },
    { type: 'assistant/message', seq: 9, time: 1200, data: { turn: 1, step: 2, usage: { inputTokens: 400, outputTokens: 90, cacheReadTokens: 1800, cacheWriteTokens: 10, reasoningTokens: 0, totalTokens: 2300 }, stream: stream(1150) } },
    { type: 'tool/call', seq: 10, time: 1201, data: { turn: 1, step: 2, callId: 'c2', name: 'read', arguments: '{"path":"a"}' } },
    { type: 'tool/result', seq: 11, time: 1211, data: { turn: 1, step: 2, message: toolResult('c2', 'boom', true) } },
    { type: 'step/end', seq: 12, time: 1220, data: { turn: 1, step: 2 } },
    { type: 'turn/end', seq: 13, time: 1230, data: { turn: 1 } },
    { type: 'turn/start', seq: 14, time: 2000, data: { turn: 2 } },
    { type: 'request/context', seq: 15, time: 2001, data: { provider: 'q', model: 'n', contextWindow: 100000 } },
    { type: 'step/start', seq: 16, time: 2010, data: { turn: 2, step: 1 } },
    { type: 'assistant/message', seq: 17, time: 2100, data: { turn: 2, step: 1, usage: { inputTokens: 50, outputTokens: 10, cacheReadTokens: 0, cacheWriteTokens: 0, totalTokens: 60 }, stream: stream(2020) } },
    { type: 'step/end', seq: 18, time: 2110, data: { turn: 2, step: 1 } },
    { type: 'turn/end', seq: 19, time: 2120, data: { turn: 2 } },
  ]
}

test('prompt buckets are disjoint and reasoning stays inside output', () => {
  const buckets = usageBuckets({ inputTokens: 1000, outputTokens: 400, cacheReadTokens: 600, cacheWriteTokens: 50, reasoningTokens: 120 })
  assert.equal(buckets.inputTokens, 1000)
  assert.equal(buckets.contextTokens, 1650)
  assert.equal(buckets.outputTokens, 400)
  assert.equal(buckets.reasoningTokens, 120)
  assert.equal(cacheHitOf(buckets.cacheReadTokens, buckets.contextTokens), 600 / 1650)
  assert.equal(usageBuckets({}), null)
})

test('the first token is the first content span, not the step start', () => {
  assert.equal(firstTokenTime(stream(1050)), 1050)
  assert.equal(firstTokenTime([]), null)
  assert.equal(firstTokenTime(undefined), null)
})

test('textOf concatenates text blocks and ignores non-text blocks', () => {
  assert.equal(textOf({ content: [{ type: 'text', text: 'a' }, { type: 'image' }, { type: 'text', text: 'b' }] }), 'ab')
  assert.equal(textOf('raw'), 'raw')
  assert.equal(textOf(null), '')
})

test('a turn yields one row per closed step with the measured columns', () => {
  const { turns, totals } = deriveSessionDevStats(fixture())
  assert.equal(turns.length, 2)
  const [first, second] = turns
  assert.equal(first.turn, 1)
  assert.equal(first.steps.length, 2)
  assert.equal(first.wallMs, 230)
  assert.equal(first.startTime, 1000)
  assert.equal(first.endTime, 1230)

  const step1 = first.steps[0]
  assert.equal(step1.contextTokens, 1600, '1000 uncached + 600 cache read + 0 cache write')
  assert.equal(step1.cacheHit, 600 / 1600)
  assert.equal(step1.outputTokens, 400)
  assert.equal(step1.reasoningTokens, 120)
  assert.equal(step1.modelMs, 50, 'step start 1010 -> assistant message 1060')
  assert.equal(step1.ttftMs, 40, 'step start 1010 -> first token 1050')
  assert.equal(step1.decodeMs, 10, 'first token 1050 -> message 1060')
  assert.equal(step1.wallMs, 120)
  assert.equal(step1.provider, 'p')
  assert.equal(step1.model, 'm')
  assert.equal(step1.toolCalls, 1)
  assert.equal(step1.calls[0].name, 'bash')
  assert.equal(step1.calls[0].ms, 60)
  assert.equal(step1.calls[0].resultChars, 250)
  assert.equal(step1.calls[0].error, false)

  const step2 = first.steps[1]
  assert.equal(step2.contextTokens, 2210)
  assert.equal(step2.calls[0].error, true)
  assert.equal(step2.toolErrorCount, 1)

  assert.equal(first.contextCumulative, 3810)
  assert.equal(first.contextLatest, 2210)
  assert.equal(first.toolCalls, 2)
  assert.equal(first.toolMs, 70)
  assert.equal(first.toolErrorCount, 1)
  assert.deepEqual(first.routes, [{ provider: 'p', model: 'm' }])

  assert.equal(second.steps[0].provider, 'q')
  assert.equal(second.steps[0].model, 'n')

  // Totals equal the sessionStats projection shape plus the token buckets.
  assert.equal(totals.turns, 2)
  assert.equal(totals.steps, 3)
  assert.equal(totals.contextCumulative, 3810 + 50)
  assert.equal(totals.modelMs, 50 + 60 + 90)
  assert.equal(totals.ttftMs, 40 + 10 + 10)
  assert.equal(totals.decodeMs, 10 + 50 + 80)
  assert.equal(totals.decodeTokens, 400 + 90 + 10)
  assert.equal(totals.toolMs, 70)
  assert.equal(totals.wallMs, 1120, 'first observed 1000 -> last observed 2120')
})

test('an unclosed step stays visible and is marked running', () => {
  const events = fixture().slice(0, 10)
  const { turns } = deriveSessionDevStats(events)
  const step = turns[0].steps[1]
  assert.equal(step.running, true)
  assert.equal(step.wallMs, null)
  assert.equal(turns[0].running, true)
})

test('an empty log derives an empty, zeroed result', () => {
  const { turns, totals, truncated } = deriveSessionDevStats([])
  assert.deepEqual(turns, [])
  assert.equal(totals.turns, 0)
  assert.equal(totals.steps, 0)
  assert.equal(totals.wallMs, null)
  assert.equal(totals.cacheHit, null)
  assert.equal(truncated, false)
})

test('row budgets truncate the display but never the totals', () => {
  const { turns, totals, truncated } = deriveSessionDevStats(fixture(), { maxTurns: 1, maxStepsPerTurn: 1 })
  assert.equal(truncated, true)
  assert.equal(turns.length, 1)
  assert.equal(turns[0].turn, 2)
  assert.equal(turns[0].steps.length, 1)
  assert.equal(totals.steps, 3)
  assert.equal(totals.turns, 2)
})

test('the route is attributed from the assembled message source when the request window is missing', () => {
  const events = [
    { type: 'turn/start', seq: 0, time: 1000, data: { turn: 1 } },
    { type: 'step/start', seq: 1, time: 1010, data: { turn: 1, step: 1 } },
    {
      type: 'assistant/message',
      seq: 2,
      time: 1060,
      data: {
        turn: 1,
        step: 1,
        message: { role: 'assistant', source: { kind: 'model', provider: 'deepseek-account', model: 'deepseek-v4.1-flash' }, content: [] },
        usage: { inputTokens: 500, outputTokens: 25, cacheReadTokens: 0 },
      },
    },
    { type: 'step/end', seq: 3, time: 1070, data: { turn: 1, step: 1 } },
  ]
  const { turns, totals } = deriveSessionDevStats(events)
  assert.equal(turns[0].steps[0].provider, 'deepseek-account')
  assert.equal(turns[0].steps[0].model, 'deepseek-v4.1-flash')
  assert.deepEqual(totals.routes, [{ provider: 'deepseek-account', model: 'deepseek-v4.1-flash' }])
})

test('malformed events are ignored instead of throwing', () => {
  const events = [null, 7, {}, { type: 'tool/result' }, { type: 'step/start', data: {} }, 'x', { type: 'assistant/message' }]
  const { totals } = deriveSessionDevStats(events)
  assert.equal(totals.turns, 1)
  assert.equal(totals.steps, 1)
})

test('the ledger view exposes counters only, never live objects', () => {
  const state = {
    sid: 's1',
    turn: 3,
    requests: 7,
    tiered: 2,
    closed: false,
    recallDone: true,
    dedup: { size: 5 },
    stats: {
      mode: 'apply',
      startedAt: 10,
      updatedAt: 20,
      dedupHits: 4,
      dedupSavedChars: 900,
      tierShadowTokens: 1200,
      breakerTrips: 1,
      watchdogWarns: 2,
      watchdogInterrupts: 0,
      toolCalls: 9,
      toolErrors: 2,
      notices: 3,
      pinned: true,
      thinkInCode: true,
    },
  }
  const ledger = ledgerOf(state)
  assert.equal(ledger.mode, 'apply')
  assert.equal(ledger.dedup.hits, 4)
  assert.equal(ledger.dedup.entries, 5)
  assert.equal(ledger.tiering.replacements, 2)
  assert.equal(ledger.tiering.shadowedTokens, 1200)
  assert.equal(ledger.loopBreaker.trips, 1)
  assert.equal(ledger.watchdog.warnings, 2)
  assert.equal(ledger.recall.done, true)
  assert.equal(ledger.pinned, true)
  // Deep-equal against a plain object proves no live reference (Map/store) escaped.
  assert.deepEqual(JSON.parse(JSON.stringify(ledger)), ledger)
})
