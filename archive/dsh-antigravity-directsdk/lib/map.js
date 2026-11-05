/**
 * Translate cloudcode-pa response parts into DSH stream events.
 *
 * Measured part shapes (2026-11-05):
 *   {"text": "..."}                     -> assistant text
 *   {"text": "...", "thought": true}    -> reasoning; requires
 *                                          thinkingConfig.includeThoughts
 *   {"functionCall": {"name", "args", "id"}}
 *                                       -> a complete tool call in one part
 *   {"thoughtSignature": "..."}         -> opaque, must be ignored
 *
 * Tool calls arrive COMPLETE (args already an object), not as streamed argument
 * fragments, so the adapter synthesises start/delta/end for one block.
 *
 * @module @nolit/dsh-antigravity-directsdk/map
 */

/** Map a Gemini finishReason string to a DSH finish reason. */
export function finishReasonFor(value) {
  switch (value) {
    case 'MAX_TOKENS':
      return { kind: 'max-tokens' }
    case 'SAFETY':
    case 'RECITATION':
    case 'BLOCKLIST':
    case 'PROHIBITED_CONTENT':
    case 'SPII':
    case 'OTHER':
      return { kind: 'error', failure: { kind: 'provider', message: `Generation stopped: ${value}` } }
    default:
      return { kind: 'stop' }
  }
}

/**
 * Extract the single candidate from a frame payload.
 * @param payload - parsed SSE frame.
 * @returns the candidate, or undefined.
 */
export function candidateOf(payload) {
  const response = payload?.response ?? payload
  const candidates = response?.candidates
  return Array.isArray(candidates) && candidates.length > 0 ? candidates[0] : undefined
}

/**
 * Extract parts from a candidate.
 * @param candidate - one candidate.
 * @returns the parts array, never undefined.
 */
export function partsOf(candidate) {
  const parts = candidate?.content?.parts
  return Array.isArray(parts) ? parts : []
}

/** Classify one part. */
export function classify(part) {
  if (part && typeof part.functionCall === 'object' && part.functionCall !== null) return 'tool-call'
  if (part && part.thought === true) return 'reasoning'
  if (part && typeof part.text === 'string') return 'text'
  return 'other'
}
