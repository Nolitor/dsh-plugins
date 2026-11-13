#!/usr/bin/env node
/**
 * `npm run spec:watch` — MANUAL upstream change detector.
 *
 * What it does
 *   1. reads `specs/watch.json` (the registered docs / changelogs / pricing URLs);
 *   2. fetches each URL (conditional requests when the lock has an ETag or
 *      Last-Modified);
 *   3. normalizes the body (HTML → text, line endings, trailing spaces) and
 *      hashes it with SHA-256;
 *   4. compares the hash against `specs/upstream.lock.json`;
 *   5. prints a report with a sanitized line diff for changed URLs.
 *
 * It NEVER writes the baseline unless `--update` is passed, and it registers
 * nothing: no cron, no timer, no background job. Running it twice in a row is
 * idempotent.
 *
 * Exit codes
 *   0  clean (changes are reported but do not fail unless --fail-on-change)
 *   1  changes/new entries and --fail-on-change
 *   2  configuration, network or filesystem failure (a hard error)
 *
 * @module dsh-custom-router/spec-watch
 */
import { createHash } from 'node:crypto'
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/** Repository root, resolved from this script. */
export const DEFAULT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')

/** Manual watch registry. */
export const WATCH_PATH = 'specs/watch.json'

/** Baseline hash lock. */
export const LOCK_PATH = 'specs/upstream.lock.json'

/** Local normalized-body cache, used only to render diffs. Git-ignored. */
export const CACHE_DIR = 'specs/.watch-cache'

/** Watch entry kinds. */
export const WATCH_KINDS = Object.freeze(['protocol', 'provider', 'pricing', 'changelog'])

/** Largest body accepted; a runaway page is an error, not a hash. */
export const MAX_BODY_BYTES = 12 * 1024 * 1024

/** User agent: identify the tool, send no credentials. */
const USER_AGENT = 'dsh-custom-router-spec-watch/1.0'

/**
 * Read and validate `specs/watch.json`.
 * @param {{root?: string, watchPath?: string}} [options] - root and override path.
 * @returns {Promise<{entries: object[], errors: string[], path: string}>} the registry.
 */
export async function loadWatch(options = {}) {
  const root = options.root ?? DEFAULT_ROOT
  const path = resolve(root, options.watchPath ?? WATCH_PATH)
  let parsed
  try {
    parsed = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    return { entries: [], errors: [`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`], path }
  }
  const entries = Array.isArray(parsed?.entries) ? parsed.entries : null
  if (entries === null) return { entries: [], errors: [`${path}: "entries" must be an array`], path }
  const errors = []
  const seen = new Set()
  const normalized = []
  for (const [index, entry] of entries.entries()) {
    const where = `${path}: entries[${index}]`
    if (entry === null || typeof entry !== 'object' || Array.isArray(entry)) { errors.push(`${where} must be an object`); continue }
    if (typeof entry.id !== 'string' || entry.id === '') errors.push(`${where}.id must be a non-empty string`)
    else if (seen.has(entry.id)) errors.push(`${where}.id "${entry.id}" is duplicated`)
    else seen.add(entry.id)
    let url
    try { url = new URL(String(entry.url)) } catch { errors.push(`${where}.url must be an absolute URL`) }
    if (url && url.protocol !== 'https:' && url.protocol !== 'http:') errors.push(`${where}.url must be http(s)`)
    if (!WATCH_KINDS.includes(entry.kind)) errors.push(`${where}.kind must be one of ${WATCH_KINDS.join(', ')}`)
    if (!Array.isArray(entry.specs) || entry.specs.some((id) => typeof id !== 'string' || id === '')) {
      errors.push(`${where}.specs must be an array of spec ids`)
    }
    if (entry.optional !== undefined && typeof entry.optional !== 'boolean') errors.push(`${where}.optional must be a boolean`)
    normalized.push({
      id: String(entry.id ?? ''),
      url: String(entry.url ?? ''),
      kind: String(entry.kind ?? ''),
      specs: Array.isArray(entry.specs) ? entry.specs.map(String) : [],
      optional: entry.optional === true,
      note: typeof entry.note === 'string' ? entry.note : undefined,
    })
  }
  return { entries: normalized, errors, path }
}

/**
 * Read the baseline lock; a missing lock is an empty baseline, not an error.
 * @param {{root?: string, lockPath?: string}} [options] - root and override path.
 * @returns {Promise<{lock: object, path: string, exists: boolean, errors: string[]}>} the lock.
 */
