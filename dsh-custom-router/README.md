# @nolit/dsh-custom-router

<!-- skeleton:
version: 0.0.1-rc.10
kind: readme
status: active
updated: 2026-11-08
summary: Custom Router track: the single installed plugin for the multi-row preset router, vendor dashboard, OpenCodex bridge, and the vendored Antigravity/DeepInfra adapters.
-->

| | |
| :--- | :--- |
| Package | `@nolit/dsh-custom-router` |
| Version | `0.0.1-rc.10` (numeric part owner-gated; `rc#` is the agent history marker) |
| Status | **implemented bundle + browser dashboard + vendored providers.** `lib/index.js` mounts the enabled preset rows; one `settings.section` (`custom-router`) owns usage/billing, per-layer switches and write-only credentials. Antigravity and DeepInfra no longer exist as separate profile plugins. |
| Docs | [`docs/`](./docs) — measured specs plus the bridge contract and runbook; document skeleton versions follow the `rc.#` history scheme (separate from the plugin version) |
| History | [`CHANGELOG.md`](./CHANGELOG.md) |
| Parent workspace | [`docs/RULES.md`](../docs/RULES.md) |

## Browser dashboard (M10, 2026-11-08)

`package.json` now declares `dsh.client` and `lib/client.js` registers exactly one
`settings.section` named `custom-router`. The dashboard is a **sidebar panel** (`sidebar.panellist`
plus the `main` page keyed `custom-router`) inside a single centred width container
(`.crPage`: `width:100%; max-width:1120px; margin:0 auto; padding:20px 24px`). It renders a DSH
page header (title, description, refresh), a KPI band of three cards, and **one column of compact
provider rows** (`.crProviderList`): each row carries the provider identity, the connection badge,
a mini usage summary (the tightest window's label, percent and reset time — or the spend and
balance for a pay-per-token provider) and the settings trigger. The **detail of the open provider
renders below the list at full width** (`.crProviderDetail`), holding the full measurement in a
compact inset and the settings form. Provider usage is read from the same local routes the vendor
panels use; a missing reading stays unavailable instead of becoming zero.

The browser surface follows the DSH design tokens: sizes come from `--dsh-content-font-size` and
its derived secondary, the family is inherited, every colour is a `--dsw-*` token (or
`transparent`), and the component language (rows, cards, form sections, toolbar, sticky action bar,
underline tabs) is the shadcn/ui composition rebuilt locally — this bundle loads through
`window.__ModuleLoader__` and may only require React, so no UI package is added. The settings
trigger is an inline SVG, and every interactive control carries a `:focus-visible` ring from
`--dsw-focus-ring-*`.

The surface carries its accessibility contract in the DOM, not only in the stylesheet: the plan
ledger is a real `<table>` with `<th scope="col">`; both tab strips are keyboard-operable
(`ArrowRight` / `ArrowLeft` / `Home` / `End` move the selection and the focus) and named; a
collapsed settings panel is `inert` and `aria-hidden`, so it leaves both the tab order and the
accessibility tree; every write result is announced through an always-mounted
`role="status" aria-live="polite"` region; every credential input is named by a real `<label>` and
is `autoComplete="new-password"`; every progress bar carries `aria-valuetext`; and
`prefers-reduced-motion: reduce` removes the transitions this surface owns.

Only the ACTIVE tab panel is rendered — the tabs are not `hidden`, they do not exist — so a
`display:flex` rule can never resurrect a second panel underneath the first. Each tab carries
`role="tab"`, `aria-selected`, and `aria-controls` pointing at the one mounted `role="tabpanel"`.

The same section is the **model-serving manager**: one tab per preset
(`안티그래비티 / 오픈코드 / 딥인프라`), one shared toolbar + group card + row + footer layout across
all three. The Antigravity tab groups by family (Gemini / Claude & GPT / Argon / 기타), shows the
family's remaining quota in the group header, and renders ONE row per base model — a checkbox
toggles every reasoning-effort variant of that row and the save value is the flattened variant
list. DeepInfra rows carry the per-1M input/output rate, the promotion badge and the struck-through
list price; subscription rows say `구독 포함` and never a fabricated price. An empty selection
cannot be saved, because every vendor reads `[]` as ALL.

Switch writes are path-scoped and atomic for compound controls. `lib/index.js` reconciles mounted
child rows on `app-boot/config-reload`, so a volatile settings write remounts only the affected
row. Credentials are write-only: the schema declares `role('secret')`, and the dashboard renders
only the redacted `설정됨/미설정` sidecar state.

## Shared downstream stream pipe (P1, 2026-11-07)

`lib/stream/` is the workspace's **one implementation** of everything between a decoded
provider payload and the host's last `StreamChunk`: SSE framing, block lifecycle, first-seen
index allocation, the six-way finish table, the disjoint usage writer, the mandatory
`{message, code}` failure shape, and the empty/cut/abort terminal policy. Providers differ only
through a descriptor plus hooks, so a vendor quirk never edits the core.

