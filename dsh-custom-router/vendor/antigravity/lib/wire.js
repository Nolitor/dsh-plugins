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
 * @module @nolit/dsh-antigravity/wire
 */
import { EFFORT_ALIASES, aliasFor, effortAlias } from './catalog.js'

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

  // A DSH tool result is a first-class message (`role: 'tool'` with the call id
  // on the MESSAGE), not a `tool-result` content block. The Anthropic-backed
  // Claude lane on this host validates the tool_use -> tool_result pairing and
  // rejects a history where the response is missing; measured 2026-11-14 on
  // claude-opus-5-5: "messages.2: tool_use ids were found without tool_result
  // blocks immediately after". Resolve the function name from the preceding
  // assistant tool-call blocks so the response can be paired by id.
  const toolNames = new Map()
  for (const message of messages ?? []) {
    if (message?.role !== 'assistant' || !Array.isArray(message.content)) continue
    for (const block of message.content) {
      if (block?.type === 'tool-call' && typeof block.id === 'string' && typeof block.name === 'string') {
        toolNames.set(block.id, block.name)
      }
    }
  }

  /** Append a functionResponse, merging consecutive tool results into one user turn. */
  const appendResponse = (functionResponse) => {
    const last = contents[contents.length - 1]
    if (last?.role === 'user' && Array.isArray(last.parts) && last.parts.length > 0
      && last.parts.every((part) => part.functionResponse !== undefined)) {
      last.parts.push({ functionResponse })
      return
    }
    contents.push({ role: 'user', parts: [{ functionResponse }] })
  }

  for (const message of messages ?? []) {
    const role = message?.role
    if (role === 'system') {
      const text = textOf(message.content)
      if (text) systemParts.push(text)
      continue
    }
    if (role === 'tool' && typeof message.toolCallId === 'string' && message.toolCallId !== '') {
      const hasBlock = Array.isArray(message.content) && message.content.some((block) => block?.type === 'tool-result')
      if (!hasBlock) {
        const name = toolNames.get(message.toolCallId) ?? 'tool'
        appendResponse({
          name,
          response: { output: textOf(message.content) },
          id: message.toolCallId,
        })
        continue
      }
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
      case 'image': {
        // Measured 2026-11-05: images ride as `inlineData {mimeType, data}` and
        // are understood by Gemini and Claude. `gpt-oss-120b-medium` reports no
        // image support and treats the image as absent, so the caller is
        // responsible for not routing an image request to a non-vision model;
        // see supportsImages in the catalog.
        const inline = inlineImage(block)
        if (inline) parts.push({ inlineData: inline })
        break
      }
      case 'tool-call':
        // The opaque thoughtSignature is a PART-level sibling of functionCall,
        // never a field inside it. Measured 2026-11-14 on gemini-4-hydrogen-low
        // (isolated home): the inbound part is `{ thoughtSignature, functionCall:
        // { name, args, id } }`, and replaying the signature inside functionCall
        // is HTTP 400 "Unknown name \"thoughtSignature\" at
        // 'request.contents[N].parts[0].function_call': Cannot find field."
        parts.push({
          functionCall: {
            name: block.name,
            args: parseArguments(block.arguments),
            id: block.id ?? undefined,
          },
          ...(typeof block.thoughtSignature === 'string' && block.thoughtSignature !== ''
            ? { thoughtSignature: block.thoughtSignature }
            : {}),
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
 * Convert a DSH image block into Gemini inlineData.
 *
 * Accepts the shapes the harness actually emits: a base64 `data` field, a
 * `source` object with `data`, or a `data:` URL in `url`/`image_url`.
 *
 * @param block - image content block.
 * @returns `{ mimeType, data }`, or undefined when nothing usable is present.
 */
export function inlineImage(block) {
  const mimeType = block?.mimeType ?? block?.mediaType ?? block?.source?.mediaType ?? 'image/png'
  const data = block?.data ?? block?.source?.data ?? block?.base64
  if (typeof data === 'string' && data !== '') return { mimeType, data }
  const url = block?.url ?? block?.image_url?.url ?? block?.source?.url
  if (typeof url === 'string') {
    const match = /^data:([^;]+);base64,(.+)$/.exec(url)
    if (match) return { mimeType: match[1], data: match[2] }
    // A remote URL cannot be fetched by the adapter (no I/O in a mapping layer).
    return undefined
  }
  return undefined
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
 * Whether a reasoning-effort selection is honourable for this route.
 *
 * MEASURED 2026-11-05 — this is the important correction:
 *
 *   flash-low  thinkingLevel=LOW   -> thoughts 0 chars
 *   flash-low  thinkingLevel=HIGH  -> thoughts 0 chars
 *   flash-high thinkingLevel=HIGH  -> thoughts 1620 chars
 *   flash-high thinkingLevel=LOW   -> thoughts 1620 chars
 *
 * `generationConfig.thinkingConfig.thinkingLevel` is IGNORED by the server. The
 * effort is encoded in the MODEL ID suffix (`-low` / `-medium` / `-high`), which
 * is why the catalog lists one id per level. `includeThoughts` only controls
 * whether the thinking text is streamed back.
 *
 * Consequence: an adapter that maps `reasoningEffort` onto `thinkingLevel` looks
 * like it works while changing nothing. Effort must instead select the model id,
 * so this function reports whether the requested effort matches the id.
 *
 * @param model - exact model id, possibly suffixed.
 * @param effort - DSH reasoning effort id.
 * @returns true when the model id already encodes the requested effort.
 */
export function effortMatchesModel(model, effort) {
  if (!effort) return true
  const match = /-(low|medium|high)$/.exec(String(model ?? ''))
  if (!match) return true // a model with no suffix has one fixed level
  const wanted = effort === 'xhigh' || effort === 'max' ? 'high' : effort
  return match[1] === wanted
}

/**
 * The model id that encodes a requested effort, when the catalog serves it.
 *
 * @param model - requested model id.
 * @param effort - DSH reasoning effort id.
 * @param available - model ids the catalog serves.
 * @returns the suffixed id to use, or the original when no variant exists.
 */
export function modelForEffort(model, effort, available) {
  const ids = Array.isArray(available) ? available : []
  const alias = effortAlias(model)
  const base = alias ? alias.base : String(model ?? '').replace(/-(low|medium|high)$/, '')
  const variants = ids.filter((id) => id === base || id.startsWith(base + '-'))

  // F-40: the provider's effort scale is mapped onto DSH's, and the mapping
  // must round-trip. The old rule folded `xhigh` onto `high` unconditionally,
  // which was correct only while no account served an `xhigh` id. Measured
  // 2026-11-13: Hydrogen serves one, so folding meant picking XHigh sent High —
  // a control that is accepted but not honoured, the exact failure F-40 names.
  // Collapse only when the catalog does NOT carry the exact level.
  const served = new Set(ids)
  let wanted = effort
  if ((effort === 'xhigh' || effort === 'max' || effort === 'maximal') && !served.has(`${base}-${effort}`)) wanted = 'high'
  // A bare alias id already encodes its level; a bare alias base defaults to low.
  if (!wanted) wanted = alias?.effort ?? (base === 'gemini-3.5-flash-lite' ? 'low' : undefined)
  // Bounded by the suffix shape, not a closed list: a narrower list silently
  // refuses to name a level the catalog just advertised.
  if (wanted && /^[a-z]+$/.test(wanted)) {
    // The 3.5 Flash Lite family maps effort onto three unrelated ids.
    const aliasId = aliasFor(base, wanted)
    if (aliasId) return aliasId
    const candidate = `${base}-${wanted}`
    if (ids.length === 0) return candidate
    if (ids.includes(candidate)) return candidate
  }

  // No effort requested, or the requested level is not served: the base id alone
  // is NOT a valid model. Measured 2026-11-05: sending `gemini-3.8-flash` or
  // `gpt-oss-120b` returns 404 NOT_FOUND, because the account only serves the
  // suffixed ids. Prefer the LOWEST level (the owner's default), not the first
  // catalog row: the account lists high, medium, low, so "Default" previously
  // resolved to high while the picker looked neutral.
  if (ids.length > 0) {
    if (ids.includes(model)) return model
    if (aliasesOf(base).includes(model)) return model
    if (ids.includes(base + '-low')) return base + '-low'
    if (variants.length > 0) return variants[0]
  }
  // Unknown catalog: keep a suffixed id when the caller already gave one.
  return /-(low|medium|high)$/.test(String(model ?? '')) ? model : model
}

/** All raw alias ids that belong to a base model. */
function aliasesOf(base) {
  return Object.keys(EFFORT_ALIASES).filter((id) => EFFORT_ALIASES[id].base === base)
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
    // includeThoughts controls STREAMING of the thinking text only; the level is
    // the model id suffix (see effortMatchesModel for the measurement).
    thinkingConfig: { includeThoughts: true },
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
