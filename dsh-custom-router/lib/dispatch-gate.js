/**
 * CLI-worker dispatch control plane — one gate and one reclaimer for every
 * external CLI the router can reach (AGY and OpenCode v2).
 *
 * WHY THIS LIVES IN THE ROUTER (measured 2026-11-08)
 *   The router is the only owner of the preset mounts, so it is the only place
 *   that knows every CLI surface it dispatched. Putting the check in each
 *   vendor package would mean two implementations that can drift, and a vendor
 *   mounted standalone would silently have no gate at all. The router already
 *   provides a runtime seam (`ctx.provide('customRouter')`); this module is
 *   that seam's dispatch face.
 *
 * TWO INDEPENDENT DUTIES
 *   1. **Admission** — may this call dispatch an external CLI under the calling
 *      session's preset and sandbox mode? Enforced as a `tools/pre-execute`
 *      listener, the same seam the shipped Auto-review and workspace-changes
 *      plugins use. A denial therefore produces the SAME model-facing outcome
 *      those produce (`{kind:'deny', reason}`), not a vendor-specific throw:
 *      the caller sees a normal tool error and nothing is spawned.
 *   2. **Reclamation** — a dispatched process is tracked against its owning
 *      session, and every tracking record is released when that session's agent
 *      is disposed, when the session is disposed, or when the router unloads.
 *      `terminate()` is the subprocess seam's own documented verb, so this
 *      module never invents a signalling scheme; it only decides WHEN to call
 *      it.
 *
 * WHAT ADMISSION DOES NOT CLAIM
 *   The sandbox governs file effects, not process creation (measured: a
 *   read-only session can spawn `dsh`/`opencode` and only its WRITES are
 *   denied). This gate is therefore the only thing that stops a restricted
 *   session from outsourcing work to an external CLI, and it does so by
 *   refusing the tool call rather than by hoping the child confines itself.
 *
 * @module @nolit/dsh-custom-router/dispatch-gate
 */

/** Presets under which an external CLI may not be dispatched. */
export const RESTRICTED_PRESETS = Object.freeze(['minimal'])

/** Sandbox modes treated as restricted (everything except full access). */
export const RESTRICTED_SANDBOX_MODES = Object.freeze(['read-only', 'workspace-write'])

/** The exact refusal text the model and the audit log receive. */
export const DISPATCH_DENIED_REASON =
  'Disallowed: CLI worker invocation blocked under restricted sandbox/preset'

/**
 * Normalize "an Agent or a Session" to the Session the registry keys on.
 *
 * MEASURED (2026-11-08): the delegation providers hold the PARENT AGENT at
 * `request.parent`, while the lifecycle edges (`agent/disposed`,
 * `session/disposed`) deliver a SESSION. Keying the registry by whichever object
 * happens to arrive would make reclamation silently never match, so every entry
 * point funnels through this function: a tracked worker is always filed under a
 * Session, and a disposal lookup always asks for one.
 * @param {unknown} candidate - an Agent, a Session, or nothing.
 * @returns {object|undefined} the Session, when one can be identified.
 */
export function sessionOf(candidate) {
  // Bounded walk, not a single shape test. The identity may arrive as a Session,
  // an Agent, or an Agent wrapped by a caller that mis-specified the seam. A
  // single-level test missed the measured defect (a `{agent:{session:Agent}}`
  // wrapper normalized to `undefined`, which reads as "no restriction" and
  // silently ALLOWED a restricted session), so the walk keeps unwrapping until
  // it finds a Session or runs out of plausible links.
  //
  // The depth cap exists because the input is caller-controlled and may be
  // cyclic; four links covers every shape this codebase produces
  // (wrapper -> agent -> session -> header).
  let current = candidate
  for (let depth = 0; depth < 4; depth += 1) {
    if (current === null || typeof current !== 'object') return undefined
    // A Session is identified by its `header`, which an Agent does not carry.
    if (current.header !== undefined) return current
    // Prefer `session` (the Agent link) over `agent` (the wrapper link): a tool
    // execution carries both, and its `session` is the authoritative one.
    const next = current.session !== null && typeof current.session === 'object'
      ? current.session
      : (current.agent !== null && typeof current.agent === 'object' ? current.agent : undefined)
    if (next === undefined || next === current) return undefined
    current = next
  }
  return undefined
}

