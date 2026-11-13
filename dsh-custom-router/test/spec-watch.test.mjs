/**
 * `spec:watch` — manual upstream change detection.
 *
 * All tests are offline: the fetch is injected. The script itself never
 * registers a timer and the tests must not either.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  CACHE_DIR,
  LOCK_PATH,
  WATCH_PATH,
  diffLines,
  loadWatch,
  normalizeContent,
  renderReport,
  sanitizeLine,
  sha256,
  watchOnce,
} from '../scripts/spec-watch.mjs'

/** A fetch response double. */
function response(text, options = {}) {
  const status = options.status ?? 200
  const headerMap = { 'content-type': options.contentType ?? 'text/html; charset=utf-8', ...(options.headers ?? {}) }
  return {
    ok: status >= 200 && status < 300,
    status,
    headers: { get: (name) => headerMap[String(name).toLowerCase()] ?? null },
    async arrayBuffer() {
      const bytes = new TextEncoder().encode(text)
      return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    },
  }
}

/** A temporary repo root with a specs dir. */
async function tempRoot() {
  const root = await mkdtemp(join(tmpdir(), 'spec-watch-'))
  await mkdir(join(root, 'specs'), { recursive: true })
  return root
}

test('HTML is reduced to text before hashing; scripts and entities do not leak', () => {
  const html = '<!doctype html><html><head><script>var build="abc"</script><style>.x{}</style></head><body><h1>Hello&nbsp;World</h1><p>A &amp; B</p></body></html>'
  const text = normalizeContent(html, { contentType: 'text/html' })
  assert.equal(text, 'Hello World A & B')
  assert.equal(sha256(text), sha256('Hello World A & B'))
})

test('JSON key order and id-array order do not create a false change', () => {
  const a = '{"b":1,"a":[{"id":"z","v":1},{"id":"a","v":2}]}'
  const b = '{"a":[{"id":"a","v":2},{"id":"z","v":1}],"b":1}'
  assert.equal(
    normalizeContent(a, { contentType: 'application/json' }),
    normalizeContent(b, { contentType: 'application/json' }),
  )
})

test('line endings and trailing spaces are normalized', () => {
  assert.equal(normalizeContent('a  \r\nb\r\n\r\n\r\nc\t'), 'a\nb\n\nc')
})

test('sanitizeLine removes ANSI/control sequences and caps length', () => {
  const clean = sanitizeLine('\u001b[31mred\u001b[0m\u0007' + 'x'.repeat(600))
  assert.equal(clean.startsWith('red'), true)
  assert.equal(clean.length <= 501, true)
})

test('diffLines reports the changed middle with context and a cap', () => {
  const before = 'a\nb\nc\nold\nd\n'
  const after = 'a\nb\nc\nnew\nd\n'
  const lines = diffLines(before, after)
  assert.deepEqual(lines.map((line) => line.type), [' ', ' ', ' ', '-', '+', ' ', ' '])
  assert.equal(lines[3].text, 'old')
  assert.equal(lines[4].text, 'new')
  const capped = diffLines('x\n' + 'a\n'.repeat(500), 'x\n' + 'b\n'.repeat(500), { maxLines: 10 })
  assert.equal(capped.length <= 10, true)
  assert.equal(capped.some((line) => /omitted|more .* line/.test(line.text)), true)
})

