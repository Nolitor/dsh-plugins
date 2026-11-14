# DSH bridge architecture

<!-- skeleton:
version: 1.5
kind: spec
status: active
updated: 2026-11-15
summary: Measured DSH 0.2.2 extension points, per-event lifecycle contract, tool-mask semantics, the 2026-11-14 subagent split (engine path root-only, memory path everywhere), the 2026-11-15 module map with the plugin-record attribution layer and the project-identity anchor, the agent/pre-step tiering trigger, the deprecated-read posture and the SessionSurface constraint, DSH trace reader schema, prior-session recall through the harness FTS5 service, the observe/apply mode split, host-local in-memory features, tiered memory, state and ledger formats, and verified limits.
-->

## 1. Isolation boundary

Two processes, one direction of trust.

| Half | Runs as | Owns | Never does |
|---|---|---|---|
| `@nolit/dsh-tokeneconomizer` (Node) | a Cordis plugin inside the DSH Host | lifecycle translation, DSH levers, session export | read TokenEconomizer state files directly, call a model, edit repository config |
| `tokeneconomizer` (Python ≥ 3.10, stdlib only) | a child process per hook, and detached folds | evidence, mechanism state, ledger, side calls through `dsh` | import a DSH package, or write a DSH session |

Both halves are reached with `child_process` only: this package imports nothing outside `node:`
builtins, so its peer dependencies (and their unpublished prerelease versions) cannot block a
profile install. The boundary is JSON on stdin/stdout:

```
DSH Host ── payload ──► te-hook --host dsh ──► tokeneconomizer.plugin.hook
         ◄─ hook object ─┘
DSH Host ── argv ─────► te dsh-session | dsh-import | status --json
```

The upstream engine is not forked into this package. `scripts/bootstrap.mjs` clones the pinned
commit `6141bb9251a7d5cccc1b97ae340c7b872108292c`, applies
`patch/0001-add-dsh-host.patch`, and writes two launchers under the TokenEconomizer state root.
The patch adds exactly what the engine's own architecture reserves for a new agent
(`docs/ARCHITECTURE.md` upstream: "A new agent needs a reader here and nothing else"):

| File | Addition |
|---|---|
| `tokeneconomizer/trace/dsh.py` | the DSH session reader (new) |
| `tokeneconomizer/trace/__init__.py` | exports it |
| `tokeneconomizer/plugin/hosts.py` | `DSH` host adapter, `HOSTS['dsh']`, `TE_DSH=1` default |
| `tokeneconomizer/plugin/sidecall.py` | `dsh_call()` through `dsh --profile headless --json` |
| `tokeneconomizer/plugin/context.py` | `toolprune=auto` reads as `propose` on `dsh` |
| `tokeneconomizer/plugin/denylist.py` | DSH has no settings file: no write, no fallback to Claude's path |
| `tokeneconomizer/plugin/cli.py` | `dsh-session` (session brief + catalog) and `dsh-import` (cold start) |
| `tests/test_dsh_trace.py` | reader tests (4, stdlib `unittest`) |

External model calls exist in both halves and are separate by design: micro-skills' proposer and
the loop guard's judge run inside the Python engine, through the person's own `dsh` headless
profile, and are charged to the session ledger. The Node plugin never calls a model.

## 2. Measured DSH 0.2.2 extension points

Read from the installed `@deepseek-ai/dsh@0.2.2-rc.3` type declarations (measured 2026-11-14; the
seams below were first measured against `0.2.2-alpha.2` on 2026-10-29):

| Need | API | File |
|---|---|---|
| agent created (with start source) | `agent/created` `{ agent, source, signal }`, serial and awaited | `dsh-agent` |
| agent gone | `agent/disposed` `{ agent }` | `dsh-agent` |
| turn boundaries | `session/event` carrying `turn/start`, `turn/end`, `user/message` | `dsh-session` |
| tool outcomes | `tools/result` `(exec, result)`, emit, scope-filtered by agent | `dsh-tools` |
| tool mask | `tools.restrict({ deny })`, calling scope, returns disposer | `dsh-tools` |
| prompt context | `systemPrompt.context({ name, order, text, required })` | `dsh-system-prompt` |
| mid-turn context | `agent.inject(UserMessage)` for the next pre-step | `dsh-agent` |
| user message factory | `createUserMessage({ content, source })` | `dsh-llm` |

