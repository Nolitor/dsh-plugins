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
import { writeFileSync } from 'node:fs'
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
import { composePinnedText, createPrefixGuard, pinnedSection } from './prefix.js'
import { repoKeyFor } from './repokey.js'
import { createLoopBreaker, createWatchdog } from './watchdog.js'
import { createInterruptRecorder, WATCHDOG_ISSUER } from './interrupt-bridge.js'
import {
  classifyTool,
  TIER_HOT,
  tierContent,
  tierForTurn,
  TIER_DEFAULTS,
} from './tiering.js'

/** One process-wide recorder: the interrupt registry it points at is process-wide too. */
const interruptRecorder = createInterruptRecorder()

/** Cordis plugin name; must equal package.json `name` and the cordis.patch.yml row id. */
export const name = 'dsh-tokeneconomizer'

/** Services this plugin needs: the tool registry, the prompt registry, and the token meter. */
export const inject = ['tools', 'systemPrompt', 'tokenMeter']

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
  /** Watch a step that commits no progress, and warn before its budget expires. */
  watchdog: true,
  /** Progress-free budget of one step. */
  watchdogThresholdMs: 600000,
  /**
   * Budget of one in-flight tool call. The turn budget is held while a tool runs, so this
   * separate budget is what expires a slow or spinning tool. `0` disables it.
   */
  watchdogToolThresholdMs: 600000,
  /** Point inside the budget where one soft warning is emitted. */
  watchdogWarnMs: 300000,
  /** What the watchdog does when the budget is exhausted; `warn` never ends the turn. */
  watchdogAction: 'interrupt',
  /** Whether assistant stream frames count as progress. */
  watchdogProgress: 'any',
  /** Grade old tool outputs by turn: hot (full), warm (structure), cold (evicted). */
  tiering: true,
  /** Turns kept at full fidelity. */
  tierHotTurns: TIER_DEFAULTS.hotTurns,
  /** Turns kept as a structural summary; older turns are evicted. */
  tierWarmTurns: TIER_DEFAULTS.warmTurns,
  /** Characters kept from the head of a warm-tier output. */
  tierHeadChars: TIER_DEFAULTS.headChars,
  /** Characters kept from the tail of a warm-tier output. */
  tierTailChars: TIER_DEFAULTS.tailChars,
  /** Shortest output worth grading; below this the summary costs more than it saves. */
  tierMinChars: TIER_DEFAULTS.minChars,
  /** Pin the constant routing guidance that sends large inspections through one script. */
  thinkInCode: true,
  /** Recall this repository's earlier sessions before the first answer of a new one. */
  recallPriorSessions: true,
  /** Maximum number of earlier sessions quoted in the recall block. */
  recallLimit: 3,
  /** Maximum characters of the recall block; turn `recallPriorSessions` off to disable it. */
  recallMaxChars: 900,
  /** Write the decompressed session export the engine's fold reads. */
  exportSessions: true,
  /**
   * `apply` saves tokens and records evidence; `observe` keeps recording evidence but injects
   * nothing — no pinned rules, no recall, no pointer substitution, no loop guard, no surface
   * rewrite — so disabling the savings never stops the tracking.
   */
  mode: 'apply',
})

/** Names a config object may carry; anything else is a typo, not a setting. */
const CONFIG_KEYS = new Set(Object.keys(DEFAULTS))

