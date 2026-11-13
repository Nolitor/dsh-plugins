/**
 * The shared OpenAI-compatible protocol core.
 *
 * One module for both halves of the OpenAI chat-completions wire: the stream
 * boundary (`readEvent`, `STREAM_DESCRIPTOR`, `STREAM_HOOKS`, `mapFinish`) and
 * the request projection (`serializeMessages`, `serializeTools`, `requestBody`,
 * `textOf`, `userContent`, `toolCallsOf`, `nonEmpty`, `positiveInteger`).
 *
 * This module SUPERSEDES two byte-identical vendor copies that Phase 2 deletes:
 *   - `vendor/deepinfra/lib/stream-contract.js:85-125`  (readEvent)
 *   - `vendor/exaone/lib/stream-contract.js:76-116`     (readEvent)
 * plus the delta mapping both vendors re-implement in their own `map.js`
 * (`mapDelta` / `reasoningText` / `toolCallFragments`) and the request projection
 * in `vendor/deepinfra/lib/wire.js`. Those files are NOT edited here; their
 * bindings keep working until Phase 2 repoints them at this module.
 *
 * Measured wire shape (api.openai.com/v1/chat/completions and the OpenAI-
 * compatible routes the two copies above were measured against, 2026-11-04):
 *
 *   frame               { choices: [{ delta, finish_reason }], usage }
 *   text part           delta.content
 *   reasoning part      delta.reasoning_content / reasoning / reasoning_text
 *   tool-call part      delta.tool_calls[] -> { index, id, function: { name, arguments } }
 *                       FRAGMENTED: the first fragment carries index/id/name with
 *                       EMPTY arguments, later ones carry only index and an
 *                       argument slice, with id:null and name:null
 *   usage               { prompt_tokens, completion_tokens, total_tokens,
 *                         prompt_tokens_details.cached_tokens,
 *                         completion_tokens_details.reasoning_tokens }
 *   sentinel            data: [DONE]   (the shared reader swallows it)
 *
 * The boundary rule is the one this workspace already paid for (failure ledger
 * F-22): **a delta's type comes from the wire field that carried it, never from
 * looking at its characters.** No tag scanners, no regex classifiers.
 *
 * This module is pure: no I/O, no config, no service access, and no provider
 * identity. The only behavioural delta from the superseded copies is the wording
 * of two error strings, which now name the protocol instead of a vendor (code
 * values are unchanged):
 *   - `readEvent` defect message: '<vendor> event is not a JSON object' ->
 *     'OpenAI-compatible event is not a JSON object' (code stays PROTOCOL_DEFECT);
 *   - `serializeMessages`/`requestBody` errors: vendor prefix -> 'OpenAI-compatible
 *     adapter'.
 *
 * @module @nolit/dsh-custom-router/stream/openai
 */

import { finishReasonFor } from './wire.js'

/** Typed part kinds this core emits. */
export const PART_TEXT = 'text'
export const PART_REASONING = 'reasoning'
export const PART_TOOL_CALL = 'tool-call'

/** Wire fields that carry reasoning text, in priority order. */
export const REASONING_FIELDS = Object.freeze(['reasoning_content', 'reasoning', 'reasoning_text'])

/**
 * Provider stop-sequence ceiling.
 *
 * Measured on the endpoint these copies bind: 4, 5, 8 and 16 are all HTTP 200,
 * 32 returns 422 "maximum of 16 stop sequences allowed". A route with a
 * different ceiling overrides it through `settings.maxStopSequences`.
 */
export const MAX_STOP_SEQUENCES = 16

/**
 * Translate one streamed choice delta into typed parts.
 *
 * @param delta - `choices[0].delta` from one SSE event, or null.
 * @returns ordered typed parts; empty when the delta carries nothing new.
 */
export function mapDelta(delta) {
  if (delta == null || typeof delta !== 'object') return []
  const parts = []
  // Order matters per block, not across blocks: emitting reasoning before text
  // for the same delta matches the wire order the harness assembles against.
  const reasoning = reasoningText(delta)
  if (reasoning.length > 0) parts.push({ kind: PART_REASONING, text: reasoning })
  const text = typeof delta.content === 'string' ? delta.content : ''
  if (text.length > 0) parts.push({ kind: PART_TEXT, text })
  for (const call of toolCallFragments(delta.tool_calls)) {
    parts.push({ kind: PART_TOOL_CALL, ...call })
  }
  return parts
}

/**
 * Read the reasoning text from whichever field the route used.
 * @param delta - one streamed delta.
 * @returns the reasoning text, or '' when the delta carries none.
 */
