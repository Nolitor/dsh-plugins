/**
 * The DeepInfra `LlmAdapter`.
 *
 * Obligations this file satisfies, from docs/subsystems/llm-streaming.md:
 *   1. `stream(options)` is an AsyncIterable<StreamChunk>.
 *   2. Emit `usage` BEFORE `finish`; emit NOTHING after `finish`. DeepInfra sends
 *      its usage chunk AFTER the finish_reason event (measured: ... FINISH:tool_calls
 *      -> USAGE -> [DONE]), and sometimes sends finish and usage on the same event.
 *      The shared pipe buffers usage until the body ends, so both shapes hold.
 *   3. Tool-call arguments are raw JSON strings end-to-end; indexes are allocated
 *      in first-seen order and reused per block (owned by the shared pipe).
 *   4. Two error paths: throw LlmError (transport/protocol) or finish{kind:'error'}.
 *   5. Honor options.signal; an abort ends IN-BAND as finish{kind:'aborted'}.
 *   6. An unhonorable option throws UNSUPPORTED_OPTION, never dropped silently.
 *   7. Every request carries attributionHeaders().
 *   8. An empty completion is EMPTY_RESPONSE, not a silent success.
 *
 * Only the request half lives here. Everything downstream of the decoded payload
 * — block lifecycle, indexes, finish table, usage buckets, terminal policy — is
 * `@nolit/dsh-custom-router/stream`, bound to this provider by
 * `./stream-contract.js`.
 */
import {
  LlmAdapter,
  LlmError,
  attributionHeaders,
  isContextWindowExceededError,
} from '@deepseek-ai/dsh-llm'
import { normalizeStream, readSseEvents } from '../../../lib/stream/index.js'

import { COMPLETIONS_PATH, DEFAULT_BASE_URL, requestBody } from './wire.js'
import { STREAM_DESCRIPTOR, STREAM_HOOKS } from './stream-contract.js'

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
   * The downstream half is the workspace's one shared pipeline
   * (`@nolit/dsh-custom-router/stream`): block lifecycle, first-seen indexes,
   * the finish table, the disjoint usage writer, the failure shape and the
   * empty/cut/abort terminal policy. This adapter supplies only the provider
   * binding in `./stream-contract.js`, so a DeepInfra quirk never edits the core.
   *
   * DeepInfra emits its usage event AFTER the finish_reason event (measured:
   * FINISH -> USAGE -> [DONE]), and sometimes sends both on one event. The pipe
   * buffers usage until the body ends, which satisfies "usage before finish,
   * nothing after" for both shapes.
   *
   * @param body - response body stream.
   * @param options - the originating request.
   * @param pricing - catalog `metadata.pricing`, for the list-price figure.
   * @param requestId - the provider's `x-request-id`, when it sent one.
   */
  async * translate(body, options, pricing, requestId) {
    // The cost figure comes from `estimated_cost`, which the host's TokenUsage
    // has no slot for, so the RAW provider usage object is kept as it arrives.
    let lastRawUsage
    // One ledger row per response: the pipe can only produce one usage chunk,
    // and the host may stop iterating at `finish`, so the record happens on
    // arrival rather than after the stream (spec §7.1 F4).
    let costRecorded = false
    const hooks = {
      ...STREAM_HOOKS,
      readEvent: (payload) => {
        const record = STREAM_HOOKS.readEvent(payload)
        if (record?.usage !== undefined) lastRawUsage = record.usage
        return record
      },
    }

    try {
      yield* normalizeStream({
        events: readSseEvents(body, { signal: options.signal, malformed: STREAM_DESCRIPTOR.malformedRecord }),
        descriptor: STREAM_DESCRIPTOR,
        hooks,
        tools: options.tools,
        signal: options.signal,
        onUsage: () => {
          if (costRecorded) return
          costRecorded = true
          // Never throws into the stream: a ledger failure must not fail a
          // generation (recordCost swallows and logs its own errors).
          this.dependencies.recordCost?.(options, lastRawUsage, pricing, requestId)
        },
      })
    } catch (error) {
      if (error instanceof LlmError) throw error
      // Contract rule N5 / spec §5.4: a protocol defect is a thrown failure, not
      // an in-band clean finish. The pipe rethrows it for exactly this reason.
      if (error?.code === 'PROTOCOL_DEFECT') {
        throw new LlmError(error.message ?? 'DeepInfra stream carried an undecodable event', 'PROTOCOL', { cause: error })
      }
      throw new LlmError('DeepInfra stream failed', 'TRANSPORT', { cause: error })
    }
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
