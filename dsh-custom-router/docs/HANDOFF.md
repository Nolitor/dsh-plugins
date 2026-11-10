# Custom Router — Handoff

<!-- skeleton:
version: 1.1
kind: report
status: active
updated: 2026-11-10
summary: Stage-by-stage handoff for @nolit/dsh-custom-router at 0.0.1-rc.10 — what is done, the next ordered stages with their gates, the preset-based dispatch policy revised 2026-11-10, and the owner decisions that block each one.
-->

> History lives in [CHANGELOG.md](../CHANGELOG.md). This file is the **forward** view: stage order,
> entry/exit conditions, and what is blocked. Rules: [docs/RULES.md](../../docs/RULES.md).

## 1. State

| Item | Measured value |
| :--- | :--- |
| Package | `@nolit/dsh-custom-router@0.0.1-rc.10` |
| Last commit | `56c59d6` 2026-11-08 (rc.9) + the 2026-11-10 preset-policy revision (rc.10) |
| Tests | `npm test` → **372/372 pass** |
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
| Blocked by | nothing technical — **not started** |

### S2 — P5: parity suite

| Field | Value |
| :--- | :--- |
| Entry | S1 delivered |
| Work | one recorded fixture per provider replayed through the shared core |
| Exit gate | the three streams produce the same `StreamChunk` shape for the same semantic event |
| Blocked by | S1 |

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
