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
import { spawnSync } from 'node:child_process'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'


import {
  brief,
  contentText,
  ensureExportDir,
  exitCodeOf,
  hook,
  isInert,
  launchers,
  runJson,
  runText,
  stateRoot,
  toolResponse,
  writeExport,
} from './bridge.js'
import { appendRecord, RECORD_NAMES } from './attribution.js'
import { probeCtx } from './probes.js'
import { applyRewrite } from './surface-attribution.js'
import { createDedupStore, SHORT_HASH_CHARS } from './dedup.js'
import { createDevStatsServer, registerDevStatsRoutes } from './devstats-server.js'
import { composePinnedText, createPrefixGuard, pinnedSection } from './prefix.js'
import { adoptLegacyKey, identityKeyOf, readIdentity, resolveIdentity, writeIdentity } from './identity.js'
import { repoKeyFor } from './repokey.js'
import { createSettingsRoutes } from './settings-api.js'
import { mergeSettings, readSettingsFile } from './settings.js'
import { checkUpstream, readEngineIdentity, PINNED_SHA } from './upstream.js'
import { createLoopBreaker, createWatchdog } from './watchdog.js'
import { createInterruptRecorder, WATCHDOG_ISSUER } from './interrupt-bridge.js'
import {
  chooseTrigger,
  classifyTool,
  decidedAtTrigger,
  policyHash,
  TIER_HOT,
  tierContent,
  tierForTurn,
  TIER_DEFAULTS,
  TRIGGERS,
  triggerProbe,
} from './tiering.js'

/** One process-wide recorder: the interrupt registry it points at is process-wide too. */
const interruptRecorder = createInterruptRecorder()

/**
 * This package's own directory — the tree the loader mounted.
 *
 * The engine keys its per-repository config by the directory it is asked about, so every
 * settings read and write must name the SAME directory. This package's directory is the
 * repository the plugin operates on, and it is stable regardless of what directory the
 * hosting process happens to boot in.
 *
 * @returns {string} the absolute path of the package root.
 */
function packageDir () {
  try {
    // `new URL('..', import.meta.url)` resolves against THIS FILE's directory (`lib/`), so
    // `..` is already the package root. No `dirname` on top: that would climb one level too
    // far and name the package's PARENT — measured 2026-11-15, the settings page would then
    // have filed its configuration under the workspace, not the plugin's repository.
    return fileURLToPath(new URL('..', import.meta.url))
  } catch {
    return process.cwd()
  }
}

/**
 * Run one git command and answer its trimmed stdout, or null when it failed.
 *
 * The engine's own identity lives in a git checkout, so reading it means asking git. Every
 * failure is a value: a machine without git, a checkout that was never made, or a tree whose
 * history was pruned all answer null, and the caller reports "unknown" rather than a guess.
 *
 * @param {string[]} args - the git arguments.
 * @returns {string | null} the trimmed stdout, or null.
 */
function gitOutput (args) {
  try {
    const result = spawnSync('git', args, { encoding: 'utf8', timeout: 5000, stdio: ['ignore', 'pipe', 'ignore'] })
    if (result.status !== 0) return null
    const text = String(result.stdout ?? '').trim()
    return text.length > 0 ? text : null
  } catch {
    return null
  }
}

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
  /**
   * Mount the in-memory levers (dedup, tiering, loop breaker, watchdog, prefix guard, pinned
   * rules) in a subagent session too.
   *
   * The engine path is root-only by design — a delegated child is folded with its parent's work
   * (`docs/ARCHITECTURE.md` §3) — but the memory path is not: a child that repeats a 40 kB tool
   * output, or burns its context on stale turns, costs the same as a root session doing it, and
   * the bill lands on the parent. Turn this off to restore the old "no economy of its own"
   * behaviour for children while keeping it for root sessions.
   */
  subagentMemory: true,
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

/**
 * A read-only view of the session map holding only its root sessions.
 *
 * The developer statistics surface lists one row per entry of the map it is handed, so a
 * delegated child left in the view appears as a *sibling* session of its parent: its turns and
 * its tokens are counted as if a person had run them, which is exactly the double count this
 * module removes from the engine path. The view is `values()`-only because that is the one
 * method `createDevStatsServer` reads, and it is live because the map it wraps is.
 *
 * The child still lives in the real map and still gets every memory lever; it is only hidden
 * from the camera. A child carries no separate bill to report — its cost belongs to the parent
 * that spawned it.
 * @param {Map<string, object>} sessions - the live per-session state map.
 * @returns {{ values: () => object[], get: (id: string) => object | undefined, size: number }}
 *   the root-session view.
 */
export function rootSessionsView(sessions) {
  return {
    values: () => [...sessions.values()].filter((state) => state?.subagent !== true),
    get: (id) => {
      const state = sessions.get(id)
      return state?.subagent === true ? undefined : state
    },
    get size() {
      return [...sessions.values()].filter((state) => state?.subagent !== true).length
    },
  }
}

/** Settings whose value is one of a fixed set. */
const ENUM_SETTINGS = Object.freeze({
  headless: Object.freeze(['auto', 'always', 'never']),
  watchdogAction: Object.freeze(['warn', 'interrupt']),
  watchdogProgress: Object.freeze(['any', 'committed']),
  mode: Object.freeze(['apply', 'observe']),
})

