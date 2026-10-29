# OpenCode v2 HTTP API — measurement for DSH-side control

<!-- skeleton:
version: 1.0
kind: measurement
status: measured
updated: 2026-10-29
summary: Measured the OpenCode v2.2.0 HTTP server (130 endpoints, SSE event stream) as a DSH-controlled transport instead of per-turn `opencode run` subprocesses; auth, sessions, streaming, usage/cache, permissions, variants, and lifecycle.
-->

> Status: **measured** · Runtime: OpenCode CLI/API `2.2.0`, DSH `0.2.2-alpha.2` ·
> Target: running service `--service` PID 280829 at `127.0.0.1:49374`, plus a DSH-owned
> `opencode serve --port 0` child · Bindings: `~/.config/opencode/opencode.jsonc` ·
> Method: read the OpenAPI document, then HTTP calls and SSE capture against the real server.
> No live DSH state, profile, or plugin was modified.

## 0. Answer

**The HTTP path is real and strictly richer than the CLI wrapper, and DSH can own it.**
Measured: 130 endpoints, a typed SSE stream with per-token deltas, exact per-step token/cache/cost
accounting, persistent multi-turn sessions with prefix-cache reuse, a working permission bridge,
model/variant switching, compaction/interrupt endpoints, and an account usage-limits endpoint.
The 128 KiB argv limit that broke long CLI turns (see VERIFICATION.md §13) does not exist on this
path: a 189,041-byte prompt was accepted as a JSON body and answered.

## 1. Surface

| Fact | Measured value |
|---|---|
| API document | `GET /openapi.json` → OpenAPI **3.1.0**, title *opencode HttpApi 0.0.1*, **130 paths**, 337 schemas |
| Server identity | `GET /api/info` → `{"version":"2.2.0","pid":…,"urls":["http://127.0.0.1:49374"],"capabilities":{"persistentPty":true}}` |
| Auth | every `/api/*` returns **401 `UnauthorizedError`** without `Authorization: Basic base64(opencode:<password>)`; `/` (web UI HTML) is public |
| Password sources | own child: banner `server password <token>`; CLI daemon: `~/.local/state/opencode/service.json` (`{id,version,url,pid,password}`) |
| Key control endpoints | `POST /api/session`, `POST /api/session/{id}/prompt`, `/interrupt`, `/compact`, `/model`, `/permission/{rid}/reply`, `/fork`, `/revert/*`, `GET /api/session/{id}/context`, `GET /api/session/{id}/message`, `GET /api/session/active` |
| Event stream | `GET /api/event[?types=…]` → `text/event-stream`; OpenAPI enum lists **188 entries** (~94 unique event types) |
| Usage limits | `GET /api/experimental/usage/limits` |

## 2. Streaming and accounting (measured)

A 3-turn conversation on one HTTP session (`opencode/beam-free`):

| Turn | streamed text | step tokens | session cumulative tokens |
|---|---|---|---|
| 1 | `T1OK` | input 11, output 4, reasoning 24, cache.read 4160 | same as step |
| 2 | `42` | input 57, output 5, reasoning 36, cache.read 4160 | input 68, cache.read 8320 |
| 3 | summary sentence | input 114, output 17, reasoning 69, cache.read 4160 | input 182, cache.read 12480 |

- Deltas are real deltas: `session.text.delta`, `session.reasoning.delta` (not snapshots).
- `session.step.ended` carries `finish`, `rawFinish`, `tokens{input,output,reasoning,cache{read,write}}`, `cost`.
- `session.usage.updated` carries the session-cumulative `cost` + `tokens`.
- Session records (`GET /api/session`, `GET /api/session/{id}`) expose `tokens` and `cost` directly —
  no `session export` subprocess is needed.
- Cross-process resume: a follow-up prompt issued from a **different process** to a session created
  earlier answered `42` — the transcript lives server-side and prefix cache is reused each turn.

## 3. Permission bridge (measured)

With `permissions: [{"action":"*","resource":"*","effect":"ask"}]` on the session:

```
permission.asked  action=shell  resources=["echo HELLO_HTTP_PROBE"]  save=["echo *"]
POST /api/session/{sid}/permission/{rid}/reply {"decision":"once"} -> 204
permission.replied reply=once
session.tool.success content=[{text:"HELLO_HTTP_PROBE\n"}]
```

`Permission.Reply` enum: `once | always | reject`. This is the seam DSH needs to map its own
approval policy onto OpenCode tool calls (both allow/deny and persisted `save` rules).

## 4. Model variants (reasoning levels)

`POST /api/session/{id}/model {"model":{"providerID":"opencode-go","id":"deepseek-v4.1-flash","variant":"high"}}`
→ **204**, `GET /api/session/{id}` shows `variant:"high"`, the next assistant message is recorded
with `model.variant:"high"` and answered `391` with a reasoning block. `GET /api/model` supplies
`limit.context` / `limit.output` and `variants[]` — the same source the CLI discovery already uses.

