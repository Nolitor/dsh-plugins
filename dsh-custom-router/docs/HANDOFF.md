# Custom Router — Handoff

<!-- skeleton:
version: 1.4
kind: report
status: active
updated: 2026-11-13
summary: Handoff for @nolit/dsh-custom-router at 0.0.1-rc.13 — Phase B stays closed; this round delivered the model-list refresh contract (vendor ?refresh=1, two buttons, one bus), six measured vendor defects (catalog host, xhigh round-trip, promotion coercion, disabled routes, two test-isolation leaks), a live route gate (verify:refresh), the preset-registry audit recorded for a future one-place preset addition, and the doc corrections that closed C1 (llm-pi-ai active by default, router does not force it) and adopted the DSH credential-store policy for API keys; records the preparation state for N3 and the S-steps.
-->

> History lives in [CHANGELOG.md](../CHANGELOG.md). This file is the **forward** view: stage order,
> entry/exit conditions, and what is blocked. Rules: [docs/RULES.md](../../docs/RULES.md).

## 1. State

| Item | Measured value |
| :--- | :--- |
| Package | `@nolit/dsh-custom-router@0.0.1-rc.13` (vendors: antigravity `rc.12`, deepinfra `rc.13`, opencode `rc.6`; every peer pinned `0.0.1-rc.13`) |
| Last commit | `8ea7044` (tokeneconomizer hairline) — this round is the working tree, committed as the round's own commit |
| Host | DSH `0.2.2-rc.1` (measured: `@deepseek-ai/dsh/package.json`) |
| Tests | `npm test` → **509/509**; antigravity **184**, deepinfra **217**, vendored OpenCode **546** |
| Live route gate | `npm run verify:refresh` → **PASS** (3/3 routes, isolated `DSH_HOME`) |
| Docs | `docs:check` OK (38 workspace / 12 pending / 6 tracks, 1,531 links) |

### 1a. This round (2026-11-13) — what shipped

Owner instruction: 커스텀라우터 모델서빙 리스트가 왜 업데이트가 안 되고 있는지 + 세 구조로 패치.

**The refresh contract** ([MODEL-LIST-REFRESH.md](./MODEL-LIST-REFRESH.md)):

| Structure | Delivered |
|---|---|
| Backend `?refresh=1` cache bypass | antigravity `catalog.invalidate()`, deepinfra `invalidateCatalog()`, opencode `catalog.refresh()`; a malformed URL is a plain read, a failed probe still answers 200 |
| Refresh control on both surfaces | models-tab toolbar (`data-action="refresh-models"`) + dashboard header (which was **throwing** — `setReload(read)` passed `read` as a React updater) |
| One refresh bus | `onRefresh`/`requestRefresh`; buttons send `{force:true}`, host events send `{force:false}`; `remote` is now a declared inject |

**Six defects found by measurement, not by reading.** Each has a regression test:

| # | Defect | Evidence |
|---|---|---|
| 1 | Antigravity catalog came from `cloudcode-pa` (26 models, no Hydrogen) instead of `daily-cloudcode-pa` (31, 4 Hydrogen) | `rpc()` hardcoded the control host and ignored `baseUrl` |
| 2 | `splitEffort` knew only `low/medium/high` | `gemini-4-hydrogen-xhigh` became its own base row |
| 3 | `EFFORT_ORDER`/`EFFORT_NAMES`/name-trim knew 3 levels | `indexOf('xhigh') === -1` sorted it ahead of `low`; row kept `(XHigh)` in its name |
| 4 | **F-40 violation**: `modelForEffort()` folded `xhigh → high` unconditionally | selecting XHigh sent High |
| 5 | DeepInfra promo badge: `Number(null) === 0` is finite | all 83 full-price rows badged `0%`; live now **8 discounted / 83 list** |
| 6 | `-disabled` routes offered as selectable models | `gemini-4-carbon-disabled` has a displayName but no quota |

Also fixed (pre-existing, blocked a clean run): `vendor/opencode` tests read the operator's live
catalog because `adapterFor()`/`makeAdapter()` omitted `catalogPath` — 6–8 failures on a developer
machine, green in CI. Now isolated.

