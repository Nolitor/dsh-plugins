<!-- skeleton:
version: 1.0
kind: design
status: active
updated: 2026-11-04
summary: Stage plan for @nolit/dsh-opencode-v2 — what "stabilised" means as a measurable gate, then stage 2 (move the canonical recipe-derived protocol parser into this single package) and stage 3 (ship the conformance oracle in the test suite). Replaces the deleted beta package. Records the exact defects that block promotion, the acceptance thresholds taken from recorded traffic, the rollback route, and who is allowed to open a stage.
-->

> **Absorption 2026-11-10:** stages 2 and 3 are re-homed to Phase B (port + `classifyText`
> hook, legacy default) and Phase F (canonical default + oracle) of
> [OPENCODE-ABSORPTION-BLUEPRINT.md](../../dsh-custom-router/docs/OPENCODE-ABSORPTION-BLUEPRINT.md).
> Phase B is decoupled from the O1/O2/O3 verdict.
>
> Status: **stage 1 (stabilisation) in progress** · Baseline: `0.0.2-rc.1` ·
> Staged code: `staging/opencode-v2-stage2/` · Next plugin: [dsh-deepinfra/docs/DEEPINFRA-ADAPTER-BRIEF.md](../../dsh-custom-router/vendor/deepinfra/docs/DEEPINFRA-ADAPTER-BRIEF.md) ·
> Evidence: [CHANGELOG](../CHANGELOG.md),
> [capability delta](../RECIPE-CAPABILITY-DELTA.md)

# OpenCode V2 — stage plan (2 and 3 gated on stabilisation)

## 1. Why this document exists

The beta package (`@nolit/dsh-opencode-v2-beta`) was deleted on 2026-11-04. It was created
to stage a better protocol parser, but it shipped as a second plugin that:

- registered the same `opencode` tool, `/opencode`, `/ocode`, `cli_worker` and
  `opencode-http-agent` route as the stable package, so only one could ever be active;
- had no `locale/*.json`, so its plugin card rendered as the bare specifier
  `@nolit/dsh-opencode-v2-beta` next to `Opencode v2 Agent` — indistinguishable in the UI;
- served no model: it mounted, ran its self-check, and stood down.

The parser work itself was sound and is preserved in `staging/opencode-v2-stage2/`. The
stages below move it into the **single** stable package, behind measurable gates.

## 2. What "stabilised" means (stage 1 exit criteria)

Stage 2 may not start until **all** of these hold. Each is a command, not an opinion.

| # | Criterion | How it is measured | Threshold |
|---|---|---|---|
| S1 | No entry fails to activate | `journalctl --user -u dsh-web.service --since <restart>` | zero `did not activate` lines |
| S2 | The served build matches the tree | `bash scripts/verify-opencode-v2-restart.sh` | `verdict: PASS` |
| S3 | Unit suite green | `node --import ./test/setup-isolate.mjs --test test/*.test.mjs` | 0 fail |
| S4 | Real isolated boot clean | copy the profile to a temp `DSH_HOME`, `dsh web --port 0` | 0 activation warnings, load beacon present |
| S5 | Browser boot clean | playwright against the served page | shell renders, no `web boot:` failure, no page errors |
| S6 | **Soak**: a full day of real turns with no new defect | owner-reported; trace reviewed | zero new defect reports attributable to this plugin |
| S7 | Every reported defect closed **with a regression test** | test files named in §6 | 100 % |

S6 is the criterion that failed last time: `0.0.2` was shipped, restarted, and broke on the
first boot. **A green suite is not S6.** S6 requires time and the owner's own usage.

### Sibling track — `@nolit/dsh-antigravity`

Antigravity uses the same S1–S7 gate; its status and stage-1 reinforcement are recorded in
[dsh-antigravity/docs/ANTIGRAVITY-STAGE-PLAN.md](../../dsh-custom-router/vendor/antigravity/docs/ANTIGRAVITY-STAGE-PLAN.md). Stage 2/3 work opens for **both** tracks
together, and only after each track's S6 soak is owner-confirmed. Do not open stage 2 for one
track alone.

