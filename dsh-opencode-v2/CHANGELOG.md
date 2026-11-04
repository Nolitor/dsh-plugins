# Changelog — @nolit/dsh-opencode-v2

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-03
summary: Engineering history for @nolit/dsh-opencode-v2, moved out of README.md so the README can serve as an operator manual. Every entry records what was measured, what changed, and what stayed unchanged; per-round proof lives in VERIFICATION.md and VERIFICATION-ARCHIVE.md.
-->

> Per-round proof, measurements and failure ledger entries live in
> [VERIFICATION.md](VERIFICATION.md) and [VERIFICATION-ARCHIVE.md](VERIFICATION-ARCHIVE.md).
> This file records **what changed and why**, in the order the owner instructed it.

## 0.0.2 — Tier A guards, beta track split, verified prerequisites (2026-11-04)

Owner instruction: version to `0.0.2`, beta to `0.0.2-beta.1`, beta stabilises through
`0.0.2-beta.N` and becomes `0.0.3`, at which point `0.0.2` is the lower version.

| Field | Value |
|---|---|
| `package.json` | `0.0.2` (was `0.0.1-rc.10`) |
| `lib/http.js` load-beacon `VERSION` | `0.0.2` |
| beta package | `@nolit/dsh-opencode-v2-beta` `0.0.2-beta.1`, peer `~0.0.2` |
| Tests | 402 stable (was 359), 12 beta |
| Artifacts | `artifacts/nolit-dsh-opencode-v2-0.0.2.tgz` (sha256 `395267f1…`), `artifacts/nolit-dsh-opencode-v2-0.0.2-beta.1.tgz` (sha256 `60165f6f…`) |
| Packing | `scripts/pack-opencode-v2.sh` — see the artifact naming rule below |

**Artifact naming rule (owner instruction, 2026-11-04).** The PACKAGE keeps `-beta`
in its name (that identity is what the peer dependency and the exclusion claim
reference), but the ARTIFACT does not repeat the word: `npm pack` names a tarball
`<name without scope>-<version>.tgz`, which produced
`nolit-dsh-opencode-v2-beta-0.0.2-beta.1.tgz` — "beta" twice. Artifacts are
named `nolit-dsh-opencode-v2-<version>.tgz` and built through
`scripts/pack-opencode-v2.sh`, which renames after packing and rewrites the
`artifacts/SHA256SUMS.opencode-v2` rows against the final name.

### 0.0.2.1 Request guards (Tier A) — deepseek-recipe rules applied

- `max_tokens` is clamped to `min(reservation, contextWindow - promptTokens)`, floored at 1.
  A prompt that cannot fit is refused as `OPENCODE_CONTEXT_OVERFLOW` **before upload**.
  Basis: recipe `ConversationRequest::resolve_max_tokens`; measured on this profile, 3,140
  recorded requests carried more than 120k prompt characters and none was checked.
- Full upstream `finish_reason` mapping. `content_filter`, `insufficient_system_resource` and
  any unknown reason are now `error` with their own codes instead of a silent `stop`.
- Pre-flight tool validation: non-empty name, at most 128 bytes, `^[a-zA-Z0-9_-]+$`,
  uniqueness, and `parameters` must be a JSON object. Stop lists: at most 16, none empty.
  Basis: recipe `protocol/validation.rs`.
- Reasoning-token accounting: absence of `completion_tokens_details.reasoning_tokens` is
  recorded on the trace finish line and warned once per stream. The host's `TokenUsage` has
  no field for an absence, so the trace carries it.
- Prompt tokens are ESTIMATED at 3.5 chars/token (conservative end of the measured range).
  An exact count needs `deepseek-recipe-encoding` and is deliberately not a dependency.

### 0.0.2.2 Beta track `@nolit/dsh-opencode-v2-beta` (Tier B and C)

- Canonical DeepSeek V4/V4.1 token table extracted from recipe by code point. A hand-typed
  draft was wrong in five of eighteen entries; every entry is now asserted in a test.
- Staged protocol parser modelled on recipe's `OutputParser`. Two defects were found and
  fixed by measurement during the port: a hold-back limited to the token spelling loses the
  opener at one-code-unit chunking, and eating a partial closer destroys the block terminator.
- Conformance corpus (7 cases, each naming its recipe source) plus a re-chunking oracle
  (300 splits invariant).

### 0.0.2.3 Mutual exclusion (both packages, mandatory)

Both packages register `opencode-http-agent`, the `opencode` tool and the same commands, so
only one may be active per profile. One implementation (`lib/exclusion.js`) serves both:
a mount-time claim at `$DSH_HOME/cache/opencode-claim.json` (stale pid taken over) and a
runtime live-sibling check. Measured end to end: the second activation is refused and names
the owner, pid and timestamp.

Two defects were found while wiring it, both by measurement rather than review:

- The first runtime check read `llm.adapters()`, which this host does not provide — a guard
  that could never fire. The real surface is `llm.listProviders()` (`dsh-llm` `LlmRuntime`).
- The corrected check then treated the SHARED provider id as proof of a sibling, so it stood
  down on its own registration and silenced the pre-existing `already registered by another
  instance` warning (caught by `conflicts.test.mjs`). Both packages register
  `opencode-http-agent`, so that id can never name an owner: ownership belongs to the claim
  file, and the runtime check only reports a *foreign* provider id or the shared tool name.

### 0.0.2.4 Documentation

README gained `## Prerequisites (measured 2026-11-04)` — OpenCode v2.2.0 install shape, web
auth and token storage (`~/.local/share/opencode/auth.json`, mode 0644, integration ids that
differ from the route id, oauth-before-key selection), and PATH resolution with a five-step
validation ladder. Also `## Request guards` and `## Mutual exclusion`.

### 0.0.2.5 What did NOT change

- The stable parse path. The regex classifier still serves; the canonical parser lives in the
  beta package and is not on the stream path.
