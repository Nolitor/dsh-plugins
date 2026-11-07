/**
 * The shared downstream stream pipe.
 *
 * One implementation of everything between a decoded provider payload and the
 * host's last `StreamChunk`. Providers differ through a descriptor and a hook
 * set; they never fork the pipeline.
 *
 * The pipe owns:
 *   - block lifecycle and first-seen index allocation;
 *   - `usage` strictly before `finish`, nothing after `finish`;
 *   - one finish table (plus a per-provider override hook);
 *   - one failure shape (`{ message, code }`);
 *   - empty / cut / abort terminal policy.
 *
 * The pipe does NOT own registration, dispatch, retry, credentials, catalog or
 * request construction. It holds no provider table and imports no host
 * registry, so the single-writer rule for `LlmRuntime` is untouched.
 *
 * @module @nolit/dsh-custom-router/stream
 */

import { abortedCompletion, CODES, cutCompletion, emptyCompletion, fail } from './failure.js'
import { readSseEvents } from './sse.js'
import { usageFrom as defaultUsageFrom } from './usage.js'
import { finishReasonFor } from './wire.js'

export { CODES, abortedCompletion, cutCompletion, emptyCompletion, fail } from './failure.js'
export { DONE, findRecordBoundary, readSseEvents } from './sse.js'
export { TOTAL_FORMULAS, usageFrom, usageFromProjection } from './usage.js'
export { count, finishReasonFor } from './wire.js'

/**
 * Run one provider event stream through the shared pipeline.
 *
 * @param options - `{ events, descriptor, hooks, signal, onUsage }`.
 * @param options.events - async iterable of decoded provider payloads.
 * @param options.descriptor - `{ toolCallShape, usage, malformedRecord }`.
 * @param options.hooks - `{ readEvent }` plus optional overrides.
 * @param options.signal - caller cancellation.
 * @param options.onUsage - optional sink invoked when a usage chunk is produced.
 * @returns async generator of `StreamChunk`s.
 */
