/**
 * Artifact collection for the built-in `cli_worker` tool.
 *
 * A worker call returns its final message plus the files it produced. The
 * caller names globs; matches are resolved strictly inside the call's `cwd`,
 * hashed, and reported. A glob that matches nothing is reported back, never
 * dropped silently.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** Directories that never contribute artifacts (generated trees, VCS data). */
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.cache'])

/** Bounds for one workspace walk; a worker's output tree is expected small. */
const MAX_ENTRIES = 20000
const MAX_DEPTH = 12

/**
 * Translate an artifact glob into an anchored regular expression over
 * `/`-separated relative paths.
 *
 * Supported syntax: `**` (any depth, including none when followed by `/`),
 * `*` (within one segment), `?` (one character). Everything else is literal.
 * @param {string} pattern - glob as written by the caller.
 * @returns {RegExp} matcher for relative POSIX paths.
 */
export function globToRegExp(pattern) {
  const source = String(pattern ?? '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
  let out = ''
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index]
    if (character === '*') {
      if (source[index + 1] === '*') {
        index += 1
        if (source[index + 1] === '/') {
          index += 1
          out += '(?:.*/)?'
        } else {
          out += '.*'
        }
      } else {
        out += '[^/]*'
      }
      continue
    }
    if (character === '?') {
      out += '[^/]'
      continue
    }
    out += /[.+^${}()|[\]\\]/.test(character) ? `\\${character}` : character
  }
  return new RegExp(`^${out}$`)
}

/**
 * List files under `cwd` as `/`-separated relative paths.
 * @param {string} cwd - workspace root.
 * @param {{signal?: AbortSignal}} [options] - cancellation.
 * @returns {Promise<string[]>} relative paths of regular files.
 */
async function listFiles(cwd, options = {}) {
  const files = []
  const queue = [{ dir: cwd, depth: 0 }]
  while (queue.length > 0) {
    if (options.signal?.aborted) break
    const { dir, depth } = queue.shift()
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      if (files.length >= MAX_ENTRIES) return files
      if (entry.isSymbolicLink()) continue
      const full = join(dir, entry.name)
      if (entry.isDirectory()) {
        if (depth >= MAX_DEPTH || SKIP_DIRECTORIES.has(entry.name)) continue
        queue.push({ dir: full, depth: depth + 1 })
        continue
      }
      if (!entry.isFile()) continue
      files.push(relative(cwd, full).split(sep).join('/'))
    }
  }
  return files
}

/**
 * Hash one file.
 * @param {string} path - absolute file path.
 * @returns {Promise<string>} lowercase hex SHA-256 digest.
 */
async function sha256File(path) {
  const hash = createHash('sha256')
  for await (const chunk of createReadStream(path)) hash.update(chunk)
  return hash.digest('hex')
}

/**
 * Resolve artifact globs against a worker's workspace.
 * @param {{cwd: string, patterns: readonly string[], limit?: number, signal?: AbortSignal}} options - workspace, globs, and bounds.
 * @returns {Promise<{artifacts: {path: string, bytes: number, sha256: string}[], missing: string[], skipped: number}>} collected files, globs with no match, and the count dropped by `limit`.
 */
export async function collectArtifacts(options) {
  const patterns = options.patterns.filter((pattern) => typeof pattern === 'string' && pattern.length > 0)
  if (patterns.length === 0) return { artifacts: [], missing: [], skipped: 0 }
  const limit = Number.isInteger(options.limit) && options.limit > 0 ? options.limit : 100
  const files = await listFiles(options.cwd, { signal: options.signal })
  const matchers = patterns.map((pattern) => ({ pattern, test: globToRegExp(pattern) }))
  const selected = new Set()
  const missing = []
  for (const { pattern, test } of matchers) {
    const matches = files.filter((file) => test.test(file))
    if (matches.length === 0) missing.push(pattern)
    for (const file of matches) selected.add(file)
  }
  const ordered = [...selected].sort()
  const kept = ordered.slice(0, limit)
  const artifacts = []
  for (const path of kept) {
    if (options.signal?.aborted) break
    const absolute = join(options.cwd, path)
    try {
      const info = await stat(absolute)
      if (!info.isFile()) continue
      artifacts.push({ path, bytes: info.size, sha256: await sha256File(absolute) })
    } catch {
      // A file that vanished between the walk and the hash is an exit fact: the
      // worker removed it. Report nothing rather than a phantom artifact.
    }
  }
  return { artifacts, missing, skipped: Math.max(0, ordered.length - kept.length) }
}
