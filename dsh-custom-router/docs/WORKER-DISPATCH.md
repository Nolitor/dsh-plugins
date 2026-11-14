# Custom Router — Worker Dispatch Packages

<!-- skeleton:
version: 1.1
kind: reference
status: active
updated: 2026-11-14
summary: Copy-paste dispatch packages for Phase 1 (serial core lock W1-1..W1-4) and Phase 2 (parallel upper-layer fan-out W2-A..W2-E) with disjoint write scopes and exact gates. W2-A (A3) and W2-D (A6 gates) are SHIPPED as of 2026-11-14 (e8b39f7); R2, R3, R5, R6 and A7 are ALL CLOSED as of rc.21; R8 and R9 are CLOSED as of rc.22, so the P2-A queue is EMPTY and the remaining work is owner-gated.
-->

> **Execution guide.** Follow [ROADMAP.md](./ROADMAP.md) §4 P2-A and the layer contract in
> [ARCHITECTURE-LAYERED.md](./ARCHITECTURE-LAYERED.md).
>
> - **SHIPPED 2026-11-14 (`e8b39f7`) — do not re-run these blocks:**
>   - **W2-A (A3, OpenCode onto the shared pipe)** — DONE. `http.js` **3 272 → 2 721 L**; the
>     legacy loop, its prelude, the vendor's own SSE reader (`chatSseEvents`/`parseSseBlock`), the
>     `pipe` config key and 4 orphaned imports are deleted — **no config selects a pipeline any
>     more**. `stream-parser.js` was measured to be **shared-path glue** and was **renamed**
>     `notation-classifier.js` (679 L, one named export, one consumer). OpenCode suite
>     **553/553**; the live shared-pipe turn is owner-verified.
>   - **W2-D (A6 gates)** — DONE. `test/stream-boundary.test.mjs` (**15** cases),
>     `scripts/verify-usage-readers.mjs` + `test/usage-readers.test.mjs` (**12** cases), and the
>     dead `classifyBlock` slot removed.
>   - The blocks below are kept as the **record of what shipped**; the *open* work was
>     **R8** (the OpenCode-backend 404, provider-id resolution seam) in
>     [ROADMAP.md](./ROADMAP.md) §6 — **not** a re-run of W2-A / W2-D. **CLOSED in rc.22**: R8
>     resolved endpoints from the daemon's authoritative provider **DIRECTORY**, and R9 made the
>     build chain idempotent. **The P2-A queue is now EMPTY** — nothing here should be re-run.
> - **CLOSED 2026-11-14 (rc.21) — R2, R3, R5, R6 and A7 are all closed:**
>   - **R2** — OpenCode's private ledger, plan table and usage constants now delegate to the
>     core (`numberOrNull` / `pickSession` / `USAGE_BUCKETS` / `usageTotal` are each defined
>     **once** repo-wide).
>   - **R3 / R5** — closed by `77a53b0` (one retry core, one catalog cache, no vendor ids in L1).
>   - **R6** — the repo-wide uniqueness greps are now a **wired gate**
>     (`test/uniqueness.test.mjs` **23 cases** + `scripts/verify-uniqueness.mjs`), with a
>     negative proof.
>   - **A7** — closed as a **measurement**
>     ([HOST-PROVIDERS-SEAM.md](./HOST-PROVIDERS-SEAM.md)): the host `dsh-llm-pi-ai` seam models
>     **provider profiles only**, so it **cannot replace this router**; recommended: keep it
>     dormant.
>   - **NEW in rc.21** — the **tool-argument contract seam**
>     (`lib/stream/tool-argument-contract.js`, at the L1 emission point) and the
>     `sync-derive.mjs` **idempotency** fix.
>
> - **Phase 1 (`W1-1` → `W1-2` → `W1-3` → `W1-4`) is STRICTLY SERIAL.** Never run two Phase 1
>   workers concurrently: they share `lib/stream/index.js`, `lib/driver/contract.js`, and
>   `package.json`.
> - **Phase 2 (`W2-A`, `W2-B`, `W2-C`, `W2-D`, `W2-E`) is PARALLEL** only **after** Phase 1 passes
>   its **Core Interface Locked** bar. Every Phase 2 worker has a provably disjoint write scope;
>   **only `W2-D` owns `scripts/verify-stream.mjs`**.
> - **Shared baseline numbers** (measured 2026-11-14 at `@nolit/dsh-custom-router@0.0.1-rc.21`):
>   router `649/649`, antigravity `193/193`, deepinfra `222 pass / 7 skip` (`229` total),
>   opencode `555/555`, exaone `19/19`, `verify:stream` `8/8` (`vendor loads: 0`),
>   `verify:presets:mutation` `17/17`, `specs:check` `5 protocols, 4 providers, 4 pricing — OK`.

---

## 1. Phase Matrix and Disjoint Write-Scope Summary

