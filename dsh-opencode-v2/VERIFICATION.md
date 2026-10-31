<!-- skeleton:
version: 1.4
kind: ver
status: active
updated: 2026-11-01
summary: Current verification rounds for the opencode-v2 plugin, v0.7.4 and later, through v0.0.1. Older rounds live in VERIFICATION-ARCHIVE.md.
-->
# @nolit/dsh-opencode-v2 - Verification (current)

> Only the recent rounds live here. Everything up to v0.7.3 is in
> VERIFICATION-ARCHIVE.md in this directory.
>
> Live runtime: DSH 0.2.2-alpha.2 - Node v24.22.1 - plugin 0.0.1 on disk (the serving process still runs 0.9.0 until restart)

## 33. v0.7.4 — no protocol notation reaches the transcript (measured 2026-10-31 23:20-23:40)

### 33.1 What the owner saw and what it was

After 0.7.3 the owner still saw blocks like
`[tool call bash #call_736b…]: {"command":…}` and a stray `</thinking>` inside assistant
**text**. Measurement of the live session record `session-45134ad1` (the session that produced the
screen) fixed the facts:

| Measurement | Value |
|---|---|
| Serving adapter (`request/header`) | `provider: opencode-http-agent` — this plugin |
| Structured tool-call blocks | **149** (endpoint and protocol are fine) |
| Literal `[tool call ` inside assistant **text** | **80** (turn1 13, turn2 13, turn3 20, turn4 34, turn5 0) |
| Stray `</thinking>` with no opener | present in the same blocks |
| Client bundles containing a `[tool call …]` template | **none** — so the UI did not synthesise it; it was stored content |
| Service restart | 23:11:13, single process, `NRestarts=0`, no bytecode cache |

0.7.3 converted only the **well-formed** `[tool call name #id]: {json}` shape and passed every
other shape through "byte for byte": a stray closer, a marker with prose, or a marker with
broken JSON all survived. The new tests had covered only the well-formed case, which is why
229/229 was green while the screen was not clean.

### 33.2 What changed

- `sanitizeProtocolText()` runs on **every** text fragment (and on reasoning), so no protocol
  marker can reach the model-visible text: `<thinking>`/`</thinking>`, and any
  `[tool call …]` marker — with its JSON payload when that payload parses, without it otherwise.
- A marker whose name is **not** a declared tool is stripped and never executed (0.7.3 kept it
  as literal text).
- A marker holding a stray `</thinking>` in the middle of a sentence is fixed in place.
- `OPENCODE_V2_ROUTING_DEBUG=1` writes one JSONL line per content delta to
  `/tmp/opencode-v2-routing.jsonl` (raw delta + routing decision), so a future recurrence can be
traced without guesswork. Off by default; failures are swallowed.
- `package.json` `0.7.4`.

### 33.3 Verification

```
$ npm run check   -> CHECK OK
$ npm test        -> tests 237 / pass 237 / fail 0   (229 before; 6 router + 2 stream new)
```

New router tests are the shapes that were still on screen: stray closer, marker with prose,
marker with broken JSON, marker mid-sentence, and the **verbatim leaked block** from the session
record. Each asserts that no `[tool call ` and no `thinking>` survives in the text parts.

### 33.4 Status

`applied pending restart` at the time of writing; the restart that loads it is scheduled and the
mount is verified in the boot log afterwards. Known residual: a marker whose JSON payload does
**not** parse keeps its (harmless, still textual) payload fragment; the notation itself is gone.

## 34. v0.7.6 — a split marker is held, not released (measured 2026-11-01)

### 34.1 What was still wrong after 0.7.4

0.7.4 promised "no protocol marker reaches the model-visible text, ever". It held a tag split
*inside an opener* and the `<thinking>` body, but a `[tool call …` marker that arrived **without
its closing `]`** fell straight through `drainCall()`'s last branch and was pushed out as text.

The router therefore worked only when the whole marker landed in one SSE chunk — which is the
case that never happens live.

### 34.2 Measured reproduction (before the fix)

