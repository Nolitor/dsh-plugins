# TokenEconomizer saving measurement (DSH bridge, 2026-10-30)

<!-- skeleton:
version: 1.3
kind: measurement
status: measured
updated: 2026-11-02
summary: What the DSH TokenEconomizer bridge actually saved: the 2026-10-30 dark-lever measurement, the tiered-memory and routing fixes built from it, the 2026-11-02 re-measurement that found 1.03M chars of real tiering saving with 53% self-inflation, the toolprune lever that is real but capped near 1.2k tokens per request, and the adopted tierMinChars 3700 floor chosen from the measured maximum inflating input.
-->

> **Superseded verdict.** Section 0 below is the **2026-10-30** reading: every lever dark, about
> zero saved. That was correct for the route in use then, and it is **no longer the current
> state**. Section 8 is the 2026-11-02 re-measurement over the live corpus: tiering saves for
> real, the minimum-size gate was raised to stop it inflating, and toolprune turns out to apply
> but only bounds at roughly 1.2k tokens per request. Read Section 8 before quoting Section 0.

## 0. Verdict (2026-10-30)

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

## 8. Re-measurement, 2026-11-02: what the plugin saves now

Read-only over `~/.dsh/sessions` (153 session files; 65 synthetic fixtures and 2 audit sessions
excluded, 88 real sessions counted) plus the engine state. Nothing under `~/.dsh` or
`~/.tokeneconomizer` was written by the measurement.

**Method, and the trap it avoids.** A rewrite counts as the plugin's only when the record carries
`surfaceOp: {op: 'replace'}` **and** its replacement text matches a TokenEconomizer code path
(`lib/tiering.js` warm/cold, `lib/dedup.js` pointer). The harness's own pruner
(`@deepseek-ai/dsh-compaction-tool-result-pruner`) writes the *identical* `compaction/prune` plus
`surfaceOp` shape, so a text grep conflates the two. Oracle check: at the nominal split the prior
audit's numbers reproduce exactly (641 rewrites / 339 inflating / +245,070 chars), which validates
the classifier before it is used on new data.

### 8.1 The cutover was 12:39:06, not 12:00

`tierMinChars` 1200 -> 3000 was written at **12:16:39**, but the process that loads plugin code and
config restarted at **12:39:06**. Splitting at the nominal noon boundary misclassifies 3 rewrites as
"after" that provably ran the old code — one has `charsBefore=1856`, impossible under a 3000 floor.
All numbers below split at **12:39:06**.

### 8.2 Tiering: real saving, and the inflation is fixed

| Era | rewrites | charsBefore | charsAfter | net saved | inflating | chars added |
|---|---|---|---|---|---|---|
| `minChars=1200` (before 12:39:06) | 644 | 2,823,115 | 1,790,732 | +1,032,383 | **341 (52.95%)** | **+245,927** |
| `minChars=3000` (from 12:39:06) | 1 | 3,028 | 2,763 | +265 | 0 | 0 |

The `minChars=3000` era has **n=1**, which is not evidence of anything. The fix is therefore proven
by counterfactual over the 644 real era-A rewrites instead of by the after-era:

* inputs below 3000 that the new floor would **skip**: 360, of which **340 were inflating**,
  avoiding **+245,919 chars** of self-inflicted growth;
* inputs at or above 3000 that would still run: 284, netting **+1,276,730 chars**, with 1 inflation
  case (+8 chars).

**Inflation rate 52.95% -> 0.35%.** The raise does kill it, because 340 of 341 inflation cases were
inputs under 3000.

> **Residual: 3000 is not fully clear of the floor.** The summary's own size is content-dependent —
> the index can emit up to 20 file paths and 12 headings — so the floor is not a constant. Measured
> lower bound with a benign log: 2,764 chars. Measured with an adversarial path-dense log: **3,517**
> chars, where a 3,045-char input still produced a 3,517-char replacement (+472, inflated) and was
> applied. The other audit's real-data sample put the floor at 1,973-3,609.

#### 8.2.1 Adopted: `tierMinChars` 3000 -> 3700 (2026-11-02)

**Adopted on 2026-11-02.** The value lives in two places that must agree: the code default
(`lib/tiering.js`, `TIER_DEFAULTS.minChars`) and the plugin's own bundle patch
(`cordis.patch.yml`, `tierMinChars`). The live value resolves from the bundle patch, not from the
user profile patch, so a change to the profile alone would silently miss.

Re-measured over 645 real warm rewrites before choosing the number:

| Floor | Rewrites kept | Net chars saved | Inflating |
|---|---|---|---|
| 3000 | 285 | 1,276,995 | **1** |
| 3500 | 243 | 1,263,015 | 0 |
| 3600 | 236 | 1,258,533 | 0 |
| **3700 (adopted)** | **230** | **1,253,996** | **0** |
| 4000 | 205 | 1,230,406 | 0 |

