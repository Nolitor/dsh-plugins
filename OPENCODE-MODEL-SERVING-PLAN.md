# OpenCode Model Serving — Consolidation Plan and Postmortem

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-10-30
summary: Records the 2026-10-30 subrouter regression (measurement skipped, live profile changed without approval), the measured defects, and the ordered plan to fix them.
-->

> Owner: root doc for the subrouter track. `dsh-subrouter/README.md` is implementation detail; this
> file is the record a later session must find (docs/RULES.md §6 track-not-indexed rule).

## 1. What happened (measured, not intended)

A session added `@nolit/dsh-subrouter` (commit `e709ec3`) and repointed the live `web` profile in
one pass. The rules in `~/.dsh/AGENTS.md` §1 (measure first) and `docs/RULES.md` §2 (live state is
read-only without approval), §4 (four-step plugin replacement with a real-mount check) and §6
(docs skeleton + index) were not followed. Recorded plainly: **the ordering was wrong, not just
the verification.**

Order used: write code -> change live profile -> restart -> (no docs read).
Order required: read docs/boot card -> measure the incumbent -> report and get approval ->
disable -> remove -> add -> real-mount verify -> update docs and index.

## 2. Measured defects in the current live state

Measured 2026-10-30 on `pid` running `dsh --profile web`, HTTP 401 (auth gate healthy).

| # | Defect | Evidence | Root cause |
|---|---|---|---|
| D1 | `x-opencode-session` header absent on some dispatches | `{"type":"error","type":"MissingSessionID"}` from `https://opencode.ai/inference/go/v1` | The header was only sent when DSH passed a session id; catalog/title dispatches pass none. The requirement was already recorded in `OPENCODE-V2-HTTP-API-MEASUREMENT.md`. |
| D2 | Inference reasoning-level option missing from the model picker | `grep reasoningEffort dsh-subrouter/lib/adapter.js` -> none | `dsh-llm-pi-ai` exposes `reasoningEfforts` (`lib/index.js:587`, `:1970`); the subrouter adapter never implemented it, so disabling `llm-pi-ai` removed the control. |
| D3 | Measured v2 parameters/behaviour not reused | `dsh-opencode-v2` v0.3.7 holds 175 passing tests over the v2 surface | The subrouter was written from scratch instead of following `OPENCODE-V2-SURFACE-MEASUREMENT.md` and `CLI-WORKER-STANDARD.md`. |
| D4 | "Registered/verified" claimed without a real mount | Only `--dump-config` (rc=0) was run | `docs/RULES.md` §4 states explicitly that `--dump-config` does not prove a mount. |
| D5 | Track docs missing skeleton headers; root docs never updated | `npm run docs:check` FAIL before this file | `docs/RULES.md` §6. |

## 3. Current live routing (measured)

| Row | State |
|---|---|
| `agent-default-model` | `deepseek-account / deepseek-flash`, `reasoningEffort: 'off'` |
| `llm-pi-ai` | `disabled: true` |
| `llm-deepseek` (api-key) | `disabled: true` |
| `dsh-subrouter` | active; `subrouter-openai` and `subrouter-anthropic`, 28 OpenCode Go models each |
| Reasoning-level control | **absent** for every subrouter model (D2) |

Backups created during the session (restore source, do not delete):

```
~/.dsh/profiles/web/cordis.patch.yml.bak.before-subrouter-20261030_083908
~/.dsh/profiles/web/cordis.patch.yml.bak.before-deepseek-only-20261030_091010
```

## 4. Ranked plan

Nothing below runs without approval. Steps 1-2 restore the user-visible regression first.

| Step | Action | Gate |
|---|---|---|
| 1 | Restore `llm-pi-ai` so the reasoning-level control returns | approval, then restart |
| 2 | Keep `dsh-subrouter` disabled, or move it to an isolated profile until step 4 passes | approval |
| 3 | Re-read the v2 sources of truth and write the subrouter conformance list: session header, `reasoningEfforts` per model, variants -> wire mapping, usage/cache accounting, abort/timeout/error codes | none (read-only) |
| 4 | Implement and verify in an isolated `DSH_HOME`: per-model `variants` from `opencode-models.json` -> `reasoningEfforts`; always-present session header; OpenAI `reasoning_effort` and Anthropic `thinking.budget_tokens` mapping | isolated mount only |
| 5 | Real-mount verification of the subrouter route inside an isolated profile (tool/call, tool/result, delivery counters, tiering) | isolated profile |
| 6 | Only then consider the live profile, with the four-step replacement and a restart window the user chooses | approval |

## 5. Sources of truth for step 3

- [OPENCODE-V2-SURFACE-MEASUREMENT.md](OPENCODE-V2-SURFACE-MEASUREMENT.md) — variants per model, event schema
- [OPENCODE-V2-HTTP-API-MEASUREMENT.md](OPENCODE-V2-HTTP-API-MEASUREMENT.md) — server auth, session header, SSE, usage/cache, permissions
- [CLI-WORKER-STANDARD.md](CLI-WORKER-STANDARD.md) — worker argv/stdin/artifact contract
- `dsh-opencode-v2/lib/*` — the working v2 implementation and its 175 tests
- `~/.dsh/profiles/web/opencode-models.json` — measured `variants`, `contextWindow`, `maxTokens` per route

## 6. Rules restated for the next session

1. Read `~/.dsh/AGENTS.md` -> `docs/RULES.md` -> `docs/SKELETON.md` -> latest boot card before acting.
2. Measure the incumbent implementation before writing a replacement.
3. `~/.dsh` and the 3080 service are the user's; no writes or restarts without explicit approval.
4. `--dump-config` is not a mount. Verify by real mount in an isolated `DSH_HOME`.
5. Measurements and decisions belong in a root doc like this one, not only in a track README.
