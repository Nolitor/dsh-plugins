# OpenCode v2 — Handoff

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-08
summary: Stage-by-stage handoff for @nolit/dsh-opencode-v2 at 0.0.1-rc.3 — the delivered CLI-subagent work, the three open stage-1 observations that need an owner verdict, and the gated stage-2 parser swap.
-->

> History lives in [CHANGELOG.md](../CHANGELOG.md). This file is the **forward** view.
> Stage authority: [OPENCODE-V2-STAGE-PLAN.md](OPENCODE-V2-STAGE-PLAN.md).

## 1. State

| Item | Measured value |
| :--- | :--- |
| Package | `@nolit/dsh-opencode-v2@0.0.1-rc.3` |
| Last code commit | `abd53f5` 2026-11-08 — CLI subagent model selection, absolute resolution, usage ledger |
| Tests | `npm test` → **471/471 pass** |
| Stage | **stage 1 (stabilisation) in progress** |

## 2. Done

- Managed child-session delegation cutover (the `opencode` tool returns a child id immediately).
- `request.agentOptions.model` beats `config.model` and reaches `opencode run -m`.
- `resolveExecutable()` — the default bare `opencode` is not on the host PATH; every delegation
  used to fail before the CLI started.
- Usage: `parseRunStream` sums `step_finish` tokens; `sharedCostLedger()` makes the CLI row and the
  HTTP row feed the **same** `opencode-session-cost.json`.

## 3. Stages

### S1 — stage-1 observations awaiting an owner verdict

Each needs an owner report first; do **not** pre-emptively "fix" these.

| # | Observation | Evidence | Needs |
| :--- | :--- | :--- | :--- |
| O1 | Prose that mentions the call notation is erased and re-armed as a call candidate | reproducible 2026-11-04: `Use [tool call run_code #abc]: {...} syntax…` loses the sentence | is this a display bug to fix before stage 2? |
| O2 | Marker glyph drift — `｜` (U+FF5C), `│` (U+2502), `|` used for the same token | 1,048 / 7,291 finishes (14.4 %) carried a marker delta | stage 2 handles it; no standalone fix |
| O3 | `content_filter` maps to an error | 26 occurrences in trace | confirm the host handles the error kind well |

### S2 — canonical parser swap

Replace the 679-line regex classifier with the staged parser in
`staging/opencode-v2-stage2/`, behind `parser: 'legacy' | 'canonical'` (default `legacy`).
Keep `stream-parser.legacy.js` for one release. Entry condition: S1 verdicts.
Implementation brief: [OPENCODE-V2-IMPROVEMENT-SPEC-20261107.md](OPENCODE-V2-IMPROVEMENT-SPEC-20261107.md).

### S3 — shared stream pipe (P4) integration

The pipe-side delivery is `classifyText`. Its owner-side work is in the Custom Router handoff
(`dsh-custom-router/docs/HANDOFF.md` S1); this track supplies the hook.

### S4 — OpenCode 2.2.6 job/session APIs

[OPENCODE-226-JOB-SESSION-INTEGRATION-ROADMAP.md](OPENCODE-226-JOB-SESSION-INTEGRATION-ROADMAP.md)
is a **draft**. P0 requires owner approval and a DB backup. Not scheduled.

## 4. Open state

- `modelSelection: true` arrives through the Custom Router preset; the live profile patch does
  **not** carry `modelSelection` (measured absent). Not a defect — recorded so the next reader does
  not look for it in the profile.
- Multiple older CHANGELOG entries carry "applied pending restart"; those are historical. The
  current `rc.3` row is applied on disk.

## 5. Verification

```bash
cd dsh-opencode-v2 && npm test
```
