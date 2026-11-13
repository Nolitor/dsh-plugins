# Custom Router — Active Roadmap

<!-- skeleton:
version: 1.0
kind: plan
status: active
updated: 2026-11-14
summary: The only active roadmap for @nolit/dsh-custom-router at 0.0.1-rc.20. Old Phase/Step plans are closed or superseded and live in ROADMAP-ARCHIVE.md; this file keeps P0 security, P1 operating verification, and P2 backlog items with a planning intent and a completion criterion each.
-->

> This is the **only** document that lists active work. Historical phases are in
> [ROADMAP-ARCHIVE.md](./ROADMAP-ARCHIVE.md); current state and next actions are in
> [HANDOFF.md](./HANDOFF.md). Do not execute a Phase/Step list from an older design doc.

## 1. What the router is now (the context that makes old phases obsolete)

- **One package owns the whole route.** `@nolit/dsh-custom-router@0.0.1-rc.20` contains the
  dashboard, the preset registry, the shared stream pipe and four **vendored** adapters
  (Antigravity, OpenCode, DeepInfra, EXAONE). The old multi-package absorption phases no longer
  describe a plan; they describe history.
- **One preset registry, derived.** `lib/presets.js` `PRESETS` is the declaration; `lib/preset-derive.js`
  derives browser facts, `lib/client.src.js` builds `MODEL_PRESETS`, and the host seam
  `lib/index.js` publishes `presetSettings`. The old "two registries / five hand-written places"
  model is superseded.
- **One shared stream pipe.** `lib/stream/` normalizes every provider; vendors bind through
  `stream-contract.js`. `verify:stream` proves the core runs with zero vendor loads. OpenCode still
  defaults its request path to `pipe: 'legacy'`; the shared path exists and is test-proven.
- **Specs and conformance are part of the product.** `specs/` holds the protocol/provider/pricing
  registry, `verify-specs` enforces freshness, `build-spec-matrix` generates the compatibility
  matrix, `spec:watch` reports upstream changes manually, and `test/conformance/` replays one
  OpenAI-completions fixture through three bindings.
- **Four live presets** are registered: Antigravity, OpenCode, DeepInfra, EXAONE. EXAONE is enabled
  in the live profile and currently free after application.
- **The picker lists served routes only.** The synthetic `OpenCode (config default)` row is gone
  from the OpenCode provider group (closed this session; evidence in
  [ROADMAP-ARCHIVE.md](./ROADMAP-ARCHIVE.md) §2).

## 2. P0 — immediate / security

### P0-1. Rotate the DeepInfra and EXAONE API keys

- **Status:** **owner-only, still open.** No agent action can close this one.
- **Why:** the two live values were printed into a session's tool transcript during measurement.
  A key that has appeared in a log/transcript must be treated as disclosed; the plaintext profile is
  a second exposure.
- **Done when:** both keys are revoked at the provider, replacements are issued, the old values
  return 401 on their routes, and the replacements are stored per P0-2.

### P0-2. Move both keys into the DSH credential store (policy D5)

- **Status:** **agent side DELIVERED and live-verified for DeepInfra**; the owner side (the rotation
  itself) is open.
- **Why:** the two plaintext `apiKey:` values were in the live profile
  (`~/.dsh/profiles/web/cordis.patch.yml`); the store already holds refs for other providers, so this
  is a normalization, not a new mechanism.
- **Agent side — DELIVERED 2026-11-14 (rc.20):** the seam is measured (`~/.dsh/.credentials.yaml`
  `refs:`/`records:`, read via `ctx.credentials.resolve(ref)`) and both vendored presets declare a
  `credentialRef` (`DEEPINFRA_API_KEY` / `EXAONE_API_KEY`), resolve it at mount and re-resolve on
  `credentials/reference-updated`, with the precedence `explicit apiKey → store ref → env` pinned by
  pure tests (`keyPrecedence`). Full runbook: [CREDENTIAL-STORE-MIGRATION.md](./CREDENTIAL-STORE-MIGRATION.md).
  The router now migrates a plaintext key **by itself**, at mount, when its own live config still
  carries one (`lib/credential-migration.js`; `lib/index.js` → `migratePlaintextKeysAtMount`). The
  order is the safety property: back up (0600) → write the value into the store → **confirm** the
  ref resolves back to the same value → only then replace the plaintext line with `credentialRef:`.
  A failure at any step leaves the plaintext line in place and logs a warning naming the **ref**,
  never a value. A one-shot script (`scripts/migrate-plaintext-keys.mjs --dry-run|--apply`) performs
  the same migration without mounting the router, through the atomic YAML path.
