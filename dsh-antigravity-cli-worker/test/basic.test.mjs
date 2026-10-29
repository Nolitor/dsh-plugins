import test from 'node:test'
import assert from 'node:assert/strict'
import { buildAgyArgv, parseAgyOutput } from '../lib/backends.js'

test('buildAgyArgv uses defaults', () => {
  const argv = buildAgyArgv({ executable: 'agy' })
  assert.deepEqual(argv, ['agy', '-p', '--model', 'gemini-3.8-flash-low', '--effort', 'low', '--output-format', 'json'])
})

test('parseAgyOutput parses json', () => {
  const json = JSON.stringify({
    conversation_id: '123',
    status: 'SUCCESS',
    response: 'hello',
    usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 0, cache_read_tokens: 2 }
  })
  const res = parseAgyOutput(json)
  assert.equal(res.summary, 'hello')
  assert.equal(res.usage.inputTokens, 10)
  assert.equal(res.usage.cacheReadTokens, 2)
})
