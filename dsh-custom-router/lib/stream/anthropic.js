/**
 * Anthropic Messages provider hooks for the shared downstream stream pipe.
 *
 * Anthropic is not an OpenAI-shaped SSE stream, and the differences are the
 * whole reason this module exists. An event carries its name in `event:` *and*
 * in `data.type`, and the pipe only sees decoded payloads, so `type` is the
 * discriminator. There is no `[DONE]` sentinel: the server closes after
 * `message_stop`. Usage arrives in two pieces — input/cache on `message_start`,
 * output on `message_delta` — and `input_tokens` EXCLUDES cache by design. A
 * tool call is announced on `content_block_start` (id + name) with its JSON in
 * `input_json_delta.partial_json` fragments, so the block index is carried, never
 * inferred from ordinal. Thinking blocks carry an opaque `signature` (or `data`
 * when redacted) that no host chunk field can hold, and a turn can hold several,
 * so signatures are kept per block index. An in-stream `error` is a terminal
 * provider failure, never a clean `stop`.
 *
 * Framing is not implemented here: `readSseEvents` owns it for every wire.
 *
 * @module @nolit/dsh-custom-router/stream/anthropic
 */

import { CODES } from './failure.js'
import { readSseEvents } from './sse.js'
import { usageFromAnthropic } from './usage.js'
import { finishReasonFor } from './wire.js'

/**
 * The pipeline descriptor for Anthropic's wire.
 *
 * Measured: tool calls are fragmented (`partial_json`), a usage total rebuilds
 * only as `input+output+cache` because cache tokens are reported separately, and
 * an undecodable payload is a defect rather than a skippable frame — a skipped
 * `content_block_delta` silently truncates the turn.
 */
export const ANTHROPIC_DESCRIPTOR = Object.freeze({
  protocol: 'anthropic-messages',
  toolCallShape: 'fragmented',
  usage: { totalFormula: 'input+output+cache' },
  malformedRecord: 'fail',
})

/**
 * Read an Anthropic SSE response as decoded event payloads, in wire order.
 *
 * A thin adapter over the shared reader's named-event dialect: `event:` names
 * fold into `type` only when the payload omits its own, keep-alive lines and
 * blank `data:` frames are skipped, an unterminated trailing record is still
 * decoded (the socket closes right after `message_stop`), and there is no
 * `[DONE]` sentinel — end of stream is clean termination.
 *
 * @param response - a `Response` (its `.body` is read), a web `ReadableStream`,
 *   an async iterable of byte/string chunks, or a string body.
 * @param options - `{ signal }`; `signal` aborts iteration mid-stream.
 * @returns async generator of decoded payload objects.
 * @throws `Error` with `code: 'PROTOCOL_DEFECT'` on undecodable `data:` — a
 *   skipped frame would drop a delta from the turn.
 */
export async function* readAnthropicSse(response, options = {}) {
  // A plain string is not async-iterable, so it is wrapped before the reader sees it.
  const body = typeof response === 'string' ? (async function* () { yield response })() : response
  yield* readSseEvents(body, { ...options, eventNames: true })
}

/**
 * Map one Anthropic event payload onto the pipe record.
 *
 * A `signature_delta` is deliberately not surfaced: the host's chunk shape has
 * no signature field, and inventing one would fork the pipe. It is still
 * accumulated on the state so a caller replaying thinking blocks can read it,
 * keyed by block index in `state.signatures`.
 *
 * @param payload - one decoded event (`{ type, index?, content_block?, delta?, usage? }`).
 * @param state - accumulator shared across events; `signatures` (a Map keyed by
 *   block index) is populated, and `signature` mirrors the most recent block.
 *   The pipe passes a fresh object per event, so a caller needing the signature
 *   across records must pass its own long-lived object (or use the factory).
 * @returns a pipe record `{ parts?, usage?, finish?, defect?, done? }`, or
 *   `undefined` for an event with no downstream effect.
 */
