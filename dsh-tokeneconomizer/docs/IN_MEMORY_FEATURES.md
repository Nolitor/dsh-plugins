# Host-Local In-Memory Features

<!-- skeleton:
version: 1.1
kind: spec
status: active
updated: 2026-10-30
summary: Architecture of the four host-local, in-memory features of the DSH bridge: tool-result hash deduplication, the KV-cache-safe prompt slot, the loop breaker with its thinking watchdog, and the turn-based tiered memory for tool outputs.
-->

## 1. What this document answers

This bridge is a DSH-side adapter for the `tokeneconomizer` Python engine: the engine decides, and
this plugin applies the answer with DSH's own levers. Four features do not need the engine, do
not need a model call, and must not wait for a subprocess: they run in the Host process, in
memory, with `node:crypto` and timers only.

| Feature | Question it answers | Module |
|---|---|---|
| `ToolResultDedup` | the same tool output was shown twice; can the second copy be a pointer? | `lib/dedup.js` |
| `KVSafePrefixSlot` | where do pinned instructions live, and did the cached prefix survive? | `lib/prefix.js` |
| `LoopWatchdog` | is the turn stuck, and does the person get a chance to steer it? | `lib/watchdog.js` |
| `TieredMemory` | which old tool outputs may leave the model context, and how? | `lib/tiering.js` |

They share one rule: **no storage**. No SQLite, no vector index, no file, no engine call. Every
piece of state lives in the plugin's per-agent record and disappears with the agent's scope.

## 2. Measured seams

The seams below were measured against the published `@deepseek-ai/dsh@0.2.2-alpha.2` type
declarations, which is the version this package's `engines.dsh` window names.

| Need | Seam | Contract that matters here |
|---|---|---|
| Rewrite a tool result before the model sees it | `tools/post-execute` waterfall | the decision may carry `content`; a decision that carries a canonical `value` may not carry `content` as well |
| Know which step produced a result | `session/event` of type `tool/call` | the event carries `turn`, `step`, `callId`, `name`, `arguments`; the loop logs it **before** the call runs |
| Place text in the request's first message | `systemPrompt.section({name, order, text, interpolate})` | all sections are concatenated into **one** system message, in ascending order |
| Keep text out of the first message | `systemPrompt.context({name, order, text, required})` | contexts are joined into the runtime-context snapshot, which the harness materializes as **one user-role message** |
| Interrupt a turn | `agent.cancel(cause, {keepInbox})` | the cause is one of `user`, `parent`, `hook` (with a reason), `disposed`; `keepInbox` preserves queued work |
| Deliver a prompt into the next step | `agent.inject(UserMessage)` | appends model-facing context; it does not wake the driver |
| Observe request progress | `session/event`, `agent/assistant-stream` | stream frames are process-local notifications, not session events |
| Read the model-visible transcript | `session.deriveMessages()` | the first entry is the effective system message |

Two constraints shaped the design:

1. **A session append may not re-enter.** `Session.append` refuses to run while another append is
   being published, so a surface rewrite from inside a `session/event` listener is impossible.
   A tool result is therefore rewritten *before* the loop logs it, at `tools/post-execute`.
2. **The prompt cache is a prefix cache.** The request's messages are `session.deriveMessages()`:
   the system message first, then the runtime-context snapshot, then the conversation. A change
   at position *n* invalidates the cache from position *n* onward. A rewrite at the tail keeps
   everything before it cached.

## 3. `ToolResultDedup`

### 3.1 Data flow

```
tool resolves
  -> tools/post-execute (this plugin, after next())
  -> text = joined text blocks of the result
  -> sha256(text) -> the session's digest map
  -> first sighting : the raw text is kept
  -> later sighting : the decision carries one text block, the pointer
  -> the loop logs the tool result with the pointer
```

The pointer is exactly:

```
[Output identical to step <N> (hash: <short-hash>), content omitted to save context]
```

`<N>` is the step of the **first** occurrence, taken from the `tool/call` event. `<short-hash>`
is the first twelve hexadecimal characters of the SHA-256 digest of the output.

