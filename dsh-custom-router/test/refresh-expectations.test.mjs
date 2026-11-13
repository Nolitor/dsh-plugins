/**
 * Tests for the expected-route table behind `npm run verify:refresh`.
 *
 * WHY THIS SUITE EXISTS (ROADMAP P1-6)
 *   `verify:refresh` only catches a missing preset, model or lane if the
 *   expectation actually FAILS when the fact disappears. A gate that passes a
 *   broken payload is worse than no gate, so this suite is written as
 *   mutations: one healthy read proves the table passes what the live gate
 *   measures, then ONE mutation per expectation proves the table fails when
 *   that expectation is removed — always with a message that NAMES the preset,
 *   so an operator reading the log knows which lane vanished.
 *
 * The fixtures mirror the measured live payloads (2026-11-14): Antigravity
 * answers grouped rows (`groups[].models[]`), the other three answer a flat
 * `models[]`.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'

import {
  ROUTES,
  antigravityBases,
  evaluateRefresh,
  evaluateRefreshRoute,
  modelRows,
} from '../scripts/refresh-expectations.mjs'

/**
 * A healthy Antigravity payload: grouped by usage family, as the live route
 * answers. The measured baseline is 10 base rows including `claude-opus-5-5`
 * and `gemini-4-hydrogen`.
 * @param {object} [options] - `{ omit }` drops one base id, `{ keep }` narrows
 *   the row list to one family.
 * @returns {object} the payload.
 */
function antigravityPayload(options = {}) {
  const families = [
    { kind: 'gemini', models: ['gemini-4-hydrogen', 'gemini-3-flash', 'gemini-3.1-flash-lite'] },
    { kind: 'claude', models: ['claude-opus-5-5', 'claude-sonnet-5-5'] },
    { kind: 'gpt', models: ['gpt-oss-120b'] },
  ]
  const groups = families
    .filter((family) => options.keep === undefined || options.keep === family.kind)
    .map((family) => ({
      kind: family.kind,
      models: family.models
        .filter((id) => options.omit === undefined || id !== options.omit)
        .map((id) => ({ id, variants: [id] })),
    }))
  return { groups }
}

/**
 * A healthy flat payload for the three `models[]` routes.
 * @param {object[]} [models] - the rows.
 * @returns {object} the payload.
 */
function flatPayload(models) {
  return { models }
}

/** A 200 read carrying a payload. */
const ok = (body) => ({ status: 200, body, ms: 1 })

/**
 * The four healthy reads, in table order.
 * @returns {Array<{preset: string, plain: object, forced: object}>} the reads.
 */
function healthyReads() {
  return [
    { preset: 'antigravity', plain: ok(antigravityPayload()), forced: ok(antigravityPayload()) },
    { preset: 'opencode', plain: ok(flatPayload([{ id: 'opencode-go/glm-5' }])), forced: ok(flatPayload([{ id: 'opencode-go/glm-5' }])) },
    { preset: 'deepinfra', plain: ok(flatPayload([{ id: 'deepseek-ai/DeepSeek-V3' }])), forced: ok(flatPayload([{ id: 'deepseek-ai/DeepSeek-V3' }])) },
    { preset: 'exaone', plain: ok(flatPayload([{ id: 'k-exaone_v2.5' }])), forced: ok(flatPayload([{ id: 'k-exaone_v2.5' }])) },
  ]
}

/**
 * Apply one mutation to the healthy reads.
 * @param {(reads: Array<object>) => void} mutate - the mutation.
 * @returns {object} the verdict of the mutated reads.
 */
function mutated(mutate) {
  const reads = healthyReads()
  mutate(reads)
  return evaluateRefresh(reads)
}

/**
 * Assert that a mutation fails AND that the failure message names the preset.
 * @param {object} verdict - the verdict under test.
 * @param {string} preset - the preset that must be named.
 * @param {RegExp} [pattern] - an extra pattern the message must match.
 * @returns {string[]} the failure messages.
 */
