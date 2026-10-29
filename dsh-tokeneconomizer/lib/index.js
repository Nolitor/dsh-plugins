/**
 * TokenEconomizer for the DeepSeek Harness.
 *
 * The economical behaviour lives in the `tokeneconomizer` Python engine (stdlib only). This
 * plugin is the DSH side of that engine, not a second implementation of it: it translates DSH's
 * agent lifecycle into the hook contract the engine's dispatcher already speaks, and applies the
 * answers with DSH's own levers.
 *
 *   agent/created (startup|resume|clear|compact)
 *       -> SessionStart      learned micro-skills (a scoped system-prompt context), the
 *                            evidence-based tool mask (a scoped in-memory restriction), and the
 *                            notices the engine returns for this start
 *   turn/start
 *       -> UserPromptSubmit  opens one prompt-turn for the loop guard
 *   tools/result
 *       -> PostToolUse       folds the call; a redirect is injected for the next step, a
 *                            still-stuck notice is reported out of band
 *   turn/end
 *       -> Stop              closes the turn; an ended-green turn feeds the repository envelope
 *   agent/disposed
 *       -> SessionEnd        writes the decompressed session export, then hands the session to
 *                            a detached `te fold`
 *
 * The one place this plugin diverges from the engine's other hosts: DSH has no per-repository
 * tool settings file, so the deny list is applied as `ctx.tools.restrict({ deny })` on the
 * agent's own scope. It is derived from the same evidence, lifted when this plugin unloads, and
 * never written into a source configuration.
 *
 * Three features are host-local instead of engine-backed, because they need no evidence and no
 * model call: they run in memory, in this process, with `node:crypto` and timers only.
 *
 *   tools/post-execute  -> ToolResultDedup     a repeated tool output is replaced, in the
 *                                              model-visible copy only, by a pointer to the step
 *                                              that produced it
 *   systemPrompt.section -> KVSafePrefixSlot   the pinned rules live inside the request's first
 *                                              message, and the committed system node is checked
 *                                              for a mid-session change
 *   tools/post-execute  -> LoopWatchdog        consecutive identical failures interrupt the turn,
 *                                              and a step without progress trips a timer
 *
 * Every registration is an effect on the agent's own scope, so disposal reverts it. Every engine
 * call fails open: `{}` changes nothing, and a session keeps working without the engine.
 */
import { randomUUID } from 'node:crypto'
import { join } from 'node:path'


import {
  brief,
  contentText,
  ensureExportDir,
  exitCodeOf,
  hook,
  isInert,
  launchers,
  stateRoot,
  toolResponse,
  writeExport,
} from './bridge.js'
import { createDedupStore, SHORT_HASH_CHARS } from './dedup.js'
import { createPrefixGuard, pinnedSection } from './prefix.js'
import { createLoopBreaker, createWatchdog } from './watchdog.js'

/** Cordis plugin name; must equal package.json `name` and the cordis.patch.yml row id. */
export const name = 'dsh-tokeneconomizer'

/** Services this plugin needs: the tool registry and the prompt registry. */
export const inject = ['tools', 'systemPrompt']

/**
 * Deployment-varying settings, with their defaults. The loader passes a bundle row's `config`
 * through unchanged; this plugin validates it itself, so the module needs nothing from the
 * harness but a Context and a child process. An invalid value fails the row loudly at load
 * instead of silently falling back.
 */
