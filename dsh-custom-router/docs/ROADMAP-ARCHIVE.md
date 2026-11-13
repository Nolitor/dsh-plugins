# Custom Router — Roadmap Archive (completed / deprecated)

<!-- skeleton:
version: 1.0
kind: report
status: historical
updated: 2026-11-14
summary: Closed and superseded roadmap items for @nolit/dsh-custom-router, kept as evidence only. Active work lives in ROADMAP.md; current state and next actions live in HANDOFF.md.
-->

> **Do not execute anything below as a plan.** This file exists so old Phase/Step numbers stop
> polluting the active roadmap. Active work: [ROADMAP.md](./ROADMAP.md). Current state:
> [HANDOFF.md](./HANDOFF.md). Detailed history: [CHANGELOG.md](../CHANGELOG.md).

## 1. Absorption phases (OpenCode v2 → router vendor tree)

| Item | Status | Why it is closed | Evidence |
| :--- | :--- | :--- | :--- |
| Phase A — vendor tree + shim, exports, leaf contract | **Done** | The package is vendored and the legacy track was archived | `vendor/opencode/`; `archive/dsh-opencode-v2/`; router and opencode suites green |
| Phase B — B-1 hooks/lifecycle, B-2 shared pipe behind `pipe`, B-3 descriptor case | **Done** | Shared pipe and its OpenCode descriptor case are shipped | `lib/stream/`; `vendor/opencode/lib/http.js:2054`; `verify:stream` 8/8 |
| Phase B — replay `markerDeltas == 0` | **Deprecated** | Withdrawn as unevidenced; the trace has no per-marker count | Blueprint §9.1 |
| Phase C — `parts`/`syncAll` supervisor, config-reload, dispatch binding, no second settings section | **Done** | The vendor now behaves like Antigravity's supervisor | `vendor/opencode/lib/index.js:930,1075,1021,939`; `verify:dispatch` 17/17 |
| Phase D — vendored slot, `loadVendorModules` by URL, preset-only boot | **Done** | No code path reads the profile link | `lib/presets.js:161`; `lib/vendor-modules.js`; `verify:presets` |
| Phase D — remove the legacy profile link | **Done (already absent)** | It is not in `~/.dsh/profiles/web/package.json`; only a broken node_modules symlink remains | live profile measured 2026-11-14 |
| Phase E — runtime independence, shim/docs archived | **Done** | The track directory is gone; the shim is under `archive/` | `test/vendor-modules.test.mjs`; `archive/dsh-opencode-v2/` |

## 2. Cross-cutting work that shipped

