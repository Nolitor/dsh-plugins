/**
 * The embedded engine's identity, and the upstream release it is compared against.
 *
 * This plugin does not vendor the TokenEconomizer source: `scripts/bootstrap.mjs` clones ONE
 * pinned upstream commit into the TokenEconomizer state root, applies this package's patch, and
 * writes two launchers. The engine the user actually runs is therefore identified by that
 * pinned commit — not by a version string the engine itself does not carry.
 *
 * Measured 2026-11-15: the engine tree carries no `__version__` and no `VERSION` file, so
 * `te --version` is not even a valid invocation (the CLI requires a subcommand). The git
 * describe of the pinned checkout is the only truthful version label upstream publishes for
 * that tree.
 *
 * **TWO VERSIONS, AND THEY MUST NOT BE CONFUSED.** The page shows both, under different names:
 *
 *   - the PLUGIN's version (`0.0.1-rc.N`) — this package's own version, the one a release
 *     notes and an upgrade are about;
 *   - the ENGINE's version (an upstream tag plus a commit distance) — the upstream project's
 *     own release line, which this plugin does not control and does not bump.
 *
 * A page that shows only the engine's tag reads as "the plugin is v0.1.0", which is false: the
 * plugin is `0.0.1-rc.N` and the tag belongs to `microsoft/TokenEconomizer`. Measured 2026-11-15:
 * the first version of this card showed `v0.1.0` under a heading that did not say whose version
 * it was, and the operator read it as the plugin's version.
 *
 * Everything here fails open. A machine with no network, a blocked port, a GitHub rate limit or
 * a missing `git` answers a value that says "could not check", never "out of date" — the same
 * rule the CLI's `update --check` already follows.
 */

import { readFileSync } from 'node:fs'

/** Upstream repository the engine is pinned from. */
export const UPSTREAM_REPO = 'microsoft/TokenEconomizer'

/** The upstream commit this package's patch was produced against and verified on. */
export const PINNED_SHA = '6141bb9251a7d5cccc1b97ae340c7b872108292c'

/** The branch the pin is compared against. */
export const DEFAULT_BRANCH = 'main'

/** Base of the GitHub REST API the release and commit lookups use. */
export const GITHUB_API = 'https://api.github.com'

/**
 * How long one upstream lookup may take before it is treated as unreachable.
 *
 * A page that waits on the network is a page that appears broken, so every lookup is bounded
 * and the answer names the timeout as the reason.
 */
export const DEFAULT_UPSTREAM_TIMEOUT_MS = 8000

/**
 * This plugin's own version, read from its package manifest.
 *
 * The numeric part (`0.0.1`) is the owner's; the `rc.<n>` suffix is this track's history
 * marker. Neither is the engine's version, and neither is derived from the upstream tag.
 *
 * @returns {string} the plugin's version, or `unknown` when the manifest cannot be read.
 */
export function pluginVersion () {
  try {
    const manifest = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8'))
    return typeof manifest?.version === 'string' ? manifest.version : 'unknown'
  } catch {
    return 'unknown'
  }
}

/**
 * The version label of a pinned tree, in the form `git describe` gives it.
 *
 * The engine has no version constant, so the label is derived from the tag history: the newest
 * release tag reachable from the tree, plus the commit distance and the short commit id.
 *
 * `git describe --tags` FAILS on a checkout with no tag in its history — and the measured
 * isolated tree is exactly that case, because a `--filter=blob:none` clone of one commit has
 * no tags. The answer is then the commit itself, which is still a truthful identity: the
 * short commit id names the exact engine.
 *
 * @param {string} describe - the `git describe --tags` output for the tree, or null.
 * @param {string | null} shortSha - the short commit id, used when there is no tag.
 * @returns {string} a human-readable version label, or `unknown` when there is neither.
 */
export function versionFromDescribe (describe, shortSha = null) {
  const text = String(describe ?? '').trim()
  if (text.length > 0) {
    // `v0.1.0-22-g6141bb9` -> `v0.1.0+22.g6141bb9`; a bare tag stays as it is.
    const match = /^(.+)-(\d+)-g([0-9a-f]+)$/.exec(text)
    if (match !== null) return `${match[1]}+${match[2]}.g${match[3]}`
    return text
  }
  const short = typeof shortSha === 'string' ? shortSha.trim() : ''
  if (short.length > 0) return `unreleased+${short}`
  return 'unknown'
}

