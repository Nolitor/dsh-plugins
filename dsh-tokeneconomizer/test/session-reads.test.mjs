/**
 * The session-read posture this plugin actually ships.
 *
 * Measured constraint (do not re-derive): `SessionSurface` exposes sequence
 * numbers and generation counters only — it has no event-body read, and the
 * Agent Note the deprecation points at is not published in the install. So only
 * one call site is migratable today; the rest stay on `eventAt`/`snapshotEvents`
 * exactly as upstream does, and the audit records each exception with a reason
 * instead of deleting the seam.
 *
 * These tests pin all three halves of that posture: no phantom API, the one real
 * migration, and a printed justification for every remaining deprecated read.
 */
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'

import { validateRewriteTarget } from '../lib/rewriter.js'
import { SEAMS } from '../scripts/audit-deprecations.mjs'

const LIB = new URL('../lib/', import.meta.url)

/** Read one `lib/` module as text. */
function readLib (name) {
  return readFile(fileURLToPath(new URL(name, LIB)), 'utf8')
}

/** A `tool/result` event at `seq`, resolvable from any of the three sources. */
function toolResult (seq) {
  return {
    type: 'tool/result',
    seq,
    data: { message: { content: [{ type: 'text', text: 'body' }] } },
  }
}

test('no module references a phantom surface readEvent', async () => {
  for (const name of ['rewriter.js', 'surface-attribution.js']) {
    const source = await readLib(name)
    assert.equal(
      source.includes('surface.readEvent'),
      false,
      `${name} must not reference surface.readEvent`
    )
  }
})

test('the log-presence check uses the non-deprecated log length', async () => {
  const source = await readLib('index.js')
  assert.equal(source.includes('session.seq > 0'), true, 'the log-presence check must read session.seq')
  assert.equal(
    source.includes('snapshotEvents().length > 0'),
    false,
    'the log-presence check must not scan the full event snapshot'
  )
})

test('every remaining deprecated read is explicitly allowed with a justification', () => {
  const allowed = SEAMS.filter((seam) => seam.allowDeprecated === true)
  assert.ok(allowed.length > 0, 'at least one seam is expected to remain an allowed deprecation')
  for (const seam of allowed) {
    assert.equal(typeof seam.justification, 'string', `${seam.id} must state a justification`)
    assert.ok(seam.justification.trim().length > 0, `${seam.id} justification must not be empty`)
  }
  // The seam this session actually migrated must not be silently pre-allowed.
  const migrated = SEAMS.find((seam) => seam.id === 'session.snapshotEvents')
  assert.equal(migrated.allowDeprecated, true)
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
