# TokenEconomizer 3-day adversarial audit (D)
Window: 1793571849158 - 1793831049158
Generated: 2026-11-04T22:49:26.750Z

## Headline
- Scanned sessions: 111 (real: 109, fixtures: 2)
- Replacements in window: 0

## Claims
1. TE warm rewrites claimed 229, measured 0 | net(warm+cold) claimed 982680, measured 0 | inflating claimed 0, measured 0
2. Cold tier claimed 0, measured 0
3. Dedup pointers claimed 4 (append,not replace): measured 0 (append=0, replace=0)
4. Harness pruner claimed 0, measured 0
5. TE rewrite with original containing "tool result middle pruned": claimed exactly 1, measured 0

## Per-class
| class | count | charsBefore | charsAfter | net |
|---|---|---|---|---|
| te_warm | 0 | 0 | 0 | 0 |
| te_cold | 0 | 0 | 0 | 0 |
| te_dedup_pointer | 0 | 0 | 0 | 0 |
| harness_pruner | 0 | 0 | 0 | 0 |
| other | 0 | 0 | 0 | 0 |

## Day table

## Samples

## Verdict
VERDICT: TENSION/WRONG - [1][3][5]
- headline: TE warm=0 net=0 inflating=0 cold=0 dedup=0(a=0/r=0) pruner=0 claim5=0