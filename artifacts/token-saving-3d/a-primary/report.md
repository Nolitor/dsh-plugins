# Track A — primary rewrite measurement (TokenEconomizer, 3-day window)

**Window** 2026-11-02 07:24:09 → 2026-11-05 07:24:09 KST
(`START_MS 1793571849158`, `END_MS 1793831049158`), attribution by the **replacement event's
`time`**, day buckets Asia/Seoul.

**Method** — for every session directory under `~/.dsh/sessions`, read the latest
non-`bak` `session.v4.jsonl.zstd`; for every event with
`surfaceOp.op === 'replace'`, pair it to its original by `sourceEventSeqs[0]` (falling back to
`surfaceOp.startSeq`), and take `charsBefore = text(original).length`,
`charsAfter = text(replacement).length`. Classify **strictly at the start of the replacement text**:
`[tokeneconomizer] warm tier: …` → TE warm; `[tokeneconomizer] cold tier: …` → TE cold;
exact pointer text `[Output identical to step N (hash: h), content omitted to save context]`;
`tool result middle pruned` → **harness pruner, never counted**. Anything else → `other` (reported,
excluded). Originals already starting with `[tokeneconomizer]` are skipped.

**Reproduce**

```bash
cd artifacts/token-saving-3d/a-primary
node measure.mjs --json report.json > run.log
```

## Headline

| | rewrites | charsBefore | charsAfter | netCharsSaved | tokens (÷3.7) | inflating |
|---|---:|---:|---:|---:|---:|---:|
| **total** | **229** | **1668821** | **686141** | **982680** | **265589** | **0** |
| warm | 229 | 1668821 | 686141 | 982680 | 265589 | 0 |
| cold | 0 | 0 | 0 | 0 | 0 | 0 |

Mean charsBefore 7287.4 · min charsBefore **3719** · inflating **0** (0 chars added).
Cold tier fired **zero** times in the window — every rewrite is warm-tiering.

## Classifier validation (BRIEF §2)

The verified sample reproduces exactly: **seq 1681 → src 35, 3932 → 3338 chars**, classified
`te-warm`. **But it is not in session `16358e59…` as the BRIEF says** — that log has max seq 494
and no 1681. The row is in `session-10518982-4667-4481-89f6-063e37d56829` at
2026-11-01 08:26:17 KST. The shape claim holds; the session attribution in the BRIEF is wrong.

## Per day (Asia/Seoul)

| day | rewrites | charsBefore | charsAfter | net saved | tokens |
|---|---:|---:|---:|---:|---:|
| 2026-11-02 | 30 | 277777 | 90390 | 187387 | 50645 |
| 2026-11-03 | 78 | 472634 | 233009 | 239625 | 64764 |
| 2026-11-04 | 67 | 506190 | 201788 | 304402 | 82271 |
| 2026-11-05 | 54 | 412220 | 160954 | 251266 | 67910 |

2026-11-05 is a partial day (ends 07:24 KST). Per-day saving is **rising**, not decaying.

## Eras (derived from the data, not from git dates)

Era boundary derived from **turn age** = (turn in force at the replacement) − (turn in force at the
original), read from `turn/start` events, not from the events' own `data.turn` field (which is
always 1 here and would fake an age of 0).

| era | first | last | n | net saved | turn ages |
|---|---|---|---:|---:|---|
| E1 five-turn hot window | 2026-11-02 08:17:59 | 2026-11-02 08:34:48 | 18 | 81483 | 5 |
| E2 six-turn hot window | 2026-11-02 08:46:39 | 2026-11-05 04:39:07 | 211 | 901197 | 6 (181), 7 (22), 8 (1), 10 (7) |

Empirical boundary **2026-11-02 08:17–08:46 KST**: the last turn-age-5 rewrite is 08:34:48, the first
turn-age-6 is 08:46:39. `5fba56a` (six-turn hot window) is committed 08:42:19 — the observed flip
sits inside that minute-scale bracket, so the commit date is *consistent with* the data but was not
used to choose the boundary.

**Floor era**: **zero** rewrites have `charsBefore < 3700`; the minimum observed is 3719. That bounds
the *input*. It is **not** proof the 3700 floor was live for the whole window — see the caveat below.

## Inflating rewrites

**Zero.** 0 of 229 rewrites have `charsAfter > charsBefore`; 0 chars were added. This is a real
regression fix versus the 2026-11-02 audit (52.95 % inflating under the 1200-char floor): the
current floor makes the structural summary always smaller than the input.

## Dedup pointers (host-local)

4 exact pointer events in the window — all genuinely TE dedup, each verified by recomputing
SHA-256 of the referenced `tool/result` at the quoted step and matching the quoted 12-hex prefix:

