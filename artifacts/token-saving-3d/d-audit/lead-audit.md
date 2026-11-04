# Lead audit — TokenEconomizer 3-day window

Window: START 1793571849158 / END 1793831049158 (2026-11-02 07:24:09 ~ 11-05 07:24:09 KST).
Run: 2026-11-05 07:50 KST. Read-only over ~/.dsh and ~/.tokeneconomizer.

## Verdicts

| # | Claim | Verdict | Measured basis |
|---|---|---|---|
| C1 | 229 TE warm rewrites / 982,680 net chars / 0 inflating | CONFIRMED | two independent paths (harness logs + engine mirror) and Tracks A/B/C agree to the unit; min input 3,719 |
| C2 | cold tier 0 in window | CONFIRMED | last cold eviction 2026-10-31 21:19Z; in-window turn ages 6-11, warmTurns 15 never reached |
| C3 | dedup 4 pointers, 3,767 net chars | CONFIRMED | 4 exact events, surfaceOp append — a replace-only scan sees 0 |
| C4 | harness-pruner conflations 0 | CONFIRMED | 0 harness prune replacements in window (179 corpus-wide, all before START) |
| C5 | exactly 1 TE rewrite whose original contains a prune marker | CONFIRMED | 13,711 -> 3,034 chars, net 10,677; explains Track E's 228 |

## Additional checks

- Duplicate snapshot files: 0 sessions with >1 .jsonl.zstd, so no double counting.
- Boundary: 0 events at START; 1 at END (a system/message in the lead session, excluded by the half-open window).
- Rewrites keyed by (project, session, replacement seq): 229 unique.
- False negative: the iceman audit in failed-iceman-scan/ scanned 230 tool results where the window has 5,064 and reported 0 rewrites; quarantined.
- False positive: a bare pointer regex over all tool/result text also matches pointers quoted inside tool output; require text to begin with the pointer.

## Headline (authoritative)

229 tiering rewrites, 1,668,821 -> 686,141 chars, net 982,680 chars (265,589 tokens), 0 inflating.
+ 4 dedup pointers, 3,767 chars -> 986,447 chars = 266,607 tokens direct.
Persisted re-send avoided: 47,050,795 tokens = 3.99% of the window's 1,178,681,003 prompt tokens
(upper bound; 98.88% of prompt tokens are cache reads).

Confidence: HIGH on counts (two-store agreement 0.00%, every original resolved by seq).
MEDIUM only on the re-send multiplier (assumption-bound).
