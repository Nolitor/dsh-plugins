import test from 'node:test'
import assert from 'node:assert/strict'

import { DEFAULT_EFFORT, DEFAULT_MODEL, buildAgyArgv, parseAgyOutput } from '../lib/backends.js'
import { globToRegExp } from '../lib/artifacts.js'

test('argv carries the prompt beside -p and the measured flag order', () => {
  const argv = buildAgyArgv({ executable: 'agy', prompt: 'do the thing' })
  assert.deepEqual(argv, [
    'agy',
    '-p',
    'do the thing',
    '--model',
    DEFAULT_MODEL,
    '--effort',
    DEFAULT_EFFORT,
    '--output-format',
    'json',
  ])
})

test('argv honours model, effort, and extra args', () => {
  const argv = buildAgyArgv({
    executable: '/usr/bin/agy',
    prompt: 'x',
    model: 'gemini-3.8-pro',
    effort: 'high',
    extraArgs: ['--mode', 'plan'],
  })
  assert.deepEqual(argv.slice(3), [
    '--model',
    'gemini-3.8-pro',
    '--effort',
    'high',
    '--output-format',
    'json',
    '--mode',
    'plan',
  ])
})

test('argv never emits an empty -p', () => {
  assert.throws(() => buildAgyArgv({ executable: 'agy', prompt: undefined }), TypeError)
})

test('parses the JSON envelope including usage', () => {
  const stdout = JSON.stringify({
    conversation_id: 'c-1',
    status: 'SUCCESS',
    response: 'hello\n',
    usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 2, cache_read_tokens: 7 },
  })
  const parsed = parseAgyOutput(stdout)
  assert.equal(parsed.summary, 'hello')
  assert.equal(parsed.status, 'SUCCESS')
  assert.equal(parsed.conversationId, 'c-1')
  assert.deepEqual(parsed.usage, {
    inputTokens: 10,
    outputTokens: 5,
    thinkingTokens: 2,
    cacheReadTokens: 7,
  })
  assert.equal(parsed.parsed, true)
})

test('degrades to raw text when the envelope is not JSON', () => {
  const parsed = parseAgyOutput('Error: -p took "--model" as its prompt')
  assert.equal(parsed.parsed, false)
  assert.match(parsed.summary, /took "--model" as its prompt/)
  assert.equal(parsed.usage.inputTokens, 0)
})

test('empty stdout yields an empty result', () => {
  const parsed = parseAgyOutput('   ')
  assert.equal(parsed.summary, '')
  assert.equal(parsed.parsed, false)
})

test('glob translation handles recursive, single-segment, and literal paths', () => {
  assert.ok(globToRegExp('dist/**/*.js').test('dist/a/b/c.js'))
  assert.ok(globToRegExp('dist/**/*.js').test('dist/c.js'))
  assert.ok(globToRegExp('*.md').test('README.md'))
  assert.equal(globToRegExp('*.md').test('docs/README.md'), false)
  assert.ok(globToRegExp('a+b.txt').test('a+b.txt'))
})
