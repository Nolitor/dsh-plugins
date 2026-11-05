# @nolit/dsh-opencode-v2

<!-- skeleton:
version: 4.1
kind: readme
status: active
updated: 2026-11-04
summary: Operator manual for @nolit/dsh-opencode-v2 — a native DSH LLM adapter that streams from OpenAI-compatible backends (OpenCode Go) while the DSH agent loop keeps ownership of tools, history and workspace. Covers the three provided surfaces (opencode-http-agent route, opencode tool + /opencode command, cli_worker), Tier A request guards derived from deepseek-recipe, the legacy-provider collision guard, verified prerequisites (CLI version, web auth and token store, PATH resolution), the release ladder, and installation. Engineering history lives in CHANGELOG.md.
-->

OpenCode models inside DeepSeek Harness, served **natively** through the DSH model
registry.

| | |
|---|---|
| Package | `@nolit/dsh-opencode-v2` |
| Version | `0.0.1-rc.1` |
| Host | DSH `>=0.2.2-alpha.2 <0.3.0` |
| History | [CHANGELOG.md](CHANGELOG.md) |
| Release line | `0.0.1-rc.N` (owner normalization 2026-11-05); the retired `0.0.2` name was the pre-normalization line |
| Proof of record | [VERIFICATION.md](VERIFICATION.md) |
| Upstream compatibility | [UPSTREAM-COMPAT.md](UPSTREAM-COMPAT.md) — per-release surface diff, tag-verified |

---

## Subagent delegation

`subagent_opencode` runs one isolated `opencode run` per delegation. Merged from
`@nolit/dsh-subagent-opencode` 0.1.0 on 2026-11-05 so one package carries every OpenCode surface.

```yaml
subagent: true                  # false leaves the chat route and CLI worker intact
subagentProviderName: opencode
subagentTimeoutMs: 900000
subagentDisposeGraceMs: 5000
subagentEnv: {}
```

The delegation tool row is separate (`@deepseek-ai/dsh-tool-subagent` bound to provider
`opencode`). Disabling the provider while leaving that row points the tool at a name with no
provider — remove both to drop the surface.

If `@nolit/dsh-subagent-opencode` is still mounted, it registers the same provider name; this
plugin detects that with `getProvider` and **yields with a warning** instead of shadowing it.

## Overview

This plugin is a **model-serving adapter**, not an agent framework. It registers the
`opencode-http-agent` route directly into the DSH model registry
(`ctx.llm.registerAdapter`) and streams generations from OpenCode Go's
OpenAI-compatible `/chat/completions` endpoint.

The split that matters:

- **The adapter generates.** It turns one DSH step into one raw streaming request and
  normalizes the SSE deltas back into DSH stream chunks.
- **DSH keeps autonomy.** The agent loop, system prompt, tool schemas, tool execution,
  session history, compaction and the active workspace directory all stay with the
  harness. The adapter never runs an OpenCode agent, never issues a session prompt, and
  never injects a persona.

The local OpenCode server is used as a **control plane only** — catalog, provider
metadata, and cached credentials (`/api/model`, `/api/provider/{id}`,
`/api/credential`). Conversations never travel through it.

```
DSH agent loop ──► opencode-http-agent ──► {baseURL}/chat/completions   (data plane)
                          │
                          └──► opencode serve (local)                   (control plane)
                               /api/model · /api/provider · /api/credential
```

## Provided capabilities

| Surface | Row | What it does |
|---|---|---|
| **`opencode-http-agent`** | `dsh-opencode-v2-http` | The streaming model route. Appears in the prompt model picker. Recommended path. |
| **`opencode` tool** + **`/opencode`** | `dsh-opencode-v2` | Delegates one task to `opencode run` in a child process and returns its final text. |
| **`cli_worker`** + **`/worker`** | `dsh-opencode-v2` | One-shot isolated batch runs of `opencode` / `codex` / `claude` with artifact collection. |

The route is what you want for normal work: it streams, it carries reasoning, and DSH
owns the loop. The two tools are for delegating a self-contained job to an external CLI.

Stream output is normalized into DSH chunks in this order:
`block-start`, `text-delta` / `reasoning-delta` / `tool-call-delta`, `block-end`,
then **`usage` before `finish`**. Usage buckets are disjoint — cached tokens are
subtracted from `prompt_tokens`, and `reasoning_tokens` are never double counted.

## Localisation

English is the default; Korean follows the host locale. The plugin card title/description live in
`locale/en.json` and `locale/ko.json` (`오픈코드 v2 에이전트`), and the browser half carries the
full `I18N.ko` / `I18N.en` tables for the model-settings tab and the session cost pill. The client
exports `inject = ['slots', 'locale']`; `test/locale.test.mjs` pins the card metadata and both
language tables.

## Configuration

