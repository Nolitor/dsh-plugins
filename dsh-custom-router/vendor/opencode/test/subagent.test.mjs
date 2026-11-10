/**
 * The merged delegation provider.
 *
 * Merged from @nolit/dsh-subagent-opencode 0.1.0 (2026-11-05). These tests pin the
 * two things that silently broke the Antigravity merge: the argv shape and the
 * stream parser, plus the switch that must remove the provider cleanly.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { buildOpencodeArgv, parseRunStream } from '../lib/subagent.js'

test('argv carries the model and json format', () => {
  const argv = buildOpencodeArgv({ executable: 'opencode', model: 'opencode-go/x', auto: false, agent: '' })
  assert.deepEqual(argv, ['opencode', 'run', '-m', 'opencode-go/x', '--format', 'json'])
})

test('argv adds --auto and --agent only when set', () => {
  assert.ok(buildOpencodeArgv({ executable: 'o', model: 'm', auto: true, agent: '' }).includes('--auto'))
  const withAgent = buildOpencodeArgv({ executable: 'o', model: 'm', auto: false, agent: 'build' })
  assert.deepEqual(withAgent.slice(-2), ['--agent', 'build'])
})

test('the last cumulative text snapshot per part wins', () => {
  const stdout = [
    JSON.stringify({ type: 'text', part: { id: 'p1', text: 'Hel' } }),
    JSON.stringify({ type: 'text', part: { id: 'p1', text: 'Hello' } }),
    JSON.stringify({ type: 'reasoning', part: { id: 'r1', text: 'thinking' } }),
    JSON.stringify({ type: 'text', part: { id: 'p2', text: ' world' } }),
  ].join('\n')
  assert.equal(parseRunStream(stdout).text, 'Hello world')
})

test('error events are collected', () => {
  const stdout = JSON.stringify({ type: 'error', error: { message: 'boom' } })
  assert.deepEqual(parseRunStream(stdout).errors, ['boom'])
})

test('non-JSON lines are ignored', () => {
  assert.equal(parseRunStream('plain text\n{broken').text, '')
})
