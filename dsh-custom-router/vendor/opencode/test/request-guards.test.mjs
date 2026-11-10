/**
 * Tier A guards — behaviour pinned against deepseek-recipe and the host contract.
 *
 * Every case here is either a rule copied from deepseek-recipe
 * (`protocol/validation.rs`, `ConversationRequest::resolve_max_tokens`) or a
 * defect measured on recorded traffic (see RECIPE-CAPABILITY-DELTA.md §2).
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  Config,
  finishFromOpenAi,
  estimatePromptTokens,
  reasoningAccounting,
} from '../lib/http.js'
import {
  MAX_STOP_SEQUENCES,
  MAX_TOOL_NAME_LEN,
  RequestShapeError,
  resolveRequestMaxTokens,
  validateRequest,
  validateStop,
  validateTools,
} from '../lib/request-guards.js'

// --- max_tokens clamp (recipe: ConversationRequest::resolve_max_tokens) ---

test('the completion budget never exceeds what is left of the window', () => {
  // 1M window, 984,000 prompt tokens: only 16,000 remain, so a 16,384
  // reservation has to come down; the route would reject it otherwise.
  const result = resolveRequestMaxTokens({ reservation: 16384, promptTokens: 984000, contextWindow: 1000000 })
  assert.equal(result.maxTokens, 16000)
  assert.equal(result.clamped, true)
  assert.equal(result.remaining, 16000)
  assert.equal(result.overflow, null)
})

test('a reservation that fits is passed through untouched', () => {
  const result = resolveRequestMaxTokens({ reservation: 16384, promptTokens: 1000, contextWindow: 1000000 })
  assert.equal(result.maxTokens, 16384)
  assert.equal(result.clamped, false)
})

test('the budget is floored at 1, never zero or negative', () => {
  const exact = resolveRequestMaxTokens({ reservation: 16384, promptTokens: 990000, contextWindow: 1000000 })
  assert.equal(exact.maxTokens, 10000)
  const over = resolveRequestMaxTokens({ reservation: 16384, promptTokens: 999999, contextWindow: 1000000 })
  assert.equal(over.maxTokens, 1)
  assert.equal(over.clamped, true)
})

test('a prompt that alone exceeds the window is reported as overflow, not clamped to a silent 1', () => {
  const result = resolveRequestMaxTokens({ reservation: 16384, promptTokens: 1200000, contextWindow: 1000000 })
  assert.deepEqual(result.overflow, { promptTokens: 1200000, contextWindow: 1000000 })
  assert.equal(result.remaining, 0)
})

test('an unknown window or prompt leaves the reservation alone', () => {
  assert.equal(resolveRequestMaxTokens({ reservation: 16384 }).maxTokens, 16384)
  assert.equal(resolveRequestMaxTokens({ reservation: 16384, contextWindow: 0 }).clamped, false)
  assert.equal(resolveRequestMaxTokens({ reservation: 16384, promptTokens: undefined, contextWindow: 1000 }).maxTokens, 1000)
})

test('a zero or missing reservation still yields a positive budget', () => {
  assert.equal(resolveRequestMaxTokens({ reservation: 0, promptTokens: 100, contextWindow: 1000 }).maxTokens, 900)
  assert.equal(resolveRequestMaxTokens({ reservation: 0 }).maxTokens, 1)
})

// --- tool validation (recipe: validate_tool_name, duplicate_tool_names) ---

test('a well-formed tool block validates', () => {
  const result = validateTools([
    { name: 'bash', description: 'run', parameters: { type: 'object', properties: {} } },
    { name: 'read_file-2', parameters: { type: 'object' } },
  ])
  assert.equal(result.ok, true, result.errors.join('; '))
})

test('an empty tool name is refused', () => {
  const result = validateTools([{ name: '', parameters: { type: 'object' } }])
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /name.*empty/i)
})

test('a tool name longer than recipe\'s 128-byte limit is refused', () => {
  const result = validateTools([{ name: 'a'.repeat(MAX_TOOL_NAME_LEN + 1) }])
  assert.equal(result.ok, false)
  assert.match(result.errors[0], /too long/)
  assert.equal(validateTools([{ name: 'a'.repeat(MAX_TOOL_NAME_LEN) }]).ok, true)
})

test('a tool name outside ^[a-zA-Z0-9_-]+$ is refused', () => {
  for (const name of ['run code', 'run.code', 'run/code', '도구']) {
    const result = validateTools([{ name }])
    assert.equal(result.ok, false, `${name} must be refused`)
    assert.match(result.errors.join(' '), /does not match/)
  }
})

test('duplicate tool names are refused', () => {
  const result = validateTools([{ name: 'bash' }, { name: 'bash' }])
  assert.equal(result.ok, false)
  assert.match(result.errors.join(' '), /Duplicate tool name 'bash'/)
})

test('a parameters value that is not a JSON object is refused', () => {
  for (const parameters of ['{"type":"object"}', [], null, 42]) {
    const result = validateTools([{ name: 'bash', parameters }])
    assert.equal(result.ok, false, JSON.stringify(parameters))
  }
})

test('an absent or non-array tool block is handled without throwing', () => {
  assert.equal(validateTools(undefined).ok, true)
  assert.equal(validateTools(null).ok, true)
  const notArray = validateTools({ name: 'bash' })
  assert.equal(notArray.ok, false)
  assert.match(notArray.errors[0], /must be an array/)
})

// --- stop validation (recipe: validate_stop_sequences) ---

test('stop lists follow recipe\'s limits: no empty entry, at most 16', () => {
  assert.equal(validateStop(undefined).ok, true)
  assert.equal(validateStop('END').ok, true)
  const empty = validateStop(['END', ''])
  assert.equal(empty.ok, false)
  assert.match(empty.errors[0], /empty string/)
  const tooMany = validateStop(Array.from({ length: MAX_STOP_SEQUENCES + 1 }, (_, i) => `s${i}`))
  assert.equal(tooMany.ok, false)
  assert.match(tooMany.errors[0], /too long/)
  assert.equal(validateStop(Array.from({ length: MAX_STOP_SEQUENCES }, (_, i) => `s${i}`)).ok, true)
})

test('validateRequest reports both families at once', () => {
  const result = validateRequest({ tools: [{ name: 'a b' }], stop: [''] })
  assert.equal(result.ok, false)
  assert.equal(result.errors.length, 2)
})

test('RequestShapeError carries a stable code', () => {
  const error = new RequestShapeError('OPENCODE_REQUEST_INVALID', 'nope')
  assert.equal(error.code, 'OPENCODE_REQUEST_INVALID')
  assert.equal(error.name, 'RequestShapeError')
  assert.ok(error instanceof Error)
})

// --- finish_reason mapping (measured: 6,131 finishes had 3 outcomes) ---

test('the five DSH finish kinds are all reachable and honest', () => {
  assert.deepEqual(finishFromOpenAi('tool_calls'), { kind: 'tool-calls' })
  assert.deepEqual(finishFromOpenAi('function_call'), { kind: 'tool-calls' })
  assert.deepEqual(finishFromOpenAi('length'), { kind: 'max-tokens' })
  assert.deepEqual(finishFromOpenAi('stop'), { kind: 'stop' })
  assert.deepEqual(finishFromOpenAi(null), { kind: 'stop' })
  assert.deepEqual(finishFromOpenAi(undefined), { kind: 'stop' })
})

test('a filtered response is never reported as a clean stop', () => {
  const filtered = finishFromOpenAi('content_filter')
  assert.equal(filtered.kind, 'error')
  assert.equal(filtered.failure.code, 'OPENCODE_FINISH_FILTERED')
  assert.ok(!/retry/i.test(filtered.failure.code))
})

test('a resource-starved response is its own family', () => {
  const busy = finishFromOpenAi('insufficient_system_resource')
  assert.equal(busy.kind, 'error')
  assert.equal(busy.failure.code, 'OPENCODE_FINISH_RESOURCE')
})

test('an unknown reason is an error, not a stop', () => {
  const unknown = finishFromOpenAi('some_new_reason')
  assert.equal(unknown.kind, 'error')
  assert.equal(unknown.failure.code, 'OPENCODE_FINISH_UNKNOWN')
  assert.match(unknown.failure.message, /some_new_reason/)
})

test('reason matching is case-insensitive and alias-aware', () => {
  assert.equal(finishFromOpenAi('TOOL_CALLS').kind, 'tool-calls')
  assert.equal(finishFromOpenAi('max_tokens').kind, 'max-tokens')
  assert.equal(finishFromOpenAi('end_turn').kind, 'stop')
  assert.equal(finishFromOpenAi('tool_use').kind, 'tool-calls')
})

// --- reasoning accounting (measured: 2 of 35 steps carried the field) ---

test('reasoning accounting separates absence from a measured zero', () => {
  assert.equal(reasoningAccounting(null).state, 'not-reported')
  assert.equal(reasoningAccounting({ completion_tokens: 5 }).state, 'not-reported')
  assert.equal(reasoningAccounting({ completion_tokens_details: {} }).state, 'not-reported')
  const zero = reasoningAccounting({ completion_tokens_details: { reasoning_tokens: 0 } })
  assert.equal(zero.state, 'measured-zero')
  assert.equal(zero.hasField, true)
  const reported = reasoningAccounting({ completion_tokens_details: { reasoning_tokens: 42 } })
  assert.equal(reported.state, 'reported')
  assert.equal(reported.tokens, 42)
})

// --- prompt estimate (the input to the clamp) ---

test('the prompt estimate counts messages and tool schemas', () => {
  const body = {
    messages: [
      { role: 'system', content: 'x'.repeat(350) },
      { role: 'assistant', content: null, tool_calls: [{ id: 'c', function: { name: 'bash', arguments: '{}' } }] },
    ],
    tools: [{ type: 'function', function: { name: 'bash', parameters: { type: 'object' } } }],
  }
  const estimate = estimatePromptTokens(body)
  assert.ok(estimate >= 100, `estimate ${estimate} must cover the 350-char system message`)
  assert.equal(estimatePromptTokens({}), 0)
})

test('the guards are pure: they never mutate the request they inspect', () => {
  const options = { tools: [{ name: 'bash', parameters: { type: 'object' } }], stop: ['x'] }
  const snapshot = JSON.stringify(options)
  validateRequest(options)
  resolveRequestMaxTokens({ reservation: 10, promptTokens: 1, contextWindow: 100 })
  assert.equal(JSON.stringify(options), snapshot)
})

test('Config still parses with the guards in place', () => {
  const config = Config({ reasoningField: 'reasoning_content', effortField: 'reasoning_effort' })
  assert.equal(config.turnMaxTokens.get() > 0, true)
})
