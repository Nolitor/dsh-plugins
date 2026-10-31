/**
 * Upstream stream classifier: an explicit state machine, one pass, no body surgery.
 *
 * Restored at 0.0.1 (the 0.7.8 machine was deleted in 0.8.0). Two layers, kept
 * separate on purpose:
 *
 *   TOP  (this file)          classify one stream into typed parts:
 *                             text | reasoning | tool-call
 *   BOTTOM (lib/display-gate) split those parts into two destinations:
 *                             the DSH parser channel (tool-call) and the screen
 *                             channel (text / reasoning).
 *
 * A structured call that arrives as a wire field (delta.tool_calls) never visits
 * this file: lib/upstream-map.js types it first. What this file classifies is the
 * notation a route leaves *inside* a text payload — the spec grammar
 * `[tool call <name> #<id>]: <json>`, the XML form `<invoke name="…">…</invoke>`,
 * the DSML form `[tool call <name>">` + `<｜DSML｜ parameter …>`, and the thinking
 * wrappers `<thinking>` / `<analysis>` that must become reasoning, not screen text.
 *
 * Invariants (each is a bug this file exists to prevent):
 *   I1  prose is emitted once, in order, verbatim — only protocol syntax is removed;
 *   I2  in TEXT at most (longest opener - 1) characters are held back;
 *   I3  notation that cannot be parsed is dropped, never printed (display must not
 *       show a marker, and a malformed call must not be executed);
 *   I4  output is invariant under re-chunking: any split of the same input yields
 *       the same parts in the same order (property-tested).
 */

const OPENERS = [
  '<antml:think>', '<think>', '<antml:thinking>', '<thinking>',
  '<analysis>', '<antml:analysis>',
  '[tool call ', '<antml:invoke', '<invoke',
]
const MAX_OPENER = Math.max(...OPENERS.map((opener) => opener.length))

/** Closers erased in place (syntax only, never body prose). */
const STRAY = [
  '</think>', '<think>', '</antml:think>', '<antml:think>',
  '</thinking>', '<thinking>', '</antml:thinking>', '<antml:thinking>',
  '</analysis>', '<analysis>', '</antml:analysis>', '<antml:analysis>',
  '</summary>', '<summary>', '</antml:summary>', '<antml:summary>',
]
const MAX_STRAY = Math.max(...STRAY.map((tag) => tag.length))
const THINKING_CLOSE = /<\/(?:antml:)?think(?:ing)?>/i
const THINKING_OPEN = /<(?:antml:)?think(?:ing)?>/i
const ANALYSIS_OPEN = /<(?:antml:)?analysis>/i
const ANALYSIS_CLOSE = /<\/(?:antml:)?analysis>/i

/**
 * DSML notation (DeepSeek Markup Language) — the model's internal encoding.
 * A public client must not depend on it (see en/innovations/15), but when a route
 * leaks it inside content the display must not show it and the call must still
 * reach the DSH parser. Shapes measured live on 2026-11-01:
 *   [tool call run_code">
 *   <｜DSML｜ parameter name="code" string="true">…</｜DSML｜ parameter>
 *   </｜DSML｜ invoke>
 *   </｜DSML｜ calls>
 */
const DSML_TOKEN = '｜DSML｜'
const DSML_END = /<\/?｜DSML｜\s*(?:invoke|calls|tool_calls)\s*>/
const DSML_PARAM = /<｜DSML｜\s*parameter\s+name="([^"]+)"(?:\s+string="(true|false)")?\s*>([\s\S]*?)<\/｜DSML｜\s*parameter>/g
const DSML_ANY = /<\/?｜DSML｜[^>]*>/g

const STATE_TEXT = 'text'
const STATE_REASONING = 'reasoning'
const STATE_TOOL_HEAD = 'tool-head'
const STATE_TOOL_ARGS = 'tool-args'
const STATE_DSML_ARGS = 'dsml-args'
const STATE_INVOKE_HEAD = 'invoke-head'

/**
 * Create the classifier.
 *
 * @param {object} [options]
 * @param {Iterable<string>|Set<string>} [options.toolNames] - declared tool names.
 *   A body call whose name is not declared is dropped, never executed.
 * @param {number} [options.maxHold] - upper bound on notation held while a shape
 *   is undecided; past it the notation degrades (dropped) instead of printing.
 * @returns {{
 *   push: (delta: string) => object[],
 *   flush: () => object[],
 *   stats: { thinking: number, unterminatedThinking: number, calls: number,
 *            stripped: number, degraded: number, stray: number, dsml: number },
 * }}
 */
