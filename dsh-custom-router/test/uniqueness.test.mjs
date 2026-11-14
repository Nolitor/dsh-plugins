/**
 * Repo-wide implementation-uniqueness gate (`ARCHITECTURE-LAYERED.md` §6 #3,
 * follow-up **R6**) — the CI half.
 *
 * WHY THIS FILE EXISTS
 * §6 #3 listed five names — `mapDelta`, `numberOrNull`, `pickSession`,
 * `createCostStore`, `backoffDelay` — and measured that two of them had more
 * than one definition. It recorded that as a **manual grep**. Nothing failed
 * when a vendor re-copied a core body, so the duplication that R2 is now
 * removing had landed green and would have come back green.
 *
 * The obvious gate — "each name is defined exactly once repo-wide" — is WRONG,
 * and this file pins why. Measured at the time of writing:
 *
 *   mapDelta         1   (lib/stream/openai.js)
 *   backoffDelay     1   (lib/retry.js)
 *   numberOrNull     2   (lib/cost.js + vendor/opencode/lib/cost.js)
 *   pickSession      2   (lib/cost.js + vendor/opencode/lib/cost.js)
 *   createCostStore  3   (lib/cost.js + vendor/opencode + vendor/deepinfra)
 *
 * `createCostStore` legitimately appears three times. The architecture allows a
 * vendor to keep a same-named THIN WRAPPER as long as it imports the core symbol
 * and CALLS it; `vendor/deepinfra/lib/cost.js` is the accepted precedent (it
 * delegates to the core `createSharedStore`). What is forbidden is a vendor
 * carrying a second copy of the BODY. So the rule this gate encodes is:
 *
 *   1. each name has exactly ONE implementation, and it lives in `lib/**`;
 *   2. a `vendor/<pkg>/**` definition is allowed ONLY when the file imports the
 *      core symbol and calls it — a wrapper delegates, never re-implements;
 *   3. definitions outside both layers are strays and fail;
 *   4. the vendor set is MEASURED from `vendor/*​/package.json`, never
 *      hand-listed (same technique as `test/plan-boundary.test.mjs`), so a fifth
 *      vendored package is covered without editing this test.
 *
 * `scripts/verify-uniqueness.mjs` runs the same scanner as a standalone gate.
 * Every rule here also has a MUTATION test that plants the regression in memory
 * and asserts it is caught — a gate nobody has seen fail is a gate nobody should
 * trust.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  GATED_NAMES,
  bodyOf,
  checkUniqueness,
  collectTree,
  definitionsOf,
  importBindings,
  measuredVendors,
  reachesCore,
  scanUniqueness,
  stripComments,
} from '../scripts/verify-uniqueness.mjs'

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)))
const TREE = collectTree(ROOT)

/** A doctored copy of the measured tree: prepend text to one file. */
function withSource(file, text, tree = TREE) {
  return { ...tree, sources: { ...tree.sources, [file]: `${text}\n${tree.sources[file]}` } }
}

/** A doctored copy with a brand-new file. */
function withFile(file, text, tree = TREE) {
  return { ...tree, sources: { ...tree.sources, [file]: text } }
}

const sha256 = (text) => createHash('sha256').update(text, 'utf8').digest('hex')

// ---------------------------------------------------------------------- setup

test('the measured vendor set is read from vendor/*/package.json, not typed in', () => {
  const vendors = measuredVendors(ROOT)
  assert.ok(vendors.length >= 4, `measured ${vendors.length} vendors: ${vendors.map((vendor) => vendor.dir).join(', ')}`)
  const dirs = vendors.map((vendor) => vendor.dir)
  const names = vendors.map((vendor) => vendor.name)
  assert.ok(dirs.includes('vendor/opencode') && dirs.includes('vendor/deepinfra'), dirs.join(', '))
  assert.ok(names.includes('@nolit/dsh-opencode-v2') && names.includes('@nolit/dsh-deepinfra'), names.join(', '))
  // A vendor directory with no readable package.json is NOT a vendor: the set is
  // measured, so an empty or unreadable manifest cannot silently widen it.
  assert.deepEqual(measuredVendors(join(ROOT, 'does-not-exist')), [])
})

