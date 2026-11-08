# Custom Router — Ownership Map

<!-- skeleton:
version: 0.0.1-rc.8
kind: reference
status: active
updated: 2026-11-08
summary: One-page ownership map after the 2026-11-08 integration: the Custom Router owns the dashboard, bridge, shared pipe and the vendored Antigravity/DeepInfra adapters; the rule that keeps a new service from re-deriving the same bridge.
-->

> Read this before adding code to any `dsh-*` track that touches OpenCodex.

## 1. Current ownership

| Surface | Owner | State |
| :--- | :--- | :--- |
| OpenCodex bridge (URL, token, projection, scope union) | **this track** (`lib/`) | implemented, tested |
| Shared downstream stream pipe (SSE → StreamChunk → usage → finish) | **this track** (`lib/stream/`) | implemented and consumed by both vendored providers |
| OpenCode model checklist + DSH `settings.update` | `@nolit/dsh-opencode-v2` | implemented; still a separate active track |
| Antigravity model checklist + `agy` credential reuse | **this track** (`vendor/antigravity/`) | integrated 2026-11-08; no separate profile plugin |
| DeepInfra model checklist | **this track** (`vendor/deepinfra/`) | integrated 2026-11-08; no separate profile plugin |
| Settings-Models (Custom) surface | **this track** | implemented browser dashboard |
| Per-service preset tabs | **this track** | implemented in the dashboard |
| DSH host packages (`dsh-llm`, `dsh-app-boot`, UI) | `@deepseek-ai/*` | out of scope, never edited |

## 2. What this track deliberately does NOT own

- **No second adapter registration path.** The router mounts each preset's child plugin; the child
  still calls `ctx.llm.registerAdapter` for its own provider id. The router itself never registers
  an adapter, so `DUPLICATE_ADAPTER` remains a host-enforced failure rather than a router policy.
- **No request-time credentials in the pipe.** The shared pipe never reads a token, a catalog, or
  a settings row. It receives already-decoded provider records and emits `StreamChunk`s.
- **Provider credentials stay with their provider row.** The vendored Antigravity/DeepInfra rows
  keep their own credential fields and write-only dashboard inputs. This track only ever sees the
  OpenCodex **management** token in the bridge library.
- **One UI.** The `custom-router` settings section is the only dashboard for provider usage,
  per-layer switches, model checklists and write-only credentials.

## 3. The one rule for a fourth service

Adding a provider must be **data, not a new client**:

1. provider name → `SCOPABLE_PROVIDERS` (`lib/scope-aggregator.js`)
2. id projection → `projectSelection()` (`lib/selection-projector.js`)
3. vendor seam → `applySelection({ provider, enabled, activePlan })`
4. tests → one projection case + one scope-union case

If a change requires a new HTTP client, a new token reader, or a vendor-local URL, the change
is in the wrong package.

## 4. Package wiring facts

- OpenCode declares `@nolit/dsh-custom-router` in `peerDependencies`; DSH resolves that linked
  plugin's bare imports from the **profile's** `node_modules`. `scripts/link-custom-router.mjs`
  provides the workspace link.
- Antigravity and DeepInfra are vendored at `vendor/antigravity/` and `vendor/deepinfra/`. They
  are not separate profile dependencies and do not appear as top-level tracks.
- This package **is** in the live profile's `dsh.profile.bundles` and is the single loader row for
  the provider presets it mounts.

## 5. Document map

| Question | Document |
| :--- | :--- |
| What is the contract and why one owner? | [OPENCODEX-BRIDGE.md](./OPENCODEX-BRIDGE.md) |
| How do I operate or roll it back? | [OPENCODEX-OPERATIONS.md](./OPENCODEX-OPERATIONS.md) |
| How do the three routers compose? | [CUSTOM-ROUTER-ARCHITECTURE.md](./CUSTOM-ROUTER-ARCHITECTURE.md) |
| What does each service standardise? | [CUSTOM-ROUTER-SERVICE-SPEC.md](./CUSTOM-ROUTER-SERVICE-SPEC.md) |
| Where did the Antigravity/DeepInfra plugins go? | [PROVIDER-INTEGRATION.md](./PROVIDER-INTEGRATION.md) |
| What exactly is shared downstream, and where are the hooks? | [SHARED-STREAM-PIPE-SPEC.md](./SHARED-STREAM-PIPE-SPEC.md) |
| Retry/fallback policy | [RETRY-POLICY.md](./RETRY-POLICY.md) |