All configuration lives in **one** place: the **OpenCode V2** settings panel
(Settings → OpenCode V2). It is backed by `lib/client.js` and writes the
`dsh-opencode-v2-http` row through the host settings service.

| Control | Effect |
|---|---|
| **Plan** (Go / Zen) | Which provider namespace the picker offers. Plan availability is decided from the route id alone, so switching never calls the backend. |
| **Model checklist** | The allow-list. Only ticked routes appear in the prompt model picker; an empty list means "offer everything". |
| **Select all usable / Clear all** | Bulk edit of that allow-list. |
| **Refresh usage ranking** | Fetches `opencode.ai/data/index.json` and orders rows by public usage. |
| Row badges | `usable`, `new model`, `other plan`, and refusals the backend actually reported (`unavailable`, `deprecated`, `auth`, `forbidden`). |

Refusal badges are not a pre-flight probe: they record what the backend said during real
traffic, so checking every route costs no quota. A route that starts working clears its
badge automatically.

### Profile keys

Most operators never touch these, but the bundle row accepts them:

| Key | Default | Meaning |
|---|---|---|
| `defaultModel` | `opencode-go/minimax-m3.1-flash` | Route behind the `default` picker row. Reasoning levels come from `reasoningEffort`, not a `#variant` suffix. |
| `activePlan` | `go` | `go` or `zen`; same gate as the panel's Plan control. |
| `enabledModels` | `[]` | Allow-list. Empty means unrestricted. |
| `turnMaxTokens` | `16384` | Completion tokens **one turn** reserves. Separate from the route's `limit.output` capability: the reservation is subtracted from the context window before compaction, so a capability-sized value would waste context. |
| `conflictPolicy` | `warn` | `warn` serves alongside a legacy `opencode-go`/`opencode` provider; `stand-down` yields the namespace. |
| `attachToDaemon` / `spawnServer` | `true` / `true` | Attach to a running `opencode serve` first, own one only when nothing is reachable. |
| `cwd` | — | Working directory of the local server process **only**. The model context workspace always comes from the DSH session. |

### Credentials

`password` and `apiKey` are declared `.role('secret')`, so the host redaction layer
strips them from every settings response. Leave them empty to use the credential already
stored by `opencode auth login`; the adapter reads it from the local control plane.

---

## Release ladder (owner instruction, 2026-11-04)

| Step | Version | What ships |
|---|---|---|
| 1 | `0.0.1-rc.1`, `-rc.2`, … | Each `rc` is one instructed fix round on the single `0.0.1` line. |
| 2 | next minor patch of the stable package | Only after the `rc` line is quiet. The canonical parser (former "beta") is added to THIS package, not to a second one. |
| 3 | following stable line | The conformance oracle becomes part of the shipped test suite. |

Rules:

- The version changes only on an explicit owner instruction; a green test run is not one.
- **There is no second package.** The `@nolit/dsh-opencode-v2-beta` staging package was
  removed on 2026-11-04: it registered the same tool, commands, worker and model route as
  this one (mutual exclusion was mandatory) and its plugin card had no title, so the operator
  saw two identical-looking entries and could not tell which was which. Stage 2 and 3 work
  now happens on top of a stabilised stable release.
- A promoted change keeps the same package identity, so a rollback is a version change, not a
  profile rebuild.

**Read before opening a stage:** [docs/OPENCODE-V2-STAGE-PLAN.md](../docs/OPENCODE-V2-STAGE-PLAN.md)
— the seven stage-1 exit criteria, the stage-2 acceptance gates, the three adversarial inputs
that must round-trip, and the rollback route.

**Check the gate, do not assert it:**

```bash
scripts/opencode-v2-stabilisation-status.sh --boot --browser
```

It prints S1–S7 with PASS/FAIL/UNKNOWN and exits non-zero unless every machine-decidable
criterion passes. `S6` (soak) is owner-reported and always prints UNKNOWN — that is the
criterion `0.0.2` skipped, which is why it broke on its first boot.


## Request guards (Tier A, 2026-11-04)

