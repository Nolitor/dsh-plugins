/**
 * Beta package entry for @nolit/dsh-opencode-v2-beta.
 *
 * The beta package ships the canonical protocol parser (Tier B) and the
 * recipe-derived conformance oracle (Tier C). It deliberately does NOT yet
 * replace the stable adapter's stream path: the parser is exposed as a library
 * plus a self-check, and the package stays unmounted until the conformance
 * results are accepted.
 *
 * MUTUAL EXCLUSION: both packages claim the same provider id, tool name and
 * commands, so only one of them may be active in a profile. The claim is made
 * through the stable package's guard (`@nolit/dsh-opencode-v2/lib/exclusion.js`),
 * which is a single implementation shared by both sides.
 */
import {
  claimActivation,
  detectSibling,
  releaseClaim,
  resolveClaimPath,
} from '@nolit/dsh-opencode-v2/lib/exclusion.js'
import { optionalService } from '@nolit/dsh-opencode-v2/lib/optional-service.js'

import { BETA_PACKAGE, BETA_PROVIDER_ID, BETA_TOOL_NAME } from './identity.js'
import { createProtocolParser, PARSER_VERSION } from './protocol-parser.js'
import { runConformance, runInvariance } from './conformance.js'

/** Host plugin name; must match package.json `name` and the cordis row id. */
export const name = BETA_PACKAGE

/** No services are required: this build parses and verifies, it does not serve. */
export const inject = []

export { BETA_PROVIDER_ID, BETA_TOOL_NAME, PARSER_VERSION, createProtocolParser }

/**
 * Self-check result, computed once per process.
 *
 * A beta that cannot parse its own conformance corpus must not be mounted, so
 * the answer is part of the export surface rather than a test-only fact.
 *
 * @returns {{ parser: string, conformance: object, invariance: object }}
 */
export function selfCheck() {
  return { parser: PARSER_VERSION, conformance: runConformance(), invariance: runInvariance() }
}

/**
 * Activation.
 *
 * Refuses to load when the stable package is live in the same host: both would
 * claim `opencode-http-agent` and the `opencode` tool.
 *
 * @param {object} ctx - cordis context.
 */
export function apply(ctx, config) {
  // MOUNT-TIME claim first: the stable package writes the same file, so whichever
  // activates second is refused here rather than half-registering. A claim left by
  // a dead process is taken over, so a crash cannot lock the profile.
  const claimPath = resolveClaimPath({
    explicit: typeof config?.exclusionStatePath?.get === 'function'
      ? config.exclusionStatePath.get()
      : config?.exclusionStatePath,
    dshHome: process.env.DSH_HOME,
  })
  const claim = claimActivation({ owner: BETA_PACKAGE, path: claimPath })
  if (!claim.ok) {
    ctx?.logger?.warn?.(claim.message)
    return () => releaseClaim(claimPath, BETA_PACKAGE)
  }

  const sibling = detectSibling({
    owner: BETA_PACKAGE,
    // This entry injects nothing, so cordis throws on any service read; both are
    // read optionally (the same defect that killed the stable row on 2026-11-04).
    llm: optionalService(ctx, 'llm'),
    tools: optionalService(ctx, 'tools'),
    providerId: BETA_PROVIDER_ID,
    toolName: BETA_TOOL_NAME,
  })
  if (sibling.conflict) {
    ctx?.logger?.warn?.(
      `${BETA_PACKAGE} stands down: ${sibling.evidence.join('; ')}. `
      + 'Only one OpenCode package may be active per profile (mutual exclusion).',
    )
    return () => releaseClaim(claimPath, BETA_PACKAGE)
  }
  const check = selfCheck()
  if (!check.conformance.ok || !check.invariance.ok) {
    ctx?.logger?.warn?.(
      `${BETA_PACKAGE} stands down: conformance ${check.conformance.ok ? 'ok' : 'FAILED'}, `
      + `invariance ${check.invariance.ok ? 'ok' : 'FAILED'}.`,
    )
    return
  }
  ctx?.logger?.info?.(
    `${BETA_PACKAGE} active: parser ${check.parser}, ${check.conformance.checked} conformance cases, `
    + `${check.invariance.checked} re-chunkings invariant.`,
  )
  ctx?.on?.('dispose', () => releaseClaim(claimPath, BETA_PACKAGE))
}