test('the real watch registry is valid', async () => {
  const watch = await loadWatch()
  assert.deepEqual(watch.errors, [])
  assert.equal(watch.entries.length >= 10, true)
  assert.equal(new Set(watch.entries.map((entry) => entry.id)).size, watch.entries.length)
  for (const entry of watch.entries) assert.match(entry.url, /^https?:\/\//)
})

test('a new URL is reported as new; --update writes the lock and cache', async () => {
  const root = await tempRoot()
  const entries = [{ id: 'doc', url: 'https://example.test/doc', kind: 'provider', specs: ['exaone'] }]
  const fetched = []
  const fetchImpl = async (url) => {
    fetched.push(url)
    return response('<html><body>v1</body></html>', { contentType: 'text/html' })
  }
  const first = await watchOnce({ root, entries, fetchImpl, now: '2026-11-14T00:00:00.000Z' })
  assert.equal(first.counts.new, 1)
  assert.equal(first.counts.changed, 0)
  assert.equal(first.updated, false)

  const second = await watchOnce({ root, entries, fetchImpl, now: '2026-11-14T00:00:00.000Z', update: true })
  assert.equal(second.updated, true)
  const lock = JSON.parse(await readFile(join(root, LOCK_PATH), 'utf8'))
  assert.equal(lock.entries.doc.url, 'https://example.test/doc')
  assert.equal(lock.entries.doc.sha256, sha256('v1'))
  const cache = await readFile(join(root, CACHE_DIR, 'doc.txt'), 'utf8')
  assert.equal(cache, 'v1')
})

test('an unchanged body is unchanged and a changed body carries a sanitized diff', async () => {
  const root = await tempRoot()
  const entries = [{ id: 'doc', url: 'https://example.test/doc', kind: 'provider', specs: [] }]
  const baseline = sha256('v1')
  await mkdir(join(root, CACHE_DIR), { recursive: true })
  await writeFile(join(root, CACHE_DIR, 'doc.txt'), 'v1', 'utf8')
  const lock = { version: 1, entries: { doc: { url: entries[0].url, sha256: baseline } } }

  const unchanged = await watchOnce({ root, entries, lock, now: '2026-11-14T00:00:00.000Z', fetchImpl: async () => response('v1', { contentType: 'text/plain' }) })
  assert.equal(unchanged.counts.unchanged, 1)
  assert.equal(unchanged.results[0].status, 'unchanged')

  const changed = await watchOnce({
    root,
    entries,
    lock,
    now: '2026-11-14T00:00:00.000Z',
    fetchImpl: async () => response('v1\u001b[31m\nv2', { contentType: 'text/plain' }),
  })
  assert.equal(changed.counts.changed, 1)
  assert.equal(changed.results[0].status, 'changed')
  assert.equal(changed.results[0].diff.some((line) => line.text.includes('v2')), true)
  assert.equal(changed.results[0].diff.some((line) => line.text.includes('\u001b[31m')), false)
})

test('a 304 with a previous hash is unchanged without reading a body', async () => {
  const root = await tempRoot()
  const entries = [{ id: 'doc', url: 'https://example.test/doc', kind: 'provider', specs: [] }]
  const lock = { version: 1, entries: { doc: { url: entries[0].url, sha256: sha256('v1'), etag: '"abc"' } } }
  const result = await watchOnce({ root, entries, lock, now: '2026-11-14T00:00:00.000Z', fetchImpl: async () => ({ ok: false, status: 304, headers: { get: () => null } }) })
  assert.equal(result.counts.unchanged, 1)
  assert.equal(result.results[0].sha256, sha256('v1'))
})

test('an optional fetch error is a warning; a required one is an error', async () => {
  const root = await tempRoot()
  const optional = [{ id: 'blocked', url: 'https://example.test/blocked', kind: 'changelog', specs: [], optional: true }]
  const warn = await watchOnce({ root, entries: optional, now: '2026-11-14T00:00:00.000Z', fetchImpl: async () => { throw new Error('HTTP 403') } })
  assert.equal(warn.counts.warnings, 1)
  assert.equal(warn.counts.errors, 0)

  const required = [{ id: 'blocked', url: 'https://example.test/blocked', kind: 'changelog', specs: [] }]
  const fail = await watchOnce({ root, entries: required, now: '2026-11-14T00:00:00.000Z', fetchImpl: async () => { throw new Error('HTTP 500') } })
  assert.equal(fail.counts.errors, 1)
  assert.equal(fail.counts.warnings, 0)
})

test('the JSON report is machine-readable and the text report names a change', async () => {
  const root = await tempRoot()
  const entries = [{ id: 'doc', url: 'https://example.test/doc', kind: 'provider', specs: [] }]
  const lock = { version: 1, entries: { doc: { url: entries[0].url, sha256: sha256('v1') } } }
  const result = await watchOnce({ root, entries, lock, now: '2026-11-14T00:00:00.000Z', fetchImpl: async () => response('v2', { contentType: 'text/plain' }) })
  const json = JSON.parse(renderReport(result, { json: true }))
  assert.equal(json.counts.changed, 1)
  assert.equal(json.results[0].status, 'changed')
  const text = renderReport(result)
  assert.match(text, /CHANGED doc/)
  assert.match(text, /sha256:/)
})

test('the registry path is the documented one', async () => {
  const root = await tempRoot()
  const path = join(root, WATCH_PATH)
  await mkdir(join(root, 'specs'), { recursive: true })
  await writeFile(path, JSON.stringify({ version: 1, entries: [] }), 'utf8')
  const watch = await loadWatch({ root })
  assert.deepEqual(watch.errors, [])
  assert.equal(watch.entries.length, 0)
})
