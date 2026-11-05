/**
 * Developer statistics: a read-only fold of the DSH session event ledger, plus a view of this
 * plugin's own in-memory ledger counters.
 *
 * The shape is a deliberate copy of the structure the harness itself uses in `0.2.2-rc.1`, so a
 * reader who knows `@deepseek-ai/dsh-session-stats` (the `sessionStats` projection) and
 * `@deepseek-ai/dsh-experimental-client-ui-stats` (the per-turn / per-step table) can read this
 * one without a new vocabulary:
 *
 *   - the prompt buckets are DISJOINT: `inputTokens` is uncached input, and the prompt (the
 *     "context" a step sent) is `inputTokens + cacheReadTokens + cacheWriteTokens`
 *     (the same rule as `contextTokens()` in the experimental client plugin);
 *   - `reasoningTokens` is a SUBSET of `outputTokens`, never added to it;
 *   - `decodeMs` / `decodeTokens` are the first-token → assembled-message span and the provider's
 *     output count over the same steps, exactly the two fields of the `sessionStats` projection;
 *   - the counted step event is `step/end` (the step lifecycle authority), so a cancelled or
 *     failed step still lands one row;
 *   - tool wall time pairs `tool/call` → `tool/result` by call id;
 *   - every assistant message's provider/model comes from the request that carried it
 *     (`request/context`, falling back to `request/header.header.config`).
 *
 * Every function here is pure: it reads an array of committed events and returns plain JSON. It
 * never mutates the log, never opens a file, and never calls the harness. The host route and the
 * browser half are thin carriers of this module.
 *
 * @module @nolit/dsh-tokeneconomizer/devstats
 */

/** Turns kept in one detail payload; older turns stay in the ledger and in the totals. */
export const MAX_TURNS = 200

/** Steps kept per turn in one detail payload. */
export const MAX_STEPS_PER_TURN = 200

/** Tool calls kept per step row, matching the experimental stats plugin's call budget. */
export const MAX_CALLS_PER_STEP = 12

/** Upper bound on the character count we report, so one huge output cannot skew a payload. */
const MAX_REPORTED_CHARS = 10_000_000

/**
 * One finite, non-negative number, or null.
 * @param {unknown} value - candidate.
 * @returns {number | null} the safe number.
 */
export function safeNumber(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : null
}

/**
 * Whether a usage bucket was reported.
 * @param {unknown} value - candidate.
 * @returns {boolean} true when it is a finite non-negative number.
 */
function reported(value) {
  return safeNumber(value) !== null
}

/**
 * Read the four disjoint provider usage buckets out of one `assistant/message` usage record.
 *
 * `inputTokens` is uncached input only. `contextTokens` is the prompt the step sent, so it is the
 * sum of the three disjoint prompt buckets. `reasoningTokens` stays separate and is never added
 * to `outputTokens`.
 * @param {object | null | undefined} usage - the usage record.
 * @returns {{inputTokens: number|null, outputTokens: number|null, cacheReadTokens: number|null,
 *   cacheWriteTokens: number|null, reasoningTokens: number|null, contextTokens: number|null}
 *   | null} the buckets, or null when nothing was reported.
 */
export function usageBuckets(usage) {
  if (usage === null || typeof usage !== 'object') return null
  const input = safeNumber(usage.inputTokens)
  const output = safeNumber(usage.outputTokens)
  const cacheRead = safeNumber(usage.cacheReadTokens)
  const cacheWrite = safeNumber(usage.cacheWriteTokens)
  const reasoning = safeNumber(usage.reasoningTokens)
  if (input === null && output === null && cacheRead === null && cacheWrite === null) return null
  const context = (input ?? 0) + (cacheRead ?? 0) + (cacheWrite ?? 0)
  return {
    inputTokens: input,
    outputTokens: output,
    cacheReadTokens: cacheRead,
    cacheWriteTokens: cacheWrite,
    reasoningTokens: reasoning,
    contextTokens: reported(input) || reported(cacheRead) || reported(cacheWrite) ? context : null,
  }
}

/**
 * Cache-read share of the prompt, in [0, 1], or null when it cannot be derived.
 * @param {number | null | undefined} cacheRead - cache-read tokens.
 * @param {number | null | undefined} context - prompt tokens.
 * @returns {number | null} the share.
 */
export function cacheHitOf(cacheRead, context) {
  if (!reported(cacheRead) || !reported(context) || context <= 0) return null
  return Math.min(1, cacheRead / context)
}

/**
 * Concatenate the text blocks of one message or content array.
 * @param {object | string | null | undefined} messageOrContent - a message, a content array, or text.
 * @returns {string} the text.
 */
