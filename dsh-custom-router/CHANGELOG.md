# Changelog — @nolit/dsh-custom-router

<!-- skeleton:
version: 0.0.1-rc.20
kind: report
status: active
updated: 2026-11-14
summary: Engineering history for the Custom Router track: created 2026-11-06 as a specification track, extended 2026-11-07 with the OpenCodex bridge library and preset mounts, extended 2026-11-08 with the browser dashboard, the settings schema, the shared stream pipe, the browser redesign, and the owner-ordered integration of the Antigravity/DeepInfra plugins into the router vendor tree, extended 2026-11-10 with the preset-based CLI dispatch policy, extended 2026-11-12 with the two-track plan evidence contract (declared baseline plus consent-gated correction), extended 2026-11-13 with the model-serving refresh design (vendor `?refresh=1` cache bypass, a refresh button on both surfaces, one refresh bus fed by host events) and rc.15 with the preset-registry drift gate (static registry diff, `usageRoutes` on every preset, and a mutation harness that proves each drift class is rejected), and rc.17 with the `google-generative-ai` vendor wire plus JSON-Schema enums derived from their constant arrays instead of hand-copied, rc.18 with the subagent-activation contract migration that restores the `opencode`/`agy_worker` managed-child delegation on DSH 0.2.2-rc.3, and rc.19 with the living-spec gates (a 14-day age check on the manual `spec:watch` baseline, the four-preset live-route smoke gate), the vendored Antigravity fix that replays a Gemini `thoughtSignature` as a part-level sibling of `functionCall` instead of nesting it inside (live 400 → 200), the Anthropic/Google conformance fixtures, the approved deletion of two dead surfaces, and DSH credential-store support (`credentialRef`) for the DeepInfra and EXAONE keys, and rc.20 with the automatic plaintext-key migration (profile patch → DSH credential store), the EXAONE subagent-allowlist entry in both the live profile and the repo default, the atomic owner-only write the migration commits through, and the removal of the synthetic `OpenCode (config default)` model row from the picker (the `default` pseudo-route still resolves server-side), three post-rc.20 fixes found by live probing (the credential-store ref read through the inject-free accessor, the Gemini replay argument pruning, and the deferred credential injection) with a live verification block, and the A3 completion plus R4 closure (the OpenCode legacy pipeline and the `pipe` config key deleted — one pipeline, no config selects it — `stream-parser.js` renamed to `notation-classifier.js` because it was measured to be shared-path glue, the L1 boundary lint and the `USAGE_READERS` gate shipped with negative proofs, and the dead `classifyBlock` slot removed).
-->

## 0.0.1-rc.20 (cont. 4) — R3 closed (one retry, one catalog cache) and R5 closed (no vendor ids in L1) — 2026-11-14

> Code commit: `77a53b0` (`refactor(custom-router): close R3 (duplicate retry/catalog caches) and R5 (plan vendor ids out of L1)`).
> This section records it; the code commit itself carried no CHANGELOG entry.

### R3 — one retry and one catalog cache

| Item | Before | After | Evidence |
|---|---|---|---|
| OpenCode `sleepFor` | vendor-local, **24 L** | **deleted** | `grep -rn "function sleepFor" lib/ vendor/` → **1** hit, `lib/retry.js:147` |
| OpenCode `backoffDelay` | vendor-local, **12 L**, **inverted signature** `backoffDelay(baseMs, attempt)` vs the core's `backoffDelay(attempt, baseMs, capMs)` | **deleted** — both retry sites call `lib/retry.js` | `grep -rn "function backoffDelay" lib/ vendor/` → **1** hit, `lib/retry.js:130` |
| `vendor/opencode/lib/catalog-cache.js` | **362 L** (durable class bound to fs/probe/timer) | **deleted** — split into `catalog-file.js` (**236 L**) + `catalog-lifecycle.js` (**181 L**) over the core `createCatalogCache` | `git show --stat 77a53b0`; single-flight and the durable snapshot round-trip preserved |
| DeepInfra catalog cache | local 30-min in-memory closure + `invalidateCatalog` closure + `fetchedAt` math | core `createCatalogCache` with a `ttlMs` **function** — the plugin's **30-min default** and its `catalogTtlMs` **config key** are unchanged | `vendor/deepinfra/lib/index.js:237` → `numberAt('catalogTtlMs', DEFAULT_CATALOG_TTL_MS)` |
| OpenCode vendor suite | 553 | **554/554** | `npm test` in `vendor/opencode` |
| Router suite | 802 | **807/807** | `npm test` in the track |

**Preserved deliberately (the semantics that must not drift):** the vendor's **own** retry status
set — **429 / 451 / 502 / 503 / 504** — was **not** widened to the core's wider set; the
**unbounded** progression (the cap is deliberately raised); the **abort semantics**; and the
**one-shot 401 refresh**, kept as an **in-attempt** action that never consumes a retry.

**Measured benefit (DeepInfra):** **5 concurrent cold reads → 1 probe** (the old closure had no
in-flight dedupe); a **failed cold fetch is still served as an empty catalog and is not cached**,
so one bad poll does not blank the picker for a whole TTL.

⚠️ **Known divergence (not a defect).** `DEFAULT_CATALOG_TTL_MS` now exists in **two** places:
`vendor/deepinfra/lib/catalog.js:111` (**30 min** — the one actually used) and
`lib/catalog-cache.js:42` (**15 min** — the core default when no `ttl` is passed). DeepInfra passes
its own 30-minute constant explicitly, so the **runtime** TTL is unambiguous — but the two names
coexist, and a reader who sees only the core constant will read the wrong default.

### R5 — no vendor ids in L1

| Item | Before | After | Evidence |
|---|---|---|---|
| `PLAN_PROVIDERS` | declared in `lib/plan.js` (the shared L1 core) as `{ go: 'opencode-go', zen: 'opencode' }` | moved to the **declaration layer** `lib/presets.js` (+ `PLAN_PROVIDERS_BY_PRESET`, `planProvidersOf(presetId)`) | `lib/presets.js:397` |
| `lib/plan.js` plan→provider seam | read a module-level literal | `bindPlanProviders(map)` + an **explicit `providers` argument** on `planOfProvider` / `planOfRoute` / `availabilityOf` / `orderModels`; unbound, the map is empty and every provider classifies as `other` | `lib/plan.js:388-404` |
| Vendor-id count in `lib/plan.js` | **2 code ids** (9 including comments) | **0** | `grep -ciE "opencode\|antigravity\|deepinfra\|exaone" lib/plan.js` → **0** |
| Plan-boundary lint | **did not exist** | **`test/plan-boundary.test.mjs` (5 cases)** — measures the vendor words **from `vendor/*/package.json`** instead of hand-listing them, so a new vendor cannot slip past an out-of-date lint list | `npm test` in the track |

### Gates (re-measured)

router `npm test` **807/807**; `verify:stream` **8/8** with **4** vendored packages probed,
**8/8** specifiers refused, **vendor loads 0**; `specs:check` OK (`5 protocols, 4 providers,
4 pricing`); `verify:presets:mutation` **26/26**; `verify:usage-readers` OK (4 presets / 4 routes /
3 readers); vendor suites antigravity **193/193**, deepinfra **222 pass / 7 skip**,
opencode **554/554**, exaone **19/19**.

### Not done, deliberately