| Item | Status | Evidence |
| :--- | :--- | :--- |
| Model-list refresh contract (`?refresh=1`, both buttons, one refresh bus) | **Done** | `MODEL-LIST-REFRESH.md`; `verify:refresh` PASS |
| CLI dispatch control plane (admission + reclamation) | **Done** | `lib/dispatch-gate.js`; `verify:dispatch` 17/17 |
| Preset registry derivation (single `PRESETS` source, `MODEL_PRESETS` derived) | **Done** | `lib/preset-derive.js`; `client.src.js:1990`; `verify:presets:mutation` 17/17 |
| Preset drift gate (tabs, usage routes, locales, artefacts) | **Done** | `verify:presets`; `verify:presets:mutation` |
| S4b provider-slot Step 1 | **Done, then withdrawn** | The `cli:false` toggle was withdrawn the same day; the live profile carries `cli_worker`/`/ocode` |
| S4c preset-based dispatch policy | **Done** | `verify:dispatch` 17/17 |
| Antigravity + DeepInfra vendor integration | **Done** | `PROVIDER-INTEGRATION.md`; both under `vendor/` |
| OpenCodex selection bridge | **Done** | `lib/vendor-bridge.js`, `selection-sync`, `scope-aggregator`; `OPENCODEX-*` specs |
| **P1-4** DeepInfra pricing re-verification (2026-11-14) | **Done** | Live catalog re-read: 178 entries, 92 chat-tagged, 8 discounted (0.05–0.51); `specs/pricing/deepinfra.json` `verifiedAt: 2026-11-14`, 7-day `ttlDays` retained; matrix regenerated |
| **P1-5** `spec:watch` baseline age check | **Done** | `scripts/verify-specs.mjs` `checkWatchBaseline` (14-day default, warning by default, `--strict-watch`/`verify:freshness:strict` = error); 41 specs tests; manual cycle run 2026-11-14: 14 watched, 0 changed, 0 errors; cadence runbook in `specs/README.md` |
| **P1-6** Four-preset live-route smoke check | **Done** | `scripts/refresh-expectations.mjs` + rewritten `verify-refresh-routes.mjs`; `verify:refresh` reports 4/4 preset routes and fails on a missing route/row; 22 new tests; measured 2026-11-14: antigravity 10 bases (Claude + Hydrogen), opencode 32 go rows, deepinfra 92 rows/8 discounted, exaone `k-exaone_v2.5` |
| Antigravity `thoughtSignature` replay fix (live 400) | **Done, pending restart** | Nested-inside-`functionCall` replay → part-level sibling; isolated real-wire proof 400→200; vendor suite 190/190 |
| **P2-4** Anthropic + Google conformance fixtures | **Done** | `test/conformance/anthropic-messages.test.mjs` (6 tests: usage merge across `message_start`/`message_delta`, signature fragments, request-side tool-result grouping) and `google-generative-sse.test.mjs` (5 tests: part-level `thoughtSignature`, cumulative `usageMetadata`, STOP→tool-calls). 3 of 5 wires covered; negative proofs per fixture |
| **P2-9** Documentation freshness sweep | **Done** | 12+ docs corrected to the rc.19 baseline (test counts, rc numbers, 178/92 catalog, DSH 0.2.2-rc.3, live unit 01:07:25 KST); `PRESET-REGISTRY-STANDARD` §4 self-contradiction fixed; `SERVICE-SPEC` "all three are `link:` deps" disproved against the live profile; C5 **CONFIRMED** — the shipped client registers exactly one `settings.section`, the vendor clients are unreachable dead code |

| **T16** preset surface audit (subagent/CLI per preset) | **Done (measurement)** | Matrix pinned: antigravity + opencode carry subagent provider + CLI worker + tools/command; deepinfra + exaone are model routes only (`registerAdapter` and nothing else). Declarations match vendored source in both directions; new `test/preset-surfaces.test.mjs` (4 tests, suite 629/629). Only gap = the live EXAONE allowlist entry (owner, ROADMAP P1-3) |
| **T18** obsolete-doc prune | **Done** | Inventory of 26 docs with real inbound-link counts (one earlier reading was direction-inverted and corrected before acting). `FEATURE-SUMMARY.md` (no hand-written inbound link, version table stopped at rc.17) moved to `docs/archive/` with depth-fixed links and a new `docs/archive/INDEX.md`; nothing deleted; `docs:check` green — 233 docs / 1,702 links || **P1-2** Antigravity multi-turn tool use (Claude + Gemini) | **Done** | Post-restart live probes 2026-11-14 02:15/02:16 KST: Gemini stepped tool-call (real 372-byte `thoughtSignature` on the part) → tool result → follow-up `PROBE_GEMINI_OK`, `turn/end completed`, zero 400/`Cannot find field`; Claude one assistant message carried two `bash` calls, both results, `turn/end completed`. Contrast: pre-restart session `4e240372` ended in the nested-signature 400 |
| **T19** credential-store support (agent side of P0-2) | **Delivered, owner-gated** | Both vendored presets declare `credentialRef` (`DEEPINFRA_API_KEY` / `EXAONE_API_KEY`), resolve via `ctx.credentials.resolve()` at mount + on `credentials/reference-updated`, precedence `apiKey → store ref → env` pinned by `keyPrecedence` tests (deepinfra 222+7 skip, exaone 19, router 629). Runbook `docs/CREDENTIAL-STORE-MIGRATION.md`; owner still rotates+registers the values |
| **P2-7** dead-surface deletion | **Done (owner-approved)** | `vendor/antigravity/lib/subagent-opencode.js` (sha256 `033d478b…`) deleted with its `"./subagent-opencode"` export entry (16 keys left, 0 dangling) and no stale README reference; broken profile symlink `~/.dsh/profiles/web/node_modules/@nolit/dsh-opencode-v2` removed (symlink only — containing dir inode unchanged, 6 remaining entries all resolve). Gates after: antigravity 190/190, router 625/625, `verify` 0, `verify:presets` OK |
| Synthetic `OpenCode (config default)` model row | **Done (2026-11-14)** | The phantom row was produced in two places per vendored adapter — the `models` config default and the `listModels` prepend under the `OpenCode Go (direct)` provider group: `vendor/opencode/lib/http.js` and `vendor/opencode/lib/provider.js`. Both config defaults now seed **no** row (`.default([])`) and both prepends are gone. It was never a model id, so the picker stopped showing it. **KEPT on purpose:** the `default` pseudo-route still resolves server-side (`modelRefFromRoute` → `defaultModel`; `resolveOpencodeModel` → empty `-m`), because that is route resolution, not a dropdown entry. Producer grep count for the label = **0**; `test/model-catalog-default-row.test.mjs` (4 tests) asserts the absence; the vendor test that used to assert *"the config-default row always stays selectable"* now asserts absence, plus a new vendor test pins that the pseudo-route still resolves to `defaultModel`. No locale key ever existed for that label (count 0 in `locale/{en,ko,zh}.json`, `lib/locale-table.js`, `vendor/opencode/locale/*.json`), so no orphan translation was left behind. Suites after: router **649/649**, opencode **555/555** |

