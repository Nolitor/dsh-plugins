<!-- skeleton:
version: 2.1
kind: design
status: active
updated: 2026-11-14
summary: What is actually removable in @nolit/dsh-tokeneconomizer, measured against the live corpus — the two features a previous draft wrongly called dead (watchdog is used 35 times across 15 sessions, devstats is wired into the client and both locale files), the low-yield lever that is genuinely a candidate (tool-result dedup), the subagent early return that cost the pruning lever most of its traffic (resolved 2026-11-14 by the engine/memory path split), and the dead code that was removed.
-->

# Refactoring — what is removable, measured

> History lives in [CHANGELOG.md](../CHANGELOG.md). This document is a **candidate list with
> evidence**, not a plan approved by anyone. Nothing here is removed except where the
> "Removed" section says so.

## 1. Correcting the previous draft

Version 1.0 of this file (2026-11-13) listed two whole features as "not in use, removable":

| Claim in 1.0 | Measured 2026-11-13 | Verdict |
| :--- | :--- | :--- |
| `watchdog.js` — "currently unused, only adds complexity" | **35 distinct watchdog notices across 15 sessions** in `~/.dsh/sessions` (239 logs, 745.9 MB decompressed). 27 are the advisory warning path, 8 are the opt-in interrupt. 16 turn-level and 9 tool-level budgets expired; 1 turn was actually cancelled by it (`action=interrupted`). | **False.** The watchdog is the plugin's only stall detector and it fires in real use. Not removable. |
| `devstats.js` / `devstats-server.js` — "written for debugging, no longer needed" | `lib/index.js` mounts the route (`registerDevStatsRoutes`); `lib/client.js` renders the card and carries **65** `devstats.*` keys; `locale/en.json` and `locale/ko.json` each carry all 65. `docs/DEV-STATISTICS.md` documents it as a shipped surface. | **False.** It is a shipped Web surface with three consumers. Not removable. |
| (unstated) | `lib/configValue` was exported and referenced **nowhere** — not by `lib/`, not by `bin/`, not by any test. | **True, removed.** |
| (unstated) | `bin/dsh-te.mjs` purge listed a `'ho'` path — a two-character typo of `hosts` from commit `d1547b9`. The live state root has no `ho`, so it purged nothing while carrying a live `rmSync` against an unrelated name. | **True, removed.** |

The lesson is in the method, not the list: both wrong claims are the kind a reader makes from
file names, and both are falsified by one grep over the corpus and one grep over the importers.

## 2. Real candidates, in measured yield order

### 2.1 Tool-result dedup — lowest yield per line of code

`lib/dedup.js` is 83 lines plus a call site and a config triple, and across the same corpus it
fired **118 times in 29 sessions**: 118 pointer substitutions, 9,676 pointer chars written to
replace them. At `dedupMinChars: 200` the minimum displaced text is 23,600 chars, so the measured
floor is **13,924 chars saved in 239 sessions** — roughly 58 chars per session, or under 20
tokens. The pointer text itself is 82 chars, so an output between 200 and 282 chars saves
nothing and *costs* context.

Why the yield is structurally low: the lever only fires on a **byte-identical** repeat of an
output over 200 chars in the same session. Real sessions mostly re-read changed files, and a
repeated large output is usually a repeat the model already knows it made.

Candidate, in order of preference:

1. **Keep it, raise the floor.** `dedupMinChars: 200 → 400` removes every case where the pointer
   costs more than it saves, at a measured cost of at most a handful of substitutions. This is a
   config change, no code movement.
2. **Delete the feature.** Saves 83 lines and a config triple, and measurably costs ~14k chars per
   239 sessions. Legitimate only if the config surface itself is the burden.
3. **Leave it alone.** Defensible: it is cheap at runtime, fail-open, and the devstats card
   already reports `dedupHits` / `dedupSavedChars`, so the yield is visible rather than assumed.

Not recommended: optimising it. The ceiling is the repeat rate, not the implementation.

### 2.2 The toolprune subagent early return — a gate that costs the lever most of its traffic — **resolved 2026-11-14**

