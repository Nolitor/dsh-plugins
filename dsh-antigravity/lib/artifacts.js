/**
 * Artifact collection for the Antigravity worker tool.
 *
 * The caller names globs; matches are resolved strictly inside the call's
 * `cwd`, hashed, and reported. A glob that matches nothing is reported back as
 * `missing`, and overflow past the limit is counted as `skipped`, so a caller
 * never loses the fact that something was dropped.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

/** Directories that never contribute artifacts. */
const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.cache'])

/** Bounds for one workspace walk. */
const MAX_ENTRIES = 20000
const MAX_DEPTH = 12

/**
 * Translate an artifact glob into an anchored regular expression over
 * `/`-separated relative paths.
 * @param {string} pattern - glob as written by the caller.
 * @returns {RegExp} matcher for relative POSIX paths.
 */
export function globToRegExp(pattern) {
  const source = String(pattern ?? '')
  let re = '^'
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i]
    if (ch === '*') {
      if (source[i + 1] === '*') {
        if (source[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 2
        } else {
          re += '.*'
          i += 1
        }
        continue
      }
      re += '[^/]*'
      continue
    }
    if (ch === '?') {
      re += '[^/]'
      continue
    }
    if ('.+^$()[]{}|/\\'.includes(ch)) re += `\\${ch}`
    else re += ch
  }
  return new RegExp(`${re}$`)
}

/**
 * Walk a directory tree without following skipped directories.
 * @param {string} dir - directory to read.
 * @param {string} base - root used for relative paths.
 * @param {number} depth - current depth.
 * @param {Array<{full: string, rel: string}>} out - accumulator.
 * @returns {Promise<void>} resolves after the subtree is listed.
 */
async function walk(dir, base, depth, out) {
  if (depth > MAX_DEPTH || out.length >= MAX_ENTRIES) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    // An unreadable directory contributes no artifacts.
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_ENTRIES) break
    const full = join(dir, entry.name)
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      await walk(full, base, depth + 1, out)
      continue
    }
    if (entry.isFile() || entry.isSymbolicLink()) {
      out.push({ full, rel: relative(base, full).split(sep).join('/') })
    }
  }
}

/**
 * Hash one file with SHA-256.
 * @param {string} path - absolute file path.
 * @returns {Promise<string>} hex digest.
 */
async function hashFile(path) {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
    stream.on('error', reject)
  })
}

/**
 * Collect artifact matches for the caller's globs.
 * @param {string} cwd - absolute worker directory.
 * @param {string[]} globs - caller globs, relative to `cwd`.
 * @param {number} limit - maximum artifacts to report.
 * @returns {Promise<{artifacts: Array<object>, missing: string[], skipped: number}>} collected artifacts and gaps.
 */
export async function collectArtifacts(cwd, globs, limit) {
  const patterns = Array.isArray(globs) ? globs.filter(Boolean).map(String) : []
  if (patterns.length === 0) return { artifacts: [], missing: [], skipped: 0 }

  const files = []
  await walk(cwd, cwd, 0, files)

  const artifacts = []
  const missing = []
  const seen = new Set()
  let skipped = 0

  for (const pattern of patterns) {
    const matcher = globToRegExp(pattern)
    const matches = files.filter((file) => matcher.test(file.rel))
    if (matches.length === 0) {
      missing.push(pattern)
      continue
    }
    for (const file of matches) {
      if (seen.has(file.rel)) continue
      seen.add(file.rel)
      if (artifacts.length >= limit) {
        skipped += 1
        continue
      }
      try {
        const info = await stat(file.full)
        artifacts.push({ path: file.rel, bytes: info.size, sha256: await hashFile(file.full) })
      } catch {
        missing.push(file.rel)
      }
    }
  }
  return { artifacts, missing, skipped }
}
