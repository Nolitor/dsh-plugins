/**
 * Request construction for cloudcode-pa.
 *
 * Envelope verified 2026-11-05 by replaying a captured `agy` packet and removing
 * one field at a time:
 *
 *   { project, requestId, request: { contents, tools, generationConfig,
 *                                    sessionId, systemInstruction },
 *     model, userAgent, requestType }
 *
 * Field-removal result: every top-level key except `model` is optional; `model`
 * is required and must be the picker id (`gemini-3.8-flash-low`), NOT the
 * catalog key from fetchAvailableModels (`gemini-3.8-flash-tiered`).
 * Omitting `model` returns 404 NOT_FOUND, which is how a wrong shape shows up.
 *
 * @module @nolit/dsh-antigravity-directsdk/wire
 */

/** Streaming generation path. `alt=sse` is what makes the response line-delimited. */
export const GENERATION_PATH = '/v1internal:streamGenerateContent?alt=sse'

/**
 * Turn a DSH message list into Gemini `contents`.
 *
 * DSH request messages carry a leading system-role message for loop-built
 * requests; that text is hoisted into `systemInstruction` because the generation
 * API rejects a system role inside `contents`.
 *
 * @param messages - DSH request messages.
 * @param explicitSystem - `options.system` from a one-shot caller.
 * @returns contents and the system instruction, if any.
 */
export function toContents(messages, explicitSystem) {
  const contents = []
  const systemParts = []
  if (explicitSystem) systemParts.push(explicitSystem)

  for (const message of messages ?? []) {
    const role = message?.role
    if (role === 'system') {
      const text = textOf(message.content)
      if (text) systemParts.push(text)
      continue
    }
    const parts = partsOf(message)
    if (parts.length === 0) continue
    contents.push({ role: role === 'assistant' ? 'model' : 'user', parts })
  }
  return {
    contents,
    systemInstruction: systemParts.length > 0
      ? { role: 'user', parts: [{ text: systemParts.join('\n\n') }] }
      : undefined,
  }
}

/**
 * Flatten DSH content into plain text.
 * @param content - message content (string or block list).
 * @returns concatenated text.
 */
function textOf(content) {
  if (typeof content === 'string') return content
  if (!Array.isArray(content)) return ''
  const out = []
  for (const block of content) {
    if (block?.type === 'text' && typeof block.text === 'string') out.push(block.text)
    else if (typeof block?.text === 'string') out.push(block.text)
  }
  return out.join('')
}

/**
 * Convert one DSH message into Gemini parts.
 * @param message - one request message.
 * @returns provider parts.
 */
function partsOf(message) {
  const content = message?.content
  if (typeof content === 'string') return content === '' ? [] : [{ text: content }]
  if (!Array.isArray(content)) return []
  const parts = []
  for (const block of content) {
    switch (block?.type) {
      case 'text':
        if (typeof block.text === 'string' && block.text !== '') parts.push({ text: block.text })
        break
      case 'reasoning':
        // Thinking text is display-only history; the API does not accept it back
        // as input, and echoing it would double-count tokens.
        break
      case 'tool-call':
        parts.push({
          functionCall: {
            name: block.name,
            args: parseArguments(block.arguments),
            id: block.id ?? undefined,
          },
        })
        break
      case 'tool-result':
        parts.push({
          functionResponse: {
            name: block.name ?? block.toolName ?? 'tool',
            response: { output: typeof block.content === 'string' ? block.content : textOf(block.content) },
            id: block.toolCallId ?? undefined,
          },
        })
        break
      default:
        if (typeof block?.text === 'string' && block.text !== '') parts.push({ text: block.text })
        break
    }
  }
  return parts
}

/**
 * Parse tool-call arguments, which arrive as a JSON string.
 * @param value - raw arguments.
 * @returns an object, or an empty object when unparseable.
 */