| Delta shape | Result |
|---|---|
| whole marker in one delta | `tool-call` (correct) |
| split **before** the closing `]` | `text:"[tool call bash #"`, `text:"c1"`, `text:" ]: {…}"` — **leaked** |
| split right after the tool name | `text:"[tool call bash"`, `text:" #c1]: {…}"` — **leaked** |
| split inside the opener (`[tool ca` / `ll …`) | `tool-call` (correct) |
| `<thinking>` split across deltas | `reasoning` (correct) |

The live stream of session `e9c75e9a` split exactly like row 2, recorded in the stored
`text-chunks` as `[tool call bash #` | `chatcmpl-t` | `ool-f82` | `dc4b5b1582ac5` | `]: {…}`.
13 of that session's 24 assistant messages carried the notation in their **text** part.

Why the last mile did not catch it: `sanitizeProtocolText()` runs per fragment and its
`CALL_MARKER` also requires the closing `]`, so it only ever stripped strings that were already
intact. `http.js` applied sanitising to reasoning only (`:1322`); text was forwarded verbatim.

### 34.3 What changed

- `drainCall()` now **holds** any prefix that can still become a marker — `[tool call …` with no
  `]` yet, or `<invoke …` with no `>` yet — bounded by `maxHold`, so a literal mention in prose
  cannot wedge the stream.
- A complete-but-invalid marker goes through the new `stripLeadingMarker()`: the syntax is
  dropped, the prose around it is kept.
- `sanitizeProtocolText()` also removes `<invoke>…</invoke>` blocks and stray
  `<invoke>`/`<parameter>` tags, which 0.7.4 did not cover at all.
- Last-mile net: every `text`/`reasoning` block is re-sanitised when it is closed, in both
  `closeAll()` and `closeCut()`.

### 34.4 Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` | **243/243 pass, fail 0** (was 237; +5 router cases, +1 route case) |
| Split-before-`]` case | now one `tool-call`, zero text |
| Recorded live delta split | one `tool-call`, text is exactly the prose |
| Route-level SSE split test | `block-end` tool-call `{"command":"ls -la"}`, no `[tool call ` anywhere in the chunk stream |
| Artifact | `artifacts/nolit-dsh-opencode-v2-0.7.6.tgz`, SHA-256 `def0ff0f7b58a220c38a98b165246197b8b4fb0da1ffcfcd71857df0f6691049` |

### 34.5 Status

**`done`** — the restart happened and the live transcript was re-measured (§34.6). At the time this
section was first written the status was `applied pending restart`; that line was measured false at
00:12:41 and is corrected here rather than deleted.

Restart facts (measured, not inferred):

| Measurement | Value |
|---|---|
| Old process | killed at 00:12:38 KST (`code=killed, status=9/KILL`) |
| Restart | `dsh-web.service` `Restart=always` → scheduled restart, `NRestarts=1` |
| New process | `MainPID 1861680`, `ExecMainStartTimestamp` 2026-11-01 00:12:41 KST |
| Listener | `127.0.0.1:3080` owned by `1861680` |
| Module resolution | `profiles/web/node_modules/@nolit/dsh-opencode-v2` → symlink to this workspace |
| Patched sources | `lib/inline-tags.js` 00:01:26, `lib/http.js` 00:01:44 — both older than the process start, so 0.7.6 is what the process loaded |

Known residual: a marker whose JSON payload does not parse keeps a harmless textual payload
fragment; the notation itself is gone.

### 34.6 Post-restart live measurement (2026-11-01 00:13–00:21 KST)

Method: decompress every `~/.dsh/sessions/**/session.v4.jsonl.zstd`, take each `assistant/message`
event, split on the restart epoch (00:12:41), and count `content[]` parts by type; a `text` part is
counted as a leak when it matches `\[tool call`, `<invoke` or `<parameter`.

| Window | Assistant messages | `text` parts | `text` parts carrying notation | `tool-call` parts |
|---|---|---|---|---|
| Before restart (6 sessions) | 656 | 317 | **165 (52.1%)** | — |
| After restart (session `8859609a`, route `opencode-go/deepseek-v4.1-flash`) | 15 | 1 | **0 (0.0%)** | 19 |