## 5. Lifecycle

```
opencode serve --hostname 127.0.0.1 --port 0
  stdout: server listening on http://127.0.0.1:44103
          server password <43 chars>
GET /api/info (basic auth)       -> 200, version 2.2.0
prompt opencode/beam-free        -> "FRESHOK", tokens {input 2435, output 10, reasoning 16, cache.read 1728}
kill -TERM <pid>                 -> process exits
```

So DSH can own a server process exactly like it owns the CLI child today: spawn, parse banner, use
basic auth, terminate. Alternatively it can attach to the user's existing daemon through
`~/.local/state/opencode/service.json` (url + pid + password), which also shares sessions with the
CLI/TUI.

## 6. Large prompt (the defect that motivated this)

`POST /api/session/{id}/prompt {"text": <189,041 bytes>}` → **200**, outcome `succeeded`,
`tokens.input = 37,439`, text `BIGOK`. There is no single-argument limit on this path.

## 7. Account usage

`GET /api/experimental/usage/limits` (measured):

```json
{"workspace":{"name":"Personal","usageURL":"https://opencode.ai/console/…/activity/overview"},
 "go":{"rolling":{"percent":30,"limited":false,"resetsAt":…},
       "weekly":{"percent":28,"resetsAt":…},"monthly":{"percent":15,"resetsAt":…}},
 "budgets":[]}
```

This is the "사용량" surface the CLI adapter cannot see at all.

## 8. Gaps and risks (measured or directly implied)

| # | Finding | Consequence |
|---|---|---|
| 1 | `/api/event` is a **global** stream (only a `types` filter; no session filter) | the adapter must filter events by `data.sessionID`; measured 38 foreign events interleaved with 28 own events during one 3-turn probe |
| 2 | `Session.Info.outcome` is **sticky** (still `succeeded` while a new run starts) | wait on `session.execution.started`→`succeeded/failed/interrupted`, never poll `outcome` alone |
| 3 | no Last-Event-ID/resume parameter in the spec | on reconnect, recover via `GET /api/session/{id}/message` (returns full message list) |
| 4 | `interrupt` → `outcome:"interrupted"`; usage still lands in session tokens (measured input 1605/output 284 after a 3 s run), but the interrupted step may not emit a final `step.ended` | read session `tokens` after interrupt; accept a small accounting gap |
| 5 | two servers can run against the same data dir (measured: daemon + fresh serve both worked), but they share one SQLite DB (`opencode.db`, WAL) | prefer one server per data dir: attach to the daemon, or give DSH a dedicated data dir and validate |
| 6 | `client-mcp` bridge exists (`GET /api/experimental/client-mcp?name=…&ticket=…`, `POST …/token`, `POST /api/pair` → 5-min code) but a token request with the pairing code returned **403** | DSH-injected tools via MCP are **not confirmed**; OpenCode's own tools still work with the permission bridge |
| 7 | API version is `HttpApi 0.0.1` (experimental paths under `/api/experimental/*`) | pin OpenCode version, feature-detect with `/api/info` and the OpenAPI document |
| 8 | two compaction systems would coexist: DSH `compaction-basic` and `POST /api/session/{id}/compact` | pick one owner per route; `session.compaction.*` events exist if OpenCode owns it |

## 9. Integration shape for a DSH adapter

1. **Server manager** — attach to `~/.local/state/opencode/service.json` if alive, else spawn
   `serve --port 0`, parse the banner, verify `/api/info`, own shutdown (SIGTERM).
2. **Model catalog** — `/api/model` → `limit.context`/`limit.output` + `variants[]` (reuse the
   existing `modelsFromApiPayload` mapping).
3. **Session map** — DSH session id ↔ OpenCode `session.id` (`POST /api/session` with
   `location.directory`, `model`, `permissions`); persist the mapping in session metadata.
4. **Stream** — `POST …/prompt`, then consume `/api/event?types=session.text.delta&…`, filter by
   `sessionID`, map `text.delta`→`text-delta`, `reasoning.delta`→`reasoning-delta`,
   `step.ended`→`usage`+`finish`; `execution.failed`→error finish; `interrupt` on abort.
5. **Permissions** — `permission.asked` → DSH approval/decision → `reply {once|always|reject}`.
6. **Usage** — `step.ended.tokens` per step + `session.usage.updated` cumulative; optionally surface
   `/api/experimental/usage/limits` as an account-usage panel.
7. **Compaction** — either disable `compaction-basic` for this route and call `/compact`, or keep DSH
   compaction and never call it.

## 10. What this enables beyond the current CLI wrapper

