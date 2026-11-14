# DSH schema alignment — implementation record

<!-- skeleton:
version: 1.1
kind: report
status: active
updated: 2026-11-15
summary: The implementation record for the DSH schema alignment refactor of @nolit/dsh-tokeneconomizer — the module map as delivered, the three plugin:tokeneconomizer/* record types, the agent/pre-step trigger migration and its one-step consequence, the deprecated-read posture with the SessionSurface constraint, the 토큰절약기 · 환경설정 settings page and its six routes, the three mechanisms' end-to-end paths with their degraded modes, what was not done, and the verification gates.
-->

## 1. Purpose and inputs

This document records **what was built**, as opposed to [DSH-SCHEMA-BLUEPRINT.md](DSH-SCHEMA-BLUEPRINT.md),
which designed it. The two inputs were:

| Input | Role |
|---|---|
| [DSH-SCHEMA-GAP-BRIEF.md](DSH-SCHEMA-GAP-BRIEF.md) | the measured ingestion of the installed DSH `0.2.2-rc.3` core schema — 42 gaps, severity-ranked, with a hard-assumption inventory |
| [DSH-SCHEMA-BLUEPRINT.md](DSH-SCHEMA-BLUEPRINT.md) | the target architecture that closed all 42 gaps, with acceptance gates |

Both are inputs and are **kept as written**; this file adds the delivery record beside them.

The refactor changed the plugin's *ownership posture*, not its feature set: from "consumer of ambient
shapes" to "producer of attributed, probed, identity-pinned writes". Three blocker-grade gaps were
closed:

| Gap | Blocker statement | Closed by |
|---|---|---|
| `G-A-01` | no project/repository entity exists in DSH's session store, so the plugin's per-repo partition had no DSH-side durable anchor | `lib/identity.js` — the two-value identity model |
| `G-B-01` | the plugin wrote the byte-identical `compaction/prune` + `tool/result`-replace pair as the harness's own pruner, so the two were indistinguishable in the log | `lib/attribution.js` + `lib/surface-attribution.js` — plugin records |
| `G-C-01` | the headline token-saving feature (tiering) rode on the deprecated `agent/request` hook | `lib/tiering.js` — the `agent/pre-step` trigger |

## 2. Module map as delivered

Measured line counts, 2026-11-15.

| Module | Lines | Role |
|---|---|---|
| `lib/identity.js` | 314 | project identity: the two-value model `projectDir` (immutable, from the session header) vs `liveDir` (from `working-directory/change`); `resolveIdentity`, `readIdentity`, `writeIdentity`, `adoptLegacyKey`, `IDENTITY_SCHEMA_VERSION = 1` |
| `lib/repokey-bridge.js` | 37 | the legacy engine repository key, used only by the adoption procedure; marked UNVERIFIABLE against the engine |
| `lib/probes.js` | 404 | capability-probe catalog — 7 seams, contract-tier vs internal-tier, `probeFn`, `probeCtx`, `probeSessionAppendOverload`, `probeAll`, `SEAM_CATALOG` |
| `lib/attribution.js` | 220 | the record layer: `appendRecord`, `readRecords`, `recordsOfType`, `validateRecord`, `RECORD_NAMES` |
| `lib/rewriter.js` | 295 | surface composition: `validateRewriteTarget`, `buildReplacement`, `buildPrunePayload`, `composeRewrite` |
| `lib/surface-attribution.js` | 248 | the paired write: `applyRewrite` — validate → `tier-decision` record → `compaction/prune` → `tool/result`+`surfaceOp` → `surface-rewrite` record |
| `lib/settings-contract.js` | 69 | browser-safe frozen contract data (zero imports) |
| `lib/settings-api.js` | 691 | the six settings routes |
| `lib/types/records.d.ts` | 80 | `PluginRecordMap` augmentation |
| `scripts/audit-deprecations.mjs` | 327 | the deprecation gate (exit 0/1/2) |
| `scripts/check-syntax.mjs` | 62 | walks `lib/`, `bin/`, `scripts/` instead of a hardcoded file list |

`lib/identity.js` and `lib/repokey-bridge.js` are exercised by `test/identity.test.mjs`; the
identity resolution path is not yet wired into `lib/index.js`'s live session flow (see §8).

## 3. The three record types

All three live under the `plugin:tokeneconomizer/` namespace and go through DSH's
`appendPluginRecord`.

| Record type | Payload |
|---|---|
| `surface-rewrite` | `{ nodeSeq, tier, charsBefore, charsAfter, shadowTokens, reason }` |
| `tier-decision` | `{ nodeSeq, tier, turn, step, policyHash, reason }` |
| `toolprune-applied` | `{ tools, countBefore, countAfter, visibleIntersection, proposalId?, repoKey, time }` |

### 3.1 Why records, not event types

A plugin record is `ignorable`, **never enters the model-visible surface** (so it costs zero
tokens), and survives fork and resume with the rest of the log. A new *event type* would enter the
surface and therefore the model's context — an attribution trail that spends the very tokens the
plugin exists to save. The event space is also closed: the harness owns the event type grammar,
and a plugin-owned event type would be a hard mount failure the moment the grammar tightened.

The measurement that forced the change: the harness's own `dsh-compaction-tool-result-pruner`
writes exactly the same `compaction/prune` payload and the same `tool/result` replacement with
`surfaceOp: { op: 'replace', … }`, and `compaction/prune` carries **no producer field**. On the log
alone the two were indistinguishable, and a measurement once credited the harness's 179 rewrites to
this plugin. The record is the side channel that makes the producer nameable.

### 3.2 The appender is a module export, not a method

DSH's `Session` has **no** `appendPluginRecord` *method*. The record API is a module export —
`appendPluginRecord(session, type, data)` — resolved through the ctx service surface
(`ctx.get('session')`). `lib/index.js` resolves that appender once per process
(`resolveRecordAppender()`), so no harness package is imported and the package keeps its zero
runtime imports outside `node:` builtins. `lib/attribution.js` looks for a session method first and
falls back to the injected appender, so a test can supply its own.

### 3.3 The write order is the failure policy

`applyRewrite` (`lib/surface-attribution.js`) runs in one fixed order:

```
validate the target against the current surface
  -> append the `tier-decision` record
  -> append `compaction/prune` (the shadow price)
  -> append `tool/result` with `surfaceOp: {op:'replace'}`
  -> append the `surface-rewrite` record
```

Two consequences, both intended:

1. A **record** failure never corrupts or undoes the replacement, and never retries the
   replacement: a lost record is a missing attribution, not a reason to write the surface twice.
   The failure is reported back to the caller as a `warning` once.
2. A **replacement** failure returns before any record claims it, so a record can never describe a
   write that did not happen. A resumed log carries records only for writes that really landed.

The one exception is deliberate: a *validation* failure still writes the `tier-decision` record
(with `reason: "rejected: …"`), because a decision that produced no rewrite is a measurement fact,
not a failure to hide.

Records are advisory evidence. Every path in the record layer is fail-open.

## 4. Trigger migration and its honest consequence

Tiering moved off the deprecated `agent/request` seam onto **`agent/pre-step`**, with a
`session/event` (`step/start`) fallback. `chooseTrigger()` in `lib/tiering.js` **never returns
`agent/request`** — not even when it is the only hook the probe reports.

The fallback order is fixed:

| Order | Seam | Why |
|---|---|---|
| 1 | `agent/pre-step` | preferred, non-deprecated, the exact step-preparation waterfall DSH still supports |
| 2 | `session/event` (`step/start`) | first-class fallback: it observes `step/start` and applies before the next pre-step |

### 4.1 The consequence, stated plainly

`agent/request` ran **after** request assembly and `step/start`, before the system prompt and the
accepted user batch were committed. `agent/pre-step` runs at **step preparation**, before request
assembly. So a rewrite triggered from `agent/pre-step` **may land one step later** than it would
have on `agent/request`.

It still saves tokens on every subsequent step of the turn. The one-step delay is a real cost, not
a cosmetic one, and it is stated here rather than hidden.

## 5. Deprecated-read posture

| Site | Status |
|---|---|
| `lib/index.js:928` | **migrated** → `session.seq > 0` |
| `lib/index.js:1047`, `:1091` | keeps `session.eventAt` — **no replacement exists in 0.2.2-rc.3** |
| `lib/index.js:1589` | keeps `session.snapshotEvents` — needs the full durable log including shadowed events |
| `deriveMessages` | **not deprecated** — untouched |

`scripts/audit-deprecations.mjs` carries `allowDeprecated: true` for the two seams that keep a
deprecated read, **with a printed justification**, and the FAIL branch still bites for any seam
that is not on the allow list:

```
$ node scripts/audit-deprecations.mjs
WARN session.eventAt: deprecated (allowed — No replacement reader exists in 0.2.2-rc.3; upstream keeps 20+ live calls with "migration deferred". Call sites: lib/index.js:1047, :1091.); migration: docs/ARCHITECTURE.md
WARN session.snapshotEvents: deprecated (allowed — Required for the full durable log (shadowed events included); the surface exposes sequence numbers only. Call site: lib/index.js:1589.); migration: docs/ARCHITECTURE.md
ok session.deriveMessages
ok session.append
ok agent.pre-step
ok tools.restrict
ok systemPrompt.context

2 allowed deprecation(s); schedule the migration.
$ echo $?
0
```

Exit codes: `0` every seam present and none newly deprecated, `1` a consumed seam missing or
deprecated without acknowledgement, `2` the DSH install root cannot be found. The script is
read-only: it never writes to the install or the workspace.

### 5.1 This mirrors upstream's own stance

The deprecation text reads *"Existing logic may remain unmigrated for now, but new calls are
prohibited."* Upstream holds itself to that literally, not to a stricter rule: **22** call sites
across the installed `@deepseek-ai/dsh` packages are annotated
`// Existing Session history read; migration deferred.` next to a `.eventAt(...)` call, and
`dsh-compaction-basic` — the upstream compactor — keeps live `eventAt` calls marked exactly that
way. The plugin's posture is the same one upstream takes: existing reads stay, new reads are not
added, and the exception is recorded rather than implied.

The deprecation's referenced Agent Note
(`.agents/notes/implemented/architecture/2026-09-09-deprecate-synchronous-session-event-reads.md`)
is **not shipped in the install** — the path does not exist under
`/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh`, so the migration plan it may carry
cannot be read from this host. **UNVERIFIABLE** from here.

### 5.2 The phantom-API finding

`session.surface.readEvent` **does not exist**. `SessionSurface` exposes only three members:

| Member | Type | Meaning |
|---|---|---|
| `nodes` | `readonly SessionSeq[]` | current surface event sequences, in model-visible order |
| `replaceGeneration` | `number` | monotonic count of committed positional replacements |
| `contentGeneration` | `number` | monotonic count of committed replacements and plugin-owned message changes |

Measured against the installed `@deepseek-ai/dsh-session/lib/types/surface.d.ts`. Any design that
assumed an event-body read through the surface was wrong: **a caller must supply the event or a
reader**. The plugin does exactly that — `lib/rewriter.js` takes the event (or a `readEvent`
callback) as an input, and `lib/index.js` supplies `readEvent: (probeSeq) => session.eventAt(probeSeq)`
at the one call site that still uses the deprecated reader. `surface.nodes` is the sequence-number
view only, and it is what makes the full durable log (shadowed events included) unreachable from
the surface alone — hence `session.snapshotEvents` at `lib/index.js:1589`.

## 6. The settings GUI

### 6.1 The two seats

| Seat id | Order | Kind | Title |
|---|---|---|---|
| `tokeneconomizer-devstats` | 62 | read-only card | `Token Economizer · Developer statistics` |
| `tokeneconomizer-settings` | 63 | write page | `토큰절약기 · 환경설정` |

The Korean title is the locale value (`locale/ko.json` → `settings.title`); the English title is
`Token Economizer · Settings` (`locale/en.json`).

### 6.2 The six routes

| Route | Method | Answer |
|---|---|---|
| `/api/local/tokeneconomizer/settings` | GET | the read payload: modes, thresholds, mechanism status, judge status |
| `/api/local/tokeneconomizer/settings/config` | POST | batched write — one result per key, not one verdict for the batch |
| `/api/local/tokeneconomizer/settings/restore` | POST | undo the tool-prune restriction |
| `/api/local/tokeneconomizer/settings/reset` | POST | drop stored overrides (all thresholds, or a named subset) |
| `/api/local/tokeneconomizer/settings/import` | POST | **202** plus a job id |
| `/api/local/tokeneconomizer/settings/import/:jobId` | GET | the job's own status, exit code and output |

### 6.3 The controls

| Control | Values |
|---|---|
| `microskills` | `off` / `envfacts` / `envfacts+distiller` / `distiller` |
| `toolprune` | `off` / `propose` / `auto` |
| `loopguard` | `off` / `nudge` / `stop` |
| nine numeric thresholds | `microskills_propose_every`, `toolprune_evidence`, `toolprune_min_sessions`, `toolprune_sessions`, `toolprune_quiet_minutes`, `loopguard.envelope_min_samples`, `loopguard.judge_confidence`, `loopguard_nudges`, `loopguard.backstop_mult` |
| actions | `toolprune restore`, reset-to-defaults, history import |
| banner | judge-unavailable |

`on` is a **write alias**, never a stored value: `microskills: on` writes
`envfacts+distiller`, `toolprune: on` writes `auto`, `loopguard: on` writes `nudge`.

The nine thresholds each carry a default, an override and an effective value as three distinct
readings, and each has its own per-key reset.

### 6.4 `history_import` is not an engine key

`history_import` is a **plugin-owned action**, not a config key. A whole-engine grep finds **zero**
hits for it. It maps to `bin/te-dsh.mjs cold-start` — the import route spawns that command with a
validated argument allow-list (`--all`, `--dry-run`, `--reimport`, `--include-missing`,
`--dsh-home`, `--limit`, `--only`) and answers `202` with a job id.

### 6.5 Writes go through the process boundary

Every engine write goes through the `child_process` boundary (`te config set`, `te config unset`,
`te config restore`) — **never** a direct file write into the engine's state. And every write
**re-reads `te config show` before responding**: the response carries the persisted value, never
the posted one. A key the engine did not persist comes back as `ok: false` with
`engine did not persist <key>`.

### 6.6 The client half cannot import the contract

The client half **cannot import** `settings-contract.js`: the loader exposes a fixed module table
and `lib/client.js` must carry **no** `import` statements (asserted by `test/client.test.mjs`). The
client therefore **mirrors the constants as literals**, with a comment naming
`lib/settings-contract.js` as the source of truth. A **drift test** binds the inline
`SETTINGS_I18N` table to `locale/en.json` and `locale/ko.json`, so the inline copy cannot silently
diverge from the locale files.

## 7. The three mechanisms, end to end

### 7.1 Micro-skills — now real

| Stage | Path |
|---|---|
| facts | engine-synthesized repository facts, returned in the session brief |
| injection | `systemPrompt.context({ name: 'tokeneconomizer:microskills', order, text, required: true })` |
| form | a **durable user-role snapshot**, never a byte-changing section |
| stability | the text is captured at `agent/created`, so the rendered bytes never change inside a session and the cached prefix survives |

### 7.2 Tool pruning — now real

| Stage | Path |
|---|---|
| proposal | the engine's per-repository tool-prune proposal |
| intersection | intersected with `ctx.tools.definitions()` — the **visible** tool set — before use |
| application | `ctx.tools.restrict({ deny })` on the agent scope; the tool is absent from the next step's declarations, not merely denied at call time |
| evidence | a `toolprune-applied` record: `{ tools, countBefore, countAfter, visibleIntersection, proposalId?, repoKey, time }` |

Measured before this work: `untool_applied` was `[]` across the whole ledger — **1149 records, all
1149 empty** — the lever had never applied. The cause was the missing intersection: DSH rejects a
restriction naming a tool the composition does not register, so an unintersected proposal failed
every time and the lever was silently dead.

### 7.3 Failure-loop — envelope plus judge, with a degraded path

| Stage | Path |
|---|---|
| envelope | the ended-green turn envelope the engine builds from the session |
| judge | the engine's model side call through `dsh --profile headless` |
| degraded path | when the judge seam is unreachable, the **strict heuristic** still fires (consecutive identical failures with the same error signature is judge-independent), and the decision is marked `loopguard:repeat:degraded` in the record's `reason` |

Measured: the judge **cannot run**. `~/.tokeneconomizer/errors.log` ends with
`sidecall dsh: no reply (exit 1) dsh: ACCOUNT_SIGN_IN_REQUIRED`. The judge is probed once per
session and cached — a per-turn probe would spawn a side call on every tool result. The
lower-precision path is visible in the record rather than presented as a judged verdict.

## 8. What was NOT done, and why

| Not done | Why |
|---|---|
| ~~`lib/identity.js` is not wired~~ — **closed 2026-11-15** | `lib/index.js` resolves every session through `resolveSessionIdentity()` (`:674`). The legacy engine key still wins when its bucket exists on disk, and the identity key is recorded alongside it, so an existing `repos/<key>/` directory is adopted rather than orphaned. Measured: 11 of 11 checkouts produce an identity key identical to the legacy key. |
| ~~`lib/settings-api.js` is not mounted~~ — **closed 2026-11-15** | `mountSettings()` (`:578`, `:616-624`) registers the six routes through the connection seam, grouped one-registration-per-path because DSH rejects a duplicate path. The client's 404 is gone. |
| `lib/repokey-bridge.js`'s key is not claimed to match the engine | the engine's source is absent from this host, so its canonicalization is **UNVERIFIABLE** from here. The bridge names the legacy path once so the adoption procedure has one obvious seam; it never asserts parity. |
| The deprecated `eventAt` / `snapshotEvents` reads are still there | no replacement reader exists in `0.2.2-rc.3`, and the surface exposes sequence numbers only. Migrating them would need an upstream reader this host does not have. |
| The judge was not fixed | it fails on the operator's account authentication (`ACCOUNT_SIGN_IN_REQUIRED`), which is the user's credential state, not a plugin defect. The degraded path exists for exactly this case. |
| `lib/probes.js`'s `SEAM_CATALOG` reports the `agent/request` row | the catalog **reports** the deprecated seam so a reader can see it exists; the code never selects it. Reporting a deprecation is not using it. |

## 8a. Where the next session starts — Wave 6 only

Waves 1–5 are delivered and wired. `docs/DSH-SCHEMA-BLUEPRINT.md` §5.2 still specifies **W6**, which
is structural debt rather than a defect: every capability works today, and the tests are green.

| W6 item | Measured now | Target | Gap |
|---|---|---|---|
| `lib/index.js` size | **1,890 lines** | ≤ 300 (wiring only) | G-A-04, G-A-06, G-A-10 |
| `package.json` `dependencies` on consumed contracts | **absent** | declared | G-C-08 |
| `engines.dsh` range / `manifestVersion` self-check | wide range, unchecked | narrowed + activation self-check | G-C-09, G-C-14 |
| Frozen `SOURCE_KINDS` / `ORIGIN_VALUES` / `SECTION_NAMES` | **none present** | one frozen constant each | G-C-11, G-C-12, G-C-13 |
| `bin/te-dsh.mjs` `identityKey` alias + `doctor` key diff | absent | aliased, probed | G-A-13 |

Two cautions for whoever picks it up, both learned the hard way in this session:

1. **The slim-down is a pure move, so a missed wire is silent.** `lib/identity.js` and
   `lib/settings-api.js` were once delivered-but-unmounted exactly this way. Before declaring W6.A
   done, assert runtime behaviour, not just `wc -l`: the six settings routes must still register and
   `state.identity` must still be populated.
2. **The deprecated reads are not W6 work.** `lib/index.js` keeps `eventAt` (`:1047`, `:1091`) and
   `snapshotEvents` (`:1589`) because 0.2.2-rc.3 ships no replacement reader and the surface exposes
   sequence numbers only. Upstream keeps 22 such calls marked "migration deferred". The audit script
   carries both with a printed justification; do not remove them to make the audit quieter.

## 9. Verification

### 9.1 The test suite

```
$ npm test
ℹ tests 236
ℹ suites 0
ℹ pass 235
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
```

29 test files. Before this refactor the suite was **164 tests / 163 pass / 1 skip / 0 fail**.

The one skip is the opt-in end-to-end engine fixture (`TE_DSH_TEST_HOME` not set).

### 9.2 The gates

```sh
npm test                                        # 236 tests / 235 pass / 1 skip / 0 fail
npm run check                                   # walks lib/, bin/, scripts/
node scripts/audit-deprecations.mjs             # exit 0 with two allowed deprecations
node scripts/audit-deprecations.mjs --json      # machine-readable form
```

`npm run check` now walks `lib/`, `bin/` and `scripts/` instead of naming each file. The old
hardcoded 12-file list **silently skipped new modules** — `identity.js`, `repokey-bridge.js` and
`probes.js` were all added unchecked.

### 9.3 The plugin marker

The plugin now stamps a marker **distinct** from the harness's own
`[... tool result middle pruned ...]`:

```
[... tokeneconomizer: tool result reduced ...]
```

A reader that greps for the harness's marker must not match this plugin's writes.

### 9.4 The documentation gates

```sh
npm run docs:index                              # regenerate every index
(cd dsh-tokeneconomizer && node ../scripts/doc-index-track.mjs)
npm run docs:check                              # headers, stale indexes, broken links
node scripts/check-doc-links.mjs --quiet        # every relative link resolves
```

## 10. Related documents

* [ARCHITECTURE.md](ARCHITECTURE.md) — the bridge's isolation boundary, the lifecycle contract and
  the module map.
* [OPERATIONS.md](OPERATIONS.md) — install, bootstrap, the settings page, the gates and rollback.
* [IN_MEMORY_FEATURES.md](IN_MEMORY_FEATURES.md) — the host-local features, the attribution records
  and the tiering trigger.
* [DSH-SCHEMA-GAP-BRIEF.md](DSH-SCHEMA-GAP-BRIEF.md) — the measured input.
* [DSH-SCHEMA-BLUEPRINT.md](DSH-SCHEMA-BLUEPRINT.md) — the design input.
* [../CHANGELOG.md](../CHANGELOG.md) — the engineering history.
