# Track D — adversarial audit (authored by the Track-A owner)

**File note:** a sibling agent replaced `d-audit/audit.mjs` while I was writing it. Its script
reports **0 rewrites in the window**; that is a bug, not a measurement (see *Sibling bug* below).
My audited implementation is `audit-trackA.mjs` / `report-trackA.json` / `run-trackA.log`.
Both files are left in place so the divergence is visible rather than silently overwritten.

```bash
cd artifacts/token-saving-3d/d-audit && node audit-trackA.mjs --json report-trackA.json
```

## Own headline (independent re-implementation)

**229 rewrites · 1 668 821 → 686 141 chars · net 982 680 chars = 265 589 tokens @3.7 · 0 inflating ·
min charsBefore 3 719.** Reproduced by a separate traversal and a separate classifier order from
Track A; agreement is to the unit.

## Verdicts

| # | claim | verdict | measured basis |
|---|---|---|---|
| A1 | 229 / 1 668 821 / 686 141 / 982 680 | **CONFIRMED** | independent traversal reproduced all four integers |
| A2 | 0 inflating rewrites | **CONFIRMED** | 0 inflating, 0 chars added, max(after−before) < 0 |
| A3 | 0 cold-tier rewrites | **CONFIRMED** | cold 0, warm 229 |
| A4 | fixtures excluded | **CONFIRMED** | no in-window rewrite has a /tmp cwd or te-side-/benchtest-/ab-current- project |
| D1 | ≥20-rewrite sample confirms real summaries | **CONFIRMED** | 24 sampled (stride 9) across 11-02…11-05; every one starts with the warm banner, is shorter than its original, original untiered |
| D2 | harness pruner excluded | **CONFIRMED** | 0 in-window replacement texts carry the pruner marker |
| D2b | cost of dropping the pruner rule | **CONFIRMED** | **in-window: 0 rewrites / 0 chars** would be wrongly counted; whole-corpus it would add **180 of 1135** surface replaces |
| D3 | no post-d1547b9 rewrite below 3700 | **CONFIRMED** | below3700 = 0, min = 3719; first in-window rewrite 08:17:59 is 29.9 min after the commit, and no rewrite exists between START and 08:17:59 |
| D3b | no inflation after the floor | **CONFIRMED** | but see *TENSION detail*: the floor bounds the input, not the output |
| D4a | boundary handling | **CONFIRMED** | first +53.8 min, last −164.5 min from the edges, none exactly on an edge |
| D4b | no duplicate snapshots | **CONFIRMED** | 109 dirs, 109 non-bak snapshots, 0 dirs with >1 |
| D4c | backups never read | **CONFIRMED** | 1 dir carries `.bak-1793504712` + `.singleframe-bak-…`; the selector requires the name to start with `session.v4.jsonl.zstd` **and** excludes `bak` |
| D5 | dedup pointers genuine | **CONFIRMED** | 4 events, **4/4 SHA-256 verified** against the referenced step. **Shape correction below.** |
| D5b | the 1 rewrite whose *original* quotes the pruner wording | **CONFIRMED** | `edeabe91` seq 2625 / src 220 — the phrase is inside a quoted report the tool printed, not a pruner surface; classifying on the *replacement* keeps it correctly as te-warm |
| D6 | no chained double count | **CONFIRMED** | 0 originals are themselves replacements; 0 originals rewritten twice; ΣcharsBefore == Σ over distinct (session,src) |
| D7 | same-ms batches are distinct | **CONFIRMED** | 38 (session,ms) groups, largest 2, each with a different seq and different original |

## Shape correction — dedup pointers are *not* `op:'replace'`

The BRIEF's category list is right that dedup pointers are TE dedup, but their **field shape differs**
from a tiering rewrite. A pointer event carries `surfaceOp: "append"` — a **string**, not an object
with `op:'replace'` — plus `sourceEventSeqs` pointing at the *first occurrence's* seq (e.g. 614→614
for `70ee2d8d` seq 619, source 614). Dedup rewrites at append time, before the surface is ever
committed, so nothing needs replacing.

Consequence: **any scan that keys on `surfaceOp.op === 'replace'` sees 0 dedup pointers.** That is
exactly what the quarantined "0 rewrites" audit did, and why it also reported a dedup count of 0.
Pointer detection must be by replacement *text*, not by surface op. My audit detects them by
whole-text regex equality and then verifies the quoted digest.

## TENSION detail — the one attack that lands

**"Zero inflation after the 3700 floor" is true but weaker than it reads.** The floor raises the
minimum *input*; it places no upper bound on the *output*. Inflation stays structurally possible.
Evidence that it still happens — just not inside TE:

- `session-13a47456` seq 2188 (2026-11-03 20:05:22): `system/message` **42 231 → 55 650** (+13 419)
- `session-b75ad9c0` seq 447 (2026-11-03 17:43:45): `system/message` **54 095 → 48 116** (−5 979)
- `session-eaa3d2b7` seq 3421 (2026-11-04 21:14:18): `system/message` **55 633 → 0** (blanked)
- `session-c67cb8aa` seq 5428 (2026-11-04 03:36:10): `user/message` 0 → 13 072 (checkpoint insert)

All four are harness/compaction surfaces, correctly classified `other` and excluded. Net across them
is +26 491 chars *added*, which is why "0 inflating" must be stated as "0 inflating **among TE
rewrites**", never as "the corpus never inflates".

## Pruner quantification (attack 2)

In this window the pruner exclusion is **free**: zero replacement texts contain
`tool result middle pruned`. The rule is still load-bearing for any longer-window measurement — over
the whole corpus **180 of 1135** surface replaces carry that marker. A measurement that dropped the
rule and kept only `surfaceOp.op === 'replace'` would over-count by 180 rewrites.

## Sibling bug (why two D answers exist)

`d-audit/audit.mjs` calls `getText(ev.data)` for `tool/result` events. The text lives at
`data.message.content`, and `getText` has no branch for it, so it falls through to
`JSON.stringify(data)` — the classifier then sees a JSON blob, matches nothing, returns `other`, and
`replacementsInWindow` is reported as **0**. That 0 is not evidence of inactivity; the plugin fired
229 times. Anyone quoting a "0 rewrites" D verdict should re-run `audit-trackA.mjs`.

## Confidence

**HIGH on the counts** — two independently authored implementations agree to the unit, and the
harness's own `compaction/prune` stream independently witnesses exactly 229 shadowed TE originals.
**MEDIUM on causal attribution** — the floor/mount timing is inferred from `charsBefore` minima and
the absence of rewrites before 08:17:59, not from a mount log; no mount log exists in the data.