### 1b. Live state — the owner has already exercised the fix

Measured 2026-11-13 in `~/.dsh/profiles/web/cordis.patch.yml`:

- antigravity `enabledModels` = **13**, and it contains `gemini-4-hydrogen-{low,medium,high,xhigh}`
  — all four levels as **separate ids**. `high` and `xhigh` coexist, which is the proof that the
  F-40 reverse mapping now round-trips instead of folding.
- deepinfra `enabledModels` = 2 (`DeepSeek-V4.1-Flash-1017`, `GLM-5.3`); the promotion fix is live
  on the route (8 discounted / 83 list of 91 chat rows).
- opencode `enabledModels` = 3, `activePlan: go`, so `opencode/gemini-4-hydrogen` (a **Zen** route)
  is absent by design — `otherPlanCount: 26` reports the ones the tab is not showing.

| Gate | This round |
| :--- | :--- |
| Contract check | `vendor/opencode: npm run verify:contract` → 139 documented, 5 used, **0 undocumented** |
| Guard | `strictWire:false`, `allowDynamicPassthrough:true`, `rawBypass:false` (all declared, advisory default) |
| Shared pipe | `npm run verify:stream` → **7/7 cases, 0 vendor loads** |
| Preset parity | `npm run verify:presets` → OK; providers `deepseek-account, antigravity, deepinfra, deepinfra-anthropic, opencode-http-agent` |
| Live mount | 5 providers, 6 commands, 6 tools resolved from the live profile |

**Superseded by measurement:** an earlier revision of this section said `dsh-web.service` had *not*
been restarted. Measured 2026-11-13 10:18 KST:
`ExecMainStartTimestamp=Fri 2026-11-13 10:01:43 KST`, `NRestarts=0`, `ActiveState=active`. The
service **did** restart after the `rc.13` files landed, so the browser now serves the `rc.13` bundle.
N1's browser checklist below is therefore actionable now; what it confirms is the *render*, not the
load.

### 1c. This round — documentation corrections (2026-11-13)

Owner instruction: `llm-pi-ai` is not disabled but active by default and the custom router does not
force it; API-key input is managed through the DSH system store.

| # | Corrected | Where | Result |
|---|---|---|---|
| 1 | D4 merged "don't build a second parser" with "the `llm-pi-ai` row is disabled"; the second half stopped being true 2026-11-08 | [CUSTOM-ROUTER-SURFACE-CONTRACT.md](./CUSTOM-ROUTER-SURFACE-CONTRACT.md) §1 D4 | split into (a) parser rule — still holds — and (b) row status — corrected; **closes open contradiction C1** |
| 2 | New §5.2: the router never forces the row (no `disabled: true`, no redundant enable, no `providers` write) | same, §5.2 | measured: the live patch has **no** `llm-pi-ai` entry at all, only a comment — the row sits at its enabled bundle default |
| 3 | New D5 + §5.1: API keys live in the DSH credential store, never as a preset literal | same, §5.1 | cites the real contract: `CredentialRef` / `CredentialKey`, empty-is-absent, `modifyRecord`, `credentials/reference-updated` / `record-updated`, `role('secret')`, `AUTH_SOURCES` |
| 4 | Live profile is **not yet compliant** with D5 | — | `~/.dsh/profiles/web/cordis.patch.yml:155` still holds the DeepInfra key as a plaintext `apiKey:`; the document says so instead of claiming compliance |

**C1 is closed as a documentation fix; the key migration (item 4) is open** — see N5 below.

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

## 3. Contradictions (reported, then acted on only where instructed)

### C1 — `llm-pi-ai` status disagreed between two documents — **CLOSED 2026-11-13**

| Document | Line | Said |
| :--- | :--- | :--- |
| [CUSTOM-ROUTER-SURFACE-CONTRACT.md](CUSTOM-ROUTER-SURFACE-CONTRACT.md) | D4 table row, §1 | "`llm-pi-ai` stays disabled; its adapter is imported" (owner decision 2026-11-07) |
| [DSH-HARNESS-POLICY.md](../../docs/DSH-HARNESS-POLICY.md) | §1.1 | the owner **re-enabled** `llm-pi-ai` on 2026-11-08; it starts dormant with zero routes |

