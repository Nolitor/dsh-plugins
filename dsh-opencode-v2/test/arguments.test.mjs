/**
 * Contract tests for tool-call argument normalization (0.0.1-rc.1).
 *
 * Measured defect: session 2dc3531f sent 30 of 80 calls as two complete JSON
 * snapshots concatenated, and every one failed with
 *   invalid arguments: "arguments" must be an object
 * These tests pin the collapse and the schema inference that recovers a call the
 * route never sent as a structured one.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { canonical, inferToolFromArguments, normalizeArguments, scanJsonValue } from '../lib/arguments.js'

const ARGS = '{"code":"const r = await tools.bash({command: \\"ls\\"})","description":"list"}'

test('a normal fragmented accumulation stays as it was', () => {
  const normalized = normalizeArguments(ARGS)
  assert.equal(normalized.mode, 'valid')
  assert.equal(normalized.value, ARGS)
  assert.deepEqual(normalized.reparsed, JSON.parse(ARGS))
})

test('two identical concatenated snapshots collapse to one valid object', () => {
  const raw = ARGS + ARGS
  assert.throws(() => JSON.parse(raw))
  const normalized = normalizeArguments(raw)
  assert.equal(normalized.mode, 'duplicate')
  assert.equal(normalized.snapshots, 2)
  assert.deepEqual(JSON.parse(normalized.value), JSON.parse(ARGS))
})

test('a restated snapshot keeps the last complete statement', () => {
  const first = '{"code":"old"}'
  const second = '{"code":"new"}'
  const normalized = normalizeArguments(first + second)
  assert.equal(normalized.mode, 'restated')
  assert.deepEqual(JSON.parse(normalized.value), { code: 'new' })
})

test('three snapshots collapse and the whitespace between them is ignored', () => {
  const normalized = normalizeArguments(ARGS + '\n' + ARGS + '  ' + ARGS)
  assert.equal(normalized.mode, 'duplicate')
  assert.equal(normalized.snapshots, 3)
  assert.deepEqual(JSON.parse(normalized.value), JSON.parse(ARGS))
})

test('empty arguments become an empty object', () => {
  assert.deepEqual(normalizeArguments(''), { value: '{}', mode: 'empty', snapshots: 0, reparsed: {} })
})

test('truly broken arguments are reported, not silently rewritten', () => {
  const normalized = normalizeArguments('{"code":"unterminated')
  assert.equal(normalized.mode, 'invalid')
  assert.equal(normalized.value, '{"code":"unterminated')
})

test('scanJsonValue stops at the end of the first value', () => {
  const scanned = scanJsonValue(ARGS + '{"a":1}')
  assert.equal(scanned.raw, ARGS)
  assert.equal(canonical(JSON.parse(ARGS)), canonical(JSON.parse(ARGS)))
})

const TOOLS = [
  { name: 'run_code', parameters: { type: 'object', properties: { code: { type: 'string' }, description: { type: 'string' } }, required: ['code'] } },
  { name: 'bash', parameters: { type: 'object', properties: { command: { type: 'string' } }, required: ['command'] } },
]

test('a bare arguments object is matched to the declared tool by its schema', () => {
  assert.equal(inferToolFromArguments({ code: 'x', description: 'y' }, TOOLS), 'run_code')
  assert.equal(inferToolFromArguments({ command: 'ls' }, TOOLS), 'bash')
})

test('a required key missing means it is not that tool', () => {
  assert.equal(inferToolFromArguments({ description: 'no code' }, TOOLS), null)
})

test('an undeclared key means it is not that tool', () => {
  assert.equal(inferToolFromArguments({ code: 'x', shell: 'zsh' }, TOOLS), null)
})

test('a non-object payload is never matched', () => {
  assert.equal(inferToolFromArguments([1, 2], TOOLS), null)
  assert.equal(inferToolFromArguments('text', TOOLS), null)
  assert.equal(inferToolFromArguments({}, TOOLS), null)
})

const RUN_CODE_SCHEMA = { properties: { code: {}, description: {} }, required: ['code'] }

test('a wrapped snapshot is unwrapped when it fits the declared schema', () => {
  const wrapped = JSON.stringify({ arguments: JSON.stringify({ code: 'inner' }) })
  const normalized = normalizeArguments(wrapped, RUN_CODE_SCHEMA)
  assert.equal(normalized.mode, 'unwrapped')
  assert.deepEqual(JSON.parse(normalized.value), { code: 'inner' })
})

test('the fitting snapshot wins over a wrapper that does not fit', () => {
  const direct = '{"code":"direct"}'
  const wrapper = JSON.stringify({ arguments: '{"code":"wrapped"}' })
  const normalized = normalizeArguments(direct + wrapper, RUN_CODE_SCHEMA)
  assert.deepEqual(JSON.parse(normalized.value), { code: 'wrapped' })
})

test('without a schema the wrapper is still unwrapped when it is the only statement', () => {
  const wrapped = JSON.stringify({ arguments: { command: 'ls' } })
  const normalized = normalizeArguments(wrapped)
  assert.equal(normalized.mode, 'unwrapped')
  assert.deepEqual(JSON.parse(normalized.value), { command: 'ls' })
})

test('a snapshot that fits the schema beats a later one that does not', () => {
  const fitting = '{"code":"a"}'
  const other = '{"something":"else"}'
  const normalized = normalizeArguments(fitting + other, RUN_CODE_SCHEMA)
  assert.deepEqual(JSON.parse(normalized.value), { code: 'a' })
})

