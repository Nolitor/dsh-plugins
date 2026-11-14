# Changelog — @nolit/dsh-tokeneconomizer

<!-- skeleton:
version: 1.6
kind: report
status: active
updated: 2026-11-15
summary: Engineering history for @nolit/dsh-tokeneconomizer. Seeded from git history on 2026-11-04 when the owner made per-plugin history mandatory (docs/RULES.md 6.1); entries after that date follow the same rule — what changed, why, and the measured before/after.
-->

> History lives here (owner instruction 2026-11-04). Boot cards and `AGENTS.md` are narrowed to
> the owner's unfinished asks; they are not a changelog. See `docs/RULES.md` §6.1 in the
> `dsh-plugins` workspace (workspace-level document; not part of this package).

Current version: `0.0.1-rc.8`

## 0.0.1-rc.8 — three defects the operator found: the version, the model slots, the repository — 2026-11-15

**Why.** The operator restarted the service and reported three symptoms. Each turned out to be a
real defect in what this session shipped, and each was found by measurement, not by reading the
code again.

| Symptom | Actual cause |
|---|---|
| "버전 표시가 0.1.0지?" — the version reads `0.1.0` | The card showed only the **upstream engine's** release tag (`v0.1.0`) under a heading that did not say whose version it was. The plugin's own version (`0.0.1-rc.N`) was not shown at all, so an upstream tag read as the plugin's version. |
| "하나는 계속 저장을 해도 기본값으로 바뀐다" — a saved model reverts to the default | **Three** separate defects, stacked. See below. |
| The saved model never reached the engine | The engine's per-repository config is keyed by the directory it is asked about, and the settings page's engine call passed **no `--cwd`**. The engine therefore used the **host process's** working directory — the web profile's cwd is `~/.dsh` — so a save landed in `repos/deepseek-harness-bbcdb118d8/config.json` while the operator's own repository (`repos/dsh-plugins-4806902e1d/config.json`) kept its old value. |

### The three model-slot defects

**1. The read lookup used a property the slot did not have.** The client's slots declared only
`key` (the WRITE key, `model.microskills`) while the stored value was read as
`modelSlots[slot.label]` — `label` was `undefined`, so **every stored value read as
undefined** and the select showed the deployment default even after the engine had persisted
the choice. The read payload is keyed by the slot's `label` (`microskills`), which is a
different string from its write `key` (`model.microskills`); both are now declared, and the
gate pins the lookup.

**2. The `default` slot was a control with nowhere to put its value.** The engine has **no**
"default model" config key — the deployment's own route is whatever DSH's `agent-default-model`
says. The slot was still a `<select>`: it accepted a value, the client sent it, the server
answered `ok: true` with the value **empty** (there was nowhere to put it), and the select
snapped back to "deployment default" on the next read. It is now a **read-only fact**, and only
the two slots with an engine key are writable.

**3. The write addressed the wrong repository.** Fixed above: `runEngine` now names the
directory explicitly with `--cwd`, and the directory is **this package's own** — the tree the
loader mounted, which is the repository the plugin operates on.

The `--cwd` fix had one trap of its own: `new URL('..', import.meta.url)` already resolves to
the package root, and a `dirname` on top climbs one level too far and would have filed the
configuration under the **workspace** rather than the plugin's repository. The gate pins both
halves.

### The version, stated as two versions

The card now shows **both**, named so they cannot be read as one:

- **플러그인 버전 / Plugin version** — this package's own version, read from its manifest.
  `0.0.1-rc.8`. The numeric part (`0.0.1`) is the owner's; the `rc.<n>` suffix is this
  track's history marker.
- **내장 원본 엔진 버전 (업스트림) / Embedded engine version (upstream)** — the upstream
  project's own release line, which this plugin does not control and does not bump.

### Measured, live, in a real browser

| Fact | Before | After |
|---|---|---|
| Plugin version on the page | not shown | `0.0.1-rc.8`, under its own label |
| Engine version on the page | `v0.1.0` under an unlabelled heading | `v0.1.0+22.g6141bb9`, labelled "(upstream)" |
| Model slots that are controls | 3 (one of them unwritable) | 2 writable + 1 read-only fact |
| A saved model, after a page reload | reverted to the default | **persists** |
| Where a settings write lands | the server's repository | **the plugin's own repository** |

**End-to-end, measured in headless Chromium against the running service**: a save of
`exaone/k-exaone_v2.5` was still selected after a full page reload, and the engine's own config
file carried `microskills_model: "exaone/k-exaone_v2.5"`.

The three regression gates that keep these from coming back:
`REGRESSION GATE: every model slot carries the label the read payload is keyed by`,
`REGRESSION GATE: the default model slot is a fact, never a control`, and
`REGRESSION GATE: the settings engine calls name the repository explicitly`.

### The live engine's patch was also behind

The running engine still carried the **previous** patch, so `te config set microskills_model`
was refused with `unknown key 'microskills_model'` — the setting could not be saved at all.
`scripts/bootstrap.mjs --refresh` re-applied the pinned patch to the live vendored tree; the
engine's own state (`repos/`, `identities/`, `sessions/`, `errors.log`) was untouched by it,
and the wrong-repository config written by defect 3 was restored by hand.

### The documentation was brought to the current version

Measured 2026-11-15: the track owned **16** documents, and the new work had reached only two of
them (`OPERATIONS.md` and `README.md`). The rest still described `0.0.1-rc.5` / `rc.6`. The
question "is there a specification, a configuration reference and a developer document?" was
answered by measurement, not by assumption — **all three kinds existed**, and all three were
stale in specific ways.

| Document | Kind | What it said before | What it says now |
|---|---|---|---|
| `ARCHITECTURE.md` | spec | the module map's line counts were wrong and `lib/upstream.js` did not exist | every count re-measured, the new module added, and a new §2b for the engine identity, the model slots, the manifest self-check, the doctor and the `--cwd` rule |
| `DSH-SCHEMA-IMPLEMENTATION.md` | report | "the six settings routes"; the client described as **two** `settings.section` seats | "the eight settings routes"; the client is **one** seat with two internal tabs; a new §6.7 for what shipped; §8 now states explicitly that the upstream check and the slots **are** shipped rather than deferred |
| `IN_MEMORY_FEATURES.md` | spec | documented **30** of the plugin's **36** configuration keys | all 36, split into §7.1 (the host-local levers this document owns) and §7.2 (the six that select the engine), because one flat table of 36 would blur which keys the document is about |
| `OPERATIONS.md` | spec | the routes, the slots and the `--cwd` rule | extended with §5.3b and the read-only default slot |
| `README.md` / `README.ko.md` | readme | the Korean edition had no `환경설정` description at all | both editions carry the two versions, the upstream check and the model slots |
| `FEATURE-SUMMARY.md` | index | the version table stopped at `rc.6` | the table runs to `rc.8`, with the two versions and the slots |
| `HANDOFF.md` | report | described `0.0.1-rc.5` and a restart that had not happened | the current state, the three defects and their fixes, and what remains open |
| **`DEVELOPER-GUIDE.md`** | spec | **did not exist** | **new** — the three surfaces a developer touches, the contract between them, the patch-regeneration procedure and its two traps, the gates, and the rules that bite |

