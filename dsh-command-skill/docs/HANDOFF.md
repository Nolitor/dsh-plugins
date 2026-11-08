# Command & Skill Contract — Handoff

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-08
summary: Stage-by-stage handoff for @nolit/dsh-command-skill at 0.0.1-rc.1 — a documentation-only track that registers nothing, its unresolved interrupt-architecture decision, and its draft config-externalization design.
-->

> History lives in [CHANGELOG.md](../CHANGELOG.md). This file is the **forward** view.

## 1. State

| Item | Measured value |
| :--- | :--- |
| Package | `@nolit/dsh-command-skill@0.0.1-rc.1` |
| `private` | `true` — not a publish target |
| Runtime surface | **none** — this package registers nothing and is installed in no profile |
| Test script | none (a contract verifier exists: `scripts/verify-contract.mjs`) |
| CHANGELOG last written | 2026-11-05 |

## 2. Done

- Interrupt architecture review (A: wire into the TokenEconomizer watchdog vs B: a standalone
  `dsh-interrupt` plugin) in [INTERRUPT-ARCHITECTURE.md](INTERRUPT-ARCHITECTURE.md).
- Measured interrupt lifecycle defects in [INTERRUPT-LIFECYCLE.md](INTERRUPT-LIFECYCLE.md).
- Cross-project contract with `projects/total_skill` in
  [CROSS-PROJECT-COLLABORATION.md](CROSS-PROJECT-COLLABORATION.md).
- Isolated `DSH_HOME` contract harness (`scripts/verify-contract.mjs`).

## 3. Stages

### S1 — decide A or B for the interrupt capability

[INTERRUPT-ARCHITECTURE.md](INTERRUPT-ARCHITECTURE.md) compares both wirings on failure isolation,
blast radius, mount-surface risk and maintenance. **No implementation has started; the choice is an
owner decision.** Nothing else in this track can move until it is made.

### S2 — config externalization (draft)

[research/CONFIG-EXTERNALIZATION-DESIGN.md](research/CONFIG-EXTERNALIZATION-DESIGN.md) is a draft
that measures the option-resolution chain and proposes a fail-open JSON settings file. Its own
prerequisites are unmet: two dangling `@deepseek-ai/{schemastery,cosmokit}` symlinks, 13
`assert.throws` tests to rewrite, and an accepted Settings-UI save writing the profile patch.

### S3 — keep the contract current

When `projects/total_skill` or the interrupt boundary changes, update
[CROSS-PROJECT-COLLABORATION.md](CROSS-PROJECT-COLLABORATION.md) in the same round. Duplicate
command/skill names are a hard mount failure.

## 4. Verification

```bash
node dsh-command-skill/scripts/verify-contract.mjs
```