function assertNamesPreset(verdict, preset, pattern) {
  assert.equal(verdict.ok, false, `${preset}: the mutated read must NOT pass the gate`)
  const named = verdict.failures.filter((message) => message.includes(preset))
  assert.ok(named.length > 0, `${preset}: no failure message names the preset; got ${JSON.stringify(verdict.failures)}`)
  if (pattern !== undefined) {
    assert.ok(named.some((message) => pattern.test(message)), `${preset}: no failure message matches ${pattern}; got ${JSON.stringify(named)}`)
  }
  return verdict.failures
}

test('the table names the four presets and their live routes', () => {
  assert.deepEqual(ROUTES.map((spec) => spec.preset), ['antigravity', 'opencode', 'deepinfra', 'exaone'])
  assert.deepEqual(ROUTES.map((spec) => spec.path), [
    '/api/local/dsh-antigravity/models',
    '/api/local/opencode-v2/model-settings',
    '/api/local/deepinfra/models',
    '/api/local/dsh-exaone/models',
  ])
  for (const spec of ROUTES) {
    assert.equal(typeof spec.rows, 'function', spec.preset + ': a row reader is required')
    assert.ok(Array.isArray(spec.expected) && spec.expected.length > 0, spec.preset + ': the table must name at least one expected row')
    for (const want of spec.expected) {
      assert.equal(typeof want.label, 'string', spec.preset + ': an expectation needs a label')
      assert.ok(want.label.length > 0, spec.preset + ': an expectation label must not be empty')
      assert.equal(typeof want.find, 'function', spec.preset + ': an expectation needs a predicate')
    }
  }
})

test('the expected paths are the paths the presets declare', async () => {
  const { PRESETS } = await import('../lib/presets.js')
  for (const spec of ROUTES) {
    const preset = PRESETS.find((entry) => entry.id === spec.preset)
    assert.ok(preset !== undefined, spec.preset + ': the table must not name an unknown preset')
    // Antigravity declares no `catalogRoute` — its catalog route is the usage
    // route it publishes — so it is checked against that list instead.
    const declared = preset.catalogRoute ?? (preset.usage?.routes ?? []).map((route) => route.path)
    assert.ok(declared.includes(spec.path), spec.preset + ': the expected route is not a route the preset declares')
  }
})

test('healthy reads for all four presets pass the gate', () => {
  const verdict = evaluateRefresh(healthyReads())
  assert.equal(verdict.ok, true, 'healthy reads must pass: ' + verdict.failures.join('; '))
  assert.deepEqual(verdict.failures, [])
  assert.equal(verdict.present, 4)
  assert.equal(verdict.expected, 4)
  assert.equal(verdict.results.length, 4)
  for (const result of verdict.results) {
    assert.equal(result.ok, true, result.preset + ': healthy read must pass')
    assert.equal(result.present, true, result.preset + ': a healthy read is a present route')
    assert.ok(result.checks.length > 0, result.preset + ': the verdict must report its checks')
    for (const check of result.checks) assert.equal(check.ok, true, result.preset + ': ' + check.label + ' must hold')
  }
})

test('evaluateRefresh reports the present and expected counts', () => {
  const verdict = evaluateRefresh(healthyReads())
  assert.equal(verdict.present, 4)
  assert.equal(verdict.expected, 4)
  assert.equal(verdict.expected, ROUTES.length)
  // A read that was never made is NOT a present route: counting it would be the
  // false green this gate exists to prevent.
  const nothing = evaluateRefresh([])
  assert.equal(nothing.present, 0)
  assert.equal(nothing.expected, 4)
  assert.equal(nothing.ok, false)
  assert.ok(nothing.failures.length > 0, 'a gate that read nothing must fail')
})

test('an unmounted route fails and names its preset', () => {
  const verdict = mutated((reads) => {
    reads[3] = { preset: 'exaone', plain: { skipped: true }, forced: { skipped: true } }
  })
  assertNamesPreset(verdict, 'exaone', /not mounted/)
  assert.equal(verdict.present, 3)
  assert.equal(verdict.expected, 4)
  assert.equal(verdict.ok, false)
})

test('a route that was never read fails instead of counting as present', () => {
  const verdict = evaluateRefresh([])
  assert.equal(verdict.present, 0)
  assert.equal(verdict.ok, false)
  for (const result of verdict.results) {
    assert.equal(result.present, false, result.preset + ': an unread route is not present')
    assert.ok(result.failures.some((message) => message.includes(result.preset)), result.preset + ': the failure must name the preset')
  }
})

