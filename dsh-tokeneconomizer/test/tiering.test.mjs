/**
 * The turn-based hierarchical memory policy: what stays, what is summarized,
 * and what is evicted.
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import {
  classifyTool,
  evictionNotice,
  KIND_CODE,
  KIND_LOG,
  structuralIndex,
  structuralSummary,
  tierContent,
  tierForTurn,
  TIER_COLD,
  TIER_DEFAULTS,
  TIER_HOT,
  TIER_WARM,
} from '../lib/tiering.js'

const policy = { ...TIER_DEFAULTS }

test('the newest turns are hot, the middle ones warm, the old ones cold', () => {
  // Boundaries come from TIER_DEFAULTS, never from literals: `age = currentTurn - turn`,
  // hot while `age < hotTurns` (6), warm while `age < warmTurns` (15), else cold.
  // Derived so a boundary change is one edit, not five assertions to hunt down.
  const cur = 20
  const hot = TIER_DEFAULTS.hotTurns
  const warm = TIER_DEFAULTS.warmTurns
  assert.equal(tierForTurn(cur, cur, policy), TIER_HOT, 'the current turn is hot')
  assert.equal(tierForTurn(cur - (hot - 1), cur, policy), TIER_HOT, 'the last hot turn is still hot')
  assert.equal(tierForTurn(cur - hot, cur, policy), TIER_WARM, 'one past the hot boundary is warm')
  assert.equal(tierForTurn(cur - (warm - 1), cur, policy), TIER_WARM, 'the last warm turn is still warm')
  assert.equal(tierForTurn(cur - warm, cur, policy), TIER_COLD, 'one past the warm boundary is cold')
  assert.equal(tierForTurn(1, cur, policy), TIER_COLD, 'the first turn is cold')
})

test('the documented six-turn window holds', () => {
  // The operator-facing promise: turns 1-6 in memory, 7-15 an index, 16+ in the log.
  // Stated against a fresh session so the numbers are the ones a person sees.
  assert.deepEqual(
    [1, 2, 3, 4, 5, 6].map((t) => tierForTurn(t, 6, policy)),
    [TIER_HOT, TIER_HOT, TIER_HOT, TIER_HOT, TIER_HOT, TIER_HOT],
    'turn 6 leaves all six of its turns whole',
  )
  // At turn 7 the first turn ages out of hot into the index.
  assert.equal(tierForTurn(1, 7, policy), TIER_WARM)
  assert.equal(tierForTurn(2, 7, policy), TIER_HOT)
  // The index window closes at turn 16, where the oldest turn is evicted.
  assert.equal(tierForTurn(1, 16, policy), TIER_COLD)
  assert.equal(tierForTurn(2, 16, policy), TIER_WARM)
})

test('a hot output is never touched', () => {
  const text = 'x'.repeat(5000)
  assert.equal(tierContent({ text, kind: KIND_LOG, tier: TIER_HOT, turn: 20, step: 1, name: 'bash', policy }), undefined)
})

test('a short output is left alone even when it is old', () => {
  const text = 'short'
  assert.equal(tierContent({ text, kind: KIND_LOG, tier: TIER_COLD, turn: 1, step: 1, name: 'bash', policy }), undefined)
})

test('a warm log becomes a structural summary that keeps head, tail and index', () => {
  const text = [
    'Running tests for src/app.ts',
    'error: cannot read config.json',
    'exit code: 2',
    // Above TIER_DEFAULTS.minChars (3,700): a fixture below the floor would be skipped
    // by the gate and this test would assert nothing about summarization.
    ...Array.from({ length: 240 }, (_, i) => `line ${i} of noise`),
    'the last line',
  ].join('\n')
  const summary = tierContent({ text, kind: KIND_LOG, tier: TIER_WARM, turn: 10, step: 3, name: 'bash', policy })
  assert.ok(summary.includes('warm tier'))
  assert.ok(summary.includes('Running tests for src/app.ts'), 'the head stays')
  assert.ok(summary.includes('the last line'), 'the tail stays')
  assert.ok(summary.includes('config.json'), 'the index keeps the file names')
  assert.ok(summary.includes('exit code: 2'), 'the index keeps the status')
  assert.ok(summary.includes('errors=1'), 'the index counts the errors')
  assert.ok(summary.length < text.length, 'the summary is smaller than the output')
})

test('a warm code read keeps its whole content', () => {
  const text = 'const answer = 42\n'.repeat(400)
  assert.equal(tierContent({ text, kind: KIND_CODE, tier: TIER_WARM, turn: 10, step: 3, name: 'read', policy }), undefined)
})

test('a cold output is evicted with a pointer to the log', () => {
  const text = 'y'.repeat(5000)
  const evicted = tierContent({ text, kind: KIND_LOG, tier: TIER_COLD, turn: 2, step: 7, name: 'bash', policy })
  assert.ok(evicted.includes('cold tier'))
  assert.ok(evicted.includes('turn=2'))
  assert.ok(evicted.includes('step=7'))
  assert.ok(evicted.includes('session log'))
  assert.ok(evicted.length < 500)
})

test('a shell read is code, a shell run is a log', () => {
  assert.equal(classifyTool('read', {}), KIND_CODE)
  assert.equal(classifyTool('bash', { command: 'cat src/app.ts' }), KIND_CODE)
  assert.equal(classifyTool('bash', { command: 'npm test' }), KIND_LOG)
  assert.equal(classifyTool('pwsh', { command: 'Get-Content a.ts' }), KIND_LOG)
})

test('the index names files, statuses and sections', () => {
  const index = structuralIndex([
    '# Build output',
    'compiled src/index.ts and src/util.ts',
    'status: 200',
    'warning: deprecated api',
  ].join('\n'))
  assert.ok(index.includes('files='))
  assert.ok(index.includes('index.ts'))
  assert.ok(index.includes('status=200'))
  assert.ok(index.includes('warnings=1'))
  assert.ok(index.includes('Build output'))
})

test('the eviction notice says where the output went', () => {
  const notice = evictionNotice({ turn: 3, step: 4, chars: 1200, kind: KIND_LOG, name: 'bash' })
  assert.ok(notice.includes('turn=3'))
  assert.ok(notice.includes('step=4'))
  assert.ok(notice.includes('full-text search'))
})

test('the summary keeps the marker the tiering pass recognizes', () => {
  const summary = structuralSummary('z'.repeat(3000), policy)
  assert.ok(summary.startsWith('[tokeneconomizer]'))
})