`DSH-SCHEMA-BLUEPRINT.md` and `DSH-SCHEMA-GAP-BRIEF.md` keep their `rc.5` / `rc.6` figures on
purpose: they are the **design and audit snapshots** of those days, and rewriting their pinned
versions would destroy the audit trail.

**Three stale facts found while cross-checking the documents against the code**, all corrected:
the module map's line counts (`lib/index.js` 1699 → 2086 and eleven others), the client's seat
count (two → one), and the `import/:jobId` route form (the engine has no `:param` segment — the
job id travels as `?jobId=`). Two further stale line citations survived in the **code** and were
fixed there too: `scripts/audit-deprecations.mjs` printed `lib/index.js:1047, :1091` and `:1589`
for seams that now live at `:1359`, `:1403` and `:1909`, and `lib/upstream.js` carried a comment
saying the pin was "110 ahead" where the live figure is 187.

## 0.0.1-rc.7 — upstream version check, side-call model slots, and the W6 boundary — 2026-11-15

**Why.** Four gaps, measured rather than assumed.

1. **The settings page could not answer "which engine am I running?"** The embedded engine has
   no version string of its own — measured: no `__version__`, no `VERSION` file, and `te --version`
   is not even a valid invocation (the CLI requires a subcommand). The engine is identified by the
   upstream commit `scripts/bootstrap.mjs` pinned and patched, and nothing on the page said so.
2. **The side calls could not be pointed at a cheaper model.** The Micro-skills proposer and the
   Loop Guard judge are the two LLM calls the engine makes per session. Both were hard-wired to
   the deployment's own route, so the one lever that actually lowers the cost of running this
   plugin did not exist.
3. **The shipped patch was not reproducible.** The patch's `sidecall.py` hunk header had been
   hand-edited to `@@ -344,4 +393,6 @@`; the true regenerated value is `@@ -344,4 +408,6 @@`.
   The tree it produced was correct, so nothing failed — but the patch could no longer be
   regenerated from its own source, which is the property that makes it auditable.
4. **`doctor` reported no configuration at all.** It answered whether the installation was in
   place (7 operational keys) and nothing about the 36 settings the plugin actually supports.

### What changed

**The engine's identity is now on the page** (`lib/upstream.js`, new). The version shown is the
one upstream publishes for the pinned commit — `v0.1.0+22.g6141bb9` for the measured tree — and
the pinned commit's short id sits beside it.

**The upstream check is a route, not a guess** (`GET /api/local/tokeneconomizer/settings/upstream-check`).
It compares the pinned commit with the upstream branch head, the latest release and the commit
distance, and reports the changed files. Every failure mode is a value: an unreachable network, a
GitHub rate limit, a timeout and an unreadable answer all answer `ok: false` with the reason in
`errors`. **`updateAvailable` is `null` when the question could not be answered — never `true`.**
An out-of-date claim that turns out to be a network problem teaches the reader to ignore the
button, and the next real update goes unnoticed.

**Two bugs found by measuring the live upstream, and fixed.** The first run against
`api.github.com` answered "the upstream branch head is **0** commit(s) ahead" while the head had
actually moved **187** commits past the pin: the compare API's `behind_by` counts the commits the
**pin** has and the head does not, so the number an operator reads — how far the HEAD is ahead —
is `ahead_by`. Reading `behind_by` would have reported "the pin is current" on every run, which
is the one answer that makes the button useless. The second: `git describe --tags` **fails** on
the vendored checkout, because a filtered clone of one commit carries no tags — so the version
label was `unknown` on exactly the tree the page is about. It now falls back to the short commit
id (`unreleased+6141bb92`), which is the truthful identity: the commit names the exact engine.

**The side-call model slots are real** (`settings-contract.js`, `settings-api.js`, `client.js`).
Three slots — `model.default`, `model.microskills`, `model.loopguard` — write the engine's own
new config keys `microskills_model` and `loopguard_model`. The value is a `provider/model` pair
(`deepseek-account/deepseek-flash`), because DSH routes by provider and a model id alone belongs
to one. The list of choices is the **host's own LLM registry** (`ctx.llm.listProviders()` and
`ctx.llm.listModels(provider)`), so it names only routes this deployment can actually take; a
deployment with no registry answers an empty list and the page says so.

The engine side carries the model to the call through the `--patch` overlay it already writes for
the throwaway session store: one extra `agent-default-model` row, so the call runs on that
provider/model **for that call only**. Measured end to end: the patched engine writes

```yaml
- id: agent-default-model
  config:
    provider: "deepseek-account"
    model: "deepseek-flash"
```

and real `dsh --profile headless --patch <overlay> --dump-config` composes it as
`{provider: deepseek-account, model: deepseek-flash}`.

**The slot labels are namespaced with `model.`** — a correction of a bug found while building
this. The engine's `microskills` key is the **mode** (`envfacts+distiller`), and the model slot
for the same mechanism is a different setting. Both travel in one `set` object on the write path,
so an unnamespaced slot named `microskills` would have been two different settings under one key:
the mode select would have written the model key. `test/upstream-models.test.mjs` pins it.

**The patch is reproducible again.** It is regenerated from the pinned upstream commit with
`git apply` → edit → `git add -N` → `git diff`, and the hunk header is the regenerated one. The
engine tree carries the two new config keys, the `provider/model` parser, the slot-aware
`runner_for`, and the engine's own tests for all of it.

**`doctor` now answers three questions.** The install (unchanged), the **manifest** (the package's
own `dsh.manifestVersion` against the one this build understands — the host does not enforce it:
measured, the installed `dsh-package-manifest` README says "Current installers and loaders do
not enforce `dsh.manifestVersion` or `engines.dsh`"), the **configuration** (all 36 keys, their
defaults, their current values, and which are overridden), and the **identity** (the engine's
repository key for this directory against the keys the engine actually holds under `repos/`).

**The plugin checks its own manifest version at activation** (`checkManifestVersion`). A mismatch
**warns and degrades**; it never throws, because a throw inside `apply()` costs the entire
plugin and a cost optimizer must not be the reason a session breaks.

### Measured