| Worker | Phase / Mode | Task | Allowed write scope | Owns `verify-stream.mjs`? |
|---|---|---|---|---|
| `W1-1` | Phase 1 · SERIAL #1 | **A2-core**: extract `lib/stream/openai.js` | `lib/stream/openai.js`, `lib/stream/index.js`, `package.json`, `test/stream-openai.test.mjs`, `test/conformance/openai-completions.test.mjs` | No |
| `W1-2` | Phase 1 · SERIAL #2 | **A1-core**: consolidate `lib/stream/anthropic.js` + `totalFormula` | `lib/stream/{anthropic,sse,usage,failure,index}.js`, `lib/driver/contract.js`, `test/stream-*.test.mjs`, `test/anthropic-protocol.test.mjs`, `test/driver-contract.test.mjs`, `test/conformance/anthropic-messages.test.mjs` | No |
| `W1-3` | Phase 1 · SERIAL #3 | **A4-core**: lock `lib/{cost,plan,usage}.js` accounting + ledger | `lib/{cost,plan,usage}.js`, `package.json`, `test/{cost,plan,usage}.test.mjs` | No |
| `W1-4` | Phase 1 · SERIAL #4 | **A5-core**: add `lib/retry.js` + `lib/catalog-cache.js` | `lib/retry.js`, `lib/catalog-cache.js`, `package.json`, `test/retry.test.mjs`, `test/catalog-cache.test.mjs` | No |
| `W2-A` | Phase 2 · PARALLEL | **A3**: OpenCode onto shared pipe + ledger/retry/cache rewiring | `vendor/opencode/lib/**`, `vendor/opencode/test/**` | No |
| `W2-B` | Phase 2 · PARALLEL | **DeepInfra dedup**: OpenAI wire + cost ledger + cache | `vendor/deepinfra/lib/**`, `vendor/deepinfra/test/**` | No |
| `W2-C` | Phase 2 · PARALLEL | **EXAONE dedup**: OpenAI wire + dead exports (`map.js:96-130`) | `vendor/exaone/lib/**`, `vendor/exaone/test/**` | No |
| `W2-D` | Phase 2 · PARALLEL | **A6**: `dsh-exaone` guard + spec↔preset mirror + boundary lint | `scripts/verify-stream.mjs`, `scripts/verify-specs.mjs`, `scripts/verify-presets-mutation.mjs`, `lib/driver/contract.js`, `lib/preset-drift.js`, `specs/**`, `test/{specs,preset-drift,driver-contract,stream-boundary}.test.mjs` | **YES (sole owner)** |
| `W2-E` | Phase 2 · PARALLEL *(optional)* | **Antigravity A4/A5**: retry + catalog cache + `agy` usage map | `vendor/antigravity/lib/**`, `vendor/antigravity/test/**` | No |

---

## 2. Phase 1 Dispatch Blocks (SERIAL — Run One at a Time)

### W1-1 — A2-core: Extract One OpenAI Wire Profile in Core

```text
WORKER_ID: W1-1
TASK: A2-core — Extract standardized OpenAI stream + request-projection profile into lib/stream/openai.js
MODE: SERIAL (Phase 1, Step 1.1 — must complete and pass before W1-2 starts; do NOT run alongside other workers)
REPO: /home/minami/Workspace/projects/dsh-workspace/dsh-plugins
PACKAGE_DIR: dsh-custom-router (@nolit/dsh-custom-router@0.0.1-rc.21)

ALLOWED_WRITE_SCOPE:
  - dsh-custom-router/lib/stream/openai.js (new)
  - dsh-custom-router/lib/stream/index.js
  - dsh-custom-router/package.json (exports + check script only; do NOT change version)
  - dsh-custom-router/test/stream-openai.test.mjs (new)
  - dsh-custom-router/test/conformance/openai-completions.test.mjs

FORBIDDEN_PATHS:
  - dsh-custom-router/vendor/** (vendor deletions wait for Phase 2 W2-B / W2-C)
  - dsh-custom-router/scripts/**
  - dsh-custom-router/specs/**
  - dsh-custom-router/docs/**
  - ~/.dsh/** and any sibling track outside dsh-custom-router/

READING_LIST:
  - dsh-custom-router/docs/ARCHITECTURE-LAYERED.md (§2, §3, §5)
  - dsh-custom-router/docs/ROADMAP.md (§4 P2-A W1-1 / A2)
  - dsh-custom-router/lib/stream/index.js
  - dsh-custom-router/vendor/deepinfra/lib/map.js
  - dsh-custom-router/vendor/deepinfra/lib/stream-contract.js
  - dsh-custom-router/vendor/deepinfra/lib/wire.js
  - dsh-custom-router/vendor/exaone/lib/map.js
  - dsh-custom-router/vendor/exaone/lib/stream-contract.js
  - dsh-custom-router/vendor/exaone/lib/wire.js

STEPS:
  1. Measure comment-stripped equality across vendor/{deepinfra,exaone}/lib/{map.js,stream-contract.js,wire.js}
     (measured baseline: map.js 130 L zero non-comment diff; readEvent 41 L differing by 2 vendor-name
     lines; 6 of 8 wire.js functions byte-identical, 2 differing by vendor label + EXAONE options).
  2. Create lib/stream/openai.js exporting:
     - OPENAI_DESCRIPTOR ({ toolCallShape: 'fragmented', usage: { totalFormula: 'prompt+output' }, malformedRecord: 'fail' })
     - readOpenAiEvent(payload, options?) with parameterized error label (no hardcoded vendor name!)
     - OPENAI_HOOKS / createOpenAiHooks({ label?, reasoningFields?, usageFrom? })
     - mapDelta(delta, context?) and shared request-projection helpers (serializeMessages, serializeTools,
       textOf, userContent, toolCallsOf, nonEmpty, positiveInteger, buildOpenAiRequestBody).
  3. Re-export ./stream/openai in package.json exports + add lib/stream/openai.js to package.json scripts.check;
     re-export stable symbols from lib/stream/index.js as appropriate.
  4. Verify zero vendor names, zero vendor/ imports, zero ctx/fetch/fs access in lib/stream/openai.js.
  5. Add test/stream-openai.test.mjs proving zero comment-stripped divergence from the extracted functions
     plus parameterized label behavior.

ACCEPTANCE_GATES (run inside dsh-custom-router/):
  - npm run check                             -> exit 0
  - npm test                                  -> >= 649 pass, 0 fail (incl. conformance/openai-completions)
  - npm run verify:stream                     -> 8/8 dispatch cases, vendor loads: 0
  - npm run verify:presets                    -> OK
  - npm run verify:presets:mutation           -> 17/17
  - npm run specs:check                       -> 5 protocols, 4 providers, 4 pricing — OK
  - (cd vendor/antigravity && npm test)       -> 193/193
  - (cd vendor/deepinfra && npm test)         -> 222 pass / 7 skip
  - (cd vendor/opencode && npm test)          -> 555/555
  - (cd vendor/exaone && npm test)            -> 19/19

COMMIT_TEMPLATE:
  git add dsh-custom-router/lib/stream/openai.js dsh-custom-router/lib/stream/index.js dsh-custom-router/package.json dsh-custom-router/test/
  git commit -m "feat(custom-router): extract core OpenAI stream profile (Phase 1 W1-1 / A2-core)"

CONSTRAINTS:
  - No service restart, no version bump (stay at 0.0.1-rc.20), no ~/.dsh writes, no API key values printed.
  - Approvals are disabled: do not request sandbox escalation.
  - Any live probe (not needed here) must use an isolated DSH_HOME via scripts/iso-home.mjs.
```

