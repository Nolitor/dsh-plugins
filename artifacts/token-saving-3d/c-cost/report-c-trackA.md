# Track C — cost attribution and counterfactual

**Window** 2026-11-02 07:24:09 → 2026-11-05 07:24:09 KST. `scripts/measure-token-saving.mjs`
copied unmodified to `measure-baseline-copy.mjs`; adaptation is in `measure.mjs`.

```bash
cd artifacts/token-saving-3d/c-cost && node measure.mjs --json report.json > run.log
```

**Note:** `c-cost/` also holds a sibling agent's `spotcheck.mjs` / `report.md`. My outputs are
`measure.mjs`, `report-c-trackA.json`, `run-c.log` to avoid overwriting it.

## Corpus (in-window `assistant/message` usage, real sessions)

| | |
|---|---:|
| sessions | 15 |
| requests | 4 925 |
| **promptTokens** | **1 178 681 003** |
| — inputTokens | 13 168 427 |
| — cacheReadTokens | 1 165 512 576 (**98.883 %**) |
| — cacheWriteTokens | 0 |
| outputTokens | 3 648 461 |
| mean prompt / request | 239 326 |

### Per route

| route | requests | promptTokens | share |
|---|---:|---:|---:|
| `opencode-http-agent / opencode-go/deepseek-v4.1-flash` | 3 828 | 862 905 224 | 73.21 % |
| `deepseek-account / deepseek-flash` | 586 | 194 049 156 | 16.46 % |
| `deepinfra / deepseek-ai/DeepSeek-V4.1-Flash-1017` | 511 | 121 726 623 | **10.33 %** |

## The plugin's saved context (Track-A classification, implemented here)

229 rewrites (warm 229, cold 0, inflating 0) · 1 668 821 → 686 141 chars · **982 680 chars saved**
+ 4 dedup pointers **3 767 chars** → **986 447 chars = 266 607 tokens @3.7**.

| lens | tokens | share of window prompt tokens |
|---|---:|---:|
| (a) context chars removed (measured once) | 266 607 | **0.023 %** |
| (b) persisted tokens not re-sent (× later requests, mean 175.5) | 47 050 795 | **3.992 %** |

## Prices — measured, not assumed

`~/.dsh/deepinfra-session-cost.json` has **no price table**; it stores 500 `recent[]` rows of
`{tokens:{input,cacheRead,output}, costUsd, listCostUsd}`. Fitting three rates by least squares
reproduces every row with **max relative residual 2.1 × 10⁻¹⁵** — i.e. the file *is* a linear model
with exactly these rates:

| | input $/1M | cacheRead $/1M | output $/1M |
|---|---:|---:|---:|
| **paid** | 0.0980 | 0.0029 | 0.2940 |
| list | 0.2000 | 0.0060 | 0.6000 |

Paid = **0.49 × list**. Cache reads are **1/33.8** of the input rate.

**Route scope:** these are the **deepinfra** route's rates. Only **10.33 %** of in-window prompt
tokens ran there, so every dollar figure below applies a deepinfra price model to the whole corpus.
Treat them as an order-of-magnitude, not an invoice. The other 89.7 % is unpriced in this file.

## Pricing the saving

| basis | $ |
|---|---:|
| context removed, all-cacheRead rate (conservative) | **0.000784** |
| context removed, all-input rate (upper) | 0.026128 |
| persisted not-re-sent, all cacheRead | 0.138329 |
| persisted not-re-sent, corpus cache-aware blend | 0.188299 |
| persisted not-re-sent, as if uncached input (**unrealistic**) | 4.610978 |

## Counterfactual corpus cost

Cash blend rate = cacheRead × 98.883 % + input × 1.117 % = **$0.0040 / 1M prompt tokens**.

| | $ |
|---|---:|
| actual in-window corpus cost | **5.789760** |
| without-rewrite corpus cost | 5.978059 |
| **delta** | **0.188299 (3.25 % of actual)** |

So the honest, cache-aware statement is: the rewrites kept **3.99 %** of prompt tokens off the wire,
worth about **$0.19** of an **~$5.79** window, i.e. **~3.3 %** of corpus cost on one route's price
model — **not** the ~$4.61 that a naive input-rate multiplication would claim.

## Why the dollar figure is not 1:1 with tokens removed

1. **98.9 % of prompt tokens are cache reads** at 1/33.8 of the input rate. A token not re-sent was
   almost always a *cached* token, so its avoided cost is ~1/34 of face value.
2. **Shrinking context also shrinks the prefix-cache hit** for the next request: fewer cached tokens
   means the next request may need a fresh cache write, which this model cannot see. Real savings
   are therefore *lower* than the counterfactual, potentially negative in a session that re-reads.
3. **Coverage:** the fitted price belongs to the 10.33 % deepinfra slice. Applying it corpus-wide is
   a modelling choice, stated rather than hidden.

## Reproduce

```bash
cd artifacts/token-saving-3d/c-cost
node measure.mjs --json report.json > run.log
```