/**
 * The embedded engine's own identity, read from the local installation.
 *
 * The facts come from the vendored checkout under the TokenEconomizer state root — the tree
 * `scripts/bootstrap.mjs` cloned and patched — plus the launchers it wrote. Nothing here
 * touches the network.
 *
 * @param {object} options - the query.
 * @param {string} options.root - the TokenEconomizer state root.
 * @param {string} options.sha - the pinned commit this package expects.
 * @param {{ describe?: (tree: string) => string | null, exists?: (path: string) => boolean,
 *   head?: (tree: string) => string | null }} [options.probe] - injected filesystem and git
 *   readers, so the module never shells out on its own.
 * @returns {{ pinned: string, installed: string | null, describe: string | null,
 *   version: string, patchApplied: boolean, launchers: { te: boolean, hook: boolean },
 *   detail: string }} the measured identity.
 */
export function readEngineIdentity ({ root, sha, probe = {} }) {
  const describe = typeof probe.describe === 'function' ? probe.describe : () => null
  const exists = typeof probe.exists === 'function' ? probe.exists : () => false
  const head = typeof probe.head === 'function' ? probe.head : () => null
  const tree = `${root.replace(/\/+$/, '')}/vendor/TokenEconomizer-${sha.slice(0, 8)}`
  const installed = head(tree)
  const describeText = describe(tree)
  const bin = `${root.replace(/\/+$/, '')}/bin`
  const launchers = { te: exists(`${bin}/te`), hook: exists(`${bin}/te-hook`) }
  // A patched tree is not at the pinned commit any more: the patch changes the files, so the
  // HEAD commit stays the pin and the working tree carries the diff. A tree whose HEAD moved
  // away from the pin is a different engine than this package patched.
  const patchApplied = installed !== null && installed === sha
  let detail
  if (installed === null) detail = 'the vendored checkout is missing'
  else if (installed !== sha) detail = `the vendored checkout is at ${installed.slice(0, 8)}, not the pinned ${sha.slice(0, 8)}`
  else if (!launchers.te || !launchers.hook) detail = 'the launchers are missing from the state root'
  else detail = 'the vendored checkout is the pinned commit'
  return {
    pinned: sha,
    installed,
    installedShort: installed === null ? null : installed.slice(0, 8),
    describe: describeText,
    version: versionFromDescribe(describeText, installed === null ? null : installed.slice(0, 8)),
    // The plugin's own version, carried beside the engine's so the two are never confused.
    pluginVersion: pluginVersion(),
    patchApplied,
    launchers,
    detail,
  }
}

/**
 * One upstream lookup, bounded and never throwing.
 *
 * @param {string} url - the URL to read.
 * @param {{ timeoutMs?: number, fetchImpl?: typeof fetch }} [options] - the bound and the fetcher.
 * @returns {Promise<{ ok: boolean, status?: number, body?: unknown, error?: string }>} the answer.
 */
export async function fetchJson (url, options = {}) {
  const timeoutMs = options.timeoutMs ?? DEFAULT_UPSTREAM_TIMEOUT_MS
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  if (typeof fetchImpl !== 'function') {
    return { ok: false, error: 'no fetch implementation is available' }
  }
  const controller = typeof AbortController === 'function' ? new AbortController() : null
  const timer = controller === null
    ? null
    : setTimeout(() => controller.abort(), timeoutMs)
  try {
    const response = await fetchImpl(url, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': '@nolit/dsh-tokeneconomizer',
      },
      ...(controller === null ? {} : { signal: controller.signal }),
    })
    const status = Number(response?.status ?? 0)
    const text = typeof response?.text === 'function' ? await response.text() : ''
    let body = null
    try {
      body = text.length > 0 ? JSON.parse(text) : null
    } catch {
      return { ok: false, status, error: 'the upstream answered unreadable JSON' }
    }
    if (!response?.ok) {
      // GitHub's rate-limit answer carries its own reason; keep it verbatim.
      const reason = typeof body?.message === 'string' ? body.message : `the upstream answered ${status}`
      return { ok: false, status, error: reason }
    }
    return { ok: true, status, body }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const aborted = error?.name === 'AbortError'
    return { ok: false, error: aborted ? `the upstream did not answer within ${timeoutMs} ms` : message }
  } finally {
    if (timer !== null) clearTimeout(timer)
  }
}

/**
 * Compare the pinned commit with the upstream branch head and the latest release.
 *
 * The answer is always a value: "newer upstream exists", "the pin is the head", or "the
 * question could not be answered" — with the reason. It never says "out of date" on a failure,
 * because an unreachable network is not an out-of-date installation.
 *
 * @param {object} options - the query.
 * @param {string} [options.sha] - the pinned commit.
 * @param {string} [options.branch] - the branch to compare against.
 * @param {number} [options.timeoutMs] - the bound on each lookup.
 * @param {typeof fetch} [options.fetchImpl] - the fetcher to use.
 * @returns {Promise<object>} the comparison.
 */
