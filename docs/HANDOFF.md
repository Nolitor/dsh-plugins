# Workspace Handoff — 전체 진척도

<!-- skeleton:
version: 1.1
kind: report
status: active
updated: 2026-11-10
summary: Workspace-level progress roll-up — per-track state, the ordered cross-track next actions, the owner decisions that block them, and the measured gates that say whether a track is releasable.
-->

> Per-track detail lives in each `dsh-<track>/docs/HANDOFF.md`. This file is the **roll-up**: what is
> blocked where, and what order the tracks move in. Rules: [RULES.md](RULES.md).

## 1. Roll-up

| Track | Version | Tests | Live | Handoff |
| :--- | :--- | :--- | :--- | :--- |
| `dsh-custom-router` | `0.0.1-rc.10` | 372/372, stream 7/7, dispatch 17/17 | mounted | [HANDOFF](../dsh-custom-router/docs/HANDOFF.md) |
| `dsh-opencode-v2` | `0.0.1-rc.5` | 481/481 | mounted | [HANDOFF](../dsh-opencode-v2/docs/HANDOFF.md) |
| `dsh-notify` | `0.0.1-rc.4` | 70/70 | loaded; live visual check open | [HANDOFF](../dsh-notify/docs/HANDOFF.md) |
| `dsh-tokeneconomizer` | `0.0.1-rc.1` | 139 pass / 1 skip | loaded; live visual check open | [HANDOFF](../dsh-tokeneconomizer/docs/HANDOFF.md) |
| `dsh-sidebar-manager` | `0.0.1-rc.1` | 162/162 | mounted | [HANDOFF](../dsh-sidebar-manager/docs/HANDOFF.md) |
| `dsh-command-skill` | `0.0.1-rc.1` | contract verifier only | not installed (by design) | [HANDOFF](../dsh-command-skill/docs/HANDOFF.md) |
| `dsh-korean-locale` | `0.0.1-rc.1` | `verify.mjs` ok — 74 ns / 3,843 keys | mounted | see below |
| `archive/` (6 tracks) | — | — | not installed | [archive/README.md](../archive/README.md) |

`dsh-korean-locale` is a **git submodule**: this workspace must not write into it (RULES §6.1b),
so it has no handoff here. Its own record is `dsh-korean-locale/README.md` + `CHANGELOG.md`, and its
repository has no `docs/` directory.

## 2. Ordered cross-track actions

| Order | Action | Track | Blocked by |
| :--: | :--- | :--- | :--- |
| 1 | Live visual verification of the two client-side changes (no restart needed — modules loaded) | notify, tokeneconomizer | owner browser |
| 2 | P4 — opencode-v2 onto the shared stream pipe, then P5 parity | custom-router + opencode-v2 | nothing technical |
| 2b | Restart `dsh-web.service` to apply the 2026-11-10 dispatch policy (`applied pending restart`) | owner-only | owner action |
| 3 | Decide the `rc` state for the two tracks whose version did not move on 2026-11-08 | notify, sidebar-manager, tokeneconomizer | **owner decision** |
| 4 | Record the 2026-11-08 notify change in `CHANGELOG.md` | notify | nothing |
| 5 | Stage-1 verdicts O1/O2/O3 | opencode-v2 | **owner decision** |
| 6 | Interrupt capability: choose A or B | command-skill | **owner decision** |

## 3. Measured gates

| Gate | Command | Result |
| :--- | :--- | :--- |
| Docs | `npm run docs:check` | OK — 36 workspace docs, 12 pending, 6 subproject indexes, 1,349 links |
| Per-track history | `node scripts/check-plugin-history.mjs` | 6 tracks ok; `dsh-korean-locale` skipped (untracked in this repo) |
| Publishability | `npm run check:publish` | 3 publishable tracks, all pass |
| Preset parity | `npm run verify:presets` | OK |
| Dispatch policy | `(cd dsh-custom-router && npm test && npm run verify:dispatch)` | 372/372, 17/17 — preset-based rule (2026-11-10) |

## 4. Known documentation contradictions

Each item states **which track owns the fix**. This file only points; the work happens in the track
document named below. Nothing here has been fixed.

1. **"Pending restart" is stale.** Measured 2026-11-08: `dsh-web.service` started 11:53:42;
   the notify client (11:30:26) and tokeneconomizer client (11:28:51) are older, so they are loaded.
   The CHANGELOG lines are historical, not a current blocker. **Owner: none** — already resolved by
   measurement.
2. **`llm-pi-ai` status.** [DSH-HARNESS-POLICY.md](DSH-HARNESS-POLICY.md) §1.1 records the owner
   re-enabling it on 2026-11-08; [CUSTOM-ROUTER-SURFACE-CONTRACT.md](../dsh-custom-router/docs/CUSTOM-ROUTER-SURFACE-CONTRACT.md)
   D4 still says it stays disabled. **Owner: `dsh-custom-router`** — see
   [C1 in its handoff](../dsh-custom-router/docs/HANDOFF.md). The policy is the newer statement, so
   the contract is the side expected to change.
3. **Boot-card paths.** [bootcards/2026-11-08T0902+0900.md](../bootcards/2026-11-08T0902+0900.md)
   §3–§4 still names `dsh-antigravity/lib/*` and `dsh-deepinfra/lib/wire.js`, which moved to
   `dsh-custom-router/vendor/` in `a772058`. The findings are live; the paths are stale.
   **Owner: `dsh-custom-router`** — the moved files are its vendors. Cards are historical evidence,
   so the fix is a path note in the new card rather than an edit to the old one.
4. **Submodule docs claim.** [docs/SKELETON.md](SKELETON.md) lists `dsh-korean-locale` as
   "separate repository — read `dsh-korean-locale/README.md`", while [README.md](../README.md) says
   the track "owns its own docs". There is no `docs/` directory in that repository.
   **Owner: `dsh-korean-locale`** — this workspace must not write there (RULES §6.1b), so the fix
   has to be made inside that repository, not here.
5. **`CHANGELOG.md` missing from `files[]`** in `dsh-sidebar-manager` and
   `dsh-tokeneconomizer`. Measured with `npm pack`: the tarballs carry 51 and 27 files and contain
   no CHANGELOG. `npm run check:publish` passes and does **not** cover this. **Owner: each track** —
   see the S1 section of [Sidebar Manager](../dsh-sidebar-manager/docs/HANDOFF.md) and
   [TokenEconomizer](../dsh-tokeneconomizer/docs/HANDOFF.md).
6. **No `rc` bump** for the 2026-11-08 changes in `dsh-notify`, `dsh-sidebar-manager` and
   `dsh-tokeneconomizer`. **Owner: each track**, with the bump decision reserved to the owner —
   agents must not change the numeric part.

## 5. What is not measured here

Browser rendering and real generation turns are **not** claimed in this document; they need the
owner's browser. Module loading is claimed, and it was measured from file mtimes against the
service start timestamp.