---

### W1-2 — A1-core: Consolidate One Anthropic Wire + Unify `totalFormula`

```text
WORKER_ID: W1-2
TASK: A1-core — Fold Anthropic SSE/usage/abort into core L0/L1, wire createAnthropicHooks onto createHooks, unify totalFormula
MODE: SERIAL (Phase 1, Step 1.2 — starts ONLY after W1-1 passes; do NOT run concurrently)
REPO: /home/minami/Workspace/projects/dsh-workspace/dsh-plugins
PACKAGE_DIR: dsh-custom-router (@nolit/dsh-custom-router@0.0.1-rc.21)

ALLOWED_WRITE_SCOPE:
  - dsh-custom-router/lib/stream/anthropic.js
  - dsh-custom-router/lib/stream/sse.js
  - dsh-custom-router/lib/stream/usage.js
  - dsh-custom-router/lib/stream/failure.js
  - dsh-custom-router/lib/stream/index.js
  - dsh-custom-router/lib/driver/contract.js
  - dsh-custom-router/test/stream-sse.test.mjs
  - dsh-custom-router/test/stream-usage.test.mjs
  - dsh-custom-router/test/stream-pipe.test.mjs
  - dsh-custom-router/test/stream-finish.test.mjs
  - dsh-custom-router/test/anthropic-protocol.test.mjs
  - dsh-custom-router/test/driver-contract.test.mjs
  - dsh-custom-router/test/conformance/anthropic-messages.test.mjs

FORBIDDEN_PATHS:
  - dsh-custom-router/scripts/verify-stream.mjs (reserved strictly for Phase 2 W2-D)
  - dsh-custom-router/vendor/**
  - dsh-custom-router/specs/**
  - dsh-custom-router/docs/**
  - ~/.dsh/** and any sibling track

READING_LIST:
  - dsh-custom-router/docs/ARCHITECTURE-LAYERED.md (§2, §3, §5)
  - dsh-custom-router/docs/ROADMAP.md (§4 P2-A W1-2 / A1)
  - dsh-custom-router/lib/stream/anthropic.js
  - dsh-custom-router/lib/stream/sse.js
  - dsh-custom-router/lib/stream/usage.js
  - dsh-custom-router/lib/stream/failure.js
  - dsh-custom-router/lib/stream/index.js
  - dsh-custom-router/lib/driver/contract.js

STEPS:
  1. Make lib/stream/sse.js eventName-aware (optional event: -> type fallback when payload.type is
     absent, ignoring blank data: keep-alives) and remove readAnthropicSse/decodeRecord/chunksOf (85 L)
     from lib/stream/anthropic.js (keep a thin re-export only if external callers require readAnthropicSse).
  2. Add 'input+output+cache' to TOTAL_FORMULAS in lib/stream/usage.js and fold usageFromAnthropic (22 L)
     onto usageFromProjection; keep no duplicate writer in anthropic.js.
  3. Export one abortError() helper from lib/stream/failure.js and remove the duplicates in index.js (5 L),
     sse.js (4 L), and anthropic.js (3 L) — one factory, one message.
  4. Adapt createAnthropicHooks so it rides normalizeStream({ createHooks }) cleanly per stream (each
     stream owns private usage + per-index thinking signatures).
  5. Align lib/driver/contract.js:14 TOTAL_FORMULAS with lib/stream/usage.js so defineProviderDriver
     accepts both Anthropic ('input+output+cache') and Antigravity ('prompt+output+reasoning') descriptors,
     removing the unimplemented 'gemini' string mismatch.
  6. Assert line count of lib/stream/anthropic.js <= 434 L (down >= 180 L from 614 L) with zero
     behaviour changes on stream parts, usage buckets, finish reasons, and failure codes.

ACCEPTANCE_GATES (run inside dsh-custom-router/):
  - wc -l lib/stream/anthropic.js             -> <= 434 lines (from 614)
  - npm run check                             -> exit 0
  - npm test                                  -> >= 649 pass, 0 fail (anthropic-messages conformance green)
  - npm run verify:stream                     -> 8/8 dispatch cases, vendor loads: 0
  - npm run verify:presets                    -> OK
  - npm run verify:presets:mutation           -> 17/17
  - npm run specs:check                       -> 5 protocols, 4 providers, 4 pricing — OK
  - (cd vendor/antigravity && npm test)       -> 193/193
  - (cd vendor/deepinfra && npm test)         -> 222 pass / 7 skip
  - (cd vendor/opencode && npm test)          -> 555/555
  - (cd vendor/exaone && npm test)            -> 19/19

COMMIT_TEMPLATE:
  git add dsh-custom-router/lib/stream/ dsh-custom-router/lib/driver/contract.js dsh-custom-router/test/
  git commit -m "refactor(custom-router): unify Anthropic stream pipe and totalFormula (Phase 1 W1-2 / A1-core)"

CONSTRAINTS:
  - No service restart, no version bump (stay at 0.0.1-rc.20), no ~/.dsh writes, no secrets printed.
  - Do NOT edit scripts/verify-stream.mjs (owned by W2-D).
  - Approvals disabled; isolated DSH_HOME if running any probe.
```

---

### W1-3 — A4-core: Lock One Cost / Plan / Usage Accounting Core

