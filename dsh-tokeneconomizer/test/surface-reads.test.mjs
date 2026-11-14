/**
 * The rewriter resolves a target event body without a deprecated Session read.
 * `SessionSurface` exposes `nodes` (sequence numbers) and generation counters
 * only — no event bodies — so a caller must supply the event or a reader.
 * These tests pin that contract and forbid a phantom `surface.readEvent` hook.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { validateRewriteTarget } from '../lib/rewriter.js'

const LIB = new URL('../lib/', import.meta.url)

/** A `tool/result` event at `seq`. */
function toolResult (seq) {
  return {
    type: 'tool/result',
    seq,
    data: { message: { content: [{ type: 'text', text: 'body' }] } },
  }
}

test('no module references a phantom surface readEvent', async () => {
  for (const name of ['rewriter.js', 'surface-attribution.js']) {
    const source = await readFile(fileURLToPath(new URL(name, LIB)), 'utf8')
    const hits = source.split('session.surface.readEvent').length - 1
    assert.equal(hits, 0, `${name} must not reference session.surface.readEvent`)
  }
})

test('an event is resolved from the caller, the reader, or a node-carried event', () => {
  const seq = 7

  // 1. the caller already holds the event.
  const fromCaller = validateRewriteTarget(
    { surface: { nodes: [seq] } },
    seq,
    { event: toolResult(seq) }
  )
  assert.equal(fromCaller.ok, true)
  assert.equal(fromCaller.event.seq, seq)

  // 2. a caller-supplied reader.
  const fromReader = validateRewriteTarget(
    { surface: { nodes: [seq] } },
    seq,
    { readEvent: (probe) => (probe === seq ? toolResult(probe) : undefined) }
  )
  assert.equal(fromReader.ok, true)
  assert.equal(fromReader.event.seq, seq)

  // 3. a surface node object carrying its own event.
  const fromNode = validateRewriteTarget(
    { surface: { nodes: [{ seq, event: toolResult(seq) }] } },
    seq,
    {}
  )
  assert.equal(fromNode.ok, true)
  assert.equal(fromNode.event.seq, seq)
})

test('an unresolvable sequence returns event-unavailable without throwing', () => {
  const seq = 3
  const session = { surface: { nodes: [seq] } }
  let result
  assert.doesNotThrow(() => {
    result = validateRewriteTarget(session, seq, {})
  })
  assert.equal(result.ok, false)
  assert.equal(result.reason, 'event-unavailable')
})
