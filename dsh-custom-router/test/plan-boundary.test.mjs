/**
 * L1 boundary regression: `lib/plan.js` carries ZERO vendor identifiers.
 *
 * WHY THIS FILE EXISTS
 * `docs/ARCHITECTURE-LAYERED.md` §2.5 #1 forbids vendor names in the shared core
 * (`lib/cost.js`, `lib/plan.js`, `lib/usage.js`). The last measured violation was
 * `lib/plan.js:372` declaring the plan → provider map as a literal vendor table
 * (R5). The data now lives in the preset declaration layer (`lib/presets.js`,
 * legitimately vendor-aware) and reaches L1 through an argument or
 * `bindPlanProviders()`.
 *
 * Vendor words are MEASURED from the `vendor/` tree, never hand-listed, so a new
 * vendored package is covered without editing this test. Comments are stripped
 * (L1 documents its history in prose); string, template and identifier text is
 * kept, because a vendor id in a thrown message is exactly the leak the rule
 * forbids.
 *
 * Scope: this test only asserts the ONE file R5 closed. The whole `lib/stream/*`
 * surface has its own gate (`test/stream-boundary.test.mjs`).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { PLAN_PROVIDERS as DECLARED_PLAN_PROVIDERS, planProvidersOf } from '../lib/presets.js'
import { PLAN_PROVIDERS, bindPlanProviders, planOfProvider, planOfRoute } from '../lib/plan.js'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))

/** Vendor names MEASURED from the vendored packages, never hand-listed. */
function measuredVendorWords() {
  const dir = join(ROOT, 'vendor')
  const words = new Set()
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    words.add(entry.name.toLowerCase())
    let name
    try {
      name = JSON.parse(readFileSync(join(dir, entry.name, 'package.json'), 'utf8')).name
    } catch {
      continue
    }
    if (typeof name !== 'string') continue
    for (const part of name.toLowerCase().split('/')) {
      if (part.startsWith('dsh-')) words.add(part.slice(4))
    }
  }
  return [...words].sort()
}

/**
 * Blank JS comments while KEEPING string/template contents (same contract as
 * `test/stream-boundary.test.mjs` `stripComments`).
 * @param {string} source - file text.
 * @returns {string} the same length, comment characters replaced by spaces.
 */
export function stripComments(source) {
  const out = source.split('')
  const blank = (from, to) => {
    for (let i = from; i < to && i < out.length; i += 1) if (out[i] !== '\n') out[i] = ' '
  }
  let index = 0
  let quote = null
  while (index < source.length) {
    const char = source[index]
    const next = source[index + 1]
    if (quote !== null) {
      if (char === '\\') {
        index += 2
        continue
      }
      if (char === quote) quote = null
      index += 1
      continue
    }
    if (char === '"' || char === "'" || char === '`') {
      quote = char
      index += 1
      continue
    }
    if (char === '/' && next === '/') {
      const end = source.indexOf('\n', index)
      const stop = end === -1 ? source.length : end
      blank(index, stop)
      index = stop
      continue
    }
    if (char === '/' && next === '*') {
      const end = source.indexOf('*/', index + 2)
      const stop = end === -1 ? source.length : end + 2
      blank(index, stop)
      index = stop
      continue
    }
    index += 1
  }
  return out.join('')
}

test('the measured vendor set is non-empty and read from vendor/, not typed in', () => {
  const words = measuredVendorWords()
  assert.ok(words.length >= 4, `measured vendor words: ${words.join(', ')}`)
  assert.ok(words.includes('opencode') && words.includes('deepinfra'), words.join(', '))
})

test('R5: lib/plan.js has zero vendor identifiers outside comments', () => {
  const source = readFileSync(join(ROOT, 'lib', 'plan.js'), 'utf8')
  const code = stripComments(source)
  const hits = []
  for (const word of measuredVendorWords()) {
    const matches = code.match(new RegExp(word.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gi'))
    if (matches !== null) hits.push(`${word}×${matches.length}`)
  }
  assert.deepEqual(hits, [], `vendor identifiers in L1 code: ${hits.join(', ')}`)
})

test('the plan → provider map is declared in the preset layer, not in L1', () => {
  // The declaration layer owns the vendor ids …
  assert.equal(DECLARED_PLAN_PROVIDERS.go, 'opencode-go')
  assert.equal(DECLARED_PLAN_PROVIDERS.zen, 'opencode')
  // … per preset family, and a preset without plans gets an empty map.
  assert.deepEqual({ ...planProvidersOf('opencode') }, { go: 'opencode-go', zen: 'opencode' })
  assert.deepEqual({ ...planProvidersOf('deepinfra') }, {})
  assert.deepEqual({ ...planProvidersOf(undefined) }, {})
})

test('binding the declared map reproduces the previous L1 behaviour', () => {
  bindPlanProviders(DECLARED_PLAN_PROVIDERS)
  assert.equal(planOfProvider('opencode-go'), 'go')
  assert.equal(planOfProvider('opencode'), 'zen')
  assert.equal(planOfProvider('something-else'), 'other')
  assert.equal(planOfRoute('opencode-go/glm-5.3-flash'), 'go')
  assert.equal(planOfRoute('opencode/flint-40b-free'), 'zen')
})

test('an explicit map argument works without any binding (injection seam)', () => {
  bindPlanProviders(null)
  assert.equal(planOfProvider('opencode-go'), 'other')
  const injected = { go: 'provider-a', zen: 'provider-b' }
  assert.equal(planOfProvider('provider-a', injected), 'go')
  assert.equal(planOfRoute('provider-b/model-x', injected), 'zen')
  assert.equal(planOfProvider('opencode-go', injected), 'other')
  bindPlanProviders(DECLARED_PLAN_PROVIDERS)
})
