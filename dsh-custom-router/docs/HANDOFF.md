# Custom Router — Handoff

<!-- skeleton:
version: 1.2
kind: report
status: active
updated: 2026-11-10
summary: Handoff for @nolit/dsh-custom-router at 0.0.1-rc.10 — Phase B (OpenCode absorption, shared pipe, ingress guard, external-contract check) closed; runtime invariants, owner-gated live run, and the Phase C–F / Core-A roadmap that follows.
-->

> History lives in [CHANGELOG.md](../CHANGELOG.md). This file is the **forward** view: stage order,
> entry/exit conditions, and what is blocked. Rules: [docs/RULES.md](../../docs/RULES.md).

## 1. State

| Item | Measured value |
| :--- | :--- |
| Package | `@nolit/dsh-custom-router@0.0.1-rc.10` |
| Last commit | `135c009` 2026-11-10 — B-3 contract check recorded (Phase B closed) |
| Tests | `npm test` → **491/491**; vendored OpenCode → **544/544** |
| Contract check | `vendor/opencode: npm run verify:contract` → 139 documented, 5 used, **0 undocumented** |
| Guard | `strictWire:false`, `allowDynamicPassthrough:true`, `rawBypass:false` (all declared, advisory default) |
| Shared pipe | `npm run verify:stream` → **7/7 cases, 0 vendor loads** |
| Preset parity | `npm run verify:presets` → OK; providers `deepseek-account, antigravity, deepinfra, deepinfra-anthropic, opencode-http-agent` |
| Live mount | 5 providers, 6 commands, 6 tools resolved from the live profile |

## 2. Stages (in order)

### S1 — P4: move `dsh-opencode-v2` onto the shared stream pipe

| Field | Value |
| :--- | :--- |
| Entry | P2 + P3 integrated (done) |
| Work | add the `classifyText` hook in [SHARED-STREAM-PIPE-SPEC.md](SHARED-STREAM-PIPE-SPEC.md) terms |
| Exit gate | opencode-v2 suite green; replay shows `markerDeltas == 0`; S2-3 prose gate passes |
| Result | **done (Phase B)** — opencode moved onto the shared pipe behind `pipe: 'legacy'|'shared'` (legacy default), parity proven 544/544. The replay gate was withdrawn as unevidenced (trace stores only len/excerpt); prose gate moved to Phase F (owner decision D-4) |
| Blueprint | [OPENCODE-ABSORPTION-BLUEPRINT.md](./OPENCODE-ABSORPTION-BLUEPRINT.md) Phase B (legacy classifier first; canonical default in Phase F) |

### S2 — P5: parity suite

| Field | Value |
| :--- | :--- |
| Entry | S1 delivered |
| Work | one recorded fixture per provider replayed through the shared core |
| Exit gate | the three streams produce the same `StreamChunk` shape for the same semantic event |
| Blocked by | S1 |
| Blueprint | [OPENCODE-ABSORPTION-BLUEPRINT.md](./OPENCODE-ABSORPTION-BLUEPRINT.md) Phase F |

### S3 — Antigravity usage per model group

Antigravity reports usage **per model group** (Gemini / Claude·GPT / Argon). The dashboard card
merges them and shows one window set.
**Owner decision recorded 2026-11-08: deferred.** Split the card per group; the in-group window
order is already 5시간 → 주간 → 월간.

### S4 — remaining spec-only surfaces

`CUSTOM-ROUTER-PRESET-SURFACE.md` is specification only: no `settings.section` row, no client half,
no real mount, no generation turn. **Requires owner implementation approval.**

### S4b — provider-slot migration, Step 1 (delivered 2026-11-08)

| Field | Value |
| :--- | :--- |
| Entry | owner approval 2026-11-08 (M9 explicitly deferred) |
| Work | peer alignment to the shipped router version; the OpenCode CLI toggle was applied and **withdrawn the same day**; `surfaces.cli` kept `gates: ['opencode']` |
| Exit gate | `verify:presets` OK on the live profile; model serving still mounted |
| Result | **done, then reverted** — the live profile and the current mount carry `opencode`, `cli_worker` and `/ocode` (measured 2026-11-10). An earlier revision of this table said the CLI surface was off; that was wrong. |
| Detail | [CLI-DISPATCH-CONTROL-PLANE.md §8](./CLI-DISPATCH-CONTROL-PLANE.md) |

**Open issue this step exposed:** `dsh-opencode-v2` has no `app-boot/config-reload` reconcile, so
the toggle needs a `dsh-web.service` restart (ledger F-46 class). Not fixed — owner has not
approved a code change there.