| Fact | Before | After |
|---|---|---|
| Engine identity on the settings page | absent | version + pinned commit + upstream comparison |
| Side-call model slots | none | 3 slots, 2 engine config keys, host-registry choices |
| Engine patch reproducibility | hand-edited hunk header | regenerated; `git apply` → `git diff` round-trips |
| `doctor` sections | 1 (install) | 4 (install, manifest, config, identity) |
| `doctor` config coverage | 0 of 36 keys | 36 of 36 keys, with defaults and overrides |
| Settings routes | 6 | 8 |
| Plugin tests | 251 | 256 (18 new in `test/upstream-models.test.mjs`) |
| Engine tests | 411 | 419 passed, 1 skipped (8 new) |

**Engine suite, measured in the regenerated tree:** `419 passed, 1 skipped in 7.18s`.

**Live upstream, measured 2026-11-15:** the pinned commit `6141bb92` is **187 commits behind**
the upstream branch head `7042ea89`; the latest release is `v0.1.0`; 110 files differ. The
installed engine still runs the **previous** patch — the new one is applied and verified in an
isolated state root (`/tmp/te-iso`), and re-bootstrapping the live one is an operator action
that writes the user's live state.

**Live engine, measured 2026-11-15 (`te status`):** `microskills=envfacts+distiller
toolprune=propose loopguard=nudge repomap=off mode=auto shadow=False` — 95 folded sessions,
435.5M effective tokens, plugin overhead 3.3M (0.7%), 8 facts injected at session start, 81
sessions observed for tool pruning, 4 loop-guard redirects over 465 turns.

**Live UI, measured 2026-11-15 in headless Chromium against the running `dsh-web.service`:**
the `토큰절약기` settings section renders, and the `환경설정` tab paints five cards —
`내장 원본 엔진` (Embedded engine), `모드` (Mode), `사이드콜 모델 설정` (Side-call models),
`임계값` (Thresholds), `동작` (Actions) — with the two tabs `환경설정` / `통계`, the
`업스트림 버전 확인` button, and the three model slots
(`model.default`, `model.microskills`, `model.loopguard`) as `<select>` elements.

