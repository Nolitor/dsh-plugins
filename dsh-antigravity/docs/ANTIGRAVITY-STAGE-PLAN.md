# Antigravity Stage Plan — the same S1–S7 gate as OpenCode v2

<!-- skeleton:
version: 1.0
kind: design
status: active
updated: 2026-11-05
summary: Stage-1 stabilisation gate for @nolit/dsh-antigravity, the measured S1–S7 status after today's reinforcement, and the rule that its stage 2/3 upgrades ride with the OpenCode v2 stage plan.
-->

> Status: **stage 1 machine-decidable criteria PASS** · S6 soak **UNKNOWN (owner-confirmed)** ·
> Sibling: [dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md](../../dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md) · Evidence:
> [CHANGELOG](../CHANGELOG.md), [FAILURE-LEDGER](../../docs/FAILURE-LEDGER.md)

## 1. Why this document exists

The OpenCode v2 stage plan defines seven exit criteria (S1–S7). Stage 1 was applied to
`@nolit/dsh-opencode-v2`; `@nolit/dsh-antigravity` was created the same day and never had that
gate applied. The owner's instruction (2026-11-05) is therefore:

1. finish **stage-1 reinforcement** for Antigravity now;
2. when the OpenCode v2 beta plan enters stage 2, **upgrade Antigravity in the same round**;
3. do **not** open stage 2 for either track while its S6 soak is unconfirmed.

## 2. The gate (identical to the OpenCode v2 plan §2)

| # | Criterion | How it is measured | Antigravity status (2026-11-05 06:47 KST) |
| :--- | :--- | :--- | :--- |
| S1 | No entry fails to activate | journal since service start: zero `did not activate` | **PASS** — none since 06:17:49 |
| S2 | Served build matches the tree | `scripts/verify-antigravity-restart.sh` (pid + load beacon + package.json) | **PASS** — pid 2065914 loaded `0.0.1-rc.4` |
| S3 | Unit suite green | `node --test test/*.test.mjs` in `dsh-antigravity` | **PASS** — 90 tests, 0 fail |
| S4 | Isolated boot clean | `--boot`: copy profile to temp `DSH_HOME`, boot `dsh web --port 0` | **PASS** — no activation warnings |
| S5 | Browser boot clean | `--browser`: Playwright loads the page, checks the client entry, opens Settings → Antigravity and finds the grouped model list | **PASS** — `{rendered,hasEntry,hasTab,hasGroup}:true` |
| S6 | Soak: a day of real turns, no new defect attributable to this plugin | owner usage + trace review | **UNKNOWN** — time has not passed |
| S7 | Every closed defect keeps a regression test | static test-file check | **PASS** — client-inject, server, ledger, switch, models-group, catalog, wire |

S6 is the one gate this round cannot satisfy: it is a time-and-usage criterion, not a code change.
**Stage 1 is not "done" until the owner confirms the soak.**

## 3. What this round added for stage 1

| Piece | Purpose |
| :--- | :--- |
| `lib/beacon.js` → `/tmp/antigravity-boot.jsonl` | the serving pid records the package version it loaded; the version is read from `package.json`, never duplicated (F-26) |
| `scripts/verify-antigravity-restart.sh` | compares serving pid + beacon version against `package.json`; PASS / STALE / PENDING |
| `scripts/antigravity-stabilisation-status.sh` | evaluates S1–S7; `--boot` and `--browser` run the expensive checks |
| `scripts/antigravity-browser-boot.mjs` | S5 real browser check: client entry, Settings tab, grouped model list |
| regression tests | `client-inject`, `server`, `ledger`, `switch`, `models-group`, `catalog`, `wire` |
| grouped model selection | base models only; families match the account usage page; weekly/5-hour quota from `retrieveUserQuotaSummary` |

### Reproduce

```bash
scripts/antigravity-stabilisation-status.sh            # S1–S3, S7
scripts/antigravity-stabilisation-status.sh --boot     # + S4
scripts/antigravity-stabilisation-status.sh --browser  # + S5 (needs a live token in the journal)
scripts/verify-antigravity-restart.sh                  # S2 detail
```

## 4. Known pre-existing page error (not this plugin)

The live profile has a **single-slot collision on `conversation.input.activity`** between `tk` and
deepinfra. This plugin no longer registers there (its usage chip moved to the additive
`conversation.input.right` list), so the error is not attributable to Antigravity. The S5 browser
check reports it under `ignoredErrors` and does not fail on it; fixing the other two plugins is
outside this track.

## 5. Stage 2/3 — coupled to the OpenCode v2 beta plan

Stage 2/3 for both tracks starts **together**, and only after each track's S6 soak is confirmed:

| Track | Stage 2 candidate | Gate |
| :--- | :--- | :--- |
| OpenCode v2 | canonical recipe-derived parser inside the single package; conformance oracle | S6 of OpenCode v2 |
| Antigravity | quota-summary weekly/5-hour surface; alias/effort catalog cleanup; model-list UX parity | S6 of Antigravity |

No stage-2 code was opened in this round. A green suite is not S6; the previous OpenCode v2 beta
failure came from treating a passing suite as a release gate.
