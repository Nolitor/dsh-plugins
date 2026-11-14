# Custom Router — Active Roadmap

<!-- skeleton:
version: 2.0
kind: design
status: active
updated: 2026-11-14
summary: Active roadmap for @nolit/dsh-custom-router at 0.0.1-rc.20: P0 security, P1 checks, and P2-A phased horizontally. Phase 1 (core lock) and Phase 2 (vendor fan-out) are DONE and measured; A3 is COMPLETE (the OpenCode legacy pipeline is gone — no config selects a pipeline any more), R4 is CLOSED (the L1 boundary lint and the USAGE_READERS gate exist), R3 is CLOSED (one retry core, one catalog cache) and R5 is CLOSED (no vendor ids in L1). The remaining queue is R2, R6 and A7; Phase 3 (A7 host seam) is still measure-first.
-->

> This is the **only** document that lists active work. Historical phases are in
> [ROADMAP-ARCHIVE.md](./ROADMAP-ARCHIVE.md); current state and next actions are in
> [HANDOFF.md](./HANDOFF.md); the horizontal layer contract is in
> [ARCHITECTURE-LAYERED.md](./ARCHITECTURE-LAYERED.md); copy-paste worker dispatch packages live
> in [WORKER-DISPATCH.md](./WORKER-DISPATCH.md). Do not execute a Phase/Step list from an older
> design doc.

## 1. What the router is now (the context that makes old phases obsolete)

- **One package owns the whole route.** `@nolit/dsh-custom-router@0.0.1-rc.20` contains the
  dashboard, the preset registry, the shared stream pipe and four **vendored** adapters
  (Antigravity, OpenCode, DeepInfra, EXAONE). The old multi-package absorption phases no longer
  describe a plan; they describe history.
- **One preset registry, derived.** `lib/presets.js` `PRESETS` is the declaration; `lib/preset-derive.js`
  derives browser facts, `lib/client.src.js` builds `MODEL_PRESETS`, and the host seam
  `lib/index.js` publishes `presetSettings`. The old "two registries / five hand-written places"
  model is superseded.
- **One shared stream pipe.** `lib/stream/` normalizes every provider; vendors bind through
  `stream-contract.js`. **As of Phase 2 (2026-11-14)**: the pipe is **1 851 lines**
  (`index` 345, `openai` 467, `anthropic` 433, `usage` 217, `sse` 216, `failure` 105, `wire` 68)
  and **no longer contains a protocol fork**: Anthropic rides the shared SSE reader
  (`anthropic.js` 614 → **433 L**), OpenAI has one core (`lib/stream/openai.js`, **467 L**), and
  `verify:stream` now proves the core runs with zero vendor loads against **all 4** vendored
  packages (measured: **4 probed, 8/8 specifiers refused, 0 loads**). **A3 is COMPLETE**
  (measured 2026-11-14, `e8b39f7`): the OpenCode legacy pipeline is gone — `http.js` **3 272 →
  2 721 L** (−630/+79), **no config selects a pipeline any more**, and the vendor's
  `stream-parser.js` was **not** dead code but shared-path glue, so it was **renamed** to
  `vendor/opencode/lib/notation-classifier.js` (679 L, single named export, one consumer).
  **R4 is CLOSED**: `test/stream-boundary.test.mjs` (15 cases) and
  `scripts/verify-usage-readers.mjs` + `test/usage-readers.test.mjs` (12 cases) now enforce the
  L1 boundary and the `usage.routes[].normalize` names. **R3 is CLOSED** (`77a53b0`): **one** retry
  core (`lib/retry.js`) and **one** catalog cache (`lib/catalog-cache.js`) now serve every vendor.
  **R5 is CLOSED** (`77a53b0`): `lib/plan.js` names **0** vendor ids. The remaining consolidation
  queue is **§4 P2-A**: **R2**, **R6** and **A7**.
- **Specs and conformance are part of the product.** `specs/` holds the protocol/provider/pricing
  registry, `verify-specs` enforces freshness, `build-spec-matrix` generates the compatibility
  matrix, `spec:watch` reports upstream changes manually, and `test/conformance/` replays one
  OpenAI-completions fixture through three bindings.
- **Four live presets** are registered: Antigravity, OpenCode, DeepInfra, EXAONE. EXAONE is enabled
  in the live profile and currently free after application.
- **The picker lists served routes only.** The synthetic `OpenCode (config default)` row is gone
  from the OpenCode provider group (closed this session; evidence in
  [ROADMAP-ARCHIVE.md](./ROADMAP-ARCHIVE.md) §2).

## 2. P0 — immediate / security

### P0-1. Rotate the DeepInfra and EXAONE API keys

- **Status:** **owner-only, still open.** No agent action can close this one.
- **Why:** the two live values were printed into a session's tool transcript during measurement.
  A key that has appeared in a log/transcript must be treated as disclosed; the plaintext profile is
  a second exposure.
- **Done when:** both keys are revoked at the provider, replacements are issued, the old values
  return 401 on their routes, and the replacements are stored per P0-2.

### P0-2. Move both keys into the DSH credential store (policy D5)

- **Status:** **agent side DELIVERED and live-verified for DeepInfra**; the owner side (the rotation
  itself) is open.
- **Why:** the two plaintext `apiKey:` values were in the live profile
  (`~/.dsh/profiles/web/cordis.patch.yml`); the store already holds refs for other providers, so this
  is a normalization, not a new mechanism.
- **Agent side — DELIVERED 2026-11-14 (rc.20):** the seam is measured (`~/.dsh/.credentials.yaml`
  `refs:`/`records:`, read via `ctx.credentials.resolve(ref)`) and both vendored presets declare a
  `credentialRef` (`DEEPINFRA_API_KEY` / `EXAONE_API_KEY`), resolve it at mount and re-resolve on
  `credentials/reference-updated`, with the precedence `explicit apiKey → store ref → env` pinned by
  pure tests (`keyPrecedence`). Full runbook: [CREDENTIAL-STORE-MIGRATION.md](./CREDENTIAL-STORE-MIGRATION.md).
  The router now migrates a plaintext key **by itself**, at mount, when its own live config still
  carries one (`lib/credential-migration.js`; `lib/index.js` → `migratePlaintextKeysAtMount`). The
  order is the safety property: back up (0600) → write the value into the store → **confirm** the
  ref resolves back to the same value → only then replace the plaintext line with `credentialRef:`.
  A failure at any step leaves the plaintext line in place and logs a warning naming the **ref**,
  never a value. A one-shot script (`scripts/migrate-plaintext-keys.mjs --dry-run|--apply`) performs
  the same migration without mounting the router, through the atomic YAML path.
- **Measured 2026-11-14 (applied):** `apiKey:` count in the live profile patch = **0**; the live
  patch now carries `credentialRef: DEEPINFRA_API_KEY` (line 142) and
  `credentialRef: EXAONE_API_KEY` (line 166); `~/.dsh/.credentials.yaml` (mode **0600**) holds
  `refs:` for `DEEPSEEK_API_KEY`, `OPENCODE_API_KEY`, `DEEPINFRA_API_KEY` and `EXAONE_API_KEY`
  alongside the untouched `version:`/`records:` blocks; the backup
  `cordis.patch.yml.bak.before-plaintext-key-migration-20261113-183336` exists at mode **0600**.
  The migration was executed **once**; the live rows no longer carry a plaintext key, so the mount
  hook is now a no-op on this profile.
- **Live-verified for DeepInfra (2026-11-14, post-restart):** a DeepInfra child on
  `deepseek-ai/DeepSeek-V4.1-Flash-1017` returned **`DEEPINFRA_PROBE_OK`**, no error — the store
  ref resolves at request time and the key is no longer silently empty. The service ran as
  `MainPID 284518` (started 06:10:57 KST) and its boot log carries **no credential warnings**.
  Three fixes made this true (see §4): `0b2c516` (read the ref through the inject-free accessor),
  `6388397` (deferred injection instead of a mount-time resolve), and the rc.20 migration itself.
- **Owner side — remaining:** **rotate the FOUR keys.** The store's `refs:` **values** were printed
  into a session transcript by a worker, so **all four** refs must be treated as disclosed — not
  only the two this item covers:
  - `DEEPSEEK_API_KEY`, `OPENCODE_API_KEY` (pre-existing store refs),
  - `DEEPINFRA_API_KEY`, `EXAONE_API_KEY` (the two migrated here).

  Rotate each at its provider, paste the replacement into `refs:` in `~/.dsh/.credentials.yaml`
  (the store is hot — the provider watches the file, so a rotated value reaches the next request
  **without a restart**), then **restart once** and verify **one turn per key** (deepseek, opencode,
  deepinfra, exaone).
- **Done when:** all four refs resolve to freshly rotated values, no plaintext `apiKey:` remains in
  the profile, a live turn on each of the four routes succeeds after the owner-approved restart, and
  `verify:presets` / `verify:refresh` stay green.

### P0-3. Secret hygiene check around the migration

- **Status:** open; read-only worker recipe, blocked on the rotation.
- **Why:** the `specs/` and `.watch-cache/` surfaces must never retain provider secrets; the
  conformance fixtures and docs must stay value-free.
- **Done when:** a scan of `specs/`, `docs/`, `test/` and the watch lock shows no key/token values,
  `.watch-cache/` remains git-ignored, and the migration left no plaintext copy in the repo or the
  handoff.

## 3. P1 — short-term operation and verification

Closed P1 items (P1-2 Antigravity multi-turn on Claude+Gemini, P1-4 pricing re-verification, P1-5
`spec:watch` baseline age, P1-6 four-preset smoke check) are **done** and moved to
[ROADMAP-ARCHIVE.md](./ROADMAP-ARCHIVE.md) §2 with their evidence. What remains:

### P1-1. Verify an EXAONE turn through DSH itself

- **Status:** **top-level CONFIRMED WORKING by the owner**; the remaining proof is the **child** call
  from a NEW session (see P1-3).
- **Why:** EXAONE has a direct API check and a mounted preset, but no real model turn through the
  running DSH session. A provider can be registered and still fail on message projection, tools or
  usage.
- **Measured 2026-11-14:** a child call with `exaone/k-exaone_v2.5` is refused by the host before any
  model request: `child LLM route "exaone/k-exaone_v2.5" is not allowed for this Session`
  (`subagent/model-selection-policy.allowedModels` does not list it). The route therefore cannot be
  exercised from a child; only a **top-level** session on that model can prove it.
- **Confirmed 2026-11-14 (owner):** a **top-level** EXAONE turn works — the owner ran it and
  confirmed the route end to end. The item therefore no longer needs a top-level proof.
- **Done when:** one fresh top-level session (owner) completes a Korean prompt through
  `exaone/k-exaone_v2.5`, with tool calling and reasoning/usage recorded, and the result is noted in
  the handoff. **Met for the top-level path.**
- **Measured 2026-11-14:** EXAONE registers only `registerAdapter` — it has no subagent provider, so
  a child route needs both the allowlist entry (P1-3) and the host's in-process spawn/fork provider;
  the router cannot guarantee the latter. Top-level is the supported proof today.

