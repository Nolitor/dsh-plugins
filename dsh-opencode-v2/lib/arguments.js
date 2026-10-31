/**
 * Tool-call argument normalization at the adapter boundary.
 *
 * Measured 2026-11-01 (session 2dc3531f, opencode-go route): 30 of 80 tool calls
 * arrived as TWO complete JSON snapshots concatenated into one arguments string.
 * The route re-sends the whole arguments object instead of a fragment, and the
 * adapter appended it, so the host received
 *   {"code":"…"}{"code":"…"}
 * and every dispatch failed with `invalid arguments: "arguments" must be an object`
 * (30 x ToolArgsError INVALID_ARGS in one session).
 *
 * A route may also restate a snapshot with changed content. The last complete
 * snapshot wins, which matches the writer's intent: the newest full statement of
 * the call. Fragments that are not complete values keep concatenating as before.
 */

/** Parse a complete JSON value, or null. */
function parseValue(text) {
  try { return JSON.parse(text) } catch { return null }
}

/**
 * Scan one complete JSON value (object or array) from the head of s.
 *
 * @param {string} s
 * @returns {{ raw: string, end: number } | null} the value text and the index
 *   just past it, or null when the value is not complete.
 */
export function scanJsonValue(s) {
  let i = 0
  while (i < s.length && /\s/.test(s[i])) i += 1
  if (i >= s.length) return null
  const open = s[i]
  if (open !== '{' && open !== '[') return null
  let depth = 0
  let inString = false
  let escaped = false
  for (let k = i; k < s.length; k += 1) {
    const ch = s[k]
    if (inString) {
      if (escaped) escaped = false
      else if (ch === '\\') escaped = true
      else if (ch === '"') inString = false
      continue
    }
    if (ch === '"') { inString = true; continue }
    if (ch === '{' || ch === '[') depth += 1
    else if (ch === '}' || ch === ']') {
      depth -= 1
      if (depth === 0) return { raw: s.slice(i, k + 1), end: k + 1 }
    }
  }
  return null
}

/** Canonical form used to decide whether two snapshots say the same thing. */
export function canonical(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((key) => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}'
}

/** Whether a value can be the argument set of one declared parameter schema. */
function fitsSchema(value, schema) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  if (!schema || typeof schema !== 'object') return true
  const properties = schema.properties && typeof schema.properties === 'object' ? schema.properties : null
  const required = Array.isArray(schema.required) ? schema.required : []
  const keys = Object.keys(value)
  if (keys.length === 0) return false
  if (!required.every((key) => Object.hasOwn(value, key))) return false
  if (properties && !keys.every((key) => Object.hasOwn(properties, key))) return false
  return true
}

/**
 * Unwrap the wrapped call form the route sometimes re-sends as a second snapshot:
 * `{"arguments":"<json>"}` or `{"arguments":{...}}`. Measured on 3 of the 30 broken
 * calls in session 2dc3531f; keeping the wrapper would have handed the host
 * `{arguments: "..."}` for a tool whose schema declares neither key.
 */
function unwrapSnapshot(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (keys.length !== 1 || keys[0] !== 'arguments') return null
  const inner = value.arguments
  if (typeof inner === 'string') {
    const parsed = parseValue(inner)
    return parsed !== null && typeof parsed === 'object' ? parsed : null
  }
  return inner !== null && typeof inner === 'object' ? inner : null
}

/**
 * Normalize one tool-call arguments string.
 *
 * @param {string} raw - the accumulated arguments string from the wire.
 * @param {{properties?: object, required?: string[]}} [schema] - the declared
 *   parameter schema of the call's tool, used to pick the right snapshot.
 * @returns {{
 *   value: string,
 *   mode: 'empty' | 'valid' | 'duplicate' | 'restated' | 'unwrapped' | 'invalid',
 *   snapshots: number,
 *   reparsed: unknown,
 * }} `value` is always a string safe to hand to the host when mode is not
 *   `invalid`; `reparsed` is the parsed object (or null).
 */
export function normalizeArguments(raw, schema = null) {
  const text = typeof raw === 'string' ? raw : ''
  if (text.trim().length === 0) return { value: '{}', mode: 'empty', snapshots: 0, reparsed: {} }
  const whole = parseValue(text)
  if (whole !== null && typeof whole === 'object') {
    const unwrapped = unwrapSnapshot(whole)
    if (unwrapped !== null && fitsSchema(unwrapped, schema)) {
      return { value: JSON.stringify(unwrapped), mode: 'unwrapped', snapshots: 1, reparsed: unwrapped }
    }
    return { value: text.trim(), mode: 'valid', snapshots: 1, reparsed: whole }
  }
  // One or more complete values back to back: the route re-sends whole snapshots
  // instead of fragments. Keep the last one that fits the declared schema.
  const found = []
  let at = 0
  while (at < text.length) {
    while (at < text.length && /\s/.test(text[at])) at += 1
    if (at >= text.length) break
    const scanned = scanJsonValue(text.slice(at))
    if (scanned === null) break
    const parsed = parseValue(scanned.raw)
    if (parsed === null) break
    found.push({ raw: scanned.raw, parsed })
    at += scanned.end
  }
  if (found.length > 1) {
    const candidates = []
    for (const item of found) {
      candidates.push({ raw: item.raw, parsed: item.parsed })
      const unwrapped = unwrapSnapshot(item.parsed)
      if (unwrapped !== null) candidates.push({ raw: JSON.stringify(unwrapped), parsed: unwrapped })
    }
    const fitting = candidates.filter((item) => fitsSchema(item.parsed, schema))
    const pool = fitting.length > 0 ? fitting : candidates
    const last = pool[pool.length - 1]
    const allEqual = candidates.every((item) => canonical(item.parsed) === canonical(last.parsed))
    const mode = candidates.length > found.length ? 'unwrapped' : (allEqual ? 'duplicate' : 'restated')
    return { value: last.raw, mode, snapshots: found.length, reparsed: last.parsed }
  }
  return { value: text, mode: 'invalid', snapshots: found.length, reparsed: null }
}

/**
 * Infer the declared tool a bare JSON object is an argument set for.
 *
 * A match requires every declared `required` key to be present and every present
 * key to be declared in `properties`. The most specific match wins (most keys).
 *
 * @param {unknown} value - parsed JSON object from a text payload.
 * @param {Array<{name: string, parameters?: object}>} tools - declared tools.
 * @returns {string | null} the tool name, or null when nothing matches.
 */
export function inferToolFromArguments(value, tools) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const keys = Object.keys(value)
  if (keys.length === 0) return null
  let best = null
  for (const tool of Array.isArray(tools) ? tools : []) {
    const name = tool?.name
    if (typeof name !== 'string' || name.length === 0) continue
    const parameters = tool?.parameters && typeof tool.parameters === 'object' ? tool.parameters : null
    const properties = parameters?.properties && typeof parameters.properties === 'object' ? parameters.properties : null
    if (!properties) continue
    const required = Array.isArray(parameters.required) ? parameters.required : []
    if (!required.every((key) => Object.hasOwn(value, key))) continue
    if (!keys.every((key) => Object.hasOwn(properties, key))) continue
    if (best === null || keys.length > best.keys) best = { name, keys: keys.length }
  }
  return best?.name ?? null
}
