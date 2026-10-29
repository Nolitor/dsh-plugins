import test from 'node:test'
import assert from 'node:assert/strict'

import {
  DEFAULT_EFFORT,
  DEFAULT_MODE,
  DEFAULT_MODEL,
  effortOfModel,
  buildAgyArgv,
  parseAgyOutput,
} from '../lib/backends.js'
import { globToRegExp } from '../lib/artifacts.js'
import { parseCommandInput } from '../lib/index.js'

test('argv carries the prompt beside -p and the measured flag order', () => {
  const argv = buildAgyArgv({ executable: 'agy', prompt: 'do the thing' })
  assert.deepEqual(argv, [
    'agy',
    '-p',
    'do the thing',
    '--model',
    DEFAULT_MODEL,
    '--mode',
    DEFAULT_MODE,
    '--output-format',
    'json',
  ])
})

test('a model id that encodes its level emits no --effort', () => {
  const argv = buildAgyArgv({ executable: 'agy', prompt: 'x', model: 'gemini-3.8-flash-high', effort: 'high' })
  assert.equal(argv.includes('--effort'), false)
  assert.equal(effortOfModel('gemini-3.8-flash-high'), 'high')
})

test('a conflicting --effort is rejected before the CLI runs', () => {
  assert.throws(
    () => buildAgyArgv({ executable: 'agy', prompt: 'x', model: 'gemini-3.8-flash-low', effort: 'high' }),
    RangeError,
  )
})

test('a base model id keeps --effort and extra args stay verbatim', () => {
  const argv = buildAgyArgv({
    executable: '/usr/bin/agy',
    prompt: 'x',
    model: 'gemini-3.8-flash',
    effort: 'high',
    mode: 'plan',
    extraArgs: ['--sandbox'],
  })
  assert.deepEqual(argv.slice(3), [
    '--model',
    'gemini-3.8-flash',
    '--effort',
    'high',
    '--mode',
    'plan',
    '--output-format',
    'json',
    '--sandbox',
  ])
})

test('argv never emits an empty -p', () => {
  assert.throws(() => buildAgyArgv({ executable: 'agy', prompt: undefined }), TypeError)
})

test('a task above the single-argument limit is rejected with guidance', () => {
  const huge = 'a'.repeat(131072)
  assert.throws(() => buildAgyArgv({ executable: 'agy', prompt: huge }), RangeError)
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

test('command input keeps a task that contains flag-like text', () => {
  const parsed = parseCommandInput('--model gemini-3.8-flash-high explain --strict mode')
  assert.equal(parsed.options.model, 'gemini-3.8-flash-high')
  assert.equal(parsed.task, 'explain --strict mode')
  assert.deepEqual(parsed.unknown, [])
})

test('command input reports an unknown leading option', () => {
  const parsed = parseCommandInput('--nope value')
  assert.deepEqual(parsed.unknown, ['nope'])
})

test('glob translation handles recursive, single-segment, and literal paths', () => {
  assert.ok(globToRegExp('dist/**/*.js').test('dist/a/b/c.js'))
  assert.ok(globToRegExp('dist/**/*.js').test('dist/c.js'))
  assert.ok(globToRegExp('*.md').test('README.md'))
  assert.equal(globToRegExp('*.md').test('docs/README.md'), false)
  assert.ok(globToRegExp('a+b.txt').test('a+b.txt'))
})

test('default effort is the level encoded by the default model', () => {
  assert.equal(effortOfModel(DEFAULT_MODEL), DEFAULT_EFFORT)
})
