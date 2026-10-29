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
  assert.equal(tierForTurn(20, 20, policy), TIER_HOT)
  assert.equal(tierForTurn(16, 20, policy), TIER_HOT, 'five turns back is still hot')
  assert.equal(tierForTurn(15, 20, policy), TIER_WARM)
  assert.equal(tierForTurn(6, 20, policy), TIER_WARM)
  assert.equal(tierForTurn(5, 20, policy), TIER_COLD)
  assert.equal(tierForTurn(1, 20, policy), TIER_COLD)
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
    ...Array.from({ length: 200 }, (_, i) => `line ${i} of noise`),
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