### P1-3. Decide EXAONE's place in the subagent allowlist

- **Status:** the allowlist is **applied live (7 routes) and in the repo default**; the remaining
  proof is a **child** call from a **NEW** session — still owner-gated.
- **Why:** a subagent call with `exaone/k-exaone_v2.5` was refused (measured message above). If EXAONE
  is meant to be a cheap worker route, this is a live configuration gap, not a model bug.
- **Measured 2026-11-14 (surface audit, T16):** the surface matrix is
  `antigravity` = subagent provider + CLI worker + tools/command; `opencode` = subagent provider +
  CLI worker + tool/command; `deepinfra` and `exaone` = **model routes only** (they call
  `registerAdapter` and nothing else — no provider, no tool, no command, so declaring one would
  invent a surface the code cannot serve).
- **Agent side — APPLIED 2026-11-14 (rc.20):** the owner approved the live edit, so it was applied
  at `~/.dsh/profiles/web/cordis.patch.yml:63-64` — the live allowlist now holds **7** routes
  (antigravity×3, opencode-http-agent×2, deepinfra×1, **exaone×1**). The **repo-side default** was
  added in the same run so a fresh profile includes it: this package's `cordis.patch.yml` states the
  `subagent-model-selection-settings` row with the same 7 routes, and `lib/allowlist.js` holds the
  list as data; `test/allowlist.test.mjs` pins the two homes against each other (the YAML is parsed
  with the HOST's own parser). A bundle layer applies BEFORE the profile's own patch and a patch
  REPLACES a row's whole config, so an operator's list still wins wholesale.
- **Measured 2026-11-14 (why the child proof is still open):** the host freezes a Session's
  allowlist at `agent/created`, and a **child inherits the parent's** frozen list. The live patch row
  and the repo default both carry **7** routes, and 8 Sessions created 04:25–04:37 KST carry that
  7-route list — but the probe children created 06:11–06:20 KST (after the 06:10:57 restart) are
  children of a top-level Session created **01:08:57 KST**, before the 7-route edit, so they carry
  the **6-route** list without `exaone/k-exaone_v2.5`.
- **Owner side — remaining:** rotate the keys (P0-2 / P0-1), **restart once**, then start a **NEW
  top-level session** — the allowlist freezes at `agent/created`, so an existing session keeps the
  old list — and verify a **child** on `exaone/k-exaone_v2.5`. Note the measured caveat from P1-1:
  EXAONE registers only `registerAdapter` — it has no subagent provider — so a CHILD route needs the
  host's in-process spawn/fork provider as well; **top-level is the supported proof today** (and the
  top-level turn already works).
- **Done when:** the owner either verifies a child on `exaone/k-exaone_v2.5` from a new session, or
  records that EXAONE is top-level-only and withdraws the "use EXAONE for chores" instruction.

## 4. P2 — backlog, hold, owner-gated

### P2 head — measured finding: the declaration layer is mount + routing only

> **The former P2-1 ("a data-only 'install a preset' path") was DELETED on 2026-11-14.** It promised
> an abstraction the repo cannot deliver: "a new OpenAI-compatible provider enabled by declaration
> + key + model, with no new adapter code". That promise is **unreachable in this repo**, and
> keeping it was a false roadmap item. The measured facts that killed it are in §4.1 and in the
> **P2-A** queue below. The real "generic OpenAI-compatible provider" seam is in the **HOST**, not
> in this repo's preset layer — see **A7**.

### 4.1 Measured finding — 0 of 4 presets are data-only

Audit measured 2026-11-14 (read-only; file:line evidence is quoted per item):

| Measured fact | Where |
|---|---|
| The declaration layer owns **only** mount rows + provider routing (+ a drift-gate mirror). | `lib/presets.js` `PRESETS`, `lib/preset-derive.js`, `lib/index.js` |
| **0 of 4** presets are data-only — every one needs code somewhere. | `lib/presets.js` |
| `kind: 'declaration'` mounts **nothing**: `planApplications` produces `rows: []` for it. | `lib/presets.js:384` (`DECLARATION_EXAMPLE`), `lib/presets.js:460`, `lib/index.js:191` (`rows.push(...entries)`) |
| `route: 'pi-ai'` has **no writer anywhere in this repo** — it is read only to *validate* a protocol. | `lib/preset-schema.js:177-181` (the only `route` consumers), `lib/presets.js:62` (`ROUTES`) |
| The real seam is in the **HOST**: `dsh-llm-pi-ai` takes `providers: z.dict(profile)`. | host `node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js:1094` |

