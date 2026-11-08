/**
 * The DeepInfra **Anthropic-compatible** `LlmAdapter`.
 *
 * DeepInfra exposes the same models behind an Anthropic Messages mount as well
 * as its OpenAI-compatible one. This adapter is that second route: same
 * credential, same catalog, a different protocol on the wire.
 *
 * Two differences from `./adapter.js` are structural, not cosmetic:
 *
 *   1. The downstream half is bound PER STREAM. `createAnthropicBinding()` owns
 *      the thinking `signature` and the two-piece usage bookkeeping, so two
 *      concurrent streams must not share it — hence a new binding inside every
 *      `stream()` call, never a module constant.
 *   2. Anthropic requires `max_tokens` and requires `system` as a TOP-LEVEL
 *      field, so `requestBodyAnthropic` cannot reuse the chat body builder.
 *
 * @module @nolit/dsh-deepinfra/anthropic-adapter
 */

import { LlmAdapter, LlmError, attributionHeaders } from '@deepseek-ai/dsh-llm'
import { normalizeStream } from '../../../lib/stream/index.js'
import { readAnthropicSse } from '../../../lib/stream/anthropic.js'

import { createAnthropicBinding } from './stream-anthropic.js'
import { requestBodyAnthropic } from './wire.js'

/**
 * The Messages path on DeepInfra's Anthropic-compatible mount.
 *
 * The mount lives under `/anthropic` and keeps Anthropic's own `/v1/messages`,
 * so the suffix is the only part that differs from api.anthropic.com.
 */
const ANTHROPIC_MESSAGES_PATH = '/anthropic/v1/messages'

/**
 * The Anthropic mount's OWN origin.
 *
 * Measured 2026-11-08: the Messages endpoint answers at
 * `https://api.deepinfra.com/anthropic/v1/messages`. It is NOT under the
 * OpenAI-compatible `/v1/openai` base, so joining the two paths produces
 * `/v1/openai/anthropic/v1/messages`, which the provider rejects. The two
 * routes therefore need two bases, not one base and one suffix.
 */
const ANTHROPIC_DEFAULT_BASE_URL = 'https://api.deepinfra.com'

/** The one OpenAI-compatible path segment that must never reach the Anthropic URL. */
const OPENAI_BASE_PATH_SUFFIX = '/v1/openai'

/**
 * Resolve the base URL the Messages URL is joined to.
 *
 * Precedence, highest first:
 *   1. `settings.anthropicBaseURL` — an operator/gateway that names the mount
 *      explicitly always wins.
 *   2. `settings.baseURL` with a trailing `/v1/openai` removed — the plugin's
 *      one public base-URL setting is documented as OpenAI-compatible, so a
 *      value that ends in that segment is an OpenAI base and only its origin
 *      can serve the Anthropic mount.
 *   3. the provider default origin.
 *
 * @param {object} [settings] - the live settings snapshot.
 * @returns {string} a base URL with no trailing slash.
 */
export function resolveAnthropicBaseURL(settings) {
  const trimSlash = (value) => value.replace(/\/+$/, '')
  const read = (value) => (typeof value === 'string' ? trimSlash(value.trim()) : '')

  const explicit = read(settings?.anthropicBaseURL)
  if (explicit.length > 0) return explicit

  const openaiBase = read(settings?.baseURL)
  if (openaiBase.length === 0) return ANTHROPIC_DEFAULT_BASE_URL
  // A trailing `/v1/openai` is the OpenAI-compatible mount, which these Messages
  // requests must not target; the origin is what the Anthropic mount shares.
  if (openaiBase === OPENAI_BASE_PATH_SUFFIX || openaiBase.endsWith(OPENAI_BASE_PATH_SUFFIX)) {
    const stripped = trimSlash(openaiBase.slice(0, openaiBase.length - OPENAI_BASE_PATH_SUFFIX.length))
    return stripped.length > 0 ? stripped : ANTHROPIC_DEFAULT_BASE_URL
  }
  return openaiBase
}

