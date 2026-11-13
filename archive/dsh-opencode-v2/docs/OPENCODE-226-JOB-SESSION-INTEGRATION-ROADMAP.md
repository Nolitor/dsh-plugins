# OpenCode 2.2.6 job/session integration roadmap

<!-- skeleton:
version: 1.0
kind: design
status: draft
updated: 2026-11-07
summary: Planned, read-only-derived integration options for OpenCode 2.2.6 session_part/job APIs with @nolit/dsh-opencode-v2, with efficiency hypotheses and measurement gates.
-->

> Planning only. No plugin code, config, live profile, DB, or service was changed for this
> document. Every API shape below was read from the exact `v2.2.6` tag; every plugin
> attachment point was read from the current source. Expected gains are hypotheses with
> named measurements, not results.

## 1. Why this exists

The first compatibility pass answered “does 2.2.6 break the current contract?”. It did not
answer “what new work does 2.2.6 make possible?”. This roadmap covers the second question.

The 2.2.6 schema/API additions relevant to this plugin:

| Addition | Exact surface | Status |
|---|---|---|
| Durable background jobs | `GET /api/experimental/job` with `sessionID`, `kind`, `status`, `descendants` filters; `Job.Info` rows with `status`, `output`, `error`, `recovery` | Experimental upstream |
| Ordered session parts | `session_part` table keyed by `(message_id, ordinal)`, indexed by `(session_id, message_id, ordinal)` | Storage layer |
| Session export | `GET /api/experimental/session/:sessionID/export` | Experimental upstream |
| Session wait | `POST /api/experimental/session/:sessionID/wait` | Experimental upstream |
| Session stats | `GET /api/experimental/session/stats` | Experimental upstream |

Upstream marks the HTTP endpoints “Experimental: may change without compatibility
guarantees.” That is the central design constraint: any integration must degrade to the
current behavior when the endpoint is absent or its schema changes.

## 2. Current plugin attachment points

Read from the current source, not proposed modules:

| Point | File | Current behavior | New 2.2.6 input it could consume |
|---|---|---|---|
| Control-plane client | `lib/http.js` `ServerManager.request()` | authenticated `GET` to `/api/info`, `/api/model`, `/api/provider/*`, `/api/credential` | `/api/experimental/job`, `/api/experimental/session/*` |
| Per-session cost ledger | `lib/http.js` `recordCost()` + `lib/cost.js` | records wire `usage.cost` per request | job-triggered or subagent-triggered spend not visible on the parent wire |
| CLI usage fetch | `lib/shared.js` `fetchUsage()` | spawns `opencode session export <sid>` and parses `info.tokens` | HTTP export removes a subprocess spawn |
| `opencode run` tool | `lib/index.js` `runOpencode()` | waits for child exit, then exports usage | `job.list` gives structured background-job state |
| `cli_worker` | `lib/workers/run.js` | one child, timeout, parse stdout | same |
| Subagent provider | `lib/subagent.js` | one isolated `opencode run` | same |

## 3. Integration options

### Option A — replace CLI `session export` spawn with HTTP export

**What:** in `fetchUsage()`, first call
`GET /api/experimental/session/:sessionID/export` through the already-authenticated
control plane; fall back to the current CLI spawn when unavailable.

**Why it may help:**

- removes one subprocess spawn per completed `opencode run` (tool, subagent, worker);
- removes the CLI's managed-service port coupling that blocked the earlier isolated
  `session export` measurement;
- reuses the existing `ServerManager` auth, timeout and retry path.

**Risk:** the endpoint is experimental and returns a projected transcript
(`PublicSessionTransfer`), not necessarily the identical `info.tokens` payload the CLI
export produced. The mapping must be pinned by fixture tests before replacing anything.

**Measurement:** count spawns per delegated run before/after; compare
`usageFromSessionExport()` output against a CLI export for the same session.

### Option B — attach background-job state to worker/subagent results

**What:** after `opencode run` exits, call
`GET /api/experimental/job?sessionID=<sid>&descendants=true` and attach a bounded summary
(kind, status, title, error) to the tool/worker result.

**Why it may help:**

- 2.2.6 makes `opencode run` wait for background jobs it started; the adapter currently
  only sees exit code and stdout;
- a timeout currently reports `timedOut` with no structured cause. Job rows can distinguish
  “model still working”, “shell job still running”, and “job errored”;
- `--archived` plus job status could keep scripted workers out of session lists.

**Risk:** job rows are “active and unconsumed”; a list call has its own cost and the
eligibility window is not yet measured. Do not poll; read once at exit.

**Measurement:** for a run that starts a long shell job, record exit time, job list shape,
and whether the status explains the wait. Compare against current stderr-only diagnosis.

### Option C — use session parts for cheaper transcript reconstruction

