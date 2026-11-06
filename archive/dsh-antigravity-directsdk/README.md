# Antigravity Subscription — DirectSDK for DeepSeek Harness

<!-- skeleton:
version: 1.0
kind: readme
status: archived
updated: 2026-11-05
summary: DirectSDK track absorbed into @nolit/dsh-antigravity.
-->


> ## ⚠️ ARCHIVED / SUPERSEDED — do not install this package
>
> This package was **absorbed into `@nolit/dsh-antigravity`** on 2026-11-05 and moved to
> `archive/` on the owner's instruction ("통합되어서 안쓰는거 아닌가 … 아카이브에 보관해").
>
> | | |
> | :--- | :--- |
> | **Replacement** | `@nolit/dsh-antigravity` (bundle `@nolit/dsh-antigravity`) |
> | **Surface now in the replacement** | the `antigravity` provider route (`ctx.llm.registerAdapter`), plus `/agy`, `agy_worker`, `subagent_antigravity`, the settings section and the usage chip |
> | **Measured state (2026-11-05)** | not in `~/.dsh/profiles/web/package.json`, not in `dsh.profile.bundles`, **0** occurrences in `dsh --profile web --dump-config`, no `@nolit` node_modules link, and `dsh-antigravity/lib/*` imports nothing from here → it is dead code |
> | **Why it cannot be reinstalled alongside the replacement** | both register the provider route `antigravity`; a duplicate route/name aborts the plugin row (docs/RULES.md §4) |
> | **What to do** | Nothing. Read it as history. Use `@nolit/dsh-antigravity`. |
>
> Its tests still pass (25/25 at archival) and its code still works; it is superseded, not broken.
> `node_modules/` inside is gitignored local symlink scaffolding and is not part of the record.

A **pure `LlmAdapter`** that runs DSH on a Google Antigravity consumer subscription by calling `cloudcode-pa.googleapis.com` directly over HTTP. No CLI, no subprocess, no agent persona: the harness owns the system prompt, tool schemas, tool execution, approvals and history.

Every protocol detail here was measured against the live API on 2026-11-05.

## Why not the CLI

The Hermes plugin of the same name drives `agy` as a subprocess and parses its `stream-json`. That path works, but on a host with `dangerouslySkipPermissions` the model can execute shell commands through `agy` and those calls never reach a DSH approval gate. This adapter bypasses the agent entirely: the model only ever produces text, thoughts and tool calls, and DSH executes them.

## Layout

| File | Role |
| :--- | :--- |
| `lib/index.js` | Plugin entry, config schema, catalog cache |
| `lib/auth.js` | Refresh-token grant, token cache |
| `lib/settings.js` | Precedence: config → env → built-in default |
| `lib/wire.js` | DSH messages → Gemini `contents`/`tools` |
| `lib/sse.js` | SSE reader (CRLF and LF) |
| `lib/map.js` | Part classification, finish reasons |
| `lib/usage.js` | Disjoint token accounting |
| `lib/catalog.js` | Model list, quota, account |

## Authentication

The access token is obtained with the **refresh token already on disk** from `agy`:

```
~/.gemini/antigravity-cli/antigravity-oauth-token
{ "token": { "access_token", "refresh_token", ... }, "auth_method": "consumer" }
```

Probe order: `jetski-standalone-oauth-token`, then `antigravity-oauth-token`. Sign in with `agy` once and this plugin works. The file is read, never written.

The OAuth client id/secret default to the values extracted from the `agy` binary. They are installed-application credentials (public by Google's model for native apps), kept in one place and **overridable** — a rotated pair is a settings edit, not a code change.

## Precedence

Every value resolves **config → environment → built-in default**:

| Value | Config | Env | Default |
| :--- | :--- | :--- | :--- |
| client id | `clientId` | `ANTIGRAVITY_CLIENT_ID` | agy-extracted |
| client secret | `clientSecret` | `ANTIGRAVITY_CLIENT_SECRET` | agy-extracted |
| refresh token | `refreshToken` | `ANTIGRAVITY_REFRESH_TOKEN` | token file |
| token file | `tokenFile` | `ANTIGRAVITY_TOKEN_FILE` | probe list |
| base URL | `baseUrl` | `ANTIGRAVITY_BASE_URL` | daily host |
| User-Agent | `userAgent` | `ANTIGRAVITY_USER_AGENT` | measured agy string |

## Measured protocol

### Hosts

Generation MUST use the daily host. The same body and token return **200** on `daily-cloudcode-pa.googleapis.com` and **429** on `cloudcode-pa.googleapis.com`; control-plane RPCs answer on both.

```
POST {base}/v1internal:streamGenerateContent?alt=sse
POST https://cloudcode-pa.googleapis.com/v1internal:loadCodeAssist
POST https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels
```

### Envelope

```json
{ "project": "aicode-consumers", "requestId": "agent/…",
  "request": { "contents": [...], "systemInstruction": {...}, "tools": [...],
               "generationConfig": { "maxOutputTokens": 65536,
                 "thinkingConfig": { "includeThoughts": true, "thinkingLevel": "LOW" } },
               "sessionId": "…" },
  "model": "gemini-3.8-flash-low", "userAgent": "antigravity", "requestType": "agent" }
```

Field-removal test: **`model` is the only required top-level key** (omit → 404 NOT_FOUND). `model` is the *picker id* from the catalog (`gemini-3.8-flash-low`), not the catalog key (`gemini-3.8-flash-tiered`).

### Digital fingerprint

Requests are rejected without an `antigravity/cli/` User-Agent: **403** `You do not have a valid license of this product`, and `loadCodeAssist` reports `UNSUPPORTED_CLIENT`. The adapter sends the measured string. This is a protocol field of the client Google ships, not a disguise; it is configurable so a newer CLI string can replace it.

### Response parts

| Part | Meaning |
| :--- | :--- |
| `{"text": "..."}` | assistant text |
| `{"text": "...", "thought": true}` | reasoning |
| `{"functionCall": {"name","args","id"}}` | complete tool call |
| `{"thoughtSignature": "..."}` | opaque, ignored |

Frames are CRLF-terminated. **Frames delimited by `\r\n\r\n`** — an `\n\n`-only split silently yields zero events from a valid 200 response.

### Usage

`usageMetadata` is cumulative; the last frame wins. DSH counts are disjoint, so `promptTokenCount` is split against `cachedContentTokenCount`, and `thoughtsTokenCount` becomes `reasoningTokens` (never added to `outputTokens`).

## Configuration

```yaml
clientId: ''       # '' = built-in default
clientSecret: ''   # '' = built-in default
tokenFile: ''      # '' = probe the known filenames
refreshToken: ''   # '' = use the token file
baseUrl: ''        # '' = daily-cloudcode-pa
project: ''        # '' = aicode-consumers
userAgent: ''      # '' = measured agy string
catalogTtlMs: 900000
enabledModels: []
extraHeaders: {}
```

## Tests

```bash
node --test test/*.test.mjs   # 25 tests, no network
```

## Live verification (2026-11-05, gemini-3.8-flash-low)

| Case | Result |
| :--- | :--- |
| plain text | "ADAPTER-OK", finish `stop` |
| with tools | `get_weather({"city":"Seoul"})`, finish `tool-calls` |
| reasoning high | text "391", `reasoningTokens: 152` |
| catalog | 19 conversation models with per-model quota |
| account | tier `free-tier`, paidTier `g1-pro-tier` |