```text
WORKER_ID: W1-3
TASK: A4-core — Lock canonical cost/plan/usage/ledger interface in lib/{cost,plan,usage}.js
MODE: SERIAL (Phase 1, Step 1.3 — starts ONLY after W1-2 passes; do NOT run concurrently)
REPO: /home/minami/Workspace/projects/dsh-workspace/dsh-plugins
PACKAGE_DIR: dsh-custom-router (@nolit/dsh-custom-router@0.0.1-rc.21)

ALLOWED_WRITE_SCOPE:
  - dsh-custom-router/lib/cost.js
  - dsh-custom-router/lib/plan.js
  - dsh-custom-router/lib/usage.js
  - dsh-custom-router/package.json (exports + check script only; do NOT change version)
  - dsh-custom-router/test/cost.test.mjs
  - dsh-custom-router/test/plan.test.mjs
  - dsh-custom-router/test/usage.test.mjs

FORBIDDEN_PATHS:
  - dsh-custom-router/lib/stream/**
  - dsh-custom-router/vendor/** (vendor ledger deletions happen in Phase 2 W2-A / W2-B / W2-E)
  - dsh-custom-router/scripts/**
  - dsh-custom-router/specs/**
  - dsh-custom-router/docs/**
  - ~/.dsh/** and any sibling track

READING_LIST:
  - dsh-custom-router/docs/ROADMAP.md (§4 P2-A W1-3 / A4)
  - dsh-custom-router/lib/cost.js
  - dsh-custom-router/lib/plan.js
  - dsh-custom-router/lib/usage.js
  - dsh-custom-router/vendor/deepinfra/lib/cost.js
  - dsh-custom-router/vendor/opencode/lib/cost.js
  - dsh-custom-router/vendor/opencode/lib/plans.js
  - dsh-custom-router/vendor/opencode/lib/usage-ledger.js

STEPS:
  1. Compare vendor/deepinfra/lib/cost.js (391 L) and vendor/opencode/lib/cost.js (381 L) against
     lib/cost.js (85 L), lib/plan.js (254 L), and lib/usage.js (192 L).
  2. Fold canonical ledger & store primitives (numberOrNull, pickSession, createCostStore supporting
     explicit path / profileDir / dshHome resolution, createCostLedger, parseCost, formatCost) into
     lib/cost.js (or a dedicated core submodule exported by lib/cost.js) without breaking existing
     lib/cost.js exports (normalizeUsage, ratesFor, calculateCost).
  3. Ensure lib/usage.js accepts normalized TokenUsage + optional agy-style envelope projections cleanly.
  4. Keep all pure arithmetic vendor-agnostic (zero hardcoded vendor names; caller supplies fileName/label).
  5. Add unit tests covering store resolution, ledger persistence, parseCost, numberOrNull, pickSession.

ACCEPTANCE_GATES (run inside dsh-custom-router/):
  - npm run check                             -> exit 0
  - npm test                                  -> >= 649 pass, 0 fail
  - npm run verify:stream                     -> 8/8, vendor loads: 0
  - npm run verify:presets                    -> OK
  - npm run verify:presets:mutation           -> 17/17
  - npm run specs:check                       -> 5 protocols, 4 providers, 4 pricing — OK
  - (cd vendor/antigravity && npm test)       -> 193/193
  - (cd vendor/deepinfra && npm test)         -> 222 pass / 7 skip
  - (cd vendor/opencode && npm test)          -> 555/555
  - (cd vendor/exaone && npm test)            -> 19/19

COMMIT_TEMPLATE:
  git add dsh-custom-router/lib/cost.js dsh-custom-router/lib/plan.js dsh-custom-router/lib/usage.js dsh-custom-router/package.json dsh-custom-router/test/
  git commit -m "feat(custom-router): unify core cost, plan and ledger interface (Phase 1 W1-3 / A4-core)"

CONSTRAINTS:
  - No service restart, no version bump, no ~/.dsh writes, no secrets printed, approvals disabled.
```

---

### W1-4 — A5-core: Add Shared Retry/Backoff + Generic Catalog Cache (Final Core Lock)

```text
WORKER_ID: W1-4
TASK: A5-core — Implement lib/retry.js and lib/catalog-cache.js and sign off CORE INTERFACE LOCKED
MODE: SERIAL (Phase 1, Step 1.4 — starts ONLY after W1-3 passes; must pass before ANY Phase 2 worker launches)
REPO: /home/minami/Workspace/projects/dsh-workspace/dsh-plugins
PACKAGE_DIR: dsh-custom-router (@nolit/dsh-custom-router@0.0.1-rc.21)

ALLOWED_WRITE_SCOPE:
  - dsh-custom-router/lib/retry.js (new)
  - dsh-custom-router/lib/catalog-cache.js (new)
  - dsh-custom-router/package.json (exports + check script only; do NOT change version)
  - dsh-custom-router/test/retry.test.mjs (new)
  - dsh-custom-router/test/catalog-cache.test.mjs (new)

FORBIDDEN_PATHS:
  - dsh-custom-router/lib/stream/**
  - dsh-custom-router/vendor/** (vendor adoption waits for Phase 2)
  - dsh-custom-router/scripts/**
  - dsh-custom-router/specs/**
  - dsh-custom-router/docs/**
  - ~/.dsh/** and any sibling track

READING_LIST:
  - dsh-custom-router/docs/RETRY-POLICY.md (normative T1–T5, P1–P5, §3 backoff formula, §7 R1–R10)
  - dsh-custom-router/docs/ARCHITECTURE-LAYERED.md (§5 Core Interface Locked)
  - dsh-custom-router/vendor/antigravity/lib/adapter.js (lines 40-63, 225-273)
  - dsh-custom-router/vendor/antigravity/lib/index.js (lines 200-291)
  - dsh-custom-router/vendor/deepinfra/lib/index.js (lines 209-237)
  - dsh-custom-router/vendor/opencode/lib/catalog-cache.js

STEPS:
  1. Implement lib/retry.js strictly matching RETRY-POLICY.md:
     - TRANSIENT_STREAM_CODES + isTransientStreamError(error)
     - classifyRetryDecision({ error, status, body, signal }) implementing §2.3 decision order
       (502/503/504 + T1/T2/T4 retryable; 401/403/400/404/422/402/429-quota/500/451/abort terminal)
     - backoffDelay(baseMs, attempt, { maxMs = 2000, jitter = true, rng }) and sleepFor(ms, signal)
     - boundedRetry(fn, opts) with per-turn budget (default maxAttempts=3, baseMs=500, cap=2000, 0-25% jitter),
       no model fallback, no circuit breaker, optional onAuth401 single-refresh hook.
  2. Implement lib/catalog-cache.js: generic TTL cache with stale-on-error fallback and explicit
     refresh=true (?refresh=1) bypass, zero vendor names.
  3. Export ./retry and ./catalog-cache in package.json and add both to package.json scripts.check.
  4. Write unit tests covering RETRY-POLICY.md gates R1–R9 and catalog-cache TTL/refresh/fallback semantics.
  5. Confirm ALL core interfaces are locked and full baseline gates pass.

ACCEPTANCE_GATES (run inside dsh-custom-router/ — CORE LOCK SIGN-OFF):
  - npm run verify                            -> exit 0 (check + >= 649 tests + verify:stream 8/8 + specs:check)
  - npm run verify:presets                    -> OK
  - npm run verify:presets:mutation           -> 17/17
  - npm run verify:dispatch                   -> 17/17
  - (cd vendor/antigravity && npm test)       -> 193/193
  - (cd vendor/deepinfra && npm test)         -> 222 pass / 7 skip
  - (cd vendor/opencode && npm test)          -> 555/555
  - (cd vendor/exaone && npm test)            -> 19/19

COMMIT_TEMPLATE:
  git add dsh-custom-router/lib/retry.js dsh-custom-router/lib/catalog-cache.js dsh-custom-router/package.json dsh-custom-router/test/
  git commit -m "feat(custom-router): lock core retry and catalog-cache primitives (Phase 1 W1-4 / A5-core)"

CONSTRAINTS:
  - No service restart, no version bump, no ~/.dsh writes, no secrets printed, approvals disabled.
```