**No restart** — the live service still runs the `e8b39f7` build, so the live-probe record in
[HANDOFF.md](./docs/HANDOFF.md) §1 is unchanged and remains the last measured live state.
**No version bump** — held at `rc.20` (the numeric part is the owner's; this was a code change
inside the same session, not a release). **No** `~/.dsh` write. **No** API key was read, printed
or reproduced. The remaining consolidation queue is **R2** (OpenCode's private cost ledger),
**R6** (the repo-wide uniqueness greps are still a manual grep, not a wired gate) and **A7**
(the host `dsh-llm-pi-ai` `providers` seam — measure-first, owner-gated).

## 0.0.1-rc.20 (cont. 3) — A3 complete (one OpenCode pipeline) and R4 closed — 2026-11-14

### What changed

| Item | Before | After | Evidence |
|---|---|---|---|
| OpenCode `http.js` | **3 272 L** | **2 721 L** (**−630 / +79**) | `git diff e8b39f7^..e8b39f7 -- vendor/opencode/lib/http.js` |
| OpenCode pipelines | 2 (a `pipe` config key selected one) | **1** — the `pipe` config key is **deleted**, no config selects a pipeline | `grep -n "pipe" vendor/opencode/lib/http.js` |
| Vendor-local SSE reader | `chatSseEvents` / `parseSseBlock` (~60 L) | **deleted** | grep: 0 code hits |
| `vendor/opencode/lib/stream-parser.js` | 679 L, imported by the shared path | **renamed** `notation-classifier.js` (679 L, one named export `createNotationClassifier`, **one** consumer `stream-contract.js:58`) | `grep -rn "notation-classifier" vendor/` |
| OpenCode vendor suite | 555 | **553/553** (two legacy-only tests removed; the legacy↔shared parity tests replaced by **golden sequences captured from the shared path before the deletion**) | `npm test` in `vendor/opencode` |
| Router suite | 774 | **802/802** | `npm test` in the track |
| L1 boundary lint | **did not exist** | `test/stream-boundary.test.mjs` (**15 cases**) — no vendor import/identifier, no `ctx`/`process.env`/`node:fs`/`fetch(`/`require(`/dynamic `import(`, no per-vendor equality, exactly one SSE decoder / usage writer / finish table / `abortError` | `npm test`; **negative proof**: a planted forbidden import failed 3 rules, reverted with a sha256 check |
| `USAGE_READERS` gate | **did not exist** | `scripts/verify-usage-readers.mjs` + `test/usage-readers.test.mjs` (**12 cases**) — every `usage.routes[].normalize` must name a real reader, no dead reader, browser source↔bundle parity | `node scripts/verify-usage-readers.mjs` → **OK** (4 presets / 4 routes / 3 readers); a renamed route exits 1 |
| Dead `classifyBlock` hook slot | declared in `lib/driver/contract.js` `OPTIONAL_HOOKS` | **removed** | `test/driver-contract.test.mjs` asserts `'classifyBlock' in driver.hooks === false` |
| Version | `0.0.1-rc.20` | `0.0.1-rc.20` (**held** — the numeric part is the owner's) | `package.json` |

### Gates (re-measured)

router `npm test` **802/802**; `verify:stream` **8/8** with **4** vendored packages probed,
**8/8** specifiers refused, **vendor loads 0**; `specs:check` OK (`5 protocols, 4 providers,
4 pricing`); `verify:presets:mutation` **26/26**; `verify:usage-readers` OK; vendor suites
antigravity **193/193**, deepinfra **222 pass / 7 skip**, opencode **553/553**, exaone **19/19**.

### Live verification

After the owner's restart at **09:37:14 KST** (PID 361248): the **OpenCode shared pipe**,
the **DeepInfra OpenAI core** and the **Antigravity core** all returned **OK with no error**.

### Note on the measured correction

The earlier **629-line** delete list was measured wrong: `stream-parser.js` is **shared-path
glue**, not legacy-only code. It was therefore **renamed, not deleted** — a vendor-local
notation-quirk surface — and the legacy↔shared parity coverage was replaced by golden
sequences captured from the shared path **before** the deletion, so the expected output is a
recorded constant rather than a live re-derivation.

## 0.0.1-rc.20 (cont. 2) — three post-rc.20 fixes found by live probing — 2026-11-14

### What changed

| Item | Before | After | Evidence |
|---|---|---|---|
| Credential-store ref read | `ctx.credentials` (a bare property read) | `ctx.get('credentials')` — the inject-free accessor | commits `0b2c516`, `6388397` |
| Replayed Gemini `functionCall.args` | replayed verbatim, undeclared keys included | only keys the tool declaration declares are replayed | commit `642ee06` |
| Antigravity vendor suite | 190 | **193** | `npm test` in `vendor/antigravity` (+3 regression cases) |
| Router suite | 649 | **649** (unchanged) | `npm test` in the track |
| Vendor suites (unchanged) | — | deepinfra **222 pass / 7 skip** (229 total), opencode **555**, exaone **19** | `npm test` per vendor |

### `0b2c516` — the credential ref was read through a service this plugin does not inject

The rc.20 `credentialRef` support read the host credential service as **`ctx.credentials`**. Both
vendored presets declare `inject: ['llm']`, so cordis refuses the bare property read with
`cannot get property "credentials" without inject` (cordis:1257). The `try/catch` around it
swallowed that error and returned `''` — **silently**: the migrated keys were never resolved and
DeepInfra/EXAONE turns went out with no API key (live `HTTP 401`).

The fix is the **inject-free accessor**: `ctx.get('credentials')` (cordis:1345) reads a mounted
service without an inject requirement. Both `vendor/deepinfra/lib/index.js` and
`vendor/exaone/lib/index.js` now use it.

### `642ee06` — a replayed Gemini `functionCall.args` key the tool does not declare is fatal

Measured live 2026-11-14 (session `2a16c3bb`, turn 1 step 14, model `gemini-4-hydrogen`): a request
that replayed a `write` tool call carrying **`sandbox_permissions`** was rejected by Google with
`HTTP 400 "Request contains an invalid argument."`. Google validates **replayed** `functionCall`
arguments against the tool declaration; a key the declaration does not declare poisons the request.
Earlier steps replayed only schema-normal arguments and passed.

- `declaredArguments(tools)` builds the per-tool parameter map from the **request's own** tool list.
- `pruneArguments(value, schema)` keeps only declared keys, recursively (arrays included), and drops
  `null`/`undefined` values, which Gemini also rejects on replay.
- An **undeclared tool name** still projects its arguments unchanged — the projection cannot invent a
  schema it was not given.

Antigravity suite **190 → 193** (+3 regression cases).

### `6388397` — the store ref was resolved once, at mount, and that was too early

The live DeepInfra child failed with `HTTP 401: missing API key` even though the store held
`DEEPINFRA_API_KEY` and the credentials provider was mounted (`dsh --dump-config` shows
`credentials -> @deepseek-ai/dsh-credentials-local`).

**Cause:** `ctx.get(name, strict)` returns `undefined` while the providing fiber is still activating,
and a plugin `apply()` can run **before** the credentials service is. The single eager resolve
therefore cached an empty key for the whole process lifetime.

**Fix:** read with **`strict=false`** (return the provider even while its fiber is activating) **and**
register **`ctx.inject(['credentials'], …)`** — cordis's deferred sub-context, whose callback runs as
soon as the service becomes available — so the value is resolved at the right time and refreshed on
`credentials/reference-updated`.

### Live verification (2026-11-14, post-restart)

Measured after the service restart at **06:10:57 KST** (`MainPID 284518`):

| Probe | Result |
|---|---|
| DeepInfra child, model `deepseek-ai/DeepSeek-V4.1-Flash-1017` | **`DEEPINFRA_PROBE_OK`**, no error |
| Gemini child, model `gemini-4-hydrogen` — two consecutive requests, the second a **replay carrying `sandbox_permissions`** | **`GEMINI_OK_3`** / **`GEMINI_OK_3B`** / **`TWO_REQUESTS_OK`**, **no HTTP 400** |
| Live service | `MainPID 284518`, started **06:10:57 KST** |
| Boot log | **no credential warnings** (credential-warning match count in the boot journal = **0**) |

**An EXAONE *child* call is still UNVERIFIED.** The probing children inherited their allowlist from
their **parent** Session `session-b32097ec…`, a top-level Session created at **01:08:57 KST** —
*before* the 7-route allowlist row was applied to the live patch — and the allowlist freezes at
`agent/created`. The children therefore carry the parent's **6-route** list (no
`exaone/k-exaone_v2.5`) even though the live patch row and the repo default both carry **7**.
Measured: 8 Sessions carry the 7-route policy (all created 04:25–04:37 KST, after the edit) and 16
carry 6; the probe children `a8399f2d` / `b9d83d3f` / `62f0816a` (06:11–06:20 KST, after the
06:10:57 restart) are all children of the 6-route parent. A **top-level** EXAONE turn works
(confirmed by the owner). The child route therefore remains owner-verifiable only from a **new**
top-level Session (P1-1/P1-3 in `docs/ROADMAP.md`).

### Notes

- Version held at `rc.20` (same session, per owner instruction). No live profile value was written,
  no service was restarted by this change, and no key value appears in this entry.
- The three fixes are code-only (`vendor/deepinfra`, `vendor/exaone`, `vendor/antigravity`); the
  docs in this session (`docs/ROADMAP.md`, `docs/HANDOFF.md`) were brought to the measured state
  alongside them.

## 0.0.1-rc.20 (cont.) — the synthetic `OpenCode (config default)` model row is removed — 2026-11-14

### What changed

| Item | Before | After | Evidence |
|---|---|---|---|
| OpenCode provider group in the picker | carried one synthetic row `id: 'default'`, name `OpenCode (config default)` | the served catalog only | `vendor/opencode/lib/http.js` (`listModels`), `vendor/opencode/lib/provider.js` (`listModels`) |
| `models` config default (both adapters) | `[{ id: 'default', opencodeModel: '', name: 'OpenCode (config default)' }]` | `[]` (seeds no row) | `vendor/opencode/lib/http.js` Config, `vendor/opencode/lib/provider.js` Config |
| Router suite | 645 | **649** | `npm test` (+4 negative-proof cases) |
| OpenCode vendor suite | 554 | **555** | `npm test` in `vendor/opencode` (+1 case: the pseudo-route still resolves) |

### Where it came from

The row was **synthesized in two places per vendored adapter**, never by the host and never by the
router's own preset registry:

1. `vendor/opencode/lib/http.js` — the `models` schema default carried the entry, and
   `listModels()` prepended a fresh `{ provider, id: 'default', name: 'OpenCode (config default)' }`
   row to the discovered catalog. That is the row the `OpenCode Go (direct)` provider group showed.
2. `vendor/opencode/lib/provider.js` — the same two places for the CLI adapter (`OpenCode (CLI)`).

It was never a model id: the backend serves no route by that name, so the picker advertised a
phantom.

### What was removed, and what was deliberately KEPT

**Removed:** the ENTRY — both config defaults now seed no row, and both `listModels` prepends are
gone. The list simply stops showing it; no replacement entry was invented.

**Kept:** the `default` **pseudo-route** resolution, which is server-side route resolution and not a
dropdown entry:

- `modelRefFromRoute(route, table, defaultModel)` (`http.js`) still maps the `default` id to the
  table's `opencodeModel` or, failing that, to `defaultModel`. The live profile sets
  `defaultModel: opencode-go/minimax-m3.1-flash`.
- `resolveOpencodeModel(routeId, table)` (`provider.js`) still maps `default` to the empty `-m`
  value, so `opencode run` applies its own configuration.

The two were coupled in the old code only because ONE synthetic row served both purposes. The
removal deletes the advertisement and leaves the resolution untouched.

### Negative proof

- Producer grep count for the exact label in `vendor/*/lib/` + `lib/` = **0**. The label survives
  only inside assertions that FORBID it.
- New track test `test/model-catalog-default-row.test.mjs` (4 cases): neither adapter config seeds
  a row; the HTTP discovered list equals the served catalog; the HTTP fallback list is empty; the
  CLI discovered list equals the served catalog.
- The vendor test that asserted *"the config-default row always stays selectable"* now asserts its
  **absence**, and a new vendor test pins that the pseudo-route still resolves to `defaultModel`.

### Locale

**No locale key ever existed for that label** (measured: `config default` count = 0 in
`locale/en.json`, `locale/ko.json`, `locale/zh.json`, `lib/locale-table.js`,
`vendor/opencode/locale/en.json`, `vendor/opencode/locale/ko.json`). There was therefore no orphan
translation to delete, and none was invented. `lib/locale-table.js` and the locale JSONs are
unchanged by this change.

### Notes

- Version held at `rc.20` (bumped earlier in the session). No live profile value was written and
  the running service was **not** restarted; the live picker keeps the old catalog until the next
  restart.
- Docs were brought to the measured rc.20 baseline in the same session: `docs/ROADMAP.md`,
  `docs/HANDOFF.md`, and the closed-item table in `docs/ROADMAP-ARCHIVE.md` §2.

## 0.0.1-rc.20 — automatic plaintext-key migration + EXAONE allowlist — 2026-11-14

### What changed

| Item | Before | After | Evidence |
|---|---|---|---|
| DeepInfra key | plaintext `apiKey:` in the live profile patch (line 140) | `credentialRef: DEEPINFRA_API_KEY` (line 142) | `~/.dsh/profiles/web/cordis.patch.yml`; backup `cordis.patch.yml.bak.before-plaintext-key-migration-20261113-183336` (mode 0600) |
| EXAONE key | plaintext `apiKey:` in the live profile patch (line 164) | `credentialRef: EXAONE_API_KEY` (line 166) | same file; same backup |
| Credential store | `refs: DEEPSEEK_API_KEY, OPENCODE_API_KEY` | `refs: … + DEEPINFRA_API_KEY, EXAONE_API_KEY` | `~/.dsh/.credentials.yaml` (mode 0600); `version:`/`records:` untouched |
| Live allowlist | 6 routes, `exaone` absent | **7 routes**, `exaone/k-exaone_v2.5` added | `~/.dsh/profiles/web/cordis.patch.yml:63-64` |
| Repo default allowlist | no `subagent-model-selection-settings` row | 7 routes incl. `exaone/k-exaone_v2.5` | `cordis.patch.yml` (this package's bundle layer) + `lib/allowlist.js` |
| Router suite | 629 | **645** | `npm test` (16 new cases: 11 migration + 5 allowlist) |

### The automatic migration (`lib/credential-migration.js`)

The router now migrates a plaintext provider key into the DSH credential store **by itself**, at
mount, when its OWN live config still carries one:

1. **Trigger** — the router's live `vendorConfig` holds a plaintext `apiKey` for a managed row
   (`dsh-deepinfra`, `dsh-exaone`). The live config is the trigger because it is what the running
   service actually uses; the patch file is then edited to match, so the two cannot drift.
2. **Backup** — the patch is copied to `cordis.patch.yml.bak.before-plaintext-key-migration-<ts>`
   with mode **0600** before anything is touched.
3. **Store** — the value is written into `~/.dsh/.credentials.yaml` under `refs:`, through the host
   credential seam (`ctx.credentials.set(ref, value)`), which commits with the provider's own
   atomic protocol (random-suffix sibling + rename, mode 0600, under the document's writer lock).
4. **Confirm** — the ref is read back and must resolve to the same value.
5. **Remove** — only then is the plaintext line replaced by `credentialRef: <ref>`.

**The order is the safety property.** There is no env fallback on the live service, so a lost value
is a lost route; a plaintext key is therefore never deleted before its store entry is confirmed.
Every failure path leaves the plaintext line in place and logs a warning naming the **ref** (never
a value). The edit is LINE-ORIENTED, not a YAML load/dump: the patch carries comments and an order
that a rewrite would destroy, and the diff after the run was exactly the two intended lines.

**Idempotent by construction.** With the plaintext lines gone the plan is empty and nothing is
written — the steady state is a no-op, verified by re-running the one-shot script
(`result: nothing to migrate`, no second backup).

### The one-shot script (`scripts/migrate-plaintext-keys.mjs`)

`--dry-run` (default) plans and reports; `--apply` performs the same four steps against a chosen
`--patch` file and `--home`. The store write uses the **atomic YAML path** (the `yaml` Document
`setIn(['refs', ref])` + `writeFileAtomic` + `withFileLock`), because the service's own write method
is not reachable from a standalone script; the credential provider watches the file and picks the
change up **without a restart**. `version:`, `records:` and every other entry survive byte for byte.

### The EXAONE allowlist

The measured refusal was `child LLM route "exaone/k-exaone_v2.5" is not allowed for this Session`.
The route is now in the **live** allowlist and in the **repo-side default**, which is stated in two
homes from one source: `lib/allowlist.js` (the list as data) and this package's `cordis.patch.yml`
(the bundle layer a fresh profile mounts). A bundle layer applies BEFORE the profile's own patch and
a patch REPLACES a row's whole config, so an operator's list wins wholesale — the default never
fights the live list. `test/allowlist.test.mjs` pins the two homes against each other, parsing the
YAML with the HOST's own parser so the file the test reads is the file the loader parses.

### Notes for the owner

- The two keys in the live profile were **disclosed in a transcript** (see `docs/FAILURE-LEDGER.md`
  and ROADMAP P0-1). This migration moves them into the store; it does **not** rotate them. Rotate
  at the provider and update the store refs.
- The live patch file is read at boot: the new `credentialRef` lines take effect on the next
  restart. The credential store is hot — the provider watches it, so a rotated value reaches the
  next request without a restart.
- `scripts/verify-mount.mjs` currently reports `PARITY: FAIL` against
  `.runtime-measure/custom-router-e2e/baseline-web.json`. This is **pre-existing drift**, proved by
  re-running the gate with this change reverted (identical result): the baseline is an UNTRACKED
  artifact from 2026-11-07 that predates the host's `propose_action`/`team_task_*` tools and the
  `deepinfra-anthropic` route. It is not a gate this change was asked to run, and it is not
  affected by it.

## 0.0.1-rc.19 — living-spec gates, four-preset smoke, Gemini replay 400 — 2026-11-14

### Measured before → after

| Surface | Before | After | Evidence |
|---|---|---|---|
| Router suite | 592 | **625** | `npm test` (22 refresh-expectation cases + 11 conformance cases) |
| Conformance wires | 1 of 5 | **3 of 5** | anthropic-messages + google-generative-sse replay offline |
| Stale docs | 12+ docs on rc.16/583/173-entry claims | **rc.19 baseline** | `docs:check` 232 docs / 1,695 links |
| `verify:refresh` | PASS on 3 mounted routes | **PASS on 4 preset routes + expected rows** | `[expected] preset routes present: 4/4` |
| `specs:check` | freshness only | freshness **+ watch-baseline age** | `watch: generatedAt …, 0d old (max 14d) — OK` |
| DeepInfra pricing `verifiedAt` | 2026-11-13 (TTL 7d → hard-stale 2026-11-21) | **2026-11-14** | live catalog: 178 entries, 92 chat, 8 discounted (0.05–0.51) |
| Gemini replay (router path) | HTTP 400 `Unknown name "thoughtSignature" at 'request.contents[5].parts[0].function_call'` | isolated real wire **200**, answer + finish `stop` | `vendor/antigravity/lib/wire.js`; vendor suite 190/190 |
| Vendored versions | antigravity rc.13 / opencode rc.7 / deepinfra rc.13 | **rc.14 / rc.8 / rc.14**, peers `rc.19` | package manifests |

### Living-spec gates

- **Watch-baseline age (ROADMAP P1-5).** `scripts/verify-specs.mjs` gained
  `loadWatchBaseline()` + `checkWatchBaseline()`: `specs/upstream.lock.json` is aged against
  `--watch-max-age` (default **14 days**, i.e. two missed weekly cycles), warning by default so an
  offline machine still passes, error with `--strict-watch` / `npm run verify:freshness:strict`. A
  missing lock is a warning (an error under `--strict-watch`). The manual cadence and the three-step
  runbook are in `specs/README.md`. No scheduler was added. 8 new tests.
- **Pricing re-verification (P1-4).** The live catalog was re-read on 2026-11-14 and
  `specs/pricing/deepinfra.json` now records the fresh measurement; the 7-day `ttlDays` is retained
  because the owner never asked to move to the 30-day default. The stale facts in
  `specs/providers/deepinfra.json` and the vendored `catalog.js` header (173/91/9) were corrected to
  the new measurement (178/92/8) instead of being left as evidence for a different day.
- **Four-preset smoke (P1-6).** `scripts/refresh-expectations.mjs` is a pure expectation table
  (`ROUTES`, `evaluateRefreshRoute`, `evaluateRefresh`) and `scripts/verify-refresh-routes.mjs` now
  mounts **all four** presets and judges the payload: EXAONE must list `k-exaone_v2.5`, Antigravity
  must keep a Claude and a Gemini lane, OpenCode and DeepInfra must serve rows. An absent route is a
  **failure**, not a skip. 22 unit tests, plus two end-to-end negatives (preset dropped from the
  mount → exit 1; `k-exaone_v2.5` stripped → exit 1).

### Defects the worker caught in the first draft of that gate

Six real defects were found in the lead's initial implementation and fixed (recorded because they
are the reason the gate is trustworthy): a never-read route counted as `present` (false green,
`evaluateRefresh([])` printed 4/4); the "Gemini base row" check was actually a `/hydrogen/` match; a
lost row was only checked on the **forced** read, so a stale cache could pass; positional read
matching; no aggregate `ok`; and "route not mounted" printed for a never-read route. The new suite
fails 18/22 against the original implementation.

### Vendored Antigravity — the live Gemini 400

A live child on `antigravity/gemini-4-hydrogen` failed at its second step with
`HTTP 400 Invalid JSON payload received. Unknown name "thoughtSignature" at
'request.contents[5].parts[0].function_call': Cannot find field.` The adapter had carried the opaque
signature correctly through the stream and the shared pipe but replayed it **inside** `functionCall`;
the wire returns it as a **part-level sibling**. `vendor/antigravity/lib/wire.js` now emits
`{ functionCall: { name, args, id }, thoughtSignature }`, `test/wire.test.mjs` gained a deep-path
regression that fails if the key appears anywhere under `functionCall` (and the old test that pinned
the nested shape was removed), and an isolated real-wire replay proved 400 → 200. **State: applied
pending restart** — the live unit (started 01:07:25 KST) still runs the pre-fix module.

### Conformance fixtures (ROADMAP P2-4, closed)

`test/conformance/` grew from one wire to three. `anthropic-messages.test.mjs` (6 tests) replays a
recorded Messages stream — `message_start` usage (input 60 / cacheRead 10 / cacheWrite 20) merged with
the output-only `message_delta`, two `signature_delta` fragments accumulating into one per-block
signature, a fragmented `input_json_delta`, and the request-side rule that **both** tool results of one
assistant turn land in ONE user message. `google-generative-sse.test.mjs` (5 tests) replays the
`{response:{candidates,usageMetadata}}` envelope, proves `promptTokenCount` includes the cached tokens
(`inputTokens` 100 of 120), promotes STOP-after-tool-call to `tool-calls`, and pins the signature path
`[1].parts[0].thoughtSignature` with a recursive walk proving zero `thoughtSignature` keys beneath any
`functionCall`. Each fixture carried a negative proof (breaking the binding made it fail; the vendor
file was restored and hash-verified). **Uncovered remain `openai-responses` and
`google-generative-ai`.**

### Documentation freshness (ROADMAP P2-9, closed)

Twelve docs plus `README.md`/`README.ko.md` were corrected to the rc.19 baseline — test counts, rc
numbers, the DeepInfra catalog (178 entries / 92 chat / 8 discounted 0.05–0.51), host
`0.2.2-rc.3`, live unit 01:07:25 KST. Two substantive findings: `PRESET-REGISTRY-STANDARD` §4 listed
steps 2–3 as open while its header said the registry is derived (measured: `MODEL_PRESETS` **is**
derived at `lib/client.src.js:2010`; the residual is `ROUTER_PROVIDERS`/`PICKER_ITEMS` only), and
`CUSTOM-ROUTER-SERVICE-SPEC`'s claim that all three vendors are `link:` dependencies is false against
the live profile. **C5 confirmed by measurement**: one `settings.section` in the shipped client,
asserted by `test/client.test.mjs`; the vendor clients are unreachable dead code. `docs:check` green —
232 documents / 1,695 links; `check-plugin-history` green.

### Owner-instruction wave (same session, 02:00–03:00 KST)

- **Post-restart live re-check (P1-2 closed):** the owner restarted the unit at 02:06:42 KST
  (`MainPID 187920`). Router-path probes then passed on both wires — Gemini replayed a real 372-byte
  `thoughtSignature` on a tool-call, read the result and completed the follow-up
  (`turn/end completed`, zero 400 / `Cannot find field`); Claude carried two `bash` calls in one
  assistant message with both results. The nested-signature 400 was not reproduced after the restart.
- **Owner-approved deletions (P2-7 closed):** `vendor/antigravity/lib/subagent-opencode.js`
  (sha256 `033d478b…`) removed together with its `"./subagent-opencode"` export entry (16 export keys
  left, 0 dangling), and the broken profile symlink
  `~/.dsh/profiles/web/node_modules/@nolit/dsh-opencode-v2` removed — symlink only, containing
  directory inode unchanged, six remaining entries all resolve. Gates after: antigravity 190/190,
  router green, `verify:presets` OK.
- **Preset surface audit (T16):** measured matrix — antigravity: subagent provider + CLI worker +
  tools/command; opencode: subagent provider + CLI worker + tool/command; deepinfra and exaone:
  **model routes only** (`registerAdapter` and nothing else). Declarations already matched vendored
  source in both directions; a new `test/preset-surfaces.test.mjs` pins that in both directions
  (declared-but-absent **and** present-but-undeclared). The only gap is the live EXAONE allowlist
  entry (owner, ROADMAP P1-3).
- **Obsolete docs pruned (T18):** `FEATURE-SUMMARY.md` was the only document with no hand-written
  inbound link and a version table that stopped at rc.17; it moved to `docs/archive/` with
  depth-fixed links and a new `docs/archive/INDEX.md`. Nothing was deleted.
- **Credential store (P0-2 agent side):** both vendored presets declare `credentialRef`
  (`DEEPINFRA_API_KEY` / `EXAONE_API_KEY`), resolve it through `ctx.credentials.resolve()` at mount
  and on `credentials/reference-updated`, with the precedence `explicit apiKey → store ref → env`
  extracted as the pure `keyPrecedence` rule and pinned by tests (deepinfra 222 pass + 7 skip,
  exaone 19/19, router 629/629). The **declaration layer** now lists the same precedence —
  `auth.sources = [secret-field apiKey, credential-ref <REF>, env <REF>]` for both presets
  (`lib/presets.js`), with `test/presets.test.mjs` updated in the same change — so
  `verify:presets` and its mutation gate cover the store ref too. The seam is documented in
  `docs/CREDENTIAL-STORE-MIGRATION.md` with the owner steps; no value appears in the repo. **Note:** two workers were dispatched on this
  task and both exhausted context with zero writes before the lead measured the seam
  (`dsh-credentials-local/lib/index.js:492`) and executed the bounded change.

### Versions

- Router `0.0.1-rc.19`; antigravity `0.0.1-rc.14` (wire fix), deepinfra `0.0.1-rc.14` (catalog
  re-measurement), opencode `0.0.1-rc.8` (peer pin only), exaone unchanged at `0.0.1-rc.1`.
- All four peer pins now read `0.0.1-rc.19`.

## 0.0.1-rc.18 — subagent activation spec is flat again — 2026-11-13

### Owner report

세 세션(`b3ff706f`, `0ca4f190`, `fc5e45e7`)의 서브에이전트 호출이 막힌 원인을 실측하고
보완한다. `opencode`/`agy_worker` 호출이 `Cannot read properties of undefined (reading 'id')`로
실패하며, 권한(승인/샌드박스) 문제가 아니라 **벤더 위임 코드가 DSH 0.2.1-rc.2에서 제거된
중첩 `request` 필드를 아직 보내고 있는 계약 불일치**다.

### Measured

| Surface | Before | Evidence |
|---|---|---|
| Live failure (session `b3ff706f`, 2026-11-13 22:16:55 KST) | `Error: opencode delegation could not start its child session: Cannot read properties of undefined (reading 'id')` | `tool/result` seq 95 |
| `dsh-subagent` (0.2.2-rc.3) `startActivation(spec)` | reads `spec.parent.id` first (`lib/index.js:3024`); `startExternal()` destructures `spec.parent` (`:1584`) then `assertAdmitting(parent)` → `rootOf(undefined)` → `caller.id` | code read + `closingTeardownFor` (`:1898-1901`) |
| Upgrade guide `v0.2.1-rc.2/subagent-activation-options` | "The nested `request` field is removed… pass `prompt`, `parent`, and optional execution settings directly" | installed DSH docs |
| `vendor/opencode/lib/delegation.js` | sent `{provider,label,request:{prompt,parent,cwd},signal,delivery}` | measured live; test pinned `spec.request.parent` |
| `vendor/antigravity/lib/cli-activation.js` | same nested shape for `agy_worker` / `/agy` | test pinned `spec.request.*` |
| Host `subagent` explicit model errors (`fc5e45e7`) | **separate cause**: `child LLM route … is not allowed for this Session` | see below — not a permission decision |

### What was wrong (two independent symptoms)

1. **Contract mismatch (fixed here).** The vendored delegations were written against the
   0.2.1-alpha.1 seam (`request: {…}`) and never migrated. `spec.parent` is `undefined`, so the
   live service throws before any provider runs; the tool surfaces that error as a delegation
   failure. Nothing in the dispatch gate is involved.
2. **Frozen per-session model policy (not fixed by code).** The host records
   `subagent/model-selection-policy` once at `agent/created` and never re-resolves it
   (`dsh-tool-subagent/lib/model-selection-settings.js`). Sessions created before the live
   `allowedModels` edit keep the old route ids (e.g. `0ca4f190` lists `antigravity/gemini-3.8-flash`,
   `gemini-4-argon-{low,medium,high}` while the current catalog advertises `gemini-4-hydrogen` /
   `gemini-4-argon` / `claude-opus-5-5`), so explicit selection is refused there. This is a DSH
   design property, not the router's gate: a fresh top-level session (or omitting explicit
   model selection) is the only remedy.

### Fix

- `vendor/opencode/lib/delegation.js`: `startChildSession()` builds a flat activation spec
  (`provider`, `label`, `prompt`, `parent`, `signal`, `delivery`, optional `cwd`). `/ocode` uses
  the same function.
- `vendor/antigravity/lib/cli-activation.js`: `startCliChild()` builds the same flat spec for
  `agy_worker` / `/agy`.
- Tests updated to pin the flat contract, including the exact live read
  (`spec.parent.id` / `spec.parent.session.header.cwd`) and the absence of `request`.
- `lib/client.src.js` `OPENCODE_DOC_LIMITS`: the `claude-haiku-5-5` route now resolves its
  documented Go limit; the combined free-model key was split into `beam-free` and
  `iceman-contributor-free` (both null). `lib/client.js` rebuilt from the source.
- `test/dual-mount-guard.test.mjs`: removed the three obsolete `dsh-opencode-v2` shim
  export/locale parity tests and `SHIM_ROOT`; Phase E retired the shim and moved it to
  `archive/`, so the guard would only measure archived code. The header records why.
- `vendor/opencode/lib/index.js`: `/ocode` help no longer advertises a fallback-only saved
  selection in managed mode; it names the provider route it will actually use.
- `vendor/opencode/lib/index.js`: the `model` parameter text interpolated the compile-time
  `DEFAULT_MODEL` even when the row configured another model, so the model read a route the child
  would not run. `parameters(model)` now receives `cfg('model', DEFAULT_MODEL)`; clear/empty config
  falls back to the same default the provider uses. The row's `config-reload` re-sync re-registers
  the tool, so the text follows a settings change.
- `scripts/build-presets.mjs`: `check:derive` compared `declarationSource()` (line + trailing
  newline) with `DECLARATION_LINE` (a `/m` match that never captures the newline), so it FAILED on
  a semantically identical tree forever and could not separate real drift from its own newline
  (measured: `lengths 3760 vs 3761`, `equal ignoring trailing newline? true`,
  `deep equal? true`). `declarationsAreCurrent()` now compares without the trailing newline;
  `npm run check:derive` exits 0 and a changed declaration still fails it (`test/build-presets.test.mjs`).

### Same-class drift found while answering “where else?”

| Surface | Measured | Status |
|---|---|---|
| Live `subagent-model-selection-settings.allowedModels` | six routes, all registered; the parent/default route `deepseek-account/deepseek-flash` is absent. Live check on a fresh session: `list_subagent_models({provider:"deepseek-account"})` → `Error: LLM provider "deepseek-account" is not allowed for this Session` | **intentional** — owner confirmed 2026-11-13 that subagents are limited to Antigravity / OpenCode / DeepInfra; `deepseek-account` is deliberately excluded |
| Session allowlists | creation-time snapshot; `0ca4f190` has 12 stale ids, `fc5e45e7` 6, current session 6 | DSH design; only a new top-level session picks up edits |
| `lib/client.src.js` `OPENCODE_DOC_LIMITS` | key `claude-haiku-5.5`; the catalog route is `opencode-go/claude-haiku-5-5`, so `documentedLimit(row.route)` returned `null` and the UI printed `—` even though the docs list $15/$60/$20. The combined `crouton/beam/iceman` key can never be produced by `opencodeLimitKey` | **fixed** — dashed route key, combined key split into the two served free routes, `client.js` rebuilt; regression pinned in `test/client.test.mjs` |
| `test/dual-mount-guard.test.mjs` | 3 failures: the test read `dsh-opencode-v2/` at the repo root, which Phase E moved to `archive/` | **fixed** — the retired shim's three export/locale parity tests and `SHIM_ROOT` were removed; the vendor-only guard remains |
| `vendor/antigravity` CLI default `gemini-3.8-flash-low` | not in the profile's `dsh-antigravity.enabledModels` (that field filters the model route only, not the CLI), so no drift is proven; flagged as worth checking against the account catalog | unverified |

### Verification

| Gate | Result |
|---|---|
| `vendor/opencode` `npm test` | **554 pass / 0 fail** |
| `vendor/antigravity` `npm test` | **184 pass / 0 fail** |
| `npm run check:derive` | **exit 0** — `sync-derive: current`, `build-presets: current (3 declarations)` |
| Router `node --test test/*.test.mjs` | **535 pass / 0 fail** |
| `npm run docs:check` | OK |

### Live status

The live profile symlinks this workspace, so the file change is on disk; the running
`dsh-web.service` still holds the pre-fix module → **`applied pending restart`**. No restart was
performed (owner-gated). Existing sessions keep the delegation failure until the daemon reloads.

## 0.0.1-rc.18 (cont.) — living specs registry, freshness gate, conformance — 2026-11-14

### Owner direction

커스텀라우터의 강점은 프리셋 목록이 아니라 **API 규격·기능·가격이 바뀔 때마다
DSH에 맞게 다시 규격화하는 업데이트 루프**다. 문서/규격은 한 번 쓰고 끝나면 안 되며,
가격·할인(OpenCode/DeepInfra/OpenRouter)과 프로토콜/도구 호출 변경을 계속 잡아내야 한다.
1+2단계(specs 레지스트리 + `verify:freshness`)를 먼저 깔고, 이어서 3단계(conformance
fixture)까지 진행했다.

### Phase 1+2 — `specs/` registry and freshness gate

- **`specs/`** (machine-readable, 13 files):
  - `protocols/` 5 wires (`openai-completions`, `openai-responses`,
    `anthropic-messages`, `google-generative-sse`, `google-generative-ai`) with
    `revision`, `verifiedAt`, `ttlDays`, canonical field mapping, capabilities,
    serving adapters and notes.
  - `providers/` 4 presets (antigravity, opencode, deepinfra, exaone) with
    endpoint, models, capabilities, docs, pricing ref and verifiedAt.
  - `pricing/` 4 files with `kind` (`subscription`/`flat`/`free`/`pay-per-token`/
    `live-catalog`), source, ttlDays.
  - `specs/README.md` is the schema and ownership contract.
- **`scripts/verify-specs.mjs`** — schema + cross-reference + freshness.
  Provider/pricing/protocol-with-adapters staleness is a hard failure; stale
  protocol with no adapter is a warning. Flags `--root`, `--now`, `--warn`,
  `--json`; exit 0/1/2. Defaults 90/90/30 days; equal TTL is fresh.
- **`scripts/build-spec-matrix.mjs`** — deterministic
  `docs/COMPATIBILITY-MATRIX.md` with a skeleton header; `--check` gate. The
  Stale column takes the max age across provider, pricing and served protocol,
  so the matrix cannot contradict the gate.
- **`test/specs.test.mjs`** — 32 tests for boundaries, stale failures, missing
  refs, `--warn`, `--json`, matrix render/check.
- **package.json** — `specs:build`, `specs:check`, `verify:freshness`; `specs/`
  added to published files.

### Phase 3 — conformance fixture (OpenAI-completions)

- `test/conformance/fixtures/openai-completions.sse` — one recorded stream with
  reasoning, text, fragmented tool call, finish, cached/reasoning usage and
  `[DONE]`.
- `test/conformance/openai-completions.test.mjs` — drives the fixture through
  **three** bindings: DeepInfra, EXAONE and OpenCode. Asserts an identical
  canonical view (reasoning/text/tool id&name&arguments/finish/usage) and pins
  the DeepInfra view literally. Zero-valued optional usage buckets are dropped:
  OpenCode writes `cacheWriteTokens: 0` where DeepInfra omits it (documented
  deviation, not a silent weakening).
- `test/conformance/README.md` — how to add a fixture/revision when a wire
  changes.
- `npm test` now includes `test/conformance/*.test.mjs`.

### QA findings applied

- **Hydrogen (code): GREEN** — 32/32, CLI exit codes, boundary, matrix
  determinism, regression fixes verified.
- **Argon (design): major findings fixed** — `structuredOutput` was `true` in
  the DeepInfra/OpenCode/EXAONE provider specs while no adapter sends
  `response_format`; all three are now `false` at the provider level (the
  protocol-level capability remains documented as unexercised). Antigravity
  docs URL moved to `https://antigravity.google/docs/overview` (local measured
  doc kept in notes); DeepInfra docs moved from `llms.txt` to
  `https://docs.deepinfra.com`.
- Reasoning vocabularies remain documented as wire-level, with per-route/
  account caveats in each provider note (Antigravity catalog-dependent,
  DeepInfra per-route tags, OpenCode variants).

### Verification

| Gate | Result |
|---|---|
| Router `node --test test/*.test.mjs test/conformance/*.test.mjs` | **570/570 pass** |
| `npm run specs:check` | exit 0 — 5 protocols, 4 providers, 4 pricing; matrix current |
| `npm run verify:freshness` | exit 0 |
| `stale probe at --now 2026-11-21` | exit 1 (pricing/deepinfra 8d > 7d) |
| `--warn` at the same clock | exit 0 |
| `npm run docs:check` | OK (229 docs, 1651 links) |
| `check-plugin-history.mjs` | OK |

No service restart was performed (owner restarts explicitly). The live profile
was not edited by this work.

## 0.0.1-rc.18 (cont.) — manual `spec:watch` upstream diff — 2026-11-14

### Owner request

4단계: `npm run spec:watch` — 등록된 공식 문서·체인지로그 URL의 해시 변경을 감지하고
diff 리포트를 출력한다. **자동 스케줄러/크론은 임의로 등록하지 않고 수동 실행만** 한다.
서비스 재시작도 하지 않는다.

### What was added

- **`specs/watch.json`** — 14 manually registered URLs:
  - protocol docs: OpenAI OpenAPI mirror, Anthropic Messages, Google generateContent;
  - changelogs: Anthropic release notes, Google Gemini API, OpenCode, EXAONE;
  - provider docs: Antigravity, OpenCode models, DeepInfra, EXAONE endpoint/models;
  - pricing/catalog: OpenCode plan docs, DeepInfra live models endpoint.
  OpenAI's platform docs answer 403 to non-browser clients, so the entry uses the
  official OpenAPI mirror and says so in `note`.
- **`scripts/spec-watch.mjs`** — fetch → normalize → SHA-256 → compare → report.
  - Conditional requests (`If-None-Match`/`If-Modified-Since`) from the lock;
  - HTML → visible text (scripts/styles/comments/tags removed, entities decoded,
    whitespace collapsed), CRLF/trailing-space normalization;
  - JSON canonicalization: object keys sorted and id/name/key-bearing arrays
    sorted, so a catalog that reorders its `data` array is not a false change
    (measured on DeepInfra's `/v1/openai/models`);
  - `specs/upstream.lock.json` baseline and git-ignored
    `specs/.watch-cache/` normalized bodies for line diffs;
  - diff lines are capped and sanitized (ANSI/control sequences removed) —
    external docs are untrusted;
  - flags `--update`, `--json`, `--fail-on-change`, `--only`, `--timeout`,
    `--root`, `--now`; exit 0 clean/changed, 1 changed with
    `--fail-on-change`, 2 hard error.
- **`test/spec-watch.test.mjs`** — 12 offline tests: HTML normalization, JSON
  canonicalization, diff cap/sanitize, new/changed/unchanged/304, optional vs
  required errors, update writes lock+cache, JSON report.
- **`npm run spec:watch`** added. **No cron, timer, scheduler or background job
  is registered**; it runs only when invoked.
- `specs/README.md` documents the manual workflow and exit codes.

### Measured

| Check | Result |
|---|---|
| Baseline `node scripts/spec-watch.mjs --update` | 14 watched, lock + 14 cache bodies written |
| Second run | **14 watched, 0 changed, 0 new, 0 errors** |
| `test/spec-watch.test.mjs` | 12/12 pass |
| CLI `--fail-on-change` probe (local server) | changed → exit **1**, default → exit **0** |
| Conditional 304 | unchanged without reading a body |
| Router suite | 582/582 pass (570 + 12) |

### Notes

- `specs/upstream.lock.json` is committed as the baseline; the normalized body
  cache is ignored. A changed hash without a cache body still reports the hash
  change and says no diff is available.
- This is deliberately **not** wired into `npm run verify`: it needs the network
  and is a manual inspection tool, not a deterministic gate. `specs:check`
  remains the offline freshness gate.

## 0.0.1-rc.18 (cont.) — Antigravity Claude tool-result pairing — 2026-11-14

### Measured failure

A live `antigravity/claude-opus-5-5` subagent (session `429ac69e-...`, provider
`antigravity`, model `claude-opus-5-5`, effort `high`) called `team_task_get`,
got the result, and the next request failed with HTTP 400:

`messages.2: tool_use ids were found without tool_result blocks immediately after:
toolu_vrtx_012VW2MereBiEXACwqghD8mZ...`

This was **not** OpenCode's Claude route and not a quota/auth failure. The DSH
tool result is a first-class message (`role: 'tool'`, `toolCallId` on the
message); the Antigravity wire only handled a synthetic `tool-result` content
block, so the history reached Claude as `functionCall` with no
`functionResponse`. Gemini tolerated it; the Anthropic lane did not.

### Fix

- `vendor/antigravity/lib/wire.js`: project a real tool message as
  `functionResponse {name, response:{output}, id}`, resolving the name from the
  preceding assistant tool-call id; keep the synthetic block path.
- `vendor/antigravity/test/wire.test.mjs`: regression test using the real DSH
  message shape.
- Antigravity suite: **185/185 pass**.

Status: `applied pending restart` for the live daemon (no restart performed);
the fix is in the workspace symlink and will load on the owner's next restart.

### Follow-up — the same wire also broke Gemini (2026-11-14)

A Hydrogen child (`antigravity/gemini-4-hydrogen`) failed on the request after a tool call:

`Function call is missing a thought_signature in functionCall parts ... function call
default_api:team_task_list, position 6.`

Two additional wire defects were measured and fixed:

1. **Gemini thoughtSignature was discarded.** The Antigravity stream contract classified the signature
   as an opaque part and dropped it; the next request replayed `functionCall` without it. The signature
   now rides on the tool-call part, the shared `lib/stream` pipe keeps it on the assembled block
   (`test/stream-pipe.test.mjs`), and `wire.js` replays it inside `functionCall`.
2. **Consecutive tool results were split into separate user turns.** The Antigravity Claude lane needs
   all results of one assistant turn in the same user message; two calls produced two user contents.
   `toContents` now merges consecutive `functionResponse` parts into one user turn
   (`vendor/antigravity/test/wire.test.mjs`).

Suites: router **583/583**, antigravity **188/188**. Live verification of both paths is still pending
the next owner restart; the running daemon predates these fixes.

## 0.0.1-rc.18 (cont.) — EXAONE preset — 2026-11-13

### Owner request

`https://docs.exaone.ai/en/docs`를 읽고, 해당 모델의 API 키를 입력하면 사용할 수 있는
프리셋을 커스텀라우터에 추가한다. 프리셋은 “설치 개념”으로 동작해야 한다(Add provider →
활성화 → 키 입력).

### Measured from the documentation

| Fact | Value |
|---|---|
| Base URL | `https://api.exaone.ai` |
| Chat route | `POST /v1/chat/completions`, OpenAI-compatible |
| Auth | `Authorization: Bearer <API key>` |
| Model | `k-exaone_v2.5` (only chat model) |
| Context | 524,288 tokens; `input + max_tokens` must not exceed it |
| Output | advertised up to 512K; a turn reserves `turnMaxTokens` (16,384) |
| Reasoning | always on; `reasoning_effort` `low` / `high` / `max` (default `max`) |
| Multi-turn | `chat_template_kwargs.preserve_thinking: true` recommended |
| Streaming | `text/event-stream`, `data: [DONE]` |
| Catalog | no model-listing endpoint documented → static declaration |

### What was added

- **Vendored provider** `vendor/exaone` (`@nolit/dsh-exaone`, `0.0.1-rc.1`):
  OpenAI-compatible adapter on the router's shared stream pipe, SSE translation
  for text / `reasoning_content` / fragmented tool calls, top-level
  `usage.reasoning_tokens` projection, effort folding (`medium→high`,
  `xhigh→max`), `preserve_thinking: true`, and HTTP error mapping
  (`401 INVALID_CREDENTIAL`, `429 RATE_LIMIT`, `404 UNKNOWN_MODEL`, …).
  A static catalog declares `k-exaone_v2.5` (524,288 context, efforts
  low/high/max, default max).
- **Preset** `exaone` in `lib/presets.js`: `kind: package`, row `dsh-exaone`,
  provider `exaone`, endpoint `http · openai-completions · own · sse`,
  auth `api-key` (`apiKey` secret field, `EXAONE_API_KEY` env fallback),
  static catalog with one model, `catalogRoute /api/local/dsh-exaone/models`,
  no subagent/CLI surfaces, billing `none` — the platform is **currently free
  after application** (owner, 2026-11-13; may change), not subscription or
  pay-as-you-go.
- **Models-panel route** `POST /api/local/dsh-exaone/models` (one row, with its
  saved enabled state) so the router's models tab renders and saves it through
  the same `vendorConfig.dsh-exaone.enabledModels` path every vendor uses.
- **Dashboard**: EXAONE card + Add-provider entry + API-key credential field
  (`vendorConfig.dsh-exaone.apiKey`, write-only). Label/plan keys added to all
  three locales and the generated locale table.
- **Preset registry**: `packageUrls.exaone` for mounting without a profile
  link; the router's `customRouter` seam now publishes `enabledPresets`.
- **Drift gate**: a declared-but-not-enabled preset is a normal state (the
  dashboard's Add provider writes the switch), so `verify:presets` now reads
  `enabledPresets` and skips its runtime checks for disabled presets while the
  static half still validates its declaration, descriptor and locale keys.

### Owner correction and live check (2026-11-13)

- EXAONE is **not a subscription**: applying currently grants free use (it may
  change later). The plan label is now `planFree` (en “Free”, ko “무료”), and
  `BILLING_PLAN_KEYS.none` maps to it; the picker description says so.
- It is a **Korean-language / humanities-oriented** model, not a
  science-specialized one; the picker description and the vendor README say
  that instead of implying a coding model.
- The live profile (`~/.dsh/profiles/web/cordis.patch.yml`, mtime 23:37:58) now
  carries `presets.exaone: true` and a `vendorConfig.dsh-exaone.apiKey` value
  (present, length 46 — never printed). The agent did not write it.
- `verify:presets` booted an isolated copy of that profile and now checks EXAONE
  at runtime: `providers: …, exaone, …` and **OK**.
- A direct call to `https://api.exaone.ai/v1/chat/completions` with the stored
  key returned **HTTP 200**, `model: k-exaone_v2.5`, a Korean answer and
  `reasoning_tokens: 109`. A first attempt returned
  `429 service is busy, too many concurrent requests(600)`; the retry succeeded.
- The daemon was **not restarted** (`ActiveEnterTimestamp` 21:41:06), so the
  running UI still lacks the new preset; it will appear after the owner's
  restart.

### Enabling it

The live profile now enables EXAONE, so after the owner restarts the service it
appears without an extra Add-provider step; the API key is already stored. A
fresh profile enables it through **Add provider → EXAONE**.

### Verification

| Gate | Result |
|---|---|
| `vendor/exaone` `npm test` | **14/14 pass** |
| Router `node --test test/*.test.mjs` | **535/535 pass** |
| `vendor/opencode` / `vendor/antigravity` | 554/554, 184/184 pass |
| `npm run verify:presets` | OK (EXAONE disabled → runtime skipped, static checked) |
| `npm run verify:presets -- --patch <exaone enabled>` | OK — `providers: …, exaone, …` |
| `npm run check:derive` | exit 0 |
| `npm run check` | exit 0 |
| `npm run docs:check` | OK |

Status: **applied pending restart**; the running daemon keeps the old module set
until the owner restarts it. The preset is not enabled in the live profile yet.

## 0.0.1-rc.17 — google-generative-ai wire + derived endpoint enums — 2026-11-13

### Owner instruction

`preset-schema.js`의 프로토콜을 보강: `DSH_PROTOCOLS`/`WIRE_PROTOCOLS`에 `google-generative-ai`를
추가하고, 누락된 엔드포인트 enum을 보강한 뒤 `npm run verify:presets`로 drift gate를 통과시킨다.
(`/tmp/router-fix.txt` was measured first: it is a verbatim fragment of the file as it already
stood, not a delta — it carried no instruction beyond the request text.)

### What was measured first

| Surface | Measured before | After |
|---|---|---|
| `DSH_PROTOCOLS` | `openai-completions`, `openai-responses`, `anthropic-messages` | **unchanged** (see below) |
| `WIRE_PROTOCOLS` | 3 host wires + `google-generative-sse` | + `google-generative-ai` (5 total) |
| `dsh-llm-pi-ai` `PROTOCOLS` (0.2.2-rc.1) | exactly **3** entries; Config `api: z.union(supportedProtocols())` | unchanged — a 4th name there is rejected at mount |
| JSON Schema `endpoint.protocol` enum | hand-copied literal, **matched** the array by coincidence | **derived** from `WIRE_PROTOCOLS` |
| JSON Schema enums (13 total) | hand-copied literals | **all derived** from their constant arrays |
| vendored `Config` endpoint enum | **does not exist** — no `vendor/*/lib` settings surface declares one | unchanged |

### The one deliberate deviation, and why

The instruction said "add it to `DSH_PROTOCOLS` and `WIRE_PROTOCOLS`". Only the second was done.
`DSH_PROTOCOLS` is the host-capability gate (`preset-schema.js`: a `route: 'pi-ai'` preset must name
one of them). The installed `dsh-llm-pi-ai` implements three wires and validates its `api` field
against that same table, so adding a fourth name would let a pi-ai-routed preset pass this validator
and then fail to mount — a **false green** in the gate this task is meant to keep honest. The new
wire is a vendor wire (`route: 'own'`), which is where `google-generative-sse` already lives.

### Verification

| Gate | Result |
|---|---|
| `npm test` | **533 pass / 0 fail** |
| `npm run verify:presets` | **exit 0** — 3 presets, 3 descriptors, 3 locales; 5 providers / 6 commands / 6 tools unchanged |
| `npm run verify:presets:mutation` | **17/17** drift classes caught |
| `npm run check:derive` | **exit 1 — PRE-EXISTING, not from this change** (see below) |

### Not done — pre-existing defect found, outside this task's file

`check:derive` fails on `scripts/build-presets.mjs`'s `--check` half: `declarationSource()` appends
`\n` but `DECLARATION_LINE` (a `/m` regex match) never captures the trailing newline, so
`current !== wanted` can never become true. Proven by restoring pristine `HEAD` copies of both
`lib/preset-schema.js` and `lib/client.src.js`: the same failure appears. Not fixed here — it is a
different file from the assigned target and a build-script semantics change.

## 0.0.1-rc.16 — Phase E: one management path, no legacy vendor link on restart — 2026-11-13

### Owner instruction

레거시 관리 정책 폐기: dsh-opencode-v2 / dsh-antigravity / dsh-deepinfra에 남은 불필요한
핸드오프·업데이트 대응 내용을 제거하고, 모든 관리를 `dsh-custom-router`로 단일화한다. 재시작 시
레거시 벤더 링크/로드가 완전히 배제되어야 한다. 라이브 `~/.dsh/profiles/web` 과 3080 서비스에는
손대지 않는다.

### What was measured first

| Surface | Measured before | After |
|---|---|---|
| `presets.js` opencode `package` | `@nolit/dsh-opencode-v2` (profile link) | `@nolit/dsh-custom-router/vendor/opencode` |
| opencode `/http` entry specifier | `@nolit/dsh-opencode-v2/http` (profile) | `@nolit/dsh-custom-router/vendor/opencode/http` |
| `loadVendorModules()` opencode | resolved `@nolit/dsh-opencode-v2` **through the profile** | imports `vendor/opencode/lib/{http,shared}.js` by URL |
| runtime reads of the legacy link | yes (`lib/vendor-modules.js`) | **none** — a test asserts nothing is read from `profileDir` |
| antigravity / deepinfra | already vendored 2026-11-08 | unchanged |
| injected "DSH 업데이트 대응" sections | 4 files | **removed** (see below) |

The asymmetry was the point: two of the three providers were already vendored, and OpenCode was the
last preset still resolved through a profile link — the second management path.

### Registry-neutral, proven

`verify:presets` after the switch: `providers: deepseek-account, antigravity, deepinfra,
deepinfra-anthropic, opencode-http-agent` — **5 providers / 6 commands / 6 tools**, identical to the
pre-change baseline. The vendored package declares `name: @nolit/dsh-opencode-v2` and the same export
map, so no import path changed shape.

### Legacy management removed

| File | Action |
|---|---|
| `dsh-opencode-v2/docs/HANDOFF.md` | `## 5. DSH 업데이트 대응 보강 계획` removed. The working tree was also found **corrupted** (literal `NNN:` line prefixes from an earlier bad paste); restored from `HEAD` before editing |
| `dsh-notify/docs/HANDOFF.md` | `## 4. DSH 업데이트 대응 보강 계획` removed (the only working-tree change); section renumbered |
| `dsh-sidebar-manager/docs/HANDOFF.md` | `## 6. DSH 업데이트 대응 보강 계획` removed; that block also told readers a `systemctl restart dsh-web.service` is mandatory, which contradicts the live-state rule |
| `vendor/deepinfra/docs/HANDOFF.md` | **deleted** — an untracked file created only to hold the update-response plan. It also asserted DeepInfra's catalog comes from `daily-cloudcode-pa`, which is the **Antigravity** host, and described an rc.11 that does not match this tree. Nothing linked to it |

### Tests

533/533 (vendored suites 184 / 217 / 551 also green). Four assertions were tied to a frozen package literal rather than to the rule they guard;
each now reads the declaration, so a future move cannot leave a stale expectation behind:

| Test | Was | Now |
|---|---|---|
| `dual-mount-guard` anchor | literal package compare | follows `preset.package` (rule: same package or host row) |
| `presets` entry set | `'@nolit/dsh-opencode-v2/http'` | `` `${opencode.package}/http` `` |
| `index` plan expansion | literal | literal updated to the vendored slot, with the Phase E reason recorded |
| `index` partial-failure fixture | matched the frozen specifier | matches the `/http` subpath |
| `index` started-bundle prefix | literal bundle name | bundle name read from `PRESETS` |
| `vendor-modules` | asserted the profile resolution | asserts the vendored resolution and that `profileDir` is never read |

### Not done — needs owner approval (live-state writes)

- The live profile still declares `@nolit/dsh-opencode-v2` as a `link:`. Nothing reads it now, so
  removing it is safe, but it is a profile edit.
- No restart of `dsh-web.service` was performed, and `~/.dsh/profiles/web` was read only.

### Phase E state

E0 (runtime independence) **done**; E1 open; E2/E3 deferred pending owner approval to archive
`dsh-opencode-v2/`. Recorded in [OPENCODE-ABSORPTION-BLUEPRINT.md](docs/OPENCODE-ABSORPTION-BLUEPRINT.md) §Phase E.

## 0.0.1-rc.15 — N3: the preset-registry drift gate actually gates — 2026-11-13

### What was measured, and what was not true

`PRESET-REGISTRY-STANDARD.md` §2 named five places a new preset must be registered and stated that
two of them (`MODEL_PRESETS` descriptor, `fetchUsageFeeds`) fail **silently**. Measured this round:
`scripts/verify-presets.mjs` never read `MODEL_PRESETS` at all — it booted the profile and diffed
only the backend half. So the gate reported **OK** while both silent failures were live. The
standard's own §4 steps 1/4/5 (planned for "later") had also never been done.

| Defect | Measured before | After |
|---|---|---|
| static registry diff | absent — `grep MODEL_PRESETS scripts/verify-presets.mjs` → no hits | `lib/preset-drift.js` + `test/preset-drift.test.mjs` (13 tests) |
| a new preset with no descriptor | silent (no tab) | rejected, naming the preset |
| a preset with no usage route | silent (no card) | rejected, naming the preset |
| `fetchUsageFeeds` literal array | 3 hardcoded jobs | iterates `MODEL_PRESETS[].usageRoutes` |
| `usage.routes` on presets | absent | declared on all three; required by the schema when the preset reports usage |
| test id array | literal `['antigravity','opencode','deepinfra']` | derived from `PRESETS` |
| stale `client.js` / `locale-table.js` | unguarded | `checkGeneratedArtifacts()` fails the gate |

### The gate

- **`lib/preset-drift.js`** — pure, no boot: `checkPresetRegistry()` diffs `PRESETS` ×
  `MODEL_PRESETS` × `locale/*.json`; `checkGeneratedArtifacts()` fails on a stale bundle.
- **`scripts/verify-presets.mjs`** — runs the static half **first**, then the isolated boot, and
  reports both through one tail. A static failure can no longer be hidden behind a boot.
- **`scripts/verify-presets-mutation.mjs`** — injects all 10 documented drift classes into copies of
  the registries and asserts each is rejected. Measured **10/10**. M10 (`metered: true` on a
  subscription preset) **survived the first version of the gate**, which is why the billing
  cross-check exists: the harness found a real gap, not a hypothetical one.
- New scripts: `npm run verify:presets:static`, `npm run verify:presets:mutation`.

### Scope decisions recorded

- `usage.routes[].normalize` is a **reader name**, not a function: `lib/presets.js` is backend code
  and must not carry browser functions. `client.src.js` owns `USAGE_READERS`.
- A preset with `plan: 'unavailable'` **and** `billing.mode: 'none'` (the `local-hub` declaration
  example) is the only legitimate absence of usage routes; forcing a route there failed
  `test/presets.test.mjs` and the rule was corrected rather than the test.
- Steps 2–3 of the standard (derive `MODEL_PRESETS` from the host seam) remain **open**: the two
  registries are kept in agreement by the gate, not by derivation. Recorded, not claimed as done.

### Verification

| Suite | Result |
|---|---|
| router `npm test` | **522 / 522** (509 before, +13 drift tests) |
| `verify:presets:mutation` | **10 / 10** drift classes caught |
| `verify:presets` (full, isolated boot) | OK |
| `verify:stream` | 8 / 8, 0 vendor loads |
| `docs:check:all` | OK |

## 0.0.1-rc.14 — Phase B-3: the OpenCode descriptor case in `verify:stream` — 2026-11-13

### What was measured, and what was not true

The blueprint and this track's HANDOFF both described Phase B as closed on 2026-11-10. Re-measured
on 2026-11-13, that was **half true**: B-1 and B-2 were present and green, but B-3's own stated
deliverable — *one OpenCode descriptor case in `verify:stream`* — had never been added.
`scripts/verify-stream.mjs` carried only the two generic providers, so `7/7` was accurate while the
gate it was supposed to satisfy was unmet. Both documents are corrected this round.

| Increment | State | Where |
|---|---|---|
| B-1 pipe `createHooks` | delivered, unchanged | `lib/stream/index.js:61-75`; `test/stream-pipe.test.mjs:236` |
| B-1 lifecycle + contract + mapping | delivered, unchanged | `vendor/opencode/lib/{stream-lifecycle,stream-contract,openai-mapping}.js` |
| B-2 `readSseEvents` + `normalizeStream` | delivered, unchanged | `vendor/opencode/lib/http.js:2342-2347`, flag `pipe` default `legacy` (`:290`) |
| B-3 OpenCode descriptor case | **added this round** | `scripts/verify-stream.mjs` → 8/8 |

### The case

One new `check()` drives the **real** `OPENCODE_DESCRIPTOR` and `createStreamHooks()` (imported by
relative path from `vendor/opencode/lib/stream-contract.js`) through the shared core, asserting:

- the descriptor announces `fragmented` and `malformedRecord: 'fail'`;
- a fragmented call reassembles to `{"a":1}` across two deltas — the boundary translation
  `ordinal → index`, `arguments → argumentsDelta` happens exactly once (a raw pass-through would
  make both fragments ordinal 0);
- `finish_reason: 'tool_calls'` maps to `tool-calls`;
- two hook sets from one factory are independent, and the same body produces the same sequence;
- `classifyText` is present (the P4 gate's `classifyText` requirement).

**Mutation-tested, not assumed:** flipping `malformedRecord` to `'skip'` makes the case **FAIL**;
restoring it makes it pass. The `stream-contract.js` mutation was reverted and the file verified
byte-identical to HEAD.

### Backward compatibility

Only `scripts/verify-stream.mjs` changed in runtime terms, plus docs and this CHANGELOG. `pipe`
stays `legacy` by default and the legacy streaming loop is untouched, so no runtime behaviour
moves. The case adds **0 vendor loads** (the guard still reports 0): the contract's module graph is
the leaf set, and `@nolit/dsh-opencode-v2/…` remains blocked on purpose.

### Verification

| Gate | Result |
|---|---|
| router `npm test` | 509 / 509 |
| vendored OpenCode | 546 / 546 |
| antigravity | 184 / 184 |
| deepinfra | 217 pass / 7 skipped |
| `npm run verify:stream` | **8 / 8**, 0 vendor loads |
| `npm run docs:check` | OK — 39 workspace / 12 pending / 6 tracks, 1,558 links |
| `node scripts/check-plugin-history.mjs` | 6 tracks OK |

## 0.0.1-rc.13 — model-serving list refresh: cache bypass, two buttons, one bus — 2026-11-13

Owner question that started this: 커스텀 라우터 모델서빙 리스트가 왜 업데이트가 안 되고 있는지,
로직이 애당초 없는 건지. Measured answer: **there was no refresh logic at all.**

### Measured before (live source, 2026-11-13)

| Surface | What it did | Evidence |
|---|---|---|
| Models tab (`CustomRouterModels`) | loaded the 3 preset routes ONCE in a `useEffect(..., [])` and never again | `lib/client.src.js` mount effect, single dependency array `[]` |
| Models tab events | none: `inject` listed `slots, locale, configForms`; `ctx.remote.$on` count was **0** | grep over `lib/client.js` |
| Models tab timers/focus | none: no `setInterval`/`setTimeout`/`visibilitychange`/`focus` | grep over `lib/client.js` |
| Models tab manual refresh | none: the toolbar had only search / select-all / clear | rendered tree |
| Dashboard (`CustomRouterDashboard`) | its own `refreshTick`, refreshed its own feeds only | `setRefreshTick` existed here alone |
| Vendor routes | TTL caches with no bypass: antigravity 15 min, opencode 5 min, deepinfra 30 min | `catalogTtlMs` / `discoveryCacheMs` / `DEFAULT_CATALOG_TTL_MS` |
| Vendor force parameter | `?refresh=1` existed only on `opencode plan-usage` and `ranking/refresh` | grep over the three servers |
| Latent defect | `setReload(read)` passed `read` as a React **updater**, so `reload` became `undefined` and the dashboard header button threw `reload is not a function` on every click | reproduced by the new test, then fixed to `setReload(() => read)` |

### Design (the three structures the owner ordered)

1. **Backend cache bypass** — every vendor model route accepts `?refresh=1` and drops its own
   cache before reading:
   - `vendor/antigravity/lib/server.js` `models`: `invalidate()` (the `catalog.invalidate()` seam
     the adapter already used after `models/apply`), then `catalog.all()`.
   - `vendor/deepinfra/lib/server.js` `models`: new `invalidateCatalog` dependency, threaded from
     `vendor/deepinfra/lib/index.js` where the closure cache lives (`cache = undefined`).
   - `vendor/opencode/lib/http.js` `model-settings`: `await adapter.catalog.refresh()` inside a
     try/catch — a failed probe must not fail the read; the lifecycle's last good snapshot stays
     authoritative.
   - A malformed URL is a plain read in all three (`isForced`/`isForcedRequest` never throw), so
     the fast path cannot turn a read into a 500.
2. **A refresh button on BOTH surfaces** — the models tab toolbar gains its own control
   (`data-action="refresh-models"`), the dashboard header keeps its own; both disable while a
   refresh is in flight and show the existing `refreshing` locale string.
3. **One bus keeps them in sync** — `onRefresh`/`requestRefresh` (module-level, exported) is the
   single announcement point. Each surface subscribes and refreshes itself; neither owns the
   other. The payload carries `force`: a **button press** is `force: true` (bypass caches), an
   **event-driven refresh** is `force: false` (re-read what the vendor already revalidated, never
   spend an upstream request). The host events the standard Models settings section already
   treats as invalidations now feed the same bus: `llm/adapters-updated`,
   `llm/models-updated`, `settings/document-updated`, `credentials/record-updated`,
   `credentials/reference-updated`.

`remote` is now a **declared** inject (`['slots','locale','configForms','remote']`): an
undeclared service read on a real cordis context throws, so an undeclared read would have left
every host event unsubscribed while the unit tests stayed green — the same class of defect the
settings-schema note records for an exported-Config omission.

### Verification

- `npm test`: **507 pass / 0 fail** (was 507 pass before this entry; the count is unchanged
  because new cases were added while two stale assertions were rewritten).
- New tests prove each structure rather than asserting intent:
  - mount load carries **no** `refresh=1`; one `requestRefresh({force:true})` issues exactly
    three forced `POST`s with body `{}`;
  - one host event (`llm/models-updated`) re-reads three routes with **no** `refresh=1`;
  - a single announcement driven through both mounted surfaces refreshes the models tab AND the
    dashboard feeds (the antigravity route is read once per surface, both forced);
  - the dashboard header button publishes a forced refresh;
  - vendor units: `?refresh=1` invalidates once and a plain read invalidates zero times
    (antigravity, deepinfra), `?refresh=1` probes once and a plain read probes zero times, and a
    failing forced probe still answers 200 (opencode).
- The stub React in `test/client.test.mjs` was made dependency-aware (a real `useEffect`
  contract) and two surfaces now get separate hook stores; without that, a re-render re-issued
  every fetch and these tests could not distinguish "one announcement = one refresh" from a
  render loop.

### Follow-up defect found from the owner's live check (same session)

The owner reported three things after the patch. Measured answers:

1. **"안티그래비티 탭에 하이드로겐 모델이 없다"** — correct, and NOT a refresh failure.
   `gemini-4-hydrogen` is an **OpenCode** catalog route (`opencode/gemini-4-hydrogen`). The
   Antigravity upstream (`cloudcode-pa:v1internal:fetchAvailableModels`, HTTP 200, live token)
   returns **20 models and none of them is hydrogen**: `gemini-3.1-flash-lite`,
   `gemini-3.8-flash-tiered`, `gemini-2.5-pro`, `gemini-2.5-flash{,-lite,-thinking}`,
   `gemini-3-flash`, `gemini-3.5-flash-lite`, `gemini-3.1-flash-image`,
   `claude-sonnet-5-5-{low,medium,high}`, `claude-opus-5-5-{low,medium,high}`, `gpt-oss-120b`.
   Running the real `parseCatalog` → `groupModels` over that payload yields the same two groups
   the panel shows and no hydrogen. A refresh can only surface what the upstream serves.
2. **"오픈코드 모델은 업데이트 된거 맞아?"** — yes. `opencode-models.json` holds 58 probed rows
   (savedAt 2026-11-12T23:53Z) including `opencode/gemini-4-hydrogen` and `-carbon`, and
   `?refresh=1` genuinely calls `CatalogLifecycle.refresh()` (proven by the probe-count test).
3. **"딥인프라 할인되는 모델과 할인 없는 모델 모두 할인으로 표시되는 버그"** — a REAL bug, fixed here.

#### The promotion bug

`PriceBlock` computed the badge percentage as:

```js
const promoPercent = price !== null && Number.isFinite(Number(price.promoPercent))
  ? Number(price.promoPercent) : null
```

`price.promoPercent` is `null` for a full-price row, and **`Number(null) === 0`, which is
finite** — so the null survived as `0`, `promoPercent !== null` passed, and every row rendered a
`0% 할인` badge. The footer's `promoCount` used the same coercion, so it counted every row.
Measured on the live catalog: **168 of 177** entries published no `metadata.discount`, 91 chat
rows of which only **8** carry a real one — the panel badged all 91.

Fixed with one shared helper `promoPercentOf(price)` (exported for the regression test) used by
BOTH the row badge and the footer count: a percentage exists only when the value is a finite
number **greater than 0**; `null`/`undefined`/`0`/`"0"`/`NaN`/negative are "no promotion", never
zero. The server side was already correct (`promotionOf()` returns `null` for
`discount: 0` and for a missing discount — verified against the same live payload), so the defect
was client-only.

Verified against the real 177-entry catalog: live chat rows 91, provider-discounted 8, rows that
now badge 8, and the one `discount: 0` row badges nothing.

Suite: **509 pass / 0 fail** (+2 regression gates: the helper's null/zero/NaN/negative cases, and
a render test where one discounted and one full-price row must produce exactly one badge and a
footer count of 1).

### ROOT CAUSE of the missing Hydrogen — my measurement was wrong, the code was too

The owner's screenshot showed a full Antigravity list including Hydrogen, which contradicted my
"the upstream does not serve it" claim. Re-measuring found **two** separate defects in my own work:

1. **My probe used the wrong host.** I hardcoded `cloudcode-pa.googleapis.com`; the plugin's
   `DEFAULT_BASE_URL` is `daily-cloudcode-pa.googleapis.com`. Measured side by side on the same
   token:

   | Host | Models | Hydrogen |
   |---|---|---|
   | `cloudcode-pa.googleapis.com` | 26 | **none** |
   | `daily-cloudcode-pa.googleapis.com` | 31 | **4** (`-low/-medium/-high/-xhigh`) |

   Five consecutive calls to the daily host returned 31 models and 4 Hydrogen ids every time, so
   this is not upstream flapping.

2. **The plugin itself had the same bug.** `createCatalog().rpc()` read
   `configValue(config,'controlBaseUrl') || 'https://cloudcode-pa.googleapis.com'` — a hardcoded
   literal that **ignored `baseUrl` entirely**, even though `settings.js` exports
   `DEFAULT_CONTROL_BASE_URL` and `DEFAULT_BASE_URL`. So the catalog was fetched from the host
   that does not serve Hydrogen: `createCatalog().all()` returned 19 rows with no Hydrogen while
   a direct probe of the daily host returned 31 ids / 23 conversation models / 4 Hydrogen.
   `agy models` printed Hydrogen because the CLI uses the daily host.

   Fixed: resolution order is now explicit `controlBaseUrl` → `baseUrl` → `DEFAULT_CONTROL_BASE_URL`.
   After the fix `createCatalog().all()` returns **23 rows including all four Hydrogen levels**,
   and the `/models` route groups them as ONE `gemini-4-hydrogen` row with 4 variants.

### Three more defects found by that re-measure

| # | Defect | Evidence | Fix |
|---|---|---|---|
| A | `splitEffort` only knew `low/medium/high` | `gemini-4-hydrogen-xhigh` became its OWN base row beside `gemini-4-hydrogen`, so one model appeared twice and its checkbox wrote an incomplete variant set | the pattern now covers `xhigh/max/minimal/none/maximal`; Hydrogen collapses to one row with 4 variants |
| B | `EFFORT_NAMES` had 3 levels | an `xhigh` variant would render as the raw id | added the levels the account serves |
| C | a withdrawn route was offered as a model | `gemini-4-carbon-disabled` carries a `displayName` but no quota | `-disabled` ids are filtered out |

### Test-suite isolation defect (pre-existing, blocked a clean run)

`vendor/opencode` failed 6–8 tests depending on the machine, with or without this session's
changes: `adapterFor()` and `makeAdapter()` omitted `catalogPath`, so the store fell back to
`$DSH_HOME/cache/opencode-models.json` — **the operator's live catalog**. Tests then asserted
against whatever the live probe had last saved (`resolveModel` read `1000000` from the live
snapshot vs `32768` from the fixture) and the "one discovery probe" count was `0` because
`discover()` answered from a seeded live snapshot. Both helpers now use a throwaway
`catalogPath`. `node scripts/check-dsh-isolation.mjs` only inspects `dsh` launchers, which is why
this slipped through.

Suite totals after every fix: **antigravity 180, deepinfra 217, opencode 546, router 509 — all
pass, 0 fail.**

### Owner correction: I widened a regex instead of honouring the F-40 contract

The owner's objection, and it was right: 안티그래비티는 모델 추론옵션이 모델과 동일하게 리스트로 떠서 각
모델을 대분류하고 추론을 선택하면 해당 모델을 선택할 수 있게 설정해야 하는데, 기존 로직을 무시하고 그냥 xhigh로
단순 지정했다.

What I had done was add `xhigh` to `splitEffort`'s regex and stop there. That made the panel **show**
an XHigh row, but the repository already had a written contract for this exact problem — **F-40** in
`docs/FAILURE-LEDGER.md`, restated in `docs/CUSTOM-ROUTER-PROTOCOL-STANDARD.md` §4.1:

| F-40 requirement | What I had done |
|---|---|
| Group suffixed ids into **one base model** | regex widened only |
| Expose the suffixes as `reasoning.efforts` | not checked |
| **Reverse the mapping on the way out** | not checked — and it was broken |

Concretely, `wire.js:modelForEffort()` did
`effort === 'xhigh' || effort === 'max' ? 'high' : effort`, so selecting **XHigh sent High over the
wire**. Verified before the fix:

```
effort low      -> gemini-4-hydrogen-low
effort medium   -> gemini-4-hydrogen-medium
effort high     -> gemini-4-hydrogen-high
effort xhigh    -> gemini-4-hydrogen-high   <-- accepted but not honoured
```

`EFFORT_ORDER` also still held three entries, so `indexOf('xhigh')` was `-1` and sorted the highest
level ahead of `low`; and the base name was never trimmed of its level, so the row read
`Gemini 4 Hydrogen (XHigh)` instead of grouping as one category.

Fixed per the contract:

- `EFFORT_ORDER` and the display-name trim now cover `minimal/none/low/medium/high/xhigh/maximal/max`.
- `modelForEffort()` collapses `xhigh`/`max` **only when the catalog does not carry that exact
  level**, so a three-level account keeps the old safe folding and Hydrogen round-trips.
- Verified output: one `Gemini 4 Hydrogen` row, `reasoning.efforts` =
  `low/medium/high/xhigh` (names Low/Medium/High/XHigh), `defaultEffort: low` (the owner's
  lowest-level rule, not the first catalog row).

Four new F-40 regression tests: every served level round-trips, an unserved level still folds, the
grouped row advertises four ordered efforts with a trimmed name, and an unlisted level can never
sort ahead of a known one.

**Documentation was also stale, which the owner called out.** Updated:
`docs/CUSTOM-ROUTER-PROTOCOL-STANDARD.md` §2 (the reasoning row now says "every level the account
serves", cites the measured Hydrogen xhigh case) and §4 (`reasoning.ids` is not a fixed three);
`docs/MODEL-LIST-REFRESH.md` gains §6a with the full contract and both defects.

### Owner audit: three things I had claimed but not done

The owner's question — 딥인프라도 버그 수정하지 않았어? 근데 왜 그것과 관련한거나 오픈코드나 딥인프라
새로고침도 없어서 실제 업데이트 안된 부분에 대해서도 기록하지 않았지? 그리고 프리셋이 계속 추가될텐데 3개만
업데이트되고 신규로 추가되는 프리셋은 업데이트 또 별도로 해야하나? — exposed three separate gaps.

**1. "Verified" meant "fixture-verified".** The `?refresh=1` bypass for DeepInfra and OpenCode had
unit tests over stub catalogs. A stub cannot prove that a network fetch, a daemon probe or a
durable cache file was re-read; only the Antigravity path had been re-measured live (and only
because an earlier mistake forced it). The document said "verified" without marking the difference.

Now measured live — `npm run verify:refresh` (`scripts/verify-refresh-routes.mjs`) boots the real
`web` profile into a throwaway `DSH_HOME`, reads the host's own route table, and calls each route
plain and forced:

| Preset | Plain | Forced | Content |
|---|---|---|---|
| antigravity | 200, 10 grouped rows | 200, 10 | bases include **`gemini-4-hydrogen`** |
| opencode | 200, 32 rows | 200, 32 | all `go`; Hydrogen absent (Zen, `otherPlanCount: 26`) |
| deepinfra | 200, 91 rows | 200, 91 | **8 discounted / 83 list price**, `promotionCount: 8` |

That last row is also the first live confirmation that the promotion fix works end to end: before
it, all 83 full-price rows badged `0%`.

**2. The "a refresh does not fix this" cases were never recorded.** They are now, in
`docs/MODEL-LIST-REFRESH.md` §7: a model absent from the **prompt** while present in the **tab** is
an `enabledModels` fact (`catalog.list()` filters, `catalog.all()` does not); OpenCode's Hydrogen is
a **plan** fact; and a preset with no tab/usage card is a **registry** fact.

**3. Adding a preset still touches five places, two of them silently.** Measured by reading every
consumer of both registries: `lib/presets.js`, `lib/client.src.js` `MODEL_PRESETS`,
`lib/client.src.js` `fetchUsageFeeds` (a literal array of three vendors), the expected-id array in
`test/inventory-metadata.test.mjs:151`, and the locale tables. Forgetting #2 or #3 produces **no
error at all** — the preset is simply never rendered and never counted. `fetchUsageFeeds` is the
worst: it also decides which routes a refresh touches, so a fourth preset would be invisible to the
refresh contract too.

Registered as [docs/PRESET-REGISTRY-STANDARD.md](docs/PRESET-REGISTRY-STANDARD.md): the measured
five-place audit, the normative descriptor contract (`catalogRoute`, ordered `usageRoutes`,
`load`/`saveValue`, `metered`, …), and the ordered six-step plan to make a preset a one-place
addition. Per the owner's decision this round, the design is **recorded, not implemented**; the
interim rule is "touch all five and say so in the CHANGELOG".

### Status

`applied pending restart` — the rebuilt `lib/client.js` and the three vendor libraries are on
disk; the running `dsh-web.service` still serves the previous build until it is restarted (owner
action; not restarted here). The promotion fix is client-only, so it reaches the page with the
same restart (or a client-bundle HMR reload).

## 0.0.1-rc.12 — two-track plan evidence — 2026-11-12

Owner correction, in two steps:

> billing_source는 요청 다 끝나고 응답 와이어에 찍히는 **사후 데이터**잖아 …
> 첫 요청 전에도 동작할 수 있게 [프로필/토큰 메타데이터 기반 기본 플랜 정의 + 사후
> billing_source로 실시간 보정/동기화(Sync)] **투 트랙**으로 설계해야지.

> 사용자에게 플랜을 1차적으로 받고 이후에 보정치가 생기면 **사용자 동의 후** 요금제를
> 바꿔야 할거 아니냐

An earlier attempt in this session derived the account tier from the durable cost ledger.
That was wrong: the ledger is empty on a cold start, so a pre-dispatch verdict would have had
no input at all, and on a warm profile it would have rewritten a decision already taken. The
ledger-based module was deleted, `lib/plan.js` was reverted, and the design was rebuilt around
when each piece of evidence actually exists.

### Measured: no pre-request source names a tier

| Candidate | Result |
|---|---|
| Console OAuth token | opaque `st_…`, 39 chars, not a JWT |
| `credential.json` metadata | `type, server, access, refresh, expires, accountID, email, orgID, orgName` — no plan |
| `GET /zen/go/v1/usage` | 200, `{rolling,weekly,monthly}` — proves a window set exists, names no tier |
| `/zen/go/v1/{subscription,plan,plans,billing,account,me,limits}` | all 404 |
| `/zen/v1/{usage,subscription,me}` | all 404 |
| `/console/api/v2/{me,orgs,members,subscription,billing,plan,usage}` | all 404 |
| `/console/api/orgs` | 200, no plan field |
| MCP `get_context` / `get_usage` / tool list (11 tools) | no plan anywhere; `budgets: []` |

### Track A — declared baseline judges before dispatch

`judgePlan()` now accepts the operator's declaration as the pre-dispatch basis and tags the
verdict: `degraded[]` records that the tier is *declared*, not measured. Nothing declared and
nothing measured is `unknown`, never a guessed `match`.

### Track B — the receipt proposes, consent applies

New `proposeCorrection({declaredPlan, billingSources, sampleCount})` returns
`{status: 'none'|'agree'|'propose', proposal: {field:'activePlan', from, to, requiresConsent:true}}`.
A receipt can therefore never become the account tier inside the verdict; the only path into the
declaration is an operator-consented `settings.update` on the row's own volatile field.

**Live case this closes:** the profile declares `activePlan: go` while 9279 of 9279 sourced
requests billed as `go-plus`, and the documented-limit check puts `kimi-k3.1-pro` at 314% of Go
but 78.5% of Go Plus. That now surfaces as a proposal, and nothing changes until it is applied.

`lib/plan.js` no longer derives `accountPlan` from `billingSources` at all.

### Test scope correction — the peer test no longer reaches into a sibling track

`test/presets.test.mjs` compared this package's version against
`../../archive/dsh-opencode-v2/package.json`, a **sibling track**. That coupled every router `rc` bump
to an edit outside this track's boundary, which the single-writer rule
(`docs/RULES.md` §3.2) forbids — the router could not ship a new rc without an unauthorized
write to another package. Owner instruction 2026-11-12: narrow the test to this track.

The check now covers the three vendored providers this package actually owns
(`vendor/antigravity`, `vendor/opencode`, `vendor/deepinfra`, all part of
`@nolit/dsh-custom-router`). Cross-track drift stays `verify:presets`' job, which boots the
real profile and diffs the live registries instead of reading a neighbour's manifest.

Non-vacuity proven: setting `vendor/deepinfra` back to `rc.11` fails the test
(`1 fail`), removing the mutation passes again. `dsh-opencode-v2/package.json` was never
modified in this session.

### Verification

- `npm test` → **502/502** (was 493 before this session; +9 two-track tests)
- `test/plan.test.mjs` → 21 tests, including "a receipt does NOT become the account tier" and
  "a cold start has no receipt and proposes nothing"
- `npm run check` → pass; `docs:check` → 1494 links, 6 indexes OK

## 0.0.1-rc.11 (cont.) — border fallback — 2026-11-11

Owner correction, measured against the upstream authority
[`docs/web-styling.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/web-styling.md):

> Flat borders and separators that use a neutral `--dsw-alias-border-*` token draw at `0.5px` …
> Dashed affordances and **state-colored borders keep 1px**.

The previous entry replaced `.5px` with `var(--dsh-hairline-width,1px)`. The token itself is real —
`@deepseek-ai/dsh-client-ui-theme` publishes it on the document root and resolves it to
`max(1, floor(0.5*dpr))/dpr` — but **its fallback in the shipped host bundle is `.5px`, not
`1px`** (`dsh-web-frontend` declares `var(--dsh-hairline-width, .5px)`), and the upstream styling
reference never mentions the token at all. With a `1px` fallback the border painted twice as thick
whenever the token was not injected (headless capture, non-window documents, test harnesses).

**Corrected in this package:** every `--dsh-hairline-width` use now carries the host's own
`.5px` fallback instead of `1px` — **28 occurrences, measured before -> after**.

The `.5px` regression gate was narrowed to a bare literal so it still rejects a hand-written
literal while accepting the token fallback.

## 0.0.1-rc.11 — hairline token, CJK wrapping — 2026-11-11

Owner task: the four plugin UI surfaces must stop hardcoding the hairline and must not break
Korean words mid-word.

**Measured, from the shipped source (before → after):** `.5px` literals in `lib/client.src.js`
**28 → 0**; `word-break:keep-all` on the root `.crSection` absent → present.

Every border now reads `var(--dsh-hairline-width,1px) solid var(--dsw-*)`. The one negative
offset (`.crTab{margin-bottom:-.5px}`) became `calc(-1 * var(--dsh-hairline-width,1px))`, so the
tab underline still cancels exactly one hairline instead of a fixed half pixel. The token is
published on the document root by `@deepseek-ai/dsh-client-ui-theme`, which resolves it to
`max(1, floor(0.5 * dpr)) / dpr` — the literal ignored that on every display.
`test/client.test.mjs` gained a regression gate that fails the suite if a `.5px` literal or a
missing `keep-all` returns.

## 0.0.1-rc.10 — 2026-11-10 (dispatch policy: preset-based, not workspace-write)

Owner instruction: the four presets are minimal, ptc, standard, cordis. minimal and ptc hard-block
external CLI and subagent dispatch; standard and cordis may dispatch on `workspace-write`; only
`read-only` keeps the sandbox restriction.

**Measured cause of the revision.** `dsh --profile web --dump-config` shows
`sandbox-policy.mode = DSH_PERMISSION_MODE ?? 'workspace-write'`, and the service env carries no
`DSH_PERMISSION_MODE`. The rc.9 policy listed `workspace-write` as restricted, so every ordinary
session refused all four CLI tools while the HTTP model route kept working — the owner-visible
"OpenCode is broken" symptom. `ptc` was not restricted at all.

| Constant | rc.9 | rc.10 |
| :--- | :--- | :--- |
| `RESTRICTED_PRESETS` | `['minimal']` | `['minimal', 'ptc']` |
| `RESTRICTED_SANDBOX_MODES` | `['read-only', 'workspace-write']` | `['read-only']` |

Evidence: `npm test` 372/372 (four new policy cases), `verify:dispatch` 17/17 (8 denials,
3 allows), live mount unchanged. `applied pending restart` — the running `dsh-web.service` keeps
the rc.9 gate until it restarts (owner-only).

Peer alignment completed: `dsh-opencode-v2` rc.5, `vendor/antigravity` rc.11 and
`vendor/deepinfra` rc.12 now peer this package at `0.0.1-rc.10`; deepinfra had been left at `rc.2`.

## 0.0.1-rc.9 (cont.) — 2026-11-08 (provider-slot migration, Step 1)

Owner instruction: *"M9 readiness probe는 보류하고, 1) 벤더의 라우터 의존성 버전 정렬(rc.2 → rc.9)과
2) OpenCode CLI 토글 비활성화(Step 1) 두 가지만 승인한다. 규정 절차대로 문서 갱신 및 마운트 검증
거쳐서 깔끔히 커밋하고 한글로 간략히 보고해라."*

**1. Router peer alignment.** Both provider packages pinned
`@nolit/dsh-custom-router: 0.0.1-rc.2` while this package had reached `rc.9`. A strict resolver
refuses that pairing, and the failure would surface at mount time rather than in review.

| Package | Before | After |
| :--- | :--- | :--- |
| `dsh-opencode-v2` | `0.0.1-rc.2` | `0.0.1-rc.9` |
| `vendor/antigravity` | `0.0.1-rc.2` | `0.0.1-rc.9` |

The `opencode-v2` suite asserted the literal `rc.2`, so it pinned the drift instead of catching
it. That assertion now compares against the router's own `package.json` version, and this track
gained the same check.

**2. OpenCode CLI surface — switched off, then WITHDRAWN (same day).**

`vendorConfig['dsh-opencode-v2'].cli: false` was applied as "migration Step 1" and reverted within
the hour. Measured reason: that ONE vendor switch (`cliOn`) withdraws the `opencode` delegation
tool, `/ocode` and `cli_worker` together, so the step removed surfaces users call — including the
`/ocode` command the owner reported as "not loading". The owner's later instruction was that the
migration itself was already complete; the router had been mounting these surfaces all along.

| Item | State |
| :--- | :--- |
| `cli: false` in the live profile | **withdrawn** (backup `cordis.patch.yml.bak.before-ocode-restore-*`) |
| `surfaces.cli` declaration | live (no `default: false`); `gates: ['opencode']` retained |
| `/ocode`, `opencode`, `cli_worker` | mounted again on the next `dsh-web.service` restart |

**Correction to an earlier claim in this file.** A previous revision said the surfaces "ship OFF".
They do not: `dsh-opencode-v2` declares `cli: Schema.boolean().default(true)`, its own
`cordis.patch.yml` carries no `cli` key, and a booted pre-change profile shows all four surfaces
mounted. The drift gate now reports OK against the live profile.

**Latent defect (still real, still unfixed).** `dsh-opencode-v2` installs no
`app-boot/config-reload` reconcile (measured 2026-11-08; `vendor/antigravity` does), so ANY
`cli` flip — on or off — needs a `dsh-web.service` restart. This is why the withdrawal is not
visible in the running process yet. Ledger F-46 class; fixing it is a code change the owner has
not approved.

## 0.0.1-rc.9 — 2026-11-08 (CLI dispatch control plane: admission + reclamation)

Owner instruction: *"프리셋/샌드박스 제한 시 비인가 CLI 디스패치가 자연스럽게 차단될 것 … 세션
중단 시 외부 워커 프로세스가 좀비나 탈주 상태로 남지 않고 회수될 것"*

Two duties, both placed in the router because the router is the only owner of the preset
mounts, and both built on seams that already existed rather than new mechanisms.

| Duty | Implementation | Seam reused |
| :--- | :--- | :--- |
| Refuse dispatch under a restricted preset/sandbox | `tools/pre-execute` listener, `prepend`ed, installed before the rows mount | the shipped policy seam Auto-review uses; denial is an ordinary `{kind:'deny'}` |
| Reclaim a dispatched worker on session end | `CliWorkerRegistry` + `agent/disposed` / `session/disposed` / router disposer | the subprocess handle's own `terminate()` verb |

**Measured, and each one changed the implementation:**

| Finding | Consequence |
| :--- | :--- |
| The sandbox blocks file effects, not process creation (`read-only` still spawns `dsh`, nested `bwrap`) | a gate is the only thing that stops a restricted session outsourcing work |
| A child cannot see a parent-provided service via `ctx.get()`; `ctx.inject` can | every vendor acquires `customRouter` through deferred injection |
| Providers hold the parent Agent; lifecycle edges deliver a Session | `sessionOf()` normalizes both identities, or reclamation would never match |
| The settings schema materialises `[]` for an absent array | empty lists fall back to the shipped defaults instead of restricting nothing |

**Files.** New `lib/dispatch-gate.js` (gate, registry, lifecycle binding) and
`docs/CLI-DISPATCH-CONTROL-PLANE.md`; `lib/index.js` extends the existing `customRouter` seam
with `cliDispatch` and releases gate/registry in its disposer; `lib/settings-schema.js` gains
`cliDispatchGate`. Vendored AGY (`subagent.js`, `cli-batch.js`, `index.js`) and OpenCode v2
(`subagent.js`, `index.js`, `workers/run.js`, `workers/index.js`) register handles and assert
the same rule in `start()`.

**Neutralizing `auto: true`.** The decision lands before the tool body, so no argv is built and
no `--auto` can be read. A regression test pins that `--auto` never reaches a process under a
denial.

**Verification.** `npm run verify:dispatch` — 10/10 live checks (4 restricted combinations deny
all CLI tools with `bodyRuns: 0`; a real child is killed by agent disposal, session disposal,
and router unload; a sibling session's worker survives). Suites: router 361, AGY 171,
OpenCode v2 479 — all pass. `dsh --profile web --dump-config` exits 0 and the router still
mounts with `cliDispatch` present.

## 0.0.1-rc.8 — 2026-11-08 (Antigravity/DeepInfra absorbed; llm-pi-ai re-enabled)

Owner instruction: *"커스텀라우터 플러그인 통합으로 인하여 플러그인 중에 안티그래비티, 딥인프라
플러그인 삭제 및 관련 서브 프로젝트 해당 플러그인 사용하지 않고 커스텀라우터 플러그인으로
통합되었다고 관련 문서 커밋하고, 설정-모델 pi-ai 사용 가능으로 활성화해줘"*

**Moved, not rewritten.**

| Before | After |
| :--- | :--- |
| `dsh-antigravity/` active track + profile `link:` dependency | `dsh-custom-router/vendor/antigravity/`; no profile dependency or `node_modules` link |
| `dsh-deepinfra/` active track + profile `link:` dependency | `dsh-custom-router/vendor/deepinfra/`; no profile dependency or `node_modules` link |
| preset packages resolved through the profile | internal exports `@nolit/dsh-custom-router/vendor/antigravity` and `.../vendor/deepinfra` |
| live `llm-pi-ai` row `disabled: true` | row enabled (dormant with zero routes until a provider profile is saved) |

**Code changes:** `vendor-modules.js` loads the vendored Antigravity bridge modules from
`import.meta.url`; OpenCode remains profile-resolved. The vendored libs import the shared stream
pipe and vendor bridge by relative path. `lib/presets.js` names the internal subpath packages, and
`preset-schema.js` now accepts a scoped package subpath (the previous exact `@scope/name` regex
would reject the router's own vendor export). The started-bundle guard now excludes the router's
own package name, because `@nolit/dsh-custom-router/vendor/*` subpaths were being mistaken for a
second mount of the router bundle; a regression test pins that case.

**Profile cleanup (measured before → after).**

| Check | Before | After |
| :--- | :--- | :--- |
| `~/.dsh/profiles/web/package.json` dependencies | included `@nolit/dsh-antigravity`, `@nolit/dsh-deepinfra` | neither present |
| `~/.dsh/profiles/web/node_modules/@nolit/` | both links present | neither link present |
| `dsh --profile web --dump-config` | `llm-pi-ai` `disabled: true`; router row present | `llm-pi-ai` active; router row present; no vendor dependencies |
| Isolated real boot (`scripts/verify-mount.mjs`) | router mount ok | router mount ok; providers `antigravity`, `deepinfra`, `deepinfra-anthropic`, `deepseek-account`, `opencode-http-agent`; `did not activate` 0 |

**Verification:** custom-router 332/332; vendored Antigravity 164/164; vendored DeepInfra
205 pass / 7 skip / 0 fail. The integration record is
[`docs/PROVIDER-INTEGRATION.md`](docs/PROVIDER-INTEGRATION.md).

## 0.0.1-rc.7 — 2026-11-08 (browser surface redesign — provider rows over DSH tokens)

Owner instruction: *"오늘 만든 커스텀라우터 플러그인 이 스킬 주입을 이용해서 다시 레이아웃 짜 물론 전체
스타일이랑 폰트 타이틀 모두 dsh 스타일 따르고 ui 디자인만 적용할 수 있도록 해"* — re-lay out the
custom-router browser surface with the injected `/ui` skill's component hierarchy, keep DSH's own
style, typography tokens and title conventions, change design only.

**Scope: the browser surface only.** No write path, settings path, i18n key, registration id,
locale value or data path changed. Every measurement below is a CSS value or a DOM structure read
out of `lib/client.src.js`; the router behaviour is untouched.

**Component selection (the `/ui` hierarchy, adapted).** The skill names shadcn/ui as the default
for standard dashboard surfaces. This bundle is a plain CommonJS factory evaluated by
`window.__ModuleLoader__` and may only `require('react')`, so the shadcn/ui **composition and
visual language** are reproduced locally over the DSH design tokens instead of adding packages:
row / card / form-section / field / toolbar / footer-bar / tab patterns, a segmented action style,
and one inline SVG icon set. No dependency was added, and no marketing effect (Magic UI /
Aceternity) was used.

**Layout: one column of provider rows, one full-width detail panel.** The 3-up vendor grid was
the defect. Every card was stretched to the width of its widest sibling, so a form with one
credential field got the same 380 px column as a card with three, and the measurement of one
provider sat next to the measurement of another. The surface is now a **single column of compact
provider rows** (`.crProviderList` → `.crProviderItem` → `.crProviderRow`), and the detail of the
open provider renders **below the list, full width** (`.crProviderDetail`), not inside a column of
its own.

| Complaint | Measured before | Now |
| :--- | :--- | :--- |
| The provider wall was flat: three cards in one row, no hierarchy | `.crVendorGrid{grid-template-columns:repeat(3,minmax(0,1fr))}` — every card stretched to the widest sibling | `.crProviderList` is one column (`.crProviderItem` per provider); the opened provider's detail (`.crProviderDetail`) is a full-width sibling of the row, not a column of a grid |
| Each card carried the whole measurement, so scanning meant reading | `.crVendorCard` mixed identity, measurement and switches in one stack | the row carries a **mini usage summary** (`.crMiniUsage`): the tightest window's label, percent and reset time — or the spend and balance for a pay-per-token provider — with a decorative bar (`aria-hidden`) |
| The detail had no frame of its own | the measurement was a bare list inside the card | the full measurement sits in one compact inset (`.crUsageInset`) inside the detail panel, beside the settings form |
| The page was wider than a readable dashboard | `.crPage{width:100%;max-width:1180px;margin:0 auto;padding:16px 20px}` | `.crPage{width:100%;max-width:1120px;margin:0 auto;padding:20px 24px;box-sizing:border-box}` — measured 1120 px at a 1600 px viewport |
| The settings trigger was an emoji | `.crGear` rendered the text node `'⚙'` (platform emoji font, ignores the colour tokens) | an inline 16 px SVG (stroke `currentColor`, `aria-hidden`), still `aria-expanded` + `aria-controls` |
| Keyboard focus was invisible | no `:focus-visible` rule existed | one rule for `.crButton` / `.crTab` / `.crGear` / `.crJump` / `.crSearchInput` / `.crInput` / `.crSwitch` / `.crRowCheck`, using `--dsw-focus-ring-width` and `--dsw-focus-ring-color` (the same tokens DSH's own theme uses) |
| A literal pixel size survived on the icon button | `.crGear{font-size:14px}` | removed; **every** `font-size` in the stylesheet is a `var()`/`calc()` on the DSH content tokens (measured: 0 literal sizes) |
| Credentials were one dense inline row | `.crCredentialRow` = name + input + state + two buttons on one line | `.crField` form blocks under a labelled `.crFormSection` (title + write-only hint): field name, set/unset state, masked input, primary save + ghost clear |
| The model manager chrome scrolled away | static `.crToolbar` and `.crFooterBar` | the toolbar sticks to the top (`position:sticky;top:0`), the action bar sticks to the bottom (`position:sticky;bottom:0`) |
| A dense table could widen the page | `.crPage` declared no overflow rule | `.crPage.crPageScroll{overflow-x:hidden}`; the plan table keeps its own scroll (`.crPlanTableWrap{overflow:auto}`) |
| The picker was four identical tiles | `crPickerCard` with one anonymous button | a head row (name + added badge), description, auth hint and one primary action (`data-picker-action="add"`), disabled for `custom-json` and for an already added provider |
| Empty and loading states looked identical | `.crEmpty` for both | `.crEmpty[data-state=loading|empty|error]` with the error copy in the error colour |

**Accessibility contract (the final pass).** The redesign was audited against the browser
contract, and the surface now states the following in the DOM, not only in the stylesheet:

- **Real plan table semantics.** The plan ledger was a grid of `<div>`s (`.crPlanRow`); it is now
  a `<table class="crPlanTable">` with a `<thead>`, `<th scope="col">` on every column, a `<tbody>`
  and an `aria-label`. The table keeps its own scroll (`.crPlanTableWrap`).
- **Keyboard tabs.** Both tab strips (the dashboard's usage/add strip and the model manager's
  per-preset strip) carry `role="tablist"` with an accessible name, a roving `tabIndex`
  (`0` on the selected tab, `-1` on the rest), and one `keydown` handler on the strip:
  `ArrowRight` / `ArrowLeft` move the selection and wrap, `Home` / `End` jump to the first and last
  tab. The handler moves the DOM focus with the selection, so a keyboard user follows the tab
  instead of losing the strip.
- **Collapsed settings leave the tab order and the accessibility tree.** A closed settings panel
  keeps its DOM (the reveal animates it open), so its inner box carries `inert` **and**
  `aria-hidden="true"` while collapsed. Without both, `aria-expanded="false"` on the trigger would
  be a lie.
- **Live regions.** Every write result is announced through a `role="status"` region with
  `aria-live="polite"`, and the region is **always mounted** — a region that appears together with
  its text is not announced. One per provider panel (3) plus the model manager's footer.
- **Credential labels.** Each write-only credential input is named by a real `<label htmlFor>`
  pointing at a unique input id, so the field name is visible and is the accessible name (no
  `aria-label` shadows it). The input is `type="password"` with `autoComplete="new-password"`, so a
  stored secret is never offered to the browser's autofill.
- **Progress bars carry a readable value.** Every `role="progressbar"` — the usage windows in the
  detail and the plan windows in the model manager — carries `aria-valuenow` / `aria-valuemin` /
  `aria-valuemax`, an `aria-label`, and an `aria-valuetext` that names the window and its percent
  (or the limit reached). The mini bar in the provider row is decoration and is `aria-hidden`.
- **Reduced motion.** `@media (prefers-reduced-motion: reduce)` removes every transition this
  surface owns (`.crButton`, `.crGear`, `.crTab`, `.crReveal`, `.crSwitch`).

**Typography and colour contract.** The surface root still reads
`font-size:var(--dsh-content-font-size,14px)` with
`line-height:calc(22px + var(--dsh-content-font-delta,0px))`, hints and meta use the derived
secondary token, `font-family` is `inherit` (the code seat is the only exception, for model ids
and rates), and no colour is a literal: every fill, border, radius and focus ring is a `--dsw-*`
token or `transparent` (measured: 0 hex, 0 `rgb()`/`hsl()`; the only non-token colour keyword in the
stylesheet is `transparent`). The DSH title text and the title hierarchy are unchanged.

**The settings section now matches the built-in plugin tab menu (measured).** The settings surface
(`settings.section`, id `custom-router`) was aligned to DSH's own
`packages/client/ui-settings-plugins/src/client/PluginsSettingsSection.module.css`: it is a
760 px column instead of the dashboard's full-bleed `.crPage` container, and its heading, intro and
tab strip use the built-in geometry.

| | Before | Now (measured from the built-in section) |
| :--- | :--- | :--- |
| Section width | `.crPage.crPageNarrow` — a 920 px page with `padding:20px 24px` | `.crSettingsSection{display:flex;flex-direction:column;gap:12px;max-width:760px;min-width:0}` |
| Heading | `h2.crTitle` (`.crTitle` is shared with the dashboard) | `h2.crSettingsTitle` — `calc(var(--dsh-content-font-size,14px) + 4px)` / `600` |
| Intro | `p.crSubtitle` | `p.crSettingsIntro` — the secondary content token in the tertiary label colour |
| Tab strip | `.crTabs` (dashboard chrome: `gap:2px`, `border-l3`, 14 px tabs) | `.crSettingsTabs{display:flex;align-items:flex-end;gap:22px;border-bottom:.5px solid var(--dsw-alias-border-l2);margin-top:2px}` |
| Tab | `.crTab` (14 px, `padding:10px 14px`, 2 px business-primary border) | `.crSettingsTab` — `padding:7px 1px 9px`, the secondary content token, tertiary label colour, and a 2 px `--dsw-alias-label-primary` underline (`bottom:-1px`, `border-radius:2px 2px 0 0`) on the active tab, with the host focus ring on `:focus-visible` |

The heading and intro are direct children of the section (the built-in section has no header
wrapper), so the hierarchy is `section > h2 + p + tablist + tabpanel`. The dashboard keeps its own
`.crPage` / `.crTabs` chrome and is untouched. The model data attributes, the tab ids
(`cr-models-tab-<preset>`), the panel id (`cr-models-panel-<preset>`), the `tablist` role and
accessible name, the roving `tabIndex`, the arrow-key handler, the save path and every locale
string are unchanged. Group cards keep the settings-card tokens
(`--dsw-alias-settings-card-fill` / `--dsw-alias-settings-card-stroke`, `.5px` hairline,
`--dsw-radius-lg`).

**Class names.** Removed (12): `crCredential`, `crCredentialField`, `crCredentialHead`,
`crCredentialName`, `crCredentialRow`, `crCredentialTitle`, `crPlanRow`, `crPlanRowHead`,
`crTitleBlock`, `crVendorCard`, `crVendorGrid`, `crVendorHead`. Added (27): `crField`,
`crFieldActions`, `crFieldHead`, `crFieldLabel`, `crFormSection`, `crFormSectionBody`,
`crFormSectionHead`, `crFormSectionHint`, `crFormSectionTitle`, `crMiniBar`, `crMiniBarFill`,
`crMiniLabel`, `crMiniPct`, `crMiniReset`, `crMiniRow`, `crMiniUsage`, `crPickerHead`,
`crPlanTableWrap`, `crProviderDetail`, `crProviderHead`, `crProviderItem`, `crProviderList`,
`crProviderRow`, `crProviderUsage`, `crSettingsIntro`, `crSettingsSection`, `crSettingsTab`,
`crSettingsTabs`, `crSettingsTitle`, `crStatusLive`, `crUsageInset`, `crUsageWindows`. The
stylesheet grew from 127 to 142 `.cr*` classes (23 593 → 28 813 bytes of emitted CSS) and no rule
targets a bare element selector.

**Tests:** 313 → 332 (`npm test`), all green; `npm run check` and `npm run verify:stream` green
(7/7 dispatch, 0 vendor loads). The client suite went 48 → 67 tests. New: the typography-token
form (no literal size, no literal colour, `inherit` family only), the SVG icon trigger (and the
emoji must not come back), one measurement inset per provider, the focus-visible ring on every
interactive control, the credential form blocks, the picker action contract, the responsive rules,
the provider-row / full-width-detail layout, the accessible name on every tab strip, the keyboard
tab strip on both surfaces, the inert + `aria-hidden` collapsed panel, the live regions, the real
credential labels, the `aria-valuetext` on both progress-bar families, and the reduced-motion
block. Updated for the intentional layout change: the pinned width container (1180 → 1120 px), the
provider-grid assertion (`.crVendorGrid` → `.crProviderList` / `.crProviderItem`), and the picker
action selector (`className === 'crButton'` → `data-picker-action="add"`, because the action is now
a primary button). No behaviour or accessibility assertion was weakened.

The settings-section alignment adds one test (`the settings section follows the built-in plugin
section spec`): the 760 px column, the `h2` heading class, the intro class, the tab strip class and
its three tabs, and the pinned built-in tab geometry (gap 22 px, `padding:7px 1px 9px`, the
secondary font token, the 2 px label-primary underline, the focus ring). The two heading assertions
were retargeted from the shared `.crTitle` / `.crSubtitle` classes to the section's own
`.crSettingsTitle` / `.crSettingsIntro`; the copy they assert is unchanged.

**Not verified.** The redesign was not checked in a live browser (no DSH boot in this session):
the sticky offsets, the inset contrast in both themes, the 1120 px measure and the rendered
contrast of the mini bars are read from the stylesheet and the DOM structure, not measured on
screen.

## 0.0.1-rc.6 — 2026-11-08 (Anthropic Messages protocol hooks in the shared pipe)

Owner instruction: a provider's protocol is the axis, not the vendor. The shared downstream pipe
must absorb **Anthropic Messages** the same way it absorbed OpenAI, so any provider that speaks the
protocol (DeepInfra's `/anthropic` route, OpenCode's `/v1/messages`, or a direct Anthropic key) can
be served by a thin binding instead of a copy of the parser.

**Added**
- `lib/stream/anthropic.js` (new, exported as `@nolit/dsh-custom-router/stream/anthropic`):
  - `readAnthropicSse` — event-typed SSE (`event:` + `data:`), multi-line data, CRLF, comments,
    **no `[DONE]` sentinel**, malformed JSON -> `PROTOCOL_DEFECT`, empty data frames skipped;
  - `readAnthropicEvent` — `message_start` usage, `content_block_start` (text/tool_use/thinking/
    redacted_thinking), `content_block_delta` (`text_delta`/`thinking_delta`/`input_json_delta`/
    `signature_delta`), `message_delta` (stop_reason + usage), `message_stop`; a mid-stream `error`
    event becomes an in-band failure (`PROVIDER_RESOURCE` for `overloaded_error`/`api_error`,
    `RATE_LIMIT` for `rate_limit_error`) instead of a successful stop;
  - `createAnthropicHooks()` — per-stream state so usage pieces from `message_start` and
    `message_delta` merge (the pipe replaces usage per record) and per-block `signature` survives;
  - `usageFromAnthropic` — Anthropic `input_tokens` **excludes** cache, so the projection does not
    subtract `cacheRead` the way the OpenAI writer does; `cacheReadTokens`/`cacheWriteTokens` are
    separate buckets; `totalTokens` only when the provider total agrees;
  - `mapAnthropicFinish`, `ANTHROPIC_DESCRIPTOR` (`fragmented`, `input+output+cache`, `fail`).
- `lib/stream/wire.js` finish table: `pause_turn` -> stop (server paused a long turn, not an error)
  and `model_context_window_exceeded` -> max-tokens. Measured: leaving them unmapped turned a
  provider pause into `UNKNOWN_FINISH_REASON` and killed the turn.

**Measured constraints encoded** (2026-11-08): `thinking_delta` is the only reasoning channel;
`signature_delta` emits no chunk and the host `ContentBlockMap` has no signature field, so the
signature lives in the provider binding's state and in `replayState` on the replay path; a
`tool_use` block announces `id`/`name` on `content_block_start` and its JSON arrives as
`input_json_delta.partial_json` fragments (same fragmented shape the pipe already owns).

**Addendum — subagent tool rows opt into per-call model selection (2026-11-08).**
`PRESETS.antigravity` and `PRESETS.opencode` now declare `modelSelection: true` on their
`tool-subagent-*` entry, and both vendor `cordis.patch.yml` rows carry the same switch. Measured
requirement: `dsh-tool-subagent` rejects `modelSelection` unless the provider's
`capabilities.agentOptions` is true (the vendor providers were changed in the same round), and the
allowed-route policy comes from the Session's `subagent/model-selection-policy` event, not from the
provider — so no provider-side route table was invented. `test/presets.test.mjs` was updated to the
new measured entry set.

**Verification (measured):** `npm test` **313 pass / 0 fail** (286 -> 313, +27 protocol tests);
`npm run verify:stream` 7/7, vendor loads 0; `node --check` on every edited module. No adapter
registered, no provider table, no `dsh-llm` import — R0 unchanged.

## 0.0.1-rc.5 — 2026-11-08 (width container, one tab panel, tabbed model picker)

**Addendum — OpenCode plan/usage card (2026-11-08 04:30).** The OpenCode tab now opens with a
`플랜 사용량` card built strictly from measured data:
- tier from the local ledger's `bySource` (`go-plus` present → **Go Plus**, labelled 원장 증거;
  no evidence → `플랜 미확인`, never a guess) — the console API exposes no plan id;
- the three windows (`5시간 / 주간 / 월간`) as real progress bars with a `한도 도달` badge;
- `사용 $23.60 · 허용량 $64.35 · 37%` from `cost.listCostUsd / allowanceUsd` + request count;
- a per-model table aggregating `cost.bySession[].byModel` (requests, spent, allowance) with the
  **documented monthly limit** (`Go Plus` column, docs 2026-11-07) beside it, and an explicit
  `로컬 기록 기준` note. Measured live: 9 rows; `kimi-k3.1-pro $60`, `deepseek-v4.1-flash $200`.
  Witnessed live: 3 bars, tier go-plus, allowance line, 9 table rows.


**Scope:** the two surfaces the owner rejected in the rc.4 build. No backend row, switch, schema
field or write path changed; the writes are the same ones rc.4 measured end-to-end.

| Complaint | Measured before (rc.4) | Now |
| :--- | :--- | :--- |
| Sidebar dashboard stretched across the whole window | `lib/client.js` rendered a bare `section.crSection` (`max-width:1100px`, no horizontal padding); the host main slot made it full-bleed | `div.crSection.crPage` — `width:100%;max-width:1180px;margin:0 auto;padding:16px 20px;box-sizing:border-box` |
| Both tab panels rendered at once | Both `role="tabpanel"` nodes were in the DOM and `hidden` lost to `.crPanel{display:flex}`, so "프로바이더 추가" content showed under the dashboard | Only the active panel is RENDERED (conditional). `aria-controls` exists only on the active tab, `tabIndex` follows selection, no `hidden` attribute survives |
| Settings model list ignored the DSH row style and stacked three long categories | `MODEL_SOURCES.map(...)` rendered three `crCategory` sections at once | Tabs `안티그래비티 / 오픈코드 / 딥인프라` (`cr-models-tab-<id>`), one active `role="tabpanel"` (`cr-models-panel-<id>`, `data-category`), and ONE shared toolbar/group/row/footer layout |

**Antigravity reasoning-effort collapse.** The `/models` route already returns the base rows and
their variants (`groups[].models[] = {id,name,variants,enabled}`), and rc.4 threw that away by
rendering the flat `models[]`, so Gemini 3.8 Flash appeared three times. The tab now renders one
row per base model, shows the family's remaining quota in the group header
(`limits[].remainingFraction` → `주간 4% 잔여`), and a checkbox toggles EVERY variant id of its row.
The save value is the flattened variant list, in row order:

```
mutate([{ op: 'set', path: ['vendorConfig', 'dsh-antigravity', 'enabledModels'],
          value: ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low',
                  'gemini-3.5-flash-lite', 'claude-sonnet-4.5'] }])
```

**Class names.** Shared layout: `crPage` / `crPageNarrow`, `crToolbar` / `crSearchInput`,
`crButtonGhost` / `crButtonPrimary`, `crCards`, `crGroup` / `crGroupHead` / `crGroupTitle` /
`crGroupMeta` / `crGroupSide` / `crGroupBody`, `crList`, `crRow` / `crRowCheck` / `crRowMain` /
`crRowName` / `crRowId` / `crRowMeta`, `crPrice` / `crPriceRate` / `crPriceList` / `crPriceNote`,
`crBadgeMeta[data-tone]` (`promo`, `positive`, `muted`), `crEmpty`, `crFooterBar`, `crPanelBody`.
`crCategory*`, `crModelRow*`, `crModelPrice`, `crPromoBadge` and `crModelEmpty` are gone.

**Normalized shapes.** `normalizeAntigravityModels` / `normalizeOpencodeModels` /
`normalizeDeepinfraModels` now return **groups** (`{id,labelKey,label,quota,quotaTitle,rows[]}`)
instead of a flat row list; OpenCode groups by plan (`go` / `zen`), DeepInfra is one price card.
A flat Antigravity `models[]` payload (no `groups`) still renders as one `기타 모델` card.

**Locale.** 8 new keys in `en` / `ko` / `zh` (parity enforced by `gen-locale`): `groupGemini`,
`groupClaudeGpt`, `groupArgon`, `groupOther`, `planOther`, `quotaLeft`, `promoCount`,
`modelsSelectedTotal`. 119 keys × 3 locales.

**Tests:** 275/275 (`npm test`). New/rewritten: the width container, conditional panels + aria
wiring, the three model tabs, the shared row layout across all three vendors, the Antigravity
family grouping + variant toggle + exact save payload, DeepInfra rate/promo/struck-through list
price, OpenCode plan grouping with no dollar figure, the empty-selection guard, the per-tab search
filter, and "no `crCategory` vendor sections". `npm run check` and `npm run docs:check` green.

**Live verification (Chromium against the running 3080, 2026-11-08 03:12).** The worker's
vm-based evidence was re-checked in the real GUI after the HMR rev moved: the dashboard
section measures exactly **1180 px** at a 1600 px viewport and now mounts **one** tabpanel
(the add-provider panel is absent from the DOM); the settings dialog shows three tabs
(안티그래비티 / 오픈코드 / 딥인프라) with one mounted panel; Antigravity renders family group
cards (`Gemini 모델` with `주간 96% 잔여 · 5시간 100% 잔여`, `Claude 및 GPT 모델`, `Gemini 4 Argon`)
and one row per base model (`Gemini 3.8 Flash` instead of High/Medium/Low), subscription rows
`구독 포함`; DeepInfra renders `입력 $0.075 · 출력 $0.225 / 1M` with the struck-through list price
and `75% 할인`. No config was written during verification.

## 0.0.1-rc.4 — 2026-11-08 (settings schema + single dashboard — M10 UI sprint)

**Scope:** the front half the rc.3 row was missing. A `Config` schema makes the row
configurable, and one browser dashboard (settings section `custom-router`) owns provider usage,
per-layer switches and credentials under the single `커스텀 라우터 / Custom Router` entry.

**Measured defects this fixes (isolated boot, 2026-11-08).**

| Symptom | Measured before | After |
| :--- | :--- | :--- |
| Settings service could not project the row | `describe()` had no `dsh-custom-router` namespace; the Plugins list showed the raw package name | namespace served with `presets` / `vendorConfig` / `usage`; locale `meta.title` renders `커스텀 라우터` |
| Browser half never registered | `clientModules.sources` had no `@nolit/dsh-custom-router` (`resolveMeta` answered null) | client bundle listed in the graph (`plugins/??@nolit/dsh-custom-router/client.js&rev=…`) |
| Switches unsaveable | no schema → `settings.write` answered "no configurable plugin entry" | `presets.<id>`/`vendorConfig.<row>.*` writes accepted as volatile; `strict` refused ("is not volatile") |
| Secret-bearing row visible | — | `role('secret')` redaction: API key absent from `value`, sidecar reports `vendorConfig.dsh-deepinfra.apiKey=true` |

**Why the loader row is now the BARE package name.** `@deepseek-ai/dsh-client-modules`
maps a row back to its manifest with `exactPackageSpecifier(row.name)`, which returns
`undefined` for a scoped SUBPATH. A row named `@nolit/dsh-custom-router/plugin` therefore
never reached `resolveMeta`, so the client half was invisible even though the host half
mounted and the settings namespace existed. The package now exports `"."`, and
`cordis.patch.yml` names the row `@nolit/dsh-custom-router`.

**The browser surface (design approved 2026-11-08).** CSS-grid dashboard, real DOM
`role="progressbar"` bars (no block characters), three equal vendor cards with independent
`0fr → 1fr` settings reveals, DeepInfra pay-per-token billing variant (unknown balance
reported as unavailable, never zero), write-only credential inputs whose "set / not set"
state comes from the settings mirror's secret sidecar (the form snapshot does not carry it),
and an add-provider tab panel. Display text comes from `locale/{en,ko,zh}.json`, baked into
`lib/client.js` by `scripts/gen-locale.mjs` + `scripts/build-client.mjs`.

**Tests:** 261/261 (`npm test`, includes the new `settings-schema`, `client`, `locale` and
`inventory-metadata` suites). `scripts/verify-mount.mjs` now reads the vendor config from
the router row's `vendorConfig` (the live profile no longer carries vendor rows) and prints
`PARITY: PASS`: providers 4/4, tools 6/6, commands 6/6, probes 19/53/178 models.

**Runtime controls and usage feed.** Volatile settings writes retain the router config object
without re-running `apply()`, so `apply()` now listens for `app-boot/config-reload` and diffs
mounted rows by an in-memory fingerprint: only the changed row is disposed/remounted, and a
master-off disposes every row of that preset. The dashboard also reads the same measured local
routes each vendor panel already exposes — Antigravity `/models`, OpenCode `/plan-usage` +
`/model-settings`, DeepInfra `/cost/summary` — and merges those readings over any published
`usage` fallback. Missing routes stay `사용량 미제공`; nothing is synthesized as zero.

**Post-restart verification (live 3080, 2026-11-08 02:08–02:12, Chromium E2E).**
The owner restarted the service at 02:01. Measured in the running GUI:

- Settings (`계정 메뉴 → 설정`) shows **커스텀 라우터** in the settings nav; the dashboard renders
  under it (KPI 3-grid, three equal vendor cards, two tabs). It is a **settings page**, not a
  sidebar row: the main sidebar's `더 보기` lists plugin pages, never settings sections.
- Live readings reach the cards: Antigravity 주간 4% / 5시간 0% (models 9), OpenCode 5시간 3% /
  주간 57% / 월간 54% (models 32), DeepInfra **$0.75** spend, 560 requests, 2,560,350 input /
  335,053 output tokens, `요금표 미제공` / `잔액 조회 미제공`. Five `role=progressbar` bars.
- Two defects found only in that live run and fixed here:
  1. `runtimeUsage` was fetched (four routes, all 200) but never merged into the view model, so
     every window still read `사용량 미제공`; `buildViewModel(mergeRuntimeUsage(...))` now feeds it.
  2. `nextReset` parsed epoch milliseconds as a date string (`new Date(String(1794…))` is
     Invalid Date), blanking the `다음 초기화` KPI; numeric values are now used directly, the KPI
     shows a 24-hour clock time, and card reset lines use a compact `11. 11. 00:00` stamp.
- Client-modules HMR picked up the rebuilt bundle without a second restart (graph rev moved
  `a4f2bc963d71 → 56b13872db32`), so the fixes were verified on the live process.

**M10 UI sprint, second pass (2026-11-08).** Two surfaces now, split by job:

- **Sidebar panel `커스텀 라우터`** (registered into `sidebar.panellist` + the `main` page slot
  keyed `custom-router`): the usage / billing / switch dashboard, reachable from the sidebar
  instead of only from Settings.
- **Settings section `커스텀 라우터`** is now the model-serving manager: one category per preset
  (Antigravity / OpenCode / DeepInfra) listing that vendor's models with a checkbox, a search
  filter and select-all/clear. The selection is saved to `vendorConfig.<row>.enabledModels`
  (the field each vendor already filters its catalog with); the router's `config-reload`
  reconcile remounts that row, so the prompt model picker shows the chosen models without a
  restart. DeepInfra rows carry the provider's per-1M input/output rate and its promotion badge
  (`75% 할인`, list price struck through); subscription plans say `구독 포함` instead of a
  fabricated price.
- Measured live (02:21–02:24): sidebar row opens the dashboard (KPI 3, 5 progress bars);
  settings shows 3 categories with 19/32/92 models, selections 6/19, 3/32, 4/92, and DeepInfra
  rates/promotions. Tests 265/265.
- The save path was measured end-to-end in an **isolated** boot (never against the live
  profile): writing `vendorConfig.dsh-deepinfra.enabledModels = ["deepseek-ai/DeepSeek-V4-Flash-Vision-Exp"]`
  through `settings.write` took the DeepInfra provider from 4 advertised models to exactly 1,
  and restoring the list brought all 4 back — the reconcile remounts the child and the prompt
  picker follows the saved selection.
- An EMPTY selection cannot be saved: every vendor reads `enabledModels: []` as "all", so the
  save button is disabled with `최소 1개 이상 선택해야 합니다` instead of silently turning a
  clear-all into select-everything (measured live: the button is disabled with zero selected).

**Deferred by the owner (2026-11-08), kept here so the next round does not re-derive them.**
- Antigravity reports usage PER MODEL GROUP (Gemini / Claude·GPT / Argon); the dashboard card
  currently merges them (first group wins) and shows one window set. Split the card per group;
  the window order inside a group is already 5시간 → 주간 → 월간.
- The OpenCode plan card code (`PlanUsageCard`, tier evidence, documented-limit table) stays
  exported but is NOT mounted in Settings: usage belongs to the sidebar dashboard, and the
  settings tab must not duplicate it.
- S-A (declaration/Custom-JSON onboarding) and S-B (readiness probe surface) are later rounds;
  S-C (per-model limit / plan tier fidelity) is on hold behind the upstream console API.

**Known gaps (measured, not claimed as done).**
- The `Custom JSON` picker entry remains disabled until the backend has a declaration-preset
  row to enable; the three measured vendor presets are wired.
- The dashboard opens from Settings only. A sidebar entry would need a page-slot contribution,
  which this sprint did not add.

## 0.0.1-rc.3 — 2026-11-07 (multi-row presets + first real mount)

**Scope:** the router's first **real mount**. `entries` makes a preset declare the loader rows it
owns, and `apply()` mounts one child per row with **that row's own config**. Ships
`cordis.patch.yml` + the `dsh.bundle` manifest, so the router is a bundle row instead of a library
only.

**The measured defect this fixes.** The old body mounted `preset.package` once. Against the live
profile that produced **providers 3/4, tools 4/6** (missing `opencode-http-agent`,
`subagent_opencode`, `subagent_antigravity`) — a vendor bundle inserts several rows, and a
single-package mount silently drops every row but the first.

| Surface | Before | After |
| :--- | :--- | :--- |
| providers | 3/4 (`opencode-http-agent` absent) | 4/4 |
| tools | 4/6 (`subagent_opencode`, `subagent_antigravity` absent) | 6/6 |
| commands | 6/6 | 6/6 |
| deepinfra probe | 0 models (`INVALID_PROBE: probe needs a baseUrl`) | 178 models |

**Design as implemented.**

- `preset.entries: [{ row, specifier?, config? }]`. `row` is the loader/settings namespace of the
  row being mounted; `specifier` defaults to `preset.package`; `config` is static NON-SECRET config
  for the host-shared rows the router owns.
- Entry sets: `antigravity` = `dsh-antigravity` + `tool-subagent-antigravity`;
  `opencode` = `dsh-opencode-v2` + `dsh-opencode-v2-http` + `tool-subagent-opencode`;
  `deepinfra` = `dsh-deepinfra`. `preset.package`/`preset.row` stay for back-compat, and a preset
  without `entries` still mounts its own package as one row.
- **Mount config lookup is keyed by `entry.row`**, because the two OpenCode rows carry different
  live configs. Merge rule: `entry.config` (declared, non-secret) is the base and
  `vendorConfig[row]` (operator/live) is applied on top, shallowly, with `undefined` values skipped
  so a live `undefined` cannot erase a declared default. The probe layer keeps scoping by
  `preset.id` — a different question — so both key sets coexist in one object.
- **Resolution is an ordered anchor chain**: profile → `installAnchor` → extras → `execPath`
  fallback. `@nolit/*` resolves through the profile; `@deepseek-ai/dsh-tool-subagent` resolves
  through the install anchor. `profileContext` supplies both when the caller passes neither.

**Measured resolution (2026-11-07).**

| Specifier | Anchor that resolved it | Path |
| :--- | :--- | :--- |
| `@nolit/dsh-antigravity` | profile | `<profile>/node_modules/@nolit/dsh-antigravity/lib/index.js` |
| `@nolit/dsh-opencode-v2/http` | profile | `…/dsh-opencode-v2/lib/http.js` |
| `@nolit/dsh-deepinfra` | profile | `…/dsh-deepinfra/lib/index.js` |
| `@deepseek-ai/dsh-tool-subagent` | installAnchor | `/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js` |

**Measured hazard — why the install anchor is explicit.** DSH patches `Module._resolveFilename`
during boot (`dsh-app-boot` `profile-resolution-bootstrap`) to route `@deepseek-ai/*` into the
install tree. The SAME `createRequire(<profile>/package.json).resolve('@deepseek-ai/dsh-tool-subagent')`
call **fails before a boot and succeeds after one**, in the same process. A resolver that trusted
the profile for host packages would work only by accident and only after the first boot.

**Bundle row.** `package.json` gains `dsh.manifestVersion: 1` + `dsh.bundle.patch`, and
`cordis.patch.yml` inserts row `dsh-custom-router` with specifier `@nolit/dsh-custom-router/plugin`:
the export map has **no `"."`** entry, so the bare package name fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED` while the `/plugin` subpath resolves. Measured both ways. The row
carries switches only (`strict: true`, all presets `false`); no vendor secrets. Verified as a real
loader row: booting an isolated profile with it in `dsh.profile.bundles` reports
`seam present: true` and no router warning. Without the `dsh.bundle` field the host skips the
package with `declares no dsh.bundle in its package.json` (measured), which is why the manifest is
part of this change.

**Probe `baseUrl` default.** A probe layer declares only a path (`endpoint: '/models'`); its host
lives once in `preset.endpoint.baseUrl`. The seam now defaults `baseUrl` (and `apiKey` from the
preset-scoped `vendorConfig`) so the generic executor receives it. DeepInfra keeps `shape: 'openai'`
— its `/models` IS a standard OpenAI listing, and `shape: 'vendor'` is reserved for provider-specific
RPCs the router must not parse (§2.3.4); routing it to the vendor bridge would have hidden the
missing-`baseUrl` bug instead of fixing it.

**Measured:** 192/192 tests (23 new across `presets`, `index`, `vendor-modules`).
`node /tmp/lead-verify-mount.mjs` → `PARITY: PASS` (exit 0); `npm run verify:presets` OK;
`node scripts/check-dsh-isolation.mjs` exit 0.

## 0.0.1-rc.2 — 2026-11-07 (preset declarations as data, S4)

**Scope:** `lib/presets.js` — the M13–M16 surface contract as frozen data plus a pure validator.
The module **registers nothing** (no `apply`, no `ctx`, no imports): a future mounted surface (M10)
reads the declarations instead of hard-coding per-vendor knowledge.

**Measured declarations (from the vendor tracks at HEAD):** `antigravity` (Google SSE wire, route
`own`, async `agy_worker` + sync `agy_cli`, `subagent_antigravity`, `/agy`), `opencode`
(`openai-completions`, route `own` pending the PiAiAdapter migration, sync `cli_worker` +
`/ocode`/`/worker`, `subagent_opencode`), `deepinfra` (`openai-completions`, model route only,
plan `unavailable`).

**Validator rules:** a `pi-ai` route requires a protocol the host implements
(`openai-completions` / `openai-responses` / `anthropic-messages`); subagent rows must use the host's
shared `@deepseek-ai/dsh-tool-subagent` row and a `subagent_<provider>` tool name; a CLI tool must be
listed in `surfaces.tools` and differ from the batch tool; a skill must carry `modelInvocable` and
`userInvocable`; tool/command names are unique across presets (the host registries are global).

**Measured:** 80/80 tests (9 new in `test/presets.test.mjs`). A preset-only isolated profile (the
three vendor bundles removed, `@nolit/dsh-custom-router` still linked) boots with `deepseek-account`
as the only provider and no activation failure.

## Preset drift gate — 2026-11-07 (same `rc.2`)

Owner decision 2b: presets are verified against the **runtime**, not copied by hand. Added:

- `presets[].switches` — the master/surface switches each preset owns, with the module (`index` or
  `http`) that declares them;
- `presets[].package` / `presets[].row` — identity used by the gate;
- `scripts/verify-presets.mjs` (`npm run verify:presets`) — boots an isolated `DSH_HOME`, reads
  `llm.listProviders()`, `tools.definitions()` and `commands.list()`, imports each vendor `Config.dict`
  and diffs everything. Exit 1 on drift, 2 when the harness cannot run.

Negative test: adding `/worker` to the opencode preset made the gate report
`opencode: command "/worker" is declared but not registered` and exit 1. Clean run: OK.

## Preset application body — 2026-11-07 (same `rc.2`)

`lib/index.js` (exported as `@nolit/dsh-custom-router/plugin`) is the first runtime body. It applies
presets the only way that keeps R0: it mounts each active preset's **own package plugin** as a child
with `ctx.plugin` and disposes exactly that child on deactivation. It never calls
`ctx.llm.registerAdapter` and mounts nothing unless a preset is explicitly enabled
(`presets: { <id>: true }`).

- `planApplications(config)` — pure planning: validates the declarations, rejects unknown ids,
  resolves the module (with a `packages` override) and the per-preset vendor config.
- `apply(ctx, config)` — mounts the plan, isolates per-preset failures, returns the disposer.
- `strict` (default true) throws before mounting when a declaration is invalid.

Measured: 9 new tests (plan, override, unknown id, mount/dispose, strict rejection, failure
isolation, and a source scan proving the body owns no adapter call). No bundle row yet: the package
still ships no `cordis.patch.yml`, so linked profiles keep mounting the vendor plugins directly.

## Preset common data model — 2026-11-07 (same `rc.2`)

Owner requirement: a new provider must fill one standard shape that answers **delivery** (JSON
declaration vs NPM package), **authentication** (API key vs web auth vs local socket) and
**endpoint** (protocol + transport), not a package name tag.

Added `lib/preset-schema.js` (`@nolit/dsh-custom-router/preset-schema`):

- `kind`: `package` (code-backed) | `declaration` (JSON only, no package, static catalog);
- `auth`: `api-key` | `web-auth` | `local-socket` | `none`, with ordered
  `secret-field` / `env` / `credential-ref` / `token-file` / `daemon-endpoint` sources;
- `endpoint`: `http` | `local-http` | `daemon`, protocol (`openai-completions`,
  `openai-responses`, `anthropic-messages`, `google-generative-sse`), route (`pi-ai` | `own`),
  transport (`sse`, `websocket`, `websocket-cached`, `auto`), base URL, chat path;
- measured instances: antigravity (web-auth, Google SSE), opencode (web-auth/daemon, OpenAI),
  deepinfra (api-key, OpenAI); plus `DECLARATION_EXAMPLE` for a loopback JSON preset;
- `PRESET_JSON_SCHEMA` mirrors the validator for external tools.

Measured: 96/96 tests (5 new data-model cases), drift gate still OK.

## Catalog & price 3-layer synchronization — 2026-11-07 (same `rc.2`)

Owner decision: catalog and price sync are three ordered layers, merged with 3 > 2 > 1 precedence.

- **`catalog.layers`** in `preset-schema`: `upstream` (pi-ai static snapshot, default fallback),
  `probe` (API/web-auth endpoint list), `override` (preset/local models and prices). Validator enforces
  order, uniqueness, probe endpoint shape, and partial price overlays.
- **`lib/catalog.js`** (`@nolit/dsh-custom-router/catalog`): `mergeCatalog()` merges field by field,
  keeps provenance (`source`, `layers`), lets a later layer create a model, and supports pricing-only
  patches (single rate fields; `tiers` replaces when supplied).
- **`lib/cost.js`** (`@nolit/dsh-custom-router/cost`): mirrors upstream pi-ai `calculateCost()` —
  per-1M rates, tier selection by input+cache tokens, 1h cache write at 2× input — because the DSH
  wrapper drops `usage.cost` (measured 2026-11-07).

Measured upstream coverage: 42 providers / 1,712 models / **1,712 priced** / 261 tiered, snapshot
generated 2026-11-02. Tests: 108/108 (12 new catalog/cost cases), drift gate unchanged and green.

## Routing and probe executor — 2026-11-07 (same `rc.2`)

- **`lib/routing.js`** (`@nolit/dsh-custom-router/routing`): `resolvePreset()` / `resolveRoute()` —
  explicit preset → provider id → `modelPrefixes`; an ambiguous prefix is refused, never guessed.
  Presets gained measured `modelPrefixes` (antigravity, opencode-http-agent/opencode-go/opencode,
  deepinfra, local-hub).
- **`lib/probe.js`** (`@nolit/dsh-custom-router/probe`): layer-2 executor with injected fetch.
  `openai` and `anthropic` listings normalize into catalog entries (Bearer vs `x-api-key` +
  `anthropic-version`, one Anthropic page); `shape: 'vendor'` endpoints (`/api/model`,
  `fetchAvailableModels`) are refused with `VENDOR_OWNED` because the owning plugin parses them.
  `probePreset()` skips vendor layers and returns `{models, measuredAt, errors}`.

Measured: 124/124 tests (16 new routing/probe cases); drift gate green.

## Plan (subscription/flat) layer — 2026-11-07 (same `rc.2`)

`usage.billing.mode` + `lib/plan.js` (`@nolit/dsh-custom-router/plan`):

- `subscription` (antigravity), `flat` (opencode-v2), `pay-per-token` (deepinfra), `none` (loopback);
- `judgePlan()` builds the §1.4 `PlanVerdict` from L1 declared / L2 account / L3 probe, with
  `throttled`, `mismatch`, `match`, `unknown` and `no-plan-service`;
- `billingOutcome()` returns `{billed, covered, confidence, reason}`: plan-covered → `0`, per-token →
  the catalog estimate, and **`unknown` → `null`, never a fabricated zero**.

Measured: 136/136 tests (12 new plan cases); drift gate green.

## Usage binding, quota display, vendor-probe connection — 2026-11-07 (same `rc.2`)

- **Vendor probe connection** (`probeVendor`): explicit `vendorProbes[preset.id]` → host
  `ctx.llm.discoverModels(namespace)` → `VENDOR_OWNED`. Measured: the three vendor plugins register
  **no** discovery (0 hits) and keep it in `lib/provider.js`; OpenCode's namespace is
  `dsh-opencode-v2-http`.
- **Usage binding** (`lib/usage.js`, `@nolit/dsh-custom-router/usage`): `bindUsage()` returns
  `{usage, cost, billing, readings}` — token buckets, catalog cost, plan billing outcome, and
  `UsageReading[]`.
- **Quota display** (`windowReadings`): provider windows (`rolling`/`7d`/`30d` aliased) become
  `percent-consumed` / `fraction-remaining` readings with `limited`, `resetsAt`, locale `en`/`ko`.
- Invariant preserved: an unmeasurable reading is `confidence: 'unavailable'` with a reason; an
  `unknown` plan appends that gap instead of claiming `$0`.

Measured: 147/147 tests (11 new usage/vendor cases); drift gate green.

## Antigravity vendor-probe bridge — 2026-11-07 (same `rc.2`)

`lib/bridges/antigravity.js` (`@nolit/dsh-custom-router/bridges/antigravity`) connects antigravity to
layer 2 without touching the vendor:

- reuses `./auth` `TokenProvider`, `./settings` `resolveEndpoint`, `./catalog` `parseCatalog`;
- keeps the **digital fingerprint** (measured `antigravity/cli/…` UA; without it the endpoint answers
  403 and `loadCodeAssist` reports `UNSUPPORTED_CLIENT`);
- flexible slots in `vendorConfig[presetId]`: `tokenPath`, `refreshToken`, `userAgent`, `extraHeaders`,
  `project`, `baseUrl`, `controlBaseUrl` — overrides win, nothing is invented;
- `probeVendor` now scopes `vendorConfig` per preset, so one profile can carry several providers.

Measured: 153/153 tests (6 bridge cases); drift gate green.

## Three vendor bridges, module resolution, apply seam — 2026-11-07 (same `rc.2`)

- **`opencode` bridge** (`lib/bridges/opencode.js`): daemon `GET /api/model` with
  `Basic opencode:<password>`; reuses `./http` `authHeader`/`serviceStateCandidates` and
  `lib/shared.js` `modelsFromApiPayload` (file URL — the export map does not expose it).
  Slots: `baseUrl`, `password`, `serviceFile`, `extraHeaders`.
- **`deepinfra` bridge** (`lib/bridges/deepinfra.js`): thin wrapper over `probeCatalog` with
  `apiKey`/`DEEPINFRA_API_KEY` and `baseUrl`/`extraHeaders` slots.
- **Registry** (`lib/bridges/index.js`): `createVendorBridges({modules})` → three handlers.
- **Module resolution** (`lib/vendor-modules.js`): `loadVendorModules({profileDir})` resolves every
  vendor entry through the profile `package.json` and returns the module set plus preset package URLs.
- **Apply seam:** `apply()` loads modules/bridges, resolves preset packages for `ctx.plugin`, and
  provides `customRouter` `{presets, vendorProbes, route, probe, merge}`.

Measured: 169/169 tests (16 new); drift gate green.

## 0.0.1-rc.1 — 2026-11-07 (shared downstream stream pipe specified)

**Owner instruction:** do not standardise only on paper and leave three implementations; extract
the DSH-facing parser and stream pipe into **one common module** with overridable hooks so a
provider-specific API or web-auth exception can still be absorbed.

**Before (measured, 3 tracks at HEAD):** the downstream half was implemented three times and had
already drifted.

| Concern | Drift measured |
| :--- | :--- |
| finish table | `content_filter`/`SAFETY`-class → `stop` in antigravity and deepinfra, `error` in opencode-v2 |
| `totalTokens` | three different rules; `usageFromOpenAi` publishes a subset, `addUsage` sums a different set in the same file |
| `LlmFailure.code` | missing in antigravity's `SAFETY` branch |
| empty completion | throw (AG) vs in-band `finish{kind:'error'}` (DI) |
| cut preservation | present only in opencode-v2 |
| block index | fixed constants (OC) vs first-seen (AG, DI) |
| SSE malformed record | skip (AG), fail (DI), null (OC) |

**After (specification, no code yet):**
`docs/SHARED-STREAM-PIPE-SPEC.md` defines one module — `readSseEvents`, `normalizeStream`,
`fail`, `emptyCompletion`, `cutCompletion` — owned by this track and exported as
`@nolit/dsh-custom-router/stream`. Providers differ only through a stream descriptor and hooks
(`readEvent` mandatory; `classifyText`, `mapFinish`, `usageFrom`, `closeBlock`, `onMalformed`,
`onCut`, `onEmpty` optional). The pipe registers no adapter and holds no retry loop, so R0
(no second routing table) still holds.

**Rollout corrected (same day, owner instruction):** the first draft put `dsh-opencode-v2` as
the P2 migration target. That is withdrawn. The order is now **P1 core (no consumer) → P2
`dsh-antigravity` (primary testbed: low live use, and the only measured web-auth upper
pipeline) → P3 `dsh-deepinfra` (pure API parity) → P4 `dsh-opencode-v2` (last, highest traffic,
owns the optional `classifyText` hook)**. The rationale is recorded in
`docs/SHARED-STREAM-PIPE-SPEC.md` §1 and §7. No migration has started.

**Documents corrected, not just appended:**
`CUSTOM-ROUTER-ARCHITECTURE.md` §3.1 and M3, `CUSTOM-ROUTER-PROTOCOL-STANDARD.md` §2.1/§5/§7,
`CUSTOM-ROUTER-SERVICE-SPEC.md` B2, `WEB-AUTH-PIPELINE-ENGINE.md` verdict rows,
`README-OWNERSHIP.md`, `PLAN-AND-USAGE-SPEC.md` coverage matrix,
`dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md` §4.1 (recipe parser = `classifyText` hook).

**Known deltas registered (not fixed):** D1–D8 in `CUSTOM-ROUTER-PROTOCOL-STANDARD.md` §7.

**Verification surface built (same day, before P3):** the owner asked whether this package has a
callable CLI. Measured answer: **no `bin`, no mount** — it is a library, and its only executables
were `npm test` and `npm run check`. A unit suite cannot prove the property that matters for a
shared component (that it dispatches with **none of the vendor plugins loadable**), so
`scripts/verify-stream.mjs` was added with `npm run verify:stream` /
`verify:stream:json` / `verify` (check + test + verifier). Measured: **7/7 dispatch cases,
0 vendor module loads**, and a negative control confirms the resolver really blocks a vendor
import. The same `npm run verify` was then run from a **copied sandbox with no sibling tracks and
no `node_modules`** and still passed 71 tests + 7/7 dispatch, which is the standalone proof.
`dsh-antigravity` was exercised with its profile switches off (`enabled`, `modelServing`,
`cliWorker`, `usagePill` all `false`, verified in the composed `--dump-config`); the pipe still
produced a correct terminal `finish` in that state. No `bin`, no mount, no version change.

**P2 completed (same day):** `@nolit/dsh-antigravity` is the first consumer of
`@nolit/dsh-custom-router/stream`. Its local SSE reader, usage writer, finish table and block
emitter were replaced by the shared pipe; the package now contributes only
`lib/stream-contract.js` (descriptor + `readEvent` + `usageFrom` projection). Measured:
antigravity **144/144** (was 118), shared core 71/71, deepinfra and opencode-v2 still import
nothing from the pipe (158 + 7 skip, 453). The shared reader gained `emitDone` and `Response`
acceptance to keep the published legacy contract, and `normalizeStream` gained an `onUsage`
sink so a ledger records usage before the host stops iterating. D3/D4/D6/D8 closed for this
track. D2 was **withdrawn as a defect**: the provider 403s without its CLI `user-agent`, so the
host attribution string and the provider identity genuinely collide — recorded as a declared
conflict, not a missing call.

**P1 implemented (same day, owner-approved sequence):** `lib/stream/` now exists with
`normalizeStream`, `readSseEvents`, `usageFrom`/`usageFromProjection`, `finishReasonFor`, and the
failure factories, exported as `@nolit/dsh-custom-router/stream`. Measured: **71 tests pass**
(14 SSE framing, 12 usage, 11 finish/failure, 20 pipeline, 14 pre-existing bridge tests);
`npm run check` passes over 12 files; **zero vendor consumers** (`grep` finds no import in any
`dsh-*` track); the three vendor suites are unchanged — antigravity 118, deepinfra 158 + 7 skip,
opencode-v2 453. The module imports no `dsh-llm`, registers no adapter, and contains no retry
loop, so R0 holds. P2 (`dsh-antigravity`) is next and is not started.

**Verification:** `npm run docs:check` (root) OK — 9 subproject indexes current, 1,332 links
checked. No code, profile, service, or version changed.

## 0.0.1-rc.1 — 2026-11-07 (OpenCodex bridge becomes runtime code)

**Owner instruction:** the OpenCodex bridge must not be duplicated across vendor plugins, and
the Custom Router track must document it so a future service does not re-derive it.

**Before (measured):** `dsh-opencode-v2`, `dsh-antigravity` and `dsh-deepinfra` each carried a
private `lib/opencodex-models.js`. Three consequences were measured:

1. each copy read its own server URL and key id, so the bridge had no single configuration;
2. the shared DSH client key was scoped per provider, so **the last plugin to save overwrote
   the other providers' scope** — a real silent revocation;
3. the same id-projection bugs had to be fixed three times.

**After:** `lib/` in this track is the only implementation.

| Module | Responsibility |
| :--- | :--- |
| `config.js` | `OPENCODEX_BRIDGE_URL`, `OPENCODEX_BRIDGE_KEY_ID`, management token |
| `opencodex-client.js` | `GET/PUT /api/selected-models`, `PATCH /api/keys` |
| `selection-projector.js` | DSH route → OpenCodex id, incl. Antigravity family aliases |
| `scope-aggregator.js` | union across providers, and the refusal to guess |
| `selection-sync.js` | ordering, re-read, failure propagation |
| `vendor-bridge.js` | the only import vendor plugins use |

Vendor plugins keep a one-function seam and their own checklist UI. The three vendor
`opencodexModelsUrl` / `opencodexClientKeyId` settings were removed: a per-vendor copy of shared
state is the defect, not the fix.

**Measured behavior split recorded in `docs/OPENCODEX-BRIDGE.md`:** `selectedModels` and
`disabledModels` are catalog visibility only; a direct call to an unselected, blocklisted model
still returned HTTP 200. Authorization exists only on a configured key, and only on a
non-loopback bind. The bridge therefore writes both, and skips the key write with a reason when
any provider is unrestricted rather than silently denying it.

**Measured (2026-11-07):**

| Check | Result |
| :--- | :--- |
| this track `npm test` | 14/14 pass |
| `dsh-opencode-v2` | 453/453 pass |
| `dsh-deepinfra` | 158 pass, 7 skip, 0 fail |
| `dsh-antigravity` | 118/118 pass |
| isolated real DSH boot with the bridge linked | **0** `did not activate` |
| live DSH service | not restarted; profile not edited |

**Added:** `scripts/link-custom-router.mjs` at the workspace root. A linked plugin is loaded
from its real path and DSH resolves a bare import through the profile's `node_modules` only for
declared peers, so the peer declaration alone is not enough; the script writes only the
gitignored workspace-root link.

**Not done:** no Settings-Models (Custom) surface, no client half, no real mount of that surface,
no scoped key issued, and no `rc#` bump beyond the existing `0.0.1-rc.1`.

## 0.0.1-rc.1 — 2026-11-06 (specification only)

**Before (measured):** four Custom Router specs sat in the shared `docs/` tree
(`CUSTOM-ROUTER-SERVICE-SPEC.md`, `CUSTOM-ROUTER-PROTOCOL-STANDARD.md`,
`CUSTOM-ROUTER-PRESET-SURFACE.md`, `CUSTOM-ROUTER-ARCHITECTURE.md`), indexed by
`npm run docs:index` as public documents (91→92 docs). The owner pointed out that this
pollutes the common tree and that the project belongs in its own track. Plugin versions were
also briefly written with the document version scheme; the owner separated the two:
**documents use `rc.#` for history, plugins start at `0.0.1-rc.1`**.

**Changed:** created `dsh-custom-router/` with `package.json`
(`@nolit/dsh-custom-router@0.0.1-rc.1`), `README.md`, this CHANGELOG, and `docs/`.
Moved the four specs into `dsh-custom-router/docs/` verbatim (doc skeleton versions corrected
from `0.0.1-rc1` to `0.0.1-rc.1`). Added three spec sections the owner named as missing:
subscription-plan detection logic, usage/quota normalisation, and standard-vs-custom coverage.

**Measured evidence carried into the specs:** DSH `0.2.2-rc.1`, `@deepseek-ai/dsh-llm@0.2.2-rc.1`;
`registerAdapter` all-or-nothing `DUPLICATE_ADAPTER`; real `LlmRuntime` S1–S8 scenarios;
isolated `DSH_HOME` A/B boots (81 entries, 0 activation failures, 0 page errors);
pi-ai `NO_COST` / `emptyPiUsage()` / generated `PROVIDER_DATA`; DeepInfra
`promotionOf()` 8/91; OpenCode `GET /api/experimental/usage/limits` real response
`go.rolling=2%, weekly=8%, monthly=29%, limited:false`; `GET /api/credential` 3 entries
(`Personal` oauth active, 2 keys inactive); Antigravity `retrieveUserQuotaSummary`;
DeepInfra `/v1/me` identity-only and `/v1/request-costs` 404 for this account.

**After (measured):** `npm run docs:check` reports the shared tree back to 88 docs;
`node scripts/check-plugin-history.mjs` reports this track OK; `git status` shows only the
new track plus the two regenerated shared indexes. No runtime code, live profile, service
restart, or existing plugin version was changed. No `rc#` was advanced — this is the first
session for this track and the owner's instruction is what created it.

**Same-session addition (no `rc#` bump):** `docs/PRESET-SCHEMA-AND-EXTENSION.md` — the
per-service preset descriptor/schema (`ServicePreset`, `ConfigFieldSpec`), schema conformance
rules S1–S9, measured extension limits (unlimited tabs/fields/child slots vs the uniqueness /
authority ceiling), and the T0–T7 coverage ceiling for a future service. Measured substrate:
`AgentPreset.Config.plugins = z.array(z.any())`, `settings.section` list kind, `SlotKind` union,
schemastery recursive types, and Config field counts 71 / 33 / 7.

**Same-session addition (no `rc#` bump):** `docs/WEB-AUTH-PIPELINE-ENGINE.md` — answers the
owner's layer question with measured call sites: web auth is minted/refreshed in the **lower**
pipeline (`auth.js:105-162`, `adapter.js:255-260` 401-retry, `http.js:1806`), while the upper
pipeline only constructs the provider (`index.js:374`) and reports readiness. Verdict: upper
pipeline, tool standardisation (`ToolDefinition`), and router engine (`LlmRuntime`) are **already
standard**; lower pipeline and model serving share the `LlmAdapter`/`StreamChunk` **contract**
but are implemented per service; plan/usage/promotion alone stay in the custom surface. Rule R0:
no second routing table.

**Same-session addition (no `rc#` bump):** `docs/RETRY-POLICY.md` — owner 2026-11-06
instruction: **no automatic model fallback**, harden retry only. Normative classification
(T1-T5 transport/socket/502-503-504 retryable; P1-P5 401/403/quota/402/400/404/422 terminal),
bounded 2-3 attempts at 500ms->1000->2000ms exponential jitter, clean terminal cause, **no
circuit breaker**. Recorded three measured deltas against current code: 429 and 451/500 are
currently retried, and backoff is 1000ms uncapped. Withdrew the PLAN-AND-USAGE U5 "offers another
service" wording. Spec only; no code/config/version changed.

**Not done:** no `settings.section` row, no client half, no real mount of the new surface,
no real generation turn. Those require the owner's implementation approval.