/**
 * Read a value that may be a Cordis reactive ref rather than a plain value.
 * @param {unknown} entry - config entry.
 * @param {unknown} fallback - value used when absent.
 * @returns {unknown} the plain value.
 */
function configValue(entry, fallback) {
  if (entry !== null && typeof entry === 'object' && typeof entry.get === 'function') {
    const value = entry.get()
    return value === undefined ? fallback : value
  }
  return entry === undefined ? fallback : entry
}

/**
 * Resolve the dispatch policy of one session from the host services that own
 * the facts. Every read is defensive: a profile that composes the router
 * without `agentPresets` or `sandboxPolicy` still answers, and an unknown
 * sandbox mode is treated as restricted (fail closed).
 * @param {object} ctx - cordis context exposing the host services.
 * @param {object} [session] - the calling session, when the caller has one.
 * @returns {{restricted: boolean, preset: string|null, sandboxMode: string|null, causes: string[]}} the decision facts.
 */
export function resolveDispatchPolicy(ctx, session) {
  const causes = []
  /** @type {string|null} */
  let preset = null
  /** @type {string|null} */
  let sandboxMode = null

  if (session !== undefined && session !== null) {
    try {
      const presets = ctx?.get?.('agentPresets')
      if (presets !== undefined && typeof presets.presetForSession === 'function') {
        preset = presets.presetForSession(session) ?? null
      }
    } catch {
      // A missing projection must not grant dispatch; the sandbox check below
      // still applies, and an unknown preset is not itself a restriction.
    }
    try {
      const policy = ctx?.get?.('sandboxPolicy')
      if (policy !== undefined && typeof policy.resolve === 'function') {
        const resolved = policy.resolve({ session })
        sandboxMode = typeof resolved?.mode === 'string' ? resolved.mode : null
      } else if (policy !== undefined && typeof policy.overrideOf === 'function') {
        sandboxMode = policy.overrideOf(session) ?? null
      }
    } catch {
      // Left null; the fail-closed default below turns that into a restriction
      // only when the deployment actually confines (see `confines`).
    }
  }

  if (preset !== null && RESTRICTED_PRESETS.includes(preset)) causes.push(`preset "${preset}"`)
  if (sandboxMode !== null && RESTRICTED_SANDBOX_MODES.includes(sandboxMode)) {
    causes.push(`sandbox "${sandboxMode}"`)
  }

  return { restricted: causes.length > 0, preset, sandboxMode, causes }
}

/**
 * Whether this deployment confines at all. A composition with no sandboxing
 * executor has no restricted mode to enforce, so the preset rule alone applies.
 * @param {object} ctx - cordis context.
 * @returns {boolean} true when a confining bash executor is mounted.
 */
export function deploymentConfines(ctx) {
  try {
    return ctx?.get?.('shell')?.sandboxMode !== undefined
  } catch {
    return false
  }
}

/**
 * The router's CLI-worker tool names, derived from the preset declarations so a
 * surface added to a preset is gated without editing this module.
 *
 * `subagent_*` tools are deliberately EXCLUDED: they start a managed in-process
 * child session whose own sandbox is inherited and enforced, so they are
 * already inside the boundary. This gate exists for the surfaces that reach an
 * EXTERNAL CLI binary.
 * @param {readonly object[]} presets - preset declarations.
 * @returns {Set<string>} tool names to gate.
 */
