/**
 * Pure OpenAI-compatible mapping helpers.
 *
 * These three functions were extracted verbatim from `lib/http.js` (Phase B,
 * increment B-1) so the wire vocabulary of this adapter lives in one module
 * that imports nothing from the adapter itself. They are pure: no I/O, no
 * context, no state. `lib/http.js` re-exports them, so every existing import
 * path and test keeps working unchanged.
 *
 * @module @nolit/dsh-opencode-v2/openai-mapping
 */

/** Map OpenAI's final `usage` object onto DSH's disjoint buckets. */
export function usageFromOpenAi(raw) {
  const prompt = Number(raw?.prompt_tokens ?? 0)
  const cached = Number(raw?.prompt_tokens_details?.cached_tokens ?? 0)
  const output = Number(raw?.completion_tokens ?? 0)
  const reasoning = Number(raw?.completion_tokens_details?.reasoning_tokens ?? 0)
  const usage = {
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: output,
    cacheReadTokens: cached,
    cacheWriteTokens: 0,
  }
  if (Number.isFinite(reasoning) && reasoning > 0) usage.reasoningTokens = reasoning
  usage.totalTokens = usage.inputTokens + usage.outputTokens + usage.cacheReadTokens
  return usage
}

/**
 * Upstream finish reasons that mean "the model stopped on its own terms".
 *
 * Kept apart from the unknown reason on purpose: collapsing an UNRECOGNISED
 * reason into `stop` (the previous behaviour) reports a filtered or
 * resource-starved response as a clean completion, and the host commits it.
 */
const STOP_REASONS = new Set(['stop', 'end_turn', 'eos', 'completed', 'stop_sequence', null, undefined])
/** Reasons that end the response normally even though a tool call is involved. */
const TOOL_REASONS = new Set(['tool_calls', 'function_call', 'tool_use', 'tool_use_start'])
/** Reasons that mean the output hit its budget. */
const LENGTH_REASONS = new Set(['length', 'max_tokens', 'max_output_tokens', 'token_limit'])
/** Reasons that mean the provider intervened: an error, never a clean stop. */
const FILTER_REASONS = new Set(['content_filter', 'safety', 'refusal', 'blocked', 'guardrail'])
/** Reasons that mean the provider was out of capacity mid-generation. */
const RESOURCE_REASONS = new Set(['insufficient_system_resource', 'server_busy', 'overloaded'])

/**
 * Map an upstream `finish_reason` onto a DSH finish reason.
 *
 * The host's vocabulary is fixed (`stop | tool-calls | max-tokens | aborted |
 * error`; measured in dsh-llm `FinishReasonMap`), so a provider-specific reason
 * has to land on one of those five. `error` is the honest home for the ones that
 * are not a clean completion; the failure code says which family it came from.
 *
 * Measured 2026-11-04: 6,131 recorded finishes produced only three distinct
 * outcomes before this change, because every unrecognised reason fell through to
 * `stop`.
 *
 * @param {string|null|undefined} reason - the upstream `finish_reason`.
 * @returns {{kind: string, failure?: {code: string, message: string}}}
 */
export function finishFromOpenAi(reason) {
  const value = typeof reason === 'string' ? reason.toLowerCase() : reason
  if (TOOL_REASONS.has(value)) return { kind: 'tool-calls' }
  if (LENGTH_REASONS.has(value)) return { kind: 'max-tokens' }
  if (STOP_REASONS.has(value)) return { kind: 'stop' }
  if (FILTER_REASONS.has(value)) {
    return {
      kind: 'error',
      failure: {
        code: 'OPENCODE_FINISH_FILTERED',
        message: `the route stopped the response with finish_reason "${reason}"; the output is incomplete`,
      },
    }
  }
  if (RESOURCE_REASONS.has(value)) {
    return {
      kind: 'error',
      failure: {
        code: 'OPENCODE_FINISH_RESOURCE',
        message: `the route ran out of capacity with finish_reason "${reason}"; the output is incomplete`,
      },
    }
  }
  return {
    kind: 'error',
    failure: {
      code: 'OPENCODE_FINISH_UNKNOWN',
      message: `the route reported finish_reason "${reason}", which this adapter does not classify; treating it as an incomplete response rather than a clean stop`,
    },
  }
}

/**
 * Reasoning-token accounting for one stream.
 *
 * Two measured facts drive this helper. Reasoning is 86.1% of this profile's
 * output characters (761 reasoning vs 123 content characters per recorded step),
 * yet `reasoning_tokens` reaches the adapter in 2 of 35 recorded steps. A number
 * that is either absent or zero looks identical downstream, so the absence is
 * reported instead of being silently dropped.
 *
 * @param {object|null} usage - the final `usage` object of the stream.
 * @returns {{ state: 'reported'|'measured-zero'|'not-reported', tokens: number|null,
 *   hasField: boolean }}
 */
export function reasoningAccounting(usage) {
  const detail = usage?.completion_tokens_details
  const hasField = Boolean(detail) && Object.prototype.hasOwnProperty.call(detail, 'reasoning_tokens')
  const tokens = hasField ? Number(detail.reasoning_tokens) : null
  if (!hasField) return { state: 'not-reported', tokens: null, hasField: false }
  if (Number.isFinite(tokens) && tokens > 0) return { state: 'reported', tokens, hasField: true }
  return { state: 'measured-zero', tokens: 0, hasField: true }
}
