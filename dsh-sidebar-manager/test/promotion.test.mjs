/**
 * Integration tests for the ported promotion engine (promotion/* routes).
 *
 * These run entirely against an in-memory mock of `ctx.workspaceRegistry` and
 * `ctx.sessionPersistence` inside a throwaway temp DSH home. They never touch
 * ~/.dsh, workspace.json, or any real session log.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

import {
  createTransactionRoutes,
  previewPromotion,
  applyPromotion,
  finalizePendingPromotion,
  resolveOptions,
} from '../lib/transaction.mjs'

/** Minimal WorkspaceRegistry double: create/get/list/attach/delete. */
function mockRegistry(seed = [], headersById = new Map()) {
  const workspaces = new Map()
  let counter = 0
  const make = (record) => {
    const entry = {
      get id() {
        return record.id
      },
      get path() {
        return record.path
      },
      get title() {
        return record.title
      },
      record,
      async attachSession(id) {
        if (record.sessionIds.includes(id)) return
        // Mirrors the real dsh-workspace attachSession: it validates the stored
        // header cwd against the workspace path and does NOT enforce
        // single-workspace ownership. Ownership is the caller's responsibility,
        // which is exactly what attachCandidates guards.
        const header = headersById.get(id)
        if (header === undefined) throw new Error(`cannot attach session '${id}': unknown header`)
        if (header.cwd !== record.path) {
          throw new Error(`cannot attach session '${id}': its cwd resolves to '${header.cwd}'`)
        }
        record.sessionIds.push(id)
      },
      async setTitle(value) {
        record.title = value
      },
    }
    workspaces.set(record.id, entry)
    return entry
  }
  for (const seedRecord of seed) make({ ...seedRecord, sessionIds: [...seedRecord.sessionIds] })
  return {
    workspaces,
    list: () => [...workspaces.values()],
    get: (id) => workspaces.get(id),
    archivedSessionIds: [],
    async create(wsPath, title) {
      counter += 1
      const id = `ws-new-${counter}`
      return make({ id, path: wsPath, title, sessionIds: [] })
    },
  }
}

/** Minimal sessionPersistence double. */
function mockPersistence(headers) {
  return { list: async () => headers.map((header) => ({ header })) }
}

/** Build a registry whose attachSession validates header cwd against workspace path. */
function seededRegistry(seed, headers) {
  const byId = new Map(headers.map((header) => [header.id, header]))
  return mockRegistry(seed, byId)
}

function makeContext({ registry, headers, logger }) {
  const services = new Map([
    ['workspaceRegistry', registry],
    ['sessionPersistence', mockPersistence(headers)],
    ['agents', { get: () => undefined }],
    ['sessions', { get: () => undefined }],
  ])
  return {
    get: (name) => services.get(name),
    logger: logger ?? { warn() {} },
  }
}

/** Build an isolated options object rooted in a fresh temp directory. */
function makeOptions(root) {
  const options = resolveOptions({
    // dshHome MUST be redirected: the engine writes workspace.json backups and
    // promotion journals under it. Without this the suite wrote into the live
     // ~/.dsh. Guarded below as well.
    dshHome: path.join(root, 'dsh-home'),
    backupDir: path.join(root, 'backup'),
    stateDir: path.join(root, 'state'),
    projectsRoot: path.join(root, 'projects'),
    allowExternalPaths: false,
  })
  const live = path.join(os.homedir(), '.dsh')
  if (path.resolve(options.dshHome) === path.resolve(live)) {
    throw new Error('refusing to run: options.dshHome resolved to the live ~/.dsh')
  }
  if (!path.resolve(options.dshHome).startsWith(path.resolve(root))) {
    throw new Error(`refusing to run: options.dshHome "${options.dshHome}" escaped the temp root`)
  }
  return options
}

function makeRoot() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-test-'))
  fs.mkdirSync(path.join(root, 'projects'), { recursive: true })
  return root
}

