/**
 * The DSH side of the bridge: hook payload shaping, export serialization, and the bounded
 * JSON call. These are the seams a unit test can prove without a running harness.
 */
import assert from 'node:assert/strict'
import { EventEmitter } from 'node:events'
import { test } from 'node:test'

import {
  contentText,
  exitCodeOf,
  isInert,
  runJson,
  serializeExport,
  stateRoot,
  toolResponse,
} from '../lib/bridge.js'

/**
 * A `spawn` stand-in that answers one fixed stdout line.
 * @param {string} line - what the child prints.
 * @param {{ exit?: number }} [options] - process outcome.
 * @returns {Function} a `spawn` replacement.
 */
function fakeSpawn(line, options = {}) {
  return () => {
    const child = new EventEmitter()
    child.stdout = new EventEmitter()
    child.stdin = { on() {}, end() {} }
    child.kill = () => {}
    queueMicrotask(() => {
      if (line) child.stdout.emit('data', `${line}\n`)
      child.emit('close', options.exit ?? 0)
    })
    return child
  }
}

test('state root follows the engine default', () => {
  assert.equal(stateRoot({ TOKENECONOMIZER_HOME: '/tmp/te' }), '/tmp/te')
  assert.match(stateRoot({}), /\.tokeneconomizer$/)
})

test('a tool result renders its text and the exit status bash appends', () => {
  const text = contentText([
    { type: 'text', text: '1 failed in 0.1s' },
    { type: 'image', attachment: {} },
  ])
  assert.equal(text, '1 failed in 0.1s')
  assert.equal(exitCodeOf(`${text}\n[exit code: 1]`), 1)
  assert.deepEqual(toolResponse({ content: [{ type: 'text', text: 'ok\n[exit code: 0]' }] }), {
    content: 'ok\n[exit code: 0]',
    isError: false,
    exit_code: 0,
  })
  assert.equal(exitCodeOf('no status here'), undefined)
})

test('export serialization keeps the harness header and every event verbatim', () => {
  const events = [
    { type: 'turn/start', seq: 0, time: 1, data: { turn: 1 } },
    { type: 'tool/call', seq: 1, time: 2, data: { name: 'bash', arguments: '{}' } },
  ]
  const text = serializeExport({
    header: { id: 'session-x', version: 4, createdAt: 1792, cwd: '/repo' },
    events,
  })
  const lines = text.trim().split('\n').map((line) => JSON.parse(line))
  assert.equal(lines[0].type, 'session')
  assert.equal(lines[0].id, 'session-x')
  assert.equal(lines[0].cwd, '/repo')
  assert.deepEqual(lines.slice(1), events)
  assert.ok(text.endsWith('\n'))
})

test('a side call makes this plugin inert', () => {
  assert.equal(isInert({ TE_SIDECALL: '1' }), true)
  assert.equal(isInert({ TE_DISABLE: 'true' }), true)
  assert.equal(isInert({}), false)
})

test('runJson answers the last JSON line and null on garbage', async () => {
  const good = await runJson('te', [], {}, {
    spawnImpl: fakeSpawn('noise\n{"ok":true}'),
    timeoutMs: 1000,
  })
  assert.deepEqual(good, { ok: true })
  const bad = await runJson('te', [], {}, { spawnImpl: fakeSpawn('not json'), timeoutMs: 1000 })
  assert.equal(bad, null)
})

test('runJson answers null when the launcher cannot start', async () => {
  const missing = await runJson('te', [], {}, {
    spawnImpl: () => {
      throw new Error('ENOENT')
    },
    timeoutMs: 1000,
  })
  assert.equal(missing, null)
})