Per session, before window: `e9c75e9a` 62 msgs / 43 text / 23 leaks; `f8c40e19` 301 / 133 / 40;
`45134ad1` 117 / 53 / 43; `6d3263c3` 131 / 64 / 51; `a06efaa2` 33 / 15 / 6; `dd6919f9` 12 / 9 / 2.
After window: `8859609a` 15 / 1 / **0**, with 19 `tool-call` parts — every marker of that window became
a tool call and none became text.

| Check | Result |
|---|---|
| `npm test` on the committed tree, after the restart | **243/243 pass, fail 0** |
| `npm run docs:check` on the committed tree | **FAILED** — stale `INDEX.md`/`docs/SKELETON.md` (the 00:07 card was generated after the last index run); fixed in the follow-up commit, see F-19 |
| Artifact hash | `sha256sum` matches `artifacts/SHA256SUMS.opencode-v2` |

Caveat carried forward: 15 post-restart messages with a single 1-character text part is a thin sample
for the *prose-preserved* half of the fix; that half rests on the unit and route tests (§34.4), not on
this window.

## 35. v0.7.7 — the compaction scratchpad, and why this is not a bespoke "dialect" table

### 35.1 What was still on screen (measured 2026-11-01 00:48 KST)

The 0.7.6 fix closed the streaming marker leak. It did not close the whole class. Scanning every
`assistant/message` `text` part in every session log and splitting on the 00:12:41 restart:

| Notation reaching TEXT | before restart | after restart |
|---|---|---|
| `[tool call` | 219 | 1 (prose quoting it) |
| `</thinking>` / `<thinking>` | 89 / 64 | 0 / 0 |
| `<invoke>`, `<parameter>`, `<name>`, `<function_results>`, `<result>`, `<output>` | 18 / 10 / 13 / 5 / 5 / 5 | 0 |
| **`<analysis>` / `<summary>`** | **3 / 3** | **2 / 2** |

So one family was still live: the compaction wrappers. Calling it out of scope was wrong; it is the
same defect class as the rest.

### 35.2 Prior art — this is a known bug with known fixes

The wrappers are not invented by this adapter. The compaction prompt in this lineage says, verbatim:
"Your entire response must be plain text: an `<analysis>` block followed by a `<summary>` block"
(Claude Code `/compact` prompt, reproduced in `claude-code-system-prompts`). The `<analysis>` block is
a **drafting scratchpad**, not answer text. Upstream projects treat its leak into visible output as a
bug and fix it at the boundary:

- `QwenLM/qwen-code#6023` — "Subagent final result leaks `<analysis>`/`<summary>` tags into parent
  context and breaks daemon UI markdown rendering". Their conclusion: the pollution exists *before*
  rendering; the tool result must not carry the scratchpad.
- `QwenLM/qwen-code#6595` — "may leak `<analysis>`/`<summary>` tags in main assistant responses".
- `windmill-labs/windmill#9750` — "strip unclosed `<summary>` tag leaking into compaction summary".
- `nccasia/agent-sdk` — "strip inlined ` thinking` reasoning from answers" (DeepSeek-R1 / Qwen / MiniMax
  emit chain-of-thought inside `message.content`; the client adapts it).

The common rule: **classify the wrapper onto the transport's own fields** — reasoning/scratchpad stays
invisible, the answer stays visible — instead of deleting strings per tag.

### 35.3 What changed

- `dropScratchpad()` in `lib/inline-tags.js`: when a text block **starts** with `<analysis>` (the real
  failure shape), the scratchpad is dropped — through `</analysis>`, or up to `<summary>`, or to the
  end when the model never closed it.
- `SUMMARY_TAG` unwraps `<summary>`/`</summary>` wherever it appears and keeps the prose.
- Guard: a *mention* of `<analysis>` inside a sentence or a code fence is left alone, so documentation
  and reports stay readable.
- `hasInlineTags()` now recognises both wrappers.

### 35.4 Verification

| Check | Result |
|---|---|
| `npm run check` | clean |
| `npm test` | **248/248 pass, fail 0** (was 243; +5 wrapper cases) |
| Replay of every recorded `text` part carrying notation (226) through `sanitizeProtocolText` | **203 fully clean**; the 23 survivors are prose that *describes* the notation (sampled and confirmed), preserved on purpose |
| Artifact | `artifacts/nolit-dsh-opencode-v2-0.7.7.tgz`, SHA-256 `9f394d43600b73b94487f119202cfc235d1167dad9e6e1bc9d1822334666c8f2` |

