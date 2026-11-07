/**
 * Wire helpers shared by every provider hook.
 *
 * @module @nolit/dsh-custom-router/stream/wire
 */

/**
 * Normalize one provider finish value onto the shared six-way table.
 *
 * Providers spell the same semantic outcome differently: OpenAI says `length`
 * where Gemini says `MAX_TOKENS`, OpenAI says `content_filter` where Gemini says
 * `SAFETY`. Without one table two adapters reported a filtered response as a
 * clean `stop`, which the host then committed as a complete answer.
 *
 * @param value - the provider's raw finish value.
 * @returns `{ kind, failure? }` in the host's `FinishReason` shape.
 */
export function finishReasonFor(value) {
  const raw = typeof value === 'string' ? value.trim().toLowerCase() : value
  if (raw === null || raw === undefined || raw === '') return { kind: 'stop' }

  if (FINISH_NORMAL.has(raw)) return { kind: 'stop' }
  if (FINISH_TOOLS.has(raw)) return { kind: 'tool-calls' }
  if (FINISH_BUDGET.has(raw)) return { kind: 'max-tokens' }
  if (FINISH_FILTER.has(raw)) {
    return {
      kind: 'error',
      failure: { code: 'CONTENT_FILTERED', message: `the provider stopped generation: ${value}` },
    }
  }
  if (FINISH_RESOURCE.has(raw)) {
    return {
      kind: 'error',
      failure: { code: 'PROVIDER_RESOURCE', message: `the provider ran out of capacity: ${value}` },
    }
  }
  return {
    kind: 'error',
    failure: { code: 'UNKNOWN_FINISH_REASON', message: `unrecognised finish reason: ${value}` },
  }
}

const FINISH_NORMAL = new Set([
  'stop', 'end_turn', 'eos', 'completed', 'stop_sequence', 'stopsequence', 'finish_reason_stop',
  'pause_turn', // Anthropic: a long turn paused and can be resumed, not truncated
])
const FINISH_TOOLS = new Set(['tool_calls', 'function_call', 'tool_use', 'tool_use_start', 'tool_calls_start'])
const FINISH_BUDGET = new Set([
  'length', 'max_tokens', 'max_output_tokens', 'token_limit', 'max_tokens_reached',
  'model_context_window_exceeded', // Anthropic: the context window, not the output budget, ran out
])
const FINISH_FILTER = new Set([
  'content_filter', 'safety', 'recitation', 'blocklist', 'prohibited_content', 'spii', 'refusal', 'blocked', 'guardrail',
])
const FINISH_RESOURCE = new Set([
  'insufficient_system_resource', 'server_busy', 'overloaded', 'other', 'resource_exhausted',
])

/**
 * Read a count from a provider field.
 *
 * @param value - any provider value.
 * @returns a non-negative integer, or undefined when the value is not a count.
 */
export function count(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) return undefined
  return Math.trunc(value)
}