/**
 * The plugin's own package manifest version, checked at activation.
 *
 * The loader does not enforce `dsh.manifestVersion` (measured 2026-11-15 in the installed
 * `dsh-package-manifest` README: "Current installers and loaders do not enforce
 * `dsh.manifestVersion` or `engines.dsh`"), so the plugin checks its own field. A mismatch
 * degrades and warns; it never throws — a throw inside `apply()` costs the entire plugin.
 */
export const MANIFEST_VERSION = 1

/**
 * The manifest version this plugin's package declares.
 *
 * Read from the package manifest rather than hard-coded twice, so the check and the manifest
 * cannot drift apart. A missing or unreadable manifest answers null, which the check treats
 * as "cannot verify" rather than "mismatch".
 *
 * @returns {number | null} the declared version, or null when it cannot be read.
 */
function declaredManifestVersion () {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    const version = manifest?.dsh?.manifestVersion
    return typeof version === 'number' ? version : null
  } catch {
    return null
  }
}

/**
 * Compare the declared manifest version with the one this code understands.
 *
 * @param {number | null} declared - the version the package manifest carries.
 * @returns {{ ok: boolean, reason: string }} the verdict and the sentence to show.
 */
export function checkManifestVersion (declared = declaredManifestVersion()) {
  if (declared === null) {
    return { ok: true, reason: 'the package manifest declares no version to check' }
  }
  if (declared === MANIFEST_VERSION) {
    return { ok: true, reason: `manifest version ${declared} is the one this build understands` }
  }
  return {
    ok: false,
    reason: `the package manifest declares version ${declared}; this build understands ${MANIFEST_VERSION}`,
  }
}

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
  // Settings warnings go to stderr, never through noticeUser(): that helper injects a
  // user message, which would restart the watchdog budget the warning is about.
  const settingsWarn = (text) => process.stderr.write(`[tokeneconomizer] ${text}\n`)
  // The manifest self-check runs before anything else is wired, so a version this build does
  // not understand is reported once and up front. It warns and degrades; it never throws —
  // a throw inside `apply()` costs the entire plugin, and a cost optimizer must not be the
  // reason a session breaks.
  const manifest = checkManifestVersion()
  if (!manifest.ok) settingsWarn('manifest: ' + manifest.reason)
  /**
   * The mechanism status the settings page shows on its degraded-judge banner.
   *
   * Read from the live config rather than a session state, because the page is mounted once for
   * the process while sessions come and go. The judge answer is the same probe `judgeProbeFor`
   * uses, resolved without a session so the banner can render before any turn runs.
   * @returns {{ judge: { available: boolean, reason: string }, config: object }} the status.
   */
  const settingsMechanismStatus = () => {
    let judge = { available: false, reason: 'the judge seam has not been probed' }
    try {
      const probe = probeCtx(ctx, 'loopguard/judge')
      judge = {
        available: probe?.ok === true,
        reason: typeof probe?.reason === 'string' && probe.reason
          ? probe.reason
          : probe?.ok === true ? '' : 'the judge seam reported nothing',
      }
    } catch (error) {
      judge = { available: false, reason: error instanceof Error ? error.message : String(error) }
    }
    return {
      judge,
      config: {
        mode: composed.mode,
        microskills: composed.microskills,
        toolprune: composed.toolprune,
        loopguard: composed.loopguard,
      },
    }
  }
  const composed = resolveConfig(config ?? {})
  // The external settings file is merged ON TOP of the composed Cordis config, because a
  // patch `config` replaces the whole config and a layer underneath could never win a key.
  // Reading it here (not at import) keeps a test that rewrites DSH_HOME honest, and every
  // rejection is a warning that costs one key rather than the plugin.
  const file = readSettingsFile({ warn: settingsWarn })
  config = Object.keys(file.values).length > 0
    ? mergeSettings(composed, file.values, resolveConfig, settingsWarn)
    : composed
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
  /** The resolved plugin-record appender; `undefined` until first lookup, `null` when absent. */
  let recordAppender
  const diagOn = diagnosticsEnabled()
  const diagRoot = stateRoot({ ...process.env, TOKENECONOMIZER_HOME: bins.root })

  /**
   * Read the harness's own session projections for one session, when the composition registered
   * them. The token-meter units are the DSH ledger vocabulary this plugin's developer statistics
   * mirrors (`tokenUsage`, `contextPressure`, `contextBreakdown`), and `sessionStats` appears when
   * the host's session-stats plugin is composed. A composition without a projection registry — a
   * headless one-shot, a unit-test context — simply reports none.
   * @param {object} session - the DSH session.
   * @returns {{asOfSeq: number|null, values: object} | null} the projection cut, or null.
   */
  function readProjectionSnapshot(session) {
    if (typeof ctx.get !== 'function') return null
    let registry
    try {
      registry = ctx.get('sessionProjections')
    } catch {
      return null
    }
    if (registry === null || registry === undefined || typeof registry.snapshot !== 'function') return null
    try {
      const snapshot = registry.snapshot(session, [
        'tokenUsage',
        'contextPressure',
        'contextBreakdown',
        'sessionStats',
      ])
      return { asOfSeq: snapshot?.asOfSeq ?? null, values: snapshot?.values ?? {} }
    } catch {
      return null
    }
  }

  // Developer statistics: a read-only camera over the session ledger plus this plugin's counters.
  // It is mounted through the connection seam only when the host has one, so a headless profile
  // boots the plugin with the surface inert (never a failed row).
  const devStats = createDevStatsServer({
    sessions: rootSessionsView(sessions),
    readProjections: readProjectionSnapshot,
    log: { warn: settingsWarn },
  })
  const mountDevStats = (scoped) => {
    registerDevStatsRoutes({ ctx, scoped, server: devStats, log: { warn: settingsWarn } })
  }
  /**
   * The embedded engine's identity plus the upstream comparison, as one value.
   *
   * The engine's own facts are read from the local installation and never fail; the upstream
   * facts come from the network and may be unavailable, in which case the comparison says so
   * rather than guessing. The page renders both.
   * @returns {Promise<object>} the identity and the comparison.
   */
  const upstreamComparison = async () => {
    const root = stateRoot(createEnv())
    const identity = readEngineIdentity({
      root,
      sha: PINNED_SHA,
      probe: {
        exists: (path) => existsSync(path),
        head: (tree) => gitOutput(['-C', tree, 'rev-parse', 'HEAD']),
        describe: (tree) => gitOutput(['-C', tree, 'describe', '--tags']),
      },
    })
    const comparison = await checkUpstream({ sha: PINNED_SHA })
    return { ...comparison, engine: identity }
  }

  /**
   * The provider/model pairs this deployment can route a side call to.
   *
   * The host's LLM registry is the only truthful source: `listProviders()` names the registered
   * routes and `listModels(provider)` names what each one advertises. A deployment whose
   * registry is absent answers an empty list, which the page renders as "no model provider is
   * registered" — never a list this plugin made up.
   * @returns {Promise<{ providers: object[], failures: object[] }>} the catalog.
   */
  const hostModelCatalog = async () => {
    const providers = []
    const failures = []
    let registry = null
    try {
      registry = typeof ctx.get === 'function' ? ctx.get('llm') : undefined
    } catch {
      registry = null
    }
    if (registry === null || registry === undefined) return { providers, failures }
    let listed = []
    try {
      listed = typeof registry.listProviders === 'function' ? registry.listProviders() : []
    } catch (error) {
      failures.push({ id: 'llm', name: 'the LLM registry', message: error instanceof Error ? error.message : String(error) })
      return { providers, failures }
    }
    for (const provider of Array.isArray(listed) ? listed : []) {
      const id = typeof provider?.id === 'string' ? provider.id : String(provider?.id ?? '')
      const name = typeof provider?.name === 'string' ? provider.name : id
      if (id.length === 0) continue
      try {
        const models = typeof registry.listModels === 'function' ? await registry.listModels(id) : []
        providers.push({
          id,
          name,
          models: (Array.isArray(models) ? models : [])
            .filter((model) => typeof model?.id === 'string' && model.id.length > 0)
            .map((model) => ({
              id: model.id,
              name: typeof model?.name === 'string' && model.name.length > 0 ? model.name : model.id,
            })),
        })
      } catch (error) {
        failures.push({ id, name, message: error instanceof Error ? error.message : String(error) })
      }
    }
    return { providers, failures }
  }

  // The interactive settings page. Its eight routes are the write half of the seat the client
  // already renders, so registering them here is what removes the client's 404. Engine access
  // runs through the same `runJson` boundary every other engine call uses: the route layer never
  // opens `~/.tokeneconomizer/config.json` itself.
  //
  // The engine's per-repository config is keyed by the directory it is asked about, so the
  // settings page must name ONE directory explicitly. It is this package's own directory —
  // the tree the loader mounted — because that is the repository the plugin operates on, and
  // because it is the same directory the operator sees in `te status` when they run it from
  // here. Naming the SERVER's working directory instead would file the settings under
  // whatever repository the host happened to boot in.
  const settingsCwd = () => packageDir()
  const mountSettings = (scoped) => {
    const connection = scoped?.connection ?? (typeof ctx.get === 'function' ? ctx.get('connection') : undefined)
    const register = connection?.fetch?.register
    if (typeof register !== 'function') return []
    const bins = launchers(createEnv())
    const runEngine = async (kind, args) => {
      // `te config show` prints JSON; `set`/`unset`/`restore` print a human-readable confirmation
      // and still exit 0. The status therefore has to travel with the text — passing only stdout
      // made a successful write look like a rejection, because a confirmation line is not JSON.
      //
      // `--cwd` is NOT optional here. The engine keys its per-repository config by the
      // directory it is asked about, so WITHOUT it the settings page wrote into whichever
      // repository the SERVER's working directory happened to be — measured 2026-11-15: the
      // web profile's cwd is `~/.dsh`, so a save from the settings page landed in
      // `repos/deepseek-harness-bbcdb118d8/config.json` while the operator's own repository
      // (`repos/dsh-plugins-4806902e1d/config.json`) kept its old value. The page then read
      // the same wrong bucket and showed the old value again: the setting looked like it
      // "reverted to the default" on every save.
      //
      // The directory named is the one the settings are ABOUT: the plugin's own repository,
      // which is the directory the plugin was loaded from and the one the operator is working
      // in. It is resolved once, at mount time, from the same path the loader used.
      const args2 = ['--cwd', settingsCwd(), 'config', kind, ...args]
      return runText(bins.te, args2, {
        env: createEnv(),
        timeoutMs: opts.cliTimeoutMs,
      })
    }
    try {
      // DSH allows exactly one registration per path, carrying a `methods` set — a second
      // registration for the same path throws (`connection: exact Fetch route ... is already
      // registered`, measured). So collect the handlers by path and register each path once,
      // dispatching on the request method inside the single handler.
      const byPath = new Map()
      const registerPath = (method, path, handler) => {
        const entry = byPath.get(path) ?? { methods: [], handlers: new Map() }
        if (entry.handlers.has(method)) return
        entry.methods.push(method)
        entry.handlers.set(method, handler)
        byPath.set(path, entry)
      }
      const created = createSettingsRoutes({
        runEngine,
        register: registerPath,
        mechanismStatusOf: () => settingsMechanismStatus(),
        upstreamCheck: () => upstreamComparison(),
        modelCatalog: () => hostModelCatalog(),
        log: { warn: settingsWarn },
      })
      for (const [path, entry] of byPath) {
        try {
          register.call(connection.fetch, {
            path,
            methods: entry.methods,
            requestBody: 'buffered',
            fetch: async (request) => {
              const method = String(request?.method ?? 'GET').toUpperCase()
              const handler = entry.handlers.get(method)
              if (typeof handler !== 'function') {
                return new Response(JSON.stringify({ ok: false, error: 'method not allowed: ' + method }), {
                  status: 405,
                  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
                })
              }
              return handler(request)
            },
          })
        } catch (error) {
          settingsWarn('settings-api: ' + path + ': ' + (error instanceof Error ? error.message : String(error)))
        }
      }
      return created
    } catch (error) {
      settingsWarn('settings-api: ' + (error instanceof Error ? error.message : String(error)))
      return []
    }
  }
  if (typeof ctx.inject === 'function') {
    try {
      ctx.inject(['connection'], (scoped) => {
        mountDevStats(scoped)
        mountSettings(scoped)
      })
    } catch {
      mountDevStats()
      mountSettings()
    }
  } else {
    mountDevStats()
    mountSettings()
  }

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
    const isSubagent = agent.session.header.origin === 'subagent'
    // Two different things live behind one `agent/created` and only ONE of them is root-only.
    //
    //   engine path   SessionStart / UserPromptSubmit / PostToolUse / Stop / SessionEnd, the
    //                 Python engine behind them, the session export and its fold. Root only: a
    //                 delegated child is folded with its parent's work, so running its own
    //                 envelope double-counts the child's turns and teaches the loop guard a
    //                 turn scale no person runs (`docs/ARCHITECTURE.md` §3).
    //
    //   memory path   dedup, tiering, loop breaker, watchdog, prefix guard, pinned section. No
    //                 engine call, no file write, `node:` builtins only. A child session burns
    //                 the same model context and makes the same tool calls, and its bill lands
    //                 on the parent, so these must run everywhere — `subagentMemory: false`
    //                 opts a child back out.
    //
    // A child with memory turned off mounts nothing at all: no state, no listeners.
    if (isSubagent && config.subagentMemory !== true) return
    const sid = String(agent.id)
    const cwd = agent.session.header.cwd ?? process.cwd()
    /**
     * The project identity for this session, resolved once through `lib/identity.js`.
     *
     * `projectDir` is the immutable anchor from the session header; `liveDir` is the current
     * directory. They are kept apart because conflating them was the original identity bug.
     *
     * `engineRepoKey` is the key the engine actually uses on disk. The legacy `repoKeyFor()` value
     * stays the authority here — `lib/identity.js` marks the engine's own canonicalization
     * unverifiable from this host, so a computed key is never allowed to displace a bucket that
     * already exists. When a legacy bucket is present and the resolved identity differs from it,
     * the legacy key is adopted onto the identity record so the existing data keeps being read.
     */
    const identity = resolveSessionIdentity(agent.session.header, cwd)
    const state = {
      sid,
      cwd,
      identity,
      agent,
      prompt: '',
      turn: 0,
      source,
      lastExport: 0,
      timer: null,
      closed: false,
      started: false,
      /**
       * Whether this session owns the engine path. Every engine call site checks this flag
       * explicitly instead of relying on `started` (which the memory path never sets) or on the
       * handler's early return: the SessionEnd hook in `finish()`, the export in
       * `scheduleExport()`/`writeSession()`, and the PostToolUse trace in `onToolResult()` are
       * reached through paths that a `started` check alone never covered.
       */
      engineEnabled: !isSubagent,
      /** Whether this state was created for a delegated child (devstats labelling). */
      subagent: isSubagent,
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
      /** The trigger seam the tiering pass is registered on, chosen at mount. */
      tierTrigger: null,
      requests: 0,
      /**
       * Counters for the read-only developer statistics surface. They are plain numbers so a
       * serialization of the ledger view cannot pull a live object out of the host, and every
       * bump is fail-open: a statistics counter must never break the feature it counts.
       */
      stats: {
        mode: config.mode,
        startedAt: Date.now(),
        updatedAt: Date.now(),
        dedupHits: 0,
        dedupSavedChars: 0,
        tierShadowTokens: 0,
        breakerTrips: 0,
        watchdogWarns: 0,
        watchdogInterrupts: 0,
        toolCalls: 0,
        toolErrors: 0,
        notices: 0,
        pinned: false,
        thinkInCode: config.thinkInCode === true,
      },
      /** Whether this session already spent its one prior-session recall. */
      recallDone: false,
      /** Categories already reported once; a repeating degraded path reports once, not per turn. */
      noticedOnce: new Set(),
      /** Whether the tiering pass already reported a skipped rewrite. */
      tierRewriteNoticed: false,
      /** The judge seam probe, resolved once per session: `undefined` until first needed. */
      judgeProbe: undefined,
    }
    sessions.set(sid, state)
    // Every observer is registered before the first await: `agent/created` is awaited before the
    // loop claims its first message, so a listener registered after the brief would miss the
    // session's first tool calls.
    mount(state)
    // The engine path is root-only: a child gets the memory levers above and nothing else.
    if (state.engineEnabled) await start(state, source)
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
      // `watchdog: false` is honoured here: the key was declared, validated and documented but
      // read nowhere until 2026-11-13, so turning it off silently changed nothing.
      disabled: config.watchdog !== true,
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
    state.stats.pinned = Boolean(applying() && pinned)
    if (applying() && pinned) {
      state.agent.ctx.systemPrompt.section(pinnedSection(pinned, config.pinnedRulesOrder))
    }
    state.agent.ctx.on('tools/post-execute', async (exec, result, next) => {
      DELIVERY.agentPost += 1
      const decision = await next()
      state.stats.updatedAt = Date.now()
      state.stats.toolCalls += 1
      if (result?.isError === true) state.stats.toolErrors += 1
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
    // Tiering rewrites the surface, which cannot run while `turn/start` is being appended. It is
    // applied from the non-deprecated `agent/pre-step` waterfall (step preparation, before request
    // assembly) or, when that seam is absent, from the `session/event` fallback on `step/start`.
    // Neither window is the old `agent/request` one: a rewrite can land one step later than before,
    // and still saves tokens on every later step of the turn. The seam is chosen in one place.
    const triggerChoice = chooseTrigger(triggerProbe(state.agent.ctx))
    state.tierTrigger = decidedAtTrigger(triggerChoice)
    if (triggerChoice.trigger === TRIGGERS.PRE_STEP) {
      state.agent.ctx.on(TRIGGERS.PRE_STEP, async (payload, next) => {
        if (payload.agent !== state.agent) return next()
        state.turn = payload.turn
        tierOnce(state)
        // A tiering rewrite must never reject a step: `next()` keeps the current messages.
        return next()
      })
    } else {
      state.agent.ctx.on(TRIGGERS.SESSION_EVENT, (session, event) => {
        if (session !== state.agent.session || event?.type !== 'step/start') return
        const turn = event.data?.turn
        if (typeof turn === 'number' && turn > 0) state.turn = turn
        tierOnce(state)
      })
    }
    state.agent.ctx.on('tools/result', (exec, result) => {
      DELIVERY.agentResult += 1
      onToolResult(state, exec, result)
    })
  }

  /**
   * The appender {@link appendRecord} should call, resolved once per process.
   *
   * DSH's `Session` has no `appendPluginRecord` *method*: the record API is a module export
   * (`appendPluginRecord(session, type, data)`), and `lib/attribution.js` looks for a session
   * method first. Without this seam every record this plugin writes would be dropped with a
   * warning nobody reads — and the point of this wave is that the records exist. The module
   * namespace is reached through the ctx service surface (`ctx.get('session')`), which is the
   * same lookup `lib/probes.js` already performs, so no harness package is imported.
   *
   * @returns {Function|null} `(session, type, data) => seq`, or null when unreachable.
   */
  function resolveRecordAppender() {
    if (recordAppender !== undefined) return recordAppender
    recordAppender = null
    if (typeof ctx.get === 'function') {
      let namespace
      try {
        namespace = ctx.get('session')
      } catch {
        namespace = undefined
      }
      const candidate = namespace?.appendPluginRecord ?? namespace?.default?.appendPluginRecord
      if (typeof candidate === 'function') {
        recordAppender = (session, type, data) => candidate(session, type, data)
      }
    }
    return recordAppender
  }

  /**
   * The options every record write goes through: the resolved appender, or nothing.
   *
   * When no appender exists the write is attempted against the session anyway (a test double, a
   * newer host that grew the method), and its failure is reported once — never silently.
   * @param {object} state - per-agent state.
   * @param {object} [session] - the log-owning session, when the write runs against a view of it.
   * @returns {{ appendPluginRecord?: Function }} the append options.
   */
  function recordOptions(state, session) {
    const appender = resolveRecordAppender()
    if (appender === null) {
      noticeOnce(state, 'records', 'records: no plugin-record appender on this host; provenance records cannot be written')
      return {}
    }
    // The record API is a module export bound to the real session object, so a rewrite that runs
    // against a widened surface view still commits its record through the owner of the log.
    return {
      appendPluginRecord: (target, type, data) => appender(session ?? target, type, data),
    }
  }

  /**
   * Apply the engine's tool-prune proposal as a scoped restriction, and record that it applied.
   *
   * The proposal is intersected with the tools this agent can actually see before it is passed
   * to `restrict`: DSH rejects a restriction naming an unknown tool, so an unintersected
   * proposal would fail every time and the lever would silently never apply — which is exactly
   * the measured state (`untool_applied: []` across the whole ledger). Every degraded path is
   * reported once and writes no applied record; only a restriction that really landed does.
   *
   * @param {object} state - per-agent state.
   * @param {{ proposal?: string[], mode?: string, proposalId?: string }} [toolprune] - the
   *   engine's answer; `undefined` means the engine was unreachable.
   * @returns {void}
   */
  function applyToolPrune(state, toolprune) {
    const proposal = Array.isArray(toolprune?.proposal)
      ? toolprune.proposal.filter((name) => typeof name === 'string' && name !== '')
      : []
    if (proposal.length === 0) return
    const before = visibleToolNames(state)
    const visible = new Set(before)
    const deny = [...new Set(proposal)].filter((name) => visible.has(name))
    if (deny.length === 0) {
      noticeOnce(state, 'toolprune', 'toolprune: the proposal names no tool this assembly registers; nothing was restricted')
      return
    }
    let restricted = false
    try {
      state.agent.ctx.tools.restrict({ deny })
      restricted = true
    } catch (error) {
      noticeOnce(
        state,
        'toolprune',
        `toolprune: restrict rejected [${deny.join(', ')}] (${error instanceof Error ? error.message : String(error)}); no tool was masked`,
      )
    }
    if (!restricted) return
    const after = visibleToolNames(state)
    // The engine key this session's evidence belongs to, taken from the resolved identity so an
    // adopted legacy bucket keeps receiving evidence instead of a parallel bucket starting empty.
    const repoKey = state.identity?.engineRepoKey ?? ''
    const record = {
      tools: deny,
      countBefore: before.length,
      countAfter: after.length,
      visibleIntersection: deny,
      repoKey: repoKey === '' ? 'unknown' : repoKey,
      time: Date.now(),
    }
    if (typeof toolprune?.proposalId === 'string' && toolprune.proposalId !== '') {
      record.proposalId = toolprune.proposalId
    }
    const outcome = appendRecord(state.agent.session, RECORD_NAMES.TOOLPRUNE_APPLIED, record, recordOptions(state))
    if (!outcome.ok) {
      noticeOnce(
        state,
        'toolprune',
        `toolprune: applied [${deny.join(', ')}] but its record could not be appended (${outcome.reason ?? 'unknown'})`,
      )
      return
    }
    state.stats.updatedAt = Date.now()
  }

  /**
   * The tool names this agent can see, from its own scope when the registry exposes one.
   * @param {object} state - per-agent state.
   * @returns {string[]} the visible names.
   */
  function visibleToolNames(state) {
    const scoped = state.agent.ctx?.tools
    if (scoped !== null && typeof scoped === 'object' && typeof scoped.definitions === 'function') {
      try {
        return scoped.definitions(state.agent).map((definition) => String(definition.name))
      } catch {
        /* fall through to the plugin-scoped registry */
      }
    }
    try {
      return ctx.tools.definitions().map((definition) => String(definition.name))
    } catch {
      return []
    }
  }

  /**
   * Write one notice at most once per session for a category.
   *
   * A degraded path is reported, never silent; but a path that fails on every turn would
   * otherwise flood the log and bury the one line that identifies the problem.
   * @param {object} state - per-agent state.
   * @param {string} key - the once-per-session category.
   * @param {string} text - the notice.
   * @returns {void}
   */
  function noticeOnce(state, key, text) {
    const seen = state.noticedOnce
    if (!(seen instanceof Set)) return
    if (seen.has(key)) return
    seen.add(key)
    notice(state, text)
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
    // Belt and braces: the caller only reaches here for a root session, but the invariant
    // "a subagent makes zero engine calls" is worth holding at the engine entry point itself,
    // not only at its call site.
    if (!state.engineEnabled) return
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
    if (applying() && config.toolprune) applyToolPrune(state, answer?.toolprune)

    const payload = {
      session_id: state.sid,
      cwd,
      hook_event_name: 'SessionStart',
      source,
    }
    if (state.agent.session.seq > 0) {
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
      if (!state.engineEnabled || !state.started) return
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
      if (!state.engineEnabled) return
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
   * Apply the tiering pass once per turn, from whichever trigger seam
   * {@link chooseTrigger} picked. Fail-open: a rewrite that throws is reported
   * and the turn continues with its context intact.
   * @param {object} state - per-agent state.
   * @returns {void}
   */
  function tierOnce(state) {
    const turn = state.turn
    if (!turn || state.tieredTurn === turn) return
    state.tieredTurn = turn
    try {
      applyTiering(state)
    } catch (error) {
      notice(state, `tiering: failed open (${error instanceof Error ? error.message : String(error)})`)
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
    // The harness projects `surface.nodes` as a readonly array and the paired-write module
    // validates exactly that shape. A standing collection instead (an older host, a test double)
    // is widened here rather than relaxing that validation. Appends still reach the real session.
    const target = Array.isArray(nodes)
      ? session
      : {
          append: (type, data, appendOptions) => session.append(type, data, appendOptions),
          surface: { nodes: [...nodes] },
        }
    // The tier policy is hashed once per pass: every decision record names the policy that
    // graded it, so a later reader can re-audit the decision against the boundaries in force.
    const policyFingerprint = policyHash(policy)
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
      const shadowTokens = meter.estimateMessage(original)
      // The write goes through the paired-write module, so the prune payload, the decision
      // record and the rewrite record are one ordered unit: a rewrite without its records can
      // no longer happen, and a reader can tell "decided, not rewritten" from "never decided".
      let outcome
      try {
        outcome = applyRewrite(target, seq, replacement, {
          tier,
          turn,
          step: event.data?.step ?? 0,
          policyHash: policyFingerprint,
          reason: `tier:${tier}`,
          shadowTokens: Number.isFinite(Number(shadowTokens)) ? Number(shadowTokens) : 0,
          charsBefore: text.length,
        }, {
          readEvent: (probeSeq) => session.eventAt(probeSeq),
          ...recordOptions(state, session),
        })
      } catch {
        // Fail open: a session that cannot be re-tiered keeps its context.
        outcome = { ok: false, reason: 'rewrite-threw' }
      }
      if (!outcome.ok) {
        if (!state.tierRewriteNoticed) {
          state.tierRewriteNoticed = true
          notice(state, `tiering: rewrite skipped (${outcome.reason ?? 'unknown'})`)
        }
        continue
      }
      if (outcome.warning && !state.tierRewriteNoticed) {
        state.tierRewriteNoticed = true
        notice(state, `tiering: ${outcome.warning}`)
      }
      state.tiered += 1
      state.stats.tierShadowTokens += Number.isFinite(Number(shadowTokens)) ? Number(shadowTokens) : 0
      state.stats.updatedAt = Date.now()
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
      state.stats.updatedAt = Date.now()
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
      // Recall belongs to the engine path: it quotes earlier sessions to open a *root* session,
      // and a delegated child repeats its parent's first prompt, so recalling there would inject
      // the same block a second time.
      if (genuine && !state.recallDone && state.engineEnabled && config.recallPriorSessions) {
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
    // Recall widens an exact-`cwd` match to the same repository. The key comes from the resolved
    // identity, and the set of keys to match includes any adopted legacy bucket, so a session
    // started before the identity layer existed is still recalled by a session started after it.
    const key = state.identity?.engineRepoKey ?? ''
    const identityKey = state.identity?.identityKey ?? ''
    const legacyKeys = Array.isArray(state.identity?.legacyKeys) ? state.identity.legacyKeys : []
    const knownKeys = new Set([key, identityKey, ...legacyKeys].filter(Boolean))
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
        // The live directory and the immutable project directory are both valid matches: a
        // session resumed from a subdirectory still belongs to the same project.
        if (cwd === state.cwd || cwd === state.identity?.projectDir) return true
        if (knownKeys.size === 0) return false
        try {
          if (knownKeys.has(repoKeyFor(cwd))) return true
        } catch {
          /* an unresolvable directory simply does not match */
        }
        try {
          return knownKeys.has(identityKeyOf(resolveIdentity({ cwd }, cwd, [], { env: createEnv() })))
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
    state.stats.dedupHits += 1
    state.stats.dedupSavedChars += Math.max(0, text.length - repeat.text.length)
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
    state.stats.breakerTrips += 1
    return trip
  }

  /**
   * Whether the engine's loop-guard judge is reachable, probed once per session.
   *
   * The judge is a model side call, and in the measured live deployment it cannot run:
   * `errors.log` ends with `sidecall dsh: no reply (exit 1) ACCOUNT_SIGN_IN_REQUIRED`. When the
   * seam is absent the guard still fires — the strict heuristic (consecutive identical failures
   * with the same error signature) is judge-independent — but its decision is marked degraded so
   * the lower precision is visible instead of being presented as a judged verdict.
   *
   * Probed once and cached: a per-turn probe would spawn a side call on every tool result.
   * @param {object} state - per-agent state.
   * @returns {{ ok: boolean, reason: string }} the cached probe.
   */
  function judgeProbeFor(state) {
    if (state.judgeProbe !== undefined) return state.judgeProbe
    let probe
    try {
      probe = probeCtx(state.agent.ctx, 'loopguard/judge')
    } catch (error) {
      probe = { ok: false, reason: `probe-threw: ${error instanceof Error ? error.message : String(error)}` }
    }
    const resolved = {
      ok: probe?.ok === true,
      reason: typeof probe?.reason === 'string' ? probe.reason : 'the judge seam reported nothing',
    }
    state.judgeProbe = resolved
    if (!resolved.ok) {
      notice(
        state,
        `loopguard: judge unavailable (${resolved.reason}); running the strict heuristic path only, decisions are marked degraded`,
      )
    }
    return resolved
  }

  /**
   * Record the loop guard's decision, marking it degraded when no judge could vote on it.
   *
   * The record is a `tier-decision` payload with a loop-guard reason, because the alternative —
   * a fourth record type — would be a log-format migration for one field. The `reason` carries
   * the degradation, so a reader never has to guess whether a judge participated.
   *
   * @param {object} state - per-agent state.
   * @param {object} exec - the tool execution identity.
   * @param {object} trip - the trip report of the loop breaker.
   * @param {{ ok: boolean, reason: string }} judge - the cached judge probe.
   * @returns {void}
   */
  function recordLoopDecision(state, exec, trip, judge) {
    const degraded = !judge.ok
    const reason = degraded ? 'loopguard:repeat:degraded' : 'loopguard:repeat'
    // The step comes from the call index the tool-call fold maintains, so the record names the
    // step that actually looped instead of a placeholder.
    const call = state.calls?.get(String(exec?.callId))
    const payload = {
      nodeSeq: 0,
      tier: 'hot',
      turn: Number.isFinite(call?.turn) ? call.turn : (Number.isFinite(state.turn) ? state.turn : 0),
      step: Number.isFinite(call?.step) ? call.step : 0,
      policyHash: policyHash({ loopBreakerThreshold: config.loopBreakerThreshold }),
      reason,
    }
    const outcome = appendRecord(state.agent.session, RECORD_NAMES.TIER_DECISION, payload, recordOptions(state))
    if (!outcome.ok) {
      noticeOnce(
        state,
        'loopguard',
        `loopguard: decision stands but its record could not be appended (${outcome.reason ?? 'unknown'})`,
      )
    }
    state.stats.updatedAt = Date.now()
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
    // Attribute the decision before acting on it: whether the judge took part is part of the
    // record, and a degraded decision must be readable as degraded.
    const judge = judgeProbeFor(state)
    recordLoopDecision(state, exec, trip, judge)
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
    const suffix = judge.ok ? '' : ` degraded=true judge=${judge.reason}`
    notice(state, `loop-breaker: tool=${exec.name} consecutive-failures=${trip.count} error=${trip.signature.slice(0, 120)}${suffix}`)
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
    state.stats.watchdogWarns += 1
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
    state.stats.watchdogInterrupts += 1
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
    // A subagent never delivers it: the child is folded with its parent, and a second PostToolUse
    // stream would record the same tool call twice under a turn scale nobody runs.
    if (isInert() || !config.loopguard) return
    if (!state.engineEnabled) return
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
    // A subagent session is never exported: the engine folds the child through its parent, and a
    // separate child transcript in `dsh-sessions/` makes the fold count the child's turns twice.
    if (!state.engineEnabled) return
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
    // A delegated child has no transcript of its own as far as the engine is concerned: its work
    // is folded through the parent, so a distinct child file would be counted a second time.
    // Silent, unlike the `exportSessions: false` notice below — this is a deliberate asymmetry,
    // not a misconfiguration to report.
    if (!state.engineEnabled) return ''
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
    if (!state.engineEnabled) {
      // The memory levers ran for this child; the engine path never did. Drop the state without
      // a SessionEnd hook, without an export, and without the fold it would trigger.
      sessions.delete(state.sid)
      return
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
  /**
   * Resolve one session's project identity, adopting an existing engine bucket rather than
   * orphaning it.
   *
   * The engine's `repos/<key>/` directories are durable data. `lib/identity.js` computes an
   * identity key from the same facts the engine uses, but its own header records that the engine's
   * canonicalization cannot be verified from this host — so a freshly computed key is never
   * trusted over a bucket that is already on disk. The resolution order is:
   *
   *   1. the persisted identity record for this project, when one was written before;
   *   2. the legacy `repoKeyFor()` key, when that bucket exists on disk (adopted onto the record);
   *   3. the resolved identity key itself, for a project the engine has never seen.
   *
   * Adoption writes a shim, not a move: the bucket keeps its directory and its contents, and the
   * identity record gains the legacy key in `legacyKeys`, so a later reader can reach the same data
   * through either name. A resolution that would silently re-partition history is the failure this
   * function exists to prevent.
   * @param {object} header - the immutable session header.
   * @param {string} liveDir - the session's current directory.
   * @returns {object} the identity record plus `engineRepoKey` and `identityKey`.
   */
  function resolveSessionIdentity(header, liveDir) {
    const root = stateHome || stateRoot(createEnv())
    let persisted = []
    let legacyKey = ''
    try {
      legacyKey = repoKeyFor(liveDir)
    } catch {
      legacyKey = ''
    }
    try {
      const known = identityKeyOf(resolveIdentity(header, liveDir, [], { env: createEnv() }))
      if (known) {
        const stored = readIdentity(root, known)
        if (stored) persisted = [stored]
      }
    } catch {
      /* a resolution failure leaves `persisted` empty; the legacy path below still decides */
    }
    let record
    try {
      record = resolveIdentity(header, liveDir, persisted, { env: createEnv() })
    } catch (error) {
      settingsWarn(`identity: resolution failed (${error instanceof Error ? error.message : String(error)}); using the legacy engine key`)
      record = { schemaVersion: 1, projectDir: liveDir, liveDir, identityKey: null, legacyKeys: [], resolvedBy: 'unanchored' }
    }
    const legacyExists = legacyKey !== '' && existsSync(join(root, 'repos', legacyKey))
    let engineRepoKey = legacyKey
    if (record.identityKey && legacyExists && record.identityKey !== legacyKey) {
      // The bucket on disk wins. Adopt it so both names reach the same data.
      try {
        adoptLegacyKey(root, record.identityKey, legacyKey)
      } catch (error) {
        settingsWarn(`identity: could not record the legacy key ${legacyKey} (${error instanceof Error ? error.message : String(error)})`)
      }
      engineRepoKey = legacyKey
    } else if (!legacyKey && record.identityKey) {
      engineRepoKey = record.identityKey
    }
    try {
      if (record.identityKey) writeIdentity(root, record)
    } catch (error) {
      settingsWarn(`identity: could not persist the record (${error instanceof Error ? error.message : String(error)})`)
    }
    return { ...record, engineRepoKey }
  }

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
    if (state.stats !== null && typeof state.stats === 'object') {
      state.stats.notices += 1
      state.stats.updatedAt = Date.now()
    }
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
