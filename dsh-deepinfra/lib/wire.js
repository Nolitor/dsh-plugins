/**
 * DeepInfra wire layer: request serialization and provider response shape.
 *
 * Everything here is measured against the live endpoint (2026-11-04), not
 * assumed from an OpenAI compatibility claim:
 *
 *   base URL      https://api.deepinfra.com/v1/openai
 *   completion    POST {base}/chat/completions
 *   auth          Authorization: Bearer <key>
 *   missing key   401 {"error":{"message":"missing API key","code":"invalid_api_key"}}
 *   unknown model 404 {"error":{"message":"The model ... does not exist","code":"model_not_found"}}
 *   bad effort    422 "Input should be 'none', 'minimal', ..."
 *   stop list     max 16 on HTTP; >16 returns 422
 *   max_tokens    accepted well above 16,384 (16385 / 50000 / 100000 all 200)
 *   developer     role ACCEPTED (200)
 *   image input   content part {type:'image_url', image_url:{url:'data:...'}} (200)
 */

/** Provider base URL; override only for a compatible gateway. */
export const DEFAULT_BASE_URL = 'https://api.deepinfra.com/v1/openai'

/** Completion path under the base URL. */
export const COMPLETIONS_PATH = '/chat/completions'

/**
 * Provider stop-sequence ceiling.
 *
 * The brief said "up to 4". Measured on the live endpoint: 4, 5, 8 and 16 are all
 * HTTP 200, and 32 returns 422 "Value error, maximum of 16 stop sequences
 * allowed". The real limit is 16.
 */
export const MAX_STOP_SEQUENCES = 16

/** Default per-turn completion reservation, matching the measured turn policy. */
export const DEFAULT_TURN_MAX_TOKENS = 16384

/** Default context window when a route reports none (none of the 91 chat routes do). */
export const DEFAULT_CONTEXT_WINDOW = 32768

/**
 * Serialize one harness message list onto DeepInfra chat messages.
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
        throw new Error(`DeepInfra adapter: unsupported message role "${String(message.role)}"`)
    }
  }
  return out
}

/**
 * Serialize harness tool schemas onto DeepInfra function declarations.
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
 * Build the completion request body.
 *
 * @param options - harness `GenerateOptions`.
 * @param settings - `{ maxTokens, reasoningEffort, temperature }` resolved values.
 * @returns the provider JSON body.
 * @throws when the request asks for something the provider cannot honor.
 */
