# TokenEconomizer 3-day savings — shared measurement brief

Tracks: A primary tiering measurement · B engine-side cross-check · C cost attribution ·
D adversarial audit · E per-day trend. This file is the single source of truth for the method.
Lead wrote it 2026-11-05 (KST). Everything below marked VERIFIED was checked by the Lead against
the live data; everything else is the track's job.

## 0. Window and discipline

- START_MS = 1793571849158 = 2026-11-02T07:24:09+09:00
- END_MS   = 1793831049158 = 2026-11-05T07:24:09+09:00
- Attribute every rewrite by the **replacement event's `time`** (epoch ms). Do not use file mtime
  for event attribution (only for "sessions changed in window" discovery).
- **Read-only**: nothing under `~/.dsh` or `~/.tokeneconomizer` may be written. Do not edit repo
  code or docs. Write only inside your own track directory (assigned in your prompt).
- "Measured" means you ran a command and it printed the number. Label anything else "inferred".

## 1. Data sources

1. `~/.dsh/sessions/<project>/<sessionId>/session.v4.jsonl.zstd` — zstd-compressed JSONL, one
   event per line. Read the **last** file in sorted order of a session directory. Event fields:
   `type`, `seq`, `time` (ms), `data`, `surfaceOp`, `sourceEventSeqs`.
   The store is append-only in surface terms: the original event of a rewrite is still retrievable
   by `seq` in the same file.
2. `~/.tokeneconomizer/repos/<repo>/dsh/` — engine state: `events.jsonl` (turn summaries),
   `untool.json` (toolprune proposal/streaks), `sessions/*.json` (injected_chars, nudges).
   Also `~/.tokeneconomizer/dsh-sessions/*.jsonl` (engine mirror of session events) and
   `~/.tokeneconomizer/index.json`.
3. `scripts/measure-token-saving.mjs` — existing whole-corpus script (no date filter). Copy and
   adapt in your own dir; do not edit the original. 3.7 chars/token is the measured constant.

## 2. VERIFIED event shapes (Lead, 2026-11-05)

A plugin rewrite is a **`tool/result`** event with
`surfaceOp = { op: 'replace', startSeq: S, endSeq: S }` and `sourceEventSeqs = [S]`; the original
`tool/result` event `seq === S` is still present in the same log, so
`charsBefore = text(original).length`, `charsAfter = text(replacement).length` exactly.
Verified sample: session `16358e59…/session.v4.jsonl.zstd` rewrite seq 1681 → original seq 35,
3932 chars → 3338 chars (2026-10-31T23:26Z, outside window).

Classification of a replacement (strict, at the start of the text):
- `[tokeneconomizer] warm tier: the tool output was replaced by its structure.` → TE warm tiering
- `[tokeneconomizer] cold tier: this tool output was evicted from the model context.` → TE cold tiering
- `/\[Output identical to step (\d+) \(hash: ([0-9a-f]+)\), content omitted to save context\]/`
  → TE host-local dedup pointer
- text containing `tool result middle pruned` (or the harness's own prune wording) → **harness
  pruner, NOT TokenEconomizer**. The harness pruner writes the *identical* `compaction/prune` +
  `surfaceOp` shape; never count it as plugin saving.
- skip originals whose text already starts with `[tokeneconomizer]` (already-tiered surfaces).
- anything else → `other`, excluded from plugin totals but counted separately.

Deduping: count each (project, sessionId, replacement seq) once, even if the session directory has
multiple snapshot files.

## 3. Context (read before interpreting numbers)

`dsh-tokeneconomizer/CHANGELOG.md`, `docs/OPERATIONS.md`, and
`TOKEN-ECONOMIZER-SAVING-MEASUREMENT.md` §8 (2026-11-02 audit: 644 warm rewrites, 2.82M chars
before, +1.03M chars saved, 52.95% of rewrites **inflating** under the old 1200-char floor).
Known commitments in the window:
- `d1547b9` 2026-11-02 07:48:05 +09 — `tierMinChars` 3000 → 3700
- `5fba56a` 2026-11-02 08:42:19 +09 — external settings file + six-turn hot window
- live `cordis.patch.yml` value today: `tierMinChars: 3700`
Restart times are not in git, so era boundaries must be **derived empirically** (first rewrite that
could only run under the new floor, settings-file mtime, changelog notes). Do not assume a single
regime for the whole window; report per-era as well as per-day (Asia/Seoul).
A fixed floor bounds the input, not the output: report `inflating` (charsAfter > charsBefore) and
chars added, and never quote gross saving without net.

## 4. Required numbers (fill what your track owns; use null where not measured)

- corpus: sessions / requests / promptTokens / cacheReadTokens+share / outputTokens for the window
  (real sessions only; fixtures listed below)
- tiering: rewrites, charsBefore, charsAfter, netCharsSaved, inflating count+chars, split warm/cold,
  per-day, per-era
- dedup: pointer events, bytes/characters replaced, and tokens-not-re-sent model (see §5)
- microskills: injected chars in window (engine `sessions/*.json` `injected_chars`, mtime-filtered)
- toolprune: proposals non-empty? which repos, any active mask
- watchdog/loop guard: nudges, aborts, guard-observed tool calls in window
- savings in tokens: netChars / 3.7 (context tokens removed) and the persisted-context multiplier
- coverage: what share of the window's prompt tokens the saving represents

## 5. Two savings lenses (report both, never conflate)

(a) **context chars removed**: sum(charsBefore - charsAfter) for plugin rewrites, plus dedup
    pointer replacement size. This is the direct edit.
(b) **prompt tokens not re-sent**: a rewrite at turn T shrinks the context for every later
    `assistant/message` request in that session. Estimate = (chars saved / 3.7) × number of
    later assistant messages in the same session (cap at END_MS). Say clearly that this assumes
    the rewrite persists and that most of those re-sends are cache reads (cheaper than uncached
    input); give the token figure, not a dollar figure, unless your track is C.

## 6. Fixtures and exclusions

Exclude from "real" totals: session cwd under `/tmp` (e.g. /tmp/te-*), project dirs named
`te-side-*`, `benchtest-*`, `ab-current-*`, plus obvious synthetic verification runs. Report the
fixture totals separately so the split is visible.

## 7. Deliverables (in your track dir)

- `measure.mjs` (or .sh) — reproducible, prints the headline table; store its stdout in `run.log`.
- `report.json` — the numbers, exact integers (chars) and derived floats; include window, era table,
  day table, and a `method` string per block.
- `report.md` — ≤120 lines: method, headline table, per-day/per-era, inflating cases, caveats,
  exact commands to reproduce.
- Final reply to the Lead: ≤25 lines of headline numbers + your confidence + any contradiction with
  the other tracks' likely numbers.

## 8. Non-negotiables

- If a number cannot be measured, write `null` and say why. Never fill a gap with a plausible value.
- Keep exact integers; round only in prose, and say the unit.
- Flag any case where self-inflation (charsAfter > charsBefore) still occurs after the 3700 floor —
  with the input size and the added chars.
- Do not write outside your track dir; do not touch the plugin's source or `~/.dsh`/`~/.tokeneconomizer`.