- **Measured 2026-11-14 (applied):** `apiKey:` count in the live profile patch = **0**; the live
  patch now carries `credentialRef: DEEPINFRA_API_KEY` (line 142) and
  `credentialRef: EXAONE_API_KEY` (line 166); `~/.dsh/.credentials.yaml` (mode **0600**) holds
  `refs:` for `DEEPSEEK_API_KEY`, `OPENCODE_API_KEY`, `DEEPINFRA_API_KEY` and `EXAONE_API_KEY`
  alongside the untouched `version:`/`records:` blocks; the backup
  `cordis.patch.yml.bak.before-plaintext-key-migration-20261113-183336` exists at mode **0600**.
  The migration was executed **once**; the live rows no longer carry a plaintext key, so the mount
  hook is now a no-op on this profile.
- **Live-verified for DeepInfra (2026-11-14, post-restart):** a DeepInfra child on
  `deepseek-ai/DeepSeek-V4.1-Flash-1017` returned **`DEEPINFRA_PROBE_OK`**, no error — the store
  ref resolves at request time and the key is no longer silently empty. The service ran as
  `MainPID 284518` (started 06:10:57 KST) and its boot log carries **no credential warnings**.
  Three fixes made this true (see §4): `0b2c516` (read the ref through the inject-free accessor),
  `6388397` (deferred injection instead of a mount-time resolve), and the rc.20 migration itself.
- **Owner side — remaining:** **rotate the FOUR keys.** The store's `refs:` **values** were printed
  into a session transcript by a worker, so **all four** refs must be treated as disclosed — not
  only the two this item covers:
  - `DEEPSEEK_API_KEY`, `OPENCODE_API_KEY` (pre-existing store refs),
  - `DEEPINFRA_API_KEY`, `EXAONE_API_KEY` (the two migrated here).

  Rotate each at its provider, paste the replacement into `refs:` in `~/.dsh/.credentials.yaml`
  (the store is hot — the provider watches the file, so a rotated value reaches the next request
  **without a restart**), then **restart once** and verify **one turn per key** (deepseek, opencode,
  deepinfra, exaone).
- **Done when:** all four refs resolve to freshly rotated values, no plaintext `apiKey:` remains in
  the profile, a live turn on each of the four routes succeeds after the owner-approved restart, and
  `verify:presets` / `verify:refresh` stay green.

### P0-3. Secret hygiene check around the migration

- **Status:** open; read-only worker recipe, blocked on the rotation.
- **Why:** the `specs/` and `.watch-cache/` surfaces must never retain provider secrets; the
  conformance fixtures and docs must stay value-free.
- **Done when:** a scan of `specs/`, `docs/`, `test/` and the watch lock shows no key/token values,
  `.watch-cache/` remains git-ignored, and the migration left no plaintext copy in the repo or the
  handoff.

## 3. P1 — short-term operation and verification

Closed P1 items (P1-2 Antigravity multi-turn on Claude+Gemini, P1-4 pricing re-verification, P1-5
`spec:watch` baseline age, P1-6 four-preset smoke check) are **done** and moved to
[ROADMAP-ARCHIVE.md](./ROADMAP-ARCHIVE.md) §2 with their evidence. What remains:

### P1-1. Verify an EXAONE turn through DSH itself

- **Status:** **top-level CONFIRMED WORKING by the owner**; the remaining proof is the **child** call
  from a NEW session (see P1-3).
- **Why:** EXAONE has a direct API check and a mounted preset, but no real model turn through the
  running DSH session. A provider can be registered and still fail on message projection, tools or
  usage.
- **Measured 2026-11-14:** a child call with `exaone/k-exaone_v2.5` is refused by the host before any
  model request: `child LLM route "exaone/k-exaone_v2.5" is not allowed for this Session`
  (`subagent/model-selection-policy.allowedModels` does not list it). The route therefore cannot be
  exercised from a child; only a **top-level** session on that model can prove it.
- **Confirmed 2026-11-14 (owner):** a **top-level** EXAONE turn works — the owner ran it and
  confirmed the route end to end. The item therefore no longer needs a top-level proof.
- **Done when:** one fresh top-level session (owner) completes a Korean prompt through
  `exaone/k-exaone_v2.5`, with tool calling and reasoning/usage recorded, and the result is noted in
  the handoff. **Met for the top-level path.**
- **Measured 2026-11-14:** EXAONE registers only `registerAdapter` — it has no subagent provider, so
  a child route needs both the allowlist entry (P1-3) and the host's in-process spawn/fork provider;
  the router cannot guarantee the latter. Top-level is the supported proof today.

### P1-3. Decide EXAONE's place in the subagent allowlist

- **Status:** the allowlist is **applied live (7 routes) and in the repo default**; the remaining
  proof is a **child** call from a **NEW** session — still owner-gated.
