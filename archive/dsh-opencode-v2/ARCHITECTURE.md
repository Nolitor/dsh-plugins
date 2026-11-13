# Architecture — @nolit/dsh-opencode-v2

<!-- skeleton:
version: 1.0
kind: spec
status: active
updated: 2026-11-04
summary: Module map, control-plane vs serving boundary, credential resolution, slot contract and ledger ownership for @nolit/dsh-opencode-v2, aligned with the same host standards now documented in dsh-deepinfra/ARCHITECTURE.md.
-->

> Operator manual: [README.md](README.md) · History: [CHANGELOG.md](CHANGELOG.md) ·
> Per-round proof: [VERIFICATION.md](VERIFICATION.md) · Upstream: [UPSTREAM-COMPAT.md](UPSTREAM-COMPAT.md)

## 1. Three surfaces, one package

Unlike `dsh-deepinfra` (one route, two slots), this package deliberately ships several surfaces
because OpenCode exposes several planes.

| # | Surface | Module | Registers | Switch |
|---|---|---|---|---|
| 1 | Model serving / router — `opencode-http-agent` | `lib/http.js` | `ctx.llm.registerAdapter` | `modelServing: false` (or the row's `disabled`) |
| 2 | Subagent — `opencode` provider + `subagent_opencode` row | `lib/subagent.js` | `ctx.subagents.registerProvider` | `subagent: false` |
| 3 | CLI — `opencode` tool, `/ocode` command, `cli_worker` tool | `lib/index.js`, `lib/provider.js` | tools, commands, worker | `cli: false` removes the tool + `/ocode` + `cli_worker`; `workerEnabled: false` narrows to `cli_worker` |
| — | Auxiliary UI — settings panel + cost chip | `lib/client.js` | `settings.section`, `conversation.input.right` | `usagePill` / client gate |

The three numbered rows are the activation surfaces. The UI row is auxiliary and is not counted as
one: it observes the routes rather than serving one.

## 2. Control plane vs serving plane

This is the architectural fact that distinguishes the two plugins, and the reason they were not
merged.

```
   control plane (local)                    serving plane (remote)
   ─────────────────────                    ──────────────────────
   GET /api/info          liveness          POST {baseURL}/chat/completions
   GET /api/model         catalog           Authorization: Bearer <credential>
   GET /api/provider/{id} baseURL/headers   stream: true
   GET /api/credential    credential        stream_options.include_usage
```

The local `opencode serve` process is used **only** for catalog, provider metadata and credential
resolution. No conversation ever runs through it: `POST /api/session/{id}/prompt` is forbidden and
asserted against by tests. Model serving is a direct HTTP call, so the DSH agent loop keeps
ownership of tools, history and workspace.

`dsh-deepinfra` has **no** control plane at all — one public catalog and one bearer key — which is
why it needed no daemon and no spawn.

## 3. Credential resolution (measured ordering)

1. explicit `backendBaseUrl` / `apiKey` (or `OPENCODE_API_KEY`)
2. local control plane: `/api/provider/{id}` baseURL + active `/api/credential`

The credential is cached for `credentialCacheMs`; a 401 forces exactly one refresh. A provider id
is resolved **from the live catalog** before use — a default id is a guess, and a wrong one
produced `ProviderNotFoundError` on a real turn.

## 4. Module ownership

| Fact | Owner |
|---|---|
| Request body + Tier A guards | `lib/request-guards.js` |
| SSE parse + typed parts | `lib/stream-parser.js`, `lib/upstream-map.js` |
| Display cleaning | `lib/display-gate.js`, `lib/display-clean.js` |
| Cost + session spend | `lib/cost.js`, `lib/cost-pill.js` |
| Usage de-duplication | `lib/usage-ledger.js` |
| Catalog cache | `lib/catalog-cache.js` |
| Plan model | `lib/plans.js` |
| Conflict guard | `lib/conflicts.js` |

The boundary rule both plugins share: **a delta's type comes from the wire field that carried it,
never from its characters** (`lib/upstream-map.js`). No text scanners.

## 5. Slot contract

Identical to `dsh-deepinfra`, because both use the same host seam:

`CostPill` renders in `conversation.input.right` — the additive LIST slot Antigravity's usage chip
occupies, immediately left of the model selector — and returns `null` for a foreign provider. It
gates on `data-provider-id` only (never a model-id prefix) and renders nothing until the session has
a measured request. The measured rule stands: contributing to `conversation.input.model.label`
**replaces** the model name. The previous seat, `conversation.input.activity`, is a SINGLE slot
already registered by the token-economizer in the live profile, so it is not a seat this plugin may
use; migration recorded in `CHANGELOG.md` `0.0.2-rc.4`.

## 6. Service declaration

`inject = ['llm','subprocess','sessions','connection','settings']` for the http route, because the
control plane genuinely needs all five. This is the opposite of `dsh-deepinfra`'s minimal
`['llm']`, and the difference is deliberate: a service that is truly required must be declared, or
reading it throws and takes the entry down. `dsh-deepinfra` declares only what it truly requires
and mounts the rest through `ctx.inject([...])`.

Rule for choosing: declare a service when the plugin cannot serve **any** surface without it;
otherwise read it optionally so a profile that lacks it still boots.

## 7. Ledger and cost

`$DSH_HOME[/profiles/<name>]/opencode-session-cost.json`, keyed by DSH session id, with per-model
detail. Cost is taken from the wire's own `opencode` block (`cost`, `list_cost`, `allowance`,
`billing_source`), never derived. A missing `cost` parses to `null` and never to a fabricated
zero, because "unpriced" and "free" are different answers.

## 8. Relationship to dsh-deepinfra

They share a wire format and a slot contract, and they share **no code**. Folding DeepInfra into
this package would make the credential ranking, plan model, catalog cache and conflict guard
conditional on which vendor a request targets. The gate that decided it: DeepInfra needs zero
daemon, zero spawn and zero credential ranking, so merging would reintroduce all three.

What is shared is the *pattern* set, now documented once for both:
`turnCompletionReservation`, disjoint usage buckets, provider-id ownership gating, and the
"measure the wire, never assume it" rule.