/**
 * Map the Anthropic accumulator onto the shape `cost.js parseCost` reads.
 *
 * `parseCost` was written for the OpenAI-compatible wire (`prompt_tokens` /
 * `completion_tokens` / `prompt_tokens_details`), so the Anthropic counters are
 * translated rather than passed through: an untranslated object has no
 * `prompt_tokens`, which is how every Anthropic turn was priced as zero tokens.
 *
 * Anthropic's `input_tokens` EXCLUDES cache, so the prompt total is the sum of
 * the three input-side buckets; the cache buckets are also carried separately,
 * because `parseCost` subtracts `cached_tokens` to recover the uncached input.
 *
 * @param {object} snapshot - `{ input, cacheRead, cacheWrite, output, total? }`.
 * @returns {object} `{ prompt_tokens, completion_tokens, total_tokens?, prompt_tokens_details }`.
 */
export function openAiUsageFrom(snapshot = {}) {
  const count = (value) => (typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : undefined)
  const input = count(snapshot.input) ?? 0
  const cacheRead = count(snapshot.cacheRead) ?? 0
  const cacheWrite = count(snapshot.cacheWrite) ?? 0
  const output = count(snapshot.output)

  const prompt = input + cacheRead + cacheWrite
  const mapped = {
    prompt_tokens: prompt,
    completion_tokens: output ?? 0,
    prompt_tokens_details: { cached_tokens: cacheRead, cache_write_tokens: cacheWrite },
  }
  // Absence is not zero: a total is only claimed when the output count is known.
  if (output !== undefined) mapped.total_tokens = prompt + output
  return mapped
}

/**
 * Map an HTTP status onto the host's provider-neutral failure codes.
 *
 * The codes are what the host routes on, so the mapping is explicit per status
 * rather than a generic "request failed": a 401 must be re-authable, a 429 must
 * be retryable, a 404 must be a model-selection problem.
 *
 * @param status - HTTP status of the failed response.
 * @returns a stable failure code.
 */
function failureCodeFor(status) {
  if (status === 401 || status === 403) return 'INVALID_CREDENTIAL'
  if (status === 404) return 'UNKNOWN_MODEL'
  if (status === 422) return 'UNSUPPORTED_OPTION'
  if (status === 429) return 'RATE_LIMIT'
  if (status >= 500) return 'SERVER'
  return 'SERVER'
}

/**
 * Read a numeric `retry-after` header in milliseconds, when the provider sent one.
 * @param headers - response headers.
 * @returns milliseconds, or undefined.
 */
function retryAfterMs(headers) {
  const read = typeof headers?.get === 'function' ? headers.get('retry-after') : null
  if (typeof read !== 'string' || read.length === 0) return undefined
  const seconds = Number(read)
  if (!Number.isFinite(seconds) || seconds <= 0) return undefined
  return Math.trunc(seconds * 1000)
}

/**
 * DeepInfra's Anthropic-compatible provider adapter.
 */
export class DeepInfraAnthropicAdapter extends LlmAdapter {
  /**
   * @param dependencies - `{ settings, catalog, fetchImpl, log }`.
   */
  constructor(dependencies) {
    super()
    this.dependencies = dependencies
  }

  /**
   * Describe the registered route. The `id` is the IDENTITY, not the route key:
   * the route passed to `registerAdapter()` is `deepinfra-anthropic` and so is
   * this id, so they agree.
   *
   * @returns display metadata.
   */
  providerInfo() {
    return { id: 'deepinfra-anthropic', name: 'DeepInfra (Anthropic)' }
  }

