# OpenCode 2.2.0 → 2.2.6 delta — what actually changed

<!-- skeleton:
version: 1.0
kind: measurement
status: measured
updated: 2026-11-07
summary: Full 2.2.0-to-2.2.6 upstream delta by surface, including five DB migrations, background-job persistence, schedules, artifacts, and measured limits.
-->

> This document corrects an earlier, too-narrow summary that treated the delta as
> “process leak only”. It is a **source-level inventory** from the exact `v2.2.0` and
> `v2.2.6` tags plus their release notes. It is not a claim that every upstream feature
> reaches DSH, because `@nolit/dsh-opencode-v2` uses OpenCode only as a control plane and
> its OpenAI-compatible model backend.

## 1. Scale of the delta

| Measure | 2.2.0 | 2.2.6 | Delta |
|---|---:|---:|---:|
| Files in the upstream tag tree | 9,961 | 12,340 | **+3,078** |
| DB migrations | 54 | 59 | **+5** |
| Commits in `v2.2.0...v2.2.6` | — | — | **835** |
| Released versions traversed | 2.2.0 | 2.2.6 | 6 releases |

The 835-commit compare object reports `diverged` because release branches are not linear;
`ahead_by: 835` is the number of commits reachable from 2.2.6 but not 2.2.0. It is a scale
indicator, not a promise that all 835 touch this plugin.

## 2. New files by area

Counted from added paths in the exact tag trees:

| Area | Added paths | What it indicates |
|---|---:|---|
| Claude Agent provider | 85 | A new first-class provider integration around the Claude Code login |
| Image generation | 23 | New image tool, multimodal protocol work |
| MCP | 18 | Connection pooling, auth, transport work |
| Background jobs | 17 | Persistent job model, job API, wait/recovery semantics |
| Schedules | 17 | Scheduled prompts and their checks/state |
| Goal mode | 17 | `/goal` continuation loop and reviewer |
| Artifacts | 12 | Publish/update/serve HTML/static artifacts |
| Session runtime | 8 | Runner, compaction, request/stream changes |
| HTTP API | 8 | New protocol groups and server handlers |
| CLI run | 0 added files | `run` was reworked in existing files, not a new module |

## 3. The five DB migrations — what they expand

This is the concrete answer to “DB migration means the internal schema grew, so what got
better?” The schema grew in **four capability areas**, and one of them directly changes
session storage efficiency.

| Migration | Schema change | Capability it enables |
|---|---|---|
| `20261026223005_schedule` | New `schedule` table + session FK + `schedule_due_idx` partial index | Durable scheduled prompts; the partial index makes only active due rows cheap to scan |
| `20261029002625_session_part` | New `session_part` table keyed by `(message_id, ordinal)` + `(session_id, message_id, ordinal)` index | Parts are stored as first-class rows instead of being re-parsed out of message blobs; enables ordered incremental part lookup and precise updates |
| `20261029073502_session_time_busy` | `session_v2.time_busy` column | Tracks actual busy time separately from wall-clock age; needed by background-job and session-list views |
| `20261029165540_schedule_checks` | `schedule.check`, `.checks`, `.failures`, `.state` | Scheduled runs can carry checks/results and a state machine, not just fire blindly |
| `20261030054400_job` | New `job` table + `session`, `child_session`, `id` indexes; one-time migration of `kv` rows matching `job.background/%`, then deletes those KV rows | Durable background jobs with output/error/recovery, instead of JSON blobs in generic `kv` |

### Why this matters beyond “schema changed”

- **Query shape:** `session_part` replaces an opaque message payload with indexed ordered
  parts. That is the storage-level basis for resuming, rendering, and updating one part
  without rewriting a whole message.
- **Collection cleanup:** the `job` migration selects structured columns out of
  `kv` values and then deletes the moved rows. Repeated JSON reads and unbounded KV growth
  become indexed SQL queries.
- **Cheap active work:** the partial index on `schedule_due_idx` indexes only
  `status = 'active' AND next_due_at IS NOT NULL`, so due-work lookup does not scan history.
- **Busy-time accounting:** `time_busy` separates “time actually spent working” from
  “session exists since then”, which is a prerequisite for reliable job and schedule
  accounting.