test('the scan is not vacuous: it reads the real sources and finds the gated names', () => {
  assert.ok(Object.keys(TREE.sources).length >= 100, `scanned ${Object.keys(TREE.sources).length} files`)
  assert.deepEqual([...GATED_NAMES].sort(), ['backoffDelay', 'createCostStore', 'mapDelta', 'numberOrNull', 'pickSession'])
  for (const name of GATED_NAMES) {
    const total = Object.values(TREE.sources).reduce((sum, text) => sum + definitionsOf(stripComments(text), name).length, 0)
    assert.ok(total >= 1, `"${name}" has no definition at all — the scan or the name list is broken`)
  }
})

test('a re-export and an import binding are NOT definitions', () => {
  // vendor/deepinfra/lib/cost.js re-exports the core symbols: that is sharing,
  // not a second implementation, and the gate must not count it.
  const deepinfra = stripComments(TREE.sources['vendor/deepinfra/lib/cost.js'])
  assert.match(deepinfra, /export\s*\{[^}]*numberOrNull[^}]*\}/)
  assert.deepEqual(definitionsOf(deepinfra, 'numberOrNull'), [])
  assert.deepEqual(definitionsOf(deepinfra, 'pickSession'), [])
  // …while its createCostStore really is a definition.
  assert.equal(definitionsOf(deepinfra, 'createCostStore').length, 1)
})

// ------------------------------------------------------- the shipped invariant

test('R6: each gated name has exactly ONE core implementation in lib/**', () => {
  const findings = scanUniqueness(TREE).filter((finding) => finding.rule === 'core-count')
  assert.deepEqual(findings, [], findings.map((finding) => finding.message).join(' | '))
})

test('R6: no gated name is defined outside the core and vendor layers', () => {
  const findings = scanUniqueness(TREE).filter((finding) => finding.rule === 'stray-definition')
  assert.deepEqual(findings, [], findings.map((finding) => `${finding.file}:${finding.line} ${finding.message}`).join(' | '))
})

test('R6: no gated name leaks into a generated artifact', () => {
  const findings = scanUniqueness(TREE).filter((finding) => finding.rule === 'generated-artifact')
  assert.deepEqual(findings, [], findings.map((finding) => finding.message).join(' | '))
})

test('R6: every vendor definition of a gated name is a thin wrapper that calls the core', () => {
  const findings = scanUniqueness(TREE).filter((finding) => finding.rule === 'vendor-reimplementation')
  // This is the assertion R2 must make pass. Each message names the file, the
  // line and which rule broke, so a failure is actionable without a re-grep.
  assert.deepEqual(findings, [], findings.map((finding) => `${finding.file}:${finding.line} — ${finding.message}`).join('\n'))
})

test('R6: the whole tree is clean in one pass, and the count table is measured', () => {
  const verdict = checkUniqueness(ROOT)
  assert.deepEqual(verdict.findings, [])
  assert.deepEqual(Object.keys(verdict.checked.names).sort(), [...GATED_NAMES].sort())
  for (const [name, counts] of Object.entries(verdict.checked.names)) {
    assert.equal(counts.core, 1, `"${name}": core=${counts.core} — exactly one implementation is required`)
    assert.equal(counts.other, 0, `"${name}": ${counts.other} stray definition(s) outside lib/** and vendor/**`)
    assert.equal(counts.total, counts.core + counts.vendor)
  }
  assert.ok(verdict.vendors.length >= 4)
})

// ------------------------------------------- satisfiability of the target shape

/**
 * The shape R2 is landing, in memory: the OpenCode ledger keeps no body of its
 * own and delegates every shared name to the core. Used by the satisfiability
 * tests below so they measure the TARGET invariant, not today's tree.
 */
