# OpenCode v2 — Handoff

<!-- skeleton:
version: 1.2
kind: report
status: active
updated: 2026-11-13
summary: Stage-by-stage handoff for @nolit/dsh-opencode-v2 at 0.0.1-rc.5 — the delivered CLI-subagent work, the router dispatch-policy revision, the three open stage-1 observations that need an owner verdict, and the gated stage-2 parser swap. Re-measured 2026-11-13 for the S-work handoff: the track is a 7-file re-export shim whose suite lives in dsh-custom-router/vendor/opencode, `npm test` now reports the real 546/546 instead of a hollow 0/0, and the stale router peer pin (rc.11 vs the shipped rc.15) is corrected.
-->

> History lives in [CHANGELOG.md](../CHANGELOG.md). This file is the **forward** view.
> Stage authority: [OPENCODE-V2-STAGE-PLAN.md](OPENCODE-V2-STAGE-PLAN.md).

## 1. State

| Item | Measured value |
| :--- | :--- |
| Package | `@nolit/dsh-opencode-v2@0.0.1-rc.5` |
| Last code commit | `56c59d6` 2026-11-08 (rc.4) + the 2026-11-10 router-peer revision (rc.5) |
| Tests | `npm test` → **546/546 pass** (measured 2026-11-13) |
| Stage | **stage 1 (stabilisation) in progress** |
| **Track body** | **a 7-file re-export shim** (`lib/{index,http,provider,subagent,cost,client,optional-service}.js`, 57–81 bytes each) pointing at `@nolit/dsh-custom-router/vendor/opencode/*` — Phase A moved the implementation |
| **Router peer** | `0.0.1-rc.15` (was a stale `0.0.1-rc.11`, which the shipped `rc.14`/`rc.15` could never satisfy) |

### 1a. S-work readiness — measured 2026-11-13

Two defects were found by measuring rather than by reading, and both would have made an S-work
handoff report a state that was not true:

1. **`npm test` reported 0/0 and exited 0.** Phase A moved `test/` into
   `dsh-custom-router/vendor/opencode/test`, but `package.json` kept pointing at the deleted
   `./test/` glob. Node's test runner treats an unmatched glob as "no tests" and exits **0**, so the
   command looked green with nothing having run. The script now points at the vendored suite:
   **546/546**, measured.
2. **The router peer pin was unsatisfiable.** `@nolit/dsh-custom-router@0.0.1-rc.11` is an exact
   pin; the installed router was `rc.14`. `semver.satisfies('0.0.1-rc.14', '0.0.1-rc.11')` is
   `false`. It went unnoticed because the live profile links both packages from disk, and a `file:`
   link carries no version metadata for npm to check. Repinned to `rc.15`; all four manifests now
   agree.

The **shared stream pipe** (S3 → Phase B) is delivered on the vendor side, not here:
`vendor/opencode/lib/{stream-contract,stream-lifecycle,openai-mapping}.js` exist, `pipe` stays
`legacy` by default, and `npm run verify:stream` reports **8/8, 0 vendor loads**. Nothing in this
track still needs to ship for that step — see the router's
[OPENCODE-ABSORPTION-BLUEPRINT.md §9.1](../../dsh-custom-router/docs/OPENCODE-ABSORPTION-BLUEPRINT.md).

## 2. Done

- Managed child-session delegation cutover (the `opencode` tool returns a child id immediately).
- `request.agentOptions.model` beats `config.model` and reaches `opencode run -m`.
- `resolveExecutable()` — the default bare `opencode` is not on the host PATH; every delegation
  used to fail before the CLI started.
- Usage: `parseRunStream` sums `step_finish` tokens; `sharedCostLedger()` makes the CLI row and the
  HTTP row feed the **same** `opencode-session-cost.json`.

## 3. Stages

> **Absorption (2026-11-10).** This track is being absorbed into
> [dsh-custom-router/vendor/opencode](../../dsh-custom-router/docs/OPENCODE-ABSORPTION-BLUEPRINT.md).
> Stages below are re-homed, not dropped: S2 → Phase B (port, legacy default) and Phase F
> (canonical default + oracle); S3 → Phase B; S4 → Phase F; S5 → Phase A–E.

### S1 — stage-1 observations awaiting an owner verdict

Each needs an owner report first; do **not** pre-emptively "fix" these.