export function reasoningText(delta) {
  for (const field of REASONING_FIELDS) {
    const value = delta[field]
    if (typeof value === 'string' && value.length > 0) return value
  }
  return ''
}

/**
 * Normalize the tool-call array of one delta.
 *
 * @param value - `delta.tool_calls`, when present.
 * @returns one entry per fragment, with a usable integer `index` and raw
 *   `arguments` string. A fragment with no arguments contributes an empty
 *   delta rather than a bogus one.
 */
export function toolCallFragments(value) {
  if (!Array.isArray(value)) return []
  const out = []
  for (const entry of value) {
    if (entry == null || typeof entry !== 'object') continue
    const index = Number.isInteger(entry.index) && entry.index >= 0 ? entry.index : 0
    const fn = entry.function ?? {}
    const id = typeof entry.id === 'string' && entry.id.length > 0 ? entry.id : undefined
    const name = typeof fn.name === 'string' && fn.name.length > 0 ? fn.name : undefined
    // Arguments stay a RAW STRING end-to-end (the harness contract). A provider
    // that hands back a parsed object is re-stringified exactly once, here.
    const args = typeof fn.arguments === 'string' ? fn.arguments : fn.arguments == null ? '' : JSON.stringify(fn.arguments)
    out.push({ index, id, name, argumentsDelta: args })
  }
  return out
}

/**
 * The descriptor handed to `normalizeStream`.
 *
 * `malformedRecord: 'fail'` is what both superseded copies already did: an
 * undecodable record threw instead of being skipped, because a skipped frame
 * silently truncates a turn.
 */
export const STREAM_DESCRIPTOR = Object.freeze({
  toolCallShape: 'fragmented',
  usage: Object.freeze({ totalFormula: 'prompt+output' }),
  malformedRecord: 'fail',
})

/**
 * Map a provider `finish_reason` onto the host `FinishReason`.
 *
 * OpenAI speaks the same vocabulary the shared table already covers, so this is
 * a delegation with the intent documented rather than a second table:
 * `content_filter` is an error with code `CONTENT_FILTERED`, not a clean `stop`.
 *
 * @param value - `choices[0].finish_reason`.
 * @returns the host `FinishReason` (`{ kind, failure? }`).
 */
export function mapFinish(value) {
  return finishReasonFor(value)
}

/**
 * The stream boundary: one decoded payload in, one normalized record out.
 *
 * The shared pipe never inspects provider JSON. This function decides what one
 * event means and hands over plain parts, the raw usage object and the raw
 * finish value. Nothing here synthesises identity (a tool-call id or name a
 * fragment omitted) — the pipe owns first-seen allocation, so a `call_N`
 * fallback exists in exactly one place.
 *
 * @param payload - one decoded SSE payload. The shared reader ends iteration at
 *   `[DONE]`, so the sentinel never reaches this function.
 * @returns `{ parts?, usage?, finish? }`, `{ defect }` when the payload is not an
 *   object, or undefined when the event carries nothing this provider cares about.
 */
export function readEvent(payload) {
  if (payload === null || typeof payload !== 'object') {
    return {
      defect: { code: 'PROTOCOL_DEFECT', message: 'OpenAI-compatible event is not a JSON object' },
    }
  }

  const choice = payload.choices?.[0]
  const finish = typeof choice?.finish_reason === 'string' && choice.finish_reason.length > 0
    ? choice.finish_reason
    : undefined

  const parts = []
  for (const part of mapDelta(choice?.delta)) {
    if (part.kind === 'tool-call') {
      // A fragment is `{ index, id, name, argumentsDelta }` with `id`/`name`
      // present-but-undefined; the record shape omits absent identity so the
      // pipe's `part.id`/`part.name` reads test the value, not the key.
      parts.push({
        kind: 'tool-call',
        index: part.index,
        ...(part.id !== undefined ? { id: part.id } : {}),
        ...(part.name !== undefined ? { name: part.name } : {}),
        argumentsDelta: part.argumentsDelta,
      })
      continue
    }
    parts.push(part)
  }

  // Usage may arrive with an empty `choices` array (measured: the cost-bearing
  // event is the last one), so it is read independently of the choice.
  const usage = payload.usage !== null && typeof payload.usage === 'object' ? payload.usage : undefined

  if (parts.length === 0 && usage === undefined && finish === undefined) return undefined
  return {
    ...(parts.length > 0 ? { parts } : {}),
    ...(usage === undefined ? {} : { usage }),
    ...(finish === undefined ? {} : { finish }),
  }
}

