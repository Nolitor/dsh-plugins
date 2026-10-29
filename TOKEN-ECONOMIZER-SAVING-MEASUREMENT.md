# TokenEconomizer saving measurement (DSH bridge, 2026-10-30)

<!-- skeleton:
version: 1.1
kind: measurement
status: measured
updated: 2026-10-30
summary: Measured what the installed DSH TokenEconomizer bridge actually saved (nothing), why each lever is dark, the tool-event routing check that withdrew the earlier defect claim, and the tiered-memory and usage-ledger fixes built from it.
-->

## 0. Verdict

The bridge is installed, mounted and live, and it saved **approximately zero tokens** so far.
Every lever is dark, and the reason is measured, not guessed:

| Lever | Measured state | Why |
|---|---|---|
| Tool mask (`toolprune`) | proposal `[]` in all 10 repositories | 27 of the 32 catalog tools are in the engine's `DSH_PROTECTED` set; the two never-used candidates (`cli_worker`, `working_directory`) sit at streak 2 (< 5 sessions) and 9 prompts (< 10) |
| Micro-skills | 0 injected characters in every repository | the engine's default for DSH is `microskills=off`; no `injection.json` was ever written |
| Loop guard | 44 turn summaries, **42 with `tool_calls: 0`**, 0 nudges, 0 aborts | the sessions that ran with the plugin mounted made no DSH tool call at all (§3) |
| Host-local dedup | **0** pointer events in 16,842 tool results | no tool result to deduplicate: the live route runs its tool calls outside DSH (§3) |
| Loop breaker / watchdog | no bail-out prompt in any session | same cause: no `tools/post-execute` delivery, and no `tokeneconomizer`-sourced user message exists in the corpus |

The corpus cost those levers were supposed to shrink is **3.84 billion prompt tokens**, 99.27% of
it cache-read re-sends of a context that grows to 729,629 tokens in the costliest sessions.

## 1. Corpus and method

Read-only measurement over the harness's own session store (`~/.dsh/sessions`, 140 sessions,
2026-10-24 → 2026-10-30) and the engine's state (`~/.tokeneconomizer`). Nothing under
`~/.dsh` or `~/.tokeneconomizer` was written by the measurement.

```sh
node scripts/measure-token-saving.mjs            # workspace root, prints every number below
node scripts/measure-token-saving.mjs --json out.json
```

### 1.1 What the corpus cost

| Metric | Value |
|---|---|
| Sessions / requests | 140 / 13,468 |
| Prompt tokens (input + cache read + cache write) | 3,839,983,126 |
| …of which cache read | 3,811,890,742 (99.27%) |
| …of which uncached input | 27,975,391 (0.73%) |
| Output tokens | 11,683,130 |
| Prompt tokens per request | p50 213,008 · mean 285,119 · p90 586,437 · p99 720,062 · max 729,629 |

Cost concentrates in long sessions: sessions with more than 200 requests hold **78.3%** of all
cache-read tokens (201-500 requests: 37.7%, more than 500: 40.6%), and the ten costliest
sessions hold **57.9%**.

### 1.2 Per route (the `opencode-http-agent` numbers were broken — see §5.2)

| Route | Requests | Prompt tokens | Over 1M tokens/request |
|---|---|---|---|
| `deepseek-account / deepseek-flash` | 8,782 | 2,808,375,719 | 0 |
| `deepseek-official / deepseek-flash` | 3,679 | 652,643,195 | 0 |
| `opencode-http-agent / opencode-go/deepseek-v4.1-flash` | 47 | 248,546,377 | 36 |
| `opencode-go / deepseek-v4.1-flash` | 477 | 53,778,883 | 0 |
| `opencode-http-agent / opencode-go/iceman-contributor-free` | 10 | 25,945,457 | 6 |

The two DeepSeek account routes are the real corpus: **3.46 billion prompt tokens** over 12,461
requests.

## 2. Where the context comes from

| Metric | Value |
|---|---|
| Tool results | 16,842 results, 35,798,107 chars |
| Result size | p50 514 · p90 5,159 · p95 9,350 · p99 21,959 · max 57,680 chars |
| Results above the pruner's 8,192-char threshold | 990 results (5.9%) holding **16,995,559 chars (47.5% of all tool output)** |
| Results above 2,000 chars | 4,113 results (24.4%) holding 29,649,730 chars (82.8%) |
| Tool-output share of the transcript, costliest sessions | 70.7% / 80.1% / 90.9% / 95.6% |
| Static per-request overhead (tool schemas + framing) | median 11,975 tokens, p90 16,963 |
| Pruned results actually present in the logs | **181** of 16,842 (1.1%) |
| Compaction runs in the corpus | 29 (`compaction/start`), against 140 sessions |

`@deepseek-ai/dsh-compaction-tool-result-pruner` is configured with `thresholdChars: 8192`,
yet 990 results exceed that threshold and only 181 carry the prune marker: the pruner runs
**inside a compaction**, and compaction ran 29 times. `compaction-basic` uses
`thresholdRatio: 0.8` (819K of a 1M-token window), so a session has to grow to ~819K tokens
before anything is compacted; the corpus peaks at 729,629.

## 3. The tool-event routing: measured, not assumed