export function cliWorkerTools(presets) {
  const names = new Set()
  for (const preset of presets ?? []) {
    const tools = preset?.surfaces?.tools
    if (!Array.isArray(tools)) continue
    for (const tool of tools) if (typeof tool === 'string' && tool !== '') names.add(tool)
    const cli = preset?.surfaces?.cli
    if (typeof cli?.toolName === 'string' && cli.toolName !== '') names.add(cli.toolName)
    const batch = preset?.surfaces?.batch
    if (typeof batch?.toolName === 'string' && batch.toolName !== '') names.add(batch.toolName)
  }
  // `opencode` is the OpenCode v2 model-facing tool name; a declaration that
  // renames its `cli` surface must still leave the shipped name gated.
  names.add('cli_worker')
  names.add('agy_worker')
  names.add('agy_cli')
  names.add('opencode')
  return names
}

/**
 * Normalize the operator's gate configuration.
 *
 * `enabled` defaults to TRUE: a control plane that must be switched on is a
 * control plane that is off in every profile that never heard of it. An
 * operator who genuinely wants unrestricted external dispatch opts out
 * explicitly, and this module records that in the denial path's counterpart.
 * @param {unknown} config - the row config (reactive or plain).
 * @returns {{enabled: boolean, restrictedPresets: string[], restrictedModes: string[]}} normalized gate config.
 */
export function gateConfig(config) {
  const raw = configValue(config?.cliDispatchGate, undefined)
  if (raw === undefined || raw === null) {
    return {
      enabled: true,
      restrictedPresets: [...RESTRICTED_PRESETS],
      restrictedModes: [...RESTRICTED_SANDBOX_MODES],
    }
  }
  const enabled = configValue(raw?.enabled, true) !== false
  const presets = configValue(raw?.restrictedPresets, undefined)
  const modes = configValue(raw?.restrictedModes, undefined)
  // MEASURED HAZARD (2026-11-08): the settings schema materialises `[]` for an
  // absent array field. An empty list means "restrict nothing", so treating it
  // as a configured value would silently turn the gate off for every profile
  // that never set the field. An EMPTY list therefore falls back to the shipped
  // defaults; an operator who truly wants no preset rule must say so explicitly
  // with `enabled: false` (which warns) or name a value.
  const listedPresets = Array.isArray(presets) && presets.length > 0
    ? presets.filter((id) => typeof id === 'string')
    : [...RESTRICTED_PRESETS]
  const listedModes = Array.isArray(modes) && modes.length > 0
    ? modes.filter((mode) => typeof mode === 'string')
    : [...RESTRICTED_SANDBOX_MODES]
  return {
    enabled,
    restrictedPresets: listedPresets,
    restrictedModes: listedModes,
  }
}

/**
 * Decide one dispatch attempt against an explicit policy set.
 *
 * Split from {@link resolveDispatchPolicy} so tests (and the client) can pin the
 * decision without composing host services, and so the same rule serves the
 * registry's pre-start assertion.
 * @param {{preset: string|null, sandboxMode: string|null}} facts - measured session facts.
 * @param {{restrictedPresets?: string[], restrictedModes?: string[]}} policy - active restriction sets.
 * @returns {{allowed: boolean, causes: string[]}} the decision.
 */
export function decideDispatch(facts, policy = {}) {
  const restrictedPresets = policy.restrictedPresets ?? RESTRICTED_PRESETS
  const restrictedModes = policy.restrictedModes ?? RESTRICTED_SANDBOX_MODES
  const causes = []
  if (typeof facts?.preset === 'string' && restrictedPresets.includes(facts.preset)) {
    causes.push(`preset "${facts.preset}"`)
  }
  if (typeof facts?.sandboxMode === 'string' && restrictedModes.includes(facts.sandboxMode)) {
    causes.push(`sandbox "${facts.sandboxMode}"`)
  }
  return { allowed: causes.length === 0, causes }
}

