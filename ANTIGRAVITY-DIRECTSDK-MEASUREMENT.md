<!-- skeleton:
version: 1
kind: measurement
status: active
updated: 2026-11-05
summary: Measured feasibility of reusing the Hermes antigravity-subscription-directsdk module to build DSH plugins (OpenCode v2 / DeepInfra class). Verdict: NOT a drop-in; usable only as an LLMAdapter after solving 4 blockers.
-->

# Antigravity Subscription DirectSDK — 실측 보고 (DSH 플러그인 재사용성)

Measured 2026-11-05 (KST) on this host. Everything below is from a live run, not from docs.

## 1. Identity and location (measured)

| Item | Measured value |
| :--- | :--- |
| Path | `~/.hermes/plugins/antigravity-subscription-directsdk` (real dir, not a symlink) |
| Upstream | `soyelmismo/hermes-antigravity-subscription` |
| Installed HEAD | `4cbb056` = tag `v1.0.21` (clean, one untracked `.hermes-catalog.json`) |
| Catalog pin | `sha 4cbb0563…`, `tier community`, installed `2026-10-28T16:13:57Z` |
| `catalog-entry.yaml` in repo | **stale drift**: says `v1.0.0`, `requires_hermes >=0.21.0`; `plugin.yaml` says `v1.0.21`, `>=0.21.4` |
| Language / size | Python — 8 modules + 20 test files, 1.4 MB |
| Manifest kind | `model-provider` (Hermes provider plugin) |

## 2. Runtime it depends on (measured)

| Dependency | Measured |
| :--- | :--- |
| `agy` binary | `~/.local/bin/agy`, 234 MB, **v1.4.12**, 2026-10-31 |
| Hermes host | `v0.22.6+493.gfd267bb`, install `~/.hermes/hermes-agent` (git) |
| Auth | live — `agy models` returned 13 models from the real account |
| Account models | `gemini-4-argon-{low,medium,high}`, `gemini-3.8-flash-{…}`, `claude-opus-5-5-{…}`, `claude-sonnet-5-5-{…}`, `gpt-oss-120b-medium` |

Note: the README model table (gemini-3.8 / claude-4-6 / gpt-oss) is **already behind** the account (now 4-argon and 5-5). Dynamic discovery covers this.

## 3. Live wire protocol (measured, own probe, not through the plugin)

Command: `agy --model gemini-3.8-flash-low --input-format stream-json --output-format stream-json --disable-slash-commands`, stdin = NDJSON.

```json
{"event":"user","message":{"content":"<prompt text>"}}
```

- **stderr/stdout split is clean**: all JSON on stdout, all errors on stderr. Field is `event`, not `type`.
- **init**: `{event:"init", conversation_id, init:{model, cwd, tools:[60 tools]}}` — agy injects **60 native tools**.
- **step_update**, `state: ACTIVE|DONE`: `step_type` is one of `user_input | agent_response | tool | finish`. Token deltas arrive as `text_delta` on successive ACTIVE `agent_response` step_updates.
- **result**: `{status: SUCCESS|ERROR, response, num_turns, usage:{input_tokens, output_tokens, thinking_tokens, cache_read_tokens, total_tokens}, structured_output?, error?}`
- **Multi-turn over one process works**: two NDJSON lines → two results, same `conversation_id`, `num_turns` 1 → 2, and the second turn answered with the secret from the first (`BANANA7`).
- **Argument-order traps** (real errors hit during measurement): `-p` swallows the next token as its prompt; with `--input-format stream-json` a command-line prompt is rejected outright. Prompts must come from stdin only.

Measured latency/usage baseline (`gemini-3.8-flash-low`):

| Probe | duration | input tok | output tok |
| :--- | ---: | ---: | ---: |
| trivial "PONG-OK" | 3.9 s | 8,440 | 4 |
| one `run_command` turn | 8.0 s | 17,299 | 360 |

