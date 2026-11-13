<!-- skeleton:
version: 1.0
kind: measurement
status: active
updated: 2026-11-04
summary: Capability delta between deepseek-ai/deepseek-recipe (Rust/Python model-serving library) and the local @nolit/dsh-opencode-v2 plugin. Measured against plugin HEAD dab7240 (0.0.1-rc.10), 359 passing tests, and 24,150 lines of recorded adapter trace (6,727 requests through 2026-11-04). Recipe is a model-side conversion/encoding library with no Node binding, so it cannot replace the plugin's transport; four of its capabilities are still adoptable as specs, three as code. Recommends six cheap changes ranked by measured impact, and rejects a runtime sidecar at current scope.
-->

# deepseek-recipe vs @nolit/dsh-opencode-v2 — capability delta and optimisation report

Measured 2026-11-04 (KST). Every number below was read from the named source at the
time of writing; estimates are labelled **estimate**.

> **Current status (2026-11-05):** this document measures recipe and the plugin at
> `0.0.1-rc.10` / 359 tests. The plugin is now `0.0.2-rc.2` / 413 tests after the subagent merge
> and cleanup. Tier A guards remain applied; Tier B/C are not on the stable stream path; stage 2
> has not been opened (S6 soak is owner-confirmed). The numbers below are the measurement date,
> not today's HEAD.

## 0. What was measured, and what was not

| # | Source | Reading |
|---|---|---|
| S1 | `https://github.com/deepseek-ai/deepseek-recipe` @ HEAD | 182 tree entries, workspace `version = 0.2.0`, edition 2024, MIT, 8 crates + 2 example servers |
| S2 | `dsh-opencode-v2/` @ `dab7240` | `lib/` 23 files / 8,837 lines; `package.json` 0.0.1-rc.10 |
| S3 | `node --test test/*.test.mjs` | 359 pass, 0 fail, 5.2 s |
| S4 | `/tmp/opencode-v2-trace.jsonl` | 24,150 lines, 6,727 requests, 6,131 finishes, 2026-11-01..11-04 |
| S5 | `.runtime-measure/sess-7374.jsonl` | 35 recorded usage steps |
| S6 | `~/.dsh/profiles/web/cordis.patch.yml` | plugin mounted live (symlink to this checkout), provider `opencode-http-agent` |

**Not measured:** no live end-to-end call ran in this pass — the local OpenCode server was not
running (`curl 127.0.0.1:4096/api/info` → `000`), and no new inference quota was spent. Everything
about wire behaviour comes from S4/S5 (real traffic already recorded by the adapter's own trace).

## 1. What deepseek-recipe actually is

It is **model-serving middleware**, not a client SDK. Its stated contract: *"uniformly convert API
requests in different formats into the Conversation format, render conversations into prompts for
DeepSeek models, encode conversations into token IDs with an attached tokenizer, and convert model
output into responses in the corresponding format. The caller must provide model inference, tool
execution, and HTTP transport."*

| Capability | Where | Relevance to a client adapter |
|---|---|---|
| 3 request/response protocols (Messages, Chat Completions, Responses) → one Conversation | `deepseek-recipe/src/protocol/**` | Low — the plugin speaks exactly one wire format |
| V4/V4.1 prompt rendering with explicit special-token ranges | `deepseek-recipe-encoding`, `core/src/prompt.rs` | **High as a spec** — the canonical token spellings |
| `PromptTokenizer`: plain regions batched, special ranges pinned | `encoding/src/tokenizer.rs` | Medium — only if the plugin ever counts tokens |
| `StreamProcessor` + `OutputParser`: staged matcher, markers as `Plain|Special` segments | `src/stream/output_parser.rs` (889 lines) | **High** — a deterministic replacement for regex heuristics |
| `resolve_max_tokens(prompt_tokens, context_limit)` (8192 / 65536 / 131072 by mode, clamped to remaining) | `src/request/mod.rs` | **High** — the plugin has no such clamp |
| Pre-flight validation: tool names, duplicate names, stop sequences, JSON Schema | `src/protocol/validation.rs` | Medium — cheap to mirror |
| Usage with `prompt_cache_hit_tokens` / `reasoning_tokens` (needs tokenizer) | `docs/streaming.md` | Medium — names the two numbers the plugin under-reports |
| Images (OpenCV preprocessing, URL fetch with `DestinationFilter`) | `deepseek-recipe-image` | None — plugin advertises text-only |
| Python wheel; `server-rs` (axum), `server-py` (FastAPI) examples | `deepseek-recipe-python` | Shows the intended integration shape: a **server**, not an npm package |

Hard fact from the tree: **there is no `package.json`, no TypeScript, and no JavaScript binding**
anywhere in the repository (the only `.js` is `encoding-decoding-demo/static/app.js`, a browser
asset). Any Node adoption therefore means IPC to a Rust binary or a Python process, not an import.

## 2. What the plugin actually is, measured

A pure adapter: OpenCode's local server is used only as a control plane (`/api/model`,
`/api/provider/{id}`, `/api/credential`); generation goes straight to
`POST {baseURL}/chat/completions` with `stream:true, stream_options.include_usage:true`. The DSH
host owns the loop, prompt, tools and history.

