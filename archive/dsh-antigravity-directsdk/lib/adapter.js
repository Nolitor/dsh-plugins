/**
 * The Antigravity `LlmAdapter`.
 *
 * Contract obligations (docs/subsystems/llm-streaming.md):
 *   1. `stream(options)` is an AsyncIterable<StreamChunk>.
 *   2. Emit `usage` BEFORE `finish`; emit nothing after `finish`.
 *   3. Tool-call arguments are JSON strings end-to-end.
 *   4. Two error paths: throw LlmError, or finish{kind:'error'}.
 *   5. Honor `options.signal`.
 *   6. An unhonorable option throws, never gets dropped silently.
 *   7. Every request carries attributionHeaders().
 *   8. An empty completion is EMPTY_RESPONSE, not a silent success.
 *
 * The provider streams whole parts rather than deltas: a frame carries
 * `{"text": "..."}` or a complete `functionCall`. The adapter therefore owns
 * block indexing and emits start/delta/end around each part.
 *
 * @module @nolit/dsh-antigravity-directsdk/adapter
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'

import { GENERATION_PATH, requestBody } from './wire.js'
import { readEvents } from './sse.js'
import { candidateOf, classify, finishReasonFor, partsOf } from './map.js'
import { toTokenUsage } from './usage.js'
import { resolveEndpoint } from './settings.js'

/** Tool-call ids are synthesised when the provider omits one. */
let callCounter = 0

/**
 * Antigravity subscription provider adapter.
 */
export class AntigravityAdapter extends LlmAdapter {
  /**
   * @param dependencies - `{ settings, tokens, catalog, fetchImpl, log }`.
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
    return { id: provider, name: 'Antigravity (subscription)' }
  }

  /**
   * Advertise the live catalog. Served from cache; never blocks on a request.
   * @param provider - registered route.
   * @returns advisory model metadata.
   */
  async listModels(provider) {
    const entries = await this.dependencies.catalog().then((catalog) => catalog.list())
    return entries.map((entry) => this.#toModelInfo(provider, entry))
  }

  /**
   * Resolve metadata for one exact model id.
   * @param provider - registered route.
   * @param model - exact model id.
   * @param signal - cancellation for the catalog lookup.
   * @returns host model metadata.
   */
  async resolveModel(provider, model, signal) {
    const catalog = await this.dependencies.catalog(signal)
    // list() is the normalized view (efforts attached); find an exact id in it.
    const entries = (await catalog.list(signal)) ?? []
    const entry = entries.find((candidate) => candidate.id === model) ?? (await catalog.find(signal, model))
    if (!entry) {
      // Unknown ids still route; context falls back rather than failing the turn.
      return this.#toModelInfo(provider, { id: model, name: model })
    }
    return this.#toModelInfo(provider, entry)
  }

  /**
   * Build one LlmModelInfo from a catalog entry.
   * @param provider - route id.
   * @param entry - catalog entry.
   * @returns host model metadata.
   */
  #toModelInfo(provider, entry) {
    const info = {
      id: entry.id,
      name: entry.name ?? entry.id,
      provider,
    }
    if (entry.maxInputTokens) info.contextWindow = entry.maxInputTokens
    if (entry.maxOutputTokens) info.maxOutputTokens = entry.maxOutputTokens
    if (Array.isArray(entry.efforts) && entry.efforts.length > 0) info.reasoningEfforts = entry.efforts
    return info
  }

  /**
   * Stream one completion.
   * @param options - the fully assembled harness request.
   * @returns raw harness stream chunks.
   */
  stream(options) {
    return this.#generate(options)
  }

  /**
   * Drive one request from HTTP to terminal chunk.
   * @param options - harness request.
   */
  async *#generate(options) {
    const config = this.dependencies.settings()
    const endpoint = resolveEndpoint(config)
    const sessionId = options.sessionId ? String(options.sessionId) : undefined

    let body
    try {
      body = requestBody(options, {
        model: options.model,
        project: endpoint.project,
        sessionId,
      })
    } catch (error) {
      throw new LlmError(error?.message ?? 'Antigravity request rejected', error?.code ?? 'UNSUPPORTED_OPTION', { cause: error })
    }

    const token = await this.dependencies.tokens.get(options.signal)
    const url = `${endpoint.baseUrl}${GENERATION_PATH}`
    const headers = {
      authorization: `Bearer ${token}`,
      'content-type': 'application/json',
      'user-agent': endpoint.userAgent,
      accept: 'text/event-stream',
    }