export const DEFAULTS = Object.freeze({
  /** Supervisor command line (`te`). Empty = `<state root>/bin/te`. */
  tePath: '',
  /** Hook command line (`te-hook`). Empty = `<state root>/bin/te-hook`. */
  hookPath: '',
  /** TokenEconomizer state root. Empty = `$TOKENECONOMIZER_HOME` or `~/.tokeneconomizer`. */
  stateHome: '',
  /** Inject the learned facts into the session's prompt context. */
  microskills: true,
  /** Leave out the tools the engine's evidence proposes. */
  toolprune: true,
  /** Fold tool results into the loop guard and deliver its redirects. */
  loopguard: true,
  /** Bound on one lifecycle hook; a tool call waits at most this long on a decision. */
  hookTimeoutMs: 8000,
  /** Bound on one operator call (session brief, status). */
  cliTimeoutMs: 20000,
  /** `auto` reads `dsh headless …` from argv, `always`/`never` pin it. */
  headless: 'auto',
  /** Replace a repeated tool output with a pointer to the step that produced it. */
  dedup: true,
  /** Shortest output worth replacing with a pointer. */
  dedupMinChars: 200,
  /** Maximum number of remembered output digests per session. */
  dedupMaxEntries: 512,
  /** Immutable instruction lines mounted in the system prompt's first message. */
  pinnedRules: '',
  /** Section order of the pinned rules inside the system prompt. */
  pinnedRulesOrder: 50,
  /** Interrupt a turn whose identical command keeps failing. */
  loopBreaker: true,
  /** Consecutive identical failures that trip the breaker. */
  loopBreakerThreshold: 3,
  /** Number of remembered calls. */
  loopBreakerWindow: 5,
  /** Interrupt a step that commits no progress within this budget. */
  watchdog: true,
  /** Progress-free budget of one step. */
  watchdogThresholdMs: 180000,
  /** What the watchdog does when the budget is exhausted. */
  watchdogAction: 'interrupt',
  /** Whether assistant stream frames count as progress. */
  watchdogProgress: 'any',
})

/** Names a config object may carry; anything else is a typo, not a setting. */
const CONFIG_KEYS = new Set(Object.keys(DEFAULTS))

/** Settings whose value is one of a fixed set. */
const ENUM_SETTINGS = Object.freeze({
  headless: Object.freeze(['auto', 'always', 'never']),
  watchdogAction: Object.freeze(['warn', 'interrupt']),
  watchdogProgress: Object.freeze(['any', 'committed']),
})

/** Settings that must be integers no smaller than the listed value. */
const MINIMUM_SETTINGS = Object.freeze({
  loopBreakerThreshold: 2,
  loopBreakerWindow: 2,
})

/**
 * Lowest accepted section order of the pinned rules. The harness owns the identity section at
 * `-1000`, so a pinned rule below that order would displace it.
 */
export const MIN_PINNED_RULES_ORDER = -999

/**
 * Read one config entry whether the loader handed a schemastery accessor or a plain value.
 * @param {object} config - plugin config from the loader.
 * @param {string} key - field name.
 * @returns {unknown} the raw value, or undefined.
 */
function rawValue(config, key) {
  const raw = config?.[key]
  if (raw && typeof raw.get === 'function') {
    try {
      return raw.get()
    } catch {
      return undefined
    }
  }
  return raw
}

/**
 * Read a config field, preferring the loader's value over the default.
 * @param {object} config - plugin config from the loader.
 * @param {string} key - field name.
 * @param {unknown} fallback - value when the field is absent.
 * @returns {unknown} the resolved value.
 */
export function configValue(config, key, fallback) {
  const value = rawValue(config, key)
  return value === undefined ? fallback : value
}

/**
 * Validate and normalize one bundle row's config.
 * @param {object} [config] - raw config object from the loader.
 * @returns {typeof DEFAULTS} complete, validated settings.
 * @throws {TypeError} on an unknown key, a wrong type, or an unknown `headless` mode.
 */
