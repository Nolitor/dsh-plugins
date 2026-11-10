/**
 * The DeepInfra driver as the first conforming consumer of the leaf contract.
 *
 * These assertions are about the declaration only: the driver is frozen, it
 * reuses the existing stream descriptor instead of restating it, it occupies no
 * tool or command name, and its `readEvent` hook is pure and synchronous.
 */
import assert from 'node:assert/strict'
import test from 'node:test'

import { effectiveSurfaceNames, validateDrivers } from '../../../lib/driver/contract.js'
import { DEEPINFRA_DRIVER, readEvent } from '../lib/driver.js'
import { STREAM_DESCRIPTOR } from '../lib/stream-contract.js'

test('the driver is frozen and carries the deepinfra id', () => {
  assert.ok(Object.isFrozen(DEEPINFRA_DRIVER))
  assert.ok(Object.isFrozen(DEEPINFRA_DRIVER.descriptor))
  assert.ok(Object.isFrozen(DEEPINFRA_DRIVER.surfaces))
  assert.ok(Object.isFrozen(DEEPINFRA_DRIVER.activation))
  assert.equal(DEEPINFRA_DRIVER.id, 'deepinfra')
})

test('the descriptor matches STREAM_DESCRIPTOR field for field', () => {
  // The contract copies the validated fields into its own frozen object, so the
  // check is equality of the wire facts, not of the object reference.
  assert.deepEqual(DEEPINFRA_DRIVER.descriptor, STREAM_DESCRIPTOR)
  assert.equal(DEEPINFRA_DRIVER.descriptor.toolCallShape, STREAM_DESCRIPTOR.toolCallShape)
  assert.equal(DEEPINFRA_DRIVER.descriptor.usage.totalFormula, STREAM_DESCRIPTOR.usage.totalFormula)
  assert.equal(DEEPINFRA_DRIVER.descriptor.malformedRecord, STREAM_DESCRIPTOR.malformedRecord)
})

test('validateDrivers accepts the driver alone', () => {
  const drivers = validateDrivers([DEEPINFRA_DRIVER])

  assert.equal(drivers.length, 1)
  assert.ok(Object.isFrozen(drivers))
  assert.equal(drivers[0].id, 'deepinfra')
})

test('model serving is the only surface: no tools, no commands', () => {
  assert.equal(DEEPINFRA_DRIVER.surfaces.model.adapter, true)
  assert.equal(DEEPINFRA_DRIVER.surfaces.model.factory, 'createAdapter')
  assert.deepEqual(effectiveSurfaceNames(DEEPINFRA_DRIVER), { tools: [], commands: [] })
})

test('the three activation switches are declared with their modules and roles', () => {
  assert.deepEqual(DEEPINFRA_DRIVER.activation.switches, [
    { name: 'enabled', module: 'config', role: 'master' },
    { name: 'modelServing', module: 'config', role: 'model' },
    { name: 'anthropicRoute', module: 'config', role: 'auxiliary' },
  ])
})

test('readiness names the bridge, catalog layer and auth mode', () => {
  assert.equal(DEEPINFRA_DRIVER.activation.readiness.bridge, 'deepinfra')
  assert.equal(DEEPINFRA_DRIVER.activation.readiness.catalogLayer, 'probe')
  assert.equal(DEEPINFRA_DRIVER.activation.readiness.auth, 'api-key')
})

test('readEvent is a synchronous function over one recorded text delta', () => {
  assert.equal(typeof DEEPINFRA_DRIVER.hooks.readEvent, 'function')

  const record = DEEPINFRA_DRIVER.hooks.readEvent({ choices: [{ delta: { content: 'x' } }] })

  assert.equal(typeof record, 'object')
  assert.equal(typeof record?.then, 'undefined', 'readEvent must not return a promise')
  assert.deepEqual(record, { parts: [{ kind: 'text', text: 'x' }] })
})

test('readEvent unwraps the payload that mapDelta cannot read directly', () => {
  // mapDelta takes `choices[0].delta`; the hook takes the whole decoded event.
  const record = readEvent({
    choices: [{ delta: { reasoning_content: 'think', content: 'answer' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 3, completion_tokens: 1, total_tokens: 4 },
  })

  assert.deepEqual(record.parts, [
    { kind: 'reasoning', text: 'think' },
    { kind: 'text', text: 'answer' },
  ])
  assert.equal(record.finish, 'stop')
  assert.equal(record.usage.total_tokens, 4)
})

test('readEvent omits identity a tool fragment did not carry', () => {
  const record = readEvent({ choices: [{ delta: { tool_calls: [{ index: 0, function: { arguments: '{"a":' } }] } }] })

  assert.deepEqual(record.parts, [{ kind: 'tool-call', index: 0, argumentsDelta: '{"a":' }])
  assert.equal('id' in record.parts[0], false)
  assert.equal('name' in record.parts[0], false)
})

test('readEvent reports a non-object payload as a protocol defect', () => {
  const record = readEvent(null)

  assert.equal(record.defect.code, 'PROTOCOL_DEFECT')
})

test('an event with nothing this provider cares about yields undefined', () => {
  assert.equal(readEvent({ choices: [{ delta: {} }] }), undefined)
})