**Resolution (owner instruction 2026-11-13).** D4 was re-worded to separate the two ideas it merged:
(a) *do not build a second parser when DSH supports the protocol* — **still holds**; (b) *the
`llm-pi-ai` row is disabled* — **stopped being true on 2026-11-08**. The contract now states that
`llm-pi-ai` is **active by default**, that the status is the host's rather than this package's, and
(§5.2) that the router never forces the row on or off.

Measured basis: `grep -n "pi-ai" ~/.dsh/profiles/web/cordis.patch.yml` returns **one comment line
and no patch entry**. A row with no patch entry is at its bundle default; the comment records the
owner's 2026-11-08 decision. The earlier statement that the bridge overlay sets
`llm-pi-ai.providers: {}` was not reproducible in the patch file this round.

### C2 — API-key storage: policy vs live profile — **OPEN (tracked as N5)**

The policy adopted this round (contract D5/§5.1) is that an API key lives in the DSH system
credential store. The live profile still holds the DeepInfra key as a plaintext `apiKey:` field.
A policy document that described the live state as compliant would be false; §5.1 rule 7 says so
explicitly. No live write was made — migrating the key is a profile edit that needs owner approval.

## 4. Verification

```bash
cd dsh-custom-router
npm test                    # 509 (router surface)
npm run verify              # check + test + verify:stream
npm run verify:presets      # preset parity against the live profile
npm run verify:refresh      # NEW: real routes, isolated DSH_HOME, plain + ?refresh=1
(cd vendor/antigravity && node --test test/*.test.mjs)   # 184
(cd vendor/deepinfra  && node --test test/*.test.mjs)    # 217
(cd vendor/opencode   && node --test test/*.test.mjs)    # 546
```

`npm test` only runs `test/*.test.mjs`; the three vendor suites are separate commands. A run that
skips them is not a verification.

`npm run verify:refresh` boots the real `web` profile into a throwaway `DSH_HOME`, reads the host's
own route table, and calls each model route twice. It prints the base ids it read, so "200 with
rows" cannot hide a catalog that omitted the model under investigation.

## 5. Next actions, in order

### N1 — owner: confirm in the browser (service already restarted)

The service restarted at **10:01:43 KST today**, so `rc.13` is being served. Confirm the render:

1. Models tab → antigravity: `Gemini 4 Hydrogen` is ONE row; its reasoning cell lists
   low / medium / high / **xhigh**, and picking xhigh must send `gemini-4-hydrogen-xhigh` (not
   `-high`).
2. DeepInfra tab: only the 8 genuinely-discounted rows carry a badge; the footer counts 8, not 91.
3. Both refresh buttons (models toolbar, dashboard header) work and update each other.

### N2 — preset registry standardisation (design recorded, NOT implemented)

[docs/PRESET-REGISTRY-STANDARD.md](./PRESET-REGISTRY-STANDARD.md) is the audit the owner asked for:
adding a preset touches **five** places and two of them (`MODEL_PRESETS`, `fetchUsageFeeds`) fail
**silently** — no tab, no usage card, no error.

Owner decision: record the design, defer the change. The dependency order is §4 of that document.
The cheapest meaningful step is **6 (the drift gate)**: a check that fails when a `PRESETS` id has no
`MODEL_PRESETS` descriptor or no `usageRoutes`. That alone converts both silent failures into loud
ones, without changing the runtime.

### N3 — a fourth preset is currently unguarded — preparation state

Until N2 lands there is no gate, so the preparation below is what a next session must hold in hand.

**The five places, and what breaks when one is missed:**

| # | Place | File | Failure when missed |
|---|---|---|---|
| 1 | `PRESETS` | `lib/presets.js` | preset cannot mount; `planApplications()` reports unknown preset (loud) |
| 2 | `MODEL_PRESETS` | `lib/client.src.js` | **silent**: no settings tab |
| 3 | `fetchUsageFeeds` | `lib/client.src.js` | **silent**: no dashboard usage card |
| 4 | locale table / label key | locale + `client.src.js` | raw key shown instead of a label |
| 5 | mirrored `client.js` | built from `client.src.js` | hand-edited bundle is overwritten on next build |