export function textOf(messageOrContent) {
  if (typeof messageOrContent === 'string') return messageOrContent
  const content = Array.isArray(messageOrContent)
    ? messageOrContent
    : messageOrContent?.content
  if (!Array.isArray(content)) return ''
  let text = ''
  for (const block of content) {
    if (typeof block === 'string') text += block
    else if (typeof block?.text === 'string') text += block.text
  }
  return text
}

/**
 * Time of the first emitted token in one assistant stream, mirroring the harness rule: the first
 * entry carrying a content span (`reasoning-chunks` / `text-chunks` / `tool-call-chunks`) reports
 * its span start as `time0`, and a plain delta `chunk` reports its own time.
 * @param {Array<object> | null | undefined} stream - the `assistant/message` stream entries.
 * @returns {number | null} the first-token wall time, or null before anything was emitted.
 */
export function firstTokenTime(stream) {
  if (!Array.isArray(stream)) return null
  for (const entry of stream) {
    if (entry === null || typeof entry !== 'object') continue
    const type = typeof entry.type === 'string' ? entry.type : ''
    const time = safeNumber(entry.time0) ?? safeNumber(entry.time)
    if (time === null) continue
    // Only a content span emits tokens; a plain chunk here is a block boundary or a usage
    // record, which the harness also stamps with a time but no token.
    if (type.endsWith('-chunks')) return time
  }
  return null
}

/**
 * Whether one tool result reported an error.
 * @param {object | null | undefined} message - the tool message.
 * @returns {boolean} true when the harness marked it failed.
 */
export function isErrorResult(message) {
  return message?.isError === true
}

/**
 * Turn key of a `(turn, step)` pair.
 * @param {unknown} turn - turn number.
 * @param {unknown} step - step number.
 * @returns {string} the key.
 */
function stepKey(turn, step) {
  return `${String(turn)}:${String(step)}`
}

/**
 * Create the accumulator for one step.
 * @param {number} turn - turn number.
 * @param {number} step - step number.
 * @param {number | null} startTime - step start wall time.
 * @returns {object} the step state.
 */
function newStep(turn, step, startTime) {
  return {
    turn,
    step,
    startTime,
    endTime: null,
    firstTokenTime: null,
    messageTime: null,
    buckets: null,
    messages: 0,
    calls: [],
    callsOpen: 0,
    provider: null,
    model: null,
    contextWindow: null,
  }
}

/**
 * Aggregate the completed step states of one turn.
 * @param {object} turn - the turn accumulator.
 * @returns {object} the turn row.
 */
function turnRow(turn) {
  const steps = turn.steps.map(stepRow)
  const totals = {
    contextCumulative: 0,
    contextLatest: null,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    modelMs: 0,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
    toolMs: 0,
    toolCalls: 0,
    toolErrorCount: 0,
    toolResultChars: 0,
    runningSteps: 0,
    abortedSteps: 0,
  }
  for (const row of steps) {
    totals.contextCumulative += row.contextTokens ?? 0
    if (row.contextTokens !== null) totals.contextLatest = row.contextTokens
    totals.inputTokens += row.inputTokens ?? 0
    totals.cacheReadTokens += row.cacheReadTokens ?? 0
    totals.cacheWriteTokens += row.cacheWriteTokens ?? 0
    totals.outputTokens += row.outputTokens ?? 0
    totals.reasoningTokens += row.reasoningTokens ?? 0
    totals.modelMs += row.modelMs ?? 0
    totals.toolMs += row.toolMs
    totals.toolCalls += row.toolCalls
    totals.toolErrorCount += row.toolErrorCount
    totals.toolResultChars += row.toolResultChars
    if (row.ttftMs !== null) {
      totals.ttftMs += row.ttftMs
      totals.ttftSteps += 1
    }
    if (row.decodeMs !== null && row.outputTokens !== null) {
      totals.decodeMs += row.decodeMs
      totals.decodeTokens += row.outputTokens ?? 0
    }
    if (row.running) totals.runningSteps += 1
    if (row.aborted) totals.abortedSteps += 1
  }
  const endTime = turn.endTime
  // A turn whose `turn/end` did not land (the window started mid-turn, or the session is still
  // running) still reports a measured wall time: the last observed event is the bound, and
  // `running` stays true so the surface can say the boundary is unknown.
  const observedEnd = endTime ?? turn.observedEnd ?? null
  const wallMs = turn.startTime !== null && observedEnd !== null
    ? Math.max(0, observedEnd - turn.startTime)
    : null
  return {
    turn: turn.turn,
    startTime: turn.startTime,
    endTime,
    wallMs,
    running: endTime === null,
    steps,
    ...totals,
    cacheHit: cacheHitOf(totals.cacheReadTokens, totals.contextCumulative),
    routes: turn.routes,
  }
}

