/**
 * EXAONE wire layer: provider facts, the vendor request quirks, and the one
 * request body EXAONE accepts.
 *
 * The facts below are read from the official platform docs (docs.exaone.ai,
 * 2026-11-13), not inferred from an OpenAI-compatibility claim:
 *
 *   base URL      https://api.exaone.ai
 *   completion    POST /v1/chat/completions (OpenAI-compatible)
 *   auth          Authorization: Bearer <key>
 *   streaming     text/event-stream, each frame `data: <json>`, terminated by `data: [DONE]`
 *   model         k-exaone_v2.5 (the platform's only chat model)
 *   reasoning     message/delta.reasoning_content; usage.reasoning_tokens
 *   effort        reasoning_effort: low | high | max (default max)
 *   context       524,288 tokens; input tokens + max_tokens must not exceed it
 *   multi-turn    chat_template_kwargs.preserve_thinking (recommended true for agents)
 *   tools         the platform advertises tool calling and structured outputs
 *
 * The OpenAI request projection itself is NOT defined here any more: message,
 * tool and content serialization live in `lib/stream/openai.js` (Phase 1). This
 * file keeps the four EXAONE-only deltas on top of it —
 *
 *   1. `EXAONE_EFFORT`: the harness advertises more effort ids than the platform
 *      has levels, so extra ids are FOLDED onto low|high|max;
 *   2. `chat_template_kwargs.preserve_thinking: true`, the platform's agent
 *      guidance for multi-turn tool work;
 *   3. the 16-stop ceiling, passed to the core as this route's declared value;
 *   4. refusal of options the platform provably rejects (negative temperature,
 *      more stops than the ceiling) — codes unchanged (`UNSUPPORTED_OPTION`),
 *      wording now the core's generic "OpenAI-compatible route" phrasing, which
 *      is why the two former EXAONE-worded throws are no longer duplicated here.
 *
 * The core's projection functions are re-exported so the `./wire` subpath keeps
 * the surface it published before the dedup.
 *
 * @module @nolit/dsh-exaone/wire
 */

import { MAX_STOP_SEQUENCES as OPENAI_MAX_STOP_SEQUENCES, requestBody as openaiRequestBody } from '../../../lib/stream/openai.js'

export {
  nonEmpty,
  positiveInteger,
  serializeMessages,
  serializeTools,
  textOf,
  toolCallsOf,
  userContent,
} from '../../../lib/stream/openai.js'

/** Provider base URL; override only for a compatible gateway. */
export const DEFAULT_BASE_URL = 'https://api.exaone.ai/v1'

/** Completion path under the base URL. */
export const COMPLETIONS_PATH = '/chat/completions'

/**
 * Stop-sequence ceiling for this route.
 *
 * OpenAI-compatible routes measured across vendors answer 32 stops with HTTP 422
 * ("maximum of 16 stop sequences allowed"); EXAONE docs state no number, so this
 * route takes the shared measured ceiling rather than inventing one.
 */
export const MAX_STOP_SEQUENCES = OPENAI_MAX_STOP_SEQUENCES

/** Default per-turn completion reservation (the platform allows up to the context). */
export const DEFAULT_TURN_MAX_TOKENS = 16384

/**
 * Documented context window (524,288 tokens).
 *
 * NOTE (measured 2026-11-14, 0 consumers repo-wide): `./catalog.js` also exports
 * `CONTEXT_WINDOW = 524288`, and that is the value the adapter advertises. This
 * constant is a second source of truth for the same number; it is retained
 * unexported from any code path but flagged here so the next pass can choose one.
 */
export const DEFAULT_CONTEXT_WINDOW = 524288

/** Harness effort ids folded onto the platform's three levels. */
export const EXAONE_EFFORT = Object.freeze({
  none: 'low',
  minimal: 'low',
  low: 'low',
  medium: 'high',
  high: 'high',
  xhigh: 'max',
  max: 'max',
})

/**
 * Build the completion request body.
 *
 * The body is the shared OpenAI projection; the two EXAONE quirks are applied on
 * top of it. Effort is folded by OVERWRITING the field the core wrote from the
 * harness id, so an id outside low|high|max can never leave this module.
 *
 * @param options - harness `GenerateOptions`.
 * @param settings - `{ maxTokens, reasoningEffort, temperature }` resolved values.
 * @returns the provider JSON body.
 * @throws when the request asks for something the provider cannot honor.
 */
export function requestBody(options, settings = {}) {
  // The core owns the stop ceiling and the negative-temperature refusal. This
  // route passes its declared ceiling explicitly so the number stays EXAONE's.
  const body = openaiRequestBody(options, { ...settings, maxStopSequences: MAX_STOP_SEQUENCES })

  const effort = settings.reasoningEffort ?? options.reasoningEffort
  if (typeof effort === 'string' && effort.length > 0) {
    body.reasoning_effort = EXAONE_EFFORT[effort] ?? effort
  }

  // The platform always reasons, and its agent guidance recommends preserving
  // earlier turns' reasoning for multi-turn tool work.
  body.chat_template_kwargs = { preserve_thinking: true }
  return body
}
