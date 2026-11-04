/**
 * The DeepInfra `LlmAdapter`.
 *
 * Obligations this file satisfies, from docs/subsystems/llm-streaming.md:
 *   1. `stream(options)` is an AsyncIterable<StreamChunk>.
 *   2. Emit `usage` BEFORE `finish`; emit NOTHING after `finish`. DeepInfra sends
 *      its usage chunk AFTER the finish_reason event (measured: ... FINISH:tool_calls
 *      -> USAGE -> [DONE]), and sometimes sends finish and usage on the same event,
 *      which is exactly the case the buffer-then-flush rule exists for.
 *   3. Tool-call arguments are raw JSON strings end-to-end; indexes are allocated
 *      in first-seen order and reused per block.
 *   4. Two error paths: throw LlmError (transport/protocol) or finish{kind:'error'}.
 *   5. Honor options.signal.
 *   6. An unhonorable option throws UNSUPPORTED_OPTION, never dropped silently.
 *   7. Every request carries attributionHeaders().
 *   8. An empty completion is EMPTY_RESPONSE, not a silent success.
 */
import {
  LlmAdapter,
  LlmError,
  ReasoningEffortId,
  ToolCallId,
  attributionHeaders,
  isContextWindowExceededError,
} from '@deepseek-ai/dsh-llm'

import { COMPLETIONS_PATH, DEFAULT_BASE_URL, requestBody } from './wire.js'
import { readEvents } from './sse.js'
import {
  PART_REASONING,
  PART_TEXT,
  PART_TOOL_CALL,
  finishReason,
  isFinishEvent,
  mapDelta,
} from './map.js'
import { tokenUsage } from './usage.js'
import { parseCost } from './cost.js'

/**
 * DeepInfra provider adapter.
 */
export class DeepInfraAdapter extends LlmAdapter {
  /**
   * @param dependencies - `{ settings, catalog, fetchImpl, log }`.
   */
  constructor(dependencies) {
    super()
    this.dependencies = dependencies
  }

  /**
   * Describe the registered route.
   * @param provider - the route passed to registerAdapter().
   * @returns display metadata whose id equals the provider.
   */
  providerInfo(provider) {
    return { id: provider, name: 'DeepInfra' }
  }

  /**
   * Advertise the chat catalog. Read from the cached catalog, never a request.
   * @param provider - registered route.
   * @returns advisory model metadata.
   */
  async listModels(provider) {
    const catalog = await this.dependencies.catalog()
    return catalog.list(provider)
  }

  /**
   * Resolve exact-route metadata (context, reservation, reasoning efforts).
   * @param provider - registered route.
   * @param model - exact model id.
   * @param signal - cancellation for the catalog lookup.
   * @returns host model metadata.
   */
  async resolveModel(provider, model, signal) {
    const catalog = await this.dependencies.catalog(signal)
    return catalog.resolve(provider, model)
  }

  /**
   * Stream one completion.
   * @param options - the fully assembled harness request.
   * @returns raw harness stream chunks.
   */
  stream(options) {
    return this.generate(options)
  }

