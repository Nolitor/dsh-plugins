/**
 * The tiering trigger seam: which hook the rewrite is registered on, and what
 * the decision record names once it has been chosen.
 *
 * The deprecated `agent/request` seam is gone. `agent/pre-step` is preferred;
 * `session/event` is the first-class fallback that observes `step/start` and
 * applies before the next pre-step. That fallback can land the rewrite one step
 * later than `agent/request` would have, which is the honest cost of leaving the
 * deprecated seam.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  chooseTrigger,
  decidedAtTrigger,
  TRIGGERS,
  triggerProbe,
} from '../lib/tiering.js'

const DEPRECATED = 'agent/request'

/**
 * A probe map shaped like `probeAll`'s: one `ProbeResult` per seam id.
 * @param {Record<string, boolean>} availability - seam id to availability.
 * @returns {Record<string, { ok: boolean, reason: string }>} the probe map.
 */
function probeOf (availability) {
  const out = {}
  for (const [id, ok] of Object.entries(availability)) {
    out[id] = { ok, reason: ok ? `${id} is available` : `${id} is absent` }
  }
  return out
}

test('pre-step present => decidedAtTrigger is agent/pre-step', () => {
  const available = {
    [TRIGGERS.PRE_STEP]: true,
    [TRIGGERS.SESSION_EVENT]: true,
  }
  const chosen = chooseTrigger(probeOf(available))
  assert.equal(chosen.trigger, TRIGGERS.PRE_STEP)
  assert.equal(decidedAtTrigger(chosen), TRIGGERS.PRE_STEP)
  assert.equal(decidedAtTrigger(chosen), 'agent/pre-step')
  assert.match(chosen.reason, /agent\/pre-step/)
})

test('session/event fallback runs tiering on surface mutation', () => {
  // The fallback is chosen only when the pre-step waterfall is not available.
  const chosen = chooseTrigger(probeOf({ [TRIGGERS.PRE_STEP]: false }))
  assert.equal(chosen.trigger, TRIGGERS.SESSION_EVENT)
  assert.equal(decidedAtTrigger(chosen), 'session/event')
  assert.match(chosen.reason, /agent\/pre-step/, 'the reason names what was missing')

  // `triggerProbe` reaches the same conclusion from a context that declares its
  // event vocabulary and omits the hook — the way a removed seam actually shows up.
  const gone = triggerProbe({
    eventTypes: ['step/start', 'step/end', 'turn/start', 'session/event'],
    on () {},
  })
  const fallback = chooseTrigger(gone)
  assert.equal(fallback.trigger, TRIGGERS.SESSION_EVENT)
  assert.equal(decidedAtTrigger(fallback), TRIGGERS.SESSION_EVENT)
})

test('chooseTrigger never returns agent/request, even when it is the only available hook', () => {
  // The deprecated seam reports available and nothing else does: the fallback is
  // still the answer, because the point of the migration is to stop listening there.
  const onlyDeprecated = chooseTrigger(probeOf({ [DEPRECATED]: true }))
  assert.equal(onlyDeprecated.trigger, TRIGGERS.SESSION_EVENT)
  assert.notEqual(onlyDeprecated.trigger, DEPRECATED)
  assert.notEqual(decidedAtTrigger(onlyDeprecated), DEPRECATED)

  // Every route in and out of the choice is checked, including a bare string and
  // the deprecated name handed straight to the recorder.
  for (const probe of [
    probeOf({ [DEPRECATED]: true }),
    probeOf({ [TRIGGERS.PRE_STEP]: false, [DEPRECATED]: true }),
    probeOf({}),
    undefined,
    null,
  ]) {
    assert.notEqual(chooseTrigger(probe).trigger, DEPRECATED)
  }
  assert.notEqual(decidedAtTrigger(DEPRECATED), DEPRECATED)
  assert.equal(decidedAtTrigger(DEPRECATED), TRIGGERS.SESSION_EVENT)
  assert.ok(!Object.values(TRIGGERS).includes(DEPRECATED), 'the constants never name the deprecated seam')
})

test('chooseTrigger is pure and handles an empty probe', () => {
  // An empty probe has no pre-step row, so the fallback is the only safe answer.
  for (const empty of [{}, undefined, null, 0, 'nope', []]) {
    const chosen = chooseTrigger(empty)
    assert.equal(chosen.trigger, TRIGGERS.SESSION_EVENT)
    assert.equal(typeof chosen.reason, 'string')
    assert.ok(chosen.reason.length > 0)
  }

  // Purity: repeated calls on one frozen probe return equal results and the input
  // is not mutated. A hostile getter must not make it throw outward either.
  const probe = Object.freeze(probeOf({ [TRIGGERS.PRE_STEP]: true }))
  const first = chooseTrigger(probe)
  const second = chooseTrigger(probe)
  assert.deepEqual(first, second)
  assert.deepEqual(Object.keys(probe).sort(), [TRIGGERS.PRE_STEP])

  const hostile = {
    get [TRIGGERS.PRE_STEP] () {
      throw new Error('boom')
    },
  }
  const survived = chooseTrigger(hostile)
  assert.equal(survived.trigger, TRIGGERS.SESSION_EVENT)
  assert.equal(decidedAtTrigger(survived), TRIGGERS.SESSION_EVENT)

  // `decidedAtTrigger` normalizes anything unknown to the fallback, never to the
  // deprecated seam, and accepts the bare constants.
  assert.equal(decidedAtTrigger(TRIGGERS.PRE_STEP), TRIGGERS.PRE_STEP)
  assert.equal(decidedAtTrigger('garbage'), TRIGGERS.SESSION_EVENT)
  assert.equal(decidedAtTrigger(undefined), TRIGGERS.SESSION_EVENT)
})