export async function checkUpstream ({
  sha = PINNED_SHA,
  branch = DEFAULT_BRANCH,
  timeoutMs = DEFAULT_UPSTREAM_TIMEOUT_MS,
  fetchImpl,
} = {}) {
  const repo = UPSTREAM_REPO
  const release = await fetchJson(`${GITHUB_API}/repos/${repo}/releases/latest`, { timeoutMs, fetchImpl })
  const head = await fetchJson(`${GITHUB_API}/repos/${repo}/commits/${branch}`, { timeoutMs, fetchImpl })
  const compare = await fetchJson(`${GITHUB_API}/repos/${repo}/compare/${sha}...${branch}`, { timeoutMs, fetchImpl })

  const releaseTag = release.ok && typeof release.body?.tag_name === 'string' ? release.body.tag_name : null
  const headSha = head.ok && typeof head.body?.sha === 'string' ? head.body.sha : null
  const headDate = head.ok && typeof head.body?.commit?.committer?.date === 'string'
    ? head.body.commit.committer.date
    : null
  const headMessage = head.ok && typeof head.body?.commit?.message === 'string'
    ? head.body.commit.message.split('\n')[0]
    : null
  // The compare API answers `ahead_by`/`behind_by` and the commits between the two points.
  const behind = compare.ok && Number.isFinite(Number(compare.body?.behind_by)) ? Number(compare.body.behind_by) : null
  const ahead = compare.ok && Number.isFinite(Number(compare.body?.ahead_by)) ? Number(compare.body.ahead_by) : null
  const changedFiles = compare.ok && Array.isArray(compare.body?.files)
    ? compare.body.files.map((file) => ({
      filename: typeof file?.filename === 'string' ? file.filename : String(file?.filename ?? ''),
      status: typeof file?.status === 'string' ? file.status : 'unknown',
      changes: Number.isFinite(Number(file?.changes)) ? Number(file.changes) : 0,
    }))
    : []

  const errors = []
  if (!release.ok) errors.push('release: ' + (release.error ?? 'unknown'))
  if (!head.ok) errors.push('branch head: ' + (head.error ?? 'unknown'))
  if (!compare.ok) errors.push('compare: ' + (compare.error ?? 'unknown'))

  const upToDate = headSha !== null && headSha === sha
  const updateAvailable = headSha === null ? null : !upToDate
  // `behind_by` counts the commits on the BASE side of the comparison — the ones the pin HAS
  // and the head does not. The number an operator wants is the other one: how many commits
  // the head is AHEAD of the pin, which is `ahead_by`. Measured 2026-11-15: the pin was 0
  // behind and 187 ahead, and reading `behind_by` would have said "the pin is current" while
  // the head had moved 187 commits past it. (The distance grows as upstream lands commits, so
  // this figure is a reading of that day, not a constant.)
  const commitsAhead = compare.ok && Number.isFinite(Number(compare.body?.ahead_by)) ? Number(compare.body.ahead_by) : null
  const commitsBehind = commitsAhead
  return {
    ok: errors.length === 0,
    pinned: sha,
    repo,
    branch,
    upstreamHead: headSha,
    upstreamHeadDate: headDate,
    upstreamHeadMessage: headMessage,
    latestRelease: releaseTag,
    latestReleaseUrl: release.ok && typeof release.body?.html_url === 'string' ? release.body.html_url : null,
    latestReleasePublishedAt: release.ok && typeof release.body?.published_at === 'string'
      ? release.body.published_at
      : null,
    upToDate,
    updateAvailable,
    commitsBehind,
    commitsAhead,
    changedFiles,
    errors,
    detail: describeComparison({ headSha, sha, upToDate, updateAvailable, behind: commitsAhead, errors }),
  }
}

/**
 * One sentence describing the comparison, in the same voice as the rest of the plugin.
 *
 * @param {object} facts - the comparison facts.
 * @returns {string} the sentence.
 */
function describeComparison ({ headSha, sha, upToDate, updateAvailable, behind, errors }) {
  if (headSha === null) {
    return 'the upstream branch head is unknown: ' + (errors[0] ?? 'the lookup failed')
  }
  if (upToDate) return 'the pinned commit is the upstream branch head'
  if (updateAvailable !== true) return 'the upstream branch head is unknown'
  const distance = behind === null ? 'an unknown number of' : `${behind} commit(s)`
  return `the upstream branch head is ${distance} ahead of the pinned ${sha.slice(0, 8)}`
}
