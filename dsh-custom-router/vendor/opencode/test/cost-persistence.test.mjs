/**
 * The session total must survive a restart.
 *
 * Measured 2026-11-04: the pill reset to zero on every restart because the
 * ledger lived only in a Map. An operator cannot price a day of work if the
 * meter starts over whenever the service does.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { createCostLedger, createCostStore, parseCost } from '../lib/cost.js'

const GO = parseCost({
  prompt_tokens: 32,
  completion_tokens: 8,
  cost: 0,
  opencode: {
    billing_source: 'go-plus',
    list_cost: 0.0000096,
    allowance: 0.00001152,
    tokens: { input: 32, output: 8, reasoning: 0, cache_read: 0, cache_write_5m: 0, cache_write_1h: 0 },
  },
})

test('a second process reads back what the first one spent', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocv2-cost-'))
  try {
    // Process 1: records two requests, then shuts down.
    const store1 = createCostStore({ explicit: join(dir, 'cost.json') })
    const ledger1 = createCostLedger({ store: store1 })
    ledger1.record('session-a', 'opencode-go/deepseek-v4.1-flash', GO)
    ledger1.record('session-a', 'opencode-go/deepseek-v4.1-flash', GO)
    assert.equal(ledger1.flush(), true, 'the final write must land before shutdown')

    // Process 2: a brand-new ledger over the same file.
    const store2 = createCostStore({ explicit: join(dir, 'cost.json') })
    const ledger2 = createCostLedger({ store: store2 })
    const session = ledger2.session('session-a')
    assert.ok(session, 'the session survives the restart')
    assert.equal(session.requests, 2)
    assert.equal(session.allowanceUsd, 0.00001152 * 2, 'the plan burn keeps accumulating')
    assert.equal(session.byModel['opencode-go/deepseek-v4.1-flash'].requests, 2)

    // And new work keeps adding to the same total rather than starting over.
    ledger2.record('session-a', 'opencode-go/deepseek-v4.1-flash', GO)
    assert.equal(ledger2.session('session-a').requests, 3)
    ledger2.flush()

    const ledger3 = createCostLedger({ store: createCostStore({ explicit: join(dir, 'cost.json') }) })
    assert.equal(ledger3.session('session-a').requests, 3)
    assert.equal(ledger3.summary().requests, 3)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('no store means in-memory only, and nothing is written', () => {
  const ledger = createCostLedger()
  ledger.record('s', 'opencode-go/x', GO)
  assert.equal(ledger.session('s').requests, 1)
  assert.equal(ledger.flush(), false, 'there is nowhere to write')
})

test('a corrupt file is "nothing measured", not a crash', () => {
  const dir = mkdtempSync(join(tmpdir(), 'ocv2-cost-bad-'))
  try {
    const path = join(dir, 'cost.json')
    writeFileSync(path, '{not json')
    const ledger = createCostLedger({ store: createCostStore({ explicit: path }) })
    assert.equal(ledger.summary().sessions, 0)
    ledger.record('s', 'opencode-go/x', GO)
    assert.equal(ledger.session('s').requests, 1)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})
