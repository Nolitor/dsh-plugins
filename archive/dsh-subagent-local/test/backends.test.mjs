import test from 'node:test'
import assert from 'node:assert/strict'

import {
  BACKENDS,
  DEFAULT_AUTO_ORDER,
  MAX_ARG_STRLEN,
  MAX_STDIN_PROMPT_BYTES,
  assertPromptFits,
  buildAgyArgv,
  buildInvocation,
  buildClaudeArgv,
  buildCodexArgv,
  buildOpencodeArgv,
  effortOfModel,
  parseAgyOutput,
  parseClaudeOutput,
  parseCodexOutput,
  parseOpencodeOutput,
  parseOutput,
  usesArgvPrompt,
} from '../lib/backends.js'
import { canonicalBackend } from '../lib/worker.js'

const PROMPT = 'SECRET TASK: build the thing'

test('backends and auto order are the four local CLIs', () => {
  assert.deepEqual([...BACKENDS], ['antigravity', 'opencode', 'codex', 'claude'])
  assert.deepEqual([...DEFAULT_AUTO_ORDER], [...BACKENDS])
})

test('prompt transport: agy is argv, every other backend is stdin', () => {
  assert.equal(usesArgvPrompt('antigravity'), true)
  for (const backend of ['opencode', 'codex', 'claude']) assert.equal(usesArgvPrompt(backend), false)
})

test('stdin backends never put the task text in argv', () => {
  for (const backend of ['opencode', 'codex', 'claude']) {
    const invocation = buildInvocation({ backend, executable: `/usr/bin/${backend}`, prompt: PROMPT })
    assert.equal(invocation.stdinPrompt, PROMPT)
    assert.equal(
      invocation.argv.some((argument) => argument.includes('SECRET TASK')),
      false,
      `${backend} argv leaked the prompt: ${invocation.argv.join(' ')}`,
    )
  }
})

test('agy puts the task beside -p because stdin is ignored in print mode', () => {
  const invocation = buildInvocation({ backend: 'antigravity', executable: '/usr/bin/agy', prompt: PROMPT })
  assert.equal(invocation.stdinPrompt, null)
  assert.deepEqual(invocation.argv.slice(0, 3), ['/usr/bin/agy', '-p', PROMPT])
  assert.deepEqual(invocation.argv.slice(-4), ['--mode', 'accept-edits', '--output-format', 'json'])
})

test('opencode argv: run, model, json format, auto approval', () => {
  const argv = buildOpencodeArgv({
    executable: '/home/minami/.bun/bin/opencode',
    prompt: PROMPT,
    model: 'opencode-go/beam-free',
    auto: true,
  })
  assert.deepEqual(argv, [
    '/home/minami/.bun/bin/opencode',
    'run',
    '-m',
    'opencode-go/beam-free',
    '--format',
    'json',
    '--auto',
  ])
})

test('codex argv: exec --json, trailing stdin marker, model and sandbox mode', () => {
  const argv = buildCodexArgv({
    executable: 'codex',
    prompt: PROMPT,
    model: 'gpt-5-codex',
    mode: 'workspace-write',
    effort: 'high',
    extraArgs: ['--full-auto'],
  })
  assert.deepEqual(argv, [
    'codex',
    'exec',
    '--json',
    '--skip-git-repo-check',
    '--model',
    'gpt-5-codex',
    '--sandbox',
    'workspace-write',
    '-c',
    'model_reasoning_effort=high',
    '--full-auto',
    '-',
  ])
})

test('claude argv: print mode with a json envelope; invalid permission mode is rejected', () => {
  const argv = buildClaudeArgv({
    executable: 'claude',
    prompt: PROMPT,
    model: 'claude-sonnet-4-5',
    mode: 'plan',
  })
  assert.deepEqual(argv, [
    'claude',
    '-p',
    '--output-format',
    'json',
    '--model',
    'claude-sonnet-4-5',
    '--permission-mode',
    'plan',
  ])
  assert.throws(
    () => buildClaudeArgv({ executable: 'claude', prompt: PROMPT, mode: 'yolo' }),
    RangeError,
  )
})

test('agy effort is encoded in the model id or passed as --effort, never both', () => {
  assert.equal(effortOfModel('gemini-3.8-flash-low'), 'low')
  assert.equal(effortOfModel('gemini-3.8-flash'), '')

  const encoded = buildAgyArgv({ executable: 'agy', prompt: PROMPT, model: 'gemini-3.8-flash-high', effort: 'high' })
  assert.equal(encoded.includes('--effort'), false)

  const base = buildAgyArgv({ executable: 'agy', prompt: PROMPT, model: 'gemini-3.8-flash', effort: 'high' })
  assert.deepEqual(base.slice(5, 7), ['--effort', 'high'])

  assert.throws(
    () => buildAgyArgv({ executable: 'agy', prompt: PROMPT, model: 'gemini-3.8-flash-low', effort: 'high' }),
    RangeError,
  )
})