export async function loadLock(options = {}) {
  const root = options.root ?? DEFAULT_ROOT
  const path = resolve(root, options.lockPath ?? LOCK_PATH)
  try {
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    if (parsed?.entries === null || typeof parsed?.entries !== 'object' || Array.isArray(parsed?.entries)) {
      return { lock: { version: 1, entries: {} }, path, exists: false, errors: [`${path}: "entries" must be an object`] }
    }
    return { lock: { version: 1, ...parsed, entries: parsed.entries }, path, exists: true, errors: [] }
  } catch (error) {
    if (error?.code === 'ENOENT') return { lock: { version: 1, entries: {} }, path, exists: false, errors: [] }
    return { lock: { version: 1, entries: {} }, path, exists: false, errors: [`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`] }
  }
}

/**
 * Normalize a body before hashing.
 *
 * HTML is reduced to text (scripts/styles/comments/tags removed, entities
 * decoded); every body gets CRLF→LF, trailing whitespace removed, and runs of
 * blank lines collapsed. The goal is "the human-visible content changed", not
 * byte identity: a build hash in a script tag must not raise a false alarm.
 * @param {string} text - raw body.
 * @param {{contentType?: string}} [options] - response content type.
 * @returns {string} normalized text.
 */
export function normalizeContent(text, options = {}) {
  let value = String(text ?? '').replace(/\r\n?/g, '\n')
  const looksJson = /json/i.test(options.contentType ?? '')
    || /\.json(?:$|[?#])/i.test(String(options.url ?? ''))
  if (looksJson) {
    try {
      return JSON.stringify(canonicalize(JSON.parse(value)), null, 2)
    } catch {
      // A malformed JSON body is hashed as text; the report will show the change.
    }
  }
  const looksHtml = /html/i.test(options.contentType ?? '')
    || /^\s*<!doctype\s+html/i.test(value.slice(0, 512))
    || /<html[\s>]/i.test(value.slice(0, 2048))
  if (looksHtml) {
    value = value
      .replace(/<script\b[\s\S]*?<\/script>/gi, ' ')
      .replace(/<style\b[\s\S]*?<\/style>/gi, ' ')
      .replace(/<noscript\b[\s\S]*?<\/noscript>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<[^>]+>/g, ' ')
    value = decodeEntities(value).replace(/[ \t]{2,}/g, ' ')
  }
  return value
    .split('\n')
    .map((line) => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

/**
 * Canonicalize JSON so key order and an array of id-bearing objects do not look
 * like a semantic change. The DeepInfra catalog reorders its `data` array on
 * every request; without this, a price watcher would report a change every run.
 * @param {unknown} value - parsed JSON.
 * @returns {unknown} canonical value.
 */
export function canonicalize(value) {
  if (Array.isArray(value)) {
    const items = value.map(canonicalize)
    const keyOf = (item) => (item !== null && typeof item === 'object' && !Array.isArray(item)
      ? (typeof item.id === 'string' ? item.id : typeof item.name === 'string' ? item.name : typeof item.key === 'string' ? item.key : undefined)
      : undefined)
    return items.every((item) => keyOf(item) !== undefined)
      ? [...items].sort((left, right) => keyOf(left).localeCompare(keyOf(right)))
      : items
  }
  if (value !== null && typeof value === 'object') {
    const out = {}
    for (const key of Object.keys(value).sort()) out[key] = canonicalize(value[key])
    return out
  }
  return value
}

/**
 * Decode the small entity set that appears in documentation chrome.
 * @param {string} value - HTML-ish text.
 * @returns {string} decoded text.
 */
function decodeEntities(value) {
  const named = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' }
  return value
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => codePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_match, dec) => codePoint(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name) => named[name.toLowerCase()] ?? match)
}

/**
 * One Unicode code point as a string; invalid values become a space.
 * @param {number} value - code point.
 * @returns {string} the character.
 */
function codePoint(value) {
  try { return Number.isFinite(value) ? String.fromCodePoint(value) : ' ' } catch { return ' ' }
}

/**
 * SHA-256 of the normalized body.
 * @param {string} value - normalized text.
 * @returns {string} lowercase hex digest.
 */
export function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex')
}

/**
 * Remove terminal control sequences and cap one diff line.
 *
 * External documents are untrusted: their text must not be able to rewrite the
 * terminal, and one enormous line must not drown the report.
 * @param {string} line - raw line.
 * @returns {string} sanitized line.
 */
export function sanitizeLine(line) {
  const clean = String(line ?? '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\u001b\[[0-9;?]*[ -/]*[@-~]/g, '')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, '')
  return clean.length > 500 ? clean.slice(0, 500) + '…' : clean
}

/**
 * A compact line diff: common prefix/suffix are trimmed, the changed middle is
 * capped. This is a report, not a patch: it names WHAT changed without claiming
 * to be a reversible diff.
 * @param {string} before - previous normalized body.
 * @param {string} after - current normalized body.
 * @param {{context?: number, maxLines?: number}} [options] - rendering limits.
 * @returns {Array<{type: string, text: string}>} diff lines.
 */
export function diffLines(before, after, options = {}) {
  const context = Number.isInteger(options.context) && options.context >= 0 ? options.context : 3
  const maxLines = Number.isInteger(options.maxLines) && options.maxLines > 0 ? options.maxLines : 160
  const a = String(before ?? '').split('\n')
  const b = String(after ?? '').split('\n')
  let start = 0
  while (start < a.length && start < b.length && a[start] === b[start]) start += 1
  let endA = a.length
  let endB = b.length
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) { endA -= 1; endB -= 1 }
  if (start === endA && start === endB) return []

  const lines = []
  const push = (type, text) => lines.push({ type, text: sanitizeLine(text) })
  for (let index = Math.max(0, start - context); index < start; index += 1) push(' ', a[index])
  const removed = a.slice(start, endA)
  const added = b.slice(start, endB)
  const budget = Math.max(2, maxLines - lines.length - context)
  if (removed.length + added.length <= budget) {
    for (const line of removed) push('-', line)
    for (const line of added) push('+', line)
  } else {
    const half = Math.max(1, Math.floor(budget / 2))
    for (const line of removed.slice(0, half)) push('-', line)
    push(' ', `… ${Math.max(0, removed.length - half)} more removed line(s) …`)
    for (const line of added.slice(0, half)) push('+', line)
    push(' ', `… ${Math.max(0, added.length - half)} more added line(s) …`)
  }
  for (let index = 0; index < context && endA + index < a.length; index += 1) push(' ', a[endA + index])
  return lines.slice(0, maxLines)
}

/**
 * Fetch one watched URL.
 * @param {object} entry - watch entry.
 * @param {object} previous - previous lock entry, if any.
 * @param {object} options - `{ fetchImpl, timeoutMs }`.
 * @returns {Promise<{status: number, text: string, etag?: string, lastModified?: string}>} response.
 */
async function fetchEntry(entry, previous, options) {
  const headers = {
    'user-agent': USER_AGENT,
    accept: 'text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8',
  }
  if (typeof previous?.etag === 'string' && previous.etag !== '') headers['if-none-match'] = previous.etag
  if (typeof previous?.lastModified === 'string' && previous.lastModified !== '') headers['if-modified-since'] = previous.lastModified
  const fetchImpl = options.fetchImpl ?? globalThis.fetch
  const response = await fetchImpl(entry.url, {
    headers,
    redirect: 'follow',
    signal: AbortSignal.timeout(options.timeoutMs ?? 30000),
  })
  const status = Number(response?.status ?? 0)
  if (status === 304) return { status, text: '' }
  if (!response?.ok) throw new Error(`HTTP ${status}`)
  const buffer = await response.arrayBuffer()
  if (buffer.byteLength > MAX_BODY_BYTES) throw new Error(`body ${buffer.byteLength} exceeds ${MAX_BODY_BYTES}`)
  const text = new TextDecoder('utf-8').decode(buffer)
  return {
    status,
    text,
    headers: response.headers,
    etag: response.headers?.get?.('etag') ?? undefined,
    lastModified: response.headers?.get?.('last-modified') ?? undefined,
  }
}

/**
 * Run one manual watch pass.
 * @param {object} [options] - `{ root, entries, lock, fetchImpl, update, only, now, timeoutMs, cacheDir, lockPath }`.
 * @returns {Promise<object>} the result, including the next lock.
 */
export async function watchOnce(options = {}) {
  const root = options.root ?? DEFAULT_ROOT
  const entries = options.entries ?? (await loadWatch({ root })).entries
  const loadedLock = options.lock ?? (await loadLock({ root, lockPath: options.lockPath })).lock
  const lock = { version: 1, ...loadedLock, entries: { ...(loadedLock.entries ?? {}) } }
  const only = Array.isArray(options.only) && options.only.length > 0 ? new Set(options.only) : null
  const now = options.now ?? new Date().toISOString()
  const cacheDir = resolve(root, options.cacheDir ?? CACHE_DIR)
  const updated = options.update === true
  const results = []
  const counts = { watched: 0, unchanged: 0, changed: 0, new: 0, errors: 0, warnings: 0 }

  for (const entry of entries) {
    if (only !== null && !only.has(entry.id)) continue
    counts.watched += 1
    const previous = lock.entries[entry.id]
    const cachePath = join(cacheDir, `${entry.id}.txt`)
    try {
      const response = await fetchEntry(entry, previous, { fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs })
      if (response.status === 304 && previous !== undefined) {
        counts.unchanged += 1
        results.push({ ...entry, status: 'unchanged', sha256: previous.sha256, previous: previous.sha256, fromCache: true })
        continue
      }
      const normalized = normalizeContent(response.text, { contentType: response.headers?.get?.('content-type'), url: entry.url })
      const digest = sha256(normalized)
      let diff = []
      if (previous === undefined) {
        counts.new += 1
      } else if (previous.sha256 === digest) {
        counts.unchanged += 1
      } else {
        counts.changed += 1
        try { diff = diffLines(await readFile(cachePath, 'utf8'), normalized, options.diff) } catch { diff = [] }
      }
      const status = previous === undefined ? 'new' : previous.sha256 === digest ? 'unchanged' : 'changed'
      results.push({ ...entry, status, sha256: digest, previous: previous?.sha256, diff, bytes: Buffer.byteLength(normalized) })
      if (updated) {
        await mkdir(cacheDir, { recursive: true })
        await writeFile(cachePath, normalized, 'utf8')
        lock.entries[entry.id] = {
          url: entry.url,
          sha256: digest,
          bytes: Buffer.byteLength(normalized),
          ...(response.etag === undefined ? {} : { etag: response.etag }),
          ...(response.lastModified === undefined ? {} : { lastModified: response.lastModified }),
          fetchedAt: now,
        }
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (entry.optional === true) counts.warnings += 1
      else counts.errors += 1
      results.push({ ...entry, status: 'error', error: message, optional: entry.optional === true })
    }
  }

  if (updated) {
    const lockPath = resolve(root, options.lockPath ?? LOCK_PATH)
    await mkdir(dirname(lockPath), { recursive: true })
    const temporary = `${lockPath}.tmp-${process.pid}`
    await writeFile(temporary, JSON.stringify({ version: 1, generatedAt: now, entries: lock.entries }, null, 2) + '\n', 'utf8')
    await rename(temporary, lockPath)
  }

  return { root, now, results, counts, lock, updated, lockPath: resolve(root, options.lockPath ?? LOCK_PATH), cacheDir }
}

/**
 * Render the human or JSON report.
 * @param {object} result - watchOnce result.
 * @param {{json?: boolean}} [options] - output mode.
 * @returns {string} the report.
 */
export function renderReport(result, options = {}) {
  if (options.json === true) {
    return JSON.stringify({
      ok: result.counts.errors === 0,
      now: result.now,
      counts: result.counts,
      updated: result.updated,
      lockPath: result.lockPath,
      cacheDir: result.cacheDir,
      results: result.results.map((entry) => ({
        id: entry.id,
        url: entry.url,
        kind: entry.kind,
        specs: entry.specs,
        status: entry.status,
        sha256: entry.sha256,
        previous: entry.previous,
        optional: entry.optional === true,
        ...(entry.error === undefined ? {} : { error: sanitizeLine(entry.error) }),
        ...(entry.diff === undefined ? {} : { diff: entry.diff }),
      })),
    }, null, 2)
  }

  const lines = []
  const { counts } = result
  lines.push(`spec-watch: ${counts.watched} watched, ${counts.changed} changed, ${counts.new} new, ${counts.errors} error(s), ${counts.warnings} warning(s)`)
  lines.push(`lock: ${result.lockPath}${result.updated ? ' (updated)' : ' (read-only; pass --update to write)'}`)
  if (result.cacheDir) lines.push(`cache: ${result.cacheDir}`)
  for (const entry of result.results) {
    if (entry.status === 'unchanged') continue
    if (entry.status === 'error') {
      lines.push('')
      lines.push(`${entry.optional === true ? 'WARN' : 'ERROR'} ${entry.id} (${entry.kind}) ${entry.url}: ${sanitizeLine(entry.error)}`)
      continue
    }
    lines.push('')
    lines.push(`${entry.status.toUpperCase()} ${entry.id} (${entry.kind}) ${entry.url}`)
    if (entry.specs.length > 0) lines.push(`  specs: ${entry.specs.join(', ')}`)
    if (entry.previous !== undefined) lines.push(`  sha256: ${String(entry.previous).slice(0, 12)} -> ${String(entry.sha256).slice(0, 12)}`)
    else lines.push(`  sha256: ${String(entry.sha256).slice(0, 12)} (no baseline)`)
    for (const line of entry.diff ?? []) lines.push(`  ${line.type} ${line.text}`)
    if ((entry.diff ?? []).length === 0 && entry.status === 'changed') lines.push('  (no cached body to diff; the hash changed)')
  }
  if (!result.updated) lines.push('\nbaseline unchanged; run `npm run spec:watch -- --update` to accept the current bodies.')
  return lines.join('\n')
}

/**
 * Parse CLI arguments.
 * @param {string[]} argv - process arguments after the script.
 * @returns {object} parsed options.
 */
function parseArgs(argv) {
  const options = { update: false, json: false, failOnChange: false, only: [], timeoutMs: 30000 }
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index]
    const value = () => {
      const next = argv[index + 1]
      if (next === undefined) throw new Error(`${arg} requires a value`)
      index += 1
      return next
    }
    if (arg === '--update') options.update = true
    else if (arg === '--json') options.json = true
    else if (arg === '--fail-on-change') options.failOnChange = true
    else if (arg === '--root') options.root = value()
    else if (arg === '--lock') options.lockPath = value()
    else if (arg === '--cache-dir') options.cacheDir = value()
    else if (arg === '--timeout') options.timeoutMs = Number(value())
    else if (arg === '--now') options.now = new Date(value()).toISOString()
    else if (arg === '--only') options.only.push(...value().split(',').map((id) => id.trim()).filter(Boolean))
    else if (arg === '--help' || arg === '-h') options.help = true
    else throw new Error(`unknown argument: ${arg}`)
  }
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error('--timeout must be a positive number')
  return options
}