- no argv ceiling and no full-transcript retransmission (session continuity + prefix cache reuse);
- exact per-step usage/cache/cost (no `session export` second process);
- DSH-driven permissions, abort, compaction, model/variant switch, fork/revert;
- account usage/limits endpoint;
- a plausible "host controller": multiple `serve` instances each exposing `url`/`password`/`/api/info`
  could be driven from one DSH controller (no such DSH feature exists today).

## 11. PoC result (v0.2.0, `dsh-opencode-v2/lib/http.js`)

`opencode-http-agent` is implemented as a second `LlmAdapter` in the same package; the CLI route
stays the default. Measured with 15 unit tests (fake server) and an A/B against the CLI route in a
real `LlmRuntime` with the real CLI/server (`opencode/beam-free`, one DSH `sessionId`):

| Metric | CLI route | HTTP route |
|---|---|---|
| contextWindow | 32,768 (discovery off) | 1,048,576 |
| turn 1 first token | 1,581 ms | 946 ms |
| turn 1 input tokens | 2,541 | 45 |
| turn 2 wall / input | 1,002 ms / 66 | 739 ms / 2 |
| abort | child kill | `OPENCODE_INTERRUPTED` after 1.5 s |

Isolated mount (`DSH_HOME=/tmp/opencode/http-poc`, port 39321): the composed config contains the
`dsh-opencode-v2-http` insert row and the boot log has zero activation warnings. Operator notes:
a patch that adds a row needs `- insert:`, and a profile must not also mount
`@quonaro/dsh-plugin-opencode` (duplicate `opencode` tool / `opencode-agent` adapter).
Details and exact commands: `dsh-opencode-v2/VERIFICATION.md` §14.

## 12. Protocol compatibility ("Claude extension protocol")

Measured against the installed trees; the protocol DSH exposes for editor/agent integration is
**ACP (Agent Client Protocol) v1**, not MCP.

| Pairing | Verdict | Reason |
|---|---|---|
| DSH ACP ↔ `opencode acp` | **role collision** | both are ACP **servers** over stdio; DSH ships no ACP client (only `dsh-acp`/`dsh-acp-app`) and OpenCode exposes no ACP-over-HTTP path |
| DSH MCP-client ↔ OpenCode MCP-server | **incompatible** | OpenCode is MCP **client-only** (130 HTTP paths, no MCP-server surface); `client-mcp` is the inverse direction (the peer hosts tools for OpenCode) |
| DSH SDK/Typert protocols ↔ OpenCode HTTP | **incompatible** | DSH-private NDJSON/Typert RPC vs OpenAPI 3.1 + SSE |

**Alternative chosen:** the HTTP v2 adapter in §11 (OpenAPI session/prompt/event/permission).
If tools must flow *into* OpenCode, a DSH-side MCP **server** shim registered in OpenCode's `mcp`
config is the missing piece; DSH currently ships only an MCP client.

## 13. Orchestration fit (Lead → subagent team → per-model routes)

- DSH already owns orchestration: the `subagent` tool accepts `provider`/`model`/
  `reasoning_effort` per child (`dsh-tool-subagent/lib/index.js:394-407`) and enforces the session
  `allowedModels` policy; `workflow` `agent(prompt,{provider,model})` fans out and bypasses the
  allowlist; `spawn_teammate` has **no** model parameter (inherits the Lead's route).
- An HTTP route is just another `(provider, model)` string; the loop stamps
  `GenerateOptions.sessionId`, so one route per child maps cleanly to one OpenCode session.
- Heterogeneous teams therefore need no new orchestration code — add `opencode-http-agent` routes
  to the profile and to `allowedModels`, then the Lead can assign different models per subagent.
- OpenCode's own `/api/agent` roster is redundant for this design (DSH owns roles); the useful
  server surfaces are session/model binding, SSE, permissions and usage.
- Blockers to keep in mind: two histories (delta sync implemented for the PoC), two compactors
  (pick one owner per route), tool execution stays inside OpenCode unless a permission bridge is
  wired, and the global SSE stream must be demultiplexed by `sessionID`.

## 14. Post-restart symptom and fix (v0.2.1)

After the live restart the provider appeared but listed no models. Measured cause: the OpenCode
`serve --service` daemon is spawned on demand by the CLI and dies with its parent (the old daemon
was gone; the next one started at 12:20:11, five minutes after the host booted at 12:15:06), and
the `dsh-web.service` PATH has no `~/.bun/bin`, so the spawn fallback could not resolve the bare
`opencode` name. The adapter therefore degraded to the `default` pseudo-route with no message.

Fixed by verifying the endpoint with `/api/info` before attaching, falling back to a spawned
server, pinning `opencodePath` to the absolute binary in the profile, retrying once when an
attached daemon disappears, and throwing a provider failure (instead of an empty list) when the
catalog cannot be fetched. With a daemon absent the route now lists all 46 routes by owning its
own server. Details: `dsh-opencode-v2/VERIFICATION.md` §15.
