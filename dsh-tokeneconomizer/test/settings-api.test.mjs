import test from "node:test"
import assert from "node:assert/strict"
import { readFileSync } from "node:fs"

/**
 * The settings read/write seam, tested against its injected boundaries.
 *
 * `createSettingsRoutes` takes `register` and `runEngine` as arguments, so every route can be
 * driven without a live engine or a real `~/.tokeneconomizer` directory. The two properties
 * worth defending are:
 *
 *   1. Stored state and declared defaults stay separable. A page can only show "this differs
 *      from the default" if the payload keeps the three views apart.
 *   2. A partially invalid batch is not an all-or-nothing write: the valid keys land and the
 *      invalid ones come back with their own reason.
 */
import {
  SETTINGS_PATH,
  CONFIG_PATH,
  RESTORE_PATH,
  RESET_PATH,
  IMPORT_PATH,
  UPSTREAM_PATH,
  MODELS_PATH,
  MODE_VALUES,
  THRESHOLDS,
  ACTIONS,
  validateValue,
  validateModel,
  readModelSlots,
  diffAgainstDefaults,
  createSettingsRoutes,
} from "../lib/settings-api.js"

/** Collect the routes `createSettingsRoutes` registers, without a host. */
function capture () {
  const routes = new Map()
  const register = (method, path, handler) => routes.set(method + " " + path, handler)
  return { routes, register }
}

/** A minimal request whose body is the given object. */
function request (body) {
  return { json: async () => body }
}

/** Read a WHATWG Response as JSON. */
async function bodyOf (response) {
  return await response.json()
}

test("the aggregate read returns effective values, defaults and overrides separately", () => {
  const stored = {
    toolprune: {
      toolprune_evidence: 25,
      toolprune_sessions: THRESHOLDS.toolprune_sessions.def,
    },
  }

  const view = diffAgainstDefaults(stored)

  assert.equal(view.overrides.toolprune_evidence, 25)
  assert.equal(view.defaults.toolprune_evidence, undefined)
  assert.equal(view.effective.toolprune_evidence, 25)

  // The untouched key must not be reported as an override, and keeps the declared default.
  assert.equal(view.overrides.toolprune_sessions, undefined)
  assert.equal(view.defaults.toolprune_sessions, THRESHOLDS.toolprune_sessions.def)
  assert.equal(view.effective.toolprune_sessions, THRESHOLDS.toolprune_sessions.def)

  // A stored override is distinguishable from the default it replaces.
  assert.notEqual(view.effective.toolprune_evidence, THRESHOLDS.toolprune_evidence.def)
  assert.equal(THRESHOLDS.toolprune_evidence.def, 10)
})

test("a partially invalid batch applies the valid keys and reports the invalid one", async () => {
  const { routes, register } = capture()
  const calls = []
  const persisted = { toolprune_evidence: 25 }
  const runEngine = async (kind, args) => {
    calls.push({ kind, args })
    if (kind === "show") return JSON.stringify({ toolprune: { ...persisted } })
    return JSON.stringify({ ok: true })
  }
  createSettingsRoutes({ runEngine, register })

  const handler = routes.get("POST " + CONFIG_PATH)
  assert.equal(typeof handler, "function")

  const response = await handler(request({
    set: { toolprune_evidence: 25, "loopguard.judge_confidence": 5 },
  }))
  const body = await bodyOf(response)

  const sets = calls.filter((call) => call.kind === "set")
  assert.deepEqual(sets.map((call) => call.args), [["toolprune_evidence=25"]])

  const byKey = Object.fromEntries(body.results.map((result) => [result.key, result]))
  assert.equal(byKey.toolprune_evidence.ok, true)
  assert.equal(byKey.toolprune_evidence.value, 25)
  assert.equal(byKey["loopguard.judge_confidence"].ok, false)
  assert.equal(typeof byKey["loopguard.judge_confidence"].error, "string")
  assert.match(byKey["loopguard.judge_confidence"].error, /at most 1/)

  // The batch as a whole is not a failure: the valid key did land.
  assert.equal(body.ok, true)
  assert.equal(response.status, 200)
})

test("an engine rejection surfaces the engine reason verbatim", async () => {
  const { routes, register } = capture()
  const reason = "value out of range: backstop_mult"
  const runEngine = async (kind) => {
    if (kind === "show") return JSON.stringify({})
    return { ok: false, code: 1, stdout: "", stderr: reason }
  }
  createSettingsRoutes({ runEngine, register })

  const handler = routes.get("POST " + CONFIG_PATH)
  const response = await handler(request({ set: { "loopguard.backstop_mult": 2.5 } }))
  const body = await bodyOf(response)

  const result = body.results[0]
  assert.equal(result.key, "loopguard.backstop_mult")
  assert.equal(result.ok, false)
  assert.equal(result.error, reason)
  assert.equal(body.ok, false)
  assert.equal(response.status, 400)
})