`tools/restrict` documents: "Empty filters, unknown names, scope-local names, and reserved
transport names fail." The plugin therefore intersects the proposal with
`ctx.tools.definitions()` before calling it, so a proposal naming a tool this composition does not
register cannot fail the agent's scope.

`systemPrompt.context` documents: "Dynamic model context materialized as a durable user-role
snapshot." The facts become one durable snapshot, not a rewritten system section, and stay
byte-identical for the session: the render is frozen at `agent/created`, so a later fold cannot
change a running conversation's cached prefix.

## 2a. Module map as delivered

Measured line counts, 2026-11-15. The map replaces the older inline description of the package
layout; [README.md](../README.md) carries the same list in short form.

| Module | Lines | Role |
|---|---|---|
| `lib/index.js` | 1699 | the Cordis plugin: the DSH lifecycle mapping |
| `lib/identity.js` | 314 | project identity: `projectDir` (immutable, from the session header) vs `liveDir` (from `working-directory/change`); `resolveIdentity`, `readIdentity`, `writeIdentity`, `adoptLegacyKey`, `IDENTITY_SCHEMA_VERSION = 1` |
| `lib/repokey-bridge.js` | 37 | the legacy engine repository key, used only by the adoption procedure; **UNVERIFIABLE** against the engine |
| `lib/probes.js` | 404 | capability-probe catalog — 7 seams, contract-tier vs internal-tier, `probeFn`, `probeCtx`, `probeSessionAppendOverload`, `probeAll`, `SEAM_CATALOG` |
| `lib/attribution.js` | 220 | the record layer: `appendRecord`, `readRecords`, `recordsOfType`, `validateRecord`, `RECORD_NAMES` |
| `lib/rewriter.js` | 295 | surface composition: `validateRewriteTarget`, `buildReplacement`, `buildPrunePayload`, `composeRewrite` |
| `lib/surface-attribution.js` | 248 | the paired write: `applyRewrite` — validate → `tier-decision` record → `compaction/prune` → `tool/result`+`surfaceOp` → `surface-rewrite` record |
| `lib/settings-contract.js` | 69 | browser-safe frozen contract data (zero imports) |
| `lib/settings-api.js` | 691 | the six settings routes |
| `lib/tiering.js` | 551 | the retention policy, the trigger choice, the decision records |
| `lib/bridge.js` | 282 | the process boundary: `te-hook`, `dsh-session`, `dsh-import`, exports |
| `lib/repokey.js` | 238 | host-local: `cwd` to the engine's repository key, in pure Node |
| `lib/dedup.js` | 83 | host-local: tool-result hash deduplication |
| `lib/prefix.js` | 88 | host-local: the KV-cache-safe prompt slot, its routing text and its guard |
| `lib/watchdog.js` | 302 | host-local: the loop breaker and the advisory thinking watchdog |
| `lib/devstats.js` | 605 | the per-turn/per-step fold of the committed session ledger |
| `lib/devstats-server.js` | 265 | the read-only host route behind the statistics card |
| `lib/settings.js` | 169 | the external settings file, merged on top of the Cordis config |
| `lib/client.js` | 1166 | the Web half: the two `settings.section` seats |
| `lib/interrupt-bridge.js` | 184 | the shared interrupt registry the watchdog attributes through |
| `lib/types/records.d.ts` | 80 | `PluginRecordMap` augmentation |
| `bin/te-dsh.mjs` | 603 | operator commands: bootstrap, cold-start, purge, status, doctor |
| `scripts/audit-deprecations.mjs` | 327 | the deprecation gate (exit 0/1/2) |
| `scripts/check-syntax.mjs` | 62 | walks `lib/`, `bin/`, `scripts/` instead of a hardcoded file list |
| `scripts/bootstrap.mjs` | 238 | pinned clone + patch + launchers + verification + bounded migration |

