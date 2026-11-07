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
 * @module @nolit/dsh-antigravity/adapter
 */
import { LlmAdapter, LlmError } from '@deepseek-ai/dsh-llm'
import { normalizeStream, readSseEvents } from '@nolit/dsh-custom-router/stream'

import { GENERATION_PATH, modelForEffort, requestBody } from './wire.js'
import { groupByBase, toModelInfo, toResolvedModelInfo } from './catalog.js'
import { STREAM_DESCRIPTOR, STREAM_HOOKS } from './stream-contract.js'
import { configValue, resolveEndpoint } from './settings.js'

/**
 * Statuses an Antigravity generation request is retried on.
 *
 * The measured 2026-11-05 failure was an OpenCode-side 451, but the resilience
 * contract is per-route: a rate limit (429), an upstream gateway fault
 * (500/502/503/504), or a legal/unavailable refusal (451) says nothing about the
 * request body. 401/403/404 are excluded: they need a new credential or a
 * different model, not another attempt.
 */
export const DEFAULT_ANTIGRAVITY_RETRY_STATUSES = Object.freeze([429, 451, 500, 502, 503, 504])

/** Abortable sleep used by the retry loop. */
async function sleepFor(ms, signal) {
  if (!(ms > 0)) return !signal?.aborted
  if (signal?.aborted) return false
  return new Promise((resolve) => {
    let settled = false
    const finish = (elapsed) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      signal?.removeEventListener?.('abort', onAbort)
      resolve(elapsed)
    }
    const timer = setTimeout(() => finish(true), ms)
    const onAbort = () => finish(false)
    signal?.addEventListener?.('abort', onAbort, { once: true })
  })
}

