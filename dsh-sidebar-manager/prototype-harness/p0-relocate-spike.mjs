#!/usr/bin/env node
/**
 * P0 spike — session relocation file layer (sandbox only).
 *
 * Proves the riskiest part of Move/Fork before any Host service work:
 *   source log (zstd frames, header line first)
 *   -> rewrite ONLY the first-frame header cwd
 *   -> keep every event frame byte-for-byte
 *   -> stage, fsync, verify, rename
 *   -> patch a copied session_projcache record
 *   -> prove the source file was not modified.
 *
 * This script NEVER writes under ~/.dsh. It reads a source log (or projcache)
 * and writes only inside --sandbox.
 *
 * Usage:
 *   node tools/p0-relocate-spike.mjs --self-test
 *   node tools/p0-relocate-spike.mjs --source-log <file> --target-cwd <abs path> --sandbox <dir> [--projcache <file>] [--apply]
 *
 * Exit code 0 means every asserted invariant passed.
 */
import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import zlib from 'node:zlib'

const ZSTD_MAGIC = 0xfd2fb528
const CHECKSUM = { params: { [zlib.constants.ZSTD_c_checksumFlag]: 1 } }

function fail(message) {
  const error = new Error(message)
  error.p0 = true
  throw error
}

function sha256(buffer) {
  return crypto.createHash('sha256').update(buffer).digest('hex')
}

