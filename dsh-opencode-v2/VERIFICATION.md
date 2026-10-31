<!-- skeleton:
version: 1.0
kind: ver
status: active
updated: 2026-11-01
summary: Current verification rounds for the opencode-v2 plugin, v0.7.4 and later. Older rounds live in VERIFICATION-ARCHIVE.md.
-->
# @nolit/dsh-opencode-v2 - Verification (current)

> Only the recent rounds live here. Everything up to v0.7.3 is in
> VERIFICATION-ARCHIVE.md in this directory.
>
> Live runtime: DSH 0.2.2-alpha.2 - Node v24.22.1 - plugin 0.7.8

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
