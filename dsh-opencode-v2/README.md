# @nolit/dsh-opencode-v2
<!-- skeleton:
version: 2.2
kind: readme
status: active
updated: 2026-10-30
summary: Golden-reference pure LLM adapter for OpenCode Go. The local OpenCode server is a control plane only (catalog/provider/credential); generation goes directly to the OpenAI-compatible /chat/completions backend and is normalized into DSH text/reasoning/tool/usage chunks. No agent loop, persona, session prompt, or static cwd.
-->


OpenCode inside DeepSeek Harness, aligned with the **OpenCode v2.2.0** CLI surface.

`dsh-opencode-v2` is a **managed wrapper**. It wraps
[`@quonaro/dsh-plugin-opencode@0.1.2`](https://www.npmjs.com/package/@quonaro/dsh-plugin-opencode)
as an ordinary npm **dependency** and **never modifies it** — no patching
`node_modules`, no forking files, no private hashed imports. Everything the v2
surface needs is re-implemented here on top of `ctx.subprocess`.

> Measurement of record: [`../OPENCODE-V2-SURFACE-MEASUREMENT.md`](../OPENCODE-V2-SURFACE-MEASUREMENT.md)

## 1. Measured OpenCode v2.2.0 facts this plugin is built on

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

## 2. What it provides

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

## 2a. Context window (required for compaction) — v0.1.1

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

## 2b. Reasoning levels (thinking selector) — v0.1.2

The prompt's model selector shows a thinking-level choice only for a model whose **exact**
resolution returns `reasoning` (`buildModelCatalog` -> `llm.resolveModelInfo()`; absent means
"provider default" only). Before v0.1.2 the `opencode-agent` route returned none, so OpenCode
models had no level choice and an explicit level was rejected with `UNSUPPORTED_REASONING_EFFORT`.

| Host contract | Source in OpenCode v2.2.0 |
|---|---|
| `reasoning.efforts[].id` / `.name` | `GET /api/model` -> `variants[].id`, ordered none -> minimal -> low -> medium -> high -> xhigh -> max, then any unknown id |
| wire selection (`GenerateOptions.reasoningEffort`) | `-m provider/model#<variant>` (the variant sets `reasoningEffort` or `thinkingConfig` provider-side) |
| `reasoning.defaultEffort` | **not set**: omitting a level preserves OpenCode's own default variant |

Measured levels on this account: `low` (31 models), `high` (34), `max` (24), `medium` (21),
`xhigh` (19), `none` (13), `minimal` (5), `thinking` (1). The host catalog advertises 50 routes
(49 models plus the `default` pseudo-route) and 39 of them carry levels. A route with no variants
advertises none, so the host rejects a level instead of silently running at a different one.

Re-measured 2026-10-30 against the live account (`GET /api/model`, 49 entries) and the running
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
every route to the 32768 floor with no levels. That is what v0.1.1 did; v0.1.2 spawns serve piped
and bounds the readiness wait.

The `opencode models` fallback discloses ids only, so it advertises no levels; only the
`serve` discovery path can. `--thinking` stays independent: it controls whether OpenCode
*streams* reasoning blocks, not how much reasoning the model does.

## 2c. Prompt delivery on stdin — v0.1.3

The flattened transcript is **not** an argv element. Linux caps one argument string at 128 KiB
(`MAX_ARG_STRLEN`, 32 pages); measured: `spawn` with a 140 KB argument fails `E2BIG`, 120 KB
succeeds. A DSH transcript routinely exceeds that, and v0.1.2 passed the prompt as one
`-- <prompt>` argument, so every long session died with `OPENCODE_SPAWN` / `spawn E2BIG` before
the CLI started. The tool path (`opencode` tool) had the same defect.

Measured v2.2.0 surface: `opencode run` reads the message from stdin when no positional message
is given (`printf 'say OK' | opencode run -m opencode/beam-free` answers `OK`), and accepts a
200 KB piped prompt. v0.1.3 therefore spawns with `stdin: 'pipe'`, drops the prompt from argv,
and closes stdin through `sendPrompt()`; argv now ends at the last flag.

Proof through the real adapter and the real CLI: a 189,051-byte prompt delivered on stdin
produced an 88-character argv and a `finish{kind:'stop'}` with `text:"PONG"`.

## 2d. Pure backend adapter (`opencode-http-agent`) — v0.5.0

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

### Session identity and credential choice (v0.5.1 — measured 2026-10-30)

Two independent defects made every `opencode-http-agent` turn fail after the 2026-10-30 22:36
restart. Both are fixed in v0.5.1:

| Defect | Measured symptom | Fix |
|---|---|---|
| No conversation header | Go backend answered **HTTP 400** `{"type":"error","error":{"type":"MissingSessionID","message":"Request is missing x-opencode-session …"}}`. The same body with the header was accepted. | `sessionHeaders()` sends `x-opencode-session` (config `sessionHeader`) = `options.sessionId`, else `sessionFallback` (default `deepseek-harness`) so catalog/title probes are not rejected either. |
| Credential preference | `GET /api/credential` listed an active **`key`** entry labelled `OpenCode Go` (revoked: **401 Invalid credential**) beside the active **`oauth`** web login (**200**, served). "First active match" picked the dead key. | Rank active candidates `oauth` → `key` → other; owner ids now include both `opencode` (where the store files credentials) and `opencode-go`; optional `credentialLabel` pins one entry. |

The store files credentials under `opencode` while the route is `opencode-go`, and a stored
master key without a Go subscription answers 403 — so the web (OAuth) login is the credential
that must win. Live verification after the fix: `st_66…d659` + `x-opencode-session` → **200**,
`content: "LIVE_OK"`, usage present. Record of the incident:
[`../OPENCODE-MODEL-SERVING-PLAN.md`](../OPENCODE-MODEL-SERVING-PLAN.md) §5.1.

The OpenCode console documents the requirement (Go: "Send a stable session ID in
`x-opencode-session` for each conversation") and lists DeepSeek Harness under *known
problematic clients* for exactly this gap.

### Model allow-list and the settings tab (v0.6.0 — measured 2026-10-30)

The catalog serves 49 routes, but only **35** are usable on this account (12 `Model is
unavailable.`, 2 deprecated — measured by a one-shot sweep, see
[`../OPENCODE-MODEL-SERVING-PLAN.md`](../OPENCODE-MODEL-SERVING-PLAN.md) §5.2). `status`/`enabled` in
`/api/model` are uniformly `active`/`true` and carry no entitlement, and the account limits endpoint
has no per-model data, so the backend's own answer is the only reliable signal.

| Piece | Behaviour |
|---|---|
| `enabledModels: string[]` | Route allow-list for the picker. **Empty = unrestricted**, which is the default, so clearing it restores the old behaviour. |
| `listModels()` | Keeps the `default` row, then only allow-listed catalog ids. Nothing else changes: sessions that already selected a hidden route keep running (display-only requirement). |
| `measureEntitlement()` | One minimal request per route, classified by `classifyProbe()` (`usable` / `unavailable` / `deprecated` / `auth` / `forbidden` / `error`); retries once at 16 tokens for providers with an output floor. 49 routes ≈ 20 s. |
| `lib/client.js` | Adds an **OpenCode v2** settings section (`settings.section`, order 60): a checklist of routes, a *Check usable models* button, *Select all (usable)*, *Clear all*, and *Save*. |
| `/api/local/opencode-v2/model-settings` | Catalog, current allow-list, and what the picker currently shows. |
| `/api/local/opencode-v2/model-settings/apply` | Persists the allow-list through `ctx.settings.update('dsh-opencode-v2-http', …)`. |
| `/api/local/opencode-v2/model-settings/measure` | Runs the sweep — only when the operator presses the button, never during a conversation. |

`inject` now includes `connection` and `settings`: reading an undeclared service throws and takes
the whole plugin entry down (measured in an isolated boot). A host without them still boots; the
settings routes are simply absent.

Tests are hermetic: `test/setup-isolate.mjs` pins `DSH_HOME` to a temp dir so a developer shell
exporting the live `DSH_HOME` can neither read nor overwrite live state.

Two operational facts the measurements forced:

- **The daemon is not a service.** The OpenCode CLI spawns `opencode serve --service` on demand
  and it dies with the process that spawned it, so at a fresh host boot there is usually no
  daemon to attach to. The adapter therefore verifies the endpoint with `/api/info` (a live pid
  whose port is gone is not enough) and falls back to spawning its own server.
- **`opencodePath` must be an absolute path** in a profile whose host PATH lacks the OpenCode
  install (the `dsh-web.service` PATH has no `~/.bun/bin`, so a bare `opencode` cannot be
  resolved). Without it the spawn fallback fails and the route has no models.

When no catalog can be fetched, `listModels` throws with the concrete reason; the host turns that
into a visible provider failure, so an empty list is never silent. The route name carries the
transport (`OpenCode Go (direct)`) and the advertised model description names the serving build
(`OpenCode Go v2.2.0 (OpenAI-compatible backend)`).

**Pure conversation (v0.5.0):** the HTTP route is model-only. The CLI adapter is not a route or a
fallback: `lib/provider.js` is a batch-worker backend that registers no LLM adapter, and the
`opencode` tool (`lib/index.js`) performs one-shot isolated runs. Rationale: the measured
`POST /api/session/{id}/prompt` path always runs OpenCode's `agent:"build"` with its own persona,
tools, and permissions — a harness-inside-a-harness. The direct backend has no such loop; DSH sees
raw deltas and remains the only owner of tool execution and workspace context.

Server discovery: candidate descriptor files are tried in order (`serviceStatePath`, then
`$OPENCODE_SERVICE_STATE`, `$XDG_STATE_HOME/opencode/service.json`,
`$XDG_CONFIG_HOME/opencode/service.json`) so an `opencode service` shared server is attached instead
of duplicated; each candidate is validated with `/api/info` before it is adopted, and spawning
remains the last resort.

Model availability: routes the server reports as `enabled: false` or `status: "disabled"` are
dropped from the catalog, and a configured route that is absent from the served catalog logs a
warning at resolution time instead of failing silently.

Cancellation (model switch or user stop) is reported as a `finish{kind:'aborted'}` chunk, so the
host records an aborted turn instead of an error.

Model names: when two providers serve the same display name (measured: `opencode/*` Zen and
`opencode-go/*` both name "DeepSeek V4.1 Flash"), the catalog appends the provider id
(`DeepSeek V4.1 Flash (Go)` / `(Zen)` — the OpenCode Go and Zen route namespaces) so the picker
does not show two indistinguishable rows.

The route publishes `contextWindow`/`defaultMaxTokens`/`reasoning.efforts` from `GET /api/model`
(`limit.context`, `limit.output`, `variants[]`). One DSH `sessionId` maps to one OpenCode session;
a reasoning effort is applied as the session model `variant`. `purpose: 'session-title'` stays
local, and an ephemeral call (no `sessionId`) deletes its OpenCode session afterwards.

## 2e. Model catalog lifecycle — v0.3.0

The catalog the Web model picker reads is served from a durable snapshot, not from a live probe
on the read path:

| Phase | Behaviour |
|---|---|
| Activation | `opencode-models.json` is read **synchronously** from the profile directory; the first `listModels()` answers from memory |
| Cold probe | Runs in the background right after activation (and on the `catalogSyncMs` timer, default 5 min) |
| Stale read | A snapshot older than `discoveryCacheMs` still answers immediately and revalidates in the background (single-flight) |
| Change | A different catalog rewrites the snapshot atomically and emits `llm/models-updated`, so connected clients refetch |
| Failure | The last good catalog survives; the probe error is logged and surfaced to operators instead of emptying the picker |

### Status-bar speed

The composer's `tok/s` pill is computed by DSH's `sessionStats` projection, not by
this plugin. Its stock formula counts only the settled message usage over the
wall-clock span from first token to settlement, which on this route (many nested
OpenCode calls per DSH step) reads 2 tok/s for a 400 tok/s model. Two changes make
it truthful: this adapter now emits a running usage total across nested steps, and
`scripts/patch-session-stats.mjs` (repo root of this workspace) rewrites that
projection to keep the generation total (the last cumulative snapshot, or the sum
when an adapter emits per-call deltas), to divide by packed delta-run time, and to
attribute `wall − TTFT − decode` of an `opencode-http-agent` step to `toolMs`
(OpenCode runs its tools inside the step, so DSH logs no `tool/call` for them).
Run it after every `dsh` upgrade:

```bash
node scripts/patch-session-stats.mjs "$(dirname "$(readlink -f "$(which dsh)")")/.."
```

The projection caches its state, so the patch bumps `stateVersion`; a service
restart is required before the new numbers appear (see VERIFICATION §21).

`models.json` lives at `<profile>/opencode-models.json` (the worker backend keeps its own
`opencode-models-cli.json` when it is constructed as a library). `catalogPath` overrides the
location, `catalogSyncMs: 0` disables the background timer, and `discoveryCacheMs` remains the
freshness window. Without a profile and without `DSH_HOME`, the cache stays in memory and nothing
is written to disk.

The DSH-session → OpenCode-session map is persisted the same way in
`<profile>/opencode-sessions.json` (`sessionMapPath` overrides). It lets a resumed DSH session
adopt its existing OpenCode session instead of replaying the transcript; adoption re-validates the
id with `GET /api/session/{id}` and drops a stale one. A private daemon that dies with the host
invalidates every id, so the benefit appears under attach / shared-service mode.

## 2f. Built-in CLI worker tool (`cli_worker`) — v0.3.4

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


## 3. Bundle layer

`cordis.patch.yml` is **this package's own** patch file — not upstream's. It
inserts two rows whose `id`s equal the exported plugin names (the loader derives
the settings namespace from the id):

| row id | name | role |
|---|---|---|
| `dsh-opencode-v2` | `@nolit/dsh-opencode-v2` | `opencode` tool, `/opencode`, `cli_worker`, `/worker` |
| `dsh-opencode-v2-http` | `@nolit/dsh-opencode-v2/http` | **autonomous model router** (`opencode-http-agent`) |

`./provider` is exported for the batch-worker backend but has **no `apply`** and
is not a bundle row. There are deliberately **no `attach` / `pure` keys**.

### 3.1 Native router and conflict guard

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

### 3.2 Golden reference pattern for future vendor adapters

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

## 4. Verify without touching `~/.dsh`

```bash
cd dsh-opencode-v2
npm test            # node --test: fake subprocess + fake OpenAI-compatible SSE backend
npm run check       # node --check on every lib file
```

The suite fakes `ctx.subprocess` and the local control plane, so it never spawns
`opencode`, opens a real backend socket, or reads `~/.dsh`. `test/bundle.test.mjs` also parses `cordis.patch.yml` with
`js-yaml` and proves every row id/name/config key agrees with `package.json` and
the module Config schemas.

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

## 5. Install

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

## 6. Files

```
dsh-opencode-v2/
├── package.json          # exports ., ./provider, ./cordis.patch.yml, ./package.json
├── cordis.patch.yml      # our bundle layer (two insert rows)
├── README.md
├── lib/
│   ├── index.js          # `opencode` tool + /opencode command
│   ├── provider.js       # `opencode-agent` LLM route (true streaming)
│   └── shared.js         # argv, ndjson parser, usage mapping/fetch
└── test/
    ├── shared.test.mjs   # argv / parser / usage
    ├── providers.test.mjs# tool + provider halves
    ├── bundle.test.mjs   # package.json <-> cordis.patch.yml contract
    └── helpers/dsh-tools-stub.mjs
```