**Dead declarations, measured:** these fields are validated, projected to the browser, and read by
**no** runtime consumer — `auth.mode` / `auth.sources` kinds, `catalog.mode`, `probe.kind`,
`probe.ttlMs`, `catalog.layers[].source: 'upstream'` and `'override'` (the merger never receives
the preset's layers — `lib/catalog.js:57`, `lib/index.js:644`), `endpoint.route` / `protocol` /
`transport` / `chatPath` / `mode`, `surfaces.skill`, `surfaces.model`,
`surfaces.subagent.maxDepth`, `usage.billing.windows`.

**Specs are a second, unlinked registry.** Measured against `scripts/verify-specs.mjs`:

| Mutation | `verify-specs` exit | Reading |
|---|---|---|
| `specs/providers/deepinfra.json` → wrong `endpoint` + wrong `protocol` | **0** (passes) | a lying endpoint/protocol is not caught |
| `specs/providers/deepinfra.json` → wrong `models` id (valid shape) | **0** (passes) | a lying model id is not caught |
| `specs/providers/deepinfra.json` → **deleted** | **1** (fails) | the cross-reference from `specs/pricing/deepinfra.json` catches the deletion |

> **Correction to the audit brief.** The brief said "deleting it → exit 0". Measured: deleting a
> provider spec **fails** (exit 1), because `specs/pricing/<preset>.json` cross-references it.
> The *content* mutations (wrong endpoint, wrong protocol, wrong model id) are the real hole and
> they do pass. The gate must compare the spec against the **preset**, not only against the spec
> set's internal references.

`specs/pricing/*.kind` uses a different vocabulary than `preset.usage.billing.mode` — `kind` is
`subscription` / `live-catalog` / `free` / `flat`; `billing.mode` is `subscription` / `flat` /
`pay-per-token` / `none` — with **no cross-check**. `usage.routes[].normalize` joins to a
hand-written `USAGE_READERS` table (`lib/client.src.js:772`) with **no gate**.

### P2-A. Architecture consolidation — horizontal phase matrix

> **Owner principle ([ARCHITECTURE-LAYERED.md](./ARCHITECTURE-LAYERED.md)).** LOWER layer = a thin
> standardised shared pipeline for OpenAI / Anthropic / Gemini. UPPER layer = thin vendor/preset
> adapters that carry **vendor quirks only**.
>
> **Audit verdict 2026-11-14 (before the phases): the principle was NOT met.** The core pipe
> (`lib/stream/` = **764** lines across `index` 343, `sse` 180, `usage` 90, `wire` 68, `failure` 83)
> was protocol-agnostic in code — zero protocol branches — **but `lib/stream/anthropic.js` was 614
> lines — 80.4 % on top of the 764-line core**: one protocol was forked *inside* the lower layer. And the upper
> layer was not thin: the four vendors carried **22 672** lines of `lib/` (antigravity 5 216, opencode
> 12 330, deepinfra 3 950, exaone 1 176) between them, with a measured **681-line** duplicated
> OpenAI wire in two of them.
>
> **Phase 1 + Phase 2 verdict 2026-11-14 (after the phases): the principle is now met for the
> three standard protocols, with named exceptions.** The core pipe is **1 851 lines**
> (`index` 345, `openai` 467, `anthropic` 433, `usage` 217, `sse` 216, `failure` 105, `wire` 68):
> **one** SSE reader, **one** usage writer, **one** finish table, **one** failure taxonomy, and
> **one** OpenAI protocol core that DeepInfra, EXAONE and OpenCode all bind to by identity. The
> vendor `lib/` totals moved to **22 228** (antigravity 5 275, opencode 12 631, deepinfra 3 480,
> exaone 842) — net **−444 L** in the vendors, **+1 087 L** in the core, i.e. the duplication left
> the upper layer and the standardisation entered the lower one. The **OpenAI** protocol is shared
> (one `lib/stream/openai.js`); the **Anthropic** protocol is shared (one
> `lib/stream/anthropic.js` on the shared SSE reader); the **Gemini** protocol was already thin
> and stays thin. **What is NOT done:** A3 is COMPLETE (`e8b39f7`) and R4 is CLOSED; the remaining
> open items are R2, R6 and A7 — see the open-item table
> below and the boundary verdict in [HANDOFF.md](./HANDOFF.md) §3.
>
> **Removed, not closed:** the former **P2-1** ("data-only preset install") remains **DELETED** as an
> unreachable promise (0 of 4 presets are data-only; `kind:'declaration'` mounts nothing). Its real
> host seam is **Phase 3 (A7)** below.

#### Phase matrix — measured status (2026-11-14)

| Phase | Mode | Status | Commits | Measured result |
| :-: |---|---|---|---|
| **1 — Core lock** | **SERIAL** (1 worker at a time) | ✅ **DONE** | `c0e48ab`, `3ac7a10`, `c2ba900`, `ae9fd1d` | `lib/stream/openai.js` (467 L) extracted; `anthropic.js` 614 → **433 L** (own SSE reader / usage writer / `abortError` copies deleted); `lib/stream/usage.js` 90 → **217 L** with `input+output+cache` as a first-class `TOTAL_FORMULAS` entry; `lib/stream/failure.js` 83 → **105 L** with one `abortError`; `lib/driver/contract.js` derives its formula vocabulary from the core; `lib/cost.js` 85 → **727 L**, `lib/plan.js` 254 → **510 L**, `lib/usage.js` 192 → **432 L**; new `lib/retry.js` (255 L) + `lib/catalog-cache.js` (314 L). Router suite **649 → 759** over the four commits. |
| **2 — Upper-layer fan-out** | **PARALLEL** (disjoint scopes) | ✅ **DONE** | `8ee4ef1`, `e8b39f7` | DeepInfra `map`/`wire`/`stream-contract`/`cost` now re-export the shared cores **by identity** (vendor `lib/` 3 950 → **3 480**); EXAONE the same (1 176 → **842**, dead `finishReason`/`isFinishEvent` gone); Antigravity retry → `lib/retry.js`, catalog cache → `lib/catalog-cache.js`, one `agy` usage mapper instead of two (5 216 → **5 275 L**, +59 = the core's own seams); **OpenCode `http.js` 3 272 → 2 721 L** — the legacy branch body, its prelude, its own SSE reader (`chatSseEvents`/`parseSseBlock`), the `pipe` config key and 4 orphaned imports are deleted, so **no config selects a pipeline any more**; `stream-parser.js` (679 L) was measured to be **shared-path glue**, not dead code, and was renamed `notation-classifier.js` (single named export, one consumer). Gates: `verify:stream` 8/8 with **4 vendors probed, 8/8 specifiers refused, 0 loads**; `specs:check` OK; `verify:presets:mutation` **17 → 26/26**; `verify:usage-readers` OK (4 presets / 4 routes / 3 readers); **new** `test/stream-boundary.test.mjs` (15 cases) + `test/usage-readers.test.mjs` (12 cases); the dead `classifyBlock` slot is removed from `lib/driver/contract.js`. Router **774 → 802/802**; vendors 193 / 222+7 / **553** / 19 (opencode 555 → 553: two legacy-only tests removed, the legacy↔shared parity tests replaced by golden sequences captured from the shared path **before** deletion). |
| **3 — A7 host seam** | **SERIAL / measure-first** | ⬜ **NOT STARTED** | — | Measure `dsh-llm-pi-ai` `providers: z.dict(profile)` first; produce a written owner decision **before** any code or profile mutation. |

> **Post-Phase-2 closures (measured 2026-11-14, `77a53b0`).** **R3 is CLOSED** and **R5 is CLOSED**
> — see the A4/A5 result blocks in §4. Since Phase 2 the router suite moved **802 → 807/807** and
> the opencode vendor suite **553 → 554/554**; the other three vendor suites are unchanged
> (antigravity **193**, deepinfra **222 pass / 7 skip**, exaone **19**).

**Horizontal split (replaces the vertical A2 → A1 → … single-worker silo):** lock all L0/L1 lower
interfaces **serially** first (Phase 1), then fan out L2 vendor clean-ups and L3 gates **in parallel**
with provably disjoint write scopes (Phase 2), followed by the independent host-seam measurement
(Phase 3). Dispatch blocks for every worker live in [WORKER-DISPATCH.md](./WORKER-DISPATCH.md).

#### Phase dependency diagram

```text
  PHASE 1 — CORE LOCK (SERIAL: 1 worker at a time, touches lib/ + package.json + core tests)
    [W1-1: A2-core (lib/stream/openai.js)]
          │  establishes protocol-profile pattern in lib/stream/
          ▼
    [W1-2: A1-core (lib/stream/{anthropic,sse,usage,failure,index}.js + contract.js)]
          │  unifies SSE, TOTAL_FORMULAS, abortError, per-stream createHooks
          ▼
    [W1-3: A4-core (lib/{cost,plan,usage}.js + store/ledger interface)]
          │  locks single accounting & ledger contract on top of normalized usage
          ▼
    [W1-4: A5-core (lib/retry.js + lib/catalog-cache.js)]
          │
          ▼
  ════════ CORE INTERFACE LOCKED (all Phase 1 gates green; zero core-internal forks) ════════
          │
          ├──────────────────┬──────────────────┬──────────────────┬──────────────────┐
          ▼                  ▼                  ▼                  ▼                  ▼
  [W2-A: A3 OpenCode] [W2-B: DeepInfra] [W2-C: EXAONE]    [W2-D: A6 Gates]   [W2-E: Antigravity]
  vendor/opencode/**  vendor/deepinfra  vendor/exaone/**  scripts/ + specs/  vendor/antigravity/**
                                                          (sole owner of     (A4/A5 rewiring;
                                                           verify-stream.mjs) disjoint scope)
          │                  │                  │                  │                  │
          └──────────────────┴──────────────────┴──────────────────┴──────────────────┘
                                                │
                                                ▼
  ════════ INTEGRATION VERIFY (npm run verify + all 4 vendor suites + live OpenCode turn) ════════
                                                │
                                                ▼
  PHASE 3 — A7 HOST SEAM (measure-first, owner decision, NOT parallel with Phase 1/2)
    [W3-1: A7 — inspect @deepseek-ai/dsh-llm-pi-ai providers dict & write decision]
```

#### Phase 1 — Core lock, SERIAL (single worker, sequential, file-conflict safety) — ✅ **DONE**

Phase 1 touches shared core files (`lib/stream/index.js`, `lib/driver/contract.js`, `package.json`),
so steps **must** run sequentially on one worker at a time.

| Order | Step | Task scope | Why this order | Lock criteria (before next step / Phase 2) | Measured outcome |
| :-: |---|---|---|---|---|
| **1.1** | **W1-1 (A2-core)** | Extract `lib/stream/openai.js` (delta→parts mapper, `readOpenAiEvent`, shared OpenAI request-projection helpers) + export in `lib/stream/index.js` / `package.json` | **Smallest blast radius** and pure duplication extraction; establishes the `lib/stream/<proto>.js` module pattern that A1 reuses | `lib/stream/openai.js` API frozen; comment-stripped diff vs extracted vendor functions = 0 changed lines (except parameterized vendor label); `openai-completions` conformance + `npm run verify` + all vendor suites green | ✅ `c0e48ab` — `lib/stream/openai.js` **467 L**; `lib/cost.js` 85 → **727 L**; `lib/retry.js` **255 L**; `lib/catalog-cache.js` **314 L**; router **649 → 699** |
| **1.2** | **W1-2 (A1-core)** | Consolidate `lib/stream/anthropic.js` onto eventName-aware `sse.js`, `usage.js` (`TOTAL_FORMULAS['input+output+cache']`), `failure.js` (single `abortError`), and `createHooks`; align `lib/driver/contract.js:14` `TOTAL_FORMULAS` | **Largest L1 violation** (614 L = 80.4 % on top of 764 L core) and requires the A2 core-module pattern; closes the split `totalFormula` vocabulary so drivers and `usageFrom` agree | `lib/stream/anthropic.js` ≤ 434 L (≥ 180 L removed); zero duplicate SSE/usage/`abortError` inside `lib/stream/`; `defineProviderDriver` accepts Anthropic & Antigravity descriptors; `anthropic-messages` conformance + `npm run verify` green | ✅ `3ac7a10` (usage vocabulary 90 → **217 L**; one `abortError`; `anthropic.js` 614 → 582) + `c2ba900` (Anthropic rides the shared SSE reader; `anthropic.js` 582 → **433 L** ≤ 434 target); router 707 → **724** |
| **1.3** | **W1-3 (A4-core)** | Lock `lib/cost.js` + `lib/plan.js` + `lib/usage.js` as the single accounting & cost-ledger interface (incl. canonical `createCostStore`, `createCostLedger`, `numberOrNull`, `pickSession`) | Reads normalized token buckets from A1/A2 (`lib/stream/usage.js`), so it lands after stream normalization is locked | Core accounting & ledger exports frozen in `package.json`; core cost/plan/usage unit tests + `npm run verify` green; zero duplicate accounting helpers in `lib/` | ✅ `ae9fd1d` — `lib/plan.js` 254 → **510 L**; `lib/usage.js` 192 → **432 L**; router **724 → 759** |
| **1.4** | **W1-4 (A5-core)** | Add `lib/retry.js` (bounded transport retry per [RETRY-POLICY.md](./RETRY-POLICY.md)) and `lib/catalog-cache.js` (generic TTL + `?refresh=1` bypass) | Pure cross-vendor mechanics with zero wire coupling; locks right before Phase 2 vendor rewiring | `lib/retry.js` + `lib/catalog-cache.js` exports frozen; R1–R9 retry tests + cache TTL/refresh tests green; **CORE INTERFACE LOCKED** (`npm run verify` + all 4 vendor suites green) | ✅ shipped in `c0e48ab` (alongside 1.1) — `lib/retry.js` **255 L**, `lib/catalog-cache.js` **314 L**; **CORE INTERFACE LOCKED** at `ae9fd1d` |

#### Phase 2 — Upper-layer fan-out, PARALLEL after core lock — ✅ **DONE** (`8ee4ef1`)

Once Phase 1 locks every L1/core interface, launch **4 primary parallel workers** (`W2-A`..`W2-D`)
plus optional disjoint **`W2-E`** (Antigravity A4/A5 rewiring) simultaneously. Every worker owns a
**provably disjoint write scope** — zero shared files. Only **`W2-D`** may edit `scripts/verify-stream.mjs`.

| Worker | Task | Allowed write scope (disjoint) | Forbidden paths | Owns `verify-stream.mjs`? | Measured outcome |
|---|---|---|---|---|---|
| **W2-A** | **A3 — OpenCode onto shared pipe** (+ OpenCode ledger/retry/cache rewiring) | `vendor/opencode/lib/**`, `vendor/opencode/test/**` | `lib/**`, `scripts/**`, `specs/**`, `package.json`, `vendor/{antigravity,deepinfra,exaone}/**` | No | ✅ **DONE** (`e8b39f7`) — `http.js` **3 272 → 2 721 L** (−630/+79): the legacy branch body, its prelude, its own SSE reader (`chatSseEvents`/`parseSseBlock`), the `pipe` config key and 4 orphaned imports are deleted, so **no config selects a pipeline any more**. `stream-parser.js` (679 L) was **measured to be shared-path glue, not dead code** → renamed `notation-classifier.js` (single named export, one consumer). Suite **555 → 553/553** (two legacy-only tests removed; the legacy↔shared parity tests were replaced by **golden sequences captured from the shared path before deletion**). See **A3 (complete)** below. The OpenCode ledger rewiring is **not** part of A3 — it is **R2**; the retry/cache rewiring was **R3** and is now **CLOSED** (`77a53b0`). |
| **W2-B** | **DeepInfra dedup** (OpenAI `map`/`wire`/`stream-contract` + `cost` ledger + catalog TTL cache) | `vendor/deepinfra/lib/**`, `vendor/deepinfra/test/**` | `lib/**`, `scripts/**`, `specs/**`, `package.json`, `vendor/{antigravity,opencode,exaone}/**` | No | ✅ `stream-contract`/`wire`/`map`/`cost` re-export the shared cores **by identity**; `lib/` **3 950 → 3 480 L**; suite **222 pass / 7 skip** unchanged. The Anthropic-native route stays vendor-local by design. Its **catalog cache** was still local at that time → **R3, now CLOSED** (`77a53b0`: DeepInfra rides the core `createCatalogCache`). |
| **W2-C** | **EXAONE dedup + dead exports** (OpenAI `map`/`wire`/`stream-contract` + `map.js:96-130` 35 L dead exports) | `vendor/exaone/lib/**`, `vendor/exaone/test/**` | `lib/**`, `scripts/**`, `specs/**`, `package.json`, `vendor/{antigravity,opencode,deepinfra}/**` | No | ✅ `map.js` 130 → **32 L** (a re-export shim), `wire.js` 292 → **116 L**, `stream-contract.js` 141 → **81 L**; the dead `finishReason`/`isFinishEvent` (35 L) is gone; `lib/` **1 176 → 842 L**; suite **19/19** unchanged. EXAONE's effort fold / `preserve_thinking` / 16-stop cap stay local. |
| **W2-D** | **A6 — Dead surface removal & gate hardening** (`dsh-exaone` stream guard, spec↔preset mirror, dead-field allowlist, `L1` boundary lint) | `scripts/verify-stream.mjs`, `scripts/verify-specs.mjs`, `scripts/verify-presets-mutation.mjs`, `scripts/verify-usage-readers.mjs`, `lib/driver/contract.js`, `lib/preset-drift.js`, `specs/**`, `test/specs.test.mjs`, `test/preset-drift.test.mjs`, `test/driver-contract.test.mjs`, `test/stream-boundary.test.mjs`, `test/usage-readers.test.mjs` | `lib/stream/**`, `lib/{cost,plan,usage,retry,catalog-cache}.js`, `vendor/**`, `package.json` | **YES (sole owner)** | ✅ **DONE** (`e8b39f7` closes the last remnant) — the stream guard probes **all 4** vendored packages (**8/8 specifiers refused, 0 loads**, self-tested + vacuity-guarded); `checkPresetMirror` landed (protocol/endpoint/pricing/model + `pricing.kind`↔`billing.mode`); `DECLARATION_RUNTIME_FIELDS` / `DECLARATION_DEAD_FIELDS` landed; mutation harness **17 → 26/26**; **the `L1` boundary lint now exists** — `test/stream-boundary.test.mjs` (**15 cases**): no vendor import or vendor identifier in `lib/stream/*`, no `ctx` / `process.env` / `node:fs` / `fetch(` / `require(` / dynamic `import(`, no per-vendor equality, and **exactly one** SSE decoder / usage writer / finish table / `abortError`; **`scripts/verify-usage-readers.mjs` + `test/usage-readers.test.mjs` (12 cases)** gate every `usage.routes[].normalize` name against the real reader table with browser source↔bundle parity; the dead `classifyBlock` slot is **removed** from `lib/driver/contract.js`. Both gates carry **negative proofs** (a planted regression → failure → reverted with a hash check). |
| **W2-E** *(optional Wave 2)* | **Antigravity A4/A5 rewiring** (70 L retry + 92 L catalog cache + 28 L `agy` usage double-map) | `vendor/antigravity/lib/**`, `vendor/antigravity/test/**` | `lib/**`, `scripts/**`, `specs/**`, `package.json`, `vendor/{opencode,deepinfra,exaone}/**` | No | ✅ retry loop → `lib/retry.js` (`adapter.js:27`); catalog cache → `lib/catalog-cache.js` (`index.js:32`); the `agy` usage double-map collapsed to **one** mapper (`backends.js:15` → `usageFromProjection`), `subagent.js` now delegates to it; suite **193/193** unchanged. |

> **Integration bar after Phase 2 — MEASURED GREEN.** `npm run verify` exit 0; router
> **802/802**; `verify:stream` **8/8** with **4 vendored packages probed, 8/8 specifiers refused,
> vendor loads 0**; `specs:check` OK (`5 protocols, 4 providers, 4 pricing`); `verify:presets`
> OK; `verify:presets:mutation` **26/26**; `verify:usage-readers` OK (4 presets / 4 routes /
> 3 readers); all 4 vendor suites at baseline
> (antigravity **193**, deepinfra **222 pass / 7 skip**, opencode **553**, exaone **19**).
> **The live OpenCode shared-pipe turn was verified by the owner after the 09:37:14 KST restart**
> (PID 361248) — OpenCode shared pipe, DeepInfra OpenAI core and Antigravity core all returned
> OK with no error. **The owner-verified live EXAONE child turn is still outstanding** — it is an
> owner action, not a worker action, and it is listed in §4's open items.
>
> **Current bar (`77a53b0`, R3 + R5 closed):** router **807/807**; `verify:stream` **8/8** with
> **4** probed / 8/8 refused / 0 loads; `specs:check` OK; `verify:presets:mutation` **26/26**;
> `verify:usage-readers` OK; vendors antigravity **193**, deepinfra **222 pass / 7 skip**,
> opencode **554**, exaone **19**. **No restart** was performed for `77a53b0`, so the live
> service still runs the `e8b39f7` build — the live-probe record in §7 and in
> [HANDOFF.md](./HANDOFF.md) §1 is unchanged and remains the last measured live state.

#### Phase 3 — A7 Host Seam (measure-first, owner decision, sequential)

**A7** (`dsh-llm-pi-ai` `providers: z.dict(profile)` seam) is **not** parallel with Phase 1/2
refactoring. It runs as a dedicated measure-first pass against the host package, producing an
owner decision before any code or profile mutation is attempted.

---

#### A1 — one Anthropic wire in the shared pipe

- **Measured evidence.**
  - `lib/stream/anthropic.js` = **614** lines — **80.4 % on top** of the 764-line core (44.6 % of the whole 1,378-line directory including itself).
  - Own SSE reader `readAnthropicSse` (**66–92**, 27 L) + `decodeRecord` (**545–579**, 35 L) +
    `chunksOf` (**587–609**, 23 L) = **85 lines** duplicating `lib/stream/sse.js` (180 L).
  - Own usage writer `usageFromAnthropic` (**369–390**, 22 L) bypassing `usageFromProjection`
    (`lib/stream/usage.js:80-90`), because Anthropic's cache convention is additive.
  - Three `abortError` copies = **14 lines**: `lib/stream/index.js:339-343` (5 L),
    `lib/stream/sse.js:176-179` (4 L), `lib/stream/anthropic.js:612-614` (3 L). Note the third has
    a **different message** ("request cancelled by the caller" vs "the stream was aborted").
  - `totalFormula` vocabulary is split: `lib/driver/contract.js:14` allows `['prompt+output',
    'gemini']`; `lib/stream/usage.js:23-28` implements `['prompt+output',
    'prompt+output+reasoning']`. Measured: `defineProviderDriver` **rejects** the Anthropic
    (`input+output+cache`) and Antigravity (`prompt+output+reasoning`) descriptors, and
    `usageFrom` **throws** on `gemini` (`unknown usage formula: gemini`) and on
    `input+output+cache`.
  - `createHooks` seam (`lib/stream/index.js:61-76`) — **used by OpenCode**
    (`vendor/opencode/lib/http.js:2358`), *not* by nobody. The Anthropic per-stream state
    (`createAnthropicHooks`, `lib/stream/anthropic.js:482-536`, **55 L**) is however built as a
    **frozen shared object**, not per stream, so it does not ride the seam.
  - `verify:stream` = **8/8** dispatch cases, `vendor loads: 0` — but
    `scripts/verify-stream.mjs:23` guards only `['dsh-antigravity', 'dsh-deepinfra',
    'dsh-opencode-v2']`; **`dsh-exaone` is not guarded**, so the "0" is not proof for the 4th
    vendor.
- **Owner-principle reason.** One Anthropic protocol must have exactly **one** wire in the lower
  layer. A 614-line per-protocol fork inside the core means the lower layer is not shared at all
  for that protocol — every Anthropic quirk becomes a core edit, and the "upper layer carries
  quirks only" rule is inverted.
- **Concrete moves / deletes.**
  1. Fold the Anthropic SSE reader into `lib/stream/sse.js` as an **eventName-aware** reader
     (Anthropic frames carry `event:` names; OpenAI frames do not) — one SSE reader, one decoder,
     one chunker.
  2. Move `usageFromAnthropic` (22 L) into `lib/stream/usage.js` as a **third `TOTAL_FORMULAS`
     entry** (`input+output+cache`) consumed by `usageFromProjection`.
  3. Collapse the three `abortError` copies (14 L) into `lib/stream/failure.js` — one factory,
     one message.
  4. Move the **55-line** per-stream state (`createAnthropicHooks`) onto the `createHooks` seam
     so each Anthropic stream gets its own accumulator instead of a module-level frozen object.
  5. Align `lib/driver/contract.js:14` with `lib/stream/usage.js` so the Anthropic and
     Antigravity descriptors validate, and `gemini` resolves to one name instead of two.
  6. Extend `scripts/verify-stream.mjs:23` to guard `dsh-exaone`.
- **Acceptance criteria (gate-provable).**
  - `npm run verify:stream` → **8/8**, `vendor loads: 0`, **with `dsh-exaone` in the guard list**.
  - The anthropic-messages conformance fixture is **green**.
  - `lib/stream/anthropic.js` **shrinks by ≥ 180 lines** (614 → ≤ 434).
  - `defineProviderDriver` accepts the Anthropic **and** Antigravity descriptors; `usageFrom`
    accepts every formula the contract accepts — one shared vocabulary, no `gemini`-only throw.
  - **No behaviour change**: same stream parts, same usage buckets, same finish reasons, same
    failure codes for the same input fixture.

---

#### A2 — one OpenAI wire profile (do this first)

- **Measured evidence.**
  - `vendor/exaone/lib/map.js` and `vendor/deepinfra/lib/map.js` are **130 lines each** and
    **zero non-comment diff** (comment-stripped: 50 lines each, 0 changed lines — verified).
  - Their `stream-contract.js` `readEvent` is **41 lines each** and differs by **2** substantive
    lines (the vendor name inside a `PROTOCOL_DEFECT` message) — the audit's "8 substantive lines"
    over-counts: the whole-file comment-stripped diff is **16** lines, of which 12 are EXAONE's
    extra `usageFrom` / `STREAM_HOOKS` members and 2 are the vendor-name message.
  - EXAONE's OpenAI request projection vs DeepInfra's `wire.js`: of the 8 named functions,
    **6 are byte-identical** (`serializeTools` 16 L, `textOf` 13 L, `userContent` 17 L,
    `toolCallsOf` 13 L, `nonEmpty` 5 L, `positiveInteger` 4 L) and **2 differ only in vendor
    branding** (`serializeMessages` 41 L — one error-message string; `requestBody` 36 L vs 33 L —
    the vendor name plus EXAONE's `EXAONE_EFFORT` fold and `chat_template_kwargs`). The audit's
    "byte-identical for 8 functions" over-counts by 2.
  - Duplicate line volume in the two vendors' OpenAI wire: `map.js` 130 + 130,
    `stream-contract.js` `readEvent` 41 + 41, and the 8 named `wire.js` request-projection
    functions 172 + 167 = **681 duplicated lines** across both vendor copies (measured by
    brace-matched function spans). The audit's "≈660" figure is close; **681** is the measured
    value.
- **Owner-principle reason.** OpenAI is the most standardised of the three protocols, so it must
  have **one** wire profile in the lower layer. Two vendors carrying a private copy of the same
  mapper is the textbook violation: a bug fix lands in one vendor and the other keeps the bug.
- **Concrete moves / deletes.**
  1. New `lib/stream/openai.js` in the core holding the measured-duplicate functions: the
     delta→parts mapper, `readEvent`, and the request-projection helpers.
  2. Delete the byte-identical copies in `vendor/{deepinfra,exaone}/lib/{map.js,
     stream-contract.js, wire.js}` — the duplicated subset is **681 lines** (measured); both
     vendors import the core module instead.
  3. Keep only the genuinely vendor-specific remainder in each vendor (EXAONE's `EXAONE_EFFORT`
     fold, `chat_template_kwargs`, the 16-stop cap, the static single-model catalog; DeepInfra's
     Anthropic-native route and its discount/pricing facts).
- **Acceptance criteria (gate-provable).**
  - Both vendor suites stay green (exaone **19/19**, deepinfra **222 pass / 7 skip**).
  - A **grep gate** proves no vendor-local OpenAI delta mapper remains:
    `grep -rn "mapDelta" vendor/` returns only the core module.
  - A **diff proof** is committed: the extracted core functions are byte-identical to the deleted
    vendor copies (comment-stripped diff = 0 changed lines), except for the two branded error
    messages, which become **parameterised** instead of duplicated.
  - `npm run verify:stream` stays green and `npm run verify:presets` still reports `OK`.

---

#### A3 — OpenCode onto the shared pipe — ✅ **COMPLETE** (`e8b39f7`)

- **Status:** **DONE — measured, not claimed.** The Phase 2 commit (`8ee4ef1`) had recorded A3 as
  *"DELETION NOT DONE … the opt-out branch is still an explicit config path and
  `vendor/opencode/lib/stream-parser.js` is still imported by the shared path … the 629-line
  delete list was wrong. Recorded as a follow-up, not silently dropped."* That follow-up
  (**R1**) is now closed by `e8b39f7`.
- **What is done (measured, 2026-11-14).**
  - **The legacy pipeline is gone.** `vendor/opencode/lib/http.js` **3 272 → 2 721 L**
    (**−630 / +79**): the legacy branch body, its prelude, its **own** SSE reader
    (`chatSseEvents` / `parseSseBlock`), the **`pipe` config key** and **4 orphaned imports** are
    deleted. **No config selects a pipeline any more** — the file header now states the pipeline
    explicitly.
  - **`stream-parser.js` was NOT dead code — it is shared-path glue.** The earlier measurement
    that overturned the 629 L delete list was right: the classifier is live on the shared path.
    It was therefore **renamed, not deleted**: `vendor/opencode/lib/stream-parser.js` →
    `vendor/opencode/lib/notation-classifier.js` (**679 L**, one named export
    `createNotationClassifier`, **one consumer** — `stream-contract.js:58`). The rename records
    the placement decision R1 asked for: a **vendor-local notation-quirk surface**, not a core
    parser slot.
  - **Coverage did not depend on the oracle that was removed.** Two legacy-only tests were
    removed (**555 → 553**), and the two legacy↔shared parity tests were **replaced by literal
    golden sequences captured from the shared path BEFORE the deletion** — so the expected output
    is a recorded constant, not a live re-derivation.
  - Suite **553/553** green; router **802/802** (was 774); `verify:stream` **8/8** with **4**
    vendors guarded and **0** loads; `specs:check` OK; `verify:presets:mutation` **26/26**;
    `verify:usage-readers` OK (4 presets / 4 routes / 3 readers).
- **Acceptance criteria (gate-provable) — all met.**
  - opencode suite green — ✅ **553/553**.
  - `npm run verify:stream` green — ✅ **8/8**, 4 vendors guarded, 0 loads.
  - `pipe: 'legacy'` no longer exists as a config union member — ✅ **the `pipe` config key is
    deleted entirely; no config selects a pipeline.**
  - `stream-parser.js` placement recorded in writing — ✅ **renamed to
    `notation-classifier.js`** (vendor-local notation quirk surface, single named export, one
    consumer).
  - A **parity fixture** over legacy vs shared — ✅ **superseded by golden sequences captured
    from the shared path before deletion** (the legacy oracle no longer exists, so a live
    legacy↔shared diff is impossible to write).
  - **One live turn** on an OpenCode route through the shared pipe — ✅ **owner-verified after the
    09:37:14 KST restart (PID 361248): the OpenCode shared pipe returned OK with no error.**
- **Still open under the same vendor scope** — these are the A4/A5 remnants, tracked separately:
  the OpenCode private cost ledger (**R2**) and the OpenCode + DeepInfra catalog caches / retry
  loops (**R3**). **R3 is now CLOSED** (`77a53b0`) — see the A5 result block below. **R2** (the
  OpenCode private ledger) is still open.

---

#### A4 — one cost / plan / usage accounting

- **Measured evidence.**
  - Core `lib/cost.js` (**85**), `lib/plan.js` (**254**), `lib/usage.js` (**192**) = **531 lines**
    and are imported by **zero vendors**. Measured: the only importer of core `lib/usage.js` is
    `lib/usage.js:18` → `lib/plan.js`; no vendor imports any of the three.
  - Instead there are **two ledgers**: `vendor/deepinfra/lib/cost.js` (391 total; ledger body
    **166–314** = 149 L) and `vendor/opencode/lib/cost.js` (381 total; ledger body **142–288** =
    146 L).
  - Byte-identical helpers across the two ledgers (measured, comment-stripped):
    `numberOrNull` (**5 L + 5 L**) — identical; `pickSession` (**10 L + 10 L**) — identical;
    `createCostStore` (deepinfra **24 L**, opencode **25 L**) — **differs** (the audit's
    "25 + 26" over-counts and the byte-identical claim does not hold for this one).
  - OpenCode re-implements the unused core in `plans.js` (**185**) + `usage-ledger.js` (**139**) +
    `cost-pill.js` (**182**) = **506 lines**.
  - Antigravity maps its own `agy` usage envelope **twice**: `vendor/antigravity/lib/backends.js`
    **109–118** (10 L) and `vendor/antigravity/lib/subagent.js` **96–113** (18 L).
- **Owner-principle reason.** Accounting is not a vendor quirk; it is a shared, standardised
  concern. Two private ledgers plus an unused core implementation means the numbers the owner
  sees can disagree with the numbers the core computes — and today **nothing** in the serving path
  uses the core implementation.
- **Concrete moves / deletes.**
  1. Make core `lib/cost.js` + `lib/plan.js` + `lib/usage.js` **the only** implementation.
  2. Delete the two vendor ledgers and the byte-identical helpers (`numberOrNull`, `pickSession`).
  3. Fold the Antigravity `agy` envelope double-mapping onto `usageFromProjection`.
  4. Delete the **506-line** opencode re-implementation, or fold it onto the core.
- **Acceptance criteria (gate-provable).**
  - Core cost tests green; **one live turn per vendor** (antigravity, opencode, deepinfra,
    exaone) with the recorded spend equal to the pre-migration value.
  - A grep gate proves **zero duplicate helper names**: `numberOrNull` / `pickSession` /
    `createCostStore` each appear exactly once in the repo.
  - `npm run verify:presets` still reports `OK` (the dashboard's usage rows are unchanged).

#### A4 result (measured 2026-11-14) — the CORE is done; the vendor ledgers are partly done

- ✅ **Core (Phase 1, `c0e48ab` + `ae9fd1d`):** `lib/cost.js` 85 → **727 L**, `lib/plan.js` 254 →
  **510 L**, `lib/usage.js` 192 → **432 L**. The core now owns `createCostStore`, `createCostLedger`,
  `numberOrNull`, `pickSession` and the whole plan/usage vocabulary.
- ✅ **DeepInfra (Phase 2, `8ee4ef1`):** `vendor/deepinfra/lib/cost.js` imports `LEDGER_VERSION`,
  `createCostLedger as createSharedLedger`, `createCostStore as createSharedStore`,
  `numberOrNull`, `pickSession` **from `../../../lib/cost.js`** (`:50-56`). What stays vendor-local
  is the wire parsing (`parseCost`), the catalog list-price projection (`listPriceOf`) and the chip
  renderer (`formatCost`) — DeepInfra-specific vocabulary. The ledger body is now a thin wrapper
  over the core's (`:194-231`).
- ✅ **Antigravity (Phase 2, `8ee4ef1`):** the `agy` usage double-map collapsed to **one** mapper —
  `vendor/antigravity/lib/backends.js:15` imports `ADDITIVE_FORMULA` + `usageFromProjection` from
  `../../../lib/stream/usage.js`, and `vendor/antigravity/lib/subagent.js:93` now delegates to
  `agyTokenUsage` instead of mapping a second time.
- ⚠️ **OpenCode still owns a private ledger** (`vendor/opencode/lib/cost.js`): its own
  `numberOrNull` (`:61`), `pickSession` (`:332`), `createCostStore` (`:356`) and
  `createCostLedger` (`:142`) — **four** re-definitions that the core already owns. Its
  `vendor/opencode/lib/plans.js:25` also re-declares `PLAN_PROVIDERS` (the core has it at
  `lib/plan.js:372`), and `vendor/opencode/lib/usage-ledger.js:21` re-declares `USAGE_BUCKETS`
  (the core has it at `lib/usage.js:29`). **These are A4 remnants** — the OpenCode ledger is
  deliberately left for the same wave that finishes A3 (one vendor, one file scope, one worker).
  Measured: `grep -rn "function numberOrNull"` → **2** hits (`lib/cost.js:145`,
  `vendor/opencode/lib/cost.js:61`); `pickSession` → **2**; `createCostStore` → **3**
  (`lib/cost.js:672`, `vendor/opencode/lib/cost.js:356`, `vendor/deepinfra/lib/cost.js:172` — the
  DeepInfra one is a 2-line wrapper over the core, so it is not a third implementation).
- **Open A4 remnant (next worker, scope `vendor/opencode/lib/**`):** route OpenCode's
  `numberOrNull` / `pickSession` / `createCostStore` / `createCostLedger` / `plans.js` /
  `usage-ledger.js` onto `lib/cost.js` + `lib/plan.js` + `lib/usage.js`, keeping only OpenCode's
  own wire vocabulary (`usage.opencode.billing_source`, `usage.opencode.allowance`, the
  `list_cost` / `estimated` facts) in the vendor.

> **R5 note (measured `77a53b0`).** The `lib/plan.js:372` `PLAN_PROVIDERS` line quoted above is
> **gone** — the vendor-id table moved to the declaration layer (`lib/presets.js` →
> `PLAN_PROVIDERS` + `planProvidersOf(presetId)`), and `lib/plan.js` now takes the map as an
> explicit `providers` argument or through `bindPlanProviders()`. The **remaining** L1 vendor-id
> residue in this A4 area is the **OpenCode private ledger** — that is **R2**, still open.

---

#### A5 — one retry/backoff + one catalog cache in the core

- **Measured evidence.**
  - **The core has no retry module**: `grep -rn "backoff" lib/` → **0** hits.
  - Antigravity implements its own: `vendor/antigravity/lib/adapter.js:40-63` (`sleepFor` +
    `backoffDelay`) plus the retry loop **228–273** = **70 lines**.
  - OpenCode has **three** separate retry loops.
  - The catalog cache is the same generic cache implemented **three** times:
    `vendor/antigravity/lib/index.js:200-291` (92 L), `vendor/deepinfra/lib/index.js:209-237`
    (in-memory TTL), `vendor/opencode/lib/catalog-cache.js` (**362**).
- **Owner-principle reason.** Retry/backoff and TTL caching are cross-vendor mechanics, not vendor
  quirks. Leaving them per-vendor means the *policy* (which status codes retry, how long the
  backoff grows, what the cache TTL means) drifts silently per vendor — and no gate can see it,
  because there is no shared implementation to compare against.
- **Concrete moves / deletes.**
  1. New `lib/retry.js` in the core: the bounded retry policy already specified in
     [RETRY-POLICY.md](./RETRY-POLICY.md) (transport/socket failures and transient 502/503/504
     only, no model fallback, no circuit breaker, short exponential backoff).
  2. Consume it from Antigravity (70 L) and OpenCode's three loops.
  3. New generic catalog cache in the core, replacing the three implementations above.
  4. Keep only the vendor-specific facts (Antigravity's live quota RPC and its separate 1-minute
     quota cache, DeepInfra's discount/pricing facts) in the vendor layer.
- **Acceptance criteria (gate-provable).**
  - A grep gate proves `backoffDelay` / the sleep helper exist **once** in the repo.
  - One live turn per vendor proves the retry path still behaves (a transient 503 is retried, a
     4xx is not).
  - The three catalog caches are replaced by one core cache with the same TTL semantics; a
     refresh (`?refresh=1`) still bypasses it for every vendor.

#### A5 result (measured 2026-11-14) — the CORE is done; the vendor remnants are **now closed**

- ✅ **Core (Phase 1, `c0e48ab`):** `lib/retry.js` **255 L** — `DEFAULT_RETRY_STATUSES`
  (429/451/500/502/503/504), `isRetryableStatus`, `statusOf`, `isRetryableError`, `isAbortError`,
  `abortError`, `backoffDelay`, `sleepFor`, `withRetry`. `lib/catalog-cache.js` **314 L** — TTL,
  single-flight, `invalidate()`, stale-while-revalidate, a durable versioned snapshot with an
  injected `fs` and an injected clock (so it is pure and browser-loadable).
- ✅ **Antigravity (Phase 2, `8ee4ef1`):** its 70-line retry loop now rides the core —
  `vendor/antigravity/lib/adapter.js:27` imports `DEFAULT_RETRY_STATUSES`, `isRetryableStatus`,
  `statusOf`, `withRetry` from `../../../lib/retry.js`. Its 92-line catalog cache now rides the
  core — `vendor/antigravity/lib/index.js:32` imports `createCatalogCache`,
  `DEFAULT_CATALOG_TTL_MS` from `../../../lib/catalog-cache.js` (instantiated at `:272`).
  The live quota RPC and its separate quota window stay vendor-local (a product fact).
- ✅ **OpenCode + DeepInfra (Phase 2 follow-up, `77a53b0`):** both remaining vendor-local
  mechanics are gone — **R3 is CLOSED**. The measured detail is in the next block. The former
  ⚠️ rows ("OpenCode's `backoffDelay` is still its own", "two vendor catalog caches remain",
  "Open A5 remnant") are **closed** and are kept below only as the Phase-1/2-era record.

- ✅ **OpenCode — one retry core.** The vendor's own `sleepFor` (**24 L**) and its
  **inverted-signature** `backoffDelay` (**12 L**) are **deleted**; **both** retry sites — the
  control-plane request and the generation-status loop — now call `lib/retry.js`. Measured:
  `grep -rn "function backoffDelay\|function sleepFor" lib/ vendor/` → **2** hits, **both** in
  `lib/retry.js` (`backoffDelay` `:130`, `sleepFor` `:147`) — **0** in any vendor.
  **Preserved exactly** (these are the semantics that must not drift):
  - the **vendor's own status set** — **429 / 451 / 502 / 503 / 504** — deliberately **NOT** widened
    to the core's wider set;
  - **unbounded progression** (the cap is deliberately raised);
  - the **abort semantics**;
  - the **one-shot 401 refresh**, kept as an **in-attempt** action that never consumes a retry.
- ✅ **OpenCode — one catalog cache.** `vendor/opencode/lib/catalog-cache.js` (**362 L**) is
  **deleted**. Its snapshot file and its stale-while-revalidate lifecycle are split into
  `vendor/opencode/lib/catalog-file.js` (**236 L**) + `vendor/opencode/lib/catalog-lifecycle.js`
  (**181 L**) on top of the core `createCatalogCache` (single-flight and the durable snapshot
  round-trip preserved). OpenCode suite **553 → 554/554**.
- ✅ **DeepInfra — one catalog cache.** The local 30-minute in-memory cache, the
  `invalidateCatalog` closure and the `fetchedAt` math are **replaced** by the core
  `createCatalogCache` fed by a `ttlMs` **function**, so the plugin's **own 30-minute default**
  and its **config key** (`catalogTtlMs`) are **unchanged**
  (`vendor/deepinfra/lib/index.js:237` → `numberAt('catalogTtlMs', DEFAULT_CATALOG_TTL_MS)`).
  **Measured benefit:** **5 concurrent cold reads → 1 probe** (the old closure had no in-flight
  dedupe); a **failed cold fetch is still served as an empty catalog and is not cached**, so one
  bad poll does not blank the picker for a whole TTL.
- ⚠️ **Known divergence (not a defect).** `DEFAULT_CATALOG_TTL_MS` now exists in **two** places:
  `vendor/deepinfra/lib/catalog.js:111` (**30 min**, the one actually used) and
  `lib/catalog-cache.js:42` (**15 min**, the core default when no `ttl` is passed). DeepInfra
  passes its own 30-minute constant explicitly, so the **runtime** TTL is unambiguous — but the
  two names coexist and a reader who sees only the core constant will read the wrong default.

---

#### A6 — delete dead surfaces + close the gates

- **Measured evidence.**
  - `vendor/exaone/lib/map.js:96-130` — `finishReason` + `isFinishEvent` = **35 lines** with
    **0 external consumers** (measured: the only import of `map.js` in the vendor is `mapDelta`
    from `vendor/exaone/lib/stream-contract.js:31`; no other file in `vendor/exaone/` or `test/`
    references either symbol).
  - `classifyBlock` is declared in `lib/driver/contract.js:20` (`OPTIONAL_HOOKS`) and **no hook
    reads it** (measured: 1 hit repo-wide, the declaration itself).
  - The 3 `abortError` copies (14 L) — see A1.
  - `scripts/verify-stream.mjs:23` guards only 3 of 4 vendors — `dsh-exaone` is unguarded.
  - The spec↔preset hole: a wrong `endpoint` / `protocol` / model id in
    `specs/providers/deepinfra.json` passes `verify-specs` with **exit 0** (measured).
  - `specs/pricing/*.kind` (`subscription` / `live-catalog` / `free` / `flat`) and
    `preset.usage.billing.mode` (`subscription` / `flat` / `pay-per-token` / `none`) are two
    vocabularies with **no cross-check**.
  - `usage.routes[].normalize` joins to the hand-written `USAGE_READERS` table
    (`lib/client.src.js:772`) with **no gate**.
- **Owner-principle reason.** Dead code in the upper layer is not "thin adapter"; it is a second
  source of truth that will drift. And a gate that does not fail on a lying spec is worse than no
  gate, because it reports health.
- **Concrete moves / deletes.**
  1. Delete `vendor/exaone/lib/map.js:96-130` (35 L, 0 consumers) and the unused `classifyBlock`
     hook slot.
  2. Delete the 3 `abortError` copies (folded into `lib/stream/failure.js` by A1).
  3. Extend `scripts/verify-stream.mjs:23` to guard **`dsh-exaone`** — the 4th vendor.
  4. Add a **spec ↔ preset mirror check**: a spec file that lies about endpoint / protocol /
     model must **fail**. The check compares `specs/providers/<id>.json` against the preset
     declaration, not only against the spec set's internal references (the current cross-reference
     catches a *deleted* file — exit 1 — but not a *lying* one — exit 0).
  5. Add a **declaration "dead field" allowlist** with mutation cases: every field listed in
     §4.1's dead-declaration row is either wired to a consumer or explicitly allow-listed as
     dead, and a mutation test proves each class is caught.
  6. Add a **mapping** between `specs/pricing/*.kind` and `preset.usage.billing.mode`, and gate
     `usage.routes[].normalize` against the `USAGE_READERS` table.
- **Acceptance criteria (gate-provable).**
  - `verify:stream` guards **4 of 4** vendors; `vendor loads: 0` then covers EXAONE too.
  - A lying spec (wrong endpoint / protocol / model id) makes `specs:check` **exit 1** — proven
     by a committed mutation case.
  - The dead-field allowlist has **one entry per measured dead field**, each with a mutation case.
  - `npm run verify` (check + tests + `verify:stream` + `specs:check`) exits 0.

#### A6 result (measured 2026-11-14) — the gates are hardened; two items are still OPEN

- ✅ **The zero-vendor-loads guard is now honest for all 4 vendors.**
  `scripts/verify-stream.mjs` no longer types a vendor list: it **measures** the vendor set from
  `vendor/<name>/package.json` (`:34-51`), so a fifth vendor is guarded the moment it is vendored.
  The guard **self-tests**: `guardSelfTest()` (`:94-122`) asks the resolver for every vendor's
  alias and scoped name and **requires the refusal**; a specifier that resolves is reported as
  `UNGUARDED` and fails the run. A **control probe** (`node:fs`, `:115-120`) proves the resolver
  is consulted, so the self-test cannot pass by every call being ignored. A **vacuity guard**
  (`:54-57`) exits **2** when no vendored package is found — a guard that guards nothing must not
  report success. Measured 2026-11-14: **4 vendored packages probed, 8/8 specifiers refused,
  vendor loads 0**.
- ✅ **The spec↔preset mirror landed.** `checkPresetMirror(specs, { presets })`
  (`scripts/verify-specs.mjs:216`, wired at `:372`) compares each provider spec against the
  **preset declaration**, so a lying spec now fails. Proven by committed mutation cases:
  `S1-spec-endpoint-contradicts-preset`, `S2-spec-protocol-contradicts-preset`,
  `S3-spec-model-not-in-preset`, `S4-pricing-kind-contradicts-billing`,
  `S5-provider-spec-missing-for-a-preset`, `S6-spec-pricing-names-another-file` — all **caught**.
- ✅ **The dead-field allowlist landed.** `lib/preset-schema.js` gained
  `DECLARATION_RUNTIME_FIELDS` (`:147`) and `DECLARATION_DEAD_FIELDS` (`:228`); `verify-presets.mjs`
  now reports unknown fields as **errors** and allow-listed dead fields as **warnings**; the
  mutation harness proves it: `D1-new-dead-field-on-a-declaration`,
  `D2-dead-field-inside-the-usage-block`, `D3-new-surface-with-no-consumer` — all **caught**.
- ✅ **The EXAONE dead exports are gone** (`vendor/exaone/lib/map.js` 130 → **32 L**, a pure
  re-export shim); the 3 `abortError` copies are one (`lib/stream/failure.js:101`).
- ✅ **The mutation harness grew 17 → 26/26** (registry 13, files 4, specs 6, declaration fields 3).
- ✅ **OPEN 1 is now CLOSED — the L1 boundary lint exists** (`e8b39f7`).
  `test/stream-boundary.test.mjs` (**15 cases**) scans `lib/stream/*` + the core accounting /
  retry / cache modules and fails on: (a) a `vendor/` or `@nolit/dsh-(antigravity|deepinfra|
  exaone|opencode)` import, (b) a vendor name in a non-comment token, (c) a forbidden runtime
  dependency (`ctx.`, `process.env`, `node:fs`, `fetch(`, `require(`, dynamic `import(`),
  (d) a per-vendor equality branch, and (e) more than one SSE decoder / usage writer / finish
  table / `abortError`. **Negative proof:** a planted forbidden import failed **3** rules; the
  plant was reverted with a **sha256 verification**.
- ✅ **OPEN 2 is now CLOSED — `USAGE_READERS` is gated** (`e8b39f7`).
  `scripts/verify-usage-readers.mjs` + `test/usage-readers.test.mjs` (**12 cases**) check that
  every preset's `usage.routes[].normalize` names a **real** reader, that no reader is dead, and
  that the browser **source↔bundle** stay in parity. Measured: **4 presets / 4 routes / 3 readers**
  (`normalizeAntigravityUsage`, `normalizeOpencodeUsage`, `normalizeDeepinfraUsage`); a renamed
  route exits **1**.
- ✅ **OPEN 3 is now CLOSED — the dead `classifyBlock` slot is removed** (`e8b39f7`).
  `lib/driver/contract.js` no longer declares it; `test/driver-contract.test.mjs` asserts
  `'classifyBlock' in driver.hooks === false`.
- ⬜ **Still open (not A6, tracked separately):** the **repo-wide uniqueness greps** are still a
  manual grep, not a wired gate (**R6**), and `numberOrNull` / `pickSession` / `createCostStore`
  are still defined more than once because of the OpenCode ledger remnant (**R2**). The
  `backoffDelay` duplicate is **gone** — **R3 is CLOSED** (`77a53b0`): OpenCode's own `sleepFor`
  (24 L) and inverted-signature `backoffDelay` (12 L) are deleted, and both retry sites ride
  `lib/retry.js`.

---

#### A7 — the real "generic OpenAI-compatible provider" seam is in the HOST (measure-first)

- **Measured evidence.**
  - The host plugin `dsh-llm-pi-ai` takes its provider profiles as a **dict**:
    `providers: z.dict(profile).default({}).volatile()` — host
    `node_modules/@deepseek-ai/dsh-llm-pi-ai/lib/index.js:1094`. A generic OpenAI-compatible
    provider is therefore a **host profile**, not a router preset.
  - In **this** repo the `route: 'pi-ai'` value has **no writer**: the only consumers of
    `endpoint.route` are *validators* (`lib/preset-schema.js:177-181`); `lib/presets.js:62`
    declares the allowed values (`ROUTES = ['pi-ai','own']`), and `lib/presets.js:393` uses
    `route: 'pi-ai'` in `DECLARATION_EXAMPLE` — an example preset that mounts nothing.
  - `kind: 'declaration'` mounts nothing (measured above), so the declaration path cannot serve a
    model route today.
- **Owner-principle reason.** The owner principle puts the *standard* in the lower layer. A
  generic OpenAI-compatible provider is exactly a standard-protocol route — so it belongs where
  the standard lives (the host's pi-ai providers dict), **not** as a new declaration format in the
  router. This repo's preset layer is a *routing + mount* layer; making it a provider registry
  would put a second registry next to the host's.
- **Concrete moves / deletes.**
  1. **Measure first**: prove whether the router can and should write a host `providers` profile
     entry (write permission, hot-reload semantics, credential resolution, conflict with an
     operator's own entry).
  2. Only then decide the shape: a router→host provider-profile writer, or a documented
     operator procedure.
  3. **Do not promise "no adapter code" until measured.** The former P2-1 promised it; the
     measurement says it is not reachable from this repo.
- **Acceptance criteria (gate-provable).**
  - A written, measured answer to "can the router write the host `providers` dict?" — with the
     exact seam, the failure modes and the conflict rules.
  - If it can: one generic OpenAI-compatible route enabled by **data only** (profile + key +
     model), proven by a live turn, with a committed mutation case proving the drift gate
     catches a bad profile.
  - If it cannot: a documented operator procedure in the host's own terms, and this repo's
     P2 backlog stops claiming a data-only install path.

---

### P2-2. Flip OpenCode's `pipe: 'shared'` default — ✅ **DONE (the key is gone entirely)**

- **Status:** **done** (2026-11-14, `e8b39f7`). The `pipe` config key is **deleted**: the legacy
  branch body, its prelude and its own SSE reader (`chatSseEvents` / `parseSseBlock`) are gone,
  and **no config selects a pipeline any more** — the file header states the pipeline explicitly.
  There is no opt-out left to flip.
- **Why it mattered:** the shared path had to be implemented and test-proven before the second
  implementation could be removed.
- **Done when:** one owner-verified live turn runs on the shared pipe, the legacy path is removed,
  and `verify:stream` stays green. **Met** — the owner-verified live turn ran after the
  09:37:14 KST restart (PID 361248) and the OpenCode shared pipe returned OK with no error.

### P2-3. Canonical parser (the Phase F parser item) — ✅ **DONE (placement recorded)**

- **Status:** **done** (2026-11-14, `e8b39f7`). The hardcoded `parser: 'legacy'` literal is gone,
  the parser identity is the data value `OPENCODE_PARSER = 'shared-openai'`, and the wire boundary
  is the shared OpenAI core. The *placement decision* R1 asked for is now recorded: the classifier
  is a **vendor-local notation-quirk surface** —
  `vendor/opencode/lib/stream-parser.js` → `vendor/opencode/lib/notation-classifier.js`
  (679 L, single named export `createNotationClassifier`, one consumer). It is **not** promoted
  into a core parser slot, because a second prose-notation provider has not appeared.
- **Why the earlier measurement mattered:** the shared path **imports** the classifier, so it was
  never legacy-only. That is why the original 629-line delete list was wrong — and why the file was
  renamed rather than deleted.
- **Done when:** the placement is recorded in writing ✅, the coverage survives the deletion ✅
  (golden sequences captured from the shared path before the deletion), and the prose/glyph/
  `content_filter` gates named in the old Phase F are measurable. **The parser-placement half is
  met; the old Phase F content-filter gates were never part of A3 and remain unstarted.**

### P2-5. S3 — Antigravity usage per model group

- **Status:** **not started; owner deferred on 2026-11-08.**
- **Why:** the account reports Gemini / Claude·GPT / Argon separately; the dashboard flattens them
  into one window set, hiding which family is exhausted.
- **Done when:** the card renders one section per group with the existing 5h → weekly → monthly
  order inside each group.

### P2-6. S4 — spec-only surfaces

- **Status:** **not started; blocked on owner approval.**
- **Why:** `OPENCODE-CONSOLE-SINGLE-PRESET-SPEC.md` names six unimplemented pieces
  (`entry.isolate`, Console window bridge, four-wire catalog reader, `usage.billing.limits`, cost
  shape adapter, Track-B consent card). They are real product gaps but not required for the current
  serving path.
- **Done when:** the owner approves the surface and the six items land behind their own gates.

### P2-8. EXAONE static catalog → live catalog (when the platform adds one)

- **Status:** **not started; waits on the platform.**
- **Why:** EXAONE documents one chat model and no listing endpoint, so the model row is static; a new
  EXAONE model would require a code edit.
- **Done when:** if/when `GET /v1/models` (or an equivalent) exists, the provider reads it with a
  TTL and the static row becomes a fallback.

## 5. Recently fixed (rc.20, same session)

Three code-only fixes, all found by live probing after the rc.20 migration; the full evidence is in
[CHANGELOG.md](../CHANGELOG.md) §"0.0.1-rc.20 (cont. 2)".

| Commit | What was wrong | Fix | Evidence |
|---|---|---|---|
| `0b2c516` | the credential ref was read as `ctx.credentials`; both presets inject only `llm`, so cordis threw `cannot get property "credentials" without inject` (cordis:1257) and the `try/catch` silently returned `''` | read it through the **inject-free accessor** `ctx.get('credentials')` (cordis:1345) | vendor deepinfra / exaone |
| `642ee06` | a replayed Gemini `functionCall.args` carried a key the tool declaration does not declare (live: `sandbox_permissions` on a `write` call, session `2a16c3bb` turn 1 step 14) → Google answered `HTTP 400 "Request contains an invalid argument."` | `declaredArguments()` + `pruneArguments()` — only declared keys are replayed | antigravity suite **190 → 193** |
| `6388397` | the store ref was resolved once at mount, but `ctx.get(name, strict)` returns `undefined` while the provider fiber is activating (live: `HTTP 401: missing API key` on a DeepInfra child) | `strict=false` + `ctx.inject(['credentials'], …)` deferred resolution + refresh on `credentials/reference-updated` | vendor deepinfra / exaone |

**Live verification (2026-11-14, post-restart):** DeepInfra child
`deepseek-ai/DeepSeek-V4.1-Flash-1017` → `DEEPINFRA_PROBE_OK`, no error. Gemini child
`gemini-4-hydrogen` → two consecutive requests, the second a replay carrying `sandbox_permissions`
→ `GEMINI_OK_3` / `GEMINI_OK_3B` / `TWO_REQUESTS_OK`, no HTTP 400. Service `MainPID 284518`,
started 06:10:57 KST; the boot log carries no credential warnings. **An EXAONE *child* call is still
UNVERIFIED** (the probing session froze its allowlist at `agent/created`); the **top-level** EXAONE
turn works, confirmed by the owner.

## 6. Order

1. **P0-1/P0-2** (owner key rotation of **all four** refs; the credential-store migration itself is
   applied and live-verified for DeepInfra) — owner-gated.
2. **P1-1/P1-3** — owner restart once after the rotation, then a **new** top-level session and the
   EXAONE **child** turn. Top-level EXAONE is already confirmed working.
3. **P2-A — Horizontal Phase Matrix** (full contracts in
   [ARCHITECTURE-LAYERED.md](./ARCHITECTURE-LAYERED.md), dispatch packages in
   [WORKER-DISPATCH.md](./WORKER-DISPATCH.md)):

   | Phase | Mode | Tasks | Gate / Exit Bar | Status |
   | :-: |---|---|---|---|
   | **1** | **SERIAL** (1 worker, sequential) | **W1-1 (A2-core)** → **W1-2 (A1-core)** → **W1-3 (A4-core)** → **W1-4 (A5-core)** | **Core Interface Locked:** `lib/stream/*`, `lib/driver/contract.js`, `lib/{cost,plan,usage,retry,catalog-cache}.js` frozen; `anthropic.js` ≤ 434 L; `npm run verify` + all 4 vendor suites green | ✅ **DONE** — `c0e48ab`, `3ac7a10`, `c2ba900`, `ae9fd1d`; `anthropic.js` **433 L** ≤ 434 |
   | **2** | **PARALLEL** (disjoint write scopes) | **W2-A (A3 OpenCode)** ‖ **W2-B (DeepInfra)** ‖ **W2-C (EXAONE)** ‖ **W2-D (A6 Gates, owns `scripts/verify-stream.mjs`)** ‖ **W2-E (Antigravity A4/A5)** | Zero vendor-local wire/ledger/retry/cache copies left; `verify:stream` 8/8 with `dsh-exaone` guarded (`vendor loads: 0`); `verify:presets:mutation` 17/17 + spec↔preset mirror + boundary lint green; 1 live OpenCode shared-pipe turn | ✅ **DONE** — `8ee4ef1` + `e8b39f7`; `verify:stream` 8/8 with **4** vendors probed / 8/8 refused / 0 loads; mutation **26/26**; spec↔preset mirror green; **A3 COMPLETE** (legacy pipeline deleted, `pipe` config key gone, `notation-classifier.js` rename); **R4 CLOSED** (L1 boundary lint **15** cases + `verify-usage-readers` **12** cases, dead `classifyBlock` slot removed); the **live OpenCode shared-pipe turn is owner-verified** (09:37:14 KST restart, PID 361248) |
   | **3** | **SERIAL / Measure-first** | **W3-1 (A7 host seam)** | Measured answer on `dsh-llm-pi-ai` `providers` dict + owner decision (no unmeasured data-only promise) | ⬜ **NOT STARTED** |

   **What remains in the P2-A queue, in order** (everything else is closed or owner-gated):

   | # | Task | Scope | Gate |
   | :-: |---|---|---|
   | ~~**R1**~~ | ~~Finish A3~~ — **CLOSED** by `e8b39f7`: the `pipe` config key, the legacy branch body, its prelude and its own SSE reader are deleted (`http.js` 3 272 → **2 721 L**); `stream-parser.js` was measured to be **shared-path glue** and was **renamed** `notation-classifier.js` (679 L, one named export, one consumer); the legacy↔shared parity tests were replaced by **golden sequences captured from the shared path before deletion** (opencode 555 → **553/553**) | — | ✅ opencode **553/553**; `verify:stream` **8/8**; the `pipe` key is gone from the config union; the live OpenCode shared-pipe turn is **owner-verified** |
   | **R2** | **A4 remnant** — route OpenCode's private ledger (`numberOrNull`, `pickSession`, `createCostStore`, `createCostLedger`) and its re-declared `plans.js` / `usage-ledger.js` constants onto `lib/{cost,plan,usage}.js` | `vendor/opencode/lib/**` only | a grep gate proves `numberOrNull` / `pickSession` are defined **once** repo-wide |
   | ~~**R3**~~ | ~~A5 remnant~~ — **CLOSED** by `77a53b0`: OpenCode's own `sleepFor` (24 L) and inverted-signature `backoffDelay` (12 L) are deleted and **both** retry sites use `lib/retry.js`; `vendor/opencode/lib/catalog-cache.js` (362 L) is deleted and split into `catalog-file.js` (236 L) + `catalog-lifecycle.js` (181 L) over the core `createCatalogCache`; DeepInfra's local 30-min cache + `invalidateCatalog` closure + `fetchedAt` math are replaced by the core cache with a `ttlMs` function (its 30-min default and config key unchanged) | — | ✅ opencode **554/554**; deepinfra **222 pass / 7 skip**; `grep "function backoffDelay\|function sleepFor"` → **2** hits, both in `lib/retry.js`; `grep "lib/catalog-cache.js" vendor/` → **3** hits (antigravity, deepinfra, opencode) — **one** core cache for every vendor; 5 concurrent cold reads → **1** probe |
   | ~~**R4**~~ | ~~A6 remnant~~ — **CLOSED** by `e8b39f7`: `test/stream-boundary.test.mjs` (**15** cases) enforces the L1 boundary; `scripts/verify-usage-readers.mjs` + `test/usage-readers.test.mjs` (**12** cases) gate the `usage.routes[].normalize` names with browser source↔bundle parity; the dead `classifyBlock` slot is removed from `lib/driver/contract.js` | — | ✅ the lint fails on a planted vendor import / vendor name / `ctx.` / `process.env` / `fetch(` inside `lib/stream/*`; an unregistered `normalize` name fails; **both gates carry negative proofs** (a planted regression → failure → reverted with a hash check) |
   | ~~**R5**~~ | ~~No vendor ids in L1~~ — **CLOSED** by `77a53b0`: `PLAN_PROVIDERS` moved from `lib/plan.js` into the declaration layer `lib/presets.js` (+ `planProvidersOf(presetId)`); `lib/plan.js` exposes `bindPlanProviders(map)` and takes an **explicit** `providers` argument. Vendor-id count in `lib/plan.js`: **2 code ids (9 with comments) → 0** | — | ✅ `test/plan-boundary.test.mjs` (**5 cases**) measures the vendor words from `vendor/*/package.json` instead of hand-listing them; the lint fails on a planted vendor id in `lib/plan.js` |
   | **R6** | **Uniqueness greps as a wired gate** — `mapDelta` / `numberOrNull` / `pickSession` / `createCostStore` / `backoffDelay` are currently a manual grep, not a test | `test/**` or `scripts/**` | each name has exactly one definition repo-wide, enforced by a test |
   | **A7** | **Host seam** — measure the host `providers: z.dict(profile)` seam, then produce the owner decision | `docs/**` first, then owner-gated code | a written, measured answer; no unmeasured data-only promise |

   > **R5 naming note.** Earlier revisions used **R5** for two different things (the
   > `PLAN_PROVIDERS` L1 vendor-id table **and** the host `providers`-seam measurement). The
   > **host seam is now called A7 everywhere** (it is **Phase 3** in the matrix above); **R5** is
   > unambiguously the `PLAN_PROVIDERS` closure, which is **CLOSED** by `77a53b0`.

4. The remaining **P2** items keep their own order and gates: **P2-2** and **P2-3** are superseded by
   **A3** (tracked there); **P2-5** (S3, owner deferred 2026-11-08) and **P2-6** (S4, blocked on owner
   approval) stay owner-gated and are not in the P2-A queue; **P2-8** (EXAONE live catalog) waits on
   the platform. P2-4 is split into Anthropic and Google fixtures (a single worker ran out of
   context doing both). The deleted **P2-1** remains **removed, not closed** (unreachable promise).

## 7. Evidence

Current gates (re-measured 2026-11-14, after Phase 1 + Phase 2 + the A3 completion + **R3/R5
closure**): router `npm test` **807/807** (was 802 at `e8b39f7`),
`npm run verify` exit 0 (check + 807 tests + `verify:stream` + `specs:check` — `5 protocols, 4
providers, 4 pricing` — OK), `verify:presets` OK (`OK: preset declarations, the browser registry,
the locales and the runtime registries all agree`; runtime providers `deepseek-account, antigravity,
deepinfra, deepinfra-anthropic, exaone, opencode-http-agent`). Vendor suites: antigravity **193/193**
(+3 from `642ee06`), deepinfra **222 pass / 7 skip** (229 total), opencode **554/554** (553 → 554:
the R3 catalog split added one case), exaone
**19/19** — **the three non-OpenCode vendor suites are unchanged by the refactor.**

`verify:stream` (re-measured 2026-11-14): **8/8** dispatch cases, **4** vendored packages probed
(`@nolit/dsh-antigravity`, `@nolit/dsh-deepinfra`, `@nolit/dsh-exaone`, `@nolit/dsh-opencode-v2`),
**8/8** specifiers refused, **vendor loads: 0**. The vendor set is **measured** from
`vendor/*/package.json`, not typed in, and the guard is self-tested with a control probe and a
vacuity guard — see A6's result above.

`verify:presets:mutation` (re-measured 2026-11-14): **26/26** drift classes caught (registry 13,
files 4, specs 6, declaration fields 3).

`verify:usage-readers` (re-measured 2026-11-14): **OK** — 4 presets, 4 routes, 3 readers
(`normalizeAntigravityUsage`, `normalizeOpencodeUsage`, `normalizeDeepinfraUsage`).

**Size movement (measured by `wc -l`, `ead9daf` → `8ee4ef1` → `e8b39f7` → `77a53b0`):**

| Surface | `@ead9daf` | `8ee4ef1` | `e8b39f7` | `77a53b0` | Δ (audit → now) |
|---|---:|---:|---:|---:|---:|
| `lib/stream/` total | **1 378** | **1 851** | **1 851** | **1 851** | **+473** |
| ↳ `lib/stream/anthropic.js` | **614** | 433 | **433** | **433** | **−181** |
| ↳ `lib/stream/usage.js` | 90 | 217 | 217 | 217 | +127 |
| ↳ `lib/stream/sse.js` | 180 | 216 | 216 | 216 | +36 |
| ↳ `lib/stream/openai.js` | — | **467** | **467** | **467** | **+467** |
| `lib/{cost,plan,usage}.js` | **531** | **1 669** | **1 669** | **1 702** | **+1 171** |
| `lib/retry.js` + `lib/catalog-cache.js` | — | **569** | **569** | **569** | **+569** |
| ↳ `vendor/opencode/lib/http.js` | **3 073** | **3 272** | **2 721** | **2 697** | **−376** |
| vendor antigravity `lib/` | 5 216 | 5 275 | **5 275** | **5 275** | +59 |
| vendor opencode `lib/` | 12 330 | 12 631 | **12 083** | **12 115** | **−215** |
| vendor deepinfra `lib/` | 3 950 | 3 480 | **3 480** | **3 517** | **−433** |
| vendor exaone `lib/` | 1 176 | 842 | **842** | **842** | **−334** |
| **vendor total** | **22 672** | **22 228** | **21 680** | **21 749** | **−923** |

The reading: the **duplication left the upper layer** (**−923 L** across the four vendors since the
audit) and the **standardisation entered the lower one** (+2 213 L across `lib/stream/` and the
accounting / retry / cache cores). The core is bigger; the *vendors* are smaller and now bind to
it by identity instead of carrying copies. The A3 completion removed the last **−551 L** of
OpenCode's own pipeline (12 631 → 12 083) — the second, vendor-local implementation is gone.
**R3 (`77a53b0`) moved the last two vendor-local mechanics out:** OpenCode's `lib/` went
**12 083 → 12 115** (+32 = the `catalog-file.js` / `catalog-lifecycle.js` split minus the deleted
362 L cache minus the deleted 36 L of retry helpers), DeepInfra's `lib/` went **3 480 → 3 517**
(+37 = the core-cache wiring), and the core grew **+33 L** in `lib/plan.js` (the `providers`
parameter and the `bindPlanProviders` seam) — **net −923 L** in the vendors against the audit.

The **synthetic `OpenCode (config default)` row** is closed: it was produced in
`vendor/opencode/lib/http.js` (the `models` config default and the `listModels` prepend) and in
`vendor/opencode/lib/provider.js` (same two places). Both are removed; the `default` pseudo-route
still resolves server-side to `defaultModel`, and that behaviour is unchanged. Producer grep count
for the label is **0**; `test/model-catalog-default-row.test.mjs` (4 tests) asserts the absence in
the config default, the discovered list and the fallback list, and the vendor test
`listModels hides routes outside enabledModels and never lists the synthetic default row` now
asserts absence too.
