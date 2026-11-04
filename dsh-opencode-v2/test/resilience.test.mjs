/**
 * Resilience contract tests: orphan cleanup + salvage manifests.
 *
 * These cover the two behaviors added for the measured 2026-11-05 failure: a
 * parent turn could die while its children kept running, and a dead child's
 * surviving files were invisible to the parent, which re-ran the whole track.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, readFile, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  collectChangedFiles,
  installResilience,
  isOrphan,
  resolveSalvageDir,
  runningDescendants,
  writeSalvageManifest,
} from '../lib/resilience.js'

/** Schemastery-like accessor bag. */
const cfg = (values = {}) => {
  const defaults = {
    orphanCleanup: true,
    orphanSweepMs: 60000,
    salvage: true,
    salvageDir: '',
    salvageMaxFiles: 200,
  }
  const all = { ...defaults, ...values }
  return Object.fromEntries(Object.entries(all).map(([key, value]) => [key, { get: () => value }]))
}

const agent = (id, { parent, origin = 'subagent', status = 'running' } = {}) => ({
  id,
  status,
  session: { id, header: parent === undefined ? {} : { parentSession: parent, origin } },
  cancelled: 0,
  cancel() {
    this.cancelled += 1
    this.status = 'idle'
  },
})

test('resolveSalvageDir follows explicit, DSH_HOME, then the home default', () => {
  const previous = process.env.DSH_HOME
  try {
    process.env.DSH_HOME = '/tmp/dsh-home-test'
    assert.equal(resolveSalvageDir('/explicit/dir'), '/explicit/dir')
    assert.equal(resolveSalvageDir(''), join('/tmp/dsh-home-test', 'opencode-v2', 'salvage'))
  } finally {
    if (previous === undefined) delete process.env.DSH_HOME
    else process.env.DSH_HOME = previous
  }
})

test('runningDescendants walks the durable lineage at any depth', () => {
  const parent = agent('parent-1', { origin: undefined })
  const running = agent('child-1', { parent: 'parent-1' })
  const nested = agent('grandchild-1', { parent: 'child-1' })
  const idle = agent('child-2', { parent: 'parent-1', status: 'idle' })
  const unrelated = agent('other-1', { parent: 'other-parent' })
  const agents = { list: () => [parent, running, nested, idle, unrelated] }
  const found = runningDescendants(agents, 'parent-1').map((entry) => entry.id)
  assert.deepEqual(found, ['child-1', 'grandchild-1'])
})

test('isOrphan reports a child whose parent is no longer live', () => {
  const child = agent('child-1', { parent: 'gone-parent' })
  const liveChild = agent('child-2', { parent: 'live-parent' })
  const liveParent = agent('live-parent', { origin: undefined })
  const agents = { list: () => [liveParent, liveChild, child] }
  assert.equal(isOrphan(agents, child), true)
  assert.equal(isOrphan(agents, liveChild), false)
})

test('collectChangedFiles returns recent files and skips generated trees', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-salvage-scan-'))
  await mkdir(join(root, 'node_modules', 'pkg'), { recursive: true })
  await mkdir(join(root, 'track'), { recursive: true })
  await writeFile(join(root, 'track', 'report.json'), '{"ok":true}\n')
  await writeFile(join(root, 'node_modules', 'pkg', 'index.js'), 'ignored\n')
  const listed = await collectChangedFiles(root, { sinceMs: 0, maxFiles: 50 })
  assert.deepEqual(listed.files.map((file) => file.path), ['track/report.json'])
  assert.equal(listed.truncated, false)
  const none = await collectChangedFiles(root, { sinceMs: Date.now() + 60_000 })
  assert.deepEqual(none.files, [])
})

