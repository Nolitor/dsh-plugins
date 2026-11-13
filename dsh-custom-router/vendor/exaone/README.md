# @nolit/dsh-exaone

EXAONE API Platform model route for DeepSeek Harness, vendored inside
`@nolit/dsh-custom-router` and mounted by its `exaone` preset.

## Facts (docs.exaone.ai, read 2026-11-13)

| Item | Value |
|---|---|
| Base URL | `https://api.exaone.ai` |
| Chat route | `POST /v1/chat/completions` (OpenAI-compatible) |
| Auth | `Authorization: Bearer <API key>` |
| Model | `k-exaone_v2.5` |
| Context | 524,288 tokens (`input + max_tokens` must not exceed it) |
| Modalities | text |
| Reasoning | always on; `reasoning_effort` `low` / `high` / `max` (default `max`) |
| Multi-turn | `chat_template_kwargs.preserve_thinking: true` is sent |
| Streaming | `text/event-stream`, `data: [DONE]` sentinel |
| Pricing | **currently free after application** (owner, 2026-11-13; may change) |
| Orientation | Korean-language / humanities-oriented, not a science-specialized route |

The platform publishes one chat model and no catalog listing endpoint, so the
model row is a static declaration in `lib/catalog.js`.

## Config

| Field | Default | Meaning |
|---|---|---|
| `baseUrl` | `https://api.exaone.ai/v1` | OpenAI-compatible base URL |
| `apiKey` | `''` | Bearer key; write-only. Empty falls back to `EXAONE_API_KEY` |
| `turnMaxTokens` | `16384` | Completion tokens one turn reserves |
| `defaultEffort` | `max` | Default `reasoning_effort` |
| `enabledModels` | `[]` | Advertise only these ids (empty = the declared model) |

The router writes the key at `vendorConfig['dsh-exaone'].apiKey`; the adapter
reads the live config on every request, so a saved key applies without a
restart.

## Routes

- `POST /api/local/dsh-exaone/models` — the router's models tab (one model row,
  with its saved enabled state).

## Tests

`npm test` covers the request body, SSE translation (text / reasoning / tool
calls / usage), effort folding, the missing-key refusal and HTTP error mapping.
