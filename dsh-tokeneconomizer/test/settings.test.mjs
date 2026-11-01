import test from "node:test"
import assert from "node:assert/strict"
import { mkdtempSync, writeFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

/**
 * The external settings file.
 *
 * Two properties matter more than any single key, because a regression in either costs
 * more than the feature is worth:
 *
 *   1. A bad file never throws. A throw inside `apply()` costs the ENTIRE plugin
 *      (measured: `warning: 1 entry did not activate`, exit code 0, no GUI banner), so
 *      fail-open is per key, never wholesale.
 *   2. The file can never admit a key the Cordis layer would reject: the strict resolver
 *      is reused as the oracle rather than restated.
 */
import { mergeSettings, readSettingsFile, SETTINGS_VERSION } from "../lib/settings.js"
import { DEFAULTS, resolveConfig } from "../lib/index.js"

const dir = mkdtempSync(join(tmpdir(), "te-settings-"))
let n = 0
/** Write one settings file and return its path. */
function fileWith(content) {
  const path = join(dir, "s" + n++ + ".json")
  writeFileSync(path, typeof content === "string" ? content : JSON.stringify(content))
  return path
}

test("a missing file yields no values and does not warn", () => {
  const warnings = []
  const out = readSettingsFile({ path: join(dir, "absent.json"), warn: (t) => warnings.push(t) })
  assert.deepEqual(out.values, {})
  assert.equal(out.present, false)
  assert.equal(warnings.length, 0, "absence is normal, not a defect")
})

test("malformed JSON fails open instead of throwing", () => {
  const warnings = []
  const out = readSettingsFile({ path: fileWith("{ not json"), warn: (t) => warnings.push(t) })
  assert.deepEqual(out.values, {})
  assert.equal(out.present, false)
  assert.equal(warnings.length, 1)
  assert.match(warnings[0], /not valid JSON/)
})

test("a non-object document is rejected wholesale", () => {
  const out = readSettingsFile({ path: fileWith([1, 2, 3]), warn: () => {} })
  assert.deepEqual(out.values, {})
  assert.match(out.problems[0], /must contain a JSON object/)
})

test("a future schema version is ignored whole, not guessed at", () => {
  const warnings = []
  const path = fileWith({ version: SETTINGS_VERSION + 1, tierHotTurns: 6 })
  const out = readSettingsFile({ path, warn: (t) => warnings.push(t) })
  assert.deepEqual(out.values, {}, "reading a newer schema with older rules inverts meaning")
  assert.match(warnings[0], /is not/)
})

test("the current version is accepted and version is not a setting", () => {
  const out = readSettingsFile({ path: fileWith({ version: SETTINGS_VERSION, tierHotTurns: 6 }), warn: () => {} })
  assert.deepEqual(out.values, { tierHotTurns: 6 })
})

test("nested objects are refused per key rather than silently flattened", () => {
  const warnings = []
  const path = fileWith({ tiering: { hotTurns: 6 }, tierHotTurns: 6 })
  const out = readSettingsFile({ path, warn: (t) => warnings.push(t) })
  assert.deepEqual(out.values, { tierHotTurns: 6 })
  assert.equal(warnings.length, 1)
})

test("file values override the composed config", () => {
  const base = resolveConfig({})
  const merged = mergeSettings(base, { tierHotTurns: 6 }, resolveConfig, () => {})
  assert.equal(merged.tierHotTurns, 6)
  assert.equal(merged.tierMinChars, base.tierMinChars, "other keys survive")
})

test("an unknown key is dropped, not fatal", () => {
  const warnings = []
  const base = resolveConfig({})
  const merged = mergeSettings(base, { notASetting: 1 }, resolveConfig, (t) => warnings.push(t))
  assert.equal("notASetting" in merged, false)
  assert.match(warnings[0], /unknown setting notASetting/)
})

test("a value the strict resolver rejects costs only that key", () => {
  const warnings = []
  const base = resolveConfig({})
  const merged = mergeSettings(base, { tierHotTurns: "six", tierMinChars: 4000 }, resolveConfig, (t) => warnings.push(t))
  assert.equal(merged.tierHotTurns, base.tierHotTurns, "rejected value keeps the composed one")
  assert.equal(merged.tierMinChars, 4000, "a valid sibling still applies")
  assert.match(warnings[0], /tierHotTurns rejected/)
})

test("an enum value outside the allowed set is rejected", () => {
  const base = resolveConfig({})
  const merged = mergeSettings(base, { watchdogAction: "kill" }, resolveConfig, () => {})
  assert.equal(merged.watchdogAction, base.watchdogAction)
})

test("a shadowing value warns, so a later Cordis change is not mysteriously ineffective", () => {
  const warnings = []
  const base = resolveConfig({ tierMinChars: 3700 })
  mergeSettings(base, { tierMinChars: 5000 }, resolveConfig, (t) => warnings.push(t))
  assert.match(warnings[0], /shadows the composed value/)
})

test("the shared DEFAULTS object is never mutated", () => {
  const before = { ...DEFAULTS }
  readSettingsFile({ path: fileWith({ tierHotTurns: 99 }), warn: () => {} })
  mergeSettings(resolveConfig({}), { tierHotTurns: 99 }, resolveConfig, () => {})
  assert.deepEqual(DEFAULTS, before)
})

test("cleanup", () => { rmSync(dir, { recursive: true, force: true }) })
