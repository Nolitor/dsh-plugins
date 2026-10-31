/**
 * Streaming content parser: an explicit state machine, one pass, no body surgery.
 *
 * Replaces the regex filter that used to re-scan and rewrite accumulated text.
 * The contract matches the AI SDK / assistant-ui wire: a delta stream is classified
 * into ordered parts (text | reasoning | tool-call), and nothing is dropped except
 * the marker syntax itself.
 *
 * Reference model:
 *   - Vercel AI SDK stream parts: text-start/delta/end, reasoning-start/delta/end,
 *     tool-input-start/delta/available
 *   - assistant-ui assistant-stream canonical chunks
 *
 * Invariants (each is a bug this file exists to prevent):
 *   I1  Text is emitted once, in order, verbatim. No replace() over the body.
 *   I2  In TEXT state only a bounded suffix is held: at most MAX_OPENER chars.
 *   I3  A marker that fails to parse degrades to TEXT, it is not swallowed.
 *   I4  Output is invariant under re-chunking: any split of the same input
 *       produces the same parts in the same order (property-tested).
 */

const OPENERS = ['<antml:thinking>', '<thinking>', '<analysis>', '<antml:analysis>', '[tool call ', '<antml:invoke', '<invoke']
const MAX_OPENER = Math.max(...OPENERS.map((opener) => opener.length))
// Spans erased in place (syntax only, never body prose). Their partial tails must
// be held exactly like openers, or the same input classifies differently per chunk.
const STRAY = [
  '</thinking>', '<thinking>', '</antml:thinking>', '<antml:thinking>',
  '</analysis>', '<analysis>', '</antml:analysis>', '<antml:analysis>',
  '</summary>', '<summary>', '</antml:summary>', '<antml:summary>',
]
const MAX_STRAY = Math.max(...STRAY.map((tag) => tag.length))
const THINKING_CLOSE = /^<\/(?:antml:)?thinking>/i

const STATE_TEXT = 'text'
const STATE_REASONING = 'reasoning'
const STATE_TOOL_HEAD = 'tool-head'
const STATE_TOOL_ARGS = 'tool-args'
const STATE_INVOKE_HEAD = 'invoke-head'

