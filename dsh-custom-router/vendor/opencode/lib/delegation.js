/**
 * Managed child-session delegation for the `opencode` tool and the `/ocode` command.
 *
 * Owner decision (2026-11-05): a CLI-worker plugin must not spawn a bare
 * `opencode run` process for a conversation delegation. The bare process is
 * invisible to the harness: it gets no DSH session, no lineage, no catalog
 * membership, and its work shows up as an orphan ("그룹 없음" in the sidebar).
 * The `opencode` tool and `/ocode` now start a managed child session through
 * `ctx.subagents.startActivation(...)` with this package's own registered
 * `opencode` provider and `delivery: 'parent'`:
 *
 *   - the tool returns the child id immediately (the model keeps working),
 *   - the child's result is delivered to the parent as a completion notice,
 *   - the child is a real DSH session with a parent, so it belongs in the tree.
 *
 * Everything here is a pure function of its inputs except `startChildSession`,
 * whose only side effect is the activation it is asked to start. The spawn path
 * in `lib/index.js` (`runOpencode`) survives only as the emergency fallback that
 * `DSH_OPENCODE_SPAWN_FALLBACK=1` enables explicitly; nothing calls it by default.
 *
 * @module @nolit/dsh-opencode-v2/delegation
 */

/** Environment variable that re-enables the bare-process fallback. Explicit, opt-in, logged. */
export const FALLBACK_ENV = 'DSH_OPENCODE_SPAWN_FALLBACK'

/** Delivery policy: the child's result is delivered to the parent as a notice, not awaited. */
export const CHILD_DELIVERY = 'parent'

/** Default provider name this package registers (mirrors `Config.subagentProviderName`). */
export const DEFAULT_PROVIDER_NAME = 'opencode'

/** Longest label retained for the child catalog row. */
export const MAX_LABEL_CHARS = 80

/**
 * Tool arguments that cannot be honored per call in child-session mode: the
 * child runs on the provider's configured route, not on a per-call override.
 * They stay declared for callers of the old signature and are rejected with a
 * message that names the config key instead of being silently ignored.
 */
export const CHILD_UNSUPPORTED_ARGS = Object.freeze([
  'model',
  'agent',
  'session',
  'continueLast',
  'auto',
  'thinking',
  'files',
])

/** Typed failure with a stable code, so callers can choose tool error vs command errors. */
export class DelegationError extends Error {
  /**
   * @param {string} code - stable machine-readable reason.
   * @param {string} message - operator-facing text.
   * @param {object} [options] - `{ cause }`.
   */
  constructor(code, message, options = {}) {
    super(message, options)
    this.name = 'DelegationError'
    this.code = code
  }
}

/**
 * Read one config field that may be a schemastery Volatile or a plain value.
 * @param {unknown} config - plugin config.
 * @param {string} key - field name.
 * @returns {unknown} the current value.
 */
function configValue(config, key) {
  try {
    const field = config?.[key]
    return field !== null && typeof field === 'object' && typeof field.get === 'function'
      ? field.get()
      : field
  } catch {
    return undefined
  }
}

/**
 * Provider name this package delegates to.
 * @param {unknown} config - plugin config.
 * @returns {string} the provider registry name.
 */
export function providerNameOf(config) {
  const value = configValue(config, 'subagentProviderName')
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : DEFAULT_PROVIDER_NAME
}

/**
 * Whether the explicit bare-process emergency fallback is enabled.
 * @param {Record<string, string | undefined>} [env] - environment to read.
 * @returns {boolean} true when `DSH_OPENCODE_SPAWN_FALLBACK` is truthy.
 */
export function fallbackEnabled(env = process.env) {
  return ['1', 'true', 'yes', 'on'].includes(String(env?.[FALLBACK_ENV] ?? '').trim().toLowerCase())
}

/**
 * Collapse one prompt into a single-line label.
 * @param {string} prompt - the task text.
 * @returns {string} a bounded label.
 */
export function labelFromPrompt(prompt) {
  const line = String(prompt ?? '').replace(/\s+/g, ' ').trim()
  if (line.length <= MAX_LABEL_CHARS) return line
  return `${line.slice(0, MAX_LABEL_CHARS - 1).trimEnd()}…`
}

/**
 * The catalog label of one activation: the explicit title, else the task's first line.
 * @param {{ title?: unknown, prompt?: unknown, label?: unknown }} args - tool/command input.
 * @returns {string} a non-empty bounded label.
 */
export function activationLabel(args) {
  for (const candidate of [args?.label, args?.title]) {
    if (typeof candidate === 'string' && candidate.trim() !== '') {
      const line = candidate.replace(/\s+/g, ' ').trim()
      return line.length <= MAX_LABEL_CHARS ? line : `${line.slice(0, MAX_LABEL_CHARS - 1).trimEnd()}…`
    }
  }
  return labelFromPrompt(args?.prompt) || 'opencode delegation'
}

/**
 * Convert one prompt string into the child's initial user message.
 * @param {unknown} prompt - the task text.
 * @returns {Array<{type: 'text', text: string}>} content blocks.
 * @throws {DelegationError} when the prompt is empty.
 */
export function promptBlocks(prompt) {
  const text = typeof prompt === 'string' ? prompt.trim() : ''
  if (text === '') {
    throw new DelegationError('empty-prompt', 'opencode delegation requires a non-empty prompt')
  }
  return [{ type: 'text', text }]
}

