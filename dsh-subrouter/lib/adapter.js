/**
 * OpenAI-compatible chat-completions adapter for DSH.
 *
 * This module is deliberately duck-typed against DSH's LlmAdapter surface.
 * It has no runtime dependency on a DSH package, so the plugin can be loaded
 * from a profile link without resolving private package paths. The optional
 * `@deepseek-ai/dsh-llm` attribution helper is imported best-effort.
 *
 * The adapter owns no tool execution. It translates SSE chunks into DSH
 * `tool-call-delta` chunks; the DSH agent loop decides whether and when to run
 * a tool, and emits tool/call and tool/result in the normal way.
 */
import { randomUUID } from 'node:crypto'

export const DEFAULT_MODEL = Object.freeze({
  id: 'deepseek-v4.1-flash',
  name: 'DeepSeek V4.1 Flash',
  contextWindow: 1000000,
  maxTokens: 384000,
})

export const DEFAULTS = Object.freeze({
  provider: 'subrouter',
  displayName: 'Subrouter (OpenAI-compatible)',
  /** Wire protocol: openai-completions | anthropic-messages. */
  protocol: 'openai-completions',
  /** Empty means protocol default: Bearer for OpenAI, x-api-key for Anthropic. */
  authStyle: '',
  anthropicVersion: '2023-06-01',
  anthropicBeta: '',
  baseURL: 'https://opencode.ai/inference/go/v1',
  apiKeyEnv: 'OPENCODE_API_KEY',
  apiKey: '',
  sessionHeader: 'x-opencode-session',
  /**
   * Value used when DSH dispatches without a session id (catalog probes, title
   * requests). Some routers, including OpenCode Go, reject a request that
   * carries no session identity at all.
   */
  sessionFallback: 'dsh-subrouter',
  timeoutMs: 300000,
  includeUsage: true,
  contextWindow: 131072,
  maxTokens: 8192,
  headers: Object.freeze({}),
  models: Object.freeze([DEFAULT_MODEL]),
  /** Optional umbrella routes. When empty, the top-level fields are one route. */
  routes: Object.freeze([]),
})

const CONFIG_KEYS = new Set(Object.keys(DEFAULTS))

/** Read a loader accessor or a plain config value. */
export function rawValue(config, key) {
  const raw = config?.[key]
  if (raw && typeof raw.get === 'function') {
    try {
      return raw.get()
    } catch {
      return undefined
    }
  }
  return raw
}

function plainObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function nonEmptyString(value, fallback) {
  return typeof value === 'string' && value.trim() ? value.trim() : fallback
}

function positiveNumber(value, fallback) {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback
}

/** Validate the bundle row config. Unknown keys fail loudly instead of being ignored. */
export function resolveConfig(config = {}) {
  if (!plainObject(config)) throw new TypeError('dsh-subrouter: config must be an object')
  const resolved = { ...DEFAULTS, headers: {}, models: DEFAULTS.models.map((model) => ({ ...model })) }
  for (const key of Object.keys(config)) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`dsh-subrouter: unknown setting ${key}`)
    const value = rawValue(config, key)
    if (value === undefined) continue
    if (key === 'headers') {
      if (!plainObject(value)) throw new TypeError('dsh-subrouter: headers must be an object')
      resolved.headers = Object.fromEntries(
        Object.entries(value).map(([name, headerValue]) => [String(name), String(headerValue)]),
      )
      continue
    }
    if (key === 'models') {
      if (!Array.isArray(value)) throw new TypeError('dsh-subrouter: models must be an array')
      resolved.models = value.map((entry, index) => {
        if (!plainObject(entry)) throw new TypeError(`dsh-subrouter: models[${index}] must be an object`)
        const id = nonEmptyString(entry.id, '')
        if (!id) throw new TypeError(`dsh-subrouter: models[${index}].id is required`)
        return {
          id,
          name: nonEmptyString(entry.name, id),
          contextWindow: positiveNumber(entry.contextWindow, resolved.contextWindow),
          maxTokens: positiveNumber(entry.maxTokens, resolved.maxTokens),
        }
      })
      continue
    }
    if (key === 'timeoutMs' || key === 'contextWindow' || key === 'maxTokens') {
      if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
        throw new TypeError(`dsh-subrouter: ${key} must be a positive number`)
      }
      resolved[key] = value
      continue
    }
    if (key === 'includeUsage') {
      if (typeof value !== 'boolean') throw new TypeError('dsh-subrouter: includeUsage must be boolean')
      resolved[key] = value
      continue
    }
    if (key === 'routes') {
      if (!Array.isArray(value)) throw new TypeError('dsh-subrouter: routes must be an array')
      resolved.routes = value
      continue
    }
    if (typeof value !== 'string') throw new TypeError(`dsh-subrouter: ${key} must be a string`)
    resolved[key] = value
  }
  resolved.provider = nonEmptyString(resolved.provider, DEFAULTS.provider)
  resolved.displayName = nonEmptyString(resolved.displayName, DEFAULTS.displayName)
  resolved.baseURL = resolved.baseURL.trim().replace(/\/+$/, '')
  resolved.apiKeyEnv = resolved.apiKeyEnv.trim()
  resolved.sessionHeader = resolved.sessionHeader.trim()
  resolved.sessionFallback = resolved.sessionFallback.trim()
  resolved.protocol = nonEmptyString(resolved.protocol, DEFAULTS.protocol)
  if (!['openai-completions', 'anthropic-messages'].includes(resolved.protocol)) {
    throw new TypeError(`dsh-subrouter: unsupported protocol ${resolved.protocol}`)
  }
  resolved.authStyle = resolved.authStyle.trim()
  if (resolved.authStyle && !['bearer', 'x-api-key'].includes(resolved.authStyle)) {
    throw new TypeError(`dsh-subrouter: authStyle must be bearer or x-api-key`)
  }
  resolved.anthropicVersion = nonEmptyString(resolved.anthropicVersion, DEFAULTS.anthropicVersion)
  resolved.anthropicBeta = resolved.anthropicBeta.trim()
  return resolved
}

