/**
 * CLI-worker delegation through the managed subagent seam.
 *
 * Owner decision 2026-11-05: `/agy` and `agy_worker` must not spawn a bare
 * `agy` process. A bare process is invisible to the harness, so the work does
 * not appear as a tracked child session (the owner measured sessions piling up
 * in the sidebar's ungrouped bucket). Every CLI worker call now starts a
 * managed child through `ctx.subagents.startActivation` with the provider this
 * plugin already registers (`subagentProviderName`, default `antigravity`) and
 * `delivery: 'parent'`:
 *
 *   - the tool/command returns the child session id immediately;
 *   - the answer (or failure) arrives later as a completion notice;
 *   - the activation manager owns the child's lifecycle, so this module keeps
 *     no result/dispose handle (same shape the shipped `subagent_oar` tool uses).
 *
 * When the subagent service or the provider is missing, the call fails with a
 * message that names the missing dependency. It never falls back to a bare
 * process: an untracked process is exactly the defect this module removes.
 *
 * @module @nolit/dsh-antigravity/cli-activation
 */
import { configValue } from './settings.js'

/** Default registered provider name. */
export const DEFAULT_SUBAGENT_PROVIDER = 'antigravity'

/** Longest label persisted for one activation. */
export const MAX_LABEL_CHARS = 80

/**
 * A CLI-worker request that cannot be turned into a managed child session.
 * The message is user-facing: it names the missing dependency and the switch
 * that controls it.
 */
export class CliDelegationError extends Error {
  /**
   * @param message - user-facing diagnostic.
   * @param options - standard error options (cause).
   */
  constructor(message, options) {
    super(message, options)
    this.name = 'CliDelegationError'
  }
}

/**
 * Registered subagent provider name used by the CLI worker.
 * @param {object} config - reactive or plain plugin config.
 * @returns {string} the provider name.
 */
export function cliProviderName(config) {
  return String(configValue(config, 'subagentProviderName') || DEFAULT_SUBAGENT_PROVIDER)
}

/**
 * Derive the short child label from the task's first line.
 * @param {string} prompt - task text.
 * @returns {string} a bounded label.
 */
export function labelFromPrompt(prompt) {
  const firstLine = String(prompt ?? '')
    .split('\n')
    .map((line) => line.trim())
    .find((line) => line !== '')
  const fallback = 'agy task'
  if (firstLine === undefined) return fallback
  return firstLine.length > MAX_LABEL_CHARS ? `${firstLine.slice(0, MAX_LABEL_CHARS - 1)}…` : firstLine
}

/**
 * Assert that the managed delegation path is available.
 * @param {object} options - dependency check input.
 * @param {object} options.services - deferred services acquired from cordis.
 * @param {object} options.config - plugin config.
 * @returns {{subagents: object, providerName: string}} the runtime seam and provider name.
 * @throws {CliDelegationError} naming the missing dependency.
 */
export function assertDelegationAvailable(options) {
  const subagents = options.services?.subagents
  if (!subagents || typeof subagents.startActivation !== 'function') {
    throw new CliDelegationError(
      'the Antigravity CLI worker now runs as a managed child session, but the shared '
      + 'subagent service (ctx.subagents) is not mounted. Enable the plugin\'s "subagent" '
      + 'surface and use a profile that provides @deepseek-ai/dsh-subagent. No process was spawned.',
    )
  }
  const providerName = cliProviderName(options.config)
  if (typeof subagents.getProvider === 'function' && !subagents.getProvider(providerName)) {
    throw new CliDelegationError(
      `the Antigravity CLI worker needs the registered subagent provider "${providerName}", `
      + 'but no provider with that name is mounted. Enable the plugin\'s "subagent" surface '
      + '(or stop the older plugin that claimed that name). No process was spawned.',
    )
  }
  return { subagents, providerName }
}

/**
 * Start one managed child session for a CLI worker call and return immediately.
 * @param {object} options - delegation input.
 * @param {object} options.services - deferred services acquired from cordis.
 * @param {object} options.config - plugin config.
 * @param {string} options.prompt - task text.
 * @param {object} options.agent - the calling Agent (`exec.agent` / command `agent`).
 * @param {AbortSignal} [options.signal] - caller cancellation.
 * @param {string} [options.cwd] - optional child directory; omitted inherits the parent's.
 * @returns {Promise<{childId: string, messageId: string, provider: string, label: string}>} the activation facts.
 * @throws {CliDelegationError} when a dependency or the activation start is missing.
 */
export async function startCliChild(options) {
  const prompt = String(options.prompt ?? '').trim()
  if (prompt === '') {
    throw new CliDelegationError('the Antigravity CLI worker requires a non-empty task.')
  }
  const { subagents, providerName } = assertDelegationAvailable(options)
  if (!options.agent) {
    throw new CliDelegationError(
      'the Antigravity CLI worker needs the calling agent to attach a child session '
      + '(no agent was provided by this invocation). No process was spawned.',
    )
  }

  const request = {
    parent: options.agent,
    prompt: [{ type: 'text', text: prompt }],
  }
  const cwd = String(options.cwd ?? '').trim()
  if (cwd !== '') request.cwd = cwd
  const label = labelFromPrompt(prompt)
  const signal = options.signal ?? new AbortController().signal

  let activation
  try {
    activation = await subagents.startActivation({
      provider: providerName,
      label,
      request,
      signal,
      delivery: 'parent',
    })
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error)
    throw new CliDelegationError(`could not start the Antigravity child session: ${detail}`, { cause: error })
  }

  const childId = String(activation?.childId ?? '')
  if (childId === '') {
    throw new CliDelegationError(
      'the subagent service accepted the activation but returned no child session id; '
      + 'the task was not delegated.',
    )
  }
  return {
    childId,
    messageId: String(activation?.messageId ?? ''),
    provider: providerName,
    label,
  }
}
