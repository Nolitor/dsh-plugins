/**
 * Contract tests for the bottom gate (0.0.1).
 *
 * The gate is the only place that decides the fate of a tool call recovered from
 * the body text: promote to the DSH parser, or drop as echo / superseded /
 * undeclared. These tests pin both directions, because a wrong promote executes a
 * duplicate call and a wrong drop loses work.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { createDisplayGate, sameCall, stableStringify } from '../lib/display-gate.js'

const TOOLS = new Set(['bash', 'run_code'])

const candidate = (over = {}) => ({
  kind: 'tool-call',
  id: '',
  name: 'bash',
  arguments: '{"command":"ls"}',
  ...over,
})

test('a body call with no structured twin is promoted', () => {
  const gate = createDisplayGate({ toolNames: TOOLS })
  gate.addCandidate(candidate())
  const settled = gate.settle([])
  assert.equal(settled.promote.length, 1)
  assert.equal(settled.promote[0].name, 'bash')
  assert.equal(settled.promote[0].source, 'text')
  assert.equal(settled.dropped.length, 0)
})

test('a text echo of a structured call is dropped, never promoted twice', () => {
  const gate = createDisplayGate({ toolNames: TOOLS })
  gate.addCandidate(candidate({ id: 'call_1' }))
  const settled = gate.settle([{ id: 'call_1', name: 'bash', arguments: '{"command":"ls"}' }])
  assert.equal(settled.promote.length, 0)
  assert.equal(settled.dropped[0].verdict, 'echo')
})

test('equal arguments with a different id are still the same call', () => {
  const gate = createDisplayGate({ toolNames: TOOLS })
  gate.addCandidate(candidate({ id: 'text_id' }))
  const settled = gate.settle([{ id: 'wire_id', name: 'bash', arguments: '{"command": "ls"}' }])
  assert.equal(settled.promote.length, 0)
  assert.equal(settled.dropped[0].verdict, 'echo')
})

test('a stale attempt of a name that was re-sent is superseded, not executed', () => {
  const gate = createDisplayGate({ toolNames: TOOLS })
  gate.addCandidate(candidate({ id: 'call_8c09', arguments: '{"command":"old"}' }))
  const settled = gate.settle([{ id: 'call_6640', name: 'bash', arguments: '{"command":"new"}' }])
  assert.equal(settled.promote.length, 0)
  assert.equal(settled.dropped[0].verdict, 'superseded')
})

test('an undeclared name is dropped and never promoted', () => {
  const gate = createDisplayGate({ toolNames: TOOLS })
  gate.addCandidate(candidate({ name: 'rm_rf' }))
  const settled = gate.settle([])
  assert.equal(settled.promote.length, 0)
  assert.equal(settled.dropped[0].verdict, 'undeclared')
})

test('two identical body calls promote once', () => {
  const gate = createDisplayGate({ toolNames: TOOLS })
  gate.addCandidate(candidate())
  gate.addCandidate(candidate())
  const settled = gate.settle([])
  assert.equal(settled.promote.length, 1)
  assert.equal(settled.dropped[0].verdict, 'duplicate')
})

test('settle clears the queue: a second settle promotes nothing', () => {
  const gate = createDisplayGate({ toolNames: TOOLS })
  gate.addCandidate(candidate())
  assert.equal(gate.settle([]).promote.length, 1)
  assert.equal(gate.settle([]).promote.length, 0)
})

test('argument equality is order-independent', () => {
  assert.equal(sameCall(
    { name: 'bash', arguments: '{"a":1,"b":2}' },
    { name: 'bash', arguments: '{"b":2,"a":1}' },
  ), true)
  assert.equal(stableStringify({ b: 1, a: 2 }), '{"a":2,"b":1}')
})
