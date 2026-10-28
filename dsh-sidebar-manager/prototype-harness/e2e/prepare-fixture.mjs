#!/usr/bin/env node
/**
 * Prepare an isolated DSH home for the Sidebar Manager E2E run.
 *
 * Creates disposable workspaces and cold sessions under a temporary root, then
 * copies the active web profile into a separate DSH_HOME. It never writes the
 * real DSH home.
 *
 * Usage:
 *   node tools/e2e/prepare-fixture.mjs --home <dir> --root <dir> [--source <session log>]
 */
import fs from 'node:fs'
import path from 'node:path'
import crypto from 'node:crypto'
import zlib from 'node:zlib'

const ZSTD_MAGIC = 0xfd2fb528
const CHECKSUM = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }

const args = process.argv.slice(2)
const value = (flag) => {
  const index = args.indexOf(flag)
  return index < 0 ? undefined : args[index + 1]
}
const home = path.resolve(value('--home') ?? path.join(process.env.TEMP ?? '.', 'dsh-e2e-home'))
const root = path.resolve(value('--root') ?? path.join(process.env.TEMP ?? '.', 'dsh-e2e-root'))
const realDsh = path.join(process.env.USERPROFILE ?? '', '.dsh')
const sourceLog =
  value('--source') ??
  path.join(
    realDsh,
    'sessions',
    '--C-Users-nolit-Workspace-projects-dsh-workspace--',
    'session-b852d5fc-7d22-4089-960c-56fbdb6b3de2',
    'session.v4.jsonl.zstd',
  )

function scanFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) throw new Error('torn source log')
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`bad zstd magic at ${offset}`)
    offset += 4
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    const contentSizeFlag = descriptor >>> 6
    const singleSegment = (descriptor & 32) !== 0
    const checksum = (descriptor & 4) !== 0
    const dictionaryBytes = (descriptor & 3) === 3 ? 4 : descriptor & 3
    const contentSizeBytes = contentSizeFlag === 0 ? (singleSegment ? 1 : 0) : 1 << contentSizeFlag
    offset += (singleSegment ? 0 : 1) + dictionaryBytes + contentSizeBytes
    for (;;) {
      const blockHeader = buffer.readUIntLE(offset, 3)
      offset += 3
      const last = (blockHeader & 1) !== 0
      const type = (blockHeader >>> 1) & 3
      const size = blockHeader >>> 3
      offset += type === 1 ? 1 : size
      if (last) break
    }
    if (checksum) offset += 4
    frames.push({ start, end: offset })
  }
  return frames
}

function readSource(file) {
  const buffer = fs.readFileSync(file)
  const frames = scanFrames(buffer)
  const first = zlib.zstdDecompressSync(buffer.subarray(frames[0].start, frames[0].end)).toString('utf8')
  if (!first.endsWith('\n')) throw new Error('source header frame is malformed')
  return {
    header: JSON.parse(first.slice(0, -1)),
    eventFrames: frames.slice(1).map((frame) => buffer.subarray(frame.start, frame.end)),
  }
}