    let response
    try {
      response = await this.dependencies.fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        signal: options.signal,
      })
    } catch (error) {
      if (error?.name === 'AbortError') throw error
      throw new LlmError(`Antigravity request failed: ${error?.message ?? error}`, 'TRANSPORT', { cause: error })
    }

    if (!response.ok) {
      const text = await response.text().catch(() => '')
      if (response.status === 401) this.dependencies.tokens.invalidate()
      throw classifyHttpError(response.status, text)
    }

    let index = 0
    let sawText = false
    let sawTool = false
    let reasoningIndex = -1
    let textIndex = -1
    const open = new Set()
    let usage
    let finishReason

    for await (const event of readEvents(response)) {
      if (event?.done) break
      const candidate = candidateOf(event)
      if (!candidate) continue

      for (const part of partsOf(candidate)) {
        const kind = classify(part)
        if (kind === 'reasoning') {
          if (reasoningIndex === -1) {
            reasoningIndex = index++
            open.add(reasoningIndex)
            yield { type: 'block-start', index: reasoningIndex, blockType: 'reasoning' }
          }
          if (part.text) yield { type: 'reasoning-delta', index: reasoningIndex, text: part.text }
        } else if (kind === 'text') {
          if (!part.text) continue
          if (textIndex === -1) {
            textIndex = index++
            open.add(textIndex)
            yield { type: 'block-start', index: textIndex, blockType: 'text' }
          }
          sawText = true
          yield { type: 'text-delta', index: textIndex, text: part.text }
        } else if (kind === 'tool-call') {
          const call = part.functionCall
          const callIndex = index++
          const id = call.id ?? `antigravity-${Date.now()}-${callCounter++}`
          const args = JSON.stringify(call.args ?? {})
          sawTool = true
          yield { type: 'block-start', index: callIndex, blockType: 'tool-call' }
          yield { type: 'tool-call-delta', index: callIndex, id, name: call.name, argumentsDelta: args }
          yield {
            type: 'block-end',
            index: callIndex,
            block: { type: 'tool-call', id, name: call.name, arguments: args },
          }
        }
      }

      const metadata = (event?.response ?? event)?.usageMetadata
      const next = toTokenUsage(metadata)
      if (next) usage = next
      if (candidate.finishReason) {
        finishReason = finishReasonFor(candidate.finishReason)
        if (finishReason.kind === 'tool-calls' || candidate.finishReason === 'STOP') {
          // STOP with a tool call present means the turn hands back to the harness.
          if (sawTool) finishReason = { kind: 'tool-calls' }
        }
      }
    }

    // Close blocks that are still open, in index order.
    for (const blockIndex of [...open].sort((a, b) => a - b)) {
      const blockType = blockIndex === reasoningIndex ? 'reasoning' : 'text'
      yield { type: 'block-end', index: blockIndex, block: { type: blockType, text: '' } }
    }

    if (!sawText && !sawTool) {
      throw new LlmError('Antigravity returned an empty completion', 'EMPTY_RESPONSE')
    }
    if (usage) yield { type: 'usage', usage }
    yield { type: 'finish', reason: finishReason ?? (sawTool ? { kind: 'tool-calls' } : { kind: 'stop' }) }
  }
}

/**
 * Map a non-2xx response onto an LlmError.
 *
 * Measured statuses: 401 (expired/revoked token), 403 (no UA / no license),
 * 404 (wrong `model` id or wrong envelope), 429 (rate/quota).
 *
 * @param status - HTTP status.
 * @param text - response body.
 * @returns an LlmError carrying a stable code.
 */
export function classifyHttpError(status, text) {
  const message = extractMessage(text) ?? `Antigravity HTTP ${status}`
  const code = status === 401 ? 'AUTH'
    : status === 403 ? 'NO_LICENSE'
      : status === 404 ? 'NOT_FOUND'
        : status === 429 ? 'RATE_LIMITED'
          : 'HTTP_ERROR'
  return new LlmError(message, code, { status })
}

/**
 * Pull the provider's error message out of a response body.
 * @param text - raw body.
 * @returns the message, or undefined.
 */
function extractMessage(text) {
  try {
    const parsed = JSON.parse(text)
    return parsed?.error?.message ?? parsed?.[0]?.error?.message
  } catch {
    return text?.slice(0, 200) || undefined
  }
}