export function readAnthropicEvent(payload, state = {}) {
  if (payload === null || typeof payload !== 'object') return undefined

  switch (payload.type) {
    case 'message_start': {
      const usage = payload.message?.usage ?? payload.usage ?? {}
      return {
        usage: {
          input: usage.input_tokens,
          cacheRead: usage.cache_read_input_tokens,
          cacheWrite: usage.cache_creation_input_tokens,
        },
      }
    }

    case 'content_block_start': {
      const block = payload.content_block ?? {}
      const index = payload.index ?? 0
      switch (block.type) {
        case 'text':
          // Text arrives as deltas only; there is nothing to open downstream.
          return undefined
        case 'tool_use':
          return { parts: [{ kind: 'tool-call', index, id: block.id, name: block.name, argumentsDelta: '' }] }
        case 'thinking':
          setSignature(state, index, block.signature ?? '')
          return { parts: [{ kind: 'reasoning', text: block.thinking ?? '' }] }
        case 'redacted_thinking':
          setSignature(state, index, block.data ?? '')
          return { parts: [{ kind: 'reasoning', text: '[Reasoning redacted]' }] }
        default:
          return undefined
      }
    }

    case 'content_block_delta': {
      const delta = payload.delta ?? {}
      switch (delta.type) {
        case 'text_delta':
          return { parts: [{ kind: 'text', text: delta.text }] }
        case 'thinking_delta':
          return { parts: [{ kind: 'reasoning', text: delta.thinking }] }
        case 'input_json_delta':
          return { parts: [{ kind: 'tool-call', index: payload.index ?? 0, argumentsDelta: delta.partial_json }] }
        case 'signature_delta':
          // No host chunk field exists for a signature; accumulate only.
          appendSignature(state, payload.index ?? 0, delta.signature ?? '')
          return undefined
        default:
          return undefined
      }
    }

    case 'message_delta': {
      // Measured 2026-11-08 on DeepInfra's native Anthropic mount: the request's
      // INPUT counts are reported HERE, not on `message_start` (0 there, the
      // real 51 here), and `input_tokens` already EXCLUDES cache. Only a
      // NON-ZERO count is claimed: a 0 forwarded from this event would erase an
      // input count `message_start` already established.
      const usage = payload.usage ?? {}
      const piece = { output: usage.output_tokens }
      const claim = (field, key) => {
        const value = usage[field]
        if (typeof value === 'number' && Number.isFinite(value) && value > 0) piece[key] = value
      }
      claim('input_tokens', 'input')
      claim('cache_read_input_tokens', 'cacheRead')
      claim('cache_creation_input_tokens', 'cacheWrite')
      return { finish: payload.delta?.stop_reason, usage: piece }
    }

    case 'message_stop':
      return { done: true }

    case 'error':
      // An in-stream error is terminal. The pipe turns a non-`PROTOCOL_DEFECT`
      // `defect` into `{ type: 'finish', reason: { kind: 'error', failure } }`
      // and stops, so this must be a defect: projecting it to nothing would let
      // the turn end as a clean `stop` (measured: it did).
      return { defect: anthropicErrorFailure(payload) }

    // `ping` and future events have no chunk-shaped projection here.
    default:
      return undefined
  }
}

/**
 * Project an Anthropic in-stream `error` event onto the pipe's failure shape.
 *
 * The wire's `error.type` decides the code, because the host routes on it: an
 * overloaded/`api_error` turn is a provider-capacity problem and a rate limit is
 * a rate limit. Anything unrecognised stays a resource failure rather than
 * becoming a generic defect — the turn cannot be completed either way.
 *
 * @param payload - the decoded `{ type: 'error', error: { type, message } }`.
 * @returns `{ code, message }` with a non-empty message, as the pipe requires.
 */
function anthropicErrorFailure(payload) {
  const error = payload.error ?? {}
  const type = typeof error.type === 'string' ? error.type : ''
  const message = typeof error.message === 'string' && error.message.length > 0
    ? error.message
    : `the provider reported an in-stream error: ${type || 'unknown'}`

  let code
  switch (type) {
    case 'rate_limit_error':
      // `RATE_LIMIT` is the host's retryable quota code (not in `CODES`, which
      // holds only this pipe's own codes, so it is spelled literally).
      code = 'RATE_LIMIT'
      break
    case 'overloaded_error':
    case 'api_error':
    default:
      code = CODES.PROVIDER_RESOURCE
  }
  return { code, message }
}