function encodeSegment(raw) {
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const ch = String.fromCharCode(raw.charCodeAt(i))
    out += ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch) ? ch : `~${raw.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

function projectKey(cwd) {
  let out = ''
  let separator = false
  for (let i = 0; i < cwd.length; i += 1) {
    const ch = String.fromCharCode(cwd.charCodeAt(i))
    if (ch === '/' || ch === '\\' || ch === ':') {
      if (!separator) out += '-'
      separator = true
    } else if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) {
      out += ch
      separator = false
    } else {
      out += `~${cwd.charCodeAt(i).toString(16).toUpperCase().padStart(4, '0')}`
      separator = false
    }
  }
  return `--${(out.replace(/^-+/, '') || 'root').slice(0, 251)}--`
}

function makeId() {
  return `session-${crypto.randomUUID()}`
}

function writeSession(home, workspacePath, id, source, createdAt) {
  const dir = path.join(home, 'sessions', projectKey(workspacePath), encodeSegment(id))
  fs.mkdirSync(dir, { recursive: true })
  const header = { ...source.header, id, cwd: workspacePath, createdAt }
  const headerFrame = zlib.zstdCompressSync(Buffer.from(`${JSON.stringify(header)}\n`, 'utf8'), CHECKSUM)
  fs.writeFileSync(path.join(dir, 'session.v4.jsonl.zstd'), Buffer.concat([headerFrame, ...source.eventFrames]))
  const cacheDir = path.join(home, 'storages', 'session_projcache', 'sessions')
  fs.mkdirSync(cacheDir, { recursive: true })
  const sourceCache = path.join(
    path.dirname(sourceLog),
    '..',
    '..',
    '..',
    'storages',
    'session_projcache',
    'sessions',
    `${source.header.id}.json`,
  )
  if (fs.existsSync(sourceCache)) {
    const cache = JSON.parse(fs.readFileSync(sourceCache, 'utf8'))
    if (cache.record?.identity) cache.record.identity.cwd = workspacePath
    if (cache.record?.rows?.workingDirectory) cache.record.rows.workingDirectory.val = workspacePath
    fs.writeFileSync(path.join(cacheDir, `${id}.json`), JSON.stringify(cache, null, 2))
  }
}

fs.rmSync(root, { recursive: true, force: true })
fs.rmSync(home, { recursive: true, force: true })
fs.mkdirSync(root, { recursive: true })
fs.mkdirSync(home, { recursive: true })

const workspacePaths = {
  alpha: path.join(root, 'ws-alpha'),
  beta: path.join(root, 'ws-beta'),
  gamma: path.join(root, 'ws-gamma'),
  delta: path.join(root, 'ws-delta'),
}
for (const directory of Object.values(workspacePaths)) fs.mkdirSync(directory, { recursive: true })

const profileSource = path.join(realDsh, 'profiles', 'web')
const profileTarget = path.join(home, 'profiles', 'web')
fs.mkdirSync(profileTarget, { recursive: true })
for (const entry of fs.readdirSync(profileSource, { withFileTypes: true })) {
  if (!entry.isFile()) continue
  if (entry.name.includes('.bak')) continue
  fs.copyFileSync(path.join(profileSource, entry.name), path.join(profileTarget, entry.name))
}
for (const file of ['.credentials.yaml', '.anonymous-user-id']) {
  const source = path.join(realDsh, file)
  if (fs.existsSync(source)) fs.copyFileSync(source, path.join(home, file))
}

const source = readSource(sourceLog)
const now = Date.now()
const ids = {
  alpha1: makeId('alpha1'),
  alpha2: makeId('alpha2'),
  beta1: makeId('beta1'),
}
writeSession(home, workspacePaths.alpha, ids.alpha1, source, now - 3000)
writeSession(home, workspacePaths.alpha, ids.alpha2, source, now - 2000)
writeSession(home, workspacePaths.beta, ids.beta1, source, now - 1000)

const iso = new Date().toISOString()
const workspace = {
  unit: { name: 'workspace', version: 2 },
  global: {
    initialized: true,
    defaultWorkspaceId: 'ws-alpha',
    workspaceIds: ['ws-alpha', 'ws-beta', 'ws-gamma', 'ws-delta'],
    archivedSessionIds: [],
    pinnedSessionIds: [],
  },
  tables: {
    workspaces: {
      'ws-alpha': {
        path: workspacePaths.alpha,
        title: 'E2E Alpha',
        sessionIds: [ids.alpha1, ids.alpha2],
        createdAt: iso,
        updatedAt: iso,
      },
      'ws-beta': {
        path: workspacePaths.beta,
        title: 'E2E Beta',
        sessionIds: [ids.beta1],
        createdAt: iso,
        updatedAt: iso,
      },
      'ws-gamma': {
        path: workspacePaths.gamma,
        title: 'E2E Gamma',
        sessionIds: [],
        createdAt: iso,
        updatedAt: iso,
      },
      'ws-delta': {
        path: workspacePaths.delta,
        title: 'E2E Delta',
        sessionIds: [],
        createdAt: iso,
        updatedAt: iso,
      },
    },
  },
}
fs.mkdirSync(path.join(home, 'storages'), { recursive: true })
fs.writeFileSync(path.join(home, 'storages', 'workspace.json'), `${JSON.stringify(workspace, null, 2)}\n`)
fs.mkdirSync(path.join(home, 'sidebar-manager'), { recursive: true })

console.log(JSON.stringify({ home, root, workspacePaths, ids }, null, 2))