These are capability/efficiency expansions at the storage layer. They do **not** by
themselves make the DSH adapter faster, because the adapter streams generations directly
and does not use OpenCode schedules, jobs, or session parts for its data plane.

## 4. Feature delta by release

### 2.2.1

- `/goal <objective>` with pause/resume/clear and reviewer-driven continuation.
- Opt-in scheduled prompts (`/schedule`, agent tools, `experimental.schedules`).
- Opt-in `image_generate` tool.
- New default model picker in Desktop.
- Snapshot performance work: coalesced captures and avoided repeated ignore-file work.
- Context headroom preserved when fitting tool output.
- Provider throttling retries no longer misreported as context overflow.

### 2.2.2

- Image generation enabled by default when an image-capable provider is connected.
- Session execution start time recorded.
- Faster worktree selection and unified quote/annotation editing.
- Media preserved across session fork/import.

### 2.2.3

- Claude Agent provider using a local Claude Code login.
- Long-session Desktop rendering performance work.
- Managed policy split into `mcp.use`, `skill.use`, `plugin.use`.
- TUI plugin OpenTUI 0.8 requirement (breaking for TUI plugins, not this DSH plugin).

### 2.2.4

- Persistent session PTYs with scrollback across restarts.
- Opt-in artifacts (`artifact_create/read/update/delete`).
- Schedules coordinated across multiple servers so each fires once.
- Provider/remote config can override Console-supplied provider metadata.
- Local service requests kept out of environment-configured proxies.
- Repeated streaming Markdown work reduced.

### 2.2.5

- `compaction.buffer` accepts a percentage of the model context window.
- Compaction prompt capped at the model context window.
- LiteLLM context-window errors trigger compaction instead of ending the session.
- Reasoning no longer converted to plain text across model switches/resumes.
- Tool named `bash` runs as `shell`; plugin tool `bash` still wins.
- Large MCP stdio messages no longer disconnect at 10 MiB.

### 2.2.6

- MCP connection pooling (`pool: true`).
- `run --archived` for scripted/CI sessions.
- `run --worktree/-w`.
- Session warming per provider/model, including cache-TTL-based `auto`.
- Noninteractive `run` lifecycle rework: waits for background jobs, SIGTERM cancels the
  session and jobs, exit 143.
- `/api/*` cross-site request refusal and sandboxed file/media responses.
- GUI plugin themes and new slots.

## 5. What reaches this plugin

`@nolit/dsh-opencode-v2` has three paths, and they consume OpenCode differently:

| Plugin path | Uses OpenCode for | Relevant 2.2.0→2.2.6 delta |
|---|---|---|
| `opencode-http-agent` route | `/api/info`, `/api/model`, `/api/provider/{id}`, `/api/credential`; model calls go directly to the OpenAI-compatible backend | Catalog/provider/credential shape, plus the `/api/*` security change. Sessions, jobs, schedules, artifacts and session parts are **not** used |
| `opencode` tool / `subagent_opencode` | `opencode run --format json` over stdio | NDJSON event shape, `run` lifecycle, new optional flags not emitted by the plugin |
| `cli_worker` | `opencode run --format json --thinking --auto --standalone` | Same, plus background-job wait and SIGTERM behavior |

Consequences measured or inferred from source:

- **No compatibility break found** in the control-plane shapes or NDJSON parser.
- **Potential reliability gain** for tool/worker runs from the reworked noninteractive
  lifecycle. Not reproduced as a fix for a specific observed DSH failure.
- **No direct efficiency gain** for the HTTP route from the new DB schema. The route does
  not read OpenCode session storage.
- **`--archived` is available but unused.** It could reduce session-list noise for scripted
  workers, but emitting it would be a plugin change, not part of this cleanup.
- **Background-job waiting can extend a run.** The plugin's timeouts remain the containment
  mechanism; the interaction was not exercised.

## 6. Honest limits

- The 2.2.6 binary was measured before cleanup; its `/tmp` artifact has since been removed.
- A successful adapter generation against 2.2.6 was not measured because the free route
  returned HTTP 429 `FreeUsageLimitError`.
- The 5 migrations were read from the exact `v2.2.6` tag and exercised only indirectly by
  opening a copied live DB with the 2.2.6 server.
- The efficiency claims in §3 are schema-level and code-level facts. No benchmark of the
  DSH adapter against 2.2.0 and 2.2.6 was run.