The full delivery record — what each module was built for, and what was deliberately not wired in —
is in [DSH-SCHEMA-IMPLEMENTATION.md](DSH-SCHEMA-IMPLEMENTATION.md).

## 3. Lifecycle contract

| DSH event | TokenEconomizer event | Payload beyond `session_id`/`cwd` | Answer applied as |
|---|---|---|---|
| `agent/created` (`startup`) | `SessionStart` | `source`, `transcript_path` (resume only) | `systemPrompt.context`, `tools.restrict`, notices |
| `agent/created` (`resume`) | `SessionStart` | `source: resume` | contexts re-registered for the new scope |
| `turn/start` | `UserPromptSubmit` | `prompt_id = <session>:<turn>`, `prompt` | opens one guard turn |
| `tools/result` | `PostToolUse` | `tool_name`, `tool_input`, `tool_use_id`, `tool_response` | redirect → `agent.inject` |
| `turn/end` | `Stop` | `prompt_id`, `stop_hook_active: false` | ended-green envelope; export |
| `agent/disposed` | `SessionEnd` | `reason: "disposed"`, `transcript_path` | detached `te fold` |

Every row of that table is the **engine path**, and the engine path runs in root sessions only —
see §3.1 for the split and for what a subagent child does get instead.

`tool_response` is `{ content, isError, exit_code? }`: `content` is the joined text blocks,
`isError` is the tool result's own flag, and `exit_code` is read from the rendered `[exit code: N]`
line DSH's `bash` appends. The guard's ended-green proxy uses the status when present and its
error-text detector when not — the same split as the Copilot and Claude Code hosts.

### 3.1 Subagent sessions: the engine path is root-only, the memory path is not

A subagent session is one whose `session.header.origin === 'subagent'`. Since 2026-11-14 the
plugin splits behind that marker into **two paths of different kinds**, and only one of them is
root-only.

| Path | What it is | Root only? |
|---|---|---|
| **Engine path** | `SessionStart` / `UserPromptSubmit` / `PostToolUse` / `Stop` / `SessionEnd` hooks, the Python engine behind them, the session export and its fold, the ledger | **yes** |
| **Memory path** | tool-result dedup, tiering, loop breaker, thinking watchdog, prefix guard, pinned section | **no — it runs in every session** |

**Why the engine path stays root-only.** A delegated child is folded with its parent's work, so
giving it its own envelope would teach the guard a turn scale that no person runs, and a second
`PostToolUse` stream would record the same tool call twice. A child therefore makes **zero**
engine calls and writes **no** export file: `writeSession()` returns `''` for it, and
`finish()` drops its state without a `SessionEnd` hook. A separate child transcript under
`dsh-sessions/` would make the fold count the child's turns twice.

**Why the memory path runs everywhere.** A child burns the same model context, calls the same
tools, and produces the same repeated or stale tool output as a root session — and **its bill
lands on the parent**. Not mounting the memory levers in a child does not save the parent's
tokens; it only removes the parent's ability to see them. These levers make no engine call and
write no state: `node:` builtins and timers only.

The `subagentMemory` config key selects this. It defaults to `true`, so a child gets the memory
path and nothing else. Set it to `false` to restore the old "a subagent has no economy of its
own" behaviour: a child then mounts no state and no listeners at all. The key is declared in
`lib/index.js` `DEFAULTS` and in `cordis.patch.yml`.

The measured motive for the change: of the last 333 session logs, **201 (60%)** were subagents,
so the previous blanket early return left more than half of all sessions with no saving lever at
all. The correction is recorded in [AUDIT-2026-11-14.md](AUDIT-2026-11-14.md) §10.