---

## 3. Phase 2 Dispatch Blocks (PARALLEL — Launch Together After Phase 1 Core Lock)

> **Launch rule:** Verify `W1-4` is committed and all Phase 1 lock gates are green before launching
> `W2-A`, `W2-B`, `W2-C`, `W2-D` (and optional `W2-E`) in parallel. Each worker touches **only** its
> listed write scope; none edits `package.json`, `lib/stream/**`, or another worker's vendor folder.

### W2-A — A3: OpenCode onto Shared Pipe + Ledger/Retry/Cache Rewiring — ✅ **SHIPPED** (`e8b39f7`)

> **This block is the record of what shipped — do not execute it again.** The A3 half is DONE
> (see the note at the top of this file). The **ledger / retry / cache rewiring** steps 4–5 below
> are **NOT** done — they are now tracked as **R2** and **R3** in
> [ROADMAP.md](./ROADMAP.md) §6, with their own gates.

```text
WORKER_ID: W2-A
TASK: A3 — Flip OpenCode default to shared pipe, delete legacy loop/SSE/mapping/tool-assembly, rewire cost/retry/cache onto locked core
MODE: PARALLEL (Phase 2 — launch simultaneously with W2-B, W2-C, W2-D after Phase 1 Core Lock)
REPO: /home/minami/Workspace/projects/dsh-workspace/dsh-plugins
PACKAGE_DIR: dsh-custom-router (@nolit/dsh-custom-router@0.0.1-rc.21)

ALLOWED_WRITE_SCOPE:
  - dsh-custom-router/vendor/opencode/lib/**
  - dsh-custom-router/vendor/opencode/test/**

FORBIDDEN_PATHS:
  - dsh-custom-router/lib/**
  - dsh-custom-router/scripts/** (incl. scripts/verify-stream.mjs — owned by W2-D)
  - dsh-custom-router/specs/**
  - dsh-custom-router/package.json
  - dsh-custom-router/docs/**
  - dsh-custom-router/vendor/{antigravity,deepinfra,exaone}/**
  - ~/.dsh/** and any sibling track

READING_LIST:
  - dsh-custom-router/docs/ARCHITECTURE-LAYERED.md (§2, §4 violation example, §5)
  - dsh-custom-router/docs/ROADMAP.md (§4 P2-A A3/A4/A5, P2-2/P2-3)
  - dsh-custom-router/lib/stream/index.js
  - dsh-custom-router/lib/cost.js, lib/plan.js, lib/usage.js, lib/retry.js, lib/catalog-cache.js
  - dsh-custom-router/vendor/opencode/lib/http.js
  - dsh-custom-router/vendor/opencode/lib/openai-mapping.js
  - dsh-custom-router/vendor/opencode/lib/stream-contract.js
  - dsh-custom-router/vendor/opencode/lib/notation-classifier.js   # was stream-parser.js (renamed)

STEPS:
  1. In vendor/opencode/lib/http.js:
     - Flip pipe default from 'legacy' to 'shared' (line 302) and remove the hardcoded parser: 'legacy'
       literal (line 2284; read configured/default parser cleanly).
     - Delete legacy loop (2091-2245), private SSE reader chatSseEvents (440-499), and 335-line
       tool-call assembly (1590-1924), routing through normalizeStream + createHooks + shared part assembler.
  2. Delete openai-mapping.js:14-92 (usageFromOpenAi + finishFromOpenAi) or reduce to thin core
     delegations if vendor-internal tests import exported symbol names; prefer core usageFrom/finishReasonFor.
  3. Decide & record placement of stream-parser.js (679 L) inside vendor/opencode/lib/stream-contract.js
     header comments (it rides L2's classifyText/flush hooks as an OpenCode text-tool quirk, since L1
     has no parser slot).
  4. Replace OpenCode's 3 retry loops (and local backoffDelay at http.js:530), private cost ledger
     (vendor/opencode/lib/cost.js 381 L + plans.js/usage-ledger.js/cost-pill.js 506 L duplicates),
     and catalog-cache.js (362 L) with imports from locked core lib/{retry,cost,plan,usage,catalog-cache}.js.
  5. Add a parity fixture test under vendor/opencode/test/ proving recorded OpenCode responses yield
     identical StreamChunks, usage buckets, finish reason, and failure code through the shared path.

ACCEPTANCE_GATES:
  - (cd dsh-custom-router/vendor/opencode && npm test) -> 553/553 pass
  - (cd dsh-custom-router && npm run verify)           -> exit 0 (router >= 802, verify:stream 8/8, specs:check OK)
  - grep -rn "parser: 'legacy'" dsh-custom-router/vendor/opencode/ -> 0 matches
  - grep -rn "default('legacy')" dsh-custom-router/vendor/opencode/ -> 0 matches
  - Live probe (owner or isolated DSH_HOME post-merge): 1 OpenCode route turn through shared pipe
                                        # MET: owner-verified after the 2026-11-14 09:37:14 KST restart (PID 361248)

MEASURED_OUTCOME:
  - Steps 1-3: DONE (e8b39f7). http.js 3272 -> 2721 L (-630/+79); the pipe config key is deleted,
    so NO config selects a pipeline any more; stream-parser.js was measured to be shared-path
    glue and was RENAMED notation-classifier.js (679 L, one named export, one consumer).
    Parity coverage: the two legacy<->shared parity tests were replaced by golden sequences
    captured from the shared path BEFORE the deletion; opencode 555 -> 553 (2 legacy-only tests removed).
  - Steps 4-5: NOT DONE -> R2 (ledger) and R3 (retry loops + catalog caches).

COMMIT_TEMPLATE:
  git add dsh-custom-router/vendor/opencode/
  git commit -m "refactor(opencode): migrate to shared stream pipe, retry, cache and core accounting (Phase 2 W2-A / A3)"

CONSTRAINTS:
  - No service restart, no version bump, no ~/.dsh writes, no secrets printed, approvals disabled.
  - Any live probe MUST use an isolated DSH_HOME (scripts/iso-home.mjs), never ~/.dsh.
```