**The live server still answers 404 for the two new routes**, and the engine card shows `—`,
because the running `dsh-web.service` booted at 03:35 — before this session's changes. The
**client** half was picked up without a restart (the host's HMR rebuilt the bundle), but the
**server** half (the routes and the engine identity) needs a restart to take effect. Restarting
the user's live service is not this session's call.

The routes were verified end to end in a **mounted, isolated** DSH instance (a copy of the web
profile on port 3202, `TOKENECONOMIZER_HOME` pointed at an isolated state root carrying the new
patch): `GET /settings/upstream-check` → `ok: true`, version `unreleased+6141bb92`, 187 commits
behind, latest release `v0.1.0`; `GET /settings/models` → `ok: true`, provider
`deepseek-account`; `GET /settings` → `modelSlots` present; and a write of
`model.microskills = deepseek-account/deepseek-flash` persisted and was confirmed by the
engine's own re-read.

## 0.0.1-rc.6 — DSH schema alignment and settings GUI — 2026-11-15

**Why.** The 2026-11-14 schema gap brief measured 42 gaps between this plugin and the installed DSH
`0.2.2-rc.3` core schema. Three were **blocker** grade, and each one was a silent failure rather
than a crash: the plugin kept mounting, kept reporting, and kept doing the wrong thing.

| Gap | What was actually broken |
|---|---|
| `G-A-01` | DSH has **no project or repository entity** in its session store. The plugin's per-repository partition had **no DSH-side durable anchor** — every key was re-derived by re-running git discovery, and a mismatch silently created a new bucket instead of erroring. |
| `G-B-01` | The plugin wrote the **byte-identical** `compaction/prune` + `tool/result`-replace pair as the harness's own `dsh-compaction-tool-result-pruner`, and `compaction/prune` carries **no producer field**. The two were indistinguishable in the log — a measurement once credited the harness's 179 rewrites to this plugin. |
| `G-C-01` | The headline token-saving feature (tiering) rode on **`agent/request`**, which upstream has deprecated. Tiering would stop entirely, while the plugin still mounted and still reported turns. |

**What.** Three blockers closed, the module map split into named layers, and a settings page that
makes the three mechanisms tunable without editing a package.

### The three blockers closed

**`G-A-01` — the project identity anchor.** `lib/identity.js` introduces the two-value identity
model. `projectDir` is the **immutable** anchor taken from the session header (the harness header
"retains the original project"); `liveDir` is the directory in force right now, taken from
`working-directory/change`. Conflating the two was the bug. Resolution is a precedence, not a
guess: a record already persisted for this project wins verbatim, otherwise the anchor is derived
from the git remote, else from the checkout path, else from the directory itself. A header with no
`cwd` is **unanchored** — no key is minted and nothing throws. `IDENTITY_SCHEMA_VERSION = 1`;
`readIdentity` / `writeIdentity` persist under `<state root>/identities/<key>.json`;
`adoptLegacyKey` records that a legacy engine key belongs to an identity.

**`G-B-01` — attribution records.** Three plugin record types now go through DSH's
`appendPluginRecord`:

| Record type | Payload |
|---|---|
| `plugin:tokeneconomizer/surface-rewrite` | `{ nodeSeq, tier, charsBefore, charsAfter, shadowTokens, reason }` |
| `plugin:tokeneconomizer/tier-decision` | `{ nodeSeq, tier, turn, step, policyHash, reason }` |
| `plugin:tokeneconomizer/toolprune-applied` | `{ tools, countBefore, countAfter, visibleIntersection, proposalId?, repoKey, time }` |

Records and not event types, because a record is `ignorable` and **never enters the model-visible
surface** — zero token cost — and survives fork and resume. The plugin event space is closed
anyway: the harness owns the event-type grammar.

**`G-C-01` — the trigger.** Tiering moved off `agent/request` onto **`agent/pre-step`**, with a
`session/event` (`step/start`) fallback. `chooseTrigger()` never returns `agent/request`. The
honest consequence, stated rather than hidden: `agent/request` ran *after* request assembly, and
`agent/pre-step` runs at *step preparation*, so **a rewrite may land one step later**. It still
saves tokens on every subsequent step of the turn.

### The new modules

| Module | Lines | Role |
|---|---|---|
| `lib/identity.js` | 314 | the two-value project identity model |
| `lib/repokey-bridge.js` | 37 | the legacy engine repo key, used only by the adoption procedure; **UNVERIFIABLE** against the engine |
| `lib/probes.js` | 404 | capability-probe catalog — 7 seams, contract-tier vs internal-tier |
| `lib/attribution.js` | 220 | the record layer: `appendRecord`, `readRecords`, `recordsOfType`, `validateRecord` |
| `lib/rewriter.js` | 295 | surface composition: `validateRewriteTarget`, `buildReplacement`, `buildPrunePayload`, `composeRewrite` |
| `lib/surface-attribution.js` | 248 | the paired write: `applyRewrite` — validate → decision → prune → replace → rewrite record |
| `lib/settings-contract.js` | 69 | browser-safe frozen contract data (zero imports) |
| `lib/settings-api.js` | 691 | the six settings routes |
| `lib/types/records.d.ts` | 80 | `PluginRecordMap` augmentation |
| `scripts/audit-deprecations.mjs` | 327 | the deprecation gate (exit 0/1/2) |
| `scripts/check-syntax.mjs` | 62 | walks `lib/`, `bin/`, `scripts/` |

**`Session` has no `appendPluginRecord` method.** The record API is a *module export*,
`appendPluginRecord(session, type, data)`, resolved through `ctx.get('session')` — the same lookup
`lib/probes.js` already performs, so no harness package is imported.

### The settings page

A second `settings.section` seat, `tokeneconomizer-settings` (order 63), titled
`토큰절약기 · 환경설정`, beside the existing read-only `tokeneconomizer-devstats` card (order 62).

Six routes: `GET /settings`, `POST /settings/config` (batched, per-key results), `POST /settings/restore`,
`POST /settings/reset`, `POST /settings/import` (202 + job id), `GET /settings/import/:jobId`.

Controls: three mode selects (`microskills` off/envfacts/envfacts+distiller/distiller; `toolprune`
off/propose/auto; `loopguard` off/nudge/stop — `on` is a **write alias, never a stored value**), the
nine numeric thresholds with the default/override/effective distinction and a per-key reset,
`toolprune restore`, reset-to-defaults, history import, and a judge-unavailable banner.

**`history_import` is not an engine key** — a whole-engine grep finds zero hits. It maps to
`bin/te-dsh.mjs cold-start`.

Engine writes go through the `child_process` boundary (`te config set`), **never** a direct file
write, and every write **re-reads `te config show` before responding**: the answer carries the
persisted value, never the posted one.

The client half **cannot import** `settings-contract.js` — the loader exposes a fixed module table
and `lib/client.js` must carry no `import` statements. It mirrors the constants as literals with a
comment naming the source of truth, and a drift test binds the inline `SETTINGS_I18N` table to
`locale/*.json`.

### The deprecation gate

`scripts/audit-deprecations.mjs` reads the installed DSH type declarations and checks the seams
this plugin consumes. Exit `0` (all present, none newly deprecated), `1` (a seam missing or
deprecated without acknowledgement), `2` (no DSH install root).

Two seams carry `allowDeprecated: true` **with a printed justification**, and the FAIL branch still
bites for any non-allowed seam:

| Site | Status |
|---|---|
| `lib/index.js:928` | **migrated** → `session.seq > 0` |
| `lib/index.js:1047`, `:1091` | keeps `session.eventAt` — no replacement exists in 0.2.2-rc.3 |
| `lib/index.js:1589` | keeps `session.snapshotEvents` — needs the full durable log including shadowed events |
| `deriveMessages` | not deprecated — untouched |

This mirrors upstream's own stance: **22** upstream `.eventAt(...)` call sites are annotated
`// Existing Session history read; migration deferred.`, and `dsh-compaction-basic` keeps live
`eventAt` calls marked exactly that way. The deprecation's referenced Agent Note is **not shipped
in the install**, so the migration plan it may carry is **UNVERIFIABLE** from this host.

**Phantom-API finding.** `session.surface.readEvent` **does not exist**. `SessionSurface` exposes
only `nodes` (sequence numbers), `replaceGeneration` and `contentGeneration`. Any design that
assumed an event-body read through the surface was wrong: a caller must supply the event or a
reader.

### The three mechanisms, now real

| Mechanism | What changed |
|---|---|
| **micro-skills** | engine-synthesized facts injected as `systemPrompt.context()` — a durable user-role snapshot, never a byte-changing section |
| **tool pruning** | the proposal is intersected with the visible tool set and applied via `tools.restrict({ deny })` on the agent scope, evidenced by a `toolprune-applied` record. Measured before this work: `untool_applied` was `[]` across **all 1149** ledger records — the lever had never applied |
| **failure-loop** | envelope + judge, with a **degraded no-judge path** marked in the record's `reason`. Measured: the judge cannot run — `errors.log` ends with `sidecall dsh: no reply (exit 1) ACCOUNT_SIGN_IN_REQUIRED` |

### Also fixed

- `scripts/check-syntax.mjs` replaced a hardcoded 12-file `check` script that **silently skipped new
  modules** — `identity.js`, `repokey-bridge.js` and `probes.js` were all added unchecked.
- The plugin now stamps a marker **distinct** from the harness's `[... tool result middle pruned ...]`.

### Measured before → after

| | before | after |
|---|---|---|
| tests | 164 | **236** |
| pass | 163 | **235** |
| fail | 0 | **0** |
| skipped | 1 | 1 |
| test files | — | **29** |

### Integration, settings UI, and live verification — same session, after the module work

The modules above were first delivered **unmounted**, and that was a defect in how the work was
split, not a scoping decision. Both cut-overs and the settings UI were completed in the same
session.

**Identity is mounted.** `lib/index.js` resolves each session through `resolveSessionIdentity()`;
the legacy engine key still wins when its bucket exists, and the identity key is persisted beside
it. Measured against the 31 existing buckets: **11 of 11 resolvable checkouts produce an identity
key identical to the legacy one**, so adoption is a no-op in practice rather than a re-partition.

**The settings routes are mounted.** `mountSettings()` registers six routes. Three defects had to be
fixed to get there, each found by running it rather than by reading it:

| Defect | Symptom | Fix |
|---|---|---|
| the launcher drops the exit code | `te config set` succeeded, the route answered **400**, and the value still persisted | `runText()` keeps exit code + stdout + stderr; the normalizer reads the code, not the shape of stdout |
| `:jobId` path parameter | `connection: invalid exact Fetch route` — the route silently never registered | the job id travels as `?jobId=`; DSH accepts only `[A-Za-z0-9_$.-]+` per segment |
| two registrations for one path | `connection: exact Fetch route ... is already registered` | handlers are grouped by path and registered once with a `methods` set |

**The settings page is interactive.** Alongside the read-only statistics card there is
`토큰절약기 · 환경설정`: mode selects, the nine engine thresholds with default/override/effective
distinction and per-key reset, `toolprune restore`, reset-to-defaults, history import, and a
degraded-judge banner. Every write re-reads `te config show` before answering, so the screen never
shows a value the engine has not confirmed.

**Both pages are one navigation row.** Two `settings.section` entries meant two sidebar rows for
one product surface; they are now a single `토큰절약기` row with internal `환경설정 | 통계` tabs.
The statistics tab leads with what was **saved** — total characters removed, the rate against the
session's context, and a per-lever share — because a column of raw counters answers "what happened",
never "did this help".

**The section now matches the host, not just the tokens.** Measured against this repository's own
`dsh-custom-router` settings section, three differences were found and closed: the section had its
own `max-width` and centring (the shell's `.options` column already owns both), cards were bordered
boxes rather than padded hairline rows, and the tab styling copied `.crTab` (an in-panel tab) rather
than `.crSettingsTab` (the settings tab: 13px, `7px 1px 9px`, `::after` underline). The title and
intro were also a nested wrapper where the reference makes them siblings. After the fix the two
sections agree on every measured value, including element coordinates.

### What was NOT done

| Not done | Why |
|---|---|
| **Wave 6** — `lib/index.js` is 1,890 lines rather than ≤300, `dependencies` on the consumed contracts are undeclared, and `SOURCE_KINDS` / `ORIGIN_VALUES` / `SECTION_NAMES` are bare literals | structural debt, not a defect: every capability works and the suite is green. `docs/DSH-SCHEMA-IMPLEMENTATION.md` §8a records the measured starting point for whoever picks it up |
| the deprecated reads were not migrated | no replacement reader exists in 0.2.2-rc.3; upstream keeps 22 such calls marked "migration deferred". Both are allowed **with a printed justification** in `scripts/audit-deprecations.mjs` |
| the judge was not fixed | it fails on the operator's account authentication, which is the user's credential state, not a plugin defect |

### Documentation

- `docs/DSH-SCHEMA-IMPLEMENTATION.md` — **new**: the implementation record for this refactor.
- `docs/ARCHITECTURE.md` → 1.5, `docs/OPERATIONS.md` → 1.5, `docs/IN_MEMORY_FEATURES.md` → 1.4,
  `README.md` → 1.6.

## 0.0.1-rc.5 — subagent gate narrowed to the engine path — 2026-11-14

**Why.** The `agent/created` handler returned early for every delegated child
(`agent.session.header.origin === 'subagent'`), so a subagent session got **nothing**: no engine
path, and no in-memory levers either. Measured on the live corpus, **201 of the last 333 session
logs (60%)** were subagents — so more than half of all sessions had **no saving lever at all**.
The child burns the same model context, calls the same tools, produces the same repeated or stale
tool output as a root session, and **its bill lands on the parent**. Not mounting the levers in a
child never saved the parent a token; it only removed the parent's ability to see the waste.

**What.** The gate was narrowed from *"a subagent gets nothing"* to *"a subagent gets the engine
path only"*. Behind the one `agent/created` there are now **two paths of different kinds**, and
only one of them is root-only.

| Path | What it covers | Root only? | Why |
|---|---|---|---|
| **Engine path** | `SessionStart` / `UserPromptSubmit` / `PostToolUse` / `Stop` / `SessionEnd` hooks, the Python engine behind them, the session export and its fold, the ledger | **yes** | a delegated child is folded with its parent's work, so its own envelope would count its turns twice and teach the loop guard a turn scale no person runs |
| **Memory path** | tool-result dedup, tiered memory, loop breaker, thinking watchdog, KV-cache-safe prefix guard, pinned section | **no — every session** | no engine call, no file write, `node:` builtins and timers only; a child burns the same context and its bill lands on the parent |

**New config key `subagentMemory`** (default `true`). `false` restores the old behaviour: a child
mounts no state and no listeners at all. Declared in both `lib/index.js` `DEFAULTS` and
`cordis.patch.yml`.

**Side effects of the split:**

- `rootSessionsView()` (`lib/index.js:201`) — a new read-only view of the session map that
  exposes **only root sessions**, handed to the devstats route. Without it a delegated child would
  appear as a *sibling* session of its parent, and its turns and tokens would be counted as if a
  person had run them — the same double count the engine path removes. The child still lives in
  the real map and still gets every memory lever; it is only hidden from the camera.
- `writeSession()` returns `''` for a subagent → a child writes **no** export file, because a
  separate child transcript under `dsh-sessions/` would make the fold count its turns twice.
- `finish()` drops a subagent's state **without** a `SessionEnd` hook and without the fold that
  hook triggers.
- `start()` and every engine call site now check `state.engineEnabled` explicitly, so the
  invariant *"a subagent makes zero engine calls"* is held at the engine entry point and not only
  at its call site. Prior-session recall joined the engine path for the same reason: a child
  repeats its parent's first prompt, so recalling there would inject the same block twice.

**Measured before → after**

| | before | after |
|---|---|---|
| tests | 156 | **164** |
| pass | 155 | **163** |
| fail | 0 | **0** |
| skipped | 1 | 1 |

**How it was verified.** Mutation testing confirms the assertions actually bite: removing the
gate fails **4** tests, removing the `finish()` gate fails **1**, and leaving `subagentMemory`
unread fails **1**. "Zero engine calls" is proven with a counting launcher — over a child's whole
lifecycle (`SessionStart` → `SessionEnd`) it spawns **0** `te` / `te-hook` processes and writes
**no** file under `dsh-sessions/`. The positive control confirms the counter does count: a root
session shows `te` once and `SessionStart` / `UserPromptSubmit` / `Stop` in the `te-hook` log.

**Live state: `applied pending restart`.** The `dsh-web` service started at **2026-11-14
09:37:14 KST** (`systemctl --user show dsh-web.service -p ExecMainStartTimestamp`) and the code
was changed at **21:24:15 KST** (file mtime). The owner was in the middle of other work, so the
service was **not restarted**: the running process still holds the old behaviour, and a restart is
required before any live measurement reflects this change.

**Documentation.** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) §3.1 now describes the split (the
old "subagent sessions are skipped" paragraph was wrong);
[docs/REFACTORING.md](docs/REFACTORING.md) §2.2 is marked **Resolved 2026-11-14** with the
analysis kept as history; [docs/TOKEN-ECONOMIZER-SAVING-MEASUREMENT.md](docs/TOKEN-ECONOMIZER-SAVING-MEASUREMENT.md)
keeps its 2026-11-02 figures but drops the vanished line number and points at the current state;
[docs/AUDIT-2026-11-14.md](docs/AUDIT-2026-11-14.md) gains **§10**, which records the fix without
rewriting the audit's own observations.

## 0.0.1-rc.4 — measurement correction, audit, and documentation alignment — 2026-11-14

**Why.** The token-saving measurement script counted rewrites by the **presence of the harness
pruner's marker string** in a tool result. That string is also quoted verbatim by the user's own
`grep`/`bash` output, so the count was polluted in both directions at once: it invented activity
that never happened and it missed the rewrites that did. The audit of 2026-11-14
([docs/AUDIT-2026-11-14.md](docs/AUDIT-2026-11-14.md)) established that the script had been
**under-reporting this plugin's real saving by 88.6%**, and that a naive structural count
over-reports it by 9.6% unless the harness's own pruner is attributed out.

**Measured before → after**

| Measurement | Before (marker-based) | After (structural + attribution) |
|---|---|---|
| Structural rewrites of the tool-result corpus | **235** reported | **2,052** measured structurally |
| …of which this plugin's tiering (warm 1,829 + cold 44) | (not separable) | **1,873** |
| …of which the harness's own tool-result pruner | (counted as ours) | **179** — excluded, not this plugin's work |
| Marker mentions with no rewrite record (grep/bash echo) | counted as savings | **62** — demoted to a reference indicator |
| Recent activity windows | not measured | 24h **131** rewrites, 7d **632** rewrites |

The four top-line figures (235, 2,052, 1,873, 179) are stable and reproducible. The corpus itself
grows while sessions run, so the tool-result denominator and the echo subset drift by tens of
percent between runs; both are reported by the script rather than pinned here.

The three-step correction is the reusable lesson, and it is now written down in the audit:

| Step | Aggregation | Result | Error |
|---|---|---|---|
| 1 (old) | marker string containment | 235 | **-88.6%** (under-report) |
| 2 (intermediate) | every `surfaceOp.op === 'replace'` | 2,052 | **+9.6%** (over-report; harness's 179 included) |
| 3 (current) | `surfaceOp` + body attribution | **1,873** | exact |

Step 2 was possible to get wrong because `@deepseek-ai/dsh-compaction-tool-result-pruner` writes
the **same** `surfaceOp: { op: 'replace', startSeq, endSeq }` + `sourceEventSeqs` shape as this
plugin's tiering. Only the replacement body separates them. The 1,873 / 179 split was verified by
**two independent implementations** that reached the same numbers.

**What changed** (files):

- `scripts/measure-token-saving.mjs` — aggregation switched from marker containment to the
  event's **structure** (`surfaceOp.op === 'replace'` on a `tool/result`), with attribution by
  replacement-body prefix separating this plugin's warm/cold tiers from the harness pruner;
  `compaction/prune` demoted to a log-only shadow-price record; 24h / 7d activity windows added;
  cache-read share and the duplicate-token figure explicitly labelled as **not** a saving.
- `test/measure-token-saving.test.mjs` — new regression test for the corrected aggregation.
- `docs/AUDIT-2026-11-14.md` — new. Read-only audit of three axes (DSH schema fit, real token
  saving, settings-tab registration), the 15 documented-vs-actual mismatches, and the
  measurement-methodology correction above.
- `docs/ARCHITECTURE.md` — `openAt: never` corrected: the **shipped base default** is `never`, the
  live profile mounts `openAt: startup` with an explicit path. DSH version reference corrected to
  the installed `0.2.2-rc.3`.
- `docs/IN_MEMORY_FEATURES.md` — DSH version reference corrected to `0.2.2-rc.3`; test count
  corrected.
- `docs/OPERATIONS.md` — "This plugin registers none [tools/routes]" corrected: it registers no
  tool and no model-facing route, but it **does** register the read-only host route
  `POST /api/local/tokeneconomizer/devstats`. Test count corrected.
- `docs/HANDOFF.md` — version references corrected to rc.3/rc.4; the "`CHANGELOG.md` is absent from
  `files[]`" finding corrected — `files[]` **does** carry it and `test/package.test.mjs` pins it;
  test count corrected to 156 / 155 / 0 fail / 1 skip.
- `docs/REFACTORING.md` — the "`config.watchdog` never read, 0 reads" section marked **superseded**
  (`lib/index.js:579` reads it); the "tierHotTurns is documented as 5" row removed as a **false**
  finding (both tables say 6); `index.js:500` → `:488`; locale key count 66 → **65** (en and ko).
- `docs/TOKEN-ECONOMIZER-SAVING-MEASUREMENT.md` — hot tier "newest 5" → **6**; `index.js:557-561` →
  `:668`; `index.js:408` → `:488`; a pointer added to the 2026-11-14 audit (the corpus figures in
  this document are the 2026-11-02 reading and describe a different corpus).
- `README.md` — skeleton header added, rewritten in **English**.
- `README.ko.md` — skeleton header added, Korean content kept.
- `package.json`, `market/index.json` — version `0.0.1-rc.3` → **`0.0.1-rc.4`** (the `rc` suffix is
  the agent-managed history marker per global `AGENTS.md` §6; the numeric part is unchanged).
- `test/package.test.mjs` — the version pin updated to `rc.4`. This test is **designed** to fail
  on an rc bump ("pinned rather than left to review" per its own comment): it guards the numeric
  part against silent changes and forces an rc range bump to be an explicit, reviewed edit. The
  numeric part `0.0.1` is unchanged.

**Verification.** `npm test` → **156 tests / 155 pass / 0 fail / 1 skipped** (the skip is the
pre-existing opt-in engine fixture, `TE_DSH_TEST_HOME` not set).

## 0.0.1-rc.2 (cont.) — border fallback — 2026-11-11

Owner correction, measured against the upstream authority
[`docs/web-styling.md`](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/web-styling.md):

> Flat borders and separators that use a neutral `--dsw-alias-border-*` token draw at `0.5px` …
> Dashed affordances and **state-colored borders keep 1px**.

The previous entry replaced `.5px` with `var(--dsh-hairline-width,1px)`. The token itself is real —
`@deepseek-ai/dsh-client-ui-theme` publishes it on the document root and resolves it to
`max(1, floor(0.5*dpr))/dpr` — but **its fallback in the shipped host bundle is `.5px`, not
`1px`** (`dsh-web-frontend` declares `var(--dsh-hairline-width, .5px)`), and the upstream styling
reference never mentions the token at all. With a `1px` fallback the border painted twice as thick
whenever the token was not injected (headless capture, non-window documents, test harnesses).

**Corrected in this package:** every `--dsh-hairline-width` use, including the dense table's row
rules, now carries the host's own `.5px` fallback instead of `1px` — **7 occurrences**.

The `.5px` regression gate was narrowed to a bare literal so it still rejects a hand-written
literal while accepting the token fallback.

## 0.0.1-rc.2 — hairline token, CJK wrapping — 2026-11-11

Owner task: the four plugin UI surfaces must stop hardcoding the hairline and must not break
Korean words mid-word.

**Measured, from the shipped source (before → after):** `.5px` literals in `lib/client.js`
**7 → 0**; `word-break:keep-all` on the root `.tkdsSection` absent → present.

Every border now reads `var(--dsh-hairline-width,1px) solid var(--dsw-*)`, including the dense
table's row rules. The token is published on the document root by
`@deepseek-ai/dsh-client-ui-theme`, which resolves it to `max(1, floor(0.5 * dpr)) / dpr` —
the literal ignored that on every display. `test/client.test.mjs` gained a regression gate that
fails the suite if a `.5px` literal or a missing `keep-all` returns.

## test harness — integration test owns a throwaway DSH_HOME — 2026-11-05

**Owner task (2026-11-05): CLI/test DSH_HOME isolation.** The TokenEconomizer engine spawns
`dsh --profile headless` for side calls, so a test that lets it inherit the process environment can
persist a session into the live home under `cwd = /tmp/te-*` — one of the sources of the sidebar
orphan flood. The engine's own patch already re-roots session persistence per side call; this
change closes the harness half.

| Surface | Before | After |
| :--- | :--- | :--- |
| `test/integration.test.mjs` env | `{ ...process.env, TOKENECONOMIZER_HOME: home }`; `DSH_HOME` unset → default live home | temp `DSH_HOME` + `TOKENECONOMIZER_HOME` per run, explicit `DSH_HOME` in the engine spawn env, both env vars restored and the temp home removed in `t.after` |
| `test/tiering-mount.test.mjs` | applied the plugin with the default state root: the session export on `agent/created` tried to write the live `~/.tokeneconomizer/dsh-sessions/` — **2 tests failed** with `EROFS` in the sandbox (a live write outside it) | each test gets a per-test temp `stateHome` and removes it in `t.after`; **2 failed → 0 failed** |
| Repo guard | `scripts/check-dsh-isolation.mjs` reported `engine-spawn-without-DSH_HOME` at the integration test | guard reports **0 violations** |
| Live state after the suite | — | `~/.dsh/sessions` count unchanged (**120**), no new files written under `~/.tokeneconomizer` by the tests |
| Tests | 129 pass / 2 fail / 1 skipped | **131 pass / 0 fail / 1 skipped** |

No plugin code changed. Policy and the guard: `docs/DSH-HOME-ISOLATION.md` in the `dsh-plugins` workspace (workspace-level document; not part of this package).

## Seeded history (from git, before this file existed)

The commits below predate this file. They are the record of what shipped, quoted from the
repository history rather than rewritten:

- `e709ec3` umbrella model-API plugin and DSH-native tiering fix
- `64c9c2a` feat(watchdog): tool-call budget, interrupt recorded before cancel
- `d1547b9` feat(tokeneconomizer): raise `tierMinChars` to 3700 from the measured floor
- `ebc4aa5` feat(command-skill): contract authority, watchdog self-reset fix
- `5fba56a` feat(tokeneconomizer): external settings file + six-turn hot window
- `41c6c6f` docs: alpha.3 plugin verification + typography standard

## Entries after 2026-11-04

Add newest first. Each entry: what changed, why, and the measured before/after. A change with no
entry here is not complete.

### 2026-11-08 — developer-statistics card redesign (Web UI)

**Why.** The statistics card added on 2026-11-05 rendered, but it did not follow the DSH settings
surface rules: it stretched across the pane, its heading levels were wrong for its seat, the
stylesheet was keyed by an element id the host does not own, the per-turn table had no scroll frame,
the controls had no focus ring, and the session picker showed an 8-character id prefix. The
English locale file also carried the Korean display title, so the English plugin inventory showed a
Korean plugin name.

**What changed** (files):

- `lib/client.js` — the card's own stylesheet and markup: a `720px` centred section width, an `h2`
  section title and `h3` card titles sized from the DSH content-font tokens, the stylesheet keyed
  by `data-plugin-css="@nolit/dsh-tokeneconomizer"`, a `280px` scroll frame with a sticky table
  header and `scope="col"` on every column header, a `:focus-visible` ring from the DSH focus
  tokens on the select and the buttons, a `prefers-reduced-motion: reduce` rule that drops the
  decorative transitions, a narrow-pane (`max-width: 640px`) density pass, and a `sessionLabel()`
  that names a session by its working directory plus its **full** id.
- `locale/en.json` — `meta.title` is now `TokenEconomizer (MS tokeneconomizer)`.
- `lib/devstats-server.js` — `let` → `const` for the destructured `derived` (no behaviour change).
- `test/client.test.mjs`, `test/package.test.mjs` — assertions for each rule above.

Measured before → after:

| Surface | Before | After |
| :--- | :--- | :--- |
| Section width | `max-width: 980px`, `padding: 16px 0` — the cap never applied in a settings pane narrower than 980px, so the card filled the pane edge to edge | `max-width: 720px`, `margin: 0 auto`, `padding: 0` — the section stops at the settings read-width and centres itself |
| Headings | section title `h4`, card titles `h5` | section title `h2`, card titles `h3`; heading size `calc(var(--dsh-content-font-size,14px) + 4px)` from the live token, `font-weight: 600` |
| Stylesheet ownership | `<style id="tk-devstats-style">`, inserted once per document; the host cannot claim or replace it | `<style data-plugin-css="@nolit/dsh-tokeneconomizer">`; the host reads that attribute to own the tag, and a re-mount replaces the rules instead of stacking a second copy |
| Per-turn table | `.tkdsScroll { overflow-x: auto }` — horizontal scroll only, the header scrolled out of view, the card grew without bound | `.tkdsScroll { max-height: 280px; overflow: auto }` with `position: sticky` on the header cells; `220px` under `max-width: 640px` |
| Column headers | no `scope` attribute | `scope="col"` on all nine headers |
| Focus | no focus rule at all — the browser default only | `:focus-visible` outline from `--dsw-focus-ring-width` / `--dsw-focus-ring-color` on the select and the buttons |
| Motion | no `prefers-reduced-motion` rule | transitions on the select and the buttons are removed under `prefers-reduced-motion: reduce` |
| Hover | `:hover` rules applied on every device | hover rules wrapped in `@media (hover: hover)`; disabled controls use `cursor: not-allowed` |
| Session picker | option label was `String(entry.id).slice(0, 8) + ' · ' + cwd` — an 8-character uuid prefix identifies nothing, and two sessions in one directory looked identical | `sessionLabel()`: the working directory plus the **full** session id; the option's `title` spells out the whole directory |
| English display title | `locale/en.json` carried `토큰절약기(MS tokeneconomizer)` — the English inventory showed a Korean plugin name | `TokenEconomizer (MS tokeneconomizer)`; `locale/ko.json` keeps the Korean title |

No feature was added and no behaviour of the statistics route or fold changed: the card renders the
same numbers from the same route (`POST /api/local/tokeneconomizer/devstats`).

Verification: `npm run check` (syntax gate over every module) passes; `npm test` reports **139
pass / 0 fail / 1 skipped** (the count as of 2026-11-08; the suite has grown since — see the
2026-11-14 entry below for the current figure), the same pass/fail counts as before the redesign.
The suite gained
eight new cases in `test/client.test.mjs` (one per rule above) and one rewritten case in
`test/package.test.mjs` (the English display title).

### 2026-11-05 — developer statistics (per-turn / per-step) + `0.0.1-rc.1` normalization

**Why.** Owner ask: the TokenEconomizer track should expose the experimental "Developer tools —
Statistics for per-turn and per-step context, cache, model, and tool measurements" data
(rc.1, @mektpoy) and reference the DSH ledger structure. Owner decision the same day: every
`@nolit` track is normalized to `0.0.1-rc.N`, and rc.1 requires Node `>=24.9`.

**What changed** (files):

- `lib/devstats.js` — new pure fold of the committed session event ledger into per-turn /
  per-step rows, plus `ledgerOf()` for this plugin's own counters. Copies the
  `@deepseek-ai/dsh-session-stats` + `@deepseek-ai/dsh-experimental-client-ui-stats` shape
  (`context = input + cacheRead + cacheWrite`, `reasoning ⊂ output`, `step/end` is the counted
  event, `llmMs` / `toolMs` / `ttftMs` / `decodeMs` / `decodeTokens`, `tool/call`→`tool/result`
  pairing by call id).
- `lib/devstats-server.js` — one read-only route `POST /api/local/tokeneconomizer/devstats`
  registered through deferred `ctx.inject(['connection'], …)`; answers a session list plus the
  selected session's turns/steps, the tk ledger counters, and the DSH projection cut
  (`tokenUsage`, `contextPressure`, `contextBreakdown`, `sessionStats` when composed).
- `lib/client.js` — new browser half. One additive `settings.section` registration
  (`id: tokeneconomizer-devstats`, order 62); session selector + totals + turn/step table with
  tool calls (name, ms, result chars, error). **No** composer seat, **no** `conversation.view`
  tab. English default, Korean only while the active locale is `ko`.
- `lib/index.js` — per-session statistics counters (dedup hits/saved chars, tier shadow tokens,
  loop-breaker trips, watchdog warns/interrupts, tool calls/errors, notices, pinned/recall flags),
  bumped at the existing hook sites; deferred route mount; `readProjectionSnapshot()` reads the
  harness projection registry but registers nothing.
- `package.json` — version `0.0.1-rc.1` (owner decision), `engines.node: >=24.9` (rc.1 floor),
  `exports["./client"]`, `dsh.client { platform: web, immediately: true, inject: [ui-settings,
  client-locale] }`; `scripts.check` now covers the three new modules.
- `locale/en.json`, `locale/ko.json` — `devstats` tables (65 keys each) mirrored from the inline
  browser tables.
- `docs/DEV-STATISTICS.md` — measured before/after, reference comparison, placement decision,
  derivation rules, evidence.
- `test/devstats.test.mjs`, `test/devstats-server.test.mjs`, `test/client.test.mjs` — new; and
  `test/package.test.mjs` pins the version/Node floor/client manifest.

**Measured before → after**

| Fact | Before (`0.2.0`) | After (`0.0.1-rc.1`) |
| :--- | :--- | :--- |
| Client surface | none (`lib/client.js` absent, no `./client` export, no `dsh.client`) | one `settings.section` card (`tokeneconomizer-devstats`) |
| Slot registrations | 0 | 1, in a list seat; 0 in `conversation.input.*` / `conversation.view` |
| Local routes | 0 | 1, read-only (`POST /api/local/tokeneconomizer/devstats`) |
| Data exposed to the UI | none (stderr notices only) | per-turn/per-step context, cache read/write, cache hit, input/output/reasoning, provider/model, tool name/ms/result chars, wall/llm/ttft/decode time + tk ledger counters + optional DSH projections |
| `engines.node` | `^22.19.0 \|\| >=24.0.0` | `>=24.9` |
| Version | `0.2.0` | `0.0.1-rc.1` |

Real-log evidence (session `022a9249…`, rc.1, 315 non-header events, folded 2026-11-05):
1 turn / 57 steps / context 3,358,079 / cache hit 97.87% (read 3,286,604, write 0) / input 71,475 /
output 18,751 / reasoning 5,833 / llmMs 413,105 / toolMs 55,396 / ttftMs 328,504 / decodeMs 84,601 /
56 tool calls with 12 errors / 114,403 result chars / wallMs 469,965.

**Verification**

- `TOKENECONOMIZER_HOME=<workspace scratch> npm test` → **132 tests, 131 pass, 0 fail, 1 skipped**
  (the count as of 2026-11-05; the suite has grown since — see the 2026-11-14 entry below for the
  current figure).
  (the skip is the pre-existing opt-in engine fixture, `TE_DSH_TEST_HOME` not set). Before this
  change the same suite ran 99 tests.
  - Note: without a writable `TOKENECONOMIZER_HOME`, one pre-existing test
    (`tiering-mount.test.mjs`, "the newest turns are left untouched") fails with
    `EROFS … /home/minami/.tokeneconomizer/…` because this session's sandbox cannot write the
    default state root. That is an environment limitation, not a regression; the suite is green
    with a writable root.
- `npm run check` → `node --check` passes for `lib/index.js`, `lib/bridge.js`, `lib/dedup.js`,
  `lib/prefix.js`, `lib/repokey.js`, `lib/tiering.js`, `lib/watchdog.js`, `lib/devstats.js`,
  `lib/devstats-server.js`, `lib/client.js`, `bin/te-dsh.mjs`, `scripts/bootstrap.mjs`.
- Isolated `DSH_HOME` browser boot (minimal profile: `dsh-base` + `dsh-web-app` +
  `@nolit/dsh-tokeneconomizer`, thrown-away tree, cleaned up afterwards): the tk client entry
  reported active, the Settings card rendered
  (`TokenEconomizer · Developer statistics`, session selector, session totals, DSH projections
  `as of seq 2`, tk ledger), the route answered `200 {ok:true, sessions:1, projections:true}`
  from the page, and **0 page errors / 0 console errors**. English rendered by default; the
  Korean dictionary needs the owner's `@nolit/dsh-korean-locale` pack (not composed in the
  minimal boot), so Korean rendering is asserted by the locale unit test and the inline/JSON
  table equality rather than by that boot.
- The live 3080 service was **not** touched: this change is **applied pending restart**; the
  owner restarts to see the card in the live profile.

## 2026-11-13 — 0.0.1-rc.2 (cont.) — 문서 정리 및 DSH 업데이트 대응 준비
- DSH 호환성 점검: engines.dsh >=0.2.2-alpha.2 <0.3.0 확인 완료.
- CHANGELOG 및 서브프로젝트 문서화 규정 준수 확인.
- 토큰절약기 내부 기능 정리 준비(기능 삭제 전 상태 측정 완료).