function post(body) {
  return new Request('http://localhost/api/local/sidebar/x', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
}

// ---------------------------------------------------------------------------

test('routes expose promotion/preview, promotion/apply, promotion/status', async () => {
  const root = makeRoot()
  const ctx = makeContext({ registry: mockRegistry(), headers: [] })
  const routes = createTransactionRoutes(ctx, makeOptions(root))
  for (const name of ['promotion/preview', 'promotion/apply', 'promotion/status']) {
    assert.equal(typeof routes[name], 'function', `${name} must be registered`)
  }
  // Pre-existing routes must survive the integration.
  assert.equal(typeof routes['session/move'], 'function')
  assert.equal(typeof routes['workspace/archive'], 'function')
  fs.rmSync(root, { recursive: true, force: true })
})

test('preview refuses a missing path without mutating the registry', async () => {
  const root = makeRoot()
  const registry = mockRegistry()
  const ctx = makeContext({ registry, headers: [] })
  const result = await previewPromotion(ctx, makeOptions(root), {})
  assert.equal(result.ok, false)
  assert.ok(result.blockerCodes.includes('PATH_REQUIRED'))
  assert.equal(registry.list().length, 0)
  fs.rmSync(root, { recursive: true, force: true })
})

test('preview rejects a path outside projectsRoot', async () => {
  const root = makeRoot()
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'promo-outside-'))
  const ctx = makeContext({ registry: mockRegistry(), headers: [] })
  const result = await previewPromotion(ctx, makeOptions(root), { path: outside })
  assert.equal(result.ok, false)
  assert.ok(result.blockerCodes.includes('PATH_OUTSIDE_ROOT'), JSON.stringify(result.blockerCodes))
  fs.rmSync(root, { recursive: true, force: true })
  fs.rmSync(outside, { recursive: true, force: true })
})

test('preview rejects a nonexistent directory instead of creating a phantom workspace', async () => {
  const root = makeRoot()
  const ctx = makeContext({ registry: mockRegistry(), headers: [] })
  const result = await previewPromotion(ctx, makeOptions(root), { path: path.join(root, 'projects', 'nope') })
  assert.equal(result.ok, false)
  assert.ok(result.blockerCodes.includes('PATH_UNRESOLVABLE'), JSON.stringify(result.blockerCodes))
  fs.rmSync(root, { recursive: true, force: true })
})

test('preview refuses the default workspace', async () => {
  const root = makeRoot()
  const target = path.join(root, 'projects', 'default-ws')
  fs.mkdirSync(target)
  const options = makeOptions(root)
  // defaultWorkspaceId reads the registry file; seed it in the temp home.
  fs.mkdirSync(path.join(options.dshHome, 'storages'), { recursive: true })
  fs.writeFileSync(
    path.join(options.dshHome, 'storages', 'workspace.json'),
    JSON.stringify({ global: { defaultWorkspaceId: 'ws-default' } }),
  )
  const registry = mockRegistry([{ id: 'ws-default', path: fs.realpathSync(target), title: 'Default', sessionIds: [] }])
  const ctx = makeContext({ registry, headers: [{ id: 's1', cwd: fs.realpathSync(target), createdAt: 1 }] })
  const result = await previewPromotion(ctx, options, { path: target })
  assert.equal(result.ok, false)
  assert.ok(result.blockerCodes.includes('DEFAULT_WORKSPACE'), JSON.stringify(result.blockerCodes))
  fs.rmSync(root, { recursive: true, force: true })
})

test('preview lists unaccounted same-cwd sessions as candidates in creation order', async () => {
  const root = makeRoot()
  const target = fs.realpathSync(fs.mkdtempSync(path.join(root, 'projects', 'alpha-')))
  const ctx = makeContext({
    registry: mockRegistry(),
    headers: [
      { id: 'sB', cwd: target, createdAt: 200 },
      { id: 'sA', cwd: target, createdAt: 100 },
      { id: 'sOther', cwd: '/somewhere/else', createdAt: 50 },
    ],
  })
  const result = await previewPromotion(ctx, makeOptions(root), { path: target })
  assert.equal(result.ok, true, JSON.stringify(result.blockers))
  assert.deepEqual(result.candidateSessionIds, ['sA', 'sB'])
  assert.equal(result.effects.restartRequired, false)
  assert.equal(result.governance.gate, 'unavailable')
  fs.rmSync(root, { recursive: true, force: true })
})