One more consequence of the split: the developer-statistics surface must not count a child as a
sibling of its parent, so `rootSessionsView()` (`lib/index.js`) hands the devstats route a view
that exposes only the root sessions. The child still lives in the real session map and still gets
every memory lever; it is only hidden from the camera.

## 3.2 The attribution record layer

The harness's own `dsh-compaction-tool-result-pruner` writes exactly the same `compaction/prune`
payload and the same `tool/result` replacement with `surfaceOp: { op: 'replace', … }` that this
plugin writes, and `compaction/prune` carries **no producer field**. On the log alone the two are
indistinguishable — and a measurement once credited the harness's 179 rewrites to this plugin.

The fix is a side channel: every write this plugin performs is accompanied by a DSH-native plugin
record under the `plugin:tokeneconomizer/` namespace.

| Record type | Payload |
|---|---|
| `surface-rewrite` | `{ nodeSeq, tier, charsBefore, charsAfter, shadowTokens, reason }` |
| `tier-decision` | `{ nodeSeq, tier, turn, step, policyHash, reason }` |
| `toolprune-applied` | `{ tools, countBefore, countAfter, visibleIntersection, proposalId?, repoKey, time }` |

Three properties make a record the right carrier rather than a new event type:

- a record is `ignorable` and **never enters the model-visible surface**, so it costs **zero
  tokens** — an attribution trail that spent the tokens the plugin saves would be self-defeating;
- a record survives **fork and resume** with the rest of the log;
- the plugin **event space is closed** — the harness owns the event type grammar, so a plugin-owned
  event type is a hard mount failure the moment that grammar tightens.

**`Session` has no `appendPluginRecord` method.** The record API is a *module export*,
`appendPluginRecord(session, type, data)`, resolved through the ctx service surface
(`ctx.get('session')`) — the same lookup `lib/probes.js` already performs, so no harness package
is imported and the package keeps its zero runtime imports outside `node:` builtins.

`applyRewrite` (`lib/surface-attribution.js`) fixes the write order, and the order *is* the failure
policy: validate → `tier-decision` record → `compaction/prune` → `tool/result`+`surfaceOp` →
`surface-rewrite` record. A record failure never corrupts or undoes the replacement and never
retries it; a replacement failure returns before any record claims it. The one exception is
deliberate: a *validation* failure still writes the `tier-decision` record, because a decision that
produced no rewrite is a measurement fact, not a failure to hide.

## 3.3 The tiering trigger moved to `agent/pre-step`

