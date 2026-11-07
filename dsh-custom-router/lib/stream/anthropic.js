/**
 * Anthropic Messages provider hooks for the shared downstream stream pipe.
 *
 * Anthropic is not an OpenAI-shaped SSE stream, and the differences are the
 * whole reason this module exists:
 *   - an event carries its name in `event:` *and* in `data.type`; the pipe only
 *     sees decoded payloads, so `type` is the discriminator;
 *   - there is no `[DONE]` sentinel — the server closes the connection after
 *     `message_stop`, so end-of-stream is normal termination;
 *   - usage arrives in two pieces: input/cache on `message_start`, output on
 *     `message_delta`, and `input_tokens` EXCLUDES cache by design;
 *   - a tool call is announced on `content_block_start` (id + name) and its JSON
 *     arrives in `input_json_delta.partial_json` fragments, so the block index
 *     must be carried, never inferred from ordinal;
 *   - thinking blocks carry an opaque `signature` (or `data` for a redacted
 *     block) that no host chunk field can hold — and a turn can contain more
 *     than one such block, so signatures are kept per block index;
 *   - an in-stream `error` event is a terminal provider failure, not a no-op: it
 *     must never leave the turn looking like a clean `stop`.
 *
 * @module @nolit/dsh-custom-router/stream/anthropic
 */

import { CODES } from './failure.js'
import { count, finishReasonFor } from './wire.js'

/**
 * The pipeline descriptor for Anthropic's wire.
 *
 * Measured facts behind the fields: tool calls are fragmented (`partial_json`),
 * a usage total can only be rebuilt as `input+output+cache` because cache tokens
 * are reported separately and are not inside `input_tokens`, and a decoded
 * payload that cannot be read is a defect rather than a skippable frame — a
 * skipped `content_block_delta` silently truncates the turn.
 */
export const ANTHROPIC_DESCRIPTOR = Object.freeze({
  protocol: 'anthropic-messages',
  toolCallShape: 'fragmented',
  usage: { totalFormula: 'input+output+cache' },
  malformedRecord: 'fail',
})

/** A blank line ends a record; `\r?` covers CRLF, LF and the mixed `\n\r\n`. */
const BOUNDARY = /\r?\n\r?\n/

/**
 * Read an Anthropic SSE response as decoded event payloads, in wire order.
 *
 * Framing rules guaranteed here, matching the provider's own output:
 *   - a record ends at a blank line under CRLF or LF;
 *   - multi-line `data:` fields join with `'\n'`, as the SSE spec requires;
 *   - `: comment` / keep-alive lines are ignored;
 *   - a trailing record with no closing blank line is still decoded, because the
 *     socket closes right after `message_stop`;
 *   - end of stream is clean termination: there is no `[DONE]` sentinel to wait
 *     for and none is yielded.
 *
 * @param response - a `Response` (its `.body` is read), a web `ReadableStream`,
 *   an async iterable of byte/string chunks, or a string body.
 * @param options - `{ signal }`; `signal` aborts iteration mid-stream.
 * @returns async generator of decoded payload objects; the `event:` name is
 *   folded into `type` only when the payload does not carry its own.
 * @throws an `Error` with `code: 'PROTOCOL_DEFECT'` when a `data:` field is not
 *   valid JSON. Silently skipping it would drop a delta from the turn.
 */
export async function* readAnthropicSse(response, options = {}) {
  if (response === null || response === undefined) return
  const { signal } = options

  const decoder = new TextDecoder()
  let buffer = ''

  for await (const chunk of chunksOf(response)) {
    if (signal?.aborted) throw abortError()
    buffer += typeof chunk === 'string' ? chunk : decoder.decode(chunk, { stream: true })
    let boundary
    while ((boundary = BOUNDARY.exec(buffer)) !== null) {
      const record = buffer.slice(0, boundary.index)
      buffer = buffer.slice(boundary.index + boundary[0].length).replace(/^(?:\r?\n)+/, '')
      const payload = decodeRecord(record)
      if (payload !== undefined) yield payload
    }
  }

  buffer += decoder.decode()
  // A closed connection leaves the last record unterminated; dropping it would
  // lose the final `message_stop`.
  for (const record of buffer.split(BOUNDARY)) {
    const payload = decodeRecord(record)
    if (payload !== undefined) yield payload
  }
}