- No runtime dependency on deepseek-recipe: the repository has no Node binding (measured),
  so adoption is a Rust or Python sidecar. Four specs and one test oracle were copied instead.
- `turnMaxTokens` stays 16384. The clamp changes the value only when the window is tighter.

## 0. Version — 0.0.1 baseline, 0.0.1-rc.9 on instruction

| Field | Value |
|---|---|
| `package.json` | `0.0.1-rc.9` (was `0.0.1-rc.8`, which was `0.0.1-rc.7`, which was `0.0.1-rc.6`, which was `0.0.1-rc.5`, which was `0.0.1-rc.4`, which was `0.0.1-rc.3`, which was `0.0.1-rc.2`, which was `0.0.1-rc.1`, which was `0.0.1`) |
| `lib/http.js` load-beacon `VERSION` | `0.0.1-rc.9` (was `0.0.1-rc.8`, which was `0.0.1-rc.7`, which was `0.0.1-rc.6`, which was `0.0.1-rc.5`, which was `0.0.1-rc.4`, which was `0.0.1-rc.3`, which was `0.0.1-rc.2`, which was `0.0.1-rc.1`, which was `0.0.1`) |
| Versions self-bumped in this history | 26 (`0.1.1` … `0.9.0`) |
| `0.0.1-rc.1` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.1.tgz` — sha256 `64be56cd99543754caadcc5459b983c597ac53f226cdd145ded4ab7d99a3fc16` |
| `0.0.1-rc.2` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.2.tgz` — sha256 `29260240b776708a524e90c5e6b4071557beeb9f6b18908c4ad09befda85e8e3` |
| `0.0.1-rc.3` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.3.tgz` — sha256 `54e7b84380cf9373d991ce4f4ddc2fdd67987831a42865c3d2a5eadd9542f32b` |
| `0.0.1-rc.4` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.4.tgz` — sha256 `19212774f7f4fc8d001e980e3d9c25509510c54804670b4480f2f41cb3693be1` |
| `0.0.1-rc.5` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.5.tgz` — sha256 `970e0c70cefc4ebcb0ce3dc767dc824939f6a6ea3e14f1807ea9124ed8fa7609` |
| `0.0.1-rc.6` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.6.tgz` — sha256 `b95379ad0f13b78699fa8a4b526ca586fc0ad2d945628d487bea0e24d311b1b9` |
| `0.0.1-rc.7` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.7.tgz` — sha256 `79e6ddf7d0fa7e640654783b7fd243d8a36295c68ebd07747530790322a2d442` |
| `0.0.1-rc.8` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.8.tgz` — sha256 `a417272025669427fd7bdcb4f114a4092ba188c55212782cf1451b66c5d63ac1` |
| `0.0.1-rc.9` artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.9.tgz` — sha256 `46b95607e34a6916cc34c3f23c4eb1c3f66cc391f84904c1ed5a3873b1b270f9` |

> Per-artifact hashes for releases after `0.0.1-rc.10` live in `artifacts/SHA256SUMS.opencode-v2`
> (outside the tarball) and in `VERIFICATION.md`; a hash row inside `CHANGELOG.md` would change the
> hash of the artifact that contains it.

The owner reset the number and forbade further self-bumps: **the version changes again only on an
explicit owner instruction, and then only as `0.0.1.rc<N>`** (packaged as `0.0.1-rc.<N>`). A release,
a fix round or a green test run is not an instruction. The load-beacon constant is part of the
release, not a log decoration. The `0.0.1` baseline stays the reset; the line advances one
release-candidate step per instructed fix round and nowhere else.

Eight instructed fix rounds have moved the line so far: `0.0.1` → `0.0.1-rc.1` (argument
accumulation, §0.1), `0.0.1-rc.1` → `0.0.1-rc.2` (shape-based marker classification, §0.2),
`0.0.1-rc.2` → `0.0.1-rc.3` (stream-safe recognition at chunk boundaries, §0.3),
`0.0.1-rc.3` → `0.0.1-rc.4` (protocol tokens are a delimiter family, not a DSML family, §0.4),
`0.0.1-rc.4` → `0.0.1-rc.5` (real-traffic trace instead of synthetic probes, §0.5),
`0.0.1-rc.5` → `0.0.1-rc.6` (the system prompt actually reaches the model, §0.6) and
`0.0.1-rc.6` → `0.0.1-rc.7` (a call in the reasoning channel is promoted, not dropped, §0.7),
`0.0.1-rc.7` → `0.0.1-rc.8` (assistant history is prose only, §0.8) and
`0.0.1-rc.8` → `0.0.1-rc.9` (the per-turn reservation is separated from the route capability, §0.9).
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

### 0.8 `0.0.1-rc.8` — assistant history is prose only

The rc.7 traffic left two owner-visible symptoms: turns that **restated tool calls in a loop**
(session `edeabe91`, 2026-11-02 07:02–07:06 KST) and protocol notation that still reached the
screen (the same session's final step printed a run of `</run_code>` / `</function>` closers as
reasoning; session `bca2c2f7` is the second reference).

Measured on those two sessions by rebuilding the request body from the recorded transcript:

| Measure (one request built from the whole session) | `bca2c2f7` | `edeabe91` |
|---|---|---|
| wire characters, before → after | 634,761 → **388,841** (−38.7%) | 133,684 → **66,405** (−50.3%) |
| `<thinking>` wrappers sent back to the route | **73** → 0 | 12 → 0 |
| rendered `[tool call <name> #<id>]: <json>` echoes | **122** → 0 | 13 → 0 |
| assistant messages whose `content` is `null` (call-only) | 0 → 69 | 0 → 8 |

Root cause: `buildChatRequest()` serialized **every** assistant block with
`provider.js blocksToText()`. Reasoning became `<thinking>…</thinking>`, each tool-call block became
`[tool call <name> #<id>]: <json>`, and that string was sent as the assistant `content` **next to**
the structured `tool_calls` field — so the route received every prior call twice and every prior
reasoning block wrapped in the notation the classifier is supposed to strip. The model then keeps
writing that notation (the leak) and re-states calls it has already made (the loop).

| # | Piece | Behaviour |
|---|---|---|
| a | new `assistantHistoryText(blocks)` | assistant `content` is the **text blocks only**; reasoning and call notation are never re-sent |
| b | call-only message | `content: null` with the structured `tool_calls` — no phantom echo line |
| c | reasoning-only message | not sent at all: it carried nothing the conversation contract needs |
| d | classifier element scrub | a bare protocol element tag is erased in place: `function(s)`, `invoke`, `calls`, `tool(_call|_result)`, `parameter(s)`, `argument(s)`, `result(s)`, `output(s)` **plus every declared tool name**, so `</run_code>` and `</bash>` are notation |
| e | split closer | a trailing partial tag (`</run_co`) is held and never printed as prose |

| Check | Result |
|---|---|
| `npm test` | **298/298 pass**, 0 fail (295 before; **3** new) |
| `npm run check` | exit 0 |
| artifact | `artifacts/nolit-dsh-opencode-v2-0.0.1-rc.8.tgz` |
| sha256 | `a417272025669427fd7bdcb4f114a4092ba188c55212782cf1451b66c5d63ac1` |

**Status: applied on disk, pending restart.** The body figures are a rebuild of recorded transcripts,
not live requests: the serving process must be restarted before the wire changes. Detail:
`VERIFICATION.md` §47, ledger F-35.


### 0.9 `0.0.1-rc.9` — the per-turn reservation is separated from the route capability

`resolveModel().defaultMaxTokens` used to publish the route's own `limit.output`
(384000 on `deepseek-v4.1-flash`, 512000 on `minimax-m3.1-flash`). That is a **capability**, but
the host reads the same field as a **reservation**: it fills in `max_tokens` when a caller omits
one, and `compaction-basic` computes

```
thresholdTokens = min(contextWindow * thresholdRatio,
                     contextWindow - reservedCompletionTokens - headroomTokens)
```

with `reservedCompletionTokens = header.config.maxTokens ?? info.defaultMaxTokens`. So publishing a
capability-sized number subtracted it from the context **on every turn**:

| reserved | usable before compaction (1M route) | share |
|---|---|---|
| 384000 (before) | 550464 | 55.0% |
| 16384 (after) | 800000 (ratio-bound) | 80.0% |

Measured 2026-11-03 over 2223 routed steps on this profile: output tokens p50 **661**, p90 2564,
p99 13077, max 131072 (one real 541425-character reasoning block). Only 17 steps (0.76%) ever
exceeded 16384.

**The fix is a separation, not a smaller fudge factor.**

- `limit.output` stays the **catalog capability** — it is what `listModels` reports and what the
  settings UI shows.
- `defaultMaxTokens` becomes the **per-turn reservation**: `DEFAULT_TURN_MAX_TOKENS = 16384`,
  capped by the route's own capability (`turnCompletionReservation()`). A route that can only emit
  8192 reserves 8192; nothing ever reserves more than the route can deliver.
- `turnMaxTokens` (`Config`, default 16384, `.volatile()`) lets a profile raise it without a code
  change. A caller that passes an explicit `maxTokens` still gets exactly that — the reservation is
  only the default.

Message capacity after the reservation is 918080 tokens (**91.8%** of a 1M window); compaction is
now bound by its normal `thresholdRatio` rather than by the reservation.

Tests: `resolveModel` publishes the reservation (`context.test.mjs`), a route under the cap
reserves only what it can emit, and `turnMaxTokens` is honoured per profile.

**Not changed, and why:** a report of a "usage accumulation bug" (cacheRead 41M on a 1M route) was
traced to session `7850b074` created **2026-10-29**, before the present adapter emitted a single
`usage` chunk per attempt. Every one of the 59 multi-usage messages lives in a session created
2026-10-29 or 10-30; the current code was verified against a stub backend that sends a cumulative
`usage` on every delta and it still emits exactly one. No code change was made for it.


---

## Detail moved out of README.md

These sections described defects that README.md used to carry inline. They are engineering
history and proof, not operator instructions, so they live here.

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


### 0.10 `0.0.1-rc.10` — README becomes a manual, one settings surface, native styling

Three presentation defects, no router behaviour change.

**README was a changelog.** It opened with 443 lines of release rounds, byte diffs and ledger
entries (§0 through §0.8) plus §0.9 appended at the end, and the DSH plugin inspector renders that
file directly. The history moved to `CHANGELOG.md`; `README.md` is now an operator manual
(overview, provided surfaces, configuration, install). Every heading from the old README survives
in one of the two files — the split only renamed section numbers that no longer had neighbours.

**Two settings surfaces over one row.** `apply()` advertised the plugin through
`registerConfigurableProviders`, so the Models tab rendered a generic form over all 40 volatile
fields of `dsh-opencode-v2-http` beside this plugin's own panel. That registration is gone. The
panel keeps working because the host settings service resolves a namespace through
`configEditor.entries()` (the loader tree), never through the directory — verified against
`dsh-settings` and `dsh-config-editor`, and now asserted by `test/conflicts.test.mjs`.

**Credentials were readable.** `password` and `apiKey` were plain `.volatile()` strings. The host
redacts only `role('secret')` fields, so running the real `redactSecrets()` over the schema kept
both values verbatim (0 secrets declared). Both fields now carry `role('secret')`: re-running the
same function reports 2 secrets and returns `undefined` for both.

**The panel was hand-styled.** `lib/client.js` used four hardcoded `rgba()` colours and 14 inline
style objects, and injected no stylesheet. It now follows the native settings conventions measured
in `dsh-client-ui-settings-subagent`: one `<style data-plugin-css>` tag keyed by a stable id, the
`--dsw-*` token set (`label-primary/secondary/tertiary`, `border-l2/l3/l4`, `bg-layer-4`,
`brand-primary`, `state-error-primary`, `radius-md/lg`), zero literal colours, and two titled cards
(Plan, Models) with the badge-then-name-then-route row geometry the native model list uses.
`test/client.test.mjs` pins the contract: every class the view uses exists in the stylesheet, no
hardcoded colours return, and the ko/en dictionaries stay in parity.

### 0.10.1 `0.0.1-rc.10` (second round) — the styling contract was inherited by name, not measured

Owner report (2026-11-04): the tab had built its own look instead of following DSH, the model row
printed the display name and the route as one running string, and a new model looked Go-usable when
it is not.

**The tab had its own scale.** rc.10 adopted the native *token names* but never compared computed
values against the page they sit in. Measured in the live GUI before this round
(`test/live/settings-tab-live.mjs`, 1440x1000):

| Surface | Before | Native settings page (measured) | Now |
|---|---|---|---|
| section root | **16px** (inherited; no size stated) | 14px/22px | 14px/22px |
| section heading | 13px/600 | 16px/24px/500 (page title) | 16px/24px/500 |
| card body | 13px/600 titles, 11px meta | 14px/22px, 12px/18px | 14px/22px, 12px/18px |
| card | `.5px` border, `radius-lg` 16px | 1px `settings-card-stroke`, `radius-xl` 20px | token border, `radius-xl` |
| plan switch selected | `bg-layer-4` → **unset**, so transparent | `#ebeef2` (`button-ghost-active-fill`) | same token |
| control | 12px | 13px/20px | 13px/20px |

Two of those are the same class of mistake the notify restyle fixed: `--dsw-alias-bg-layer-4` is
declared in the theme sheet but resolves to the empty string, so the selected plan painted nothing,
and the root inherited the UA 16px because the plugin never stated a size.

**Name and route were one string.** Both spans sat inside the same inline `<label>`, so the row
rendered `DeepSeek V4.1 Flash (Go)opencode-go/deepseek-v4.1-flash`. They are now two lines in a
`.ocv2Name` column — 14px name over 12px route — each one ellipsised row with the full value in
`title`, and the grid column is `minmax(0,1fr)` so a long name truncates instead of pushing the
badge.

**The styling was not testable.** The row was an anonymous inline `h('li', …)` inside the section,
so no test could render it. It is now `ModelRow(props)`, exported from the client module and
asserted by `test/client-rows.test.mjs` (two separate text nodes, both tooltips, both ellipsised,
native type scale, native card geometry, no token that is unset at runtime).

**"Can the new model be used on Go?"** No, and by construction. Measured on the live catalog:
`opencode/pulse-alpha-free` is published under the `opencode` provider, so `planOfRoute` returns
`zen` and `availabilityOf` returns `other-plan` under `activePlan: 'go'` — the same rule the panel
already applied. What made it *look* usable was the display name: the catalog decorates colliding
names with the provider (`… (Go)` / `… (Zen)`) and `Pulse Alpha Free` has no twin, so it carried no
suffix while sitting in the Zen column. `test/plan-attribution.test.mjs` now pins that a name never
moves a route between plans.

**Price plans and rules are not manageable here.** The local control plane exposes one usage
endpoint (`GET /api/experimental/usage/limits`: workspace, go rolling/weekly/monthly percentages,
`budgets: []`) and no plan, budget or pricing write path; the OpenAPI document has 130 paths and
none is a billing mutation. The Go endpoint itself reports per request
(`usage.opencode = {billing_source, list_cost, allowance, tokens}`), which the adapter does not
consume. So the tab can display what the account reports and must not pretend to set it; the
console (opencode.ai/v2/docs/console) remains the place where the plan is chosen.

**Verification.** `npm test` 321/321 (311 before this round; 6 row/typography + 4 plan-attribution
tests added). Live reread after the change: section 14px/22px,
heading 16px/24px/500, card `radius-xl` with the token stroke, selected plan `rgb(235,238,242)`,
50 rows all `stacked: true`, 0 page errors.

### 0.10.2 `0.0.1-rc.10` (third round) — the checklist was grouped by availability, not by plan

Owner report (2026-11-04): with Go selected, Zen models must read as *another plan* and must not be
selectable; the reverse must hold too; and "unusable" or "new" may only appear **inside the plan
being shown**. Measured on the live route before this round (`activePlan: 'go'`, 50 rows):

| Plan | State | Rows | Problem |
|---|---|---|---|
| go | usable | 28 | correct |
| go | deprecated | 2 | correct |
| zen | other-plan | 8 | correct |
| zen | **unavailable** | **12** | a refusal of the *other* plan's endpoint relabelled this plan's rows |
| zen | other-plan + **새 모델** | **1** | `pulse-alpha-free` showed the new badge while unselectable |

Two causes, both precedence bugs:

1. **`availabilityOf` asked about the verdict before asking about the plan.** A route measured
   "unavailable" on the Go endpoint carried that state into a Zen row, so 12 routes read as "사용 불가"
   instead of "다른 플랜". The plan is now the first question; a refusal is only reported inside the
   plan being shown.
2. **The sort compared availability before plan**, so blocked rows of both plans shared one group and
   fell back to rank/name — 11 rank/plan inversions in the served order
   (`claude-opus-5-5` above `kimi-k3`, `mimo-v2.5` in the middle of Zen rows). Order is now
   plan → availability → new → rank → name, which yields two contiguous blocks.

The badge had the same defect on the client: `badgeClass` returned the "new" style whenever
`isNew` was set, before looking at `state`. It now reads
`usable → new | usable`, and everything else from the state, so a new route of another plan renders
`다른 플랜` with the neutral pill. Both helpers are exported and pinned by `test/badge.test.mjs`.

Measured by replaying the **real** catalog through the fixed classifier
(`test/live/plan-shape.mjs`):

| activePlan | go rows | zen rows | plan blocks |
|---|---|---|---|
| `go` | 28 usable + 2 deprecated | 20 other-plan (0 "unavailable") | `go → zen` |
| `zen` | 30 other-plan | 8 usable + 12 unavailable | `zen → go` |

"Unusable" now appears only inside the chosen plan, which is the rule the owner stated.


### 0.10.3 `0.0.1-rc.10` (fourth round) — the plan did not reach the endpoint, and the list carried a dead plan

Owner asked two design questions (2026-11-04) and one of them exposed a serving defect, not a
styling one.

**Q1 — "Go and Zen are already split upstream, why keep one long list?"**
Measured on the live route (`activePlan: 'go'`): **50 rows served, 28 selectable**, and the 20
other-plan rows rendered the disabled "다른 플랜" badge — 44% of the list was rows the operator could
not act on, each carrying 138 bytes of plan/state/rank JSON. `model-settings` now returns only the
active plan's rows and reports the rest as `otherPlanCount`; switching the plan swaps the list.
The client shows "다른 플랜 N개는 목록에서 제외됩니다" instead of rendering them.

**Q2 — the split itself revealed a real defect: the endpoint ignored the plan.**
`resolveBackend()` read `/api/provider/${backendProviderId}` once — default `opencode-go` — cached
it, and reused it for every route. The plan filtered the *list* but never the *root*. Measured with
one credential against both roots (`test/live/endpoint-plan-probe.mjs`):

| Endpoint | Model | Result |
|---|---|---|
| go root | `deepseek-v4.1-flash` (go-owned) | 200, `billing_source: go-plus` |
| go root | `pulse-alpha-free` (**zen-only**) | **400** "Model is unavailable." |
| zen root | `deepseek-v4.1-flash` (go-owned) | **402** "Insufficient account funds" |
| zen root | `pulse-alpha-free` (zen-only) | 429 FreeUsageLimitError (entitled, just capped) |

So with `activePlan: 'zen'` every Zen route was selectable *and* unroutable: the request still went
to the Go root and could only answer 400. `backendProviderForRoute()` now derives the provider from
the route prefix, the backend cache is keyed by provider (a Zen route must not reuse the Go
`baseURL` resolved moments earlier), and `test/http.test.mjs` proves it end to end against a
fixture with two distinct roots.

**Dead weight removed (measured, not guessed).** `test/live/dead-code.mjs` reports symbols with
zero references outside their own definition — the first version of that audit was wrong because it
only counted cross-file imports and so labelled live code "dead"; the corrected version checks
intra-file use as well. Removed: `createReasoningGate` and `createTextGate` (86 lines, superseded by
the classifier), `PLAN_LABELS` (labels live in the client dictionary), `isModelRoute`, and the
duplicated `stableStringify` in `display-gate.js` (now one implementation in `display-clean.js`).
`display-clean.js` 207 -> 121 lines. Audit now reports **0** dead symbols.

**TypeScript: measured, not adopted.** `typescript` is not in the npm cache (offline install:
`ENOTCACHED`), there is no `tsc`/`tsdown` on PATH, and this package ships `lib/*.js` directly as
`main`/`exports` with no build step — the DSH loader evaluates those files as-is, including
`lib/client.js`, which is served to the browser verbatim. Converting would add a build artefact to
a link-installed profile that currently hot-reloads source. Left as JS; the contract tests are what
make the conversion safe to do later.

| Measure | Before | After |
|---|---|---|
| rows served for one plan | 50 | 30 (28 usable + 2 deprecated) |
| unclickable rows | 22 (44%) | 0 |
| endpoint follows the plan | no | yes |
| dead symbols | 4 | 0 |
| `display-clean.js` | 207 lines | 121 lines |
| suite | 311 | 336 |


### 0.10.4 `0.0.1-rc.10` (fifth round) — cost was on the wire and the adapter threw it away

Owner correction (2026-11-04): the responses carry cost, and the previous round wrongly reported it
as unavailable. Measured on the live Go root (`test/live/cost-capture.mjs`, final streaming chunk):

```json
"usage": { "prompt_tokens": 32, "completion_tokens": 8, "cost": 0,
  "opencode": { "billing_source": "go-plus", "list_cost": 0.0000096,
                "allowance": 0.00001152,
                "tokens": { "input": 32, "output": 8, "reasoning": 0, "cache_read": 0, ... } } }
```

`usageFromOpenAi()` mapped five token buckets and dropped `cost`, `opencode.billing_source`,
`opencode.list_cost`, `opencode.allowance` and `opencode.tokens` entirely.

**New module: `lib/cost.js`** (published as `@nolit/dsh-opencode-v2/cost`). Standalone by design —
it parses and accumulates, and one call site feeds it. The streaming and display paths are untouched.

| Export | Role |
|---|---|
| `parseCost(raw)` | one wire `usage` → `{costUsd, listCostUsd, allowanceUsd, estimated, billingSource, planSource, tokens}` |
| `createCostLedger()` | per-session accumulator: totals, per-model, per-billing-source |
| `describeCost(cost)` | one-line diagnostic |

Parsing rules, each traced to the measurement rather than assumed:

- **absent ≠ 0.** The docs say `cost` is "absent when the model has no price"; a missing price
  parses to `null` and the ledger counts it in `unpricedRequests` instead of folding it into a
  fabricated zero. Measured: Go usage reports `cost: 0` — a real zero, kept as one.
- **`planSource` is derived from `billing_source`**, not from the presence of `allowance`. Only
  `go`/`go-plus` consume a monthly allowance; `balance`/`byok`/`free` do not, so a plan burn can
  never be inflated by a paid call.
- **Billed tokens come from `opencode.tokens`, not `prompt_tokens`.** The docs state `input`
  excludes cache and `output` includes reasoning. Confirmed live: a `minimax-m3.1-flash` request
  reported `in=7 out=4 cache=197`, which the top-level counters cannot express.
- **`estimated` is only true when the wire says so** (byok only).

**Route wiring.** `recordCost()` is called from the one event that carries the final usage, and it
never throws into the stream — a bookkeeping failure must not fail a generation. `model-settings`
now returns `cost: <summary>` (sessions, requests, costUsd, listCostUsd, allowanceUsd, per-session,
per-model), so actual spend is visible without leaving the tab.

**Measured end to end** (`test/live/cost-live.mjs`, two real generations):

```
opencode-go/deepseek-v4.1-flash -> go-plus cost=0 list=0.0000072  plan=0.00000864 in=32 out=4 cache=0
opencode-go/minimax-m3.1-flash  -> go-plus cost=0 list=0.00000641 plan=0.00001922 in=7  out=4 cache=197
summary: requests 2, costUsd 0, listCostUsd 0.00001361, allowanceUsd 0.00002786
```

**Why not on the host's usage record:** `dsh-llm` `types.d.ts:167` `TokenUsage` declares five token
buckets and no cost field, so cost cannot travel in `{type:'usage'}`; it stays a plugin-owned
surface and is reported beside it.

**Verification.** `npm test` 345/345 (9 new: `test/cost.test.mjs` 8, and a streamed end-to-end case in
`test/http.test.mjs`), `npm run check` green, the `./cost` export resolves and is covered by the
bundle gate.

### 0.10.5 `0.0.1-rc.10` (sixth round) — the session cost belongs on screen, in the status row

Owner instruction (2026-11-04): **one** cumulative figure for the session, beside the existing
"NN tok · 캐시 적중 NN%" pill at the bottom of the chat. A per-turn badge was explicitly rejected —
"말풍선마다 몇 센트씩 덕지덕지 붙이지 마라". `conversation.chat.turnTail` was never used in code;
it was measured and discarded.

**Where the row actually lives.** The status pills are NOT a slot. `dsh-client-ui-chat` renders
`span[data-composer-stat="activity"|"usage"]` (`PlainPill`/`DialogPill`, class `bOPqQW_pill`), so a
plugin cannot register beside them — but the anchors carry a stable data attribute and the row is
plain DOM.

**`lib/cost-pill.js`** — append/update/remove one pill in that row:

| Export | Role |
|---|---|
| `formatUsd` | sub-cent amounts stay readable (measured burns are `0.00002786`) |
| `costPillText` | `무료 · 플랜 $0.0000279` on Go, `$0.00412` on balance |
| `sessionCostOf` | pick the session **by id**, never "most recent" |
| `renderCostPill` | idempotent append; borrows the host pill's own class |
| `watchStatusRow` | re-attaches after React replaces the row |

**Server.** `POST /api/local/opencode-v2/cost/session` answers `{session, totals}` from the
in-process ledger — no backend request.

**Client.** `startCostPill()` polls every 15 s, reads the session id from
`[data-conversation-session]` (measured live: `session-eaa3d2b7-…`), and repaints through a
MutationObserver.

**Two bugs found by verification, not by reading:**

1. `startCostPill()` was defined and never called — `apply()` only registered the settings section,
   so the served bundle contained the code and nothing ran. Fixed and re-measured on the served
   bundle (`startCostPill(ctx)` present).
2. The inject contract test flagged `ctx.effect` as an undeclared service. It is Cordis CORE
   (`Pick<Fiber,'effect'>`, corgis `fiber.d.ts:8`) and every shipped bundle calls it without
   declaring it; the test now excludes core members instead of demanding a phantom service.

**Measured in a real browser** (`test/live/cost-pill-dom.mjs`, Chromium, row shaped like the host's):

```
rowText : 13턴 553단계 | 141M tok · 캐시 적중 99% | $0.00412 · 플랜 $0.001
cls     : bOPqQW_pill (borrowed)   fontSize: 12px   color: rgb(129,133,140)
count   : 1 (sameNode true on update)   afterRemove: 0
```

**Verification.** `npm test` 351/351 (6 pill tests + i18n parity restored with
`costFree`/`costPlan`/`costTitle`). `cost/session` is live and answers 200.

### 0.10.6 `0.0.1-rc.10` (seventh round) — the pill rendered, but with the page font

Owner report (2026-11-04): the text appeared and the styling was broken. Diagnosed in the live
browser instead of reasoning about the code.

**What the browser actually showed** (`test/live/diag.mjs`, real session, 25 s of polling):

| Probe | Result |
|---|---|
| console | one unrelated `[deepseek-account]` error, **no cost-pill exception** |
| network | `POST /api/local/opencode-v2/cost/session` → **200**, repeated every 15 s |
| payload | `{"session":null,"totals":{"sessions":1,"requests":8,"costUsd":0,"allowanceUsd":0.13259272}}` |
| DOM | session id read correctly; **`[data-composer-stat]` anchors: 0** in that view |

So the request worked and the failure was entirely in the markup.

**Cause 1 — wrong nesting (the visible bug).** The host renders THREE spans and the font is set on
the outermost one:

```
span.anchor[data-composer-stat]   <- font-size: calc(... - 1px); line-height: calc(20px + ...)
  span.pill                        <- only padding/radius/colour; `font: inherit`
    span.label                     <- ellipsis
```

`.pill` sets `font:inherit`, so appending a bare `.pill` to the row inherits from the PAGE. Measured
side by side with the live stylesheet:

| | font-size | line-height | height |
|---|---|---|---|
| host pill | 11px | 19px | 21px |
| **flat pill (before)** | **16px** | **normal** | **26px** |
| nested pill (after) | 11px | 19px | 21px |

The module now builds `anchor > pill > label` and copies all three hashed class names off a live
sibling (they are per-build hashes, not stable names). Verified against the real stylesheet:

```
hostPill : 11px/19px rgb(129,133,140) pad 1px 8px h 21
ownPill  : 11px/19px rgb(129,133,140) pad 1px 8px h 21   <- identical
```

**Cause 2 — the status row is absent in some views.** `[data-composer-stat]` renders only when the
session reports token usage; an empty or freshly opened session has no row, so there is nothing to
attach to. The pill is now skipped silently in that case rather than painting into the wrong place,
and the MutationObserver attaches it as soon as the row appears.

**Cause 3 — `session: null`.** The DOM session id and the id the loop stamps on requests are both
`session-<uuid>`, but the lookup only accepted an exact match. It now matches with or without the
`session-` prefix, so a session that has cost never reports "no data".

**Verification.** `npm test` 351/351; `npm run check` OK. Live measurement of the final markup is
in `test/live/pill-verify.mjs`.

### 0.10.7 `0.0.1-rc.10` (eighth round) — route gating, and the clickable plan panel that was missing

Two owner instructions (2026-11-04): show the pill **only while an OpenCode V2 model is selected**,
and adopt the Hermes `opencode-go-usage` plugin's **click-to-open panel**.

**The Hermes plugin was measured, not guessed.** Found at
`~/.hermes/webui/extensions/opencode-go-usage` with a live sidecar on `127.0.0.1:17799`
(`systemctl --user` unit, active). Its `GET /api/usage` returns the Go plan windows; queried with
the token from `~/.hermes/webui/sidecar-auth/opencode-go-usage.token` → **200**:

```json
{"go":{"plan":{"windows":{"rolling":{"percent":3.0},"weekly":{"percent":3.0},"monthly":{"percent":27.0}}}}}
```

The DSH-side control plane reports the **same numbers** from `GET /api/experimental/usage/limits`
(3 / 3 / 27, same reset instants). So the panel reads that endpoint through the adapter's existing
control-plane client: no second credential, no sidecar, nothing to install.

**Route gating.** The composer model chip carries the machine-readable route — measured live on
`span[data-provider-id][data-model-id]` → `opencode-http-agent` / `opencode-go/deepseek-v4.1-flash`.
`usingOwnRoute()` reads it and the pill is removed whenever another provider is selected. Verified
both directions by rewriting the attribute in a live page:

| Selected route | pill shown |
|---|---|
| `opencode-http-agent` / `opencode-go/deepseek-v4.1-flash` | **true** |
| `deepseek-api` / `deepseek-chat` | **false** |

**Click → panel.** Clicking the pill toggles `[data-ocv2-plan]`: a header with a refresh control and
three bars (5시간 / 7일 / 30일) with percentages and reset times, styled with the plugin's own tokens
and sized like the host. Rendered with the real injected stylesheet:

```
panel     : 310x220  radius 16px  bg #fff
pill own  : 11px  h21  radius 8px      <- identical to host pill
pill host : 11px  h21  radius 8px
panelText : Go 플랜 사용량 | 새로고침 | 5시간 3% | 7일 3% | 30일 27%
```

**Verification.** `npm test` 351/351, `npm run check` OK. `cost/session` and `plan-usage` both live (200).

### 0.10.8 `0.0.1-rc.10` (ninth round) — three defects the owner hit in a row

**1. "대화가 시작해야지 출력되고, 그렇지 않으면 아예 표시도 안 된다."** Correct, and it was a design
mistake. The pill was a DOM node appended beside the host's `[data-composer-stat]` anchors — and
those anchors only exist once a session reports token usage (measured: `anchorCount: 0` on a fresh
session). Changed to a **composer slot**:
`ctx.slots.register({ name: 'conversation.input.activity' }, CostPill)`, following the pattern
`dsh-experimental-client-ui-voice-input` uses for the same seat. The composer toolbar renders it from
the first paint.

**2. The chip was hidden by its own formatter.** `costPillText` returned `''` for `requests <= 0`,
and the component returned `null` for an empty string — so a brand-new session showed nothing at
all. Zero spend is zero, not "no meter": it now returns `무료`/`free`. Verified live before any turn
was sent: `chipPresent: true, chipText: "무료", 11px, h21`.

**3. Clicking did nothing even though the request succeeded.** Measured with a real mouse click:
`plan-usage` returned **200** and `[data-ocv2-plan]` count was **0**. The outside-click listener was
registered inside the same event turn as the opening click, so it removed the panel immediately.
The listener is now deferred by one task. Verified after the fix: panel present, 310x220, reading
`5시간 3% · 7일 3% · 30일 27%`.

**4. "매번 금액이 재시작되네?"** Also correct — the ledger was a `Map` only. It now persists to
`<profile>/opencode-session-cost.json` (the catalog path rule: explicit → profile → DSH_HOME), writes
are debounced to 1 s, and `flush()` forces the last write. `test/cost-persistence.test.mjs` proves a
second ledger over the same file reads back `requests: 2` and keeps accumulating to 3.

**Verification.** `npm test` 354/354. Live: chip visible before any conversation, click opens the
panel with the real Go windows, `plan-usage` 200.

### 0.10.9 `0.0.1-rc.10` (tenth round) — "무료" next to a real balance

Owner report (2026-11-04): the chip showed `무료` while the account had spent money, looked like the
meter reset again, and the chip only appeared after a turn.

**Root cause, measured.** The ledger held:

| Session | Events | Requests | Where it came from |
|---|---|---|---|
| `session-c67cb8aa` | **4,904** | 11 | the live conversation (title "오픈코드 v2 스타일·플랜 점검") |
| `session-eaa3d2b7` | 6 | 0 | an empty shell, and **the id the DOM reports** |

`pickSession()` did an exact match only, found nothing for the DOM id, and fell through to zero —
which rendered as `무료`. So the number was never reset; the lookup was pointing at the wrong row.

**Fix.** `pickSession(summary, sessionId)` in `lib/cost.js` (tested by `test/session-pick.test.mjs`):
exact id → bare uuid → **the most recently active session**. `lastAt` is stamped by `recordCost`,
so the most recent spender is the conversation on screen in every case this plugin can observe.

**The chip could also disappear.** `CostPill` initialized `text` to `''` and returned `null` for an
empty string, so the seat was empty until the first poll answered, and it vanished again whenever a
figure was missing. It now starts at the zero label and never returns `null`.

**Verified live** (no turn sent, then after opening a session):

```
1-fresh-after-nav        : 무료 · 플랜 $0.0284
2-after-dismiss-8s       : 무료 · 플랜 $0.0284
3-after-20s              : 무료 · 플랜 $0.0284
4-after-opening-session  : 무료 · 플랜 $0.0284
```

Previously the same probe reported plain `무료` in every state. On this account `cost` is legitimately
0 (Go usage inside its limit), so the meaningful figure is the plan burn — which is now shown.

**Verification.** `npm test` 359/359.

### 0.10.10 `0.0.1-rc.10` (eleventh round) — seat, wording, and the missing breakdown

Four points from the owner (2026-11-04), all measured first.

**1. Seat — model serving position is fixed; the chip moves before it.**
`conversation.input.activity` is documented as "compact action AFTER the model selector", so the
chip sat to its right. Moved to `conversation.input.left` — "compact controls at the LEFT of the
composer tool row". Measured live: chip at x=656, model selector at x=964 → **before** it.

> **Correction (0.10.11).** This move did not survive the same session. `input.left` put the figure
> ~300 px away in the composer's left tool group, which the owner rejected; the entry above records
> the measurement accurately but the **seat described here is no longer the shipped one**. See
> 0.10.11 for the slot that is actually registered and why the two remaining options both fail.

**2. "무료 · 플랜" wording removed.** On a Go plan `cost` is always 0, so the label was two words of
noise around one number. The chip is now a single money figure. Verified: `$0.0850`.

**3. "모델마다 금액이 다르고 사용량도 다른데 딸랑 금액만 나와?"** Correct — the panel showed only the
plan windows. It now opens with the session's own spend **per model**: requests, money and tokens
(input+output+cache) for each route, then the plan windows. Measured data the panel receives:

```json
{"requests":28,"allowanceUsd":0.09107836,
 "byModel":{"opencode-go/deepseek-v4.1-flash":{"requests":28,"costUsd":0,"allowanceUsd":0.09107836}}}
```

**4. The ledger was losing tokens.** `byModel` recorded requests and money but not tokens, so
"사용량" could not be reported per model at all. `record()` now accumulates
`input/output/reasoning/cacheRead/cacheWrite5m/cacheWrite1h` both per model and per session, and the
panel renders them as `28건 · $0.0911 · 141k tok · 캐시 99k`.

**Verification.** `npm test` 359/359; live chip before the model selector at `$0.0850`.
**Applied pending restart** for the server half: the running process still answers
`{"session":null}` because `pickSession` landed after it started, so the panel shows the aggregate
note ("모델별 내역은 재시작 후 표시됩니다") instead of a misleading empty block.

### 0.10.11 `0.0.1-rc.10` (twelfth round) — the seat was reverted, and the record said otherwise

Owner: "이제 모델마다 가격이 나고는거지? 그리고 지금 저거 플랜 사용량 게이트웨이 헤르메스거
가져오는거고..? 직접 구현하는게 아니고?" Both answered by measurement.

**1. The 0.10.10 seat claim was stale.** That entry recorded the move to `conversation.input.left`,
accurate when written and **wrong by the end of the same session**: the owner rejected the ~300 px
gap and the chip went back to `conversation.input.activity`. The entry now carries a correction
note rather than being rewritten, so the measurement history stays intact and the current seat is
stated once, here.

**2. Model catalog carries unit prices — and they differ per plan.** `GET /api/model` on the local
daemon reports `cost[0].{input,output}` in USD per Mtok:

| Route | Go | Zen |
|---|---|---|
| `deepseek-v4.1-flash` | 0.15 / 0.60 | 0.30 / 1.20 |
| `deepseek-v4-pro` | 0.66 / 1.98 | 1.74 / 3.48 |

39 of 50 catalog rows carry a non-zero unit price. The panel does **not** use these yet; it reports
accumulated money per model, which is what "모델마다 가격" actually asks for.

**3. Per-model rows work; the payload was stale.** Panel opened live and read:

```
이 세션 90건 · 모델별
  deepseek-v4.1-flash
  90건 · $0.2642
```

Three gaps remain **because the process predates the file**, each verified by probe, not assumed:

| Probe | Live answer | Meaning |
|---|---|---|
| `cost/session` with a `garbage` id | `{"session":null}` | `pickSession` fallback not loaded |
| `session.tokens` | `null` | token accumulation not loaded |
| `byModel[route]` keys | `requests,costUsd,listCostUsd,allowanceUsd` | no `tokens` key |

**4. Plan usage is implemented in this plugin, not proxied from Hermes.** Measured side by side:

```
opencode daemon 127.0.0.1:49374  -> rolling 0 - weekly 3 - monthly 27
plugin route plan-usage          -> rolling 0 - weekly 3 - monthly 27
Hermes sidecar 127.0.0.1:17799   -> HTTP 401 (it requires its own token)
```

The path is `client.js` -> `POST /api/local/opencode-v2/plan-usage` -> `GET
/api/experimental/usage/limits` on the daemon the adapter already talks to, with Basic auth read
from `~/.local/state/opencode/service.json`. No second credential, no sidecar. `17799` appears in
`lib/` exactly once, in a comment recording that the numbers match.

**5. Dead CSS removed.** `.ocv2CostLabel` survived the revert of the destructive
`conversation.input.model.label` experiment — the component was deleted, its style was not.
`grep -o 'ocv2CostLabel'` count is now 0.

**6. Orphaned verification blocks reattached.** The file ended with two `**Verification.**`
paragraphs and no heading, detached from the entries they belonged to. Removed; the entries they
described are already summarised above them.

**Verification.** `npm test` 359/359, `npm run check` OK, `npm run docs:check` OK, packaged as
`0.0.1-rc.10`. **Applied pending restart** for the whole server half: process started 03:08:14;
`lib/http.js` 03:14:43 and `lib/cost.js` 03:21:36 are both later. The client half
(`lib/client.js`) reloads without a restart.