Exported as `@nolit/dsh-custom-router/stream`. It registers no adapter, holds no provider table,
contains no retry loop, and imports no `dsh-llm` — the router engine stays entirely the host's.

### Anthropic Messages (rc.6)

The pipe speaks two protocol families. `lib/stream/anthropic.js` (exported as
`@nolit/dsh-custom-router/stream/anthropic`) owns the Anthropic wire: event-typed SSE with no
`[DONE]`, `content_block_start`/`content_block_delta` (`text_delta`, `thinking_delta`,
`input_json_delta`, `signature_delta`), `message_delta` usage, and `message_stop`. A `thinking_delta`
becomes a `reasoning-delta` chunk — the host assembles it into a `reasoning` block — and a
`tool_use` block's `partial_json` becomes the same fragmented `tool-call-delta` the OpenAI lane
uses. The `signature` has no host chunk field, so it lives in the binding's per-stream state.

`createAnthropicHooks()` returns per-stream hooks (the pipe passes a fresh context per event), which
merge the two usage pieces and keep per-block signatures. Any provider that speaks the protocol
(DeepInfra `/anthropic`, OpenCode `/v1/messages`, a direct Anthropic key) reuses this module by
adding only endpoint, auth and catalog.

## Provider preset declarations (S4, 2026-11-07)

`lib/presets.js` (exported as `@nolit/dsh-custom-router/presets`) holds the M13–M16 surface contract
as **frozen data** plus `validatePreset` / `validatePresets`: the model route, subagent provider, CLI
worker (async or sync), tool/command names, optional skill, the protocol lane, and the usage/plan
record for each provider. It registers nothing and touches no context — the mounted preset surface
(M10) will read these declarations.

**Drift gate:** `npm run verify:presets` (owner decision 2026-11-07) boots an isolated `DSH_HOME`,
reads the runtime registries (providers, tools, commands) and each vendor's `Config.dict`, then
compares them with the declarations. It fails on a phantom command, a missing tool, or a switch that
does not exist in the module the preset names. Nothing registers during the check — the gate only
reads.

**Catalog & price layers:** `lib/catalog.js` merges the three sources field by field
(`upstream` pi-ai snapshot → `probe` API/web-auth list → `override` preset/local data, 3 > 2 > 1),
and `lib/cost.js` computes spend with the upstream formula (per-1M rates, tiers, 1h cache write 2×)
because DSH drops `usage.cost`.

**Vendor bridges:** three handlers — antigravity (OAuth + fingerprint RPC), opencode (daemon
`/api/model` Basic auth), deepinfra (standard OpenAI listing). Modules resolve through the profile
(`lib/vendor-modules.js`); `apply({profileDir})` builds the bridges and provides the `customRouter`
seam `{route, probe, merge}`.

**Antigravity bridge:** `lib/bridges/antigravity.js` reuses the vendor's TokenProvider /
resolveEndpoint / parseCatalog exports, keeps the measured `antigravity/cli/…` User-Agent (a 403
otherwise), and exposes `tokenPath` / `userAgent` / `extraHeaders` overrides through
`vendorConfig.antigravity`.

**Usage & quota:** `lib/usage.js` binds adapter usage to cost + billing and turns plan windows into
readings (`percent-consumed` / `fraction-remaining`, en/ko); vendor probes connect through an explicit
handler or the host discovery seam.

**Plan & billing:** `lib/plan.js` judges subscription/flat/pay-per-token plans from the preset's
`usage.billing.mode` and keeps `unknown` visible (`billingOutcome()` returns `null`, never `0`).

**Routing & probe:** `lib/routing.js` resolves a model id to a preset (explicit → provider →
`modelPrefixes`, ambiguity refused); `lib/probe.js` executes layer-2 endpoint probes for the
OpenAI/Anthropic shapes and refuses vendor-owned RPCs.

**Plugin body:** `@nolit/dsh-custom-router` applies presets by mounting each active preset's own
package plugin as a child (`ctx.plugin`) and disposing exactly that child when the preset is turned
off. It registers no adapter itself and mounts nothing by default; a profile must opt in per preset
(`presets: { antigravity: true }`). `cordis.patch.yml` ships the bundle row and the package exposes
both the plugin and the browser half.

### Commands

| Command | What it proves |
| :--- | :--- |
| `npm test` | pipe behaviour per module — **71 tests** |
| `npm run check` | every shipped module parses — 12 files |
| `npm run verify:stream` | the real pipe dispatches two independent provider hook sets while **all three vendor plugins are blocked at module resolution** — **7 cases, 0 vendor loads** |
| `npm run verify:stream:json` | the same, machine-readable |
| `npm run verify` | `check` + `test` + `verify:stream` |

There is **no `bin`** and no profile mount by design: this package is a library plus
specifications, and mounting it would register no provider while making the ownership map
wrong.