### 3.2 Rules

| Rule | Reason |
|---|---|
| Only the **newest** occurrence is replaced | the replacement sits at the tail of the transcript, so the cached prefix before it survives |
| Only a **successful** result is replaced | a failed result is the error the model has to read |
| Only output of at least `dedupMinChars` characters is replaced | below that a pointer costs more than it saves |
| A decision that carries a canonical `value` is left alone | the registry rejects a decision that carries both `value` and `content`, and the tool's own projection stays authoritative |
| A `block` decision is left alone | the registry turns a block into an error result; the plugin does not undo that |
| Only a call the loop logged is deduplicated | without a `tool/call` event there is no step number to cite |
| The map keeps digests only | the raw text of the first occurrence is already in the session log, and a duplicate is identical to it |
| The map is bounded by `dedupMaxEntries` | the oldest digest is evicted; a long session cannot grow it without limit |

### 3.3 Why the surface rewrite was not used

The harness can rewrite the model-visible copy of a logged tool result and keep the original in
the log (`session.append('tool/result', …, {surfaceOp: {op: 'replace', …}})`). That route was
rejected for two measured reasons: the append cannot run inside a `session/event` listener, and
a deferred append races the next request build. It also rewrites history, which is exactly what
the prefix slot exists to prevent.

## 4. `KVSafePrefixSlot`

### 4.1 Where the pinned text lives

The request's first message is the single system message the harness assembles from the
registered sections. The plugin therefore mounts its pinned rules as a **section**, not as a
context:

```js
state.agent.ctx.systemPrompt.section(pinnedSection(rules, config.pinnedRulesOrder))
```

`pinnedRulesOrder` defaults to `50`, which places the text between the deployment persona prefix
(`0`) and the plan policy (`500`). The lowest accepted order is `-999`: the harness owns the
identity section at `-1000`, and a pinned rule below it would displace the harness identity.

The text is a constant, and interpolation is off, so the rendered system prompt cannot drift
between requests.

### 4.2 What stays a context

The learned micro-skills facts stay a `systemPrompt.context` at order `180`. The harness
materializes contexts into one user-role snapshot, which sits *after* the system message. Two
properties keep that snapshot stable:

* its provider returns a constant captured at `agent/created`, so it never re-renders into
  different text, and
* `required: true` keeps it when optional runtime context is suppressed, so a toggle cannot
  remove it and rewrite the snapshot.

A changed snapshot is not a cosmetic problem: the harness replaces the old node, which rewrites
the transcript from that position and resets the cached prefix.

### 4.3 The guard

The plugin observes the effective system message through `session.deriveMessages()[0]` and
compares it with the bytes it saw first:

| Event | Verdict | Reported |
|---|---|---|
| first observation | `{ first: true, changed: false }` | no |
| identical bytes | `{ first: false, changed: false }` | no |
| different bytes | `{ first: false, changed: true }` | one stderr line: the cached prompt prefix was reset |

The guard observes only. The harness owns the system node, and the plugin does not rewrite it: a
replacement would move every later message in the transcript.

## 5. `LoopWatchdog`

Two independent detectors share one per-session record.

### 5.1 Loop breaker

| Element | Value |
|---|---|
| Ring buffer | the last `loopBreakerWindow` calls (default 5), oldest first |
| Call key | tool name plus the canonical arguments (deep key-sorted, so `{a,b}` and `{b,a}` are one call) |
| Error signature | the error text with identifiers, digit runs and spacing masked, capped at 400 characters |
| Trip | the last `loopBreakerThreshold` entries (default 3) share one key, all failed, and all carry the same signature |
| Reset | a user message ends the chain |

On a trip the plugin, in this order:

1. queues the bail-out prompt with `agent.inject(...)`, so the person is asked for guidance;
2. cancels the active turn with `agent.cancel({kind: 'hook', reason: 'tokeneconomizer/loop-breaker'}, {keepInbox: true})`;
3. writes one stderr line.