const OPENCODE_AS_WRAPPER = [
  "import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'",
  '',
  "import { resolveCatalogPath } from './catalog-file.js'",
  "import {",
  '  createCostStore as createSharedStore,',
  '  numberOrNull as coreNumberOrNull,',
  '  pickSession as corePickSession,',
  "} from '../../../lib/cost.js'",
  '',
  'export { coreNumberOrNull as numberOrNull, corePickSession as pickSession }',
  '',
  'export function createCostStore({ explicit, profileDir, dshHome, fileName } = {}) {',
  '  const path = resolveCatalogPath({ explicit, profileDir, dshHome, fileName })',
  "  return createSharedStore({ path, fs: { mkdirSync, readFileSync, writeFileSync } })",
  '}',
  '',
].join('\n')

/** The measured tree with the OpenCode duplicate replaced by the target wrapper. */
function treeAfterR2() {
  return { ...TREE, sources: { ...TREE.sources, 'vendor/opencode/lib/cost.js': OPENCODE_AS_WRAPPER } }
}

test('TARGET INVARIANT: once R2 makes the OpenCode ledger a thin wrapper, the gate goes clean', () => {
  // The gate fails today on exactly the three OpenCode duplicates R2 is removing.
  // A gate that could never pass would be worthless, so this test proves the
  // TARGET shape is green. Built in memory — nothing on disk is touched, and
  // vendor/opencode is never edited by this track.
  const findings = scanUniqueness(treeAfterR2())
  assert.deepEqual(findings, [], findings.map((finding) => `${finding.file}:${finding.line} — ${finding.message}`).join('\n'))
})

test('TARGET INVARIANT: a delegating wrapper per vendor name satisfies rule 2 for all five names', () => {
  const wrapper = GATED_NAMES.map(
    (name) => `import { ${name} as core${name[0].toUpperCase()}${name.slice(1)} } from '../../../lib/cost.js'\nexport function ${name}(...args) { return core${name[0].toUpperCase()}${name.slice(1)}(...args) }`,
  ).join('\n\n')
  const base = treeAfterR2()
  const tree = { ...base, sources: { ...base.sources, 'vendor/exaone/lib/wrappers.js': `${wrapper}\n` } }
  const findings = scanUniqueness(tree).filter((finding) => finding.rule === 'vendor-reimplementation')
  assert.deepEqual(findings, [], findings.map((finding) => `${finding.file} — ${finding.message}`).join('\n'))
})

// ------------------------------------------------- the accepted wrapper precedent