export function resolveConfig(config = {}) {
  const resolved = { ...DEFAULTS }
  for (const key of Object.keys(config ?? {})) {
    if (!CONFIG_KEYS.has(key)) throw new TypeError(`tokeneconomizer: unknown setting ${key}`)
    const value = rawValue(config, key)
    if (value === undefined) continue
    const expected = typeof DEFAULTS[key]
    const allowed = ENUM_SETTINGS[key]
    if (allowed !== undefined) {
      if (!allowed.includes(value)) {
        throw new TypeError(`tokeneconomizer: ${key} must be ${allowed.join(', ')}, not ${value}`)
      }
    } else if (key === 'pinnedRulesOrder') {
      if (typeof value !== 'number' || !Number.isInteger(value) || value < MIN_PINNED_RULES_ORDER) {
        throw new TypeError(
          `tokeneconomizer: pinnedRulesOrder must be an integer >= ${MIN_PINNED_RULES_ORDER}, not ${value}`,
        )
      }
    } else if (typeof value !== expected) {
      throw new TypeError(`tokeneconomizer: ${key} must be ${expected}, not ${typeof value}`)
    } else if (expected === 'number' && !(value > 0)) {
      throw new TypeError(`tokeneconomizer: ${key} must be positive, not ${value}`)
    } else if (MINIMUM_SETTINGS[key] !== undefined && value < MINIMUM_SETTINGS[key]) {
      throw new TypeError(`tokeneconomizer: ${key} must be >= ${MINIMUM_SETTINGS[key]}, not ${value}`)
    }
    resolved[key] = value
  }
  return resolved
}

/** Where the learned facts sit among DSH's runtime contexts (after the team identity). */
export const MICROSKILLS_CONTEXT_ORDER = 180

/** Number of logged tool calls kept per session, so a step number is always available. */
export const CALL_INDEX_LIMIT = 64

/**
 * Whether this process runs DSH headless, which decides how a still-stuck notice is phrased.
 * @param {string} mode - `headless` config value.
 * @param {string[]} [argv] - process argv.
 * @returns {boolean} true when nobody is watching the DSH UI.
 */
export function isHeadless(mode, argv = process.argv) {
  if (mode === 'always') return true
  if (mode === 'never') return false
  const joined = argv.join(' ')
  return argv.includes('headless') || joined.includes('--profile headless')
}

/**
 * The source tag for context this plugin injects. DSH's message-source map is merge-extensible
 * and each producer declares its own kind, so the log says where the text came from.
 */
export const MESSAGE_SOURCE = Object.freeze({ kind: 'tokeneconomizer' })

/**
 * Construct one identified user-role message. The identity is minted here, and the source kind
 * declares this producer in DSH's merge-extensible map, so the log records where the text came
 * from without importing a harness package.
 * @param {string} text - model-facing text.
 * @returns {object} a frozen `UserMessage`.
 */
function userMessage(text) {
  return Object.freeze({
    id: randomUUID(),
    role: 'user',
    content: Object.freeze([{ type: 'text', text }]),
    source: MESSAGE_SOURCE,
  })
}

/**
 * Plugin body. Registers one scoped world per DSH agent and nothing global.
 * @param {object} ctx - Cordis context of the plugin row.
 * @param {object} config - validated plugin config.
 * @returns {void}
 */