test('apply registers the workspace, attaches sessions, and commits the journal', async () => {
  const root = makeRoot()
  const target = fs.realpathSync(fs.mkdtempSync(path.join(root, 'projects', 'beta-')))
  const headers = [{ id: 's1', cwd: target, createdAt: 1 }]
  const registry = seededRegistry([], headers)
  const options = makeOptions(root)
  const ctx = makeContext({ registry, headers })

  const result = await applyPromotion(ctx, options, { path: target, title: 'Beta' })
  assert.equal(result.ok, true, JSON.stringify(result.blockers ?? result))
  assert.equal(result.created, true)
  assert.deepEqual(result.attachedSessionIds, ['s1'])
  assert.equal(result.restartRequired, false)

  const created = registry.get(result.workspaceId)
  assert.equal(created.title, 'Beta')
  assert.deepEqual(created.record.sessionIds, ['s1'])

  const journal = JSON.parse(fs.readFileSync(path.join(options.stateDir, 'promotion', 'pending.json'), 'utf8'))
  assert.equal(journal.state, 'committed')
  assert.equal(journal.txid, result.txid)
  // Lock must be released even on success.
  assert.equal(fs.existsSync(path.join(options.stateDir, 'promotion', 'lock.json')), false)
  fs.rmSync(root, { recursive: true, force: true })
})

test('apply is idempotent for an already registered workspace', async () => {
  const root = makeRoot()
  const target = fs.realpathSync(fs.mkdtempSync(path.join(root, 'projects', 'gamma-')))
  const headers = [{ id: 's1', cwd: target, createdAt: 1 }]
  const registry = seededRegistry([], headers)
  const options = makeOptions(root)
  const ctx = makeContext({ registry, headers })

  const first = await applyPromotion(ctx, options, { path: target, title: 'Gamma' })
  assert.equal(first.ok, true)
  const second = await applyPromotion(ctx, options, { path: target, title: 'Gamma' })
  assert.equal(second.ok, true, JSON.stringify(second.blockers ?? second))
  assert.equal(second.alreadyRegistered, true)
  assert.equal(second.created, false)
  assert.equal(second.workspaceId, first.workspaceId)
  assert.deepEqual(second.attachedSessionIds, [])
  assert.equal(registry.list().length, 1)
  fs.rmSync(root, { recursive: true, force: true })
})

test('apply refuses a session already accounted by another workspace', async () => {
  const root = makeRoot()
  const target = fs.realpathSync(fs.mkdtempSync(path.join(root, 'projects', 'delta-')))
  const headers = [{ id: 's1', cwd: target, createdAt: 1 }]
  const registry = seededRegistry([{ id: 'ws-owner', path: '/elsewhere', title: 'Owner', sessionIds: ['s1'] }], headers)
  const ctx = makeContext({ registry, headers })
  const result = await applyPromotion(ctx, makeOptions(root), { path: target })
  assert.equal(result.ok, false)
  assert.ok(result.blockerCodes.includes('SESSION_ALREADY_ACCOUNTED'), JSON.stringify(result.blockerCodes))
  fs.rmSync(root, { recursive: true, force: true })
})

test('apply rejects an unsupported mode', async () => {
  const root = makeRoot()
  const ctx = makeContext({ registry: mockRegistry(), headers: [] })
  const result = await applyPromotion(ctx, makeOptions(root), { mode: 'scratch-cold', path: '/tmp' })
  assert.equal(result.ok, false)
  assert.deepEqual(result.blockerCodes, ['UNSUPPORTED_MODE'])
  fs.rmSync(root, { recursive: true, force: true })
})

test('concurrent apply is serialized by the lock and reports LOCK_HELD', async () => {
  const root = makeRoot()
  const target = fs.realpathSync(fs.mkdtempSync(path.join(root, 'projects', 'epsilon-')))
  const options = makeOptions(root)
  fs.mkdirSync(path.join(options.stateDir, 'promotion'), { recursive: true })
  fs.writeFileSync(
    path.join(options.stateDir, 'promotion', 'lock.json'),
    JSON.stringify({ txid: 'someone-else', acquiredAt: Date.now(), expiresAt: Date.now() + 60_000 }),
  )
  const ctx = makeContext({ registry: mockRegistry(), headers: [{ id: 's1', cwd: target, createdAt: 1 }] })
  const result = await applyPromotion(ctx, options, { path: target })
  assert.equal(result.ok, false)
  assert.ok(result.blockerCodes.includes('LOCK_HELD'), JSON.stringify(result.blockerCodes))
  fs.rmSync(root, { recursive: true, force: true })
})

