/**
 * Display cleaning for already-typed parts (shapes measured 2026-11-01).
 *
 * 0.8.0 types every part from its wire field (lib/upstream-map.js). Nothing
 * here re-types a part. Two pieces of scaffolding the route leaves *inside* an
 * already-typed payload are removed, both structurally:
 *
 *   1. reasoning: the literal tokens '<thinking>' and '</thinking>'. Measured
 *      on 11 real assistant messages: they are never a whole-text wrapper; they
 *      sit at arbitrary offsets inside the reasoning body (offsets 257, 764,
 *      1378, ...). Only those two tokens go; every other character stays.
 *   2. text: a rendered tool call ('[tool call <name> #<id>]: <json>') that
 *      begins a LINE and runs to the end of the part. Measured: it is either
 *      the whole part (offset 0) or follows one line of prose (offset 53). It
 *      is dropped only when a structured tool call in the same response has
 *      the same id, or the same name and equal arguments.
 */

export const THINK_OPEN = '<thinking>'
export const THINK_CLOSE = '</thinking>'
export const ECHO_PREFIX = '[tool call '
const ECHO_RE = /^\[tool call ([A-Za-z0-9_.:$/-]+) #([A-Za-z0-9_-]+)\]:\s*([\s\S]*)$/

/** Remove the two reasoning protocol tokens, wherever they sit. */
export function stripThinkingTags(text) {
  if (typeof text !== 'string') return { text: '', removed: 0 }
  if (text.length === 0) return { text, removed: 0 }
  let out = text
  let removed = 0
  for (const token of [THINK_OPEN, THINK_CLOSE]) {
    const count = out.split(token).length - 1
    if (count > 0) {
      removed += count
      out = out.split(token).join('')
    }
  }
  return { text: out, removed }
}

export function parseToolCallEcho(text) {
  if (typeof text !== 'string') return null
  const t = text.trim()
  if (!t.startsWith(ECHO_PREFIX)) return null
  const m = ECHO_RE.exec(t)
  if (!m) return null
  const args = m[3].trim()
  let value
  try { value = JSON.parse(args) } catch { return null }
  return { name: m[1], id: m[2], args, value }
}
export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return '[' + value.map((i) => stableStringify(i)).join(',') + ']'
  const keys = Object.keys(value).sort()
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + stableStringify(value[k])).join(',') + '}'
}

export function echoMatchesStructuredCall(echo, calls) {
  if (!Array.isArray(calls)) return false
  for (const call of calls) {
    if (!call || typeof call !== 'object') continue
    if (echo.id && call.id && echo.id === call.id) return true
    if (call.name !== echo.name) continue
    let parsed = null
    try { parsed = JSON.parse(typeof call.arguments === 'string' ? call.arguments : '') } catch { continue }
    if (stableStringify(parsed) === stableStringify(echo.value)) return true
  }
  return false
}

/** Drop a trailing rendered tool call that starts a line and runs to the end. */
export function dropEchoTail(text, calls) {
  if (typeof text !== 'string' || text.length === 0) return { text, dropped: 0, echo: null }
  const lines = text.split('\n')
  for (let i = 0; i < lines.length; i += 1) {
    if (!lines[i].startsWith(ECHO_PREFIX)) continue
    const tail = lines.slice(i).join('\n')
    const echo = parseToolCallEcho(tail)
    if (!echo || !echoMatchesStructuredCall(echo, calls)) continue
    const head = lines.slice(0, i).join('\n')
    return { text: head, dropped: tail.length, echo }
  }
  return { text, dropped: 0, echo: null }
}

export function cleanParts(parts) {
  const empty = { parts: [], dropped: 0, unwrapped: 0, droppedChars: 0, removedTokens: 0, droppedText: [] }
  if (!Array.isArray(parts)) return empty
  const calls = parts.filter((p) => p && p.kind === 'tool-call')
  const out = []
  const droppedText = []
  let dropped = 0, unwrapped = 0, droppedChars = 0, removedTokens = 0
  for (const part of parts) {
    if (!part || typeof part !== 'object') continue
    if (part.kind === 'text' && typeof part.text === 'string') {
      const r = dropEchoTail(part.text, calls)
      if (r.dropped > 0) {
        dropped += 1
        droppedChars += r.dropped
        droppedText.push(part.text)
        if (r.text.trim().length > 0) out.push({ ...part, text: r.text })
        continue
      }
      out.push(part)
      continue
    }
    if (part.kind === 'reasoning' && typeof part.text === 'string') {
      const r = stripThinkingTags(part.text)
      if (r.removed > 0) {
        unwrapped += 1
        removedTokens += r.removed
        if (r.text.length > 0) out.push({ ...part, text: r.text })
        continue
      }
    }
    out.push(part)
  }
  return { parts: out, dropped, unwrapped, droppedChars, removedTokens, droppedText }
}