/** Exponential backoff step: `base`, `base*2`, `base*4`, ... */
export function backoffDelay(baseMs, attempt) {
  const base = Number(baseMs)
  if (!Number.isFinite(base) || base <= 0) return 0
  return Math.round(base * 2 ** Math.max(0, Math.trunc(attempt)))
}


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
    const groups = await this.#groups()
    return groups.map((group) => toModelInfo(provider, group))
  }

  /**
   * Resolve metadata for one exact model id.
   * @param provider - registered route.
   * @param model - exact model id.
   * @param signal - cancellation for the catalog lookup.
   * @returns host model metadata.
   */
  async resolveModel(provider, model, signal) {
    const groups = await this.#groups(signal)
    const group = groups.find((candidate) => candidate.id === model)
    if (!group) {
      // Unknown ids still route; metadata falls back rather than failing the turn.
      return { provider, id: model, name: model }
    }
    return toResolvedModelInfo(provider, group)
  }

  /**
   * Grouped catalog: one entry per base model, efforts collected.
   * @param signal - cancellation for the catalog lookup.
   * @returns grouped models.
   */
  async #groups(signal) {
    const catalog = await this.dependencies.catalog(signal)
    return groupByBase((await catalog.list(signal)) ?? [])
  }

  /**
   * Resolve the catalog model id that encodes a requested reasoning effort.
   *
   * Measured 2026-11-05: `thinkingLevel` is ignored by the server; the effort is
   * the `-low/-medium/-high` id suffix. A model with no suffix has one fixed
   * level, so the id is returned unchanged.
   *
   * @param model - requested model id.
   * @param effort - DSH reasoning effort id.
   * @returns the model id to send.
   */
  async #modelFor(model, effort) {
    // Always resolve, even without an effort: the base id (`gemini-3.8-flash`) is
    // NOT a served model. Measured 2026-11-05 — sending it returns 404 NOT_FOUND
    // because the account only serves the suffixed ids.
    try {
      const catalog = await this.dependencies.catalog()
      const entries = (await catalog.list()) ?? []
      return modelForEffort(model, effort, entries.map((entry) => entry.id))
    } catch {
      return model
    }
  }

  /**
   * Whether the catalog says this model accepts images.
   *
   * An unknown model is treated as vision-capable so a catalog miss never blocks
   * a legitimate request; the provider remains the final authority.
   * @param model - exact model id.
   * @returns true when images may be sent.
   */
  async #supportsImages(model) {
    // Match on the BASE id: the caller passes `gpt-oss-120b` while the catalog
    // holds `gpt-oss-120b-medium`, so an exact-id lookup missed and the guard
    // silently allowed an image through (measured 2026-11-05: the model then
    // answered as if no image were attached).
    try {
      const catalog = await this.dependencies.catalog()
      const entries = (await catalog.list()) ?? []
      const base = String(model ?? '').replace(/-(low|medium|high)$/, '')
      const entry = entries.find((candidate) => candidate.id === model)
        ?? entries.find((candidate) => String(candidate.id).replace(/-(low|medium|high)$/, '') === base)
      return entry ? entry.supportsImages !== false : true
    } catch {
      return true
    }
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

    // Reject an image request routed to a model that reports no image support
    // BEFORE the call. Measured 2026-11-05: `gpt-oss-120b-medium` silently
    // ignores `inlineData` and answers as if no image were attached, which would
    // otherwise look like a model failure rather than a routing mistake.
    if (hasImage(options.messages) && !(await this.#supportsImages(options.model))) {
      throw new LlmError(
        `Model ${options.model} does not accept image input; choose a vision model (gemini-* or claude-*).`,
        'UNSUPPORTED_OPTION',
      )
    }

    // Effort is the model id suffix, not a generationConfig field (measured
    // 2026-11-05: thinkingLevel is ignored). Resolve the suffixed id so a caller
    // asking for "high" actually gets the high model rather than a relabelled
    // low one.
    const resolvedModel = await this.#modelFor(options.model, options.reasoningEffort)

    let body
    try {
      body = requestBody(options, {
        model: resolvedModel,
        project: endpoint.project,
        sessionId,
      })
    } catch (error) {
      throw new LlmError(error?.message ?? 'Antigravity request rejected', error?.code ?? 'UNSUPPORTED_OPTION', { cause: error })
    }

    const url = `${endpoint.baseUrl}${GENERATION_PATH}`
    const maxRetries = Math.max(0, Math.trunc(configValue(config, 'httpRetries') ?? 3) || 0)
    const baseMs = Math.max(0, Number(configValue(config, 'httpRetryBaseMs') ?? 1000) || 0)
    const retryStatuses = new Set(
      (configValue(config, 'httpRetryStatuses') ?? DEFAULT_ANTIGRAVITY_RETRY_STATUSES).map((value) => Number(value)),
    )
    let statusRetries = 0
    let authRetried = false
    let response
    for (;;) {
      // The token is re-read on every attempt: a 401 invalidates it, and a
      // retry after backoff may sit long enough for the access token to rotate.
      const token = await this.dependencies.tokens.get(options.signal)
      const headers = {
        authorization: `Bearer ${token}`,
        'content-type': 'application/json',
        'user-agent': endpoint.userAgent,
        accept: 'text/event-stream',
      }
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
      if (response.ok) break

      const text = await response.text().catch(() => '')
      if (response.status === 401 && !authRetried) {
        authRetried = true
        this.dependencies.tokens.invalidate()
        this.dependencies.log?.warn?.('antigravity: 401 from the generation endpoint; refreshing the token and retrying once')
        continue
      }
      if (retryStatuses.has(response.status) && statusRetries < maxRetries) {
        const delay = backoffDelay(baseMs, statusRetries)
        statusRetries += 1
        this.dependencies.log?.warn?.(
          `antigravity: generation HTTP ${response.status}; retry ${statusRetries}/${maxRetries} in ${delay}ms`,
        )
        if (!(await sleepFor(delay, options.signal))) {
          const aborted = new Error('Antigravity request aborted during retry backoff')
          aborted.name = 'AbortError'
          throw aborted
        }
        continue
      }
      if (response.status === 401) this.dependencies.tokens.invalidate()
      throw classifyHttpError(response.status, text)
    }

    // The downstream half is the workspace's one shared pipeline
    // (`@nolit/dsh-custom-router/stream`): block lifecycle, first-seen indexes,
    // the finish table, the disjoint usage writer, the failure shape and the
    // empty/cut/abort terminal policy. This adapter supplies only the provider
    // binding in `./stream-contract.js`, so a Gemini quirk never edits the core.
    yield* normalizeStream({
      events: readSseEvents(response, { signal: options.signal, malformed: STREAM_DESCRIPTOR.malformedRecord }),
      descriptor: STREAM_DESCRIPTOR,
      hooks: STREAM_HOOKS,
      signal: options.signal,
      // The host may stop iterating as soon as it sees `finish`, so the ledger
      // is written from the usage chunk itself rather than after the stream.
      onUsage: (usage) => this.dependencies.ledger?.record?.(usage),
    })
  }
}

/**
 * Whether any message carries an image block.
 * @param messages - request messages.
 * @returns true when an image is present.
 */
export function hasImage(messages) {
  for (const message of messages ?? []) {
    if (!Array.isArray(message?.content)) continue
    for (const block of message.content) {
      if (block?.type === 'image') return true
    }
  }
  return false
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