/** Settings whose value is one of a fixed set. */
const ENUM_SETTINGS = Object.freeze({
  headless: Object.freeze(['auto', 'always', 'never']),
  watchdogAction: Object.freeze(['warn', 'interrupt']),
  watchdogProgress: Object.freeze(['any', 'committed']),
  mode: Object.freeze(['apply', 'observe']),
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
  if (resolved.tierWarmTurns <= resolved.tierHotTurns) {
    throw new TypeError(
      `tokeneconomizer: tierWarmTurns (${resolved.tierWarmTurns}) must be greater than tierHotTurns (${resolved.tierHotTurns})`,
    )
  }
  // The warning point is derived from the budget, not an independent bound: a deployment that
  // shortens `watchdogThresholdMs` (a test, a tight sandbox) should not also have to shorten the
  // warning point, and a warning at or past the budget would simply never fire. Clamp instead of
  // failing the row — this knob is advisory, so a late warning is a worse bug than a clamped one.
  if (resolved.watchdogWarnMs >= resolved.watchdogThresholdMs) {
    resolved.watchdogWarnMs = Math.max(1, Math.floor(resolved.watchdogThresholdMs / 2))
  }
  return resolved
}

/** Where the learned facts sit among DSH's runtime contexts (after the team identity). */
export const MICROSKILLS_CONTEXT_ORDER = 180

/** Number of logged tool calls kept per session, so a step number is always available. */
export const CALL_INDEX_LIMIT = 64

/**
 * Number of tool calls whose name and arguments are kept, so an old output can
 * still be graded as code or as a log when it falls out of the working window.
 */
export const META_INDEX_LIMIT = 4096

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
 * Whether a session event carries a message this plugin injected.
 *
 * Two shapes reach `onEvent`, and the source does not live in the same place in either:
 *
 *   user/message        -> event.data.source.kind
 *   agent/inbox/spliced -> event.data.inserted[].source.kind
 *
 * The splice shape is the one that matters. `agent.inject()` is synchronous: it splices the
 * inbox and appends `agent/inbox/spliced` inside the same tick, so the watchdog's own warning
 * comes back through `onEvent` before `onWatchdogWarn` even returns. Guarding only
 * `data.source` therefore misses it entirely (measured: 4 warnings, 0 cancels).
 *
 * The splice event also carries genuine user input, so the array must be inspected entry by
 * entry rather than treated as this plugin's own wholesale.
 * @param {object} event - one session event.
 * @returns {boolean} true when every message in the event came from this plugin.
 */
export function isOwnNotice (event) {
  const data = event?.data
  if (!data) return false
  if (data.source?.kind === MESSAGE_SOURCE.kind) return true
  const inserted = data.inserted
  if (!Array.isArray(inserted) || inserted.length === 0) return false
  return inserted.every((message) => message?.source?.kind === MESSAGE_SOURCE.kind)
}

/**
 * Tool-event delivery counters, one per registration path.
 *
 * The harness dispatches `tools/result` and `tools/post-execute` through a scope carrier, so a
 * listener registered on an agent scope and one registered on the plugin's root context can see
 * different numbers. `TE_DIAG=1` writes these counters to `<state root>/diagnostics.json`;
 * without it the counters are still counted but nothing is written. The object is mutable on
 * purpose: a counter that cannot be written must never break the tool call it counts.
 */
export const DELIVERY = {
  agentResult: 0, agentPost: 0, rootResult: 0, rootPost: 0, hookCalls: 0, hookEmpty: 0,
}

/**
 * Write the delivery counters to the state root, for the routing verification.
 * @param {string} root - the TokenEconomizer state root.
 * @returns {void}
 */
export function writeDelivery(root) {
  try {
    writeFileSync(join(root, 'diagnostics.json'), `${JSON.stringify(DELIVERY, null, 1)}\n`, { mode: 0o600 })
  } catch {
    /* fail open: a diagnostic never breaks a session */
  }
}

/**
 * Whether the diagnostic file is written at all.
 * @param {Record<string, string | undefined>} [env] - environment to read.
 * @returns {boolean} true when `TE_DIAG` is on.
 */
export function diagnosticsEnabled(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env.TE_DIAG ?? '').trim().toLowerCase())
}

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
  // Load the interrupt registry now: the deadline handler records synchronously, before cancel.
  void interruptRecorder.init()

  /**
   * Whether this session may change what the model sees.
   *
   * `observe` still records evidence (the engine hooks, the usage counters, the export), because
   * that is what a later fold learns from. It only stops the four injection points: the pinned
   * prompt section, the recall block, the pointer/guard substitutions, and the surface rewrite.
   * @returns {boolean} true when savings may be applied.
   */
  const applying = () => config.mode !== 'observe'

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
  const diagOn = diagnosticsEnabled()
  const diagRoot = stateRoot({ ...process.env, TOKENECONOMIZER_HOME: bins.root })

  // The harness dispatches the tool events through a scope carrier. These two root-level
  // listeners are the routing verification: they count what a listener on the plugin's own
  // context receives, next to the counts of the agent-scoped listeners above.
  if (diagOn) {
    ctx.on('tools/result', () => {
      DELIVERY.rootResult += 1
      writeDelivery(diagRoot)
    })
    ctx.on('tools/post-execute', async (_exec, _result, next) => {
      DELIVERY.rootPost += 1
      writeDelivery(diagRoot)
      return next()
    })
  }

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
      meta: new Map(),
      tiered: 0,
      tieredTurn: 0,
      requests: 0,
      /** Whether this session already spent its one prior-session recall. */
      recallDone: false,
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
      warnMs: config.watchdogWarnMs,
      // `Infinity` is the config-visible way to disable the tool budget: the settings
      // validator requires a positive number, so `0` is not expressible from config.
      toolThresholdMs: Number.isFinite(config.watchdogToolThresholdMs)
        ? config.watchdogToolThresholdMs
        : 0,
      onWarn: (elapsedMs, meta) => onWatchdogWarn(state, elapsedMs, meta),
      onTimeout: (budgetMs, meta) => onWatchdogTimeout(state, budgetMs, meta),
    })
    // The pinned text is a constant for the whole session: the person's own rules plus, when it
    // is on, the routing guidance that sends a large inspection through one script. Mounting an
    // empty section would be noise, so an empty composition mounts nothing.
    const pinned = composePinnedText(config.pinnedRules, config.thinkInCode)
    if (applying() && pinned) {
      state.agent.ctx.systemPrompt.section(pinnedSection(pinned, config.pinnedRulesOrder))
    }
    state.agent.ctx.on('tools/post-execute', async (exec, result, next) => {
      DELIVERY.agentPost += 1
      const decision = await next()
      if (state.closed) return decision
      // Observe mode keeps the routing counters and the evidence hooks, but hands the tool result
      // through untouched: no breaker prompt, no pointer substitution.
      if (!applying()) return decision
      if (exec.agent && String(exec.agent.id) !== state.sid) return decision
      const trip = observeBreaker(state, exec, result)
      if (trip !== undefined) breakLoop(state, exec, trip)
      const content = dedupContent(state, exec, result, decision)
      if (content !== undefined) return { ...decision, content }
      return decision
    })
    state.agent.ctx.on('session/event', (session, event) => onEvent(state, session, event))
    // Tiering rewrites the surface, which cannot run while `turn/start` is
    // being appended. The request waterfall runs after that append and before
    // the request is assembled, so the rewrite reaches this turn's first call.
    state.agent.ctx.on('agent/request', async (payload, next) => {
      if (payload.agent !== state.agent) return next()
      state.turn = payload.turn
      if (state.tieredTurn !== payload.turn) {
        state.tieredTurn = payload.turn
        try {
          applyTiering(state)
        } catch (error) {
          notice(state, `tiering: failed open (${error instanceof Error ? error.message : String(error)})`)
        }
      }
      return next()
    })
    state.agent.ctx.on('tools/result', (exec, result) => {
      DELIVERY.agentResult += 1
      onToolResult(state, exec, result)
    })
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
    const text = applying() && config.microskills ? answer?.microskills?.text ?? '' : ''
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
    if (applying() && config.toolprune) {
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
   * Grade this session's tool outputs and replace the ones that fell out of the
   * working window.
   *
   * Tier 1 (the newest turns) keeps every output byte-identical. Tier 2
   * replaces a log with its structure. Tier 3 evicts the output from the model
   * context and leaves a pointer; the durable session log keeps the original, so
   * the session query can still find it. Code reads are never summarized in
   * tier 2: they are the work, not noise.
   *
   * @param {object} state - per-agent state.
   * @returns {void}
   */
  function applyTiering(state) {
    if (!applying() || !config.tiering || state.closed) return
    const session = state.agent.session
    const currentTurn = state.turn
    if (!currentTurn) return
    const meter = ctx.tokenMeter
    if (!meter?.estimateMessage) return
    const policy = {
      hotTurns: config.tierHotTurns,
      warmTurns: config.tierWarmTurns,
      headChars: config.tierHeadChars,
      tailChars: config.tierTailChars,
      minChars: config.tierMinChars,
    }
    const nodes = session.surface?.nodes
    if (!nodes) return
    for (const seq of [...nodes]) {
      let event
      try {
        event = session.eventAt(seq)
      } catch {
        continue
      }
      if (event?.type !== 'tool/result') continue
      const turn = event.data?.turn ?? 0
      const tier = tierForTurn(turn, currentTurn, policy)
      if (tier === TIER_HOT) continue
      let original
      try {
        original = session.deriveEventMessage(event)
      } catch {
        continue
      }
      const text = contentText(original?.content)
      if (!text || text.startsWith('[tokeneconomizer]')) continue
      const callId = event.data?.message?.source?.callId ?? event.data?.message?.toolCallId
      const meta = state.meta.get(String(callId))
      const kind = classifyTool(meta?.name, meta?.arguments)
      const replacement = tierContent({
        text,
        kind,
        tier,
        turn,
        step: event.data?.step ?? 0,
        name: meta?.name ?? 'tool',
        policy,
      })
      if (replacement === undefined) continue
      const message = Object.freeze({
        ...original,
        content: Object.freeze([{ type: 'text', text: replacement }]),
      })
      try {
        session.append('compaction/prune', {
          shadowedRange: { start: seq, end: seq },
          shadowedSeqs: [seq],
          shadowedTokenCount: meter.estimateMessage(original),
        })
        session.append('tool/result', { ...event.data, message }, {
          surfaceOp: { op: 'replace', startSeq: seq, endSeq: seq },
          sourceEventSeqs: [seq],
        })
        state.tiered += 1
      } catch {
        /* fail open: a session that cannot be re-tiered keeps its context */
      }
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
      // The tiering grades an old output by what produced it, so the call's
      // name and arguments are kept per call id.
      state.meta.set(String(event.data.callId), {
        name: event.data.name,
        arguments: event.data.arguments,
      })
      while (state.meta.size > META_INDEX_LIMIT) {
        state.meta.delete(state.meta.keys().next().value)
      }
      // A tool is now running: it commits no session event until it returns, and a question
      // waiting on the person can block for minutes. Hold the budget instead of expiring it.
      state.watchdog.suspend()
      return
    }
    if (event.type === 'tool/result') {
      state.watchdog.resume()
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
    if (event.type === 'assistant/message') {
      state.requests += 1
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
    if (event.type === 'user/message') {
      // The first prompt of a session is the only cheap statement of intent, so the recall runs
      // once, on it, and reports into the transcript instead of the pinned prefix. Approval
      // notices and the plugin's own injected blocks also arrive as `user/message`, but they are
      // not a person's request: searching with them would recall the wrong thing, so the budget
      // stays unspent until a real prompt arrives.
      const source = event.data?.source?.kind
      const genuine = source === undefined || source === null || source === 'user'
      if (genuine && !state.recallDone && config.recallPriorSessions) {
        state.recallDone = true
        void recallPrior(state, contentText(event.data.content))
      }
      // A message this plugin injected is not progress, whichever shape carried it.
      if (!isOwnNotice(event)) state.watchdog.progress()
      return
    }
    // Most events are real activity and restart the budget, but the plugin's own notices are
    // not activity: counting them reset the budget that was about to expire, so the watchdog
    // warned forever and never reached its timeout (measured 2026-11-02: 24 warnings, 0
    // interrupts; the regression is commit 3254ebf, which swapped notice() for noticeUser()).
    if (!isOwnNotice(event)) state.watchdog.progress()
  }

  /**
   * Quote the earlier sessions of this repository into the transcript.
   *
   * DSH owns the FTS5 index behind `ctx.sessionQuery`; this plugin never opens that database, it
   * only asks the service for a page. The repository key widens an exact-`cwd` match so a session
   * started in a subdirectory still recalls work done at the checkout root.
   * @param {object} state - per-agent state.
   * @param {string} query - the first prompt of this session.
   * @returns {Promise<void>} resolves when the recall is delivered or skipped.
   */
  async function recallPrior(state, query) {
    if (!applying()) return
    // Reading an optional service must never throw: a Context without the reflect accessor (or a
    // composition without the query service) simply has no recall.
    if (typeof ctx.get !== 'function') return
    let service
    try {
      service = ctx.get('sessionQuery')
    } catch {
      return
    }
    if (!service || typeof service.searchSessions !== 'function') return
    const text = String(query ?? '').trim()
    if (!text) return
    let key = ''
    try {
      key = repoKeyFor(state.cwd)
    } catch {
      key = ''
    }
    let page
    try {
      page = await service.searchSessions({
        query: text.slice(0, 400),
        limit: Math.max(config.recallLimit * 4, 8),
        eventFilters: [{ kind: 'type', values: ['user/message', 'assistant/message'] }],
      })
    } catch {
      // Search is opt-in in a shipped composition and may be disabled; a session without recall
      // is the normal case, not an error.
      return
    }
    const hits = (page?.items ?? [])
      .filter(hit => String(hit?.header?.id ?? '') !== state.sid)
      .filter(hit => {
        const cwd = hit?.header?.cwd
        if (typeof cwd !== 'string' || !cwd) return false
        if (cwd === state.cwd) return true
        if (!key) return false
        try {
          return repoKeyFor(cwd) === key
        } catch {
          return false
        }
      })
      .slice(0, config.recallLimit)
    const block = formatRecall(hits, config.recallMaxChars)
    if (!block || state.closed) return
    try {
      state.agent.inject(userMessage(block))
    } catch {
      /* fail open: the recall is advisory */
    }
  }

  /**
   * Render the recall block, bounded in characters.
   * @param {object[]} hits - the accepted search hits.
   * @param {number} maxChars - the block budget.
   * @returns {string} the block, or an empty string when nothing is quotable.
   */
  function formatRecall(hits, maxChars) {
    const lines = []
    for (const hit of hits) {
      const id = String(hit?.header?.id ?? '').trim()
      const snippet = String(hit?.bestMatch?.snippet ?? '')
        .replace(/\s+/g, ' ')
        .trim()
      if (!id || !snippet) continue
      lines.push(`- ${id}: ${snippet.slice(0, 180)}`)
    }
    if (lines.length === 0) return ''
    const header = 'Earlier sessions of this workspace matched this request '
      + '(recalled from the harness index; verify before relying on it):'
    const block = `${header}\n${lines.join('\n')}`
    if (block.length <= maxChars) return block
    return `${block.slice(0, Math.max(1, maxChars - 4)).trimEnd()}\n ...`
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
    if (!applying()) return
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
   * Report one soft warning: the budget is part spent, and the turn keeps running.
   *
   * This is the jab, not the punch. It exists so a genuinely stuck step is visible without the
   * plugin ever deciding on its own that a long reasoning turn is stuck.
   * @param {object} state - per-agent state.
   * @param {number} elapsedMs - milliseconds without progress.
   * @returns {void}
   */
  function onWatchdogWarn(state, elapsedMs, meta) {
    if (state.closed) return
    const what = meta?.phase === 'tool' ? 'tool call' : 'turn'
    noticeUser(state, `watchdog: ${what} made no progress for ${Math.round(elapsedMs)} ms — warning only, the turn continues`)
  }

  /**
   * Report a step that committed no progress within the watchdog budget.
   *
   * The default action is `warn`: the notice is written and the budget restarts, so a long
   * reasoning turn or a slow tool is never killed. `interrupt` stays available as an explicit
   * opt-in for deployments that want the old behaviour.
   * @param {object} state - per-agent state.
   * @returns {void}
   */
  function onWatchdogTimeout(state, budgetMs = config.watchdogThresholdMs, meta) {
    if (state.closed) return
    if (!applying() || config.watchdogAction !== 'interrupt') {
      noticeUser(state, `watchdog: no progress for ${budgetMs} ms — still watching, the turn is not interrupted`)
      state.watchdog.progress()
      return
    }
    const what = meta?.phase === 'tool' ? 'tool call' : 'turn'
    // Record the interrupt first so the turn-exit reason names a system issuer instead of an
    // anonymous abort. Fail-open: a missing registry must never stop the cancel below.
    const record = interruptRecorder.record(state.sid, WATCHDOG_ISSUER)
    noticeUser(state, `watchdog: ${what} made no progress for ${budgetMs} ms, action=interrupted (` + (record.recorded ? record.wording : 'registry unavailable') + ')')
    try {
      state.agent.cancel({ kind: 'hook', reason: WATCHDOG_ISSUER }, { keepInbox: true })
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
    // The PostToolUse hook is a trace: it is what the engine folds into evidence, so observe mode
    // keeps delivering it. Only the guard's redirect back into the conversation is gated.
    if (isInert() || !config.loopguard) return
    if (exec.agent && String(exec.agent.id) !== state.sid) return
    DELIVERY.hookCalls += 1
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
      if (Object.keys(out).length === 0) DELIVERY.hookEmpty += 1
      const redirect = out?.hookSpecificOutput?.additionalContext
      if (redirect && applying()) {
        try {
          state.agent.inject(await userMessage(redirect))
        } catch {
          /* fail open: the guard's advice is advisory */
        }
      }
      report(state, out)
      if (diagOn) writeDelivery(diagRoot)
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
    if (!config.exportSessions) return
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
   *
   * The export is the only copy of the session the Python engine can read: DSH's own store is
   * zstd-framed, and the engine's fold takes a plain JSONL path. Turning `exportSessions` off
   * therefore stops the periodic duplicate but also leaves the fold nothing new to read, so the
   * caller is told rather than left to discover it.
   * @param {object} state - per-agent state.
   * @returns {string} the export path, or an empty string when exporting is off.
   */
  function writeSession(state) {
    if (!config.exportSessions) {
      if (!state.exportOffNoticed) {
        state.exportOffNoticed = true
        notice(state, 'export: exportSessions is off, so the engine fold has no new transcript for this session')
      }
      return ''
    }
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
    // A route that runs its tool calls outside the harness (an HTTP model route
    // that owns its own agent loop) leaves the bridge with nothing to observe.
    // Say so once, at the end of the session, instead of silently saving nothing.
    if (state.requests > 5 && DELIVERY.agentResult === 0) {
      notice(state, `route: no tool event reached the bridge in ${state.requests} requests — this route runs its tool calls outside DSH, so the tool-result levers (dedup, loop guard, watchdog, tiering) cannot observe them`)
    }
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

  /**
   * Surface one notice to the model and to the person's transcript, not just the log.
   *
   * A warning that only reaches stderr is invisible in the Web GUI, which is where people
   * actually watch a stalled turn. The text is queued as model-facing context, so it lands in
   * the transcript as one short block instead of rewriting anything already sent.
   * @param {object} state - per-agent state.
   * @param {string} text - the notice.
   * @returns {void}
   */
  function noticeUser(state, text) {
    notice(state, text)
    // Observe mode is silent by design: the warning still reaches the log, but nothing is added
    // to the conversation.
    if (state.closed || !applying()) return
    try {
      state.agent.inject(userMessage(`[tokeneconomizer] ${text}`))
    } catch {
      /* fail open: a notice is advisory */
    }
  }
}

/** Default export in the shape the loader reads. */
export default { name, inject, apply }
