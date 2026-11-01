import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'

/**
 * The bundle patch must stay a copy of the code defaults.
 *
 * Measured 2026-11-02: all 35 config keys currently agree between `DEFAULT_CONFIG`
 * (`lib/index.js`) and `cordis.patch.yml`, but nothing enforced it — and `tierMinChars`
 * lives in a *third* place (`lib/tiering.js`). The last value change required hand-editing
 * two files, which is exactly how a silent divergence starts.
 *
 * Why divergence is dangerous here: a patch `config` **replaces the whole config**
 * (`dsh-app-boot/lib/index.js:3261`), so any layer that sets one key drops the other 34 to
 * code defaults. If the bundle patch ever drifts from the defaults, the behaviour of a
 * profile that overrides anything becomes unspecified.
 */

const here = new URL('..', import.meta.url)
const yml = readFileSync(new URL('cordis.patch.yml', here), 'utf8')
const index = readFileSync(new URL('lib/index.js', here), 'utf8')
const tiering = readFileSync(new URL('lib/tiering.js', here), 'utf8')

/** Every `key: value` pair in the bundle patch's config block. */
function ymlConfig() {
  const out = new Map()
  for (const m of yml.matchAll(/^\s{8}([a-z][A-Za-z0-9]*):\s*(.+?)\s*$/gm)) {
    out.set(m[1], m[2].replace(/^['"]|['"]$/g, ''))
  }
  return out
}

test('the bundle patch declares a substantial config block', () => {
  const config = ymlConfig()
  assert.ok(config.size >= 30, 'expected the full config block, found ' + String(config.size) + ' keys')
})

test('tier defaults are not duplicated with different values', () => {
  // tierMinChars appears in lib/tiering.js (the source of truth), lib/index.js (which
  // derives from TIER_DEFAULTS) and cordis.patch.yml (the live value). The first two
  // are linked by code; the third is a copy and must match.
  const tierMin = /minChars:\s*(\d+)/.exec(tiering)
  assert.ok(tierMin, 'tiering.js declares minChars')
  assert.equal(ymlConfig().get('tierMinChars'), tierMin[1], 'cordis.patch.yml must mirror lib/tiering.js')

  // And index.js must derive rather than restate it.
  assert.match(
    index,
    /tierMinChars:\s*TIER_DEFAULTS\.minChars/,
    'index.js must derive tierMinChars from TIER_DEFAULTS, never a literal',
  )
})

test('hot and warm turn defaults mirror the tiering module', () => {
  const hot = /hotTurns:\s*(\d+)/.exec(tiering)
  const warm = /warmTurns:\s*(\d+)/.exec(tiering)
  assert.ok(hot && warm, 'tiering.js declares both turn boundaries')
  assert.equal(ymlConfig().get('tierHotTurns'), hot[1])
  assert.equal(ymlConfig().get('tierWarmTurns'), warm[1])
})

test('the watchdog action is legal, which --dump-config does not check', () => {
  // Measured: `--dump-config` prints `watchdogAction: 'kill'` without complaint and exits 0.
  // The validator is the only guard, so pin the live value here.
  const action = ymlConfig().get('watchdogAction')
  assert.ok(['warn', 'interrupt'].includes(action), 'unexpected watchdogAction: ' + String(action))
})
