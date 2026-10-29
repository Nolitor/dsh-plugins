/**
 * Unit tests for the durable DSH-session → OpenCode-session map.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { SESSION_MAP_VERSION, SessionMap } from '../lib/session-map.js'

test('a mapping survives a new instance', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-session-map-'))
  const path = join(dir, 'opencode-sessions.json')
  try {
    const first = new SessionMap(path)
    first.set('dsh-1', { sessionID: 'ses_1', modelKey: 'opencode/beam-free', directory: '/tmp' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    const second = new SessionMap(path)
    assert.deepEqual(second.get('dsh-1'), {
      sessionID: 'ses_1',
      modelKey: 'opencode/beam-free',
      directory: '/tmp',
    })
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('a missing or foreign file is the empty cold start', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-session-map-'))
  try {
    assert.equal(new SessionMap(join(dir, 'missing.json')).size, 0)
    const foreign = join(dir, 'foreign.json')
    await writeFile(foreign, JSON.stringify({ version: 99, sessions: { a: { sessionID: 'x' } } }))
    assert.equal(new SessionMap(foreign).size, 0)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('delete removes the mapping from disk', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-session-map-'))
  const path = join(dir, 'opencode-sessions.json')
  try {
    const map = new SessionMap(path)
    map.set('dsh-1', { sessionID: 'ses_1' })
    await new Promise((resolve) => setTimeout(resolve, 20))
    map.delete('dsh-1')
    await new Promise((resolve) => setTimeout(resolve, 20))
    const parsed = JSON.parse(await readFile(path, 'utf8'))
    assert.equal(parsed.version, SESSION_MAP_VERSION)
    assert.deepEqual(parsed.sessions, {})
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