/**
 * A session-scoped registry of dispatched external CLI work.
 *
 * One record is `{ session, label, terminate, cancelled }`. Reclamation is
 * idempotent and never throws: a handle that already settled has nothing to
 * terminate, and a failed teardown must not block the next one.
 */
export class CliWorkerRegistry {
  /**
   * @param {object} ctx - cordis context, used for lifecycle listeners.
   * @param {object} [options] - `{ warn }`.
   */
  constructor(ctx, options = {}) {
    this.ctx = ctx
    this.warn = typeof options.warn === 'function' ? options.warn : () => {}
    /** @type {Set<object>} */
    this.records = new Set()
    /** @type {WeakMap<object, Set<object>>} */
    this.bySession = new WeakMap()
    this.released = false
  }

  /**
   * Register one dispatched handle against its owning session.
   *
   * The returned disposer is what a caller runs when the work settles normally;
   * registering a handle whose signal is already aborted terminates it at once
   * rather than leaving a process nobody will reap.
   * @param {object} session - owning session (may be undefined for agentless calls).
   * @param {object} handle - the subprocess seam handle (`terminate`/`done`).
   * @param {string} [label] - short diagnostic label.
   * @returns {() => void} idempotent release.
   */
  track(owner, handle, label = 'cli worker') {
    const session = sessionOf(owner)
    if (this.released) {
      // The router unloaded while a caller still holds the seam: refuse to leak
      // rather than registering into a dead registry.
      try {
        handle?.terminate?.()
      } catch {
        /* already settled */
      }
      return () => {}
    }
    const record = { session, handle, label, released: false }
    this.records.add(record)
    /** Drop this record without signalling (the handle already settled). */
    const release = () => {
      if (record.released) return
      record.released = true
      this.records.delete(record)
      const set = session === undefined || session === null ? undefined : this.bySession.get(session)
      set?.delete(record)
    }
    if (session !== undefined && session !== null) {
      let set = this.bySession.get(session)
      if (set === undefined) {
        set = new Set()
        this.bySession.set(session, set)
      }
      set.add(record)
    }
    // A handle that already settled still needs its record dropped, otherwise a
    // long session accumulates one dead entry per call.
    try {
      Promise.resolve(handle?.done).then(
        () => release(),
        () => release(),
      )
    } catch {
      /* a handle without `done` is released by the caller */
    }
    return release
  }

  /**
   * Terminate every record owned by one session.
   * @param {object} session - the session being reclaimed.
   * @param {string} [reason] - diagnostic label.
   * @returns {number} how many handles were signalled.
   */
  reclaimSession(owner, reason = 'session ended') {
    const session = sessionOf(owner)
    if (session === undefined) return 0
    const set = this.bySession.get(session)
    if (set === undefined) return 0
    let count = 0
    for (const record of [...set]) {
      try {
        record.handle?.terminate?.()
        count += 1
      } catch (error) {
        this.warn(`dsh-custom-router: ${record.label} termination failed (${reason}): ${error instanceof Error ? error.message : String(error)}`)
      }
      record.released = true
      this.records.delete(record)
      set.delete(record)
    }
    return count
  }

  /**
   * Terminate every tracked handle and stop accepting new ones.
   * @param {string} [reason] - diagnostic label.
   * @returns {number} how many handles were signalled.
   */
  dispose(reason = 'router unloaded') {
    if (this.released) return 0
    this.released = true
    let count = 0
    for (const record of [...this.records]) {
      try {
        record.handle?.terminate?.()
        count += 1
      } catch {
        /* already settled */
      }
      record.released = true
    }
    this.records.clear()
    this.bySession = new WeakMap()
    if (count > 0) this.warn(`dsh-custom-router: reclaimed ${count} CLI worker process(es) (${reason})`)
    return count
  }

  /** How many handles are currently tracked (diagnostics and tests). */
  get size() {
    return this.records.size
  }
}