/** Expand the optional umbrella routes, each inheriting the top-level defaults. */
export function routeConfigs(config) {
  const base = { ...config, routes: [] }
  const entries = Array.isArray(config.routes) ? config.routes : []
  if (!entries.length) return [config]
  const routes = entries.map((entry, index) => {
    if (!plainObject(entry)) throw new TypeError(`dsh-subrouter: routes[${index}] must be an object`)
    return resolveConfig({ ...base, ...entry, routes: [] })
  })
  const seen = new Set()
  for (const route of routes) {
    if (seen.has(route.provider)) throw new TypeError(`dsh-subrouter: duplicate route provider ${route.provider}`)
    seen.add(route.provider)
  }
  return routes
}

/** One text projection for blocks that OpenAI-compatible APIs cannot carry natively. */
export function blocksToText(blocks) {
  return (blocks ?? [])
    .map((block) => {
      switch (block?.type) {
        case 'text':
          return String(block.text ?? '')
        case 'reasoning':
          return String(block.text ?? '')
        case 'image':
          return `[image: ${block.attachment?.name ?? block.attachment?.id ?? 'image'}]`
        case 'file':
          return `[file: ${block.attachment?.name ?? block.attachment?.id ?? 'file'}]`
        case 'tool-call':
          return `[tool-call ${block.name ?? 'unknown'} ${block.arguments ?? ''}]`
        case 'tool-addition':
          return `[tool enabled: ${block.toolName ?? 'unknown'}]`
        case 'tool-removal':
          return `[tool disabled: ${block.toolName ?? 'unknown'}]`
        default:
          return ''
      }
    })
    .filter(Boolean)
    .join('\n')
}

/**
 * Convert DSH request messages into OpenAI chat-completions messages.
 * Tool calls and tool results stay structured; they are not flattened to text.
 */
export function toOpenAIMessages(options) {
  const messages = []
  if (options?.system) messages.push({ role: 'system', content: String(options.system) })
  for (const message of options?.messages ?? []) {
    const blocks = message?.content ?? []
    if (message.role === 'tool') {
      const toolCallId = String(message.toolCallId ?? message.source?.callId ?? '')
      if (!toolCallId) continue
      messages.push({ role: 'tool', tool_call_id: toolCallId, content: blocksToText(blocks) })
      continue
    }
    if (message.role === 'assistant') {
      const text = blocks
        .filter((block) => block?.type === 'text')
        .map((block) => String(block.text ?? ''))
        .join('')
      const reasoning = blocks
        .filter((block) => block?.type === 'reasoning')
        .map((block) => String(block.text ?? ''))
        .join('')
      const toolCalls = blocks
        .filter((block) => block?.type === 'tool-call')
        .map((block) => ({
          id: String(block.id ?? `call_${randomUUID()}`),
          type: 'function',
          function: {
            name: String(block.name ?? ''),
            arguments: String(block.arguments ?? '{}'),
          },
        }))
      const assistant = { role: 'assistant', content: text || null }
      if (reasoning) assistant.reasoning_content = reasoning
      if (toolCalls.length) assistant.tool_calls = toolCalls
      messages.push(assistant)
      continue
    }
    const role = message.role === 'system' || message.role === 'developer' ? 'system' : 'user'
    messages.push({ role, content: blocksToText(blocks) })
  }
  return messages
}

