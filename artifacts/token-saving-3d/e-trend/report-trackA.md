# Track E — per-day / per-hour trend and regime timeline

**File note:** `e-trend/` is shared with a sibling agent (`trend.mjs`, `diag*.mjs`). My
implementation is `trend-trackA.mjs`; outputs are `report-trackA.json`, `daily-trackA.csv`,
`daily-trackA-hourly.csv`, `run-trackA.log`.

```bash
cd artifacts/token-saving-3d/e-trend
node trend-trackA.mjs --json report-trackA.json --csv daily-trackA.csv > run-trackA.log
```

## Daily (KST)

| day | rewrites | charsBefore | charsAfter | net saved | inflating | dedup ptr | turn ages seen |
|---|---:|---:|---:|---:|---:|---:|---|
| 2026-11-02 | 30 | 277 777 | 90 390 | 187 387 | 0 | 1 | 5, 6, 7 |
| 2026-11-03 | 78 | 472 634 | 233 009 | 239 625 | 0 | 2 | 6, 7 |
| 2026-11-04 | 67 | 506 190 | 201 788 | **304 402** | 0 | 0 | 6 |
| 2026-11-05 | 54 | 412 220 | 160 954 | 251 266 | 0 | 1 | 6, 7, 8, 10 |

```
  2026-11-02  187387  ##################################                     n=30
  2026-11-03  239625  ############################################           n=78
  2026-11-04  304402  ########################################################  n=67
  2026-11-05  251266  ##############################################         n=54  (partial)
```

## Hourly (KST) — activity is bursty, not spread

```
  11-02 08  187387  ########################################   n=30
  11-03 19  101758  #####################                      n=19
  11-03 20    7835  #                                          n=4
  11-03 21   30898  ######                                     n=15
  11-03 22   81989  #################                          n=32
  11-03 23   17145  ###                                        n=8
  11-04 02  225725  ########################################   n=39
  11-04 03   10464  ##                                         n=4
  11-04 21   65882  #############                              n=23
  11-04 22    2331  #                                          n=1
  11-05 00  142849  #############################              n=22
  11-05 01   40609  ########                                   n=8
  11-05 03   57698  ############                               n=21
  11-05 04   10110  ##                                         n=3
```

14 active hours across 3 days. Tiering fires only when a *tool-heavy* session is running; the corpus
idles for 17–20 h stretches (11-02 09:00 → 11-03 19:00, and 11-04 04:00 → 21:00).

## Regimes — placed by observed behaviour

| regime | observed from | observed to | n | net chars | witness |
|---|---|---|---:|---:|---|
| R1 five-turn hot window | 2026-11-02 08:17:59 | 2026-11-02 08:34:48 | 18 | 81 483 | warm rewrites whose original is **5** turns back |
| R2 six-turn hot window | 2026-11-02 08:46:39 | 2026-11-05 04:39:07 | 211 | 901 197 | first warm rewrite at turn age **6**; age 5 never appears again |

The flip is bracketed by two observations 12 minutes apart
(last age-5 at 08:34:48, first age-6 at 08:46:39), and `5fba56a` is committed at 08:42:19 — inside
that bracket. The boundary is **chosen from the data**; the commit time only confirms it.

**The floor regime has no boundary inside this window.** A detector that looks for
`charsBefore < 3700` finds nothing: the minimum over all 229 rewrites is **3 719**, and the first
in-window rewrite (08:17:59) is 29.9 min *after* `d1547b9` (07:48:05). So the whole window is
post-floor. That is a property of the window, not of the plugin: 415 pre-floor warm rewrites existed
before the window, 341 of them inflating.

## Is the saving increasing or dying out?

**It is rising per active hour, not decaying.**

- Daily slope on the three full days: **+58 508 chars/day**.
- Per active hour: 11-02 **187 387** (single burst), 11-03 **47 925**, 11-04 **76 101**,
  11-05 **62 817**. Excluding the single-burst 11-02 outlier, the trend is upward from 11-03 to 11-04.
- The raw day totals are driven by *how many sessions ran*, not by a per-rewrite efficiency change:
  mean charsBefore per rewrite stays in a narrow band (7 000–8 800) all window.
- 11-05's 251 266 is achieved in **7.4 hours** — if the day had continued at the 11-04/11-05 rate it
  would be the largest of the three.
- **Caveat on the framing:** "rising" is a statement about this corpus' workload, not about plugin
  improvement. R2 (six-turn hot window) reaches *older* turns, so it should tier *more* surfaces per
  turn; the data is consistent with that (211 of 229 rewrites are R2) but a single 3-day window cannot
  separate regime effect from workload effect.

## Caveats

1. 11-05 is partial (00:00–07:24 KST). Its total is not comparable to a full day.
2. 11-02 starts at 07:24 and carries no rewrite until 08:17:59, so it holds one burst from one session.
3. Per-day net sums per-rewrite deltas against each rewrite's own original — it is **not** the corpus
   context shrink, which is measured once (Track A lens (a): 266 607 tokens).
4. The 7 turn-age-10 rewrites on 11-05 all sit in one session that resumed after a long gap; they are
   counted in R2 because age ≥ 6, not because the six-turn rule explains them.