- **Why:** a subagent call with `exaone/k-exaone_v2.5` was refused (measured message above). If EXAONE
  is meant to be a cheap worker route, this is a live configuration gap, not a model bug.
- **Measured 2026-11-14 (surface audit, T16):** the surface matrix is
  `antigravity` = subagent provider + CLI worker + tools/command; `opencode` = subagent provider +
  CLI worker + tool/command; `deepinfra` and `exaone` = **model routes only** (they call
  `registerAdapter` and nothing else — no provider, no tool, no command, so declaring one would
  invent a surface the code cannot serve).
- **Agent side — APPLIED 2026-11-14 (rc.20):** the owner approved the live edit, so it was applied
  at `~/.dsh/profiles/web/cordis.patch.yml:63-64` — the live allowlist now holds **7** routes
  (antigravity×3, opencode-http-agent×2, deepinfra×1, **exaone×1**). The **repo-side default** was
  added in the same run so a fresh profile includes it: this package's `cordis.patch.yml` states the
  `subagent-model-selection-settings` row with the same 7 routes, and `lib/allowlist.js` holds the
  list as data; `test/allowlist.test.mjs` pins the two homes against each other (the YAML is parsed
  with the HOST's own parser). A bundle layer applies BEFORE the profile's own patch and a patch
  REPLACES a row's whole config, so an operator's list still wins wholesale.
- **Measured 2026-11-14 (why the child proof is still open):** the host freezes a Session's
  allowlist at `agent/created`, and a **child inherits the parent's** frozen list. The live patch row
  and the repo default both carry **7** routes, and 8 Sessions created 04:25–04:37 KST carry that
  7-route list — but the probe children created 06:11–06:20 KST (after the 06:10:57 restart) are
  children of a top-level Session created **01:08:57 KST**, before the 7-route edit, so they carry
  the **6-route** list without `exaone/k-exaone_v2.5`.
- **Owner side — remaining:** rotate the keys (P0-2 / P0-1), **restart once**, then start a **NEW
  top-level session** — the allowlist freezes at `agent/created`, so an existing session keeps the
  old list — and verify a **child** on `exaone/k-exaone_v2.5`. Note the measured caveat from P1-1:
  EXAONE registers only `registerAdapter` — it has no subagent provider — so a CHILD route needs the
  host's in-process spawn/fork provider as well; **top-level is the supported proof today** (and the
  top-level turn already works).
- **Done when:** the owner either verifies a child on `exaone/k-exaone_v2.5` from a new session, or
  records that EXAONE is top-level-only and withdraws the "use EXAONE for chores" instruction.

## 4. P2 — backlog, hold, owner-gated

### P2-1. A data-only “install a preset” path

- **Status:** **not started.**
- **Why:** adding a provider still requires a vendor package, a `PRESETS` declaration, the
  hand-authored `ROUTER_PROVIDERS`/`PICKER_ITEMS` entries, three locales, package exports and
  `specs/{providers,pricing}`. The router's stated advantage is preset updatability; a generic
  OpenAI-compatible vendor would make EXAONE/DeepInfra/OpenRouter-style routes data, not code.
- **Done when:** a new OpenAI-compatible provider can be enabled by declaration + key + model, with
  no new adapter code, and the drift gate covers its tab, credential field and usage row.

### P2-2. Flip OpenCode's `pipe: 'shared'` default

- **Status:** **not started.**
- **Why:** the shared path is implemented and test-proven, but the default remains `legacy`; two
  stream implementations still exist in the serving path.
- **Done when:** one owner-verified live turn runs with `pipe: 'shared'`, the legacy path is either
  removed or kept as a documented fallback, and `verify:stream` stays green.

### P2-3. Canonical parser (the only genuinely unstarted Phase F item)

- **Status:** **not started.**
- **Why:** `vendor/opencode/lib/http.js` hardcodes `parser: 'legacy'`; the canonical parser is not
  implemented. Without it, the “one protocol standard” claim is incomplete for OpenCode.
- **Done when:** a canonical parser exists behind a config seam, parity fixtures cover it, and the
  prose/glyph/`content_filter` gates named in the old Phase F are measurable.

### P2-5. S3 — Antigravity usage per model group

- **Status:** **not started; owner deferred on 2026-11-08.**
- **Why:** the account reports Gemini / Claude·GPT / Argon separately; the dashboard flattens them
  into one window set, hiding which family is exhausted.
- **Done when:** the card renders one section per group with the existing 5h → weekly → monthly
  order inside each group.

### P2-6. S4 — spec-only surfaces

