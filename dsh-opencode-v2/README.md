# @nolit/dsh-opencode-v2
<!-- skeleton:
version: 3.2
kind: readme
status: active
updated: 2026-11-01
summary: Golden-reference pure LLM adapter for OpenCode Go. The local OpenCode server is a control plane only (catalog/provider/credential); generation goes directly to the OpenAI-compatible /chat/completions backend and is normalized into DSH text/reasoning/tool/usage chunks. No agent loop, persona, session prompt, or static cwd. 0.0.1 (reset from 0.9.0) restores the top explicit state machine in lib/stream-parser.js and adds the bottom parser/screen gate in lib/display-gate.js; the 0.8.0/0.9.0 display-only filter is replaced, not extended. 0.0.1-rc.1 (fix round) adds defensive tool-argument accumulation in lib/arguments.js (duplicate/restated/wrapped snapshots, schema-selected) and holds a body payload that is only a tool-shaped JSON object until it can be promoted to the parser channel instead of displayed as prose. 0.0.1-rc.2 makes the top classifier recognize the tool-call marker by shape (any bracket style, name/id from the head or the declared parameter schema, any pipe glyph) instead of a literal list, scrubs model-written tags and DSML tokens from the screen, and de-duplicates promoted calls by id; measured screen leaks 301 -> 4 on whole-string feeding. 0.0.1-rc.3 makes recognition stream-safe: a bounded hold for trailing marker/DSML/parameter fragments, a PARAM_BODY state and orphan-DSML scrub stop chunk-boundary leaks (strict screen leaks 42 -> 3 fed one character at a time; turn 16 4/6 -> 0/6). 0.0.1-rc.4 scrubs any pipe-wrapped protocol token by delimiter shape instead of only DSML, treats `thought` as a thinking wrapper, and lets the chunk-boundary hold keep any character inside a pending `<…` fragment, so a split token cannot leak; worst-case chunking leaks 42 -> 3 -> 1, and the remaining 1 is a measurement-regex false positive (a pair of markdown pipes). 0.0.1-rc.5 is an evidence round, not a new classifier: the owner rejected the synthetic A/B as proof (a short prompt produces almost no reasoning or text, so there is nothing to leak), so lib/trace.js records real traffic shape (request: model/messages/context chars/tools/system/stream/maxTokens/toolChoice/effort/session; delta: field/length/marker and an excerpt of at most 400 chars only when notation is detected; finish: counts; error: transport detail and retry counters), capped at 8 MB at /tmp/opencode-v2-trace.jsonl and disabled with OPENCODE_V2_TRACE=0, never storing prompts, message bodies or credentials; scripts/analyze-opencode-trace.mjs groups it by process and request and reports the leak rate by tool count, context chars, system prompt and model. 0.0.1-rc.6 is driven by what that trace then measured: process 2397320 served 29 real requests on deepseek-v4.1-flash, 17 (58.6%) carried protocol notation (34 content deltas, 1 reasoning), 559-580 messages and ~1.07-1.10M context chars each, tools=1, max_tokens 384000, effort high — and hasSystem=false on 29 of 29, which exposed a real role-mapping defect: DSH's loop-built history carries the system prompt as a leading system-role message and every unknown role was mapped to `user`, so the model never saw its system instructions. rc.6 maps `system` to the OpenAI system slot (developer still maps to system) and sends an empty tool result with its tool_call_id instead of dropping it. 0.0.1-rc.7 answers the next trace (serving pid 2422772, 155 requests): 155/155 now carry the system prompt (the rc.6 fix verified) and 138 ended with structured tool_calls, but 56 requests (36.1%) still carried protocol notation, now mostly in `reasoning_content` — the adapter classified only the content channel for body calls, so a call the model wrote into reasoning was stripped of its wrapper tokens and lost, the step produced no tool call and the turn stalled; rc.7 sends reasoning through the same classifier, so prose stays reasoning while a recovered call is queued for the parser channel.
-->


OpenCode inside DeepSeek Harness, aligned with the **OpenCode v2.2.0** CLI surface.