test('a non-200 plain read fails and names its preset', () => {
  const verdict = mutated((reads) => {
    reads[1].plain = { status: 500, body: { error: 'boom' }, ms: 1 }
  })
  assertNamesPreset(verdict, 'opencode', /plain read did not answer \(HTTP 500\)/)
})

test('a non-200 forced read fails and names its preset', () => {
  const verdict = mutated((reads) => {
    reads[2].forced = { status: 502, body: { error: 'bad gateway' }, ms: 1 }
  })
  assertNamesPreset(verdict, 'deepinfra', /forced read did not answer \(HTTP 502\)/)
})

test('a plain read with no JSON body fails and names its preset', () => {
  const verdict = mutated((reads) => {
    reads[0].plain = { status: 200, body: undefined, text: 'not json', ms: 1 }
  })
  assertNamesPreset(verdict, 'antigravity', /plain read did not answer/)
})

test('Antigravity without a Claude base row fails and names the preset', () => {
  const verdict = mutated((reads) => {
    reads[0].plain = ok(antigravityPayload({ keep: 'gemini' }))
    reads[0].forced = ok(antigravityPayload({ keep: 'gemini' }))
  })
  assertNamesPreset(verdict, 'antigravity', /Claude base row/)
  const claudeCheck = verdict.results[0].checks.find((check) => /Claude/.test(check.label))
  assert.equal(claudeCheck.ok, false)
  assert.equal(claudeCheck.plain, false)
  assert.equal(claudeCheck.forced, false)
  // The Gemini lane must still read as present, so the failure is the Claude
  // lane and not "the whole preset broke".
  const geminiCheck = verdict.results[0].checks.find((check) => /Gemini base row/.test(check.label))
  assert.equal(geminiCheck.ok, true)
})

test('Antigravity without a Gemini base row fails and names the preset', () => {
  const verdict = mutated((reads) => {
    reads[0].plain = ok(antigravityPayload({ keep: 'claude' }))
    reads[0].forced = ok(antigravityPayload({ keep: 'claude' }))
  })
  assertNamesPreset(verdict, 'antigravity', /Gemini base row/)
  const geminiCheck = verdict.results[0].checks.find((check) => /Gemini base row/.test(check.label))
  assert.equal(geminiCheck.ok, false)
  const claudeCheck = verdict.results[0].checks.find((check) => /Claude/.test(check.label))
  assert.equal(claudeCheck.ok, true)
})

test('Antigravity without the Hydrogen lane fails and names the preset', () => {
  const verdict = mutated((reads) => {
    const payload = antigravityPayload({ omit: 'gemini-4-hydrogen' })
    reads[0].plain = ok(payload)
    reads[0].forced = ok(payload)
  })
  assertNamesPreset(verdict, 'antigravity', /Hydrogen/)
  // The family check still holds — the lane check is what names the loss.
  const geminiCheck = verdict.results[0].checks.find((check) => /Gemini base row/.test(check.label))
  assert.equal(geminiCheck.ok, true)
})

test('EXAONE without k-exaone_v2.5 fails and names the preset', () => {
  const verdict = mutated((reads) => {
    const payload = flatPayload([{ id: 'k-exaone_v2.4' }])
    reads[3].plain = ok(payload)
    reads[3].forced = ok(payload)
  })
  assertNamesPreset(verdict, 'exaone', /k-exaone_v2\.5/)
})

test('EXAONE with an empty models list fails and names the preset', () => {
  const verdict = mutated((reads) => {
    const payload = flatPayload([])
    reads[3].plain = ok(payload)
    reads[3].forced = ok(payload)
  })
  assertNamesPreset(verdict, 'exaone', /k-exaone_v2\.5/)
})

test('OpenCode with empty models fails and names the preset', () => {
  const verdict = mutated((reads) => {
    const payload = flatPayload([])
    reads[1].plain = ok(payload)
    reads[1].forced = ok(payload)
  })
  assertNamesPreset(verdict, 'opencode', /at least one served model row/)
})

test('DeepInfra with empty models fails and names the preset', () => {
  const verdict = mutated((reads) => {
    const payload = flatPayload([])
    reads[2].plain = ok(payload)
    reads[2].forced = ok(payload)
  })
  assertNamesPreset(verdict, 'deepinfra', /at least one served model row/)
})