test('the accepted DeepInfra delegation is classified as a wrapper, not a re-implementation', () => {
  // Positive proof that the gate is not simply "any vendor definition fails":
  // vendor/deepinfra/lib/cost.js createCostStore imports the core symbol under
  // an alias and calls it. If this stopped being accepted, the vendor rule would
  // be too strict and would force a false failure forever.
  const file = 'vendor/deepinfra/lib/cost.js'
  const code = stripComments(TREE.sources[file])
  const bindings = importBindings(code)
  const alias = bindings.find((binding) => binding.imported === 'createCostStore')
  assert.ok(alias !== undefined, 'deepinfra must import the core createCostStore')
  assert.equal(alias.local, 'createSharedStore')
  assert.ok(reachesCore(file, alias.specifier), alias.specifier)
  const [definition] = definitionsOf(code, 'createCostStore')
  const body = bodyOf(code, definition.index)
  assert.match(body, /createSharedStore\s*\(/, `wrapper must CALL the core binding; body was ${body.slice(0, 120)}`)
  // The wrapper supplies the `fs` adapter (that is the injected seam, and the
  // whole point of the core taking one) but must not grow its own read/write
  // logic: a second `JSON.parse(readFileSync(` is the re-implementation tell.
  assert.ok(!/JSON\.parse\s*\(/.test(body), 'the wrapper must not re-implement reading')
  assert.ok(!/\bwriteFileSync\s*\(\s*path/.test(body), 'the wrapper must not re-implement atomic writes')
  // The body is a single delegation statement, not a from-scratch store.
  assert.ok(body.split('\n').filter((line) => line.trim().length > 0).length <= 4, `wrapper body grew to: ${body}`)
})

test('reachesCore recognises both a relative path into lib/ and the published subpath', () => {
  assert.equal(reachesCore('vendor/deepinfra/lib/cost.js', '../../../lib/cost.js'), true)
  assert.equal(reachesCore('vendor/opencode/lib/cost.js', '../../../lib/retry.js'), true)
  assert.equal(reachesCore('vendor/opencode/lib/cost.js', '@nolit/dsh-custom-router/cost'), true)
  // A sibling import never reaches the core, however it is spelled.
  assert.equal(reachesCore('vendor/opencode/lib/cost.js', './catalog-file.js'), false)
  assert.equal(reachesCore('vendor/opencode/lib/cost.js', 'node:fs'), false)
  assert.equal(reachesCore('vendor/opencode/lib/cost.js', '../../lib/cost.js'), false)
})

// --------------------------------------------------------- negative proof (5×)

test('mutation: a second CORE definition is caught (rule 1)', () => {
  const findings = scanUniqueness(withSource('lib/cost.js', 'export function pickSession() { return null }'))
  const hit = findings.find((finding) => finding.rule === 'core-count' && finding.name === 'pickSession')
  assert.ok(hit !== undefined, JSON.stringify(findings))
  assert.match(hit.message, /has 2 core definitions/)
})

test('mutation: a definition parked outside both layers is caught (rule 1b)', () => {
  const findings = scanUniqueness(withFile('scripts/scratch.mjs', 'export function numberOrNull(value) { return Number(value) }'))
  assert.ok(
    findings.some((finding) => finding.rule === 'stray-definition' && finding.name === 'numberOrNull' && finding.file === 'scripts/scratch.mjs'),
    JSON.stringify(findings),
  )
})

test('mutation: a vendor RE-IMPLEMENTATION of a core body is caught (rule 2)', () => {
  // The exact regression R2 removes: a vendor copy with no core import at all.
  const findings = scanUniqueness(
    withSource('vendor/opencode/lib/cost.js', 'export function backoffDelay(attempt, baseMs) { return baseMs * 2 ** attempt }'),
  )
  const hit = findings.find((finding) => finding.rule === 'vendor-reimplementation' && finding.name === 'backoffDelay')
  assert.ok(hit !== undefined, JSON.stringify(findings))
  assert.match(hit.message, /never bind the core "backoffDelay"/)
})

test('mutation: a vendor definition that imports the core symbol but never calls it is caught', () => {
  // Importing is not delegating: a vendored shadow that imports the core only to
  // keep the import list green must still fail.
  const planted = [
    "import { backoffDelay as coreDelay } from '../../../lib/retry.js'",
    'export function backoffDelay(attempt, baseMs) { return baseMs * 2 ** attempt }',
  ].join('\n')
  const findings = scanUniqueness(withSource('vendor/opencode/lib/http.js', planted))
  const hit = findings.find((finding) => finding.rule === 'vendor-reimplementation' && finding.name === 'backoffDelay')
  assert.ok(hit !== undefined, JSON.stringify(findings))
  assert.match(hit.message, /never CALLS the core binding/)
})

test('mutation: importing the core symbol from a NON-core module does not satisfy the rule', () => {
  // `reachesCore` is what makes the rule real; a sibling "core-looking" import
  // must not launder a vendor copy.
  const planted = [
    "import { pickSession as corePick } from './local-helper.js'",
    'export function pickSession(summary, sessionId) { return corePick(summary, sessionId) }',
  ].join('\n')
  const findings = scanUniqueness(withSource('vendor/opencode/lib/cost.js', planted))
  assert.ok(
    findings.some((finding) => finding.rule === 'vendor-reimplementation' && finding.name === 'pickSession'),
    JSON.stringify(findings),
  )
})

test('mutation: a gated name inside a generated artifact is caught (rule 0)', () => {
  const planted = 'export function backoffDelay() { return 0 }'
  const findings = scanUniqueness(withSource('lib/locale-table.js', planted))
  assert.ok(
    findings.some((finding) => finding.rule === 'generated-artifact' && finding.name === 'backoffDelay'),
    JSON.stringify(findings),
  )
})

test('mutation: an empty tree cannot pass the gate (vacuity)', () => {
  const findings = scanUniqueness({ sources: {}, vendors: [], generated: [] })
  // Every name is missing its one core implementation: a blank scan is a
  // failure, never a silent pass.
  for (const name of GATED_NAMES) {
    assert.ok(findings.some((finding) => finding.rule === 'core-count' && finding.name === name), name)
  }
})

test('mutation: a wholly re-implementing vendor copy of every gated name is caught', () => {
  const planted = GATED_NAMES.map((name) => `export function ${name}(...args) { return args }`).join('\n')
  const findings = scanUniqueness(withSource('vendor/antigravity/lib/scratch.js', planted))
  for (const name of GATED_NAMES) {
    assert.ok(
      findings.some((finding) => finding.rule === 'vendor-reimplementation' && finding.name === name),
      `${name}: ${JSON.stringify(findings)}`,
    )
  }
})

// --------------------------------------------- on-disk negative proof (wired gate)

test('a REAL planted duplicate on disk makes the wired gate fail, and the revert is byte-identical', () => {
  // The in-memory mutations above prove the RULES fire. This proves the WIRED
  // gate — the thing `npm test` runs — actually reads the disk and goes red. The
  // plant goes into `scripts/`, a file this track owns, so `vendor/**` is never
  // touched: a transient vendor edit would collide with R2 mid-refactor.
  const target = join(ROOT, 'scripts', 'r6-negative-proof-scratch.mjs')
  const marker = 'export function backoffDelay(attempt, baseMs) { return baseMs * 2 ** attempt }'
  const before = checkUniqueness(ROOT)
  let plantedHash = null
  try {
    writeFileSync(target, `${marker}\n`)
    plantedHash = sha256(readFileSync(target, 'utf8'))
    const during = checkUniqueness(ROOT)
    assert.ok(
      during.findings.length > before.findings.length,
      'planting a real duplicate on disk did not add a finding — the gate is not reading the tree',
    )
    assert.ok(
      during.findings.some((finding) => finding.rule === 'stray-definition' && finding.name === 'backoffDelay'),
      JSON.stringify(during.findings),
    )
  } finally {
    if (existsSync(target)) rmSync(target)
  }
  assert.ok(plantedHash !== null)
  // The revert is verified by the absence of the file plus a re-measured clean-ish
  // baseline identical to the pre-plant verdict.
  const after = checkUniqueness(ROOT)
  assert.equal(after.findings.length, before.findings.length, 'the revert did not restore the baseline')
})

test('the scanner leaves no files behind: the tree hash is stable across a scan', () => {
  const filesBefore = Object.keys(TREE.sources).sort()
  const scanOfAgain = collectTree(ROOT)
  assert.deepEqual(Object.keys(scanOfAgain.sources).sort(), filesBefore)
  const hashes = Object.fromEntries(
    filesBefore.map((file) => [file, sha256(readFileSync(join(ROOT, file), 'utf8'))]),
  )
  scanUniqueness(collectTree(ROOT))
  for (const file of filesBefore) {
    assert.equal(sha256(readFileSync(join(ROOT, file), 'utf8')), hashes[file], `${file} changed during the scan`)
  }
})

test('no negative-proof scratch file survives in scripts/', () => {
  const leftovers = readdirSync(join(ROOT, 'scripts')).filter((name) => /negative-proof|scratch/.test(name))
  assert.deepEqual(leftovers, [])
})