/**
 * Derive the row of one step.
 * @param {object} step - the step accumulator.
 * @returns {object} the row.
 */
function stepRow(step) {
  const buckets = step.buckets
  const modelMs = step.startTime !== null && step.messageTime !== null
    ? Math.max(0, step.messageTime - step.startTime)
    : null
  const ttftMs = step.startTime !== null && step.firstTokenTime !== null
    ? Math.max(0, step.firstTokenTime - step.startTime)
    : null
  const decodeMs = step.firstTokenTime !== null && step.messageTime !== null
    && buckets?.outputTokens !== null
    ? Math.max(0, step.messageTime - step.firstTokenTime)
    : null
  const toolMs = step.calls.reduce((sum, call) => sum + (call.ms ?? 0), 0)
  const toolResultChars = step.calls.reduce((sum, call) => sum + (call.resultChars ?? 0), 0)
  const toolErrorCount = step.calls.filter((call) => call.error).length
  const wallMs = step.startTime !== null && step.endTime !== null
    ? Math.max(0, step.endTime - step.startTime)
    : null
  return {
    turn: step.turn,
    step: step.step,
    startTime: step.startTime,
    endTime: step.endTime,
    wallMs,
    modelMs,
    ttftMs,
    decodeMs,
    contextTokens: buckets?.contextTokens ?? null,
    inputTokens: buckets?.inputTokens ?? null,
    cacheReadTokens: buckets?.cacheReadTokens ?? null,
    cacheWriteTokens: buckets?.cacheWriteTokens ?? null,
    outputTokens: buckets?.outputTokens ?? null,
    reasoningTokens: buckets?.reasoningTokens ?? null,
    cacheHit: cacheHitOf(buckets?.cacheReadTokens ?? null, buckets?.contextTokens ?? null),
    provider: step.provider,
    model: step.model,
    contextWindow: step.contextWindow,
    toolCalls: step.calls.length + step.callsOpen,
    toolMs,
    toolErrorCount,
    toolResultChars,
    calls: step.calls.slice(0, MAX_CALLS_PER_STEP),
    callsTruncated: step.calls.length > MAX_CALLS_PER_STEP,
    messages: step.messages,
    running: step.endTime === null,
    aborted: step.buckets === null,
  }
}

/**
 * Fold the committed session events into per-turn and per-step developer statistics.
 *
 * Total figures are computed over the whole log; the returned turn/step rows keep only the newest
 * `maxTurns` turns and `maxStepsPerTurn` steps per turn, and report `truncated` when they did.
 * @param {Array<{type?: string, time?: number, data?: object}>} events - committed session events.
 * @param {{ maxTurns?: number, maxStepsPerTurn?: number }} [options] - row budgets.
 * @returns {{
 *   turns: object[],
 *   totals: object,
 *   truncated: boolean,
 *   observed: {firstTime: number|null, lastTime: number|null},
 * }} the derived statistics.
 */