test('an expectation that holds only on the plain read still fails', () => {
  // A lane that the cached read serves but the forced re-read lost is a stale
  // cache — the serving path would drop the row on the next refresh.
  const verdict = mutated((reads) => {
    reads[3].forced = ok(flatPayload([{ id: 'k-exaone_v2.4' }]))
  })
  assertNamesPreset(verdict, 'exaone', /k-exaone_v2\.5/)
  const check = verdict.results[3].checks.find((entry) => /k-exaone_v2\.5/.test(entry.label))
  assert.equal(check.plain, true)
  assert.equal(check.forced, false)
  assert.equal(check.ok, false)
})

test('an expectation that holds only on the forced read still fails', () => {
  const verdict = mutated((reads) => {
    reads[3].plain = ok(flatPayload([{ id: 'k-exaone_v2.4' }]))
  })
  assertNamesPreset(verdict, 'exaone', /k-exaone_v2\.5/)
  const check = verdict.results[3].checks.find((entry) => /k-exaone_v2\.5/.test(entry.label))
  assert.equal(check.plain, false)
  assert.equal(check.forced, true)
  assert.equal(check.ok, false)
})

test('a read that names another preset cannot answer for this one', () => {
  // Every read carries a preset id, so a swapped payload must not silently
  // satisfy another preset's expectations.
  const verdict = evaluateRefresh([
    { preset: 'opencode', plain: ok(flatPayload([{ id: 'opencode-go/glm-5' }])), forced: ok(flatPayload([{ id: 'opencode-go/glm-5' }])) },
    { preset: 'antigravity', plain: ok(antigravityPayload()), forced: ok(antigravityPayload()) },
    { preset: 'deepinfra', plain: ok(flatPayload([{ id: 'deepseek-ai/DeepSeek-V3' }])), forced: ok(flatPayload([{ id: 'deepseek-ai/DeepSeek-V3' }])) },
    { preset: 'exaone', plain: ok(flatPayload([{ id: 'k-exaone_v2.5' }])), forced: ok(flatPayload([{ id: 'k-exaone_v2.5' }])) },
  ])
  assert.equal(verdict.ok, true, 'a reordered list of NAMED reads must still pass: ' + verdict.failures.join('; '))
  assert.equal(verdict.present, 4)
})

test('a missing named read fails rather than shifting the others', () => {
  const reads = healthyReads()
  reads.splice(1, 1)
  const verdict = evaluateRefresh(reads)
  assert.equal(verdict.ok, false)
  assert.equal(verdict.present, 3)
  assert.ok(verdict.failures.some((message) => message.includes('opencode')), 'the dropped preset must be named')
})

test('a throwing predicate is a MISS, not a crash', () => {
  const spec = {
    preset: 'broken',
    path: '/api/local/broken/models',
    rows: modelRows,
    expected: [{ label: 'a row that explodes', find: () => { throw new Error('boom') } }],
  }
  const verdict = evaluateRefreshRoute(spec, ok(flatPayload([{ id: 'x' }])), ok(flatPayload([{ id: 'x' }])))
  assert.equal(verdict.ok, false)
  assert.ok(verdict.failures.some((message) => message.includes('broken')), 'the failing preset must be named')
})

test('the row readers read the two measured payload shapes', () => {
  assert.deepEqual(modelRows({ models: [{ id: 'a' }] }), [{ id: 'a' }])
  assert.deepEqual(modelRows({}), [])
  assert.deepEqual(modelRows(undefined), [])
  assert.deepEqual(antigravityBases({ groups: [{ models: [{ id: 'claude-opus-5-5' }] }, { models: [{ id: 'gemini-4-hydrogen' }] }] }), ['claude-opus-5-5', 'gemini-4-hydrogen'])
  assert.deepEqual(antigravityBases({ groups: [{ models: [{ id: 'a' }] }, { noModels: true }] }), ['a'])
  assert.deepEqual(antigravityBases({ models: [{ id: 'flat' }] }), [], 'a flat payload has no Antigravity groups')
  assert.deepEqual(antigravityBases(undefined), [])
})