test('prompt limits are enforced before the CLI runs', () => {
  assert.throws(() => assertPromptFits({ backend: 'antigravity', prompt: '   ' }), TypeError)
  assert.throws(
    () => assertPromptFits({ backend: 'antigravity', prompt: 'a'.repeat(MAX_ARG_STRLEN) }),
    RangeError,
  )
  assert.doesNotThrow(() =>
    assertPromptFits({ backend: 'antigravity', prompt: 'a'.repeat(MAX_ARG_STRLEN - 1) }),
  )
  assert.throws(
    () => assertPromptFits({ backend: 'codex', prompt: 'a'.repeat(MAX_STDIN_PROMPT_BYTES + 1) }),
    RangeError,
  )
})

test('unknown backend is rejected with the supported list', () => {
  assert.throws(
    () => buildInvocation({ backend: 'gemini', executable: 'x', prompt: PROMPT }),
    /unknown local delegation backend "gemini"/,
  )
  assert.equal(canonicalBackend('AUTO'), '')
  assert.equal(canonicalBackend('Opencode'), 'opencode')
  assert.throws(() => canonicalBackend('nope'), RangeError)
})

test('agy JSON envelope is parsed with usage and conversation id', () => {
  const parsed = parseAgyOutput(JSON.stringify({
    conversation_id: 'c-1',
    status: 'SUCCESS',
    response: 'done\n',
    usage: { input_tokens: 10, output_tokens: 5, thinking_tokens: 2, cache_read_tokens: 7 },
  }))
  assert.equal(parsed.summary, 'done')
  assert.equal(parsed.status, 'SUCCESS')
  assert.equal(parsed.conversationId, 'c-1')
  assert.deepEqual(parsed.usage, { inputTokens: 10, outputTokens: 5, thinkingTokens: 2, cacheReadTokens: 7 })
  assert.equal(parsed.parsed, true)
})

test('opencode NDJSON keeps the last cumulative text snapshot per part', () => {
  const stdout = [
    JSON.stringify({ type: 'text', part: { id: 'p1', text: 'Hel' } }),
    JSON.stringify({ type: 'reasoning', part: { id: 'r1', text: 'thinking' } }),
    JSON.stringify({ type: 'text', part: { id: 'p1', text: 'Hello' } }),
    JSON.stringify({ type: 'text', part: { id: 'p2', text: ' world' } }),
    'not json noise',
  ].join('\n')
  const parsed = parseOpencodeOutput(stdout)
  assert.equal(parsed.summary, 'Hello world')
  assert.equal(parsed.status, 'SUCCESS')
  assert.deepEqual(parsed.errors, [])
})

test('opencode error events are reported instead of silently dropped', () => {
  const parsed = parseOpencodeOutput(JSON.stringify({ type: 'error', error: { message: 'quota exhausted' } }))
  assert.equal(parsed.status, 'ERROR')
  assert.deepEqual(parsed.errors, ['quota exhausted'])
})

test('codex JSONL keeps the last completed agent message and turn usage', () => {
  const stdout = [
    JSON.stringify({ type: 'thread.started', thread_id: 't1' }),
    JSON.stringify({ type: 'item.completed', item: { type: 'agent_message', text: 'first answer' } }),
    JSON.stringify({ type: 'item.completed', item: { type: 'reasoning', text: 'hidden' } }),
    JSON.stringify({
      type: 'turn.completed',
      usage: { input_tokens: 100, cached_input_tokens: 40, output_tokens: 20, reasoning_output_tokens: 3 },
    }),
  ].join('\n')
  const parsed = parseCodexOutput(stdout)
  assert.equal(parsed.summary, 'first answer')
  assert.deepEqual(parsed.usage, { inputTokens: 100, outputTokens: 20, thinkingTokens: 3, cacheReadTokens: 40 })
  assert.equal(parsed.status, 'SUCCESS')
})

test('claude result envelope is parsed and is_error is surfaced', () => {
  const parsed = parseClaudeOutput(JSON.stringify({
    type: 'result',
    subtype: 'success',
    is_error: false,
    result: 'the answer',
    session_id: 's-1',
    usage: { input_tokens: 12, output_tokens: 4, cache_read_input_tokens: 6 },
  }))
  assert.equal(parsed.summary, 'the answer')
  assert.equal(parsed.conversationId, 's-1')
  assert.deepEqual(parsed.usage, { inputTokens: 12, outputTokens: 4, thinkingTokens: 0, cacheReadTokens: 6 })

  const failed = parseClaudeOutput(JSON.stringify({ type: 'result', is_error: true, result: 'denied' }))
  assert.equal(failed.status, 'ERROR')
  assert.deepEqual(failed.errors, ['denied'])
})

test('a non-JSON payload degrades to raw text instead of being lost', () => {
  for (const backend of ['antigravity', 'claude']) {
    const parsed = parseOutput(backend, 'Error: bad flag')
    assert.equal(parsed.parsed, false)
    assert.match(parsed.summary, /bad flag/)
  }
  assert.equal(parseOutput('antigravity', '').summary, '')
})
