import { test } from 'node:test'
import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const scriptPath = join(here, '..', 'scripts', 'audit-deprecations.mjs')

/**
 * The seam packages and where each symbol must be declared. A fixture install
 * mirrors the real layout: <root>/node_modules/<pkg>/lib/types/index.d.ts.
 */
const SEAM_DECLARATIONS = [
  { package: '@deepseek-ai/dsh-session', symbol: 'eventAt', text: '    eventAt(seq: SessionSeq): SessionEvent | undefined' },
  { package: '@deepseek-ai/dsh-session', symbol: 'snapshotEvents', text: '    snapshotEvents(fromSeq?: number): readonly SessionEvent[]' },
  { package: '@deepseek-ai/dsh-session', symbol: 'deriveMessages', text: '    deriveMessages(): Message[]' },
  { package: '@deepseek-ai/dsh-session', symbol: 'append', text: '    append(inputs: readonly SessionEventInput[]): readonly SessionEvent[]' },
  { package: '@deepseek-ai/dsh-agent', symbol: 'agent/pre-step', text: "        'agent/pre-step'(payload: unknown, next: () => Promise<unknown>): Promise<unknown>" },
  { package: '@deepseek-ai/dsh-tools', symbol: 'restrict', text: '    restrict(filter: ToolRestriction): () => void' },
  { package: '@deepseek-ai/dsh-system-prompt', symbol: 'context', text: '    context(context: PromptContext): () => void' }
]

const DEPRECATION_LINE = '     * @deprecated Existing logic may remain unmigrated for now, but new calls are prohibited.'

/**
 * Build a fixture install. Every package gets one declaration file holding
 * that package's seams; `deprecated` and `removed` name seam symbols to mark
 * or drop, so a test can express exactly one deviation from a clean install.
 */
function buildFixture({ deprecated = [], removed = [] } = {}) {
  const root = mkdtempSync(join(tmpdir(), 'dsh-deprecation-audit-'))
  const byPackage = new Map()
  for (const declaration of SEAM_DECLARATIONS) {
    if (!byPackage.has(declaration.package)) byPackage.set(declaration.package, [])
    byPackage.get(declaration.package).push(declaration)
  }
  mkdirSync(join(root, 'node_modules'), { recursive: true })
  for (const [packageName, declarations] of byPackage) {
    const typesDir = join(root, 'node_modules', packageName, 'lib', 'types')
    mkdirSync(typesDir, { recursive: true })
    const lines = [
      '/** fixture declarations */',
      'export declare class Fixture {'
    ]
    for (const declaration of declarations) {
      if (removed.includes(declaration.symbol)) continue
      lines.push('    /**')
      lines.push('     * Fixture declaration.')
      if (deprecated.includes(declaration.symbol)) lines.push(DEPRECATION_LINE)
      lines.push('     */')
      lines.push(declaration.text)
    }
    lines.push('}')
    lines.push('')
    writeFileSync(join(typesDir, 'index.d.ts'), lines.join('\n'), 'utf8')
  }
  return root
}

function runAudit(fixture, extraArgs = []) {
  const args = [scriptPath, ...extraArgs]
  let stdout = ''
  try {
    stdout = execFileSync(process.execPath, args, {
      env: { ...process.env, DSH_INSTALL_DIR: fixture },
      encoding: 'utf8'
    })
    return { code: 0, stdout }
  } catch (error) {
    stdout = String(error.stdout ?? '')
    const stderr = String(error.stderr ?? '')
    return { code: error.status, stdout: stdout + stderr }
  }
}

