/**
 * Anthropic Messages API protocol driver for dsh-subrouter.
 *
 * Anthropic's protocol is not MCP: Messages is the model wire protocol, while
 * MCP is a tool/context transport. This driver translates DSH messages, tools,
 * and stream chunks only; tool execution remains in DSH.
 */
import { randomUUID } from 'node:crypto'

import {
  OpenAIChatAdapter,
  blocksToText,
  errorFinish,
  parseSSE,
} from './adapter.js'

function asContentBlocks(blocks) {
  return Array.isArray(blocks) ? blocks : []
}

function appendMessage(messages, role, content) {
  if (!content.length) return
  const last = messages.at(-1)
  if (last?.role === role) {
    last.content.push(...content)
    return
  }
  messages.push({ role, content })
}

function toolInput(argumentsText) {
  try {
    const value = JSON.parse(String(argumentsText ?? '{}'))
    return value !== null && typeof value === 'object' && !Array.isArray(value) ? value : {}
  } catch {
    return {}
  }
}

/** Convert DSH request messages into Anthropic Messages messages. */
export function toAnthropicMessages(options) {
  const systemParts = []
  if (options?.system) systemParts.push(String(options.system))
  const messages = []
  for (const message of options?.messages ?? []) {
    const blocks = asContentBlocks(message?.content)
    if (message.role === 'system' || message.role === 'developer') {
      const text = blocksToText(blocks)
      if (text) systemParts.push(text)
      continue
    }
    if (message.role === 'tool') {
      const toolUseId = String(message.toolCallId ?? message.source?.callId ?? '')
      if (!toolUseId) continue
      appendMessage(messages, 'user', [{
        type: 'tool_result',
        tool_use_id: toolUseId,
        content: blocksToText(blocks),
        ...(message.isError ? { is_error: true } : {}),
      }])
      continue
    }
    if (message.role === 'assistant') {
      const content = []
      const text = blocks
        .filter((block) => block?.type === 'text')
        .map((block) => String(block.text ?? ''))
        .join('')
      if (text) content.push({ type: 'text', text })
      for (const block of blocks) {
        if (block?.type !== 'tool-call') continue
        content.push({
          type: 'tool_use',
          id: String(block.id ?? `toolu_${randomUUID()}`),
          name: String(block.name ?? ''),
          input: toolInput(block.arguments),
        })
      }
      appendMessage(messages, 'assistant', content)
      continue
    }
    const text = blocksToText(blocks)
    if (text) appendMessage(messages, 'user', [{ type: 'text', text }])
  }
  return {
    ...(systemParts.length ? { system: systemParts.join('\n\n') } : {}),
    messages,
  }
}

/** Convert Anthropic usage into DSH's disjoint prompt/cache counters. */
export function mapAnthropicUsage(usage) {
  if (!usage || typeof usage !== 'object') return undefined
  const input = Number(usage.input_tokens ?? 0)
  const output = Number(usage.output_tokens ?? 0)
  const cacheRead = Number(usage.cache_read_input_tokens ?? 0)
  const cacheWrite = Number(usage.cache_creation_input_tokens ?? 0)
  if (![input, output, cacheRead, cacheWrite].every(Number.isFinite)) return undefined
  return {
    inputTokens: Math.max(0, input),
    outputTokens: Math.max(0, output),
    totalTokens: Math.max(0, input + output + cacheRead + cacheWrite),
    ...(cacheRead > 0 ? { cacheReadTokens: cacheRead } : {}),
    ...(cacheWrite > 0 ? { cacheWriteTokens: cacheWrite } : {}),
  }
}

function joinURL(baseURL, path) {
  return `${String(baseURL ?? '').replace(/\/+$/, '')}/${String(path).replace(/^\/+/, '')}`
}

function closeChunk(block) {
  if (block.closed) return null
  block.closed = true
  return {
    type: 'block-end',
    index: block.index,
    block: block.type === 'tool-call'
      ? { type: 'tool-call', id: block.id, name: block.name, arguments: block.arguments || '{}' }
      : { type: block.type, text: block.text },
  }
}