/**
 * Store a block's own start signature, replacing only that block's entry.
 *
 * A start states the signature outright, so it sets rather than appends; an
 * empty start never erases a real one that already arrived, and never touches
 * another block's entry. `state.signature` mirrors the latest non-empty one.
 *
 * @param state - the per-stream accumulator.
 * @param index - the block index the signature belongs to.
 * @param signature - the block's signature (`''` for a block that states none).
 */
function setSignature(state, index, signature) {
  const signatures = ensureSignatures(state)
  const key = index ?? 0
  if (signature.length === 0 && signatures.has(key)) return
  signatures.set(key, signature)
  mirrorSignature(state)
}

/**
 * Append a `signature_delta` fragment to its block's signature.
 *
 * @param state - the per-stream accumulator.
 * @param index - the block index the fragment belongs to.
 * @param fragment - the signature fragment; an empty fragment is a no-op.
 */
function appendSignature(state, index, fragment) {
  const signatures = ensureSignatures(state)
  if (fragment.length === 0) {
    if (!signatures.has(index)) signatures.set(index, '')
    mirrorSignature(state)
    return
  }
  signatures.set(index, `${signatures.get(index) ?? ''}${fragment}`)
  mirrorSignature(state)
}

/**
 * Lazily create the per-block signature map on a caller-supplied state.
 *
 * @param state - the per-stream accumulator.
 * @returns the signature map, created on first use.
 */
function ensureSignatures(state) {
  if (!(state.signatures instanceof Map)) state.signatures = new Map()
  return state.signatures
}

/**
 * Point `state.signature` at the most recent block that has a signature.
 * Backward compatibility only; the map is the source of truth.
 *
 * @param state - the per-stream accumulator.
 */
function mirrorSignature(state) {
  for (const signature of state.signatures.values()) {
    if (typeof signature === 'string' && signature.length > 0) state.signature = signature
  }
}

/**
 * Read the accumulated signature for one block, or the latest one.
 *
 * @param state - the per-stream accumulator.
 * @param index - a specific block index; omitted means the latest block.
 * @returns the signature string, or `''` before anything arrives.
 */
export function signatureFor(state = {}, index) {
  if (index !== undefined) return state.signatures?.get(index) ?? ''
  const signatures = state.signatures
  if (signatures instanceof Map) {
    let latest = ''
    for (const signature of signatures.values()) {
      if (typeof signature === 'string' && signature.length > 0) latest = signature
    }
    return latest
  }
  return state.signature ?? ''
}

/**
 * Normalize an Anthropic `stop_reason` onto the shared finish table.
 *
 * @param stopReason - the raw `message_delta.delta.stop_reason`.
 * @returns `{ kind, failure? }` in the host's `FinishReason` shape.
 */
export function mapAnthropicFinish(stopReason) {
  return finishReasonFor(stopReason)
}

/**
 * Project accumulated Anthropic token counts onto the host usage shape. A
 * re-export: the writer is shared, so this module keeps no accounting of its
 * own; the additive cache convention is declared by the descriptor's
 * `totalFormula: 'input+output+cache'`.
 */
export { usageFromAnthropic }

/** The hook set the shared pipe consumes for `protocol: 'anthropic-messages'`. */
export const ANTHROPIC_HOOKS = Object.freeze({
  readEvent: readAnthropicEvent,
  mapFinish: mapAnthropicFinish,
  usageFrom: usageFromAnthropic,
})

/**
 * The cumulative usage counters one stream can report.
 *
 * A literal list, not `Object.keys(state)`: the state also holds `signatures`
 * and `signature`, which must never be merged as if they were counts.
 */
const COUNT_KEYS = Object.freeze(['input', 'cacheRead', 'cacheWrite', 'output', 'total'])

/**
 * Copy the accumulated counters into a fresh usage object.
 *
 * A new object per call: the pipe and the caller both receive a snapshot, so
 * mutating one cannot corrupt the stream's counters. `total` stays `undefined`
 * until the provider states one — the merge never invents a number.
 *
 * @param state - the per-stream accumulator.
 * @returns `{ input, cacheRead, cacheWrite, output, total? }`.
 */
