# FINDINGS — subagent tool-call errors & OpenCode HTTP 451 / hy4-preview

<!-- skeleton:
version: 1.0
kind: measurement
status: measured
updated: 2026-11-05
summary: Measured error taxonomy of the 7 child subagents of session-e42cf5d8, plus the step-5-preview HTTP 451 verdict and hy4-preview execution history, from 114 DSH session logs.
-->

- Owner: teammate `error-analyst` (shared task **task-2**).
- Snapshot: **2026-11-05 07:56:55 KST** (live sessions were still being appended; see §7 Limitations).
- Read-only sources: `~/.dsh/sessions/**/session.v4.jsonl.zstd` (114 files), `~/.dsh/profiles/web/{opencode-model-verdicts,opencode-models,opencode-known-models,opencode-session-cost}.json`, installed plugin `~/.dsh/profiles/web/node_modules/@nolit/dsh-opencode-v2`, repo `.runtime-measure/*`, `artifacts/token-saving-3d/*`.
- Artifacts (all in this dir): `sessions.json`, `matches.jsonl`, `failures.jsonl`, `retries.jsonl`, `taxonomy.json`, `child_metrics.json`, `children_detail.json`, `perfail.json` + scripts `scan_all.py`, `scan_failures.py`, `children_detail.py`.

---

## 0. Answers to the Lead's key questions

### Q1. Was the step-5-preview 451 a DSH-client bug or an upstream OpenCode endpoint failure?

**Upstream OpenCode backend endpoint failure**, not a DSH request-construction bug — but DSH-client
policy turned a single transient upstream refusal into the loss of a 27-step child.

- The failing response is the backend's **own** JSON envelope, relayed verbatim:
  `OpenCode backend HTTP 451: {"error":{"type":"server_error","message":"Upstream request failed: Endpoint is unavailable."}}`
  (`b70d93d8` seq 259/261, 2026-11-05 07:30:44.712/.716 KST).
- The **identical config** (provider `opencode-http-agent`, model `opencode-go/step-5-preview`, maxTokens 16384)
  had just run **27 steps / 34 tool calls / 3m33s** successfully; last successful tool result at 07:30:42.867 KST.
- **0 retries**: exactly one `assistant/attempt`; no `llm/retry`/`llm/retry-started` in the whole session.
  Root cause of the no-retry: the failure code `OPENCODE_BACKEND_HTTP` is not in the host retry policy
  (`policyKey = ["normal",5,["EMPTY_RESPONSE","RATE_LIMIT","SERVER","TIMEOUT","TRANSPORT"],500,10000,0.1]`)
  and the adapter returns immediately on any non-2xx (`@nolit/dsh-opencode-v2/lib/http.js:1786-1800`).
- **Timing correlation**: no other model failed within ±10 min. The replacement run `022a9249`
  (iceman-contributor-free) started at 07:30:58 (14 s after the 451) and completed at 07:38:48 with
  0 LLM failures → other routes were healthy at the same time.
- **Same model elsewhere**: `opencode-go/step-5-preview` never executed in any other session (only `b70d93d8`
  in 114 logs). Last known-good probe of the route: `.runtime-measure/dump/measure.json` (written
  2026-10-30 23:24:30) records HTTP 200 `usable` for it.
- **Correction to a tempting shortcut**: `~/.dsh/profiles/web/opencode-model-verdicts.json` has
  `"opencode-go/step-5-preview": "unavailable"` with `measuredAt = 2026-11-04T22:30:44.712Z`
  = 2026-11-05 07:30:44.712 KST — *exactly* the failure ms. This is **not independent evidence**:
  the plugin persists a verdict from real traffic on any non-OK response (`observe()`, `http.js:1786`;
  `lib/verdict-store.js`; `classifyProbe()` maps `/unavailable/i → "unavailable"`), and by design there is
  "deliberately no probe routine". So the verdict file is a downstream record of this same 451.