| at (KST) | session | seq | duplicate chars | pointer chars | saved |
|---|---|---:|---:|---:|---:|
| 2026-11-02 08:18:07 | session-edeabe91 | 1882 | 549 | 83 | 466 |
| 2026-11-03 21:35:20 | session-70ee2d8d | 619 | 3102 | 83 | 3019 |
| 2026-11-03 21:48:39 | session-70ee2d8d | 1771 | 203 | 84 | 119 |
| 2026-11-05 06:44:19 | session-f62f7f28 | 4587 | 246 | 83 | 163 |

Total **3767 chars saved** (333 pointer chars replacing 4100 duplicate chars).
Excluded on purpose: two `16358e59` rows whose text merely *quotes* a measurement report containing
the pattern — the pointer is not the whole event text there.

## Independent witness from the harness

`compaction/prune` events in the window: **229**, of which **229** have a `shadowedSeqs` entry equal
to a TE rewrite's **original** seq (unmatched: 0). That is 1:1 with the 229 TE rewrites, from a
different event type written by the harness rather than the plugin — an independent count that the
rewrite set is complete and neither over- nor under-collected. Note this is the *same* 229 surface
edits, not 229 extra savings; do not add it to the totals.

## Excluded (reported, not counted)

`other` replace ops: **4**, 151959 → 116838 chars. All are **harness/compaction** surfaces, not TE:

- `session-13a47456` seq 2188, 2026-11-03 20:05:22 — `system/message` 42231 → 55650 (**inflating**
  re-render of the system prompt, harness-side, +13419 chars)
- `session-eaa3d2b7` seq 3421, 2026-11-04 21:14:18 — `system/message` 55633 → **0** (system prompt blanked)
- `session-b75ad9c0` seq 447, 2026-11-03 17:43:45 — `system/message` 54095 → 48116
- `session-c67cb8aa` seq 5428, 2026-11-04 03:36:10 — `user/message` 0 → 13072 (compaction checkpoint)

Harness-pruner-text replacements: **0**. Already-tiered originals skipped: **0**.
Duplicate snapshots dropped: **0** (every session dir has exactly one non-bak snapshot).

**Shape correction for the dedup pointers** (found by my Track D audit): a pointer event carries
`surfaceOp: "append"` — a **string**, not `{op:'replace'}` — with `sourceEventSeqs` pointing at the
first occurrence. Dedup replaces at append time, so nothing is ever "replaced". Detection must be by
replacement **text**; a `surfaceOp.op === 'replace'` scan counts **0** pointers. My script detects
by whole-text regex and then verifies the quoted digest by SHA-256 (4/4 verified).

## Fixtures

**Zero** fixtures in the window. No session cwd is under `/tmp`, and no project dir matches
`te-side-*`/`benchtest-*`/`ab-current-*` with in-window traffic. The engine mirror does contain
such repos, but they carry no in-window session activity, so the real/fixture split is trivially
clean rather than silently contaminated.

## Corpus baseline and coverage

In-window `assistant/message` usage, **real sessions only**: 15 sessions, 4925 requests,
**promptTokens 1 178 681 003** (input 13 168 427 + cacheRead 1 165 512 576 + cacheWrite 0),
cacheRead share **98.883 %**, outputTokens 3 648 461.

Two lenses, never conflated:

- **(a) context chars removed** = 982680 + 3767 dedup = 986447 chars → **266 607 tokens**
  = **0.023 %** of the window's prompt tokens. This is the direct edit, measured once.
- **(b) prompt tokens not re-sent** = Σ over rewrites of (saved chars ÷ 3.7) × later
  `assistant/message` in the same session (cap END_MS) = **47 050 795 tokens**
  = **3.99 %** of window prompt tokens. Mean 175.5 later requests per rewrite.

**(b) is not a cost saving.** 98.88 % of this corpus' prompt tokens are cache reads, so a token not
re-sent was mostly a *cached* token, and removing context also breaks prefix-cache reuse. Treat (b)
as "context that never had to be carried", not as money; dollar attribution is Track C's job.

## Caveats

1. `charsBefore` is the length of the **stored** original. If the harness pruned a range before TE
   saw it, the original may already be reduced — the floor check's 3719 minimum is consistent with
   an unpruned 3700 floor, but TE's input is not independently observable.
2. Turn age is computed from `turn/start`; 7 rewrites show age 10 (one session re-entered turns after
   a long gap), which the hot/warm boundary does not explain — they are included in E2 because age ≥ 6.
3. `laterRequests` counts later assistant messages regardless of whether the rewrite was itself
   later re-tiered; a replacement that a subsequent pruner shrinks again is not credited twice here
   because each rewrite is measured against its own immediate original.
4. Coverage uses in-window usage only; sessions that started before the window but were rewritten
   inside it contribute only their in-window requests, which is the correct denominator for
   "share of tokens spent in the window".
