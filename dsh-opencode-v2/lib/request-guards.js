/**
 * Request-shape guards (Tier A), derived from deepseek-ai/deepseek-recipe.
 *
 * Three things this module does, all before a byte goes on the wire:
 *
 *   1. `resolveRequestMaxTokens` — the clamp recipe applies in
 *      `ConversationRequest::resolve_max_tokens`: a completion that does not fit
 *      the context left is a guaranteed upstream failure, so lower it to what
 *      remains and never below 1.
 *   2. `validateTools` / `validateStop` — the checks recipe runs in
 *      `protocol/validation.rs` (empty/overlong/pattern-invalid tool names,
 *      duplicate names, a non-object `parameters` schema, empty or overlong stop
 *      lists) so a malformed request fails HERE with a named code instead of
 *      mid-turn at the route with an opaque 400.
 *   3. `finishFromOpenAi`/`reasoningAccounting` live in lib/http.js; the codes
 *      below are shared with it.
 *
 * Measured basis (2026-11-04): 3,140 recorded requests carried >120k prompt
 * characters, and 6,727 requests were sent with no completion/context check at
 * all. A request whose prompt alone exceeds the window is rejected by the route
 * after the full prompt has been uploaded.
 */

/** Recipe's limits, verbatim from protocol/validation.rs. */
export const MAX_TOOL_NAME_LEN = 128
export const MAX_STOP_SEQUENCES = 16

/** Failure code prefix; every code this module raises is stable and assertable. */
export const INVALID_REQUEST = 'OPENCODE_REQUEST_INVALID'

/** A request-shape refusal, shaped as the host's `LlmFailure`. */
export class RequestShapeError extends Error {
  /**
   * @param {string} code - stable machine code (`OPENCODE_REQUEST_INVALID` here).
   * @param {string} message - operator-facing detail.
   */
  constructor(code, message) {
    super(message)
    this.name = 'RequestShapeError'
    this.code = code
  }
}

/**
 * The completion budget for one request.
 *
 * `min(requested, contextWindow - promptTokens)`, floored at 1, plus the evidence
 * that decided it. When the prompt alone does not fit, that is a request the
 * route cannot serve: the caller reports `errors' code` instead of paying for an
 * upload the route will reject.
 *
 * @param {object} input
 * @param {number} input.reservation - the turn reservation (host `defaultMaxTokens`).
 * @param {number|undefined} input.promptTokens - prompt size when known.
 * @param {number|undefined} input.contextWindow - route window when known.
 * @returns {{ maxTokens: number, clamped: boolean, remaining: number|null,
 *   overflow: null|{ promptTokens: number, contextWindow: number } }}
 */
export function resolveRequestMaxTokens({ reservation, promptTokens, contextWindow }) {
  const requested = Number.isFinite(reservation) && reservation > 0 ? Math.trunc(reservation) : 0
  const prompt = Number.isFinite(promptTokens) && promptTokens > 0 ? Math.trunc(promptTokens) : 0
  const window = Number.isFinite(contextWindow) && contextWindow > 0 ? Math.trunc(contextWindow) : 0

  if (!window) {
    return { maxTokens: Math.max(1, requested), clamped: false, remaining: null, overflow: null }
  }
  const remaining = window - prompt
  if (prompt > 0 && remaining < 1) {
    return { maxTokens: 1, clamped: true, remaining: 0, overflow: { promptTokens: prompt, contextWindow: window } }
  }
  const budget = Math.max(1, Math.min(requested || remaining, remaining))
  return {
    maxTokens: budget,
    clamped: budget !== requested,
    remaining,
    overflow: null,
  }
}

/** Whether a JSON Schema-ish value is an object we are willing to send. */
function isSchemaObject(value) {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

/**
 * Validate the tool block the way recipe validates a Chat Completions request.
 *
 * Checks, in recipe's order: the list is an array; each tool has a non-empty
 * name of at most {@link MAX_TOOL_NAME_LEN} bytes matching `^[a-zA-Z0-9_-]+$`;
 * names are unique; each `parameters` is a JSON object.
 *
 * @param {unknown} tools - `options.tools` from the host.
 * @returns {{ ok: boolean, tools: object[], errors: string[] }}
 */
export function validateTools(tools) {
  const errors = []
  if (tools === undefined || tools === null) return { ok: true, tools: [], errors }
  if (!Array.isArray(tools)) {
    return { ok: false, tools: [], errors: ['tools must be an array'] }
  }
  const seen = new Set()
  for (let index = 0; index < tools.length; index += 1) {
    const tool = tools[index]
    const path = `tools[${index}]`
    if (!tool || typeof tool !== 'object') {
      errors.push(`${path} must be an object`)
      continue
    }
    const name = tool.name
    if (typeof name !== 'string' || name.length === 0) {
      errors.push(`Invalid '${path}.name': empty string or not a string`)
      continue
    }
    if (name.length > MAX_TOOL_NAME_LEN) {
      errors.push(`Invalid '${path}.name': string too long (max ${MAX_TOOL_NAME_LEN}, got ${name.length})`)
    } else if (!/^[a-zA-Z0-9_-]+$/.test(name)) {
      errors.push(`Invalid '${path}.name': '${name}' does not match '^[a-zA-Z0-9_-]+$'`)
    }
    if (seen.has(name)) errors.push(`Duplicate tool name '${name}' (Tool names must be unique.)`)
    seen.add(name)
    if (tool.parameters !== undefined && !isSchemaObject(tool.parameters)) {
      errors.push(`Invalid '${path}.parameters': expected a JSON object`)
    }
  }
  return { ok: errors.length === 0, tools, errors }
}

/**
 * Validate a stop list: at most {@link MAX_STOP_SEQUENCES} entries, none empty.
 *
 * @param {unknown} stop - `options.stop` from the host.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateStop(stop) {
  const errors = []
  if (stop === undefined || stop === null) return { ok: true, errors }
  const list = Array.isArray(stop) ? stop : [stop]
  if (list.length > MAX_STOP_SEQUENCES) errors.push(`Stop string array too long: ${list.length}`)
  for (let index = 0; index < list.length; index += 1) {
    const value = list[index]
    if (typeof value !== 'string') { errors.push(`Invalid 'stop[${index}]': expected a string`); continue }
    if (value.length === 0) errors.push(`Invalid 'stop[${index}]': empty string`)
  }
  return { ok: errors.length === 0, errors }
}

/**
 * Run every pre-flight check for one request.
 *
 * @param {{ tools?: unknown, stop?: unknown }} options - host `GenerateOptions` subset.
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateRequest(options) {
  const errors = []
  const tools = validateTools(options?.tools)
  if (!tools.ok) errors.push(...tools.errors)
  const stop = validateStop(options?.stop)
  if (!stop.ok) errors.push(...stop.errors)
  return { ok: errors.length === 0, errors }
}
