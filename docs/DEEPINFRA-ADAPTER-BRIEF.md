<!-- skeleton:
version: 1.0
kind: spec
status: active
updated: 2026-11-04
summary: Build brief for the next session — a DeepInfra API-key LLM adapter plugin for DSH (@nolit/dsh-deepinfra). Records the measured DeepInfra surface (OpenAI-compatible /v1/openai, 91 chat routes, reasoning_effort enum, prompt-cache pricing, 16,384 output cap), the DSH adapter contract it must satisfy, why API-key auth removes the hardest parts of the OpenCode V2 build (no control plane, no spawn, no OAuth, no credential store to seek), the five parts that do NOT become easy, the acceptance gates, and the exact open questions to answer with a key.
-->

> Status: **not started** · Target package: `@nolit/dsh-deepinfra` · Next session ·
> Inputs: [DeepInfra docs](https://docs.deepinfra.com/llms.txt),
> [DSH adapter cookbook](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/cookbook/adding-an-llm-adapter.md),
> [DSH LLM streaming](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/subsystems/llm-streaming.md),
> [deepseek-recipe](https://github.com/deepseek-ai/deepseek-recipe)

# DeepInfra adapter — build brief for the next session

## 1. Verdict on "API key makes it easier"

**Mostly yes, and the reason is structural — but not for the reason it looks.**

The OpenCode V2 build was hard because it is a *control-plane* adapter: the model route
lived behind a local daemon (`opencode serve`) that had to be attached or spawned, a
credential store had to be probed through `GET /api/credential`, OAuth and API-key entries had
to be ranked, a 3-endpoint catalog had to be mapped, and the CLI binary's PATH had to be
resolved **inside a systemd unit** that does not inherit a login shell. Measured cost of those
parts on this profile: one 1.5M-token session, three boot regressions, and one live outage.

DeepInfra deletes all of that:

| OpenCode V2 part | DeepInfra equivalent | Status |
|---|---|---|
| Control plane `/api/info`, `/api/model`, `/api/provider/{id}` | none — one public catalog | **gone** |
| Spawn/attach `opencode serve` | none | **gone** |
| `GET /api/credential` + oauth-before-key ranking | one `Authorization: Bearer` | **gone** |
| PATH resolution in the service unit | none (pure fetch) | **gone** |
| Model id namespace mapping (`opencode-go/…`, `opencode/…` plans) | `org/Model-Name` from the catalog | simple |
| Bill behind a subscription allowance ("plan burn") | per-token USD price per model | simpler and exact |

So: **fewer moving parts, and the remaining parts are the ones with a published contract.**
The risk does not disappear, it moves — see §5.

## 2. Measured DeepInfra surface (2026-11-04)

Everything here was read from the live API or the docs, not from memory.

| Fact | Value |
|---|---|
| Base URL | `https://api.deepinfra.com/v1/openai` (OpenAI-compatible) |
| Catalog endpoint | `GET /v1/openai/models` — **public, no key** (200 without auth, 116,954 bytes) |
| Catalog size | 173 entries; **91 chat-tagged**, 148 non-embed |
| Metadata per entry | `context_length`, `max_tokens`, `pricing{input_tokens,output_tokens,cache_read_tokens}`, `tags[]`, `description` |
| Tags seen | `chat, prompt_cache, reasoning_effort, reasoning, vision, vlm, image-gen, tts, stt, video-gen` |
| Chat routes | 91 · reasoning-capable 73 · vision 52 · prompt-cache priced 45 |
| Context lengths | 8,192 … 1,048,576 (28 distinct values) |
| Price spread | input $0.02–10.00 / Mtok · output $0.03–50.00 / Mtok |
| Auth | `Authorization: Bearer $DEEPINFRA_API_KEY`; missing key → HTTP 401 `{"code":"invalid_api_key","message":"missing API key"}` |
| Key scopes | `inference`, `models:read`, `account:read`, `lora:read`, `voice:read` (new key default) |
| Reasoning control | `reasoning_effort`: `none|minimal|low|medium|high|xhigh|max`, or `reasoning{effort,enabled}` |
| Reasoning output | `message.reasoning_content` (confirmed present in the OpenAPI schema) |
| Streaming | `stream: true` SSE; `stream_options.include_usage` **defaults to true** |
| Output cap | model-dependent, **hard 16,384 for most models** (bigger only where `max_tokens` says so) |
| Stop | **up to 4 sequences** |
| Extras worth knowing | `service_tier: priority\|flex`, `fail_fast` (429 instead of queueing), `prompt_cache_key`, `prompt_cache_options.ttl` (`1h`), `cache_salt` |

Errors the docs name explicitly: `engine_overloaded` (HTTP 429, "Model busy, retry later") and
a 400 when prompt + `max_tokens` exceed the context. **A rejected request is never billed.**

## 3. The DSH contract this plugin must satisfy

From `cookbook/adding-an-llm-adapter.md` and `subsystems/llm-streaming.md` — these are
obligations, not suggestions:

1. `stream(options)` is an `AsyncIterable<StreamChunk>`; register with
   `ctx.llm.registerAdapter(['deepinfra'], new Adapter(...))` inside **effect-based**
   registration (HMR-safe, duplicates throw).
2. **Emit `usage` before `finish`; emit nothing after `finish`.** Buffer finish/usage until the
   provider's end-of-stream marker — DeepInfra sends a trailing usage-only chunk, which is
   exactly the case that rule exists for.
3. Tool-call `arguments` are **raw JSON strings end-to-end**; stream `argumentsDelta`, never
   parsed objects. Block `index`es allocate in first-seen order and are reused per block.
4. Two error paths only: **throw** `LlmError` (transport/protocol) or end with
   `finish{kind:'error'|'aborted'}` (in-band). Pick per failure class and document it.
5. Honor `options.signal`. An option the provider cannot honor → throw
   `LlmError(..., 'UNSUPPORTED_OPTION')`, never silently drop.
6. `resolveModel()` returns provider/model identity plus optional `context` and `reasoning`
   fields; reasoning efforts are **ordered opaque ids** the adapter maps to wire values.
7. Secrets are **cordis-native**: schemastery `Config` + env fallback
   (`!!js process.env.DEEPINFRA_API_KEY`). Do **not** read ad-hoc key files in code.
8. Every request must carry `attributionHeaders()`.
9. `GenerateOptions.purpose` (auxiliary request classification) exists on the installed host
   and may arrive at the adapter; DeepInfra has no wire field for it, so ignore it explicitly
   and say so. If this plugin ever *produces* an auxiliary request, declare its own key via
   module augmentation of `LlmRequestPurposeMap` (guide `v0.2.2-alpha.2`).
10. The contract's source of truth is the **installed** `dsh-llm/lib/types/types.d.ts` plus
   `docs/upgrade-guide/**` — not the subsystem docs alone. See §11.
11. Verification follows `docs/testing.md`: unit tier, and a real-API e2e that **self-skips
   without its key** so a keyless run stays green.

## 4. Design that falls out of the measurements

| Concern | Decision | Why |
|---|---|---|
| Provider id | `deepinfra` | one route, one adapter, no plan namespaces |
| Catalog | fetch `GET /v1/openai/models` once, cache to `$DSH_HOME/cache/deepinfra-models.json` | public endpoint; no key needed, so a cold start never fails on auth |
| Route filter | tag-based: `chat` only; expose `vision`/`vlm` as `inputModalities` | 91 chat rows, 52 with vision — the host only understands `text\|image` |
| `contextWindow` | `metadata.context_length` (fall back to a documented default when null — 57 of 148 rows have none) | the catalog is the authority |
| `maxTokens` | `metadata.max_tokens`, clamped by the **16,384 hard cap** unless the row says more | measured doc statement |
| `defaultMaxTokens` | the existing `turnCompletionReservation()` split (reservation ≠ capability) | already solved in `shared.js`; reuse, do not reinvent |
| Reasoning | `reasoning_effort` from a fixed ordered list; expose only the levels a route's `reasoning_effort` tag promises | docs: setting it on a non-reasoning model "has no effect" — so do not advertise it |
| Reasoning text | `delta.reasoning_content` → `reasoning-delta` chunk | distinct from `content`, mapped in `upstream-map.js` terms |
| Usage | `prompt_tokens`, `completion_tokens`, `prompt_tokens_details.cached_tokens` (verify with a key), `reasoning_tokens` | keep the disjoint-bucket rule already used by the OpenCode adapter |
| Cost | price × tokens from `pricing{}`, **computed locally** — there is no cost field on the wire | unlike OpenCode, the number must be derived; label it `estimated` unless the provider returns a cost |
| Stop list | enforce **≤4**, else `UNSUPPORTED_OPTION`-style clear error | measured doc limit |
| Retry | 429 + `engine_overloaded` → retryable `SERVER`/`RATE_LIMIT`; 400 context → not retryable | docs: rejected requests are never billed, so retrying is safe |

## 5. What does NOT get easier (plan for these)

1. **Reasoning-token accounting is still ambiguous.** The response schema has
   `reasoning_content`, but whether `completion_tokens_details.reasoning_tokens` is populated is
   **unverified** — the OpenAPI page does not document the usage sub-object. This was the exact
   blind spot measured on the OpenCode route (reasoning = 86 % of output characters, field
   present in 2 of 35 steps). **Answer with one keyed request before writing the mapper.**
2. **Cache pricing is per-model and partial.** 45 of 91 chat rows publish
   `cache_read_tokens`; the other 46 do not. A cost readout that assumes a cache rate will be
   silently wrong on half the catalog.
3. **The 16,384 cap is a real constraint.** Long tool-heavy turns on a 1M-context model still
   stop at 16,384 output tokens unless the row overrides it. The clamp logic from the OpenCode
   fix applies, but here the cap — not the window — is the binding constraint.
4. **Cost is derived, not reported.** Any displayed figure must say "estimated from catalog
   pricing". The OpenCode lesson stands: a number presented as exact when it is computed will be
   challenged, correctly.
5. **A new vendor's parsing quirks are unknown until measured.** DeepInfra claims "among the
   highest" tool-call accuracy, but the *shape* of its deltas is undocumented. Reuse the lesson:
   **do not** copy the OpenCode regex classifier — either accept wire-only tool calls (v1) or
   port the staged canonical parser (`staging/opencode-v2-stage2/`) from day one.

## 6. Why not just extend the OpenCode adapter

Tempting and wrong: they share a wire format but not a contract. The OpenCode adapter's config,
catalog cache, plan model, cost ledger and credential ranking are all shaped by the OpenCode
control plane; folding a second vendor in would make every one of those fields conditional. The
gate that decides this: **the DeepInfra plugin needs zero daemon, zero spawn, zero credential
ranking** — merging them would reintroduce all three.

Reuse the *patterns* (`turnCompletionReservation`, usage buckets, trace, event-driven UI gate),
not the file.

## 7. Acceptance gates before this ships

| # | Gate | Threshold |
|---|---|---|
| D1 | Catalog maps without a key | ≥90 chat routes, every one with `contextWindow` and `maxTokens` |
| D2 | One real streamed turn | text + reasoning + tool call all arrive as the right chunk kinds, in order |
| D3 | Usage is disjoint | `input + cacheRead + cacheWrite` = provider prompt total, `output` excludes reasoning |
| D4 | Reasoning tokens resolved | the open question in §5.1 answered with a measurement, not a guess |
| D5 | Cost labelled honestly | an `estimated` flag exists in the payload and in the UI |
| D6 | Boot clean | isolated `dsh web` + browser boot, 0 activation warnings (the `ctx.tools` lesson) |
| D7 | No undeclared service read | `node --check` plus a source gate like `test/service-inject-gate.test.mjs` |
| D8 | Keyless CI green | the e2e self-skips without `DEEPINFRA_API_KEY` |

## 8. Open questions to answer first (with a key, ~5 requests)

1. Does `usage.completion_tokens_details.reasoning_tokens` appear? (D4)
2. Does `usage.prompt_tokens_details.cached_tokens` appear, and on which of the 45 cache-priced rows?
3. Is `reasoning_content` a delta field on the SSE stream, or only on the non-streaming message?
4. What does a streamed tool call look like: `delta.tool_calls[]` with `index`/`arguments` fragments?
5. Does the trailing usage chunk arrive after `finish_reason` (the case rule #2 exists for)?

## 9. Suggested file layout (mirrors the reference adapter)

```
dsh-deepinfra/
├── package.json            # dsh.manifestVersion 1, bundle.patch, exports ., ./provider
├── cordis.patch.yml
├── lib/
│   ├── index.js            # entry: name + inject + apply -> registerAdapter(['deepinfra'])
│   ├── wire.js             # DeepInfra types, request serialization, SSE framing
│   ├── catalog.js          # /v1/openai/models -> routes (cache + tag filter)
│   ├── map.js              # delta -> typed part (text | reasoning | tool-call)
│   ├── usage.js            # disjoint buckets + estimated cost from pricing{}
│   ├── adapter.js          # the LlmAdapter implementation
│   └── optional-service.js # copy: read a service cordis did not inject
└── test/
    ├── catalog.test.mjs
    ├── map.test.mjs
    ├── usage.test.mjs
    ├── adapter.test.mjs     # fake SSE server, no key
    └── e2e.real.test.mjs    # self-skips without DEEPINFRA_API_KEY
```

## 10. What the next session should do first

1. Answer §8 with a key (five requests, no plugin code).
2. Write `lib/wire.js` + `lib/map.js` + `lib/usage.js` against those answers, with tests that
   use recorded SSE fixtures.
3. Only then `adapter.js` and the entry, then the isolated + browser boot gate.

## 11. Upgrade-guide deltas that bind this build (read before writing code)

The brief above was written from the *current* docs. The harness also publishes an
**upgrade-guide channel** — one directory per release — and that is where contract changes
land. Every guide was scanned (119 English guides in `docs/upgrade-guide/**`); these four
affect an LLM adapter. **The installed host is `0.2.2-alpha.3`, so all four already apply.**

| Guide | Change | Effect on this plugin |
|---|---|---|
| `v0.2.2-alpha.2/llm-request-purpose-declarations` | `GenerateOptions.purpose` now derives from the declaration-mergeable `LlmRequestPurposeMap`; `@deepseek-ai/dsh-llm` no longer declares `compaction` or `session-title` | An adapter may **receive** `purpose` (verified present in the installed `types.d.ts` line 579) and may map it to model-hidden metadata. DeepInfra has no such field, so the adapter must **ignore it explicitly and document that**, rather than pass an unknown key to the wire. If this plugin ever *produces* an auxiliary request it must declare its own purpose key. |
| `v0.2.2-alpha.3/chat-process-activity-context` | `ProcessActivity` gains a `context` member; `ProcessActivitySummary.running` is now `RunningProcessActivity` (excludes `context`) | Only bites if the client half renders activity or switches exhaustively over `ProcessActivity`. **The OpenCode client does not touch it** (verified: zero references). If the DeepInfra client half shows any streaming indicator, add a `context` branch or type it as `RunningProcessActivity`. |
| `v0.2.2-alpha.3/subagent-names` | `send_message`/`interrupt_agent` take `agent` (name or session id) not `agent_id`; `list_agents` rows are `{name,status,description?}`; `SubagentActivation.name` is required; catalog payload version 3 | No effect on an LLM adapter. Listed because any test fixture or script that drives subagents must use the new argument names. |
| `v0.2.1-rc.4/reasoning-body-props` | `conversation.chat.reasoning.body` contributions get `rawText` for the original output; `text` is display-prepared | If the client half shows reasoning, read `rawText` when the raw model bytes matter. The cost pill work already learned this slot family is easy to misuse (the `input.model.label` regression). |

**Rule this adds to §3 (the DSH contract):** the adapter contract is defined by the installed
package's `types.d.ts`, and the upgrade-guide channel is the list of deltas that produced it.
Reading only `docs/subsystems` and the cookbook is not sufficient — that is exactly how
`purpose` was missed here.

### Verification that this brief matches the installed host

| Claim in this brief | Checked against | Result |
|---|---|---|
| `TokenUsage` is disjoint, `reasoningTokens` optional | installed `dsh-llm/lib/types/types.d.ts` | matches (same docstring, same fields) |
| `usage` before `finish`, two error paths | `docs/subsystems/llm-streaming.md` + cookbook | matches |
| `purpose` is a live `GenerateOptions` field | installed `types.d.ts:579` | **was missing from this brief — added above** |
| Client halves must handle `ProcessActivity.context` | alpha.3 guide | not applicable today (no reference in our client) |