- Confidence: **high (upstream)**. Residual client-side gaps found, in severity order:
  1. `OPENCODE_BACKEND_HTTP` (incl. 451) is classified non-retryable → zero retries for a `server_error`;
  2. no mid-turn model fallback; the turn dies immediately;
  3. partial work is not preserved/salvaged (contrast: `TRANSPORT` cuts are retried and preserved);
  4. the persisted "unavailable" verdict is memory of a one-off 451 and is now served to the settings tab.

### Q2. What exactly is "hy preview", and did `opencode-go/hy4-preview` ever execute?

"Hy preview" = **`opencode-go/hy4-preview`, catalog name "Hy4 preview", model family "Hy"** — a *paid-tier
preview* route on the OpenCode Go backend (not a free model):

| field | value (source: `~/.dsh/profiles/web/opencode-models.json` savedAt 07:47:11; `.runtime-measure/model-full.json` probe 10-30 23:14) |
|---|---|
| id / name | `opencode-go/hy4-preview` / `Hy4 preview` |
| family | `Hy` (siblings: `opencode-go/hy4` "Hy4", `opencode-go/hy3` "Hy3") |
| modalities / variants | text-only input, variants `none` / `high` |
| limits | context 1,024,000 · max output 64,000 |
| price (list) | in $0.834/M · out $2.501/M · cache-read $0.042/M |
| released / status | 2026-08-28 KST · `active` in catalog |

**It executed successfully — twice — and is not part of the 7-child failure story.**
Full exact-match scan of all 114 session logs (only `request/header`, `request/context`, `model/selection`,
`subagent/descriptor`, `session` events):

| session | what | time (KST) | result |
|---|---|---|---|
| `session-a89aa930-e440-4fbd-902b-deede4e04c7c` (proj `dsh-workspace`) | manual model switch `model/selection` seq 64 → request/header seq 71 → reply seq 73 | 2026-10-31 01:42:25 → 01:43:18 | `turn/end` seq 75 **completed**, 0 errors |
| `efb38152-6f1e-4722-9486-5dee4fdb7c9f` (child of `session-55b09c80`, label "Probe hy4-preview subagent route") | request/header seq 14 | 2026-11-05 07:50:19.495 → 07:50:37.897 | `turn/end` seq 24 **completed**, 0 errors |

- `opencode-go/hy4` (non-preview) and `opencode-go/hy3`: present in config/catalog and in
  `subagent-model-selection-settings.allowedModels`, but **never executed** (no request in any log).
- **No "hy preview" drops exist**: 0 failures on any `hy*` route in the 3-day window; 0 tool errors in the
  `hy4-preview` session.
- **step-5-preview was not a substitution for hy4-preview.** The Lead explicitly dispatched the child with
  `model: "opencode-go/step-5-preview"` (`parent` `tool/ptc-dispatch` 2026-11-05 07:27:11.500, label
  "Per-day trend and regime timeline"); `hy4-preview` only appears in the session's allowedModels policy list.
  The re-run was also explicit: `022a9249` = `opencode-go/iceman-contributor-free` (07:30:58).

---

## 1. Population — the 7 children of `session-e42cf5d8`