> **Resolved 2026-11-14.** The blanket early return this section describes no longer exists. The
> gate was narrowed from "a subagent gets nothing" to "a subagent gets the **engine path**
> only": the memory levers (dedup, tiering, loop breaker, watchdog, prefix guard, pinned
> section) now mount in a delegated child too, because a child burns the same model context and
> its bill lands on the parent. The engine path (hooks, export, fold, ledger) stays root-only
> for the reason given below, which still holds. The new switch is `subagentMemory`
> (default `true`); `false` restores the old behaviour. The analysis below is kept as the
> history of the finding — see [ARCHITECTURE.md](ARCHITECTURE.md) §3.1 and
> [AUDIT-2026-11-14.md](AUDIT-2026-11-14.md) §10 for the correction.

The line this section was written about was `lib/index.js:488` —
`if (agent.session.header.origin === 'subagent') return` — and it ran before the
state object existed, so a subagent session got **no** tool mask, no tiering, no dedup, no
watchdog. *(That line no longer exists; the file has grown since, so the number is a record of
where it stood, not a pointer to it.)*

The measured split in the live corpus is **126 main / 113 subagent** sessions (47.3% subagent).
`docs/TOKEN-ECONOMIZER-SAVING-MEASUREMENT.md` §8.4 already measured the consequence: toolprune is
worth **~1,060–1,210 tokens per non-subagent request and exactly zero in every subagent
session**, because of this line.

Why the line exists is documented, and it is a real reason: a delegated child is folded with its
parent's work, and giving it its own envelope would teach the loop guard a turn scale no person
runs ([ARCHITECTURE.md](ARCHITECTURE.md) §3).

That reason covers the **engine envelope** (the session brief, the hooks, the fold). It does not
cover the **host-local, in-memory** levers, which touch no engine, write no state, and are
discarded with the agent's scope:

| Lever | Needs the engine? | Needs the turn envelope? | Rationale for the blanket skip (as it stood before 2026-11-14) |
| :--- | :--- | :--- | :--- |
| `tools.restrict` from the engine's proposal | yes (proposal arrives in the brief) | no | the brief is what is skipped |
| `dedup` | no | no | none measured |
| `watchdog` | no | no | a subagent is exactly where a stall is expensive |
| `tiering` | no | yes (grades by turn) | a child's turn 1 is not the parent's turn 1 |
| loop breaker | no | yes (trips a turn) | a child's failure chain is its parent's work |

Candidate: **move the early return so that the two engine-free, turn-free levers still mount for a
subagent.** That is a ~10-line change in the `agent/created` handler, and its measured upside is
bounded by the 47.3% of sessions that currently get nothing. It must not move the envelope: the
documented reason for the skip stays true.

> **Taken 2026-11-14.** The candidate above was implemented as the engine/memory split: the
> in-memory levers (dedup, tiering, loop breaker, watchdog, prefix guard, pinned section) now
> mount for a delegated child, and the engine envelope did not move. The switch is
> `subagentMemory` (default `true`; `false` restores the blanket skip). The test count went
> **156 → 164** with 0 failures. The live process has not reloaded the change yet
> (**applied pending restart**).

Not recommended: unmounting the envelope for subagents. The architecture note is right.

### 2.3 `watchdog` (the boolean) — **superseded by the 2026-11-13 change; the watchdog is read in `lib/index.js` (`disabled: config.watchdog !== true`)**

> **Stale — corrected 2026-11-14.** The claim in this section was already superseded before this
> audit: `lib/index.js` reads `disabled: config.watchdog !== true` inside `mount()`, so
> `watchdog: false` **is** honoured. The 0-read claim below describes the code before the
> 2026-11-13 change. It is kept as history; the current state is "the key is read, the candidate
> is closed".
>
> *(The line number this section used to cite — `lib/index.js:579` — moved when the
> subagent-gate split added code above it. The gate is located by the expression
> `disabled: config.watchdog !== true`, not by a line number.)*

