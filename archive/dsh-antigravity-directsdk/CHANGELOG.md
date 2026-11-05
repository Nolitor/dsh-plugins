# Changelog — @nolit/dsh-antigravity-directsdk

> ## ⚠️ ARCHIVED — superseded by `@nolit/dsh-antigravity`
>
> Absorbed 2026-11-05; moved to `archive/` on owner instruction the same day. The `antigravity`
> provider route, the CLI worker, the subagent provider, the settings section and the usage chip
> all live in `@nolit/dsh-antigravity` now. Two packages cannot both register the `antigravity`
> route. Kept as the historical record; do not install.

Current version: `0.0.1-rc.1`

## 0.0.1-rc.1 — version ladder + localized display metadata — 2026-11-05

Owner decision: every `@nolit` track reports `0.0.1-rc.N`; `0.0.1` → `0.0.1-rc.1`.

| Surface | Before | After |
| :--- | :--- | :--- |
| `package.json.version` | `0.0.1` | `0.0.1-rc.1` |
| `engines.node` | `^22.19.0 \|\| >=24.0.0` | `>=24.9` |
| `locale/` | empty directory | `locale/en.json` + `locale/ko.json` meta, exported and shipped |
| Tests | 25/25 | 25/25 green |

rc.1 audit: host-only adapter registering one provider route through `ctx.llm`; no tool row, no
Session Projection, no app-boot import.

## [0.0.1] — 2026-11-05

Initial implementation. Pure `LlmAdapter` for the `antigravity` provider route.

### Measured facts this release encodes

- Generation works over plain HTTP on `daily-cloudcode-pa.googleapis.com`; the
  plain `cloudcode-pa` host answers control-plane RPCs but returns 429 for
  generation with the same body and token.
- Only the top-level `model` field is required; omitting it returns 404.
- `model` must be the catalog picker id, not the `fetchAvailableModels` key.
- Requests without an `antigravity/cli/` User-Agent are rejected 403.
- SSE frames are CRLF-terminated.
- `thoughtsTokenCount` and `functionCall` parts are both available, so reasoning
  and tool calling are first-class on this route.

### Features

- OAuth refresh-token grant with a shared in-flight refresh and skew-aware cache.
- Credential precedence: config → env → built-in default. Client id/secret
  defaults are extracted from `agy` but never pinned at a call site.
- Live model catalog with per-model context, output limit, thinking support and
  quota, cached with a configurable TTL.
- Streaming text, thought and tool-call deltas; disjoint usage accounting.
- Classified HTTP errors: `AUTH`, `NO_LICENSE`, `NOT_FOUND`, `RATE_LIMITED`.