All children ran provider `opencode-http-agent`, preset `ptc`; each had exactly one directly callable tool,
`run_code` (verified in each child's `request/header` tools list and system message).

| child | label | model | steps | tool calls | root tool errors | rate | turn outcome | start → end (KST) |
|---|---|---|---|---|---|---|---|---|
| `59429101` | Primary 3-day token saving measurement | opencode-go/deepseek-v4.1-flash | 111 | 110 | 3 | 2.7% | completed | 07:26:50 → 07:53:24 |
| `1217d636` | Engine-side independent cross-check | opencode-go/minimax-m3.1-flash | 106 | 105 | 4 | 3.8% | completed | 07:27:11 → 07:41:20 |
| `5b72bfc9` | Cost attribution and counterfactual | opencode-go/deepseek-v4.1-flash | 51 | 50 | 2 | 4.0% | completed | 07:27:11 → 07:39:43 |
| `5d17dd9f` | Adversarial audit of savings claims | opencode-go/beam-free | 104 | 103 | 17 | 16.5% | completed | 07:27:11 → 07:40:10 |
| `b70d93d8` | Per-day trend and regime timeline | opencode-go/step-5-preview | 28 | 34 | 9 | 26.5% | **error (451)** | 07:27:11 → 07:30:44 |
| `022a9249` | Re-run per-day trend on free preview model | opencode-go/iceman-contributor-free | 57 | 56 | 12 | 21.4% | completed | 07:30:58 → 07:38:48 |
| `72fa9915` | Re-run adversarial audit | opencode-go/iceman-contributor-free | 47 | 46 | 16 | 34.8% | **in-flight at snapshot** | 07:40:21 → … |
| **TOTAL** | | | **504** | **504** | **63** | **12.5%** | 5 completed, 1 error, 1 in-flight | |

Notes: the first scan (07:40) saw 87/105/50/101/34/56/18 tool calls because `59429101` and `72fa9915` were
still writing; `72fa9915` grew from 39 → 46 calls between 07:53 and 07:56. 63 tool errors are all root
`tool/result` errors (`data.error` / `message.isError`).

## 2. Error taxonomy (1) — was "CodeRunFailedError" a model or a harness problem?

**Verified: model-generated errors, not a PTC parser/transformer bug.**
- 63/63 root errors are attributable to model output: malformed JS/TS in the `code` argument, wrong tool
  arguments, calling a non-callable tool, wrong file pre-image, or wrong runtime assumptions.
- The recorded `code` arguments are complete valid JSON strings (no truncation); the reported messages are
  the runtime's real V8/TS parse errors and carry no line/column rewriting.
- Strongest check: the one suspicious *runtime* error — `TypeError: 3.7 is not a function`
  (`5b72bfc9` seq 391, step 36) — **reproduces 1:1 in plain Node outside DSH**. Cause in the model's code:
  it wrote `that session, `/3.7`, ...` inside a `String.raw` template without the ` + "`…`" + ` escaping used on
  every other line, so the template closed and `3.7` became a tagged-template call. `node --check` passes
  (valid syntax); execution throws exactly `TypeError: 3.7 is not a function`. Harness reported it faithfully.
- 3 further checks: the `run_code` schema does advertise `required: ["code","description"]`, so the 4
  `INVALID_ARGS` errors are the model omitting a required field, not a schema defect; the PTC system prompt
  and tools list expose only `run_code`, so the 3 `UNKNOWN_TOOL` errors are model misuse; the 2
  `old_string not found` errors are edit pre-image mismatches.

### Aggregate taxonomy (63 errors)

| # | category | count | share | definition |
|---|---|---|---|---|
| a | `ptc_parse_error` | **45** | 71.4% | model's `run_code` body is syntactically invalid JS/TS (V8 syntax / TS-transform error) |
| b | `invalid_tool_args` | 4 | 6.3% | `ToolArgsError`/`INVALID_ARGS` — required property missing (`description` ×3, `code` ×1, all in `b70d93d8`) |
| c | `unknown_tool` | 3 | 4.8% | `ToolNotFoundError`/`UNKNOWN_TOOL` — direct call of `bash`/`write` instead of via `run_code` |
| d | `runtime_js` | 8 | 12.7% | program ran but threw: `ReferenceError: path is not defined`, `ERR_MODULE_NOT_FOUND` (guessed `@mongodb-js/zstd`, `zstd`), `ENOBUFS`, `Command failed: … node: not found`, tagged-template TypeError |
| e | `old_string_not_found` | 2 | 3.2% | `ToolCallError: old_string was not found in …/d-audit/audit.mjs` |
| f | `ptc_timeout` | 1 | 1.6% | `code run failed (timeout): execution deadline reached (120000ms)` |
| | **total** | **63** | 100% | |

### Per-child / per-model breakdown

| child | model | calls | err | a parse | b args | c unknown | d runtime | e oldstr | f timeout | rate |
|---|---|---|---|---|---|---|---|---|---|---|
| `59429101` | deepseek-v4.1-flash | 110 | 3 | 1 | – | – | – | 2 | – | 2.7% |
| `1217d636` | minimax-m3.1-flash | 105 | 4 | 4 | – | – | – | – | – | 3.8% |
| `5b72bfc9` | deepseek-v4.1-flash | 50 | 2 | 1 | – | – | 1 | – | – | 4.0% |
| `5d17dd9f` | beam-free | 103 | 17 | 15 | – | 2 | – | – | – | 16.5% |
| `b70d93d8` | step-5-preview | 34 | 9 | 4 | 4 | 1 | – | – | – | 26.5% |
| `022a9249` | iceman-contributor-free | 56 | 12 | 9 | – | – | 3 | – | – | 21.4% |
| `72fa9915` | iceman-contributor-free | 46 | 16 | 11 | – | – | 4 | – | 1 | 34.8% |

By model (children): deepseek-v4.1-flash 5/160 = 3.1% · minimax-m3.1-flash 4/105 = 3.8% ·
beam-free 17/103 = 16.5% · step-5-preview 9/34 = 26.5% · iceman-contributor-free 28/102 = 27.5%.
(The parent session `e42cf5d8` had 3 further run_code errors of its own: `ReferenceError: B is not defined`
seq 248, `ToolCallError: active teammate "5d17dd9f…" not found` seq 802, `TypeError: Cannot read properties
of undefined (reading 'text')` seq 963.)

### Verified sample evidence (seq / step / exact model mistake)

| cat | child | seq/step | evidence (from raw `tool/call.arguments.code` or error text) |
|---|---|---|---|
| a | `1217d636` | 54/5 | code tail `…"…jsonl", description:Inspect events.jsonl and untool.json content" });` — unquoted object value → `Expected ',', got 'ident'` |
| a | `b70d93d8` | 48/3 | `command: '…; sed -n '1,80p' scripts/…'` — nested single quotes break the JS string → `Expected ',', got 'numeric literal'` |
| a | `5d17dd9f` | 34/3 | `command: "… && echo "---TRACKS---" && …"` → `The left-hand side of an assignment expression must be a variable or a property access.` |
| a | `5d17dd9f` | 210, 365, 508, 531 | raw shell heredoc / shell command pasted as the JS body (not wrapped in `tools.bash`) → `Unknown regular expression flags.` |
| a | `72fa9915` | 73, 78, 83, 88 … | raw shell command as JS body → `Expression expected.` |
| d | `5b72bfc9` | 391/36 | reproduced with plain node: `TypeError: 3.7 is not a function` (unescaped backticks around `/3.7`) |
| d | `022a9249` | 60/9, 65/10 | `ERR_MODULE_NOT_FOUND: Cannot find package '@mongodb-js/zstd'`; `ReferenceError: path is not defined` |
| d | `72fa9915` | 196/33, 140/22 | `spawnSync /bin/sh ENOBUFS`; `Command failed: … node: not found` |
| b | `b70d93d8` | 20, 22, 224 / 1,1,23 | `invalid arguments: missing required property "description"`; seq 107/8 `… "code"` — schema does list both as required |
| c | `5d17dd9f` | 20/1, 187/24 | `unknown tool "bash": only run_code is callable directly`; same for `"write"` |
| c | `b70d93d8` | 172/17 | `unknown tool "write": only run_code is callable directly` |
| e | `59429101` | 789/77, 812/80 | `ToolCallError: old_string was not found in "…/d-audit/audit.mjs"` |
| f | `72fa9915` | 226/39 | `code run failed (timeout): execution deadline reached (120000ms)` |

**Wasted steps** (steps whose only tool results were errors): 3+4+2+17+6+12+16 = **60 of 504 steps (11.9%)**;
62 steps hit at least one tool error. `b70d93d8` is the only child where errors ended the turn.

## 3. The HTTP 451 failure — exact evidence

`b70d93d8` (`b70d93d8-a3dd-4b34-b280-3f5fead6d21b`), 263 events, created 2026-11-05 07:27:11.370 KST.

| seq | time (KST) | event | payload (abridged) |
|---|---|---|---|
| 15 | 07:27:11.644 | `request/header` | provider `opencode-http-agent`, model `opencode-go/step-5-preview`, maxTokens 16384 |
| 254 | 07:30:42.785 | `job/settled` | last bash job `exit code: 0` |
| 256 | 07:30:42.867 | `tool/result` | last successful tool result (bash) |
| 258 | 07:30:42.897 | `step/start` | turn 1, **step 28** |
| 259 | 07:30:44.712 | `assistant/attempt` | `finish / error`: `{code:"OPENCODE_BACKEND_HTTP", message:"OpenCode backend HTTP 451: {\"error\":{\"type\":\"server_error\",\"message\":\"Upstream request failed: Endpoint is unavailable.\"}}"}` |
| 260 | 07:30:44.715 | `step/end` | turn 1, step 28 |
| 261 | 07:30:44.716 | `turn/end` | `{kind:"error", error:{…OPENCODE_BACKEND_HTTP…}}` |

- Attempts = 1, retries = 0, `llm/retry*` = 0. Error answered 1.8 s after step start.
- Structural cause of no retry (client side), quoted from the installed plugin:
  - `lib/http.js:1786-1800` — on `!response.ok`: `observe(model, classifyProbe(status,text))`, then yield
    `failure.code = OPENCODE_BACKEND_HTTP` and `return` (no retry loop).
  - Host policy (from `llm/retry` events): `maxRetries=5`, retryable = `EMPTY_RESPONSE, RATE_LIMIT, SERVER,
    TIMEOUT, TRANSPORT` → `OPENCODE_BACKEND_HTTP` **not retryable**.
  - `classifyProbe()` → `/unavailable/i` → state `unavailable`; the persisted verdict file
    (`measuredAt 2026-11-04T22:30:44.712Z`) is written from this failure (§0 Q1).
- Correlation window ±10 min: only `b70d93d8`. Replacement `022a9249` (iceman) ran 07:30:58–07:38:48 with
  0 LLM failures; session `72fa9915` started 07:40 and had only TRANSPORT stream-cuts (retried).
- Historical same-route evidence: `.runtime-measure/dump/measure.json` (mtime 2026-10-30 23:24:30) lists
  `{"route":"opencode-go/step-5-preview","status":200,"state":"usable"}`.
- Cost of the failure: first child 28 steps / 34 calls discarded; Lead re-ran the whole track
  (`022a9249`: 57 steps / 56 calls, 07:30:58 → 07:38:48, completed) ≈ **56 duplicate tool calls / ~7.8 min**.
  The first child had already produced `e-trend/trend.mjs`, `report.json`, `run.log`, `daily.csv`
  (07:29:03–07:29:13) and diag scripts (up to 07:30:36) but no final `report.md`.

## 4. 3-day per-model LLM failure table (2026-11-02 00:00 → 11-05 07:56 KST)

All `turn/end` error events + attempt-level retry failures found by scanning all logs; only events whose
`time` falls in the window are counted. `model` = route active at the failure (tracked from the most recent
`request/header`/`model/selection`).

| model | failures | codes / causes | example (time KST, session, seq) | retries |
|---|---|---|---|---|
| `opencode-go/deepseek-v4.1-flash` | **12** (9 backend + 3 local) | 8× `OPENCODE_BACKEND` 404 `ProviderNotFoundError` from the **local opencode control plane** (`GET /api/provider/opencode-go`); 1× `OPENCODE_BACKEND: fetch failed`; 2× `UNKNOWN` `loaded skill "interrupt-guide" source must be a string`; 1× `UNKNOWN` `Cannot read properties of undefined (reading 'kind')` | 11-02 06:04:23 `session-bca2` seq 30 (fetch failed); 11-03 21:06:17 `session-13a47456` seq 4793 (404); 11-04 23:51:54 `session-4974cafa` seq 3140 (404) | 0 |
| `opencode-go/iceman-contributor-free` | 0 turn-level; **2 stream-cut episodes** | `TRANSPORT` `OpenCode backend stream ended before [DONE] … no visible output` (2× with output-93-delta, 4× 0-delta) | 11-05 07:40:26 `72fa9915` step 1; 11-05 07:45:25–07:45:37 `72fa9915` step 16 | **5** (recovered) |
| `opencode-go/step-5-preview` | **1** | `OPENCODE_BACKEND_HTTP` **451** `Endpoint is unavailable` | 11-05 07:30:44.712 `b70d93d8` seq 259/261 | 0 |
| `deepseek-flash` | 0 turn-level | `TRANSPORT` `DeepSeek Messages transport failed` | 11-04 21:02:04 `session-ea…` turn 5 step 70 | 1 (recovered) |

Retries in window: **6 retries** (12 `llm/retry`+`llm/retry-started` records) — 5 on iceman/`72fa9915`,
1 on deepseek-flash. Delay schedule observed 0.5→1.0→1.9→3.6 s.

Reading: LLM-level drops are **not** spread across free preview models in general. They cluster on
(1) the legacy local-daemon route `opencode-go` used by top-level sessions (9× in 3 days,
all on deepseek-v4.1-flash, all `GET /api/provider/opencode-go → 404 ProviderNotFoundError`), and
(2) preview/free routes' stream cuts (iceman) / endpoint removal (step-5-preview). Children on
`opencode-http-agent` were otherwise LLM-stable: 5 of 7 children had zero LLM-level failures.

## 5. Notes on naive parsing vs measured reality

- `analyze.py`'s counts are reproducible but understate population drift: at 07:40 the 7 children showed
  87/105/50/101/34/56/18 calls; by 07:56:55 the same logs show 110/105/50/103/34/56/46 (children were still
  running). The error taxonomy above is from the frozen 07:56:55 snapshot (`child_metrics.json`, `taxonomy.json`).
- The "errors dominated by `CodeRunFailedError`" impression is correct as a *name* (56/63 = 88.9%) but
  misleading as a *cause*: that one error name covers 45 parse errors, 8 runtime errors, 2 old_string
  errors and 1 timeout — all model-side (`children_detail.json`).
- `5d17dd9f` (beam-free) and `022a9249`/`72fa9915` (iceman) carry the highest tool-error rates (16.5–34.8%);
  deepseek/minimax children are 2.7–4.0%. LLM-level reliability and tool-call correctness are independent
  axes here: `5d17dd9f` had 0 LLM failures but 17 tool errors.

## 6. Reproduction / scripts

- `scan_all.py` — streams all `session.v4.jsonl.zstd`, builds `sessions.json` + `matches.jsonl`
  (keyword matches for `OPENCODE_BACKEND_HTTP`, `HTTP 451`, `Endpoint is unavailable`, `hy4`,
  `step-5-preview`, `llm/retry`, 5xx, `ProviderNotFoundError`).
- `scan_failures.py` — model-attributed failures/retries/session aggregates (`failures.jsonl`,
  `retries.jsonl`, `perfail.json`).
- `children_detail.py` — per-child root & sub-dispatch error extraction (`children_detail.json`).
- Inline classifier (same dir) — final taxonomy (`taxonomy.json`); child metrics (`child_metrics.json`).
- Independent parse/runtime check: extract a failing `tool/call.arguments.code`, wrap in
  `async () => { … }`, run with plain `node` — reproduces the harness message for the tagged-template case.

## 7. Limitations

1. **Live data**: 111 logs at 07:40 → 114 at 07:53 because sessions (incl. this diagnosis team's own
   sessions) were created/appended during analysis; `72fa9915` is still in-flight (46 calls at 07:56:55).
2. Session logs do not record the outbound HTTP request headers/body for `opencode-http-agent` turns
   (`request/header` stores model config + tool schemas only). Conclusions rest on the backend's own error
   envelope, the identical-config 27-step success, zero-retry evidence, and same-window behavior of other routes.
3. `opencode-model-verdicts.json` "unavailable" for step-5-preview is derived from the 451 itself
   (`observe()` path), not a second measurement; `opencode-models.json` is a catalog listing (07:47:11 today)
   and does not prove current inference entitlement.
4. `.runtime-measure/*` used only as historical (2026-10-30) entitlement-probe evidence.