**8,440 input tokens for a 5-word prompt** is the fixed system-prompt/persona overhead. That is an unpatchable floor on every turn.

## 4. Blocking findings

### B1 — the host is a full agent, not a completion API

Aidi is an **agentic CLI**. It executes tools itself. Measured: prompt "use run_command to run `ls`" → `step_index 2, step_type tool, tool_name run_command, parameters {"CommandLine":"ls -la"}` → result "Command exited with…".

### B2 — native tools are NOT sandboxed on this host (security)

The plugin's whole guard model assumes headless = tools denied. That is false here. `~/.gemini/antigravity-cli/settings.json`:

```json
{"autoExecutionPolicy":"CASCADE_COMMANDS_AUTO_EXECUTION_EAGER",
 "dangerouslySkipPermissions": true, "toolPermission":"always-proceed",
 "permissions":{"allow":["command(*)","read_file(*)","write_file(*)"]}}
```

Plugin isolation (`process.py:582 setup_isolated_home`) links only the OAuth token into a private `HOME` — so the isolated `~/.gemini/antigravity-cli` gets no settings, and settings are absent, not overridden. Effective result: **the model can run `command(*)` on the host through a "read-only provider" plugin**. This never appears in Hermes as a tool call; DSH approval gates never see it.

### B3 — no forced / schema'd tool call

- Strict "output only `<tool_call>{…}`" prompt → **remained pure text**, no tool_call, model answered directly.
- `--json-schema` → emits `structured_output`, but as a **second field alongside free text** ("2 + 2 = 4야…\n{"arguments"…}"), `num_turns=2`. Schema steers content; it does not gate the turn into a tool instead of an answer.

DSH's `LlmAdapter.stream()` is expected to return **either** text deltas **or** `tool_call` deltas that the harness executes. `agy` cannot be constrained to that choice per turn.

### B4 — reasoning text is not exposed

README confirms upstream (issue 31). No `thinking` deltas in stream-json; `thinking_tokens` only counted in usage. DSH UI reasoning display cannot be fed.

## 5. What IS reusable

| Component | Portable to DSH? |
| :--- | :--- |
| `client.py` worker lifecycle / locks | Logic yes — **rewrite** (Python → TS) |
| `stream.py` event parser | **Directly portable** (best asset) |
| `prompt.py` tool-output pruning (600 KB → 180 KB, 70 %) | Portable idea |
| `usage.py` delta tracking | Portable (fields measured above) |
| `process.py` keyring / isolated HOME | Portable, **but see B2** |
| `__init__.py` Hermes profile registration | **Not portable** — Hermes-specific |

## 6. DSH-side contract (measured, from `@deepseek-ai/dsh-llm`)

```ts
abstract class LlmAdapter {
  abstract stream(options: GenerateOptions): AsyncIterable<StreamChunk>; // only required method
  listModels(provider): Promise<readonly LlmModelInfo[]>;
  resolveModel(provider, model, signal?): Promise<LlmResolvedModelInfo>;
}
ctx.llm.registerAdapter(providers, adapter);
```

So the DSH plugin shape is **exactly the OpenCode v2 / DeepInfra class**: an `LlmAdapter` route. `agy`'s `init` + dynamic `agy models` maps onto `listModels/resolveModel` cleanly.

## 7a. CORRECTION — what "DirectSDK" means here (measured 2026-11-05)

An earlier revision of this section treated the Antigravity CLI as a *replacement* for an HTTP route.
That misread the context. Measured reference architecture (`dsh-opencode-v2`):

| Surface | Export | Role |
| :--- | :--- | :--- |
| CLI worker | `lib/index.js` | `opencode` delegation tool + `/ocode` command + `cli_worker` — spawns `opencode run` |
| HTTP adapter | `lib/http.js` | route `opencode-http-agent` — pure `LlmAdapter`, calls provider `/chat/completions` directly |

Both load from **one plugin**, side by side. They are two surfaces, not two alternatives.