- **Status:** **not started; blocked on owner approval.**
- **Why:** `OPENCODE-CONSOLE-SINGLE-PRESET-SPEC.md` names six unimplemented pieces
  (`entry.isolate`, Console window bridge, four-wire catalog reader, `usage.billing.limits`, cost
  shape adapter, Track-B consent card). They are real product gaps but not required for the current
  serving path.
- **Done when:** the owner approves the surface and the six items land behind their own gates.

### P2-8. EXAONE static catalog → live catalog (when the platform adds one)

- **Status:** **not started; waits on the platform.**
- **Why:** EXAONE documents one chat model and no listing endpoint, so the model row is static; a new
  EXAONE model would require a code edit.
- **Done when:** if/when `GET /v1/models` (or an equivalent) exists, the provider reads it with a
  TTL and the static row becomes a fallback.

## 5. Recently fixed (rc.20, same session)

Three code-only fixes, all found by live probing after the rc.20 migration; the full evidence is in
[CHANGELOG.md](../CHANGELOG.md) §"0.0.1-rc.20 (cont. 2)".

| Commit | What was wrong | Fix | Evidence |
|---|---|---|---|
| `0b2c516` | the credential ref was read as `ctx.credentials`; both presets inject only `llm`, so cordis threw `cannot get property "credentials" without inject` (cordis:1257) and the `try/catch` silently returned `''` | read it through the **inject-free accessor** `ctx.get('credentials')` (cordis:1345) | vendor deepinfra / exaone |
| `642ee06` | a replayed Gemini `functionCall.args` carried a key the tool declaration does not declare (live: `sandbox_permissions` on a `write` call, session `2a16c3bb` turn 1 step 14) → Google answered `HTTP 400 "Request contains an invalid argument."` | `declaredArguments()` + `pruneArguments()` — only declared keys are replayed | antigravity suite **190 → 193** |
| `6388397` | the store ref was resolved once at mount, but `ctx.get(name, strict)` returns `undefined` while the provider fiber is activating (live: `HTTP 401: missing API key` on a DeepInfra child) | `strict=false` + `ctx.inject(['credentials'], …)` deferred resolution + refresh on `credentials/reference-updated` | vendor deepinfra / exaone |

**Live verification (2026-11-14, post-restart):** DeepInfra child
`deepseek-ai/DeepSeek-V4.1-Flash-1017` → `DEEPINFRA_PROBE_OK`, no error. Gemini child
`gemini-4-hydrogen` → two consecutive requests, the second a replay carrying `sandbox_permissions`
→ `GEMINI_OK_3` / `GEMINI_OK_3B` / `TWO_REQUESTS_OK`, no HTTP 400. Service `MainPID 284518`,
started 06:10:57 KST; the boot log carries no credential warnings. **An EXAONE *child* call is still
UNVERIFIED** (the probing session froze its allowlist at `agent/created`); the **top-level** EXAONE
turn works, confirmed by the owner.

## 6. Order

1. **P0-1/P0-2** (owner key rotation of **all four** refs; the credential-store migration itself is
   applied and live-verified for DeepInfra) — owner-gated.
2. **P1-1/P1-3** — owner restart once after the rotation, then a **new** top-level session and the
   EXAONE **child** turn. Top-level EXAONE is already confirmed working.
3. **P2** in the listed order; P2-1 and P2-2 are the natural next architecture moves. P2-4 is now
   split into Anthropic and Google fixtures (a single worker ran out of context doing both).

## 7. Evidence

Current gates (measured 2026-11-14, after rc.20 and the three fixes): router `npm test` **649/649**,
`npm run verify` exit 0 (check + 649 tests + `verify:stream` + `specs:check` — `5 protocols, 4
providers, 4 pricing` — OK), `verify:presets` OK (`OK: preset declarations, the browser registry,
the locales and the runtime registries all agree`; runtime providers `deepseek-account, antigravity,
deepinfra, deepinfra-anthropic, exaone, opencode-http-agent`). Vendor suites: antigravity **193/193**
(+3 from `642ee06`), deepinfra **222 pass / 7 skip** (229 total), opencode **555/555**, exaone
**19/19**.

The **synthetic `OpenCode (config default)` row** is closed: it was produced in
`vendor/opencode/lib/http.js` (the `models` config default and the `listModels` prepend) and in
`vendor/opencode/lib/provider.js` (same two places). Both are removed; the `default` pseudo-route
still resolves server-side to `defaultModel`, and that behaviour is unchanged. Producer grep count
for the label is **0**; `test/model-catalog-default-row.test.mjs` (4 tests) asserts the absence in
the config default, the discovered list and the fallback list, and the vendor test
`listModels hides routes outside enabledModels and never lists the synthetic default row` now
asserts absence too.
