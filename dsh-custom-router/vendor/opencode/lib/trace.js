/**
 * Opt-in traffic trace for the OpenCode HTTP route.
 *
 * Purpose: a short synthetic probe cannot reproduce the defect. The leak shows up
 * only in long, multi-step turns where the model produces a lot of reasoning and
 * text. Re-running those turns as probes would burn the owner's quota, so the
 * adapter records what real work already produces: per-request shape, per-delta
 * field/length/marker facts, and a bounded excerpt ONLY when a marker appears.
 *
 * Privacy: no prompt text, no message bodies, no credentials are written. A line
 * holds counts, flags, and (on a marker hit) at most MARKER_EXCERPT characters of
 * the offending delta. Disable with OPENCODE_V2_TRACE=0.
 */
import { appendFileSync, statSync } from 'node:fs'

export const DEFAULT_TRACE_PATH = '/tmp/opencode-v2-trace.jsonl'
export const MARKER_EXCERPT = 400
const MAX_BYTES = 8_000_000

/** Marker families seen in live traffic (kept broad on purpose). */
const MARKER = /[<\[]\s*\/?\s*(?:tool[ _-]?call|parameter|invoke|thought|think(?:ing)?|analysis)\b|<\s*\/?\s*[｜│|]{1,2}[^<>]{0,40}[｜│|]{0,2}>/i

/** Whether one text fragment carries protocol notation. */
export function hasMarker(text) {
  return typeof text === 'string' && MARKER.test(text)
}

let sequence = 0

/**
 * Create a trace writer.
 *
 * @param {object} [options]
 * @param {string} [options.path] - target file; env OPENCODE_V2_TRACE overrides.
 * @param {number} [options.maxBytes] - stop appending past this size.
 * @returns {{
 *   enabled: boolean, path: string, rid: string,
 *   request: (fields: object) => void,
 *   delta: (fields: object) => void,
 *   finish: (fields: object) => void,
 *   error: (fields: object) => void,
 *   stats: () => { lines: number, dropped: number },
 * }}
 */
export function createTrace(options = {}) {
  const env = process.env.OPENCODE_V2_TRACE
  const disabled = env === '0' || env === 'off' || env === 'false'
  const path = options.path ?? (env && !disabled ? env : DEFAULT_TRACE_PATH)
  const maxBytes = options.maxBytes ?? MAX_BYTES
  sequence += 1
  const rid = String(process.pid) + '-' + sequence
  let lines = 0
  let dropped = 0

  const write = (kind, fields) => {
    if (disabled) return
    try {
      if (statSync(path).size > maxBytes) { dropped += 1; return }
    } catch {
      /* first write: the file does not exist yet */
    }
    try {
      appendFileSync(path, JSON.stringify({ at: new Date().toISOString(), pid: process.pid, rid, kind, ...fields }) + '\n')
      lines += 1
    } catch {
      dropped += 1
    }
  }

  return {
    enabled: !disabled,
    path,
    rid,
    request: (fields) => write('request', fields),
    delta: (fields) => write('delta', fields),
    finish: (fields) => write('finish', fields),
    error: (fields) => write('error', fields),
    stats: () => ({ lines, dropped }),
  }
}

/**
 * Summarize one mapped part for the trace without copying its body.
 *
 * @param {{kind?: string, text?: string}} part
 * @returns {{field: string, len: number, marker: boolean, excerpt?: string}}
 */
export function summarizePart(part) {
  const text = typeof part?.text === 'string' ? part.text : ''
  const marker = hasMarker(text)
  return {
    field: part?.kind === 'reasoning' ? 'reasoning' : part?.kind === 'tool-call' ? 'tool-call' : 'content',
    len: text.length,
    marker,
    ...(marker ? { excerpt: text.slice(0, MARKER_EXCERPT) } : {}),
  }
}

/** One-line shape of a request body (never the body itself). */
export function summarizeRequest(body) {
  const messages = Array.isArray(body?.messages) ? body.messages : []
  let chars = 0
  for (const message of messages) chars += typeof message?.content === 'string' ? message.content.length : 0
  return {
    model: body?.model ?? '',
    messages: messages.length,
    chars,
    tools: Array.isArray(body?.tools) ? body.tools.length : 0,
    hasSystem: messages.some((message) => message?.role === 'system'),
    stream: body?.stream === true,
    // A route may carry its completion budget in either field; report whichever
    // the builder actually sent so a trace never reads "no budget" for one.
    maxTokens: body?.max_tokens ?? body?.max_completion_tokens ?? null,
    toolChoice: body?.tool_choice ?? null,
    effort: body?.reasoning_effort ?? body?.reasoning ?? null,
  }
}