export async function* normalizeStream(options = {}) {
  const { events, descriptor = {}, hooks = {}, signal, onUsage } = options
  if (events === null || events === undefined) throw new TypeError('normalizeStream requires an events iterable')
  if (typeof hooks.readEvent !== 'function') throw new TypeError('normalizeStream requires a hooks.readEvent function')

  const shape = descriptor.toolCallShape ?? 'fragmented'
  if (shape !== 'fragmented' && shape !== 'complete') throw new TypeError(`unknown toolCallShape: ${String(shape)}`)
  const usageFormula = descriptor.usage?.totalFormula ?? 'prompt+output'
  const usageFrom = hooks.usageFrom ?? defaultUsageFrom
  const mapFinish = hooks.mapFinish ?? finishReasonFor

  /** index -> accumulated block, in allocation order */
  const blocks = new Map()
  /** ordinal -> block index, for fragmented tool calls */
  const callBlocks = new Map()
  /** indexes whose block-start has been emitted (an allocated-but-silent call is not visible) */
  const started = new Set()
  let textBlock
  let reasoningBlock
  let nextIndex = 0
  let usage
  let rawFinish
  let sawTool = false
  let failure

  const allocate = () => nextIndex++

  try {
    for await (const payload of events) {
      if (signal?.aborted) throw abortError()
      const record = hooks.readEvent(payload, { descriptor, usageFormula })
      if (record === null || record === undefined) continue
      if (record.done === true) break
      if (record.defect) {
        if (hooks.onMalformed !== undefined) {
          const decision = hooks.onMalformed(record.defect, { descriptor })
          if (decision === 'skip') continue
        }
        throw Object.assign(new Error(record.defect.message ?? 'provider payload defect'), {
          code: record.defect.code ?? CODES.PROTOCOL_DEFECT,
        })
      }

      if (record.usage !== undefined) {
        const normalized = usageFrom(record.usage, { formula: usageFormula })
        if (normalized !== undefined) {
          usage = normalized
          // A consumer that must persist usage (a ledger) records it on arrival:
          // the host can stop iterating as soon as the terminal `finish` lands.
          onUsage?.(normalized, { descriptor, hooks })
        }
      }
      if (record.finish !== undefined) rawFinish = record.finish

      for (const part of record.parts ?? []) {
        if (signal?.aborted) throw abortError()
        if (part?.kind === 'tool-call') {
          sawTool = true
          yield* emitToolCall(part)
          continue
        }
        const text = typeof part?.text === 'string' ? part.text : ''
        if (text.length === 0) continue
        if (part.kind === 'reasoning') {
          yield* emitText('reasoning', text)
          continue
        }
        if (part.kind !== 'text') continue
        // The optional provider hook: notation the wire left inside a text
        // payload. Returning parts replaces the text part; returning undefined
        // keeps the default pass-through.
        const classified = hooks.classifyText?.(text, { descriptor })
        if (Array.isArray(classified)) {
          for (const inner of classified) {
            if (inner?.kind === 'tool-call') { sawTool = true; yield* emitToolCall(inner); continue }
            const innerText = typeof inner?.text === 'string' ? inner.text : ''
            if (innerText.length === 0) continue
            yield* emitText(inner.kind === 'reasoning' ? 'reasoning' : 'text', innerText)
          }
          continue
        }
        yield* emitText('text', text)
      }
    }
  } catch (error) {
    if (signal?.aborted || error?.name === 'AbortError') {
      for (const chunk of closeAll()) yield chunk
      if (usage !== undefined) yield { type: 'usage', usage }
      yield abortedCompletion('request cancelled by the caller')
      return
    }
    // Contract rule N5: a protocol defect is a thrown failure, not an in-band
    // clean finish. A transport cut after partial output is the in-band case.
    if (error?.code === CODES.PROTOCOL_DEFECT) throw error
    failure = {
      code: error?.code ?? CODES.STREAM_CUT,
      message: error instanceof Error ? error.message : String(error),
      ...(error?.status === undefined ? {} : { status: error.status }),
      ...(error?.providerRetryAfterMs === undefined ? {} : { providerRetryAfterMs: error.providerRetryAfterMs }),
    }
  }

  for (const chunk of closeAll()) yield chunk

  const finish = promote(mapFinish(rawFinish, { descriptor }))
  if (usage !== undefined) yield { type: 'usage', usage }

  if (failure !== undefined) {
    const result = hooks.onCut?.(failure, { blocks: started.size, sawTool }) ?? cutCompletion(failure)
    yield result
    return
  }
  if (started.size === 0) {
    const result = hooks.onEmpty?.({ usage, finish }) ?? emptyCompletion()
    yield result
    return
  }
  yield { type: 'finish', reason: finish }

  /** A mapped `stop` becomes `tool-calls` when any tool block closed. */
  function promote(reason) {
    if (sawTool && reason?.kind === 'stop') return { kind: 'tool-calls' }
    return reason
  }

  /**
   * Close every visible open block, in allocation order, before `usage`.
   *
   * An allocated tool-call block whose identity never arrived is not visible:
   * emitting `block-end` for it would produce a block the host never saw start,
   * and a nameless call cannot be dispatched anyway.
   */
  function* closeAll() {
    for (const [index, block] of [...blocks.entries()].sort((left, right) => left[0] - right[0])) {
      if (block.closed || !started.has(index)) continue
      block.closed = true
      yield { type: 'block-end', index, block: finalBlock(block) }
    }
  }

  /** The fully accumulated block, never a placeholder. */
  function finalBlock(block) {
    if (block.kind === 'tool-call') {
      return { type: 'tool-call', id: block.id || `call_${block.index}`, name: block.name, arguments: block.arguments }
    }
    return { type: block.kind, text: block.text }
  }

  /** Emit one text/reasoning delta, opening its block on first use. */
  function* emitText(kind, text) {
    let block = kind === 'reasoning' ? reasoningBlock : textBlock
    if (block === undefined) {
      block = { kind, index: allocate(), text: '', closed: false }
      blocks.set(block.index, block)
      started.add(block.index)
      if (kind === 'reasoning') reasoningBlock = block
      else textBlock = block
      yield { type: 'block-start', index: block.index, blockType: kind }
    }
    if (block.closed) return
    block.text += text
    yield kind === 'reasoning'
      ? { type: 'reasoning-delta', index: block.index, text }
      : { type: 'text-delta', index: block.index, text }
  }

  /**
   * Emit one tool-call fragment.
   *
   * `fragmented` providers send an identity fragment and later argument-only
   * fragments; `complete` providers send the whole call once. Both land in the
   * same block lifecycle, so the host cannot tell which wire it came from.
   */
  function* emitToolCall(part) {
    if (shape === 'complete' && part.index === undefined) {
      // The hook already decided this call is whole; arguments are still a raw
      // JSON string end-to-end, so an object is stringified exactly once here.
      const args = typeof part.arguments === 'string'
        ? part.arguments
        : part.arguments === undefined || part.arguments === null ? '' : JSON.stringify(part.arguments)
      const index = allocate()
      const id = part.id || `call_${index}`
      const block = { kind: 'tool-call', index, id, name: part.name ?? '', arguments: args, closed: false }
      blocks.set(index, block)
      started.add(index)
      yield { type: 'block-start', index, blockType: 'tool-call' }
      yield { type: 'tool-call-delta', index, id, ...(block.name ? { name: block.name } : {}), argumentsDelta: block.arguments }
      return
    }
    const ordinal = Number.isInteger(part.index) ? part.index : 0
    let index = callBlocks.get(ordinal)
    if (index === undefined) {
      index = allocate()
      callBlocks.set(ordinal, index)
      blocks.set(index, { kind: 'tool-call', index, id: '', name: '', arguments: '', closed: false })
    }
    const block = blocks.get(index)
    if (block.closed) return
    if (part.id) block.id = String(part.id)
    if (part.name) block.name = String(part.name)
    const delta = typeof part.argumentsDelta === 'string'
      ? part.argumentsDelta
      : typeof part.arguments === 'string' ? part.arguments : ''
    block.arguments += delta
    // Identity first: an argument-only fragment accumulates but stays silent
    // until the ordinal has an id or a name.
    if (!started.has(index)) {
      if (!block.id && !block.name) return
      started.add(index)
      yield { type: 'block-start', index, blockType: 'tool-call' }
      yield {
        type: 'tool-call-delta',
        index,
        id: block.id || `call_${index}`,
        ...(block.name ? { name: block.name } : {}),
        argumentsDelta: block.arguments,
      }
      return
    }
    if (delta.length === 0) return
    yield {
      type: 'tool-call-delta',
      index,
      id: block.id || `call_${index}`,
      argumentsDelta: delta,
    }
  }
}

/** @returns an `AbortError`-shaped error. */
function abortError() {
  const error = new Error('the stream was aborted')
  error.name = 'AbortError'
  return error
}