export function apply(ctx, config) {
  if (isInert()) return
  config = resolveConfig(config ?? {})

  const stateHome = String(config.stateHome ?? '')
  const bins = launchers({
    ...process.env,
    ...(stateHome ? { TOKENECONOMIZER_HOME: stateHome } : {}),
  })
  if (config.tePath) bins.te = String(config.tePath)
  if (config.hookPath) bins.hook = String(config.hookPath)
  const exportDir = join(stateRoot({ ...process.env, TOKENECONOMIZER_HOME: bins.root }), 'dsh-sessions')
  const opts = {
    hookTimeoutMs: config.hookTimeoutMs,
    cliTimeoutMs: config.cliTimeoutMs,
    headless: config.headless,
  }

  const sessions = new Map()

  ctx.on('agent/created', async ({ agent, source }) => {
    if (agent.session.header.origin === 'subagent') return
    const sid = String(agent.id)
    const cwd = agent.session.header.cwd ?? process.cwd()
    const state = {
      sid,
      cwd,
      agent,
      prompt: '',
      turn: 0,
      source,
      lastExport: 0,
      timer: null,
      closed: false,
      started: false,
      broken: false,
      dedup: createDedupStore({
        minChars: config.dedupMinChars,
        maxEntries: config.dedupMaxEntries,
      }),
      breaker: createLoopBreaker({
        threshold: config.loopBreakerThreshold,
        window: config.loopBreakerWindow,
      }),
      prefix: createPrefixGuard(),
      calls: new Map(),
    }
    sessions.set(sid, state)
    // Every observer is registered before the first await: `agent/created` is awaited before the
    // loop claims its first message, so a listener registered after the brief would miss the
    // session's first tool calls.
    mount(state)
    await start(state, source)
  })

  ctx.on('agent/disposed', ({ agent }) => {
    const state = sessions.get(String(agent.id))
    if (!state || state.closed) return
    state.closed = true
    if (state.timer) clearTimeout(state.timer)
    state.watchdog?.disarm()
    void finish(state)
  })

  // Assistant stream frames are published process-locally, not as session events. They count as
  // progress while a model thinks, so a long reasoning turn does not trip the watchdog.
  ctx.on('agent/assistant-stream', ({ agent }) => {
    if (config.watchdogProgress !== 'any') return
    const state = sessions.get(String(agent.id))
    if (state) state.watchdog.progress()
  })

  /**
   * Register this agent's in-memory observers and its pinned prompt slot.
   *
   * The pinned rules are a prompt *section*, so their text is part of the request's first
   * message and stays byte-identical for the session; the learned facts stay a context, which
   * the harness materializes as one user-role snapshot.
   * @param {object} state - per-agent state.
   * @returns {void}
   */
  function mount(state) {
    state.watchdog = createWatchdog({
      thresholdMs: config.watchdogThresholdMs,
      onTimeout: () => onWatchdogTimeout(state),
    })
    const rules = String(config.pinnedRules ?? '')
    if (rules) {
      state.agent.ctx.systemPrompt.section(pinnedSection(rules, config.pinnedRulesOrder))
    }
    state.agent.ctx.on('tools/post-execute', async (exec, result, next) => {
      const decision = await next()
      if (state.closed) return decision
      if (exec.agent && String(exec.agent.id) !== state.sid) return decision
      const trip = observeBreaker(state, exec, result)
      if (trip !== undefined) breakLoop(state, exec, trip)
      const content = dedupContent(state, exec, result, decision)
      if (content !== undefined) return { ...decision, content }
      return decision
    })
    state.agent.ctx.on('session/event', (session, event) => onEvent(state, session, event))
    state.agent.ctx.on('tools/result', (exec, result) => onToolResult(state, exec, result))
  }

  /**
   * SessionStart: learn what to inject and which tools to leave out, then register both on the
   * agent's scope so they disappear with it. The listeners of the session were registered by
   * {@link mount} before this call, so no event of the session is missed.
   * @param {object} state - per-agent state.
   * @param {string} source - DSH session-start source.
   * @returns {Promise<void>} resolves after the brief has been applied or failed open.
   */
  async function start(state, source) {
    const cwd = state.cwd
    const tools = ctx.tools.definitions().map((def) => def.name)
    const answer = await brief(bins, cwd, tools, {
      timeoutMs: opts.cliTimeoutMs,
      env: createEnv(),
    })
    const text = config.microskills ? answer?.microskills?.text ?? '' : ''
    if (text) {
      state.agent.ctx.systemPrompt.context({
        name: 'tokeneconomizer:microskills',
        order: MICROSKILLS_CONTEXT_ORDER,
        text: () => text,
        interpolate: false,
        // Learned facts are operational context: they must survive a runtime-context toggle,
        // because this plugin only ever adds them when the person turned micro-skills on.
        required: true,
      })
    }
    if (config.toolprune) {
      const visible = new Set(ctx.tools.definitions().map((def) => def.name))
      const deny = (answer?.toolprune?.proposal ?? []).filter((t) => visible.has(t))
      if (deny.length) state.agent.ctx.tools.restrict({ deny })
    }

    const payload = {
      session_id: state.sid,
      cwd,
      hook_event_name: 'SessionStart',
      source,
    }
    if (state.agent.session.snapshotEvents().length > 0) {
      // A resumed or forked session already has a log; a fresh one is exported at its first
      // turn boundary. SessionStart only needs the log for the engine's "fold what ended
      // unseen" pass, which reads the records it already holds.
      payload.transcript_path = writeSession(state)
    }
    const out = await hook(bins, payload, {
      timeoutMs: opts.hookTimeoutMs,
      env: createEnv(),
      cwd,
    })
    report(state, out)
    // The engine sees SessionStart before any later hook of this session.
    state.started = true
  }

  /**
   * Fold one DSH session event into the engine's lifecycle.
   * @param {object} state - per-agent state.
   * @param {object} _session - the session that produced the event.
   * @param {{ type: string, data: object }} event - committed session event.
   * @returns {void}
   */
  function onEvent(state, _session, event) {
    if (isInert()) return
    observeMemory(state, event)
    if (event.type === 'turn/start') {
      state.turn = event.data.turn
      if (!state.started) return
      void hook(bins, {
        session_id: state.sid,
        cwd: state.cwd,
        hook_event_name: 'UserPromptSubmit',
        prompt_id: `${state.sid}:${state.turn}`,
        prompt: state.prompt,
      }, { timeoutMs: opts.hookTimeoutMs, env: createEnv(), cwd: state.cwd })
    } else if (event.type === 'user/message') {
      if (event.data?.source?.kind === 'user') {
        state.prompt = contentText(event.data.content)
        // A new user message ends the context the loop ran in.
        state.breaker.reset()
        state.broken = false
      }
    } else if (event.type === 'turn/end') {
      if (!state.started) return
      void hook(bins, {
        session_id: state.sid,
        cwd: state.cwd,
        hook_event_name: 'Stop',
        prompt_id: `${state.sid}:${event.data.turn}`,
        stop_hook_active: false,
      }, { timeoutMs: opts.hookTimeoutMs, env: createEnv(), cwd: state.cwd })
      scheduleExport(state)
    }
  }

  /**
   * Fold one committed session event into the in-memory detectors.
   *
   * The tool-call index gives every tool result the step that produced it, the prefix guard
   * watches the request's first message, and the watchdog measures the time since the session
   * last committed progress.
   * @param {object} state - per-agent state.
   * @param {{ type: string, data: object }} event - committed session event.
   * @returns {void}
   */
  function observeMemory(state, event) {
    if (event.type === 'tool/call') {
      state.calls.set(String(event.data.callId), { turn: event.data.turn, step: event.data.step })
      while (state.calls.size > CALL_INDEX_LIMIT) {
        state.calls.delete(state.calls.keys().next().value)
      }
      state.watchdog.progress()
      return
    }
    if (event.type === 'system/message') {
      const head = state.agent.session.deriveMessages()[0]
      const text = head?.role === 'system' ? contentText(head.content) : ''
      if (state.prefix.observe(text).changed) {
        notice(state, 'prefix: the system prompt changed mid-session, the cached prompt prefix was reset')
      }
      return
    }
    if (event.type === 'turn/start') {
      state.watchdog.arm()
      return
    }
    if (event.type === 'turn/end') {
      state.watchdog.disarm()
      return
    }
    state.watchdog.progress()
  }

  /**
   * The pointer text for a repeated tool output, or undefined when the output is kept.
   *
   * Only a successful result of a call the loop logged is deduplicated: a failed result is the
   * error the model has to read, and a decision carrying a canonical value keeps the tool's own
   * projection.
   * @param {object} state - per-agent state.
   * @param {object} exec - the tool execution identity.
   * @param {object} result - the normalized outcome.
   * @param {object} decision - the downstream post-execute decision.
   * @returns {object[] | undefined} replacement content blocks, or undefined.
   */
  function dedupContent(state, exec, result, decision) {
    if (!config.dedup) return undefined
    if (decision.kind !== 'accept') return undefined
    if (Object.hasOwn(decision, 'value')) return undefined
    if (result?.isError === true) return undefined
    const call = state.calls.get(String(exec.callId))
    if (call === undefined) return undefined
    const text = contentText(result?.content)
    if (!text) return undefined
    const repeat = state.dedup.observe(text, call.step)
    if (repeat === undefined) return undefined
    notice(
      state,
      `dedup: tool=${exec.name} repeated-output replaced hits=${repeat.count} first-step=${repeat.step} `
      + `hash=${repeat.digest.slice(0, SHORT_HASH_CHARS)}`,
    )
    return [{ type: 'text', text: repeat.text }]
  }

  /**
   * Record one call outcome in the loop breaker and report a trip.
   * @param {object} state - per-agent state.
   * @param {object} exec - the tool execution identity.
   * @param {object} result - the normalized outcome.
   * @returns {object | undefined} the trip report, or undefined.
   */
  function observeBreaker(state, exec, result) {
    if (!config.loopBreaker) return undefined
    if (state.broken) return undefined
    const ok = result?.isError !== true
    const trip = state.breaker.observe(
      { name: exec.name, arguments: exec.arguments ?? {} },
      ok,
      contentText(result?.content),
    )
    if (trip === undefined) return undefined
    state.broken = true
    return trip
  }

  /**
   * Stop a stuck turn and ask the person for guidance.
   *
   * The bail-out prompt is queued before the cancel, and the cancel keeps the inbox, so the
   * prompt survives the interrupted turn.
   * @param {object} state - per-agent state.
   * @param {object} exec - the tool execution identity.
   * @param {object} trip - the trip report of the loop breaker.
   * @returns {void}
   */
  function breakLoop(state, exec, trip) {
    const text = `The same command (${exec.name}) failed ${trip.count} times in a row with the same error. `
      + 'Automated execution was stopped; please advise how to proceed.'
    try {
      state.agent.inject(userMessage(text))
    } catch {
      /* fail open: the bail-out prompt is advisory */
    }
    try {
      state.agent.cancel({ kind: 'hook', reason: 'tokeneconomizer/loop-breaker' }, { keepInbox: true })
    } catch {
      /* fail open: a turn that already ended needs no cancel */
    }
    notice(state, `loop-breaker: tool=${exec.name} consecutive-failures=${trip.count} error=${trip.signature.slice(0, 120)}`)
  }

  /**
   * Report a step that committed no progress within the watchdog budget.
   * @param {object} state - per-agent state.
   * @returns {void}
   */
  function onWatchdogTimeout(state) {
    if (state.closed) return
    const action = config.watchdogAction === 'interrupt' ? 'interrupted' : 'warned'
    notice(state, `watchdog: no progress for ${config.watchdogThresholdMs} ms, action=${action}`)
    if (config.watchdogAction !== 'interrupt') return
    try {
      state.agent.cancel({ kind: 'hook', reason: 'tokeneconomizer/watchdog' }, { keepInbox: true })
    } catch {
      /* fail open: a turn that already ended needs no cancel */
    }
  }

  /**
   * Fold one finished tool call; inject a redirect when the guard asks for one.
   * @param {object} state - per-agent state.
   * @param {object} exec - the tool execution identity (name, arguments, agent).
   * @param {object} result - the normalized outcome.
   * @returns {void}
   */
  function onToolResult(state, exec, result) {
    if (isInert() || !config.loopguard) return
    if (exec.agent && String(exec.agent.id) !== state.sid) return
    const payload = {
      session_id: state.sid,
      cwd: state.cwd,
      hook_event_name: 'PostToolUse',
      prompt_id: state.turn ? `${state.sid}:${state.turn}` : '',
      tool_name: exec.name,
      tool_use_id: exec.callId,
      tool_input: exec.arguments ?? {},
      tool_response: toolResponse(result),
    }
    void (async () => {
      const out = await hook(bins, payload, {
        timeoutMs: opts.hookTimeoutMs,
        env: createEnv(),
        cwd: state.cwd,
      })
      const redirect = out?.hookSpecificOutput?.additionalContext
      if (redirect) {
        try {
          state.agent.inject(await userMessage(redirect))
        } catch {
          /* fail open: the guard's advice is advisory */
        }
      }
      report(state, out)
    })()
  }

  /**
   * Debounced export at turn boundaries, so a session that is killed mid-way still has a log the
   * engine can fold at the next start. The final write at disposal is synchronous.
   * @param {object} state - per-agent state.
   * @returns {void}
   */
  function scheduleExport(state) {
    if (state.closed) return
    const now = Date.now()
    if (now - state.lastExport < 30000) return
    if (state.timer) return
    state.timer = setTimeout(() => {
      state.timer = null
      try {
        writeSession(state)
      } catch {
        /* fail open */
      }
    }, 2000)
    state.timer.unref?.()
  }

  /**
   * Write this session's export.
   * @param {object} state - per-agent state.
   * @returns {string} the export path.
   */
  function writeSession(state) {
    const session = state.agent.session
    ensureExportDir(exportDir)
    const path = writeExport(exportDir, {
      header: session.header,
      events: session.snapshotEvents(),
    })
    state.lastExport = Date.now()
    return path
  }

  /**
   * SessionEnd: final export, then the detached fold.
   * @param {object} state - per-agent state.
   * @returns {Promise<void>} resolves after the hook call settles.
   */
  async function finish(state) {
    let transcript = ''
    try {
      transcript = writeSession(state)
    } catch {
      transcript = ''
    }
    const out = await hook(bins, {
      session_id: state.sid,
      cwd: state.cwd,
      hook_event_name: 'SessionEnd',
      reason: 'disposed',
      ...(transcript ? { transcript_path: transcript } : {}),
    }, { timeoutMs: opts.hookTimeoutMs, env: createEnv(), cwd: state.cwd })
    report(state, out)
    sessions.delete(state.sid)
  }

  /**
   * The environment for one engine call: the plugin's own settings and the headless marker.
   * @returns {Record<string, string>} environment additions.
   */
  function createEnv() {
    return {
      ...process.env,
      TE_HOST: 'dsh',
      TE_DSH_MODE: isHeadless(opts.headless) ? 'headless' : 'interactive',
      // An explicit state root must reach the engine too, or the launchers and the state
      // would disagree about which tree this session is teaching.
      ...(stateHome ? { TOKENECONOMIZER_HOME: stateHome } : {}),
    }
  }

  /**
   * Surface the engine's one-line notices. DSH's Host has no toast channel for a plugin, so a
   * notice goes to stderr, which the headless profile and a terminal log both keep.
   * @param {object} state - per-agent state.
   * @param {object} out - hook output.
   * @returns {void}
   */
  function report(state, out) {
    const notice = out?.systemMessage
    if (typeof notice === 'string' && notice && !state.closed) {
      process.stderr.write(`[tokeneconomizer] ${notice}\n`)
    }
  }

  /**
   * Write one host-local notice to stderr. DSH's Host has no toast channel for a plugin, so a
   * notice goes to stderr, which the headless profile and a terminal log both keep.
   * @param {object} state - per-agent state.
   * @param {string} text - the notice.
   * @returns {void}
   */
  function notice(state, text) {
    if (state.closed) return
    process.stderr.write(`[tokeneconomizer] ${text}\n`)
  }
}

/** Default export in the shape the loader reads. */
export default { name, inject, apply }