export function deriveSessionDevStats(events, options = {}) {
  const maxTurns = Number.isInteger(options.maxTurns) && options.maxTurns > 0 ? options.maxTurns : MAX_TURNS
  const maxSteps = Number.isInteger(options.maxStepsPerTurn) && options.maxStepsPerTurn > 0
    ? options.maxStepsPerTurn
    : MAX_STEPS_PER_TURN
  const turns = []
  const stepsByKey = new Map()
  const pending = new Map()
  const routes = []
  const routeSeen = new Set()
  let route = { provider: null, model: null, contextWindow: null }
  let turn = null
  let step = null
  let firstTime = null
  let lastTime = null

  const ensureTurn = (number) => {
    const wanted = Number.isInteger(number) ? number : null
    if (turn !== null && (wanted === null || turn.turn === wanted)) return turn
    const next = {
      turn: wanted ?? (turns.length > 0 ? turns[turns.length - 1].turn + 1 : 1),
      startTime: null,
      endTime: null,
      steps: [],
      routes: [],
    }
    turns.push(next)
    return next
  }

  const noteRoute = (provider, model, contextWindow) => {
    route = {
      provider: typeof provider === 'string' && provider ? provider : route.provider,
      model: typeof model === 'string' && model ? model : route.model,
      contextWindow: safeNumber(contextWindow) ?? route.contextWindow,
    }
    const key = `${route.provider ?? ''}\u0000${route.model ?? ''}`
    if ((route.provider || route.model) && !routeSeen.has(key)) {
      routeSeen.add(key)
      routes.push({ provider: route.provider, model: route.model })
    }
  }

  for (const event of Array.isArray(events) ? events : []) {
    if (event === null || typeof event !== 'object') continue
    const type = typeof event.type === 'string' ? event.type : ''
    const time = safeNumber(event.time)
    const data = event.data !== null && typeof event.data === 'object' ? event.data : {}
    if (time !== null) {
      if (firstTime === null) firstTime = time
      lastTime = time
    }
    switch (type) {
      case 'request/context': {
        noteRoute(data.provider, data.model, data.contextWindow)
        if (step !== null) {
          step.provider = route.provider
          step.model = route.model
          step.contextWindow = route.contextWindow
        }
        if (turn !== null && (route.provider || route.model)) {
          const key = `${route.provider ?? ''}\u0000${route.model ?? ''}`
          if (!turn.routes.some((entry) => `${entry.provider ?? ''}\u0000${entry.model ?? ''}` === key)) {
            turn.routes.push({ provider: route.provider, model: route.model })
          }
        }
        break
      }
      case 'request/header': {
        const config = data.header?.config ?? {}
        noteRoute(config.provider, config.model, data.contextWindow)
        break
      }
      case 'turn/start': {
        const next = ensureTurn(data.turn)
        next.startTime = time
        turn = next
        step = null
        break
      }
      case 'step/start': {
        const owner = ensureTurn(data.turn)
        if (owner.startTime === null) owner.startTime = time
        step = newStep(Number.isInteger(data.turn) ? data.turn : owner.turn, Number.isInteger(data.step) ? data.step : owner.steps.length + 1, time)
        step.provider = route.provider
        step.model = route.model
        step.contextWindow = route.contextWindow
        owner.steps.push(step)
        stepsByKey.set(stepKey(step.turn, step.step), step)
        break
      }
      case 'tool/call': {
        const callId = String(data.callId ?? '')
        if (!callId) break
        pending.set(callId, {
          callId,
          name: typeof data.name === 'string' ? data.name : null,
          startedAt: time,
          turn: data.turn,
          step: data.step,
        })
        break
      }
      case 'tool/result': {
        const message = data.message ?? {}
        const callId = String(message.source?.callId ?? message.toolCallId ?? data.callId ?? '')
        const dispatched = pending.get(callId)
        if (callId) pending.delete(callId)
        const owner = stepsByKey.get(stepKey(dispatched?.turn ?? data.turn, dispatched?.step ?? data.step))
        if (owner === undefined) break
        if (dispatched === undefined) {
          owner.callsOpen += 1
          break
        }
        owner.calls.push({
          name: dispatched.name,
          callId,
          startedAt: dispatched.startedAt,
          endedAt: time,
          ms: time !== null && dispatched.startedAt !== null
            ? Math.max(0, time - dispatched.startedAt)
            : null,
          resultChars: Math.min(MAX_REPORTED_CHARS, textOf(message).length),
          error: isErrorResult(message),
        })
        break
      }
      case 'assistant/message': {
        const owner = stepsByKey.get(stepKey(data.turn, data.step))
          ?? (step !== null && step.turn === data.turn && step.step === data.step ? step : null)
        if (owner === null || owner === undefined) break
        owner.messages += 1
        owner.messageTime = time
        const token = firstTokenTime(data.stream)
        if (owner.firstTokenTime === null && token !== null) owner.firstTokenTime = token
        const buckets = usageBuckets(data.usage)
        if (buckets !== null) owner.buckets = buckets
        // The model route is carried by the request events, and the assembled message repeats it
        // on its source (`{kind:'model', provider, model}`) — measured in a real rc.1 log. Read
        // both, so a log window that starts after the request still names the route.
        const source = data.message?.source ?? {}
        const provider = data.provider ?? source.provider
        const model = data.model ?? source.model
        if (provider !== undefined || model !== undefined) {
          noteRoute(provider, model)
          if (owner.provider === null && typeof provider === 'string' && provider) owner.provider = provider
          if (owner.model === null && typeof model === 'string' && model) owner.model = model
        }
        if (owner.provider === null && route.provider !== null) owner.provider = route.provider
        if (owner.model === null && route.model !== null) owner.model = route.model
        break
      }
      case 'step/end': {
        const owner = stepsByKey.get(stepKey(data.turn, data.step))
        if (owner !== undefined && owner.endTime === null) owner.endTime = time
        if (step !== null && step !== owner) step = null
        break
      }
      case 'turn/end': {
        const owner = turn !== null && (data.turn === undefined || turn.turn === data.turn)
          ? turn
          : turns.find((entry) => entry.turn === data.turn)
        if (owner !== undefined && owner.endTime === null) owner.endTime = time
        break
      }
      default:
        break
    }
  }

  // A window that lost its end boundary still gets a wall time: the last observed event is the
  // best measured bound, and `running` stays true so the surface can say so.
  for (const entry of turns) {
    if (entry.startTime === null) entry.startTime = firstTime
    entry.observedEnd = entry.endTime ?? lastTime
  }

  const allTurns = turns.map(turnRow)
  const totals = {
    turns: allTurns.length,
    steps: allTurns.reduce((sum, row) => sum + row.steps.length, 0),
    wallMs: firstTime !== null && lastTime !== null ? Math.max(0, lastTime - firstTime) : null,
    contextCumulative: 0,
    inputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    outputTokens: 0,
    reasoningTokens: 0,
    modelMs: 0,
    toolMs: 0,
    ttftMs: 0,
    ttftSteps: 0,
    decodeMs: 0,
    decodeTokens: 0,
    toolCalls: 0,
    toolErrorCount: 0,
    toolResultChars: 0,
    runningSteps: 0,
    abortedSteps: 0,
    routes,
  }
  for (const row of allTurns) {
    totals.contextCumulative += row.contextCumulative
    totals.inputTokens += row.inputTokens
    totals.cacheReadTokens += row.cacheReadTokens
    totals.cacheWriteTokens += row.cacheWriteTokens
    totals.outputTokens += row.outputTokens
    totals.reasoningTokens += row.reasoningTokens
    totals.modelMs += row.modelMs
    totals.toolMs += row.toolMs
    totals.ttftMs += row.ttftMs
    totals.ttftSteps += row.ttftSteps
    totals.decodeMs += row.decodeMs
    totals.decodeTokens += row.decodeTokens
    totals.toolCalls += row.toolCalls
    totals.toolErrorCount += row.toolErrorCount
    totals.toolResultChars += row.toolResultChars
    totals.runningSteps += row.runningSteps
    totals.abortedSteps += row.abortedSteps
  }
  totals.cacheHit = cacheHitOf(totals.cacheReadTokens, totals.contextCumulative)

  let kept = allTurns
  if (allTurns.length > maxTurns) kept = allTurns.slice(allTurns.length - maxTurns)
  let truncated = kept.length !== allTurns.length
  const rows = kept.map((row) => {
    if (row.steps.length <= maxSteps) return row
    truncated = true
    return { ...row, steps: row.steps.slice(row.steps.length - maxSteps) }
  })
  return {
    turns: rows,
    totals,
    truncated,
    observed: { firstTime, lastTime },
  }
}