---

### W2-B — DeepInfra Dedup: Remove Duplicate OpenAI Wire, Ledger & Cache

```text
WORKER_ID: W2-B
TASK: DeepInfra dedup — Remove vendor-local OpenAI map/wire/readEvent, private cost ledger, and TTL cache
MODE: PARALLEL (Phase 2 — launch simultaneously with W2-A, W2-C, W2-D after Phase 1 Core Lock)
REPO: /home/minami/Workspace/projects/dsh-workspace/dsh-plugins
PACKAGE_DIR: dsh-custom-router (@nolit/dsh-custom-router@0.0.1-rc.21)

ALLOWED_WRITE_SCOPE:
  - dsh-custom-router/vendor/deepinfra/lib/**
  - dsh-custom-router/vendor/deepinfra/test/**

FORBIDDEN_PATHS:
  - dsh-custom-router/lib/**
  - dsh-custom-router/scripts/** (incl. scripts/verify-stream.mjs — owned by W2-D)
  - dsh-custom-router/specs/**
  - dsh-custom-router/package.json
  - dsh-custom-router/docs/**
  - dsh-custom-router/vendor/{antigravity,opencode,exaone}/**
  - ~/.dsh/** and any sibling track

READING_LIST:
  - dsh-custom-router/docs/ARCHITECTURE-LAYERED.md (§3, §4, §5)
  - dsh-custom-router/lib/stream/openai.js (locked in W1-1)
  - dsh-custom-router/lib/cost.js, lib/catalog-cache.js (locked in W1-3 / W1-4)
  - dsh-custom-router/vendor/deepinfra/lib/{map,stream-contract,wire,adapter,anthropic-adapter,cost,index}.js

STEPS:
  1. Delete/replace vendor/deepinfra/lib/map.js (130 L) and duplicated readEvent/request-projection
     functions in stream-contract.js (41 L) & wire.js (8 named functions, 172 L) with imports from
     ../../../lib/stream/openai.js (keep DeepInfra-only constants, discount/pricing facts, and
     anthropic-adapter.js / stream-anthropic.js).
  2. Replace vendor/deepinfra/lib/cost.js duplicate ledger helpers (numberOrNull, pickSession,
     createCostStore, createCostLedger) with imports from ../../../lib/cost.js.
  3. Replace vendor/deepinfra/lib/index.js:209-237 in-memory TTL catalog cache with ../../../lib/catalog-cache.js.
  4. Update vendor/deepinfra/test/* imports if needed while preserving all published vendor/deepinfra
     exports tested by router/vendor suites (re-export from core only if required by existing public API).

ACCEPTANCE_GATES:
  - (cd dsh-custom-router/vendor/deepinfra && npm test) -> 222 pass / 7 skip (229 total)
  - (cd dsh-custom-router && npm run verify)            -> exit 0 (router >= 649, verify:stream 8/8)
  - grep -rn "function mapDelta" dsh-custom-router/vendor/deepinfra/ -> 0 matches
  - grep -rn "function numberOrNull\|function pickSession\|function createCostStore" dsh-custom-router/vendor/deepinfra/ -> 0 matches

COMMIT_TEMPLATE:
  git add dsh-custom-router/vendor/deepinfra/
  git commit -m "refactor(deepinfra): deduplicate OpenAI wire, cost ledger and catalog cache onto core (Phase 2 W2-B)"

CONSTRAINTS:
  - No service restart, no version bump, no ~/.dsh writes, no secrets printed, approvals disabled.
```

---

### W2-C — EXAONE Dedup + Dead Exports Removal

```text
WORKER_ID: W2-C
TASK: EXAONE dedup — Remove vendor-local OpenAI map/wire/readEvent and dead map.js:96-130 exports
MODE: PARALLEL (Phase 2 — launch simultaneously with W2-A, W2-B, W2-D after Phase 1 Core Lock)
REPO: /home/minami/Workspace/projects/dsh-workspace/dsh-plugins
PACKAGE_DIR: dsh-custom-router (@nolit/dsh-custom-router@0.0.1-rc.21)

ALLOWED_WRITE_SCOPE:
  - dsh-custom-router/vendor/exaone/lib/**
  - dsh-custom-router/vendor/exaone/test/**

FORBIDDEN_PATHS:
  - dsh-custom-router/lib/**
  - dsh-custom-router/scripts/** (incl. scripts/verify-stream.mjs — owned by W2-D)
  - dsh-custom-router/specs/**
  - dsh-custom-router/package.json
  - dsh-custom-router/docs/**
  - dsh-custom-router/vendor/{antigravity,opencode,deepinfra}/**
  - ~/.dsh/** and any sibling track

READING_LIST:
  - dsh-custom-router/docs/ARCHITECTURE-LAYERED.md (§3, §4, §5)
  - dsh-custom-router/lib/stream/openai.js (locked in W1-1)
  - dsh-custom-router/vendor/exaone/lib/{map,stream-contract,wire,adapter,catalog,index}.js

STEPS:
  1. Delete vendor/exaone/lib/map.js (130 L total, incl. dead finishReason + isFinishEvent at lines
     96-130 with 0 external consumers) and import mapDelta/readOpenAiEvent from ../../../lib/stream/openai.js.
  2. Replace EXAONE's duplicated readEvent (41 L) in vendor/exaone/lib/stream-contract.js with core
     readOpenAiEvent({ label: 'EXAONE' }); keep EXAONE's usageFrom projection (top-level usage.reasoning_tokens).
  3. Replace the 8 duplicated OpenAI request-projection helpers in vendor/exaone/lib/wire.js (167 L)
     with ../../../lib/stream/openai.js imports, keeping ONLY EXAONE quirks: EXAONE_EFFORT fold,
     chat_template_kwargs.preserve_thinking, MAX_STOP_SEQUENCES = 16, static single-model catalog.

ACCEPTANCE_GATES:
  - (cd dsh-custom-router/vendor/exaone && npm test) -> 19/19 pass
  - (cd dsh-custom-router && npm run verify)         -> exit 0 (router >= 649, verify:stream 8/8)
  - grep -rn "finishReason\|isFinishEvent\|function mapDelta" dsh-custom-router/vendor/exaone/ -> 0 matches

COMMIT_TEMPLATE:
  git add dsh-custom-router/vendor/exaone/
  git commit -m "refactor(exaone): deduplicate OpenAI wire and drop dead map exports (Phase 2 W2-C)"

CONSTRAINTS:
  - No service restart, no version bump, no ~/.dsh writes, no secrets printed, approvals disabled.
```