Across those 645 rewrites the largest inflating input is **3,045 chars** (3,045 -> 3,053), so 3,700
clears every observed inflation case with ~650 chars of margin, and 3,500 would also have sufficed.
**Cost of the raise versus 3,000:** 55 rewrites skipped and **22,999 chars** of legitimate saving
given up, in exchange for removing the last inflation.

> **Correction to an earlier statement in this section.** An intermediate pass of this measurement
> reported a 3,893-char inflation case reaching 6,579 chars, which would have argued for a floor
> above 3,900. That row was a **classification error**, not a data point: the filter matched any
> tool result whose text merely *contained* `warm tier` without requiring the replacement to begin
> with the marker, so it captured an unrelated log. Under the strict classifier (the same one that
> passes the oracle check) the true worst inflating input is 3,045. The lower figure is correct;
> the 6,579 row is withdrawn.

A fixed floor is a **bound on input size**, not on output size: content denser than anything in the
corpus can in principle still inflate. It is a practical gate chosen from measured data, not a
structural guarantee. The structural alternative — refusing the rewrite whenever
`summary.length >= text.length` — is the safer invariant and remains unimplemented.

| Lever | Rewrites (era A) | Saved | Inflating |
|---|---|---|---|
| Warm/cold tiering | 644 | 1,032,383 chars | 341 |
| Exact-duplicate dedup | 42 | 55,960 chars | 0 |
| Cold evictions (subset of tiering) | 32 | 106,455 chars | 0 |
| **Harness pruner (NOT this plugin)** | 179 | 2,563,567 chars | — |

### 8.3 Why the after-era is nearly empty (absence is structural, not a failure)

The plugin is live: the newest rewrite is **2026-11-01T12:50:08**, and the engine journal records
`[tokeneconomizer] TokenEconomizer nudged this turn (judge-stuck@0.82)` at 2026-11-02 07:25:50.
The after-era is empty because **no warm-tier opportunity exists yet**: the warm tier begins at turn
age >= `hotTurns` (5), and every real session that *started* after the cutover has at most 3 turns.
Sessions with 22+ turns were all created before it, so they carry the old code for their whole life.
Re-run the audit once a post-cutover session passes turn 5.

### 8.4 toolprune: the mask is real, the ceiling is ~1.2k tokens per request

This corrects the earlier "5 proposals, 0 tools removed, 0 tokens saved" reading, which measured
the wrong artifact.

* **Mechanism is a hard mask, not advice.** `lib/index.js:557-561` calls
  `ctx.tools.restrict({ deny })`; DSH compiles it into the scoped tool layer, and the single
  `visible` map it filters feeds both the model-facing schema list and dispatch. It is not a
  settings file and not approval-gated.
* **It actually removed tools three times**, each with the removed set a subset of the proposal and
  an empty added set: `n=17 -> 15` (`cli_worker`, `working_directory`) twice on 2026-10-29, and
  `n=15 -> 12` (`agy_worker`, `subagent_antigravity`, `subagent_opencode`) on 2026-10-30.
* **Calls to a proposed name after the first proposal: 0.** The pruning held.
* **The trap:** in the current PTC preset a request declares exactly **one** tool (`run_code`), so
  there is nothing prunable in the `tools` array. The pruning lands in the **system prompt**, whose
  TypeScript bindings for the five names are what disappears. Measuring the tools array alone
  yields a truthful "0 removed" and a false "nothing happened".
* **Measured A/B**, same repository, preset and mode, only the agent origin differs: main agent
  `48210` system-prompt chars, first request `14149` tokens; subagents `53901` chars and
  `16153`/`16054` tokens with all five names present. Delta **5691 chars ~ 1059-1210 tokens per
  request (7.5-7.9% of a first request)**.
* **The gate that limits it:** `agent/created` returns early for `origin === 'subagent'`
  (`lib/index.js:408`), so toolprune never runs in a subagent session — and most traffic in this
  corpus is subagent traffic.

**Verdict on toolprune:** real, applied, and bounded at roughly **1.2k tokens per non-subagent
request, zero in every subagent session**. Worth keeping, not worth optimising further.

### 8.5 What changed as a result, and what still needs a decision

Applied and measured on disk: `tierMinChars` 1200 -> 3000, `watchdogThresholdMs` 180000 -> 600000
with `watchdogAction: interrupt`, `thinkInCode`, `recallPriorSessions`, and `run_code` added to the
code-shaped tool set. The resolved live config carries every one of these (`dsh --profile web
--dump-config`), and 72 of 73 plugin tests pass (1 skipped without `TE_DSH_TEST_HOME`).

Resolved since: `tierMinChars` was raised from 3000 to **3700** on 2026-11-02 (Section 8.2.1). The
number comes from the measured maximum inflating input (3,045 chars) plus margin, not from a round
default. Still open: whether to replace the fixed floor with the structural invariant
`summary.length >= text.length` (Section 8.2.1).