test("history_import is a plugin action, not an engine config key", () => {
  assert.equal(ACTIONS.includes("history_import"), true)

  // The whole-engine grep for this name returns zero hits: it must never be posted as a config
  // key, and no mode list may grow to accept it.
  assert.equal(Object.hasOwn(THRESHOLDS, "history_import"), false)
  assert.equal(THRESHOLDS.history_import, undefined)
  for (const values of Object.values(MODE_VALUES)) {
    assert.equal(values.includes("history_import"), false)
  }
  for (const spec of Object.values(THRESHOLDS)) {
    assert.notEqual(spec.key, "history_import")
  }
})

test("route paths and engine keys are frozen constants", () => {
  assert.equal(Object.isFrozen(THRESHOLDS), true)
  for (const spec of Object.values(THRESHOLDS)) assert.equal(Object.isFrozen(spec), true)

  // ESM modules are strict, so a frozen-object write is a TypeError, not a silent no-op.
  const before = JSON.stringify(THRESHOLDS)
  assert.throws(() => {
    THRESHOLDS.toolprune_evidence = { key: "toolprune_evidence", type: "int", min: 1, max: null, def: 999 }
  }, TypeError)
  assert.throws(() => {
    THRESHOLDS.not_a_real_key = Object.freeze({ key: "not_a_real_key", type: "int", min: 1, max: null, def: 1 })
  }, TypeError)
  assert.throws(() => {
    THRESHOLDS.toolprune_evidence.def = 999
  }, TypeError)

  assert.equal(THRESHOLDS.toolprune_evidence.def, 10)
  assert.equal(Object.hasOwn(THRESHOLDS, "not_a_real_key"), false)
  assert.equal(JSON.stringify(THRESHOLDS), before)
})

test("validateValue rejects an out-of-range float and coerces a valid int", () => {
  const tooHigh = validateValue("loopguard.judge_confidence", 5)
  assert.equal(tooHigh.ok, false)
  assert.match(tooHigh.error, /at most 1/)

  const coerced = validateValue("toolprune_evidence", "25")
  assert.deepEqual(coerced, { ok: true, value: 25 })
  assert.equal(typeof coerced.value, "number")

  // The posted string is not the stored value; the coerced number is.
  assert.equal(validateValue("toolprune_evidence", "25").value, 25)
  assert.equal(validateValue("toolprune_evidence", "").ok, false)
})

test("every route path is distinctive and prefixed", () => {
  const paths = [SETTINGS_PATH, CONFIG_PATH, RESTORE_PATH, RESET_PATH, IMPORT_PATH, UPSTREAM_PATH, MODELS_PATH]
  const prefix = "/api/local/tokeneconomizer/settings"
  for (const path of paths) assert.equal(path.startsWith(prefix), true)
  assert.equal(new Set(paths).size, paths.length)
  assert.equal(SETTINGS_PATH, prefix)

  const { routes, register } = capture()
  const runEngine = async (kind) => (kind === "show" ? JSON.stringify({}) : JSON.stringify({ ok: true }))
  createSettingsRoutes({ runEngine, register })

  // Eight registrations: the seven listed paths, with the import job's read sharing
  // IMPORT_PATH because DSH exact Fetch routes reject a `:param` path segment (measured). The
  // job id therefore travels as `?jobId=`.
  assert.equal(routes.size, 8)
  for (const route of routes.keys()) {
    const path = route.slice(route.indexOf(" ") + 1)
    assert.equal(path.startsWith(prefix), true, route + " escapes the settings namespace")
    assert.equal(path.includes(":"), false, route + " uses a path placeholder DSH rejects")
  }
  assert.equal(routes.has("GET " + IMPORT_PATH), true)
})

test("REGRESSION GATE: the settings engine calls name the repository explicitly", () => {
  // Measured 2026-11-15: the engine keys its per-repository config by the directory it is
  // asked about. The settings page's `runEngine` did NOT pass `--cwd`, so the engine used the
  // HOST PROCESS's working directory — the web profile's cwd is `~/.dsh` — and a save from
  // the settings page landed in `repos/deepseek-harness-bbcdb118d8/config.json` while the
  // operator's own repository (`repos/dsh-plugins-4806902e1d/config.json`) kept its old
  // value. The page then read the same wrong bucket and showed the old value again: the
  // setting looked like it "reverted to the default" on every save.
  //
  // The fix names ONE directory explicitly: this package's own directory, which is the
  // repository the plugin operates on.
  const source = readFileSync(new URL('../lib/index.js', import.meta.url), 'utf8')
  assert.match(
    source,
    /\['--cwd',\s*settingsCwd\(\),\s*'config'/,
    "the engine call must pass --cwd, or the write lands in the host's repository",
  )
  assert.match(source, /function packageDir \(\)/, 'the package directory must be resolvable')
  // The resolver must name the PACKAGE root, not its parent: `new URL('..', import.meta.url)`
  // already resolves to the package root, and a `dirname` on top would climb one level too
  // far and file the configuration under the workspace.
  const packageDir = source.slice(source.indexOf('function packageDir ()'), source.indexOf('function packageDir ()') + 700)
  assert.match(
    packageDir,
    /fileURLToPath\(new URL\('\.\.', import\.meta\.url\)\)/,
    'the package root is the URL itself; a dirname on top climbs one level too far',
  )
  assert.equal(
    /dirname\(fileURLToPath\(new URL\('\.\.'/.test(packageDir),
    false,
    'a dirname on the resolved package URL names the package PARENT',
  )
})
