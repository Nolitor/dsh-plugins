/**
 * Repository identity, computed the way the engine computes it.
 *
 * The engine keys its per-repository state as `repos/<slug>-<sha1(canon)[:10]>/<host>`, where
 * `canon` is the normalized `origin` remote when the checkout has one, else the real path of the
 * checkout's *main* clone (a linked worktree shares it), else the directory itself. This module
 * reproduces that rule exactly, so a DSH session's `cwd` maps to the same key without a second
 * store and without reading the engine's `repo.json` (which records no path).
 *
 * Everything here is pure filesystem inspection plus `node:crypto`: no git subprocess, no state.
 * A caller that cannot be mapped gets a key from its own directory, never an exception.
 */

import { createHash } from 'node:crypto'
import { readFileSync, realpathSync, statSync } from 'node:fs'
import { basename, dirname, isAbsolute, join, normalize, resolve } from 'node:path'

/** The checkout was identified by its normalized `origin` remote. */
export const BY_REMOTE = 'remote'

/** The checkout has no remote and was identified by its main checkout's real path. */
export const BY_PATH = 'path'

/** The directory is not a checkout and was identified by itself. */
export const BY_DIR = 'dir'

/**
 * The readable half of a repository key: lower-case, non-alphanumerics collapsed to `-`.
 * @param {string} text - the repository name.
 * @returns {string} the slug, never empty.
 */
export function slug (text) {
  const slugged = String(text || 'repo')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
  return slugged || 'repo'
}

/**
 * The stable half of a repository key.
 * @param {string} canon - the canonical identity string.
 * @returns {string} the first 10 hex characters of its SHA-1.
 */
export function digest (canon) {
  return createHash('sha1').update(String(canon), 'utf8').digest('hex').slice(0, 10)
}

/**
 * Resolve a path to its real path, falling back to the lexical path when it does not exist.
 * @param {string} path - the path.
 * @returns {string} the real or lexical absolute path.
 */
function realOrLexical (path) {
  try {
    return realpathSync(path)
  } catch {
    return resolve(path)
  }
}

/**
 * Whether a path is a git entry: a `.git` directory, or a `.git` file pointing elsewhere.
 * @param {string} path - the candidate.
 * @returns {boolean} whether it is a git entry.
 */
function isGitEntry (path) {
  try {
    const stat = statSync(path)
    return stat.isDirectory() || stat.isFile()
  } catch {
    return false
  }
}

/**
 * The nearest directory at or above `start` that is a checkout, or null.
 *
 * The walk honours `GIT_CEILING_DIRECTORIES` and treats the home directory as one more ceiling,
 * exactly as the engine does: a versioned home is the repository of a session started in `~`, not
 * of every unversioned project underneath it.
 * @param {string} start - the session working directory.
 * @param {object} [env] - environment to read the ceilings from.
 * @returns {string | null} the checkout root.
 */
export function findRepoRoot (start, env = process.env) {
  const ceilings = new Set(
    String(env.GIT_CEILING_DIRECTORIES || '')
      .split(':')
      .filter(Boolean)
      .map(entry => resolve(entry)),
  )
  const home = env.HOME ? realOrLexical(env.HOME) : null
  let current = resolve(start || process.cwd())
  for (;;) {
    if (isGitEntry(join(current, '.git'))) return current
    const parent = dirname(current)
    if (parent === current) return null
    if (ceilings.has(parent)) return null
    if (home && realOrLexical(parent) === home) return null
    current = parent
  }
}

/**
 * The git directory holding `config` for a checkout, following worktree indirection.
 * @param {string} root - the checkout root.
 * @returns {string | null} the git directory.
 */
export function gitCommonDir (root) {
  const dot = join(root, '.git')
  let stat
  try {
    stat = statSync(dot)
  } catch {
    return null
  }
  if (stat.isDirectory()) return dot
  let text
  try {
    text = readFileSync(dot, 'utf8').trim()
  } catch {
    return dot
  }
  const match = /^gitdir:\s*(.+)$/.exec(text)
  if (!match) return dot
  const gitdir = isAbsolute(match[1]) ? match[1] : resolve(root, match[1])
  try {
    const common = readFileSync(join(gitdir, 'commondir'), 'utf8').trim()
    return normalize(join(gitdir, common))
  } catch {
    return gitdir
  }
}

