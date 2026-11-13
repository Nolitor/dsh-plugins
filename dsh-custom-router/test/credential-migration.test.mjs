/**
 * Plaintext-key migration contract tests.
 *
 * These pin the SAFETY property of `lib/credential-migration.js`, which is the
 * only thing that matters about it:
 *
 *   1. a plaintext `apiKey:` line is found in the right row and nowhere else;
 *   2. the store write happens BEFORE the plaintext line is removed, and the
 *      removal is refused when the store did not confirm the value;
 *   3. every line the editor does not target survives byte for byte — the
 *      patch file carries comments and an order a YAML rewrite would destroy;
 *   4. no value is ever returned in a field that a report could print.
 *
 * The tests never carry a real key: the fixtures use obvious fakes.
 */
import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import {
  MIGRATION_TARGETS,
  backupPathFor,
  planPlaintextKeyMigration,
  plaintextKeyIn,
  redact,
  renderPlaintextKeyRemoval,
  runPlaintextKeyMigration,
  unwrap,
} from '../lib/credential-migration.js'

/** A patch that carries the two managed rows plus unrelated content. */
const PATCH = [
  '# the patch layer',
  '- id: subagent-model-selection-settings',
  '  name: "@deepseek-ai/dsh-tool-subagent/model-selection-settings"',
  '  config:',
  '    enabled: true',
  '    allowedModels:',
  '      - provider: exaone',
  '        model: k-exaone_v2.5',
  '- id: dsh-custom-router',
  '  config:',
  '    strict: true',
  '    vendorConfig:',
  '      dsh-deepinfra:',
  '        anthropicRoute: true',
  '        apiKey: sk-fake-deepinfra-value',
  '        turnMaxTokens: 16384',
  '      dsh-exaone:',
  '        apiKey: ex-fake-exaone-value',
  '      dsh-antigravity:',
  '        enabled: true',
  '',
].join('\n')

test('the plan finds each managed row\'s plaintext key and nothing else', () => {
  const { plan, rows, problems } = planPlaintextKeyMigration(PATCH)
  assert.deepEqual(problems, [])
  assert.equal(plan.length, 2)
  assert.deepEqual(plan.map((item) => item.row), ['dsh-deepinfra', 'dsh-exaone'])
  assert.deepEqual(plan.map((item) => item.ref), ['DEEPINFRA_API_KEY', 'EXAONE_API_KEY'])
  assert.equal(plan[0].value, 'sk-fake-deepinfra-value')
  assert.equal(plan[1].value, 'ex-fake-exaone-value')
  // The line numbers are 1-based file lines.
  assert.equal(plan[0].line, 15)
  assert.equal(plan[1].line, 18)
  // Every managed row is reported, found or not.
  assert.equal(rows.length, MIGRATION_TARGETS.length)
  assert.ok(rows.every((row) => row.found))
})

test('a row without a plaintext key is reported as absent, not as an error', () => {
  const without = PATCH.split('\n').filter((line) => !line.includes('apiKey:')).join('\n')
  const { plan, rows, problems } = planPlaintextKeyMigration(without)
  assert.deepEqual(problems, [])
  // The rows still EXIST in the patch (only their apiKey line is gone), so
  // `found` is true — but nothing is planned, which is what makes the
  // migration a no-op in the steady state.
  assert.equal(plan.length, 0)
  assert.equal(rows.length, MIGRATION_TARGETS.length)
  assert.ok(rows.every((row) => row.found))
})

test('an ambiguous row (two headers) is refused rather than guessed', () => {
  // A second `dsh-deepinfra:` container: the editor would not know which one
  // the plaintext line belongs to, so the plan refuses instead of guessing.
  const doubled = `${PATCH}\n      dsh-deepinfra:\n        apiKey: another-fake\n`
  const { problems, plan } = planPlaintextKeyMigration(doubled)
  // The ambiguous row is dropped from the plan; the unambiguous one survives.
  // The CALLER refuses the whole migration when `problems` is non-empty, so a
  // partial plan never reaches a write.
  assert.deepEqual(plan.map((item) => item.row), ['dsh-exaone'])
  assert.equal(problems.length, 1)
  assert.match(problems[0], /appears 2 times/)
})

