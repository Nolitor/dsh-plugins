# Architecture — @nolit/dsh-deepinfra

<!-- skeleton:
version: 1.0
kind: spec
status: active
updated: 2026-11-04
summary: Module map, data flow and host-contract boundaries for @nolit/dsh-deepinfra — which layer owns which fact, how a saved credential reaches a request, and where each measured host constraint is enforced.
-->

> Operator manual: [README.md](README.md) · History: [CHANGELOG.md](CHANGELOG.md)
> Host contracts: `docs/subsystems/llm-streaming.md`, `docs/cookbook/adding-an-llm-adapter.md`

## 1. One route, two halves, no daemon

The plugin registers **one** LLM provider route (`deepinfra`) and adds exactly two UI slots.
The chip sits in `conversation.input.right` (an additive **list** slot) — never in the single
`conversation.input.activity` seat, which the token-economizer owns (measured 2026-11-05: a second
occupant there never rendered).
There is no control plane, no child process, no credential store and no OAuth: the only external
dependency is one HTTPS endpoint.

```
                    ┌──────────────── browser ────────────────┐
                    │ lib/client.js                           │
                    │  conversation.input.right -> CostPill   │
                    │  settings.section -> DeepInfraSection   │
                    └───────────────┬─────────────────────────┘
                          fetch /api/local/deepinfra/*
                                    │
   ┌──────────────── node: lib/index.js (apply) ─────────────────┐
   │  registerAdapter(['deepinfra'], DeepInfraAdapter)           │
   │  ctx.inject(['connection','settings'])  -> lib/server.js    │
   └───────┬──────────────────────────────────┬──────────────────┘
           │                                  │
   lib/adapter.js                     lib/server.js
   lib/wire.js   lib/map.js           lib/cost.js
   lib/catalog.js  lib/usage.js       lib/settings.js
   lib/stream-contract.js  (binding)
   lib/sse.js  (wrapper: shared reader)
        │
        ▼
   @nolit/dsh-custom-router/stream  (P3: blocks · finish · usage · terminal policy)
           │
           ▼
   https://api.deepinfra.com/v1/openai/chat/completions
```

## 2. Layer ownership

Each fact has exactly one owner. Two layers must never compute the same thing, because the second
copy is where drift starts.

| Fact | Owner | Never recomputed by |
|---|---|---|
| Request JSON | `wire.js` | adapter, server |
| SSE framing | `@nolit/dsh-custom-router/stream` (`sse.js` is a wrapper) | adapter |
| Delta → typed part | `map.js` | client, display |
| Block lifecycle, finish table, terminal policy | `@nolit/dsh-custom-router/stream` | adapter |
| Usage buckets | `@nolit/dsh-custom-router/stream` (`usage.js` delegates) | client |
| Cost | `cost.js` | client |
| Catalog → model metadata | `catalog.js` | adapter |
| Credential precedence | `settings.js` | client |
| Ledger persistence | `cost.js` | server |
| Rendering | `client.js` | server |

## 3. Credential path (the one that needs no systemd edit)

```
Web UI input
  -> POST /api/local/deepinfra/setup/apply
  -> settings.update('dsh-deepinfra', { apiKey })     [host settings service]
  -> profile cordis.patch.yml  (volatile field persisted)
  -> live loader entry config   (applies: 'live')
  -> adapter reads configValue(config,'apiKey') on EVERY request
  -> Authorization: Bearer <key>
```

Three properties make this work, and each has a test:

1. **The field is `.volatile()`.** `SettingsForms.write()` computes `volatileForm(schema)`
   and throws `Plugin entry "…" has no volatile fields` when it is undefined. Without the flag a
   key typed in the UI can never be saved at all.
2. **The field is `role('secret')`.** `redactSecrets` strips it from every wire projection, so the
   panel receives `set: true` and a masked tail — never the value.
3. **The patch default is `''`, not `!!js process.env.…`.** A pinned expression is re-evaluated on
   every boot and would shadow the saved key. Empty means "fall back to the environment until the
   operator saves one".

Precedence is therefore **UI first, environment second** (`settings.js`), and the reading goes
through `configValue()` so a reactive cordis field and a plain object behave identically.

## 4. Stream translation contract

Enforced in `adapter.js`; each rule exists because the harness documents it or a measurement
demanded it.

