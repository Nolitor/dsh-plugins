# DSH schema blueprint — target architecture for `@nolit/dsh-tokeneconomizer`

<!-- skeleton:
version: 2.0
kind: design
status: active
updated: 2026-11-14
summary: Target architecture closing all 42 gaps from the DSH schema gap brief — a single persisted project-identity path anchored on the immutable session header, surface-write attribution through plugin:tokeneconomizer/* records, a capability-probe layer replacing bare seam access, the tiering trigger migrated off the deprecated agent-request seam, full fidelity for the three upstream mechanisms, and an interactive 토큰절약기 · 환경설정 settings page.
-->

> Inputs: [DSH-SCHEMA-GAP-BRIEF.md](DSH-SCHEMA-GAP-BRIEF.md) (42 gaps, measured against the installed
> DSH 0.2.2-rc.3) and a Lead-prepared measured facts capsule covering the DSH contracts, the vendored
> engine's configuration schema, and live state. Sections 1–7 were authored in six parallel fragments
> and assembled unchanged.
>
> **This document designs. It does not implement.** Every wave is executed by Stage 3 coders against
> the acceptance gates in §5.3.


## 1. Verdict on the current architecture

**Verdict: a working prototype wrapped around an unowned contract.** Its three headline mechanisms —
tiering, per-project state, per-agent mount — each rest on a DSH shape the plugin treats as stable
without owning a verifiable anchor for it. One anchor is already deprecated (G-C-01), one is
byte-indistinguishable from the harness's own writes (G-B-01), and one has no DSH-side entity at all
(G-A-01). The plugin works today because none of those three has moved yet. The refactor is not a
feature change; it is a change of *ownership posture*: from "consumer of ambient shapes" to
"producer of attributed, probed, identity-pinned writes."

#### 1.1 What is structurally sound and must be preserved

| Asset | Evidence | Why it survives the refactor |
|---|---|---|
| Engine/host split: DSH side imports only `node:*` and reaches the engine solely via `child_process` | `lib/bridge.js` owns the child-process boundary (282 lines); plugin `package.json:59-62` declares only `engines` | A profile can mount the plugin with **zero peer dependencies on DSH packages**. This is what makes the plugin cheap to install and cheap to eject — it is the plugin's best property. |
| Host-local in-memory levers needing no engine: `tools.restrict({ deny })` on agent scope, `agent.inject()`, `agent.cancel()` | `lib/index.js:739`; facts capsule §4.2/§4.3 | Runtime, memory-only, lifted at agent dispose — no persistence, no engine round-trip. These are the correct DSH-side levers. |
| `mode: observe` split — savings off, tracking on | engine `plugin/config.py:143-170` (`mode`: `auto`/`interactive`/`headless`) | A mode that writes nothing to the model-visible surface is the correct rollout gate while the plugin becomes a seam owner; keep it. |
| Fail-open on **non-critical** seams (recall, meter estimation, opt-in search) | `lib/index.js:474-476, 824, 989-992, 1008-1012` | Fail-open is right where a missing capability means "feature absent," not "wrong answer." Kept there — but the uniform policy is the flaw (§2.4). |

#### 1.2 What is structurally wrong, in order of consequence

1. **No DSH-verifiable project identity** (G-A-01, G-A-02, G-A-03, G-A-04, G-A-11, G-A-12, G-A-14, G-A-15). The plugin partitions state per git repository (`lib/repokey.js:204-228`); DSH groups sessions by a lossy, non-injective path slug (`dsh-session-persistence-jsonl/lib/index.js:871-899`). No durable DSH-side anchor exists, so every recall re-derives the partition by re-running git discovery (`lib/index.js:1013-1023`) and any divergence silently creates a new bucket.
2. **Surface-write namespace collision** (G-B-01, G-B-03, G-B-08, G-B-09). The plugin's `compaction/prune` + `tool/result`-replace pair (`lib/index.js:871-880`) is identical in shape to the harness pruner's (`dsh-compaction-tool-result-pruner/lib/index.js:159-177`), with no producer discriminator anywhere.
3. **Deprecated trigger for the headline lever** (G-C-01, G-B-06). Tiering fires only from `agent/request` (`lib/index.js:686-698`), which DSH marked `@deprecated ... do not add new listeners` (`dsh-agent/lib/types/runtime-types.d.ts:352-357`). Its removal kills tiering silently while the plugin keeps mounting and reporting.
4. **Uniform fail-open hides contract drift** (G-C-07, G-C-06, G-C-10). Nearly every failure path is a silent catch — including the tiering rewrite itself (`lib/index.js:884`). A systematic contract violation is indistinguishable from a normal run.
5. **Undeclared and deprecated API usage** (G-B-04, G-B-05, G-C-04). Three read APIs whose doc says "new calls are prohibited" (`dsh-session/lib/types/index.d.ts:214-239`) and one `append` overload that is not declared at all (`lib/index.js:872,877` vs `dsh-session/lib/types/index.d.ts:259`).
6. **No declared contract dependencies** (G-C-14, G-C-02, G-C-03, G-C-08, G-C-09). The plugin consumes `ctx.sessionQuery`, `ctx.sessionProjections`, `ctx.connection`, `ctx.tokenMeter` and writes an event type owned by `@deepseek-ai/dsh-compaction` — none declared, and no typecheck channel exists to detect their drift (plain JS, `node --check` only).
7. **Subagent classification on presentation metadata** (G-B-02, G-C-12, G-B-11). `header.origin === 'subagent'` (`lib/index.js:528`) gates the whole root-only engine path (`lib/index.js:565`), but the contract calls `origin` "presentation metadata, not proof that the child is continuable" (`dsh-session/lib/types/types.d.ts:82-86`).
8. **Untyped boundary surfaces** (G-C-11, G-C-13, G-B-10, G-B-12). The plugin's self-defined `source.kind` value, the untyped `settings.section` slot name, the `?? process.cwd()` fallback, and the async `agent/created` handler awaiting engine startup unguarded.
9. Low-severity drift surface (G-A-05..G-A-10, G-A-13, G-B-07, G-B-10, G-C-15) — grouped in §2.9.

#### 1.3 The systemic problem, in one sentence

**The plugin treats DSH's internal shapes — a path slug, an event payload, an origin flag, a slot name, an append overload — as if they were its own API.** That sentence compresses all three blockers into one posture: G-A-01 is "the slug is not my API," G-B-01 is "the event pair is not my namespace," G-C-01 is "the hook is not my API either." Every flaw group in §2 is a facet of the same consumer posture.

#### 1.4 Severity → count → meaning for the refactor

| Severity | Count | Meaning for the refactor |
|---|---|---|
| Blocker | 3 | One per dimension (A: no project entity, G-A-01; B: no producer discriminator, G-B-01; C: deprecated trigger, G-C-01). No dimension is safe alone; each blocks a headline capability — per-project state, attribution of savings, and the tiering lever itself. |
| High | 18 | Silent wrong answers: wrong partition (G-A-02..A-05), wrong subagent path (G-B-02), deprecated/undeclared reads (G-B-04/B-05), no deprecation channel (G-C-02/C-03), bare service access (G-C-06), unguarded `event.data` (G-C-10). These drive the probe-and-declare requirements. |
| Medium | 16 | Feature degradation without a wrong answer: silent fail-open (G-C-07), untyped slot/kind strings (G-C-11/C-13), wide `engines.dsh` range (G-C-08), async-created rejection (G-B-12). These drive the explicit per-seam failure policy and typed-boundary requirements. |
| Low | 5 | Cosmetic or currently unreachable (G-A-06, G-A-09, G-B-10, G-C-09, G-C-15). Register completeness (§2.9), not design drivers. |

The 3/18/16/5 skew is itself a finding: **18 of 42 are typed-contract divergences no runtime test would surface**, because the plugin is plain JS with no typecheck channel. That is why §2.6 (declared dependencies + a typecheck step) is the single highest-leverage refactor move.

## 2. Confirmed architectural flaws

### 2.1 No DSH-verifiable project identity (G-A-01, G-A-02, G-A-03, G-A-04, G-A-11, G-A-12, G-A-14, G-A-15)

**Mechanism.** The plugin derives a repo key from the session header cwd by re-running git discovery (`lib/repokey.js:204-228`), then partitions all engine state under `repos/<key>/`. DSH has no repo entity: sessions are grouped by a lossy, non-injective slug (`dsh-session-persistence-jsonl/lib/index.js:871-899`), the header `cwd` is raw and non-canonical (only `isAbsolute` validation, `dsh-session/lib/types/index.js:45-49`), and `sessionQuery`'s cwd filter is exact-match on the raw header string (`dsh-session-query/lib/index.js:792`). The plugin's key is therefore *derived per recall*, not *anchored once*: any change in git discovery, path canonicalization, or the header cwd re-partitions the entire ledger. Compounding it, the plugin caches `state.cwd` once at `lib/index.js:546` and never listens for `working-directory/change` (zero grep hits in `lib/index.js`), so identity goes stale mid-session, while every engine payload keys on `state.cwd` (`lib/index.js:744,779,796,1205,1318`) though the engine envelope is per repository — two directories of one repo accumulate two evidence sets (G-A-11).

**Evidence (DSH side).** `dsh-session-persistence-jsonl/lib/index.js:871-899` — "Separator replacement and truncation are intentionally lossy," `.slice(0, 251)` at `:898` (G-A-01, G-A-02). `dsh-session/lib/types/index.js:45-49` — header validation is `isAbsolute` only, vs `dsh-workspace/lib/types/paths.js:43-48` (`realpathNormalize`), so DSH's own two views disagree (G-A-03). `dsh-session-query/lib/index.js:792`, `dsh-session-query-sqlite/lib/index.js:217-218` — exact-match `IN` filter, no project axis (G-A-04). `dsh-working-directory/lib/types/index.d.ts:44-52` — "the immutable Session header retains the original project"; the live dir travels via `working-directory/change` (G-A-15).

**Evidence (plugin side).** `lib/repokey.js:1-12, 196-238` — a pure-function key algorithm reproducing an *external* engine's rule "exactly," a claim DSH cannot verify (G-A-14). `lib/index.js:546` — `const cwd = agent.session.header.cwd ?? process.cwd()`, cached once, never updated (G-A-15, G-B-10). `lib/index.js:1013-1023` — recall widens the exact cwd filter with an O(hits) git walk per hit (`repoKeyFor(hit.cwd)`); any repo-detection difference silently drops history (G-A-04). `lib/index.js:744,779,796,1205,1318` — every engine payload keys the engine on `state.cwd`, diverging from the per-repo envelope (G-A-11).

**What breaks and how it surfaces.** Silently, and only when something moves: a rename/move orphans the DSH project dir while the engine key survives (G-A-12); two paths of one repo split into two buckets (G-A-11); a symlinked cwd yields a different slug for the same real project (G-A-03); a mid-session `cd` leaves identity anchored to the old directory so the recall predicate misses and evidence is attributed to the wrong directory (G-A-15). None throw — all surface later as a wrong number.

**What the fix must achieve.** One canonical project-identity path: resolve identity **once** from the immutable header at session start, persist the resolved identity **and how it resolved** with the data (a `plugin:tokeneconomizer/project-identity` record), and treat any later rule change as a migration, not a silent re-partition. Two values thereafter: `projectDir` (immutable, from the header — the identity anchor) and `liveDir` (from `working-directory/change`) — never recomputed from a path.

### 2.2 Surface-write namespace collision (G-B-01, G-B-03, G-B-08, G-B-09)

**Mechanism.** The tiering lever rewrites a live surface node by appending `compaction/prune` + a `tool/result` replace (`lib/index.js:871-880`) with the same `surfaceOp: { op: 'replace', startSeq, endSeq }` + `sourceEventSeqs` shape the shipped pruner writes (`dsh-compaction-tool-result-pruner/lib/index.js:159-177`). The `compaction/prune` payload has no producer field (`dsh-compaction/lib/types/types.d.ts:80-95`), and the plugin writes no plugin-owned record anywhere in `lib/index.js` (zero `appendPluginRecord` hits; G-B-09). Any consumer counting prunes or attributing saved tokens by event shape therefore cannot separate the plugin's tiering from the harness pruner's pruning — the plugin's headline number is indistinguishable from the harness's own write.

**Evidence (DSH side).** `dsh-compaction/lib/types/types.d.ts:80-95` — payload is exactly `{ shadowedRange, shadowedSeqs, shadowedTokenCount }`; ordering MUST at `dsh-compaction/src/types.ts:80` ("The replacement MUST be appended synchronously right after this event"). `dsh-compaction-tool-result-pruner/lib/index.js:8, 159-177` — `PRUNE_MARKER` and the harness's byte-level sibling write. `dsh-session/lib/types/index.d.ts:124` — `appendPluginRecord` exists, is model-invisible ("never enters the model-visible surface"), and is carried by fork/resume: the intended attribution channel. `dsh-session/lib/types/surface.js:309-327, 349-375` — a replace must target a **current** surface node; a `tool/result` replacement must rewrite exactly one current node and may change only `data.message.content` (G-B-08).

**Evidence (plugin side).** `lib/index.js:871-880` — the identical three-field payload, no origin discriminator, appended from inside the `agent/request` waterfall with no documented permission or lease (G-B-03). `lib/index.js:834-841` — the rewrite targets `session.eventAt(seq)` for every node in `session.surface.nodes`; a stale/foreign node throws inside `Session.append` and lands in the catch-all at `:884`. `lib/index.js:884` — `catch { /* fail open */ }` with no notice, so a systematic violation (e.g. losing the race against the pruner for the same node) degrades quietly.

**What breaks and how it surfaces.** Silently, at attribution time: the plugin's savings cannot be told apart from the pruner's in the log (the measurement bug). A stale node or an ordering violation throws and is swallowed at `lib/index.js:884`, so a systematic contract violation degrades quietly while statistics keep reporting.

**What the fix must achieve.** Every tiering rewrite carries a plugin-owned, model-invisible attribution record via `appendPluginRecord` under a `plugin:tokeneconomizer/*` namespace (e.g. `plugin:tokeneconomizer/surface-rewrite`), declared through a `PluginRecordMap` augmentation, so consumers attribute savings by producer rather than by event-shape coincidence. The rewrite itself stays contract-valid: exactly one current node, only `content` changed, ordering that respects the `compaction/prune`→replace MUST.

### 2.3 Deprecated trigger for the headline lever (G-C-01, G-B-06)

**Mechanism.** `applyTiering` has exactly one call site: the `agent/request` waterfall registered at `lib/index.js:686`, gated on `state.tieredTurn !== payload.turn` (`:692`). `agent/request` is `@deprecated` — "Retained for existing listeners; do not add new listeners" (`dsh-agent/lib/types/runtime-types.d.ts:352-357`) — and DSH's compatibility convention for a degrading seam is a visible warning, not an error (`@deepseek-ai/dsh-app-boot/lib/index.js:1156-1159`). When `agent/request` stops firing, tiering stops applying; the plugin still mounts, still counts turns (`state.turn` is still updated at `lib/index.js:775`), and still publishes statistics. No error anywhere.

**Evidence.** DSH: `dsh-agent/lib/types/runtime-types.d.ts:352-357` (deprecation), `:341-368` (hook contract); `@deepseek-ai/dsh-app-boot/lib/index.js:1156-1159` (warning-not-error convention). Plugin: `lib/index.js:686-698` (sole `applyTiering` call site), `:692` (turn gate), `:818` (tiering entry), `:884` (silent catch).

**What breaks and how it surfaces.** Silently, on the next DSH release that retires the hook: tiering dies while the plugin keeps mounting, counting, and reporting zero saving — the degradation is visible only as a wrong number (the compound risk R2 in the gap brief).

**What the fix must achieve.** Migrate the tiering trigger to the non-deprecated `agent/pre-step` waterfall (`dsh-agent/lib/types/runtime-types.d.ts:333-341`) — and state plainly that its contract does not guarantee the exact "after `step/start`, before request assembly" window: a rewrite landing one step later still saves tokens on every subsequent step of the turn, and a `session/event`-driven fallback must be specified.

### 2.4 Uniform fail-open hides contract drift (G-C-07, G-C-06, G-C-10)

**Mechanism.** The plugin's catch sites are uniformly silent: `if (!meter?.estimateMessage) return` (`:824`), `catch { return null }` (`:474-476`), `catch { return }` (`:989-992`, `:1008-1012`), and — worst — the tiering rewrite itself (`catch { /* fail open */ }` at `:884`). DSH's own convention for a degrading seam is a **visible** warning (`@deepseek-ai/dsh-app-boot/lib/index.js:1156-1159`; once-per-key deprecation warnings, `docs/subsystems/session-projection.md:38`). The plugin has no equivalent, so a missing service, a missing payload field, or a systematic append rejection is indistinguishable from a normal run. Two compounding mechanisms: bare property access on contract-tier seams (`ctx.systemPrompt.section/context`, `ctx.tools.definitions/restrict`, `ctx.tokenMeter` at `lib/index.js:663, 719, 726, 739, 823-824` — G-C-06), and unguarded `event.data` reads in the hot event path (`event.data.turn` at `:775`, `event.data.callId/name/arguments` at `:902, 908-911` — G-C-10, contrasted with the guarded reads at `:785, 842, 853, 861, 951`).

**Evidence.** DSH: `@deepseek-ai/dsh-app-boot/lib/index.js:1156-1159`; `docs/subsystems/session-projection.md:38`; `docs/cordis-api/context.md:237-257` and `docs/cordis-api/registry.md:8-33` (`ctx.get` may return `undefined`; `ctx.inject` waits — the probe primitives, unused here). Plugin: `lib/index.js:474-476, 824, 884, 989-992, 1008-1012`; `lib/index.js:663, 719, 726, 739, 823-824`; `lib/index.js:775, 902, 908-911`.

**What breaks and how it surfaces.** Mixed. A rename that keeps the shape passes every gate the plugin has (no deprecation channel exists, G-C-02) and degrades silently. A bare service access throws inside `agent/created`/`start()` and kills the whole per-agent mount — loud but late and plugin-caused. An unguarded `event.data` read throws inside the session-event listener, uncaught by the plugin. All three end the same way downstream: statistics keep reporting while the feature is absent.

**What the fix must achieve.** An explicit per-seam failure policy: each seam classified **loud** (surface writes, identity resolution, engine boundary — fail loud with a `notice` and a degraded-mode state) or **justified fail-open** (recall, meter estimation, opt-in search — only where a missing capability means "feature absent"). Bare access replaced by capability probes (`ctx.get` + shape check, or `ctx.inject`) before every contract-tier seam, and the unguarded `event.data` reads guarded like those at `:785`.

### 2.5 Undeclared and deprecated API usage (G-B-04, G-B-05, G-C-04)

**Mechanism.** The plugin calls three Session read APIs whose doc says "new calls are prohibited" — `session.eventAt(seq)` at `lib/index.js:837` (the tiering hot path), `session.snapshotEvents()` at `:748` and `:1286` (the session export), `ownEvents` (`dsh-session/lib/types/index.d.ts:214-239`). It also calls the 3-arg `session.append(type, data, opts)` form (`lib/index.js:872, 877`), which is **not declared** in any `.d.ts`: the declared form is `append(inputs: readonly SessionEventInput[])` (`dsh-session/lib/types/index.d.ts:259`), while the runtime keeps the 3-arg overload only untyped (`dsh-session/lib/types/index.js:630-640`). DSH's upgrade guide says a `Session.append` replacement must implement **both** overloads (`docs/upgrade-guide/v0.2.2-rc.1/session-append-overloads/guide.md`) — the single-event form is in flux, not settled (G-C-04).

**Evidence.** DSH: `dsh-session/lib/types/index.d.ts:214-239` ("new calls are prohibited" on `eventAt`/`snapshotEvents`/`ownEvents`); `:259` (declared array-only `append`); `dsh-session/lib/types/index.js:630-640` (undocumented 3-arg runtime overload); the v0.2.2-rc.1 append-overloads upgrade guide. Plugin: `lib/index.js:837`, `:748`, `:1286`, `:872`, `:877`.

**What breaks and how it surfaces.** Silently, on the release that removes them: if the runtime is re-typed to the declared array-only `append`, tiering's rewrite throws inside `Session.append` and is swallowed at `:884`; if `eventAt` is removed, tiering skips every node silently (the per-node catch at `:836-840`); if `snapshotEvents` is removed, the whole session export fails. Because the plugin is plain JS with no typecheck (`package.json` has no `types`; `check` is `node --check`, syntax only), none of this produces a type-level warning (G-C-02).

**What the fix must achieve.** Reads move to the non-deprecated surface — `session.surface` (`dsh-session/lib/types/index.d.ts:149`) and the `SessionMessageProjection` mechanism (`dsh-session/lib/types/surface.d.ts:25-37`) — for both the tiering path and the export. Writes go through the declared `append` contract; if the 3-arg form remains necessary for `surfaceOp`, its use must be a probed, owned risk with a loud failure when absent, not an ambient assumption.

### 2.6 No declared contract dependencies (G-C-14, G-C-08, G-C-09, G-C-02, G-C-03)

**Mechanism.** The plugin consumes services owned by other packages without declaring them: `ctx.sessionQuery` (a seam owned by `dsh-session-query-sqlite`, `docs/capability-seams.md:718`), `ctx.sessionProjections` (`:728`), `ctx.connection` (`:668`), and writes `compaction/prune` — an event type owned by `@deepseek-ai/dsh-compaction` (`dsh-compaction/src/types.ts:82-89`), not by core `dsh-session` (`dsh-session/lib/types/types.d.ts:261`, G-C-03). None is declared. The only composition gate is a wide `engines.dsh` range (`">=0.2.2-alpha.2 <0.3.0"`, `package.json:59-62`) that passes 14 documented in-range breaking changes (G-C-08); `dsh.manifestVersion` is declared but never validated by the loader (G-C-09); and there is no typecheck step (G-C-02), so the compiler channel DSH documents for deprecation detection (`docs/upgrade-guide/v0.2.2-alpha.2/projection-snapshot-scope/guide.md:19`) is unavailable to a plain-JS plugin.

**Evidence.** DSH: `docs/capability-seams.md:668, 684, 718, 728` (per-seam owner packages and roles); `dsh-compaction/src/types.ts:82-89`; `dsh-package-manifest/README.md` (engines semantics, manifestVersion declared); `dsh-app-boot/lib/index.js:1075, 1147, 1158` (loader evaluates engines without importing plugin code; exact-version exemption bypass). Plugin: `package.json:59-65` (only `engines`; `test`/`check` scripts, no typecheck); `lib/index.js:473, 504, 872, 988` (consumption of the undeclared services and event type).

**What breaks and how it surfaces.** Silently, at composition time: a composition without the undeclared services loses recall, projections, dev-stats, and tiering (G-C-14); an in-range DSH upgrade silently changes a contract the plugin reads (G-C-08); a manifest-format change goes undetected (G-C-09).

**What the fix must achieve.** Declare every contract package the plugin actually consumes — `@deepseek-ai/dsh-session` (runtime + `/types` for the `PluginRecordMap` augmentation), `@deepseek-ai/dsh-compaction` for the event type, and the seam-owner packages for every consumed service — and add a typecheck step (`tsc --noEmit` against the published `.d.ts`) so the compiler channel becomes the plugin's drift detector, then narrow `engines.dsh` to the range actually verified.

### 2.7 Subagent classification on presentation metadata (G-B-02, G-C-12, G-B-11)

**Mechanism.** `const isSubagent = agent.session.header.origin === 'subagent'` (`lib/index.js:528`) drives the root-only engine path (`engineEnabled: !isSubagent`, `:565`) and the memory-path gate at `:544`. The contract says `origin` is "Coarse product classification for a session created as a subagent child. **This is presentation metadata, not proof that the child is continuable**" (`dsh-session/lib/types/types.d.ts:82-86`); it has exactly one legal value today (`readonly origin?: 'subagent'`, `:86`); and the real one-shot/continuable mode lives in the log-only `subagent/descriptor` event (`dsh-subagent/lib/types/descriptor.d.ts:26-53`), not in the header at all (G-B-11). The plugin is 100% certain about a field DSH explicitly labels non-authoritative.

**Evidence.** DSH: `dsh-session/lib/types/types.d.ts:82-86` (presentation-metadata wording), `:86` (single value), `:70, 74` (discriminator contract position); `dsh-subagent/lib/types/descriptor.d.ts:26-53` (the actual mode axis). Plugin: `lib/index.js:528, 532-540, 544, 565` (classification as ground truth, including the plugin's own comment at `:532-540` stating the failure that must not happen).

**What breaks and how it surfaces.** Silently, when the value space moves: a second `origin` value makes a child run the root-only engine path — double-counted turns, unwanted export (G-C-12); a child with no `origin` is classified as root; a `continuable` child is excluded from the engine path today (G-B-11) and stays excluded even if DSH later routes continuable children through the engine. No error surfaces in any case.

**What the fix must achieve.** Treat `origin` as a hint, not a gate: the engine path is gated on a positive mode signal (the `subagent/descriptor` mode axis where present, defaulting to the most conservative behavior for an unclassifiable child), and the classification is logged with the signal it used so a mis-classification is diagnosable from the log.

### 2.8 Untyped boundary surfaces (G-C-11, G-C-13, G-B-10, G-B-12)

**Mechanism.** Four boundary values are handled as unguarded strings or unguarded async: (1) the plugin defines its own `source.kind` value `'tokeneconomizer'` (`lib/index.js:329`) which DSH does not define in the `user/message` kind vocabulary (`dsh-session/lib/types/types.d.ts:300-305`), and branches on `kind === 'user'` as the only non-plugin human kind (`:785`, `:951-952`) — a new upstream kind makes the plugin treat a non-human message as human (recall budget skew) or lose its own notices (G-C-11). (2) The `settings.section` slot name is an untyped string literal (`lib/client.js:642`) — if the slot name drifts, the settings section silently never appears (G-C-13). (3) `header.cwd ?? process.cwd()` (`lib/index.js:546`) falls back to the *plugin process's* cwd, not the session's; the fallback is indistinguishable from a real cwd, so a session created without a cwd is silently mis-rooted (G-B-10). (4) The `agent/created` handler is `async` and awaits engine startup unguarded (`await start(state, source)` at `:613`); DSH's contract is "a throw or rejection **fails creation** and skips later listeners" (`dsh-agent/lib/types/runtime-types.d.ts:245-247`) — a plugin-caused agent-creation failure (G-B-12).

**Evidence.** DSH: `dsh-session/lib/types/types.d.ts:300-305`; `docs/capability-seams.md:704, 760`; `dsh-session/lib/types/types.d.ts:69-70` and `dsh-session-persistence-jsonl/lib/types/format.d.ts:47` (`cwd` optional, "if any"); `dsh-agent/lib/types/runtime-types.d.ts:242-259`. Plugin: `lib/index.js:329, 349-355, 785, 951-968`; `lib/client.js:642`; `lib/index.js:546`; `lib/index.js:527-614` (bare `await start` at `:613`).

**What breaks and how it surfaces.** (1) and (2) are silent — recall-budget skew or a settings section that never appears. (3) is silent mis-rooting of engine hooks and exports to the plugin process's cwd. (4) is loud but plugin-caused: a rejection in `start()` fails the whole agent creation.

**What the fix must achieve.** The plugin's own notices become `plugin:tokeneconomizer/*` records (model-invisible), never an invented `source.kind` value; the slot name is probed at startup and its absence is loud; the cwd fallback is removed — an absent header cwd is an explicit, logged "no identity" state; and `agent/created` never awaits engine startup unguarded — engine startup is detached with its own failure policy so a plugin-caused agent-creation failure is impossible.

### 2.9 Low-severity drift surface (G-A-05, G-A-06, G-A-07, G-A-08, G-A-09, G-A-10, G-A-13, G-B-07, G-B-10, G-C-15)

Grouped compactly; G-B-10 is design-covered in §2.8 and listed here for register completeness.

| ID | DSH contract fact (measured) | Refactor constraint it imposes |
|---|---|---|
| G-A-05 | No per-project display store for unregistered dirs; only the Workspace registry holds `title/createdAt/pinned`, keyed by UUID (`dsh-workspace/lib/index.js:209-215, 643-645, 652`) | The persisted project-identity record carries any display metadata the plugin needs; never derive one from the slug |
| G-A-06 | Pin/archive is per-session, not per-project (`dsh-workspace/lib/index.js:240-248`; live `workspace.json` shows empty id sets) | No DSH project-pin concept exists; any project-level pin is plugin-owned state |
| G-A-07 | Workspace UUID is registry-scoped and not derivable from cwd without an async lookup (`dsh-workspace/lib/index.js:643-645, 652`) | The plugin's persisted identity key stays pure/sync; Workspace UUID is display metadata resolved by lookup when available |
| G-A-08 | `ctx.sessionProjections` has no project axis (`dsh-session-projection/lib/index.js:129-144`) | Any project-scoped derived state is keyed by the plugin's own identity record, never assumed DSH-indexed |
| G-A-09 | `ctx.jobs`/`ctx.goal`/team board expose no cwd/project scoping (zero cwd hits in `dsh-jobs/lib/`, `dsh-goal/lib/`) | Any per-project view over jobs/goals/tasks is built from session ids, not assumed scoping |
| G-A-10 | A fourth canonicalization rule exists in `dsh-sidebar-manager` (case-folded, `path.resolve`, no realpath — `dsh-sidebar-manager/lib/groups.mjs:75-85`) vs the case-preserving DSH slug (`dsh-session-persistence-jsonl/lib/index.js:890`) | Never rely on cross-surface path identity; the persisted identity record is the only key the plugin trusts |
| G-A-13 | A Workspace record's `path` is immutable — no "workspace moved" operation (`dsh-workspace/lib/types/entity.js:57-83` verbatim; only mutator is `setTitle`, `dsh-workspace/lib/index.js:105`) | A moved project is a **new** identity record with a provenance link to the old one — never silently reuse the old identity |
| G-B-07 | `session/event` is agent-scope-filtered but the payload carries the real `session` argument (`dsh-session/lib/types/index.d.ts:53-66`) | The handler validates the session argument against the agent scope before attributing (plugin currently discards it, `lib/index.js:682, 771`) |
| G-B-10 | `header.cwd` optional ("if any", `dsh-session/lib/types/types.d.ts:69-70`) | Covered in §2.8: no `process.cwd()` fallback; explicit no-identity state |
| G-C-15 | No capability-probe API upstream; discovery is `ctx.get`/`ctx.inject` composition (`docs/cordis-api/context.md:237-257`, `registry.md:8-33`) | Formalize one probe helper (shape-check after `ctx.get`) instead of per-call-site probes (`lib/index.js:470-476, 502-510, 985-992`) |

### 2.10 Flaw → requirement summary

The table later sections consume: every row is a design constraint, not a feature request.

| # | Flaw | Gap IDs | Severity | Requirement imposed on the design |
|---|---|---|---|---|
| 1 | No DSH-verifiable project identity | G-A-01, G-A-02, G-A-03, G-A-04, G-A-11, G-A-12, G-A-14, G-A-15 | blocker (+high rows) | One canonical identity path: resolve once from the immutable header, persist with the data as `plugin:tokeneconomizer/project-identity` including resolution provenance; `projectDir`/`liveDir` split; never recompute from a path; rule change = migration |
| 2 | Surface-write namespace collision | G-B-01, G-B-03, G-B-08, G-B-09 | blocker | Every tiering rewrite carries a model-invisible attribution record under `plugin:tokeneconomizer/*` via `appendPluginRecord` + `PluginRecordMap` augmentation; rewrite stays surfaceOp-contract-valid |
| 3 | Deprecated trigger for the headline lever | G-C-01, G-B-06 | blocker | Tiering triggers on `agent/pre-step` (timing consequence stated, `session/event` fallback specified); never `agent/request` |
| 4 | Uniform fail-open hides contract drift | G-C-07, G-C-06, G-C-10 | high | Explicit per-seam policy (loud vs justified fail-open); capability probe before every contract-tier seam; guarded `event.data` reads |
| 5 | Undeclared and deprecated API usage | G-B-04, G-B-05, G-C-04 | high | Reads via `session.surface` + `SessionMessageProjection`; writes via the declared `append` contract; any remaining 3-arg use is probed and owned |
| 6 | No declared contract dependencies | G-C-14, G-C-02, G-C-03, G-C-08, G-C-09 | high | Declare every consumed contract package; add `tsc --noEmit` typecheck as the drift detector; narrow `engines.dsh` to the verified range |
| 7 | Subagent classification on presentation metadata | G-B-02, G-C-12, G-B-11 | high | `origin` is a hint: gate the engine path on a positive mode signal (`subagent/descriptor`) with a conservative default for unclassifiable children, logged with its signal |
| 8 | Untyped boundary surfaces | G-C-11, G-C-13, G-B-10, G-B-12 | medium | Own notices via `plugin:` records not `source.kind`; probe the slot name (loud if absent); no `process.cwd()` fallback; `agent/created` never awaits engine startup unguarded |
| 9 | Low-severity drift surface | G-A-05..G-A-10, G-A-13, G-B-07, G-B-10, G-C-15 | low | One formalized probe helper; persisted identity record is the only trusted key; `session/event` handler validates its session argument; move = new identity with provenance |

## 3. Target architecture

### 3.1 Design principles

Nine operational invariants. Every module in §3.2 is bound by them; each states the rule, the gap
that forces it, and the mechanical check a reviewer applies. P1–P4 blocker-grade, P5–P9 structural.

**P1 — One identity resolution path, resolved once, persisted with the data.** Closes G-A-01,
G-A-12, G-A-14, G-A-15.
- *Rule.* Project identity is resolved by exactly one exported function in exactly one module
  (`lib/identity.js` → §3.3), once per session, at `agent/created`, from the immutable session
  header. The resolved key is persisted in the `plugin:tokeneconomizer/project-identity` record
  alongside the data it partitions. No other module imports key-derivation functions, runs git
  discovery, or reads `header.cwd` to derive a bucket. A stored key is read back, never recomputed.
- *Why.* DSH has no project entity (G-A-01); the partition otherwise has no durable anchor, and any
  re-derivation mismatch silently creates a new bucket (G-A-12, G-A-14). Today's anti-pattern:
  `state.cwd` cached once at `lib/index.js:546`, reused at :718, :779, :796, :997, :1018-1021,
  :1205, :1318 — twelve call sites each able to disagree with the record.
- *Violation check.* `grep -rn "header.cwd" lib/` → only `lib/identity.js`; `grep -rn
  "repoKeyFor\|repoIdentity\|findRepoRoot" lib/` outside identity → 0 hits. Every
  `plugin:tokeneconomizer/*` record carries `identityKey`; one without it fails
  `test/identity.test.mjs`.

**P2 — Probe before use on every contract-tier seam.** Closes G-C-06, G-C-15.
- *Rule.* No bare property access on `ctx.systemPrompt.*`, `ctx.tools.*`, `ctx.tokenMeter.*`,
  `ctx.sessionQuery`, or any `ctx.get(name)` result. Each access is preceded by a probe from
  `lib/probes.js` — composed from `ctx.get` / `ctx.inject`, the only runtime lookups DSH provides
  (G-C-15) — returning `{ ok, capability }`; `!ok` takes the seam's declared policy (P4), never an
  implicit `undefined`. No version sniffing where a probe works.
- *Why.* Six seams are used bare today (`lib/index.js:663, 719, 726, 739, 823-824`); a rename
  throws inside `agent/created` and kills the whole per-agent mount.
- *Violation check.* Script lint over `lib/*.js`: access on those ctx objects must sit inside a
  probe-guarded branch or behind an `if (!probe.ok)` return. A fixture whose host lacks each seam
  asserts the plugin still mounts and degrades visibly.

**P3 — Own namespaces only.** Closes G-B-01, G-B-09, G-C-03.
- *Rule.* The plugin's log writes are exactly two kinds: (a) `appendPluginRecord` records under
  `plugin:tokeneconomizer/*` (type grammar per `dsh-session/lib/types/index.d.ts:57-59`), declared
  via `PluginRecordMap` augmentation in the plugin's own `lib/types/` (pattern:
  `dsh-action-cards/lib/types/types.d.ts:68-74`); (b) the engine-contract rewrite pair itself
  (`compaction/prune` + `tool/result` replace) — the lever, not attribution. It never invents a
  session event type: an external package cannot extend `KNOWN_SESSION_EVENT_TYPES`
  (`dsh-session/lib/index.js:79`; only packages inside the session tree can — capsule §2.7). It
  never writes into `~/.dsh` or any core namespace; its state root is `~/.tokeneconomizer/` via
  the bridge boundary only.
- *Why.* The current `compaction/prune` + `tool/result`-replace pair is byte-identical to
  `dsh-compaction-tool-result-pruner` (`dsh-compaction-tool-result-pruner/lib/index.js:159-177`) —
  no consumer can attribute saved tokens (G-B-01). And `compaction/prune` is owned by
  `@deepseek-ai/dsh-compaction`, not core (G-C-03): the plugin declares that dependency and probes
  the type's availability, it does not dodge ownership.
- *Violation check.* `grep -n "session.append(" lib/` → only `lib/attribution.js`, and
  every such write is paired with the same-seq `plugin:tokeneconomizer/surface-rewrite` record;
  `grep -n "appendPluginRecord" lib/` → every type argument starts `plugin:tokeneconomizer/`. A
  test parses a captured log and asserts every plugin-produced event is attributable.

**P4 — Explicit per-seam failure policy, declared not incidental.** Closes G-C-07, G-B-03, G-B-08.
- *Rule.* Every seam use (probe result, hook trigger, append, engine call) declares one of exactly
  two policies in the module's header comment: **loud** (fail the operation visibly, once per key)
  or **fail-open** (continue with the degraded behavior written next to the declaration). No silent
  `catch {}`, no silent `if (!x) return`. Model: `pluginCompatibilityWarning`
  (`dsh-app-boot/lib/index.js:1156-1159`) and once-per-key projection warnings
  (`docs/subsystems/session-projection.md:38`).
- *Why.* The current code is fail-open almost everywhere with no notice: `lib/index.js:824`
  (`if (!meter?.estimateMessage) return`), `:474-476`, `:486-488`, `:989-991`, `:1008-1012`
  (`catch { return ... }`), and the `:884` catch that swallows append rejection inside the
  `agent/request` waterfall (G-B-03) — a systematic contract violation degrades quietly.
- *Violation check.* `grep -n "catch {}" lib/` → 0; `grep -nE "catch \{ return" lib/` → every hit
  pairs with a once-per-key `warn()` via the watchdog channel. A test suppresses the meter/probe
  and asserts a warning was emitted on the degraded path.

**P5 — No undeclared APIs; the exception is confined to one adapter.** Closes G-B-04, G-B-05, G-C-04.
- *Rule.* The plugin calls only forms declared in shipped `.d.ts` files. The known exception is the
  single-event `session.append(type, data, opts)` form — undeclared
  (`dsh-session/lib/types/index.d.ts:259` declares only the array form; runtime has the 3-arg form,
  `dsh-session/lib/types/index.js:630-640`). It is confined to `lib/attribution.js`, with
  the reason in that file's header ("surface writes need `surfaceOp` + `sourceEventSeqs`; the 3-arg
  form is the only one that carries them per G-B-05/G-C-04") and a declared array-overload fallback
  behind the same adapter. The three prohibited read APIs
  (`eventAt` `dsh-session/lib/types/index.d.ts:216`, `snapshotEvents` `:226`, `deriveMessages`
  `:235` — "new calls are prohibited") are replaced by `session.surface` (`:149`) and
  `SessionMessageProjection` (`surface.d.ts:25-37`).
- *Why.* Declaration and runtime disagree; a re-typed runtime breaks the plugin with no
  compile-time warning (plain JS, no typecheck step — G-C-02).
- *Violation check.* `grep -rn "session.append(" lib/` → only `lib/attribution.js`;
  `grep -rn "eventAt\|snapshotEvents\|deriveMessages" lib/` → 0 hits. The adapter header names
  the undeclared form and its guard; a lint flags undeclared forms outside an adapter.

**P6 — Deprecation is a build-time signal.** Closes G-C-02, G-B-06.
- *Rule.* `scripts/audit-deprecated.mjs` runs in `npm test`: it extracts every `@deepseek-ai/*`
  symbol the plugin's adapter files reference and greps the installed `lib/types/*.d.ts` for a
  `@deprecated` marker on that symbol; a hit fails the build unless the symbol carries a migration
  note in `docs/`. New listeners are never attached to a deprecated hook.
- *Why.* The plugin is plain JS; DSH's compiler channel ("confirm that type checks pass without
  `no-deprecated` findings", upgrade-guide v0.2.2-alpha.2:19) is unavailable. An upstream
  `@deprecated` otherwise reaches it with zero signal — how the headline feature ended up on the
  deprecated `agent/request` hook (G-C-01/G-B-06).
- *Violation check.* The audit against today's symbols fails (eventAt, snapshotEvents,
  `agent/request` are marked deprecated); after Stage 3 it passes. Removing a fixture's marker
  fails the audit; the script refuses unknown symbols rather than skipping them.

**P7 — Anchor state is persisted; derived state is recomputable.** Closes G-A-01, G-A-12, G-C-05.
- *Rule.* Anything without which history silently forks — identity, engine repo key, tier-decision
  history — is persisted (plugin record + `~/.tokeneconomizer/repos/<key>/`) with `resolvedBy` and
  `schemaVersion`, so a rule change is a migration, not a silent re-partition. Anything derivable
  from the session log (devstats, dedup, shadowed seqs) is recomputable and holds no identity
  authority; a derived artifact never feeds a partition.
- *Why.* Recomputed keys are what silently re-partition ledgers on plugin restart (G-A-12, R1).
- *Violation check.* A function choosing a state bucket must take its key from persisted identity
  (P1), never a recomputed value. Test: clear all caches, re-mount mid-session, same `identityKey`.

**P8 — Root and subagent sessions are both first-class.** Closes G-B-02, G-C-12, G-B-11.
- *Rule.* Every session resolves identity (§3.3.5). `header.origin` is what DSH says it is —
  "presentation metadata, not proof that the child is continuable"
  (`dsh-session/lib/types/types.d.ts:82-86`) — never a capability gate. The root-only engine gate
  consults the persisted identity's `parentSession` and the log-only `subagent/descriptor` `mode`
  (`dsh-subagent/lib/types/descriptor.d.ts:29-34`), not `origin` alone. An unrecognized `origin`
  value degrades-once and defaults to subagent treatment (fail-safe: never double-run root).
- *Why.* `lib/index.js:528` branches 100% on a field DSH labels non-authoritative (R3): a future
  team-role child would run the root path, double-count turns, and write an unwanted export.
- *Violation check.* `grep -n "header.origin" lib/` → only `lib/identity.js`; other gates read
  identity's output (`kind`, `continuable`).

**P9 — Two-value time model for the working directory.** Closes G-A-15, G-B-10, R4.
- *Rule.* `projectDir` (immutable, from the header — "the immutable Session header retains the
  original project", `dsh-working-directory/lib/types/index.d.ts:47`) anchors identity; `liveDir`
  (from `working-directory/change`) serves operations needing the current directory. No conflation.
  The `?? process.cwd()` fallback at `lib/index.js:546` is abolished: an absent header cwd is a
  `degrade-once` warning recorded `unanchored`, never a silent mis-rooting (G-B-10).
- *Why.* After a mid-session `cd`, the cached cwd attributes evidence to the wrong directory, the
  recall predicate misses, and the engine key goes stale (G-A-15, R4).
- *Violation check.* `grep -n "state.cwd" lib/` → 0; state carries `state.identity` (anchor) and
  `state.liveDir` (set only by the `working-directory/change` listener).

### 3.2 Module map

`lib/index.js` is **1,396 lines** and is the contention point: it holds state init, identity,
probing, surface writes, tiering, hook wiring, engine export glue, and devstats plumbing in one
file, so every Stage-3 wave would collide on it. The split gives each concern its own file with a
one-way dependency direction; the file-ownership matrix at the end of this section is authoritative
and reused by §5.

**Dependency layers — imports point strictly downward; the graph is acyclic:**

```
L0 leaf       : lib/identity.js  lib/dedup.js  lib/prefix.js
L1 probe      : lib/probes.js                       (imports L0)
L2 surface    : lib/surface-attribution.js          (imports L0, L1)
L3 feature    : lib/tiering.js  lib/settings-api.js
                lib/devstats.js  lib/watchdog.js  lib/interrupt-bridge.js
                                                      (imports L0–L2)
L4 view       : lib/devstats-server.js  lib/client.js (imports L0–L3)
L5 edge       : lib/bridge.js  bin/dsh-te.mjs        (imports L0–L3; engine boundary)
L6 orchestr   : lib/index.js                        (imports L0–L5; wiring only)
```

**Per-module contract** — purpose, ownership, prohibitions, allowed imports:

| Module | Purpose (one line) | Owns | Must NOT do | May import |
|---|---|---|---|---|
| `lib/identity.js` | Single project-identity resolution + persistence (two-value model) | `resolveIdentity(header, persistedRecords)` (returns the `plugin:tokeneconomizer/project-identity` record; the caller appends it); `projectDir`/`liveDir` maintenance (§3.3.1); adoption of pre-existing `~/.tokeneconomizer/repos/<key>/`; absorbs `repokey.js` entirely (§3.3.6) | Read `working-directory/change` itself (receives `liveDir` via a setter from `index.js`); touch ctx seams; write any record (the caller appends its returned record); write engine state directly | L0 only |
| `lib/probes.js` | Capability probes for every contract-tier seam | `probeCapability(ctx, name)` → `{ok, capability}`; the probe table (systemPrompt.section/context, tools.restrict/definitions, tokenMeter.estimateMessage, sessionQuery, settings slots, `compaction/prune` type availability); the P4 policy table | Use the capability itself; cache probes beyond one mount; throw; hold domain state | L0 only |
| `lib/surface-attribution.js` | All `appendPluginRecord` writes + `pluginRecordOf` reads + projections | The three record types (`surface-rewrite`, `tier-decision`, `project-identity`); the `PluginRecordMap` + `SessionProjectionMap` augmentation files; the single `session.append` adapter (P5) with the undeclared 3-arg form and its array-overload fallback | Invent an event type (G-C-03); write outside `plugin:tokeneconomizer/`; call deprecated read APIs (G-B-04 → `session.surface` + projections); recompute identity; rewrite the surface node itself (surface composition lives in `lib/rewriter.js`) | L0, L1 |
| `lib/tiering.js` | Tiering feature, re-pointed at `agent/pre-step` | The `pre-step` listener; `applyTiering` and node grading; emits `tier-decision` + `surface-rewrite` records via L2 | Call `session.append` directly (only through L2); read `state.cwd` (reads identity from state); call the engine | L0–L2 |
| `lib/settings-api.js` | Interactive `토큰절약기 · 환경설정` route (engine config read/write) | `POST /api/local/tokeneconomizer/settings` (read) + `/settings/write`; writes funneled through `lib/bridge.js` (`te config set`, never a direct file write); immediate re-read; stored-override vs engine-default display; error presentation on engine rejection; slot id `tokeneconomizer-settings` near order 62 | Write `~/.tokeneconomizer/config.json` directly; own devstats rendering; compute identity | L0–L3, L5 (bridge) |
| `lib/devstats.js` | Pure fold over session events → per-project devstats | Stats computation, per-`identityKey` grouping | Touch ctx; write files; recompute identity | L0 |
| `lib/devstats-server.js` | Read-only devstats HTTP route + slot | `POST /api/local/tokeneconomizer/devstats`; slot `tokeneconomizer-devstats` (order 62) | Write anything; own settings | L0–L3 |
| `lib/client.js` | Client rendering for both slots | Render of `tokeneconomizer-settings` + `tokeneconomizer-devstats` | Hold its own inline locale dictionary copy (drift point; single source in `locale/*.json`) | L4 outputs only |
| `lib/bridge.js` | Engine child-process boundary (`te`, `te-hook`) | Spawn/pipe for every engine call; the JSON contract with the vendored engine | Compute identity (receives `identityKey`/`liveDir` from caller); write `~/.tokeneconomizer` outside the engine protocol | L0–L3 |
| `lib/watchdog.js` `lib/interrupt-bridge.js` `lib/dedup.js` `lib/prefix.js` | Unchanged responsibilities; watchdog gains the once-per-key `warnOnce(key, msg)` channel used by every P4 failure policy | As today | As today | L0–L3, per layer |
| `lib/index.js` | Slim orchestrator, ≤300 lines | ctx wiring; hook registration (`agent/created`, `agent/pre-step`, `session/event`, `working-directory/change`); per-agent state object creation; passes probe results and identity to feature modules | Feature logic; surface writes; identity computation; probing; engine protocol; settings logic | L0–L5 |
| `bin/dsh-te.mjs` | CLI: `status`, `doctor`, `cold-start`, `purge`, `--only <repoKey>` | Same as today; `--only` accepts the new `identityKey` with the old `repoKey` as a migration alias | Compute identity inline (uses `lib/identity.js`) | L0–L3 |

**Current → target mapping — all 12 `lib/*.js` + `bin/dsh-te.mjs` accounted for, nothing orphaned
(line counts = measured `wc -l`)**:


| Current file (lines) | Target file(s) | What moves |
|---|---|---|
| `lib/index.js` (1,396) | `lib/identity.js`, `lib/probes.js`, `lib/surface-attribution.js`, `lib/tiering.js`, `lib/settings-api.js`, slim `lib/index.js` | Identity block `:528-:546` + `:997-:1023` recall keying → identity; ctx seam sites `:663, :719, :726, :739, :823-824` → probes; surface pair `:871-887` incl. 3-arg append `:872, :877` → surface-attribution; trigger `:686-698` + `:818` → tiering on `agent/pre-step`; hook registration and state object remain → slim index |
| `lib/repokey.js` (238) | folded entirely into `lib/identity.js`; file deleted | The rule becomes candidate rules 2–4 of the §3.3.2 algorithm; the engine-rule re-implementation is confined to a `@migration`-marked `legacyKeyFor()` (§3.3.6) |
| `lib/settings.js` (169) | `lib/settings-api.js` | Resolver stays; gains the read/write routes and the write-via-bridge funnel |
| `lib/client.js` (656) | `lib/client.js` | Slot registration stays; inline 66-key dictionary removed → single source in `locale/ko.json` / `locale/en.json` |
| `lib/devstats.js` (605) | unchanged | Pure fold already; grouping key switches `cwd` → `identityKey` |
| `lib/devstats-server.js` (265) | unchanged | Route + slot; gains `identityKey` grouping parameter |
| `lib/bridge.js` (282) | unchanged (role) | Signature gains `identityKey` + `liveDir` parameters |
| `lib/watchdog.js` (302) | unchanged | Gains `warnOnce` |
| `lib/interrupt-bridge.js` (184) | unchanged | — |
| `lib/dedup.js` (83) | unchanged | — |
| `lib/prefix.js` (88) | unchanged | — |
| `bin/dsh-te.mjs` (603) | unchanged (role) | `--only` accepts `identityKey` with old-key alias |

**Tiering honesty note (contract-mandated).** `agent/pre-step`
(`dsh-agent/lib/types/runtime-types.d.ts:333-341`) does not document the exact "after `step/start`,
before request assembly" window `agent/request` had (`:352-357`). Stated plainly: a rewrite landing
one step later still saves tokens on every subsequent step of the turn, and attribution records
carry the seq range either way. Fallback if testing shows the window matters: a `session/event`-
driven check that applies the rewrite before the next `pre-step`. Declared fallback, not a silent
difference.

**File-ownership matrix for Stage 3 (authoritative; §5 reuses this).** Each wave's workers get
disjoint files; no two workers write the same file in the same wave. Workers are OpenCode DeepSeek
coders (WA–WD) plus one headless-Chromium verifier (V) that writes nothing under `lib/`.

| Wave | Worker A | Worker B | Worker C | V (verify) |
|---|---|---|---|---|
| W1 scaffolding | `lib/identity.js` (new, absorbs `repokey.js`; deletes it) | `lib/probes.js` (new) | `lib/attribution.js` (new) + `lib/surface-attribution.js` (new) + their `lib/types/` augmentation | `npm test` green |
| W2 trigger migration | `lib/tiering.js` (re-point) | `lib/settings-api.js` (absorbs `settings.js`) | `scripts/audit-deprecated.mjs` (new) | `npm test` + audit pass |
| W3 slim orchestrator | `lib/index.js` (rewrite ≤300) | `lib/devstats.js` (`identityKey` param) | `lib/devstats-server.js` | full `npm test` |
| W4 client + edge | `lib/client.js` + `locale/ko.json` + `locale/en.json` | `lib/bridge.js` + `bin/dsh-te.mjs` | `lib/watchdog.js` (`warnOnce`) | `npm test` + `docs:check` |
| W5 integration | (none — lead only) | | | `npm test` + `node scripts/check-doc-links.mjs` + `npm run docs:check` |

Disjointness proof: every file name appears at most once per wave row. Per-feature test files follow
the same discipline (`test/identity.test.mjs` W1-A; `test/probes.test.mjs` W1-B;
`test/attribution.test.mjs` W1-C; `test/tiering.test.mjs` W2-A; `test/settings-api.test.mjs` W2-B;
`test/index.test.mjs` W3-A; `test/client.test.mjs` W4-A). Existing tests are not weakened: where a
test's meaning legitimately changes (e.g. the `agent/request` trigger test), the replacement
assertion is named in that wave's test file. `lib/index.js` is touched only in W3 by Worker A —
the contention point becomes a sequenced, single-writer file.

### 3.3 Project identity resolution — closes G-A-01/02/03/04/12/14/15

This is a blocker. The design is complete and implementable as written.

#### Two-value model

DSH's contract is explicit: the immutable Session header retains the **original project**, while
`working-directory/change` carries the **live** directory
(`dsh-working-directory/lib/types/index.d.ts:44-52`). The plugin conflates them:
`lib/index.js:546` caches `state.cwd = agent.session.header.cwd ?? process.cwd()` once, never
listens for the change (`grep "working-directory" lib/index.js` → 0 hits; G-A-15), and reuses the
stale value for the engine key (`:997`), the recall predicate (`:1018-1021`), and every engine
payload (`:779`, `:796`, `:1205`, `:1318`). After a mid-session `cd`, evidence is attributed to the
old directory and the recall predicate misses — this is the root of G-A-11's split-evidence bug and
R4.

| Value | Source | Mutability | Used by |
|---|---|---|---|
| `projectDir` | Session header `cwd` (immutable); absent → `unanchored` (below), never `process.cwd()` (G-B-10) | Immutable for the session's life | Identity resolution, engine repo key, ledger partitioning, prior-session recall scope, the identity record |
| `liveDir` | `working-directory/change` event (`{ cwd: string }`) and the `workingDirectory` projection | Changes mid-session | Engine hook payloads' `cwd` field (evidence, traces), filesystem operations, any "where is the work happening now" operation |

Rules: never use `liveDir` for a partition decision; never use `projectDir` for a payload meaning
"current directory". DSH itself `fs.realpath`-resolves the new cwd
(`dsh-fs-local/lib/index.js:188`), so `liveDir` is stored as received — no second canonicalization.

Fallback when the header has no `cwd`: emit the P4 `degrade-once` warning, record
`resolvedBy: 'unanchored'`, `key = null`, and disable the engine path and recall for that session.
A null identity is an honest state; a process-cwd mis-rooting is a silent wrong answer.

#### Resolution algorithm (numbered, first match wins, in `lib/identity.js`)

`resolveIdentity(header, persistedRecords)` — called once per session at `agent/created`, before
any feature gate. Each run records which rule fired (`resolvedBy`).

1. **Persisted identity first (P1 fast path).** If a prior
   `plugin:tokeneconomizer/project-identity` record (or the state-root stamp
   `~/.tokeneconomizer/repos/<key>/identity.json`) exists for this session's `projectDir` and its
   `schemaVersion` is current, return it verbatim, without recomputing. A later reader never
   recomputes from a path.
2. **Canonicalize.** `canon = fs.realpathSync(projectDir)` when the path exists on disk; else
   `path.resolve(projectDir)` (lexical). Record `canonKind: 'realpath' | 'lexical'`. (G-A-03: DSH's
   header cwd is raw and non-canonical — validation is `isAbsolute` only,
   `dsh-session/lib/types/index.js:45-49` — while the workspace registry realpaths
   (`dsh-workspace/lib/types/paths.js:43-48`); the plugin picks realpath and says so.)
3. **Git repo with a remote.** Walk up from `canon` to the first `.git` entry (`isGitEntry`,
   retained from `repokey.js:68-86`), then `git config --get remote.origin.url` (`originUrl`,
   `repokey.js:154-185`). `resolvedBy = 'git-remote'`;
   `key = slug(normalizeRemote(url)) + '-' + digest(url)` — the existing BY_REMOTE rule
   (`repokey.js:19, 204-235`). Move-invariant (G-A-12): a directory rename keeps the key.
4. **Git repo without a remote (bare checkout).** `resolvedBy = 'git-path'`;
   `key = slug(basename(repoRoot)) + '-' + digest(repoRoot)`. A linked worktree resolves to its
   main clone (`gitCommonDir`/`mainCheckout`, `repokey.js:111-153`) so worktree and main share the
   key. `moveSensitive: true` is recorded — a later move is detectable, not silent.
5. **No git root (plain directory).** `resolvedBy = 'dir'`;
   `key = slug(canon) + '-' + digest(canon)`. `moveSensitive: true`.
6. **Subdirectory session.** Step 3's upward walk lands on the repo root, so a session in
   `/repo/src` and one in `/repo` resolve to the same key (G-A-11 fixed at the identity level, not
   per-payload). `liveDir` may still be the subdirectory for payloads.
7. **Symlinked cwd.** `canon` is the realpath (step 2), so `/a/link` and `/a/real` share one key;
   the record stores both the raw header cwd and the canonical path.
8. **Directory rename/move.** Identity is a property of the persisted record, not the current path
   (P7). A new session in the moved location resolves via rule 3 (remote unchanged → same key); a
   rule-4/5 project is `moveSensitive` and its adoption check (below) reconciles. The key never
   changes silently.
9. **No header cwd.** `resolvedBy = 'unanchored'`, `key = null`, `projectDir = null`; engine path
   and recall disabled. No `process.cwd()` fallback, ever (G-B-10).
10. **Engine key.** `engineRepoKey = key` for rules 3–5 — the engine's partition is keyed by the
    same identity the plugin chose. Persisted on the record; never re-derived later (P7). The
    old per-hit `repoKeyFor(hit.cwd)` walk (`lib/index.js:1013-1023`, G-A-04) is replaced by one
    record read per session.

#### Persistence design

Two coordinated stores, written at resolution time, never later:

- **In-log**: `appendPluginRecord(session, 'plugin:tokeneconomizer/project-identity', payload)`
  (`dsh-session/lib/types/index.d.ts:124`; record name satisfies the grammar at `:57-59`).
  Survives fork/resume; read back via `pluginRecordOf`
  (`dsh-session/lib/index.js:2142`) and a `SessionProjectionMap` augmentation (idiomatic pattern:
  `dsh-experimental-worktree/lib/types/projection.d.ts:1-13`).
- **State root**: `~/.tokeneconomizer/repos/<engineRepoKey>/identity.json` — same payload plus
  `dshSessionId`. Written by `lib/identity.js` **through `lib/bridge.js`** (the plugin's own
  engine/reducer boundary — never a direct file write from the host process, per the Stage-3
  constraint on `~/.tokeneconomizer`).

The record payload:

```
plugin:tokeneconomizer/project-identity: {
  projectDir: string | null,     // canonical anchor (realpath), from the immutable header
  rawCwd: string | null,         // header cwd as received, pre-canonicalization
  canonKind: 'realpath' | 'lexical',
  resolvedBy: 'git-remote' | 'git-path' | 'dir' | 'unanchored',  // HOW it resolved
  key: string | null,            // the resolved identity key
  moveSensitive: boolean,        // true when resolvedBy ≠ git-remote
  engineRepoKey: string | null,  // persisted WITH the data (P7)
  parentSession: string | null,  // header parent session id, when present
  delegationDepth: number,       // 0 root; parent's depth + 1 for children
  schemaVersion: 1,              // payload shape version
  resolvedAt: number             // epoch ms
}
```

Emphasis, per the contract invariant: **persist the key with the data.** A later reader —
cold-start importer, devstats, recall — reads `engineRepoKey` from the record and never recomputes
it from a path (`lib/index.js:997` and `:1021` are replaced by record reads). `resolvedBy` and
`canonKind` are stored so a rule change is an explicit migration (re-resolve under the new rule,
append a new record, keep the old key readable), not a silent re-partition (G-A-01, P1, P7).

#### Migration — adopting existing `~/.tokeneconomizer/repos/<key>/` state

Measured: `repos/` has 31 entries, 15 of them test debris (`te-side-*`, `tmp-*`, `benchtest-*`).
Rule: **adopt, never orphan.**

1. On first resolution of a project, if the resolved key matches an existing `repos/<key>`
   directory → adopt: nothing moves; the identity record simply references it.
2. If the resolved key has no directory, run the **migration-only** function
   `legacyKeyFor(projectDir)` — the retired `repokey.js` rule kept verbatim inside
   `lib/identity.js`, marked `@migration`, never on the live path. If a legacy key directory
   exists and its recorded identity (engine `repo.json`, which records no path — G-A-01) is
   consistent with this project's `projectDir`/remote, **keep the existing directory** and write
   an `identity.json` shim mapping the new `identityKey` → the existing dir. The ledger and
   evidence under the legacy key stay valid; nothing is renamed or deleted.
3. **Wrong-adoption detection.** A record whose `remote` disagrees with the directory's current
   remote, whose `resolvedBy` contradicts the persisted `identityKey`, or where two live sessions'
   records carry different `projectDir` values but the same `key` (one of which no longer
   realpaths on disk) is **not** adopted: the session runs on a fresh key so evidence cannot
   cross-contaminate, and the conflict raises a P4 loud warning (once per key via
   `lib/watchdog.js`) plus a `bin/dsh-te.mjs doctor` line. Wrong adoption is loud, not silent.
4. Test debris is never silently merged: the adoption pass emits a list; removal is the explicit
   `dsh-te.mjs purge` action, never an automatic delete.

#### Root and subagent sessions

- **Every session** resolves identity (P8): `agent/created` fires for all, `identity.js` runs for
  all, the record is written for all. Only feature attachment is gated.
- `parentSession` comes from the session header; `origin` is presentation metadata
  (`dsh-session/lib/types/types.d.ts:71-86`). When `header.parentSession` is present,
  `delegationDepth = parent.depth + 1`, the parent's depth read from the parent's own identity
  record via `pluginRecordOf` when available (else `0` — the depth is advisory; the key is not).
- A subagent **inherits its parent's `projectDir` when its own header lacks `cwd`**; when it has
  one (e.g. a worktree child), it resolves independently. The child's record carries its own
  `key` **and** `parentSession`, so "this project's sessions" groups by key and the delegation
  tree groups by `parentSession`.
- The root-only engine gate is driven by identity `kind` (`'root' | 'subagent'` from
  `parentSession` presence — not `origin` alone, per G-B-02/R3) plus the log-only
  `subagent/descriptor` `mode` (`'one-shot' | 'continuable'`,
  `dsh-subagent/lib/types/descriptor.d.ts:26-53`): a `continuable` child may be opted into the
  engine path by config; `one-shot` children never export. An unrecognized future `origin` value
  degrades-once and defaults to subagent treatment (fail-safe: never double-run the root path).
- Memory levers (dedup, watchdog, prefix, interrupt) run in every session regardless of kind —
  unchanged from today's contract intent, now keyed off persisted identity, not `origin`.

#### What happens to `lib/repokey.js` (238 lines)

Folded **entirely** into `lib/identity.js`; the file is deleted (W1-A, §3.2 matrix). The plugin's
re-implementation of the engine's key rule (G-A-14) is thereby confined to one module and one
call site, bounding the blast radius of any future engine canonicalization change:

| `repokey.js` part (lines) | Fate in `lib/identity.js` |
|---|---|
| `slug` (:32-44), `digest` (:46-53) | retained verbatim — key-encoding primitives |
| `realOrLexical` (:55-66) | replaced by algorithm step 2 (`canon` + `canonKind`) |
| `isGitEntry` (:68-86), `findRepoRoot` (:87-110), `gitCommonDir` (:111-142), `mainCheckout` (:143-153), `originUrl` (:154-185), `normalizeRemote` (:186-203) | retained as the git-discovery primitives of steps 3–4 |
| `repoIdentity` (:204-235), `repoKeyFor` (:236-238) | **deleted as the live path**; replaced by `resolveIdentity()`; the 12 `state.cwd` consumers in `lib/index.js` become `state.identity` / `state.liveDir` consumers |
| The engine-rule re-implementation (docstring :1-12, "reproduces the rule exactly") | retained **only** as `@migration`-marked `legacyKeyFor()` behind a test fixture; never on the live path |

#### UNVERIFIABLE — the engine's own key algorithm

The claim that `repokey.js` reproduces the vendored engine's key rule "exactly" is **UNVERIFIABLE**
against the engine: the plugin's docstring asserts it, but no engine-side key algorithm was
verified in the measurements (the vendored engine at
`~/.tokeneconomizer/vendor/TokenEconomizer-6141bb92/` was not read for this; INFERRED). The probe
that resolves it: a `bin/dsh-te.mjs doctor --probe-engine-key` mode that (a) picks N
representative directories (repo-with-remote, bare checkout, subdirectory, symlinked path),
(b) runs the engine's own repo-opening code through the `te hook` boundary and reads back the
engine's chosen key, (c) diffs it against `legacyKeyFor()` and the new algorithm's key, and
(d) prints the divergence table. Until that probe runs, the blueprint treats the engine key as
persisted-but-possibly-divergent and keeps the adoption procedure (§3.3, migration) as the
reconciliation mechanism. `resolvedBy` on every record makes any divergence a migration, never a
silent re-partition.


### 3.4 Surface-write attribution

Closes **G-B-01** (attribution), **G-B-03** (permission for rewriting the model-visible surface), **G-B-08** (`surface.nodes` currency), **G-B-09** (no persisted tiering record). Blocker class.

**Two attribution modules, one division of responsibility.** `lib/attribution.js` is the **record** layer: it appends and reads `plugin:tokeneconomizer/*` records, owns the `PluginRecordMap` augmentation, and is the single module allowed to call `session.append`/`pluginRecordOf`. `lib/surface-attribution.js` is the **surface-rewrite** layer: it validates the current surface node, composes the `surfaceOp` replacement, and pairs each record with its replacement event. The two are distinct concerns and distinct files; this section and §5 name them accordingly.

**Problem (measured).** The plugin appends `compaction/prune` plus a `tool/result` replacement carrying `surfaceOp: { op: 'replace', startSeq, endSeq }`. The harness pruner (`dsh-compaction-tool-result-pruner/lib/index.js:159-177`, marker `PRUNE_MARKER` at `:8`) writes **the same shape**, and `compaction/prune` has **no producer field**. Result of the measurement run: 2,052 structural rewrites — 1,873 plugin, 179 harness — and the measurement script attributed the harness's 179 to the plugin. Attribution must move from payload-shape inference to a first-class record.

#### 3.4.1 Record design (G-B-01, G-B-09)

Three record types, names satisfying the grammar (`plugin:` + slash-separated segments of lowercase letters, digits, `.`, `_`, `-`, each segment starting alnum — verbatim from `dsh-session/lib/types/index.d.ts:100-127`).

**Record 1 — `plugin:tokeneconomizer/surface-rewrite`** (one tiering rewrite, written at the same moment as the `surfaceOp` replacement)

| Field | Type | Required | Why it exists |
|---|---|---|---|
| `op` | `'replace' \| 'append'` | yes | mirrors the paired `surfaceOp` op so a reader can join record ↔ event without shape inference |
| `startSeq` | number | yes (for `replace`) | inclusive start of the replaced node range, identical to `surfaceOp.startSeq` |
| `endSeq` | number | yes (for `replace`) | inclusive end, identical to `surfaceOp.endSeq` |
| `targetKind` | `'tool/result' \| 'assistant' \| 'user'` | yes | which node kind was rewritten; harness pruner only ever writes `tool/result` |
| `tier` | `'hot' \| 'warm' \| 'cold'` | yes | the tier decision that triggered the rewrite (joins to Record 2) |
| `charsBefore` | number | yes | content length before rewrite — the token-saving numerator |
| `charsAfter` | number | yes | content length after |
| `sourceEventSeqs` | number[] | yes | copied from the event's `sourceEventSeqs`, not inferred |
| `producer` | `'plugin'` | yes | the constant that makes this record unambiguous; harness pruning never writes it |
| `reason` | string | yes | short machine-readable cause, e.g. `'tier:cold'`, `'loopguard:repeat'` |
| `turn` / `step` | number | yes | from the trigger payload; lets the GUI group rewrites per step |

**Record 2 — `plugin:tokeneconomizer/tier-decision`** (why a node was graded hot/warm/cold)

| Field | Type | Required | Why it exists |
|---|---|---|---|
| `nodeSeq` | number | yes | the graded node |
| `nodeKind` | string | yes | node kind at grading time |
| `tier` | `'hot' \| 'warm' \| 'cold'` | yes | the decision itself |
| `scores` | `Record<string, number>` | yes | the feature scores that produced it (recency, size, repetition, role weight) |
| `policyVersion` | string | yes | which tiering policy revision graded it — decisions are re-auditable across upgrades |
| `decidedAtTrigger` | `'agent/pre-step' \| 'agent/request' \| 'session/event'` | yes | which trigger made the decision; needed for §3.5.2's dual-trigger support |
| `turn` / `step` | number | yes | provenance |

**Record 3 — `plugin:tokeneconomizer/toolprune-applied`** (our own prune action, distinct from the harness's)

| Field | Type | Required | Why it exists |
|---|---|---|---|
| `nodeSeq` | number | yes | the `tool/result` node pruned |
| `marker` | `'\n\n[... token-economizer prune ...]\n\n'` | yes | our own marker constant, deliberately different from the harness's `PRUNE_MARKER` so content-level disambiguation is also possible |
| `reason` | `'tier:cold' \| 'loopguard:repeat' \| 'age'` | yes | why this tool result was pruned |
| `charsBefore` / `charsAfter` | number | yes | saving accounting |
| `pairedRewriteSeq` | number | no | seq of the `surface-rewrite` record emitted in the same batch, when one was |

Rationale for records over the §2.7 alternative: a genuinely new `SessionEventMap` entry (the `image/offload` pattern) requires editing `KNOWN_SESSION_EVENT_TYPES` inside the session package — not available to an external plugin. `appendPluginRecord` is already `ignorable` and already outside `SessionEventMap`. INFERRED: the same reasoning is stated so a reviewer can check it against `dsh-session/lib/index.js:79`.

#### 3.4.2 `PluginRecordMap` augmentation (copyable)

Follows `dsh-action-cards/lib/types/types.d.ts:68-74` and `dsh-experimental-worktree/lib/types/projection.d.ts:1-13` verbatim in shape:

```ts
// dsh-token-economizer/lib/types/records.d.ts
import type {
  PluginRecordMap,
} from '@deepseek-ai/dsh-session/types';

export interface TokenEconomizerSurfaceRewrite {
  readonly op: 'replace' | 'append';
  readonly startSeq?: number;
  readonly endSeq?: number;
  readonly targetKind: 'tool/result' | 'assistant' | 'user';
  readonly tier: 'hot' | 'warm' | 'cold';
  readonly charsBefore: number;
  readonly charsAfter: number;
  readonly sourceEventSeqs: readonly number[];
  readonly producer: 'plugin';
  readonly reason: string;
  readonly turn: number;
  readonly step: number;
}

export interface TokenEconomizerTierDecision {
  readonly nodeSeq: number;
  readonly nodeKind: string;
  readonly tier: 'hot' | 'warm' | 'cold';
  readonly scores: Readonly<Record<string, number>>;
  readonly policyVersion: string;
  readonly decidedAtTrigger: 'agent/pre-step' | 'agent/request' | 'session/event';
  readonly turn: number;
  readonly step: number;
}

export interface TokenEconomizerToolPruneApplied {
  readonly nodeSeq: number;
  readonly marker: string;
  readonly reason: 'tier:cold' | 'loopguard:repeat' | 'age';
  readonly charsBefore: number;
  readonly charsAfter: number;
  readonly pairedRewriteSeq?: number;
}

declare module '@deepseek-ai/dsh-session/types' {
  interface PluginRecordMap {
    'plugin:tokeneconomizer/surface-rewrite': TokenEconomizerSurfaceRewrite;
    'plugin:tokeneconomizer/tier-decision': TokenEconomizerTierDecision;
    'plugin:tokeneconomizer/toolprune-applied': TokenEconomizerToolPruneApplied;
  }
}
```

Import path `@deepseek-ai/dsh-session/types` is the module-augmentation path verified in `dsh-session/package.json:16-26`; the runtime function `appendPluginRecord` comes from the `"."` export. Record names are fixed identifiers; `toolprune-` mirrors the engine's own key prefix. Changing one is a migration, not a rename.

#### 3.4.3 Write path, ordering, failure policy

In the new module layout: `lib/tiering.js` produces the decision (Record 2), `lib/rewriter.js` builds the replacement event, and `lib/attribution.js` is the single module that appends records. Ordering:

1. `tiering.js` appends `tier-decision` **first** — a decision record must exist even if the rewrite never happens (e.g. validation failure per G-B-08).
2. `rewriter.js` constructs the replacement event with `surfaceOp: { op: 'replace', startSeq, endSeq }`, validating per §3.4.4.
3. `attribution.js` appends `surface-rewrite` **after the replacement event is accepted** into the same `append(inputs)` batch if batched, otherwise immediately after the single append resolves.

Failure policy — no corruption in either direction:

| Failure | Policy | Why it is safe |
|---|---|---|
| Record append fails, replacement succeeded | Log a plugin-side console warning; retry the record once; never retry the replacement | The log's interpretation of events is unaffected by records (`ignorable`, §2.1 verbatim contract); a missing record only degrades attribution, never structure. The replacement is already durable. |
| Record append fails, replacement also fails | Abort the whole tiering action; nothing is written | No partial rewrite exists, so no attribution gap; the node stays unrewritten and will be re-tiered next step. |
| Replacement fails, record succeeded | Keep the `tier-decision` record; do **not** append `surface-rewrite` (it describes an actual rewrite) | Decision records describe intent; rewrite records describe effect. Mixing them would corrupt measurement. |

INFERRED: records and the replacement event are appended via the batch form `append(inputs)` where possible (see §3.5.4), so ordering within one batch is the declared order.

#### 3.4.4 Read path (G-B-08 discipline)

All readers go through `pluginRecordOf` (`dsh-session/lib/index.js:2142` exports it; declared alongside `appendPluginRecord` at `dsh-session/lib/types/index.d.ts:124`):

- **Measurement** (`scripts/measure-token-saving.mjs`, workspace root — see §3.4.5): scans records, joins `surface-rewrite` records against surface nodes, counts `producer: 'plugin'` vs everything else.
- **GUI** (`토큰절약기` panel): reads `tier-decision` records for a per-node tier history and `surface-rewrite` for savings-over-time.
- **Self-audit**: replays both record types against the current surface to confirm each recorded `startSeq/endSeq` range still resolves to a node whose content matches `charsAfter` (drift detection).

**Session projection — yes, warranted.** Both real precedents (`dsh-action-cards`, `dsh-experimental-worktree`) pair the `PluginRecordMap` augmentation with a `SessionProjectionMap` augmentation for read-back; that is the idiomatic pattern (record in the log, projection for queries). The blueprint adds a `SessionProjectionMap` entry exposing `attributedRewrites` (the joined view of rewrite + decision records) so the GUI reads one projection instead of re-implementing the record join. Precedent citation: `dsh-experimental-worktree/lib/types/projection.d.ts:1-13`.

#### 3.4.5 Migration of legacy ledger records

971 existing ledger records (plugin-internal ledger, outside the session log) carry no attribution. Post-change measurement separates:

| Class | How identified | Treatment |
|---|---|---|
| New attributable rewrites | `plugin:tokeneconomizer/surface-rewrite` records exist | Counted fully; joined to decisions |
| Legacy ledger rewrites (plugin-side) | Present in the old ledger, absent as records | Counted as plugin-attributed but flagged `legacy: true`; excluded from attribution-confidence metrics |
| Harness pruning | No record, `compaction/prune` shape from `dsh-compaction-tool-result-pruner` | Never attributed to the plugin again |

**`scripts/measure-token-saving.mjs` must switch from shape-inference to records.** It currently attributes by payload shape — the exact mechanism that mis-attributed the 179 harness rewrites. Post-change it must read `pluginRecordOf` results (or the persisted log's plugin-record section) and count `surface-rewrite` records with `producer: 'plugin'`. The script lives at the workspace root, outside the package, so the blueprint only specifies its contract, not its file. Until the switch lands, measurement output must carry a banner that harness prunes are counted as plugin rewrites (known defect of the old method).

#### 3.4.6 Zero token cost (verbatim contract)

The doc comment at `dsh-session/lib/types/index.d.ts:100-127`, verbatim:

> **A reader that does not recognize the type retains and skips the record, which never enters the model-visible surface**, and fork and resume carry it with the rest of the log.

This matters because the plugin's entire purpose is reducing model-visible tokens; an attribution mechanism that itself added tokens to the prompt would be self-defeating. Records are strictly overhead-free for the model surface, and they survive fork and resume, so attribution history follows derived sessions too.

#### 3.4.7 Residual risk: `verify-plugin-record-callers`

Verified facts: the gate exists only inside doc comments in `dsh-session/lib/index.js:1326` and `lib/types/index.js:368`; `grep -rn "verify-plugin-record-callers" <dsh>/ --include='*.js'` finds no script; **no such script ships in the install**. It is a repo-internal lint gate ("this repository"), and an external plugin package is not governed by it.

Residual risk to record: upstream could widen the gate's scope — e.g. by making it a runtime assertion, by scanning installed plugin packages, or by forbidding `plugin:` record types not registered in a manifest. **Detection method**: a CI check in the plugin track that, on every DSH version bump, greps the new DSH install for `verify-plugin-record-callers` and for any runtime export/manifest field referencing plugin-record registration, and fails the version-up gate if the string leaves doc comments. Owner: the plugin track's version-up procedure (same gate that runs `node scripts/audit-installed-vs-packaged.mjs`).

#### 3.4.8 G-B-03 — the discipline for rewriting the model-visible surface

The rewrite happens from inside a waterfall-scope hook (`@mode waterfall` per `runtime-types.d.ts` annotations). The blueprint imposes, and documents as the permission basis:

1. The plugin never rewrites the model-visible surface except via the two legal `surfaceOp` forms, and only `replace` on a current node.
2. Every rewrite is accompanied by a `surface-rewrite` record (§3.4.1), so the action is attributable after the fact — the record *is* the persisted permission trail.
3. Rewrites are triggered only from the tiering decision path; no other code path in the plugin may call `append` on a surface-changing event.

#### 3.4.9 G-B-08 — pre-append validation (`surface.nodes` currency)

Before any replacement is appended, the plugin validates against **the current** `session.surface.nodes` (fresh read, not a cached snapshot):

| Check | Rule | On failure |
|---|---|---|
| Target currency | the node at `startSeq..endSeq` still exists in current `surface.nodes` with the same kind | abort; re-tier next step |
| Single-node rule | a `tool/result` replacement targets exactly one current `tool/result` node | abort |
| Field restriction | the replacement changes **only** `data.message.content` | abort — never other fields |
| Idempotence guard | the target's content is not already our marker / already rewritten | skip, record nothing |

This is the structural closure of G-B-08: a replacement targets a current node and may change only `data.message.content`, checked at append time against a fresh surface read.

G-B-09 is closed by §3.4.1/§3.4.2: the plugin now persists its own tiering (`tier-decision`) and rewrite (`surface-rewrite`) records in the session log, fork/resume-safe.

#### 3.4.10 Record lifecycle and join example

One tiering action, end to end, with the exact append order in the batch (`append(inputs)` input array order = log order):

| Order | Entry | Content sketch |
|---|---|---|
| 1 | event `tier-decision` | `{ nodeSeq: 412, nodeKind: 'tool/result', tier: 'cold', scores: { recency: 0.1, size: 0.9, repeat: 0.4 }, policyVersion: 'tp-3', decidedAtTrigger: 'agent/pre-step', turn: 7, step: 3 }` |
| 2 | replacement event (`tool/result`, `surfaceOp` replace 412..412, content = marker) | the model-visible change itself |
| 3 | event `surface-rewrite` | `{ op: 'replace', startSeq: 412, endSeq: 412, targetKind: 'tool/result', tier: 'cold', charsBefore: 4811, charsAfter: 38, sourceEventSeqs: [412], producer: 'plugin', reason: 'tier:cold', turn: 7, step: 3 }` |
| 4 | event `toolprune-applied` | `{ nodeSeq: 412, marker: '\n\n[... token-economizer prune ...]\n\n', reason: 'tier:cold', charsBefore: 4811, charsAfter: 38, pairedRewriteSeq: <seq of entry 3> }` |

Join rules for readers:

- **Decision → rewrite**: match on `nodeSeq` + `turn` + `step`; a decision with no rewrite within the same batch means validation aborted (§3.4.3 row 3) — counted as "decided, not rewritten", not as an anomaly.
- **Rewrite → surface**: `startSeq..endSeq` must resolve in the *current* surface to nodes whose content length equals `charsAfter`; a mismatch is a drift finding for self-audit (§3.4.4).
- **Harness prune → plugin**: harness pruning writes **no** record. Any structural rewrite in the log with no matching `surface-rewrite` record is classified as harness-produced. This single rule is what fixes the 179 mis-attributions; no payload-shape comparison is used anywhere.

#### 3.4.11 What measurement now counts (per-class accounting)

| Class | Source of truth | Counts toward plugin savings | Notes |
|---|---|---|---|
| Plugin rewrites (new) | `surface-rewrite` records | yes — `charsBefore - charsAfter` summed | fully attributable |
| Plugin decisions, no rewrite | `tier-decision` without matching rewrite | no | visible in GUI as decided-not-executed |
| Plugin rewrites (legacy ledger) | old ledger rows | yes, flagged `legacy` | decays to zero as the log ages |
| Harness pruning | log rewrites with no record | **no** | the 179 class, now correctly excluded |
| Ambiguous (pre-migration log) | shape inference only | no, reported separately | banner requirement §3.4.5 |

### 3.5 Seam capability layer and deprecation migration

Closes **G-C-01..C-07, C-10, C-12..C-15** (and **G-B-06** jointly with C-01, **G-B-04/B-05** jointly with C-04).

#### 3.5.1 Capability probes (`lib/probes.js`)

DSH has no probe API (G-C-15): a plugin cannot ask "does this seam exist?". Discovery is a static seam catalog plus runtime lookup. The idiom in the codebase is `ctx.get(name)` returning `undefined` when a name is absent.

Design of `lib/probes.js`: a static table mapping seam → expected `ctx` key → probe function → meaning of a miss → policy.

```ts
// helper signature
export function probeCtx(ctx: { get(name: string): unknown }, name: string): boolean;
// returns ctx.get(name) !== undefined; absence is the miss signal
export function probeFn(obj: object | undefined, fnName: string): boolean;
// returns obj != null && typeof obj[fnName] === 'function'
```

| Seam | `ctx` key / surface probed | Probe | Meaning of a miss | Policy |
|---|---|---|---|---|
| `agent/pre-step` | agent hook registration map | `probeFn(hooks, 'agent/pre-step')` | trigger does not exist in this DSH | fall back to `agent/request`, then `session/event` (§3.5.2) |
| `agent/request` | agent hook registration map | `probeFn(hooks, 'agent/request')` | deprecated trigger absent | `session/event` fallback |
| `session.surface` | session instance | `probeFn(session, 'surface')` getter | reads must use legacy APIs | degrade to measurement-only mode, warn |
| `appendPluginRecord` | `@deepseek-ai/dsh-session` runtime export | `probeFn(dshSession, 'appendPluginRecord')` | records unsupported | plugin runs without attribution; measurement banner set |
| `pluginRecordOf` | same export | `probeFn(dshSession, 'pluginRecordOf')` | read-back unsupported | GUI reads ledger only |
| `working-directory/change` event | `SessionEventMap` presence at listen time | try-listen and check dispatch | live dir unavailable | use header `projectDir` only, mark `liveDir: null` |
| `session.append` single-event overload | session instance | `probeFn(session, 'append')` + arity check | overload removed | batch form only |

Tier distinction (G-C-14 family): **contract-tier** = the seam is declared in a published `.d.ts` shipped by DSH (e.g. `agent/pre-step` at `dsh-agent/lib/types/runtime-types.d.ts:333-341`, `appendPluginRecord` at `dsh-session/lib/types/index.d.ts:124`, `working-directory/change` at `dsh-working-directory/lib/types/index.d.ts:44-52`). **Internal** = present in source only (`dsh-session/lib/index.js`), no `.d.ts` declaration — e.g. `KNOWN_SESSION_EVENT_TYPES` (`dsh-session/lib/index.js:79`), the harness pruner's internals (`dsh-compaction-tool-result-pruner/lib/index.js:159-177`). The plugin's seams: `agent/pre-step`, `agent/request`, `session.surface`, `appendPluginRecord`, `pluginRecordOf`, `working-directory/change` are contract-tier; `surfaceOp`'s handling details and `KNOWN_SESSION_EVENT_TYPES` membership are internal-tier and must be probed at runtime, never assumed.

#### 3.5.2 Deprecation migration — G-C-01 / G-B-06 (blocker)

Move the tiering trigger from `agent/request` to `agent/pre-step`.

**Ordering question, answered honestly.** The timing contract of `agent/request` (verbatim, facts §2.3): "On step admission, this runs after assembly and `step/start`, before the system prompt and accepted user batch are committed." `agent/pre-step` (verbatim doc): "Reject a proposed step or replace the messages that enter it" — it runs at **step preparation, before assembly**. Therefore `agent/pre-step` does **not** give the exact "after `step/start`, before request assembly" window the tiering rewrite historically used; it fires earlier. This does not break the rewrite: a tier decision made at pre-step still replaces surface nodes before the step's model call in almost all flows, because the surface rewrite is independent of message assembly. The honest consequence if the window does not line up: a rewrite landing one step later still saves tokens on every subsequent step of the turn; only the step in flight keeps its full-size surface. The blueprint does not claim a guarantee the contract does not make. **Fallback (explicit):** a `session/event`-driven path — listen for surface-changing events and run tiering when the surface mutates, giving event-driven currency rather than a hook-window guarantee. INFERRED: the event fallback re-tiers lazily; its savings are bounded by the next step either way.

**Runtime detection and fallback order:**

1. Probe `agent/pre-step` (contract-tier, `runtime-types.d.ts:333-341`). If present, register tiering there, with `decidedAtTrigger: 'agent/pre-step'`.
2. Else probe `agent/request` (`runtime-types.d.ts:352-357`, deprecated — "Retained for existing listeners; do not add new listeners"). Registering a *new* listener there is prohibited by the deprecation note, so this rung is used only if `pre-step` is absent **and** a legacy listener already exists in the process; otherwise skipped.
3. Else `session/event` fallback.

**Future removal detection (G-C-02):** the probe table (§3.5.1) is checked at plugin activation; each miss is recorded in the plugin's own record stream (`tier-decision` with `decidedAtTrigger` showing the fallback actually used) and warned in the GUI. A removal is thus visible on the first activation against the new DSH, before any step runs.

#### 3.5.3 Deprecated read APIs — G-B-04

`eventAt` (`dsh-session/lib/types/index.d.ts:216`), `snapshotEvents` (`:226`), `deriveMessages` (`:235`) are all `@deprecated … new calls are prohibited`. Migration table — this is a migration, not a rename; behaviour differences are the point:

| Current call | Non-deprecated replacement | Behaviour differences the implementer must handle |
|---|---|---|
| `eventAt(seq)` | `session.surface` node lookup by seq (`get surface(): SessionSurface`, `index.d.ts:149`) | surface exposes **current nodes**, including rewrite-applied content; `eventAt` returned the original event. A seq shadowed by a replacement may have no surface node — the reader must treat "absent node" as "shadowed", not as an error. |
| `snapshotEvents(range)` | iterate `session.surface.nodes` (+ `pluginRecordOf` for record streams) | snapshots captured pre-rewrite content; the surface shows post-rewrite content. Any comparison of "original vs current" must read originals from our own records (`charsBefore`), not from the surface. |
| `deriveMessages()` | `SessionMessageProjection` mechanism (`dsh-session/lib/types/surface.d.ts:25-37`) | projections apply during live session **and** detached replay; `deriveMessages` was a one-shot derivation. The plugin's own content changes must be registered as a projection so replay shows the same content the live surface does — otherwise derived messages diverge from the model-visible surface. |

#### 3.5.4 Undeclared `append` overload — G-B-05 / G-C-04

`session.append(type, data, opts)` is not declared in any `.d.ts`; only the batch form `append(inputs)` is. Policy:

- Confined to **one adapter** (`lib/attribution.js`, the only module allowed to call `session.append`).
- The batch form is used wherever more than one event/record is written in one action (§3.4.3 ordering), which is the common case (decision + rewrite + prune records).
- Disappearance detection: the §3.5.1 probe checks for the single-event overload at activation; if absent, everything goes through the batch form.
- **Does the design migrate off the single-event form entirely? No — not yet.** Reason: the single-event form is used for exactly one write that has no batched equivalent in the current call graph (a lone `tier-decision` when tiering runs without a rewrite, e.g. the event fallback path). INFERRED: keeping one call site in the adapter keeps the probe + fallback cheap; the adapter is the single point to migrate when the overload's status clarifies. If the probe shows the overload gone, the adapter switches that call to the batch form with a single-element input.

#### 3.5.5 Declared contract dependencies — G-C-14, G-C-08, G-C-09

Measured: the plugin declares no dependency on the packages whose contracts it uses; its `engines.dsh` range is wide; `dsh.manifestVersion` is never enforced by the loader.

Declarations to add (package.json):

| Declaration | Value (illustrative; pin at version-up time) | Enforced by | Must self-check |
|---|---|---|---|
| `dependencies` | `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-working-directory` (exact or `~` range) | npm install resolution only — this is **contract declaration**, not runtime import | none needed; it is metadata |
| `engines.dsh` | narrow range matching the tested DSH (e.g. `>=X.Y.Z <X.(Y+1).0`) | loader (engines check) — verify against the loader's actual enforcement at version-up | the *lower* bound is the risky half: self-check probe results at activation and refuse activation below the minimum |
| `dsh.manifestVersion` | manifest schema version the plugin was written against | **not enforced by the loader** (measured) — fully self-checked | plugin reads its own field at activation and compares to the host's schema version probe; mismatch → warn + degrade |

Resolution of the tension with the deliberate zero-runtime-import design: this section is about **contract declaration and version assertion, not imports**. Declaring `dependencies` on the DSH packages does not require importing them at runtime; the plugin continues to consume hosts-provided `ctx` objects only. The dependency entries assert *which* contracts the plugin is written against, `engines.dsh` narrows the compatibility claim from "wide" to tested, and the manifestVersion self-check substitutes for the loader's missing enforcement. G-C-09 (version drift silent) is closed by the activation-time self-check, not by the loader.

#### 3.5.6 Untyped boundary values — G-C-11, G-C-12, G-C-13, G-B-02

| Boundary value | Measured problem | Checked-constant design | Unknown value policy |
|---|---|---|---|
| `source.kind` strings (G-C-11) | compared against raw strings; a new kind silently takes the else branch | `const SOURCE_KINDS = Object.freeze({ rewrite: 'rewrite', prune: 'prune', ... })`; all comparisons go through the constant map; an unlisted kind fails a `assertKnownKind()` check at the boundary | fail closed: unknown kind is recorded as `kind: 'unknown:<raw>'` in our own records and excluded from attribution math, never silently classified |
| `header.origin` — single legal value (G-C-12, G-B-02) | the contract declares one legal value; a future agent-team role value would break equality checks | `const ORIGIN_VALUES = Object.freeze(['<measured-legal-value>'])` as a checked constant; `assertKnownOrigin(v)` at the boundary | fail open with a marker: an unrecognized `origin` (e.g. a future agent-team role) is treated as *unknown provenance* — the plugin keeps functioning but marks attribution rows `originUnverified: true` and warns once per session. It must not crash and must not silently mis-attribute (the G-B-01 lesson). |
| `settings.section` slot name (G-C-13) | untyped string slot in the engine config schema (facts §3.1) | `const SECTION_NAMES = Object.freeze(['토큰절약기', ...])` typed as a union; the GUI writes only constants; reads validate | unknown section name → treat as a foreign section: read-only passthrough, no plugin-owned writes into it |

The common shape: every boundary string becomes a frozen constant table plus an `assert*`/`classify*` function at the single point the value crosses into plugin logic. Classification of unknowns is explicit (recorded, warned, excluded) rather than defaulted — that is the direct structural lesson of the 179-mis-attribution defect.

#### 3.5.7 Gap coverage map (this section)

| Gap | Where closed | Mechanism |
|---|---|---|
| G-C-01, G-B-06 | §3.5.2 | trigger migration to `agent/pre-step` with probe + fallback chain |
| G-C-02 | §3.5.2 (removal detection) | activation-time probe, fallback usage recorded, GUI warn |
| G-C-03 | §3.5.3 | deprecated read APIs mapped to surface / projection |
| G-C-04, G-B-05 | §3.5.4 | single adapter, batch-first, probe on the overload |
| G-C-05..C-07 | §3.5.1, §3.5.5 | probe table per seam; contract vs internal tier stated |
| G-C-08, G-C-09, G-C-14 | §3.5.5 | declared dependencies, narrowed engines, manifest self-check |
| G-C-10 | §3.5.2 | `session/event` fallback specified as first-class, not afterthought |
| G-C-11, G-C-12, G-C-13, G-B-02 | §3.5.6 | checked constants + explicit unknown-value classification |
| G-C-15 | §3.5.1 | `lib/probes.js` — static catalog plus runtime lookup, replacing the missing probe API |

INFERRED: G-C-05..C-07 are grouped because their closure is the probe table's seam catalog itself; the per-seam rows in §3.5.1 are the deliverable.

#### 3.5.8 Deprecation sweep at version-up (process closure)

At every DSH version-up (the same gate as the `verify-plugin-record-callers` re-check, §3.4.7):

1. Grep the new install's `.d.ts` files for the three read APIs (`eventAt`, `snapshotEvents`, `deriveMessages`) and the single-event `append` overload; a removal changes the probe matrix.
2. Diff the `@deprecated` annotations: a new deprecation on a seam the plugin uses opens a migration line in the plugin's CHANGELOG before the version-up completes.
3. Re-verify the `agent/pre-step` payload shape (`runtime-types.d.ts:333-341`) — the `PreStepDecision` union (`:117-124`) is the contract the fallback chain depends on; any change to its variants breaks `{ kind: 'enter' }` handling and must be caught here, not at runtime.

### 3.6 The three upstream mechanisms, end to end

All three mechanisms live in the vendored engine `microsoft/TokenEconomizer` @ `6141bb92`,
patched into `~/.tokeneconomizer/vendor/TokenEconomizer-6141bb92/`. Each reaches DSH through
the plugin's child-process bridge (`lib/bridge.js`, 282 lines: `te` / `te-hook`), never a direct
state-root file write. Summary of the three engine homes and their DSH levers:

| Mechanism | Engine home | DSH lever(s) |
|---|---|---|
| Micro-skills | `tokeneconomizer/injection/` + proposer side call | `systemPrompt.context({name, order, text, interpolate, required})` |
| Tool pruning | `tokeneconomizer/toolprune/` + `plugin/fold.py` | `tools.restrict({ deny })` at `agent/created` |
| Failure-loop | `tokeneconomizer/loopguard/` (`turn.py`, `envelope.py`, `rules.py`) | `agent.inject(UserMessage)`, `agent.cancel(cause, {keepInbox})` |

#### 3.6.1 Micro-skills — cross-session fact synthesis and session-start injection

| Aspect | Specification |
|---|---|
| Engine | `tokeneconomizer/injection/` + proposer side call. Modes `off` / `envfacts` / `envfacts+distiller` / `distiller` (`plugin/config.py` `_CHOICES`); cadence `microskills_propose_every` (default 3); caps `microskills_max_facts` (4), `microskills_max_tokens` (150). |
| What the engine does | Every k-th prompt folds accumulating facts; a fact is promoted only after **3-session confirmation**; a new fact contradicting a stored one retires the older; the winner set is injected at session start. `envfacts` builds facts purely from environment observation (cwd, git state, tool availability) — **no model call**; `distiller` additionally runs an LLM side-call to synthesize facts from history. |
| DSH lever | `systemPrompt.context({name, order, text, interpolate, required})` — a durable **user-role context snapshot**, NOT a section. |
| Why not a section | A section change mutates the system prompt bytes and resets the cached KV prefix. The plugin's existing prefix guard already measured this defect: `[tokeneconomizer] prefix: the system prompt changed mid-session, the cached prompt prefix was reset`. A context entry is appended after the stable prefix and does not shift it. |
| Injection mechanics | One named context (`name: "tokeneconomizer.facts"`), fixed `order` after DSH's own contexts, `interpolate: false`, `required: false`. On each session start the plugin fetches the current confirmed fact set from the engine via the bridge and writes the *snapshot text* once. Fact updates mid-session are **not** rewritten into the context of the running session (that would also shift bytes after the snapshot — a bounded cost, but avoid it): the new set takes effect at the next session start. Turn-scope relevance filtering happens engine-side before the text is composed. |
| `envfacts` avoiding a model call | In `envfacts` mode the proposer is deterministic: it reads the already-observed environment events (repo cwd, git branch/dirty state, installed toolchain) and emits fact candidates by rule, so the side-call channel is never opened. `envfacts+distiller`/`distiller` do open it and therefore inherit the judge-side-call failure mode of §3.6.3. |
| Contradictory-fact retirement | Engine-side rule: when a candidate fact contradicts a stored confirmed fact, the older stored fact is dropped from the injection set and the contradiction is logged engine-side; DSH sees only the surviving set. No DSH-side fact logic. |
| Evidence | After injection the plugin appends `plugin:tokeneconomizer/fact-injection` (grammar-valid per `dsh-session/lib/types/types.d.ts:531`) recording: fact count, mode, fact digests, prompt-session seq, timestamp. The record never enters the model-visible surface (`dsh-session/lib/types/index.d.ts:100-127`), so evidence costs zero tokens. |
| Working = observable as | A `plugin:tokeneconomizer/fact-injection` record per session start whose `data.facts` matches the engine's current confirmed set (checkable via `te status` / devstats route); the system prompt bytes are byte-identical across sessions with the same fact set (prefix-guard line stays silent). |
| Degraded mode | `distiller` modes lose the LLM side-call (§3.6.3 defect) → the plugin falls back to `envfacts`-equivalent rule synthesis **with a one-time notice**; `injection` engine unreachable → no injection + `plugin:tokeneconomizer/fact-injection` record with `error` field, and the boot-time capability report marks the seam missing (§3.7). |
| Known defect (measured) | Proposals exist but the **evidence path is uneven**: some injections produce no attributable record. What must change: every injection — success, skip, and failure — appends the record above; `te status` cross-checks record count vs engine injection count and reports drift in the devstats card. |

| Side-call budget | `distiller`-mode proposals share the engine's side-call channel with the loopguard judge and are subject to the same `ACCOUNT_SIGN_IN_REQUIRED` failure (§3.6.3); the fallback order is `distiller` → `envfacts` → no injection, each downgrade noticed once per session. |
| KV-cache invariant (testable) | The property the design must preserve: for two sessions with the same confirmed fact set, every byte before the first user message is identical. The context snapshot guarantees this because the fact text lives in a `systemPrompt.context` entry appended after DSH's own stable prefix; any mid-session fact change is deferred to the next session start rather than rewritten. INFERRED: a fact set that changes every session still pays one cache miss per session — bounded, and cheaper than a mid-session section rewrite which pays it every turn. |

| Config coupling | Micro-skill behaviour keys: `microskills` (mode), `microskills_max_facts`, `microskills_max_tokens`, `microskills_propose_every`. The GUI's `토큰절약기 · 환경설정` page shows the concrete enum from `_CHOICES` (`on` is a write alias only — `ON_VALUE` maps it to `envfacts+distiller`, never stored); the mode the user picks is validated engine-side through `te config set`, and rejection is shown inline with the engine's reason (§3.4). |
| Where the engine's proposal data lives | The fact store is engine-internal under `~/.tokeneconomizer` (`injection/` state); DSH never mirrors it into session events. The session log holds only the evidence record — a session fork/resume carries the record with the log (per `index.d.ts:100-127`), so the audit trail survives forking, but the *fact state* stays engine-owned and repo-keyed. |

#### 3.6.2 Tool pruning — unused-tool tracking, evidence, proposal → applied exclusion

| Aspect | Specification |
|---|---|
| Engine | `tokeneconomizer/toolprune/` + `plugin/fold.py`. Thresholds: `toolprune_evidence` (10 prompts), `toolprune_min_sessions` (2), `toolprune_sessions` (5), `toolprune_quiet_minutes` (60), `toolprune_protect` (never-prune list). Modes `off` / `propose` / `auto`. |
| What the engine does | `fold.py` accumulates per-tool unused evidence across the repo's sessions; after the evidence/session gates and a quiet-idle window, it emits a proposal listing tools unused in that repository. Proposals exist today for **3 of 31 repositories**. |
| DSH lever | `tools.restrict({ deny })` on the **agent scope** — runtime and memory-only, lifted when the agent disposes. Contract (facts capsule §2): it accepts **only names currently visible** and **fails on unknown names**. |
| Ordering problem (measured, documented in current code) | `tools.restrict` must be called at **`agent/created`**, before the loop claims the first message; after that point the first turn already pays the full tool-schema cost. The plugin therefore registers an `agent/created` listener, resolves the repo identity (§3.3 identity), queries the engine for a pending applied proposal, and calls `restrict` synchronously in that listener. |
| Deny-list intersection | The deny list is **not** the engine's raw proposal: the plugin intersects it with the agent's actually-visible tool set (`agent.tools` listing at `agent/created`). Unknown names would throw. The intersection (possibly empty) is what is passed to `restrict`; the full proposal is kept for the evidence record. INFERRED: `tools.protect` entries from `toolprune_protect` are stripped engine-side before the proposal is written, so DSH never re-checks protection. |
| Applied-evidence mechanism | On successful `restrict`, the plugin appends `plugin:tokeneconomizer/toolprune-applied`: `{ tools: string[], countBefore, countAfter, visibleIntersection: string[], proposalId, repoKey, time }`. This is the first time `untool_applied` can become non-empty in evidence — measured live state is `untool_applied: []` across **all 971 ledger records** (`repos/<key>/dsh/ledger.jsonl`): the lever has never applied. |
| Working = observable as | A `toolprune-applied` record whose `countAfter = countBefore − tools.length` and whose `visibleIntersection` is non-empty for at least one repo; the agent's tool listing at `agent/created` excludes those names; `te status` shows the repo as `applied`. Ledger cross-check: the engine's `untool_applied` field becomes non-empty for the first time (against the measured baseline of empty in all 971 records). |
| Tool pruning | countBefore/After | `countBefore` = the agent's visible tool count at `agent/created` before `restrict`; `countAfter` = after. `visibleIntersection` = engine proposal ∩ visible set — the honest subset actually denied. If empty (proposal names nothing visible, e.g. tools renamed since proposal), no `restrict` call is made and the record still lands with `visibleIntersection: []` + `skipped: "no-visible-overlap"` — an applied-nothing is evidenced, not silent. |
| Restore semantics | The GUI exposes one-click `toolprune restore`. Restore = (a) call `tools.restrict` again with an empty deny (the restriction is memory-only, so the *next* agent is born unrestricted — restore applies to agents created after the click, plus INFERRED: `tools.restrict({ deny: [] })` on a live agent where the handle is still reachable), (b) mark the proposal `revoked` engine-side via `te` so it is not re-applied at the next `agent/created`, (c) append `plugin:tokeneconomizer/toolprune-restore` with `{ proposalId, tools, time }`. Prior state source: the engine's own proposal record (`tokeneconomizer/toolprune/` state), not the session log — the session log only evidences that application/restore happened. |
| Degraded mode | Engine unreachable at `agent/created` → no restriction, one-time notice (first fail-open per G-C-07), no applied record; restrict throws on name mismatch → caught, logged as a `toolprune-applied` record with `error` + full proposal, restriction skipped loudly in the devstats card rather than silently. `toolprune: "propose"` mode stops after the proposal and never calls `restrict`. |

| Proposal → applied trigger | Mode `auto`: once the engine marks a proposal ready (evidence + quiet-idle satisfied), it is *pending*; the plugin applies it at the next `agent/created` for that repo. Mode `propose`: the proposal waits for explicit GUI confirmation ("apply" button writes a confirm flag via `te`), then the same `agent/created` path applies it. The engine never applies by itself — DSH-side application is the only path, which is why the 971-record ledger shows zero applications: the old code had no `agent/created` → `tools.restrict` bridge at all. |
| Multi-agent sessions | Each new agent gets its own `restrict` call; a denied tool in one agent does not leak to siblings (agent-scope lever). Every application gets its own evidence record keyed by agent/session. |
| Failure to re-apply | Because the restriction is memory-only, a host restart silently un-restricts tools. That is by contract, not a defect; the plugin re-applies at the next `agent/created`. The evidence trail (proposal → applied → optional restore) is what makes the state auditable across restarts. |

#### 3.6.3 Failure-loop intervention — envelope, gate, judge, redirects, backstop

| Aspect | Specification |
|---|---|
| Engine | `tokeneconomizer/loopguard/` (`turn.py`, `envelope.py`, `rules.py`). |
| Turn envelope | `envelope_pct` (p90, 1–100) of the repository's ended-green turns × `envelope_margin` (0.1) = the turn envelope. Trusted only after `envelope_min_samples` (5) ended-green turns exist for **that project identity** (§3.3 identity, per repo key — not global). |
| Cheap gate | `rules.py` heuristics first: `min_turns` tool calls, `edit_churn`, `distinct_edit_files`, `error_outputs`, `stagnation`. The live config override `{"gate_error_outputs": 100000, "gate_min_turns": 100000}` currently disables gate wakeups entirely — the GUI must show effective vs stored vs default (§3.1). |
| LLM judge | Consulted after the gate, when `gate_min_turns`/`gate_error_outputs` allow, at `judge_confidence` (0.7): the judge returns a verdict + confidence; redirect only if confidence ≥ threshold. |
| Redirects | Up to `loopguard_nudges` (1) per stuck episode via `agent.inject(UserMessage)` — the redirect text comes from the engine verdict, injected as a user message so the model sees it in-flow. |
| Hard backstop | Stuck past `backstop_mult` (2.5) × envelope ⇒ `agent.cancel(cause, { keepInbox: true })` — judge-proof: the judge cannot veto an abort at 2.5× the learned envelope. `keepInbox` preserves the queued user messages so nothing is lost. |
| Before `envelope_min_samples` | The envelope cannot be computed and **the backstop cannot be computed either** (it is a multiple of the envelope). Behaviour: gate heuristics run, judge may still fire (it does not need the envelope), but no envelope-based abort exists — a truly stuck turn can run unbounded until the judge or the user stops it. The GUI/status shows `envelope: learning (n/5)`. |
| Judge availability (measured live defect) | `errors.log` ends with `sidecall dsh: no reply (exit 1) ACCOUNT_SIGN_IN_REQUIRED` — the judge **cannot run today**. Degraded path: no judge ⇒ decisions come from the strict heuristic gate only (`is_stuck`): lower precision, more false redirects on genuinely long-but-productive turns, and no confidence-weighted suppression. This is degrade-**with-notice**, not silent: the plugin detects the side-call failure signature once, sets `judgeAvailable: false` in its status payload, emits a one-time notice, writes a `plugin:tokeneconomizer/loopguard-degraded` record, and the devstats card + `토큰절약기 · 환경설정` page render a visible banner ("judge unavailable — heuristic-only loopguard"). It must not re-probe every turn: one probe per session, cached. |
| DSH levers | `agent.inject(UserMessage)` (redirect), `agent.cancel(cause, {keepInbox})` (abort). Both are probed for existence at mount (constraint 4: no bare property access on contract seams); a missing lever is a loud contract-tier fault (§3.7). |
| Working = observable as | A `plugin:tokeneconomizer/loopguard-*` record per nudge/abort with the triggering evidence (stuck reason, envelope value, judge verdict or `unavailable`); aborted turns actually end with `keepInbox` intact. |

| Envelope learning detail | `envelope.py` computes p90 over ended-green turns **per repo key** using `envelope_pct`; `envelope_margin` scales it. Thresholds are overridable per key through `loopguard_thresholds` (`plugin/config.py:108-125`), so one repo may run conservative (p90 × 3.0) while another runs aggressive. The identity anchor for "which repo's turns" is §3.3's persisted identity — a mis-keyed identity would learn an envelope from the wrong repo's turns, which is one concrete cost of getting §3.8 identity migration wrong. |
| `loopguard_aggr` | `conservative` / `default` / `aggressive` scale how readily the gate wakes the judge (engine-side preset on the threshold dict); orthogonal to `loopguard` mode (`off`/`nudge`/`stop`) which selects the action repertoire. |
| Redirect text source | The nudge message body comes from the engine's verdict payload (reason + suggested course correction), passed through the bridge as the `UserMessage` text; DSH-side code never composes model-facing advice itself. |
| Gate → judge → nudge → backstop sequence | 1. turn ends green ⇒ envelope sample. 2. Gate heuristics fire (`is_stuck` candidates). 3. If gate threshold met and judge available ⇒ judge verdict at `judge_confidence`. 4. Verdict positive ⇒ `agent.inject(UserMessage)` redirect (nudge 1 of `loopguard_nudges`). 5. Stuck duration > `backstop_mult` × envelope ⇒ `agent.cancel(cause, {keepInbox: true})` regardless of judge. 6. `loopguard: "off"` disables 2–5 entirely; `"stop"` skips nudges and goes straight to abort. |
| Judge probe protocol | One probe per session at first gate wakeup; failure signature `ACCOUNT_SIGN_IN_REQUIRED` (or any `sidecall dsh: no reply`) ⇒ cached `judgeAvailable: false` for the session. Next session probes again (sign-in may have been fixed between sessions). The probe result is part of the boot-time capability report's `engine.judge` seam. |

| Env propagation | The engine learns the repository context through `te-hook` folds of each prompt; per `plugin/fold.py` the hook runs at the existing bridge boundary (`lib/bridge.js`), so evidence accumulation needs no new DSH event — it rides the prompts DSH already sends. Constraint 8 note: adding hook wiring must not change the `npm test` green state (164/163/1). |
| Envelope and repo identity coupling | The envelope is per-repository keyed by the engine repo key; identity resolution must therefore precede loopguard wiring in the mount sequence (§3.3 → §3.6.3). A wrong §3.8 identity adoption means the envelope is learned from the wrong repo's turns, making the backstop either trigger-happy or blind. |
| Restore for loopguard actions | Nudges are user messages — not retractable; aborts honour `keepInbox` so queued messages survive. The GUI's restore scope is limited to toolprune restore (§3.6.2); loopguard actions are evidenced, not undone. |

### 3.7 Failure policy — explicit per-seam table

Channels that exist today: `notice()` → stderr line (implemented). Channel to add: persisted
`plugin:tokeneconomizer/diagnostic` records (survive restart, queryable via projection), plus the
**boot-time capability report**. A notice is ephemeral; a diagnostic record is durable; contract-tier
faults get **both**; performance-tier fail-opens get a notice the first time (G-C-07: today they emit
nothing).

**Boot-time capability report** — one summary line per seam at plugin mount, shape:

```json
{ "at": 1731..., "dsh": "0.2.2-rc.3", "plugin": "0.0.1-rc.5",
  "seams": [ { "id": "appendPluginRecord", "tier": "contract", "found": true },
             { "id": "agent/pre-step", "tier": "contract", "found": true },
             { "id": "agent.inject", "tier": "contract", "found": true },
             { "id": "tools.restrict", "tier": "contract", "found": true },
             { "id": "systemPrompt.context", "tier": "contract", "found": true },
             { "id": "agent.cancel", "tier": "contract", "found": true },
             { "id": "working-directory/change", "tier": "contract", "found": true },
             { "id": "session.surface", "tier": "contract", "found": true },
             { "id": "engine.bridge", "tier": "optional", "found": true },
             { "id": "engine.judge", "tier": "optional", "found": false, "reason": "ACCOUNT_SIGN_IN_REQUIRED" },
             { "id": "dedup", "tier": "perf", "found": true } ],
  "missing": ["engine.judge"] }
```

Rendered once into the devstats card header and a `plugin:tokeneconomizer/boot-report` record — so
drift is visible at startup, not at failure time.

| Seam | Tier | Policy | What the user sees | Justification | Gap IDs |
|---|---|---|---|---|---|
| `appendPluginRecord` / `PluginRecordMap` augmentation missing | contract | **loud** | stderr notice + diagnostic record + red seam in boot report; tiering attribution disabled, never silent | A missing contract seam is a deployment/compatibility fault; silence is how G-A-01/G-B-01/G-C-01 went unnoticed | G-B-01, G-B-04 |
| `agent/pre-step` missing | contract | **loud** | notice + diagnostic record; tiering does not run at all | G-C-01's replacement trigger; degrading to `agent/request` would re-introduce the deprecated path | G-C-01 |
| `agent.inject` / `agent.cancel` missing | contract | **loud** | notice + diagnostic record; loopguard nudges/aborts disabled | Core safety lever of §3.6.3 | — |
| `tools.restrict` missing or throwing on name | contract | **loud** | notice + diagnostic record + `toolprune-applied` record with `error` | It is the sole lever for 3.6.2; failing open would silently leave `untool_applied` empty forever (the measured defect) | — |
| `systemPrompt.context` missing | contract | **loud** | notice + diagnostic record; micro-skills disabled | §3.6.1 injection impossible | — |
| `working-directory/change` absent | contract | **loud** | notice + diagnostic record; identity uses header only | Constraint 7; missing event means liveDir tracking silently wrong | G-A-15 |
| Engine bridge (`te`/`te-hook`) unreachable | optional | degrade-with-notice | one-time notice + status `engine: unreachable`; all three mechanisms idle but DSH runs normally | The plugin is an enhancer; losing the engine must not break the host | — |
| Engine judge (side-call) failing | optional, **configured** | degrade-with-notice (loud-ish) | persistent banner on settings page + `loopguard-degraded` record | Configured-but-failing enhancement is not silent degradation (§3.6.3 measured defect) | — |
| `envfacts`/`distiller` side-call failing | optional, configured | degrade-with-notice | notice + fact-injection record with `error` | Same rule as judge | — |
| Boot report generation itself failing | perf | fail-open + notice | stderr line; plugin continues mounting | Reporting must not become a new single point of failure | — |
| Identity conflict (`project-identity` mismatch) | contract | **loud** | `identity-conflict` diagnostic record + settings-page conflict row | Silent re-partitioning is exactly constraint 1's forbidden failure | G-A-01 |
| `history_import` operation failure (cold-start importer) | optional, configured | degrade-with-notice | GUI shows importer progress + failure reason; never an engine config key (capsule §3.3) | Plugin-owned operation, not a config field | — |
| Recall/search-style enhancement never configured | optional, unconfigured | **silent degrade** | nothing | Never-configured means the user opted out | — |
| Surface dedup cache | perf | fail-open + **first-time notice** | one stderr line, then silent retries | Optimisation only; correctness unaffected | G-C-07 |
| Token tiering watchdog / loop breaker | perf | fail-open + first-time notice | one stderr line | Perf seams may fail open but must announce it once (G-C-07) | G-C-07 |
| Prefix guard reset (system prompt changed mid-session) | perf | fail-open + notice | stderr line (already implemented) | Cache loss is a cost issue, not correctness | — |
| Ledger read / fold errors | perf | fail-open + first-time notice | one stderr line | Bad ledger line must not kill the session loop | — |
| Quarantine move fails (permission, path race) | perf | fail-open + first-time notice | one stderr line + maintenance record if possible | Debris cleanup must never block plugin mount | — |
| Projection read-back (`pluginRecordOf`) finds no record | perf | fail-open + first-time notice | one stderr line | Records are ignorable by contract; absence is not fatal | G-B-01 |
| Config value rejected by engine (`te config set`) | contract | **loud** | UI shows the engine's rejection reason inline (§3.4 requirement) | A silently dropped config write is indistinguishable from success | — |
| `plugin:` record `data` fails owner validation on read | contract | **loud** (skip record, report) | diagnostic record + boot-report seam flag | See §3.8 validation rule — a malformed record is a version-skew fault | — |

Rule recap: contract-tier missing ⇒ loud (notice **and** durable diagnostic record); perf-tier
fail-open ⇒ notice the first time only; optional-unconfigured ⇒ silent; optional-configured-failing
⇒ visible banner. This directly answers G-C-07 ("fail-open paths currently emit no notice") and the
root cause of the three blockers going unnoticed.

**Notice vs diagnostic record — channel inventory:**

| Channel | Status | Carries | Lifetime |
|---|---|---|---|
| `notice()` → stderr | implemented today | one line, no structure | ephemeral; lost on restart |
| `plugin:tokeneconomizer/diagnostic` record | **to add** | `{ seam, kind, detail, at }` via `appendPluginRecord` | durable, in-log, queryable via projection, zero token cost |
| Boot-time capability report | **to add** | per-seam found/missing at mount (shape above) | rendered in devstats card header + one record per mount |
| GUI banner (settings page) | **to add** | persistent state of configured-but-failing optional seams | visible until fixed |
| Devstats card seam column | **to add** | red/green per seam from latest boot report | visible at every card open |

First-time-notice bookkeeping: the plugin keeps a per-process `noticedOnce` set (perf seam id →
noticed); it is deliberately not persisted — a restart may re-notice once, which is acceptable noise
for perf seams and avoids new durable state for a non-durable concern.

### 3.8 Migration and compatibility — adopt existing state, never orphan it

#### Existing state root `~/.tokeneconomizer` (707 MB)

| State | Action |
|---|---|
| `vendor/TokenEconomizer-6141bb92/` | Adopted untouched — the pinned engine is the source of truth. |
| `config.json` | Adopted; new code reads it through the same bridge. Live override `{"gate_error_outputs": 100000, "gate_min_turns": 100000}` is surfaced in the GUI as *stored override ≠ default* (§3.1). |
| `repos/<key>/dsh/ledger.jsonl` (971 records for dsh-plugins) | Adopted read-only for history; new writes keep appending (format unchanged — it is the engine's ledger, not the plugin's). |
| Session/proposal/engine-internal state | Adopted; regenerated only where the engine itself regenerates it (envelope stats). |
| What is regenerated | Turn envelopes are recomputed from `repos/<key>` turn history when samples exist; nothing is re-derived from a session path (constraint 1 — identity is persisted, never recomputed). |
| What is left untouched | `vendor/` tree, `config.json` bytes, ledger append history, the 16 real repo keys and their fold state. The plugin writes into the state root only through the `te`/`te-hook` boundary (§3.4); no direct file writes. |
| 15 test-debris dirs (`te-side-*`, `tmp-*`, `benchtest-*` of 31) | **Quarantined, not deleted**: moved (with their contents) to `~/.tokeneconomizer/quarantine/<date>-<name>/`, recorded in a `plugin:tokeneconomizer/maintenance` record. The repo rule forbids deleting a directory to remove contents; the shell directory stays, the GUI "inspect" panel filters debris by default and shows quarantine count. The 16 real repo dirs keep their keys. |

#### Existing ledger — no attribution (measured: `untool_applied` empty in all 971 records)


| Question | Answer |
|---|---|
| Read post-change | New code still reads `repos/<key>/dsh/ledger.jsonl` through the engine bridge. Every record lacking a `plugin:tokeneconomizer/*` counterpart in the session log is **legacy-unattributable**. |
| Reporting split | Devstats reports two counters: `legacyRewrites` (ledger rows with no matching `plugin:tokeneconomizer/surface-rewrite` record — countable but not attributable to a decision) and `attributedRewrites` (record-backed). Never merge them. |
| Backfill | **Not possible, say so plainly.** The legacy rows carry no producer discriminator (that is exactly G-B-01), so no amount of post-hoc code can prove which rows the plugin wrote vs the harness pruner (`dsh-compaction-tool-result-pruner/lib/index.js:159-177` writes the identical shape). Backfill would be fabrication. Attribution starts at the first new record. |

#### Identity migration (old engine repo keys → new persisted identity)

| Step | Mechanism |
|---|---|
| Adoption | On first mount per session, the plugin resolves the new persisted identity from the immutable session header (constraint 1), then maps it to the existing engine repo key via the same slug path the engine uses (`plugin/fold.py` keying). The resolution **method** is stamped in `plugin:tokeneconomizer/project-identity` (`{ resolvedBy, engineKey, projectDir }`). |
| Mapping rule | `engineKey` = the engine's existing repo key for `projectDir` (the lossy path slug today, G-A-01). The new identity *persists* the header-derived anchor and links it to that key; the engine key itself is not renamed, so the engine's 16 real repo states keep their history. |
| Wrong-adoption detection | If the stamped `engineKey` for a session header differs from the engine's current lookup for that `projectDir` (i.e. two headers map to one engine key or vice versa), the plugin writes a `plugin:tokeneconomizer/identity-conflict` diagnostic record and shows the conflict on the settings page — it does not silently re-partition. A rule change to identity resolution is an explicit migration (new `resolvedBy`), never a silent re-key. |
| Rollback | Identity records are additive: reverting to old code simply stops consulting them; the engine's own keying is unchanged, so old code keys exactly as before. Nothing to undo. |
| `working-directory/change` interplay | The header's `projectDir` is the identity anchor (immutable); the event's `cwd` is `liveDir` only (facts capsule §2.4). Migration never keys identity from `liveDir`, and a `working-directory/change` never triggers re-adoption — it updates `liveDir` in the identity record's live companion state, evidenced in the next `project-identity` update record. |

#### Version and format — `plugin:tokeneconomizer/*` schema stamp

Every record's `data` carries `{ v: 1, ... }` (schema version stamp; the record `type` itself is
stable). **Validation rule (the contract):** the record carries whatever an earlier build wrote, and
the owner plugin is the only validator — on read, `data` must be an object with an integer `v`
the current code understands (`v <= CURRENT`); fields outside the known schema for that `v` are
preserved, unknown `v` ⇒ skip the record, emit a diagnostic record and a boot-report seam flag.
Never assume `data` shape: `appendPluginRecord` snapshots whatever was passed
(`dsh-session/lib/types/index.d.ts:124`), so older/newer builds may legitimately differ. Readers
that do not recognize the type retain and skip it anyway (`index.d.ts:100-127`) — the risk is only
the *owner* misreading its own older data.

| Case | Behaviour |
|---|---|
| New build reads older record (`v: 1`, known) | Accept; unknown extra fields preserved, never stripped. |
| New build reads record with unknown higher `v` | Skip + diagnostic record + boot-report flag; the read loop continues. |
| `data` not an object or `v` missing/non-integer | Treat as unknown-version (skip loudly). |
| Older build encounters newer record *type* | Session core retains-and-skips it (`index.d.ts:100-127`) — safe by contract. |

Record grammar: names satisfy `plugin:` + slash-separated segments of `[a-z0-9._-]`, each starting
alnum (`types.d.ts:531`); all names in this blueprint (`fact-injection`, `toolprune-applied`,
`toolprune-restore`, `loopguard-degraded`, `project-identity`, `identity-conflict`, `boot-report`,
`diagnostic`, `maintenance`) comply.

#### Rollback to rc.5 behaviour

| Aspect | Answer |
|---|---|
| What new code writes that old code ignores | `plugin:tokeneconomizer/*` records in session logs (ignorable, skipped by readers per the doc contract) and quarantine moves under `~/.tokeneconomizer/quarantine/`. rc.5 ignores both — no cleanup required for rollback. |
| Procedure | Disable new plugin → reinstall rc.5 build → engine state (`config.json`, `repos/`, ledger) is shared and format-compatible, so rc.5 resumes from the same state root. `tools.restrict` restrictions are memory-only and die with their agents — nothing persists. |
| Losses on rollback | Attribution of everything written since the upgrade (records remain in logs but rc.5 does not read them); applied toolprune decisions (they were memory-only anyway). |
| Config compatibility | New code adds no engine config keys (capsule §3.3: `history_import` is a plugin operation, not a config field), so rc.5 reads the same `config.json` unchanged. GUI-only state (boot report, banner flags) lives in session records, invisible to rc.5. |

#### Test/CI implications

Baseline: `cd dsh-tokeneconomizer && npm test` → **164 tests / 163 pass / 1 skip** must stay green
(constraint 8); plus `node scripts/check-doc-links.mjs` and `npm run docs:check` from the repo root.
Existing tests must not be weakened (constraint 9).

| Test | Add or repurpose | Asserts |
|---|---|---|
| `test/prefix-guard.test.*` | **Repurpose** | context-snapshot injection does not mutate system-prompt bytes; the guard line does not fire for context entries |
| new `test/microskills-evidence.test.*` | **Add** | every injection/skip/failure appends `plugin:tokeneconomizer/fact-injection`; `envfacts` performs zero side-calls; 3-session confirmation respected; contradictory fact retired from the injected set |
| new `test/toolprune-apply.test.*` | **Add** | `agent/created` ordering; deny ∩ visible intersection; unknown-name failure handled loudly; `toolprune-applied` record fields (`countBefore/After`, `visibleIntersection`); restore revokes + records; `propose` mode never applies |
| new `test/loopguard-degraded.test.*` | **Add** | judge-unavailable ⇒ heuristic-only path + one-time notice + banner flag; pre-`envelope_min_samples` ⇒ no envelope abort, gate still runs; `backstop_mult` abort bypasses judge verdict; `keepInbox` preserved on cancel |
| `test/failure-policy.test.*` | **Add** | contract-seam-missing ⇒ loud (notice + diagnostic record); perf fail-open ⇒ first-time notice only; boot report lists every seam |
| `test/migration.test.*` | **Add** | legacy ledger rows counted as `legacyRewrites`, never attributed; quarantine moves preserve directory shells; identity conflict detection; `v` validation skips unknown versions with a diagnostic |
| existing 164 | unweakened | if a test's meaning legitimately changes (e.g. attribution now via records), the replacement assertion is named in the PR and covers the old invariant |

Docs gates: any new `dsh-tokeneconomizer/docs/*.md` needs an English skeleton header; the blueprint
doc itself goes through `npm run docs:check` and `node scripts/check-doc-links.mjs`; per-track
CHANGELOG gets the rc bump entry (rc.5 → rc.6 at first changed session per the version rule).

**Residual risks (explicit, per the capsule's honesty requirements):**
- `agent/pre-step` timing is not contract-guaranteed to be "after `step/start`, before request
  assembly" (capsule §2.3): a tiering rewrite may land one step later, which still saves tokens on
  every subsequent step of the turn. Fallback: `session/event`-driven rewrite if the window proves
  insufficient in measurement. Honest, not claimed as a guarantee.
- `verify-plugin-record-callers` is a repo-internal lint gate only (verified absent from the
  install); an external plugin may call `appendPluginRecord`, but upstream could widen the gate's
  scope in a future release — the boot report's `appendPluginRecord` seam probe is the canary.
- `tools.restrict` on a live agent post-`agent/created` is INFERRED (contract text documents
  creation-time use); the blueprint only guarantees creation-time application and treats live
  re-restrict as best-effort, evidenced only if it succeeds.

**Measurement notes carried into the design:**
- All 971 ledger records: `repos/<key>/dsh/ledger.jsonl`, measured by the Lead, cited as the proof
  that the toolprune lever has never applied end-to-end.
- `errors.log` tail `sidecall dsh: no reply (exit 1) ACCOUNT_SIGN_IN_REQUIRED`: measured, cited as
  the proof that the judge seam is down in the live deployment.
- Prefix-guard measured line `[tokeneconomizer] prefix: the system prompt changed mid-session, the
  cached prompt prefix was reset`: cited as the reason injection must be a context, not a section.

**Report**
- Path: `/tmp/stage2a-frag/04-mechanisms-policy-migration.md`
- Line count: see final measurement below (target 300–400)
- Gap IDs covered: G-A-01, G-A-15, G-B-01, G-B-04, G-B-08, G-C-01, G-C-07
- Degraded modes, one line each:
  - **Micro-skills**: distiller side-call failure ⇒ falls back to rule-based `envfacts` synthesis with a one-time notice; engine unreachable ⇒ no injection + error record + boot-report seam flag.
  - **Tool pruning**: engine unreachable or restrict-throws at `agent/created` ⇒ no restriction applied, one-time notice + `toolprune-applied` record with `error` (never silent, because silent-empty `untool_applied` is the measured defect).
  - **Failure-loop**: judge cannot run (measured `ACCOUNT_SIGN_IN_REQUIRED`) ⇒ strict heuristic `is_stuck` only, visible "judge unavailable" banner + `loopguard-degraded` record; before `envelope_min_samples` ⇒ gate runs, judge may fire, but **no envelope/backstop abort exists**.

## 4. Settings GUI — 토큰절약기 · 환경설정

A second, **interactive** `settings.section` entry beside the existing read-only devstats card
(`tokeneconomizer-devstats`, order 62, `t('devstats.title')` → `토큰절약기 · 개발자 통계`).
Slot id: `tokeneconomizer-settings`, `order: 63`, label `t('settings.title')` → ko
`토큰절약기 · 환경설정`, en `Token Economizer · Settings`.

### 4.1 Information architecture and control inventory

The page has four sections top-to-bottom: **Modes**, **Thresholds**, **Operations**, **Mechanism
status**. Master table first; grouped sub-tables follow.

Master inventory:

| # | Section | UI label | Engine key | Control | Allowed | Default | On save |
|---|---|---|---|---|---|---|---|
| 1 | Modes | 마이크로 스킬 | `microskills` | select | `off`/`envfacts`/`envfacts+distiller`/`distiller` (shortcut chip `on` = `envfacts+distiller`) | `off` | `te config set microskills=<v>` |
| 2 | Modes | 도구 정리 | `toolprune` | select | `off`/`propose`/`auto` (`on` = `auto`) | `auto` | `te config set toolprune=<v>` |
| 3 | Modes | 반복 감시 | `loopguard` | select | `off`/`nudge`/`stop` (`on` = `nudge`) | `nudge` | `te config set loopguard=<v>` |
| 4 | Modes | 강도 | `loopguard_aggr` | select | `conservative`/`default`/`aggressive` | `default` | as above |
| 5–13 | Thresholds | nine rows, below | (below) | number input | (below) | (below) | `te config set <key>=<v>` |
| 14 | Operations | 세션 이력 가져오기 | **not an engine key** | action button + progress | — | — | runs importer, not config |
| 15 | Operations | 정리된 도구 복원 | `toolprune restore` | action button (confirm) | — | — | runs restore |
| 16 | Operations | 기본값 복원 | — | action button (confirm) | per-key or all | — | `te config unset <key>` per key |
| 17 | Status | 마이크로 스킬 확인 | read-only | panel | — | — | — |
| 18 | Status | 정리 대상 도구 | read-only | panel + debris toggle | — | — | — |
| 19 | Status | 판정기 상태 | read-only | degraded banner | — | — | — |

Mode alias rule (**explicit**): `on` is a **write alias only**, never a stored value
(`ON_VALUE`: `microskills → envfacts+distiller`, `toolprune → auto`, `loopguard → nudge`). The UI
must display the concrete stored enum; it may offer an `on` chip that writes the concrete value.

`history_import` rule (**explicit**): a whole-engine grep for `history_import` returns **zero
hits**. It is **not** a config field. It maps to the plugin-owned importer
`bin/dsh-te.mjs cold-start` (flags `--reimport`, `--limit N`, `--all`, `--dry-run`,
`--only <repoKey>`, `--include-missing`) and is exposed as an **action with progress and result**
(§4.2), not a config control. Do not invent an engine key.

Threshold sub-table (the nine):

| UI label | Engine key | Default | Type | Range |
|---|---|---|---|---|
| 마이크로 스킬 제안 주기 (k) | `microskills_propose_every` | 3 | int | ≥1 |
| 도구 정리 근거 수 (p) | `toolprune_evidence` | 10 | int | ≥1 |
| 도구 정리 최소 세션 (m) | `toolprune_min_sessions` | 2 | int | ≥1 |
| 도구 정리 세션 수 (s) | `toolprune_sessions` | 5 | int | ≥1 |
| 정리 대기 시간(분) (q) | `toolprune_quiet_minutes` | 60 | int | ≥0 (only key with min 0) |
| 최소 샘플 수 (e) | `loopguard_thresholds.envelope_min_samples` | 5 | int | ≥1 |
| 판정 신뢰도 (c) | `loopguard_thresholds.judge_confidence` | 0.7 | float | 0.0–1.0 |
| 넛지 횟수 (r) | `loopguard_nudges` | 1 | int | ≥1 |
| 백스톱 배수 (b) | `loopguard_thresholds.backstop_mult` | 2.5 | float | ≥0.1 |

Effective vs stored vs default: measured live override
`loopguard_thresholds: { gate_error_outputs: 100000, gate_min_turns: 100000 }`. Every threshold row
renders **effective** value prominently; a badge `저장된 재정의 / override` marks keys with a stored
override; a `기본값 / engine default` chip shows the engine default; a per-key **초기화 / reset**
button calls `te config unset <key>`. Nested-key serialization over the CLI:
`te config set loopguard_thresholds.envelope_min_samples=5` (dotted form) — bridge verifies the
`config show` echo after each write (§4.3).

Wireframe (ASCII; row order top→bottom, control types marked):

```
┌ 토큰절약기 · 환경설정 ────────────────────────────────────────┐
│ [동작 모드]                                                  │
│  마이크로 스킬  [envfacts+distiller ▾]  (chip: on↔concrete)   │
│  도구 정리      [propose ▾]   반복 감시  [nudge ▾]            │
│                                                              │
│ [임계값]              현재값      기본값        [초기화]      │
│  제안 주기 (k)        [ 3 ]       3            ⟳           │
│  근거 수 (p)          [10]▲       10           ⟳           │
│  ... (9 rows, number inputs, min/max hint under each)        │
│  ⚠ gate_min_turns = 100000 (저장된 재정의) ⟳                 │
│                                                              │
│ [작업]                                                       │
│  [세션 이력 가져오기] [정리된 도구 복원] [기본값 복원]        │
│  import ▸ progress bar + log line + result summary           │
│                                                              │
│ [상태]                                                       │
│  마이크로 스킬: 활성 팩트 3건 · 대안 제안 1건 (보기)         │
│  정리 대상 도구: 3개 저장소 · 증거 보기 [테스트 찌꺼기 표시☐]│
│  ⚠ 판정기 사용 불가: sidecall dsh: no reply                  │
│           (exit 1) ACCOUNT_SIGN_IN_REQUIRED                  │
│           → 휴리스틱 전용으로 동작 중 (nudge/stop 유지)      │
│                                              [저장] (per-row)│
└──────────────────────────────────────────────────────────────┘
```

Repo-list scoping: the engine `repos/` has **31 entries, 15 test debris** (`te-side-*`, `tmp-*`,
`benchtest-*`). The panel defaults to repos with **real evidence or proposals** (3 of 31 have
proposals); a `테스트 찌꺼기 표시 / show debris` toggle reveals the remainder, labelled as debris.

Operations sub-detail (interactive controls beyond config):

| Control | Source | Interaction | Result surface |
|---|---|---|---|
| 마이크로 스킬 확인 | engine micro-skill store via READ route | expand panel | active fact block as rendered at injection + pending proposal text, read-only |
| 정리 대상 도구 보기 | toolprune proposals via READ route | per-repo accordion | tool name + evidence counts (prompts / sessions), `protect` list shown and editable? — **no**: `toolprune_protect` stays a CLI concern this iteration; listed read-only |
| 정리된 도구 복원 | RESTORE route | confirm dialog listing repos+tools to re-admit | toast + status panel refresh |
| 기본값 복원 | RESET route | confirm dialog listing affected keys | per-key result toast |
| 세션 이력 가져오기 | IMPORT job | option row (dry-run checkbox, limit field, repo filter) + start | progress bar, tail log, summary `{imported, skipped, repos}` |

Mechanism-status panel is driven entirely by the single READ route; no polling while idle, one
re-read after every successful write/action.

### 4.2 Route and data contracts

All routes register through `ctx.connection.fetch.register` under
`/api/local/tokeneconomizer/...`, local-host only — same mechanism as the existing devstats route:
the `local/` prefix binds to the loopback local connection surface; non-local origins are rejected
by the host before the handler runs (measured pattern from `lib/devstats-server.js`).

Typed constants (answers G-C-13) — one module, no bare literals:

```js
// lib/constants.js
export const SLOT_ID      = 'tokeneconomizer-settings';
export const SLOT_ORDER   = 63;
export const R = {
  READ:    '/api/local/tokeneconomizer/settings',
  WRITE:   '/api/local/tokeneconomizer/settings/config',
  RESTORE: '/api/local/tokeneconomizer/settings/restore',
  RESET:   '/api/local/tokeneconomizer/settings/reset',
  IMPORT:  '/api/local/tokeneconomizer/settings/import',
  IMPORT_POLL: (id) => `/api/local/tokeneconomizer/settings/import/${id}`,
};
export const KEYS = {
  ENUM: { microskills: ['off','envfacts','envfacts+distiller','distiller'],
          toolprune: ['off','propose','auto'], loopguard: ['off','nudge','stop'],
          loopguard_aggr: ['conservative','default','aggressive'] },
  ON_ALIAS: { microskills: 'envfacts+distiller', toolprune: 'auto', loopguard: 'nudge' },
  INT: ['microskills_propose_every','toolprune_evidence','toolprune_min_sessions',
        'toolprune_sessions','loopguard_nudges'],
  FLOAT: ['loopguard_thresholds.judge_confidence','loopguard_thresholds.backstop_mult'],
  MIN: { 'toolprune_quiet_minutes': 0, '*': 1 },
  RANGE: { 'loopguard_thresholds.judge_confidence': [0.0, 1.0],
           'loopguard_thresholds.backstop_mult': [0.1, null] },
};
```

**READ — `GET /api/local/tokeneconomizer/settings`.** One aggregate read; the page must not make N
round trips (a draft-local editor fires many renders; 10+ sequential child-process calls would make
the page unusable and race the config file).

Request: `{ cwd?: string, host?: string }` (defaults: session cwd, `dsh`).
Response `200`:

```json
{ "values":    { "<key>": <stored value> },
  "effective": { "<key>": <resolved value incl. nested thresholds> },
  "defaults":  { "<key>": <engine default> },
  "overrides": ["loopguard_thresholds.gate_min_turns", "..."],
  "mechanisms": { "microskills": {"activeFacts": 3, "pendingProposals": 1},
                  "toolprune":   {"proposals": [{"repo":"…","tools":[…],"evidence":…}]},
                  "repos": {"total": 31, "debris": 15, "withEvidence": 3} },
  "judge": {"available": false, "reason": "sidecall dsh: no reply (exit 1) ACCOUNT_SIGN_IN_REQUIRED"},
  "importer": {"running": false, "jobId": null} }
```

Status codes: `200`; `502` engine unavailable (`{"error":{"code":"ENGINE_UNAVAILABLE","detail":…}}`).

**WRITE — `POST /api/local/tokeneconomizer/settings/config`.** **Batched** with per-key results.
Justification: a user editing nine thresholds then pressing 저장 once should not pay nine child
process spawns serially in the UI; but atomicity per key matters more than all-or-nothing, so the
route applies keys one by one and reports each. Partial failure is visible and the UI re-reads to
reconcile.

Request: `{ cwd?, host?, pairs: [{ key: string, value: string|number }] }` — **required**: `pairs`.
Response `200`: `{ results: [{ key, ok, storedValue, effective, error?: {code, detail(engine
verbatim)} }] }`. Status: `200` (even with per-key failures — failures are in-band), `400` malformed
request, `502` engine unavailable.

Error body shape (uniform): `{"error": {"code": "INVALID_VALUE"|"UNKNOWN_KEY"|"ENGINE_UNAVAILABLE"|"ENGINE_AUTH",
"detail": "<engine stderr, verbatim>"}}`.

**RESTORE — `POST .../settings/restore`** — synchronous (single child process,
`te --host dsh toolprune restore [repo]` — or the plugin's bridge-equivalent subcommand; measured
CLI has `toolprune` surface with `restore`). Restores: removes `tools.restrict({deny})` entries
derived from toolprune proposals for the named repo (or all repos when omitted), i.e. re-admits the
pruned tools; source of truth is the engine's own proposal/apply state under `~/.tokeneconomizer`
state, read back through the engine CLI — the plugin never edits those files. Request:
`{ repo?: string }`; response `{ restored: [{repo, tools: [...]}] }` or `400` unknown repo.

**RESET — `POST .../settings/reset`** — synchronous. Request `{ key?: string }` (one key →
`te config unset <key>`; omitted → unset every UI-managed key). Response:
`{ results: [{key, ok, error?}] }` then the UI re-reads.

**IMPORT — `POST .../settings/import`** — **progress-reporting job** (cold-start can run long over
971+ ledger sessions). Request: `{ dryRun?: bool, reimport?: bool, limit?: number, all?: bool,
only?: string, includeMissing?: bool }`. Response `202`:
`{ jobId, status: "queued" }`. UI polls **GET `.../import/<jobId>`** (1 s interval):
`{ jobId, status: "running"|"done"|"error", progress: {done, total}, log?: [last 20 lines],
result?: {imported, skipped, repos: n}, error?: <verbatim> }`. Single in-flight job; a second
request returns `409`. Cancellation: `DELETE .../import/<jobId>` kills the child process.

**Security/scope**: routes are registered on the local connection only; the handler re-checks the
remote address is loopback (defense in depth, same as devstats) and rejects others with `403`.

### 4.3 Persistence, immediate reload, and failure presentation

Write path — explicit call chain:

```
UI (client.js) → fetch POST /settings/config {pairs}
  → server handler (settings-server.js, ctx.connection.fetch.register)
    → lib/bridge.js runTe(["--host","dsh","config","set","k=v","--cwd",cwd])   [child_process, 282-line boundary]
      → te CLI → engine writes ~/.tokeneconomizer/config.json
    → bridge re-runs runTe(["config","show"]) → parsed echo verified per key
  → response per-key results → UI re-reads (GET /settings) → rerender
```

A **direct file write into `~/.tokeneconomizer` is forbidden**: the state root is engine-owned
(file format, nesting, and validation live in `plugin/config.py`; a plugin hand-edit would corrupt
validation, race concurrent engine writes, and bypass type/enum checks). All access goes through
the existing `child_process` boundary (`lib/bridge.js`).

Immediate reload: after a successful write the server (a) confirms via `config show` echo, (b)
replaces the plugin's in-process config cache (invalidate the memoized result in
`lib/settings.js`'s resolve path so the next `resolveConfig` call re-runs `te config show`), and (c)
returns effective values so the UI rerenders without a restart. The devstats card and any
in-session consumer pick up the new values on their next request, not from a push.

**Not hot-reloadable (honest list)**: a `tools.restrict` already applied to a live agent is
memory-only for that agent's lifetime and is **not** lifted by a config change — changing
`toolprune` or restoring tools affects the *next* agent/session, not one mid-flight. Micro-skill
injection and loopguard levers likewise bind at session/agent start. The UI shows
`다음 세션부터 적용 / applies from next session` on these controls.

Validation: client-side range/type check first (instant inline error, no request), then the server
passes the value to the engine whose authoritative validation may still reject — the UI displays the
engine's reason **verbatim** in the row. Error taxonomy:

| Code | Meaning | UI presentation | Logged |
|---|---|---|---|
| `INVALID_VALUE` | engine rejected value/type/range | row-level inline error, engine stderr verbatim, value reverts to last confirmed | `appendPluginRecord` settings.write.error |
| `UNKNOWN_KEY` | key not in engine schema | row-level, treated as a plugin bug (should be impossible; KEYS constants prevent it) | same |
| `ENGINE_UNAVAILABLE` | `te` exit non-zero / spawn fail | banner `엔진에 연결할 수 없음`, page controls disabled | settings.error |
| `ENGINE_AUTH` | sidecall/auth failure (measured: `ACCOUNT_SIGN_IN_REQUIRED`) | degraded banner, judge panel shows verbatim reason | settings.error |

Failure presentation table (condition → user sees → logged):

| Condition | User sees | Logged |
|---|---|---|
| write succeeds | row keeps value, `기본값`/`재정의` badge updates | settings.write (attribution record) |
| engine rejects one key in batch | only that row errors, others commit, badge per key | per-key records |
| `config show` echo mismatch after write | row flagged `확인 실패`, re-read forced | settings.write.verify |
| engine down at page load | whole page degraded banner, read-only | settings.error |
| importer error mid-run | job panel shows verbatim stderr + `error` state | import.error |

**Confirm-after-write** (chosen, over optimistic UI). Justification: a silent revert is worse than a
spinner — the user believes a threshold is active when the engine refused it; optimistic UI would
also need revert plumbing for every failure mode, and writes are single-digit latency (one child
process). Pending state = inline spinner per row + disabled 저장.

Save semantics: mode selects and threshold inputs each carry their own **저장** affordance
(per-row save button; a dirty row is highlighted until confirmed). No global "apply all" — per-row
confirmation pairs naturally with confirm-after-write and per-key engine results. A dirty-row
navigation warning (`저장하지 않은 변경이 있습니다`) fires on slot teardown.

Gap IDs addressed by this section:

| Gap ID | Where addressed |
|---|---|
| G-C-13 | typed constants module, §4.2 |
| `on` alias ambiguity | §4.1 explicit alias rule; UI shows concrete stored enum |
| `history_import` non-existence | §4.1 + §4.2: plugin-owned importer action, no engine key |
| live override 100000 | §4.1 effective/override/default triad + per-key reset |
| debris repos (15/31) | §4.1 evidence-filtered default view + debris toggle |
| judge unavailable | §4.1 status panel + §4.3 `ENGINE_AUTH` taxonomy — degraded, never hidden |
| inline dictionary drift (66 vs 65) | §4.4: collapse to one source; flagged defect |
| locale label capture | §4.4: label evaluated at render, registrant re-registers on locale change |

### 4.4 Localization

Ships `locale/ko.json` and `locale/en.json` (**65 keys each**) plus an **inline dictionary in
`lib/client.js` with 66 keys — measured drift**, a known defect. Rule: the inline copy must not
drift; propose collapsing to **one source** (client.js imports/receives the locale bundle instead of
holding its own copy). Flagged as a defect to fix alongside this work.

New keys (`settings.*`, following the existing `devstats.*` style):

| Key | ko | en |
|---|---|---|
| `settings.title` | 토큰절약기 · 환경설정 | Token Economizer · Settings |
| `settings.modes` | 동작 모드 | Operating modes |
| `settings.thresholds` | 임계값 | Thresholds |
| `settings.operations` | 작업 | Operations |
| `settings.status` | 상태 | Status |
| `settings.save` | 저장 | Save |
| `settings.reset` | 초기화 | Reset |
| `settings.resetAll` | 기본값 복원 | Reset to defaults |
| `settings.restore` | 정리된 도구 복원 | Restore pruned tools |
| `settings.import` | 세션 이력 가져오기 | Import session history |
| `settings.import.dryRun` | 시험 실행 | Dry run |
| `settings.range` | 범위: {min}–{max} | Range: {min}–{max} |
| `settings.engineDefault` | 기본값 {value} | Engine default {value} |
| `settings.override` | 저장된 재정의 | Stored override |
| `settings.nextSession` | 다음 세션부터 적용 | Applies from next session |
| `settings.judgeUnavailable` | 판정기 사용 불가: {reason} | Judge unavailable: {reason} |
| `settings.judgeDegraded` | 휴리스틱 전용으로 동작 중 | Running heuristic-only |
| `settings.debris` | 테스트 찌꺼기 표시 | Show test debris |
| `settings.engineDown` | 엔진에 연결할 수 없음 | Cannot reach the engine |
| `settings.verifyFailed` | 확인 실패 | Verify failed |
| `settings.microskills` | 마이크로 스킬 | Micro-skills |
| `settings.toolprune` | 도구 정리 | Tool pruning |
| `settings.loopguard` | 반복 감시 | Loop guard |
| `settings.aggr` | 강도 | Aggressiveness |
| `settings.pendingProposal` | 대안 제안 {n}건 | {n} pending proposals |
| `settings.activeFacts` | 활성 팩트 {n}건 | {n} active facts |
| `settings.repoEvidence` | {n}개 저장소에 증거 있음 | Evidence in {n} repos |

Label contract: the registrant **re-registers the slot with fresh text on locale change**; the shell
never subscribes locale state. Therefore the page title and all labels must come from
`t(key)` **evaluated at render time inside the render function**, never a string captured at
registration. Registration: `ctx.registration.register('settings.section', { id: SLOT_ID, order:
SLOT_ORDER, label: () => t('settings.title'), render })` — whatever the host's exact contract, the
invariant is: label is a function of current locale, evaluated per render.


## 5. Phased execution plan

### 5.1 Wave structure, file ownership matrix, dependency DAG

**Six waves.** Each wave is independently verifiable, leaves the repo green (164 tests / 163 pass / 1 skip baseline holds), and ends with a clean `npm test && npm run check && npm run docs:check`.

| Wave | Name | Deliverable | Verifiable outcome |
|---|---|---|---|
| W1 | Identity + probes + records foundation | `lib/identity.js`, `lib/repokey-bridge.js`, `lib/probes.js`, `lib/attribution.js`, `lib/types/records.d.ts` | identity resolves once and persists; probes return per-seam results; record map augments cleanly |
| W2 | Surface attribution live | `lib/surface-attribution.js`, `lib/attribution.js` (type read/write), `lib/rewriter.js`, `lib/tiering.js` (records only, old trigger still firing) | every rewrite carries `plugin:tokeneconomizer/surface-rewrite`; decision records precede rewrites |
| W3 | Trigger migration + deprecated-read migration | `lib/tiering.js` (re-point), `lib/settings.js`→read resolver, deprecation-audit script | tiering fires on `agent/pre-step`; zero calls to `eventAt`/`snapshotEvents`/`deriveMessages` remain |
| W4 | The three mechanisms | `lib/tiering.js` (mechanisms), `lib/attribution.js` (prune record) | cold-tier rewrite + tool pruning + loop-guard degraded path all fire and are attributed |
| W5 | Settings GUI + client + locale | `lib/settings-api.js`, `lib/client.js`, `locale/ko.json`, `locale/en.json`, `lib/devstats.js`, `lib/devstats-server.js` | `토큰절약기 · 환경설정` renders, writes via bridge, survives reload |
| W6 | Slim orchestrator + edge + integration | `lib/index.js` (≤300), `lib/bridge.js` (identityKey param), `bin/dsh-te.mjs`, `lib/watchdog.js` | full E2E: Chromium GUI + live DSH session with persisted records |

**File ownership matrix** (workers × files; `W` = writes, `R` = reads; one worker per file per wave — proof below).

| Wave | Worker A | Worker B | Worker C | Worker V (verify) |
|---|---|---|---|---|
| W1 | `W lib/identity.js`, `W lib/repokey-bridge.js` | `W lib/probes.js` | `W lib/attribution.js`, `W lib/types/records.d.ts`, `W lib/index.js` (single seam patch) | `R` whole tree |

`lib/index.js` is written once per wave by a named single owner: W1.C (attribution seam), W3.A (trigger re-point), W6.A (slim rewrite). No other worker writes it.
| W2 | `W lib/surface-attribution.js`, `W lib/rewriter.js`, `W lib/attribution.js` (type read/write) | `W lib/tiering.js` | — | `R` |
| W3 | `W lib/tiering.js` (re-point) | `W scripts/audit-deprecations.mjs`, `W lib/settings.js` (resolver only) | — | `R` |
| W4 | `W lib/tiering.js` (mechanisms) | `W lib/attribution.js` (tool-prune record) | — | `R` |
| W5 | `W lib/settings-api.js` | `W lib/client.js`, `W locale/ko.json`, `W locale/en.json` | `W lib/devstats.js`, `W lib/devstats-server.js` | `R` + headless Chromium |
| W6 | `W lib/index.js` | `W lib/bridge.js`, `W bin/dsh-te.mjs`, `W lib/watchdog.js` | — | `R` + full E2E |

**Proof obligation: no two workers write the same file in the same wave.** Every file name appears at most once per wave row above. `lib/index.js` is the contention point (1,396 lines) and is single-writer per wave: W1 Worker C (attribution seam patch), W3 Worker A (trigger re-point), and W6 Worker A (slim rewrite) are the only writers across all six waves; no other worker ever writes it. It is written in W6 by Worker A after W1–W5 created every module it will delegate to; until then its existing code keeps running against the new modules via the small, single-wave patches owned exactly once per wave. Each such patch is listed under the owning worker in §5.2 and is the only write to `lib/index.js` in that wave.

**Dependency DAG** (edges: `Wn depends on Wn-1`):

```
W1 ──▶ W2 ──▶ W3 ──▶ W4 ──▶ W5 ──▶ W6
 │      │      │
 └──────┴──────┴── identity/probe/attribution layer (W1) is read by every later wave
```

- W2 depends on W1: attribution needs probes (`probeCtx`, `probeFn`) and identity keys.
- W3 depends on W2: the trigger re-point must fire into a working record-writing tiering.
- W4 depends on W3: mechanisms assume the `agent/pre-step` window.
- W5 depends on W4: GUI reads `tier-decision`/`surface-rewrite` records produced by W4; devstats grouping needs identity (W1).
- W6 depends on W5: the orchestrator delegates to finished modules.
- Parallel-safe within waves (disjoint files): all rows of the W1 matrix; W2 A∥B is sequential-safe but file-disjoint (B writes tiering which reads A's modules — landed same wave, A first); W5 A∥B∥C.
- No wave contains a cross-file edit race: the only multi-wave file (`lib/index.js`) is single-writer per wave (see proof obligation below).

**Stage-3 permissions respected throughout:** coders are OpenCode DeepSeek sessions; Worker V is the single headless Chromium verification worker; disjoint files run in parallel; no worker writes `~/.dsh` profile files; no worker restarts `dsh-web.service`; `~/.tokeneconomizer` is written only through `lib/bridge.js` (engine/reducer boundary); the numeric version `0.0.1` is untouched; `rc` bumps once per session by the lead (currently `rc.5` → `rc.6` on first session with code changes).

**Parallel-safety detail per wave** (who can run simultaneously without merge risk):

| Wave | Simultaneously safe groups | Sequencing within wave |
|---|---|---|
| W1 | A ∥ B (pure new files); C starts once A/B types are agreed (header contract, not file contention) | C last; V runs after C |
| W2 | A ∥ B file-disjoint, but B's record emission uses A's types — B lands second | A then B |
| W3 | A ∥ B (tiering vs script/settings-resolver) | both parallel |
| W4 | A ∥ B file-disjoint | both parallel |
| W5 | A ∥ B ∥ C (route, client+locale, devstats) | B last (renders A's slots) |
| W6 | A ∥ B file-disjoint | both parallel; V final |

### 5.2 Per-wave task specification

Worker naming: `W<wave>.<letter>`. Every worker is one OpenCode DeepSeek session scoped to the files in its heading; Worker V (headless Chromium) verifies but writes nothing. Fourteen coder roles total; the manifest summary is at the end of §7.

| Wave | Workers | Files touched |
|---|---|---|
| W1 | A (identity), B (probes), C (attribution+types, `lib/index.js` seam patch) | `lib/identity.js`, `lib/repokey-bridge.js`, `lib/probes.js`, `lib/attribution.js`, `lib/types/records.d.ts`, 1 patch to `lib/index.js` |
| W2 | A (surface), B (tiering records) | `lib/surface-attribution.js`, `lib/rewriter.js`, `lib/attribution.js`, `lib/tiering.js` |
| W3 | A (trigger), B (audit + resolver) | `lib/tiering.js`, `scripts/audit-deprecations.mjs`, `lib/settings.js`, 1 patch to `lib/index.js` |
| W4 | A (mechanisms), B (prune plumbing) | `lib/tiering.js`, `lib/attribution.js` |
| W5 | A (settings API), B (client+locale), C (devstats) | `lib/settings-api.js`, `lib/client.js`, `locale/ko.json`, `locale/en.json`, `lib/devstats.js`, `lib/devstats-server.js` |
| W6 | A (orchestrator), B (edge+boundary) | `lib/index.js`, `lib/bridge.js`, `bin/dsh-te.mjs`, `lib/watchdog.js`, `package.json` |

#### W1.A — Identity resolver (`lib/identity.js` new, `lib/repokey-bridge.js` new)
- Depends on: nothing. / Parallel-safe with: W1.B, W1.C, W1.V.
- Objective: one canonical project-identity resolution with the two-value model, closes G-A-01/02/03/04/12/14/15.
- Concrete changes: implement `resolveIdentity(sessionHeader, liveCwd, persistedRecords)` per §3.3's 7 numbered rules; extract `repoKeyOf(dir)` into `lib/repokey-bridge.js`; **return** the `project-identity` record to its caller — the caller (W1.C's adapter path, or the W6 orchestrator) performs the append; `lib/index.js` is not written by W1.A; write `~/.tokeneconomizer/repos/<key>/identity.json` through `lib/bridge.js`; adoption path for existing `repos/` entries (keep dir, write shim mapping new `identityKey`); wrong-adoption → P4 loud warn via `lib/watchdog.js` + fresh key; store `parentSession`/`delegationDepth` for subagents; `unanchored` marker when header `cwd` is absent (G-B-10).
- Acceptance gate: `cd dsh-tokeneconomizer && npm test -- --grep identity` green; `node -e "require('./lib/identity.js').resolveIdentity({cwd:'/tmp/x'})"` returns a record with `schemaVersion: 1`.
- Tests: `identity resolves once and returns the persisted record verbatim` (rule 1 fast path); `subdirectory session anchors at repo root` (rule 4); `rename re-adopts under new path with moved:true` (rule 6).
- Gap IDs closed: G-A-01, G-A-02, G-A-03, G-A-04, G-A-11, G-A-12, G-A-14, G-A-15, G-B-10 (identity half).

#### W1.B — Probe table (`lib/probes.js` new)
- Depends on: nothing. / Parallel-safe with: W1.A, W1.C.
- Objective: capability probe catalog closing G-C-15 and arming every other seam check.
- Concrete changes: `probeCtx(ctx, name)` and `probeFn(obj, fnName)` helpers; the 7-row seam table (§3.5.1): `agent/pre-step`, `agent/request`, `session.surface`, `appendPluginRecord`, `pluginRecordOf`, `working-directory/change`, `session.append` single-event overload; `probeSessionAppendOverload()` arity check; mark contract-tier vs internal-tier per seam; never throw, never cache across sessions.
- Acceptance gate: `npm test -- --grep probes` green.
- Tests: `probeFn returns false for undefined object, not throw`; `every seam catalog entry is exercised by at least one assertion` (table-completeness test).
- Gap IDs closed: G-C-15, G-C-05, G-C-06 (probe infrastructure).

#### W1.C — Attribution adapter + record types (`lib/attribution.js` new, `lib/types/records.d.ts` new; `lib/index.js` one-seam patch)
- Depends on: W1.A, W1.B (imports only — files disjoint, so parallel-safe).
- Objective: single point for all record writes and the `append` contract, closes G-B-01 scaffolding and G-B-05.
- Concrete changes: `PluginRecordMap` augmentation exactly per §3.4.2; `appendRecord(type, data)` wrapping `appendPluginRecord` with failure policy (§3.4.3: warn-once, retry record once, never retry replacement); batch-first `append(inputs)`; confined single-event `append(type, data, opts)` fallback gated on the W1.B probe; `lib/index.js` patch: replace the three surface-write call sites (`:871-887`) with imports of the adapter — this is W1's only `lib/index.js` edit.
- Acceptance gate: `npm test -- --grep attribution` green; `npx tsc --noEmit` passes with the augmentation.
- Tests: `record append failure does not corrupt the replacement event`; `PluginRecordMap accepts all three types at type level` (tsc).
- Gap IDs closed: G-B-01 (mechanism), G-B-05, G-C-04.

#### W2.A — Surface-rewrite layer (`lib/surface-attribution.js` new, `lib/rewriter.js` new)
- Depends on: W1 (all). / Parallel-safe with: W2.B (disjoint files).
- Objective: every tiering rewrite carries a model-invisible attribution record; reads migrate off deprecated APIs.
- Concrete changes: `lib/surface-attribution.js` validates the current surface node, composes the `surfaceOp` replacement, and pairs each record with its replacement event (the record append itself goes through W1.C's `lib/attribution.js` adapter); `lib/rewriter.js` builds `surfaceOp: {op:'replace', startSeq, endSeq}` events validating `surface.nodes` currency per §3.4.9 (G-B-08) and the surfaceOp contract (G-B-03); migrate `eventAt`/`snapshotEvents`/`deriveMessages` call sites to `session.surface` + `SessionMessageProjection` per §3.5.3 (G-B-04); join example per §3.4.10 (`sourceEventSeqs` copied, never inferred).
- Acceptance gate: `npm test -- --grep surface` green; `grep -rn "eventAt\|snapshotEvents\|deriveMessages" lib/ | wc -l` → 0.
- Tests: `rewrite accepted ⇒ surface-rewrite record with matching startSeq/endSeq`; `rewrite rejected ⇒ decision record kept, no rewrite record` (§3.4.3 row 3).
- Gap IDs closed: G-B-01 (live), G-B-03, G-B-04, G-B-08, G-B-09.

#### W2.B — Tiering records (`lib/tiering.js` — record emission only)
- Depends on: W1, W2.A (uses its types). / Parallel-safe with: W2.A.
- Objective: tier decisions become auditable records; per-class accounting.
- Concrete changes: `applyTiering` appends `tier-decision` **before** the rewrite (ordering §3.4.3 step 1); populate `scores`, `policyVersion`, `decidedAtTrigger`, `turn`/`step`; per-class accounting (§3.4.11) — `charsBefore`/`charsAfter` join to `surface-rewrite`.
- Acceptance gate: `npm test -- --grep tier` green.
- Tests: `decision record exists even when rewrite validation fails`.
- Gap IDs closed: G-B-09 (decision record), G-B-01 (completeness).

#### W3.A — Trigger migration (`lib/tiering.js` re-point; `lib/index.js` one-seam patch)
- Depends on: W2. / Parallel-safe with: W3.B.
- Objective: tiering fires on `agent/pre-step`, never on `agent/request`; fallback chain probe-driven.
- Concrete changes: re-point the trigger registration (`:686-698`, call site `:818`) to `agent/pre-step`; fallback order per §3.5.2 (pre-step → skip `agent/request` unless a legacy listener exists → `session/event` first-class fallback G-C-10); record `decidedAtTrigger` showing the fallback actually used; handle `PreStepDecision` union `{kind:'enter'}`; `lib/index.js` patch: move the hook registration call — W3's only `lib/index.js` edit.
- Acceptance gate: `npm test -- --grep prestep` green; `grep -n "agent/request" lib/tiering.js` → 0 hits outside the fallback-guard comment.
- Tests: `pre-step present ⇒ decidedAtTrigger is agent/pre-step`; `session/event fallback runs tiering on surface mutation` (G-C-10).
- Gap IDs closed: G-C-01, G-B-06, G-C-02, G-C-10.

#### W3.B — Deprecation audit + settings resolver (`scripts/audit-deprecations.mjs` new; `lib/settings.js` → read resolver)
- Depends on: W2. / Parallel-safe with: W3.A.
- Objective: process closure for deprecation drift (§3.5.8) and a single read-only settings resolver for W5.
- Concrete changes: audit script greps installed `.d.ts` for the three read APIs + the single-event overload, diffs `@deprecated` annotations, re-verifies `PreStepDecision` variants; exits nonzero on any new deprecation of a consumed seam; wired into the W6 final gates; `lib/settings.js` shrinks to the read-only effective-config resolver (`lib/settings-api.js` will absorb the route in W5).
- Acceptance gate: `node scripts/audit-deprecations.mjs` exit 0 against the current install.
- Tests: `audit script fails (exit 1) on a fixture .d.ts containing a removed seam`.
- Gap IDs closed: G-C-07 (drift detector), G-B-04 (audit-side), G-C-02 (removal detection).

#### W4.A — The three mechanisms (`lib/tiering.js`)
- Depends on: W3.A. / Parallel-safe with: W4.B (disjoint files).
- Objective: (1) cold-tier rewrite, (2) tool pruning, (3) loop guard with a degraded no-judge path — all attributed.
- Concrete changes: mechanism 1 — `applyTiering` grades nodes hot/warm/cold and rewrites cold `tool/result` nodes with the plugin marker; mechanism 2 — tool pruning replaces oversized/aged tool results, emits `plugin:tokeneconomizer/toolprune-applied` (record 3, §3.4.1, marker distinct from the harness's `PRUNE_MARKER`, G-B-10); mechanism 3 — loop-guard repeats detection; when the judge seam is absent (probed per §3.5.1) run the degraded heuristic path and mark records `reason: 'loopguard:repeat'` with `degraded: true` semantics in `reason`.
- Acceptance gate: `npm test -- --grep mechanism` green.
- Tests: `cold node replaced and surface-rewrite reason is tier:cold`; `pruned tool result carries toolprune-applied with pairedRewriteSeq`; `no-judge path fires and is marked degraded`.
- Gap IDs closed: G-C-01 (mechanism realization), G-B-10 (prune marker).

#### W4.B — Prune record plumbing (`lib/attribution.js`)
- Depends on: W2.A. / Parallel-safe with: W4.A.
- Objective: the tool-prune record type is written through the adapter with the same failure policy.
- Concrete changes: add `appendToolPruneApplied()` to `lib/attribution.js`; `source.kind` comparisons go through `SOURCE_KINDS` frozen map with `assertKnownKind()` (§3.5.6, G-C-11); unknown kind → `kind: 'unknown:<raw>'`, excluded from attribution math.
- Acceptance gate: `npm test -- --grep prune` green.
- Tests: `unknown source.kind is recorded as unknown and excluded`.
- Gap IDs closed: G-C-11, G-B-01 (third record).

#### W5.A — Settings API route (`lib/settings-api.js` new, absorbs `lib/settings.js` route half)
- Depends on: W1–W4. / Parallel-safe with: W5.B, W5.C.
- Objective: `토큰절약기 · 환경설정` read/write route that only writes through the engine boundary.
- Concrete changes: `POST /api/local/tokeneconomizer/settings` (read: effective vs stored-override per key) and `/settings/write` (write: validate, then `lib/bridge.js` → `te config set`); slot `tokeneconomizer-settings` near order 62; engine rejection reason surfaced verbatim (G-C-13 boundary: `SECTION_NAMES` frozen union, unknown section read-only passthrough); engine-unavailable → explicit error response, never silent success; local-only caller check.
- Acceptance gate: `npm test -- --grep settings` green; `curl -s -X POST localhost:3080/api/local/tokeneconomizer/settings -d '{}' | jq .ok` → true.
- Tests: `invalid value rejected with the engine's reason string`; `bridge unavailable ⇒ 503-style error, not ok:true`.
- Gap IDs closed: G-C-13, G-B-12 (settings write path hardening).

#### W5.B — Client + locale (`lib/client.js`, `locale/ko.json`, `locale/en.json`)
- Depends on: W1–W4. / Parallel-safe with: W5.A, W5.C.
- Objective: GUI renders from a single locale source; two slots do not collide.
- Concrete changes: remove the inline dictionary from `lib/client.js` (`:656` file) into `locale/ko.json`/`locale/en.json` (single source, G-A-05 family drift point); render both `tokeneconomizer-settings` and `tokeneconomizer-devstats` slots with explicit, non-overlapping order constants; no `process.cwd()` fallback in any client path (G-A-09/G-B-12).
- Acceptance gate: `npm test -- --grep client` green; `node -e "JSON.parse(require('fs').readFileSync('locale/ko.json'))"` exits 0 for both locales.
- Tests: `both slots register distinct order values`; `ko/en key sets are identical` (locale parity test).
- Gap IDs closed: G-A-05, G-A-06, G-A-07 (locale drift), G-B-11 (slot ordering).

#### W5.C — Devstats identityKey grouping (`lib/devstats.js`, `lib/devstats-server.js`)
- Depends on: W1.A. / Parallel-safe with: W5.A, W5.B.
- Objective: per-project stats group by `identityKey`, subagent trees roll up.
- Concrete changes: fold's grouping key switches `cwd` → `identityKey`; `devstats-server` route gains the grouping param; subagent records group under the parent identity (uses W1.A's `parentSession` field); `header.origin` boundary → `ORIGIN_VALUES` frozen constant + `assertKnownOrigin`; unknown origin → `originUnverified: true`, warn once per session, never mis-attribute (§3.5.6).
- Acceptance gate: `npm test -- --grep devstats` green.
- Tests: `subagent session groups under parent identityKey`; `unknown origin sets originUnverified, not a crash`.
- Gap IDs closed: G-A-08, G-A-13, G-B-02, G-C-12, G-B-11 (attribution half).

#### W6.A — Slim orchestrator (`lib/index.js`)
- Depends on: W5 (all). / Parallel-safe with: W6.B.
- Objective: `lib/index.js` ≤300 lines — wiring only.
- Concrete changes: keep `agent/created`, `session/event`, tool handlers, state creation; delegate identity (W1.A), probes (W1.B), attribution (W1.C/W2.A), tiering (W3/W4), settings (W5.A); remove the per-hit `repoKeyOf` re-derivation (`:1013-1023`, G-A-04 remnant); `agent/created` never awaits engine startup unguarded (G-A-10); `session/event` handler validates its session argument (G-A-06).
- Acceptance gate: `wc -l lib/index.js` ≤ 300; full `npm test` green at baseline 164/163/1.
- Tests: `index.js exports unchanged surface after slim-down` (compat smoke).
- Gap IDs closed: G-A-04 (removal), G-A-06, G-A-10.

#### W6.B — Edge + boundary hardening (`lib/bridge.js`, `bin/dsh-te.mjs`, `lib/watchdog.js`, `package.json`)
- Depends on: W5.A (route uses bridge signature). / Parallel-safe with: W6.A.
- Objective: engine boundary carries identityKey; CLI aliases it; contract dependencies declared.
- Concrete changes: `lib/bridge.js` spawn/pipe signature gains `identityKey` param; `bin/dsh-te.mjs --only` accepts `identityKey` + legacy `repoKey` shim, `doctor` gains the engine-canonicalization diff probe (§3.3); `lib/watchdog.js` gains `warnOnce(key, msg)`; `package.json`: add `dependencies` on `@deepseek-ai/dsh-session`, `@deepseek-ai/dsh-agent`, `@deepseek-ai/dsh-working-directory`; narrow `engines.dsh`; add `dsh.manifestVersion` self-check at activation (§3.5.5).
- Acceptance gate: `npm test` green; `node bin/dsh-te.mjs doctor` exits 0; `npm run check` passes.
- Tests: `manifestVersion mismatch warns and degrades, not crash`; `dsh-te --only <identityKey> status` resolves.
- Gap IDs closed: G-C-14, G-C-08, G-C-09, G-A-13 (CLI alias), G-C-12 (boundary).

### 5.3 Acceptance gates

**Global gates — run at the end of every wave:**

```bash
cd dsh-tokeneconomizer && npm test          # 164 tests / 163 pass / 1 skip
cd dsh-tokeneconomizer && npm run check
node scripts/check-doc-links.mjs            # from repo root
npm run docs:check
node scripts/check-plugin-history.mjs
```

Baseline drift: any count other than 164/163/1 without a named, reviewed new test is a fail (risk R-11).

**Per-wave gates** (the wave's new behaviour, in addition to global):

| Wave | Gate |
|---|---|
| W1 | `npm test -- --grep 'identity\|probes\|attribution'`; `npx tsc --noEmit` |
| W2 | `npm test -- --grep 'surface\|tier'`; `grep -rn "eventAt\|snapshotEvents\|deriveMessages" lib/` → 0 |
| W3 | `npm test -- --grep prestep`; `node scripts/audit-deprecations.mjs` exit 0 |
| W4 | `npm test -- --grep 'mechanism\|prune\|loopguard'` |
| W5 | `npm test -- --grep 'settings\|client\|devstats'`; Chromium slot-render check (below) |
| W6 | `wc -l lib/index.js` ≤ 300; `node bin/dsh-te.mjs doctor`; full E2E below |

A wave is **not done** until both the global gates and its per-wave gate pass; a failed per-wave gate blocks the next wave's start (the DAG in §5.1 is a hard ordering, not advisory).

**Final E2E gates:**

1. **Unit/regression:** full `npm test` (164/163/1), `npm run check`, all three root doc/history scripts green.
2. **Headless Chromium** (Worker V; `dsh-web.service` not restarted — verification runs against the live process):
   1. Launch: `chromium --headless --disable-gpu --dump-dom http://localhost:3080/<settings-page>` (or the Worker V scripted CDP session); Worker V keeps a persistent page session, not one throwaway launch per assertion.
   2. Open the `토큰절약기 · 환경설정` page; assert `document.querySelector('[data-slot="tokeneconomizer-settings"]')` exists and the Korean section heading text is present.
   3. Change one config value, click save; assert `POST /api/local/tokeneconomizer/settings/write` returns ok and the effective value updates in the DOM.
   4. Reload; assert the saved value persists (read shows stored-override ≠ default).
   5. Enter an invalid value; assert the rejection message equals the engine's returned reason string verbatim, and the stored value is unchanged.
   6. Reset-to-defaults; assert the stored-override marker clears and effective = engine default.
   7. DOM assertions, in order: `[data-slot]` presence → heading text → effective-value node text after save → after `location.reload()` same value → error toast/message element contains the engine reason → after reset, override badge absent.
3. **Live DSH session** (fresh session against the running `dsh-web.service` — no restart):
   1. Run a short session that calls a tool twice and produces a cold-tier candidate.
   2. Read the log back:
      ```bash
      zstdcat ~/.dsh/sessions/<id>.session.v4.jsonl.zst | grep 'plugin:tokeneconomizer'
      zstdcat ~/.dsh/sessions/<id>.session.v4.jsonl.zst | grep -c 'system/message'   # inject effect
      ```
   3. Assert: (a) at least one `system/message` context effect consistent with a micro-skill inject; (b) a `plugin:tokeneconomizer/surface-rewrite` record with `producer: 'plugin'` and matching `startSeq`/`endSeq` against the replaced `surfaceOp`; (c) a `plugin:tokeneconomizer/toolprune-applied` record with `marker: '\n\n[... token-economizer prune ...]\n\n'` and `pairedRewriteSeq`; (d) a `tier-decision` record with `decidedAtTrigger: 'agent/pre-step'`; (e) a loop-guard record showing the degraded no-judge path (reason `loopguard:repeat`).
   4. Join check: for one rewrite, the record's `tier` field equals the paired `tier-decision` record's `tier` for the same `nodeSeq` — proves the two records join without shape inference (§3.4.10).
4. **Restart discipline:** `dsh-web.service` is owner-controlled. Anything requiring a reload is reported **`applied pending restart`**, never claimed verified; live verification always uses a fresh session against the already-running process.

## 6. Risk register

**Likelihood/Impact scale:** low / medium / high / critical. Detection is always an implementable artifact — a named test, a probe, a script, or a log line — never "monitor".

| ID | Risk | Likelihood | Impact | Detection | Mitigation | Gap IDs |
|---|---|---|---|---|---|---|
| R-1 | `agent/pre-step` does not give the exact tiering window (after `step/start`, before assembly) | High (documented, accepted) | Medium — one-step latency on savings in the step in flight | `tier-decision.decidedAtTrigger` + a W3 test asserting rewrite lands by the next step's surface read; GUI shows trigger used | Accept consequence explicitly (§3.5.2); `session/event` fallback as first-class path re-tiering lazily | G-C-01, G-C-10 |
| R-2 | A future `origin` value (agent-team role) arrives and is treated as root | Medium | High — silent mis-attribution (the 179-defect class) | `assertKnownOrigin()` unit test with a synthetic unknown value; runtime warn-once log line `originUnverified` | Frozen `ORIGIN_VALUES` + fail-open-with-marker policy: `originUnverified: true`, excluded from attribution math, never a crash | G-C-12, G-B-02 |
| R-3 | Upstream widens `verify-plugin-record-callers` gate scope to include our record writes | Medium | High — plugin record writes blocked at install/version-up | Version-up gate re-run (§3.5.8 step 3) fails; audit script `scripts/audit-deprecations.mjs` flags the gate's new scope in the diff | Keep records in the adapter only; maintain the caller manifest the gate checks; escalate at version-up, never bypass | G-B-01 |
| R-4 | `appendPluginRecord` marked experimental — could change signature or be removed | Medium | High — all attribution lost | W1.B probe `probeFn(dshSession,'appendPluginRecord')` at activation; miss → GUI measurement banner + record-stream entry | Adapter is the single call site; degraded no-records mode keeps mechanics working; switch cost bounded to one module | G-B-01, G-C-05 |
| R-5 | Engine config writes fail silently or the engine is unavailable | Medium | High — GUI claims success while nothing persisted | W5.A test `bridge unavailable ⇒ error response, not ok:true`; Chromium gate asserts effective value after reload, not just save | Route returns the engine's reason verbatim on rejection; every write goes through `lib/bridge.js`; `te` exit code checked | G-C-13, G-B-12 |
| R-6 | Identity migration adopts the wrong key and re-partitions history | Low | High — evidence split, orphaned repos (31 entries at stake) | Wrong-adoption detection per §3.3: record `remote` vs directory remote diff → P4 loud warn via `watchdog.warnOnce`; doctor probe diffs engine's live key vs computed | Never recompute when a persisted record exists (rule 1); keep existing dir + shim, never rename; wrong adoption ⇒ fresh key, no cross-contamination | G-A-01, G-A-12, G-A-14 |
| R-7 | Module split introduces a circular import or a double-mount | Low | High — plugin fails to mount or hangs | `npm run check` incl. cycle lint; W6 gate `npm test` mount smoke; `--dump-config` AND real-mount check per RULES §4 | One-way layer DAG (L0→L6) stated per module; `lib/index.js` single-writer per wave (W1.C, W3.A, W6.A); import direction asserted in a test | G-A-03 |
| R-8 | Settings write path reachable by a non-local caller | Low | Critical — remote config tampering | Route-level local-caller test (non-loopback request ⇒ reject); Chromium gate uses localhost only | `POST /api/local/*` local-only guard preserved; write validates section against `SECTION_NAMES`, rejects foreign sections read-only | G-B-12 |
| R-9 | The two settings sections collide on slot registration or ordering | Medium | Medium — duplicate slot mount error or wrong render order | W5.B test `both slots register distinct order values`; Chromium asserts both slots render with `data-slot` attributes | Explicit order constants (settings 62, devstats 62+1); distinct slot ids `tokeneconomizer-settings` / `tokeneconomizer-devstats` | G-A-05, G-B-11 |
| R-10 | Deprecated `append` single-event form disappears mid-flight | Low | Medium — lone tier-decision write fails | W1.B `probeSessionAppendOverload()` at activation; W3.B audit script flags `.d.ts` removal | Adapter fallback to batch form with single-element input; probe decides at runtime, no hardcoded assumption | G-B-05, G-C-04 |
| R-11 | Test baseline drift (164/163/1) masks a regression | Medium | High — a real regression hidden behind new pass count | Global gate asserts the exact triple every wave; any deviation must be explained test-by-test in the wave report | New tests are additive and counted; a drop in total tests without a named removal is a fail | — |
| R-12 | `agent/request` is removed upstream while a fallback listener is being added | Low | Medium — tiering silently dead | Activation probe of both triggers records misses in the record stream + GUI warn (§3.5.2 step 3) | New listeners on `agent/request` prohibited (deprecation note); `session/event` fallback is first-class, always available | G-C-02, G-C-10 |
| R-13 | Dev-hours overrun on the `lib/index.js` slim-down (1,396 → ≤300) | Medium | Medium — W6 slips, contention risk returns | W6 gate `wc -l`; interim: contention avoided because W1/W3 patches are single-owner (W1.C, W3.A) and only W6.A rewrites it | Slim-down deferred to W6 exactly so W1–W5 never collide; fallback: ≤450 lines accepted with lead sign-off, recorded in CHANGELOG | G-A-04 |
| R-14 | Identity adoption collides with the engine's 31 existing `repos/` entries (15 test debris) | Medium | Medium — false adoption pollutes evidence | Doctor probe diff; `bin/dsh-te.mjs purge` report lists unclaimed dirs | Never delete engine state from the plugin; adoption keeps the existing dir + shim; cleanup is only `purge`'s job | G-A-01, G-A-12 |
| R-15 | `PreStepDecision` union variants change upstream, breaking `{kind:'enter'}` handling | Low | High — pre-step path crashes or no-ops silently | W3.B audit step 3 re-verifies the union at each version-up; runtime `assertKnownKind()`-style check on the payload | Probe + narrow switch over known variants; unknown variant → loud warn + session/event fallback | G-C-01, G-C-02 |
| R-16 | Engine canonicalization differs from `lib/identity.js` computed keys (UNVERIFIABLE from host) | Medium | High — every key mismatches the engine's `repos/` layout | Doctor-mode diff in `bin/dsh-te.mjs doctor` against the engine's live `repos/<key>/` index | Mismatch → loud P4 warn + migration shim; recorded as gap-register follow-up until engine source is inspectable | G-A-14 |

**Register cross-check:** every detection column names an artifact that exists after this plan (a test name in §5.2, a script in W3.B, a probe in W1.B, a doctor command in W6.B, a log-line format from `watchdog.warnOnce`). No row says "monitor". Risk rows are reviewed at each wave gate; a risk realized mid-wave reopens the affected wave only, not the DAG.

## 7. Traceability matrix

Severity classes: blocker / high / medium / low, inherited from §1.4 and §2.10 of the sibling fragments. "Closing mechanism" is one line; the verifying test is the named test case added by the same worker (see §5.2).

| Gap ID | Severity | Wave/Worker | Closing mechanism (one line) | Verifying test |
|---|---|---|---|---|
| G-A-01 | blocker | W1.A | `resolveIdentity()` rule 1: persisted `project-identity` record returned verbatim, never recomputed from a path | `identity resolves once and returns the persisted record verbatim` |
| G-A-02 | blocker | W1.A | Single canonical identity path in `lib/identity.js`; all old per-hit derivations removed (W6.A) | `index.js exports unchanged surface after slim-down` |
| G-A-03 | blocker | W1.A | Identity from immutable session header + `fs.realpath`, not the lossy slug | `subdirectory session anchors at repo root` |
| G-A-04 | blocker | W1.A + W6.A | `repoKeyOf` confined to `repokey-bridge.js`; per-hit re-derivation (`:1013-1023`) deleted in W6 | `index.js exports unchanged surface after slim-down` |
| G-A-05 | low | W5.B | Locale single-sourced in `locale/*.json`, inline dict removed | `ko/en key sets are identical` |
| G-A-06 | low | W6.A | `session/event` handler validates its session argument | `session/event validates session argument` |
| G-A-07 | low | W5.B | No client-side locale drift: render reads locale files only | `ko/en key sets are identical` |
| G-A-08 | low | W5.C | Devstats grouping key `cwd` → `identityKey` | `subagent session groups under parent identityKey` |
| G-A-09 | low | W5.B | No `process.cwd()` fallback in any client path | `client never falls back to process.cwd` |
| G-A-10 | low | W6.A | `agent/created` never awaits engine startup unguarded | `agent/created does not block on engine startup` |
| G-A-11 | high | W1.A | Two-value model: `projectDir` immutable, `liveDir` from `working-directory/change` | `identity resolves once and returns the persisted record verbatim` |
| G-A-12 | high | W1.A | Rename = re-adoption of the persisted record (`moved: true`), key never changes | `rename re-adopts under new path with moved:true` |
| G-A-13 | low | W5.C + W6.B | Identity-key grouping + `--only` alias accepting `identityKey` | `dsh-te --only <identityKey> status` resolves |
| G-A-14 | high | W1.A | `repokey.js` rule folded into identity as one bounded call site, marked UNVERIFIABLE; doctor probe diffs engine key | `doctor probe flags key mismatch` |
| G-A-15 | high | W1.A | `working-directory/change` listener updates `liveDir` mid-session | `cd mid-session updates liveDir only` |
| G-B-01 | blocker | W1.C → W2.A → W4.B | Three record types via `appendPluginRecord` + `PluginRecordMap` augmentation; every rewrite attributed | `rewrite accepted ⇒ surface-rewrite record with matching startSeq/endSeq` |
| G-B-02 | high | W5.C | `origin` treated as hint only; classification via `subagent/descriptor`; unknown → `originUnverified` | `unknown origin sets originUnverified, not a crash` |
| G-B-03 | blocker | W2.A | Rewrite stays surfaceOp-contract-valid before the record is appended | `rewrite rejected ⇒ decision record kept, no rewrite record` |
| G-B-04 | high | W2.A + W3.B | All reads via `session.surface` + `SessionMessageProjection`; deprecated reads gone + audited | `grep eventAt\|snapshotEvents\|deriveMessages lib/` → 0 |
| G-B-05 | high | W1.C + W3.B | Single adapter for `session.append`; batch-first; overload probed | `record append failure does not corrupt the replacement event` |
| G-B-06 | blocker | W3.A | Trigger moved off `agent/request` to `agent/pre-step` | `pre-step present ⇒ decidedAtTrigger is agent/pre-step` |
| G-B-07 | low | W1.A | Persisted identity record is the only trusted key | `identity resolves once and returns the persisted record verbatim` |
| G-B-08 | blocker | W2.A | Pre-append validation: `surface.nodes` currency checked before `surfaceOp` | `rewrite rejected ⇒ decision record kept, no rewrite record` |
| G-B-09 | blocker | W2.B | `tier-decision` record appended before every rewrite | `decision record exists even when rewrite validation fails` |
| G-B-10 | medium | W1.A + W4.A | No `process.cwd()`-as-project fallback (`unanchored`); distinct prune marker | `pruned tool result carries toolprune-applied with pairedRewriteSeq` |
| G-B-11 | medium | W5.B + W5.C | Explicit slot order constants; subagent grouping via parent identity | `both slots register distinct order values` |
| G-B-12 | medium | W5.A + W6.A | Settings write path local-only; no `process.cwd()` fallback anywhere | `invalid value rejected with the engine's reason string` |
| G-C-01 | blocker | W3.A + W4.A | `agent/pre-step` registration with probe + documented one-step latency | `pre-step present ⇒ decidedAtTrigger is agent/pre-step` |
| G-C-02 | high | W3.A + W3.B | Activation-time probe records misses; audit script flags upstream removals | `audit script fails on a removed seam fixture` |
| G-C-03 | high | W2.A | No invented event types; only `plugin:` records | `rewrite rejected ⇒ decision record kept, no rewrite record` |
| G-C-04 | high | W1.C + W3.B | Single-event `append` confined to the adapter with probe-gated batch fallback | `record append failure does not corrupt the replacement event` |
| G-C-05 | high | W1.B | Probe table row per seam with policy on miss | `every seam catalog entry is exercised by at least one assertion` |
| G-C-06 | high | W1.B + W1.A | Guarded `event.data` reads behind probe + per-seam loud/justified fail-open | `probeFn returns false for undefined object, not throw` |
| G-C-07 | high | W3.B | `tsc --noEmit` + audit script as drift detectors | `audit script fails (exit 1) on a fixture .d.ts` |
| G-C-08 | high | W6.B | Declared `dependencies` on the three consumed contract packages | `npm run check` passes with declarations |
| G-C-09 | high | W6.B | Activation-time `engines.dsh`/manifestVersion self-check | `manifestVersion mismatch warns and degrades, not crash` |
| G-C-10 | high | W3.A | `session/event` fallback is first-class with `decidedAtTrigger` evidence | `session/event fallback runs tiering on surface mutation` |
| G-C-11 | medium | W4.B | Frozen `SOURCE_KINDS` + `assertKnownKind()`; unknown recorded, excluded | `unknown source.kind is recorded as unknown and excluded` |
| G-C-12 | high | W5.C + W6.B | Frozen `ORIGIN_VALUES` + `assertKnownOrigin()` at both boundaries | `unknown origin sets originUnverified, not a crash` |
| G-C-13 | medium | W5.A | Frozen `SECTION_NAMES` union; unknown section read-only passthrough | `invalid value rejected with the engine's reason string` |
| G-C-14 | high | W6.B | Narrowed `engines.dsh` + lower-bound activation self-check | `manifestVersion mismatch warns and degrades, not crash` |
| G-C-15 | low | W1.B | `lib/probes.js` replaces the missing DSH probe API | `probeFn returns false for undefined object, not throw` |

### 7.1 Deferred

| Gap ID | Reason | Follow-up |
|---|---|---|
| (none) | — | — |

No gap is deferred. Two items are **bounded-open**, not deferred, and their status is stated explicitly so nothing is silently omitted:

1. **G-A-14 (engine canonicalization, UNVERIFIABLE).** The engine source is not shipped to the host, so rule-2/3 fidelity cannot be proven now. Closure shipped in W6.B is structural: the rule is confined to one call site, and the `doctor` probe diffs computed vs live keys on every run. Follow-up: re-verify the instant the vendored engine source becomes inspectable; any mismatch opens a migration shim.
2. **G-C-04 (single-event `append` overload).** The design deliberately keeps one probe-gated call site rather than migrating to batch-only, because the overload's contractual status is unclear upstream. Follow-up: migrate that one call site to batch form at the next version-up where the `.d.ts` status clarifies (W3.B audit already tracks it).

All 42 gaps close in Waves 1–6; no deferral. The one UNVERIFIABLE item — engine key canonicalization (G-A-14, §3.3) — is not deferred: its closure is the `doctor` probe plus the bounded single call site, with any mismatch surfaced as a loud warning and recorded as a gap-register follow-up until engine source becomes inspectable.

**42 total: 42 closed in Waves 1–6, 0 deferred.**

**Coverage check:** `grep -o 'G-[ABC]-[0-9][0-9]' 06-plan-risk-traceability.md | sort -u | wc -l` → **42** (15 A + 12 B + 15 C), matching the mechanical list from the sibling fragments exactly.

**Blocker mapping (required):** G-A-01 → W1.A → `identity resolves once and returns the persisted record verbatim`; G-B-01 → W1.C/W2.A → `rewrite accepted ⇒ surface-rewrite record with matching startSeq/endSeq`; G-C-01 → W3.A → `pre-step present ⇒ decidedAtTrigger is agent/pre-step`. All three are named tests attached to concrete workers.

**Manifest summary:** 14 distinct worker roles across 6 waves (W1.A–W1.C, W2.A–W2.B, W3.A–W3.B, W4.A–W4.B, W5.A–W5.C, W6.A–W6.B) plus the headless-Chromium verification worker (W1.V–W6.V).
