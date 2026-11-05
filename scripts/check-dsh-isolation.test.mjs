/**
 * Regression tests for scripts/check-dsh-isolation.mjs.
 *
 * The guard is the thing that keeps `dsh` launchers isolated, so its detector must be
 * tested on both directions: a real launcher is caught, and an intentionally isolated /
 * explicitly annotated launcher is not. The last test is the workspace gate itself.
 *
 * Run: node --test scripts/check-dsh-isolation.test.mjs
 */
import assert from 'node:assert/strict'
import { test } from 'node:test'

import { scanText, scanWorkspace } from './check-dsh-isolation.mjs'

const rules = (text, kind = 'js') => scanText({ file: 'fixture', text, kind }).map((v) => v.rule)

test('an unisolated dsh spawn is a violation', () => {
  assert.deepEqual(rules("spawn('dsh', ['web', '--no-open'], { stdio: 'ignore' })"), ['spawn-dsh-without-DSH_HOME'])
})

test('an unisolated engine spawn is a violation (the engine runs dsh headless)', () => {
  assert.deepEqual(
    rules("execFileSync(join(home, 'bin', 'te'), ['--host', 'dsh'], { env: { ...process.env } })"),
    ['engine-spawn-without-DSH_HOME'],
  )
})

test('a shell dsh command without DSH_HOME is a violation', () => {
  assert.deepEqual(rules('dsh web --no-open --port 0', 'sh'), ['shell-dsh-without-DSH_HOME'])
})

test('a test that pins process.env.DSH_HOME to the live home is a violation', () => {
  assert.deepEqual(rules("process.env.DSH_HOME = join(homedir(), '.dsh')"), ['process-env-pins-live-home'])
})

test('an isolated spawn passes', () => {
  assert.deepEqual(rules("spawn('dsh', ['web'], { env: { ...process.env, DSH_HOME: iso } })"), [])
  assert.deepEqual(
    rules("execFileSync(join(home, 'bin', 'te'), ['--host', 'dsh'], { env: { ...process.env, DSH_HOME: tempHome } })"),
    [],
  )
  assert.deepEqual(rules('DSH_HOME="$iso" timeout 45 dsh web --no-open --port 0', 'sh'), [])
})

test('the two escape hatches are explicit and file-scoped', () => {
  assert.deepEqual(rules("spawn('dsh', ['web'])\n// dsh-isolation: read-only-live-home"), [])
  assert.deepEqual(rules("# dsh-isolation: live-intentional\ndsh plugin --profile web add link:x", 'sh'), [])
})

test('the workspace itself is clean (this is the regression gate)', () => {
  const { violations } = scanWorkspace()
  assert.deepEqual(violations, [], 'unisolated DSH launcher(s): ' + JSON.stringify(violations, null, 1))
})