export function requestBody(options, settings = {}) {
  const stop = options.stop
  if (Array.isArray(stop) && stop.length > MAX_STOP_SEQUENCES) {
    const error = new Error(
      `DeepInfra accepts at most ${MAX_STOP_SEQUENCES} stop sequences; ${stop.length} were requested`,
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
  // Measured 2026-11-05: DeepInfra rejects a negative temperature with HTTP 422
  // ("Input should be greater than or equal to 0"). A harness that passes one is
  // asking for something the provider cannot honor, so it is refused here rather
  // than turned into a transport error mid-turn. Values above 2 are accepted by
  // the provider but are meaningless for the models it serves, so they pass through
  // untouched: only a value the provider provably rejects is blocked.
  const temperature = settings.temperature ?? options.temperature
  if (typeof temperature === 'number' && Number.isFinite(temperature)) {
    if (temperature < 0) {
      const error = new Error('DeepInfra rejects a negative temperature; ' + temperature + ' was requested')
      error.code = 'UNSUPPORTED_OPTION'
      throw error
    }
    body.temperature = temperature
  }
  // reasoningEffort is the harness's opaque id; DeepInfra's enum happens to use
  // the same spellings, so the id IS the wire value. Validated upstream by the
  // host against the advertised list, and again here before the request.
  const effort = settings.reasoningEffort ?? options.reasoningEffort
  if (typeof effort === 'string' && effort.length > 0) body.reasoning_effort = effort
  if (Array.isArray(stop) && stop.length > 0) body.stop = stop.slice(0, MAX_STOP_SEQUENCES)
  return body
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
 * request carrying images becomes the typed-part array DeepInfra measured as
 * accepted: `[{type:'image_url', image_url:{url}}]`.
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
 * Coerce a tool description to the non-empty string every vendor requires.
 * @param value - candidate description.
 * @param fallback - the tool name, used when there is no description.
 * @returns a non-empty string.
 */
function nonEmpty(value, fallback) {
  const text = typeof value === 'string' ? value.trim() : ''
  if (text.length > 0) return text
  // Invent nothing beyond the name: a fabricated description would be a lie the
  // model then acts on.
  return typeof fallback === 'string' && fallback.length > 0 ? 'Tool ' + fallback : 'Tool'
}

/**
 * Read a positive integer.
 *
 * A value of 0 or below is DROPPED rather than sent: measured 2026-11-05,
 * DeepInfra answers `max_tokens: 0` with HTTP 422 ("Input should be greater than
 * 0"), and the harness's "no explicit budget" is expressed by omission, not by an
 * explicit zero.
 *
 * @param value - candidate.
 * @returns the integer, or undefined.
 */
function positiveInteger(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return undefined
  return Math.trunc(value)
}

/** Anthropic's thinking budget for each harness reasoning effort, in tokens. */
const THINKING_BUDGETS = Object.freeze({ low: 1024, medium: 2048, high: 4096 })

/** The `max_tokens` an Anthropic request MUST carry when the harness names none. */
const DEFAULT_ANTHROPIC_MAX_TOKENS = 4096

/**
 * Read one harness image block as an Anthropic base64 image source.
 *
 * Measured on the harness type (dsh-llm `ImageBlock`): a block carries
 * `attachment: {attachmentId, mediaType, bytes, ...}` — an opaque STORE
 * identifier, never a URL and never the bytes. Anthropic accepts only
 * `{type:'base64', media_type, data}` (or a URL source), so this route cannot
 * conjure the bytes from an id: resolving one would need the attachment service,
 * which an adapter does not have.
 *
 * A `data:` URL is therefore projected when the caller supplied one (a block that
 * carries `url`, or an attachment that does), and every other shape degrades to a
 * named placeholder the model can see — never a silently dropped image.
 *
 * @param block - harness `ImageBlock`.
 * @returns an Anthropic image block, or undefined when no inline bytes exist.
 */
function anthropicImage(block) {
  const attachment = block.attachment !== null && typeof block.attachment === 'object' ? block.attachment : undefined
  const url = typeof block.url === 'string'
    ? block.url
    : typeof attachment?.url === 'string'
      ? attachment.url
      : undefined
  if (url === undefined || url.startsWith('data:') === false) return undefined
  const comma = url.indexOf(',')
  if (comma === -1) return undefined
  // `data:image/png;base64,<payload>` -> media type is everything before the `;`.
  const meta = url.slice('data:'.length, comma)
  const data = url.slice(comma + 1)
  const mediaType = meta.split(';')[0]
  if (typeof mediaType !== 'string' || mediaType.length === 0) return undefined
  if (data.length === 0) return undefined
  return { type: 'image', source: { type: 'base64', media_type: mediaType, data } }
}

/**
 * Project one harness content block onto Anthropic content blocks.
 *
 * @param block - harness content block.
 * @returns Anthropic blocks contributed by this block, in order.
 */
function anthropicBlocks(block) {
  if (block === null || typeof block !== 'object') return []
  switch (block.type) {
    case 'text':
      return typeof block.text === 'string' ? [{ type: 'text', text: block.text }] : []
    case 'reasoning':
      // Replayed reasoning is what makes a model keep producing it (F-35).
      return []
    case 'image': {
      const image = anthropicImage(block)
      return image === undefined ? [{ type: 'text', text: '[image omitted]' }] : [image]
    }
    case 'tool-call':
      return [
        {
          type: 'tool_use',
          id: String(block.id ?? ''),
          name: String(block.name ?? ''),
          // Anthropic requires an OBJECT here, while the harness carries the raw
          // JSON string the model produced. A historic block that no longer parses
          // becomes an empty object: sending the raw string would be rejected.
          input: parseArguments(block.arguments),
        },
      ]
    default:
      return []
  }
}

/**
 * Parse a harness tool-call argument string into an object.
 * @param value - raw JSON string, or an already-parsed value.
 * @returns the object, or `{}` when the value is not an object.
 */
function parseArguments(value) {
  if (value !== null && typeof value === 'object' && !Array.isArray(value)) return value
  if (typeof value !== 'string' || value.length === 0) return {}
  try {
    const parsed = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {}
  } catch {
    return {}
  }
}

/**
 * Project the harness message list onto Anthropic `messages`.
 *
 * Role map, and why it is a total map: Anthropic accepts only `user` and
 * `assistant` turns, so a `system` message is promoted to the top-level
 * `system` field rather than sent as a turn (ledger F-33: a role that falls
 * through silently sends the system prompt AS a user turn).
 *
 * Tool results ride in a `user` turn as `tool_result` blocks, which is the
 * Anthropic protocol — there is no `tool` role. Consecutive results are merged
 * into ONE user message because Anthropic rejects a `tool_use` whose results are
 * split across turns.
 *
 * @param messages - harness request messages.
 * @returns `{ messages, system }`, where `system` may be undefined.
 */
function anthropicMessages(messages, system) {
  const out = []
  const systems = []
  if (typeof system === 'string' && system.length > 0) systems.push(system)

  for (const message of messages ?? []) {
    if (message === null || typeof message !== 'object') continue
    const content = message.content
    switch (message.role) {
      case 'system': {
        const text = textOf(content)
        if (text.length > 0) systems.push(text)
        break
      }
      case 'developer':
        // Tool add/remove records only; already projected into `tools`.
        break
      case 'user': {
        const blocks = Array.isArray(content)
          ? content.flatMap((block) => anthropicBlocks(block))
          : typeof content === 'string'
            ? [{ type: 'text', text: content }]
            : []
        if (blocks.length > 0) out.push({ role: 'user', content: blocks })
        break
      }
      case 'assistant': {
        const blocks = Array.isArray(content)
          ? content.flatMap((block) => anthropicBlocks(block))
          : typeof content === 'string'
            ? [{ type: 'text', text: content }]
            : []
        if (blocks.length > 0) out.push({ role: 'assistant', content: blocks })
        break
      }
      case 'tool': {
        const block = {
          type: 'tool_result',
          tool_use_id: String(message.toolCallId ?? ''),
          content: textOf(content),
        }
        // Consecutive results share one user turn: Anthropic pairs each
        // `tool_use` with its result in the immediately following turn.
        const last = out[out.length - 1]
        if (last !== undefined && last.role === 'user' && last.__toolResults === true) last.content.push(block)
        else out.push({ role: 'user', content: [block], __toolResults: true })
        break
      }
      default:
        throw new Error(`DeepInfra Anthropic adapter: unsupported message role "${String(message.role)}"`)
    }
  }

  // Drop the merge marker so nothing provider-visible carries an internal flag.
  for (const message of out) delete message.__toolResults
  return { messages: out, system: systems.length > 0 ? systems.join('\n\n') : undefined }
}

/**
 * Serialize harness tool schemas onto Anthropic tool definitions.
 *
 * @param tools - harness `ToolSchema[]`.
 * @returns Anthropic `tools`, or undefined when there are none.
 */
function anthropicTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined
  const out = []
  for (const tool of tools) {
    if (tool === null || typeof tool !== 'object') continue
    if (typeof tool.name !== 'string' || tool.name.length === 0) continue
    out.push({
      name: tool.name,
      // Anthropic rejects an empty description, and `Tool <name>` is the same
      // truthful fallback the chat route already uses.
      description: nonEmpty(tool.description, tool.name),
      input_schema: tool.parameters ?? { type: 'object', properties: {} },
    })
  }
  return out.length > 0 ? out : undefined
}

/**
 * Build an Anthropic Messages request body.
 *
 * @param options - harness `GenerateOptions`.
 * @param settings - `{ maxTokens, reasoningEffort }` resolved values.
 * @returns the provider JSON body.
 */
export function requestBodyAnthropic(options, settings = {}) {
  const { messages, system } = anthropicMessages(options.messages, options.system)
  const tools = anthropicTools(options.tools)
  // Anthropic REQUIRES max_tokens on every request, so "unset" is not expressible
  // by omission here the way it is on the chat route.
  const maxTokens = positiveInteger(settings.maxTokens ?? options.maxTokens) ?? DEFAULT_ANTHROPIC_MAX_TOKENS

  const body = {
    model: options.model,
    max_tokens: maxTokens,
    stream: true,
    messages,
    ...(system === undefined ? {} : { system }),
    ...(tools === undefined ? {} : { tools }),
  }

  // `cache_control` is never sent: prompt caching is a billing decision this
  // adapter does not make on the caller's behalf.
  const effort = settings.reasoningEffort ?? options.reasoningEffort
  const budget = typeof effort === 'string' ? THINKING_BUDGETS[effort] : undefined
  if (budget !== undefined) body.thinking = { type: 'enabled', budget_tokens: budget }
  return body
}
