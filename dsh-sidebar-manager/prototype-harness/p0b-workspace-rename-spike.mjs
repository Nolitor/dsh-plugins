#!/usr/bin/env node
/**
 * P0b spike — workspace directory rename transaction in a sandbox.
 *
 * Validates the restart-finalize design without touching the real DSH home:
 *   Phase A (online): guards -> backup -> journal -> rename directory ->
 *                     rewrite every affected session header/path -> verify
 *   Phase B (next boot): reindex headers from disk -> create the new workspace
 *                     -> account sessions -> detach/delete the old workspace ->
 *                     remove old logs -> commit journal.
 *
 * Scenarios: live-session guard, target-exists guard, default-workspace guard,
 * crash after prepare (rollback), crash after files-ready (finalize), full
 * transaction, injected mid-write failure (rollback), idempotent recovery.
 *
 * Usage:
 *   node tools/p0b-workspace-rename-spike.mjs [--sandbox <dir>]
 *
 * Exit code 0 means every scenario and every invariant passed.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'

const ZSTD_MAGIC = 0xfd2fb528
const CHECKSUM = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }
const CHECKS = []
let SCENARIO = 'setup'

function check(name, ok, detail = '') {
  CHECKS.push({ scenario: SCENARIO, name, ok: ok === true, ...(detail ? { detail } : {}) })
  return ok === true
}

function fail(message) {
  const error = new Error(message)
  error.p0b = true
  throw error
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

function hashFile(file) {
  return sha256(fs.readFileSync(file))
}

function writeJsonAtomic(file, value) {
  const tmp = `${file}.tmp-${process.pid}`
  fs.writeFileSync(tmp, `${JSON.stringify(value, null, 2)}\n`)
  fs.renameSync(tmp, file)
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, 'utf8'))
}

function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid zstd magic at ${offset}`)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at ${offset - 1}`)
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryFlag = descriptor & 3
    const dictionaryBytes = dictionaryFlag === 3 ? 4 : dictionaryFlag
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      if (buffer.length - offset < 3) return { frames, tornStart: start }
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const lastBlock = (blockHeader & 1) !== 0
      const blockType = (blockHeader >>> 1) & 3
      const blockSize = blockHeader >>> 3
      if (blockType === 3) throw new Error(`reserved block type at ${offset - 3}`)
      offset += blockType === 1 ? 1 : blockSize
      if (offset > buffer.length) return { frames, tornStart: start }
      if (lastBlock) break
    }
    if (checksum) offset += 4
    if (offset > buffer.length) return { frames, tornStart: start }
    frames.push({ start, end: offset })
  }
  return { frames }
}

function readLogFile(file) {
  const buffer = fs.readFileSync(file)
  const { frames, tornStart } = scanZstdFrames(buffer)
  if (frames.length === 0) fail(`no complete frame in ${file}`)
  const texts = frames.map((frame) => zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
  const headerText = texts[0].toString('utf8')
  if (!headerText.endsWith('\n') || headerText.indexOf('\n') !== headerText.length - 1) {
    fail(`header frame is not exactly one JSONL line in ${file}`)
  }
  return {
    buffer,
    tornStart,
    header: JSON.parse(headerText.slice(0, -1)),
    events: Buffer.concat(texts.slice(1)).toString('utf8').split('\n').filter(Boolean).map((line) => JSON.parse(line)),
    eventFrameBytes: frames.slice(1).map((frame) => buffer.subarray(frame.start, frame.end)),
  }
}

function encodeSegment(raw) {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    out += ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch) ? ch : `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

function projectKey(cwd) {
  let readable = ''
  let separatorRun = false
  for (let i = 0; i < cwd.length; i += 1) {
    const code = cwd.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separatorRun) readable += '-'
      separatorRun = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      readable += ch
      separatorRun = false
    } else {
      readable += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
      separatorRun = false
    }
  }
  return `--${(readable.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

function expectedLogPath(dshHome, cwd, id) {
  return path.join(dshHome, 'sessions', projectKey(cwd), encodeSegment(id), 'session.v4.jsonl.zstd')
}

function projcachePath(dshHome, id) {
  return path.join(dshHome, 'storages', 'session_projcache', 'sessions', `${id}.json`)
}

function journalPath(fx) {
  return path.join(fx.dshHome, 'sidebar-manager', 'journal', 'pending.json')
}

function writeLogFixture(file, header, eventCount) {
  const frame = (text) => zlib.zstdCompressSync(Buffer.from(text, 'utf8'), CHECKSUM)
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const parts = [frame(`${JSON.stringify(header)}\n`)]
  for (let seq = 0; seq < eventCount; seq += 1) {
    parts.push(frame(`${JSON.stringify({ type: 'test/event', seq, marker: `${header.id}-${seq}` })}\n`))
  }
  fs.writeFileSync(file, Buffer.concat(parts))
}

function writeProjcacheFixture(file, cwd) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  writeJsonAtomic(file, {
    version: 7,
    record: {
      identity: { formatVersion: 4, createdAt: 1, cwd },
      rows: {
        title: { ver: 1, seq: 2, val: `title-${path.basename(path.dirname(file))}` },
        workingDirectory: { ver: 1, seq: 2, val: cwd },
      },
    },
  })
}

function buildFixture(root, { defaultIsOld = false } = {}) {
  fs.rmSync(root, { recursive: true, force: true })
  const dshHome = path.join(root, 'dsh')
  const oldPath = path.join(root, 'workspace-old')
  const newPath = path.join(root, 'workspace-renamed')
  const otherPath = path.join(root, 'workspace-other')
  fs.mkdirSync(oldPath, { recursive: true })
  fs.mkdirSync(otherPath, { recursive: true })
  fs.mkdirSync(path.join(dshHome, 'storages', 'session_projcache', 'sessions'), { recursive: true })
  fs.mkdirSync(path.join(dshHome, 'sidebar-manager', 'journal'), { recursive: true })

  const ordinary = ['session-p0b-a', 'session-p0b-b']
  const subagent = 'session-p0b-sub'
  const originals = new Map()
  for (const [id, origin] of [...ordinary.map((id) => [id, 'user']), [subagent, 'subagent']]) {
    const file = expectedLogPath(dshHome, oldPath, id)
    const header = {
      type: 'session',
      version: 4,
      id,
      createdAt: 1000 + ordinary.indexOf(id),
      cwd: oldPath,
      ...(origin === 'subagent' ? { origin: 'subagent', parentSession: ordinary[0] } : {}),
    }
    writeLogFixture(file, header, origin === 'subagent' ? 1 : 2)
    originals.set(id, fs.readFileSync(file))
    writeProjcacheFixture(projcachePath(dshHome, id), oldPath)
  }

  const now = new Date().toISOString()
  const workspace = {
    unit: { name: 'workspace', version: 2 },
    global: {
      initialized: true,
      defaultWorkspaceId: defaultIsOld ? 'ws-old' : 'ws-other',
      workspaceIds: ['ws-old', 'ws-other'],
      archivedSessionIds: [],
      pinnedSessionIds: [],
    },
    tables: {
      workspaces: {
        'ws-old': { path: oldPath, title: 'Old Project', sessionIds: [...ordinary], createdAt: now, updatedAt: now },
        'ws-other': { path: otherPath, title: 'Other Project', sessionIds: [], createdAt: now, updatedAt: now },
      },
    },
  }
  writeJsonAtomic(path.join(dshHome, 'storages', 'workspace.json'), workspace)

  return {
    root,
    dshHome,
    oldPath,
    newPath,
    otherPath,
    defaultIsOld,
    oldWorkspaceId: 'ws-old',
    ordinary,
    subagent,
    allSessions: [...ordinary, subagent],
    originals,
    workspaceFile: path.join(dshHome, 'storages', 'workspace.json'),
  }
}

function snapshotHashes(fx) {
  const snapshot = { workspace: hashFile(fx.workspaceFile), sessions: {}, projcache: {} }
  for (const id of fx.allSessions) {
    snapshot.sessions[id] = hashFile(expectedLogPath(fx.dshHome, fx.oldPath, id))
    snapshot.projcache[id] = hashFile(projcachePath(fx.dshHome, id))
  }
  return snapshot
}

function sameHashes(fx, original) {
  const current = snapshotHashes(fx)
  return JSON.stringify(current) === JSON.stringify(original)
}

function readJournal(fx) {
  return fs.existsSync(journalPath(fx)) ? readJson(journalPath(fx)) : undefined
}

function writeJournal(fx, journal) {
  writeJsonAtomic(journalPath(fx), journal)
}

function relocateSession(fx, id, txid) {
  const oldFile = expectedLogPath(fx.dshHome, fx.oldPath, id)
  const newFile = expectedLogPath(fx.dshHome, fx.newPath, id)
  if (fs.existsSync(newFile)) fail(`target already exists for ${id}`)
  const log = readLogFile(oldFile)
  const headerLine = `${JSON.stringify({ ...log.header, cwd: fx.newPath })}\n`
  const frame = zlib.zstdCompressSync(Buffer.from(headerLine, 'utf8'), CHECKSUM)
  const relocated = Buffer.concat([frame, ...log.eventFrameBytes])
  fs.mkdirSync(path.dirname(newFile), { recursive: true })
  const staging = `${newFile}.tmp-${txid}`
  fs.writeFileSync(staging, relocated)
  const staged = readLogFile(staging)
  if (staged.header.cwd !== fx.newPath || staged.header.id !== id) fail(`staged verify failed for ${id}`)
  if (!Buffer.concat(staged.eventFrameBytes).equals(Buffer.concat(log.eventFrameBytes))) fail(`staged event frames changed for ${id}`)
  fs.renameSync(staging, newFile)
  const committed = readLogFile(newFile)
  if (committed.header.cwd !== fx.newPath) fail(`committed verify failed for ${id}`)
  if (!Buffer.concat(committed.eventFrameBytes).equals(Buffer.concat(log.eventFrameBytes))) fail(`committed event frames changed for ${id}`)
  const cache = readJson(projcachePath(fx.dshHome, id))
  cache.record.identity.cwd = fx.newPath
  cache.record.rows.workingDirectory.val = fx.newPath
  writeJsonAtomic(projcachePath(fx.dshHome, id), cache)
}

function phaseA(fx, { liveIds = [], crashAt, failOn } = {}) {
  if (fx.defaultIsOld) throw Object.assign(new Error('default workspace cannot be folder-renamed'), { code: 'DEFAULT_WORKSPACE' })
  if (liveIds.length > 0) throw Object.assign(new Error(`live sessions: ${liveIds.join(',')}`), { code: 'SESSION_LIVE' })
  if (fs.existsSync(fx.newPath)) throw Object.assign(new Error('target path exists'), { code: 'TARGET_EXISTS' })
  if (!fs.existsSync(fx.oldPath)) throw Object.assign(new Error('source path missing'), { code: 'SOURCE_MISSING' })

  const txid = `p0b-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`
  const backupDir = path.join(fx.dshHome, 'backup', txid)
  fs.mkdirSync(path.join(backupDir, 'projcache'), { recursive: true })
  fs.copyFileSync(fx.workspaceFile, path.join(backupDir, 'workspace.json'))
  for (const id of fx.allSessions) {
    fs.mkdirSync(path.join(backupDir, 'sessions', encodeSegment(id)), { recursive: true })
    fs.copyFileSync(expectedLogPath(fx.dshHome, fx.oldPath, id), path.join(backupDir, 'sessions', encodeSegment(id), 'session.v4.jsonl.zstd'))
    fs.copyFileSync(projcachePath(fx.dshHome, id), path.join(backupDir, 'projcache', `${id}.json`))
  }
  const journal = {
    txid,
    state: 'prepared',
    oldPath: fx.oldPath,
    newPath: fx.newPath,
    oldWorkspaceId: fx.oldWorkspaceId,
    title: 'Renamed Project',
    accounted: [...fx.ordinary],
    allSessions: [...fx.allSessions],
    backupDir,
  }
  writeJournal(fx, journal)
  if (crashAt === 'prepared') return { phase: 'prepared', journal }

  fs.renameSync(fx.oldPath, fx.newPath)
  journal.state = 'dir-renamed'
  writeJournal(fx, journal)
  for (const id of journal.allSessions) {
    if (failOn === id) throw Object.assign(new Error(`injected failure before ${id}`), { code: 'INJECTED' })
    relocateSession(fx, id, txid)
  }
  journal.state = 'files-ready'
  writeJournal(fx, journal)
  return { phase: 'files-ready', journal }
}

function reindex(dshHome) {
  const map = new Map()
  const root = path.join(dshHome, 'sessions')
  if (!fs.existsSync(root)) return map
  for (const project of fs.readdirSync(root, { withFileTypes: true })) {
    if (!project.isDirectory()) continue
    for (const session of fs.readdirSync(path.join(root, project.name), { withFileTypes: true })) {
      if (!session.isDirectory()) continue
      const file = path.join(root, project.name, session.name, 'session.v4.jsonl.zstd')
      if (!fs.existsSync(file)) continue
      const header = readLogFile(file).header
      map.set(header.id, header.cwd)
    }
  }
  return map
}

function bootFinalize(fx) {
  const journal = readJournal(fx)
  if (journal === undefined) return { state: 'none' }
  if (journal.state === 'committed' || journal.state === 'rolledback') return { state: journal.state }

  if (journal.state === 'prepared') {
    fs.copyFileSync(path.join(journal.backupDir, 'workspace.json'), fx.workspaceFile)
    journal.state = 'rolledback'
    writeJournal(fx, journal)
    return { state: 'rolledback-prepared' }
  }

  const paths = reindex(fx.dshHome)
  for (const id of journal.allSessions) {
    if (paths.get(id) !== journal.newPath) fail(`reindex cwd mismatch for ${id}`)
  }

  const workspace = readJson(fx.workspaceFile)
  if (workspace.tables.workspaces[journal.oldWorkspaceId] === undefined) fail('old workspace record missing')
  const newId = `ws-new-${journal.txid}`
  const oldIndex = workspace.global.workspaceIds.indexOf(journal.oldWorkspaceId)
  if (oldIndex < 0) fail('old workspace absent from order')
  workspace.tables.workspaces[newId] = {
    path: journal.newPath,
    title: journal.title,
    sessionIds: [...journal.accounted],
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }
  delete workspace.tables.workspaces[journal.oldWorkspaceId]
  workspace.global.workspaceIds = workspace.global.workspaceIds.map((id) => (id === journal.oldWorkspaceId ? newId : id))
  writeJsonAtomic(fx.workspaceFile, workspace)

  fs.rmSync(path.join(fx.dshHome, 'sessions', projectKey(journal.oldPath)), { recursive: true, force: true })
  journal.state = 'committed'
  writeJournal(fx, journal)
  return { state: 'committed', workspace, newWorkspaceId: newId, paths }
}

function rollback(fx) {
  const journal = readJournal(fx)
  if (journal === undefined) return { state: 'none' }
  if (fs.existsSync(fx.newPath) && !fs.existsSync(fx.oldPath)) fs.renameSync(fx.newPath, fx.oldPath)
  fs.rmSync(path.join(fx.dshHome, 'sessions', projectKey(fx.newPath)), { recursive: true, force: true })
  fs.copyFileSync(path.join(journal.backupDir, 'workspace.json'), fx.workspaceFile)
  for (const id of fx.allSessions) {
    const target = expectedLogPath(fx.dshHome, fx.oldPath, id)
    fs.mkdirSync(path.dirname(target), { recursive: true })
    fs.copyFileSync(path.join(journal.backupDir, 'sessions', encodeSegment(id), 'session.v4.jsonl.zstd'), target)
    fs.copyFileSync(path.join(journal.backupDir, 'projcache', `${id}.json`), projcachePath(fx.dshHome, id))
  }
  journal.state = 'rolledback'
  writeJournal(fx, journal)
  return { state: 'rolledback' }
}

function expectCode(fn, code) {
  try {
    fn()
    return { ok: false, detail: 'no error thrown' }
  } catch (error) {
    if (error.code !== code) return { ok: false, detail: `${error.code ?? 'no-code'}: ${error.message}` }
    return { ok: true }
  }
}

function runScenario(name, fn) {
  SCENARIO = name
  const root = path.join(SANDBOX, name)
  try {
    fn(root)
  } catch (error) {
    check('scenario completed without unexpected error', false, error instanceof Error ? error.message : String(error))
  }
}

function verifyCommitted(fx, final, originalEventBytes) {
  check('finalizer committed', final.state === 'committed')
  check('old directory gone', !fs.existsSync(fx.oldPath))
  check('new directory exists', fs.existsSync(fx.newPath))
  const workspace = readJson(fx.workspaceFile)
  check('old workspace record removed', workspace.tables.workspaces[fx.oldWorkspaceId] === undefined)
  const newRecord = workspace.tables.workspaces[final.newWorkspaceId]
  check('new workspace path', newRecord?.path === fx.newPath)
  check('new workspace title', newRecord?.title === 'Renamed Project')
  check('new workspace sessions preserved', JSON.stringify(newRecord?.sessionIds) === JSON.stringify(fx.ordinary))
  check('workspace order preserved', workspace.global.workspaceIds[0] === final.newWorkspaceId && workspace.global.workspaceIds[1] === 'ws-other')
  check('default workspace untouched', workspace.global.defaultWorkspaceId === 'ws-other')
  check('subagent not accounted', !newRecord?.sessionIds.includes(fx.subagent))
  for (const id of fx.allSessions) {
    const newFile = expectedLogPath(fx.dshHome, fx.newPath, id)
    check(`new log exists ${id}`, fs.existsSync(newFile))
    const log = readLogFile(newFile)
    check(`header cwd ${id}`, log.header.cwd === fx.newPath)
    check(`original event bytes preserved ${id}`, sha256(Buffer.concat(log.eventFrameBytes)) === sha256(originalEventBytes.get(id)))
    const cache = readJson(projcachePath(fx.dshHome, id))
    check(`projcache cwd ${id}`, cache.record.identity.cwd === fx.newPath)
    check(`reindexed path ${id}`, final.paths.get(id) === fx.newPath)
  }
  check('old project session dir removed', !fs.existsSync(path.join(fx.dshHome, 'sessions', projectKey(fx.oldPath))))
  const again = bootFinalize(fx)
  check('finalizer idempotent', again.state === 'committed')
}

const SANDBOX = (() => {
  const index = process.argv.indexOf('--sandbox')
  if (index >= 0 && process.argv[index + 1]) return path.resolve(process.argv[index + 1])
  return path.join(os.tmpdir(), `dsh-p0b-${new Date().toISOString().replace(/[:.]/g, '-')}`)
})()

fs.rmSync(SANDBOX, { recursive: true, force: true })
fs.mkdirSync(SANDBOX, { recursive: true })

runScenario('guard_live_session', (root) => {
  const fx = buildFixture(root)
  const before = snapshotHashes(fx)
  const result = expectCode(() => phaseA(fx, { liveIds: [fx.ordinary[1]] }), 'SESSION_LIVE')
  check('live-session guard rejects', result.ok, result.detail ?? '')
  check('no file changed', sameHashes(fx, before))
  check('no journal created', readJournal(fx) === undefined)
  check('old directory untouched', fs.existsSync(fx.oldPath))
  check('new directory absent', !fs.existsSync(fx.newPath))
})

runScenario('guard_target_exists', (root) => {
  const fx = buildFixture(root)
  fs.mkdirSync(fx.newPath)
  const before = snapshotHashes(fx)
  const result = expectCode(() => phaseA(fx), 'TARGET_EXISTS')
  check('target-exists guard rejects', result.ok, result.detail ?? '')
  check('no file changed', sameHashes(fx, before))
  check('no journal created', readJournal(fx) === undefined)
})

runScenario('guard_default_workspace', (root) => {
  const fx = buildFixture(root, { defaultIsOld: true })
  const before = snapshotHashes(fx)
  const result = expectCode(() => phaseA(fx), 'DEFAULT_WORKSPACE')
  check('default-workspace guard rejects', result.ok, result.detail ?? '')
  check('no file changed', sameHashes(fx, before))
})

runScenario('crash_after_prepared_rolls_back', (root) => {
  const fx = buildFixture(root)
  const before = snapshotHashes(fx)
  phaseA(fx, { crashAt: 'prepared' })
  check('journal prepared', readJournal(fx)?.state === 'prepared')
  const final = bootFinalize(fx)
  check('prepared crash rolled back', final.state === 'rolledback-prepared')
  check('rollback token', readJournal(fx)?.state === 'rolledback')
  check('original hashes intact', sameHashes(fx, before))
  check('old directory intact', fs.existsSync(fx.oldPath))
  check('new directory absent', !fs.existsSync(fx.newPath))
})

runScenario('crash_after_files_ready_finalizes', (root) => {
  const fx = buildFixture(root)
  const originalEventBytes = new Map(fx.allSessions.map((id) => [id, Buffer.concat(readLogFile(expectedLogPath(fx.dshHome, fx.oldPath, id)).eventFrameBytes)]))
  const tx = phaseA(fx, { crashAt: 'files-ready' })
  check('journal files-ready', readJournal(fx)?.state === 'files-ready')
  check('directory already renamed', !fs.existsSync(fx.oldPath) && fs.existsSync(fx.newPath))
  const result = bootFinalize(fx)
  verifyCommitted(fx, result, originalEventBytes)
})

runScenario('full_rename_then_restart', (root) => {
  const fx = buildFixture(root)
  const originalEventBytes = new Map(fx.allSessions.map((id) => [id, Buffer.concat(readLogFile(expectedLogPath(fx.dshHome, fx.oldPath, id)).eventFrameBytes)]))
  phaseA(fx)
  check('journal files-ready after Phase A', readJournal(fx)?.state === 'files-ready')
  const result = bootFinalize(fx)
  verifyCommitted(fx, result, originalEventBytes)
})

runScenario('injected_failure_rolls_back', (root) => {
  const fx = buildFixture(root)
  const before = snapshotHashes(fx)
  const result = expectCode(() => phaseA(fx, { failOn: fx.ordinary[1] }), 'INJECTED')
  check('injected failure surfaced', result.ok, result.detail ?? '')
  rollback(fx)
  check('rollback token', readJournal(fx)?.state === 'rolledback')
  check('original hashes restored', sameHashes(fx, before))
  check('old directory restored', fs.existsSync(fx.oldPath))
  check('new directory absent', !fs.existsSync(fx.newPath))
  check('no new project logs left', !fs.existsSync(path.join(fx.dshHome, 'sessions', projectKey(fx.newPath))))
})

const failed = CHECKS.filter((entry) => !entry.ok)
console.log(JSON.stringify({
  ok: failed.length === 0,
  sandbox: SANDBOX,
  checkCount: CHECKS.length,
  failed: failed.length,
  checks: CHECKS,
}, null, 2))
if (failed.length > 0) process.exitCode = 1