**Applied to Antigravity:** the Hermes plugin we measured is only the **CLI surface** (spawn `agy`, drive its stream-json). That surface stays. The missing work is the **second surface**: a web-auth HTTP adapter paralleling `opencode-http-agent`, added alongside the CLI path. My §12 "CLI is not mandatory" was answering the wrong question — it is not CLI *versus* HTTP, it is CLI **plus** HTTP.

## 7. Delta against the current plugins

| | OpenCode v2 | DeepInfra | Antigravity DirectSDK |
| :--- | :--- | :--- | :--- |
| Transport | HTTP `/chat/completions` | HTTP (OpenAI-compat) | **subprocess CLI + NDJSON** |
| Tool calling | native `tool_calls` deltas | native | **text-protocol+/-native, uncontrollable (B3)** |
| Stop reason | `finish_reason` | `finish_reason` | **none** in `result` — not observed |
| Usage | disjoint fields | provided | provided (measured) |
| Reasoning | streamed | varies | **not exposed (B4)** |
| Side effects | none | none | **host commands (B2)** — CLI surface only; HTTP surface avoids it |

## 8. Verdict

**Not a drop-in module. Not reusable as-is.**

It is a Hermes *provider plugin* (Python), not an SDK. What ported conceptually is the stream parser and the usage accounting; the transport model (spawn `agy`, text prompt, native-tool abort) collides with the DSH adapter contract on three axes: tool-call choice (B3), stop reason, reasoning (B4). And on this host it carries a real security regression against a "read-only provider" expectation (B2).

**Ranking against the sibling plugins:**

1. **DeepInfra adapter** — cleanest fit, no blockers.
2. **OpenCode v2** — clean fit, HTTP-native tool calls.
3. **Antigravity DirectSDK** — feasible **only as a text-only / low-tools `LlmAdapter`** (chat, summarization, cheap classification on existing subscription quota), gated on fixing B2 first.

## 9. Prerequisite before any build (5 questions)

1. **B2**: who owns `~/.gemini/antigravity-cli/settings.json`? Until native execution is *forced off* for the spawned child, no DSH plugin should spawn `agy`. Candidate: `--settings '{"toolPermission":"…","dangerouslySkipPermissions":false}'" — **not yet measured**.
2. Scope: text-only adapter, or does it need DSH tool execution?
3. If tools are needed: is `--json-schema` + a forced "return a tool call or FINISH" contract acceptable (measured unreliable, B3)?
4. Where does the quota show? `/usage` exists in Hermes; the DSH equivalent is `cost.js`-style ledger — does agy expose quota in stream-json? (not measured).
5. Ownership: a new track per the single-writer rule (it became `dsh-antigravity-directsdk/`, now
   archived under `archive/` after the merge).

## 10. Reproduction

```bash
cd /tmp && mkdir -p agyprobe && cd agyprobe
printf '%s\n' '{"event":"user","message":{"content":"Reply with exactly: PONG-OK"}}' \
  | agy --model gemini-3.8-flash-low --input-format stream-json --output-format stream-json \
        --disable-slash-commands