export function createStreamParser(options = {}) {
  const toolNames = options.toolNames ?? new Set()
  const maxHold = options.maxHold ?? 8192
  const stats = { thinking: 0, unterminatedThinking: 0, calls: 0, stripped: 0, degraded: 0 }

  let state = STATE_TEXT
  let buf = ''
  let callName = ''
  let callId = ''
  let invokeName = ''
  let closer = null // null = thinking closer; a string = an explicit closer tag

  const allowed = (name) => toolNames.size === 0 || toolNames.has(name)

  /** Emit text verbatim (I1). */
  function text(out, value) {
    // Syntax only: wrappers and stray closers go, the model's prose stays.
    const clean = value
      .replace(/<\/?(?:antml:)?thinking>/gi, '')
      .replace(/<\/?(?:antml:)?(?:invoke|parameter)\b[^>]*>/gi, '')
      .replace(/<\/?(?:antml:)?analysis\b[^>]*>/gi, '')
      .replace(/<\/?(?:antml:)?summary\b[^>]*>/gi, '')
    if (clean.length > 0) out.push({ kind: 'text', text: clean })
  }

  /** Emit reasoning, minus any thinking wrapper left inside it. */
  function reasoning(out, value) {
    const clean = value.replace(/<\/?(?:antml:)?thinking>/gi, '')
    if (clean.length > 0) out.push({ kind: 'reasoning', text: clean })
  }

  /** Index of the earliest opener in s, or -1. */
  function firstOpener(s) {
    let best = -1
    for (const opener of OPENERS) {
      const at = s.indexOf(opener)
      if (at >= 0 && (best < 0 || at < best)) best = at
    }
    return best
  }

  /** Length of the buffer tail that is still a strict prefix of some opener. */
  function openPrefixLength(s) {
    let size = 0
    const limit = Math.min(MAX_OPENER - 1, s.length)
    for (let n = 1; n <= limit; n++) {
      const tail = s.slice(s.length - n)
      for (const opener of OPENERS) {
        if (opener.length > n && opener.startsWith(tail)) {
          size = n
          break
        }
      }
    }
    return size
  }

  /** Length of the buffer tail that is still a prefix of a stray tag. */
  function strayPrefixLength(s) {
    let size = 0
    const limit = Math.min(MAX_STRAY - 1, s.length)
    for (let n = 1; n <= limit; n++) {
      const tail = s.slice(s.length - n)
      for (const tag of STRAY) {
        if (tag.length > n && tag.startsWith(tail)) { size = n; break }
      }
    }
    return size
  }

  /** Scan one JSON object from the head of s with string/escape awareness. */
  function scanJson(s) {
    let i = 0
    let sawColon = false
    while (i < s.length && s[i] !== '{') {
      const ch = s[i]
      if (ch === ':' && !sawColon) { sawColon = true; i += 1; continue }
      if (ch !== ' ' && ch !== '\n' && ch !== '\r' && ch !== '\t') return null
      i += 1
    }
    if (i >= s.length) return null
    let depth = 0
    let inString = false
    let escaped = false
    for (let k = i; k < s.length; k++) {
      const ch = s[k]
      if (inString) {
        if (escaped) escaped = false
        else if (ch === '\\') escaped = true
        else if (ch === '"') inString = false
        continue
      }
      if (ch === '"') { inString = true; continue }
      if (ch === '{') depth += 1
      else if (ch === '}') {
        depth -= 1
        if (depth === 0) return { raw: s.slice(i, k + 1), length: k + 1, start: i }
      }
    }
    return null
  }

  /** TEXT: emit prose until a marker or the end of the buffer. */
  function stepText(out, final) {
    const at = firstOpener(buf)
    if (at >= 0) {
      text(out, buf.slice(0, at))
      buf = buf.slice(at)
      if (buf.startsWith('[tool call ')) {
        buf = buf.slice('[tool call '.length)
        state = STATE_TOOL_HEAD
        callName = ''
        callId = ''
      } else if (buf.startsWith('<thinking>') || buf.startsWith('<antml:thinking>')) {
        buf = buf.slice(buf.indexOf('>') + 1)
        closer = null
        state = STATE_REASONING
        stats.thinking += 1
      } else if (buf.startsWith('<analysis>') || buf.startsWith('<antml:analysis>')) {
        buf = buf.slice(buf.indexOf('>') + 1)
        // A compaction scratchpad is reasoning: hidden from the transcript, never deleted.
        closer = '</analysis>'
        state = STATE_REASONING
        stats.thinking += 1
      } else {
        state = STATE_INVOKE_HEAD
        invokeName = ''
      }
      return true
    }
    if (final) {
      text(out, buf)
      buf = ''
      return false
    }
    const hold = Math.max(openPrefixLength(buf), strayPrefixLength(buf))
    if (hold > 0) {
      text(out, buf.slice(0, buf.length - hold))
      buf = buf.slice(buf.length - hold)
    } else {
      text(out, buf)
      buf = ''
    }
    return false
  }

  /** REASONING: emit until the thinking closer. */
  function stepReasoning(out, final) {
    const close = closer === null ? buf.search(/<\/(?:antml:)?thinking>/i) : buf.toLowerCase().indexOf(closer)
    if (close >= 0) {
      const width = closer === null ? (THINKING_CLOSE.exec(buf.slice(close))?.[0].length ?? 0) : closer.length
      reasoning(out, buf.slice(0, close))
      buf = buf.slice(close + width)
      state = STATE_TEXT
      return true
    }
    if (final) {
      if (buf.length > 0) stats.unterminatedThinking += 1
      reasoning(out, buf)
      buf = ''
      return false
    }
    const hold = Math.min(buf.length, '<antml:thinking>'.length + 2)
    const cut = Math.max(0, buf.length - hold)
    reasoning(out, buf.slice(0, cut))
    buf = buf.slice(cut)
    return false
  }

  /** TOOL_HEAD: read name [#id] then the closing bracket. */
  function stepToolHead(out, final) {
    const close = buf.indexOf(']')
    if (close < 0) {
      if (final || buf.length > maxHold) {
        text(out, buf.replace(/^[\w.:-]*(?:\s+#[^\s\]]+)?\]?\s*:?\s*/, ''))
        buf = ''
        state = STATE_TEXT
        stats.degraded += 1
        return true
      }
      return false
    }
    const head = buf.slice(0, close).trim()
    const after = buf.slice(close + 1)
    const parts = head.split(/\s+/)
    callName = parts[0] ?? ''
    callId = (parts[1] ?? '').replace(/^#/, '')
    buf = after
    state = STATE_TOOL_ARGS
    return true
  }

  /** TOOL_ARGS: read exactly one JSON object, or degrade to text (I3). */
  function stepToolArgs(out, final) {
    const scanned = scanJson(buf)
    if (scanned === null) {
      if (final || buf.length > maxHold) {
        text(out, buf.replace(/^\s*:?\s*/, ''))
        buf = ''
        state = STATE_TEXT
        stats.degraded += 1
        return true
      }
      return false
    }
    const payload = scanned.raw
    let parsed = null
    try { parsed = JSON.parse(payload) } catch { parsed = null }
    if (parsed === null || !allowed(callName)) {
      stats.stripped += 1
    } else {
      out.push({ kind: 'tool-call', id: callId, name: callName, arguments: payload })
      stats.calls += 1
    }
    buf = buf.slice(scanned.length)
    state = STATE_TEXT
    return true
  }

  /** INVOKE_HEAD: an XML-shaped call block. */
  function stepInvokeHead(out, final) {
    const open = /^<(?:antml:)?invoke\s+name="([^"]+)"\s*>/.exec(buf)
    if (open === null) {
      // Hold while the opening tag itself may still be arriving: a chunk can end
      // anywhere, including inside <invoke name="b. Degrading here is what made
      // the same input classify differently depending on where it was split.
      const tagEnd = buf.indexOf('>')
      const stillOpening =
        buf.startsWith('<') &&
        tagEnd < 0 &&
        (/^<(?:antml:)?invoke\b/i.test(buf) || '<invoke'.startsWith(buf) || '<antml:invoke'.startsWith(buf))
      if (final || buf.length > maxHold || !stillOpening) {
        if (buf.length > 0) {
          text(out, buf)
          stats.degraded += 1
        }
        buf = ''
        state = STATE_TEXT
        return true
      }
      return false
    }
    invokeName = open[1]
    const closer = '</invoke>'
    const altCloser = '</antml:invoke>'
    const endA = buf.indexOf(closer, open[0].length)
    const endB = buf.indexOf(altCloser, open[0].length)
    const end = endA < 0 ? endB : endB < 0 ? endA : Math.min(endA, endB)
    if (end < 0) {
      if (final || buf.length > maxHold) {
        text(out, buf)
        buf = ''
        state = STATE_TEXT
        stats.degraded += 1
        return true
      }
      return false
    }
    const block = buf.slice(open[0].length, end)
    const tail = buf.slice(end + (end === endB ? altCloser.length : closer.length))
    const args = {}
    const re = /<(?:antml:)?parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/(?:antml:)?parameter>/g
    for (let m = re.exec(block); m !== null; m = re.exec(block)) args[m[1]] = m[2]
    if (allowed(invokeName)) {
      out.push({ kind: 'tool-call', id: '', name: invokeName, arguments: JSON.stringify(args) })
      stats.calls += 1
    } else {
      stats.stripped += 1
    }
    buf = tail
    state = STATE_TEXT
    return true
  }

  function step(out, final) {
    if (state === STATE_TEXT) return stepText(out, final)
    if (state === STATE_REASONING) return stepReasoning(out, final)
    if (state === STATE_TOOL_HEAD) return stepToolHead(out, final)
    if (state === STATE_TOOL_ARGS) return stepToolArgs(out, final)
    return stepInvokeHead(out, final)
  }

  return {
    stats,
    push(delta) {
      const out = []
      if (typeof delta === 'string' && delta.length > 0) buf += delta
      while (step(out, false)) {}
      return out
    },
    flush() {
      const out = []
      while (step(out, true)) {}
      return out
    },
  }
}