/**
 * Bind a registry to the host lifecycle so a session that ends -- or a router
 * that unloads -- reclaims its external workers.
 *
 * The listeners are the shipped lifecycle edges: `agent/disposed` for one
 * session's agent, `session/disposed` for the Session store's teardown, and the
 * router's own disposer for a reload. `ctx.effect` scopes all three, so a hot
 * reload of this row cannot leave duplicate listeners behind.
 * @param {object} ctx - cordis context.
 * @param {CliWorkerRegistry} registry - registry to bind.
 * @returns {() => void} explicit unbind (the effect disposer also does this).
 */
export function bindLifecycle(ctx, registry) {
  const offs = []
  const safely = (name, run) => {
    try {
      const off = ctx?.on?.(name, run)
      if (typeof off === 'function') offs.push(off)
    } catch {
      // A composition without that event simply has no such lifecycle edge.
    }
  }
  safely('agent/disposed', (payload) => {
    registry.reclaimSession(payload?.agent ?? payload, 'agent disposed')
  })
  safely('session/disposed', (session) => {
    registry.reclaimSession(session, 'session disposed')
  })
  return () => {
    for (const off of offs.splice(0)) {
      try {
        off()
      } catch {
        /* already released */
      }
    }
  }
}

/**
 * Install the router's CLI dispatch gate on the tools pipeline.
 *
 * The listener runs on the same `tools/pre-execute` waterfall the shipped
 * policy plugins use, so a denial is an ordinary `{kind:'deny'}` decision: the
 * model sees a tool error, the audit log records it, and no vendor code runs.
 *
 * Ordering: registered with `prepend`, because a restriction that is checked
 * after a vendor's own admission work has already cost that work. It still
 * yields to an earlier `deny` via `next()` when it allows the call.
 * @param {object} ctx - cordis context.
 * @param {object} options - `{ presets, config, warn }`.
 * @returns {() => void} the disposer.
 */
export function installDispatchGate(ctx, options = {}) {
  const { presets = [], config = {}, warn = () => {} } = options
  const tools = cliWorkerTools(presets)
  const gate = gateConfig(config)
  if (!gate.enabled) {
    warn('dsh-custom-router: CLI dispatch gate is disabled by configuration; restricted sessions may dispatch external CLI workers')
    return () => {}
  }
  const confines = deploymentConfines(ctx)
  const listener = async (exec, next) => {
    const name = exec?.name
    if (typeof name !== 'string' || !tools.has(name)) return next()
    const agent = exec?.agent
    const session = agent?.session
    if (session === undefined || session === null) {
      // An agentless call has no preset and no session policy; the deployment
      // default is the only fact available, and an unconfined deployment has
      // nothing to restrict.
      if (!confines) return next()
      const policy = ctx?.get?.('sandboxPolicy')
      const mode = policy?.defaultMode
      const decision = decideDispatch({ preset: null, sandboxMode: mode ?? null }, gate)
      if (decision.allowed) return next()
      return { kind: 'deny', reason: `${DISPATCH_DENIED_REASON} (${decision.causes.join(', ')})` }
    }
    const facts = resolveDispatchPolicy(ctx, session)
    const decision = decideDispatch(facts, gate)
    if (decision.allowed) return next()
    // The neutralization of autonomous bypass flags (`--auto`,
    // `--dangerously-skip-permissions`) is structural: this decision lands
    // BEFORE the tool body, so no argv is ever built and no flag can be read.
    return { kind: 'deny', reason: `${DISPATCH_DENIED_REASON} (${decision.causes.join(', ')})` }
  }
  let off
  try {
    off = ctx?.on?.('tools/pre-execute', listener, { prepend: true })
  } catch (error) {
    warn(`dsh-custom-router: CLI dispatch gate could not be installed: ${error instanceof Error ? error.message : String(error)}`)
    return () => {}
  }
  return () => {
    try {
      off?.()
    } catch {
      /* already released */
    }
  }
}