```
Probe artifacts left at `/tmp/agyprobe/` (`out_plain.ndjson`, `out_tools.ndjson`, `raw1.ndjson`).
## 11. Child-process command blocking — MEASURED (2026-11-05, flash-low only)

All probes ran `--model gemini-3.8-flash-low`. Weapon: model asked to `touch /tmp/agyprobe/PWNED_<id>` using **its own** `run_command`; ground truth = file on disk.

| # | Configuration | Outcome |
| :--- | :--- | :--- |
| I | real HOME (control) | **EXECUTED** |
| D | `--mode plan` | **EXECUTED** — warns "no effect while slash expansion disabled" |
| E | `--sandbox` | **EXECUTED** — sandbox error, model **retried and succeeded** |
| A/B/F | `--settings` (any denied key) | **rejected**: unknown/invalid setting |
| G | isolated HOME, no settings | **BLOCKED** — "headless mode cannot prompt, so it was auto-denied" |
| H | isolated HOME + deny settings | **BLOCKED** (command) / **EXECUTED** (write_file) |

**Root cause**: native execution is governed **only** by `~/.gemini/antigravity-cli/settings.json` (`dangerouslySkipPermissions:true`, `permissions.allow:["command(*)","read_file(*)","write_file(*)"]`). With HOME isolated the file is absent, so headless auto-denies command. There is **no CLI flag** to force denial — `--settings` rejects every key tried.

**Caveats (do not overstate):**
- `write_file` executed even in configuration H. Blocking measured for **command only**.
- G/H stripped allow-list and skip-permissions together; their separate contributions are **not** isolated.
- Only `gemini-3.8-flash-low` measured.

**Verdict**: spawn `agy` only under an isolated HOME with **no** settings file copied; never copy the user's.

## 12. Web-auth routing (OpenCode v2 style) — MEASURED

| Fact | Measured |
| :--- | :--- |
| Token file | `antigravity-oauth-token`: `access_token` (260), `refresh_token` (103), `token_type Bearer`, `expiry` |
| Auth | `auth_method: consumer` (Google account) |
| API host | `cloudcode-pa.googleapis.com` (`/v1internal`) |
| RPCs in binary | `LoadCodeAssist`, `FetchAvailableModels`, `GenerateContent`, `StreamGenerateContent`, `countTokens`, `onboardUser` |
| Token endpoint | `oauth2.googleapis.com/token` |

**So: CLI is NOT mandatory.** `StreamGenerateContent` over HTTP is available; the CLI is just a client of it. HTTP routing bypasses the agent persona **and** B2/B3/B4 entirely. Gate: unknown request schema.
## 13. Google Antigravity SDK (`google-antigravity`) — MEASURED 2026-11-05

Source: PyPI `google-antigravity` 0.1.23, `Google-Antigravity/antigravity-sdk-python`, Linux x86_64 wheel 45.2 MB, unpacked at `/tmp/agy-sdk/x`.

### What it is

| Fact | Measured |
| :--- | :--- |
| Package | real Google package, Apache-2.0, requires Python >=3.10 |
| Ships | 135 MB `bin/localharness` ELF (stripped, static) |
| Transport | Python spawns `localharness`, talks **websockets**, protobuf messages |
| Protos | `localharness_pb2` (57 KB), `content_pb2`, `steps_pb2`, `user_steps_pb2` — **schema fully readable** |

### Why this matters (it removes B3 and B4)

`HarnessConfig` is the request contract, and it is host-controlled in exactly the way DSH needs:

```
Msg Tool:
   name                  str
   description           str
   parameters_json_schema str     <-- DSH supplies tool schemas directly
   response_json_schema   str
   defer_loading          bool
Msg HarnessConfig:
   system_instructions / tools / workspaces,
   compaction_threshold, models, policy_config,
   initial_trajectory, mcp_servers
