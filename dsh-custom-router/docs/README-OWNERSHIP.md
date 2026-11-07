# Custom Router — Ownership Map

<!-- skeleton:
version: 0.0.1-rc.1
kind: reference
status: active
updated: 2026-11-07
summary: One-page ownership map: which package owns which surface, what this track does NOT own yet, and the rule that keeps a fourth service from re-deriving the same bridge.
-->

> Read this before adding code to any `dsh-*` track that touches OpenCodex.

## 1. Current ownership

| Surface | Owner | State |
| :--- | :--- | :--- |
| OpenCodex bridge (URL, token, projection, scope union) | **this track** (`lib/`) | implemented, tested |
| Shared downstream stream pipe (SSE → StreamChunk → usage → finish) | **this track** (`lib/stream/`, target) | **specified, not implemented** — [SHARED-STREAM-PIPE-SPEC.md](./SHARED-STREAM-PIPE-SPEC.md) |
| OpenCode model checklist + DSH `settings.update` | `@nolit/dsh-opencode-v2` | implemented |
| Antigravity model checklist + `agy` credential reuse | `@nolit/dsh-antigravity` | implemented |
| DeepInfra model checklist | `@nolit/dsh-deepinfra` | implemented |
| Settings-Models (Custom) surface | **this track** | **not implemented** — spec only |
| Per-service preset tabs | **this track** | **not implemented** — spec only |
| DSH host packages (`dsh-llm`, `dsh-app-boot`, UI) | `@deepseek-ai/*` | out of scope, never edited |

## 2. What this track deliberately does NOT own

- **No adapter registration.** All three vendor plugins call `ctx.llm.registerAdapter` themselves.
  Adding a second registration path here would risk `DUPLICATE_ADAPTER`. The shared stream pipe
  is a library the adapters call **inside** their own `stream()`; it holds no registry, no
  provider table, no dispatch, and no retry loop (R0 intact).
- **No request-time credentials.** The pipe never reads a token, a catalog, or a settings row.
  It receives already-decoded provider records and emits `StreamChunk`s.
- **No provider credentials.** Upstream keys and OAuth tokens stay in each vendor plugin.
  This track only ever sees the OpenCodex **management** token.
- **No UI.** The Settings-Models (Custom) section is specified but not mounted; the vendor
  plugins keep their own settings sections until that surface exists.

## 3. The one rule for a fourth service

Adding a provider must be **data, not a new client**:

1. provider name → `SCOPABLE_PROVIDERS` (`lib/scope-aggregator.js`)
2. id projection → `projectSelection()` (`lib/selection-projector.js`)
3. vendor seam → `applySelection({ provider, enabled, activePlan })`
4. tests → one projection case + one scope-union case

If a change requires a new HTTP client, a new token reader, or a vendor-local URL, the change
is in the wrong package.

## 4. Package wiring facts

- All three vendor packages declare `@nolit/dsh-custom-router` in `peerDependencies`.
- DSH resolves a linked plugin's bare imports from the **profile's** `node_modules` and only
  for declared peers; `scripts/link-custom-router.mjs` provides the workspace link.
- This package is `0.0.1-rc.1` and is **not** in any profile's `dsh.profile.bundles`: it is a
  library, not a mounted plugin. Adding it to bundles would mount nothing and mislead readers.

## 5. Document map

| Question | Document |
| :--- | :--- |
| What is the contract and why one owner? | [OPENCODEX-BRIDGE.md](./OPENCODEX-BRIDGE.md) |
| How do I operate or roll it back? | [OPENCODEX-OPERATIONS.md](./OPENCODEX-OPERATIONS.md) |
| How do the three routers compose? | [CUSTOM-ROUTER-ARCHITECTURE.md](./CUSTOM-ROUTER-ARCHITECTURE.md) |
| What does each service standardise? | [CUSTOM-ROUTER-SERVICE-SPEC.md](./CUSTOM-ROUTER-SERVICE-SPEC.md) |
| What exactly is shared downstream, and where are the hooks? | [SHARED-STREAM-PIPE-SPEC.md](./SHARED-STREAM-PIPE-SPEC.md) |
| Retry/fallback policy | [RETRY-POLICY.md](./RETRY-POLICY.md) |
