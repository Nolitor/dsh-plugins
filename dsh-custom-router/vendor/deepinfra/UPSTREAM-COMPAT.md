# Upstream Protocol Compatibility — @nolit/dsh-deepinfra

<!-- skeleton:
version: 1.0
kind: measurement
status: measured
updated: 2026-11-05
summary: Measured cross-vendor behaviour of DeepInfra's OpenAI-compatible endpoint across 20 catalog vendors — which wire fields, role forms, tool shapes and error codes are universal and which are vendor-specific, with the two defects the survey exposed.
-->

> Evidence for every claim below was produced by live requests on 2026-11-05 against
> `https://api.deepinfra.com/v1/openai` with the owner's key. Nothing here is inferred from
> vendor documentation.

## 1. The shape of the problem

DeepInfra exposes **one** OpenAI-compatible endpoint, but it fronts **20 distinct vendors**:

| Vendor | chat routes | Vendor | chat routes |
|---|---|---|---|
| Qwen | 19 | inclusionAI | 3 |
| google | 13 | mistralai | 3 |
| deepseek-ai | 11 | openai | 3 |
| anthropic | 9 | XiaomiMiMo | 2 |
| nvidia | 5 | Sao10K | 2 |
| zai-org | 5 | moonshotai | 2 |
| ByteDance | 4 | MiniMaxAI, tencent, microsoft, meta-models, thinkingmachines, ibm-granite | 1 each |
| meta-llama | 4 | | |

"OpenAI-compatible" is the transport contract, not a behaviour guarantee. The table below records
where vendors actually differ, because each difference is a place an adapter can silently drop a
model.

## 2. Universal — verified on every vendor tested

Tested with `system` role, tool declarations, `tool_choice`, and streaming.

| Behaviour | DeepSeek | Google | Qwen | Anthropic | Moonshot | Z.ai | Meta |
|---|---|---|---|---|---|---|---|
| `messages[].role: system` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `messages[].role: developer` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| streaming SSE `data: {json}` + `[DONE]` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `stream_options.include_usage` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `usage.estimated_cost` (exact USD) | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| tool call as structured `tool_calls` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| parallel tool results by `tool_call_id` | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |
| `finish_reason`: stop / tool_calls / length | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ | ✅ |

**Consequence:** one serializer serves all of them, and the adapter needs no per-vendor branch for
the request side.

## 3. Vendor-specific — the places that matter

### 3.1 Reasoning comes back in `delta.reasoning_content`

| Vendor | field | notes |
|---|---|---|
| Google (gemini-2.5-pro) | `reasoning_content` | streams as deltas |
| Moonshot (Kimi-K2.6) | `reasoning_content` | streams as deltas |
| Z.ai (GLM-5.3) | `reasoning_content` | streams as deltas |
| DeepSeek (V4.1-Flash) | `reasoning_content` | only when an effort is sent |
| Qwen (Qwen3-235B) | **absent** on the non-thinking variant | reasoning model variants differ |
| Anthropic (claude-sonnet-5) | `reasoning_content` (null in non-reasoning replies) | see 3.3 |

The wire field is the **only** signal used. `map.js` reads `reasoning_content`, then `reasoning`,
then `reasoning_text`, and never inspects characters.

### 3.2 `completion_tokens_details.reasoning_tokens` is optional

Present: Google (662 on one call), Moonshot, Z.ai, DeepSeek.
**Absent entirely:** Qwen non-thinking routes, and previously measured on gpt-oss-120b and
claude-sonnet-5.

Absence is reported as `undefined`, never as `0` — a route that never reports the field must not
render as a route that reasoned for zero tokens.

### 3.3 A tool `description` is MANDATORY for Anthropic

```
POST /chat/completions { tools:[{type:'function',function:{name:'get_weather', ...}}] }
-> HTTP 500
   "tools.0.custom.description: Input should be a valid string"
```

Adding a one-word description makes the identical request return **200 with a proper tool call**.

DeepSeek, Google and Qwen accept an empty description, so this defect was **invisible** on those
routes and silently removed every Anthropic model from the adapter's usable set.

**Fix:** `wire.serializeTools` guarantees a non-empty description, falling back to `"Tool <name>"`.
A fabricated description would be a lie the model acts on; the tool's own name is truthful.

### 3.4 Anthropic refuses `reasoning_effort` with a forced tool choice

```
reasoning_effort:"medium" + tool_choice:"required"
-> HTTP 400 "Thinking may not be enabled when tool_choice forces tool use."
```

The adapter never sends `tool_choice: required` (it leaves the choice to the harness), so this is
not reachable from DSH. It is recorded here because a future caller could hit it.

## 4. Request validation the provider enforces

| Input | Result | Adapter behaviour |
|---|---|---|
| `stop` with 17 entries | 422 "maximum of 16 stop sequences allowed" | `MAX_STOP_SEQUENCES = 16`; >16 throws `UNSUPPORTED_OPTION` before I/O |
| `max_tokens: 0` | 422 "Input should be greater than 0" | dropped (omitted), never sent |
| `temperature: -1` | 422 "Input should be greater than or equal to 0" | throws `UNSUPPORTED_OPTION` before I/O |
| `temperature: 0` | 200 | sent unchanged |
| `max_tokens: 50000` | 200 | sent unchanged — there is **no** 16,384 wire cap |
| unknown model | 404 `model_not_found` | `UNKNOWN_MODEL` |
| missing/invalid key | 401 `invalid_api_key` | `INVALID_CREDENTIAL` |
| overloaded engine | 429 `engine_overloaded` | `RATE_LIMIT` + `providerRetryAfterMs` |

## 5. What this survey changed in the code

| Finding | Fix | Regression test |
|---|---|---|
| Empty tool description breaks Anthropic | `wire.nonEmpty()` fallback to the tool name | `test/wire.test.mjs` |
| Negative temperature returns 422 mid-turn | throw `UNSUPPORTED_OPTION` before I/O | `test/wire.test.mjs` |
| `max_tokens: 0` returns 422 | omit the field | `test/wire.test.mjs` |

## 6. Verified through the real harness

Each of these is a real DSH turn with a real tool call, not a direct HTTP probe:

| Model | Tool call id shape | Final answer |
|---|---|---|
| `anthropic/claude-sonnet-5` | provider-issued | `alpha` |
| `google/gemini-2.5-pro` | `function-call-…` | `alpha` |
| `Qwen/Qwen3-235B-A22B-Instruct-2507` | `call_…` | `alpha` |

The fact that the tool-call **id shapes differ by vendor** while the harness consumed all three
unchanged is the proof that the adapter normalizes at the right layer.