test('audit passes on a clean fixture install', () => {
  const fixture = buildFixture()
  try {
    const result = runAudit(fixture)
    assert.equal(result.code, 0, `expected exit 0, got ${result.code}: ${result.stdout}`)
    assert.match(result.stdout, /^ok session\.append$/m)
    assert.match(result.stdout, /^ok session\.snapshotEvents$/m)
    assert.match(result.stdout, /^ok session\.deriveMessages$/m)
    assert.match(result.stdout, /^ok session\.append$/m)
    assert.match(result.stdout, /^ok agent\.pre-step$/m)
    assert.match(result.stdout, /^ok tools\.restrict$/m)
    assert.match(result.stdout, /^ok systemPrompt\.context$/m)
    assert.doesNotMatch(result.stdout, /^FAIL /m)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('audit fails (exit 1) on a fixture .d.ts containing a removed seam', () => {
  const fixture = buildFixture({ removed: ['snapshotEvents'] })
  try {
    const result = runAudit(fixture)
    assert.equal(result.code, 1, `expected exit 1, got ${result.code}: ${result.stdout}`)
    assert.match(result.stdout, /^FAIL session\.snapshotEvents: /m)
    assert.match(result.stdout, /symbol not found/)
    assert.match(result.stdout, /^ok session\.append$/m)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('audit fails when a consumed seam gains @deprecated', () => {
  const fixture = buildFixture({ deprecated: ['append'] })
  try {
    const result = runAudit(fixture)
    assert.equal(result.code, 1, `expected exit 1, got ${result.code}: ${result.stdout}`)
    assert.match(result.stdout, /^FAIL session\.append: deprecated but not allowed/m)
    assert.match(result.stdout, /^ok tools\.restrict$/m)
    // Other seams stay green: the failure is attributed, not global.
    assert.equal((result.stdout.match(/^FAIL /gm) ?? []).length, 1)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('audit reports exit 2 when the install root is missing', () => {
  const missing = join(mkdtempSync(join(tmpdir(), 'dsh-deprecation-audit-')), 'not-an-install')
  try {
    const result = runAudit(missing)
    assert.equal(result.code, 2, `expected exit 2, got ${result.code}: ${result.stdout}`)
    assert.match(result.stdout, /DSH install root not found/)
  } finally {
    rmSync(dirname(missing), { recursive: true, force: true })
  }
})

test('audit emits machine-readable --json on a failing fixture', () => {
  const fixture = buildFixture({ deprecated: ['append'] })
  try {
    const result = runAudit(fixture, ['--json'])
    assert.equal(result.code, 1)
    const parsed = JSON.parse(result.stdout)
    assert.equal(parsed.ok, false)
    assert.equal(parsed.exitCode, 1)
    assert.deepEqual(parsed.failures, ['session.append'])
    assert.equal(parsed.seams.length, 7)
    const seam = parsed.seams.find((entry) => entry.id === 'session.append')
    assert.equal(seam.deprecated, true)
    assert.equal(seam.failing, true)
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('audit --baseline demotes known failures but keeps new ones failing', () => {
  const fixture = buildFixture({ deprecated: ['append'] })
  const baselineDir = mkdtempSync(join(tmpdir(), 'dsh-deprecation-baseline-'))
  const baselineFile = join(baselineDir, 'baseline.json')
  writeFileSync(baselineFile, `${JSON.stringify({ knownFailures: ['session.append'] }, null, 2)}\n`, 'utf8')
  try {
    const known = runAudit(fixture, ['--baseline', baselineFile])
    assert.equal(known.code, 0, `baseline should suppress, got ${known.code}: ${known.stdout}`)
    assert.match(known.stdout, /baselined/)

    // A second, unrecorded deprecation must still fail.
    const fixture2 = buildFixture({ deprecated: ['append', 'restrict'] })
    try {
      const fresh = runAudit(fixture2, ['--baseline', baselineFile])
      assert.equal(fresh.code, 1, `new failure must not be suppressed: ${fresh.stdout}`)
      assert.match(fresh.stdout, /^FAIL tools\.restrict: /m)
    } finally {
      rmSync(fixture2, { recursive: true, force: true })
    }
  } finally {
    rmSync(baselineDir, { recursive: true, force: true })
    rmSync(fixture, { recursive: true, force: true })
  }
})

test('audit is read-only and does not create files in the fixture', () => {
  const fixture = buildFixture()
  try {
    runAudit(fixture)
    assert.deepEqual(readdirSync(fixture), ['node_modules'])
  } finally {
    rmSync(fixture, { recursive: true, force: true })
  }
})
