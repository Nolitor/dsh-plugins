/**
 * This provider's binding to the shared downstream pipe.
 *
 * The pipe (`@nolit/dsh-custom-router/stream`) owns the block lifecycle, the
 * finish table, the usage writer, the failure shape and the terminal policy.
 * Everything provider-specific lives here as data plus pure hooks, so a vendor
 * quirk never requires editing the core.
 *
 * Measured Antigravity shapes (2026-11-05) this file encodes:
 *
 *   frame               { response: { candidates: [{ content: { parts }, finishReason }],
 *                                      usageMetadata } }
 *   text part           { text }
 *   reasoning part      { text, thought: true }   (needs thinkingConfig.includeThoughts)
 *   tool-call part      { functionCall: { name, args, id } }   ← COMPLETE, args is an object
 *   usageMetadata       promptTokenCount / candidatesTokenCount / thoughtsTokenCount /
 *                       cachedContentTokenCount / totalTokenCount, cumulative across frames
 *
 * Two measured consequences:
 *   1. tool calls arrive whole, so `toolCallShape` is `'complete'` (no fragment ordinals);
 *   2. `thoughtsTokenCount` is separate from `candidatesTokenCount`, so the provider
 *      total only reconciles under the `prompt+output+reasoning` formula.
 *
 * @module @nolit/dsh-antigravity/stream-contract
 */

import { finishReasonFor as sharedFinish } from '../../../lib/stream/index.js'
import { usageFromProjection } from '../../../lib/stream/index.js'

/** Field names this provider uses that the shared writer does not assume. */
export const STREAM_DESCRIPTOR = Object.freeze({
  toolCallShape: 'complete',
  usage: Object.freeze({ totalFormula: 'prompt+output+reasoning' }),
  malformedRecord: 'fail',
})

/**
 * Gemini spells the same semantic outcomes differently from OpenAI. The shared
 * table already covers both vocabularies, so this is a re-export with the
 * provider's intent documented rather than a second table.
 *
 * @param value - `candidate.finishReason`.
 * @returns the host `FinishReason`.
 */
export function mapFinish(value) {
  return sharedFinish(value)
}

/**
 * Project one cumulative `usageMetadata` object onto the canonical field names.
 *
 * Measured: `promptTokenCount` INCLUDES cache hits, and `thoughtsTokenCount` is
 * billed output that `candidatesTokenCount` excludes. The shared writer splits
 * the buckets and cross-checks the total, so the projection only renames.
 *
 * @param metadata - the latest frame's `usageMetadata` (never summed: it is cumulative).
 * @returns canonical usage fields, or undefined when the object carries no counts.
 */
export function usageFrom(metadata) {
  if (metadata === null || metadata === undefined || typeof metadata !== 'object') return undefined
  return usageFromProjection(
    metadata,
    (raw) => ({
      prompt: raw.promptTokenCount,
      completion: raw.candidatesTokenCount,
      reasoning: raw.thoughtsTokenCount,
      cached: raw.cachedContentTokenCount,
      total: raw.totalTokenCount,
    }),
    { formula: STREAM_DESCRIPTOR.usage.totalFormula },
  )
}

/**
 * Extract the single candidate from one decoded frame.
 *
 * @param payload - parsed SSE frame, optionally wrapped in `{ response }`.
 * @returns the candidate, or undefined.
 */
export function candidateOf(payload) {
  const response = payload?.response ?? payload
  const candidates = response?.candidates
  return Array.isArray(candidates) && candidates.length > 0 ? candidates[0] : undefined
}

/**
 * The parts array of one candidate.
 *
 * @param candidate - one candidate.
 * @returns the parts array, never undefined.
 */
export function partsOf(candidate) {
  const parts = candidate?.content?.parts
  return Array.isArray(parts) ? parts : []
}

/**
 * Classify one provider part.
 *
 * @param part - one part from `candidate.content.parts`.
 * @returns `'tool-call' | 'reasoning' | 'text' | 'other'`.
 */
export function classify(part) {
  if (part && typeof part.functionCall === 'object' && part.functionCall !== null) return 'tool-call'
  if (part && part.thought === true) return 'reasoning'
  if (part && typeof part.text === 'string') return 'text'
  return 'other'
}

/** Tool-call ids the provider omitted are synthesised per process. */
let callCounter = 0

/**
 * The provider's `readEvent` hook: one decoded frame in, one normalized record out.
 *
 * The shared pipe never inspects provider JSON. This function is the whole
 * boundary: it decides what a frame means and hands over plain parts, raw usage
 * and the raw finish value.
 *
 * @param payload - one decoded SSE payload, or the `{ done: true }` sentinel.
 * @returns a normalized record; `undefined` when the frame carries no candidate.
 */
export function readEvent(payload) {
  if (payload?.done === true) return { done: true }
  const candidate = candidateOf(payload)
  if (candidate === undefined) return undefined

  const parts = []
  for (const part of partsOf(candidate)) {
    const kind = classify(part)
    if (kind === 'reasoning') {
      if (typeof part.text === 'string' && part.text.length > 0) parts.push({ kind: 'reasoning', text: part.text })
      continue
    }
    if (kind === 'text') {
      if (typeof part.text === 'string' && part.text.length > 0) parts.push({ kind: 'text', text: part.text })
      continue
    }
    if (kind === 'tool-call') {
      const call = part.functionCall
      // Gemini 3/4 require the opaque thoughtSignature to be replayed with the
      // functionCall; without it the NEXT request is HTTP 400 ("Function call is
      // missing a thought_signature..."). It rides on the part (or, defensively,
      // on the call), and the shared pipe keeps it on the tool-call block.
      const signature = typeof part.thoughtSignature === 'string' && part.thoughtSignature !== ''
        ? part.thoughtSignature
        : typeof call.thoughtSignature === 'string' && call.thoughtSignature !== '' ? call.thoughtSignature : undefined
      parts.push({
        kind: 'tool-call',
        // The provider may omit an id; it is synthesized once, here, so the
        // shared pipe never has to know a vendor's fallback convention.
        id: typeof call.id === 'string' && call.id.length > 0 ? call.id : `antigravity-${Date.now()}-${callCounter++}`,
        name: typeof call.name === 'string' ? call.name : '',
        // Complete calls: arguments are already an object, and the pipe
        // stringifies them exactly once (the host contract is a raw JSON string).
        arguments: call.args ?? {},
        ...(signature === undefined ? {} : { thoughtSignature: signature }),
      })
      continue
    }
    // A free-standing `thoughtSignature` part is ignored; a signature attached
    // to a functionCall is preserved because the next request must replay it.
    // Any other future unknown part is ignored.
  }

  const metadata = (payload?.response ?? payload)?.usageMetadata
  return {
    ...(parts.length > 0 ? { parts } : {}),
    ...(metadata === undefined ? {} : { usage: metadata }),
    ...(candidate.finishReason === undefined ? {} : { finish: candidate.finishReason }),
  }
}

/** The hook set handed to `normalizeStream`. Pure: no I/O, no context. */
export const STREAM_HOOKS = Object.freeze({ readEvent, mapFinish, usageFrom })