### 35.5 Status

`applied pending restart` — the live 3080 process still serves 0.7.6.

## 36. v0.7.8 - the regex filter is gone, a state machine parses the stream

### 36.1 Why the rewrite

The 0.7.3-0.7.7 router re-scanned and rewrote accumulated text with twelve
module-level regexes. Two consequences, both measured:

- the same input classified differently depending on where the SSE stream split;
- notation was hidden by deleting body text, and a sentence that merely mentioned
  a tag lost the prose that followed it.

### 36.2 What replaced it

lib/stream-parser.js - one pass, explicit states:

| State | Meaning |
|---|---|
| TEXT | emitting prose; holds at most a marker prefix |
| REASONING | inside a thinking or analysis block, emitting reasoning |
| TOOL_HEAD | read after the bracket opener: name and optional id |
| TOOL_ARGS | read exactly one JSON object, brace and string aware |
| INVOKE_HEAD | read an XML-shaped invoke block |

Model: Vercel AI SDK stream parts (text / reasoning / tool-input) and the
assistant-ui assistant-stream chunks.

Four invariants, each one a defect this file exists to prevent:

1. I1 - text is emitted once, in order, verbatim;
2. I2 - while in TEXT only a bounded suffix is held;
3. I3 - a marker that cannot be parsed degrades to text, never swallowed;
4. I4 - output is invariant under re-chunking.

### 36.3 Deleted

- the 424-line regex body of createInlineTagRouter (inline-tags.js is now 245
  lines and delegates to the parser);
- the block-end sanitizeProtocolText net in http.js closeAll() and closeCut().

### 36.4 Verification

| Check | Result |
|---|---|
| npm run check | clean |
| npm test | 258/258 pass (was 248; +10 parser cases) |
| I4 two-way split | every fixture, every cut, identical output |
| I4 random multi-way | 40 random splits per fixture, identical output |
| Boundary defects the property test found during development | 4 |

### 36.5 Status

applied pending restart - the live 3080 process still runs 0.7.7.

## 37. v0.8.0 — boundary pipeline: the wire field decides the type (measured 2026-11-01)

### 37.1 Why a text scanner was the wrong layer

Measured from the recorded per-delta trace (`/tmp/opencode-v2-routing.jsonl`, 29,940 content deltas, two models):

| Measure | Value |
|---|---|
| content deltas traced | 29,940 |
| pure text, no notation | 11,256 (37.6%) |
| carried transcript notation | 495 (1.7%) |
| reasoning deltas, every one re-sanitised per fragment | 11,061 |
| structured tool-call deltas | 153 |

More than 98% of deltas paid for a scanner that could only ever matter for 1.7%, and every
reasoning delta was rewritten on the way through. The type is already on the wire.

### 37.2 What changed