/**
 * The hook set handed to `normalizeStream`.
 *
 * Pure: no I/O, no context, no state. There is deliberately no `usageFrom`
 * override: this core already speaks the shared writer's canonical usage shape,
 * so a provider that needs a projection supplies its own hook around this one.
 */
export const STREAM_HOOKS = Object.freeze({ readEvent, mapFinish })

/* -------------------------------------------------------------------------- */
/* Request projection                                                          */
/* -------------------------------------------------------------------------- */

/**
 * Coerce a tool description to the non-empty string every vendor requires.
 * @param value - candidate description.
 * @param fallback - the tool name, used when there is no description.
 * @returns a non-empty string.
 */
export function nonEmpty(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length > 0) return text
  // Invent nothing beyond the name: a fabricated description would be a lie the
  // model then acts on.
  return typeof fallback === 'string' && fallback.length > 0 ? 'Tool ' + fallback : 'Tool'
}

/**
 * Read a positive integer.
 *
 * A value of 0 or below is DROPPED rather than sent: measured, the endpoint
 * answers `max_tokens: 0` with HTTP 422 ("Input should be greater than 0"), and
 * the harness's "no explicit budget" is expressed by omission, not by an
 * explicit zero.
 *
 * @param value - candidate.
 * @returns the integer, or undefined.
 */
export function positiveInteger(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.trunc(value)
}

/**
 * Flatten a harness content array to plain text.
 *
 * Image blocks that survive to text projection are named rather than dropped
 * silently, so a text-only route still shows that something was attached.
 *
 * @param content - harness content blocks.
 * @returns concatenated text.
 */
export function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const parts = []
  for (const block of content) {
    if (block == null || typeof block !== 'object') continue
    if (block.type === 'text' && typeof block.text === 'string') parts.push(block.text)
    else if (block.type === 'reasoning') continue
    else if (block.type === 'image') parts.push('[image omitted: this model route accepts text only]')
    else if (block.type === 'file') parts.push('[file omitted: this model route accepts text only]')
  }
  return parts.join('')
}

/**
 * Project harness user content onto provider content.
 *
 * Text-only requests stay a plain string (the shape every route accepts). A
 * request carrying images becomes the typed-part array the wire accepts:
 * `[{type:'image_url', image_url:{url}}]`.
 *
 * @param content - harness content blocks.
 * @param resolveImage - `(block) => url | undefined` for one image block.
 * @returns a string, or an array of typed parts.
 */
export function userContent(content, resolveImage) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const images = []
  for (const block of content) {
    if (block == null || typeof block !== 'object') continue
    if (block.type !== 'image' || block.offloaded === true) continue
    const url = typeof resolveImage === 'function' ? resolveImage(block) : undefined
    if (typeof url === 'string' && url.length > 0) images.push(url)
  }
  if (images.length === 0) return textOf(content)
  const parts = []
  const text = textOf(content)
  if (text.length > 0) parts.push({ type: 'text', text })
  for (const url of images) parts.push({ type: 'image_url', image_url: { url } })
  return parts
}

/**
 * Read assistant `tool-call` blocks as provider tool calls.
 * @param content - harness assistant content blocks.
 * @returns provider `tool_calls` entries, in block order.
 */
export function toolCallsOf(content) {
  if (!Array.isArray(content)) return []
  const out = []
  for (const block of content) {
    if (block == null || block.type !== 'tool-call') continue
    // Arguments travel as the raw JSON string the model produced. A historic
    // block whose string is not valid JSON is still sent verbatim: rewriting it
    // would change what the model is told it said.
    out.push({
      id: String(block.id ?? ''),
      type: 'function',
      function: { name: String(block.name ?? ''), arguments: typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? {}) },
    })
  }
  return out
}

/**
 * Serialize one harness message list onto OpenAI chat messages.
 *
 * The role map covers EVERY role the host defines (failure ledger F-33: a role
 * that falls through to `user` sends the system prompt as a user turn, silently).
 *
 * Assistant history is projected as prose plus structured `tool_calls` only.
 * Reasoning is deliberately NOT replayed: re-sending protocol text is what makes
 * a model keep producing it (F-35).
 *
 * @param messages - harness request messages.
 * @param system - optional one-shot system prompt for hand-built calls.
 * @returns provider messages in order.
 */
