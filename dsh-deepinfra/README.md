# @nolit/dsh-deepinfra

<!-- skeleton:
version: 1.3
kind: readme
status: active
updated: 2026-11-04
summary: Operator manual for the DeepInfra LLM adapter for DeepSeek Harness — config-layer credentials (no systemd edit), model enable/disable with promotion badges, the composer cost chip, the usage ledger and i18n.
-->

A DeepInfra model route for DeepSeek Harness. It registers **one** LLM provider (`deepinfra`)
that calls `https://api.deepinfra.com/v1/openai/chat/completions` directly.

| Document | Answers |
|---|---|
| this file | how to install and configure it |
| [ARCHITECTURE.md](ARCHITECTURE.md) | how it is built, and why each layer owns what it owns |
| [CONTEXT.md](CONTEXT.md) | **read before changing anything** — the defects already made here |
| [UPSTREAM-COMPAT.md](UPSTREAM-COMPAT.md) | measured per-vendor behaviour across 20 vendors |
| [CHANGELOG.md](CHANGELOG.md) | what changed, with measured before/after |

There is no daemon, no spawn, no local control plane and no credential store: the only moving
part is one bearer key. Compare `dsh-opencode-v2`, which needed all four.

## What this plugin adds

| Surface | Where |
|---|---|
| Model route `deepinfra` | chat, tool calls, reasoning |
| Settings card "DeepInfra" (Korean "딥인프라" only while the DSH locale is `ko`) | Settings → Plugins |
| Cost chip `$0.1736` | composer, in the additive `conversation.input.right` list seat beside the model selector; no seat until a measured figure exists |
| Usage ledger | `$DSH_HOME[/profiles/<name>]/deepinfra-session-cost.json` |

## Install

```bash
dsh plugin --profile <name> add /path/to/dsh-deepinfra
```

The bundle patch inserts the row automatically.

### Credential — enter it once in the UI, nothing else

**You do not need to edit a systemd unit, add an `EnvironmentFile`, or export anything.**

Type the key into Settings → Plugins → DeepInfra → **API key** and save. The host settings service
persists it into the profile's `cordis.patch.yml` and updates the live loader entry, so the
adapter reads it on the **next turn** with no restart.

```
UI input → settings.update('dsh-deepinfra', { apiKey })
         → profile cordis.patch.yml
         → live config → read on every request
```

Two schema properties make this work, and each has a test:

| Property | Why it is required |
|---|---|
| `.volatile()` | The host computes `volatileForm(schema)` and refuses the write with "has no volatile fields" otherwise |
| `role('secret')` | `redactSecrets` strips the value from every wire projection; the card learns only `set: true` |

Precedence: **the saved UI key first**, then `DEEPINFRA_API_KEY` from the environment. The patch
default is `''` rather than `!!js process.env.…`, because a pinned expression would be
re-evaluated on each boot and shadow the saved key.

A missing key does not stop the boot — the model catalog is public — only the first completion
fails with `INVALID_CREDENTIAL`.

## Configuration

