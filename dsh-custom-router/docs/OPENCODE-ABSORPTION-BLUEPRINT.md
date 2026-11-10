# OpenCode v2 Absorption — Three-Pipeline Blueprint

<!-- skeleton:
version: 1.1
kind: design
status: draft
updated: 2026-11-10
summary: Phased plan to absorb @nolit/dsh-opencode-v2 into dsh-custom-router/vendor/opencode, aligned against the three existing pipelines — DeepInfra for the shared stream pipe, Antigravity for the surface/dispatch supervisor, and the router preset slot for registry and dynamic activation — with file moves, fallback shims, per-phase verification gates, the four owner decisions recorded, and every OpenCode beta-roadmap milestone assigned to a phase.
-->

> Status: **Phase A delivered 2026-11-10** (vendor tree, shim, exports, leaf contract, first
> conforming driver, dual-mount guard); owner decisions in §6 and beta milestones in §7; CP3
> approved closing Phase A. Owner instruction 2026-11-10: absorb OpenCode v2 as a native vendor
> slot, not in isolation, by conforming to the two shipped vendor references.
> Rules: [RULES.md](../../docs/RULES.md) · Stage authority:
> [SHARED-STREAM-PIPE-SPEC.md](./SHARED-STREAM-PIPE-SPEC.md) P4/P5 ·
> [CUSTOM-ROUTER-SURFACE-CONTRACT.md](./CUSTOM-ROUTER-SURFACE-CONTRACT.md) M13/M14.

## 1. Measured baseline (2026-11-10)