test('an expired lock does not block apply', async () => {
  const root = makeRoot()
  const target = fs.realpathSync(fs.mkdtempSync(path.join(root, 'projects', 'zeta-')))
  const options = makeOptions(root)
  fs.mkdirSync(path.join(options.stateDir, 'promotion'), { recursive: true })
  fs.writeFileSync(
    path.join(options.stateDir, 'promotion', 'lock.json'),
    JSON.stringify({ txid: 'stale', acquiredAt: 1, expiresAt: Date.now() - 1000 }),
  )
  const headers = [{ id: 's1', cwd: target, createdAt: 1 }]
  const ctx = makeContext({ registry: seededRegistry([], headers), headers })
  const result = await applyPromotion(ctx, options, { path: target, title: 'Zeta' })
  assert.equal(result.ok, true, JSON.stringify(result.blockers ?? result))
  fs.rmSync(root, { recursive: true, force: true })
})

test('boot finalizer completes a promotion that crashed before attach', async () => {
  const root = makeRoot()
  const target = fs.realpathSync(fs.mkdtempSync(path.join(root, 'projects', 'eta-')))
  const options = makeOptions(root)
  const journalFile = path.join(options.stateDir, 'promotion', 'pending.json')
  fs.mkdirSync(path.dirname(journalFile), { recursive: true })
  fs.writeFileSync(
    journalFile,
    JSON.stringify({
      txid: 'promotion-crashed',
      kind: 'promotion',
      mode: 'existing',
      state: 'workspace-ready',
      target: { path: target, title: 'Eta' },
      candidateSessionIds: ['s1', 's2'],
      workspaceId: 'ws-eta',
      createdWorkspace: true,
    }),
  )
  const headers = [
    { id: 's1', cwd: target, createdAt: 1 },
    { id: 's2', cwd: target, createdAt: 2 },
  ]
  const registry = seededRegistry([{ id: 'ws-eta', path: target, title: 'Eta', sessionIds: [] }], headers)
  const ctx = makeContext({ registry, headers })

  const result = await finalizePendingPromotion(ctx, options)
  assert.equal(result.state, 'committed')
  assert.deepEqual(result.attachedSessionIds, ['s1', 's2'])
  assert.deepEqual(registry.get('ws-eta').record.sessionIds, ['s1', 's2'])
  const journal = JSON.parse(fs.readFileSync(journalFile, 'utf8'))
  assert.equal(journal.state, 'committed')
  fs.rmSync(root, { recursive: true, force: true })
})

test('boot finalizer is a no-op once committed', async () => {
  const root = makeRoot()
  const options = makeOptions(root)
  const journalFile = path.join(options.stateDir, 'promotion', 'pending.json')
  fs.mkdirSync(path.dirname(journalFile), { recursive: true })
  fs.writeFileSync(journalFile, JSON.stringify({ txid: 't', state: 'committed', mode: 'existing' }))
  const ctx = makeContext({ registry: mockRegistry(), headers: [] })
  const result = await finalizePendingPromotion(ctx, options)
  assert.equal(result.state, 'committed')
  assert.equal(result.attachedSessionIds, undefined)
  fs.rmSync(root, { recursive: true, force: true })
})

test('PROMOTION ROUTE: promotion/status returns the journal', async () => {
  const root = makeRoot()
  const options = makeOptions(root)
  const registry = mockRegistry()
  const ctx = makeContext({ registry, headers: [] })
  const routes = createTransactionRoutes(ctx, options)

  const empty = await (await routes['promotion/status'](post({}))).json()
  assert.equal(empty.ok, true)
  assert.equal(empty.journal, null)

  const target = fs.realpathSync(fs.mkdtempSync(path.join(root, 'projects', 'theta-')))
  await applyPromotion(ctx, options, { path: target, title: 'Theta' })
  const after = await (await routes['promotion/status'](post({}))).json()
  assert.equal(after.journal.state, 'committed')
  assert.equal(after.journal.title ?? after.journal.target.title, 'Theta')
  fs.rmSync(root, { recursive: true, force: true })
})