export class AnthropicMessagesAdapter extends OpenAIChatAdapter {
  async headers(options) {
    const key = this.apiKey()
    let attribution = {}
    try {
      attribution = (await this.attribution()) ?? {}
    } catch {
      /* attribution is advisory */
    }
    const authStyle = this.config.authStyle || 'x-api-key'
    const headers = {
      'content-type': 'application/json',
      accept: 'text/event-stream',
      'anthropic-version': this.config.anthropicVersion,
      ...(key && authStyle === 'x-api-key' ? { 'x-api-key': key } : {}),
      ...(key && authStyle === 'bearer' ? { authorization: `Bearer ${key}` } : {}),
      ...(this.config.anthropicBeta ? { 'anthropic-beta': this.config.anthropicBeta } : {}),
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
    const converted = toAnthropicMessages(options)
    const model = this.config.models.find((entry) => entry.id === options.model)
    return {
      model: options.model,
      max_tokens: options.maxTokens ?? model?.maxTokens ?? this.config.maxTokens,
      messages: converted.messages,
      stream: true,
      ...(converted.system ? { system: converted.system } : {}),
      ...(options.tools?.length
        ? {
            tools: options.tools.map((tool) => ({
              name: tool.name,
              description: tool.description,
              input_schema: tool.parameters ?? { type: 'object', properties: {} },
            })),
          }
        : {}),
      ...(options.temperature !== undefined ? { temperature: options.temperature } : {}),
      ...(options.stop?.length ? { stop_sequences: options.stop } : {}),
    }
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
      response = await fetchImpl(joinURL(this.config.baseURL, 'messages'), {
        method: 'POST',
        headers: await this.headers(options),
        body: JSON.stringify(this.requestBody(options)),
        signal,
      })
    } catch (error) {
      clearTimeout(timeout)
      yield errorFinish('TRANSPORT', error instanceof Error ? error.message : String(error))
      return
    }

    if (!response.ok) {
      clearTimeout(timeout)
      let detail = ''
      try {
        const raw = await response.text()
        try {
          const parsed = JSON.parse(raw)
          detail = parsed?.error?.message ?? raw
        } catch {
          detail = raw
        }
      } catch {
        /* diagnostic only */
      }
      yield errorFinish('ROUTER_HTTP', `subrouter HTTP ${response.status}${detail ? `: ${detail.slice(0, 2000)}` : ''}`, response.status)
      return
    }

    const blocks = new Map()
    let nextIndex = 0
    let usage = {}
    let stopReason = 'end_turn'
    let sawToolCall = false

    const ensureBlock = (providerIndex, type) => {
      const key = `cb:${providerIndex}`
      let block = blocks.get(key)
      if (block) return { block, start: null }
      block = { index: nextIndex++, type, text: '', id: '', name: '', arguments: '', closed: false }
      blocks.set(key, block)
      return { block, start: { type: 'block-start', index: block.index, blockType: type } }
    }

    try {
      for await (const data of parseSSE(response.body)) {
        let event
        try {
          event = JSON.parse(data)
        } catch {
          continue
        }
        if (event.type === 'error') {
          yield errorFinish('ANTHROPIC_ERROR', event.error?.message ?? 'Anthropic stream error')
          return
        }
        if (event.type === 'message_start') {
          usage = { ...usage, ...(event.message?.usage ?? {}) }
          continue
        }
        if (event.type === 'content_block_start') {
          const content = event.content_block ?? {}
          const type = content.type === 'tool_use'
            ? 'tool-call'
            : content.type === 'thinking' || content.type === 'redacted_thinking'
              ? 'reasoning'
              : 'text'
          const { block, start } = ensureBlock(event.index ?? 0, type)
          if (start) yield start
          if (type === 'tool-call') {
            sawToolCall = true
            block.id = String(content.id ?? `toolu_${randomUUID()}`)
            block.name = String(content.name ?? '')
          } else if (type === 'reasoning' && content.thinking) {
            block.text += String(content.thinking)
            yield { type: 'reasoning-delta', index: block.index, text: String(content.thinking) }
          } else if (type === 'text' && content.text) {
            block.text += String(content.text)
            yield { type: 'text-delta', index: block.index, text: String(content.text) }
          }
          continue
        }
        if (event.type === 'content_block_delta') {
          const delta = event.delta ?? {}
          const key = `cb:${event.index ?? 0}`
          if (delta.type === 'text_delta') {
            const { block, start } = ensureBlock(event.index ?? 0, 'text')
            if (start) yield start
            const text = String(delta.text ?? '')
            block.text += text
            if (text) yield { type: 'text-delta', index: block.index, text }
          } else if (delta.type === 'thinking_delta') {
            const { block, start } = ensureBlock(event.index ?? 0, 'reasoning')
            if (start) yield start
            const text = String(delta.thinking ?? '')
            block.text += text
            if (text) yield { type: 'reasoning-delta', index: block.index, text }
          } else if (delta.type === 'input_json_delta') {
            const { block, start } = ensureBlock(event.index ?? 0, 'tool-call')
            if (start) yield start
            sawToolCall = true
            const argumentsDelta = String(delta.partial_json ?? '')
            block.arguments += argumentsDelta
            yield {
              type: 'tool-call-delta',
              index: block.index,
              id: block.id || `toolu_${randomUUID()}`,
              ...(block.name ? { name: block.name } : {}),
              argumentsDelta,
            }
          }
          continue
        }
        if (event.type === 'content_block_stop') {
          const block = blocks.get(`cb:${event.index ?? 0}`)
          if (block) {
            const chunk = closeChunk(block)
            if (chunk) yield chunk
          }
          continue
        }
        if (event.type === 'message_delta') {
          if (event.delta?.stop_reason) stopReason = String(event.delta.stop_reason)
          usage = { ...usage, ...(event.usage ?? {}) }
          continue
        }
        if (event.type === 'message_stop') break
      }
    } catch (error) {
      clearTimeout(timeout)
      yield errorFinish('STREAM', error instanceof Error ? error.message : String(error))
      return
    } finally {
      clearTimeout(timeout)
    }

    for (const block of [...blocks.values()].sort((a, b) => a.index - b.index)) {
      const chunk = closeChunk(block)
      if (chunk) yield chunk
    }
    const mappedUsage = mapAnthropicUsage(usage)
    if (mappedUsage) yield { type: 'usage', usage: mappedUsage }
    yield {
      type: 'finish',
      reason: {
        kind: sawToolCall || stopReason === 'tool_use'
          ? 'tool-calls'
          : stopReason === 'max_tokens'
            ? 'max-tokens'
            : 'stop',
      },
    }
  }
}