| File | Change |
|---|---|
| `lib/upstream-map.js` | new: `mapChatDelta(delta)` returns reasoning parts, then text parts, then tool-call parts (ordinal plus this delta's argument fragment) |
| `lib/stream-parser.js` | 337 -> 55 lines: a pass-through reducer. No tags, no buffers, no state machine; `push(parts)` returns those parts unchanged |
| `lib/http.js` | one call per delta: `reduce.push(mapChatDelta(delta, { reasoningField }))`; `emitPart` keys tool calls by ordinal; router, sanitiser and routing trace deleted |
| `lib/inline-tags.js` | deleted |
| `inlineTags` config | deleted; there is nothing left to toggle |
| `test/stream-parser.test.mjs` | rewritten: 17 contract tests, including notation text returned verbatim |
| `test/upstream-map.test.mjs` | new: 10 field-shape tests |
| `test/http.test.mjs` | 6 tag tests -> 4 boundary tests |
| `test/inline-tags.test.mjs` | deleted |

### 37.3 Verification

| Check | Result |
|---|---|
| baseline before this round | 260 tests, 260 pass, 0 fail |
| `npm run check` | exit 0, clean |
| `npm test` | 245/245 pass, 0 fail |
| `node --check` on the three touched modules | exit 0 |

### 37.4 The consequence, stated plainly

A route that puts transcript notation inside `delta.content` now shows that notation as text.
The adapter no longer guesses, so the measured 1.7% becomes visible instead of being rewritten.
That is the deliberate trade: the wire field is authoritative. Correcting such a route belongs to
the route (use the structured fields) or to a renderer that is told the type — not to a character
scanner inside the adapter.

### 37.5 Status

applied on disk; the live 3080 process still runs the previous build until restart.

## 38. v0.9.0 — display cleaning of the two route scaffoldings (measured 2026-11-01 04:35-04:50)

### 38.1 What 0.8.0 exposed, measured

0.8.0 stopped rewriting text, and the real session that produced the screen
(`/tmp/sess.ndjson`, 11 assistant messages, `opencode-go/deepseek-v4.1-flash`) showed two
shapes, not a dialect:

| Shape | Where | Measured |
|---|---|---|
| literal `<thinking>` / `</thinking>` | inside *reasoning*, at arbitrary offsets (257, 764, 1378...) | 6 of 11 reasoning parts; 19 tokens |
| `[tool call <name> #<id>]: <json>` | inside *text*, starting a line and running to the end of the part | 2 blocks; 1,549 of 1,923 text chars (80.6%) |

### 38.2 What changed

| File | Change |
|---|---|
| `lib/display-clean.js` | new: `stripThinkingTags`, `parseToolCallEcho`, `echoMatchesStructuredCall`, `dropEchoTail`, `cleanParts`, and the streaming gates `createReasoningGate` / `createTextGate` |
| `lib/http.js` | +40 lines: both gates in the stream path, flushed with the structured calls before `closeAll`, reset on retry/cut |
| `package.json` | 0.8.0 -> 0.9.0; `check` covers `display-clean.js` |
| `test/display-clean.test.mjs` | new: 8 tests (tokens anywhere, echo match by id and by name+args, non-echo line released, non-terminal echo kept) |
| `test/display-gate.test.mjs` | new: 5 tests (split token, bounded hold, prose not delayed, echo held then dropped, held non-echo released) |
| `test/http.test.mjs` | the "reasoning verbatim" contract test updated: the two tokens are removed |

### 38.3 Verification, real model

The adapter was attached to the running CLI daemon (`~/.local/state/opencode/service.json`,
`/api/info` 200) and streamed real requests; baseline was the live 0.8.0 `lib/http.js`, gated was
this build. Models `opencode-go/deepseek-v4.1-flash` (effort high) and `opencode-go/beam-free`.

| Check | Result |
|---|---|
| `npm run check` | exit 0 |
| `npm test` | 258/258 pass, 0 fail (245 before; +8 +5 new, 1 updated) |
| A/B live runs (6 plain + 3 tool calls + 2 free route) | 11/11 clean (0 thinking tokens, 0 echo after) |
| gated output vs offline `cleanParts` of the same real stream | 11/11 identical |
| structured tool calls | 3/3 complete, arguments valid JSON, identical to baseline |
| latency, gated vs baseline (first text delta) | 0.93-1.22 s vs 1.00-1.84 s; max inter-chunk gap 12-69 ms vs 33-41 ms |
| plain text deltas held | 0 of 74 live text deltas |
| replay of the recorded leaking session | 19 tokens removed, 2 echo tails dropped, non-echo text byte-identical, 0 order violations |
| gate replay of 33,977 recorded real deltas | 483,609 chars in = 483,609 out; 0.46 us/delta |

### 38.4 Corrections and limits, stated plainly

- The earlier `deltasWithHold: 33921 / 99.835%` number measured per-push deferral over an entire
  unflushed trace, not latency. Retracted; superseded by the latency row above.
- The live route did not reproduce the leak in these 11 runs (baseline leaked 0), so the live runs
  prove the gates are transparent; the recorded session proves they remove. Re-measuring the leak
  live needs a route that leaks again.
- An echo line that is not at the end of a text part is released, not dropped (the tail parser
  requires the whole remainder). Both measured real echo cases were terminal.

## 39. v0.0.1 — TOP state machine restored, BOTTOM parser/screen gate added (measured 2026-11-01)

### 39.1 What this round is

0.8.0 deleted the 0.7.8 state machine without an instruction and reduced `lib/stream-parser.js` to a
55-line pass-through (commit `e1ef561`: 366 -> 55 lines; `lib/inline-tags.js`, 245 lines, deleted).
0.9.0 answered the resulting leak with a display-only filter that mutates the single text stream, so
the parser channel and the screen channel could not be separated. The owner reset the version and
forbade further self-bumps.

| Item | Measured |
|---|---|
| `package.json` | 0.9.0 -> 0.0.1 |
| `lib/http.js` load-beacon `VERSION` | 0.9.0 -> 0.0.1 |
| Versions self-bumped before the reset | 26 (`0.1.1` ... `0.9.0`) |
| Version rule now | no bump except on explicit owner instruction, and then only `0.0.1.rc<N>` |

### 39.2 What changed

| File | Change |
|---|---|
| `lib/stream-parser.js` | TOP restored: explicit state machine (455 lines), states TEXT / REASONING / TOOL_HEAD / TOOL_ARGS / DSML_ARGS / INVOKE_HEAD |
| `lib/display-gate.js` | BOTTOM new: parser channel vs screen channel; promote / echo / superseded / undeclared |
| `lib/http.js` | the 0.9.0 reasoningGate / textGate removed from the stream path; classifier runs on `delta.content`; wire-typed reasoning stripped of wrapper tokens; tool-call parts go straight to the parser |
| `lib/display-clean.js` | retained but no longer on the stream path (only `stripThinkingTags` is used) |
| `test/stream-parser.test.mjs` | rewritten for the classifier: 11 tests, incl. DSML and a two-way-split invariance loop over every cut position |
| `test/display-gate.test.mjs` | new: 8 gate tests |
| `test/http.test.mjs` | +2 end-to-end: an echo of a wire call is dropped (one call block, not two); DSML notation reaches the parser while the screen text stays clean |
| 0.9.0-era tests | 2 flipped from "notation stays text verbatim" to the new contract |

### 39.3 Tests

| Check | Result |
|---|---|
| `npm run check` | exit 0 |
| `npm test` | 257/257 pass, 0 fail |

### 39.4 Replay of the recorded corpus

Source: 1455 assistant text messages from the `opencode-route` sessions under `~/.dsh/sessions`,
read with `zstd`, replayed through the 0.0.1 classifier and gate.

| Measure | 0.9.0 (recorded) | 0.0.1 replay |
|---|---|---|
| messages with screen-visible notation | 316 | 13 |
| marker occurrences | 703 | 0 |
| `<thinking>` tokens | 448 | 0 |
| `<analysis>` tokens | 36 | 0 |
| `｜DSML｜` tokens | 124 | 7 |
| `<invoke` | 12 | 4 |

The 7 surviving `｜DSML｜` occurrences are prose sentences that discuss the token inline, and the 4
`<invoke` survivors are inline prose too. No protocol notation is printed.

### 39.5 Live window

Window: the 0.9.0 build only, since 2026-10-31T19:53:06Z — 65 assistant messages.

| Measure | 0.9.0 | 0.0.1 replay |
|---|---|---|
| leaky messages | 20 | 7 |
| marker occurrences | 14 | 0 |
| `<thinking>` tokens | 26 | 0 |
| `<analysis>` tokens | 12 | 0 |
| `｜DSML｜` tokens | 42 | 4 (inline prose) |

| Body calls recovered from text | Count |
|---|---|
| promoted to the DSH parser | 5 |
| dropped as echo | 1 |
| dropped as superseded | 7 |

44 of the 45 notation-free messages are byte-identical after the replay; the one that differs is
not a notation case.

### 39.6 Load beacon — a restart proof with zero model requests

A `stream` beacon only appears once a request starts, and the test suite also writes beacons, so a
restart could not be proven without spending a model request. `lib/http.js` now writes
`bootBeacon('load')` at module evaluation, into the same `/tmp/opencode-v2-boot.jsonl` and with the
same `VERSION` constant.

| Item | Measured |
|---|---|
| `lib/http.js` | `bootBeacon('load')` at the end of the module; the `stream` event is unchanged |
| Tests after the change | 257/257 pass, 0 fail; `npm run check` exit 0 |
| Re-packed artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1.tgz`, SHA-256 `5c73f5c61b795f63e5b3860f3c1e630e6c01a18dc447cd32c1c9829ac30ba904` (supersedes `67a2d7b24f4291a367188b722b11d1b27215cfb8e57e58d941fd39b3d5546094`) |
| `artifacts/SHA256SUMS.opencode-v2` | carries the new `5c73f5c6...904` |

### 39.7 Post-restart verification helper

`scripts/verify-opencode-v2-restart.sh` (workspace root; read-only, never restarts anything, never
calls a model) prints unit state, serving pid, process start, source version, the newest source
file, the beacon for that pid (version, events, last), other beacon pids, and a verdict: `PASS`
when the serving pid's beacon version equals the source version, `STALE` when it differs,
`PENDING` when the process predates the newest source edit, `UNDECIDED` when the process is newer
but wrote no beacon. `--wait <seconds>` waits for `MainPID` to change; exit codes 0/1/2.

Measured before the restart (2026-11-01 06:48 KST):

| Field | Value |
|---|---|
| unit | `dsh-web.service (active)` |
| serving pid | `2091170` |
| process start | 2026-11-01 04:53:07 KST |
| source version | `0.0.1` |
| beacon(pid=2091170) | `0.9.0 events={"stream":84} last=2026-10-31T21:21:51.801Z` |
| other beacon pids | other processes that loaded the plugin at `0.0.1` — test runs or failed boot attempts, not the serving process |
| verdict | `STALE - pid 2091170 loaded 0.9.0, source is 0.0.1` |
| exit | 1 |

Expected after the restart:

| Field | Expected |
|---|---|
| serving pid | a new pid; the old pid is gone |
| beacon(pid=<new>) | `0.0.1 events={"load":1,...} last=<iso>` |
| verdict | `PASS - serving pid <new> loaded 0.0.1` |
| exit | 0 |

### 39.8 Status

**`applied on disk, pending restart`.** The running service (`pid 2091170`, started
2026-11-01 04:53:07 KST) still serves the previous 0.9.0 code; the helper reports `STALE` (exit 1),
which is the correct pre-restart verdict. The new source is on disk and is not live; no mount is
claimed here.

### 39.9 Measured after the restart (2026-11-01 06:52 KST)

| Field | Measured |
|---|---|
| restart sequence | old `pid 2091170` ended `status=9/KILL` at 06:52:15 (port not released); `2199034` (06:52:18) and `2199192` (06:52:25) both failed with `webserver (required) … EADDRINUSE 127.0.0.1:3080`; `2199284` (06:52:32) came up, printed the URL and was killed at 06:52:36; `2199391` started 06:52:39 and is serving; a further attempt `2199413` loaded the plugin and then hit the same EADDRINUSE at 06:52:45 |
| serving pid | `2199391` (start 2026-11-01 06:52:39 KST, `NRestarts=4`) |
| listener on 3080 | exactly one: `pid=2199391` |
| beacon(pid=2199391) | `0.0.1 events={"load":1} last=2026-10-31T21:52:41.449Z` |
| journal after 06:52:39 | no `did not activate`, no `startup failed`, no `EADDRINUSE` |
| helper verdict | `PASS - serving pid 2199391 loaded 0.0.1`, exit 0 |
| artifact | `5c73f5c6…904` (matches `SHA256SUMS.opencode-v2`) |

Two things this measurement does **not** claim:

1. The two failed boots were **not** caused by this plugin. The failing required plugin was
   `@deepseek-ai/dsh-host-webserver` (EADDRINUSE on 3080), and `include:dsh-opencode-v2` plus
   `include:dsh-opencode-v2-http` are present in the serving process's diagnostics. The port was
   still bound because the previous process was killed with SIGKILL instead of being stopped by
   systemd (ledger F-20); the cascade is the cost of that, not a mount defect.
2. No `stream` event exists for `2199391` yet: the opencode route has not served a request since
   the restart. `load` proves the module was evaluated in the serving process; a single live
   request would add `"stream":1` and exercise the restored classifier and the bottom gate on
   real traffic. That request spends account quota, so it is left for an explicit instruction.

Restart procedure that avoids the cascade: `systemctl --user restart dsh-web.service` (never kill
the port holder), then `scripts/verify-opencode-v2-restart.sh`.