test('writeSalvageManifest preserves the file list and the failure reason', async () => {
  const root = await mkdtemp(join(tmpdir(), 'dsh-salvage-work-'))
  const dir = await mkdtemp(join(tmpdir(), 'dsh-salvage-out-'))
  await mkdir(join(root, 'track'), { recursive: true })
  await writeFile(join(root, 'track', 'daily.csv'), 'day,net\n')
  const createdAt = Date.now() - 5000
  const session = { id: 'child-1', header: { origin: 'subagent', parentSession: 'parent-1', createdAt, cwd: root } }
  const event = {
    type: 'turn/end',
    time: Date.now(),
    data: { reason: { kind: 'error', error: { code: 'OPENCODE_BACKEND_HTTP', message: 'HTTP 451' } } },
  }
  const path = await writeSalvageManifest({ session, event }, { dir, maxFiles: 10 })
  assert.equal(path, join(dir, 'child-1.json'))
  const manifest = JSON.parse(await readFile(path, 'utf8'))
  assert.equal(manifest.kind, 'subagent-salvage')
  assert.equal(manifest.parentSessionId, 'parent-1')
  assert.equal(manifest.reason.code, 'OPENCODE_BACKEND_HTTP')
  assert.deepEqual(manifest.files.map((file) => file.path), ['track/daily.csv'])
  const markdown = await readFile(join(dir, 'child-1.md'), 'utf8')
  assert.match(markdown, /HTTP 451/)
  assert.match(markdown, /track\/daily\.csv/)
})

test('a failed parent turn cancels its running descendants', () => {
  const parent = agent('parent-1', { origin: undefined, status: 'running' })
  const child = agent('child-1', { parent: 'parent-1' })
  const agents = { list: () => [parent, child] }
  const handlers = []
  const ctx = { agents, on: (name, handler) => handlers.push({ name, handler }), logger: { warn() {} } }
  const installed = installResilience(ctx, cfg({ salvage: false, salvageDir: '/tmp/never-used' }), () => {})
  try {
    assert.equal(handlers.length, 1)
    handlers[0].handler(parent.session, { type: 'turn/end', data: { reason: { kind: 'error', error: { message: 'boom' } } } })
    assert.equal(child.cancelled, 1, 'the child is cancelled when the parent turn fails')
  } finally {
    installed.dispose()
  }
})

test('a failed child turn writes a salvage manifest', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-salvage-event-'))
  const agents = { list: () => [] }
  const handlers = []
  const ctx = { agents, on: (name, handler) => handlers.push({ name, handler }), logger: { warn() {} } }
  const installed = installResilience(ctx, cfg({ salvageDir: dir }), () => {})
  try {
    const session = { id: 'child-2', header: { origin: 'subagent', parentSession: 'parent-1', createdAt: Date.now() - 1000, cwd: dir } }
    handlers[0].handler(session, {
      type: 'turn/end',
      time: Date.now(),
      data: { reason: { kind: 'error', error: { code: 'X', message: 'died' } } },
    })
    // writeSalvageManifest is fire-and-forget; wait for the file to land.
    const target = join(dir, 'child-2.json')
    for (let attempt = 0; attempt < 50; attempt += 1) {
      try {
        const raw = await readFile(target, 'utf8')
        assert.equal(JSON.parse(raw).reason.message, 'died')
        return
      } catch {
        await new Promise((resolve) => setTimeout(resolve, 20))
      }
    }
    assert.fail('salvage manifest was not written')
  } finally {
    installed.dispose()
  }
})

test('the orphan sweep cancels only children whose parent is gone', () => {
  const liveParent = agent('parent-live', { origin: undefined, status: 'running' })
  const liveChild = agent('child-live', { parent: 'parent-live' })
  const orphan = agent('child-orphan', { parent: 'parent-gone' })
  const agents = { list: () => [liveParent, liveChild, orphan] }
  const ctx = { agents, on: () => {}, logger: { warn() {} } }
  const installed = installResilience(ctx, cfg({ salvage: false }), () => {})
  try {
    assert.equal(installed.sweep(), 1)
    assert.equal(orphan.cancelled, 1)
    assert.equal(liveChild.cancelled, 0)
  } finally {
    installed.dispose()
  }
})
