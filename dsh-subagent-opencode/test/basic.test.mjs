import test from 'node:test'
import assert from 'node:assert/strict'

import { buildArgv, parseRunStream } from '../lib/index.js'

test('argv selects the json format and the configured route', () => {
  const argv = buildArgv({ executable: 'opencode', model: 'opencode-go/beam-free', auto: true, agent: '' })
  assert.deepEqual(argv, ['opencode', 'run', '-m', 'opencode-go/beam-free', '--format', 'json', '--auto'])
})

test('argv omits --auto when auto is disabled and includes a named agent', () => {
  const argv = buildArgv({ executable: 'opencode', model: 'm', auto: false, agent: 'build' })
  assert.deepEqual(argv, ['opencode', 'run', '-m', 'm', '--format', 'json', '--agent', 'build'])
})

test('cumulative text snapshots keep the last value per part', () => {
  const stream = [
    JSON.stringify({ type: 'text', part: { id: 'p1', text: 'Hel' } }),
    JSON.stringify({ type: 'text', part: { id: 'p1', text: 'Hello' } }),
    JSON.stringify({ type: 'text', part: { id: 'p2', text: ' world' } }),
  ].join('\n')
  assert.equal(parseRunStream(stream).text, 'Hello world')
})

test('reasoning and tool events never become the answer', () => {
  const stream = [
    JSON.stringify({ type: 'reasoning', part: { id: 'r1', text: 'thinking' } }),
    JSON.stringify({ type: 'text', part: { id: 'p1', text: 'answer' } }),
    JSON.stringify({ type: 'step_start', part: {} }),
  ].join('\n')
  assert.equal(parseRunStream(stream).text, 'answer')
})

test('error events are collected for the diagnostic', () => {
  const stream = JSON.stringify({ type: 'error', error: { message: 'Free usage limit reached' } })
  const parsed = parseRunStream(stream)
  assert.deepEqual(parsed.errors, ['Free usage limit reached'])
  assert.equal(parsed.text, '')
})

test('non-JSON lines are ignored', () => {
  const parsed = parseRunStream('warning: something\n{"type":"text","part":{"id":"p","text":"ok"}}')
  assert.equal(parsed.text, 'ok')
  assert.deepEqual(parsed.errors, [])
})