| Pipeline | Antigravity | DeepInfra | OpenCode v2 |
| :--- | :--- | :--- | :--- |
| Location | `vendor/antigravity/` (internal) | `vendor/deepinfra/` (internal) | top-level track, profile `link:` |
| Package specifier | `@nolit/dsh-custom-router/vendor/antigravity` | `…/vendor/deepinfra` | `@nolit/dsh-opencode-v2` (+ `/http`) |
| Stream | `lib/stream` via [adapter.js:280](../vendor/antigravity/lib/adapter.js#L280) | `normalizeStream` via [adapter.js:225](../vendor/deepinfra/lib/adapter.js#L225) | **own pipeline** |
| SSE decode | shared `readSseEvents` | shared `readSseEvents` | `chatSseEvents` ([http.js:356](../../dsh-opencode-v2/lib/http.js#L356)) |
| Notation | provider hook | provider hook | `stream-parser.js` 679 L + `display-gate.js` 157 L + `display-clean.js` 121 L |
| Surface reconcile | `syncAll()` + `app-boot/config-reload` ([index.js:716](../vendor/antigravity/lib/index.js#L716), [:810](../vendor/antigravity/lib/index.js#L810)) | register once | register once (`apply()`), **no reconcile** |
| Dispatch seam | `bindDispatch()` → gate/track | n/a (no CLI) | `ctx.inject(['customRouter'])` gate/track only |
| Client half | `settings.js` + `client.src.js` | `client.js` | `client.js` 1,004 L, own `settings.section` |
| Suite | 172 | 205 pass / 7 skip | 481 |

Size of the migration surface: `dsh-opencode-v2/lib` is **10,848 lines**, of which
`http.js` is **2,778** and the classifier/gate/cleaner trio is **957**.

Two measured defects the absorption must close, because the target must not carry them into
the router:

1. **No `app-boot/config-reload` reconcile** (F-46 class). A `cli`/`enabled` flip needs a
   `dsh-web.service` restart; Antigravity's `syncAll` is the reference fix.
2. **The `opencode` tool is gated by name as an external CLI** even when the subagent service
   is present and the call runs a managed child session. Antigravity gates `agy_worker`/
   `agy_cli` as external and leaves `subagent_*` to the provider-level `start()` assertion.

## 2. Three-pipeline conformance mapping

### 2.1 Stream pipeline — reference DeepInfra, spec P4

The shared core is `lib/stream/index.js`: `normalizeStream({ events, descriptor, hooks, signal, onUsage })`
plus `readSseEvents`. Hooks: `readEvent` (mandatory), `classifyText`, `mapFinish`, `usageFrom`,
`onMalformed`, `onEmpty`, `onCut`. DeepInfra's descriptor is data only
([stream-contract.js:56](../vendor/deepinfra/lib/stream-contract.js#L56)):

```js
export const STREAM_DESCRIPTOR = Object.freeze({
  toolCallShape: 'fragmented',
  usage: Object.freeze({ totalFormula: 'prompt+output' }),
  malformedRecord: 'fail',
})
```

OpenCode's target equivalent (new `vendor/opencode/lib/stream-contract.js`):

| Pipe slot | OpenCode source today | Phase-B action |
| :--- | :--- | :--- |
| `events` | `chatSseEvents(body)` | `readSseEvents(body)` — one framing implementation |
| `descriptor.toolCallShape` | fragmented `tool_calls[]` | `'fragmented'` (wire ordinals reused) |
| `descriptor.usage.totalFormula` | `usageFromOpenAi` | `'prompt+output'` unless a bucket differs; then `usageFrom` hook |
| `readEvent(payload)` | `mapChatDelta` (`upstream-map.js`) | return `{ parts, usage, finish }` — pure map, no yield |
| `classifyText(text)` | `createStreamClassifier` + display gate | canonical parser hook; `parser: 'legacy' \| 'canonical'` |
| `mapFinish` | 6-way table in `http.js` | shared table + override only for measured divergence |
| `onMalformed` | throw on undecodable frame | `'fail'` — a skipped frame truncates a turn |
| `onUsage` | `recordCost` callback | same ledger, called on arrival (not after finish) |

The P4 exit gate is already written in the spec: **opencode-v2 suite green; replay
`markerDeltas == 0`; S2-3 prose gate passes; `classifyText` lands here.** P5 then replays one
recorded fixture per provider through the core and requires the same `StreamChunk` shape for
the same semantic event.

### 2.2 Surface and dispatch pipeline — reference Antigravity

Antigravity's index is the reference supervisor: a `parts` map plus
`syncModel/syncCli/syncBatch/syncSubagent/syncPanel`, service acquisition through
`bind([...])`, a separate `bindDispatch()` for the router seam, `app-boot/config-reload → syncAll`,
and an `installed()` diagnostic. OpenCode must be refactored from "register once in apply()" to
the same shape:

| Surface | Antigravity today | OpenCode target |
| :--- | :--- | :--- |
| Model route | `syncModel()` | `syncModel()` from `modelServing`/`enabled` |
| CLI tool + command | `syncCli()` (`agy_worker`, `/agy`) | `syncCli()` (`opencode`, `/ocode`) |
| Batch tool | `syncBatch()` (`agy_cli`) | `syncWorker()` (`cli_worker`) |
| Subagent provider | `syncSubagent()` | `syncSubagent()` (`subagent_opencode` provider) |
| Panel/routes | `syncPanel()` | fold into the router dashboard (no second `settings.section`) |
| Dispatch gate | `start()` assert + pre-execute gate | same, but managed-child mode must not be denied as external CLI |
| Reclamation | `registry.track` on every spawn | same for fallback spawn and `cli_worker` |
| Config reload | `syncAll` listener | `syncAll` listener — closes F-46 |

### 2.3 Registry and dynamic activation — reference the two vendored presets

A vendored preset is `kind: 'package'` with an internal specifier, row ids that keep the
operator's `vendorConfig` keys, and per-surface switches:

| Preset | `package` | Entries (loader rows) | Switches |
| :--- | :--- | :--- | :--- |
| antigravity | `@nolit/dsh-custom-router/vendor/antigravity` | `dsh-antigravity`, `tool-subagent-antigravity` | `enabled`, `modelServing`, `cliWorker`, `cliBatch` |
| deepinfra | `@nolit/dsh-custom-router/vendor/deepinfra` | `dsh-deepinfra` | `enabled`, `modelServing`, `anthropicRoute` |
| opencode (target) | `@nolit/dsh-custom-router/vendor/opencode` | `dsh-opencode-v2`, `dsh-opencode-v2-http`, `tool-subagent-opencode` | `enabled`, `modelServing`, `subagent`, `cli`, `workerEnabled` |

The row ids and switch names already exist in
[settings-schema.js:53-67](../lib/settings-schema.js#L53-L67) and in the dashboard tabs
([client.src.js:370](../lib/client.src.js#L370)), so credentials, usage and the operator's
saved `vendorConfig` do not move.

**Readiness/activation.** The router already has a bridge for OpenCode
([bridges/opencode.js](../lib/bridges/opencode.js): 444 L, daemon `/api/model` + Basic auth) and a
catalog probe layer. **Owner decision 2026-11-10:** M9 readiness is wired as **data only**
(`vendorProbes.opencode` + catalog layers); **automatic activation stays on hold**. Activation
remains the manual `presets.opencode` + per-surface switches until the owner opens M9.

## 3. Phased absorption

### Phase A — vendor tree and shim (no mount change)

| Step | Action | Risk |
| :--- | :--- | :--- |
| A1 | `git mv dsh-opencode-v2/lib → dsh-custom-router/vendor/opencode/lib` (incl. `workers/`), `locale/`, `test/` | low — pure move |
| A2 | Add router exports: `./vendor/opencode`, `./vendor/opencode/http`, `./vendor/opencode/subagent`, `./vendor/opencode/cost` | low |
| A3 | Rewrite imports of `@nolit/dsh-custom-router/stream` to relative `../../../lib/stream/index.js` (DeepInfra pattern, avoids a cycle) | low |
| A4 | Keep `dsh-opencode-v2` as a **shim**: its export map re-exports the vendored files, so external consumers of `@nolit/dsh-opencode-v2/http` keep working | medium — circular export risk |
| A5 | Do **not** change `presets.js` yet; the preset still points at the shim | none |

Exit gate: both suites green; `verify:presets` OK; the vendored copy is never mounted twice.

### Phase B — stream unification (P4)

| Step | Action | Output |
| :--- | :--- | :--- |
| B1 | Add `vendor/opencode/lib/stream-contract.js` (descriptor + hooks) | data, pure |
| B2 | Replace `chatSseEvents` with `readSseEvents`; replace the block emitter with `normalizeStream` | one framing/terminal policy |
| B3 | Move `mapChatDelta` behind `readEvent`; move the 6-way finish table behind `mapFinish` unless shared | pure hooks |
| B4 | Keep `stream-parser.js` as the **default** classifier behind `classifyText`; add the `parser: 'legacy' \| 'canonical'` seam and port the staged parser without making it default | `classifyText` hook (P4's stated owner); canonical default moves to Phase F |
| B5 | Retire `display-gate.js`, `display-clean.js` when the canonical parser covers the notation; keep `arguments.js` inside the hook if it is still needed | −278 L minimum |

**Owner decision 2026-11-10:** Phase B proceeds with the **legacy classifier first** and is
**decoupled from the O1/O2/O3 verdict**. The canonical parser is ported in B4 but stays off by
default; flipping the default requires S2-1..S2-5 and belongs to Phase F.

Exit gate: P4 gate from the spec (suite green, `markerDeltas == 0`, prose gate, `classifyText`
present); `verify:stream` gains one OpenCode descriptor case; no `[tool call` notation reaches
the client. The canonical-parser gates are **not** required to close Phase B.

### Phase C — surface supervisor and dispatch parity

| Step | Action | Output |
| :--- | :--- | :--- |
| C1 | Replace register-once `apply()` with the Antigravity `parts`/`syncAll` shape | live switches |
| C2 | Add `bindDispatch()` and an `app-boot/config-reload → syncAll` listener | closes F-46 |
| C3 | Bind `cli_worker` and the fallback spawn to `dispatch.track`/registry like `agy_worker` | reclamation parity |
| C4 | **Owner decision 2026-11-10: keep the current policy** — the admission gate stays applied to the `opencode` tool for sandbox-policy consistency, even in managed-child mode. Record the rationale in the CLI doc; do not special-case the tool | one policy across all external-CLI surfaces |
| C5 | **Owner decision 2026-11-10: consolidate** — drop the package's own `settings.section` and fold its fields into the router dashboard (`vendorConfig['dsh-opencode-v2']`); no second UI | one UI |
| C6 | Add `installed()` diagnostics (`model/cliTool/cliCommand/subagent/worker`) | verifiable state |

Exit gate: `verify:dispatch` matrix includes `opencode`/`cli_worker`; flipping `cli` on a live
session works without restart; `installed()` matches the mount.

### Phase D — preset slot and profile cutover

| Step | Action | Rollback |
| :--- | :--- | :--- |
| D1 | `presets.js`: `package: '@nolit/dsh-custom-router/vendor/opencode'`; entry specifiers `…/vendor/opencode` and `…/vendor/opencode/http` | set `packages.opencode` override (router already supports `packages`) |
| D2 | `loadVendorModules` loads OpenCode from `vendorUrl('opencode/…')`, not the profile | keep the profile branch behind the same override |
| D3 | `bridges/opencode.js` imports the vendored module | shim still exists |
| D4 | Remove `@nolit/dsh-opencode-v2` from the profile dependencies/`node_modules` link; keep the shim installed for one release | re-add the `link:` dep |
| D5 | Isolated preset-only profile boot (vendor links removed) | — |

Exit gate: a profile with only `@nolit/dsh-custom-router` boots and lists the same six tools,
six commands and five providers; one provider id; credentials and usage ledger unchanged.

### Phase E — retirement

| Step | Action |
| :--- | :--- |
| E1 | Delete `vendor/antigravity/lib/subagent-opencode.js` (leftover, no importer measured) |
| E2 | Move `dsh-opencode-v2/` to `archive/` with the SUPERSEDED banner once the shim has shipped one release |
| E3 | Move its docs to the router track or archive; update indexes and CHANGELOG per RULES §6.1 |

### Phase F — post-consolidation beta roadmap

Everything the OpenCode track planned but did not ship moves here so the absorption does not
orphan it. Phase F starts **after** Phase E; each item keeps its original acceptance gate, now
measured through the router's pipe and vendor slot.

| Item | Original gate | Phase-F work |
| :--- | :--- | :--- |
| Canonical parser becomes default (`S2-1..S2-5`) | [STAGE-PLAN §4](../../dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md) | flip `parser: 'canonical'` after replay `markerDeltas == 0` and one day of real turns |
| Conformance oracle (`S3-1..S3-4`) | STAGE-PLAN §6 | ship the recipe fixtures in the vendored suite; a parser change without a case is refused |
| O1 prose destruction | STAGE-PLAN §3 | regression under `classifyText`: visible text keeps the sentence or an explicit `notation` part |
| O2 glyph drift (`｜`/`│`/`|`) | STAGE-PLAN §3 | canonical token table; replay must show 0 marker deltas |
| O3 `content_filter` error kind | STAGE-PLAN §3 | confirm the host renders the error kind; keep the `error` mapping |
| 2.2.6 `P0` install + DB backup | [JOB-SESSION §4](../../dsh-opencode-v2/docs/OPENCODE-226-JOB-SESSION-INTEGRATION-ROADMAP.md) | owner-gated prerequisite; no code |
| `P1` `--archived` version gate | JOB-SESSION §4 | session-list hygiene, behind a version check |
| `P2` job summary on results | JOB-SESSION §4 | bounded kind/status/error attached to worker/subagent results |
| `P3` HTTP session export | JOB-SESSION §4 | replace the CLI export spawn; usage ledger keeps one writer |
| `P4` stream repair path | JOB-SESSION §4 | becomes a pipe hook over the truncated-stream fixture |
| `P5` stats reconciliation | JOB-SESSION §4 | cost attribution once session-scoped stats are proven |
| Protocol declaration from catalog | [PROTOCOL-GAP §5](../../dsh-opencode-v2/docs/OPENCODE-PROTOCOL-FLEXIBILITY-GAP.md) | refuse to advertise a route whose wire the adapter cannot speak |
| Protocol dispatch seam | PROTOCOL-GAP §5 | sibling request builder for Responses/Messages, measured before adding |
| Stage-1 soak (`S6`) and defect closure (`S7`) | STAGE-PLAN §2 | one full day of real turns on the consolidated vendor; `S7` closes with the cases above |

Phase-F entry gate: Phases A–E green, the shim removed in favour of the vendored slot, and the
owner has approved the 2.2.6 install (`P0`). No Phase-F item may be started from inside Phase A–E
to avoid re-opening the migration.

## 4. Fallback and stubbing

| Mechanism | Where | Effect |
| :--- | :--- | :--- |
| **Re-export shim** | `dsh-opencode-v2` package | old import paths (`/http`, `/subagent`, `/cost`) resolve to the vendored code; nothing is duplicated at runtime |
| **`packages` override** | router config (`packages: { opencode: '@nolit/dsh-opencode-v2' }`) | one-line rollback to the pre-absorption mount without a code revert |
| **`parser: 'legacy' \| 'canonical'`** | OpenCode config | classifier rollback without reverting the pipe migration |
| **Per-surface switches** | `enabled`/`modelServing`/`subagent`/`cli`/`workerEnabled` | withdraw one surface, not the package |
| **Dual-read phase** | preset row ids unchanged | `vendorConfig` keys and credentials survive every phase |
| **Mount guard** | test: assert exactly one registration per provider/tool name | prevents the hard duplicate-mount failure while both copies exist |

## 5. Verification criteria (per phase)

| Gate | Command | Applies |
| :--- | :--- | :--- |
| Suites | `npm test` in router + vendored opencode + antigravity + deepinfra | A–F |
| Stream | `npm run verify:stream` (new OpenCode descriptor case) | B |
| Replay | `scripts/analyze-opencode-trace.mjs` → `markerDeltas == 0` | B |
| Parity | P5: one fixture per provider → identical `StreamChunk` shape | B |
| Mount | `npm run verify:presets` on the live profile + preset-only boot | A, D, E |
| Dispatch | `npm run verify:dispatch` (matrix includes OpenCode surfaces) | C |
| Reload | flip `cli` on a live isolated session; no restart needed | C |
| Docs | `npm run docs:check` + `node scripts/check-plugin-history.mjs` | every phase |
| Publish | `npm run check:publish` after D4/E2 | D, E |
| Canonical parser | S2-1 7/7, S2-2 300/300, S2-3 adversarial, S2-4 replay, S2-5 soak | F |
| Oracle | `test/conformance.test.mjs` inside the vendored suite | F |
| Job/session | P0 fixture+backup, export equivalence, version-gated endpoints | F |

## 6. Owner decisions and residual risks

### 6.1 Decisions recorded (2026-11-10)

| # | Decision point | Owner decision | Effect on this plan |
| :--- | :--- | :--- | :--- |
| D-1 | M9 readiness | data connection only; **automatic activation on hold** | §2.3 keeps the manual preset/switch activation; no Phase gates on M9 |
| D-2 | Managed-child gating | **keep the current policy** — the admission gate stays on the `opencode` tool for sandbox-policy consistency | C4 is fixed; no special case is added |
| D-3 | Client half | **consolidate into the router dashboard**, remove the standalone plugin section | C5 is fixed; the vendored slot ships no `settings.section` |
| D-4 | Stage 2 parser | **Phase B uses the legacy classifier first**, decoupled from the O1/O2/O3 verdict | B4 keeps `legacy` default; canonical default + oracle move to Phase F |

### 6.2 Residual risks

1. **Duplicate mount** is the only hard-failure risk: the profile link and the vendored preset
   must never mount the same provider/tool twice. Phase A stays unmounted; the guard test lands
   before Phase D.
2. **Usage ledger ownership.** The CLI and HTTP rows already share
   `opencode-session-cost.json`; after absorption the router owns that path via the vendored
   cost module. One writer must remain, or `P3` in Phase F cannot start.
3. **Peer dependency.** The shim keeps `@nolit/dsh-custom-router` as a peer during the transition;
   once the vendored copy is the only writer the cycle disappears and the peer can be dropped.
4. **Parser drift during F.** The canonical parser lands off-by-default in B and becomes the
   default only after S2-4/S2-5; starting an O1 fix before that would re-create the split this
   absorption removes.

## 7. Beta roadmap integration map

Every OpenCode beta milestone, its source document, and the phase that now owns it. No item is
dropped: shipped items keep a regression gate, planned items are attached to A–F.

| Beta item | Source | Phase | Gate carried forward |
| :--- | :--- | :--- | :--- |
| CLI worker module layout, backend adapters | [CLI-WORKER-DESIGN](../../dsh-opencode-v2/docs/CLI-WORKER-PLUGIN-DESIGN.md) | A (move) + C (registry/gate) | worker suite green; registry reclamation |
| Recipe Tier A (context clamp, finish mapping, request validation, stop lists, reasoning-token trace) | [RECIPE §4/§7](../../dsh-opencode-v2/RECIPE-CAPABILITY-DELTA.md) | A (carry) + B (regression through the pipe) | 401-pass behaviour preserved |
| Recipe Tier B — canonical tokens / declared-tool decision | RECIPE §4 | B (seam) → F (default) | S2-1..S2-5 |
| Recipe Tier C — conformance oracle | RECIPE §4 | F (Stage 3) | S3-1..S3-4 |
| Stage 1 S1–S4 (activation, build match, suite, isolated boot) | [STAGE-PLAN §2](../../dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md) | A–E verification | identical mount + suite |
| Stage 1 S5 browser boot | STAGE-PLAN §2 | D (post-cutover) | shell renders, no page errors |
| Stage 1 S6 soak | STAGE-PLAN §2 | F | one full day of real turns |
| Stage 1 S7 defect closure | STAGE-PLAN §2 | F | every closed defect has a regression test |
| O1 prose destruction | STAGE-PLAN §3 | F (after canonical default) | three adversarial inputs round-trip |
| O2 glyph drift | STAGE-PLAN §3 | B (hook seam) + F (canonical table) | replay marker deltas |
| O3 `content_filter` error kind | STAGE-PLAN §3 | F | host renders the error |
| Stage 2 parser (`S2-1..S2-5`) | STAGE-PLAN §4 | B (port, legacy default) → F (default) | conformance 7/7, invariance 300/300, replay, soak |
| Stage 3 oracle (`S3-1..S3-4`) | STAGE-PLAN §6 | F | corpus in the shipped suite |
| 2.2.6 `P0` install + backup | [JOB-SESSION §4](../../dsh-opencode-v2/docs/OPENCODE-226-JOB-SESSION-INTEGRATION-ROADMAP.md) | F (owner prerequisite) | fixture + backup |
| `P1` `--archived` | JOB-SESSION §4 | F | version gate |
| `P2` job summary | JOB-SESSION §4 | F | background-job fixture |
| `P3` HTTP export | JOB-SESSION §4 | F | export equivalence |
| `P4` stream repair | JOB-SESSION §4 | F | truncated-stream fixture |
| `P5` stats reconciliation | JOB-SESSION §4 | F | session-scoped stats |
| Protocol declaration from catalog | [PROTOCOL-GAP §5](../../dsh-opencode-v2/docs/OPENCODE-PROTOCOL-FLEXIBILITY-GAP.md) | F | `/api/model` exposes the wire |
| Protocol dispatch seam | PROTOCOL-GAP §5 | F | non-OpenAI route measured |
| Per-call selection normalization | [CHANGELOG rc.3](../../dsh-opencode-v2/CHANGELOG.md) | C | one selection contract across tool / `/ocode` / `subagent_opencode` |
| OpenCodex selection mirror | CHANGELOG 2026-11-07 | D (config keys unchanged) | projection + scope union tests |
| Settings allow-list / plan usage cards | [MODEL-SERVING-PLAN](../../dsh-opencode-v2/docs/OPENCODE-MODEL-SERVING-PLAN.md) | C5 (fold into dashboard) | one UI, no duplicate section |
| Antigravity/OpenCode CLI feasibility record | [pending-docs](../../pending-docs/unimplemented/OPENCODE-ANTIGRAVITY-FEASIBILITY.md) | historical — no phase | superseded by the shipped surfaces |

## 8. Checkpoint log

### CP1 — Provider Driver Contract (2026-11-10)

Reviewer: **Argon 4.0 (medium)** via `agy --model gemini-4-argon-medium` (the DSH runtime had not
loaded the new Antigravity models yet; see §8.1). Usage: 7,933 input / 698 output tokens,
16 s. Verdict: **APPROVE-WITH-CHANGES**.

Three changes are now part of the contract (`lib/driver/contract.js`) and D1:

| # | Finding | Accepted change |
| :--- | :--- | :--- |
| C1-1 | `surfaces` overlapped (`cli.toolName`, `subagent.toolName`, `tools[]`) making uniqueness ambiguous; `model.adapter: true` had no resolvable adapter key | `model: { adapter: true, factory: 'createAdapter' }`; one normaliser derives the effective tool/command set per driver before the global uniqueness check |
| C1-2 | Readiness lacked provider-specific metadata; hooks forbid I/O; antigravity also needs thought/citation block handling | `activation.readiness: { bridge, catalogLayer, auth: 'web-auth' \| 'api-key' \| 'daemon', health?: string }`; add optional `classifyBlock` hook next to `classifyText` |
| C1-3 | A vendor importing the router is a cycle direction | the contract **and the stream core** are leaf modules: they must not import `lib/index.js`, `lib/presets.js`, or any vendor. Enforced by an import-graph test |

### 8.1 Endpoint verification — Argon 4.0 / Opus 5.5 (2026-11-10)

| Layer | Measured |
| :--- | :--- |
| Upstream account (`agy models`) | `gemini-4-argon-{low,medium,high}`, `claude-opus-5-5-{low,medium,high}` present |
| Live profile `vendorConfig['dsh-antigravity'].enabledModels` | both families already allow-listed |
| Live profile `subagent-model-selection-settings.allowedModels` | **registered** (six ids added; backup `cordis.patch.yml.bak.before-argon-opus-register-*`) |
| Running DSH runtime (`list_subagent_models`) | only `gemini-3.8-flash` — **applied pending restart** |

Consequence: Argon/Opus are reachable through the vendor CLI now, and through the DSH subagent
roster after the next `dsh-web.service` restart (owner-only). CP1 was therefore executed on the
vendor endpoint, which is the same model id the DSH path will use.

### CP2 — Phase A exports/shim structural soundness (2026-11-10)

Reviewer: **Argon 4.0 (medium)**, 7,867 in / 1,131 out, verdict **APPROVE-WITH-CHANGES**.

| # | Finding | Disposition |
| :--- | :--- | :--- |
| C2-1 | The vendored `node_modules` symlinks were moved by hand; a clean `npm ci`/tarball relies on declared deps | Declared the five host packages as router `peerDependencies` (`cordis`, `dsh-llm`, `dsh-subprocess`, `dsh-tools`, `schemastery`). The in-tree symlinks remain the dev-time resolution path, matching the antigravity/deepinfra vendor layout |
| C2-2 | The relative `../../../lib/vendor-bridge.js` crosses the nested `vendor/opencode/package.json` boundary | Nested manifest is **retained until Phase E** because the shipped track suite reads it (`test/bundle.test.mjs`); the import targets `lib/vendor-bridge.js`, which is a leaf (only re-exports `selection-sync.js`). Removing the nested manifest before the suite moves would break Phase A verification — recorded, not silently dropped |
| C2-3 | Shim → vendor chain could cycle | **No cycle**: `vendor-bridge.js` imports no router root, no preset, and no vendor module; no vendored source self-imports `@nolit/dsh-opencode-v2` (only doc comments and the client module id) |

Rollback: package-level rollback stays safe at Phase A because external callers use the seven
`@nolit/dsh-opencode-v2` shims; it stops being safe once consumers import `./vendor/opencode/*`
directly.

### CP3 — Phase A sign-off (2026-11-10)

Reviewer: **Argon 4.0 (medium)**, 7,856 in / 191 out. Verdict **APPROVE**.

Phase A is closed with these gates: router **464/464** (396 + 68 adversarial), deepinfra
**223** (216 + 7 skip), vendored opencode **481/481**, `docs:check` OK.

CP3's one forward risk for Phase B: **stream lifecycle ownership across the vendor boundary** —
one canonical `AbortController`/lifecycle owner per stream, so an abort or error cannot leave a
reader lock or listener dangling when the pipe meets the vendored consumer.

Deferred validation edge cases (recorded in `test/driver-adversarial.test.mjs`, deliberately not
fixed): id case/whitespace normalisation, intra-driver duplicate names, command-name syntax,
switch-name uniqueness, `catalogLayer` NaN/Infinity, function-value freezing. They are
non-structural while every driver is first-party; they must be closed **before** third-party
driver registration is opened.