**What:** the adapter does **not** currently read OpenCode session parts for the HTTP
route; it owns the DSH transcript. This option is limited to the tool/worker path, where
the plugin currently re-parses cumulative NDJSON snapshots into text.

**Possibility:** after a run, fetch the ordered `session_part`-backed export and compare it
with the streamed result, then use the export only as a repair path when the stream ends
without a final text part.

**Why it may help:** ordered parts make “last complete part per message” recoverable
without re-reading a whole message blob. That is a repair/verification path, not a hot-path
optimization.

**Risk:** adding an export fetch to every run increases latency. The current stream parser
already assembles text. Use it only when the stream is truncated.

**Measurement:** truncated-stream fixture → recovered text equality; added latency when
the repair path is off.

### Option D — session stats for cost reconciliation

**What:** use `GET /api/experimental/session/stats` to reconcile the adapter's local cost
ledger with upstream usage for the same time range.

**Why it may help:** the local ledger only sees requests that went through this adapter.
Subagents and CLI children can spend outside that path.

**Risk:** stats are aggregate; attributing them to one DSH session may be impossible.
Only adopt if a session-scoped breakdown exists; otherwise keep this as a diagnostic.

**Measurement:** ledger total vs stats total for one controlled session; do not write a
reconciliation value unless the scopes match exactly.

### Option E — emit `--archived` for scripted runs

**What:** add `--archived` to the worker/subagent argv when the configured OpenCode version
supports it.

**Why it may help:** 2.2.6 documents that archived sessions stay out of inbox, home and
session lists and are skipped by `--continue`. That reduces session-list noise from
scripted runs, which is an operator-efficiency gain rather than a token gain.

**Risk:** version detection is required; 2.2.0 and 2.2.5 reject the flag. This becomes
safe only after 2.2.6 is the installed baseline.

**Measurement:** argv matrix by version; session-list entry count before/after.

## 4. Recommended order

| Phase | Work | Gate before starting | Expected benefit | Risk |
|---|---|---|---|---|
| P0 | Install 2.2.6 and run the existing suite + real mount | owner approval, DB backup | establishes the baseline | schema migration |
| P1 | Option E (`--archived`) behind a version gate | P0 verified | session-list hygiene | low |
| P2 | Option B (job summary on worker/subagent result) | real background-job fixture | better timeout diagnosis | medium |
| P3 | Option A (HTTP export, CLI fallback) | export payload equivalence | one fewer spawn per run | medium |
| P4 | Option C (repair path only) | truncated-stream fixture | stream repair | medium |
| P5 | Option D (stats reconciliation) | session-scoped stats proven | cost attribution | high/unknown |

Do not start P2–P5 while the endpoints remain experimental and unexercised on this host.
The earlier 2.2.6 session-export attempt failed on the live service port, and a successful
adapter generation was blocked by HTTP 429. Those are prerequisites, not optional checks.

## 5. What must be measured first

1. **Job payload fixture:** one real run that leaves a background shell job, captured from
   `/api/experimental/job` with no secrets.
2. **Export equivalence:** CLI `session export` vs HTTP export for the same session,
   field-by-field on `info.tokens` and final text.
3. **Endpoint availability by version:** 2.2.0, 2.2.5, 2.2.6 responses for the four
   experimental endpoints.
4. **Cost of the calls:** latency and bytes for job list/export on a representative session.
5. **Failure behavior:** what each endpoint returns when the session is unknown, the job
   list is empty, or the feature flag is off.

Until 1–3 exist, no code change should claim an efficiency gain.

## 6. Non-goals

- Do not replace the DSH-owned conversation loop with OpenCode sessions.
- Do not make generation travel through `/api/session/*/prompt`.
- Do not poll jobs in the background.
- Do not require experimental endpoints for the adapter to work.
- Do not add a second package or a second provider registration.

## 7. Source record

| Claim | Artifact |
|---|---|
| Job endpoint shape | `v2.2.6` `packages/protocol/src/groups/job.ts` |
| Job handler filters | `v2.2.6` `packages/server/src/handlers/job.ts` |
| Job table/indexes | `v2.2.6` `packages/core/src/job/sql.ts`, migration `20261030054400_job.ts` |
| Session export/wait/stats | `v2.2.6` `packages/protocol/src/groups/session.ts` |
| Session part table | `v2.2.6` migration `20261029002625_session_part.ts` |
| Plugin attachment points | current `lib/http.js`, `lib/shared.js`, `lib/index.js`, `lib/workers/run.js`, `lib/subagent.js` |
| 2.2.6 compatibility evidence | [OPENCODE-226-COMPATIBILITY-MEASUREMENT.md](OPENCODE-226-COMPATIBILITY-MEASUREMENT.md) |
| Full version delta | [OPENCODE-220-TO-226-DELTA.md](OPENCODE-220-TO-226-DELTA.md) |
