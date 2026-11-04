# Track B — independent engine-side cross-check

**Window** 2026-11-02 07:24:09 → 2026-11-05 07:24:09 KST. This track **never reads a `surfaceOp`
from `~/.dsh`**. It measures from the engine's own state under `~/.tokeneconomizer`, and touches
`~/.dsh/sessions` **only** to (i) compute the prompt-token baseline and (ii) quantify the divergence
against the raw-session route.

```bash
cd artifacts/token-saving-3d/b-engine && node measure.mjs --json report.json > run.log
```

## Data actually used

| source | rows in window | what it gives |
|---|---:|---|
| `dsh-sessions/*.jsonl` (engine mirror) | 207 files, 194 654 events, 51 092 with `surfaceOp`, 1 135 `replace` | rewrite surfaces, chars |
| `repos/*/dsh/events.jsonl` | 113 turn summaries + 12 nudge events | nudges, aborts, tool calls |
| `repos/*/dsh/ledger.jsonl` | 21 session rows + 467 overhead rows | injected_chars, judge/nudge-writer tokens |
| `repos/*/dsh/untool.json` | 1 repo modified in window | toolprune proposal + streaks |
| `repos/*/dsh/sessions/*.json` | 40 files mtime-in-window | per-session nudges (12), aborts (2) |

## Headline (engine side)

| metric | engine route | raw-session route | delta |
|---|---:|---:|---:|
| rewrites | **229** (warm 229, cold 0) | 229 | **0 (0.000 %)** |
| charsBefore | **1 668 821** | 1 668 821 | 0 (0.000 %) |
| charsAfter | 686 141 | 686 141 | 0 |
| netCharsSaved | **982 680** | 982 680 | **0 (0.000 %)** |
| dedup pointers | 4 (3 767 chars) | 4 | 0 |
| inflating | 0 | 0 | 0 |
| min charsBefore | 3 719 | 3 719 | 0 |

**Verdict: no divergence.** Every compared metric is 0.000 % apart — the two routes are not merely
within the 2 % threshold, they are exact. Since the engine route pairs rewrites through the mirror's
own `surfaceOp` range while Track A pairs through the store's `sourceEventSeqs`, exact agreement is a
real cross-check of the pairing logic, not a tautology.

## Why the agreement is exact, and where it stops being informative

The mirror is an event-level copy: `~/.tokeneconomizer/dsh-sessions/70ee2d8d…jsonl` differs from the
decompressed store only by 62 trailing bytes. So the mirror is **not an independent instrument for
counting rewrites** — it is a second copy of the same evidence. Its value is: (1) it proves the engine
saw the same surfaces, and (2) the engine state files (*not* copies of the raw log) do carry
independent signals, reported below.

## Engine-side levers (independent of the raw log)

- **micro-skills / injected chars: 0.** `ledger.jsonl`'s `injected_chars` is 0 on all 21 in-window
  session rows, and `sessions/*.json` has no `injected_chars` key at all. Micro-skills contributed
  nothing in this window — measured, not assumed.
- **loop guard / nudges: 12** (from `sessions/*.json`, mtime-in-window; the same 12 as the 12 `nudge`
  events in `events.jsonl`), **aborts: 2** (sessions `70ee2d8d`, `f62f7f28`).
- **overhead: 467 rows, 2 210 470 judge tokens + 70 280 nudge-writer tokens.** This is what the
  engine *spent* to police loops — it is a cost the plugin adds, and it is larger than the whole
  measured char saving (982 680 chars ≈ 265 589 tokens) by an order of magnitude. See caveat.
- **toolprune:** exactly one repo carries a non-empty proposal —
  `dsh-plugins-4806902e1d` → `["agy_worker","cli_worker","subagent_antigravity","subagent_opencode","working_directory"]`,
  max streak 50, `untool.json` mtime in window. All other 6 repos have `proposal: []`.
- **tool calls seen by the guard: 10 648** across 113 turn summaries.
- **repos touched in window:** `dsh-plugins` (105 turns, 22 nudges, 2 aborts, 10 299 tool calls),
  `project-promotion-manager` (5/2/0/304), `total-skill` (3/0/0/45), `default-workspace`
  (0 turns, 10 session files).

## Coverage caveat

`mirrorSessions 207` vs `dshSessions 109`; 107 sessions exist only in the mirror and 9 only in the
store. That is the engine's longer retention (it keeps folded history the store pruned), not a data
loss — none of the extra mirror sessions has in-window `replace` activity.

## Caveats

1. The exact 0.000 % agreement means **Track B cannot independently confirm or refute Track A's
   counts**; both read the same underlying event stream. Track B's genuine independent contribution is
   the engine-state block (nudges, aborts, injected_chars, toolprune, overhead).
2. `judge tokens 2 210 470` and `nudge-writer tokens 70 280` are *overhead the plugin incurred*, not
   savings. Netting them against 265 589 saved tokens yields a **net negative** on the context
   dimension. Any headline that quotes gross char saving without this line is incomplete.
3. `injected_chars` being 0 is a measurement of the ledger field, not a proof that no injection text
   ever reached a prompt.