## 3. Stage 1 — current state and remaining work

Applied in `0.0.2-rc.1` (measurements in CHANGELOG `0.0.2-rc.1`):

| Change | Status |
|---|---|
| `ctx.tools` read without `inject` killed the entry | fixed (`lib/optional-service.js`, three regression layers) |
| Cost pill rendered for every provider | fixed (event-driven route gate) |
| Cost pill matched a MODEL id prefix, so other routers showed it | fixed (provider id only) |
| Beta package / claim-file subsystem removed | done |
| README prerequisites measured on this host | done |

Still open in stage 1 (each needs an owner report first — do not pre-emptively "fix" these):

| # | Observation | Evidence | Owner decision needed |
|---|---|---|---|
| O1 | Prose that mentions the call notation is erased and re-armed as a call candidate | measured 2026-11-04, reproducible: input `Use [tool call run_code #abc]: {...} syntax…` → visible text loses the sentence, 1 call candidate raised; the display gate then drops it as `superseded` | is this a display bug worth fixing before stage 2? |
| O2 | `DWIM`-style glyph drift: the model writes `｜` (U+FF5C), `│` (U+2502) or `|` for the same token | trace: 1,048 of 7,291 finishes (14.4 %) carried a marker delta | stage 2 handles it; no stage-1 action |
| O3 | `content_filter` now maps to an error | trace: 26 occurrences | confirm the host handles the error kind well |

## 4. Stage 2 — the canonical parser inside this package

**Goal:** replace the 679-line regex classifier (`lib/stream-parser.js`, 9 openers,
`MAX_OPENER = 16` code units of hold-back) with the staged parser in
`staging/opencode-v2-stage2/lib/protocol-parser.js`.

**Why it is worth doing (measured):**

| Fact | Value |
|---|---|
| Finishes that carried protocol notation inside a text delta | 1,048 / 7,291 = **14.4 %** |
| Marker deltas total | 1,314 |
| Compression layers the parser must beat | `display-gate.js` (157 lines), `arguments.js` (178), `display-clean.js` (121) |
| Invariance the staged parser already passes | 300 re-chunkings over 7 conformance cases |

**Method — swap behind the existing seam, never a second package:**

1. The only consumer is `lib/http.js` (two call sites: text and reasoning classifiers,
   both `createStreamClassifier({ toolNames, tools })`). Keep that constructor shape so the
   swap is one import line plus a shim.
2. Port the staged files into `lib/`: `canonical-tokens.js`, `protocol-parser.js`, and an
   adapter that exposes `createStreamClassifier` on top of `createProtocolParser`.
3. Keep the old classifier in-tree as `stream-parser.legacy.js` for **one release**, selected
   by config (`parser: 'legacy' | 'canonical'`, default `legacy` until S2-4 passes).
4. Delete the legacy file only after S2-4 and S2-5 are green for a release.

**Stage 2 acceptance gates:**

| # | Gate | Threshold |
|---|---|---|
| S2-1 | Conformance corpus passes inside the package | 7/7 |
| S2-2 | Invariance | 300/300 re-chunkings identical |
| S2-3 | Prose is never destroyed | the three adversarial inputs in §5 must round-trip byte-identical when the tool name is undeclared |
| S2-4 | Replay of recorded traffic shows no regression | replay `/tmp/opencode-v2-trace.jsonl` shapes; the canonical parser's part stream must match the legacy stream on every finish that had `markerDeltas == 0` (6,243 finishes) |
| S2-5 | One full day of real turns on `parser: 'canonical'` | no new defect, same S6 rule |

**Rollback:** `parser: 'legacy'` (config, no rebuild). That is the entire reason the legacy
file stays in-tree for one release.

### 4.1 Relationship to the shared stream pipe

The recipe parser is the **`classifyText` hook** of the workspace shared downstream pipe
([SHARED-STREAM-PIPE-SPEC.md](../../dsh-custom-router/docs/SHARED-STREAM-PIPE-SPEC.md) §5.5),
not a private stage-2 file that happens to live in this package. Stage 2 therefore has two
possible landing shapes and the order is an owner decision:

The rollout order is fixed by the owner: the shared core lands first (P1, no consumer), then
**antigravity (P2)**, then **deepinfra (P3)**, and **this track last (P4)**
([SHARED-STREAM-PIPE-SPEC.md §1 §7](../../dsh-custom-router/docs/SHARED-STREAM-PIPE-SPEC.md)).
This track is last because it carries the most live traffic and is the only consumer of the
optional hook, so the wire-only path must be proven twice before it moves.

| Shape | Meaning | Gate |
| :--- | :--- | :--- |
| A — local first | port the parser into `lib/` behind `parser: 'legacy' \| 'canonical'` as written above, then register it as the hook when the shared pipe is available to this track | S2-1..S2-5 as written |
| B — pipe first | once P1–P3 are complete, this track's stage 2 is delivered as the `classifyText` hook | the same gates, measured through the pipe |

Either way the parser is **not** re-implemented per provider: DeepInfra and Antigravity stay
wire-only (`toolCalls.classifier = 'wire-only'`), and only this track enables the hook. Stage 2
of this track therefore **cannot start** while P1–P3 are open.

## 5. The three adversarial inputs that must round-trip

Copied from the live probe (all three are real failures of the current classifier):

```text
1. Use [tool call run_code #abc]: {"code":"x"} syntax to call a tool.
   today: text '"Use  syntax to call a tool."' + 1 call candidate  (sentence destroyed)

2. The model writes <｜DSML｜invoke name="bash"> when needed.
   today: text '"The model writes  when needed."'                  (notation erased from prose)

3. Plain prose only.
   today: unchanged                                                 (control case)
```

Rule for stage 2: with `toolNames = ['run_code','bash']` **declared**, input 1 and 2 may be
recovered as calls only if the recovered call is complete and the tool is declared; the
visible text must still contain the sentence as typed, or the drop must be recorded as an
explicit `notation` part. Silently deleting a sentence is not acceptable in either case.

## 6. Stage 3 — the conformance oracle in the shipped suite

**Goal:** make the recipe-derived oracle part of the package's own tests, so the parser
cannot drift from the documented DeepSeek behaviour.

| # | Gate | Threshold |
|---|---|---|
| S3-1 | `test/conformance.test.mjs` runs in `npm test` | present, green |
| S3-2 | Corpus is versioned with its source | every case keeps its `ref` field naming the recipe file or the measured trace |
| S3-3 | Invariance runs on every real-shape input in the corpus | 300 splits |
| S3-4 | A parser change without a corpus case is refused | review rule, recorded in this doc |

**Why stage 3 is separate from stage 2:** the oracle is only meaningful once the canonical
parser is the default. Running it against a parser nobody serves would be decoration.

## 7. Rules for opening a stage

- **Only an explicit owner instruction opens a stage.** A green suite, a quiet day, or an
  agent's own judgement is not an instruction. (This is the rule the `0.0.2` release broke.)
- The version advances one `-rc.N` per instructed fix round inside stage 1.
- Stage 2 and 3 ship as **the same package**, one version bump each. No staging package is
  ever installed again; `staging/` is source, not a plugin.
- Every stage-1 defect closed must leave a regression test, named in the commit and listed in
  §3 or §6.

## 8. Files that implement this plan

| Path | Role |
|---|---|
| `staging/opencode-v2-stage2/lib/canonical-tokens.js` | Special-token table, extracted from `deepseek-recipe` by code point |
| `staging/opencode-v2-stage2/lib/protocol-parser.js` | Staged parser (stages, marker matching, hold-back, unterminated-block rule) |
| `staging/opencode-v2-stage2/lib/conformance.js` | 7-case corpus + re-chunking oracle |
| `staging/opencode-v2-stage2/test/conformance.test.mjs` | The oracle's own tests |
| `dsh-opencode-v2/lib/stream-parser.js` | The legacy classifier stage 2 replaces (679 lines) |
| `dsh-opencode-v2/lib/http.js` | The seam: two `createStreamClassifier` call sites |
| `dsh-opencode-v2/RECIPE-CAPABILITY-DELTA.md` | Why recipe is copied as spec + oracle, not vendored |
