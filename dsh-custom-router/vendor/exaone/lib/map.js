/**
 * Compatibility shim: the EXAONE delta mapper is the shared OpenAI core's.
 *
 * This file used to hold a 130-line copy of `vendor/deepinfra/lib/map.js` (a
 * measured zero-comment-diff duplicate) plus two exports with no consumer
 * anywhere in the repository:
 *
 *   - `finishReason` (`:113-121`) — every caller uses the shared
 *     `finishReasonFor` table directly (`stream-contract.js` → core hook);
 *   - `isFinishEvent` (`:128-130`) — the pipe reads `finish` from the hook
 *     record, never from a predicate over the raw event.
 *
 * `PART_USAGE` / `PART_FINISH` went with them: the core emits neither kind.
 *
 * What remains is an import surface, not an implementation: the delta mapping
 * (`mapDelta`, `reasoningText`, `toolCallFragments`) and the part kinds are the
 * core's own. The file survives only because this package's `check` script
 * names it, and that script lives in a `package.json` this change is not
 * allowed to touch — delete this module together with that script entry.
 *
 * @module @nolit/dsh-exaone/map
 */

export {
  PART_REASONING,
  PART_TEXT,
  PART_TOOL_CALL,
  REASONING_FIELDS,
  mapDelta,
  reasoningText,
  toolCallFragments,
} from '../../../lib/stream/openai.js'