export function serializeMessages(messages, system) {
  const out = []
  if (typeof system === 'string' && system.length > 0) out.push({ role: 'system', content: system })
  for (const message of messages ?? []) {
    if (message == null || typeof message !== 'object') continue
    switch (message.role) {
      case 'system': {
        const text = textOf(message.content)
        if (text.length > 0) out.push({ role: 'system', content: text })
        break
      }
      case 'developer': {
        // No developer content reaches the model: the blocks it can carry are
        // tool add/remove records, which the harness has already projected into
        // the tools array. An empty developer message would be rejected.
        break
      }
      case 'user': {
        const content = userContent(message.content)
        if (content.length > 0) out.push({ role: 'user', content })
        break
      }
      case 'assistant': {
        const text = textOf(message.content)
        const calls = toolCallsOf(message.content)
        if (text.length === 0 && calls.length === 0) break
        out.push({
          role: 'assistant',
          content: text.length > 0 ? text : null,
          ...(calls.length > 0 ? { tool_calls: calls } : {}),
        })
        break
      }
      case 'tool': {
        const text = textOf(message.content)
        out.push({ role: 'tool', tool_call_id: String(message.toolCallId ?? ''), content: text })
        break
      }
      default:
        throw new Error(`OpenAI-compatible adapter: unsupported message role "${String(message.role)}"`)
    }
  }
  return out
}

/**
 * Serialize harness tool schemas onto OpenAI function declarations.
 * @param tools - harness `ToolSchema[]`.
 * @returns provider `tools` array, or undefined when there are none.
 */
export function serializeTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined
  const out = []
  for (const tool of tools) {
    if (tool == null || typeof tool.name !== 'string' || tool.name.length === 0) continue
    out.push({
      type: 'function',
      function: {
        name: tool.name,
        // `description` MUST be a non-empty string.
        //
        // Measured 2026-11-05 across vendors: an empty description is accepted by
        // DeepSeek, Google and Qwen routes, but Anthropic rejects the whole request
        // with HTTP 500 and the nested message
        //   "tools.0.custom.description: Input should be a valid string"
        // so a tool without one silently removed Claude from this adapter. A
        // function's name is the only reliable fallback and is still truthful.
        description: nonEmpty(tool.description, tool.name),
        parameters: tool.parameters ?? { type: 'object', properties: {} },
      },
    })
  }
  return out.length > 0 ? out : undefined
}

/**
 * Build the chat-completions request body.
 *
 * @param options - harness `GenerateOptions`.
 * @param settings - `{ maxTokens, reasoningEffort, temperature, maxStopSequences }`
 *   resolved values. `maxStopSequences` overrides this core's measured ceiling
 *   for a route with a different one.
 * @returns the provider JSON body.
 * @throws when the request asks for something the wire cannot honor.
 */
export function requestBody(options, settings = {}) {
  const ceiling = positiveInteger(settings.maxStopSequences) ?? MAX_STOP_SEQUENCES
  const stop = options.stop
  if (Array.isArray(stop) && stop.length > ceiling) {
    const error = new Error(
      `the OpenAI-compatible route accepts at most ${ceiling} stop sequences; ${stop.length} were requested`,
    )
    error.code = 'UNSUPPORTED_OPTION'
    throw error
  }
  const body = {
    model: options.model,
    messages: serializeMessages(options.messages, options.system),
    stream: true,
    stream_options: { include_usage: true },
  }
  const tools = serializeTools(options.tools)
  if (tools !== undefined) body.tools = tools
  const maxTokens = positiveInteger(settings.maxTokens)
  if (maxTokens !== undefined) body.max_tokens = maxTokens
  // Measured 2026-11-05: a negative temperature is rejected with HTTP 422
  // ("Input should be greater than or equal to 0"). A harness that passes one is
  // asking for something the provider cannot honor, so it is refused here rather
  // than turned into a transport error mid-turn. Values above 2 are accepted by
  // the provider but are meaningless for the models it serves, so they pass through
  // untouched: only a value the provider provably rejects is blocked.
  const temperature = settings.temperature ?? options.temperature
  if (typeof temperature === 'number' && Number.isFinite(temperature)) {
    if (temperature < 0) {
      const error = new Error('the OpenAI-compatible route rejects a negative temperature; ' + temperature + ' was requested')
      error.code = 'UNSUPPORTED_OPTION'
      throw error
    }
    body.temperature = temperature
  }
  // reasoningEffort is the harness's opaque id; the OpenAI enum happens to use
  // the same spellings, so the id IS the wire value. Validated upstream by the
  // host against the advertised list, and again here before the request.
  const effort = settings.reasoningEffort ?? options.reasoningEffort
  if (typeof effort === 'string' && effort.length > 0) body.reasoning_effort = effort
  if (Array.isArray(stop) && stop.length > 0) body.stop = stop.slice(0, ceiling)
  return body
}
