/**
 * The legacy engine repository key, isolated behind one bridge.
 *
 * TokenEconomizer (the engine) keys its per-repository state by a slug plus a digest, computed by
 * `lib/repokey.js`. That module reproduces the rule as observed, but it is a reproduction: the
 * engine's source is absent from this host, so **the engine's own canonicalization is
 * UNVERIFIABLE from here**. A key this module returns must be treated as *persisted and possibly
 * divergent* from the engine's. Never claim it reproduces the engine exactly.
 *
 * This file exists so the adoption procedure has one obvious seam: when an identity record must be
 * joined to an already-materialized engine key, the legacy path is named here once instead of being
 * re-spelled at each call site.
 */

import { repoKeyFor } from './repokey.js'

/**
 * Where the replicated engine key rule lives.
 *
 * `repoKeyFor` is the delegating entry point; the canonicalization it wraps starts at the
 * `repoIdentity` implementation in the same file. The reference is pinned to the source line so a
 * reader can verify the reproduction themselves.
 */
export const LEGACY_REPO_KEY_SOURCE = 'lib/repokey.js:236'

/**
 * The legacy engine repository key for a working directory.
 *
 * Prefer the session's `projectDir` anchor over its live directory: the engine key belongs to the
 * project, not to wherever the session happens to stand after a `working-directory/change`.
 * @param {string} cwd - the directory to key.
 * @param {Record<string, string | undefined>} [env] - environment to read the git ceilings from.
 * @returns {string} the engine repository key.
 */
export function repoKeyOf (cwd, env = process.env) {
  return repoKeyFor(cwd, env)
}
