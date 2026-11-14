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
 * Provider stop-sequence ceiling: 16.
 *
 * The brief said "up to 4". Measured on the live endpoint: 4, 5, 8 and 16 are all
 * HTTP 200, and 32 returns 422 "Value error, maximum of 16 stop sequences
 * allowed". The real limit is 16, which is also the shared core's measured
 * default, so the number has ONE definition (re-exported below) rather than two
 * that can drift.
 */

/** Default per-turn completion reservation, matching the measured turn policy. */
export const DEFAULT_TURN_MAX_TOKENS = 16384

/** Default context window when a route reports none (none of the 91 chat routes do). */
export const DEFAULT_CONTEXT_WINDOW = 32768

/**
 * The OpenAI-compatible request projection is the SHARED protocol core.
 *
 * WHAT WAS DELETED IN PHASE 2: this file used to carry its own
 * `serializeMessages`, `serializeTools`, `requestBody`, `textOf`, `userContent`,
 * `toolCallsOf`, `nonEmpty` and `positiveInteger` — eight functions whose bodies
 * were identical to `vendor/exaone/lib/wire.js` and are now `lib/stream/openai.js`.
 * Every one of them is re-exported here so the existing
 * `@nolit/dsh-deepinfra/wire` surface (and `adapter.js`) keeps working.
 *
 * The only behavioural delta is error WORDING: a rejected role now says
 * "OpenAI-compatible adapter: ..." instead of "DeepInfra adapter: ...". The
 * `error.code` values (`UNSUPPORTED_OPTION`) and the /unsupported message role/
 * text are unchanged, and no request body byte changes.
 *
 * The Anthropic-native half below (`requestBodyAnthropic` and its block
 * projection) is NOT shared and stays here: it is a different protocol with a
 * different tool/thinking/system shape, so folding it into the OpenAI core would
 * be a false abstraction.
 */
export {
  MAX_STOP_SEQUENCES,
  nonEmpty,
  positiveInteger,
  requestBody,
  serializeMessages,
  serializeTools,
  textOf,
  toolCallsOf,
  userContent,
} from '../../../lib/stream/openai.js'

import { nonEmpty, positiveInteger, textOf } from '../../../lib/stream/openai.js'

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
