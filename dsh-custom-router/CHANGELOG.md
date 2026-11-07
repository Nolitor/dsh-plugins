# Changelog — @nolit/dsh-custom-router

<!-- skeleton:
version: 0.0.1-rc.4
kind: report
status: active
updated: 2026-11-08
summary: Engineering history for the Custom Router track: created 2026-11-06 as a specification track, extended 2026-11-07 with the single-owner OpenCodex bridge library, the preset declarations, and the first real multi-row mount, extended 2026-11-08 with the settings schema and the single browser dashboard (M10 UI sprint).
-->

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
  rates/promotions. Tests 265/265; no selection was saved against the live profile during
  verification (the write path is covered by unit tests).

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