---

### W2-D — A6: Dead Surface Removal + Spec/Preset/Boundary Gates (Sole `verify-stream.mjs` Owner) — ✅ **SHIPPED** (`8ee4ef1` + `e8b39f7`)

> **This block is the record of what shipped — do not execute it again.** **R6** (the repo-wide
> uniqueness greps as a wired gate) is now **CLOSED** (rc.21) — see
> [ROADMAP.md](./ROADMAP.md) §6.

```text
WORKER_ID: W2-D
TASK: A6 — Remove unused classifyBlock hook, guard dsh-exaone in verify-stream.mjs, add spec<->preset mirror, dead-field allowlist, and L1 boundary lint
MODE: PARALLEL (Phase 2 — launch simultaneously with W2-A, W2-B, W2-C after Phase 1 Core Lock)
REPO: /home/minami/Workspace/projects/dsh-workspace/dsh-plugins
PACKAGE_DIR: dsh-custom-router (@nolit/dsh-custom-router@0.0.1-rc.21)

ALLOWED_WRITE_SCOPE:
  - dsh-custom-router/scripts/verify-stream.mjs (SOLE OWNER in Phase 2)
  - dsh-custom-router/scripts/verify-specs.mjs
  - dsh-custom-router/scripts/verify-presets-mutation.mjs
  - dsh-custom-router/lib/driver/contract.js (line 20: remove unused classifyBlock only)
  - dsh-custom-router/lib/preset-drift.js
  - dsh-custom-router/specs/** (only if a lying spec field is surfaced and needs fixing)
  - dsh-custom-router/test/specs.test.mjs
  - dsh-custom-router/test/preset-drift.test.mjs
  - dsh-custom-router/test/driver-contract.test.mjs
  - dsh-custom-router/test/stream-boundary.test.mjs (new)

FORBIDDEN_PATHS:
  - dsh-custom-router/lib/stream/** (read-only! lint only)
  - dsh-custom-router/lib/{cost,plan,usage,retry,catalog-cache,client,client.src,presets,preset-schema}.js
  - dsh-custom-router/vendor/** (NEVER write vendor files)
  - dsh-custom-router/package.json
  - dsh-custom-router/docs/**
  - ~/.dsh/** and any sibling track

READING_LIST:
  - dsh-custom-router/docs/ARCHITECTURE-LAYERED.md (§6 Forbidden-rule enforcement)
  - dsh-custom-router/docs/ROADMAP.md (§4.1, §4 P2-A A6)
  - dsh-custom-router/scripts/verify-stream.mjs
  - dsh-custom-router/scripts/verify-specs.mjs
  - dsh-custom-router/scripts/verify-presets-mutation.mjs
  - dsh-custom-router/lib/driver/contract.js
  - dsh-custom-router/lib/preset-drift.js
  - dsh-custom-router/lib/client.src.js (around line 772 USAGE_READERS)

STEPS:
  1. Remove unused 'classifyBlock' from OPTIONAL_HOOKS in lib/driver/contract.js:20 and update tests.
  2. In scripts/verify-stream.mjs:23, add 'dsh-exaone' to ENTRIES (4/4 vendors guarded) and reject
     relative ../vendor/ resolution from lib/stream/*. Keep 8/8 dispatch cases and vendor loads: 0.
  3. In scripts/verify-specs.mjs: add spec <-> preset mirror verification so wrong endpoint,
     protocol, or model id in specs/providers/<id>.json fails with exit 1; cross-check
     specs/pricing/*.kind against preset.usage.billing.mode; cross-check usage.routes[].normalize
     against USAGE_READERS in lib/client.src.js:772.
  4. In scripts/verify-presets-mutation.mjs & test/specs.test.mjs: add committed mutation cases proving
     lying spec content fails exit 1, and add a dead-field allowlist covering every measured dead
     declaration field in ROADMAP.md §4.1 with mutation tests.
  5. Add test/stream-boundary.test.mjs enforcing L1 forbidden rules (zero ../vendor/ imports, zero
     vendor names, zero ctx/process.env/node:fs/fetch in lib/stream/*) plus repo-wide uniqueness checks
     (run as non-blocking or gated post-W2-A/B/C/E integration check).

ACCEPTANCE_GATES (run inside dsh-custom-router/):
  - npm run verify:stream                     -> 8/8, vendor loads: 0, 4/4 vendors guarded incl. dsh-exaone
  - npm run specs:check                       -> 5 protocols, 4 providers, 4 pricing — OK
  - npm run verify:presets                    -> OK
  - npm run verify:presets:mutation           -> >= 17/17 (17 baseline + new spec-mirror & dead-field mutations)
  - npm run verify                            -> exit 0 (router >= 649 + new boundary/spec tests)

MEASURED_OUTCOME:
  - SHIPPED in two commits: 8ee4ef1 (the 4-vendor guard, the spec<->preset mirror, the dead-field
    allowlist, the EXAONE dead exports, the mutation harness 17 -> 26/26) and e8b39f7 (the L1
    boundary lint + the USAGE_READERS gate + the classifyBlock slot removal).
  - test/stream-boundary.test.mjs -> 15 cases, live; scripts/verify-usage-readers.mjs +
    test/usage-readers.test.mjs -> 12 cases, live (4 presets / 4 routes / 3 readers).
  - Both gates carry NEGATIVE PROOFS: a planted forbidden import failed 3 boundary rules; a renamed
    usage route exits 1. Both plants were reverted with a sha256 verification.
  - R6 IS NOW CLOSED (rc.21): the repo-wide uniqueness greps (mapDelta / numberOrNull /
    pickSession / createCostStore / backoffDelay) are a WIRED gate — test/uniqueness.test.mjs
    (23 cases) + scripts/verify-uniqueness.mjs (--json, exit 0/1/2), with a negative proof
    (a dual plant produced 8 findings and reverted to a 0-finding baseline).

COMMIT_TEMPLATE:
  git add dsh-custom-router/scripts/ dsh-custom-router/lib/driver/contract.js dsh-custom-router/lib/preset-drift.js dsh-custom-router/test/
  git commit -m "test(custom-router): guard dsh-exaone, mirror specs to presets and lint L1 boundary (Phase 2 W2-D / A6)"

CONSTRAINTS:
  - No service restart, no version bump, no ~/.dsh writes, no secrets printed, approvals disabled.
  - Keep dead-field allowlist / boundary lint free of false positives on comments or test fixtures.
```