test('the renderer replaces ONLY the planned lines and preserves everything else', () => {
  const { plan } = planPlaintextKeyMigration(PATCH)
  const next = renderPlaintextKeyRemoval(PATCH, plan)
  const before = PATCH.split('\n')
  const after = next.split('\n')
  assert.equal(before.length, after.length)
  const changed = []
  for (const [index, line] of before.entries()) {
    if (line !== after[index]) changed.push(index + 1)
  }
  assert.deepEqual(changed, [15, 18])
  assert.equal(after[14], '        credentialRef: DEEPINFRA_API_KEY')
  assert.equal(after[17], '        credentialRef: EXAONE_API_KEY')
  // The comment, the allowlist rows and the unrelated vendor row survive.
  assert.ok(next.includes('# the patch layer'))
  assert.ok(next.includes('      - provider: exaone\n        model: k-exaone_v2.5'))
  assert.ok(next.includes('      dsh-antigravity:\n        enabled: true'))
  assert.ok(next.includes('        anthropicRoute: true'))
})

test('the live-config reader finds the plaintext key of a managed row only', () => {
  const vendorConfig = {
    'dsh-deepinfra': { apiKey: 'sk-fake-deepinfra-value' },
    'dsh-exaone': { apiKey: '' },
    'dsh-antigravity': { apiKey: 'not-managed' },
  }
  assert.equal(plaintextKeyIn(vendorConfig, 'dsh-deepinfra')?.ref, 'DEEPINFRA_API_KEY')
  // A blank key is not a plaintext key.
  assert.equal(plaintextKeyIn(vendorConfig, 'dsh-exaone'), undefined)
  // An unmanaged row is never migrated.
  assert.equal(plaintextKeyIn(vendorConfig, 'dsh-antigravity'), undefined)
})

test('a reactive config node is unwrapped, not spread', () => {
  const node = { get: () => ({ apiKey: 'sk-fake-deepinfra-value' }) }
  assert.deepEqual(unwrap(node), { apiKey: 'sk-fake-deepinfra-value' })
  assert.equal(plaintextKeyIn({ 'dsh-deepinfra': node }, 'dsh-deepinfra')?.value, 'sk-fake-deepinfra-value')
})

test('the redact shape never carries the value', () => {
  const shape = redact('sk-fake-deepinfra-value')
  assert.equal(shape, `<redacted len=${'sk-fake-deepinfra-value'.length}>`)
  assert.ok(!shape.includes('sk-fake'))
})

test('the backup path is named after the file and a timestamp', () => {
  const path = backupPathFor('/home/minami/.dsh/profiles/web/cordis.patch.yml', new Date('2026-11-14T00:00:00Z'))
  assert.equal(path, '/home/minami/.dsh/profiles/web/cordis.patch.yml.bak.before-plaintext-key-migration-20261114-000000')
})

test('the migration refuses to remove the plaintext line when the store does not confirm', async () => {
  const { plan } = planPlaintextKeyMigration(PATCH)
  const calls = []
  const written = []
  // A real temp file: the migration backs the patch up before it touches the
  // store, so the refusal must be reached, not a missing-file error.
  const dir = mkdtempSync(join(tmpdir(), 'dsh-keymig-'))
  const patchPath = join(dir, 'cordis.patch.yml')
  writeFileSync(patchPath, PATCH, { mode: 0o600 })
  try {
    await assert.rejects(
      runPlaintextKeyMigration({
        patchPath,
        plan,
        // The store accepts the write but resolves a DIFFERENT value: the
        // confirmation must fail, and the plaintext line must survive.
        store: {
          set: async (ref, value) => { calls.push(['set', ref]); written.push(value) },
          resolve: async () => ({ value: 'something-else' }),
        },
        writeFile: async () => { throw new Error('the patch must not be written when the store did not confirm') },
      }),
      /did not resolve to the stored value/,
    )
    // The plaintext line is still in the file: the removal never happened.
    const after = readFileSync(patchPath, 'utf8')
    assert.ok(after.includes('apiKey: sk-fake-deepinfra-value'))
    assert.ok(after.includes('apiKey: ex-fake-exaone-value'))
    // The store write for the FIRST ref happened, and the loop stopped at the
    // first confirmation that failed — a ref is never left half-migrated.
    assert.deepEqual(calls.map((call) => call[1]), ['DEEPINFRA_API_KEY'])
    assert.equal(written.length, 1)
    // A backup exists and is owner-only.
    const backup = readdirSync(dir).find((name) => name.includes('.bak.'))
    assert.ok(backup !== undefined, 'the backup must exist before any write')
    assert.equal(statSync(join(dir, backup)).mode & 0o777, 0o600)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
})

test('an empty plan is a no-op that touches nothing', async () => {
  const report = await runPlaintextKeyMigration({
    patchPath: '/nonexistent/cordis.patch.yml',
    plan: [],
    store: { set: async () => { throw new Error('must not write') }, resolve: async () => undefined },
    writeFile: async () => { throw new Error('must not write') },
  })
  assert.deepEqual(report.migrated, [])
  assert.equal(report.backupPath, undefined)
})