| # | Observation | Evidence | Needs |
| :--- | :--- | :--- | :--- |
| O1 | Prose that mentions the call notation is erased and re-armed as a call candidate | reproducible 2026-11-04: `Use [tool call run_code #abc]: {...} syntax…` loses the sentence | is this a display bug to fix before stage 2? |
| O2 | Marker glyph drift — `｜` (U+FF5C), `│` (U+2502), `|` used for the same token | 1,048 / 7,291 finishes (14.4 %) carried a marker delta | stage 2 handles it; no standalone fix |
| O3 | `content_filter` maps to an error | 26 occurrences in trace | confirm the host handles the error kind well |

### S2 — canonical parser swap → Phase B + Phase F

Port the staged parser in `staging/opencode-v2-stage2/` behind
`parser: 'legacy' | 'canonical'` (default `legacy`) while Phase B integrates the shared pipe.
Making canonical the default, and the S2-4/S2-5 gates, move to **Phase F**. Owner decision
2026-11-10 decoupled Phase B from the O1/O2/O3 verdict.
Implementation brief: [OPENCODE-V2-IMPROVEMENT-SPEC-20261107.md](OPENCODE-V2-IMPROVEMENT-SPEC-20261107.md).

### S3 — shared stream pipe (P4) integration → Phase B

The pipe-side delivery is `classifyText`. Its owner-side work is in the Custom Router handoff
(`dsh-custom-router/docs/HANDOFF.md` S1); this track supplies the hook. Phase B uses the
**legacy** classifier behind the hook; the canonical parser becomes the default in Phase F.

### S4 — OpenCode 2.2.6 job/session APIs → Phase F

[OPENCODE-226-JOB-SESSION-INTEGRATION-ROADMAP.md](OPENCODE-226-JOB-SESSION-INTEGRATION-ROADMAP.md)
is a **draft**. P0 requires owner approval and a DB backup. Re-homed to **Phase F** (with P1–P5)
in the absorption blueprint; not scheduled before Phase E.

### S5 — provider-slot migration (2026-11-08)

Owner-approved Step 1 puts this package's CLI surface under the router's control and switched
OFF in the live profile. Peer on `@nolit/dsh-custom-router` moved `rc.2` → `rc.9`.

| Item | State |
| :--- | :--- |
| `peerDependencies['@nolit/dsh-custom-router']` | `0.0.1-rc.10` (rc.2 → rc.9 → rc.10) |
| CLI surface in the live profile | **live** — `cli: false` was applied and then withdrawn the same day |
| Model serving (`opencode-http-agent`) | **unchanged and mounted** |
| Subagent surface (`subagent_opencode`) | **unchanged and mounted** |

**Correction (2026-11-08).** An earlier revision of this HANDOFF recorded the CLI surface as
`cli: false`/unmounted. That is no longer true: the switch was withdrawn because it also removed
`/ocode` and the `opencode` tool. Note the vendor's own `cordis.patch.yml` never disabled the
surface — `cli` defaults to `true` — so the "unmounted" state was created by a profile edit and
reverted the same way.

**Recorded, not fixed:** this plugin installs no `app-boot/config-reload` reconcile, so a `cli`
flip needs a `dsh-web.service` restart (ledger F-46 class). `vendor/antigravity` does have
`syncAll`; this package does not. Fixing it is outside the approved scope.

## 4. Open state

- `modelSelection: true` arrives through the Custom Router preset; the live profile patch does
  **not** carry `modelSelection` (measured absent). Not a defect — recorded so the next reader does
  not look for it in the profile.
- The router's dispatch policy changed on 2026-11-10: `minimal`/`ptc` hard-block this package's
  external CLI paths, while `standard`/`cordis` allow them on `workspace-write` and only
  `read-only` still blocks. Detail: [router CLI doc §9](../../dsh-custom-router/docs/CLI-DISPATCH-CONTROL-PLANE.md).
- Multiple older CHANGELOG entries carry "applied pending restart"; those are historical. The
  current `rc.3` row is applied on disk.

## 5. Verification

```bash
cd dsh-opencode-v2 && npm test     # 546/546 — runs the VENDORED suite (see §1a)
cd dsh-custom-router && npm test   # 522/522, includes the preset drift gate
cd dsh-custom-router && npm run verify:presets && npm run verify:presets:mutation
```
