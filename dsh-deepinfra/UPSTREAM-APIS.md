# DeepInfra API Surface — What Works, What Does Not

<!-- skeleton:
version: 1.0
kind: measurement
status: measured
updated: 2026-11-05
summary: Every DeepInfra endpoint relevant to this adapter, probed live on 2026-11-05 with the owner's credential — which are deployed, which return 404 despite being documented, and what each is and is not allowed to feed.
-->

> **Why this file exists.** The owner asked whether all documented APIs had been tested. They had
> not. This is the full probe, including the endpoints that turned out to be undeployed — a
> documented endpoint is not a functioning one, and claiming otherwise is the defect.

## 1. Summary

`api.deepinfra.com/openapi.json` declares **132 paths**. This adapter needs a small subset; the
rest belong to deployments, GPU rental, audio, images, batches and account management.

| Endpoint | Documented | Live result | Used by this plugin for |
|---|---|---|---|
| `GET /v1/openai/models` | ✅ | **200** — 173 entries, 91 chat | model catalog |
| `POST /v1/openai/chat/completions` | ✅ | **200** | the model route |
| `GET /v1/metrics/live` | ✅ | **200** — real numbers | platform status card |
| `GET /v1/me` | ✅ | **200** — account identity | not used |
| `POST /v1/request-costs` | ✅ | **404** for this credential | prepared, degrades to null |
| `GET /v1/logs/query` | ✅ | **422** — requires `deploy_id` | not used (per-deployment only) |
| `POST /anthropic/v1/messages` | ✅ | **200** — native Anthropic shape | not used (see §4) |
| `POST /anthropic/v1/messages/count_tokens` | ✅ | **200** | not used |

## 2. `GET /v1/metrics/live` — real, and correctly scoped

```json
{"tokens_per_second":85070217.47,"time_to_first_token":0.5653,
 "requests_per_second":4594.63,"total_tflops":24780714.0}
```

**These describe the whole fleet.** They are not this account's usage and not this turn's latency.
The settings card renders them under "Platform status" with that wording, and the payload contains
no cost field at all — so it can never be mistaken for billing.

## 3. `POST /v1/request-costs` — documented, deployed only partially

The OpenAPI spec is explicit:

```json
// request
{ "requestIds": ["<id>"] }
// response
{ "requests": [ { "requestId": "<id>", "costNanoUsd": 22960 } ] }
```

`costNanoUsd` is integer **nano-USD** (1e9 nano = 1 USD). This is the authoritative billing
number — exactly what the owner asked for when distinguishing "what the prompt shows" from "what
was actually charged".

**Measured reality on this credential (2026-11-05):**

| Call | Result |
|---|---|
| `POST {}` | 422 `body.requestIds: Field required` — the route parsed the body |
| `POST {"request_ids": …}` | 422 naming `requestIds` — still parsing |
| `POST {"requestIds": "str"}` | 422 `list_type` — still parsing |
| `POST {"requestIds": ["<header id>"]}` | **404 Not Found** |
| `POST {"requestIds": ["chatcmpl-<id>"]}` | **404 Not Found** |
| `POST {"requestIds": ["<id without prefix>"]}` | **404 Not Found** |

The route exists and validates; it is **not deployed for this account**. Both id forms were tried,
with a 5-second settle after the completion, in case billing had not landed yet.

**Adapter behaviour:** `catalog.fetchRequestCost()` sends the `x-request-id` captured from every
completion and converts nano-USD to USD when the call succeeds. A 404, a network error or an empty
id all return `null` — "unknown", never `0`, because an unpriced request must not read as free.

The `x-request-id` header **is** present on every completion
(`x-request-id: RSyHYZDtXN7iAgKV9xztFoum`, identical to `chatcmpl-<suffix>`), so the moment this
endpoint is enabled for the account the authoritative figure becomes available with no further
code change.

## 4. `POST /anthropic/v1/messages` — a native Anthropic endpoint exists

A second, Anthropic-shaped API in front of the same models:

```json
{"id":"msg_7d66…","type":"message","role":"assistant","content":[{"type":"text","text":"OK"}],
 "stop_reason":"end_turn",
 "usage":{"input_tokens":10,"cache_creation_input_tokens":0,"cache_read_input_tokens":0,
          "output_tokens":4,"service_tier":"standard"}}
```

Findings:

- It works (**200**) and returns Anthropic's own `usage` shape.
- It reports **no cost** — there is no `estimated_cost` equivalent.
- Its token fields use Anthropic names (`cache_creation_input_tokens`), not the OpenAI ones.

**Decision: not used.** The adapter speaks one protocol — OpenAI-compatible `/chat/completions` —
and that endpoint already serves all 20 vendors with `estimated_cost` included. Adding a second
protocol would double the translation surface to gain nothing, and would lose the cost field.

## 5. `GET /v1/logs/query` — per-deployment only

Requires `deploy_id`; without it the call is 422. It queries logs for a **dedicated deployment**,
not for serverless requests on this account, so it cannot supply per-request billing here.

## 6. What the adapter deliberately does not call

Declared in the spec but out of scope: batch/files, image generation, TTS/STT, embeddings, video,
LoRA adapters, dedicated deployments, GPU rentals, agents, sandboxes, account mutation. Calling any
of them from a chat adapter would be scope creep with a real cost surface.

## 7. Regression tests

| Test | Asserts |
|---|---|
| `live metrics are fetched from /v1/metrics/live` | the URL, the values, and that the payload has **no** cost field |
| `live metrics degrade to null` | an HTTP failure or a throw yields null, never an exception |
| `request-costs converts nanoUSD` | `22960` → `2.296e-5`; a 404 yields null; an empty id yields null |