`watchdog: true` is a config key in `DEFAULTS`, in `cordis.patch.yml`, and in the
`docs/IN_MEMORY_FEATURES.md` table. `lib/index.js` reads `watchdogThresholdMs`,
`watchdogToolThresholdMs`, `watchdogWarnMs`, `watchdogAction` and `watchdogProgress` — but never
`config.watchdog` itself. Setting it to `false` changes nothing, which is worse than not having it.

Same shape, checked: `dedup`, `loopBreaker`, `tiering`, `toolprune`, `microskills`, `loopguard`
are each read exactly once as a gate. `watchdog` is the only boolean with **0** reads.

Candidate: either honour it (`if (!config.watchdog) return` inside `mount`, next to the other
gates) or drop the key from `DEFAULTS`, the bundle patch and the doc table. Honouring it is
smaller and matches what an operator reading the config already believes.

**Status: closed.** The candidate was taken on 2026-11-13 — `lib/index.js` now reads
`config.watchdog` as the `disabled` gate of the watchdog, so the "0 reads" defect no longer
exists.

### 2.4 Configuration documented in three places that disagree

Not dead code, but the same class of rot. Measured drift between `lib/index.js` `DEFAULTS` and
the tables in the docs:

| Key | Code | Documented |
| :--- | :--- | :--- |
| `watchdogAction` | `interrupt` | `warn` ([IN_MEMORY_FEATURES.md](IN_MEMORY_FEATURES.md) §7) |
| `watchdogProgress` | `any` | varies by table |
| `tierHotTurns` | `6` | `6` ([IN_MEMORY_FEATURES.md](IN_MEMORY_FEATURES.md) §7, [OPERATIONS.md](OPERATIONS.md) §4) — **no drift; a 1.0 draft alleged `5` and that was a false finding, removed 2026-11-14** |
| `tierMinChars` | `3700` | `3000` (both tables) |
| `watchdogThresholdMs` | `600000` | `180000` ([OPERATIONS.md](OPERATIONS.md) §4) |
| `hookTimeoutMs`, `cliTimeoutMs`, `headless`, `watchdogToolThresholdMs` | present | absent from every table |

`test/config-drift.test.mjs` already pins the bundle patch against the code for three of these.
Candidate: extend that gate to the documentation tables, so the tables are parsed and compared
rather than trusted. The four stale rows were corrected in this pass.

## 3. Removed in this pass

| Item | Evidence | Change |
| :--- | :--- | :--- |
| `lib/index.js` `configValue()` | referenced by no module and no test | deleted (the internal `rawValue()` it wrapped stays) |
| `bin/dsh-te.mjs` purge entry `'ho'` | typo of `hosts` since `d1547b9`; absent from the live state root; a live `rmSync` target | deleted, with a comment naming the reason |
| `lib/interrupt-bridge.js` absolute default URLs | one owner's home spelled into a published artifact; unresolvable for any installed copy | replaced with ordered discovery (`DSH_INTERRUPT_CORE_URL`/`REASONS_URL` → `DSH_INTERRUPT_ROOT` → sibling checkout → `~/Workspace/projects/total_skill`), fail-open as before |

## 4. Not candidates, and why

| Feature | Why it stays |
| :--- | :--- |
| `watchdog.js` | 35 real notices, the only stall detector (see §1) |
| `devstats.js` / `devstats-server.js` / the card | 3 live consumers, a documented surface, a host route with tests |
| `lib/tiering.js` | the measured lever: 1.03M chars of real saving with a 3700-char floor that eliminates the 53% self-inflation the 3000 floor caused |
| `lib/repokey.js` | pure-Node parity with the engine's repository key; a wrong key misattributes every fold |
| `lib/prefix.js` | the KV-cache-safe slot; deleting it would re-send a changed prefix each turn |
| `docs/*` | the per-track documentation contract (RULES §6.1b) |

## 5. How to decide any future candidate

1. Measure the corpus, not the file: `~/.dsh/sessions` holds the ground truth for whether a lever
   fires (239 logs / 745.9 MB as of 2026-11-13).
2. Measure the importers, not the file name: `grep -rn '<module>' lib bin scripts test`.
3. Measure the config reads: a key with zero reads is a lie in the config surface.
4. A candidate with no measured yield and no measured cost is not a candidate.