/** CLI entry point. */
async function main() {
  let options
  try { options = parseArgs(process.argv.slice(2)) } catch (error) {
    process.stderr.write(`spec-watch: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  }
  if (options.help) {
    process.stdout.write(`Usage: npm run spec:watch -- [options]\n\n` +
      `  --update            write specs/upstream.lock.json and the diff cache\n` +
      `  --json              machine-readable output\n` +
      `  --fail-on-change    exit 1 when a body changed or a new entry appeared\n` +
      `  --only a,b          watch only these ids\n` +
      `  --root <dir>        repository root (default: this package)\n` +
      `  --timeout <ms>      per-request timeout (default 30000)\n` +
      `  --now <iso>         clock override (tests)\n\n` +
      `Manual only: no cron, timer or background job is registered.\n`)
    process.exit(0)
  }
  const root = resolve(options.root ?? DEFAULT_ROOT)
  const watch = await loadWatch({ root })
  if (watch.errors.length > 0) {
    for (const error of watch.errors) process.stderr.write(`spec-watch: ${error}\n`)
    process.exit(2)
  }
  const loadedLock = await loadLock({ root, lockPath: options.lockPath })
  if (loadedLock.errors.length > 0) {
    for (const error of loadedLock.errors) process.stderr.write(`spec-watch: ${error}\n`)
    process.exit(2)
  }
  const result = await watchOnce({
    root,
    entries: watch.entries,
    lock: loadedLock.lock,
    update: options.update,
    only: options.only,
    now: options.now,
    timeoutMs: options.timeoutMs,
    cacheDir: options.cacheDir,
    lockPath: options.lockPath,
    diff: { context: 3, maxLines: 120 },
  })
  process.stdout.write(renderReport(result, { json: options.json }) + '\n')
  if (result.counts.errors > 0) process.exit(2)
  if (options.failOnChange && result.counts.changed + result.counts.new > 0) process.exit(1)
  process.exit(0)
}

if (process.argv[1] !== undefined && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  main().catch((error) => {
    process.stderr.write(`spec-watch: ${error instanceof Error ? error.message : String(error)}\n`)
    process.exit(2)
  })
}
