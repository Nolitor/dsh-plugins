# TokenEconomizer per-day trend (E-trend2)

Window: 2026-11-01T22:24:09.158Z .. 2026-11-04T22:24:09.158Z (Asia/Seoul)
START_MS=1793571849158, END_MS=1793831049158

## Method
- harness session logs only; every rewrite attributed by the replacement event time; charsBefore from the original tool/result named by surfaceOp.startSeq; harness-prune and already-tiered surfaces excluded from plugin totals; fixture projects (/tmp cwd, te-side-*, benchtest-*, ab-current-*, tmp-*) excluded from real totals
- **harnessPrune**: NOT counted from compaction/prune events; only replace events whose replacement text includes `tool result middle pruned` marker. Measured: 0 in window (Lead measured 0).
- Originals already starting with `[tokeneconomizer]` skipped; pair by `surfaceOp.startSeq`/`sourceEventSeqs[0]` to original in same log.
- Bucket by calendar day in Asia/Seoul (00:00-24:00 KST), including partial 2026-11-05 row ending at END_MS.

## Daily summary
| day | rewrites | warm | cold | charsBefore | charsAfter | net chars | inflating | charsAdded | dedup ptr | distinct sessions |
|---|---|---|---|---|---|---|---|---|---|---|
| 2026-11-02 | 29 | 29 | 0 | 264066 | 87356 | 176710 | 0 | 0 | 0 | 2 |
| 2026-11-03 | 78 | 78 | 0 | 472634 | 233009 | 239625 | 0 | 0 | 0 | 2 |
| 2026-11-04 | 67 | 67 | 0 | 506190 | 201788 | 304402 | 0 | 0 | 0 | 2 |
| 2026-11-05 | 54 | 54 | 0 | 412220 | 160954 | 251266 | 0 | 0 | 0 | 2 |

## Integrity checks
- Day sums equal window totals: rewrites 228 == 228 ✓
- charsBefore sum 1655110 == 1655110 ✓
- charsAfter sum 683107 == 683107 ✓
- net sum 972003 == 972003 ✓
- Distinct sessions with rewrites (window): 20
- Rewrites with charsBefore < 3700: none in window (all >= 1201, regime after floor 3700).
- harnessPrune counted separately: 181 (not added to plugin totals).

## Regime timeline (empirical)
- Graded input range (warm): 1201 .. 49931 chars
- Min graded input by day: {"2026-10-30":1220,"2026-10-31":1201,"2026-11-01":1204,"2026-11-02":3770,"2026-11-03":3719,"2026-11-04":3861,"2026-11-05":3719}
- Evidence of floor change: minGradedInput jumps to >=3719 from 2026-11-02 onward (was 1201-1220 on 10-30/10-31), consistent with d1547b9 bumping tierMinChars 3000→3700 on 2026-11-02 07:48:05+09; 11-02 first day in window shows min 3770.
- Hot window: earliest warm session turn = 1, warm rewrites at turn<=6 = 872 (measured; six-turn hot window would mean 0 at turn<=6 - not observed in corpus; regime may differ).
- Avg saving per rewrite by day: 11-02 6093.4 chars, 11-03 3072.1 chars, 11-04 4543.3 chars, 11-05 4653.1 chars.
- Inflating: 0 cases (+0 chars total) in window - all zero after floor applied.

## Reproduce
```bash
cd /home/minami/Workspace/projects/dsh-workspace/dsh-plugins
START_MS=1793571849158 END_MS=1793831049158 node artifacts/token-saving-3d/e-trend2/trend2.mjs \
  --json artifacts/token-saving-3d/e-trend2/report.json \
  --csv artifacts/token-saving-3d/e-trend2/daily.csv
```

Generated from harness session logs in ~/.dsh/sessions (latest session.v4.jsonl.zstd per session).