/**
 * Map one Anthropic event payload onto the pipe record.
 *
 * A `signature_delta` is deliberately not surfaced: the host's chunk shape has
 * no signature field, and inventing one would fork the pipe. The signature is
 * still accumulated on the state so a caller that must replay thinking blocks
 * on the next request can read it. A turn may contain several thinking blocks,
 * so signatures live in `state.signatures` keyed by `payload.index`; a second
 * block starting must not wipe the first block's signature.
 *
 * @param payload - one decoded event (`{ type, index?, content_block?, delta?, usage? }`).
 * @param state - accumulator shared across events; `signatures` (a Map keyed by
 *   block index) is populated, and `signature` mirrors the most recent block for
 *   backward compatibility. Note: the shared pipe passes a fresh object per
 *   event, so a caller that needs the signature across records must pass its own
 *   long-lived object (or use `createAnthropicHooks`).
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
          return {
            parts: [{
              kind: 'tool-call',
              index,
              id: block.id,
              name: block.name,
              argumentsDelta: '',
            }],
          }
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
          return {
            parts: [{
              kind: 'tool-call',
              index: payload.index ?? 0,
              argumentsDelta: delta.partial_json,
            }],
          }
        case 'signature_delta':
          // No host chunk field exists for a signature; accumulate only.
          appendSignature(state, payload.index ?? 0, delta.signature ?? '')
          return undefined
        default:
          return undefined
      }
    }

    case 'message_delta': {
      // Measured 2026-11-08 against DeepInfra's native Anthropic mount: the
      // request's INPUT counts are reported HERE, not on `message_start`
      // (`message_start.input_tokens` is 0 and `message_delta.input_tokens` is
      // the real 51). `input_tokens` already EXCLUDES cache, so all three input
      // buckets are read.
      //
      // Only a NON-ZERO count is claimed: `mergeCounts` treats any finite number
      // as a statement, so forwarding a 0 from this event would erase an input
      // count that `message_start` already established.
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
 * overloaded/`api_error` turn is a provider-capacity problem, and a rate limit
 * is a rate limit. Anything unrecognised stays a resource failure rather than
 * becoming a generic defect, since the turn cannot be completed either way.
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
      code = CODES.PROVIDER_RESOURCE
      break
    default:
      code = CODES.PROVIDER_RESOURCE
      break
  }
  return { code, message }
}

/**
 * Store a block's own start signature, replacing only that block's entry.
 *
 * A `content_block_start` states the block's signature outright, so it sets
 * rather than appends. An empty start signature never erases a real one that
 * already arrived for the same block (a replayed start must not lose it), and it
 * never touches another block's entry — the old single-field version wiped a
 * real signature when a later block started without one.
 *
 * `state.signature` mirrors the latest non-empty signature so a single-block
 * caller keeps working.
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
 * The state object is often created by a caller (or defaulted by the pipe), so
 * it cannot be assumed to be prepared by {@link createAnthropicHooks}.
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
 *
 * Backward compatibility only: the binding's accessor reads this field, and the
 * map is the source of truth.
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
 * @returns the signature string, or `''` when nothing has arrived.
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
 * Project accumulated Anthropic token counts onto the host usage shape.
 *
 * Anthropic's `input_tokens` already EXCLUDES cache, so nothing is subtracted
 * here; adding cache on top is the correction, not the double count. `total` is
 * reported only when the provider's own total agrees with `input+cache+output`,
 * so a mismatch is a visible omission rather than a silently wrong number.
 *
 * @param raw - `{ input, cacheRead, cacheWrite, output, total? }`; every field
 *   optional, values are validated as non-negative integers.
 * @param options - accepted for `hooks.usageFrom(raw, options)` symmetry; the
 *   Anthropic formula is fixed by the descriptor, so it is not consulted.
 * @returns `{ inputTokens, cacheReadTokens?, cacheWriteTokens?, outputTokens, totalTokens? }`,
 *   or `undefined` when no field carries a usable count.
 */
