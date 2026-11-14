import test from "node:test"
import assert from "node:assert/strict"

/**
 * The engine-version, upstream-check and side-call-model surfaces.
 *
 * Three properties are worth defending here:
 *
 *   1. The upstream comparison never lies. An unreachable network is "could not check", never
 *      "out of date" — a cost optimizer that cries wolf gets ignored, and a real update then
 *      goes unnoticed.
 *   2. The engine's identity is the pinned commit, because the engine carries no version
 *      string of its own.
 *   3. A side-call model is a `provider/model` string, and a string that cannot name both is
 *      refused at the boundary instead of being written and silently ignored.
 */
import {
  checkUpstream,
  readEngineIdentity,
  versionFromDescribe,
  fetchJson,
  pluginVersion,
  PINNED_SHA,
  UPSTREAM_REPO,
} from "../lib/upstream.js"
import {
  validateModel,
  readModelSlots,
  buildReadPayload,
  createSettingsRoutes,
  CONFIG_PATH,
  UPSTREAM_PATH,
  MODELS_PATH,
} from "../lib/settings-api.js"

/** Collect the routes `createSettingsRoutes` registers, without a host. */
function capture () {
  const routes = new Map()
  const register = (method, path, handler) => routes.set(method + " " + path, handler)
  return { routes, register }
}

/** A fetch that answers with one JSON body. */
function fakeFetch (body, status = 200) {
  return async () => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  })
}

test("the version label is derived from the tag history, because the engine carries none", () => {
  // Measured: the engine tree has no `__version__` and no VERSION file, and `te --version` is
  // not a valid invocation — the CLI requires a subcommand.
  assert.equal(versionFromDescribe("v0.1.0-22-g6141bb9"), "v0.1.0+22.g6141bb9")
  assert.equal(versionFromDescribe("v0.1.0"), "v0.1.0")
  assert.equal(versionFromDescribe("", "6141bb92"), "unreleased+6141bb92")
  assert.equal(versionFromDescribe(null, "6141bb92"), "unreleased+6141bb92")
  assert.equal(versionFromDescribe(""), "unknown")
  assert.equal(versionFromDescribe(null), "unknown")
})

test("a checkout with no tag still names itself, because the commit IS the identity", () => {
  // Measured 2026-11-15: `git describe --tags` FAILS on the isolated vendored tree ("No tags
  // can describe ..."), because a filtered clone of one commit carries no tags. The answer must
  // not be "unknown" — the short commit id names the exact engine.
  const identity = readEngineIdentity({
    root: "/state",
    sha: PINNED_SHA,
    probe: {
      exists: () => true,
      head: () => PINNED_SHA,
      describe: () => null,
    },
  })
  assert.equal(identity.describe, null)
  assert.equal(identity.version, "unreleased+" + PINNED_SHA.slice(0, 8))
  assert.equal(identity.patchApplied, true)
})

test("the engine identity reads the pinned commit, the launchers and the version", () => {
  const identity = readEngineIdentity({
    root: "/state",
    sha: PINNED_SHA,
    probe: {
      exists: (path) => path === "/state/bin/te" || path === "/state/bin/te-hook",
      head: () => PINNED_SHA,
      describe: () => "v0.1.0-22-g6141bb9",
    },
  })
  assert.equal(identity.pinned, PINNED_SHA)
  assert.equal(identity.installed, PINNED_SHA)
  assert.equal(identity.installedShort, PINNED_SHA.slice(0, 8))
  assert.equal(identity.version, "v0.1.0+22.g6141bb9")
  assert.equal(identity.patchApplied, true)
  assert.equal(identity.launchers.te, true)
  assert.equal(identity.launchers.hook, true)
  assert.match(identity.detail, /pinned commit/)
})

test("the identity carries the PLUGIN's own version beside the engine's", () => {
  // Measured 2026-11-15: the card showed only the upstream engine's tag (`v0.1.0`) under a
  // heading that did not say whose version it was, and the operator read it as the plugin's
  // version. The plugin is `0.0.1-rc.N`; the engine's tag belongs to microsoft/TokenEconomizer.
  // Both must be present and separately named.
  const identity = readEngineIdentity({
    root: "/state",
    sha: PINNED_SHA,
    probe: { exists: () => true, head: () => PINNED_SHA, describe: () => "v0.1.0-22-g6141bb9" },
  })
  assert.equal(identity.pluginVersion, pluginVersion())
  assert.match(identity.pluginVersion, /^0\.0\.1-rc\.\d+$/, 'the plugin version is this track\'s own')
  assert.notEqual(identity.pluginVersion, identity.version, 'the two versions must differ')
  assert.equal(pluginVersion(), pluginVersion(), 'the plugin version is stable')
})