**Interim rule (still in force):** touch all five places and **say so in the CHANGELOG**. A fourth
preset added today would render no tab and no dashboard card, and nothing would report it.

**What is already ready for N3:**

- The declaration shape is final and validated — `validatePreset` / `validatePresets` reject a
  missing lane, a bad `subagent_<provider>` name, duplicate tool/command names, and an `auth.mode`
  without sources. A new preset is **data**, not code.
- `auth.sources` is where a new key origin goes; per D5/§5.1 a `secret-field`/`credential-ref` source
  reads the DSH store, so a new preset needs **no new setter**.
- `scripts/verify-presets.mjs` already boots an isolated `DSH_HOME` and diffs live registries against
  the declarations — it can be extended for #2/#3 rather than replaced.
- The pair test asserts every `MODEL_PRESETS` id exists in `PRESETS` and its `row` matches. It
  catches #1/#2 id drift only; #3 needs the N2 step-6 gate.

**First action for N3** is step 1 of the N2 plan (add `usageRoutes` to the existing three presets),
because it is the only step that changes no behaviour and it is what step 3 and 6 build on.

### N4 — Phase C–F / Core-A0 unchanged

See §7. Nothing in this round moved them; the refresh work is orthogonal to the absorption plan.

### N5 — API-key migration to the DSH credential store (new, owner-gated)

D5/§5.1 is now the policy; the live profile is not yet migrated (C2 above). The prepared sequence:

| Step | Work | Gate |
|---|---|---|
| 1 | Add a `credential-ref` source to the DeepInfra preset's `auth.sources`, keeping `secret-field`/`env` as fallbacks | router unit tests still green; no key read from a wire response |
| 2 | Write the key into the DSH store through the service, not the patch file | `credentials/reference-updated` observed; `describe` reports configured |
| 3 | Remove the plaintext `apiKey:` from `~/.dsh/profiles/web/cordis.patch.yml:155` | `grep -c apiKey` on the patch returns 0 |
| 4 | Restart and re-verify serving | `verify:refresh` PASS; Settings shows "설정됨" without receiving the value |

Steps 2–4 are **live-state writes** and need owner approval. Until then the plaintext key stays, and
no document may describe the profile as compliant.

## 6. S-step preparation (what an S round starts from)

The S-steps are listed in §2. Their preparation state, so a next session does not re-derive it:

| Step | State | What is ready | What is missing |
|---|---|---|---|
| S1 (shared pipe) | **done — Phase B** | `pipe: 'legacy' \| 'shared'`, legacy default, parity 544/544; `verify:stream` 7/7 with 0 vendor loads | the owner-gated live request with `pipe:'shared'` (§7 target 1) |
| S2 (parity suite) | **not started** | S1 delivered; the shared core exists and is the replay target | one recorded fixture per provider; the exit gate needs the three streams to agree on `StreamChunk` shape |
| S3 (antigravity usage per group) | **deferred by owner 2026-11-08** | in-group window order already 5시간 → 주간 → 월간 | split the dashboard card per model group (Gemini / Claude·GPT / Argon) |
| S4 (spec-only surfaces) | **blocked: needs owner approval** | `CUSTOM-ROUTER-PRESET-SURFACE.md` written | no `settings.section` row, no client half, no real mount |
| S4b (provider-slot step 1) | **done, then reverted** | live profile carries `opencode`, `cli_worker`, `/ocode` | step 2 = regression guard; step 3 blocked on M9 |
| S4c (dispatch policy) | **done 2026-11-10, `applied pending restart`** | `verify:dispatch` 17/17 | confirm after the next restart |
| S5 (S-A / S-B / S-C) | later rounds | — | S-C blocked on the upstream console API |

**Ordered next S work:** S2 (parity fixtures) is the only S-step with no blocker other than its own
work. S4 stays parked behind owner approval; do not start it from a spec alone.

## 7. Phase B closure — runtime invariants and next targets

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