### Adoption state

| Track | Consumer of the pipe | Verified |
| :--- | :--- | :--- |
| `dsh-antigravity` | **yes** — `lib/stream-contract.js` is its only binding | 144/144 |
| `dsh-deepinfra` | no | 158 pass + 7 skip, unchanged |
| `dsh-opencode-v2` | no | 453/453, unchanged |

## Runtime code (added 2026-11-07)

`lib/` is the **single owner of the OpenCodex bridge**. Three vendor plugins previously each
carried a private copy of this client; the duplicate copies produced a real defect — the last
plugin to save overwrote the other providers' shared-key scope.

| Module | Responsibility |
| :--- | :--- |
| `lib/config.js` | bridge URL, shared key id, management token |
| `lib/opencodex-client.js` | management HTTP calls |
| `lib/selection-projector.js` | DSH id → OpenCodex id |
| `lib/scope-aggregator.js` | shared-key scope union and skip reasons |
| `lib/selection-sync.js` | write ordering and failure policy |
| `lib/vendor-bridge.js` | the only entry point vendor plugins import |

Contract: [docs/OPENCODEX-BRIDGE.md](./docs/OPENCODEX-BRIDGE.md) ·
Runbook: [docs/OPENCODEX-OPERATIONS.md](./docs/OPENCODEX-OPERATIONS.md) ·
Ownership: [docs/README-OWNERSHIP.md](./docs/README-OWNERSHIP.md)

## What this track owns

A **Custom Router** is a separate service class (agent/model API routing + model serving) that
registers inside the DSH `LlmRuntime` with `ctx.llm.registerAdapter`, not beside it. This track
owns the single settings/dashboard surface, the OpenCodex bridge, the shared stream pipe, and the
**vendored Antigravity and DeepInfra adapters** under `vendor/`. OpenCode remains a separate active
track because it is still independently installed and versioned.

The 2026-11-08 integration record is
[`docs/PROVIDER-INTEGRATION.md`](./docs/PROVIDER-INTEGRATION.md).

The owner's decisions encoded here:

1. **New separate surface** — `설정-모델(커스텀)` as a plugin-owned `settings.section`, not tabs
   inside the standard Settings → Models page (which has no tab API).
2. **Read-only credential reference** — a DSH-managed API key is referenced (found/missing) but
   never copied, adopted, or written. If web auth (oauth / token file) is absent, a separate
   `role('secret')` key input is shown as the fallback.
3. **Per-service standardisation** — one shared contract (M1–M12), per-service implementations
   for credential chain, catalog, plan/quota/promotion, cost, readiness, and preset tab.

## Documents

| File | Answers |
| :--- | :--- |
| [`docs/PROVIDER-INTEGRATION.md`](./docs/PROVIDER-INTEGRATION.md) | 2026-11-08 move of Antigravity/DeepInfra into `vendor/`, profile cleanup, and the llm-pi-ai re-enable decision |
| [`docs/CUSTOM-ROUTER-SERVICE-SPEC.md`](./docs/CUSTOM-ROUTER-SERVICE-SPEC.md) | standard baseline, coexistence verdict, tool-preset activation |
| [`docs/CUSTOM-ROUTER-PROTOCOL-STANDARD.md`](./docs/CUSTOM-ROUTER-PROTOCOL-STANDARD.md) | per-service wire/auth/catalog differences → `StreamChunk` mapping |
| [`docs/CUSTOM-ROUTER-PRESET-SURFACE.md`](./docs/CUSTOM-ROUTER-PRESET-SURFACE.md) | the new surface, credential modes, readiness/plan checks |
| [`docs/CUSTOM-ROUTER-ARCHITECTURE.md`](./docs/CUSTOM-ROUTER-ARCHITECTURE.md) | composition diagrams + normative per-service module contract |
| [`docs/PLAN-AND-USAGE-SPEC.md`](./docs/PLAN-AND-USAGE-SPEC.md) | subscription-plan detection + usage/quota normalisation + standard-vs-custom coverage |
| [`docs/PRESET-SCHEMA-AND-EXTENSION.md`](./docs/PRESET-SCHEMA-AND-EXTENSION.md) | per-service preset schema, standardisation boundary, extension limits, future-service coverage ceiling |
| [`docs/WEB-AUTH-PIPELINE-ENGINE.md`](./docs/WEB-AUTH-PIPELINE-ENGINE.md) | upper vs lower pipeline web-auth ownership, and which of the five layers are standard vs per-service |

## Rules that bind this track

- Measure first; report measured before/after in `CHANGELOG.md` ([RULES.md §6.1](../docs/RULES.md)).
- Single writer: only this track's files are written.
- Live `~/.dsh` and the 3080 service are read-only without owner approval.
- Plugin version `0.0.1-rc.1` start, `rc#` by owner instruction only (global AGENTS.md §6).
- Document skeleton versions use the `rc.#` history scheme; they are **not** plugin versions.