## 3. Superseded procedures / claims

| Old claim | Why it is archived |
| :--- | :--- |
| `PRESET-REGISTRY-STANDARD.md` §1–§2 “two registries / five places” | The browser registry is derived; only `ROUTER_PROVIDERS`/`PICKER_ITEMS` remain hand-authored and are tracked as P2-1 |
| `CLI-DISPATCH-CONTROL-PLANE.md` §8.1–8.4 “`cli:false`; no config-reload; Step 2/3 blocked on M9” | The toggle was withdrawn, the reload listener exists, and the legacy path is gone; M9 was never required for activation |
| `SHARED-STREAM-PIPE-SPEC.md` “P1–P3 done, P4 next” | P4 is integrated; the residual is the `pipe:'shared'` default (P2-2) |
| `OPENCODE-ABSORPTION-BLUEPRINT.md` Phase A/C/D/E checklists | Implemented; only Phase B's `shared` default and Phase F's canonical parser remain (P2-2/P2-3) |
| `HANDOFF.md` (pre-2.0) “Phase C pending / remove profile link / 535 tests” | Phase C is delivered, the link is gone, and the current suite is 625; replaced by the 2026-11-14 handoff |
| `HANDOFF.md` / boot card “583 tests”, “service active since 00:34:48 KST” | Measured 2026-11-14: suite 625, and the live unit started 01:07:25 KST (`ActiveEnterTimestamp`, `MainPID 142881`) |

## 4. Where the residuals went

| Residual | Active location |
| :--- | :--- |
| `pipe:'shared'` live gate | [ROADMAP.md](./ROADMAP.md) P2-2 |
| Canonical parser (Phase F) | [ROADMAP.md](./ROADMAP.md) P2-3 |
| Anthropic/Google conformance fixtures | **Closed** — see §2 (P2-4) |
| S3 per-group usage | [ROADMAP.md](./ROADMAP.md) P2-5 |
| S4 spec-only surfaces | [ROADMAP.md](./ROADMAP.md) P2-6 |
| Data-only preset install | [ROADMAP.md](./ROADMAP.md) P2-1 |
| API-key migration | [ROADMAP.md](./ROADMAP.md) P0-1 |
| Pricing freshness / watch cadence | **Closed** — see §2 (P1-4, P1-5) |