export function parseArguments(value) {
  if (value === null || value === undefined || value === '') return {}
  if (typeof value === 'object') return value
  try {
    const parsed = JSON.parse(value)
    return parsed !== null && typeof parsed === 'object' ? parsed : { value: parsed }
  } catch {
    return {}
  }
}

/**
 * Map DSH tool schemas to Gemini function declarations.
 *
 * Measured: the captured agent body carries `tools[0].functionDeclarations[]`
 * with `name`, `description`, `parameters`. Declarations are host-supplied, so
 * the harness owns tool choice; the model is never handed a fixed built-in set.
 *
 * @param tools - DSH tool schemas.
 * @returns the `tools` array, or undefined when there are none.
 */
export function toTools(tools) {
  if (!Array.isArray(tools) || tools.length === 0) return undefined
  const declarations = []
  for (const tool of tools) {
    if (!tool?.name) continue
    const declaration = { name: tool.name, description: tool.description ?? '' }
    // Gemini rejects an empty properties object on some models; omit instead.
    if (tool.parameters && typeof tool.parameters === 'object') declaration.parameters = sanitizeSchema(tool.parameters)
    declarations.push(declaration)
  }
  return declarations.length > 0 ? [{ functionDeclarations: declarations }] : undefined
}

/**
 * Strip JSON-schema keywords Gemini rejects while keeping the shape.
 * @param schema - JSON schema.
 * @returns a Gemini-safe schema.
 */
export function sanitizeSchema(schema) {
  if (Array.isArray(schema)) return schema.map(sanitizeSchema)
  if (schema === null || typeof schema !== 'object') return schema
  const out = {}
  for (const [key, value] of Object.entries(schema)) {
    if (key === 'additionalProperties' || key === '$schema' || key === '$id') continue
    out[key] = sanitizeSchema(value)
  }
  return out
}

/**
 * Map a DSH reasoning effort onto Antigravity's thinking level.
 *
 * Measured: `generationConfig.thinkingConfig.thinkingLevel` accepts LOW and
 * HIGH; the captured agent request used LOW for the -low picker id. `high`,
 * `xhigh` and `max` all map to HIGH because the API exposes no finer level.
 *
 * @param effort - DSH effort id.
 * @returns LOW or HIGH.
 */
export function thinkingLevel(effort) {
  switch (effort) {
    case 'high':
    case 'xhigh':
    case 'max':
      return 'HIGH'
    default:
      return 'LOW'
  }
}

/**
 * Build the request envelope.
 * @param options - DSH GenerateOptions.
 * @param context - `{ model, project, sessionId, requestType }`.
 * @returns the JSON body to POST.
 */
export function requestBody(options, context) {
  const { contents, systemInstruction } = toContents(options.messages, options.system)
  if (contents.length === 0) {
    throw Object.assign(new Error('Antigravity request has no content to send'), { code: 'EMPTY_REQUEST' })
  }
  const generationConfig = {
    maxOutputTokens: Number(options.maxTokens) > 0 ? Number(options.maxTokens) : undefined,
    thinkingConfig: {
      includeThoughts: true,
      thinkingLevel: thinkingLevel(options.reasoningEffort),
    },
  }
  if (typeof options.temperature === 'number') generationConfig.temperature = options.temperature
  if (Array.isArray(options.stop) && options.stop.length > 0) generationConfig.stopSequences = options.stop
  for (const key of Object.keys(generationConfig)) {
    if (generationConfig[key] === undefined) delete generationConfig[key]
  }

  const request = { contents, generationConfig }
  if (systemInstruction) request.systemInstruction = systemInstruction
  const tools = toTools(options.tools)
  if (tools) request.tools = tools
  if (context.sessionId) request.sessionId = context.sessionId

  const requestId = context.requestId ?? `agent/${context.sessionId ?? crypto.randomUUID()}/${Date.now()}/${Math.floor(Math.random() * 1000)}`

  const body = {
    project: context.project,
    requestId,
    request,
    model: context.model,
    userAgent: 'antigravity',
    requestType: context.requestType ?? 'agent',
  }
  return body
}