Measured strengths (do not regress these):

- **Field-typed delta routing** (`lib/upstream-map.js`): a delta is typed by the wire field that
  carried it, never by scanning characters. Measured over recorded traffic: 6,131 finishes,
  4,055 with `finish_reason: tool_calls`, so tool calls overwhelmingly arrive as wire fields.
- **Echo suppression** (`lib/display-gate.js` `settle()`): a text-recovered call is promoted only
  when the tool is declared and no usable structured call of the same name exists.
- **Reservation split** (`lib/shared.js` `turnCompletionReservation`): route capability (384,000) is
  no longer published as the per-turn reservation (16,384). Trace confirms the switch: 2026-11-01/02
  sent `max_tokens: 384000` on 1,250 requests, 2026-11-03 onward sends `16384` on 1,454.
- **Disjoint usage**: `inputTokens = prompt_tokens - cached_tokens`.

Measured weaknesses, with the evidence:

| ID | Weakness | Measurement |
|---|---|---|
| W1 | Protocol notation is handled by a regex state machine, not a grammar | `lib/stream-parser.js` 679 lines, 9 openers, `MAX_OPENER = 16` (so up to 16 chars of prose are held back); 859 of 6,131 finishes (14.0%) carried at least one marker delta |
| W2 | Compensation for not knowing the grammar | `lib/arguments.js` `scanJsonValue`, `lib/display-clean.js` echo parse, `balancedClosers` repair ladder, display-gate dedupe — ~1,000 lines whose only job is to re-derive what recipe's parser derives by construction |
| W3 | No token accounting of its own | 35 recorded steps: 1,947,008 cache-read of 2,018,022 prompt tokens (96.5%); `reasoningTokens` present in 2 of 35 steps even though reasoning is 86.1% of output characters (761 avg reasoning vs 123 avg content per step) |
| W4 | `max_tokens` is not bounded by the context left | `buildChatRequest` sends `options.maxTokens` verbatim; no `min(remaining)` clamp anywhere. Prompt sizes measured: chars p50 54,584 / p90 592,463 / p99 730,120 / max 1,149,234 (≈328k tokens at 3.5 chars/token — 33% of a 1M window on one request) |
| W5 | No stop sequences are emitted for the protocol block | `options.stop` passes through untouched; nothing derives stops from the DSML/thinking tokens |
| W6 | Unknown finish reasons collapse to `stop` | `finishFromOpenAi` maps only `tool_calls`/`length`; `content_filter`, `insufficient_system_resource` and friends are reported as a clean stop |
| W7 | No pre-flight validation of tool names / duplicate names / schemas | `body.tools` is passed from `options.tools` unchanged; recipe validates all three before the request |

Correctness probe of W1 (**run in this pass**, 7-char re-chunking of the same input):

```
input : Use [tool call run_code #abc]: {"code":"x"} syntax to call a tool.
output: Use  syntax to call a tool.            kind: tool-call candidate, source: text
```

Prose that describes the notation is erased from the visible channel and re-armed as a call candidate.
It is only rescued downstream because the name happens to be declared (`settle()` → `superseded`).
The file's own stated invariant I1 ("prose is emitted once, in order, verbatim") does not hold when a
declared tool name appears inside prose.

Two defects the trace recorded are **gone from current code** and are reported only to keep the trace
honest: `state is not defined` (7×, 2026-11-01) and `stableStringify is not defined` (3×,
2026-11-03) — both symbols now exist (`http.js:462`, `display-clean.js:51`), and all 359 tests pass.

## 3. Capability gap matrix

| Recipe capability | Plugin need | Verdict |
|---|---|---|
| Canonical special-token table (Bos/Eos/ThinkingStart/End/System/User/Assistant/Dsml/Image/Ref/Box/Point/Polygon) | The 9 ad-hoc openers in `stream-parser.js` | **Adopt as spec** — replaces invented spellings with the model's own |
| Staged `OutputParser` (ToolCalls → ArgumentName → StringAttribute → Value; markers carry special-token segments; `NewlinesAndMarker` opens a block) | Regex scanner + repair ladder (W1, W2) | **Adopt as design + test oracle** |
| `resolve_max_tokens` (clamp to `context_limit - prompt_tokens`, floor 1, defaults by thinking mode) | Missing (W4) | **Adopt now**, ~20 lines, no dependency |
| Pre-flight validation (tool names, duplicates, stop sequences, schema) | Missing (W7) | **Adopt now** |
| Usage naming (`prompt_cache_hit_tokens`, `reasoning_tokens` only with tokenizer) | Partially reported (W3) | **Adopt partially** — count, do not guess |
| `PromptTokenizer` + `encode` (exact prompt tokens, image token adjustment) | Only needed if the plugin starts making compaction decisions | **Defer** — host owns compaction; the gateway bills |
| `StreamProcessor` protocol chunk generators | Would replace the plugin's whole emission layer | **Reject** — the host already speaks DSH `StreamChunk`s, not OpenAI chunks |
| Images / OpenCV / URL fetcher | Plugin is text-only and declares so | **Not applicable** |
| Rust/Python runtime inside a Node plugin | none | **Reject at current scope** (see §5) |