/**
 * Read this plugin's own ledger counters from one live session state.
 *
 * Only counts and configuration flags leave the host: no prompt text, no tool arguments, no tool
 * output. Every field is the in-memory truth for this process; the durable engine ledger under
 * the state root is a different artifact and is not read here.
 * @param {object} state - the plugin's per-agent state.
 * @returns {object} the read-only ledger view.
 */
export function ledgerOf(state) {
  const stats = state?.stats !== null && typeof state?.stats === 'object' ? state.stats : {}
  return {
    mode: typeof stats.mode === 'string' ? stats.mode : null,
    startedAt: safeNumber(stats.startedAt),
    updatedAt: safeNumber(stats.updatedAt),
    turns: safeNumber(state?.turn) ?? 0,
    assistantMessages: safeNumber(state?.requests) ?? 0,
    closed: state?.closed === true,
    dedup: {
      hits: safeNumber(stats.dedupHits) ?? 0,
      savedChars: safeNumber(stats.dedupSavedChars) ?? 0,
      entries: safeNumber(state?.dedup?.size) ?? 0,
    },
    tiering: {
      replacements: safeNumber(state?.tiered) ?? 0,
      shadowedTokens: safeNumber(stats.tierShadowTokens) ?? 0,
    },
    loopBreaker: {
      trips: safeNumber(stats.breakerTrips) ?? 0,
    },
    watchdog: {
      warnings: safeNumber(stats.watchdogWarns) ?? 0,
      interrupts: safeNumber(stats.watchdogInterrupts) ?? 0,
    },
    toolCalls: safeNumber(stats.toolCalls) ?? 0,
    toolErrors: safeNumber(stats.toolErrors) ?? 0,
    notices: safeNumber(stats.notices) ?? 0,
    recall: {
      done: state?.recallDone === true,
    },
    pinned: stats.pinned === true,
    thinkInCode: stats.thinkInCode === true,
  }
}