  /**
   * Drive one request from HTTP to terminal chunk.
   * @param options - harness request.
   */
  async * generate(options) {
    const settings = this.dependencies.settings()
    const baseURL = settings.baseURL ?? DEFAULT_BASE_URL
    let body
    try {
      body = requestBody(options, {
        maxTokens: options.maxTokens,
        reasoningEffort: options.reasoningEffort,
        temperature: options.temperature,
      })
    } catch (error) {
      // A request the provider cannot honor throws before I/O (contract rule 5).
      throw new LlmError(error?.message ?? 'DeepInfra request rejected', error?.code ?? 'UNSUPPORTED_OPTION', { cause: error })
    }

    const headers = {
      ...attributionHeaders(),
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
    }

    // The catalog entry is needed at record time to price the same tokens at LIST
    // price; the wire only reports what was BILLED (discount already applied).
    let catalogEntry = null
    try {
      catalogEntry = await this.dependencies.catalogEntry?.(options.model)
    } catch {
      catalogEntry = null
    }

    let response
    try {
      response = await this.dependencies.fetchImpl(`${baseURL}${COMPLETIONS_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    } catch (error) {
      if (options.signal?.aborted) throw new LlmError('DeepInfra request aborted', 'ABORTED', { cause: error })
      throw new LlmError('DeepInfra transport failed', 'TRANSPORT', { cause: error })
    }

    if (!response.ok) throw await this.httpFailure(response, options)

    // `x-request-id` is the id DeepInfra's own billing surface keys on. It is
    // recorded with the request so an authoritative figure can be attached later;
    // /v1/request-costs is documented but answers 404 for this credential
    // (measured 2026-11-05), so the wire's estimated_cost remains the fallback.
    const requestId = typeof response.headers?.get === 'function' ? response.headers.get('x-request-id') : null

    yield* this.translate(response.body, options, catalogEntry?.metadata?.pricing, requestId)
  }

  /**
   * Turn a non-2xx response into the one structured failure the host routes on.
   * @param response - failed HTTP response.
   * @param options - the originating request.
   */
  async httpFailure(response, options) {
    let detail = ''
    let code = ''
    let type = ''
    try {
      const text = await response.text()
      try {
        const parsed = JSON.parse(text)
        detail = String(parsed?.error?.message ?? parsed?.message ?? text)
        code = String(parsed?.error?.code ?? parsed?.code ?? '')
        type = String(parsed?.error?.type ?? '')
      } catch {
        detail = text
      }
    } catch {
      // A body we cannot read leaves only the status.
    }
    const joined = [code, type, detail].filter((part) => part.length > 0).join(' ')

    let failureCode
    if (response.status === 401 || response.status === 403) failureCode = 'INVALID_CREDENTIAL'
    else if (response.status === 429) failureCode = joined.includes('engine_overloaded') ? 'RATE_LIMIT' : 'RATE_LIMIT'
    else if (isContextWindowExceededError(joined)) failureCode = 'CONTEXT_WINDOW_EXCEEDED'
    else if (response.status === 404 && code === 'model_not_found') failureCode = 'UNKNOWN_MODEL'
    else if (response.status === 422) failureCode = 'UNSUPPORTED_OPTION'
    else if (response.status >= 500) failureCode = 'SERVER'
    else failureCode = 'INVALID_REQUEST'

    const retryAfter = retryAfterMs(response.headers)
    return new LlmError(
      `DeepInfra ${options.model} returned HTTP ${response.status}${detail.length > 0 ? `: ${detail.slice(0, 400)}` : ''}`,
      failureCode,
      {
        status: response.status,
        ...(retryAfter === undefined ? {} : { providerRetryAfterMs: retryAfter }),
      },
    )
  }

  /**
   * Translate the SSE body into harness chunks.
   *
   * Blocks are allocated in first-seen order. Text and reasoning each occupy one
   * block index for the whole response; each tool call occupies its own index,
   * keyed by the provider's tool-call index.
   *
   * Usage and finish are buffered until the stream ends: DeepInfra emits its
   * usage event after the finish_reason event, so flushing eagerly would break
   * the "usage before finish, nothing after" order.
   *
   * @param body - response body stream.
   * @param options - the originating request.
   */
  async * translate(body, options, pricing, requestId) {
    let nextIndex = 0
    let textIndex = -1
    let reasoningIndex = -1
    /** @type {Map<number, number>} provider tool-call index -> block index */
    const callBlocks = new Map()
    /** @type {Map<number, { id: string, name: string, args: string }>} */
    const calls = new Map()
    let usage
    let lastUsage
    let finish
    let emittedBlocks = 0
    let sawFinish = false
    let textBuffer = ''
    let reasoningBuffer = ''

    try {
      for await (const event of readEvents(body, options.signal)) {
        if (event?.__unparsed !== undefined) {
          throw new LlmError('DeepInfra stream carried an undecodable event', 'PROTOCOL')
        }
        // Usage may arrive on any event, including the finish event itself.
        const eventUsage = tokenUsage(event?.usage)
        if (eventUsage !== undefined) {
          usage = eventUsage
          // Keep the RAW object too: the cost figure comes from
          // `estimated_cost`, which the host's TokenUsage has no slot for.
          lastUsage = event.usage
        }
        if (!sawFinish && isFinishEvent(event)) {
          sawFinish = true
          finish = finishReason(event.choices[0].finish_reason)
        }
        const delta = event?.choices?.[0]?.delta
        if (delta == null) continue

        for (const part of mapDelta(delta)) {
          if (part.kind === PART_REASONING) {
            if (reasoningIndex < 0) {
              reasoningIndex = nextIndex++
              yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' }
            }
            reasoningBuffer += part.text
            yield { type: 'reasoning-delta', index: reasoningIndex, text: part.text }
            continue
          }
          if (part.kind === PART_TEXT) {
            if (textIndex < 0) {
              textIndex = nextIndex++
              yield { type: 'block-start', index: textIndex, blockType: 'text' }
            }
            textBuffer += part.text
            yield { type: 'text-delta', index: textIndex, text: part.text }
            continue
          }
          if (part.kind === PART_TOOL_CALL) {
            let blockIndex = callBlocks.get(part.index)
            if (blockIndex === undefined) {
              blockIndex = nextIndex++
              callBlocks.set(part.index, blockIndex)
              calls.set(part.index, { id: part.id ?? `deepinfra-${part.index}`, name: part.name ?? '', args: '' })
              yield { type: 'block-start', index: blockIndex, blockType: 'tool-call' }
            }
            const call = calls.get(part.index)
            // A later fragment carries id:null and name:null; the identity from
            // the first fragment stands (measured fragmentation shape).
            if (part.id !== undefined && call.id.startsWith('deepinfra-')) call.id = part.id
            if (part.name !== undefined && call.name.length === 0) call.name = part.name
            if (part.argumentsDelta.length > 0) {
              call.args += part.argumentsDelta
              yield {
                type: 'tool-call-delta',
                index: blockIndex,
                id: ToolCallId(call.id),
                ...(call.name.length > 0 ? { name: call.name } : {}),
                argumentsDelta: part.argumentsDelta,
              }
            }
          }
        }
      }
    } catch (error) {
      if (options.signal?.aborted) throw new LlmError('DeepInfra stream aborted', 'ABORTED', { cause: error })
      if (error instanceof LlmError) throw error
      throw new LlmError('DeepInfra stream failed', 'TRANSPORT', { cause: error })
    }

    // Close every block that opened, in index order, before the terminal chunks.
    for (const [providerIndex, blockIndex] of [...callBlocks.entries()].sort((a, b) => a[1] - b[1])) {
      const call = calls.get(providerIndex)
      emittedBlocks += 1
      yield {
        type: 'block-end',
        index: blockIndex,
        block: { type: 'tool-call', id: ToolCallId(call.id), name: call.name, arguments: call.args },
      }
    }
    // block-end carries the FULLY ASSEMBLED block, not a placeholder: consumers
    // are documented as not having to re-assemble deltas, and the assembler
    // stores this block as the message content. Emitting an empty string here
    // produced a completed turn whose text was '' (measured on the isolated
    // headless boot, 2026-11-04, before this fix).
    if (textIndex >= 0) {
      emittedBlocks += 1
      yield { type: 'block-end', index: textIndex, block: { type: 'text', text: textBuffer } }
    }
    if (reasoningIndex >= 0) {
      emittedBlocks += 1
      yield { type: 'block-end', index: reasoningIndex, block: { type: 'reasoning', text: reasoningBuffer } }
    }

    const reason = finish?.reason ?? { kind: 'stop' }

    // An empty completion is a retryable error, not a silent success.
    if (emittedBlocks === 0 && reason.kind === 'stop') {
      if (usage !== undefined) yield { type: 'usage', usage }
      yield {
        type: 'finish',
        reason: {
          kind: 'error',
          failure: { message: 'DeepInfra returned no content blocks', code: 'EMPTY_RESPONSE' },
        },
      }
      return
    }

    // Contract order: usage strictly before finish, nothing after.
    if (usage !== undefined) yield { type: 'usage', usage }
    // Cost bookkeeping happens on the way out, after the wire's own usage object
    // has been read and before the terminal chunk. It never throws into the
    // stream: a ledger failure must not fail a generation.
    this.dependencies.recordCost?.(options, lastUsage, pricing, requestId)
    yield { type: 'finish', reason }
  }
}

/**
 * Read a provider-requested retry delay.
 * @param headers - response headers.
 * @returns a positive millisecond delay, or undefined.
 */
function retryAfterMs(headers) {
  if (headers == null || typeof headers.get !== 'function') return undefined
  const value = headers.get('retry-after')
  if (value == null) return undefined
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  return Math.trunc(seconds * 1000)
}