Four protections run before a request leaves the adapter. Each is either a rule copied
from [deepseek-ai/deepseek-recipe](https://github.com/deepseek-ai/deepseek-recipe) or a
defect measured on this profile's recorded traffic.

| Guard | Rule | Why |
|---|---|---|
| `max_tokens` clamp | `min(reservation, contextWindow - promptTokens)`, floored at 1 | recipe `resolve_max_tokens`; 3,140 recorded requests carried >120k prompt characters and none was checked against the window |
| Context overflow | prompt alone > window -> `OPENCODE_CONTEXT_OVERFLOW`, request never sent | an unservable prompt is rejected by the route only after the whole upload |
| Tool validation | non-empty name, at most 128 bytes, `^[a-zA-Z0-9_-]+$`, unique, `parameters` is an object | recipe `protocol/validation.rs`; otherwise an opaque mid-turn 400 (`OPENCODE_REQUEST_INVALID`) |
| Stop validation | at most 16 entries, none empty | recipe `validate_stop_sequences` |
| Finish reason | `stop`, `tool-calls`, `max-tokens`, or `error`; any other upstream reason is an error | a filtered response used to read as a clean `stop` and the host committed it |

Prompt tokens for the clamp are estimated (3.5 chars/token, the conservative end of the
measured range) because this package ships no tokenizer. An exact count needs
`deepseek-recipe-encoding` and is deliberately not a dependency.

Reasoning accounting: the host's `TokenUsage` has no field for "the route did not report
`reasoning_tokens`", so the adapter records it on the trace's finish line and warns once
per stream. Measured: reasoning is 86.1% of output characters on this profile, yet the
field arrives in 2 of 35 recorded steps.


## Collision guard (legacy providers only)

`conflictPolicy` handles ONE case: a legacy `opencode-go` / `opencode` provider (for example
`llm-pi-ai`) already owns the same namespace. `warn` serves alongside it, `stand-down` yields
the namespace and keeps the tools and commands usable.

There is no guard between two copies of this adapter any more, because there is only one
package. A second copy of the same package in one profile is a mount error the host reports
itself (duplicate tool registration), which is the honest place for it.


## Reference — measured OpenCode v2.2.0 facts

| Fact (measured) | Consequence in this plugin |
|---|---|
| `opencode models` lists **49 models** — 30 `opencode-go/*`, 19 `opencode/*` | the default route is `opencode-go/minimax-m3.1-flash#low`; no route is ever assumed to resolve |
| `run --format json` emits no whole-run `step_finish`: a tool-free run emits only `step_start`, `reasoning`, `text`; a tool-using run emits a **per-step** `step_finish` | `run` never carries a whole-run usage total; char/4 heuristics are never emitted, and `session export` is the only authoritative source |
| `part.text` is a **cumulative snapshot** per part id, not a delta | the parser diffs snapshots into deltas |
| `--thinking` is required for `reasoning` events | streaming reasoning is opt-in via `thinking: true` (default on) |
| a route's reasoning levels are its **model variants**: `run --help` documents `-m provider/model#variant`, and `GET /api/model` lists `variants` per model (39 of 49 models on this account) | `resolveModel()` advertises them as `reasoning.efforts` and the selected level becomes `-m provider/model#<variant>` |
| an unknown variant fails the run: `provider.no-route` "Variant unavailable for <provider>/<model>: <id>" | ids are passed verbatim from discovery; nothing is invented |
| `reasoning` events exist with a `…_reasoning-N` part id | streamed as `reasoning-delta` on their **own block index** (text stays 0) |
| `--attach` and `--pure` were **removed** (exit 1, "Unrecognized flag", usage on stdout) | never emitted; stripped from `extraArgs`; old config keys accepted but inert |
| `--title` and `-f/--file` exist | exposed as tool params `title` / `files` |
| `opencode session export <sid>` → `info.tokens` is authoritative | token/cost accounting is fetched after the run |
| a stale `opencode serve --service` on port **49374** breaks every command | documented as a pre-probe check (see §4) |

### Token mapping (`info.tokens` → host `TokenUsage`)

The host contract (`@deepseek-ai/dsh-llm` `types.d.ts`, `TokenUsage`) is **disjoint**:
`inputTokens` is uncached input only, and cache hits are reported separately.

| host field | OpenCode source |
|---|---|
| `inputTokens` | `tokens.input` (already uncached-only) |
| `outputTokens` | `tokens.output` |
| `reasoningTokens` | `tokens.reasoning` |
| `cacheReadTokens` | `tokens.cache.read` |
| `cacheWriteTokens` | `tokens.cache.write` |
| `totalTokens` | `input + output + reasoning + read + write` |

If the export fails, usage is **omitted** (provider) or left at `0` (tool) rather
than invented.

## Surfaces in detail

Both halves are plain hand-written ESM — there is **no build step**.

**`lib/index.js` → `@nolit/dsh-opencode-v2`** (row id `dsh-opencode-v2`)
- the **`opencode` tool** — delegates a task to `opencode run`, bounded capture,
  then over-fetches `session export` to fill real token counts;
- the **`/opencode` command** — registered when a `commands` service is composed;
- the **`cli_worker` tool** — one-shot isolated `opencode`/`codex`/`claude` batch
  runs with artifact collection (§2f), plus `/worker`.

Parameters: `prompt` (required), `cwd`, `model`, `agent`, `session`,
`continueLast`, `auto`, **`thinking`**, **`title`**, **`files`**, `timeoutMs`.

**`lib/http.js` → `@nolit/dsh-opencode-v2/http`** (row id `dsh-opencode-v2-http`)
- the **`opencode-http-agent` pure LLM route** — registered directly with
  `ctx.llm.registerAdapter()` (no bridge plugin);
- generation goes straight to OpenCode Go's **OpenAI-compatible
  `/chat/completions`** backend (`stream:true`,
  `stream_options.include_usage:true`); the local OpenCode server supplies only
  catalog/provider metadata/credential (`/api/model`, `/api/provider/{id}`,
  `/api/credential`);
- per-route **reasoning levels** — `/api/model` variants become host
  `reasoning.efforts` and are forwarded as `reasoning_effort`;
- raw SSE deltas become DSH `block-start`, `text-delta`, `reasoning-delta`,
  `tool-call-delta`, `block-end`, `usage`, `finish` chunks;
- DSH owns the agent loop, tool schemas, tool execution, session history, and
  the active workspace cwd (`ctx.sessions.get(sessionId).header.cwd`). The
  adapter never runs an OpenCode agent, permission prompt, or session prompt.

**`lib/provider.js`** is a **library**, not a mountable route: it exports the
batch-worker transcript/parse helpers (`blocksToText`, `buildPrompt`,
`OpencodeLlmAdapter`) but deliberately exports **no `apply`**. It is kept for
`cli_worker`/tests and for reading the legacy `opencode run` surface; it never
registers an LLM adapter (asserted by `test/providers.test.mjs`).

Errors never crash the host: a timeout finishes with
`{kind:'error', failure:{code:'OPENCODE_TIMEOUT'}}`, a non-zero exit with
`OPENCODE_EXIT` plus the stderr tail, and an unresolvable executable with
`OPENCODE_SPAWN`.

> `dsh-tools` declares tool output schemas with `additionalProperties: false`, so
> the `opencode` tool returns **exactly** the upstream key set
> (`ok`, `exitCode`, `signal`, `timedOut`, `truncated`, `sessionId`,
> `inputTokens`, `outputTokens`, `stdout`, `stderr`). Extra detail such as the
> `usage:` line is rendered as text only.

### Context window (required for compaction)

DSH `compaction-basic` **throws** when a resolved model has no context capacity:

```
compaction-basic: no context capacity for opencode-agent/<model>;
configure contextWindow on that adapter model
```

That is not a model-size problem — it is a missing metadata field. This adapter therefore
**always** publishes a positive `context.contextWindow` (and `defaultMaxTokens`) from
`resolveModel()`:

| Source | Used for |
|---|---|
| `opencode serve` -> `GET /api/model` -> `limit.context` / `limit.output` | real per-model values |
| `opencode models` (ids only) | ids + conservative `32768` / `8192` floor |
| unknown route | conservative `32768` / `8192` floor |

Measured v2.2.0 values: `opencode-go/deepseek-v4.1-flash` = 1,000,000 tokens,
`opencode/deepseek-v4.1-flash-free` = 200,000, `opencode/beam-free` = 1,048,576,
`opencode-go/minimax-m3.1-flash` = 1,000,000.

Discovery starts a short-lived `opencode serve` (1-3 s) and is cached for
`discoveryCacheMs` (default 5 min). Keep `autoDiscoverModels: true`; even when disabled the
adapter publishes a safe floor rather than a broken session.

### Reasoning levels (thinking selector)

The prompt's model selector shows a thinking-level choice only for a model whose **exact**
resolution returns `reasoning` (`buildModelCatalog` -> `llm.resolveModelInfo()`; absent means
"provider default" only). A route that advertises no levels is offered without a level choice,
and an explicit level is rejected with `UNSUPPORTED_REASONING_EFFORT` rather than silently running
at a different one.

| Host contract | Source in OpenCode v2.2.0 |
|---|---|
| `reasoning.efforts[].id` / `.name` | `GET /api/model` -> `variants[].id`, ordered none -> minimal -> low -> medium -> high -> xhigh -> max, then any unknown id |
| wire selection (`GenerateOptions.reasoningEffort`) | `-m provider/model#<variant>` (the variant sets `reasoningEffort` or `thinkingConfig` provider-side) |
| `reasoning.defaultEffort` | **not set**: omitting a level preserves OpenCode's own default variant |

Measured levels on this account: `low` (31 models), `high` (34), `max` (24), `medium` (21),
`xhigh` (19), `none` (13), `minimal` (5), `thinking` (1). The host catalog advertises 50 routes
(49 models plus the `default` pseudo-route) and 39 of them carry levels. A route with no variants
advertises none, so the host rejects a level instead of silently running at a different one.

Measured against the live account (`GET /api/model`) and the running
profile's cached catalog (`~/.dsh/profiles/web/opencode-models.json`): both report the same 39
routes with levels and the same 10 without — `opencode/big-pickle`,
`opencode/mimo-v2.6-flash-free`, `opencode/nemotron-3.5-lightning-free`,
`opencode-go/iceman-contributor-free`, `opencode-go/kimi-k2.7-code`, `opencode-go/longcat-2.0`,
`opencode-go/mimo-v2.5`, `opencode-go/mimo-v2.5-pro`, `opencode-go/mimo-v2.6-flash`, and
`opencode-go/mimo-v2.6-pro`. Those routes declare no `variants` upstream, so their picker row has
no level choice; this is an OpenCode catalog fact, not a discovery or mapping failure. `--thinking`
is independent: a variant-less model can still stream reasoning blocks.

`opencode-go/minimax-m3.1-flash` is the default route: 1,000,000 context, 512,000 output, and the
levels `low`, `medium`, `high`, `xhigh`, `max`. The default carries `#low` on the CLI route, where
the variant is part of `-m`; the HTTP route resolves its level from the DSH agent's own level,
because the route id is split at its first `/` and a `#` suffix would become part of the model id.

`default` has no `/api/model` entry of its own. The HTTP adapter resolves it through the same
`modelRefFromRoute()` call it uses on the wire (`models[].opencodeModel` for `default`, else
`defaultModel`), so the row inherits that route's context window and levels instead of the
conservative floor. The CLI adapter inherits them when the route table's `default.opencodeModel`
names a discovered route; with no such entry it advertises none and sends no `-m`, leaving
OpenCode's own default in force.

A level reaches the wire only when the resolved route advertises it. Both adapters reject an
unadvertised level before spawning or creating a session, with `UNSUPPORTED_REASONING_EFFORT` and
the advertised list, instead of OpenCode's `provider.no-route` ("Variant unavailable"). When the
`serve` probe is unavailable, the CLI route logs that it fell back to `opencode models`; that
listing carries ids only, so a fallback catalog advertises no levels and the `32768` context floor.

A level the resolved route does not advertise is rejected **before spawning** or creating an HTTP
session: the failure carries `UNSUPPORTED_REASONING_EFFORT` and the advertised list (or `none`),
instead of OpenCode's `provider.no-route` "Variant unavailable" mid-run. This guards direct adapter
callers and selections made against an older catalog. When the `serve` probe is unavailable the
adapter logs that it fell back to `opencode models` (ids only), because that fallback removes every
level and collapses context windows to the floor.

The catalog resolves every route at once, so discovery is **single-flight**: one `opencode serve`
per cache window, not one per route (measured: 0 extra probes for a 46-route catalog build).

The ready banner is read from a **piped** stdout: `dsh-subprocess` exposes `handle.stdout` only for
`stdout: 'pipe'`, so a collect-mode (`{ maxBytes }`) spawn yields no stream and silently degrades
every route to the 32768 floor with no levels. The adapter therefore spawns serve with a piped
stdout and bounds the readiness wait.

The `opencode models` fallback discloses ids only, so it advertises no levels; only the
`serve` discovery path can. `--thinking` stays independent: it controls whether OpenCode
*streams* reasoning blocks, not how much reasoning the model does.

### Prompt delivery on stdin

The flattened transcript is **not** an argv element. Linux caps one argument string at 128 KiB
(`MAX_ARG_STRLEN`, 32 pages); measured: `spawn` with a 140 KB argument fails `E2BIG`, 120 KB
succeeds. A DSH transcript routinely exceeds that, so the prompt is never passed as a
`-- <prompt>` argument: doing so fails with `OPENCODE_SPAWN` / `spawn E2BIG` before the CLI
starts. Both the route and the `opencode` tool deliver it on stdin.

Measured v2.2.0 surface: `opencode run` reads the message from stdin when no positional message
is given (`printf 'say OK' | opencode run -m opencode/beam-free` answers `OK`), and accepts a
200 KB piped prompt. The adapter therefore spawns with `stdin: 'pipe'`, keeps the prompt out of argv,
and closes stdin through `sendPrompt()`; argv now ends at the last flag.

Proof through the real adapter and the real CLI: a 189,051-byte prompt delivered on stdin
produced an 88-character argv and a `finish{kind:'stop'}` with `text:"PONG"`.

### The streaming backend adapter

The route is a **protocol router**, not an agent harness. The local OpenCode
server is used only as a control plane; each DSH generation is one raw
OpenAI-compatible backend call.

| Concern | CLI worker (`lib/provider.js`, library only) | Pure route (`lib/http.js`) |
|---|---|---|
| Transport | `opencode run` child per call, prompt on stdin | `POST {settings.baseURL}/chat/completions` |
| History | full transcript re-sent every call | DSH sends its own full `messages` history each call |
| Usage | `opencode session export` second child | final OpenAI `usage` chunk (`prompt_tokens`, `completion_tokens`, `cached_tokens`, `reasoning_tokens`) |
| Interrupt | child signal | abort `AbortSignal` on the HTTP request |
| Permissions | OpenCode's own policy | **DSH-owned**; the adapter never runs tools |
| Server | one process per generation | local control plane only (attach daemon or spawn `--port 0`) |

Control-plane resolution order: explicit `baseUrl` → the CLI daemon's
`~/.local/state/opencode/service.json` (`url`/`pid`/`password`, verified with `/api/info`) →
`opencode serve --port 0` owned by the adapter. Auth is Basic `opencode:<password>`.
Backend resolution order: explicit `backendBaseUrl` + `apiKey`/`OPENCODE_API_KEY`, otherwise
`GET /api/provider/{backendProviderId}` for `settings.baseURL`/headers and
`GET /api/credential` for the credential. The pair is cached for
`credentialCacheMs` and refreshed once on a 401.

### Model catalog lifecycle

The catalog the Web model picker reads is served from a durable snapshot, not from a live probe
on the read path:

| Phase | Behaviour |
|---|---|
| Activation | `opencode-models.json` is read **synchronously** from the profile directory; the first `listModels()` answers from memory |
| Cold probe | Runs in the background right after activation (and on the `catalogSyncMs` timer, default 5 min) |
| Stale read | A snapshot older than `discoveryCacheMs` still answers immediately and revalidates in the background (single-flight) |
| Change | A different catalog rewrites the snapshot atomically and emits `llm/models-updated`, so connected clients refetch |
| Failure | The last good catalog survives; the probe error is logged and surfaced to operators instead of emptying the picker |

### The CLI worker tool

The isolated batch worker ships **inside this package**; there is no second
plugin to install, patch, or version. `lib/index.js` registers a second tool
when `workerEnabled` is true (default):

| Concern | Behaviour |
|---|---|
| Backends | `opencode` (`run --format json --thinking --auto --standalone`), `codex` (`exec --json`), `claude` (`-p --output-format json`) |
| Daemon isolation | `--standalone` keeps a worker on a private server: it never starts, restarts, or contends with the shared `opencode service` the conversation route attaches to |
| Directory | the child's `PWD` is pinned to the validated `cwd`, because the OpenCode CLI resolves its session directory from `PWD`, not from the spawn cwd |
| Input | `task` (required, delivered on **stdin**, never argv), `backend`, `cwd` (required, absolute), `model`, `timeoutMs`, `collect` |
| Isolation | one process per call through `ctx.subprocess`; credential-shaped env names are scrubbed by the service; the child only sees the forwarded allow-list |
| Output | `{ok, backend, exitCode, timedOut, truncated, summary, artifacts:[{path,bytes,sha256}], missing, skipped, inputTokens, outputTokens, stderrTail}` |
| Artifacts | globs resolve strictly inside `cwd`; an unmatched glob is reported in `missing`, never dropped |
| Cancellation | the tool `signal` aborts the child; a cancelled call returns `ok:false, timedOut` and exit code `-1` |
| Failure | a non-zero exit is an exit fact (`ok:false`); provider errors arrive as stdout JSON events (e.g. a 429 free-limit) and are folded into `stderrTail` so the failure is readable |

It never registers an LLM route and never appears in the model picker. Config:
`workerEnabled`, `workerBackend` (default `opencode`), `workerTimeoutMs`
(default 900000), `workerMaxOutputBytes` (default 262144), `workerArtifactLimit`
(default 100). A `/worker <task>` command runs the configured backend in the
host's working directory.


## Bundle layer

`cordis.patch.yml` is **this package's own** patch file — not upstream's. It
inserts two rows whose `id`s equal the exported plugin names (the loader derives
the settings namespace from the id):

| row id | name | role |
|---|---|---|
| `dsh-opencode-v2` | `@nolit/dsh-opencode-v2` | `opencode` tool, `/opencode`, `cli_worker`, `/worker` |
| `dsh-opencode-v2-http` | `@nolit/dsh-opencode-v2/http` | **autonomous model router** (`opencode-http-agent`) |

`./provider` is exported for the batch-worker backend but has **no `apply`** and
is not a bundle row. There are deliberately **no `attach` / `pure` keys**.

### Native router and conflict guard

`dsh-opencode-v2` owns the OpenCode model namespace itself: it registers
`opencode-http-agent` directly into `dsh-llm` and needs no `dsh-subrouter`,
no bridge plugin, and no `llm-pi-ai` dependency. Token metering, session
tracking, and request waterfalls are all harness-level, so a native adapter is
intercepted exactly like any other route.

The HTTP row runs a read-only conflict guard (`lib/conflicts.js`) at activation
and on every `llm/adapters-updated` event:

| Situation | `conflictPolicy: warn` (default) | `conflictPolicy: stand-down` |
|---|---|---|
| Legacy `opencode-go` / `opencode` provider active (llm-pi-ai) | serve, log that the model family is duplicated | do not register; re-register when it disappears |
| `opencode-http-agent` already registered (second copy) | skip this instance | skip this instance |
| No conflict | serve | serve |

The guard never unloads another plugin — a plugin must not mutate the host
registry on behalf of a sibling. "Deactivating `llm-pi-ai`" means this instance
steps aside when told to, not reaching into another fiber. The tool half has its
own guard: a duplicate `opencode` tool name is logged and yielded instead of
aborting the whole plugin row.

### Golden reference pattern for future vendor adapters

Every model-serving plugin copies this shape:

1. **Control plane ≠ data plane.** Use the vendor's local server/API only for
   catalog, provider metadata, and cached credentials. Never send DSH
   conversations through a vendor agent/session endpoint.
2. **One raw generation call per DSH step.** `POST {baseURL}/chat/completions`
   (or the vendor's equivalent) with `stream:true`,
   `stream_options.include_usage:true`, DSH `messages`/`tools` verbatim, and
   the caller's `reasoningEffort` mapped to the vendor's effort field.
3. **Normalize into DSH `StreamChunk`s.** `block-start`, `text-delta`,
   `reasoning-delta`, `tool-call-delta`, `block-end`, then **`usage` before
   `finish`**. Usage buckets are disjoint: subtract cached tokens from
   `prompt_tokens`; never double-count `reasoning_tokens` (they are part of
   `completion_tokens`).
4. **No persona, no notes, no session prompt, no permission bridge.** The DSH
   system prompt is the only system prompt; the adapter constructs no
   `[note: the caller declared ...]` text.
5. **Workspace is DSH-owned.** Resolve it from
   `ctx.sessions.get(options.sessionId).header.cwd`; never pin a static project
   path in the adapter. `cwd` config remains only for local server process
   startup.
6. **Cache credentials, refresh on 401, preserve `AbortSignal`.** Surface
   vendor errors as stable `OPENCODE_BACKEND_*` failure codes.

## Verify without touching the live profile

```bash
cd dsh-opencode-v2
npm test            # node --test: fake subprocess + fake OpenAI-compatible SSE backend
npm run check       # node --check on every lib file
```

The suite fakes `ctx.subprocess` and the local control plane, so it never spawns
`opencode`, opens a real backend socket, or reads `~/.dsh`. `test/bundle.test.mjs` also parses `cordis.patch.yml` with
`js-yaml` and proves every row id/name/config key agrees with `package.json` and
the module Config schemas.

**Post-restart proof** (read-only; no model request, no `~/.dsh` write). Run from the workspace
root; the helper is not shipped in this package:

```bash
./scripts/verify-opencode-v2-restart.sh            # verdict for the current process
./scripts/verify-opencode-v2-restart.sh --wait 300 # one terminal: wait for MainPID to change
                                                   # restart in another; read the "after" block
```

`STALE` is expected before the restart (the serving pid loaded the previous build). It is `PASS`
only when that pid's `load` beacon carries the source version: `beacon(pid=<new>): 0.0.1
events={"load":1,...}`, verdict `PASS - serving pid <new> loaded 0.0.1`, exit 0.

**Isolated profile boot** (boot-card rule 3 — no live state touched):

```bash
export DSH_HOME=/tmp/dshhome-ocv2
mkdir -p "$DSH_HOME/profiles"
cp -a ~/.dsh/profiles/web "$DSH_HOME/profiles/web"
# register the bundle instead of hand-editing the live profile
dsh --profile web --dump-config > /tmp/ocv2-dump.yml   # no duplicate-id / unknown-plugin errors
```

**Live token probe** (needs real credentials, so it uses the real `HOME`):

```bash
# A stale service from another HOME squats port 49374 and breaks every command:
pgrep -af 'opencode serve --service'      # expect nothing, or kill it
opencode run --format json --thinking -m 'opencode-go/minimax-m3.1-flash#low' -- 'say hi'
opencode session export <ses_…>           # -> info.tokens.{input,output,reasoning,cache}
```

## Prerequisites (measured 2026-11-04)

Every value below was read from this machine with the command shown. Nothing here
is copied from upstream documentation.

### 1. OpenCode v2 CLI

| Requirement | Measured on this host | Verified with |
|---|---|---|
| Binary | `opencode v2.2.0` | `/home/minami/.bun/bin/opencode --version` |
| Install shape | bun shim -> `@opencode/cli/bin/opencode.exe` | `ls -la /home/minami/.bun/bin/opencode` |
| Minimum for this plugin | v2.2.0 | `GET /api/info` reports `version`; the plugin refuses v1 flags |

```bash
bun install -g @opencode/cli        # measured install on this host
# or: npm install -g @opencode/cli
opencode --version                  # must report v2.2.x or newer v2
```

v1 is not supported: v2 removed `--attach` and `--pure`, so either flag makes
`opencode run` exit 1 with a usage dump (see `cordis.patch.yml`).

### 2. Web authentication and token storage

The adapter never reads the credential file itself. It asks the control plane
(`GET /api/credential`) for the **active** entry, so the login must be done through the
CLI, not by hand-editing a file.

```bash
opencode auth login   # web (OAuth) login; the token lands in the store below
opencode auth list    # what the store currently holds
```

| Fact | Measured value |
|---|---|
| Store | `~/.local/share/opencode/auth.json`, mode 0644 on this host |
| Entry shape | `{ "<integration>": { "type": "api_key" or "oauth", "key" or "access": "..." } }` |
| Integrations present | `opencode`, `opencode-zen`, `zen` — the model route is `opencode-go`, so the credential owner id does not match the route id |
| Selection order | active `oauth` first, then active `key`, then the first active entry; `credentialLabel` pins one |

The store is plaintext at mode 0644 in the measured install, so treat it as a secret
(`chmod 600` on a shared host). If it holds a revoked `key` next to a live `oauth`
token, the selection order above is what stops the adapter sending the dead one
(measured 2026-10-30: the Go endpoint answers 401 for the revoked key, 200 for the web
token).

### 3. Binary path resolution (the most common failure)

`opencodePath` defaults to `'opencode'`, which is PATH resolution **at spawn time**. A
service unit (`dsh-web.service`) does not inherit an interactive shell's PATH, so the
bare name fails there while the same command works in a terminal. Pin the absolute path:

```yaml
- id: dsh-opencode-v2-http
  name: '@nolit/dsh-opencode-v2/http'
  config:
    opencodePath: '/home/minami/.bun/bin/opencode'   # absolute: the service PATH has no ~/.bun/bin
```

Validate in this order before restarting:

```bash
# 1. exists and is executable
test -x /home/minami/.bun/bin/opencode && echo ok

# 2. is v2 (a v1 binary fails on every flag the plugin passes)
/home/minami/.bun/bin/opencode --version

# 3. the control plane answers
/home/minami/.bun/bin/opencode serve --port 4096 &
curl -s http://127.0.0.1:4096/api/info          # {"version":"2.2.0",...}

# 4. a credential is present AND active
curl -s http://127.0.0.1:4096/api/credential    # look for active:true + oauth/key

# 5. one real generation on the exact route the plugin uses
/home/minami/.bun/bin/opencode run --format json --thinking \
  -m 'opencode-go/minimax-m3.1-flash#low' -- 'say hi'
```

Failure mapping: step 3 failing surfaces as `no OpenCode server: ... and spawnServer is
disabled` (or the adapter spawns its own); step 4 failing surfaces as
`OPENCODE_BACKEND_AUTH` on every request -- fix the login, not the config.

## Install

Installing into the live profile requires a shell with a writable `~/.dsh` and a
real `dsh plugin add` — it is **not** done by this package, and it is not done
from a sandbox:

```bash
dsh plugin --profile web add /home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-opencode-v2
dsh web   # restart the service
```

> **Both `@quonaro/dsh-plugin-opencode` rows must be disabled or removed first.**
> Leaving them mounted makes the profile fail to boot with
> `tool "opencode" is already registered` — this plugin also registers a tool named
> `opencode`, and two live rows cannot share it.

`engines.dsh` is pinned to `>=0.2.2-alpha.2 <0.3.0` (boot-card rule 4).

## Files

```
dsh-opencode-v2/
├── package.json          # exports ., ./provider, ./cordis.patch.yml, ./package.json
├── cordis.patch.yml      # our bundle layer (two insert rows)
├── README.md
├── lib/
│   ├── index.js          # `opencode` tool + /opencode command
│   ├── provider.js       # `opencode-agent` LLM route (true streaming)
│   ├── upstream-map.js   # OpenAI / AI SDK delta -> typed part (reasoning | text | tool-call)
│   ├── stream-parser.js  # TOP: explicit state machine, content -> typed parts
│   ├── display-gate.js   # BOTTOM: parser channel vs screen channel
│   ├── request-guards.js # Tier A: max_tokens clamp, tool/stop validation (recipe-derived)
│   ├── optional-service.js # read a service cordis did not inject, without throwing
│   ├── display-clean.js  # retained: stripThinkingTags only; off the stream path
│   ├── trace.js          # opt-in real-traffic shape trace (OPENCODE_V2_TRACE=0 disables, 8 MB cap)
│   └── shared.js         # argv, ndjson parser, usage mapping/fetch
└── test/
    ├── upstream-map.test.mjs   # the wire field decides the part type
    ├── stream-parser.test.mjs  # classifier contract incl. DSML and two-way-split invariance
    ├── display-gate.test.mjs   # promote / echo / superseded / undeclared
    ├── shared.test.mjs   # argv / parser / usage
    ├── providers.test.mjs# tool + provider halves
    ├── bundle.test.mjs   # package.json <-> cordis.patch.yml contract
    ├── trace.test.mjs    # kill switch, compact lines, bounded excerpt, no body copied
    └── helpers/dsh-tools-stub.mjs

# scripts/analyze-opencode-trace.mjs (workspace root) summarises the trace:
# leak rate by tool count, context chars, system prompt and model