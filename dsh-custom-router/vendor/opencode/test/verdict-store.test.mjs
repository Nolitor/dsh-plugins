/**
 * Persisted verdict snapshot: the settings tab must show the last sweep without
 * re-running it, so the store has to survive a restart, ignore a corrupt file,
 * and stay in memory (no write) when no safe path exists.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createVerdictStore, resolveVerdictPath, verdictsFromResults } from '../lib/verdict-store.js'

const tempDir = () => mkdtempSync(join(tmpdir(), 'ocv2-verdicts-'))

test('a written snapshot reads back verbatim', () => {
  const dir = tempDir()
  try {
    const store = createVerdictStore({ explicit: join(dir, 'verdicts.json') })
    assert.equal(store.write({ verdicts: { 'opencode/beam-free': 'usable' }, measuredAt: '2026-10-31T00:00:00.000Z' }), true)
    assert.deepEqual(store.read(), {
      verdicts: { 'opencode/beam-free': 'usable' },
      measuredAt: '2026-10-31T00:00:00.000Z',
    })
    // The file is plain JSON a human can read and delete.
    const raw = JSON.parse(readFileSync(join(dir, 'verdicts.json'), 'utf8'))
    assert.equal(raw.verdicts['opencode/beam-free'], 'usable')
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('a missing or corrupt snapshot is "not measured yet", never an error', () => {
  const dir = tempDir()
  try {
    const path = join(dir, 'verdicts.json')
    const store = createVerdictStore({ explicit: path })
    assert.deepEqual(store.read(), { verdicts: {}, measuredAt: null })

    writeFileSync(path, '{ this is not json')
    assert.deepEqual(store.read(), { verdicts: {}, measuredAt: null })

    writeFileSync(path, JSON.stringify({ verdicts: { a: 1, '': 'usable', b: 'usable' }, measuredAt: 7 }))
    assert.deepEqual(store.read(), { verdicts: { b: 'usable' }, measuredAt: null })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('without a profile or DSH_HOME nothing is written', () => {
  const store = createVerdictStore({})
  assert.equal(store.path, '')
  assert.equal(store.write({ verdicts: { a: 'usable' }, measuredAt: null }), false)
  assert.deepEqual(store.read(), { verdicts: {}, measuredAt: null })
})

test('the path follows the catalog rule: explicit, then profile, then DSH_HOME', () => {
  assert.equal(resolveVerdictPath({ explicit: '/x/v.json', profileDir: '/p', dshHome: '/h' }), '/x/v.json')
  assert.equal(resolveVerdictPath({ profileDir: '/p', dshHome: '/h' }), '/p/opencode-model-verdicts.json')
  assert.equal(resolveVerdictPath({ dshHome: '/h' }), '/h/cache/opencode-model-verdicts.json')
  assert.equal(resolveVerdictPath({}), '')
})

test('sweep results collapse into the route -> state map, keeping only valid rows', () => {
  const verdicts = verdictsFromResults([
    { route: 'opencode-go/a', state: 'usable' },
    { route: 'opencode/b', state: 'unavailable' },
    { route: '', state: 'usable' },
    { route: 'opencode/c' },
    { state: 'usable' },
    { route: 'opencode/d', state: '' },
  ])
  assert.deepEqual(verdicts, {
    'opencode-go/a': 'usable',
    'opencode/b': 'unavailable',
    'opencode/c': 'error',
    'opencode/d': 'error',
  })
})
