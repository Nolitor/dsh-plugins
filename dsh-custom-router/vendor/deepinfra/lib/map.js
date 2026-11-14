/**
 * Upstream mapping: one DeepInfra chat delta -> typed stream parts.
 *
 * WHAT IS LOCAL AND WHAT IS SHARED (Phase 2):
 *
 *   The delta mapper (`mapDelta` / `reasoningText` / `toolCallFragments` /
 *   `REASONING_FIELDS` / the three `PART_*` kind names) was byte-identical to
 *   `vendor/exaone/lib/map.js` and is now the shared OpenAI protocol core at
 *   `lib/stream/openai.js`. This file re-exports it rather than keeping a second
 *   copy: the boundary rule below is the same rule for every OpenAI-compatible
 *   route, and two copies of it is how the two vendors could drift.
 *
 *   What stays HERE is genuinely this vendor's: the `finishReason` wrapper that
 *   reports the `recognized` flag its callers and tests read, and
 *   `isFinishEvent`. Both delegate to the shared `finishReasonFor` table.
 *
 * The boundary rule is the one this workspace already paid for (failure ledger
 * F-22): **a delta's type comes from the wire field that carried it, never from
 * looking at its characters.** No tag scanners, no regex classifiers. Verified
 * against the live stream on 2026-11-04:
 *
 *   choices[].delta.content            -> text
 *   choices[].delta.reasoning_content  -> reasoning
 *   choices[].delta.tool_calls[]       -> tool-call (index/id/name/arguments)
 *
 * Measured tool-call fragmentation, which is the part a naive mapper gets wrong:
 * a call arrives as a first fragment carrying `index`, `id` and `function.name`
 * with EMPTY `arguments`, then one or more fragments carrying only `index` and a
 * slice of `function.arguments`. A small call can arrive complete in the first
 * fragment. Later fragments therefore have `id: null` and `name: null` and must
 * reuse the identity established by the first fragment — measured payload:
 *   [{index:0,id:"chatcmpl-tool-...",function:{name:"apply_edits",arguments:""}}]
 *   [{index:0,id:null,function:{arguments:"{\"edits\":[...2944 chars...]}"}}]
 *
 * DeepInfra also allows SEVERAL calls in one response, each with its own index.
 */

import { finishReasonFor } from '../../../lib/stream/index.js'
import {
  PART_REASONING,
  PART_TEXT,
  PART_TOOL_CALL,
  REASONING_FIELDS,
  mapDelta,
  reasoningText,
  toolCallFragments,
} from '../../../lib/stream/openai.js'

// The shared protocol core owns the delta mapping; this vendor re-exports it so
// every existing `@nolit/dsh-deepinfra/map` consumer keeps working unchanged.
export { PART_REASONING, PART_TEXT, PART_TOOL_CALL, REASONING_FIELDS, mapDelta, reasoningText, toolCallFragments }

/** Part kind this vendor names but the shared mapper never emits. */
export const PART_USAGE = 'usage'
export const PART_FINISH = 'finish'

/**
 * Translate the provider's finish_reason into a harness FinishReason.
 *
 * The table itself lives in the shared pipe (`finishReasonFor`): one table for
 * every provider is the whole point, so this is a delegation plus the
 * `recognized` flag this provider's callers (and tests) report.
 *
 * Measured values: `stop`, `tool_calls`, `length`. Two closures this delegation
 * brings, both intended (spec §5.2, D4):
 *   - `content_filter` is now `{kind:'error'}`, code `CONTENT_FILTERED`, instead
 *     of a clean `stop` the host would commit as a complete answer;
 *   - an unrecognised value is now `{kind:'error'}`, code
 *     `UNKNOWN_FINISH_REASON`, instead of being flattened to `stop`.
 *
 * @param reason - provider `finish_reason`.
 * @returns `{ reason, recognized }`.
 */
export function finishReason(reason) {
  const mapped = finishReasonFor(reason)
  // "Recognised" means the shared table had a rule for it: only the catch-all
  // UNKNOWN_FINISH_REASON branch counts as unrecognised.
  return {
    reason: mapped,
    recognized: !(mapped.kind === 'error' && mapped.failure?.code === 'UNKNOWN_FINISH_REASON'),
  }
}

/**
 * True when an event is the harness-visible end of the model's output.
 * @param event - one decoded SSE payload.
 * @returns whether `choices[0].finish_reason` is set on it.
 */
export function isFinishEvent(event) {
  return typeof event?.choices?.[0]?.finish_reason === 'string' && event.choices[0].finish_reason.length > 0
}
