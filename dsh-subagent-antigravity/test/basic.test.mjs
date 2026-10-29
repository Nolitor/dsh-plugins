import test from 'node:test'
import assert from 'node:assert/strict'

import { buildArgv, parseAgyEnvelope } from '../lib/index.js'

test('a model id with an encoded level emits no --effort', () => {
  const argv = buildArgv({
    executable: 'agy',
    prompt: 'task',
    model: 'gemini-3.8-flash-high',
    effort: 'low',
    mode: 'accept-edits',
  })
  assert.deepEqual(argv, ['agy', '-p', 'task', '--model', 'gemini-3.8-flash-high', '--mode', 'accept-edits', '--output-format', 'json'])
})

test('a base model id carries --effort', () => {
  const argv = buildArgv({
    executable: 'agy',
    prompt: 'task',
    model: 'gemini-3.8-flash',
    effort: 'medium',
    mode: 'plan',
  })
  assert.deepEqual(argv.slice(3), ['--model', 'gemini-3.8-flash', '--effort', 'medium', '--mode', 'plan', '--output-format', 'json'])
})

test('parses the success envelope into answer text', () => {
  const parsed = parseAgyEnvelope(JSON.stringify({ status: 'SUCCESS', response: 'done\n' }))
  assert.deepEqual(parsed, { text: 'done', status: 'SUCCESS', error: '' })
})

test('reports an ERROR envelope separately from its text', () => {
  const parsed = parseAgyEnvelope(JSON.stringify({ status: 'ERROR', error: 'quota', response: '' }))
  assert.equal(parsed.status, 'ERROR')
  assert.equal(parsed.error, 'quota')
})

test('a non-JSON payload is preserved instead of dropped', () => {
  const parsed = parseAgyEnvelope('error: invalid model selection')
  assert.equal(parsed.text, 'error: invalid model selection')
  assert.equal(parsed.status, '')
})

test('empty output yields empty text', () => {
  assert.deepEqual(parseAgyEnvelope('   '), { text: '', status: '', error: '' })
})