| Field | Default | Meaning |
|---|---|---|
| `baseURL` | `https://api.deepinfra.com/v1/openai` | Override only for a compatible gateway |
| `apiKey` | `''` (secret) | Bearer credential |
| `turnMaxTokens` | `16384` | Completion tokens ONE TURN reserves (the host's `defaultMaxTokens`) |
| `contextWindow` | `32768` | Used only when a route reports none (none of the 91 do) |
| `catalogTtlMs` | `1800000` | How long a fetched catalog stays authoritative |
| `defaultEffort` | `''` | Reasoning effort materialized when a caller omits one; must be one of the seven below |
| `enabledModels` | `[]` | Advertise only these ids; empty means every chat route |

## Vendor support

The endpoint is one OpenAI-compatible API in front of **20 vendors**. Measured behaviour, with no
per-vendor branching in the request path:

| | Result |
|---|---|
| Universal | `system`/`developer` roles, SSE + `[DONE]`, `include_usage`, `estimated_cost`, structured `tool_calls`, parallel results, stop/tool_calls/length |
| Reasoning channel | `delta.reasoning_content` where the vendor emits it; absent on Qwen's non-thinking variants |
| Vendor quirk | Anthropic **requires** a tool description; the serializer guarantees one |
| Verified through DSH | anthropic/claude-sonnet-5, google/gemini-2.5-pro, Qwen/Qwen3-235B — all completed a real tool loop |

See [UPSTREAM-COMPAT.md](UPSTREAM-COMPAT.md) for the full matrix and the request values the
provider rejects.

## Models

The catalog endpoint is **public** (HTTP 200 with no credential), so a cold start never fails on
auth. Measured 2026-11-04: 173 entries, **91 chat-tagged**. Only chat routes are advertised,
because image-gen, tts, stt, video-gen and embed each carry their own tag and none carry `chat`.

- `contextWindow` comes from `metadata.context_length`.
- `inputModalities` gains `image` when the route is tagged `vision` or `vlm` (52 routes).
- **`defaultMaxTokens` is NOT the catalog's `max_tokens`.** On all 91 chat routes
  `max_tokens === context_length`, so it describes capacity, not a per-response cap; using it
  would reserve a whole 1M window for one answer. The reservation comes from `turnMaxTokens`.

## Reasoning

The provider enum is `none | minimal | low | medium | high | xhigh | max`; anything else returns
HTTP 422. Effort ids are passed through unchanged. Reasoning text arrives as
`delta.reasoning_content` and is emitted on its own block index, never mixed into visible text.

Efforts are **advertised** only on routes tagged `reasoning` or `reasoning_effort` (73 of 91).
That is a conservative advertisement, not a capability statement: measured on
`deepseek-ai/DeepSeek-V3.2` (neither tag), sending `reasoning_effort:"high"` produced 50 reasoning
deltas and sending nothing produced none. The adapter therefore accepts an effort on any route.

**Budget the answer, not just the thinking.** A reasoning route spends `max_tokens` on thinking
first. Measured on `moonshotai/Kimi-K2.6` at `medium`: `max_tokens:256` was consumed entirely by
reasoning (finish `length`, zero text); `2048` produced 381 reasoning tokens then the answer.

## Usage and cost

Counts are **disjoint**, as the host requires. DeepInfra folds cache hits into `prompt_tokens`
(measured 9612 prompt / 9600 cached on a warm prefix), so `inputTokens` is the uncached
remainder and `cacheReadTokens` the subset.

DeepInfra reports its own cost: `usage.estimated_cost`, exact USD. This adapter uses it verbatim.
A locally derived figure exists only as a fallback, uses catalog `pricing` **and**
`metadata.discount` (a fraction to subtract: 0.3 means pay 70%), and is labelled `estimated`.

`completion_tokens_details.reasoning_tokens` is present on some routes and entirely absent on
others; absence is reported as "not reported", never as 0.

## Errors

| Condition | Code |
|---|---|
| 401 / 403 | `INVALID_CREDENTIAL` |
| 404 `model_not_found` | `UNKNOWN_MODEL` |
| 422 | `UNSUPPORTED_OPTION` |
| 429 | `RATE_LIMIT` (`providerRetryAfterMs` from `Retry-After`) |
| 5xx | `SERVER` |
| context overflow wording | `CONTEXT_WINDOW_EXCEEDED` |
| stream cut / transport | `TRANSPORT` (thrown) |
| undecodable SSE record | `PROTOCOL` (thrown) |
| `>16` stop sequences | `UNSUPPORTED_OPTION` (thrown before any request) |
| terminal `stop` with no content | `finish{kind:'error', code:'EMPTY_RESPONSE'}` |

A rejected request is never billed, so a retry after `RATE_LIMIT` is safe.

## Choosing models

Settings → Plugins → DeepInfra → **Served models** lists every chat route with:

- a **promotion badge** (`75% off`) and the list price struck through, for the routes the catalog
  discounts — measured: 8 of 91 carry one, from 10% to 75% off;
- effective **input/output price per million tokens**;
- context window, and `vision` / `reasoning` capability badges;
- a search box and All / None helpers.

Only ticked models appear in the model picker. **Promotional routes are sorted first**, deepest
discount at the top, so an offer is visible without hunting. An empty selection means "serve
everything".

A promotion is **derived from `metadata.discount`**: the catalog publishes no featured or promo
tag — its tag vocabulary is capability only (`chat, vision, vlm, reasoning, reasoning_effort,
prompt_cache, embed, tts, stt, image-gen, video-gen`).

## Cost chip and usage ledger

The chip shows what the **current session** has cost, using DeepInfra's own
`usage.estimated_cost` in USD. It is gated on the **provider id** only: a model id is shared
across routers, so matching it would show the chip on routes this adapter never served. On any
other provider the occupant returns `null` and occupies no seat at all.

The ledger partitions spend **by session, by model and by turn**:

```json
{ "version": 1,
  "sessions": { "session-…": {
    "requests": 3, "costUsd": 0.0031914008,
    "tokens": { "input": 21835, "output": 214, "reasoning": 0, "cacheRead": 10624 },
    "byModel": { "deepseek-ai/DeepSeek-V4.1-Flash": { "requests": 3, "costUsd": 0.0031914008 } },
    "turns": { "1": { "requests": 3, "costUsd": 0.0031914008 } } } },
  "recent": [ … ] }
```

A turn is one DSH turn, not one model call: a tool loop makes several calls that all belong to the
same turn. The turn number comes from the host's own numbering (`agent/turn-stopping` announces a
turn as it closes, so the turn in flight is that value plus one).

### Local routes

| Route | Purpose |
|---|---|
| `POST /api/local/deepinfra/setup` | credential source, catalog count, usage totals |
| `POST /api/local/deepinfra/setup/apply` | save `apiKey` / `baseURL` / `turnMaxTokens` / `defaultEffort` |
| `POST /api/local/deepinfra/models` | every served route with price, promotion and capability |
| `POST /api/local/deepinfra/models/apply` | save the enabled model selection |
| `POST /api/local/deepinfra/cost/session` | one session's figure and text |
| `POST /api/local/deepinfra/cost/summary` | every session |
| `POST /api/local/deepinfra/cost/reset` | clear one session, or all |

## Localization

English is the default; Korean is complete. The plugin name, settings section title, every field
label, hint, status and the chip tooltip exist in both. The section follows host locale changes
live. English shows **DeepInfra**; Korean shows **딥인프라**.

## Tests

```bash
npm test                              # 132 pass, 7 self-skip without a key
set -a; . ~/.env; set +a; npm test    # 139/139 with a key
```

The real-API suite self-skips without `DEEPINFRA_API_KEY`, so a keyless CI run stays green.
`test/client-runtime.test.mjs` executes the real browser module in a VM sandbox, because two
client boot failures (ESM `import`/`export` syntax) passed every source-reading test.