/** Copy of the persistence frame scanner (tools/session-migrate/lib.mjs). */
function scanZstdFrames(buffer) {
  const frames = []
  let offset = 0
  while (offset < buffer.length) {
    const start = offset
    if (buffer.length - offset < 4) return { frames, tornStart: start }
    if (buffer.readUInt32LE(offset) !== ZSTD_MAGIC) throw new Error(`invalid zstd magic at byte ${offset}`)
    offset += 4
    if (offset === buffer.length) return { frames, tornStart: start }
    const descriptor = buffer.readUInt8(offset)
    offset += 1
    if ((descriptor & 24) !== 0) throw new Error(`reserved frame-header bit at byte ${offset - 1}`)
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
      if (blockType === 3) throw new Error(`reserved block type at byte ${offset - 3}`)
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

function readLogBuffer(buffer, label) {
  const { frames, tornStart } = scanZstdFrames(buffer)
  if (frames.length === 0) fail(`${label}: no complete zstd frame`)
  const frameTexts = frames.map((frame) => zlib.zstdDecompressSync(buffer.subarray(frame.start, frame.end)))
  const headerText = frameTexts[0].toString('utf8')
  if (!headerText.endsWith('\n') || headerText.indexOf('\n') !== headerText.length - 1) {
    fail(`${label}: header frame is not exactly one JSONL line`)
  }
  const header = JSON.parse(headerText.slice(0, -1))
  const eventText = Buffer.concat(frameTexts.slice(1)).toString('utf8')
  const events = eventText
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => JSON.parse(line))
  return {
    bytes: buffer.length,
    frames,
    tornStart,
    header,
    headerText,
    events,
    eventFrameBytes: frames.slice(1).map((frame) => buffer.subarray(frame.start, frame.end)),
  }
}

/** Path segment encoding used by @deepseek-ai/dsh-session-persistence-jsonl. */
export function encodeSegment(raw) {
  if (raw.length === 0) throw new Error('cannot encode an empty path segment')
  if (raw === '.') return '~002E'
  if (raw === '..') return '~002E~002E'
  let out = ''
  for (let i = 0; i < raw.length; i += 1) {
    const code = raw.charCodeAt(i)
    const ch = String.fromCharCode(code)
    if (ch !== '~' && /^[A-Za-z0-9._-]$/.test(ch)) out += ch
    else out += `~${code.toString(16).toUpperCase().padStart(4, '0')}`
  }
  return out
}

/** cwd -> sessions project directory key; same rule as session-migrate/lib.mjs. */
export function projectKey(cwd) {
  if (cwd.length === 0) throw new Error('cannot encode an empty project path')
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

export function expectedLogPath(dshHome, cwd, id, version = 4) {
  return path.join(dshHome, 'sessions', projectKey(cwd), encodeSegment(id), `session.v${version}.jsonl.zstd`)
}

function buildRelocated(log, targetCwd) {
  const headerLine = `${JSON.stringify({ ...log.header, cwd: targetCwd })}\n`
  const headerFrame = zlib.zstdCompressSync(Buffer.from(headerLine, 'utf8'), CHECKSUM)
  return { buffer: Buffer.concat([headerFrame, ...log.eventFrameBytes]), headerLine }
}

function verifyRelocated(sourceLog, targetBuffer, targetCwd, id) {
  const target = readLogBuffer(targetBuffer, 'target')
  if (target.header.id !== id) fail('target: session id changed')
  if (target.header.version !== 4) fail('target: session version changed')
  if (target.header.cwd !== targetCwd) fail('target: header cwd not rewritten')
  if (target.events.length !== sourceLog.events.length) fail('target: event count changed')
  const targetEventBytes = Buffer.concat(target.eventFrameBytes)
  const sourceEventBytes = Buffer.concat(sourceLog.eventFrameBytes)
  if (!targetEventBytes.equals(sourceEventBytes)) fail('target: event frame bytes differ')
  for (let i = 0; i < sourceLog.events.length; i += 1) {
    if (target.events[i].seq !== sourceLog.events[i].seq) fail(`target: seq changed at event ${i}`)
    if (JSON.stringify(target.events[i]) !== JSON.stringify(sourceLog.events[i])) {
      fail(`target: event payload changed at ${i}`)
    }
  }
  return {
    headerFrameSingleLine: true,
    cwd: target.header.cwd,
    events: target.events.length,
    eventFramesIdentical: true,
  }
}

function patchProjcache(projcachePath, id, targetCwd, sandbox) {
  if (projcachePath === undefined) return undefined
  const source = fs.readFileSync(projcachePath, 'utf8')
  const document = JSON.parse(source)
  const record = document.record
  if (!record || !record.identity) fail('projcache: record.identity missing')
  if (record.identity.id !== undefined && record.identity.id !== id) fail('projcache: id mismatch')
  record.identity.cwd = targetCwd
  if (record.rows?.workingDirectory) record.rows.workingDirectory.val = targetCwd
  const dir = path.join(sandbox, 'storages', 'session_projcache', 'sessions')
  fs.mkdirSync(dir, { recursive: true })
  const output = path.join(dir, `${id}.json`)
  fs.writeFileSync(output, `${JSON.stringify(document, null, 2)}\n`)
  const reparsed = JSON.parse(fs.readFileSync(output, 'utf8'))
  if (reparsed.record.identity.cwd !== targetCwd) fail('projcache: cwd patch did not persist')
  return { output, cwd: reparsed.record.identity.cwd }
}

function relocate({ sourceLogPath, targetCwd, sandbox, projcachePath, apply }) {
  const sourceBefore = fs.readFileSync(sourceLogPath)
  const sourceShaBefore = sha256(sourceBefore)
  const log = readLogBuffer(sourceBefore, sourceLogPath)
  if (log.tornStart !== undefined) fail('source: torn tail; refusing to rewrite')
  if (log.header.version !== 4) fail(`source: unsupported session version ${String(log.header.version)}`)
  if (typeof log.header.id !== 'string' || log.header.id.length === 0) fail('source: header has no id')
  if (log.header.cwd === targetCwd) fail('target cwd equals source cwd; nothing to relocate')

  const id = log.header.id
  const targetDir = path.join(sandbox, 'sessions', projectKey(targetCwd), encodeSegment(id))
  const targetFile = path.join(targetDir, 'session.v4.jsonl.zstd')
  if (fs.existsSync(targetFile)) fail(`target already exists: ${targetFile}`)

  const relocated = buildRelocated(log, targetCwd)
  const plan = {
    ok: true,
    dryRun: apply !== true,
    id,
    oldCwd: log.header.cwd,
    newCwd: targetCwd,
    sourceLogPath,
    sourceBytes: sourceBefore.length,
    sourceSha256: sourceShaBefore,
    events: log.events.length,
    frames: log.frames.length,
    targetFile,
    expectedPathRule: targetFile === expectedLogPath(sandbox, targetCwd, id),
    projcache: projcachePath ?? null,
  }
  if (apply !== true) return plan

  const tx = `p0-${Date.now()}`
  const backupDir = path.join(sandbox, 'backup', tx)
  fs.mkdirSync(backupDir, { recursive: true })
  const backupFile = path.join(backupDir, 'session.v4.jsonl.zstd')
  fs.copyFileSync(sourceLogPath, backupFile)
  const backupSha = sha256(fs.readFileSync(backupFile))
  if (backupSha !== sourceShaBefore) fail('backup: hash differs from source')

  fs.mkdirSync(targetDir, { recursive: true })
  const staging = `${targetFile}.tmp-${tx}`
  const fd = fs.openSync(staging, 'wx')
  try {
    fs.writeSync(fd, relocated.buffer)
    fs.fsyncSync(fd)
  } finally {
    fs.closeSync(fd)
  }

  // Phase 1: validate the staged artifact before it becomes authoritative.
  const stagedCheck = verifyRelocated(log, fs.readFileSync(staging), targetCwd, id)

  // Phase 2: atomic rename, then validate the committed artifact again.
  fs.renameSync(staging, targetFile)
  const committedCheck = verifyRelocated(log, fs.readFileSync(targetFile), targetCwd, id)
  const plated = patchProjcache(projcachePath, id, targetCwd, sandbox)

  const sourceAfter = fs.readFileSync(sourceLogPath)
  const sourceShaAfter = sha256(sourceAfter)
  if (sourceShaAfter !== sourceShaBefore) fail('source: file changed during the spike')

  return {
    ...plan,
    dryRun: false,
    tx,
    backupFile,
    backupSha256: backupSha,
    stagedCheck,
    committedCheck,
    projcache: plated ?? null,
    sourceSha256After: sourceShaAfter,
    sourceUnchanged: sourceShaAfter === sourceShaBefore,
    targetSha256: sha256(fs.readFileSync(targetFile)),
  }
}

function selfTest() {
  const header = { type: 'session', version: 4, id: 'session-p0-0001', createdAt: 1, cwd: 'C:/old/workspace' }
  const frame = (text) => zlib.zstdCompressSync(Buffer.from(text, 'utf8'), CHECKSUM)
  const event = (seq) => `{"type":"test/event","seq":${seq}}\n`
  const valid = Buffer.concat([
    frame(`${JSON.stringify(header)}\n`),
    frame(`${event(0)}${event(1)}`),
    frame(event(2)),
  ])
  const log = readLogBuffer(valid, 'self')
  const out = buildRelocated(log, 'C:/new/workspace').buffer
  const checks = []
  checks.push(['valid relocation verifies', verifyRelocated(log, out, 'C:/new/workspace', header.id).eventFramesIdentical])

  try {
    verifyRelocated(log, out, 'C:/wrong', header.id)
    checks.push(['cwd mismatch detected', false])
  } catch {
    checks.push(['cwd mismatch detected', true])
  }

  const tampered = Buffer.concat([out.subarray(0, out.length - 9), Buffer.from('xxxxxxxxx')])
  try {
    verifyRelocated(log, tampered, 'C:/new/workspace', header.id)
    checks.push(['event tamper detected', false])
  } catch {
    checks.push(['event tamper detected', true])
  }

  try {
    readLogBuffer(Buffer.concat([frame(`${JSON.stringify(header)}\n\n`), ...log.eventFrameBytes]), 'multi')
    checks.push(['multi-line header rejected', false])
  } catch {
    checks.push(['multi-line header rejected', true])
  }

  try {
    const torn = readLogBuffer(Buffer.concat([valid, Buffer.from([1, 2, 3])]), 'torn')
    checks.push(['torn tail rejected', torn.tornStart !== undefined])
  } catch {
    checks.push(['torn tail rejected', false])
  }

  try {
    readLogBuffer(Buffer.concat([Buffer.from([0, 0, 0, 0]), valid]), 'magic')
    checks.push(['invalid magic rejected', false])
  } catch {
    checks.push(['invalid magic rejected', true])
  }

  const failed = checks.filter(([, ok]) => ok !== true)
  console.log(JSON.stringify({ ok: failed.length === 0, checks: checks.map(([name, ok]) => ({ name, ok })) }, null, 2))
  if (failed.length > 0) process.exitCode = 1
}

function main() {
  const argv = process.argv.slice(2)
  const value = (flag) => {
    const index = argv.indexOf(flag)
    return index < 0 ? undefined : argv[index + 1]
  }
  if (argv.includes('--self-test')) {
    selfTest()
    return
  }
  const sourceLogPath = value('--source-log')
  const targetCwd = value('--target-cwd')
  const sandbox = value('--sandbox')
  if (!sourceLogPath || !targetCwd || !sandbox) {
    fail('usage: --source-log <file> --target-cwd <absolute path> --sandbox <dir> [--projcache <file>] [--apply]')
  }
  const result = relocate({
    sourceLogPath,
    targetCwd,
    sandbox,
    projcachePath: value('--projcache'),
    apply: argv.includes('--apply'),
  })
  console.log(JSON.stringify(result, null, 2))
}

try {
  main()
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }, null, 2))
  process.exitCode = 1
}
