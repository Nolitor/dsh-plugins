# @nolit/dsh-custom-router

<!-- skeleton:
version: 0.0.1-rc.1
kind: readme
status: active
updated: 2026-11-06
summary: Specification-only track for the Custom Router service: a plugin-owned Settings-Models (Custom) surface and the standardised per-service model-serving contract.
-->

| | |
| :--- | :--- |
| Package | `@nolit/dsh-custom-router` |
| Version | `0.0.1-rc.1` (owner scheme: plugin versions start here; `rc#` moves only by owner instruction) |
| Status | **specification only** — nothing is mounted, no `cordis.patch.yml`, no runtime code |
| Docs | [`docs/`](./docs) — seven measured specs; document skeleton versions follow the `rc.#` history scheme (separate from the plugin version) |
| History | [`CHANGELOG.md`](./CHANGELOG.md) |
| Parent workspace | [`docs/RULES.md`](../docs/RULES.md) |

## What this track owns

A **Custom Router** is a separate service class (agent/model API routing + model serving) that
registers inside the DSH `LlmRuntime` with `ctx.llm.registerAdapter`, not beside it. This track
owns the **specification and the future plugin-owned surface**, not the three existing vendor
packages (`@nolit/dsh-opencode-v2`, `@nolit/dsh-antigravity`, `@nolit/dsh-deepinfra`).

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
