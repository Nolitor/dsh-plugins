<!-- skeleton:
version: 2.2
kind: ver
status: active
updated: 2026-11-03
summary: Current verification rounds for the opencode-v2 plugin, v0.7.4 and later, through v0.0.1, 0.0.1-rc.1, 0.0.1-rc.2, 0.0.1-rc.3, 0.0.1-rc.4 (protocol tokens scrubbed by delimiter shape, not by the DSML text; worst-case one-character feeding 42 -> 3 -> 1, the remaining 1 a measurement-regex false positive), 0.0.1-rc.5 (synthetic probes rejected as evidence; lib/trace.js records real-traffic shape), 0.0.1-rc.6 (the rc.5 trace measured hasSystem=false on 29/29 real requests and a 58.6% leak rate; system-role messages now keep the system slot and empty tool results keep their call id) and 0.0.1-rc.7 (rc.6 traffic: 155 requests, hasSystem=true 155/155, 56 (36.1%) still leaking mostly in reasoning because only the content channel was classified; reasoning now goes through the same classifier, replay recovers 21 calls and 3 of 6 stalled steps; 295/295) and 0.0.1-rc.8 (assistant history is prose only: the wire no longer carries `<thinking>` wrappers or rendered `[tool call ...]` echoes, -38.7% / -50.3% body size on two recorded sessions, and bare element closers are scrubbed; 298/298) and 0.0.1-rc.9 (the per-turn reservation is separated from the route capability: `defaultMaxTokens` is 16384 instead of the route's `limit.output`, restoring usable context from 55.0% to 80.0% of a 1M window / 91.8% message capacity; the reported "41M cacheRead" was measured to be a 2026-10-29 session, not current code, and was not changed; 305/305). Older rounds live in VERIFICATION-ARCHIVE.md.
-->
# @nolit/dsh-opencode-v2 - Verification (current)

> Only the recent rounds live here. Everything up to v0.7.3 is in
> VERIFICATION-ARCHIVE.md in this directory.
>
> Live runtime: DSH 0.2.2-alpha.3 - Node v24.22.1 - plugin 0.0.1-rc.10 on disk (serving pid 834087
> runs 0.0.1-rc.9 until restart)

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

## 40. v0.0.1-rc.1 — defensive argument accumulation, and a bare-JSON body payload promoted instead of printed (measured 2026-11-01 06:58–07:41 KST)

### 40.1 The measured defect

Source: DSH session `2dc3531f-1b50-406e-bacc-9ce73345e193`, route `opencode-go/deepseek-v4.1-flash`,
workspace `total_skill`, window 2026-11-01 06:58–07:41 KST.

| Measure | Value |
|---|---|
| tool calls in the session | **80** |
| failed in the host with `Error: invalid arguments: "arguments" must be an object` (`ToolArgsError`, code `INVALID_ARGS`) | **30** |
| bare JSON tool payloads displayed as assistant text | **4** |

### 40.2 Root causes

| # | Cause | Measured shape |
|---|---|---|
| 1 | The route **re-sends the whole arguments object as a second delta** instead of a fragment. The adapter appended the second payload to the first, so the host received two concatenated JSON objects (`{"code":…}{"code":…}`); `JSON.parse` failed, and the host reported "must be an object". | 24 of the 30 second copies were exact duplicates; 6 restated the call with changed content; **3** of those second copies arrived wrapped as `{"arguments":"<json>"}`. |
| 2 | After the dispatch error the model re-typed the call as a **bare JSON object inside `content`** with no marker. The 0.9.0/0.0.1 gate knew only `[tool call …]`, DSML and thinking notation, so the payload was classified as prose and displayed. | 4 occurrences in that session. |

### 40.3 What changed

| File | Change |
|---|---|
| `lib/arguments.js` | **new.** `normalizeArguments(raw, schema)` extracts one-or-more complete JSON snapshots from the raw accumulator, unwraps the `{"arguments": …}` wrapper form, and selects the **last snapshot that fits the declared tool's parameter schema** (keys within `properties`, all `required` present); with no schema it keeps the last complete snapshot. Unparsable input is passed through unchanged so the host still reports it — nothing is silently rewritten. Also `inferToolFromArguments`, `scanJsonValue`, `canonical`. |
| `lib/http.js` | applies `normalizeArguments` when a tool-call block closes (normal **and** cut paths) and where the gate compares against structured calls. Adds a **held JSON probe**: when the visible text of a response **begins** with `{` or a fenced block, the text is held until it parses, `inferToolFromArguments` infers the tool, and if exactly one declared tool fits the payload is promoted to a real tool-call part and never shown. If nothing matches, the held text is released unchanged; JSON inside prose is never probed. |
| gate rule | when **every** structured call of that name has unusable arguments, the body payload is promoted as its replacement (the wire call could not execute anyway); otherwise the echo / superseded / undeclared rules apply unchanged. |
| `test/arguments.test.mjs` | **new**, 15 tests: duplicate / restated / wrapped snapshots, schema selection, passthrough of unparsable input. |
| `test/http.test.mjs` | **+5 end-to-end**: duplicated snapshots collapse; bare JSON promoted and hidden; unmatched JSON stays text; JSON after prose stays text; body JSON replacing a broken wire call yields exactly one call. |

### 40.4 Tests

| Check | Result |
|---|---|
| `npm run check` | exit 0 (includes `node --check lib/arguments.js`) |
| `npm test` | **277/277 pass**, 0 fail (new: 15 in `arguments.test.mjs`; 5 new end-to-end in `http.test.mjs`) |

### 40.5 Corpus measurement

Source: 267 `opencode-route` sessions, 16,709 tool calls, replayed through the `0.0.1-rc.1` normalizer.

| Measure | Before | After |
|---|---|---|
| invalid arguments (`INVALID_ARGS`) | 44 | **0** |
| snapshot modes | — | valid **16,665** / duplicate **32** / restated **12** |
| bare JSON text payloads | 4 | 4 matched to a declared tool, **0 displayed** |

### 40.6 The reported session

| Measure | Before | After |
|---|---|---|
| invalid arguments | 30 | **0** |
| bare JSON payloads displayed as prose | 4 | **0** displayed — 4 matched to `run_code` |

### 40.7 Release artifact

| Field | Value |
|---|---|
| `package.json` | `0.0.1` -> `0.0.1-rc.1` |
| `lib/http.js` load-beacon `VERSION` | `0.0.1` -> `0.0.1-rc.1` |
| artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.1.tgz` |
| sha256 | `64be56cd99543754caadcc5459b983c597ac53f226cdd145ded4ab7d99a3fc16` (recorded in `artifacts/SHA256SUMS.opencode-v2`) |

The number advanced because the owner instructed this fix round; the rule stays `0.0.1.rc<N>` and
nothing else moves it.

### 40.8 Status

**`applied on disk, pending restart`.** The running service (`pid 2199391`, started
2026-11-01 06:52:39 KST) still serves `0.0.1`; the `0.0.1-rc.1` source is on disk and is **not
live**. No mount is claimed here, and no live traffic has exercised the new normalizer or the JSON
probe yet.

## 41. v0.0.1-rc.2 — classify the marker by shape, not by a literal whitelist (measured 2026-11-01)

### 41.1 The report and the measured timeline

The owner reported that his turns looked "forcibly cut" and that more errors appeared, pointing at
session `2dc3531f-1b50-406e-bacc-9ce73345e193` (`opencode-go/deepseek-v4.1-flash`, workspace
`total_skill`). The timeline shows no rc.1 regression in that session:

| Window in the session | Measured outcome |
|---|---|
| `0.0.1` — before the 07:54–07:56 KST restart | 30 `ToolArgsError INVALID_ARGS`, all timestamped 06:58–07:41 KST |
| `0.0.1-rc.1` — after the restart | 3 turns, 11 tool calls, **0 tool errors**, every `turn/end` `completed` |

What did change is a **new, corrupted notation family** the route/model began writing into
`content`. The classifier did not recognize it, so the intended call never reached the parser; the
model's own text says "continuing from where it was cut". That is the cut the owner saw.

### 41.2 The four measured payload shapes

| # | Shape | Measured example |
|---|---|---|
| 1 | marker only, no payload to execute | `<tool_call #call_00_…>` |
| 2 | head with a placeholder name/id | `<tool call run_code #code_placeholder_001>` |
| 3 | parameter tags with invented closers (a parameter opener written as a closer) | `</│DSML│ parameter name="code">…</│DSML│>`; doubled pipes `</｜｜DSML｜｜ parameter>`; bare `</│DSML│>`; `<│DSML│parameter name="description">…</│DSML│>` |
| 4 | marker and JSON mixed in one line | `<tool call run_code #id]: {json}` |

### 41.3 Replay through the rc.1 classifier

Those payloads replayed through the `0.0.1-rc.1` top classifier produced **0 calls promoted and 0
characters removed** — every classifier statistic stayed at zero and the notation was displayed
verbatim. The screen showed the marker; the parser never saw the call.

### 41.4 What changed

The top classifier is the same state machine; its marker recognition is no longer a literal list.

| Piece | Behaviour |
|---|---|
| marker head | recognized in any bracket style: `^[<\[]\s*tool[ _-]?call\b` |
| call name | a declared name in the head, `name="…"`, or inferred from the parameter schema with `inferToolFromArguments` |
| call id | `#id` or `id="…"` |
| payload | a JSON object found after the head, or parameter tags with whatever closer the model invented (a parameter opener may even be written as a closer). Block terminators require `invoke`/`calls`/`tool_calls`, so a bare closer stays a parameter closer |
| pipe glyphs | `｜`, `│` or `\|` in any 1–2 repeats, doubled included |
| screen scrub | removes model-written tool/parameter tags and DSML tokens, so they never reach the screen |
| bottom gate | also de-duplicates by call id, so the same call restated with drifted arguments is promoted once |

### 41.5 Before/after measurement

Across all `opencode-route` sessions:

| Measure | Before | After |
|---|---|---|
| assistant messages whose text contained protocol notation | 333 | 333 (same corpus) |
| strict screen leaks (line-start marker, DSML token, parameter tag) | 301 | **4** — all 4 are prose that quotes the notation inside backticks |
| looser "any mention" count | 333 | **49** — all prose |
| calls promoted from those payloads | 0 | **24** |
| duplicate restatements dropped | 0 | **209** |

Reported session, payload by payload:

| Payload | Result |
|---|---|
| marker-only payload | dropped, no call promoted (there is no payload to execute) |
| mixed marker + JSON payload | **1 call**, correct id and JSON arguments, **0 characters shown** |
| 6,427-character final payload | collapses to **2 distinct calls** after id de-duplication |

### 41.6 Tests and release artifact

| Check | Result |
|---|---|
| `npm run check` | exit 0 |
| `npm test` | **282/282 pass**, 0 fail |
| artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.2.tgz` |
| sha256 | `29260240b776708a524e90c5e6b4071557beeb9f6b18908c4ad09befda85e8e3` (recorded in `artifacts/SHA256SUMS.opencode-v2`) |

The number advanced one instructed RC step (`0.0.1-rc.1` → `0.0.1-rc.2`); the rule stays
`0.0.1.rc<N>` and nothing else moves it.

### 41.7 Status

**`applied on disk, pending restart` at the time.** The service was restarted afterwards;
later measurement shows `pid 2325852` runs `0.0.1-rc.2`, and `0.0.1-rc.3` (round 42) supersedes it
on disk only. No mount is claimed here.

## 42. v0.0.1-rc.3 — a whole-string test cannot prove a stream; recognise at chunk boundaries (measured 2026-11-01 09:22–09:31 KST)

### 42.1 Live evidence: turn 16 on rc.2

The owner said work continued after every update but the screen still showed the marker. Measured on
rc.2 (serving `pid 2325852`, 09:22–09:31 KST), **turn 16** of session
`2dc3531f-1b50-406e-bacc-9ce73345e193` still leaked the notation even though the call executed:

| Step | Shape on screen |
|---|---|
| 3 | `<tool call run_code #call_00_…]: {json}` |
| 4 | `<tool call run_code #call_00_…]: {json}` |
| 6 | `<tool call run_code #call_00_…]: {json}` |
| 8 | bare code body — the `<parameter name="code">` opener was removed, the value kept |

**3 of the 6** assistant messages in that turn leaked. The turn still completed because the wire
call was present: the defect was display, not execution.

### 42.2 Why: the classifier needed the whole marker in the buffer

The classifier recognised the marker only when the complete marker was present. A real SSE stream
splits it, so `<tool ca` was emitted as prose before it could be recognised; the remainder no longer
sat at a line start, so the marker never opened. The replay proves the shape dependence:

| Replay of the same turn-16 text | Result |
|---|---|
| one string | **0 leaks** — the bug is invisible |
| one character at a time | **4 of 6 messages leaked** — the live failure reproduces |

That is why rc.2 looked fixed in tests and still failed live: the rc.2 suite fed whole strings.

### 42.3 What changed in rc.3

`0.0.1-rc.3` keeps the parser and the gate; it makes recognition stream-safe.

| # | Piece | Behaviour |
|---|---|---|
| a | bounded hold | a trailing fragment that could still become a marker (`<tool ca`, `<tool`, `[`+tool…), a DSML tag (`</｜DSML｜ calls>`, `<｜DSML｜ invoke name="bash">`, `</│DSML│`, doubled pipes, attribute quotes) or a parameter tag (`<parameter`, `<│DSML│parameter`) is held until the shape is decided |
| b | `PARAM_BODY` | a new state drops a standalone parameter tag and its value, so a removed opener cannot leave the code body on screen |
| c | orphan scrub | removes DSML tokens whose `<` was consumed in an earlier chunk |
| d | same hold | the hold also covers piped and attribute-bearing tokens; it is not limited to plain markers |

The hold is bounded and the buffered fragment is flushed on `final`, so a genuine trailing prefix is
delayed, not lost.

### 42.4 Worst-case chunking measurement

Each of **3,689** assistant text messages across all `opencode-route` sessions was fed **one
character at a time**:

| Measure | rc.2 baseline | rc.3 |
|---|---|---|
| strict screen leaks (line-start marker, DSML token, parameter tag) | **42** | **3** — all 3 are prose that quotes the notation inside backticks |
| whole-string feeding, strict leaks | **4** | **3** (same prose) |
| calls promoted from body payloads | — | **28** |
| turn 16, one character at a time | **4/6 messages leaked** | **0/6** leaked, calls still promoted |

The earlier rc.2 corpus figures (**301 -> 4**) were measured with whole-string feeding. They are not a
chunked measurement and must not be quoted as one. Under chunking, rc.2 leaks 42 times; rc.3 leaks 3,
and all 3 are prose that quotes the notation in backticks rather than an actual marker.

### 42.5 Tests and artifact

| Check | Result |
|---|---|
| `npm test` | **286/286 pass**, 0 fail |
| `npm run check` | exit 0 |
| new regressions | marker split into single characters; standalone parameter tag split; DSML opener with attributes split; every two-way split of a mixed payload leaves no marker on screen |
| artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.3.tgz` |
| sha256 | `54e7b84380cf9373d991ce4f4ddc2fdd67987831a42865c3d2a5eadd9542f32b` |

The number advanced one instructed RC step (`0.0.1-rc.2` → `0.0.1-rc.3`); the rule stays
`0.0.1.rc<N>` and nothing else moves it.

### 42.6 Status

**`applied on disk, pending restart` at the time.** The owner restarted onto rc.3 afterwards
(serving `pid 2339788`, 09:42:39 KST); `0.0.1-rc.4` (round 43) supersedes it on disk only. No mount
is claimed here.

## 43. v0.0.1-rc.4 — not every protocol token is DSML; scrub by delimiter shape (measured 2026-11-01 09:42–10:01 KST)

### 43.1 Live evidence: turns 17-25 on rc.3

The owner restarted onto rc.3 (serving `pid 2339788`, 09:42:39 KST) and ran **nine more turns**
(17-25). Tool errors: **none** — every intended call executed. Two assistant messages still printed
protocol tokens, and **neither token was DSML**:

| Turn | Step | Token on screen |
|---|---|---|
| 18 | 6 | `<｜End of thought｜>` |
| 20 | 3 | `<｜thought>` and `</thought>` |

### 43.2 Why: the scrub was keyed to one vendor token

The scrub recognised only **DSML-shaped** tokens (`｜DSML｜`) and only think/thinking/analysis
wrappers. The model also writes other pipe-wrapped tokens (`<｜thought>`, `<｜End of thought｜>`)
and a `thought` wrapper; those matched neither rule, so they reached the screen. Keying a scrub to
one vendor token is an enumeration, and the model had moved to another token in the same notation
family.

### 43.3 What changed in rc.4

| # | Piece | Behaviour |
|---|---|---|
| a | generic protocol-token scrub | removes **any** `<｜…｜>` / `<│…│>` token regardless of its text, including single-sided forms such as `<｜thought>` |
| b | wrapper family | `thought` joins think/thinking/analysis: `<thought>` opens a reasoning block, `</thought>` closes it, and both are stripped from prose |
| c | chunk-boundary hold | the pending `<…` prefix hold accepts **any** character, so a split token is held, not printed |

### 43.4 Measurement

Every assistant text message across all `opencode-route` sessions was fed **one character at a
time** (worst-case chunking):

| Measure | rc.2 | rc.3 | rc.4 |
|---|---|---|---|
| strict screen leaks (line-start marker, protocol token, parameter tag) | **42** | **3** | **1** — a false positive of the measurement regex (a pair of markdown pipes, not notation) |
| body calls promoted | — | **28** | **28** |

Whole-string feeding: **4 -> 1**. Prose identity: **2,728** messages without notation stay
byte-identical. Live replay: turn 18 step 6 (`<｜End of thought｜>`) and turn 20 step 3
(`<｜thought>` / `</thought>`) replay through rc.4 with **no residue** — both clean, including the
single-sided form. Latest traffic: the **33** assistant messages since rc.3 (turns 17-25) contain
**1** regex false positive and **no real notation**.

### 43.5 Tests and artifact

| Check | Result |
|---|---|
| `npm test` | **286/286 pass**, 0 fail |
| `npm run check` | exit 0 |
| regression coverage | suite unchanged at 286; the two live shapes and the single-sided token replay clean |
| artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.4.tgz` |
| sha256 | `19212774f7f4fc8d001e980e3d9c25509510c54804670b4480f2f41cb3693be1` |

The number advanced one instructed RC step (`0.0.1-rc.3` -> `0.0.1-rc.4`); the rule stays
`0.0.1.rc<N>` and nothing else moves it.

### 43.6 Status

**`applied on disk, pending restart`.** Serving `pid 2339788` runs `0.0.1-rc.3`; the rc.4 source
is on disk only. No mount is claimed here.


## 44. v0.0.1-rc.5 — a short probe is not evidence; the leak is traced on real traffic (measured 2026-11-01 10:00-10:45 KST)

### 44.1 Why the synthetic A/B was rejected

The rc.4 A/B replayed the request by hand against the backend, changing headers, tool count and
system prompt. The owner rejected it as evidence: a short synthetic prompt makes the model emit
almost no reasoning and almost no text, so **there is nothing to leak**. The defect only appears in
long, multi-turn, output-heavy turns — the volume and the context are part of the reproduction.
Re-running those long turns as probes would spend the owner's quota to produce another synthetic
result. So the A/B cannot prove the fix, and rc.5 does not claim it does.

### 44.2 The A/B, recorded as a negative result

The A/B still measured something usable: it **rules out the request headers**. Same endpoint
`https://opencode.ai/inference/go/openai/v1/chat/completions`, on `beam-free` and on
`deepseek-v4.1-flash`:

| Variant | Structured `tool_calls` | Content protocol markers |
|---|---|---|
| session header on | yes | **0** |
| session header off | — | **HTTP 400** (the header is required, and is already sent) |
| directory + client headers | yes | **0** |
| non-stream request | yes | **0** |
| `tool_choice: required` + `parallel_tool_calls: false` | yes | **0** |
| combinations of the above | yes | **0** |
| 38 tools declared | yes | **0** |
| long system prompt | yes | **0** |
| markup-primed history | yes | **0** |

Both models returned structured tool calls in every variant; none put protocol notation into
`content`. Conclusion: **the headers are not the cause**, and a short probe cannot be the
instrument.

### 44.3 Design: trace real traffic instead of buying probe turns

`lib/trace.js` (wired into `lib/http.js` right where the request is issued and each mapped part is
produced) records only the **shape** of a request and only a bounded excerpt of the deltas that
actually carry notation:

| Record | Contents |
|---|---|
| `request` | model, message count, context chars, tools count, `hasSystem`, stream, maxTokens, toolChoice, effort, session id |
| `delta` | **only when** a protocol marker is detected: field (content / reasoning / tool-call), length, marker flag, excerpt of at most **400** characters |
| `finish` | counts by field, content/reasoning chars, blocks, tool-call count |
| `error` | transport detail (truncated) plus retry counters |

| Property | Value |
|---|---|
| default path | `/tmp/opencode-v2-trace.jsonl` |
| disable | `OPENCODE_V2_TRACE=0` (also `off` / `false`) |
| size cap | **8 MB** — appends stop past it, nothing is rotated or deleted |
| privacy | no prompt text, no message bodies, no credentials; bodies are summarised into counts |
| failure mode | every write is swallowed; a trace error never breaks a turn |

### 44.4 Analysis: `scripts/analyze-opencode-trace.mjs`

The analyser reads the trace, groups the lines by request, and prints the leak rate **by tool
count** (0 / 1 / 8 / 20 / 38 / 64), **by context chars**, **by system-prompt presence** and **by
model**, then the first leaking excerpts. With no hit it prints
`no leaking request in this trace yet` and keeps the trace growing — the metric appears when real
work produces it, and is not estimated in advance.

### 44.5 Tests and artifact

| Check | Result |
|---|---|
| `npm test` | **291/291 pass**, 0 fail (286 before; `test/trace.test.mjs` adds **5**) |
| `npm run check` | exit 0 |
| new test coverage | kill switch; one compact line per record; bounded excerpt; no prompt body copied; marker-family recognition |
| artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.5.tgz` |
| sha256 | `970e0c70cefc4ebcb0ce3dc767dc824939f6a6ea3e14f1807ea9124ed8fa7609` |

The number advanced one instructed RC step (`0.0.1-rc.4` -> `0.0.1-rc.5`); the rule stays
`0.0.1.rc<N>` and nothing else moves it.

### 44.6 Status

**`applied on disk, pending restart`.** No live leak verdict is claimed for rc.5. The rc.5 change
is an instrument: the next real occurrence lands in `/tmp/opencode-v2-trace.jsonl` and is analysed
by the script, instead of being argued from a probe. Ledger entry: F-32.

## 45. v0.0.1-rc.6 — the trace found a real defect: the system prompt was sent as a user message (measured 2026-11-01 10:50-11:20 KST)

### 45.1 What the rc.5 trace measured on real traffic

rc.5 shipped the trace, and the owner then ran **five real turns** on it. The report was a large
improvement plus new artifacts and remaining issues; the trace of those turns is the first
quantitative picture of this defect on real traffic (process **2397320**, model
`deepseek-v4.1-flash`):

| Measure | Value |
|---|---|
| requests recorded | **29** |
| requests carrying protocol notation in a streamed delta | **17** (**58.6%**) |
| marker deltas | **34** `content` / **1** `reasoning` |
| messages per request | **559-580** |
| context characters | **~1.07-1.10 million** |
| tools declared | **1** |
| max_tokens | **384000** |
| effort | **high** |
| `hasSystem` | **false — 29 of 29** |

The suite confirms the request shape: `tools=1`, `maxTokens=384000`, `effort=high`,
`stream=true`, one model, across all 29 requests.

### 45.2 The defect the flag exposed

`hasSystem=false` was not a trace bug. DSH's loop-built history carries the system prompt as a
**leading message with role `system`** — `dsh-llm` `types.d.ts` documents exactly that shape — and
`buildChatRequest()` mapped `assistant`, `tool` and `developer`, then fell through to `user` for
**every other role**, `system` included. The whole system prompt was therefore sent to the model
as a **user message** and the model ran without its system instructions. That is invisible in a
unit fixture that only passes `options.system` (which was mapped correctly); it appears only in
DSH's loop-built history, i.e. in real traffic. The 58.6% leak rate is the rate of a model running
off-format.

### 45.3 What rc.6 changed

| # | Fix | Behaviour |
|---|---|---|
| a | `system` role | `message.role === 'system'` maps to the OpenAI `system` role; `developer` still maps to `system` |
| b | empty tool result | an empty tool result is still pushed with its `tool_call_id`; the old `append()` dropped empty content and the id could be mis-assigned |

New tests in `test/http.test.mjs`: `a leading system-role message keeps the system slot` (asserts
`messages[0].role === 'system'` and the exact content) and `an empty tool result keeps its call
id` (asserts the `tool` message exists with `tool_call_id === 'call_1'`).

### 45.4 Measurement

| Check | Result |
|---|---|
| `npm test` | **293/293 pass**, 0 fail (291 before; **2** new) |
| `npm run check` | exit 0 |
| artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.6.tgz` |
| sha256 | `b95379ad0f13b78699fa8a4b526ca586fc0ad2d945628d487bea0e24d311b1b9` |
| trace reader | lists every process; `--pid` / `--since`; leak rate by tools / context / system / model; first leaking excerpts |

The number advanced one instructed RC step (`0.0.1-rc.5` -> `0.0.1-rc.6`); the rule stays
`0.0.1.rc<N>` and nothing else moves it.

### 45.5 Status

**`applied on disk, pending restart`.** Confirmed on real traffic, fixed in the request builder;
no mount and no post-fix leak rate are claimed here. After the restart, the same trace should show
`hasSystem=true`, and the leak rate is re-read with
`node scripts/analyze-opencode-trace.mjs --pid <serving pid>`. Ledger entry: F-33.

## 46. v0.0.1-rc.7 — the model wrote its tool calls into reasoning, and the adapter dropped them (measured 2026-11-01 11:20-12:35 KST)

### 46.1 Traffic on rc.6: the markup is gone, the turns stall

After rc.6 the owner restarted (serving **pid 2422772**) and reported that the visible markup was
gone but that **tool calls often fail** and the model frequently just sits there ("spacing out").
The trace of **155** real requests on `deepseek-v4.1-flash` quantifies both halves:

| Measure | Value |
|---|---|
| traced requests | **155** |
| `hasSystem` | **true — 155 of 155** (the rc.6 role fix, verified on live traffic) |
| finish: structured `tool_calls` | **138** |
| finish: `stop` | **10** |
| no finish record | **7** |
| requests with protocol notation in a streamed delta | **56** (**36.1%**) |

The notation had moved channel. Examples now sit in the **reasoning** stream:
`</thinking>\\n[tool call`, `</|DSML| parameter>`, and one runaway request produced **7,275**
marker deltas in reasoning. The visible screen was clean because reasoning wrapper tokens were
stripped — which is exactly why the loss was silent.

### 46.2 Root cause: only the content channel was classified

Body-call classification ran on the **content** channel only. Reasoning was passed through a
strip of think tokens for the screen and nothing else, so a tool call the model wrote into
`reasoning_content` was reduced to prose: the call was never promoted, the step produced no tool
call, and the turn had nothing to execute — the "spacing out" the owner saw. Replay of the
owner's two sessions through the rc.7 classifier:

| Session | Assistant messages with markers in reasoning | Calls recovered | No-wire-call steps recovered |
|---|---|---|---|
| `ec259449` | **30** | **21** | **3** of 6 |
| `c889802e` | **3** | 0 | 0 |

So the stalls are recoverable in practice, not a model failure: `ec259449` had six steps that
emitted no wire tool call, and three of them are fixed by classifying reasoning alone.

### 46.3 What rc.7 changed

Reasoning now goes through the **same** classifier as content, as a separate instance that is
reset with the others:

| # | Piece | Behaviour |
|---|---|---|
| a | reasoning classification | a second `createStreamClassifier` receives the reasoning text (after think-token stripping), so a body call written in `reasoning_content` is recognised |
| b | prose stays reasoning | parts without a marker are emitted as `reasoning-delta`, byte-identical |
| c | recovered call | queued for the **parser** channel with `source: 'text'`; the bottom gate promotes it only when no structured call of the same name exists, so nothing executes twice |
| d | wrapper tokens | `<thinking>` / `</thinking>` and pipe-wrapped protocol tokens are still stripped; no marker reaches the screen |
| e | reset | the reasoning classifier is reset together with the content classifier and the gate on retry |

### 46.4 Tests and artifact

| Check | Result |
|---|---|
| `npm test` | **295/295 pass**, 0 fail (293 before; **2** new end-to-end) |
| `npm run check` | exit 0 |
| new tests | `a tool call written into reasoning_content is promoted, not shown`; `reasoning prose without a marker stays reasoning` |
| artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.7.tgz` |
| sha256 | `79e6ddf7d0fa7e640654783b7fd243d8a36295c68ebd07747530790322a2d442` |

The number advanced one instructed RC step (`0.0.1-rc.6` -> `0.0.1-rc.7`); the rule stays
`0.0.1.rc<N>` and nothing else moves it.

### 46.5 Status

**`applied on disk, pending restart`.** The serving process (pid 2422772) runs rc.6; the
recovered-call figure is a replay of recorded traffic, not a live rate. After the restart the
same trace should show reasoning marker deltas falling while the `tool_calls` finish count rises.
Ledger entry: F-34.





## 47. v0.0.1-rc.8 — assistant history carried the protocol notation back to the model (measured 2026-11-02 07:09-07:20 KST)

### 47.1 What the owner reported

Two reference sessions on the live `opencode-http-agent` route (`opencode-go/deepseek-v4.1-flash`):
`edeabe91` showed a turn that **kept restating tool calls** until it was aborted (07:02-07:06 KST),
and its last step printed a run of `</run_code>` / `</function>` closers on screen; `bca2c2f7`
(05:52-06:55 KST) was named as the filtering reference.

### 47.2 Measured root cause

`buildChatRequest()` serialized **every** assistant block through `provider.js blocksToText()`. The
route therefore received, for every earlier assistant message, the reasoning body wrapped as
`<thinking>...</thinking>` and each tool-call block rendered as `[tool call <name> #<id>]: <json>` —
**in addition to** the structured `tool_calls` field of the same message.

The request body was rebuilt from the recorded transcripts (no live request was spent):

| Measure | `bca2c2f7` | `edeabe91` |
|---|---|---|
| wire characters, before -> after | 634,761 -> **388,841** (-38.7%) | 133,684 -> **66,405** (-50.3%) |
| `<thinking>` wrappers | 73 -> **0** | 12 -> **0** |
| rendered `[tool call ...]` echoes | 122 -> **0** | 13 -> **0** |
| assistant messages with `content: null` | 0 -> 69 | 0 -> 8 |
| wire messages | 240 -> 240 | 34 -> **33** |

Because the notation is also what the classifier strips from the display, sending it back is a
feedback loop: the model copies the shape it is shown, and a call appears twice, which is the
shape that makes a turn restate it.

### 47.3 Second defect — element closers reached the screen

`scrub()` erased think/analysis/summary/thought tokens, `<parameter>`/`<invoke>` tags and piped
DSML tokens, but a **bare `</NAME>` closer** was not notation to it. Measured in `edeabe91` step 14,
the stored reasoning part ends with:

```
parse JSONL.\r\n\r\n</run_code>\r\n\r\n</function>\r\n</function> ...
```

### 47.4 What rc.8 changed

| # | Piece | Behaviour |
|---|---|---|
| a | `assistantHistoryText(blocks)` (new, exported) | assistant `content` is the text blocks only |
| b | call-only assistant message | `content: null` + structured `tool_calls` |
| c | reasoning-only assistant message | not sent |
| d | `elementTagRegex(toolNames)` in `lib/stream-parser.js` | erases a bare element tag for `function(s)`, `function_call(s)`, `invoke(s)`, `call(s)`, `tool(s)`, `tool_call(s)`, `tool_result(s)`, `parameter(s)`, `argument(s)`, `result(s)`, `output(s)`, `function_result(s)`, `function_output`, `code_result` **and every declared tool name** |
| e | split closer hold | a trailing partial tag (`</run_co`) is held by `strayPrefixLength()` and never printed |

### 47.5 Tests and artifact

| Check | Result |
|---|---|
| `npm test` | **298/298 pass**, 0 fail (295 before; **3** new) |
| `npm run check` | exit 0 |
| new tests | `model-written element closers are removed, even split across deltas`; `assistant history carries prose only: no thinking wrapper, no rendered call`; `assistantHistoryText keeps prose and drops every other block` |
| artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.8.tgz` |
| sha256 | `a417272025669427fd7bdcb4f114a4092ba188c55212782cf1451b66c5d63ac1` |

The number advanced one instructed RC step (`0.0.1-rc.7` -> `0.0.1-rc.8`).

### 47.6 Status

**`applied on disk, pending restart`.** The body figures are a rebuild of recorded transcripts, not
live requests; the serving process must be restarted before the wire changes. Ledger entry: F-35.

## 48. v0.0.1-rc.9 — the per-turn reservation was the route's capability (measured 2026-11-03 20:1x-20:3x KST)

### 48.1 What was wrong

`resolveModel().defaultMaxTokens` published the route's own `limit.output`. The host reads that
field as a **reservation**, not a capability: `compaction-basic` computes

```
thresholdTokens = min(contextWindow * thresholdRatio,
                     contextWindow - reservedCompletionTokens - headroomTokens)
reservedCompletionTokens = header.config.maxTokens ?? info.defaultMaxTokens
```

so a 384000 capability was subtracted from a 1000000 window on every turn.

### 48.2 Measured before -> after (live catalog, 2026-11-03)

| route | contextWindow | reserved before | usable before | reserved after | usable after |
|---|---|---|---|---|---|
| `opencode-go/deepseek-v4.1-flash` | 1000000 | 384000 | 550464 (55.0%) | 16384 | 800000 (80.0%, ratio-bound) |
| `opencode-go/minimax-m3.1-flash` | 1000000 | 512000 | 550464 | 16384 | 800000 |
| `opencode-go/gpt-6-luna` | 1050000 | 128000 | — | 16384 | 840000 |

Message capacity after the reservation is 918080 tokens = **91.8%** of a 1M window.

### 48.3 Why 16384 is the reservation and not a smaller guess

Per-step output over 2223 routed `opencode-http-agent` steps (all sessions in this workspace):

| percentile | output tokens |
|---|---|
| p50 | 661 |
| p90 | 2564 |
| p95 | 4243 |
| p99 | 13077 |
| p99.5 | 18992 |
| max | 131072 |

Steps above 16384: **17 (0.76%)**; above 8192: 39 (1.75%). The single 131072 step is real — a
541425-character reasoning block (135356 tokens), not a counter artefact. The reservation is a
per-turn default, so a caller that needs more passes `maxTokens` explicitly and gets exactly that
(`buildChatRequest` line 649 is unchanged).

### 48.4 What changed

- `lib/shared.js`: `DEFAULT_TURN_MAX_TOKENS = 16384` and `turnCompletionReservation(capability, cap)`
  = `min(capability ?? 8192, cap ?? 16384)`.
- `lib/http.js`, `lib/provider.js`: `resolveModel().defaultMaxTokens` uses the helper; the catalog
  keeps `limit.output` untouched, so the picker still reports the true capability.
- `Config.turnMaxTokens` (default 16384, `.volatile()`) in both adapters, documented in
  `cordis.patch.yml`.
- Tests: the three sites that pinned the capability now pin the reservation, plus a route-below-cap
  case and a per-profile override case.

### 48.5 Not changed — a claim that did not survive measurement

A "usage accumulation" defect was reported (cacheRead 41M on a 1M route). Measured:

- The series is monotonic (265306 -> 41143179), and the last value is what the adapter publishes.
- All 59 multi-usage messages live in sessions created **2026-10-29 / 10-30**; the newest session
  has **0** of 280.
- The current adapter, fed a stub backend that sends a cumulative `usage` on every delta, emits
  **exactly one** `usage` chunk carrying the last value (verified 2026-11-03).
- A 37.7s generation against the live backend emitted **1** usage chunk.

No code change was made. The old records stay as historical evidence.

### 48.6 Status

**`applied pending restart`.** 305/305 tests pass, `npm run check` clean, artifact
`artifacts/nolit-dsh-opencode-v2-0.0.1-rc.9.tgz` sha256
`46b95607e34a6916cc34c3f23c4eb1c3f66cc391f84904c1ed5a3873b1b270f9`. The serving process must be
restarted before the new reservation takes effect.


## 49. v0.0.1-rc.10 — one settings surface, native styling, README as a manual (measured 2026-11-03 21:0x KST)

### 49.1 The three defects

| Defect | Measured evidence |
|---|---|
| README was the changelog | 1275 lines; §0-§0.8 occupied lines 21-463 and §0.9 sat at EOF. The plugin inspector renders this file. |
| Two settings surfaces | `registerConfigurableProviders` made the Models tab render all 40 volatile fields of `dsh-opencode-v2-http` beside the plugin's own panel. |
| Credentials readable | `redactSecrets(Config, { password, apiKey })` reported **0 secrets** and returned both values verbatim. |
| Panel hand-styled | 4 literal `rgba()` colours, 14 inline style objects, **no** stylesheet injection. |

### 49.2 What changed

- `README.md` is an operator manual (overview, three provided surfaces, configuration through the single panel, install). All engineering history moved to `CHANGELOG.md`, including the four defect-narrative subsections that used to live inline in the README body.
- The `registerConfigurableProviders` call is gone. Verified first that this cannot break saving: `dsh-settings.write()` resolves the namespace through `configEditor.entries()` (the loader tree); `dsh-config-editor.entries()` filters `loader.entries()` and never touches `ctx.llm`.
- `password` and `apiKey` are `.role('secret')`.
- `lib/client.js` rewritten against the native conventions measured in `dsh-client-ui-settings-subagent`: a single `<style data-plugin-css>` tag, `--dsw-*` tokens only, two titled cards, badge-name-route row geometry, and a segmented Plan control.

### 49.3 Verification

```
redactSecrets(Config, { password, apiKey })
  before: secrets declared 0, password "SUPER-SECRET-PW" returned verbatim
  after : secrets declared 2, password undefined, apiKey undefined

client contract (test/client.test.mjs, 6 tests)
  stylesheet injected via data-plugin-css ....... ok
  every view class defined in the stylesheet .... ok
  no hardcoded colours (css and view) ........... ok
  ko/en dictionaries in parity (33 keys each) ... ok
  every t() key present in both ................. ok
  exactly one settings.section registration ..... ok

state.directory after apply(): []  (was ['opencode-http-agent'])
suite: 311/311
```

### 49.4 Status

**`applied on disk, pending restart`.** Artifact
`artifacts/nolit-dsh-opencode-v2-0.0.1-rc.10.tgz` sha256
`f2146d62d2930c7cfc5727387397bcc9d1a3abb7a3b0bf145be4f965c80f0f0d`. The serving process keeps the old README
rendering, the duplicate form and the unstyled panel until `dsh-web.service` restarts.

> **Repacked 2026-11-04 03:59.** The previous artifact under this same version string
> (`33f193b3…`, built 2026-11-03 21:13) predated `lib/cost.js` (03:21:36) and `lib/cost-pill.js`
> (02:43:45), so it shipped a `package.json` whose `./cost` export pointed at a file that was not in
> the tarball. Per the `b349ea0` precedent the version is unchanged and the hash line is replaced;
> the tarball now carries 29 files including both cost modules.