**Correction to version 1.0 of this report.** It claimed "the tool-event path is dead: the
`PostToolUse` hook never reaches the engine". That claim was drawn from corpus sessions that
made hundreds of tool calls — and every one of them ran **before** the plugin was mounted
(`2026-10-29T20:51Z`). It is withdrawn.

The routing was then measured on an isolated mount that carries the web profile's bundle set,
with the plugin's delivery counters enabled (`TE_DIAG=1`):

| Counter | Value |
|---|---|
| agent-scoped `tools/result` / `tools/post-execute` delivered | 2 / 2 |
| root-scoped delivered | 2 / 2 |
| `PostToolUse` hooks spawned | 2 |
| engine turn summary | `tool_calls: 2` |

The agent-scoped registration is delivered, the hook reaches the engine, and the guard counts
the call. **The listeners therefore stay on the agent's scope**: moving them to the root
context would deliver every sub-agent's tool events to every session, for no measured gain.

The real reason production saved nothing is the **route**, not the routing:

* the live profile's default model route is `opencode-http-agent`
  (`~/.dsh/profiles/web/cordis.patch.yml`, row `agent-default-model`);
* that route hands the whole conversation to an OpenCode server, which runs its own agent loop
  with its own tools — **inside DSH there is no tool call at all**;
* every live session since the plugin was mounted has **0** `tool/call` events in the harness
  log, so dedup, the loop guard, the watchdog and the tiering have no input to work on.

The plugin now says so itself: a session that ends with more than five requests and no
delivered tool event reports that the route runs its tool calls outside DSH.

## 4. What was built from this measurement

### 4.1 Tiered memory for tool outputs (the turn-based policy)

`dsh-tokeneconomizer/lib/tiering.js`, applied at every turn boundary by a surface rewrite
(`compaction/prune` plus a replaced `tool/result`), so the durable log keeps the original:

| Tier | Turns | Log output | Code output |
|---|---|---|---|
| hot | newest 5 | byte-identical | byte-identical |
| warm | up to 15 | head + tail + an index of file names, status codes, schema keys and error counts | kept whole |
| cold | older | evicted; the model context keeps a pointer to the turn and step | evicted; the model context keeps a pointer |

The durable log keeps every original, so the session query (full-text search) still finds an
evicted output by its turn and step. Verified against the real harness session: the model
context carried a 236-character pointer instead of 8,024 characters, and the log still held the
original. 71 plugin tests pass (70 plus one skipped without `TE_DSH_TEST_HOME`).

### 4.2 The `opencode-v2` usage ledger (the inflated numbers)

`dsh-opencode-v2/lib/usage-ledger.js` keeps the usage already reported per OpenCode session.
A per-step total is reported as it is; a **session-cumulative** snapshot (`GET
/api/session/{id}.tokens`, `opencode session export`) now yields only its growth. Both routes
use it. 175 plugin tests pass.

### 4.3 The routing check itself

`TE_DIAG=1` writes the delivery counters to `<state root>/diagnostics.json`, so the next route
change can be measured instead of inferred.

## 5. Side findings

### 5.1 Restart storm

`~/.dsh/logs` holds 406 startup failures between 06:25 and 06:27 on 2026-10-30, all
`listen EADDRINUSE: address already in use 127.0.0.1:3080`. The service is healthy since
(`dsh-web.service`, restarted 07:12 KST).

### 5.2 The `opencode-http-agent` route reported impossible usage

45 requests reported more than 1,000,000 prompt tokens, up to **24,590,190** in a single request
of a session whose whole transcript is 17,115 characters: the route reported the session's
cumulative counters as one request's usage. The TokenEconomizer ledger inherited those numbers
(`session-b89a6252`: 2 requests, 29,703,808 cache-read tokens), so every ledger row for an
`opencode-http-agent` session was meaningless. Fixed in §4.2.

### 5.3 Corrections to earlier statements

* `dsh-tokeneconomizer/docs/ARCHITECTURE.md` §9 listed "a measured prompt-cache hit rate" as
  not verified. It is measured now: **99.27%** of the corpus prompt tokens are cache reads, and
  the mean prompt is 285,119 tokens.
* The same document presented the tool mask as an applied lever. On DSH it has never had a
  proposal to apply: the protected set and the evidence floor keep it empty (§0).
* Version 1.0 of this report claimed the tool-event path was dead. Withdrawn and replaced by
  §3, which shows the routing works and names the route as the cause.

## 6. What remains

* The tiering and the usage ledger only pay off on a **DSH-native route**: a route that owns its
  own agent loop performs its tool calls where the harness cannot see them, so no plugin lever
  can reach them. The live profile's default route is such a route.
* The tool mask still cannot propose: 27 of 32 tools are protected by the engine and the two
  candidates are below the evidence floor. Changing that is an engine decision, not a plugin one.
* The exact-duplicate dedup stays the least valuable of the four levers (76 outputs, 0.17% of
  the corpus).

## 7. Reproducing

```sh
cd dsh-plugins
node scripts/measure-token-saving.mjs
```

Reads `DSH_HOME` (default `~/.dsh`) and `TOKENECONOMIZER_HOME` (default
`~/.tokeneconomizer`); both are read-only. `--json <file>` writes the same numbers as JSON.