| Rule | Why |
|---|---|
| `usage` strictly before `finish`, nothing after | DeepInfra sends its usage event **after** `finish_reason` (measured: `FINISH -> USAGE -> [DONE]`), so finish and usage are buffered until the terminal marker |
| `block-end` carries the ASSEMBLED block | Consumers must not re-assemble deltas; emitting `text:''` produced a completed turn with an empty message (measured) |
| Tool `arguments` stay raw JSON strings | Host contract; the first fragment carries id/name with empty arguments, later ones carry only a slice |
| Block indexes allocated first-seen, reused per block | Host contract |
| An empty completion becomes `EMPTY_RESPONSE` | A silent empty success ends the turn with nothing to act on |
| An unhonorable option throws `UNSUPPORTED_OPTION` | >16 stop sequences must fail before I/O, not be truncated |

## 5. Error taxonomy

| Condition | Code | Path |
|---|---|---|
| 401 / 403 | `INVALID_CREDENTIAL` | thrown |
| 404 `model_not_found` | `UNKNOWN_MODEL` | thrown |
| 422 | `UNSUPPORTED_OPTION` | thrown |
| 429 | `RATE_LIMIT` (+ `providerRetryAfterMs`) | thrown |
| 5xx | `SERVER` | thrown |
| context wording | `CONTEXT_WINDOW_EXCEEDED` | thrown |
| stream/transport cut | `TRANSPORT` | thrown |
| undecodable SSE | `PROTOCOL` | thrown |
| terminal `stop`, no content | `EMPTY_RESPONSE` | in-band `finish{kind:'error'}` |

Throwing is chosen for anything that makes the request unusable; an in-band finish is used only
where the harness expects a settled stream.

## 6. Service declaration rule

`inject = ['llm']` — **only** `llm`. `connection` and `settings` are read through an optional
accessor and mounted through `ctx.inject([...], fn)`.

This is not defensive style; both halves were measured:

- Declaring them made a **headless** profile hang: `pending (waiting for service: connection)` →
  `NO_ADAPTER: no adapter registered`. A web-only service must never gate the model route.
- Reading `ctx.profileDir` undeclared threw `cannot get property "profileDir" without inject` and
  took the whole entry down (`1 entry did not activate`).

## 7. Client module format

`lib/client.js` is served verbatim and evaluated by `window.__ModuleLoader__`, so it is a
**CommonJS factory**, not an ES module:

```js
window.__ModuleLoader__.load({ id: '@nolit/dsh-deepinfra', factory: (require) => { … return module.exports } })
```

Two boot failures were measured before this: `import … with { type: 'json' }` →
"Cannot use import statement outside a module", and `export` → "Unexpected token 'export'". Both
printed `web boot: 1 entry did not activate`. The message tables are therefore **inlined**, and a
test asserts they still match `locale/*.json`.

## 8. Slot contract

```ts
interface InputActivityOwnerProps extends InputControlOwnerProps {
  locked: boolean
  onActiveChange: (active: boolean) => void   // release expansion on unmount
}
```

`CostPill` never expands, so it reports `active: false` on mount and again on unmount. It returns
`null` when the selected provider is not `deepinfra`, which occupies no seat at all. The gate reads
`data-provider-id` **only** — a model id is resold by other routers, so matching it would show the
chip on routes this adapter never served.

## 9. Ledger

`$DSH_HOME[/profiles/<name>]/deepinfra-session-cost.json`, never the process working directory.

```
sessions[sessionId]
  requests, costUsd, tokens{input,output,reasoning,cacheRead,cacheWrite}
  byModel[modelId]  -> requests, costUsd, tokens
  turns[turnNumber] -> requests, costUsd, tokens
```

A **turn** is one DSH turn. `GenerateOptions` has no turn field and `agent/turn-stopping` announces
a turn as it *closes*, so the turn in flight is `lastCompleted + 1`; measured, the raw value left
every request `unassigned`.

## 10. Promotion model

The catalog publishes exactly one offer signal: `metadata.discount`, a fraction to subtract.
Measured 2026-11-04: 8 of 91 chat routes carry one, from 0.10 to 0.75. There is **no** featured or
promo tag — the tag vocabulary is capability only — so `catalog.promotionOf()` derives the offer
and the panel sorts promotional routes first.
