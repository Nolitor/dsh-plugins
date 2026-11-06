# Changelog — @nolit/dsh-custom-router

<!-- skeleton:
version: 0.0.1-rc.1
kind: report
status: active
updated: 2026-11-06
summary: Engineering history for the Custom Router track; created 2026-11-06 as a specification-only track with four measured specs migrated out of the shared docs tree.
-->

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