test("a missing vendored tree is reported, not guessed", () => {
  const identity = readEngineIdentity({
    root: "/state",
    sha: PINNED_SHA,
    probe: { exists: () => false, head: () => null, describe: () => null },
  })
  assert.equal(identity.installed, null)
  assert.equal(identity.patchApplied, false)
  assert.equal(identity.version, "unknown")
  assert.match(identity.detail, /missing/)
})

test("a checkout that moved away from the pin is not the engine this package patched", () => {
  const identity = readEngineIdentity({
    root: "/state",
    sha: PINNED_SHA,
    probe: {
      exists: () => true,
      head: () => "0123456789abcdef0123456789abcdef01234567",
      describe: () => "v0.2.0",
    },
  })
  assert.equal(identity.patchApplied, false)
  assert.match(identity.detail, /not the pinned/)
})

test("the upstream comparison says the pin is the head when it is", async () => {
  const answer = await checkUpstream({
    sha: "abc123",
    fetchImpl: async (url) => {
      if (url.includes("/releases/latest")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ tag_name: "v0.1.0", html_url: "u" }) }
      }
      if (url.includes("/commits/")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ sha: "abc123", commit: { committer: { date: "d" }, message: "m" } }) }
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ behind_by: 0, ahead_by: 0, files: [] }) }
    },
  })
  assert.equal(answer.ok, true)
  assert.equal(answer.upToDate, true)
  assert.equal(answer.updateAvailable, false)
  assert.equal(answer.latestRelease, "v0.1.0")
  assert.equal(answer.repo, UPSTREAM_REPO)
  assert.match(answer.detail, /is the upstream branch head/)
})

test("the upstream comparison counts the commits the pin trails", async () => {
  const answer = await checkUpstream({
    sha: "abc123",
    fetchImpl: async (url) => {
      if (url.includes("/releases/latest")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ tag_name: "v0.2.0" }) }
      }
      if (url.includes("/commits/")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ sha: "def456", commit: { committer: { date: "d" }, message: "m" } }) }
      }
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          behind_by: 0,
          ahead_by: 7,
          files: [{ filename: "a.py", status: "modified", changes: 3 }],
        }),
      }
    },
  })
  assert.equal(answer.ok, true)
  assert.equal(answer.upToDate, false)
  assert.equal(answer.updateAvailable, true)
  assert.equal(answer.commitsAhead, 7)
  // The number the operator reads is how far the HEAD is AHEAD of the pin. Measured 2026-11-15
  // against the live upstream: `behind_by` was 0 and `ahead_by` was 110, so reading `behind_by`
  // would have said "the pin is current" while the head had moved 110 commits past it.
  assert.equal(answer.commitsBehind, 7)
  assert.equal(answer.changedFiles.length, 1)
  assert.match(answer.detail, /7 commit\(s\) ahead/)
})

test("the commit distance is the head's lead over the pin, not the pin's lead", async () => {
  // The compare API's `behind_by` counts the commits the PIN has and the head does not. The
  // question "how far behind is my pin" is answered by `ahead_by`. A regression here would
  // report "up to date" while the head had moved on.
  const answer = await checkUpstream({
    sha: "abc123",
    fetchImpl: async (url) => {
      if (url.includes("/releases/latest")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ tag_name: "v0.1.0" }) }
      }
      if (url.includes("/commits/")) {
        return { ok: true, status: 200, text: async () => JSON.stringify({ sha: "def456", commit: { committer: { date: "d" }, message: "m" } }) }
      }
      return { ok: true, status: 200, text: async () => JSON.stringify({ behind_by: 0, ahead_by: 110, files: [] }) }
    },
  })
  assert.equal(answer.commitsAhead, 110)
  assert.equal(answer.commitsBehind, 110)
  assert.equal(answer.updateAvailable, true)
  assert.match(answer.detail, /110 commit\(s\) ahead/)
})

test("an unreachable upstream is 'could not check', never 'out of date'", async () => {
  const answer = await checkUpstream({
    sha: "abc123",
    fetchImpl: async () => { throw new Error("getaddrinfo ENOTFOUND api.github.com") },
  })
  assert.equal(answer.ok, false)
  // The distinction that matters: the update state is UNKNOWN, not "an update exists".
  assert.equal(answer.updateAvailable, null)
  assert.equal(answer.upToDate, false)
  assert.equal(answer.errors.length, 3)
  assert.match(answer.detail, /unknown/)
})

test("a GitHub rate limit is reported as the upstream's own reason", async () => {
  const answer = await checkUpstream({
    sha: "abc123",
    fetchImpl: fakeFetch({ message: "API rate limit exceeded" }, 403),
  })
  assert.equal(answer.ok, false)
  assert.match(answer.errors.join(" "), /rate limit/)
})

test("an unreadable upstream answer is a failure, not a crash", async () => {
  const answer = await fetchJson("https://example.invalid", {
    fetchImpl: async () => ({ ok: true, status: 200, text: async () => "not json" }),
  })
  assert.equal(answer.ok, false)
  assert.match(answer.error, /unreadable/)
})