```

Steps include `ContentStep`, **`ThoughtStep`**, `ToolCallStep`, `ToolResultStep`, `CompactionStep`, `FunctionCallStep`.

- **B3 dissolves**: tools are declared by the *host* via `parameters_json_schema`, not by an embedded persona prompt.
- **B4 dissolves**: `ThoughtStep` exists in the protocol, so reasoning is a first-class step.

### The catch — auth does NOT cover the subscription

`models.py`: `GeminiAPIEndpoint.validate_endpoint()` demands `GEMINI_API_KEY`; `VertexEndpoint` takes `project/location/api_key`.
`grep` for `cloudcode`, `consumer`, `oauth`, `refresh_token`, `antigravity-oauth` → **zero hits** (only unrelated prose).

So the SDK is built for **API-key / Vertex billing**, not the Antigravity consumer subscription. The subscription in §12 (`auth_method: consumer`, `refresh_token`) is reachable only through `cloudcode-pa.googleapis.com` — the path `agy` uses and the SDK does not implement.

### Consequences for the build

| Approach | Protocol understood | Subscription quota | B2 | B3/B4 |
| :--- | :--- | :--- | :--- | :--- |
| A. `agy` CLI (current) | yes (§3) | **yes** | blocked by isolated HOME | B3/B4 present |
| B. raw `cloudcode-pa` HTTP | **no** — still unknown | **yes** | none | solved |
| C. SDK `localharness` | **yes (proto)** | **no** — needs API key | none | **solved** |

**The SDK is not a shortcut to the subscription.** It is the best map of the *agent contract*, which is exactly what a B-style adapter must satisfy. Use C's proto as the specification, implement B's transport, and inject the `refresh_token` credential path that `agy` uses.
## 14. HTTP direct — VERIFIED END-TO-END (2026-11-05, gemini-3.8-flash-low)

Method: mitmproxy on `127.0.0.1:8899`, `agy` routed via `HTTPS_PROXY` + `SSL_CERT_FILE`. Captured 43 flows including the full 129 KB agent body.

### Verified auth chain

| Step | Endpoint | Result |
| :--- | :--- | :--- |
| Refresh | `POST oauth2.googleapis.com/token` | **200**, scope includes `aicode` |
| client_id | `[client-id withheld from the public mirror; see local copy / PROVENANCE]` | only pair that works (1 of 9) |
| client_secret | `[installed-app secret withheld from the public mirror]` | installed-app public secret, embedded in binary |
| Tier | `POST /v1internal:loadCodeAssist` | 200, `cloudaicompanionProject: aicode-consumers`, tier `free-tier` |
| Quota | `POST /v1internal:fetchAvailableModels` | 200, per-model `quotaInfo.remainingFraction` |
| **Generate** | `POST daily-cloudcode-pa.googleapis.com/v1internal:streamGenerateContent?alt=sse` | **200 SSE** |

### Digital fingerprint (confirmed, correct behaviour)

| UA | Result |
| :--- | :--- |
| none | **403** "You do not have a valid license of this product" |
| `antigravity/cli/1.5.0 (aidev_client; os_type=linux; arch=amd64; cl=1013440158; auth_method=consumer)` | accepted |

Exact captured UA string. `loadCodeAssist` likewise returns `UNSUPPORTED_CLIENT` in `ineligibleTiers` without it.

### Minimal working request (verified 200)

```json
{
  "project": "aicode-consumers",
  "requestId": "agent/<uuid>/<ms>/1",
  "request": {
    "contents": [{"role": "user", "parts": [{"text": "..."}]}],
    "sessionId": "-3750763034362895579",
    "generationConfig": {"maxOutputTokens": 65536,
      "thinkingConfig": {"includeThoughts": true, "thinkingLevel": "LOW"}}
  },
  "model": "gemini-3.8-flash-low",
  "userAgent": "antigravity",
  "requestType": "agent"
}
```

Field-removal test (from known-good body):

| Removed | Result |
| :--- | :--- |
| `requestId` | 200 |
| **`model` (top-level)** | **404 NOT_FOUND** — the only required key |
| `userAgent` | 200 |
| `project` | 200 |
| `requestType` | 200 |
| `request.sessionId` | 200 |
| `request.generationConfig` | 200 |

### Why the earlier attempt returned 429

The earlier probes sent `model` at the top level **and** a bare `request` without the envelope, and tried model ids from `fetchAvailableModels` (`gemini-3.1-flash-lite`, `gemini-3.8-flash-tiered`, …). The generation API expects the **picker id** (`gemini-3.8-flash-low`), not the catalog key. Mixed with the mismatched envelope this surfaced as 429; with the captured envelope it is 200. **Corrected: the 429 was not quota.**

### Response contract

SSE frames of `data: {"response": {"candidates":[{"content":{"role":"model","parts":[{"text":"..."}]}}], "usageMetadata":{promptTokenCount, candidatesTokenCount, thoughtsTokenCount, totalTokenCount}, "modelVersion":"gemini-3.8-flash-n", "responseId":"..."}, "traceId":"...", "metadata":{}}`

- `thoughtsTokenCount` is reported → reasoning is measurable via `thinkingConfig.includeThoughts: true`.
- Captured agent body carries **12 tools** with `functionDeclarations` — host-supplied, Gemini tool-calling format. **B3 and B4 are solved on the HTTP path.**

### Verdict

HTTP direct is **feasible and verified**. The CLI is not required. Build target is a pure `LlmAdapter` in the `opencode-http-agent` shape, using the refresh token, this UA, and this envelope.
## 15. Implementation — @nolit/dsh-antigravity-directsdk 0.0.1 (2026-11-05)

Built at `dsh-antigravity-directsdk/`, later **absorbed into `@nolit/dsh-antigravity`** and moved to
`archive/dsh-antigravity-directsdk/` (2026-11-05, owner instruction). Pure `LlmAdapter`, route
`antigravity`. 8 lib modules, 25 unit tests, live-verified.

### Two bugs found only by running it (not by reading the protocol)

1. **Wrong host silently returns 429.** The same body and token return 200 on `daily-cloudcode-pa.googleapis.com` and 429 on `cloudcode-pa.googleapis.com`. Control-plane RPCs answer 200 on both, so the failure looks like quota. Generation must use the daily host; `loadCodeAssist`/`fetchAvailableModels` stay on the plain host.
2. **SSE frames are CRLF-terminated.** A `\n\n` split finds no boundary on the real stream and yields **zero events from a valid 200 response**, surfacing as EMPTY_RESPONSE. Parser now splits on either convention, CRLF tested first (because `\r\n\r\n` contains `\n\r\n`).

Both are covered by `test/sse-crlf.test.mjs` so they cannot regress.

### Third bug, caught by the mount check

`resolveModel` returned only `{provider}` because it read from `find()`, which returns the raw entry without the efforts normalization `list()` applies. Unit tests passed; only calling it through a mock cordis context exposed it.

### Verification (measured)

| Check | Result |
| :--- | :--- |
| syntax (`npm run check`) | OK, 9 files |
| unit tests | **25 pass, 0 fail** |
| mock mount | route `antigravity` registered, adapter disposed cleanly |
| `listModels` | **19 conversation models**, live, with context/output/quota |
| `resolveModel` | full metadata after fix |
| live plain text | "ADAPTER-OK", finish `stop` |
| live with tools | `get_weather({"city":"Seoul"})`, finish `tool-calls` |
| live reasoning high | text "391", `reasoningTokens: 195` |
| catalog | tier `free-tier`, paidTier `g1-pro-tier` |

### Credential structure (as instructed)

No client id/secret at a call site. Precedence is **config → env → built-in default** for every value:

| Value | Config | Env | Default |
| :--- | :--- | :--- | :--- |
| client id | `clientId` | `ANTIGRAVITY_CLIENT_ID` | agy-extracted |
| client secret | `clientSecret` (secret) | `ANTIGRAVITY_CLIENT_SECRET` | agy-extracted |
| refresh token | `refreshToken` (secret) | `ANTIGRAVITY_REFRESH_TOKEN` | token file |
| token file | `tokenFile` | `ANTIGRAVITY_TOKEN_FILE` | probe list |
| base URL | `baseUrl` | `ANTIGRAVITY_BASE_URL` | daily host |
| User-Agent | `userAgent` | `ANTIGRAVITY_USER_AGENT` | measured agy string |

The refresh token is read from `agy`'s credential file and **never written**.

### Not yet done

- Not installed into the running DSH profile (no live mount in the 3080 GUI). That is a separate, approval-gated step per the 4-step plugin replacement rule.
- `node_modules/@deepseek-ai/*` are local symlinks for testing only; they must not be published.
