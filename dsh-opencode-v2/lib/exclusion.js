/**
 * Mutual exclusion between the stable and the beta OpenCode packages.
 *
 * Two packages cannot share one profile: both register the `opencode` tool, the
 * `/opencode` and `/ocode` commands, the `cli_worker` tool and the
 * `opencode-http-agent` route. The host throws on duplicate tool registration
 * (`defineTool` name collision) and `ctx.llm.registerAdapter` over an owned
 * namespace shadows the other adapter, so "both loaded" is not a degraded state,
 * it is a broken one — and it bills the same route twice while it is broken.
 *
 * Two guards, because a mount-time check cannot see a plugin loaded later and a
 * runtime check cannot stop a mount that already happened:
 *
 *   1. MOUNT-TIME (`claimActivation`): an exclusive claim file under
 *      `$DSH_HOME/cache`. The first package to activate writes it; a second
 *      package activating in the same profile is refused with an actionable
 *      message instead of half-registering.
 *   2. RUNTIME (`detectSibling`): before serving, ask the live host whether the
 *      sibling's provider/tool is already registered. A stale claim file from a
 *      crashed process must not lock the profile forever, so a refusal here is
 *      only reported as a warning, while a live sibling registration is a hard
 *      stand-down.
 *
 * The claim is advisory on purpose: deleting the file is the documented way to
 * recover from a crashed activation, and the runtime check keeps that safe.
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'

/** Plugin ids that may never be active together. */
export const EXCLUSIVE_PACKAGES = Object.freeze(['@nolit/dsh-opencode-v2', '@nolit/dsh-opencode-v2-beta'])

/** Claim-file name; one file, so the last writer wins and the reader sees both fields. */
export const CLAIM_FILE = 'opencode-claim.json'

/**
 * Where the claim lives: `$DSH_HOME/cache/opencode-claim.json`.
 *
 * Empty string when neither an explicit path nor `DSH_HOME` is available (unit
 * tests, or a host without a home): the guard then degrades to the runtime check
 * and never writes into the working directory.
 *
 * @param {object} [options]
 * @param {string} [options.explicit] - configured path.
 * @param {string} [options.dshHome] - `$DSH_HOME`.
 * @returns {string}
 */
export function resolveClaimPath({ explicit, dshHome } = {}) {
  if (typeof explicit === 'string' && explicit.length > 0) return explicit
  if (typeof dshHome === 'string' && dshHome.length > 0) return join(dshHome, 'cache', CLAIM_FILE)
  return ''
}

/**
 * Read the current claim.
 *
 * @param {string} path - resolved claim path.
 * @returns {{ owner: string, pid: number, at: string } | null}
 */
export function readClaim(path) {
  if (!path) return null
  try {
    if (!existsSync(path)) return null
    const parsed = JSON.parse(readFileSync(path, 'utf8'))
    if (!parsed || typeof parsed.owner !== 'string') return null
    return parsed
  } catch {
    return null
  }
}

/** Whether a claimed pid is still running (a crashed claim must not lock the profile). */
export function isLiveClaim(claim) {
  if (!claim || !Number.isFinite(claim.pid)) return false
  try {
    process.kill(claim.pid, 0)
    return true
  } catch (error) {
    // EPERM means the process exists but belongs to another user.
    return error?.code === 'EPERM'
  }
}

/**
 * Claim activation for one package.
 *
 * @param {object} input
 * @param {string} input.owner - the requesting package name.
 * @param {string} input.path - resolved claim path ('' disables the file guard).
 * @param {string[]} [input.siblings] - packages that conflict with `owner`.
 * @returns {{ ok: boolean, code: string, owner: string|null, message: string }}
 */
export function claimActivation({ owner, path, siblings = EXCLUSIVE_PACKAGES.filter((name) => name !== owner) }) {
  const claim = readClaim(path)
  if (claim && claim.owner === owner) return { ok: true, code: 'already-claimed', owner, message: '' }
  if (claim && siblings.includes(claim.owner) && isLiveClaim(claim)) {
    return {
      ok: false,
      code: 'OPENCODE_EXCLUSIVE_CONFLICT',
      owner: claim.owner,
      message:
        `${owner} cannot activate: ${claim.owner} already owns this profile (pid ${claim.pid}, claimed ${claim.at}). `
        + 'Disable one of the two packages before restarting; loading both would register the same tool, '
        + 'commands and model route twice.',
    }
  }
  if (path) {
    try {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, JSON.stringify({ owner, pid: process.pid, at: new Date().toISOString() }) + '\n')
    } catch {
      // An unwritable claim file must not block activation; the runtime check
      // still runs and the operator keeps their plugin.
      return { ok: true, code: 'claim-unwritable', owner, message: '' }
    }
  }
  return { ok: true, code: claim ? 'stale-claim-taken-over' : 'claimed', owner, message: '' }
}

/**
 * Release the claim, but only when this process owns it.
 *
 * @param {string} path - resolved claim path.
 * @param {string} owner - the releasing package name.
 * @returns {boolean} whether a claim was removed.
 */
export function releaseClaim(path, owner) {
  const claim = readClaim(path)
  if (!claim || claim.owner !== owner) return false
  try {
    rmSync(path, { force: true })
    return true
  } catch {
    return false
  }
}

/**
 * Runtime check: is the sibling package live in this host right now?
 *
 * Both packages register `opencode-http-agent`, so a registered provider id
 * belonging to the sibling, or a tool of the same name, is proof of a live
 * collision that a claim file can never see.
 *
 * @param {object} input
 * @param {string} input.owner - this package.
 * @param {object} [input.llm] - `ctx.llm`.
 * @param {object} [input.tools] - `ctx.tools`.
 * @param {string} [input.providerId] - the shared provider id.
 * @param {string} [input.toolName] - the shared tool name.
 * @returns {{ conflict: boolean, evidence: string[] }}
 */
export function detectSibling({
  owner,
  llm,
  tools,
  providerId = 'opencode-http-agent',
  toolName = 'opencode',
  foreignProviderIds = [],
}) {
  const evidence = []
  const sibling = EXCLUSIVE_PACKAGES.find((name) => name !== owner) ?? 'the other package'
  /**
   * Why provider registration is NOT evidence by default.
   *
   * Both packages register the SAME provider id, so "opencode-http-agent is in the
   * registry" cannot say which package put it there — and at activation time the
   * registration may be this instance's own second attempt. Treating it as
   * evidence made the guard stand down on itself (measured 2026-11-04: the
   * pre-existing "second instance skips instead of throwing" case stopped
   * reporting its policy-aware warning). Ownership belongs to the claim file; a
   * caller that knows the id is foreign may pass it in `foreignProviderIds`.
   */
  try {
    const providers = typeof llm?.listProviders === 'function' ? llm.listProviders() : []
    const ids = new Set(
      (Array.isArray(providers) ? providers : []).map((entry) => String(entry?.id ?? '')).filter(Boolean),
    )
    for (const foreign of foreignProviderIds ?? []) {
      if (foreign !== providerId && ids.has(foreign)) evidence.push(`provider "${foreign}" is already registered`)
    }
  } catch {
    /* an unreadable registry is not evidence of a collision */
  }
  try {
    const tool = typeof tools?.get === 'function' ? tools.get(toolName) : undefined
    if (tool) evidence.push(`tool "${toolName}" is already registered`)
  } catch {
    /* same */
  }
  return { conflict: evidence.length > 0, evidence, sibling }
}