test('PROMOTION ROUTE: promotion/preview + promotion/apply over HTTP semantics', async () => {
  const root = makeRoot()
  const options = makeOptions(root)
  const target = fs.realpathSync(fs.mkdtempSync(path.join(root, 'projects', 'iota-')))
  const headers = [{ id: 's1', cwd: target, createdAt: 1 }]
  const registry = seededRegistry([], headers)
  const ctx = makeContext({ registry, headers })
  const routes = createTransactionRoutes(ctx, options)

  const preview = await routes['promotion/preview'](post({ path: target, title: 'Iota' }))
  assert.equal(preview.status, 200)
  const previewBody = await preview.json()
  assert.equal(previewBody.ok, true)
  assert.deepEqual(previewBody.candidateSessionIds, ['s1'])

  const applied = await routes['promotion/apply'](post({ path: target, title: 'Iota' }))
  assert.equal(applied.status, 200)
  const appliedBody = await applied.json()
  assert.equal(appliedBody.ok, true)
  assert.equal(appliedBody.attachedSessionIds.length, 1)

  const blocked = await routes['promotion/apply'](post({}))
  assert.equal(blocked.status, 409)
  const blockedBody = await blocked.json()
  assert.equal(blockedBody.ok, false)
  assert.ok(blockedBody.blockerCodes.includes('PATH_REQUIRED'))
  fs.rmSync(root, { recursive: true, force: true })
})

test('boot finalizer refuses a replayed journal whose session was claimed meanwhile', async () => {
  // The attach-time guard is the last line of defence: preview validated the
  // candidates, but a crash + retry can replay an old journal after another
  // workspace legitimately took the session. The finalizer must refuse, keep the
  // journal, and leave the other workspace's membership untouched.
  const root = makeRoot()
  const target = fs.realpathSync(fs.mkdtempSync(path.join(root, 'projects', 'race-')))
  const options = makeOptions(root)
  const journalFile = path.join(options.stateDir, 'promotion', 'pending.json')
  fs.mkdirSync(path.dirname(journalFile), { recursive: true })
  fs.writeFileSync(
    journalFile,
    JSON.stringify({
      txid: 'promotion-race',
      kind: 'promotion',
      mode: 'existing',
      state: 'workspace-ready',
      target: { path: target, title: 'Race' },
      candidateSessionIds: ['s-contested'],
      workspaceId: 'ws-race',
      createdWorkspace: true,
    }),
  )
  const registry = mockRegistry([
    { id: 'ws-race', path: target, title: 'Race', sessionIds: [] },
    { id: 'ws-other', path: '/somewhere/other', title: 'Other', sessionIds: ['s-contested'] },
  ])
  const ctx = makeContext({ registry, headers: [] })

  const result = await finalizePendingPromotion(ctx, options)
  assert.equal(result.state, 'failed')
  assert.match(result.error, /SESSION_ALREADY_ACCOUNTED/)
  assert.deepEqual(registry.get('ws-race').record.sessionIds, [])
  assert.deepEqual(registry.get('ws-other').record.sessionIds, ['s-contested'])
  // Journal is retained so the situation stays visible instead of silently dropped.
  assert.notEqual(JSON.parse(fs.readFileSync(journalFile, 'utf8')).state, 'committed')
  fs.rmSync(root, { recursive: true, force: true })
})

test('promotion engine needs no UTM ledger and writes only local journals', async () => {
  const root = makeRoot()
  const options = makeOptions(root)
  const target = fs.realpathSync(fs.mkdtempSync(path.join(root, 'projects', 'kappa-')))
  const headers = [{ id: 's1', cwd: target, createdAt: 1 }]
  const ctx = makeContext({ registry: seededRegistry([], headers), headers })

  const result = await applyPromotion(ctx, options, { path: target, title: 'Kappa' })
  assert.equal(result.ok, true, JSON.stringify(result.blockers ?? result))

  // No governance directory is created or required.
  assert.equal(fs.existsSync(path.join(options.dshHome, 'governance')), false)
  // The only artefacts are the promotion journal under the plugin state dir.
  assert.equal(fs.existsSync(path.join(options.stateDir, 'promotion', 'pending.json')), true)
  // preview always reports the offline governance signal honestly.
  const preview = await previewPromotion(ctx, options, { path: target })
  assert.equal(preview.governance.gate, 'unavailable')
  fs.rmSync(root, { recursive: true, force: true })
})
