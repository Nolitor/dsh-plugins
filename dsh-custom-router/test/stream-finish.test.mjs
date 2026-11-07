import test from 'node:test'
import assert from 'node:assert/strict'
import { finishReasonFor } from '../lib/stream/wire.js'
import { CODES, abortedCompletion, cutCompletion, emptyCompletion, fail } from '../lib/stream/failure.js'

test('every normal stop spelling maps to stop, including the Gemini and Anthropic ones', () => {
  for (const value of ['stop', 'end_turn', 'eos', 'completed', 'stop_sequence', 'STOP', 'End_Turn', null, undefined]) {
    assert.deepEqual(finishReasonFor(value), { kind: 'stop' }, String(value))
  }
})

test('every tool-call spelling maps to tool-calls', () => {
  for (const value of ['tool_calls', 'function_call', 'tool_use', 'tool_use_start', 'TOOL_CALLS']) {
    assert.deepEqual(finishReasonFor(value), { kind: 'tool-calls' }, value)
  }
})

test('every budget spelling maps to max-tokens', () => {
  for (const value of ['length', 'max_tokens', 'max_output_tokens', 'token_limit', 'MAX_TOKENS']) {
    assert.deepEqual(finishReasonFor(value), { kind: 'max-tokens' }, value)
  }
})

test('a filtered response is an error, never a clean stop', () => {
  for (const value of ['content_filter', 'safety', 'refusal', 'blocked', 'guardrail', 'SAFETY', 'RECITATION', 'BLOCKLIST', 'PROHIBITED_CONTENT', 'SPII']) {
    const reason = finishReasonFor(value)
    assert.equal(reason.kind, 'error', value)
    assert.equal(reason.failure.code, CODES.CONTENT_FILTERED, value)
  }
})

test('a resource-starved response is an error with its own code', () => {
  for (const value of ['insufficient_system_resource', 'server_busy', 'overloaded', 'OTHER']) {
    const reason = finishReasonFor(value)
    assert.equal(reason.kind, 'error', value)
    assert.equal(reason.failure.code, CODES.PROVIDER_RESOURCE, value)
  }
})

test('an unrecognised finish reason is surfaced, not collapsed into stop', () => {
  const reason = finishReasonFor('brand_new_reason')
  assert.equal(reason.kind, 'error')
  assert.equal(reason.failure.code, CODES.UNKNOWN_FINISH_REASON)
  assert.match(reason.failure.message, /brand_new_reason/)
})

test('every failure carries both a message and a code', () => {
  for (const build of [
    () => fill(fail(CODES.PROTOCOL_DEFECT, 'x')),
    () => finishReasonFor('SAFETY').failure,
    () => emptyCompletion().reason.failure,
    () => cutCompletion({ code: 'ECONNRESET', message: 'socket closed' }).reason.failure,
    () => abortedCompletion().reason.failure,
  ]) {
    const failure = build()
    assert.equal(typeof failure.message, 'string')
    assert.ok(failure.message.length > 0)
    assert.equal(typeof failure.code, 'string')
    assert.ok(failure.code.length > 0)
  }
})

test('a failure factory refuses an empty code or message', () => {
  assert.throws(() => fail('', 'x'), TypeError)
  assert.throws(() => fail('CODE', ''), TypeError)
})

test('a cut keeps the original cause instead of replacing it with a retry message', () => {
  const chunk = cutCompletion({ code: 'ECONNRESET', message: 'socket hang up', status: 502 })
  assert.deepEqual(chunk.reason, {
    kind: 'error',
    failure: { message: 'socket hang up', status: 502, code: 'ECONNRESET' },
  })
})

test('an empty completion is an in-band finish, not a throw', () => {
  const chunk = emptyCompletion()
  assert.equal(chunk.type, 'finish')
  assert.equal(chunk.reason.kind, 'error')
  assert.equal(chunk.reason.failure.code, CODES.EMPTY_RESPONSE)
})

test('an abort is its own terminal kind', () => {
  const chunk = abortedCompletion()
  assert.equal(chunk.reason.kind, 'aborted')
  assert.equal(chunk.reason.failure.code, CODES.ABORTED)
})

function fill(failure) {
  return failure
}