**Step 2 is already satisfied** in the live profile (`dsh-opencode-v2` is a dependency, not a
bundle), so what remains is a regression guard. **Step 3 stays blocked on M9.**

### S4c — dispatch policy: preset-based (delivered 2026-11-10)

| Field | Value |
| :--- | :--- |
| Entry | owner instruction 2026-11-10 |
| Work | `workspace-write` removed from the restricted sandbox set; `ptc` added to the restricted preset set |
| Rule | `minimal`/`ptc` hard-block; `standard`/`cordis` dispatch on `workspace-write`; `read-only` still blocks |
| Exit gate | `npm test` 372/372; `verify:dispatch` 17/17; live mount unchanged |
| Detail | [CLI-DISPATCH-CONTROL-PLANE.md §9](./CLI-DISPATCH-CONTROL-PLANE.md#9-policy-revision--preset-based-enforcement-2026-11-10) |
| Live state | `applied pending restart` — the running service holds the previous gate until it restarts |

### S5 — later rounds

- **S-A** (declaration / Custom-JSON onboarding) and **S-B** (readiness probe surface): later rounds.
- **S-C** (per-model limit / plan-tier fidelity): **on hold** behind the upstream console API.
- `PlanUsageCard` stays exported but **not mounted** in Settings — usage belongs to the sidebar
  dashboard by owner decision; do not re-mount it in the settings tab.

## 3. Open contradictions (report only, not acted on)

### C1 — `llm-pi-ai` status disagrees between two documents

| Document | Line | Says |
| :--- | :--- | :--- |
| [CUSTOM-ROUTER-SURFACE-CONTRACT.md](CUSTOM-ROUTER-SURFACE-CONTRACT.md) | D4 table row, §1 | "`llm-pi-ai` stays disabled; its adapter is imported" (owner decision 2026-11-07) |
| [DSH-HARNESS-POLICY.md](../../docs/DSH-HARNESS-POLICY.md) | §1.1 | the owner **re-enabled** `llm-pi-ai` on 2026-11-08; it starts dormant with zero routes |

The live profile agrees with the policy: the bridge overlay sets `llm-pi-ai.providers: {}`, which is
an enabled-but-empty row, not a disabled one.

**Fix belongs to this track**, because D4 is this track's contract: re-word D4 so it separates the
two ideas it currently merges — (a) *do not build a second parser when DSH supports the protocol*,
which still holds, and (b) *the `llm-pi-ai` row is disabled*, which stopped being true on 2026-11-08.
Lines that repeat the stale claim: §1 D4, §2.1 note, §5 lane rules.

Reported, not fixed.

## 4. Verification

```bash
cd dsh-custom-router && npm test && npm run verify:stream && npm run verify:presets
```

## 8. Phase B closure — runtime invariants and next targets

**Phase B closed 2026-11-10** as *absorbed, guarded, regression-parity proven* — not production-
certified (no published streaming contract; protocol work is Phase F).

| Invariant | Value / owner |
| :--- | :--- |
| HTTP pipe selection | `pipe: 'legacy' \| 'shared'`, **legacy default**; shared is opt-in per profile |
| Wire guard | `strictWire: false` (advisory: warn + `wire:'unverified'` + attempt) |
| Dynamic passthrough | `allowDynamicPassthrough: true` — unknown catalog keys preserved |
| Raw bypass | `rawBypass: false` — skips preflight and body rewriting when enabled |
| Parser | `parser: 'legacy'` default; canonical parser stays ported-but-off (Phase F) |
| Stream lifecycle | one `AbortController` per stream; reader lock released on every exit |
| Dispatch policy | `minimal`/`ptc` hard-block; `read-only` blocks; `workspace-write`/`full` allow |
| Mount | vendored `vendor/opencode`; `dsh-opencode-v2` is a 7-file re-export shim only |

**Next targets, in order.**

1. **Owner verification gate** — one live request with `pipe: 'shared'` (owner-gated; needs the
   running service and a real turn). Until then the shared path is test-proven only.
2. **Core-A0 (audit engine)** — contract + registry + synthetic-preset fixture; explicitly deferred
   until Phase B's guard was verified (now satisfied). Non-blocking observer, no runtime gate.
3. **Phase C** — vendored OpenCode surface supervisor (`syncAll` + `app-boot/config-reload` parity
   with Antigravity), registry binding for `cli_worker`, one dashboard UI.
4. **Phase D** — switch the preset to the vendored slot, cut the profile link, preset-only boot.
5. **Phase E** — retire the shim/old track after one release.
6. **Phase F** — canonical parser default + oracle, Anthropic/Responses protocol seam, 2.2.6
   job/session P0–P5, compatibility fields (`requireReasoning`, thinking/effort updates).