function usageSnapshot(state) {
  return {
    input: state.input,
    cacheRead: state.cacheRead,
    cacheWrite: state.cacheWrite,
    output: state.output,
    total: state.total,
  }
}

/**
 * Merge one usage piece into the accumulated counters.
 *
 * Only a finite number overwrites a counter: Anthropic omits fields it has
 * nothing to say about (`cache_read_input_tokens` is absent on an uncached
 * turn), and `undefined`/`null` must not clobber a count already arrived. A real
 * `0` is a statement and does overwrite.
 *
 * @param state - the per-stream accumulator.
 * @param raw - the `usage` object taken off one pipe record.
 * @returns `true` when at least one counter was written.
 */
function mergeCounts(state, raw) {
  let merged = false
  for (const key of COUNT_KEYS) {
    const value = raw[key]
    if (typeof value === 'number' && Number.isFinite(value)) {
      state[key] = value
      merged = true
    }
  }
  return merged
}

/**
 * Create one Anthropic hook set for one stream.
 *
 * Why a factory and not `ANTHROPIC_HOOKS`: two pieces of stream state have no
 * home in the pipe's record shape, and the pipe hands the hook a *fresh* context
 * object per event, so a hook relying on that object would lose its contents
 * between two events of the same stream.
 *
 *   1. `usage` — it arrives in TWO pieces and the pipe REPLACES its usage per
 *      record rather than merging it: `message_start` -> { input, cacheRead,
 *      cacheWrite }, `message_delta` -> { output }. A record carrying only
 *      `{ output }` would erase the input counts, so this hook merges each piece
 *      and returns the cumulative object on every usage-bearing record, leaving
 *      the pipe's LAST such record complete regardless of arrival order.
 *   2. `signature` — kept per block index in `state.signatures`.
 *
 * Measured: `usage.input_tokens` already EXCLUDES cache, so the three input-side
 * buckets are summed, not de-duplicated (see `usageFromAnthropic`). Every call
 * owns a private state: two concurrent streams must not share a token count.
 *
 * @returns `{ descriptor, hooks, signature, usage }`, where `signature()` is the
 *   accumulated thinking signature, `signature(index)` is one block's, and
 *   `usage()` is the accumulated usage snapshot.
 */
export function createAnthropicHooks() {
  /** The stream's own accumulator; never shared between two streams. */
  const state = {
    signatures: new Map(),
    signature: '',
    input: undefined,
    cacheRead: undefined,
    cacheWrite: undefined,
    output: undefined,
    total: undefined,
  }

  /**
   * `readEvent` hook: delegate to the shared reader, then fold any usage piece
   * into the stream's counters and hand back the cumulative object. The shared
   * reader accumulates signatures into `state` itself.
   *
   * @param payload - one decoded SSE payload.
   * @returns the reader's record with `usage` replaced by the accumulated
   *   snapshot (when any usage piece arrived), or the record unchanged, or
   *   `undefined` for an event with no downstream effect.
   */
  function readEvent(payload) {
    const record = readAnthropicEvent(payload, state)
    if (record === null || typeof record !== 'object') return record
    if (record.usage === null || typeof record.usage !== 'object') return record

    mergeCounts(state, record.usage)

    // Replaced even when this event only restated a field: the pipe overwrites
    // its usage per record, so every usage-bearing record must carry everything
    // known so far, or the last one would truncate the count.
    return { ...record, usage: usageSnapshot(state) }
  }

  const hooks = Object.freeze({
    readEvent,
    mapFinish: mapAnthropicFinish,
    usageFrom: usageFromAnthropic,
  })

  return Object.freeze({
    descriptor: ANTHROPIC_DESCRIPTOR,
    hooks,
    /**
     * @param index - a specific block index; omitted means the latest block.
     * @returns the accumulated signature (`''` until one arrives).
     */
    signature: (index) => signatureFor(state, index),
    /** @returns a fresh copy of the accumulated usage counters. */
    usage: () => usageSnapshot(state),
  })
}
