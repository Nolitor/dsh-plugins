/**
 * The usage ledger turns OpenCode's cumulative session counters into a
 * generation's own usage, so a long-lived session does not report its earlier
 * tokens again.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { createUsageLedger, usageTotal } from '../lib/usage-ledger.js'

test('a step total is reported as it is and advances the baseline', () => {
  const ledger = createUsageLedger()
  const usage = { inputTokens: 10, outputTokens: 4, reasoningTokens: 3, cacheReadTokens: 100, cacheWriteTokens: 0 }
  const reported = ledger.steps('session-a', usage)
  assert.equal(reported.inputTokens, 10)
  assert.equal(reported.cacheReadTokens, 100)
  assert.equal(reported.totalTokens, 117)
  assert.equal(ledger.reported('session-a').inputTokens, 10)
})

test('a cumulative snapshot reports only its growth', () => {
  const ledger = createUsageLedger()
  const cumulative = { inputTokens: 100, outputTokens: 20, reasoningTokens: 5, cacheReadTokens: 900, cacheWriteTokens: 3 }
  const first = ledger.cumulative('session-a', cumulative)
  assert.equal(first.inputTokens, 100, 'the first report carries the whole session so far')
  assert.equal(first.totalTokens, usageTotal(cumulative))

  const second = ledger.cumulative('session-a', {
    inputTokens: 140, outputTokens: 25, reasoningTokens: 9, cacheReadTokens: 1500, cacheWriteTokens: 3,
  })
  assert.equal(second.inputTokens, 40, 'the second report carries only the growth')
  assert.equal(second.outputTokens, 5)
  assert.equal(second.reasoningTokens, 4)
  assert.equal(second.cacheReadTokens, 600)
  assert.equal(second.cacheWriteTokens, 0)
  assert.equal(second.totalTokens, 649)
})

test('a cumulative snapshot after step usage reports the rest of the session', () => {
  const ledger = createUsageLedger()
  ledger.steps('session-a', { inputTokens: 30, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  const growth = ledger.cumulative('session-a', {
    inputTokens: 100, outputTokens: 20, reasoningTokens: 5, cacheReadTokens: 900, cacheWriteTokens: 3,
  })
  assert.equal(growth.inputTokens, 70)
  assert.equal(growth.totalTokens, usageTotal({ inputTokens: 70, outputTokens: 19, reasoningTokens: 5, cacheReadTokens: 900, cacheWriteTokens: 3 }))
})

test('sessions are accounted separately', () => {
  const ledger = createUsageLedger()
  ledger.cumulative('session-a', { inputTokens: 10, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  const other = ledger.cumulative('session-b', { inputTokens: 10, outputTokens: 1, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.equal(other.inputTokens, 10, 'a second session reports its own total, not a shared one')
})

test('a counter that goes backwards reports nothing', () => {
  const ledger = createUsageLedger()
  ledger.cumulative('session-a', { inputTokens: 50, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  const backwards = ledger.cumulative('session-a', { inputTokens: 10, outputTokens: 0, reasoningTokens: 0, cacheReadTokens: 0, cacheWriteTokens: 0 })
  assert.equal(backwards.inputTokens, 0)
  assert.equal(backwards.totalTokens, 0)
})

test('missing buckets count as zero', () => {
  const ledger = createUsageLedger()
  const reported = ledger.cumulative('session-a', { inputTokens: 7 })
  assert.equal(reported.inputTokens, 7)
  assert.equal(reported.outputTokens, 0)
  assert.equal(reported.totalTokens, 7)
})
