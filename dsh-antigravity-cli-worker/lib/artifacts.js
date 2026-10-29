/**
 * Artifact collection for the antigravity CLI worker tool.
 */
import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { readdir, stat } from 'node:fs/promises'
import { join, relative, sep } from 'node:path'

const SKIP_DIRECTORIES = new Set(['.git', 'node_modules', '.cache'])
const MAX_ENTRIES = 20000
const MAX_DEPTH = 12

export function globToRegExp(pattern) {
  const source = String(pattern ?? '')
  let re = '^'
  let i = 0
  const len = source.length
  while (i < len) {
    const ch = source[i]
    if (ch === '\\') {
      i += 1
      if (i < len) {
        re += '\\' + source[i]
        i += 1
      }
      continue
    }
    if (ch === '*') {
      if (source[i + 1] === '*') {
        // **
        if (source[i + 2] === '/') {
          re += '(?:.*/)?'
          i += 3
        } else if (source[i + 2] === '\\' && source[i + 3] === '/') {
          re += '(?:.*/)?'
          i += 4
        } else {
          re += '.*'
          i += 2
        }
        continue
      }
      // *
      re += '[^/]*'
      i += 1
      continue
    }
    if (ch === '?') {
      re += '[^/]'
      i += 1
      continue
    }
    if ('.+^$()[]{}|/'.includes(ch)) {
      re += '\\' + ch
      i += 1
      continue
    }
    re += ch
    i += 1
  }
  re += '$'
  return new RegExp(re)
}

async function walk(dir, base, depth, out) {
  if (depth > MAX_DEPTH || out.length >= MAX_ENTRIES) return
  let entries
  try {
    entries = await readdir(dir, { withFileTypes: true })
  } catch {
    return
  }
  for (const entry of entries) {
    if (out.length >= MAX_ENTRIES) break
    if (entry.isDirectory()) {
      if (SKIP_DIRECTORIES.has(entry.name)) continue
      await walk(join(dir, entry.name), base, depth + 1, out)
      continue
    }
    if (entry.isFile() || entry.isSymbolicLink()) {
      const full = join(dir, entry.name)
      const rel = relative(base, full).split(sep).join('/')
      out.push({ full, rel })
    }
  }
}

async function hashFile(path) {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    const s = createReadStream(path)
    s.on('data', (chunk) => h.update(chunk))
    s.on('end', () => resolve(h.digest('hex')))
    s.on('error', reject)
  })
}

export async function collectArtifacts(cwd, globs) {
  const patterns = Array.isArray(globs) ? globs.filter(Boolean).map(String) : []
  if (patterns.length === 0) return []
  const files = []
  await walk(cwd, cwd, 0, files)
  const regs = patterns.map(globToRegExp)
  const seen = new Set()
  const results = []
  for (const f of files) {
    if (!regs.some((r) => r.test(f.rel))) continue
    if (seen.has(f.rel)) continue
    seen.add(f.rel)
    try {
      const st = await stat(f.full)
      const hash = await hashFile(f.full)
      results.push({
        path: f.rel,
        absolutePath: f.full,
        size: st.size,
        sha256: hash,
      })
    } catch {
      // skip unreadable
    }
  }
  // Report globs that matched nothing? We still return matches; caller can see
  return results
}