The order matters. The prompt is queued first and the cancel keeps the inbox, so the prompt
survives the interrupted turn. The cancel cause is `hook`, because the interruption comes from
this plugin and not from the person.

### 5.2 Thinking watchdog

The watchdog measures the time since the session last committed progress.

| Element | Value |
|---|---|
| Budget | `watchdogThresholdMs` (default 180000) |
| Arm | `turn/start` |
| Progress | committed session events, and — with `watchdogProgress: 'any'` — assistant stream frames |
| Release | `turn/end`, agent disposal |
| Action | `watchdogAction: 'interrupt'` cancels the turn; `'warn'` only writes a stderr line |

Stream frames count as progress by default, because a reasoning model that thinks for minutes
still emits frames; a stricter `'committed'` mode is available for deployments that want a
committed message instead.

The timer is `unref()`'d, so a pending watchdog never keeps the process alive, and it is
disarmed when the agent is disposed.

## 6. `TieredMemory`

A session's context is re-sent on every request, so an old tool output is paid for again and
again. Truncating it blindly destroys the working context: the model loses the file it just
read, starts guessing, and costs more than the tokens that were saved. The policy grades every
tool output by two things and then acts:

| Grading | Rule |
|---|---|
| Age | the turn the output belongs to, against the turn in progress |
| Kind | code (a file read, an edit, a diff) or log (a run's output) |

| Tier | Turns | What happens to a log | What happens to code |
|---|---|---|---|
| hot | the newest `tierHotTurns` (5) | untouched, byte-identical | untouched, byte-identical |
| warm | up to `tierWarmTurns` (15) | replaced by a structural summary: the head, the tail, and an index of file names, status codes, schema keys, error and warning counts | kept whole: it is the work, not noise |
| cold | older than that | evicted: the model context keeps a pointer to the turn and step | evicted: the model context keeps a pointer to the turn and step |

The durable session log keeps the original output in every case. The replacement is a surface
rewrite, the same mechanism the harness's own tool-result pruner uses: a `compaction/prune`
shadow-price event, then a `tool/result` event with `surfaceOp: {op: 'replace'}`. The shadowed
node stays in the log, so the session query (full-text search) can still find the output by its
turn and step.

The pass runs when a turn starts, because that is the moment the age of every output changes.
It is skipped when the harness has no token meter, because the shadow price is what lets a
consumer subtract the replaced node's cost.


## 7. Configuration

Every setting is a validated field of the plugin's config. An unknown key, a wrong type, a
non-positive number, an out-of-range order, or an unknown enum value fails the row at load.

| Field | Type | Default | Meaning |
|---|---|---|---|
| `dedup` | boolean | `true` | enable the tool-result deduplication |
| `dedupMinChars` | number > 0 | `200` | shortest output worth replacing |
| `dedupMaxEntries` | number > 0 | `512` | remembered digests per session |
| `pinnedRules` | string | `''` | immutable instruction text for the system slot |
| `pinnedRulesOrder` | integer ≥ `-999` | `50` | section order of the pinned rules |
| `loopBreaker` | boolean | `true` | enable the loop breaker |
| `loopBreakerThreshold` | integer ≥ `2` | `3` | consecutive identical failures that trip the breaker |
| `loopBreakerWindow` | integer ≥ `2` | `5` | remembered calls |
| `watchdog` | boolean | `true` | enable the thinking watchdog |
| `watchdogThresholdMs` | number > 0 | `180000` | progress-free budget of one step |
| `watchdogAction` | `warn` \| `interrupt` | `interrupt` | what the watchdog does when the budget is exhausted |
| `watchdogProgress` | `any` \| `committed` | `any` | whether assistant stream frames count as progress |
| `tiering` | boolean | `true` | grade old tool outputs by turn and evict the cold ones |
| `tierHotTurns` | number > 0 | `5` | turns kept at full fidelity |
| `tierWarmTurns` | number > `tierHotTurns` | `15` | turns kept as a structural summary |
| `tierHeadChars` | number > 0 | `2000` | characters kept from the head of a warm-tier output |
| `tierTailChars` | number > 0 | `600` | characters kept from the tail of a warm-tier output |
| `tierMinChars` | number > 0 | `1200` | shortest output worth grading |

The bundle row in `cordis.patch.yml` carries the same keys with the same defaults.

## 8. Registration order and disposal

Every observer is registered in `agent/created`, **before** the first `await`:

```
agent/created (awaited by the harness before the loop claims its first message)
  -> mount(state)          registers the section, the post-execute policy, the session listener
  -> await start(state)    the engine brief, the context, the tool mask, the SessionStart hook
```

Registering after the brief would miss the session's first tool calls, because the brief is a
subprocess call bounded by `cliTimeoutMs`.

All registrations live on the agent's own scope, so disposal unwinds them with the agent. The
watchdog timer is cleared on disposal, and the per-session digest map, ring buffer, call index
and prefix guard are dropped with the record. No module-level state, no global registry.

## 9. Diagnostic lines

Every host-local event writes one structured line to stderr, prefixed with `[tokeneconomizer]`.
The lines carry the fields a runtime trace needs, and nothing is written on the quiet path.

| Event | Line |
|---|---|
| a repeated output was replaced | `dedup: tool=<name> repeated-output replaced hits=<n> first-step=<n> hash=<12 hex>` |
| the request's first message changed | `prefix: the system prompt changed mid-session, the cached prompt prefix was reset` |
| the loop breaker tripped | `loop-breaker: tool=<name> consecutive-failures=<n> error=<signature>` |
| the watchdog expired | `watchdog: no progress for <ms> ms, action=interrupted\|warned` |

The error signature in the breaker line is truncated to 120 characters. A line is written once per
event, so the cost on the quiet path is one comparison and no write.

## 10. Failure behavior

| Failure | Behavior |
|---|---|
| The engine is absent | unchanged; the host-local features do not depend on it |
| The pinned rules are empty | no section is registered |
| A tool call has no logged `tool/call` event | the result is not deduplicated |
| The agent scope rejects an injection or a cancel | the failure is contained and the notice is still written |
| The watchdog fires on a closed agent | nothing happens |

## 11. Verification

`node --test test/*.test.mjs` covers the four modules and the plugin's registration contract:
71 tests, 70 passing and one skipped. The engine-backed end-to-end test stays skipped unless
`TE_DSH_TEST_HOME` names a bootstrapped state root.

| File | Covers |
|---|---|
| `test/dedup.test.mjs` | first sighting kept, pointer text and format, the first step is cited, different output, minimum length, digest stability, bounded map, no raw text kept |
| `test/prefix.test.mjs` | the pinned rules are a section, the guard's baseline, an unchanged message, a changed message |
| `test/watchdog.test.mjs` | trip count, error signature, chain breaks, argument canonicalization, ring bound, reset, watchdog expiry, progress, disarm |
| `test/tiering.test.mjs` | the tier boundaries, the hot tier untouched, the warm summary keeping head, tail and index, the warm code read kept whole, the cold eviction pointer, the code/log classification, the index contents |
| `test/tiering-mount.test.mjs` | the plugin's pass replaces a cold node on the session surface, prices the shadowed node, and leaves a hot node alone |
| `test/mount.test.mjs` | config validation, registration before the brief, the pinned section, the pointer through the pipeline, failed results, a canonical value, a blocked call, the loop breaker trip and reset, the watchdog interrupt and warn modes, the prefix report, the diagnostic line of every event, disposal |

Not covered by these tests, and not claimed:

* a live mount in a DSH profile, and the four-step replacement procedure that proves one;
* a measured prompt-cache hit rate against a real provider; the guard only reports that the
  system node changed;
* the deduplicated output inside a real `bash` or `read` call.

## 12. Related documents

* [ARCHITECTURE.md](ARCHITECTURE.md) — the bridge's isolation boundary, the lifecycle contract,
  and the engine-backed mechanisms.
* [OPERATIONS.md](OPERATIONS.md) — install, bootstrap, rollback, and the configuration reference.
* [../README.md](../README.md) — the mechanism table and the package layout.