/** Map OpenAI token accounting into DSH's disjoint prompt/cache counts. */
export function mapUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined
  const prompt = Number(usage.prompt_tokens ?? 0)
  const completion = Number(usage.completion_tokens ?? 0)
  const cached = Number(usage.prompt_tokens_details?.cached_tokens ?? usage.prompt_cache_hit_tokens ?? 0)
  const total = Number(usage.total_tokens ?? prompt + completion)
  if (!Number.isFinite(prompt + completion + cached)) return undefined
  return {
    inputTokens: Math.max(0, prompt - cached),
    outputTokens: Math.max(0, completion),
    ...(Number.isFinite(total) && total > 0 ? { totalTokens: total } : {}),
    ...(cached > 0 ? { cacheReadTokens: cached } : {}),
  }
}

/** Parse an SSE body into event data strings. */
export async function* parseSSE(body) {
  if (!body) return
  const decoder = new TextDecoder()
  let buffer = ''
  const flush = function* (text) {
    let index
    while ((index = text.indexOf('\n')) !== -1) {
      const line = text.slice(0, index).replace(/\r$/, '')
      text = text.slice(index + 1)
      if (line.startsWith('data:')) {
        const data = line.slice(5).trim()
        if (data) yield data
      }
    }
    return { rest: text }
  }
  for await (const chunk of body) {
    buffer += decoder.decode(chunk, { stream: true })
    const result = flush(buffer)
    while (true) {
      const step = result.next()
      if (step.done) {
        buffer = step.value.rest
        break
      }
      yield step.value
    }
  }
  buffer += decoder.decode()
  const result = flush(buffer)
  while (true) {
    const step = result.next()
    if (step.done) break
    yield step.value
  }
  if (buffer.trim().startsWith('data:')) {
    const data = buffer.trim().slice(5).trim()
    if (data) yield data
  }
}

function relPath(baseURL, path) {
  const base = String(baseURL ?? '').replace(/\/+$/, '')
  return `${base}/${path.replace(/^\/+/, '')}`
}

export function errorFinish(code, message, status) {
  return {
    type: 'finish',
    reason: { kind: 'error', failure: { code, message, ...(status ? { status } : {}) } },
  }
}

function blockContent(block) {
  if (block.type === 'tool-call') {
    return { type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments || '{}' }
  }
  return { type: block.type, text: block.text }
}

/** OpenAI-compatible streaming adapter. */
export class OpenAIChatAdapter {
  /**
   * @param {*} ctx DSH plugin context.
   * @param {ReturnType<typeof resolveConfig>} config validated configuration.
   * @param {{ fetchImpl?: typeof fetch }} [options] test seam.
   */
  constructor(ctx, config, options = {}) {
    this.ctx = ctx
    this.config = config
    this.fetchImpl = options.fetchImpl
    this.disposed = false
    this.attribution = async () => ({})
    void import('@deepseek-ai/dsh-llm')
      .then((module) => {
        if (typeof module.attributionHeaders === 'function') this.attribution = module.attributionHeaders
      })
      .catch(() => {
        /* The header helper is advisory for adapters loaded outside the host. */
      })
  }

  providerInfo(provider) {
    return { id: provider, name: this.config.displayName }
  }

  providerRetryPolicy() {}

  imageRequestPricing() {}

  async listModels(provider) {
    return this.config.models.map((model) => ({
      provider,
      id: model.id,
      name: model.name,
      description: `${this.config.displayName} via OpenAI-compatible API`,
      inputModalities: ['text'],
    }))
  }

  async resolveModel(provider, model) {
    const found = this.config.models.find((entry) => entry.id === model)
    return {
      provider,
      id: model,
      name: found?.name ?? model,
      description: `${this.config.displayName} via OpenAI-compatible API`,
      inputModalities: ['text'],
      context: { contextWindow: found?.contextWindow ?? this.config.contextWindow },
      defaultMaxTokens: found?.maxTokens ?? this.config.maxTokens,
    }
  }

  async prepareCall(provider, model) {
    return { model: await this.resolveModel(provider, model), stream: (options) => this.stream(options) }
  }

  apiKey() {
    if (this.config.apiKey) return this.config.apiKey
    const name = this.config.apiKeyEnv
    return name ? process.env[name] ?? '' : ''
  }