`dsh-opencode-v2` is a **managed wrapper**. It wraps
[`@quonaro/dsh-plugin-opencode@0.1.2`](https://www.npmjs.com/package/@quonaro/dsh-plugin-opencode)
as an ordinary npm **dependency** and **never modifies it** — no patching
`node_modules`, no forking files, no private hashed imports. Everything the v2
surface needs is re-implemented here on top of `ctx.subprocess`.

> Measurement of record: [`../OPENCODE-V2-SURFACE-MEASUREMENT.md`](../OPENCODE-V2-SURFACE-MEASUREMENT.md)

## 0. Version — 0.0.1 baseline, 0.0.1-rc.7 on instruction

| Field | Value |
|---|---|
| `package.json` | `0.0.1-rc.7` (was `0.0.1-rc.6`, which was `0.0.1-rc.5`, which was `0.0.1-rc.4`, which was `0.0.1-rc.3`, which was `0.0.1-rc.2`, which was `0.0.1-rc.1`, which was `0.0.1`) |
| `lib/http.js` load-beacon `VERSION` | `0.0.1-rc.7` (was `0.0.1-rc.6`, which was `0.0.1-rc.5`, which was `0.0.1-rc.4`, which was `0.0.1-rc.3`, which was `0.0.1-rc.2`, which was `0.0.1-rc.1`, which was `0.0.1`) |
| Versions self-bumped in this history | 26 (`0.1.1` … `0.9.0`) |
| `0.0.1-rc.1` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.1.tgz` — sha256 `64be56cd99543754caadcc5459b983c597ac53f226cdd145ded4ab7d99a3fc16` |
| `0.0.1-rc.2` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.2.tgz` — sha256 `29260240b776708a524e90c5e6b4071557beeb9f6b18908c4ad09befda85e8e3` |
| `0.0.1-rc.3` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.3.tgz` — sha256 `54e7b84380cf9373d991ce4f4ddc2fdd67987831a42865c3d2a5eadd9542f32b` |
| `0.0.1-rc.4` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.4.tgz` — sha256 `19212774f7f4fc8d001e980e3d9c25509510c54804670b4480f2f41cb3693be1` |
| `0.0.1-rc.5` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.5.tgz` — sha256 `970e0c70cefc4ebcb0ce3dc767dc824939f6a6ea3e14f1807ea9124ed8fa7609` |
| `0.0.1-rc.6` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.6.tgz` — sha256 `b95379ad0f13b78699fa8a4b526ca586fc0ad2d945628d487bea0e24d311b1b9` |
| `0.0.1-rc.7` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.7.tgz` — sha256 `79e6ddf7d0fa7e640654783b7fd243d8a36295c68ebd07747530790322a2d442` |

The owner reset the number and forbade further self-bumps: **the version changes again only on an
explicit owner instruction, and then only as `0.0.1.rc<N>`** (packaged as `0.0.1-rc.<N>`). A release,
a fix round or a green test run is not an instruction. The load-beacon constant is part of the
release, not a log decoration. The `0.0.1` baseline stays the reset; the line advances one
release-candidate step per instructed fix round and nowhere else.

Seven instructed fix rounds have moved the line so far: `0.0.1` → `0.0.1-rc.1` (argument
accumulation, §0.1), `0.0.1-rc.1` → `0.0.1-rc.2` (shape-based marker classification, §0.2),
`0.0.1-rc.2` → `0.0.1-rc.3` (stream-safe recognition at chunk boundaries, §0.3),
`0.0.1-rc.3` → `0.0.1-rc.4` (protocol tokens are a delimiter family, not a DSML family, §0.4),
`0.0.1-rc.4` → `0.0.1-rc.5` (real-traffic trace instead of synthetic probes, §0.5),
`0.0.1-rc.5` → `0.0.1-rc.6` (the system prompt actually reaches the model, §0.6) and
`0.0.1-rc.6` → `0.0.1-rc.7` (a call in the reasoning channel is promoted, not dropped, §0.7).
None of those numbers came from a green suite or a defect found on our own; each was the one RC
step the owner's instruction allowed.

### 0.1 `0.0.1-rc.1` — what changed and why

`0.0.1-rc.1` is **a fix of `0.0.1`, not a new architecture**: the top state machine and the bottom
parser/screen gate are unchanged; two argument-boundary defects found in live traffic are fixed.

The defect report is session `2dc3531f-1b50-406e-bacc-9ce73345e193` (`opencode-go/deepseek-v4.1-flash`,
workspace `total_skill`, 2026-11-01 06:58–07:41 KST):

| Measure | Value |
|---|---|
| tool calls in the session | **80** |
| failed in the host with `Error: invalid arguments: "arguments" must be an object` (`ToolArgsError INVALID_ARGS`) | **30** |
| bare JSON tool payloads shown as prose | **4** |

Root causes and fixes:

| # | Cause | Fix |
|---|---|---|
| 1 | the route **re-sends the whole arguments object as a second delta** instead of a fragment; the adapter appended it, so the host received two concatenated JSON objects (`{"code":…}{"code":…}`) and `JSON.parse` failed — hence "must be an object". 24 of the 30 second copies were exact duplicates, 6 restated the call with changed content, and 3 of those copies arrived wrapped as `{"arguments":"<json>"}`. | new `lib/arguments.js`: `normalizeArguments(raw, schema)` parses one-or-more complete JSON snapshots, unwraps the `{"arguments": …}` form, and picks the **last snapshot that fits the declared tool's parameter schema** (keys within `properties`, all `required` present); without a schema it keeps the last complete snapshot. `lib/http.js` applies it when a tool-call block closes (normal and cut paths) and when the gate compares against structured calls. Unparsable arguments pass through unchanged so the host still reports them — nothing is silently rewritten. |
| 2 | after the dispatch error the model re-typed the call as a bare JSON object inside `content` (no marker). The 0.9.0/0.0.1 gate recognized only `[tool call …]`, DSML and thinking notation, so those payloads were displayed as prose. | a held JSON probe in `lib/http.js`: when the visible text of a response **begins** with `{` or a fenced block, it is held until it parses, the tool is inferred by schema (`inferToolFromArguments`), and if exactly one declared tool fits it is promoted to a real tool-call part and never shown. If nothing matches, the held text is released unchanged; JSON inside prose is never probed. |

Gate rule added: when **every** structured call of that name has unusable arguments, the body payload
is promoted as its replacement (the wire call could not execute anyway); otherwise the existing
echo / superseded / undeclared rules apply.

Measured after the fix:

| Measure | Before | After |
|---|---|---|
| corpus: 267 `opencode-route` sessions, 16,709 tool calls — invalid arguments | 44 | **0** |
| snapshot modes in that corpus | — | valid 16,665 / duplicate 32 / restated 12 |
| bare JSON text payloads (corpus) | 4 | 4 matched to a declared tool, **0 displayed** |
| reported session `2dc3531f` — invalid arguments | 30 | **0** |
| reported session — bare JSON payloads displayed as prose | 4 | **0** (4 matched to `run_code`) |

Details and the before/after tables: `VERIFICATION.md` §40.

**Status: applied on disk, pending restart.** The running service (`pid 2199391`, started
2026-11-01 06:52:39 KST) still serves `0.0.1`; the `0.0.1-rc.1` source is on disk and is **not live**.

### 0.2 `0.0.1-rc.2` — the marker family was a literal list; classification is now by shape

The owner reported that his turns looked "forcibly cut" and that more errors appeared, again
pointing at session `2dc3531f-1b50-406e-bacc-9ce73345e193`. Measured, that report contains two
different things and neither is an rc.1 regression:

| Window in that session | Measured outcome |
|---|---|
| `0.0.1` (before the 07:54–07:56 KST restart) | 30 `ToolArgsError INVALID_ARGS`, all timestamped 06:58–07:41 KST |
| `0.0.1-rc.1` (after the restart) | 3 turns, 11 tool calls, **0 tool errors**, every `turn/end` `completed` |

So rc.1 added no errors there. What did change is a **new, corrupted notation family** the route/model
began writing into `content`: the classifier recognized it in none of its forms, so the intended call
never reached the parser and the model's own text says "continuing from where it was cut". Measured
shapes: `<tool_call #call_00_…>`, `<tool call run_code #code_placeholder_001>`, closer-shaped
parameter openers `</│DSML│ parameter name="code">…</│DSML│>`, doubled pipes
`</｜｜DSML｜｜ parameter>`, a bare `</│DSML│>`, `<│DSML│parameter name="description">…</│DSML│>`,
and the mixed `<tool call run_code #id]: {json}`.

Replayed through the **rc.1** classifier those payloads yield **0 calls promoted and 0 characters
removed** — the notation was displayed verbatim. That is the "cut": the call was never executed.

`0.0.1-rc.2` keeps the same state machine and makes the top classifier tolerant:

| Piece | Behaviour |
|---|---|
| marker head | recognized in any bracket style, `^[<\[]\s*tool[ _-]?call\b` — `[tool call …`, `<tool_call …`, `<tool-call …` |
| call name | taken from a declared tool name in the head, from `name="…"`, or **inferred from the parameter schema** (`inferToolFromArguments`) when the head cannot name it |
| call id | from `#id` or `id="…"` |
| payload | a JSON object found after the head, **or** parameter tags closed by whatever closer the model invented — a parameter opener may even be written as a closer. Block terminators require `invoke`/`calls`/`tool_calls`, so a bare closer stays a parameter closer |
| pipe glyphs | `｜`, `│` and `\|` in any 1–2 repeats, doubled included |
| screen | `scrub` removes model-written tool/parameter tags and DSML tokens, so no marker reaches the screen |
| bottom gate | de-duplicates by **call id**, so the same call restated with drifted arguments is promoted once |

Measured across all `opencode-route` sessions:

| Measure | Before `0.0.1-rc.2` | After |
|---|---|---|
| assistant messages whose text contained protocol notation | 333 | 333 (same corpus) |
| strict screen leaks (line-start marker, DSML token, parameter tag) | 301 | **4** — all 4 are prose quoting the notation inside backticks |
| looser "any mention" count | 333 | **49** — all prose |
| calls promoted from those payloads | 0 | **24** |
| duplicate restatements dropped | 0 | **209** |

In the reported session: the marker-only payload is dropped with no call (there is no payload to
execute), the mixed payload becomes **1 call** with the correct id and JSON arguments and **0
characters shown**, and the 6,427-character final payload collapses to **2 distinct calls** after
id de-duplication.

**Status at the time: applied on disk, pending restart.** The service was restarted afterwards;
later measurement shows serving `pid 2325852` runs `0.0.1-rc.2`, and `0.0.1-rc.3` supersedes it
on disk only. No mount is claimed. Detail: `VERIFICATION.md` §41, ledger F-29.

### 0.3 `0.0.1-rc.3` — the classifier was tested on whole strings; a stream splits the marker

The owner was right that work continued after every update: the calls executed, but the marker was
also printed. Measured on rc.2 (serving `pid 2325852`, 09:22–09:31 KST), turn 16 of session
`2dc3531f-1b50-406e-bacc-9ce73345e193` still showed the marker on screen — steps 3, 4 and 6 printed
`<tool call run_code #call_00_…]: {json}`, and step 8 printed a bare code body (the
`<parameter name="code">` opener removed, the value kept). **3 of the 6** assistant messages in
that turn leaked; the turn still completed because the wire call was present.

Root cause: the classifier recognised the marker **only when the whole marker was in the buffer**. A
real SSE stream splits it, so `<tool ca` was emitted as prose before it could be recognised; the
remainder no longer sat at a line start, so the marker never opened. Replaying the same text as one
string hid the bug (**0 leaks**); replaying it one character at a time reproduced it (**4 of 6
messages**). That is why rc.2 looked fixed in tests and still failed live.

`0.0.1-rc.3` keeps the parser and the gate and fixes recognition at chunk boundaries:

| # | Mitigation |
|---|---|
| a | bounded hold of a trailing fragment that could still become a marker (`<tool ca`, `<tool`, `[`+tool…), a DSML tag (`</｜DSML｜ calls>`, `<｜DSML｜ invoke name="bash">`, `</│DSML│`, doubled pipes, attribute quotes) or a parameter tag (`<parameter`, `<│DSML│parameter`) |
| b | a new `PARAM_BODY` state drops a standalone parameter tag and its value |
| c | scrub removes orphan DSML tokens whose `<` was consumed in an earlier chunk |
| d | the same hold applies to piped and attribute-bearing tokens |

Measured under worst-case chunking — each of **3,689** assistant text messages across all
`opencode-route` sessions fed **one character at a time**:

| Measure | rc.2 baseline | rc.3 |
|---|---|---|
| strict screen leaks (line-start marker, DSML token, parameter tag) | **42** | **3** — all 3 are prose that quotes the notation inside backticks |
| whole-string feeding, strict leaks | **4** | **3** (same prose) |
| calls promoted from body payloads | — | **28** |
| turn 16, one character at a time | **4/6 messages leaked** | **0/6** leaked, calls still promoted |

The earlier rc.2 corpus figures (301 -> 4) were measured with **whole-string** feeding. They are not
a chunked measurement and are not repeated here as one.

Tests: `npm test` **286/286**, `npm run check` exit 0. New regressions cover a marker split into
single characters, a standalone parameter tag split across deltas, a DSML opener with attributes
split across deltas, and every two-way split of a mixed payload leaving no marker on screen.

**Status at the time: applied on disk, pending restart.** Serving `pid 2325852` ran `0.0.1-rc.2`;
the `0.0.1-rc.3` source was on disk only. The owner restarted onto rc.3 afterwards (serving
`pid 2339788`, 09:42:39 KST); `0.0.1-rc.4` (§0.4) now supersedes it on disk only. No mount is
claimed. Detail: `VERIFICATION.md` §42, ledger F-30.

### 0.4 `0.0.1-rc.4` — not every protocol token is DSML; scrub by delimiter shape

The owner restarted onto rc.3 (serving `pid 2339788`, 09:42:39 KST) and ran **nine more turns**
(17-25). Tool errors: **none**. Two messages still showed protocol tokens, and **neither was
DSML**: turn 18 step 6 printed `<｜End of thought｜>`, and turn 20 step 3 printed `<｜thought>` and
`</thought>`.

Root cause: the scrub recognised only **DSML-shaped** tokens (`｜DSML｜`) and only
think/thinking/analysis wrappers. The model also writes other pipe-wrapped tokens
(`<｜thought>`, `<｜End of thought｜>`) and a `thought` wrapper, so those fell through.

`0.0.1-rc.4` fixes the family, not the instances:

| # | Mitigation |
|---|---|
| a | a generic protocol-token scrub removes **any** `<｜…｜>` / `<│…│>` token regardless of its text |
| b | `thought` is accepted as a thinking wrapper (`<thought>` opens reasoning, `</thought>` closes it) alongside think/thinking/analysis, and both are stripped from prose |
| c | the chunk-boundary prefix hold now accepts **any** character inside a pending `<…` fragment, so a split token cannot leak |

Measured under worst-case chunking — every assistant text message across all `opencode-route`
sessions fed **one character at a time**:

| Measure | rc.2 | rc.3 | rc.4 |
|---|---|---|---|
| strict screen leaks, one character at a time | **42** | **3** | **1** — a false positive of the measurement regex (a pair of markdown pipes, not notation) |
| body calls promoted | — | **28** | **28** |

Whole-string feeding: **4 → 1**. Prose identity: **2,728** messages without notation stay
byte-identical. Latest traffic: the **33** assistant messages since rc.3 (turns 17-25) contain
**1** regex false positive and **no real notation**. Replaying the two live shapes through rc.4 —
turn 18 step 6 (`<｜End of thought｜>`) and turn 20 step 3 (`<｜thought>` / `</thought>`) — leaves
**no residue**; both are clean, including the single-sided `<｜thought>` form. Corpus worst-case
chunking stays at the same **1** regex false positive.

Tests: `npm test` **286/286**, `npm run check` exit 0. Artifact
`artifacts/nolit-dsh-opencode-v2-0.0.1-rc.4.tgz`, sha256
`19212774f7f4fc8d001e980e3d9c25509510c54804670b4480f2f41cb3693be1`.

**Status: applied on disk, pending restart.** Serving `pid 2339788` runs `0.0.1-rc.3`; the
`0.0.1-rc.4` source is on disk only. No mount is claimed. Detail: `VERIFICATION.md` §43, ledger F-31.

### 0.5 `0.0.1-rc.5` — a probe cannot reproduce the leak, so rc.5 traces real traffic

`0.0.1-rc.5` is an **evidence round, not a new classifier**: the parser, the gate, the
argument normaliser and the chunk-boundary hold are the rc.4 code. What changed is how the
defect is measured.

#### The owner's objection to the synthetic A/B

The A/B was replayed to test whether request **headers** cause the leak, and the owner rejected it
as evidence: a short synthetic prompt makes the model produce almost no reasoning and almost no
text, so **there is nothing to leak**. The leak needs long, multi-turn, output-heavy work; a probe
neither reproduces the volume nor the context. Re-running those long turns as probes would burn
the owner's quota for a result that is still synthetic.

The A/B is therefore kept only as a **negative result** — headers are not the cause:

| Variant (same endpoint `https://opencode.ai/inference/go/openai/v1/chat/completions`) | Result |
|---|---|
| `x-opencode-session` header on vs off | same structured `tool_calls`, **zero** content markers; without the header the endpoint answers **HTTP 400**, so the header is required and is already sent |
| directory + client headers | **zero** content markers |
| non-stream request | **zero** content markers |
| `tool_choice: required` + `parallel_tool_calls: false` | **zero** content markers |
| the above in combination | **zero** content markers |
| 38 tools declared | **zero** content markers |
| long system prompt | **zero** content markers |
| markup-primed history | **zero** content markers |

Run on both `beam-free` and `deepseek-v4.1-flash`: every variant returned structured
`tool_calls`, and none put protocol notation into `content`. So the six header/shape variants are
ruled out, and the cause has to be found in **real** long turns.

#### The real-traffic trace — `lib/trace.js`

The adapter now records what real work already produces. Per request it writes only the **shape**,
never the body:

| Record | Fields |
|---|---|
| `request` | model, message count, context chars, tools count, `hasSystem`, stream, maxTokens, toolChoice, effort, session id |
| `delta` | written **only when protocol notation is detected**: field (content / reasoning / tool-call), length, marker flag, and an excerpt of at most **400** characters |
| `finish` | counts by field, content/reasoning chars, blocks, tool-call count |
| `error` | the transport detail (truncated) and the retry counters |

- Path: `/tmp/opencode-v2-trace.jsonl` (override with `OPENCODE_V2_TRACE=<path>`).
- Kill switch: `OPENCODE_V2_TRACE=0` disables it entirely.
- Cap: appends stop at **8 MB**, so a forgotten trace cannot fill the disk.
- Privacy: **no prompt text, no message bodies, no credentials** — counts, flags and a bounded
  marker excerpt only.

#### What the first real trace showed — the system prompt was sent as a user message

The owner ran five real turns on rc.5 (process **2397320**, `deepseek-v4.1-flash`). The trace
recorded **29** requests; **17** of them (**58.6%**) carried protocol notation in streamed deltas —
**34** marker deltas in `content` and **1** in `reasoning`. The request shape was the same every
time: 559-580 messages, ~1.07-1.10 million context characters, tools=1, max_tokens 384000,
effort high — and **hasSystem=false on 29 of 29** requests.

That last flag was not a trace bug. DSH's loop-built history carries the system prompt as a
**leading message with role `system`** (`dsh-llm` `types.d.ts` documents this), but
`dsh-opencode-v2` mapped every role it did not name to `user`. The whole system prompt therefore
went to the model as a user message and the model ran without its system instructions — a real
adapter defect that no unit fixture had exercised, found by reading the shape of real traffic.
§0.6 fixes it.

#### What the rc.6 trace showed — the calls were in the reasoning channel

After rc.6 the owner restarted (serving **pid 2422772**) and reported that the visible markup was
gone, but that tool calls often failed and the model frequently just sat there ("spacing out").
The trace of **155** real requests on `deepseek-v4.1-flash` shows both halves:

| Measure | Value |
|---|---|
| traced requests | **155** |
| `hasSystem` | **true — 155 of 155** (the rc.6 fix, verified) |
| ended with structured `tool_calls` | **138** |
| ended with `stop` | **10** |
| no finish record | **7** |
| requests still carrying protocol notation in a streamed delta | **56** (**36.1%**) |

and the notation had moved channel: it is now mostly in the **reasoning** stream — for example
`</thinking>\n[tool call` and `</|DSML| parameter>`, plus one runaway request with **7,275**
marker deltas in reasoning. That is the stall: the adapter classified only the **content** channel
for body calls; reasoning was merely stripped of think tokens, so a tool call the model wrote into
`reasoning_content` was never promoted — the step produced no tool call at all and the turn
looked stalled. §0.7 fixes it.
#### The analyser — `scripts/analyze-opencode-trace.mjs`

`node scripts/analyze-opencode-trace.mjs [trace] [--pid <pid>] [--since <iso>]` lists **every
process** in the trace with its request count, leaking count and largest context, then reports the
leak rate **by tool count, by context chars, by system-prompt presence and by model**, plus the
first leaking excerpts. It defaults to the **busiest** process; `--pid` selects another and
`--since` cuts the trace at a timestamp. Unit-test processes also write trace lines (they run the
same adapter), so to isolate real traffic pick the process with the **largest `maxChars`** — that
is the turn the owner actually ran. Until real long work produces a hit it prints
**"no leaking request in this trace yet"**; it does not invent a number.

Tests: `test/trace.test.mjs` (**5** tests) pins the kill switch, one compact line per record, the
bounded excerpt, that no prompt body is copied, and the marker-family recognition.
`npm test` **291/291** in rc.5, **293/293** in rc.6, **295/295** in rc.7; `npm run check` exit 0
throughout.
Artifact for the rc.5 evidence round: `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.5.tgz`, sha256
`970e0c70cefc4ebcb0ce3dc767dc824939f6a6ea3e14f1807ea9124ed8fa7609`.

**Status: applied on disk, pending restart.** No live verdict about the leak is claimed in rc.5;
the trace exists so that the next real occurrence is analysable instead of argued about. Detail:
`VERIFICATION.md` §44, ledger F-32; the defect the trace exposed is §0.6 below, ledger F-33.

### 0.6 `0.0.1-rc.6` — the system prompt was sent as a user message, so the model ran without instructions

rc.5's trace did its job. The owner ran five real turns on rc.5 and reported a large improvement,
but the trace still showed new artifacts and remaining issues — and it exposed a defect the
parser work had hidden: on **29 of 29** real requests `hasSystem` was **false**.

DSH's loop-built history puts the system prompt in a **leading message whose role is `system`**
(`dsh-llm` `types.d.ts` documents that shape). The adapter mapped `assistant`, `tool` and
`developer` and fell through to `user` for everything else — including `system`. The entire
system prompt was therefore sent as a **user message**: the model never saw its system
instructions, and the leak rate measured on that traffic (17 of 29 requests, 58.6%) is the rate of
a model running off-format. No unit fixture had covered the leading system message; the trace
did.

`0.0.1-rc.6` makes the request faithful to the host's own types:

| # | Fix | Behaviour |
|---|---|---|
| a | `system` role | `message.role === 'system'` now maps to the OpenAI `system` role; `developer` still maps to `system` |
| b | empty tool result | an empty tool result is still sent **with its `tool_call_id`** — the previous `append()` dropped empty content and could mis-assign the id |

Both are covered by new tests: a leading system-role message keeps the system slot, and an empty
tool result keeps its call id.

| Check | Result |
|---|---|
| `npm test` | **293/293 pass**, 0 fail (291 before; the two role/tool tests are new) |
| `npm run check` | exit 0 |
| artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.6.tgz` |
| sha256 | `b95379ad0f13b78699fa8a4b526ca586fc0ad2d945628d487bea0e24d311b1b9` |

The trace stays on: the system-prompt flag is now expected to read `true` on the next real
traffic, and the leak rate is re-read from the same trace after the restart (`--pid` selects the
serving process, `--since` a window).

**Status: applied on disk, pending restart.** The defect was confirmed on real traffic and fixed
in the request builder; no mount is claimed here. Detail: `VERIFICATION.md` §45, ledger F-33.

### 0.7 `0.0.1-rc.7` — a tool call written into reasoning is promoted, not dropped

The rc.6 traffic made the remaining failure precise. Of the 155 traced requests, **138** ended with
structured `tool_calls`, **10** with `stop` and **7** had no finish record; **56 (36.1%)** still
carried protocol notation, and now almost all of it was in the **reasoning** channel. When the
model writes its call there, the old adapter stripped the wrapper tokens from reasoning for the
screen and kept only the prose — the call itself was dropped. The step had no tool call to execute,
so the turn sat until it ended: the "spacing out" the owner saw.

Replaying the owner's two sessions through the rc.7 classifier (`c889802e`, `ec259449`):

| Session | Assistant messages with markers in reasoning | Calls recovered | No-wire-call steps recovered |
|---|---|---|---|
| `ec259449` | **30** | **21** | **3** of 6 |
| `c889802e` | **3** | 0 | 0 |

`0.0.1-rc.7` feeds the reasoning channel through the **same** classifier as content:

| # | Piece | Behaviour |
|---|---|---|
| a | reasoning classification | reasoning text goes through a classifier instance identical to the content one, so a body call written in `reasoning_content` is recognised |
| b | prose stays reasoning | text without a marker is emitted as a `reasoning-delta` unchanged |
| c | recovered call | a recovered call is queued for the **parser** channel with `source: 'text'`, so the bottom gate promotes or discards it by the usual rules |
| d | wrapper tokens | `<thinking>` / `</thinking>` and the pipe-wrapped protocol tokens are still stripped; the marker never reaches the screen |
| e | state reset | the reasoning classifier is a **second instance** and is reset together with the content classifier and the gate between retries |

Two new end-to-end tests cover the fix: a tool call written into `reasoning_content` is promoted
and the marker does not reach the screen, and reasoning prose without a marker stays reasoning.

| Check | Result |
|---|---|
| `npm test` | **295/295 pass**, 0 fail (293 before; **2** new) |
| `npm run check` | exit 0 |
| artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.7.tgz` |
| sha256 | `79e6ddf7d0fa7e640654783b7fd243d8a36295c68ebd07747530790322a2d442` |

**Status: applied on disk, pending restart.** The serving process (pid 2422772) still runs rc.6;
the recovered-call count is a replay of recorded traffic, not a live rate. After the restart the
same trace should show the reasoning marker deltas falling while the `tool_calls` finish count
rises. Detail: `VERIFICATION.md` §46, ledger F-34.

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

### Stream-cut defence and inline-tag routing (v0.7.3/v0.7.4 — measured 2026-10-31)

Two defects made a long turn die mid-step. Both are session-record measurements, not hypotheses:

| Symptom (measured) | Cause | Fix |
|---|---|---|
| `turn/end` -> `{kind:'error', error:{message:'terminated', code:'OPENCODE_BACKEND'}}` in **3 of the last 6 sessions** | every exception thrown while reading the SSE body (undici `TypeError: terminated`, `ECONNRESET`, `UND_ERR_SOCKET`) was mapped straight to a hard error, so the whole step was discarded | `isTransientStreamError()` separates a transport cut from a request verdict; the request is retried while **nothing** has been emitted (`streamRetries`, default 1), and once output exists it is **preserved** (`streamCutPreserve`, default true) |
| literal `<thinking>` (31 occurrences in one session) and `[tool call bash #call_...]` / `<invoke ...>` stored as assistant **text** | the adapter only read the structured OpenAI fields (`reasoning_content`, `tool_calls`); a text-level tag router was bolted on to compensate | **0.8.0 deleted the router outright**; the wire field decides the type, but a route that puts notation inside `content` then shows it (measured: 1.7% of 29,940 deltas). **0.9.0** answered that with a display-only filter for two shapes instead of separating the parser channel from the screen channel; **0.0.1** restores the top classifier and adds the bottom display gate (see below) |

Rules the implementation follows:

- **Retry only before the first delta.** A retry after text has reached the transcript would duplicate
  content; instead the partial message is closed and finished as `stop`, so the harness keeps the work
  and continues. Nothing is silently dropped and no block is left open.
- **A cut tool call is closed with valid JSON.** `repairJson()` keeps the completed prefix and falls
  back to `{}`; invalid JSON never reaches the tool layer.
- **The wire field decides the type.** `delta.reasoning_content` is reasoning, `delta.tool_calls` is a tool
  call, `delta.content` is text. Decided upstream in `lib/upstream-map.js`, never by reading
  characters; the downstream reducer forwards each typed part unchanged.
- **v0.7.6 — a split marker is held, not released.** 0.7.3-0.7.5 held a tag split *inside an opener*
  (and the `<thinking>` body), but **not** a `[tool call …` marker that arrived without its closing
  `]`: that fell through `drainCall()` and was emitted as text, so the notation plus its JSON payload
  reached the screen. Measured live split: `[tool call bash #` | `chatcmpl-t` | `ool-f82` |
  `dc4b5b1582ac5` | `]: {…}`. A partial marker is now held (bounded by `maxHold`), a complete-but-
  invalid marker has its syntax stripped while the prose is kept, and every text/reasoning block is
  re-sanitised at `block-end` as a last-mile net.
- **v0.7.7 — the compaction scratchpad never reaches the screen.** A compaction answer is
  `<analysis>` (a drafting scratchpad) followed by a `summary` block. The scratchpad was stored as
  assistant *text* and rendered, because the compaction path is separate from the streaming router.
  A text block that **starts** with the scratchpad now enters the reasoning channel instead, and the
  answer wrapper is unwrapped. A mere mention of the tag inside a sentence stays readable prose.
  Prior art: QwenLM/qwen-code#6023, #6595, windmill-labs/windmill#9750.
- **Historical (0.7.8, deleted in 0.8.0, restored in 0.0.1) — a state machine parsed the stream.** The
  0.7.3-0.7.7 router re-scanned and rewrote accumulated text with twelve module-level regexes, so the
  same input could classify differently depending on where the SSE stream split, and notation was
  hidden by deleting body text. The machine **is** `lib/stream-parser.js` — one pass, explicit states,
  emitting ordered `text` / `reasoning` / `tool-call` parts modelled on the Vercel AI SDK stream parts
  and assistant-ui assistant-stream chunks. 0.8.0 reduced that same file to a 55-line pass-through
  (commit `e1ef561`: 366 -> 55 lines) and deleted `lib/inline-tags.js` (245 lines); 0.0.1 restores the
  machine (see the 0.0.1 bullets below).
- **v0.8.0 — boundary pipeline; tag guessing is gone.** Every delta is typed at the boundary
  (`lib/upstream-map.js`): `reasoning_content` (and the `reasoning` / `reasoning_text` aliases) is a reasoning
  part, `tool_calls` is a tool-call part carrying its ordinal, and `content` is a text part.
  `lib/stream-parser.js` was reduced to a 55-line pass-through reducer that returned those parts
  unchanged (restored as a machine in 0.0.1); `lib/inline-tags.js`, the `inlineTags` option, the
  per-delta routing trace and every tag pattern were deleted. Measured over 29,940 recorded content
  deltas: 37.6% pure prose, 1.7% carrying notation — a character scanner was the wrong layer, but
  deleting the parser too was the wrong conclusion (see the 0.0.1 bullets).
- **v0.8.0 / 0.9.0 — the superseded detour.** 0.8.0 deleted the owner's 0.7.8 state machine without
  an instruction, and 0.9.0 answered the resulting leak with a **display-only filter** on the one
  text stream (`lib/display-clean.js` plus two streaming gates). A filter is not a gate: it mutates
  the only channel it can see, so the DSH parser channel and the screen channel could not be
  separated, and notation kept leaking live (measured: 20 of 65 messages in the first 90 minutes of
  0.9.0). 0.0.1 **replaces** the filter; it does not extend it. `lib/display-clean.js` is retained,
  but only `stripThinkingTags` is used, and it is no longer on the stream path. Detail: `VERIFICATION.md` §38-39.
- **v0.0.1 — TOP restored: an explicit state machine classifies the stream.** `lib/stream-parser.js`
  is again a state machine, not a pass-through: states `TEXT` / `REASONING` / `TOOL_HEAD` /
  `TOOL_ARGS` / `DSML_ARGS` / `INVOKE_HEAD`. Four invariants, each one a defect this file prevents:
  **I1** prose is emitted once, in order, verbatim — only protocol syntax is removed; **I2** in `TEXT`
  at most `longest opener - 1` characters are held back; **I3** notation that cannot be parsed is
  dropped and never printed (a marker must not reach the screen and a malformed call must not
  execute); **I4** output is invariant under re-chunking (property-tested over every two-way split).
  Body shapes it classifies: the spec form `[tool call <name> #<id>]: <json>`, XML
  `<invoke name=...><parameter ...>`, DSML `[tool call <name>">` + `<｜DSML｜ parameter name=...
  string="true|false">...`, and the thinking wrappers `<thinking>` / `<analysis>` (which become
  reasoning, not screen text). **Only a wrapper at a line start (or payload start) opens a block.** An
  inline mention is scrubbed from prose, it does not reclassify the message — measured: an assistant
  explaining the notation lost its own text to the reasoning channel before the fix.
- **v0.0.1 — BOTTOM new: the parser/screen gate.** `lib/display-gate.js` splits the classified parts
  into the two destinations: tool-call parts go to the DSH parser channel (the host parses and
  executes), text/reasoning deltas go to the screen channel, which never receives a marker, an id or
  an argument payload. A body call recovered by the top layer is: **promoted** when no structured
  call of that name exists in the same response; dropped as **echo** when the same call also arrived
  as a wire field (same id, or same name with equal arguments); dropped as **superseded** when a
  structured call of the same name exists with different arguments (measured live: the route
  re-rendered the failed attempt, then sent a corrected call — promoting the stale attempt would
  execute a call the route already replaced); dropped as **undeclared** when the name is not in the
  declared tool set. A promoted call takes the next free block ordinal, so it cannot collide with a
  wire call.
- **v0.0.1 — `lib/http.js` wiring.** The 0.9.0 `reasoningGate` / `textGate` are removed from the
  stream path. The classifier runs on `delta.content`; wire-typed reasoning is stripped of wrapper
  tokens; tool-call parts from `delta.tool_calls` go straight to the parser channel. The gate
  settles once, after the response body is consumed.
- **Canonical docs.** `README.md` (this file) is the canonical, shipped document — it is the only
  markdown file in the package `files` list, so anything a consumer needs must be here. `VERIFICATION.md`
  (current rounds) and `VERIFICATION-ARCHIVE.md` (rounds through 0.7.3) are the internal evidence trail:
  measured commands, transcripts and before/after tables. They are not shipped, and a release is not
  complete until this README carries it.
- Block ordinals: a structured (wire) call uses the OpenAI ordinal `2 + index * 2`. A body call
  promoted by the gate takes the next free ordinal after the structured ones, so two blocks never
  share an index and the old `1000 + n * 2` inline range is still gone.
- **v0.7.4 — the notation is removed, not merely parsed.** 0.7.3 converted only well-formed
  markers and passed every other shape through, so a stray `</thinking>`, a marker followed by
  prose, or a marker with broken JSON still appeared in the transcript. `sanitizeProtocolText()`
  now runs on every text fragment (and on reasoning): thinking tags are dropped, and any
  `[tool call …]` marker is dropped together with its JSON payload when that payload parses. A
  marker whose tool is **not** declared is dropped and never executed. Text with no marker is
  untouched.
- The per-delta routing trace (`OPENCODE_V2_ROUTING_DEBUG`, `/tmp/opencode-v2-routing.jsonl`) was
  removed in 0.8.0 together with the router. The boot beacon (`/tmp/opencode-v2-boot.jsonl`) stays:
  `OPENCODE_V2_BEACON=0` disables it. The guard is inverted relative to the 0.7.3 docstring; treat
  the file as on unless explicitly disabled.
- **v0.0.1 — the beacon proves a restart with zero model requests.** `lib/http.js` writes
  `bootBeacon('load')` once at module evaluation, in addition to the existing `('stream')` event on
  the first real request, into the same `/tmp/opencode-v2-boot.jsonl` and with the same `VERSION`
  constant. A restart is verified by **pid + event**, not by a version string, because the test
  suite writes beacons too. Read-only check (workspace root, not this package):
  `scripts/verify-opencode-v2-restart.sh` prints unit state, serving pid, process start, source
  version, that pid's beacon (version, events, last), other beacon pids, and a verdict: `PASS`
  (beacon version = source version), `STALE` (differs), `PENDING` (process predates the newest
  source edit), `UNDECIDED` (newer but no beacon). `--wait <seconds>` waits for `MainPID` to
  change; exit codes 0/1/2.

### Tool-call arguments, body payloads and the tolerant marker family (v0.0.1-rc.1 / rc.2 / rc.3 — measured 2026-11-01)

Two argument-boundary defects were fixed on the `0.0.1` baseline; the router, the state machine and
the parser/screen gate are untouched. Source: session `2dc3531f-1b50-406e-bacc-9ce73345e193`
(80 tool calls, 30 host rejections, 4 payloads shown as prose).

| Piece | Behaviour |
|---|---|
| `lib/arguments.js` `normalizeArguments(raw, schema)` | pulls **every complete JSON snapshot** out of the raw accumulator, unwraps the `{"arguments": "<json>"}` form, and chooses against the declared tool schema: the last snapshot whose keys fit `properties` and which carries every `required` key. No schema: the last complete snapshot. Unparsable input is returned unchanged, so the host's own error is preserved. |
| `lib/http.js` call sites | normalization runs when a tool-call block closes (normal and cut paths) and where the display gate compares a body call against the structured calls. |
| `lib/http.js` held JSON probe | text that **begins** the visible response with `{` or a fenced block is held until it parses; `inferToolFromArguments` then infers the tool and, when exactly one declared tool fits, the payload is promoted to a real tool-call part and never displayed. No match: the held text is released unchanged. JSON embedded later in prose is never probed. |
| gate rule | if every structured call of a name has unusable arguments, the body payload is promoted as its replacement; otherwise echo / superseded / undeclared apply as before. |

Measured: corpus of 267 `opencode-route` sessions / 16,709 tool calls — invalid arguments **44 → 0**
(snapshot modes: 16,665 valid, 32 duplicate, 12 restated); 4 bare-JSON payloads, all matched to a
declared tool, **none displayed**. The reported session: **30 → 0** invalid and **4 → 0 displayed**
(4 matched to `run_code`). Tests: `test/arguments.test.mjs` (15) and five end-to-end cases in
`test/http.test.mjs`; `npm test` 277/277. Status: **applied on disk, pending restart** — serving
`pid 2199391` is still `0.0.1`. Detail: `VERIFICATION.md` §40, ledger F-28.

**rc.1's classifier did not recognize the next notation family.** After rc.1 the route/model started
writing tool calls into `content` in a corrupted family — `<tool_call #call_00_…>`,
`<tool call run_code #code_placeholder_001>`, closer-shaped parameter openers
`</│DSML│ parameter name="code">…</│DSML│>`, doubled pipes `</｜｜DSML｜｜ parameter>`, bare
`</│DSML│>`, `<│DSML│parameter name="description">…</│DSML│>`, and mixed
`<tool call run_code #id]: {json}`. The rc.1 classifier matched a hard-coded list of literals; a
replay of those payloads promoted **0 calls and removed 0 characters**, so the notation was printed
verbatim and the intended call never executed — the "cut" the owner saw. `0.0.1-rc.2` replaces the
literal list with shape-based recognition:

| Piece | Behaviour (rc.2) |
|---|---|
| marker head | `^[<\[]\s*tool[ _-]?call\b` — `[tool call`, `<tool_call`, `<tool-call` |
| name | declared tool name in the head, `name="…"`, or schema inference via `inferToolFromArguments` |
| id | `#id` or `id="…"` |
| payload | JSON object after the head, or parameter tags with any invented closer (a parameter opener may be written as a closer); block terminators require `invoke`/`calls`/`tool_calls` |
| pipe glyphs | `｜` / `│` / `\|`, 1–2 repeats, doubled included |
| screen | scrub removes model-written tool/parameter tags and DSML tokens |
| bottom gate | de-duplicates by call id, so a restated call with drifted arguments is promoted once |

Measured across all `opencode-route` sessions: protocol notation present in **333** assistant
messages; strict screen leaks (line-start marker, DSML token, parameter tag) **301 → 4**, and all 4
are prose quoting the notation inside backticks; the looser "any mention" count **333 → 49**, all
prose. Calls promoted from those payloads: **24**; duplicate restatements dropped: **209**. In the
reported session the marker-only payload is dropped (nothing to execute), the mixed payload becomes
1 call with the correct id and JSON arguments and 0 characters shown, and the 6,427-character final
payload collapses to 2 distinct calls. Tests: `npm test` **282/282**; `npm run check` exit 0.
Status at the time: **applied on disk, pending restart** — serving `pid 2251772` was still
`0.0.1-rc.1`. Later measurement: `pid 2325852` runs `0.0.1-rc.2`; rc.3 is on disk only.
Detail: `VERIFICATION.md` §41, ledger F-29.

**rc.2's tests fed whole strings, so they missed the live shape.** On rc.2 (serving
`pid 2325852`, 09:22–09:31 KST) turn 16 of session `2dc3531f…` still showed notation on screen:
steps 3, 4 and 6 printed `<tool call run_code #call_00_…]: {json}`, and step 8 printed a bare code
body whose `<parameter name="code">` opener was gone. **3 of 6** assistant messages leaked; the wire
call was present, so the turn still completed. The classifier recognised the marker only when the
whole marker was in the buffer, but a real SSE stream splits it: `<tool ca` went out as prose before
it could be recognised, and the rest no longer sat at a line start. Replaying the text as one string
hid this (0 leaks); feeding it one character at a time reproduced it (4 of 6 messages).

`0.0.1-rc.3` fixes the boundary in four pieces:

| Piece | Behaviour (rc.3) |
|---|---|
| bounded hold | a trailing fragment that could still become a marker (`<tool ca`, `<tool`, `[`+tool…), a DSML tag (`</｜DSML｜ calls>`, `<｜DSML｜ invoke name="bash">`, `</│DSML│`, doubled pipes, attribute quotes) or a parameter tag (`<parameter`, `<│DSML│parameter`) is held until the shape is decided |
| `PARAM_BODY` | a standalone parameter tag is dropped together with its value, so a removed opener cannot leave the code body on screen |
| orphan scrub | DSML tokens whose `<` was consumed in an earlier chunk are removed |
| same hold everywhere | the hold also covers piped and attribute-bearing tokens, not only plain ones |

Measured worst-case chunking (3,689 assistant text messages, one character at a time): strict screen
leaks **42 -> 3** (all 3 are prose quoting the notation inside backticks), calls promoted from body
payloads **28**, turn 16 **4/6 -> 0/6**, whole-string feed **4 -> 3**. The earlier rc.2 whole-string
figures (301 -> 4 corpus-wide) stay whole-string measurements and are not chunked evidence. Tests
**286/286** (`npm test`), `npm run check` exit 0; new regressions cover single-character marker
splitting, a split standalone parameter tag, a split attribute-bearing DSML opener, and every two-way
split of a mixed payload. Status: **applied on disk, pending restart** — serving `pid 2325852` runs
`0.0.1-rc.2`; rc.3 source is on disk only, no mount claimed. Detail: `VERIFICATION.md` §42, ledger F-30.

**Not every protocol token is DSML, so the scrub keys on delimiter shape.** After rc.3 the owner
restarted (serving `pid 2339788`, 09:42:39 KST) and ran nine more turns (17-25) with **0 tool
errors**, yet two messages still leaked tokens that are **not DSML**: turn 18 step 6 printed
`<｜End of thought｜>`, and turn 20 step 3 printed `<｜thought>` and `</thought>`. The scrub knew
`｜DSML｜` and the think/thinking/analysis wrappers only, so the model's other pipe-wrapped tokens
and its `thought` wrapper passed through.

`0.0.1-rc.4` replaces the enumeration with family rules:

| Piece | Behaviour (rc.4) |
|---|---|
| generic token scrub | removes **any** `<｜…｜>` / `<│…│>` token, whatever its text — including single-sided forms such as `<｜thought>` — and does not depend on the token crossing a delta whole |
| wrapper family | `thought` is a thinking wrapper next to think/thinking/analysis: `<thought>` opens a reasoning block, `</thought>` closes it, and both are stripped from prose |
| hold | the trailing `<…` prefix hold accepts **any** character, so a token split across deltas is held, not printed |

Measured under worst-case chunking (one character at a time, all `opencode-route` sessions):
strict screen leaks **42 -> 3 -> 1** (rc.2 / rc.3 / rc.4), and the remaining 1 is a false positive
of the measurement regex (a pair of markdown pipes, not notation); whole-string feeding **4 -> 1**;
body calls promoted **28**; **2,728** messages without notation stay byte-identical. Replaying the
two live shapes — turn 18 step 6 and turn 20 step 3 — through rc.4 leaves **no residue**. The
**33** assistant messages since rc.3 contain 1 regex false positive and no real notation. Tests
`npm test` **286/286**, `npm run check` exit 0. Status: **applied on disk, pending restart** —
serving `pid 2339788` runs `0.0.1-rc.3`; rc.4 is on disk only, no mount claimed.
Detail: `VERIFICATION.md` §43, ledger F-31.

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

### Plans, model allow-list and the settings tab (v0.7.0 — measured 2026-10-31)

OpenCode exposes two providers under one account, and the provider id *is* the plan:

| Provider | Plan | Routes measured 2026-10-31 |
|---|---|---|
| `opencode-go` | **Go subscription** | 30 (28 usable, 2 deprecated) |
| `opencode` | **Zen pay-as-you-go** | 19 (7 usable, 12 `Model is unavailable.`) |

The settings tab used to answer "which routes work" by probing every route — one real completion
each, 49 per sweep. The account counts **requests**, so that was the wrong shape. Availability is now
decided from the catalog's provider id plus the plan the operator selects; probing is gone entirely.
The backend's own refusals still get through, but they are recorded for free from real turns.

| Piece | Behaviour |
|---|---|
| `activePlan: 'go' \| 'zen'` | Which plan's routes are usable. Saved through `ctx.settings.update`, so the prompt picker and the checklist never disagree. |
| `enabledModels: string[]` | Allow-list for the picker. **Empty = every route the active plan offers.** Checked models are the only ones the prompt picker shows; sessions that already selected a hidden route keep running (display-only requirement). |
| `listModels()` | Keeps the `default` row, then `active plan ∩ allow-list`. No backend request is made to decide this. |
| `lib/plans.js` | `planOfRoute()`, `availabilityOf()`, `orderModels()`: usable first, then by public usage rank, then by name; the other plan's routes stay visible but disabled. |
| `lib/client.js` | **OpenCode V2** settings section (`settings.section`, order 60): a Go/Zen plan switch, the checklist with the state badge beside the checkbox, *Select all usable*, *Clear all*, *Save*, *Refresh usage ranking*. Nav label follows the UI locale (`오픈코드 V2` / `OpenCode V2`). |
| `opencode-model-verdicts.json` | Refusals the backend reported during real traffic (`{verdicts, measuredAt}`), written only when a state changes. Empty is the normal case. |
| `opencode-data-ranking.json` | Cached `opencode.ai/data/index.json` ranking (`{byModel, updatedAt, fetchedAt}`), refreshed at most once per `rankingTtlMs` (**5 days**). |
| `opencode-known-models.json` | First-seen timestamp per route. A route that appears later sorts first for `newModelDays` (7) and is offered in the prompt picker even when the allow-list is set — the plan gate still applies. The first run seeds the whole catalog at the epoch, so an existing deployment does not label all 49 routes as new. |
| `/api/local/opencode-v2/model-settings` | Catalog (annotated + ordered), active plan, allow-list, visible routes, observed refusals, ranking metadata. |
| `/api/local/opencode-v2/model-settings/apply` | Persists `{enabled?, activePlan?}` through `ctx.settings.update('dsh-opencode-v2-http', …)`. |
| `/api/local/opencode-v2/model-settings/ranking/refresh` | One GET against `opencode.ai/data/index.json` — unrelated to the model request quota. |

The per-route sweep (`measureEntitlement`, `model-settings/measure`) was **removed** in 0.7.0: it cost
one backend request per route per press.

`inject` now includes `connection` and `settings`: reading an undeclared service throws and takes
the whole plugin entry down (measured in an isolated boot). A host without them still boots; the
settings routes are simply absent.

The same rule applies to the browser half, and v0.6.0 broke it: `lib/client.js` declared
`const inject = ['slots']` and called `ctx.slots.inject(…)` but exported only `apply`, so the loader
never injected `slots`, `apply()` threw, and the **entire web shell** stopped mounting
(`web boot: 1 entry did not activate`). Fixed in **0.6.1** (`exports.inject = inject`, also on the
default export face) with a contract test that asserts every `ctx.<service>` used in the client half
appears in its exported `inject`. Note what does *not* catch this: `--dump-config`, a 200 on the
served bundle, route probes and `node --check` all pass while the client module is unloadable — only
a browser boot proves activation.

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
│   ├── upstream-map.js   # OpenAI / AI SDK delta -> typed part (reasoning | text | tool-call)
│   ├── stream-parser.js  # TOP: explicit state machine, content -> typed parts
│   ├── display-gate.js   # BOTTOM: parser channel vs screen channel
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
```