export function createStreamClassifier(options = {}) {
  const toolNames = options.toolNames instanceof Set
    ? options.toolNames
    : new Set(options.toolNames ?? [])
  const maxHold = options.maxHold ?? 65536
  const stats = {
    thinking: 0, unterminatedThinking: 0, calls: 0,
    stripped: 0, degraded: 0, stray: 0, dsml: 0,
  }

  let state = STATE_TEXT
  let buf = ''
  let callName = ''
  let callId = ''
  let invokeName = ''
  let closer = null

  const declared = (name) => toolNames.size > 0 && toolNames.has(name)

  /** Remove protocol syntax that must never reach the display channel. */
  function scrub(value) {
    let out = value
    for (const tag of STRAY) {
      const count = out.split(tag).length - 1
      if (count > 0) { stats.stray += count; out = out.split(tag).join('') }
    }
    if (out.includes(DSML_TOKEN)) {
      const count = (out.match(DSML_ANY) ?? []).length
      if (count > 0) { stats.stray += count }
      out = out.replace(DSML_ANY, '')
    }
    return out
  }

  /** Emit prose (I1): only protocol syntax is removed. */
  function text(out, value) {
    const clean = scrub(value)
    if (clean.length > 0) out.push({ kind: 'text', text: clean })
  }

  /** Emit reasoning, minus any thinking wrapper left inside it. */
  function reasoning(out, value) {
    const clean = scrub(value)
    if (clean.length > 0) out.push({ kind: 'reasoning', text: clean })
  }

  function emitCall(out, name, id, args) {
    if (!declared(name)) { stats.stripped += 1; return }
    stats.calls += 1
    out.push({ kind: 'tool-call', id: id ?? '', name, arguments: args })
  }

  /**
   * Earliest opener that starts a line (or the payload).
   *
   * A wrapper only *opens* a block at a line start; the same token written inside
   * a sentence is prose about the token, and scrub() removes it there instead of
   * reclassifying the rest of the message (measured: an assistant explaining the
   * notation must not lose its own text to reasoning).
   */
  function firstOpener(s) {
    let best = -1
    for (const opener of OPENERS) {
      let from = 0
      for (;;) {
        const at = s.indexOf(opener, from)
        if (at < 0) break
        if (at === 0 || s[at - 1] === '\n') {
          if (best < 0 || at < best) best = at
          break
        }
        from = at + 1
      }
    }
    return best
  }

  function openerPrefixLength(s) {
    let size = 0
    const limit = Math.min(MAX_OPENER - 1, s.length)
    for (let n = 1; n <= limit; n++) {
      const tail = s.slice(s.length - n)
      for (const opener of OPENERS) {
        if (opener.length > n && opener.startsWith(tail)) { size = n; break }
      }
    }
    return size
  }

  function strayPrefixLength(s) {
    let size = 0
    const limit = Math.min(MAX_STRAY - 1, s.length)
    for (let n = 1; n <= limit; n++) {
      const tail = s.slice(s.length - n)
      for (const tag of STRAY) {
        if (tag.length > n && tag.startsWith(tail)) { size = n; break }
      }
    }
    // A partial DSML closer at the tail is held too.
    const dsmlTail = '<' + DSML_TOKEN
    for (let n = 1; n <= Math.min(dsmlTail.length + 2, s.length); n++) {
      const tail = s.slice(s.length - n)
      if (dsmlTail.startsWith(tail) || ('</' + DSML_TOKEN).startsWith(tail)) { size = Math.max(size, n); break }
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
      } else if (THINKING_OPEN.test(buf.slice(0, 24))) {
        const m = THINKING_OPEN.exec(buf.slice(0, 24))
        buf = buf.slice(m[0].length)
        closer = null
        state = STATE_REASONING
        stats.thinking += 1
      } else if (ANALYSIS_OPEN.test(buf.slice(0, 24))) {
        const m = ANALYSIS_OPEN.exec(buf.slice(0, 24))
        buf = buf.slice(m[0].length)
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
    const hold = Math.max(openerPrefixLength(buf), strayPrefixLength(buf))
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
    const close = closer === null ? buf.search(THINKING_CLOSE) : buf.toLowerCase().indexOf(closer)
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
    const hold = Math.min(buf.length, MAX_STRAY)
    const cut = Math.max(0, buf.length - hold)
    reasoning(out, buf.slice(0, cut))
    buf = buf.slice(cut)
    return false
  }

  /**
   * TOOL_HEAD: read the head of a body call. Two shapes share the opener:
   *   spec  `[tool call <name> #<id>]: <json>`  — head ends at ']'
   *   DSML  `[tool call <name>">`              — head ends at '">'
   */
  function stepToolHead(out, final) {
    const specClose = buf.indexOf(']')
    const quoteClose = buf.indexOf('">')
    if (specClose >= 0 && (quoteClose < 0 || specClose < quoteClose)) {
      const head = buf.slice(0, specClose).trim()
      callName = (head.split(/\s+/)[0] ?? '').replace(/^"|"$/g, '')
      callId = (head.split(/\s+/)[1] ?? '').replace(/^#/, '')
      buf = buf.slice(specClose + 1)
      state = STATE_TOOL_ARGS
      return true
    }
    if (quoteClose >= 0) {
      callName = buf.slice(0, quoteClose).trim().replace(/^"|"$/g, '')
      callId = ''
      buf = buf.slice(quoteClose + 2)
      state = STATE_DSML_ARGS
      stats.dsml += 1
      return true
    }
    if (final || buf.length > maxHold) {
      // Undecidable notation is dropped, never printed (I3).
      stats.degraded += 1
      buf = ''
      state = STATE_TEXT
      return true
    }
    return false
  }

  /** TOOL_ARGS: read exactly one JSON object, or drop the notation (I3). */
  function stepToolArgs(out, final) {
    const scanned = scanJson(buf)
    if (scanned === null) {
      if (final || buf.length > maxHold) {
        stats.degraded += 1
        buf = ''
        state = STATE_TEXT
        return true
      }
      return false
    }
    const payload = scanned.raw
    let parsed = null
    try { parsed = JSON.parse(payload) } catch { parsed = null }
    if (parsed === null) stats.degraded += 1
    else emitCall(out, callName, callId, payload)
    buf = buf.slice(scanned.length)
    state = STATE_TEXT
    return true
  }

  /** DSML_ARGS: read the parameter block up to its closing tag. */
  function stepDsmlArgs(out, final) {
    const end = buf.indexOf(DSML_END)
    if (end < 0 && DSML_END.test(buf)) {
      // indexOf with a regex is not meaningful; fall back to exec below.
    }
    const m = DSML_END.exec(buf)
    if (!m) {
      if (final || buf.length > maxHold) {
        stats.degraded += 1
        buf = ''
        state = STATE_TEXT
        return false
      }
      return false
    }
    const block = buf.slice(0, m.index)
    const tail = buf.slice(m.index + m[0].length)
    const args = {}
    DSML_PARAM.lastIndex = 0
    for (let p = DSML_PARAM.exec(block); p !== null; p = DSML_PARAM.exec(block)) {
      const [, name, isString, value] = p
      const raw = value.replace(/^\n/, '').replace(/\n$/, '')
      if (isString === 'true') args[name] = raw
      else {
        try { args[name] = JSON.parse(raw) } catch { args[name] = raw }
      }
    }
    if (Object.keys(args).length === 0) stats.degraded += 1
    else emitCall(out, callName, callId, JSON.stringify(args))
    // The closing wrapper of the call block (`</｜DSML｜ calls>`) belongs to the same
    // notation and is consumed here, so it cannot reach the screen as prose.
    buf = tail.replace(/^\s*<\/?｜DSML｜\s*(?:calls|tool_calls)\s*>/, '')
    state = STATE_TEXT
    return true
  }

  /** INVOKE_HEAD: an XML-shaped call block. */
  function stepInvokeHead(out, final) {
    const open = /^<(?:antml:)?invoke\s+name="([^"]+)"\s*>/.exec(buf)
    if (open === null) {
      const tagEnd = buf.indexOf('>')
      const stillOpening =
        buf.startsWith('<') &&
        tagEnd < 0 &&
        (/^<(?:antml:)?invoke\b/i.test(buf) || '<invoke'.startsWith(buf) || '<antml:invoke'.startsWith(buf))
      if (final || buf.length > maxHold || !stillOpening) {
        if (buf.length > 0) stats.degraded += 1
        buf = ''
        state = STATE_TEXT
        return true
      }
      return false
    }
    invokeName = open[1]
    const closerTag = '</invoke>'
    const altCloser = '</antml:invoke>'
    const endA = buf.indexOf(closerTag, open[0].length)
    const endB = buf.indexOf(altCloser, open[0].length)
    const end = endA < 0 ? endB : endB < 0 ? endA : Math.min(endA, endB)
    if (end < 0) {
      if (final || buf.length > maxHold) {
        stats.degraded += 1
        buf = ''
        state = STATE_TEXT
        return true
      }
      return false
    }
    const block = buf.slice(open[0].length, end)
    const tail = buf.slice(end + (end === endB ? altCloser.length : closerTag.length))
    const args = {}
    const re = /<(?:antml:)?parameter\s+name="([^"]+)"\s*>([\s\S]*?)<\/(?:antml:)?parameter>/g
    for (let p = re.exec(block); p !== null; p = re.exec(block)) args[p[1]] = p[2]
    if (Object.keys(args).length === 0) stats.degraded += 1
    else emitCall(out, invokeName, '', JSON.stringify(args))
    buf = tail
    state = STATE_TEXT
    return true
  }

  function step(out, final) {
    if (state === STATE_TEXT) return stepText(out, final)
    if (state === STATE_REASONING) return stepReasoning(out, final)
    if (state === STATE_TOOL_HEAD) return stepToolHead(out, final)
    if (state === STATE_TOOL_ARGS) return stepToolArgs(out, final)
    if (state === STATE_DSML_ARGS) return stepDsmlArgs(out, final)
    return stepInvokeHead(out, final)
  }

  return {
    stats,
    /** Classify one text delta. @returns {object[]} typed parts. */
    push(delta) {
      const out = []
      if (typeof delta === 'string' && delta.length > 0) buf += delta
      while (step(out, false)) {}
      return out
    },
    /** Classify whatever is still held; undecidable notation is dropped. */
    flush() {
      const out = []
      while (step(out, true)) {}
      return out
    },
  }
}
