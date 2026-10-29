# @nolit/dsh-opencode-v2
<!-- skeleton:
version: 1.5
kind: readme
status: active
updated: 2026-10-29
summary: OpenCode v2.2.0 managed plugin: tool + /opencode + opencode-agent route, real token usage, per-model contextWindow, per-route reasoning levels (variants), stdin prompt delivery that survives the 128 KiB argv limit, and an HTTP provider that drives the OpenCode v2 server API with persistent sessions, a verified server endpoint, and visible discovery failures.
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
| `opencode models` lists **45 models** — 30 `opencode-go/*`, 15 `opencode/*` | the default route is `opencode/…`; no route is ever assumed to resolve |
| `run --format json` emits no whole-run `step_finish`: a tool-free run emits only `step_start`, `reasoning`, `text`; a tool-using run emits a **per-step** `step_finish` | `run` never carries a whole-run usage total; char/4 heuristics are never emitted, and `session export` is the only authoritative source |
| `part.text` is a **cumulative snapshot** per part id, not a delta | the parser diffs snapshots into deltas |
| `--thinking` is required for `reasoning` events | streaming reasoning is opt-in via `thinking: true` (default on) |
| a route's reasoning levels are its **model variants**: `run --help` documents `-m provider/model#variant`, and `GET /api/model` lists `variants` per model (35 of 45 models on this account) | `resolveModel()` advertises them as `reasoning.efforts` and the selected level becomes `-m provider/model#<variant>` |
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
- the **`/opencode` command** — registered when a `commands` service is composed.

Parameters: `prompt` (required), `cwd`, `model`, `agent`, `session`,
`continueLast`, `auto`, **`thinking`**, **`title`**, **`files`**, `timeoutMs`.

**`lib/provider.js` → `@nolit/dsh-opencode-v2/provider`** (row id `dsh-opencode-v2-provider`)
- the **`opencode-agent` LLM route** — flattens the transcript into one run and
  **true-streams** it: `text-delta` on block index `0`, `reasoning-delta` on
  block index `1`, `block-end` for each, then `usage`, then `finish`;
- per-route **reasoning levels** — advertised from `variants` and applied as
  `-m provider/model#<variant>` (see §2b).

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
`opencode/deepseek-v4.1-flash-free` = 200,000, `opencode/beam-free` = 1,048,576.

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

Measured levels on this account: `low` (29 models), `high` (30), `max` (22), `medium` (20),
`xhigh` (17), `none` (13), `minimal` (4), `thinking` (1). The host catalog advertises 46 routes
(45 models plus the `default` pseudo-route) and 35 of them carry levels. A route with no variants
advertises none, so the host rejects a level instead of silently running at a different one.

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

## 2d. HTTP provider (`opencode-http-agent`) — v0.2.0

A second route, same package, no CLI child per generation. It drives the measured OpenCode
v2.2.0 HTTP API instead:

| Concern | CLI route (`opencode-agent`) | HTTP route (`opencode-http-agent`) |
|---|---|---|
| Transport | `opencode run` child per call, prompt on stdin | `POST /api/session/{id}/prompt` + `GET /api/event` SSE |
| History | full transcript re-sent every call | persistent OpenCode session; only new user text is sent |
| Usage | `opencode session export` second child | inline `session.step.ended.tokens` (input/output/reasoning/cache) |
| Interrupt | child signal | `POST /api/session/{id}/interrupt` (measured 1.5 s abort) |
| Permissions | OpenCode's own policy | `permission.asked` → `reply {once|always|reject}` |
| Server | one process per generation | one `serve` per adapter (attach to the CLI daemon or spawn `--port 0`) |

Server resolution order: explicit `baseUrl` → the CLI daemon's
`~/.local/state/opencode/service.json` (`url`/`pid`/`password`, verified with `/api/info`) →
`opencode serve --port 0` owned by the adapter. Auth is Basic `opencode:<password>`.

Two operational facts the measurements forced:

- **The daemon is not a service.** The OpenCode CLI spawns `opencode serve --service` on demand
  and it dies with the process that spawned it, so at a fresh host boot there is usually no
  daemon to attach to. The adapter therefore verifies the endpoint with `/api/info` (a live pid
  whose port is gone is not enough) and falls back to spawning its own server.
- **`opencodePath` must be an absolute path** in a profile whose host PATH lacks the OpenCode
  install (the `dsh-web.service` PATH has no `~/.bun/bin`, so a bare `opencode` cannot be
  resolved). Without it the spawn fallback fails and the route has no models.

When no catalog can be fetched, `listModels` throws with the concrete reason; the host turns that
into a visible provider failure, so an empty list is never silent. The route names carry the
transport (`OpenCode (CLI)`, `OpenCode (HTTP)`) and the advertised model description names
the serving build (`OpenCode v2 server 2.2.0 via HTTP API`).

The route publishes `contextWindow`/`defaultMaxTokens`/`reasoning.efforts` from `GET /api/model`
(`limit.context`, `limit.output`, `variants[]`). One DSH `sessionId` maps to one OpenCode session;
a reasoning effort is applied as the session model `variant`. `purpose: 'session-title'` stays
local, and an ephemeral call (no `sessionId`) deletes its OpenCode session afterwards.

## 3. Bundle layer

`cordis.patch.yml` is **this package's own** patch file — not upstream's. It
inserts two rows whose `id`s equal the exported plugin names (the loader derives
the settings namespace from the id):

| row id | name |
|---|---|
| `dsh-opencode-v2` | `@nolit/dsh-opencode-v2` |
| `dsh-opencode-v2-provider` | `@nolit/dsh-opencode-v2/provider` |

There are deliberately **no `attach` / `pure` keys**.

## 4. Verify without touching `~/.dsh`

```bash
cd dsh-opencode-v2
npm test            # node --test: fake subprocess seam, no network, no ~/.dsh
npm run check       # node --check on every lib file
```

The suite fakes `ctx.subprocess`, so it never spawns `opencode`, opens a socket,
or reads `~/.dsh`. `test/bundle.test.mjs` also parses `cordis.patch.yml` with
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
opencode run --format json --thinking -m opencode/deepseek-v4.1-flash-free -- 'say hi'
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