test("a side-call model must name both a provider and a model", () => {
  assert.deepEqual(validateModel("model.microskills", "deepseek-account/deepseek-flash"), {
    ok: true,
    value: "deepseek-account/deepseek-flash",
  })
  assert.deepEqual(validateModel("model.microskills", ""), { ok: true, value: "" })
  assert.equal(validateModel("model.microskills", "deepseek-flash").ok, false)
  assert.equal(validateModel("model.microskills", "/deepseek-flash").ok, false)
  assert.equal(validateModel("model.microskills", "deepseek-account/").ok, false)
  assert.equal(validateModel("not_a_slot", "a/b").ok, false)
})

test("a side-call model slot never collides with a mechanism mode", async () => {
  // The engine's `microskills` key is the MODE (`envfacts+distiller`), and the model slot for
  // the same mechanism is a different setting. Both travel in one `set` object on the write
  // path, so their names must not be able to collide.
  const routes = new Map()
  const register = (method, path, handler) => routes.set(method + " " + path, handler)
  let written = []
  const runEngine = async (kind, args) => {
    if (kind === "show") {
      return {
        stdout: JSON.stringify({ enabled: true, other: { microskills_model: "p/m" }, warnings: [] }),
        stderr: "",
        code: 0,
      }
    }
    written.push((args ?? []).join(" "))
    return { stdout: "ok", stderr: "", code: 0 }
  }
  createSettingsRoutes({ runEngine, register })
  const handler = routes.get("POST " + CONFIG_PATH)
  const response = await handler({
    json: async () => ({
      set: {
        // The MODE and the MODEL SLOT, in one batch.
        microskills: "envfacts",
        "model.microskills": "deepseek-account/deepseek-flash",
      },
    }),
  })
  const body = await response.json()
  assert.equal(body.ok, true)
  assert.equal(body.results.length, 2)
  // The mode wrote the mode key; the slot wrote the model key. Neither wrote the other's.
  assert.ok(written.includes("microskills=envfacts"), written.join(" | "))
  assert.ok(written.includes("microskills_model=deepseek-account/deepseek-flash"), written.join(" | "))
})

test("the stored side-call models are read from the engine's own keys", () => {
  const index = new Map([
    ["microskills_model", "deepseek-account/deepseek-flash"],
    ["loopguard_model", "exaone/k-exaone_v2.5"],
  ])
  const slots = readModelSlots(index)
  assert.equal(slots.microskills, "deepseek-account/deepseek-flash")
  assert.equal(slots.loopguard, "exaone/k-exaone_v2.5")
  // The default slot names no engine key: it IS the deployment's own route.
  assert.equal(slots.default, "")
})

test("the read payload carries the side-call model slots", () => {
  const payload = buildReadPayload({ other: { microskills_model: "p/m" } }, {})
  assert.equal(payload.ok, true)
  assert.equal(payload.modelSlots.microskills, "p/m")
  assert.equal(payload.modelSlots.loopguard, "")
  assert.equal(payload.modelSlots.default, "")
})
test("the upstream route answers 200 even when the upstream is unreachable", async () => {
  const { routes, register } = capture()
  const runEngine = async (kind) => (kind === "show" ? JSON.stringify({}) : JSON.stringify({ ok: true }))
  createSettingsRoutes({
    runEngine,
    register,
    upstreamCheck: async () => ({ ok: false, errors: ["release: offline"], detail: "the upstream could not be reached" }),
  })
  const handler = routes.get("GET " + UPSTREAM_PATH)
  const response = await handler({})
  assert.equal(response.status, 200)
  const body = await response.json()
  assert.equal(body.ok, false)
  assert.equal(body.errors[0], "release: offline")
})

test("the model catalog route answers the host's own list, and nothing else", async () => {
  const { routes, register } = capture()
  const runEngine = async (kind) => (kind === "show" ? JSON.stringify({}) : JSON.stringify({ ok: true }))
  createSettingsRoutes({
    runEngine,
    register,
    modelCatalog: async () => ({
      providers: [{ id: "deepseek-account", name: "DeepSeek Account", models: [{ id: "deepseek-flash", name: "Flash" }] }],
      failures: [],
    }),
  })
  const handler = routes.get("GET " + MODELS_PATH)
  const body = await (await handler({})).json()
  assert.equal(body.ok, true)
  assert.equal(body.providers.length, 1)
  assert.equal(body.providers[0].models[0].id, "deepseek-flash")
})

test("a deployment with no model registry answers an empty list, not a guess", async () => {
  const { routes, register } = capture()
  const runEngine = async (kind) => (kind === "show" ? JSON.stringify({}) : JSON.stringify({ ok: true }))
  createSettingsRoutes({ runEngine, register })
  const handler = routes.get("GET " + MODELS_PATH)
  const body = await (await handler({})).json()
  assert.equal(body.ok, true)
  assert.deepEqual(body.providers, [])
})
