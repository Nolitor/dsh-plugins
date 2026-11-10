# OpenCode v2 Absorption — Three-Pipeline Blueprint

<!-- skeleton:
version: 1.0
kind: design
status: draft
updated: 2026-11-10
summary: Phased plan to absorb @nolit/dsh-opencode-v2 into dsh-custom-router/vendor/opencode, aligned against the three existing pipelines — DeepInfra for the shared stream pipe, Antigravity for the surface/dispatch supervisor, and the router preset slot for registry and dynamic activation — with file moves, fallback shims, and per-phase verification gates.
-->

> Status: **draft, not started.** Owner instruction 2026-11-10: absorb OpenCode v2 as a native
> vendor slot, not in isolation, by conforming to the two shipped vendor references.
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
catalog probe layer. M9 (capability-driven readiness) is **owner-deferred and not implemented**;
this blueprint treats readiness as data (`vendorProbes.opencode` + catalog layers) and keeps the
activation policy manual (`presets.opencode` + switches) until the owner opens M9.

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
| B4 | Keep `stream-parser.js` as the legacy classifier behind `parser: 'legacy' \| 'canonical'`; `classifyText` calls the canonical parser | `classifyText` hook (P4's stated owner) |
| B5 | Retire `display-gate.js`, `display-clean.js` when the canonical parser covers the notation; keep `arguments.js` inside the hook if it is still needed | −278 L minimum |

Exit gate: P4 gate from the spec (suite green, `markerDeltas == 0`, prose gate, `classifyText`);
`verify:stream` gains one OpenCode descriptor case; no `[tool call` notation reaches the client.

### Phase C — surface supervisor and dispatch parity

| Step | Action | Output |
| :--- | :--- | :--- |
| C1 | Replace register-once `apply()` with the Antigravity `parts`/`syncAll` shape | live switches |
| C2 | Add `bindDispatch()` and an `app-boot/config-reload → syncAll` listener | closes F-46 |
| C3 | Bind `cli_worker` and the fallback spawn to `dispatch.track`/registry like `agy_worker` | reclamation parity |
| C4 | Decide managed-child gating: exclude `opencode` from the external-CLI tool set when the subagent provider is mounted, or keep the pre-execute deny and document it | one policy, no false "CLI blocked" on an in-process child |
| C5 | Drop the package's own `settings.section`; its fields live in the router dashboard | one UI |
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
| Suites | `npm test` in router + vendored opencode + antigravity + deepinfra | A–E |
| Stream | `npm run verify:stream` (new OpenCode descriptor case) | B |
| Replay | `scripts/analyze-opencode-trace.mjs` → `markerDeltas == 0` | B |
| Parity | P5: one fixture per provider → identical `StreamChunk` shape | B |
| Mount | `npm run verify:presets` on the live profile + preset-only boot | A, D, E |
| Dispatch | `npm run verify:dispatch` (matrix includes OpenCode surfaces) | C |
| Reload | flip `cli` on a live isolated session; no restart needed | C |
| Docs | `npm run docs:check` + `node scripts/check-plugin-history.mjs` | every phase |
| Publish | `npm run check:publish` after D4/E2 | D, E |

## 6. Risks and open decisions

1. **Duplicate mount** is the only hard-failure risk: the profile link and the vendored preset
   must never mount the same provider/tool twice. Phase A stays unmounted; the guard test lands
   before Phase D.
2. **Client half.** OpenCode ships a 1,004-line settings client; the router already owns the
   dashboard and the `opencode` tab. Phase C5 decides "fold, do not re-mount". Shipping both is
   a second source of truth for switches.
3. **Canonical parser ownership.** P4 places `classifyText` in this migration, but stage 2 of
   [OPENCODE-V2-STAGE-PLAN.md](../../dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md) is still
   gated on owner verdicts O1/O2/O3. P4 can land with the **legacy** classifier behind the hook
   and swap to canonical when stage 2 opens — that keeps the pipe migration unblocked.
4. **M9 readiness** stays deferred. The blueprint wires readiness data but not automatic
   activation; that is an owner decision.
5. **Usage ledger ownership.** The CLI and HTTP rows already share
   `opencode-session-cost.json`; after absorption the router owns that path via the vendored
   cost module. One writer must remain.
6. **Peer dependency.** The shim keeps `@nolit/dsh-custom-router` as a peer during the transition;
   once the vendored copy is the only writer the cycle disappears and the peer can be dropped.