## 4. Recommended changes, ranked by measured impact / effort

Tier A — no new dependency (**estimate** 1–2 days total):

1. **Clamp `max_tokens` to the context left.** `sent = min(reservation, contextWindow - promptTokens)`,
   never below 1, and surface a typed error instead of letting the route return a mid-turn 400.
   Directly protects the 3,140 requests measured at >120k prompt characters.
2. **Canonical stop sequence for the protocol block** (`Dsml` spelling family from
   `special_tokens.rs`), derived once and applied to `body.stop` when the route has no declared
   tools. Removes the model's need to finish a DSML block it should never have started.
3. **Full finish-reason mapping.** Unknown reasons → `{kind:'error'}` or a new kind, never `stop`.
   A `content_filter` that reads as `stop` is silent data loss in the transcript.
4. **Pre-flight validation** of tool names, duplicates and `parameters` being a JSON object —
   the three checks `validation.rs` performs, translated, applied before the fetch.
5. **Record `reasoning_tokens` absence explicitly.** The trace already proves the field is missing
   in 33 of 35 steps while reasoning is 86% of output characters. Either the route stops reporting it
   or the adapter's usage mapping drops it; today the numbers cannot tell those apart.

Tier B — one focused change (**estimate** 3–5 days):

6. **Replace the opener set with the canonical token table and move the "declared tool" decision
   into the classifier.** Concretely: prose containing `[tool call <name> #<id>]` for an
   *undeclared* name must stay text (measured failure above); prose for a *declared* name should be
   sanitized, not erased. This shrinks the holdback window from 16 chars to the real token length and
   turns ~1,000 lines of repair code into a grammar with a single exit.

Tier C — conformance harness (**estimate** 2 days, highest confidence per hour):

7. **Port recipe's parser behaviour into fixtures**: the stage transitions, the "newlines then marker"
   block opener, JSON-fence close, and the re-chunking invariance. Run them against
   `createStreamClassifier` as a differential oracle. This is the only way to prove the plugin's
   machine matches a reference instead of matching its own tests.

## 5. Why not adopt recipe as a runtime dependency

- No Node binding exists (measured, §1); adoption is a Rust or Python sidecar plus IPC.
- Its scope is the model side: the plugin would gain *conversion* and *encoding*, neither of which it
  currently needs, while inheriting a second toolchain (Rust edition 2024 + `tokenizers` +
  OpenCV-featured crate) on an operator's machine.
- The two numbers that would actually change behaviour — exact prompt tokens and reasoning tokens —
  are already produced by the gateway and billed there; recomputing them locally buys attribution,
  not control, unless compaction moves into the plugin.
- Verdict: **do not vendor it. Copy four specs and one test oracle from it.**

## 6. Falsified / corrected in this pass

- The trace's `state is not defined` and `stableStringify is not defined` errors are **not**
  current defects; both identifiers exist in HEAD (`dab7240`). Earlier drafts of this kind of
  report have cited trace counts as live bugs; they are historical.
- The adapter's echo-recovery does work for declared tools — the adversarial probe above was
  recovered, not dispatched. W1 is a *display/ordering* defect, not yet a dispatch defect.

## 7. Adoption outcome (applied 2026-11-04, same day)

Tier A is applied to the stable package; Tier B and C exist as an unmounted beta package.

| Layer | Before | After (measured) |
|---|---|---|
| `max_tokens` | sent verbatim; no context bound | `min(reservation, window - prompt)`, floored at 1; a prompt that cannot fit is refused as `OPENCODE_CONTEXT_OVERFLOW` before upload |
| Finish reasons | 3 outcomes, unknown -> `stop` | 5 outcomes; filtered/resource/unknown reasons are `error` with their own codes |
| Tool block | passed through unvalidated | name/limit/pattern/duplicate/schema checks, refusal code `OPENCODE_REQUEST_INVALID` |
| Stop lists | passed through | at most 16 entries, none empty |
| Reasoning tokens | absent field indistinguishable from zero | absence recorded on the trace finish line plus one warning per stream |
| Tests | 359 pass | 401 pass (stable) + 12 (beta) |
| Protocol notation | regex classifier, 16-code-unit hold-back | beta parser: canonical markers, 300 re-chunkings invariant, 7 conformance cases |

Two behaviours recorded during the work, both from measurement rather than review:

- The beta parser failed the invariance property at 1-code-unit chunking until the
  hold-back was widened from the token spelling (`<DSML`) to the whole matched marker
  (`<DSMLinvoke name="`). A hold-back that covers only the token is not enough.
- A hand-typed token table was wrong in five of eighteen entries. The shipped table is
  generated from code points and asserted per entry in `test/conformance.test.mjs`.

Deliberately NOT done: no runtime dependency on recipe (no Node binding exists), and the
beta parser is not on the stable stream path. Both were ranked in section 5 and the
ranking still holds.