  async headers(options) {
    const key = this.apiKey()
    let attribution = {}
    try {
      attribution = (await this.attribution()) ?? {}
    } catch {
      /* attribution is advisory */
    }
    const headers = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      ...(key ? { authorization: `Bearer ${key}` } : {}),
      ...this.config.headers,
      ...attribution,
    }
    if (this.config.sessionHeader) {
      const session = options.sessionId ? String(options.sessionId) : this.config.sessionFallback
      if (session) headers[this.config.sessionHeader] = session
    }
    return headers
  }

  requestBody(options) {
    const body = {
      model: options.model,
      messages: toOpenAIMessages(options),
      stream: true,
    }
    if (options.maxTokens !== undefined) body.max_tokens = options.maxTokens
    if (options.temperature !== undefined) body.temperature = options.temperature
    if (options.stop?.length) body.stop = options.stop
    if (options.tools?.length) {
      body.tools = options.tools.map((tool) => ({
        type: 'function',
        function: {
          name: tool.name,
          description: tool.description,
          parameters: tool.parameters,
        },
      }))
      body.tool_choice = 'auto'
    }
    if (this.config.includeUsage) body.stream_options = { include_usage: true }
    return body
  }

  async *stream(options) {
    if (this.disposed) {
      yield errorFinish('SUBROUTER_DISPOSED', 'subrouter plugin is not active')
      return
    }
    const key = this.apiKey()
    if (!key) {
      yield errorFinish('AUTH', `no API key for provider route "${options.provider}"; set ${this.config.apiKeyEnv || 'apiKey'}`)
      return
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(new Error('subrouter request timed out')), this.config.timeoutMs)
    const signal = options.signal ? AbortSignal.any([options.signal, controller.signal]) : controller.signal
    let response
    try {
      const fetchImpl = this.fetchImpl ?? globalThis.fetch
      response = await fetchImpl(relPath(this.config.baseURL, 'chat/completions'), {
        method: 'POST',
        headers: await this.headers(options),
        body: JSON.stringify(this.requestBody(options)),
        signal,
      })
    } catch (error) {
      clearTimeout(timeout)
      const aborted = signal.aborted
      yield errorFinish(
        aborted ? 'ABORTED' : 'TRANSPORT',
        error instanceof Error ? error.message : String(error),
      )
      return
    }

    if (!response.ok) {
      clearTimeout(timeout)
      let detail = ''
      try {
        detail = (await response.text()).slice(0, 2000)
      } catch {
        /* body is diagnostic only */
      }
      yield errorFinish('ROUTER_HTTP', `subrouter HTTP ${response.status}${detail ? `: ${detail}` : ''}`, response.status)
      return
    }

    const blocks = new Map()
    let nextIndex = 0
    let usage
    let sawToolCall = false
    let finishReason = 'stop'

    const ensureBlock = (key, type) => {
      let block = blocks.get(key)
      if (block) return { block, start: null }
      block = {
        index: nextIndex++,
        type,
        text: '',
        id: '',
        name: '',
        arguments: '',
        closed: false,
      }
      blocks.set(key, block)
      return { block, start: { type: 'block-start', index: block.index, blockType: type } }
    }

    try {
      for await (const data of parseSSE(response.body)) {
        if (data === '[DONE]') break
        let event
        try {
          event = JSON.parse(data)
        } catch {
          continue
        }
        if (event.usage) usage = mapUsage(event.usage) ?? usage
        const choice = event.choices?.[0]
        if (!choice) continue
        const delta = choice.delta ?? {}
        const reasoning = delta.reasoning_content ?? delta.reasoning
        if (typeof reasoning === 'string' && reasoning) {
          const { block, start } = ensureBlock('reasoning', 'reasoning')
          if (start) yield start
          block.text += reasoning
          yield { type: 'reasoning-delta', index: block.index, text: reasoning }
        }
        if (typeof delta.content === 'string' && delta.content) {
          const { block, start } = ensureBlock('text', 'text')
          if (start) yield start
          block.text += delta.content
          yield { type: 'text-delta', index: block.index, text: delta.content }
        }
        for (const call of delta.tool_calls ?? []) {
          sawToolCall = true
          const key = `tool:${call.index ?? 0}`
          const { block, start } = ensureBlock(key, 'tool-call')
          if (start) yield start
          if (call.id) block.id = String(call.id)
          if (call.function?.name) block.name = String(call.function.name)
          const argumentsDelta = String(call.function?.arguments ?? '')
          if (argumentsDelta) block.arguments += argumentsDelta
          if (!block.id) block.id = `call_${randomUUID()}`
          yield {
            type: 'tool-call-delta',
            index: block.index,
            id: block.id,
            ...(block.name ? { name: block.name } : {}),
            argumentsDelta,
          }
        }
        if (choice.finish_reason) finishReason = choice.finish_reason
      }
    } catch (error) {
      clearTimeout(timeout)
      yield errorFinish('STREAM', error instanceof Error ? error.message : String(error))
      return
    } finally {
      clearTimeout(timeout)
    }

    for (const block of [...blocks.values()].sort((a, b) => a.index - b.index)) {
      if (block.closed) continue
      block.closed = true
      yield { type: 'block-end', index: block.index, block: blockContent(block) }
    }
    if (usage) yield { type: 'usage', usage }
    yield {
      type: 'finish',
      reason: {
        kind: sawToolCall
          ? 'tool-calls'
          : finishReason === 'length'
            ? 'max-tokens'
            : 'stop',
      },
    }
  }
}