---

### W2-E — Antigravity A4/A5 Rewiring (Disjoint 5th Scope)

```text
WORKER_ID: W2-E
TASK: Antigravity A4/A5 rewiring — Replace 70 L retry loop, 92 L catalog cache, and 28 L agy usage double-map with locked core
MODE: PARALLEL (Phase 2 — completely disjoint vendor/antigravity/** scope; run alongside W2-A..D or as Wave 2b before final grep gates)
REPO: /home/minami/Workspace/projects/dsh-workspace/dsh-plugins
PACKAGE_DIR: dsh-custom-router (@nolit/dsh-custom-router@0.0.1-rc.21)

ALLOWED_WRITE_SCOPE:
  - dsh-custom-router/vendor/antigravity/lib/**
  - dsh-custom-router/vendor/antigravity/test/**

FORBIDDEN_PATHS:
  - dsh-custom-router/lib/**
  - dsh-custom-router/scripts/** (incl. scripts/verify-stream.mjs — owned by W2-D)
  - dsh-custom-router/specs/**
  - dsh-custom-router/package.json
  - dsh-custom-router/docs/**
  - dsh-custom-router/vendor/{deepinfra,exaone,opencode}/**
  - ~/.dsh/** and any sibling track

READING_LIST:
  - dsh-custom-router/docs/ARCHITECTURE-LAYERED.md (§4 good example, §5)
  - dsh-custom-router/lib/retry.js, lib/catalog-cache.js, lib/stream/usage.js (locked in Phase 1)
  - dsh-custom-router/vendor/antigravity/lib/{adapter.js,index.js,backends.js,subagent.js,stream-contract.js}

STEPS:
  1. Replace sleepFor/backoffDelay (lines 40-63) and the retry loop (lines 228-273) in
     vendor/antigravity/lib/adapter.js with core lib/retry.js (preserving the 401 single-flight
     tokens.invalidate() refresh hook and Antigravity error classification).
  2. Replace vendor/antigravity/lib/index.js:200-291 generic catalog TTL cache with core
     lib/catalog-cache.js (keep Antigravity's separate 1-minute live quota RPC cache upstairs).
  3. Fold the agy usage envelope double-mapping (backends.js:109-118, subagent.js:96-113) onto
     core usageFromProjection.
  4. Keep Gemini stream-contract.js, declaredArguments()/pruneArguments(), and CloudCode envelope intact.

ACCEPTANCE_GATES:
  - (cd dsh-custom-router/vendor/antigravity && npm test) -> 193/193 pass
  - (cd dsh-custom-router && npm run verify)            -> exit 0
  - grep -rn "function backoffDelay\|function sleepFor" dsh-custom-router/vendor/antigravity/ -> 0 matches

COMMIT_TEMPLATE:
  git add dsh-custom-router/vendor/antigravity/
  git commit -m "refactor(antigravity): adopt core retry, catalog cache and usage projection (Phase 2 W2-E)"

CONSTRAINTS:
  - No service restart, no version bump, no ~/.dsh writes, no secrets printed, approvals disabled.
```

---

## 4. Post-Phase-2 Integration Gate & Phase 3 Handoff

After all Phase 2 workers merge, run the full verification suite once from `dsh-custom-router/`:

```bash
npm run verify                    # check + >= 649 tests + verify:stream (8/8, 4/4 vendors) + specs:check
npm run verify:presets            # OK
npm run verify:presets:mutation   # >= 17/17
npm run verify:dispatch           # 17/17
(cd vendor/antigravity && npm test)   # 193/193
(cd vendor/deepinfra  && npm test)    # 222 pass / 7 skip
(cd vendor/opencode   && npm test)    # 555/555
(cd vendor/exaone     && npm test)    # 19/19
```

**Phase 3 (A7) is DONE as a MEASUREMENT (rc.21)** — see
[HOST-PROVIDERS-SEAM.md](./HOST-PROVIDERS-SEAM.md). The seam is `providers: z.dict(profile)` with
**4** wire protocols; it models **provider profiles only** — no daemon indirection, no
ledger/billing, no plan windows, no picker, no dispatch gates — so it **cannot replace this
router**, and none of this router's four preset provider ids is a pi-ai catalog route.
**Recommended owner decision: keep `llm-pi-ai` dormant.**

The P2-A queue is now **EMPTY**. The last two items were closed in **rc.22**: **R8** (the
OpenCode-backend 404 — resolved from the daemon's authoritative provider **DIRECTORY**, with the
single-item route as a fallback only) and **R9** (the build chain is idempotent — a full
`npm run build` produces **zero diff**). See [ROADMAP.md](./ROADMAP.md) §6.