/**
 * List the supplied tool arguments that child-session mode cannot honor.
 * A value counts as supplied when it is not `undefined`, `null`, `false`, `''`
 * or an empty array.
 * @param {Record<string, unknown>} args - the tool arguments.
 * @returns {string[]} the unsupported names, in declaration order.
 */
export function unsupportedChildArgs(args) {
  const used = []
  for (const name of CHILD_UNSUPPORTED_ARGS) {
    const value = args?.[name]
    if (value === undefined || value === null || value === false) continue
    if (typeof value === 'string' && value.trim() === '') continue
    if (Array.isArray(value) && value.length === 0) continue
    used.push(name)
  }
  return used
}

/**
 * The explicit refusal used when no managed child session can be started.
 * @param {string} providerName - the provider this package registers.
 * @returns {string} the message.
 */
export function unavailableMessage(providerName) {
  return 'opencode delegation could not start a managed child session: this host exposes no `subagents` service, '
    + `so the "${providerName}" delegation provider is not mounted. Refusing to spawn an untracked opencode process. `
    + `Configure the host with the subagent service, or set ${FALLBACK_ENV}=1 for the documented emergency `
    + 'bare-process fallback (its work will not appear as a child session).'
}

/**
 * The message used when the subagent service exists but this package's provider is not registered.
 * @param {string} providerName - the expected provider name.
 * @returns {string} the message.
 */
export function providerMissingMessage(providerName) {
  return `opencode delegation provider "${providerName}" is not registered: the subagent surface is disabled `
    + '(config `subagent: false`), or a superseded package still owns the name. No child session was started; '
    + 'an untracked CLI process was not spawned.'
}

/**
 * Start one managed child session and return its identity.
 *
 * The activation's `result` promise is owned by the subagent manager (delivery
 * `parent`), so this function never awaits it: the caller returns the child id
 * immediately and the outcome arrives later as a completion notice.
 * @param {{
 *   subagents: object | null | undefined,
 *   providerName: string,
 *   label: string,
 *   prompt: unknown,
 *   parent: object | null | undefined,
 *   cwd?: string | undefined,
 *   signal?: AbortSignal | undefined,
 * }} options - the activation inputs.
 * @returns {Promise<{ childId: string, provider: string, activation: object }>} the started child.
 * @throws {DelegationError} when the service, provider, parent, prompt, or start fails.
 */
export async function startChildSession(options) {
  const { subagents, providerName, label, prompt, parent, cwd, signal } = options ?? {}
  if (subagents === null || subagents === undefined || typeof subagents.startActivation !== 'function') {
    throw new DelegationError('unavailable', unavailableMessage(String(providerName)))
  }
  if (parent === null || parent === undefined) {
    throw new DelegationError(
      'no-parent',
      'opencode delegation requires the calling agent; it was not passed to the tool or command handler',
    )
  }
  if (signal?.aborted === true) {
    throw new DelegationError('aborted', 'opencode delegation was cancelled before the child session started')
  }
  if (typeof subagents.getProvider === 'function' && subagents.getProvider(providerName) === undefined) {
    throw new DelegationError('provider-missing', providerMissingMessage(String(providerName)))
  }
  const blocks = promptBlocks(prompt)
  const controller = signal === undefined || signal === null ? new AbortController() : null
  // The activation spec is FLAT as of DSH 0.2.1-rc.2, which removed the nested
  // `request` field (upgrade-guide `v0.2.1-rc.2/subagent-activation-options`).
  // Sending the old `request: {prompt,parent,cwd}` leaves `spec.parent`
  // undefined and the host service fails in `startActivation()` with
  // "Cannot read properties of undefined (reading 'id')" before any provider
  // runs. Measured live 2026-11-13 on DSH 0.2.2-rc.3.
  const spec = {
    provider: providerName,
    label: String(label ?? '').trim() || activationLabel({ prompt }),
    prompt: blocks,
    parent,
    signal: signal ?? controller.signal,
    delivery: CHILD_DELIVERY,
  }
  if (typeof cwd === 'string' && cwd.trim() !== '') spec.cwd = cwd.trim()
  let activation
  try {
    activation = await subagents.startActivation(spec)
  } catch (error) {
    throw new DelegationError(
      'start-failed',
      `opencode delegation could not start its child session: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    )
  }
  const childId = activation?.childId === undefined || activation?.childId === null
    ? ''
    : String(activation.childId)
  if (childId === '') {
    throw new DelegationError('no-child-id', 'the subagent activation returned no child id')
  }
  return { childId, provider: String(providerName), activation }
}

/**
 * Model-facing text for one started child session.
 * @param {{ provider: string, childId: string }} started - the started child.
 * @returns {string} the text.
 */
export function activationText(started) {
  return `started opencode child session ${started.childId} (provider ${started.provider}). `
    + 'The result will arrive as a completion notice; continue with other work instead of waiting.'
}

/**
 * Model-facing text for the emergency bare-process fallback.
 * @param {string} legacyText - the legacy run summary.
 * @returns {string} the text, prefixed with the explicit fallback warning.
 */
export function fallbackText(legacyText) {
  return `WARNING: ${FALLBACK_ENV}=1 — ran opencode as a bare process instead of a managed child session. `
    + 'This work will not appear as a child session.\n\n'
    + String(legacyText ?? '')
}
