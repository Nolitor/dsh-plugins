# Track C — cost attribution and counterfactual (TokenEconomizer, 3-day window)

Window (BRIEF §0): **2026-11-02T07:24:09+09:00 → 2026-11-05T07:24:09+09:00**, i.e.
`START_MS 1793571849158 → END_MS 1793831049158`. Read-only; every number below was printed by
`node measure.mjs` (stdout in `run.log`). Chars per token = 3.7.

## Method

1. Corpus: every `assistant/message` event whose `event.time` is inside the window, from the last
   `session.v4.jsonl.zstd` of each session dir; `promptTokens = input + cacheRead + cacheWrite`.
2. Rewrites: events with `surfaceOp.op === 'replace'`, attributed by the **replacement's** time;
   `charsBefore` = text length of the original event at `startSeq`, `charsAfter` = text of the
   replacement. Classifier exactly as BRIEF §2.
3. Lens (a): `sum(before - after)` over warm/cold/dedup. Lens (b): per rewrite, `net / 3.7` times the
   number of later in-window `assistant/message` events in the same session.
4. Counterfactual (d): per in-window request, add the signed `sum(net)` of rewrites already applied in
   that session / 3.7 to the measured prompt; (c) divides each basis by the window prompt total.

## Headline

| quantity | value |
|---|---|
| sessions with in-window requests | **15** (90 further session dirs have no in-window request; 0 fixture sessions) |
| requests | **4,934** |
| promptTokens | **1,178,681,003** = input 13,168,427 + cacheRead 1,165,512,576 + cacheWrite 0 |
| cacheRead share of prompt tokens | **98.88 %** (uncached input 1.12 %) |
| outputTokens | **3,648,461** |
| mean prompt per request | 238,890 |
| plugin rewrites (warm / cold / dedup) | **229 / 0 / 4 = 233** |
| charsBefore → charsAfter | 1,672,921 → 686,474, **net saved 986,447** (warm 982,680 + dedup 3,767) |
| inflating rewrites | **0** (no in-window rewrite added chars) |
| (a) context tokens removed | **266,607.3** |
| (b) persisted tokens not re-sent | **47,050,795.1** (174,087,942 re-sent-equivalent chars) |
| (c) share of window prompt tokens | **0.0226 %** edit basis · **3.99 %** re-send basis · **3.84 %** counterfactual delta |
| (d) counterfactual prompt tokens | 1,225,731,798 vs measured 1,178,681,003 (delta 47,050,795) |

## Per route (real sessions)

| route | requests | promptTokens | cacheRead share | active saved tokens |
|---|---|---|---|---|
| opencode-http-agent / opencode-go/deepseek-v4.1-flash | 3,836 | 862,905,224 | 98.80 % | 42,651,410 |
| deepseek-account / deepseek-flash | 586 | 194,049,156 | 99.65 % | 2,687 |
| deepinfra / deepseek-ai/DeepSeek-V4.1-Flash-1017 | 512 | 121,726,623 | 98.24 % | 4,396,698 |

## Per day (Asia/Seoul)

| day | requests | promptTokens | rewrites | net chars | inflating | active saved tokens |
|---|---|---|---|---|---|---|
| 2026-11-02 | 710 | 94,406,115 | 31 | 187,853 | 0 | 3,068,437 |
| 2026-11-03 | 1,483 | 342,617,058 | 80 | 242,763 | 0 | 16,510,241 |
| 2026-11-04 | 1,540 | 379,947,660 | 67 | 304,402 | 0 | 18,912,138 |
| 2026-11-05 | 1,201 | 361,710,170 | 55 | 251,429 | 0 | 8,587,442 |

2026-11-05 covers only the first 7h24m of that KST day, cut by END_MS.

## Era (derived empirically, not from git)

The last warm rewrite whose original was **below** the current 3,700-char floor is
**2026-11-01T03:50:08.707Z** (2026-11-01 12:50 KST). All **229** rewrites after it have
`charsBefore >= 3,719` and **none in-window is below 3,700**, so the 3-day window is a **single era**,
entirely post-`d1547b9`; the 3,000-char era contributes nothing here.

## Prices and dollars (cache-aware)

`~/.dsh/deepinfra-session-cost.json` carries no price table, but its 500 `recent[]` rows are
per-request costs for one route; an exact least-squares fit over
`tokens{input, cacheRead, output, reasoning}` reproduces every row with max |residual| **3.5e-17 USD**,
so these are the operator's prices, not an approximation:

| route **deepseek-ai/DeepSeek-V4.1-Flash-1017** (deepinfra) | USD per 1M tokens |
|---|---|
| uncached input | 0.098000 |
| **cache read** | **0.002940** |
| output | 0.294000 |
| list equivalents (input / cacheRead / output) | 0.200000 / 0.006000 / 0.600000 |

Input costs **33.3x** a cache read. That route is only **10.33 %** of the window's prompt tokens
(512 of 4,934 requests); the other two routes have **no usable prices, so tokens only**.

Saved tokens on the priced route: **4,396,698** → **$0.012926** at cache-read price, **$0.430876** at
uncached-input price (upper bound) — i.e. **1.99 %** / **66.43 %** of that route's $0.6486 measured spend.

**Dollar savings are not 1:1 with token savings.** 98.88 % of window prompt tokens are cache reads,
and the chars the plugin removes sit inside the *cached prefix* that later requests re-send, so the
honest marginal price is the cache-read price; the uncached-input figure is the upper bound if every
removed token were billed as fresh input. Cross-check: on the priced route the cost file's own
session totals match this measurement almost exactly (512 vs 512 requests; cacheRead 119,584,640 vs
119,584,640; input 2,142,178 vs 2,141,983; output 296,205 vs 296,188).

## Non-plugin replacements (excluded)

| kind | count | net chars |
|---|---|---|
| harness pruner (`tool result middle pruned`) | 0 | 0 |
| compaction checkpoint (`user/message`) | 1 | 0 (original text not recoverable) |
| system-message rewrites | 3 | 48,193 (1 of them **inflates**, +13,419 chars) — not plugin saving |

## Caveats and contradictions with the BRIEF

1. **Dedup pointers are `append` events, not `replace` events.** All 4 in-window pointers carry
   `surfaceOp.op === 'append'`; a replace-only scan finds **0**. Measured by sha256(hash) match
   against the earlier `tool/result` (4,100 → 333 chars, net 3,767).
2. **Cold tier contributes 0 in-window.** All 32 cold-tier rewrites fall in
   2026-10-31T14:09Z-21:19Z, before START_MS.
3. **The BRIEF's verified sample does not reproduce here.** seq 1681 → seq 35 in session
   `16358e59...` is a `user/message` compaction checkpoint (a replace), not a `tool/result`
   rewrite, and it lies outside the window. That seq pair is not evidence about warm-tier sizing.
4. Lens (b) assumes each rewrite persists to the window end and that every later request re-sends
   the whole context — an upper-bound fan-out, not a billing model.
5. No `cacheWrite` tokens occur on any route in the window, so the cache read/write split is not a confounder.

## Reproduce

```bash
cd artifacts/token-saving-3d/c-cost
node measure.mjs          # writes report.json and run.log
node spotcheck.mjs        # independent recompute, no shared code
```

`spotcheck.mjs` (no shared code) reproduces 233 rewrites, 1,668,821 → 686,141, net **982,680**.