Tiering used to ride on `agent/request`, which upstream has deprecated ("retained for existing
listeners; do not add new listeners"). It now runs on **`agent/pre-step`**, with a `session/event`
(`step/start`) fallback. `chooseTrigger()` never returns `agent/request` — not even when it is the
only hook the probe reports.

**The honest consequence.** `agent/request` ran *after* request assembly and `step/start`, before
the system prompt and the accepted user batch were committed. `agent/pre-step` runs at *step
preparation*, before request assembly. A rewrite triggered from `agent/pre-step` may therefore land
**one step later** than it would have on `agent/request`. It still saves tokens on every subsequent
step of the turn. The delay is a real cost and is stated rather than hidden.

## 3.4 Deprecated-read posture

| Site | Status |
|---|---|
| `lib/index.js:928` | **migrated** → `session.seq > 0` |
| `lib/index.js:1047`, `:1091` | keeps `session.eventAt` — **no replacement exists in 0.2.2-rc.3** |
| `lib/index.js:1589` | keeps `session.snapshotEvents` — needs the full durable log including shadowed events |
| `deriveMessages` | **not deprecated** — untouched |

`scripts/audit-deprecations.mjs` carries `allowDeprecated: true` for the two seams that keep a
deprecated read, **with a printed justification**, and the FAIL branch still bites for any seam that
is not on the allow list. Exit codes: `0` all present and none newly deprecated, `1` a seam missing
or deprecated without acknowledgement, `2` the DSH install root cannot be found.

This mirrors upstream's own stance rather than a stricter one: **22** `.eventAt(...)` call sites
across the installed `@deepseek-ai/dsh` packages are annotated
`// Existing Session history read; migration deferred.`, and `dsh-compaction-basic` — upstream's own
compactor — keeps live `eventAt` calls marked exactly that way. The deprecation's referenced Agent
Note (`.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md`)
is **not shipped in the install**, so the migration plan it may carry is **UNVERIFIABLE** from this
host.

## 3.5 The `SessionSurface` constraint

`session.surface.readEvent` **does not exist**. Measured against the installed
`@deepseek-ai/dsh-session/lib/types/surface.d.ts`, `SessionSurface` exposes exactly three members:

| Member | Meaning |
|---|---|
| `nodes` | current surface event sequences, in model-visible order — **sequence numbers only** |
| `replaceGeneration` | monotonic count of committed positional replacements |
| `contentGeneration` | monotonic count of committed replacements and plugin-owned message changes |

Any design that assumed an event-body read through the surface was wrong: **a caller must supply
the event or a reader**. The plugin does exactly that — `lib/rewriter.js` takes the event (or a
`readEvent` callback) as an input, and `lib/index.js` supplies
`readEvent: (probeSeq) => session.eventAt(probeSeq)` at the one site that still uses the deprecated
reader. `surface.nodes` being a sequence-number view is also why the **full durable log** (shadowed
events included) is unreachable from the surface alone, and why `session.snapshotEvents` has to
stay at `lib/index.js:1589`.

## 4. Tool-mask semantics

Evidence pruning is the engine's (`toolprune.ToolingStage`, run by the fold). The DSH lever is a
runtime restriction, so:

- the proposal is read from `te dsh-session` once, at `agent/created`;
- only names the composition registers are requested;
- the restriction is registered on `agent.ctx`, so it covers this agent and disappears with it;
- no file is written, no other agent's configuration is touched, and `toolprune restore` is
  unnecessary — unloading the plugin lifts every restriction.

The catalog the evidence needs is pushed by the same call: `te dsh-session --tools a,b,c` writes
`<state root>/hosts/dsh/catalog.json` when the list changes. Without it, evidence pruning would
only know the tools a session happened to call. `toolprune=auto` is read as `propose` on DSH by
`context.py`, so the engine never attempts a settings-file write for this host.

A tool removed this way is absent from the next step's declarations, not merely denied at call
time. A running step keeps the set it admitted, which is the same visibility rule every other host
follows.

## 5. DSH trace reader

`tokeneconomizer/trace/dsh.py` reads the decompressed export the plugin writes at each turn
boundary and at disposal: `$TOKENECONOMIZER_HOME/dsh-sessions/<session-id>.jsonl`. Line 1 is the
harness's `session` header, then one committed `SessionEvent` per line.

| Field the mechanisms need | Source |
|---|---|
| `tool_name` | `tool/call.data.name` |
| `status` | `tool/result.data.message.isError` (absent = success) |
| `arguments` | `tool/call.data.arguments` (raw JSON string, parsed by the reader) |
| `tokens` | `assistant/message.data.usage` → `inputTokens`, `cacheReadTokens`, `cacheWriteTokens`, `outputTokens` |
| prompt count | `user/message` whose `source.kind == "user"` |
| model | `assistant/message.data.message.source.model` |
| session directory | header `cwd` |

`dsh_session_usage` de-duplicates by assistant message id, because a resumed or compacted log can
repeat a request envelope. `dsh_session_to_claude` groups calls by `(turn, step)` and writes the
Claude Code envelope every mechanism already reads: one assistant line carrying text plus
`tool_use` blocks, one user line per `tool_result`.

Usage mapping is stated, not inferred: DSH reports `cacheReadTokens` and `cacheWriteTokens`
separately from `inputTokens`, so the four ledger fields map one to one. `reasoningTokens` is not
added to `outputTokens`, because the harness already reports it inside the provider's output total
when the provider supplies one.

## 6. State and ledger

Everything the engine knows lives under `$TOKENECONOMIZER_HOME` (default `~/.tokeneconomizer`),
created `0700` with `0600` files:

```
index.json, repos/<repo-key>/<host>/       repository identity and per-repository settings
  injection.json                           the rendered micro-skills block (cached render)
  untool.json                              tool-prune evidence, streaks, proposal
  envelope.json                            ended-green turn envelope for the loop guard
  sessions/<session-id>.json               one record per session (turns, nudges, transcript)
  ledger.jsonl                             one priced record per folded session
  events.jsonl                             every injection, redirect, still-stuck notice
hosts/dsh/catalog.json                     the tool catalog the plugin reports
dsh-sessions/<session-id>.jsonl            decompressed exports (this bridge's addition)
vendor/TokenEconomizer-<sha>/              the pinned, patched engine
bin/te, bin/te-hook                        the launchers
```

A ledger record is written by `fold.fold_session` and carries `repo`, `host`, `session_id`,
`turns`, `nudges`, `aborts`, `injected_chars`, `untool_applied`, `prompts`, `requests`,
`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`, `output_tokens`,
`effective_tokens`, `priced_by`, and `overhead` (`optimizer_tokens`, `spiral_judge_tokens`,
`spiral_nudge_writer_tokens`). DSH model ids are not in the engine's price table, so a DSH record
is priced on the labelled fallback curve: `priced_by: "fallback"`. The token counts are exact; the
effective-token weighting is an approximation until the id is added to `pricing.py`.

## 7. Fail-open guarantees

- A missing launcher, a nonzero exit, a timeout, or unparsable stdout answers `null`; the plugin
  then registers no context and no restriction, and the session proceeds.
- `TE_SIDECALL=1` and `TE_DISABLE=1` make the plugin inert, so a TokenEconomizer side call that
  itself boots DSH cannot recurse.
- Every engine call is bounded (`hookTimeoutMs` 8000, `cliTimeoutMs` 20000). A tool result never
  waits longer than the hook bound for a redirect.
- A hook exception becomes `{}` in the engine and one traceback in `errors.log`.
- The plugin edits no repository file: no `.claude`, no `.codex`, no `.dsh` inside the project.

## 8. Host-local, in-memory features

Four features do not use the engine: they need no evidence, no model call, and no storage. They
run in the Host process, in memory, with `node:crypto` and timers only. The full design is in
[IN_MEMORY_FEATURES.md](IN_MEMORY_FEATURES.md); the seams they occupy are listed here.

| Feature | Seam | Effect |
|---|---|---|
| tool-result dedup | `tools/post-execute` on the agent's scope | a repeated successful output is replaced by a pointer to the step that produced it |
| KV-cache-safe prefix slot | `systemPrompt.section()` on the agent's scope | the pinned rules live in the request's first message, and the committed system node is checked for a mid-session change |
| loop breaker and thinking watchdog | `agent.cancel()` and `agent.inject()` | consecutive identical failures stop the turn, and a step without progress trips a timer |
| tiered memory for tool outputs | a surface rewrite of the session (`compaction/prune` plus a replaced `tool/result`) | the newest turns keep full fidelity, the middle turns keep their structure, the old turns leave the model context and stay in the durable log |

Two properties keep them compatible with the engine-backed half:

* the pinned rules are a **section**, so they join the single system message; the learned facts
  stay a **context**, so they stay in the runtime-context snapshot, whose bytes never change
  inside a session;
* the tiered memory rewrites the session's **surface**, not its log: the original output stays
  in the log and is reachable through the session query, while the model context carries the
  summary or the pointer;
* every host-local injection is an `agent.inject()`, which appends to the tail of the transcript
  and never shifts the cached prefix.

The observers are registered in `agent/created`, before the first `await`, so the session's first
tool calls are observed. The engine's own hooks still run in their measured order: `SessionStart`
is delivered before any later hook of the session.

**All four run in every session, subagent children included** (§3.1). They are the memory path:
no engine call, no file write, `node:` builtins only. A child burns the same context and its
bill lands on the parent, so the levers must reach it; `subagentMemory: false` is the switch that
removes them from children.

## 8a. Prior-session recall: DSH owns the index

An earlier design would have built a second SQLite index of the session corpus. Measurement killed
it, and what replaced it reuses the harness:

- DSH already ships `@deepseek-ai/dsh-session-query-sqlite`, an FTS5 index of session history with
  `cwd` scoping, ranked ordering and cursor paging. Its derived database is closed to writers: a
  foreign table or a foreign `application_id` is rejected at open, and `busy_timeout` is `0`, so a
  second process gets `SQLITE_BUSY` immediately. It is a single-owner derived index.
- Its documents are one per indexed event, and it does **not** index compaction events,
  `system/message`, `session/title` or request envelopes.
- Indexing happens on the first search, not at boot; 36 sessions took 5.7 s cold and produced a
  47 MB database (≈1.3 MB per session).

So the plugin reads the service instead of the file. It never opens the database, never creates a
table, and never writes a row:

```
first genuine user/message of a session
  -> ctx.get('sessionQuery').searchSessions({ query, limit, eventFilters })
  -> keep hits whose cwd matches, or whose repository key matches (subdirectory sessions)
  -> one agent.inject() of at most recallMaxChars
```

`lib/repokey.js` supplies that repository key. It reproduces the engine's rule exactly — normalized
`origin` remote, else the real path of the main checkout, else the directory — with `node:fs` and
`node:crypto` and no git subprocess, and it is verified against the engine's own keys on disk.

Four constraints shape the recall:

| Constraint | Reason |
|---|---|
| once per session, on the first real prompt | approval notices and the plugin's own injections also arrive as `user/message`; searching with them recalls the wrong thing |
| `agent.inject()`, never the pinned section | the pinned section is part of the cached prefix; per-session text there would invalidate it |
| bounded by `recallLimit` and `recallMaxChars` | a recall that floods the context costs more than it saves |
| silent when search is disabled | the shipped base default mounts the index with `openAt: never`; this profile mounts it `openAt: startup` with an explicit path (see `profiles/web/cordis.patch.yml`), so a recall that cannot search is a normal case, not an error |

## 8b. `mode`: savings off without stopping the trace

`mode: observe` keeps every observer, every engine hook, the usage counters and the export, and
drops only the injection points (pinned section, micro-skills context, tool restriction, recall,
pointer substitution, loop-guard redirect, surface rewrite, watchdog injection and cancel). That
split lets a deployment turn the savings off for a while — or disable the bundle entirely and
re-enable it later — without losing the evidence a fold needs. The re-enable path is covered by the
migration guards in [OPERATIONS.md](OPERATIONS.md) §3.1.

## 9. What was verified, and what was not

Verified on 2026-10-29 (Linux, Node 24.22.1, Python 3):

- the patch applies to the pinned upstream clone and the launchers answer
  `te --host dsh status --json` as `host: dsh` (bootstrap output `verified: true`);
- five synthetic DSH sessions folded in order and produced the expected unused-tool proposal
  (`read`, `todo_write`, `web_search`) with `priced_by: fallback`;
- a real recorded DSH session (31 events) was decompressed and folded from the harness store:
  1 prompt, 2 requests, 39,986.9 effective tokens, model `muse-spark-1.3-contributor`;
- the hook dispatcher accepted `SessionStart` → `UserPromptSubmit` → `PostToolUse` → `Stop` →
  `SessionEnd` for host `dsh`; `SessionStart` returned the pending-proposal notice and the others
  returned `{}`;
- `tools/result` folding counted 12 and 26 calls into one guard turn;
- `npm test` (17 tests) and `tests/test_dsh_trace.py` (4 tests) pass. Of the 17, one is an
  end-to-end session through a bootstrapped engine (`TE_DSH_TEST_HOME`): a stubbed DSH agent is
  created, runs one prompt-turn with one tool result, ends, and is disposed; the engine writes
  the export, folds it, and `te status --json` reports one priced session for that repository.

Verified on 2026-10-30 (Linux, Node 24.22.1) for the host-local features:

- `npm test` (71 tests, 70 passed and 1 skipped without `TE_DSH_TEST_HOME`) passes: the dedup
  store, the prefix guard, the loop breaker, the watchdog, the tiering policy and its surface
  pass, the new configuration validation, and the registration contract of the plugin scope.
- the tool-event routing was measured on an isolated mount with the web profile's bundle set
  (`TE_DIAG=1`): the agent-scoped `tools/result` and `tools/post-execute` listeners are
  delivered, the `PostToolUse` hook reaches the engine, and the engine records the call
  (`tool_calls: 1` per turn). A route that runs its tool calls outside the harness delivers
  nothing; the plugin reports that at the end of such a session.

Verified on 2026-11-14 for the subagent gate split (§3.1):

- `npm test` → **164 tests / 163 pass / 0 fail / 1 skipped** (the skip is the opt-in engine
  fixture, `TE_DSH_TEST_HOME` not set). Before the split the count was 156 / 155 / 0 / 1.
- mutation testing confirms the assertions bite: removing the gate fails **4** tests, removing the
  `finish()` gate fails **1**, leaving `subagentMemory` unread fails **1**;
- a counting launcher proves "zero engine calls" for a child: over its whole lifecycle
  (`SessionStart` → `SessionEnd`) it spawns **0** `te` / `te-hook` processes and writes **no** file
  under `dsh-sessions/`. The positive control shows the counter does count — a root session spawns
  `te` once and records `SessionStart` / `UserPromptSubmit` / `Stop` in the `te-hook` log.
- **Not live-verified:** the `dsh-web` service started **2026-11-14 09:37:14 KST** and the code
  changed at **21:24:15 KST**, so the running process still holds the pre-split behaviour. The
  state is **`applied pending restart`**; a restart is required before any live measurement
  reflects it.

Verified on 2026-11-15 for the DSH schema alignment (§2a, §3.2–§3.5):

- `npm test` → **236 tests / 235 pass / 0 fail / 1 skipped** (the skip is still the opt-in engine
  fixture, `TE_DSH_TEST_HOME` not set). Before this refactor the count was 164 / 163 / 0 / 1.
- `node scripts/audit-deprecations.mjs` → exit **0**, with two **WARN** rows (the two allowed
  deprecations) and five `ok` rows. The FAIL branch still bites for any non-allowed seam.
- the tool-prune lever is now real: the ledger held **1149 records, all 1149 with
  `untool_applied: []`** before the intersection fix, so the lever had never applied.
- the judge still cannot run: `~/.tokeneconomizer/errors.log` ends with
  `sidecall dsh: no reply (exit 1) dsh: ACCOUNT_SIGN_IN_REQUIRED`. The degraded path exists and
  marks the decision in the record's `reason`.
- `npm run check` now walks `lib/`, `bin/` and `scripts/`. The old hardcoded 12-file list silently
  skipped new modules — `identity.js`, `repokey-bridge.js` and `probes.js` were all added
  unchecked.

Not verified here:

- a live DSH mount with a model: no profile was booted with this bundle, and no turn was observed
  end to end in the GUI;
- a delivered redirect: it needs a stuck turn plus a judge verdict, and the judge needs a working
  `dsh --profile headless`; the folding path was exercised, the delivery path was not;
- the loop guard's judge and micro-skills' proposer through `dsh` headless (no key was spent here);
- the host-local features against a live provider: the pointer, the pinned slot, the interrupt
  and the bail-out prompt are covered by unit tests with stubbed scopes, not by a real session;
- a measured prompt-cache hit rate: the prefix guard reports that the system node changed, and
  nothing measured the provider's cache;
- Windows (the launchers are POSIX `sh`).
