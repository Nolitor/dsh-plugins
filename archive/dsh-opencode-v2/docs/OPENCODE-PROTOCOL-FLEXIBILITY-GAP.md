# OpenCode protocol flexibility gap — OpenAI-only adapter vs 2.2.x

<!-- skeleton:
version: 1.0
kind: measurement
status: measured
updated: 2026-11-07
summary: Read-only comparison of the plugin's provider-protocol handling against OpenCode 2.2.0-2.2.6 provider/protocol changes.
-->

> Read-only. Source: current plugin `lib/`, exact upstream tags `v2.2.0` and `v2.2.6`,
> and release notes `v2.2.1`-`v2.2.6`. No code, config or live state changed.

## 1. What the plugin does today

The HTTP route is hard-wired to one wire protocol:

| Seam | Current behavior | File |
|---|---|---|
| Endpoint | `POST {baseURL}/chat/completions` | `lib/http.js` `chatPath` default |
| Body | OpenAI messages, `stream_options.include_usage` | `lib/http.js` `buildChatRequest()` |
| Reasoning field | `compatibility.reasoningField`, default `reasoning_content` | `lib/upstream-map.js` |
| Tool calls | OpenAI `tool_calls` / `tool_call_id` | `lib/http.js` |
| Auth | `Authorization: Bearer <credential>` | `lib/http.js` `resolveBackend()` |
| Route → provider | `providerID` prefix selects `opencode`/`opencode-go` | `lib/http.js` `backendProviderForRoute()` |
| Provider metadata used | `settings.baseURL`, `headers` | `resolveBackend()` |
| Protocol field used | `package` is **read but ignored** | `/api/provider/{id}` result |

So model switching inside the plugin changes the model id and baseURL, not the protocol.
There is no Anthropic `/v1/messages`, no OpenAI `/responses`, no per-provider body
translation.

## 2. Is that a gap?

The plugin only offers two namespaces: `opencode` (Zen) and `opencode-go` (Go). Both are
OpenAI-compatible backends in the measured catalog. For those two, OpenAI-only is not a
bug, because no measured route needs another wire protocol.

It **is** a limit if the plugin is expected to expose any of the following newly supported
OpenCode providers:

- Anthropic Messages routes
- OpenAI Responses routes
- Claude Agent (a CLI/SDK-backed provider, not an HTTP chat endpoint)

The catalog row carries `package` (for example `@opencode/ai/providers/openai-compatible`).
The plugin currently ignores it, so it cannot tell an OpenAI-chat route from a Responses or
Messages route. That is the concrete flexibility gap.

## 3. What changed upstream in 2.2.1-2.2.6

Protocol-relevant, from exact release notes:

| Version | Change | Relevance |
|---|---|---|
| 2.2.1 | Responses API support for OpenRouter, DigitalOcean, Venice, including freeform tools | New wire protocol family |
| 2.2.1 | Five legacy provider entry points removed/renamed | Provider package surface churn |
| 2.2.1 | Provider throttling retried instead of misreported as context overflow | Error classification |
| 2.2.2 | Image generation enabled by default for capable providers | Modality advertisement |
| 2.2.3 | Claude Agent provider added | Non-HTTP provider |
| 2.2.3 | Reasoning capability detection fixed for variants/compatibility metadata | Correct capability mapping |
| 2.2.3 | OpenAI Responses no longer sends incompatible `filename` with `file_url` | Responses correctness |
| 2.2.4 | User/project/remote config can override provider names, limits, variants, settings, headers | Catalog override semantics |
| 2.2.5 | Reasoning no longer converted to plain text on model switch/resume | Directly about model switching |
| 2.2.6 | Provider/model session warming, cache-TTL `auto` | Latency/cache efficiency |
| 2.2.6 | Provider requests retried when host unreachable | Reliability |
| 2.2.6 | Legacy custom providers with partial `limit` kept | Catalog robustness |

Source-level additions in 2.2.6 include `azure/messages`, `openrouter/responses`,
`digitalocean/responses`, `venice/responses`, and the full Claude Agent provider tree.
Removed entry points include Cohere, Perplexity, Vercel, and the old provider factory.

## 4. Verdict

| Question | Answer |
|---|---|
| Is the plugin flexible across protocols? | **No.** OpenAI Chat Completions only. |
| Does that break the current `opencode`/`opencode-go` routes? | **No**, measured compatible. |
| Did upstream improve protocol handling 2.2.0→2.2.6? | **Yes**: Responses API, Claude Agent, reasoning preservation on switch, capability detection. |
| Can a model switch inside this plugin require another protocol? | Only if a newly exposed route uses one; current two namespaces do not. |
| Is there an actionable improvement for this plugin? | **Yes, two candidate seams.** |

## 5. Candidate improvements (planning only)

1. **Protocol declaration from the catalog.**
   Read the provider/model `package` (or an explicit `compatibility.wire` field if upstream
   exposes one) and refuse to advertise a route whose protocol this adapter cannot speak.
   Today it advertises every enabled route and would fail at the first request.

2. **Protocol dispatch seam.**
   Keep `buildChatRequest()` as the OpenAI implementation and add a sibling builder for
   Responses/Messages only when a route needs it. Do not unify by pretending both protocols
   are OpenAI-shaped.

Before either change, measure:

- whether `/api/model` or `/api/provider/{id}` exposes enough protocol information to make
  the decision;
- which currently enabled routes use a non-OpenAI-chat package;
- how 2.2.5 reasoning preservation affects the `reasoningField` path on a real switch.

Until those measurements exist, the honest position is: current routes work, the adapter is
not protocol-flexible, and upstream added protocol capabilities the plugin cannot yet use.

## 6. Related documents

- [2.2.0 → 2.2.6 delta](OPENCODE-220-TO-226-DELTA.md)
- [2.2.6 compatibility measurement](OPENCODE-226-COMPATIBILITY-MEASUREMENT.md)
- [2.2.6 job/session integration roadmap](OPENCODE-226-JOB-SESSION-INTEGRATION-ROADMAP.md)