  /**
   * Stream one completion over the Messages protocol.
   * @param options - the fully assembled harness request.
   * @returns raw harness stream chunks.
   */
  async * stream(options) {
    const settings = this.dependencies.settings()
    const baseURL = resolveAnthropicBaseURL(settings)

    let body
    try {
      body = requestBodyAnthropic(options, {
        maxTokens: options.maxTokens,
        reasoningEffort: options.reasoningEffort,
      })
    } catch (error) {
      // A request the provider provably cannot honor fails before any I/O.
      throw new LlmError(
        error?.message ?? 'DeepInfra Anthropic request rejected',
        error?.code ?? 'UNSUPPORTED_OPTION',
        { cause: error },
      )
    }

    const headers = {
      'content-type': 'application/json',
      'x-api-key': settings.apiKey,
      'anthropic-version': '2023-06-01',
      ...attributionHeaders(),
    }

    let response
    try {
      response = await this.dependencies.fetchImpl(`${baseURL}${ANTHROPIC_MESSAGES_PATH}`, {
        method: 'POST',
        headers,
        body: JSON.stringify(body),
        ...(options.signal === undefined ? {} : { signal: options.signal }),
      })
    } catch (error) {
      if (options.signal?.aborted) {
        throw new LlmError('DeepInfra Anthropic request aborted', 'ABORTED', { cause: error })
      }
      throw new LlmError('DeepInfra Anthropic transport failed', 'TRANSPORT', { cause: error })
    }

    if (!response.ok) throw await this.httpFailure(response, options)

    // The catalog row is needed at record time to price the same tokens at LIST
    // price; the wire only reports what was BILLED. Same lookup as the chat
    // route, and a failure to find one must not fail a generation.
    let pricing
    try {
      pricing = (await this.dependencies.catalogEntry?.(options.model))?.metadata?.pricing
    } catch {
      pricing = undefined
    }
    const requestId = typeof response.headers?.get === 'function' ? response.headers.get('x-request-id') : null

    // One binding per stream: it owns this stream's signature and usage counters.
    const binding = createAnthropicBinding()

    // ONE ledger row per response, exactly as the chat route does: the pipe can
    // produce several usage chunks (a usage piece on both `message_start` and
    // `message_delta`), and recording each one would bill the same turn twice.
    //
    // Measured DeepInfra shape: `message_start` carries
    // `input_tokens: 0, output_tokens: 0` as a PLACEHOLDER and the real counts
    // arrive on `message_delta`. "Has output_tokens" is therefore not enough to
    // identify the priceable record — `output_tokens: 0` is present from the
    // first event — so the row is written on the first record with a POSITIVE
    // output count, and a stream that never reports one writes its single row
    // at the end instead of vanishing from the ledger.
    let costRecorded = false
    let sawUsage = false

    /** Write the one row for this response, with the cumulative snapshot. */
    const recordOnce = () => {
      if (costRecorded) return
      costRecorded = true
      // Never throws into the stream: a ledger failure must not fail a
      // generation (recordCost swallows and logs its own errors).
      this.dependencies.recordCost?.(options, openAiUsageFrom(binding.usage()), pricing, requestId ?? undefined)
    }

    try {
      yield* normalizeStream({
        events: readAnthropicSse(response, {
          signal: options.signal,
          malformed: binding.descriptor.malformedRecord,
        }),
        descriptor: binding.descriptor,
        hooks: binding.hooks,
        signal: options.signal,
        // Recorded at record time, so a turn that makes several model calls is
        // still one turn's cost. `binding.usage()` is the cumulative snapshot,
        // which is what the caller must price.
        onUsage: () => {
          sawUsage = true
          const output = binding.usage().output
          if (typeof output === 'number' && Number.isFinite(output) && output > 0) recordOnce()
        },
      })
    } finally {
      // Runs on a normal end AND when the host stops iterating at `finish`, so a
      // usage-reporting stream always leaves exactly one row.
      if (sawUsage) recordOnce()
    }
  }

  /**
   * Turn a non-2xx response into the structured failure the host routes on.
   *
   * @param response - the failed HTTP response.
   * @param options - the originating request.
   * @returns the error to throw.
   */
  async httpFailure(response, options) {
    let detail = ''
    try {
      const text = await response.text()
      try {
        const parsed = JSON.parse(text)
        detail = String(parsed?.error?.message ?? parsed?.message ?? text)
      } catch {
        detail = text
      }
    } catch {
      // An unreadable body leaves only the status.
    }

    const retryAfter = retryAfterMs(response.headers)
    return new LlmError(
      `DeepInfra Anthropic ${options.model} returned HTTP ${response.status}${
        detail.length > 0 ? `: ${detail.slice(0, 400)}` : ''
      }`,
      failureCodeFor(response.status),
      {
        status: response.status,
        ...(retryAfter === undefined ? {} : { providerRetryAfterMs: retryAfter }),
      },
    )
  }
}
