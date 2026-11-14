/**
 * The EXAONE `LlmAdapter`.
 *
 * Obligations this file satisfies, from docs/subsystems/llm-streaming.md:
 *   1. `stream(options)` is an AsyncIterable<StreamChunk>.
 *   2. Emit `usage` BEFORE `finish`; emit NOTHING after `finish`. The shared
 *      pipe buffers the provider's usage event until the body ends.
 *   3. Tool-call arguments are raw JSON strings end-to-end; indexes are owned
 *      by the shared pipe.
 *   4. Two error paths: throw LlmError (transport/protocol) or
 *      finish{kind:'error'}.
 *   5. Honor options.signal; an abort ends IN-BAND as finish{kind:'aborted'}.
 *   6. An unhonorable option throws UNSUPPORTED_OPTION, never dropped silently.
 *   7. Every request carries attributionHeaders().
 *   8. An empty completion is EMPTY_RESPONSE, not a silent success.
 *
 * Only the request half lives here. Everything downstream of the decoded
 * payload is `@nolit/dsh-custom-router/stream`, bound by `./stream-contract.js`.
 *
 * @module @nolit/dsh-exaone/adapter
 */
import {
  LlmAdapter,
  LlmError,
  attributionHeaders,
  isContextWindowExceededError,
} from '@deepseek-ai/dsh-llm'
import { normalizeStream, readSseEvents } from '../../../lib/stream/index.js'

import { listModels, resolveModel } from './catalog.js'
import { STREAM_DESCRIPTOR, STREAM_HOOKS } from './stream-contract.js'
import { COMPLETIONS_PATH, DEFAULT_BASE_URL, requestBody } from './wire.js'

/**
 * EXAONE provider adapter.
 */
export class EXAONEAdapter extends LlmAdapter {
  /**
   * @param {{settings: Function, fetchImpl: Function, log?: object}} dependencies - per-call settings.
   */
  constructor(dependencies) {
    super()
    this.dependencies = dependencies
  }

  /**
   * Describe the registered route.
   * @param {string} provider - the route passed to registerAdapter().
   * @returns {{id: string, name: string}} display metadata whose id equals the provider.
   */
  providerInfo(provider) {
    return { id: provider, name: 'EXAONE' }
  }

  /**
   * Advertise the declared chat model, filtered by `enabledModels`.
   * @param {string} provider - registered route.
   * @returns {Promise<object[]>} advisory model metadata.
   */
  async listModels(provider) {
    const settings = this.dependencies.settings()
    return listModels(provider, settings.enabledModels)
  }

  /**
   * Resolve exact-route metadata (context, reservation, reasoning efforts).
   * @param {string} provider - registered route.
   * @param {string} model - exact model id.
   * @param {AbortSignal} [_signal] - cancellation (unused: the catalog is static).
   * @returns {Promise<object>} host model metadata.
   */
  async resolveModel(provider, model, _signal) {
    const settings = this.dependencies.settings()
    return resolveModel(provider, model, {
      defaultMaxTokens: settings.maxTokens,
      defaultEffort: settings.defaultEffort,
    })
  }

  /**
   * Stream one completion.
   * @param {object} options - the fully assembled harness request.
   * @returns {AsyncIterable<object>} raw harness stream chunks.
   */
  stream(options) {
    return this.generate(options)
  }

  /**
   * Drive one request from HTTP to terminal chunk.
   * @param {object} options - harness request.
   */
  async * generate(options) {
    const settings = this.dependencies.settings()
    if (typeof settings.apiKey !== 'string' || settings.apiKey.length === 0) {
      throw new LlmError(
        'EXAONE API key is missing: enter it in the router settings (or set EXAONE_API_KEY).',
        'INVALID_CREDENTIAL',
      )
    }

    let body
    try {
      body = requestBody(options, {
        maxTokens: options.maxTokens ?? settings.maxTokens,
        reasoningEffort: options.reasoningEffort,
        temperature: options.temperature,
      })
    } catch (error) {
      throw new LlmError(
        error?.message ?? 'EXAONE request rejected',
        error?.code ?? 'UNSUPPORTED_OPTION',
        { cause: error },
      )
    }

    const headers = {
      ...attributionHeaders(),
      'content-type': 'application/json',
      authorization: `Bearer ${settings.apiKey}`,
    }
    const baseUrl = String(settings.baseUrl ?? DEFAULT_BASE_URL).replace(/\/+$/, '')

    let response
    try {
      response = await this.dependencies.fetchImpl(`${baseUrl}${COMPLETIONS_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    } catch (error) {
      if (options.signal?.aborted) throw new LlmError('EXAONE request aborted', 'ABORTED', { cause: error })
      throw new LlmError('EXAONE transport failed', 'TRANSPORT', { cause: error })
    }

    if (!response.ok) throw await this.httpFailure(response, options)

    try {
      yield* normalizeStream({
        events: readSseEvents(response.body, {
          signal: options.signal,
          malformed: STREAM_DESCRIPTOR.malformedRecord,
        }),
        descriptor: STREAM_DESCRIPTOR,
        hooks: STREAM_HOOKS,
        tools: options.tools,
        signal: options.signal,
      })
    } catch (error) {
      if (error instanceof LlmError) throw error
      if (error?.code === 'PROTOCOL_DEFECT') {
        throw new LlmError(
          error.message ?? 'EXAONE stream carried an undecodable event',
          'PROTOCOL',
          { cause: error },
        )
      }
      throw new LlmError('EXAONE stream failed', 'TRANSPORT', { cause: error })
    }
  }

  /**
   * Turn a non-2xx response into the one structured failure the host routes on.
   *
   * EXAONE documents `{result_code, description}` for platform errors while its
   * OpenAI-compatible surface uses `{error:{message, code, type}}`. Both are read.
   * @param {Response} response - failed HTTP response.
   * @param {object} options - the originating request.
   * @returns {Promise<LlmError>} the classified failure.
   */
  async httpFailure(response, options) {
    let detail = ''
    let code = ''
    let type = ''
    try {
      const text = await response.text()
      try {
        const parsed = JSON.parse(text)
        detail = String(
          parsed?.error?.message
          ?? parsed?.description
          ?? parsed?.message
          ?? text,
        )
        code = String(parsed?.error?.code ?? parsed?.code ?? parsed?.result_code ?? '')
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
    else if (response.status === 429) failureCode = 'RATE_LIMIT'
    else if (isContextWindowExceededError(joined)) failureCode = 'CONTEXT_WINDOW_EXCEEDED'
    else if (response.status === 404) failureCode = 'UNKNOWN_MODEL'
    else if (response.status === 422 || response.status === 400) failureCode = 'UNSUPPORTED_OPTION'
    else if (response.status >= 500) failureCode = 'SERVER'
    else failureCode = 'INVALID_REQUEST'

    const retryAfter = retryAfterMs(response.headers)
    return new LlmError(
      `EXAONE ${options.model} returned HTTP ${response.status}${detail.length > 0 ? `: ${detail.slice(0, 400)}` : ''}`,
      failureCode,
      {
        status: response.status,
        ...(retryAfter === undefined ? {} : { providerRetryAfterMs: retryAfter }),
      },
    )
  }
}

/**
 * Read a provider-requested retry delay.
 * @param {Headers} headers - response headers.
 * @returns {number|undefined} a positive millisecond delay.
 */
function retryAfterMs(headers) {
  if (headers == null || typeof headers.get !== 'function') return undefined
  const value = headers.get('retry-after')
  if (value == null) return undefined
  const seconds = Number(value)
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  return Math.trunc(seconds * 1000)
}