/**
 * The directory holding a checkout's shared `.git`: the checkout itself, or the clone a linked
 * worktree was made from.
 * @param {string} root - the checkout root.
 * @returns {string | null} the main checkout, or null when the git directory is not a `.git`.
 */
export function mainCheckout (root) {
  const common = gitCommonDir(root)
  if (!common) return null
  return basename(normalize(common)) === '.git' ? dirname(normalize(common)) : null
}

/**
 * The `origin` remote URL (or the first remote's) read from the git config.
 * @param {string} root - the checkout root.
 * @returns {string | null} the URL, or null when the checkout has no remote.
 */
export function originUrl (root) {
  const gitdir = root ? gitCommonDir(root) : null
  if (!gitdir) return null
  let text
  try {
    text = readFileSync(join(gitdir, 'config'), 'utf8')
  } catch {
    return null
  }
  const remotes = {}
  let current = null
  for (const line of text.split(/\r?\n/)) {
    const header = /^\s*\[remote\s+"([^"]+)"\]\s*$/.exec(line)
    if (header) {
      current = header[1]
      continue
    }
    if (/^\s*\[/.test(line)) {
      current = null
      continue
    }
    const url = /^\s*url\s*=\s*(\S+)\s*$/.exec(line)
    if (current && url && remotes[current] === undefined) remotes[current] = url[1]
  }
  return remotes.origin ?? Object.values(remotes)[0] ?? null
}

/**
 * One spelling for `git@host:Owner/Repo.git` and `https://host/owner/repo`.
 * @param {string} url - the remote URL.
 * @returns {string} the normalized remote, or an empty string.
 */
export function normalizeRemote (url) {
  let normalized = String(url || '').trim()
  normalized = normalized.replace(/^[a-z+]+:\/\//i, '')
  normalized = normalized.replace(/^[^@/]+@/, '')
  if (/^[^/]+:[^/\d]/.test(normalized)) normalized = normalized.replace(':', '/')
  normalized = normalized.replace(/\.git$/, '').replace(/\/+$/, '')
  return normalized.toLowerCase()
}

/**
 * Identify the repository a session in `cwd` belongs to.
 *
 * One repository has one key however it is checked out: its normalized `origin` remote when it has
 * one, else the real path of its main checkout, else the directory itself.
 * @param {string} cwd - the session working directory.
 * @param {object} [env] - environment to read the ceilings from.
 * @returns {{ root: string, key: string, label: string, remote: string, how: string }} the identity.
 */
export function repoIdentity (cwd, env = process.env) {
  const found = findRepoRoot(cwd, env)
  const root = found || resolve(cwd || process.cwd())
  const remote = found ? normalizeRemote(originUrl(root)) : ''
  if (remote) {
    const parts = remote.split('/')
    const name = parts[parts.length - 1]
    return {
      root,
      key: `${slug(name)}-${digest(remote)}`,
      label: parts.slice(-2).join('/'),
      remote,
      how: BY_REMOTE,
    }
  }
  const main = found ? (mainCheckout(root) || gitCommonDir(root) || root) : root
  const name = basename(String(main).replace(/\/+$/, ''))
  return {
    root,
    key: `${slug(name)}-${digest(realOrLexical(main))}`,
    label: name || 'repo',
    remote: '',
    how: found ? BY_PATH : BY_DIR,
  }
}

/**
 * The engine's repository key for a working directory.
 * @param {string} cwd - the session working directory.
 * @param {object} [env] - environment to read the ceilings from.
 * @returns {string} the key, e.g. `dsh-plugins-4806902e1d`.
 */
export function repoKeyFor (cwd, env = process.env) {
  return repoIdentity(cwd, env).key
}
