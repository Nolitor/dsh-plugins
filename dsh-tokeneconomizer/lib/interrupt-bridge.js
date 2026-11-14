/**
 * Bridge to the shared interrupt registry (total_skill commit ebd7540).
 *
 * The watchdog has to RECORD its interrupt before it cancels, so the turn-exit reason names
 * a system issuer instead of an anonymous abort. The registry therefore has to be loaded
 * before the first deadline fires, not inside it.
 *
 * Everything here is fail-open: a missing or broken registry never stops the watchdog from
 * cancelling the turn. The record is attribution, not control.
 *
 * ## Why the location is discovered, not hardcoded
 *
 * This module used to carry one absolute `file://` URL with the owner's home directory spelled
 * into it. That is one workstation written into a published artifact: a profile installed from
 * the npm tarball, a different user, or a checkout under another root all resolved to nothing,
 * and the only signal was a silently unrecorded interrupt. The registry is now located by
 * trying, in order:
 *
 *   1. `DSH_INTERRUPT_CORE_URL` / `DSH_INTERRUPT_REASONS_URL` (the documented override),
 *   2. `DSH_INTERRUPT_ROOT`, a checkout directory,
 *   3. the adjacent `total_skill` checkout next to this workspace,
 *   4. `~/Workspace/projects/total_skill`.
 *
 * When none of them carries both modules the recorder stays unloaded and every `record()` call
 * reports `recorded: false`; that is the same fail-open contract as before, minus the absolute
 * path. No filesystem probe throws.
 */
import { existsSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

/** File names the registry pair must provide under a candidate root. */
const CORE_RELATIVE = join('src', 'interrupt-core.js')
const REASONS_RELATIVE = join('src', 'reasons.js')

/** The issuer slug this bridge records. */
export const WATCHDOG_ISSUER = 'watchdog_timeout'

/**
 * The checkout roots searched when no option or environment variable names the registry.
 *
 * The order is "most likely to be the same machine's checkout" first: the projects directory
 * this package is checked out under, then the conventional home layout, which is what an
 * installed copy (no sibling checkout) can still hit.
 * @param {Record<string, string | undefined>} [env] - environment to read.
 * @returns {string[]} absolute candidate roots, without duplicates.
 */
export function interruptRootCandidates(env = process.env) {
  const out = []
  const add = (path) => {
    if (path && !out.includes(path)) out.push(path)
  }
  const explicit = env.DSH_INTERRUPT_ROOT
  if (typeof explicit === 'string' && explicit.trim()) add(resolve(explicit))
  try {
    // <projects>/dsh-workspace/dsh-plugins/dsh-tokeneconomizer/lib/interrupt-bridge.js
    const here = dirname(fileURLToPath(import.meta.url))
    add(resolve(here, '..', '..', '..', '..', 'total_skill'))
  } catch {
    /* a bundle without file URLs simply has no adjacent-checkout candidate */
  }
  const home = env.HOME && env.HOME.trim() ? env.HOME : homedir()
  add(join(home, 'Workspace', 'projects', 'total_skill'))
  return out
}

/**
 * Resolve the module URLs of the interrupt registry pair.
 *
 * An explicit option or environment URL wins unmatched and unverified (the caller said where it
 * is). Otherwise the first candidate root carrying both files wins. Nothing is imported here, so
 * a wrong answer costs one `import()` rejection later, not a throw now.
 * @param {object} [options] - overrides, mainly for tests.
 * @param {string} [options.coreUrl] - module URL of the interrupt core.
 * @param {string} [options.reasonsUrl] - module URL of the wording helpers.
 * @param {string[]} [options.roots] - explicit candidate roots, replacing discovery.
 * @param {Record<string, string | undefined>} [options.env] - environment to read.
 * @returns {{ coreUrl: string, reasonsUrl: string, root: string | null, found: boolean }}
 *   the pair to import, the root it was found under, and whether a checkout actually matched.
 */
export function resolveInterruptSources(options = {}) {
  const env = options.env ?? process.env
  const coreUrl = options.coreUrl ?? env.DSH_INTERRUPT_CORE_URL
  const reasonsUrl = options.reasonsUrl ?? env.DSH_INTERRUPT_REASONS_URL
  if (coreUrl || reasonsUrl) {
    // One half named explicitly must not silently borrow the other from another checkout.
    const root = null
    const paired = Boolean(coreUrl && reasonsUrl)
    return {
      coreUrl: coreUrl ?? '',
      reasonsUrl: reasonsUrl ?? '',
      root,
      found: paired,
      ...(paired ? {} : { detail: 'only one of the two module URLs was supplied' }),
    }
  }
  const roots = Array.isArray(options.roots) ? options.roots : interruptRootCandidates(env)
  for (const root of roots) {
    try {
      const core = join(root, CORE_RELATIVE)
      const reasons = join(root, REASONS_RELATIVE)
      if (!existsSync(core) || !existsSync(reasons)) continue
      return {
        coreUrl: pathToFileURL(core).href,
        reasonsUrl: pathToFileURL(reasons).href,
        root,
        found: true,
      }
    } catch {
      /* an unreadable candidate is not a reason to stop looking */
    }
  }
  return { coreUrl: '', reasonsUrl: '', root: null, found: false, detail: 'no interrupt registry checkout found' }
}

/**
 * Create one recorder.
 *
 * @param {object} [options] - overrides, mainly for tests.
 * @param {string} [options.coreUrl] - module URL of the interrupt core.
 * @param {string} [options.reasonsUrl] - module URL of the wording helpers.
 * @param {Record<string, string | undefined>} [options.env] - environment to read.
 * @returns {object} the recorder: `init()`, `record(scope, reason)`, `loaded`, `source`.
 */
export function createInterruptRecorder(options = {}) {
  const sources = resolveInterruptSources(options)
  let core = null
  let reasons = null

  const ready = (async () => {
    if (!sources.coreUrl || !sources.reasonsUrl) return
    try {
      const loaded = await Promise.all([import(sources.coreUrl), import(sources.reasonsUrl)])
      const loadedCore = loaded[0]
      if (typeof loadedCore?.interrupts?.requestInterrupt !== 'function') return
      core = loadedCore
      reasons = loaded[1]
    } catch {
      core = null
      reasons = null
    }
  })()

  return {
    /** Await the one-time load; safe to call repeatedly. */
    init: () => ready,
    /** @returns {boolean} whether the registry is usable. */
    get loaded() {
      return core !== null
    },
    /**
     * Where the registry was looked for. Read-only diagnostics: a profile that cannot record an
     * interrupt should be able to say which checkout it expected.
     * @returns {{ coreUrl: string, reasonsUrl: string, root: string | null, found: boolean }} the
     *   resolved sources.
     */
    get source() {
      return { ...sources }
    },
    /**
     * Record one interrupt synchronously. Callers cancel immediately after.
     * @param {string} scope - the agent id the interrupt belongs to.
     * @param {string} [reason] - the issuer slug.
     * @returns {object} `{ recorded, issuer?, wording?, detail? }`.
     */
    record(scope, reason = WATCHDOG_ISSUER) {
      if (core === null) return { recorded: false, detail: 'registry unavailable' }
      try {
        const id = String(scope)
        const accepted = core.interrupts.requestInterrupt(id, { reason, hard: false })
        if (!accepted) return { recorded: false, detail: 'declined: the scope made progress' }
        const snap = core.interrupts.snapshot(id)
        return {
          recorded: true,
          issuer: reasons?.interruptIssuer?.(snap.reason) ?? reason,
          wording: reasons?.interruptSkipWording?.(snap.reason) ?? reason,
        }
      } catch (error) {
        return { recorded: false, detail: 'error: ' + (error instanceof Error ? error.message : String(error)) }
      }
    },
  }
}
