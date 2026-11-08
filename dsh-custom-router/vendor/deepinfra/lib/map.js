/**
 * Upstream mapping: one DeepInfra chat delta -> typed stream parts.
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

export const PART_TEXT = 'text'
export const PART_REASONING = 'reasoning'
export const PART_TOOL_CALL = 'tool-call'
export const PART_USAGE = 'usage'
export const PART_FINISH = 'finish'

/** Wire fields that carry reasoning text, in priority order. */
export const REASONING_FIELDS = ['reasoning_content', 'reasoning', 'reasoning_text']

/**
 * Translate one streamed choice delta into typed parts.
 *
 * @param delta - `choices[0].delta` from one SSE event, or null.
 * @param context - `{ completed }`: the tool-call indexes already announced.
 * @returns ordered typed parts; empty when the delta carries nothing new.
 */
export function mapDelta(delta, context) {
  if (delta == null || typeof delta !== 'object') return []
  const parts = []
  // Order matters per block, not across blocks: emitting reasoning before text
  // for the same delta matches the wire order the harness assembles against.
  const reasoning = reasoningText(delta)
  if (reasoning.length > 0) parts.push({ kind: PART_REASONING, text: reasoning })
  const text = typeof delta.content === 'string' ? delta.content : ''
  if (text.length > 0) parts.push({ kind: PART_TEXT, text })
  for (const call of toolCallFragments(delta.tool_calls)) {
    parts.push({ kind: PART_TOOL_CALL, ...call })
  }
  return parts
}

/**
 * Read the reasoning text from whichever field the route used.
 * @param delta - one streamed delta.
 * @returns the reasoning text, or '' when the delta carries none.
 */
export function reasoningText(delta) {
  for (const field of REASONING_FIELDS) {
    const value = delta[field]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}

/**
 * Normalize the tool-call array of one delta.
 *
 * @param value - `delta.tool_calls`, when present.
 * @returns one entry per fragment, with a usable integer `index` and raw
 *   `arguments` string. A fragment with no arguments contributes an empty
 *   delta rather than a bogus one.
 */
export function toolCallFragments(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const entry of value) {
    if (entry == null || typeof entry !== 'object') continue
    const index = Number.isInteger(entry.index) && entry.index >= 0 ? entry.index : 0
    const fn = entry.function ?? {}
    const id = typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : undefined
    const name = typeof fn.name === 'string' && fn.name.length > 0 ? fn.name : undefined
    // Arguments stay a RAW STRING end-to-end (the harness contract). A provider
    // that hands back a parsed object is re-stringified exactly once, here.
    const args = typeof fn.arguments === 'string' ? fn.arguments : fn.arguments == null ? '' : JSON.stringify(fn.arguments)
    out.push({ index, id, name, argumentsDelta: args })
  }
  return out
}

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