export function usageFromAnthropic(raw = {}, options) {
  if (raw === null || typeof raw !== 'object') return undefined

  const input = count(raw.input)
  const cacheRead = count(raw.cacheRead)
  const cacheWrite = count(raw.cacheWrite)
  const output = count(raw.output)
  if (input === undefined && cacheRead === undefined && cacheWrite === undefined && output === undefined) {
    return undefined
  }

  const usage = { inputTokens: input ?? 0 }
  // A cache count of zero is omitted: the host treats the field as "this turn
  // used the cache", not as a measurement of zero.
  if (cacheRead !== undefined && cacheRead > 0) usage.cacheReadTokens = cacheRead
  if (cacheWrite !== undefined && cacheWrite > 0) usage.cacheWriteTokens = cacheWrite
  usage.outputTokens = output ?? 0

  const total = (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0) + (output ?? 0)
  if (raw.total === total) usage.totalTokens = total
  return usage
}

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
 * mutating what they got cannot corrupt the stream's counters. `total` stays
 * `undefined` until the provider states one — the merge never invents a number.
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
 * turn), and `undefined`/`null` must not clobber a count that already arrived.
 * A real `0` is a statement and does overwrite.
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
 * Why a factory and not {@link ANTHROPIC_HOOKS}: two pieces of stream state have
 * no home in the pipe's record shape, and the pipe hands the hook a *fresh*
 * context object per event (`readEvent(payload, { descriptor, usageFormula })`),
 * so a hook that relied on that object would lose its contents between two
 * events of the same stream.
 *
 *   1. `usage` — it arrives in TWO pieces and the pipe REPLACES its usage on
 *      each record, not merges it:
 *        `message_start` -> { input, cacheRead, cacheWrite }
 *        `message_delta` -> { output } (and `stop_reason`)
 *      A record carrying only `{ output }` would therefore erase the input
 *      counts. This hook merges each piece and returns the cumulative object on
 *      every record that carried a usage piece, so the pipe's LAST such record
 *      is complete regardless of arrival order.
 *   2. `signature` — kept per block index in `state.signatures`, so a second
 *      thinking block cannot wipe the first one's signature.
 *
 * Measured Anthropic accounting this depends on: `usage.input_tokens` already
 * EXCLUDES cache reads and cache writes, so the three input-side buckets are
 * summed, not de-duplicated (see {@link usageFromAnthropic}).
 *
 * Every call owns a private state, which is the point: two concurrent streams
 * must not share a signature or a token count.
 *
 * @returns `{ descriptor, hooks, signature, usage }`, where `signature()` is the
 *   accumulated thinking signature (`''` until one arrives), `signature(index)`
 *   is one block's signature, and `usage()` is the accumulated usage snapshot.
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
   * into the stream's counters and hand back the cumulative object.
   *
   * The shared reader accumulates signatures into `state` itself, so this hook
   * does not touch them.
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

/**
 * Decode one `event:`/`data:` record.
 *
 * @param record - the text between two blank lines.
 * @returns the decoded payload, or `undefined` for a comment/keep-alive record.
 * @throws an `Error` with `code: 'PROTOCOL_DEFECT'` on malformed JSON.
 */
function decodeRecord(record) {
  let event
  const dataLines = []
  for (const line of record.split(/\r?\n/)) {
    if (line.length === 0 || line.startsWith(':')) continue
    const colon = line.indexOf(':')
    const field = colon === -1 ? line : line.slice(0, colon)
    let value = colon === -1 ? '' : line.slice(colon + 1)
    if (value.startsWith(' ')) value = value.slice(1)
    if (field === 'data') dataLines.push(value)
    else if (field === 'event') event = value
  }
  if (dataLines.length === 0) return undefined

  const data = dataLines.join('\n')
  // A blank `data:` frame is a keep-alive some proxies inject. It carries no
  // payload, so it is ignored — JSON.parse('') would raise a PROTOCOL_DEFECT for
  // a frame that means "nothing happened".
  if (data.trim().length === 0) return undefined

  let payload
  try {
    payload = JSON.parse(data)
  } catch (cause) {
    throw Object.assign(
      new Error(`malformed Anthropic SSE data: ${data.slice(0, 120)}`),
      { code: 'PROTOCOL_DEFECT', cause },
    )
  }
  if (payload === null || typeof payload !== 'object') return payload
  // The event name is redundant with `data.type` on every measured event; it is
  // used only when the payload omits its own discriminator.
  if (payload.type === undefined && event !== undefined) return { ...payload, type: event }
  return payload
}

/**
 * Normalize a response-like source into an async iterable of chunks.
 *
 * @param source - a `Response`, `ReadableStream`, async iterable, or string.
 * @returns async generator of byte chunks, strings, or whatever the iterable yields.
 */
async function* chunksOf(source) {
  if (typeof source === 'string') {
    yield source
    return
  }
  const body = typeof source.getReader === 'function' ? source : source.body ?? source
  if (body === null || body === undefined) return
  if (typeof body.getReader === 'function') {
    const reader = body.getReader()
    try {
      for (;;) {
        const { done, value } = await reader.read()
        if (done) return
        if (value !== undefined) yield value
      }
    } finally {
      reader.releaseLock?.()
    }
  }
  if (typeof body[Symbol.asyncIterator] === 'function') {
    for await (const chunk of body) yield chunk
  }
}

/** An abort that the shared pipe recognises as a caller cancellation. */
function abortError() {
  return Object.assign(new Error('request cancelled by the caller'), { name: 'AbortError' })
}
