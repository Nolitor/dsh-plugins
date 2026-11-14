# Custom Router — Handoff

<!-- skeleton:
version: 10.0
kind: report
status: active
updated: 2026-11-14
summary: Forward handoff for @nolit/dsh-custom-router at 0.0.1-rc.22. Phase 1 (core lock) and Phase 2 (vendor fan-out) of the horizontal layered architecture are DONE and measured. A3 is COMPLETE, R4 is CLOSED (L1 boundary lint + USAGE_READERS gate, with negative proofs), R3 is CLOSED (one retry core, one catalog cache), R5 is CLOSED (no vendor ids in L1), R2 is CLOSED (OpenCode's ledger, plans and usage constants now ride the core), R6 is CLOSED (the uniqueness greps are a WIRED gate with a negative proof), and A7 is CLOSED as a measurement (the host dsh-llm-pi-ai providers seam cannot replace this router). NEW in rc.21: the structural tool-argument contract seam at the L1 emission point, and the sync-derive idempotency fix. NEW in rc.22: R8 is CLOSED (the OpenCode-backend 404 was a directory-vs-item-route misreading; endpoints now resolve from the daemon's authoritative provider DIRECTORY) and R9 is CLOSED (the build chain is idempotent — a full npm run build now produces zero diff). Active work is the FOUR-key rotation (owner), the EXAONE child turn from a NEW session (owner) and the P0-3 scan; closed items are in ROADMAP-ARCHIVE.md.
-->

> Active work: [ROADMAP.md](./ROADMAP.md). Closed/deprecated history:
> [ROADMAP-ARCHIVE.md](./ROADMAP-ARCHIVE.md). Detailed history: [CHANGELOG.md](../CHANGELOG.md).
> Rules: [docs/RULES.md](../../docs/RULES.md).

## 1. Current state (measured 2026-11-14, after Phase 1 + Phase 2 + the A3 completion)

| Item | Value |
| :--- | :--- |
| Package | `@nolit/dsh-custom-router@0.0.1-rc.22` (**bumped** — this session changed code and docs) |
| Vendored | antigravity `rc.14`, opencode `rc.8`, deepinfra `rc.14`, exaone `rc.1` (peer pins aligned to `rc.22`) |
| Host | DSH `0.2.2-rc.3` / Node `v24.22.1` |
| Tests | router **848/848** (was **843/843** at rc.21 — **+5** from the R9 build-idempotency gate: `test/build-presets.test.mjs` **3 → 8** cases); antigravity **193/193**; deepinfra **222 pass / 7 skip** (229 total); opencode **565/565** (was **554/554** at rc.21 — **+11** from the R8 directory gate); exaone **19/19** — **the three non-OpenCode vendor suites are unchanged** |
| Gates | `npm run verify` **exit 0** (check + 848 tests + `verify:stream` + `specs:check` — `5 protocols, 4 providers, 4 pricing`), `verify:presets` **OK** (declarations ↔ browser registry ↔ locales ↔ runtime registries agree), `verify:presets:mutation` **26/26** drift classes caught, **`verify:usage-readers` OK** (4 presets / 4 routes / 3 readers), **`node scripts/verify-uniqueness.mjs` clean, exit 0** |
| **Build idempotency** | ✅ **`npm run build` produces ZERO diff** — the full chain (`gen-locale` → `sync-derive` → `build-presets` → `build-client`) is a **fixed point**. `lib/client.src.js` (**185 403 B** / **3 460 L**) and `lib/client.js` (**205 839 B** / **3 908 L**) are **byte-identical to HEAD**. `node scripts/build-presets.mjs` run **3×** is byte-identical (md5 `e53f6153…`, each printing `unchanged`); `--check` **exits 1** on real `lib/presets.js` drift and **0** after the revert. **This is the R9 closure (rc.22).** |
| Vendor guard | `verify:stream` **8/8** dispatch cases · **4** vendored packages probed · **8/8** specifiers refused · **vendor loads 0** — the vendor set is *measured* from `vendor/*/package.json`, self-tested, control-probed and vacuity-guarded |
| Boundary gates | **`test/stream-boundary.test.mjs` (15 cases)** enforces the L1 boundary; **`scripts/verify-usage-readers.mjs` + `test/usage-readers.test.mjs` (12 cases)** gate the `usage.routes[].normalize` names with browser source↔bundle parity; the dead `classifyBlock` slot is **removed** from `lib/driver/contract.js`. Both carry **negative proofs** (a planted regression → failure → reverted with a hash check). **NEW in rc.21:** `test/uniqueness.test.mjs` (**23 cases**) + `scripts/verify-uniqueness.mjs` (the R6 uniqueness gate) and `test/tool-argument-contract.test.mjs` (**13 cases**) — the tool-argument contract gate. **NEW in rc.22:** `test/build-presets.test.mjs` (**8 cases**, the R9 build-idempotency gate) and `vendor/opencode/test/backend-directory.test.mjs` (**11 cases**, the R8 provider-directory gate) |
| Phase commits | Phase 1: `c0e48ab`, `3ac7a10`, `c2ba900`, `ae9fd1d` · Phase 2: `8ee4ef1` · A3 completion + R4 closure: `e8b39f7` · **R3 + R5 closure: `77a53b0`** · **R2 + R6 + A7 + the tool-argument contract seam + the sync-derive fix: the rc.21 commit** · **R8 + R9 closure + the build-idempotency residue cleanup: the rc.22 commit (this session)** |
| Live service | **`PID 361248`, started 09:37:14 KST** (`dsh` on `127.0.0.1:3080`) — **not restarted by this session** |
| Credentials | store `~/.dsh/.credentials.yaml` (mode **0600**) holds refs for **`DEEPSEEK_API_KEY`, `OPENCODE_API_KEY`, `DEEPINFRA_API_KEY`, `EXAONE_API_KEY`** — **names only; no value is ever reproduced in this document.** Live profile patch `apiKey:` count = **0**; it carries `credentialRef: DEEPINFRA_API_KEY` / `EXAONE_API_KEY` |
| Allowlist | **live 7 routes** incl. `exaone/k-exaone_v2.5`; repo default in `cordis.patch.yml` + `lib/allowlist.js` + `test/allowlist.test.mjs` |
| Model picker | the synthetic **`OpenCode (config default)`** row is **gone** from the `OpenCode Go (direct)` group |

### Live verification (2026-11-14, post-restart)

Two restarts are recorded on this track. The **current** one is the **09:37:14 KST** restart
(**PID 361248**) — the owner restarted after `e8b39f7` so the running service carries the
A3-completed OpenCode vendor. The probes below are measured against that PID.

| Probe | Result |
| :--- | :--- |
| **OpenCode shared pipe** (after the 09:37:14 KST restart, PID 361248) | **PASS** — the shared pipe served the turn, **no error** |
| **DeepInfra OpenAI core** (same restart) | **PASS** — **no error** |
| **Antigravity core** (same restart) | **PASS** — **no error** |
| DeepInfra **child**, `deepseek-ai/DeepSeek-V4.1-Flash-1017` (earlier restart, 06:10:57 KST) | **PASS** — `DEEPINFRA_PROBE_OK`, no error |
| Gemini **child**, `gemini-4-hydrogen` — two consecutive requests, the second a replay carrying `sandbox_permissions` (earlier restart) | **PASS** — `GEMINI_OK_3` / `GEMINI_OK_3B` / `TWO_REQUESTS_OK`, **no HTTP 400** |
| EXAONE **top-level** turn | **PASS** — confirmed by the owner |
| EXAONE **child** turn | **UNVERIFIED** — the probing Session froze its allowlist at `agent/created` (6 routes, no `exaone/k-exaone_v2.5`); it must be retried from a **NEW** session |
| Boot log (earlier restart) | **no credential warnings** (credential-warning match count = **0**) |

### What is actually shipped

- **One package / four vendored adapters**, preset registry derived, shared stream pipe (**there is
  now exactly ONE OpenCode pipeline — the `pipe` config key is deleted, so no config selects a
  pipeline any more; **A3 is complete**), living `specs/` + generated compatibility matrix.
- **The picker lists served routes only.** The synthetic `OpenCode (config default)` entry was
  prepended to the OpenCode provider group by two vendored adapters as if it were a served route;
  it is not a model id, so it was removed from the model-registration/catalog data. The `default`
  **pseudo-route** still resolves server-side (to `defaultModel`), and that behaviour is unchanged.
- **Living-spec gates are self-policing:** `specs:check` also ages the manual `spec:watch`
  baseline (14 days, warning by default) so a missed discovery cycle cannot pass silently, and
  `verify:refresh` fails when one of the four presets, its route, or an expected model row disappears.
- **The credential store path works live.** The `credentialRef` route is no longer a paper feature:
  a store-backed DeepInfra turn succeeded end to end after the restart.
- **One cost/usage/plan implementation (R2).** The OpenCode vendor's private ledger, its
  re-declared plan table and its re-declared usage constants now **delegate** to the core
  `lib/cost.js`, `lib/presets.js` and `lib/usage.js` instead of carrying their own bodies.
  Measured duplicate-definition counts: `numberOrNull` **2 → 1**, `pickSession` **2 → 1**,
  `USAGE_BUCKETS` **2 → 1**, `usageTotal` **2 → 1**. `createCostStore` / `createCostLedger` stay
  at **3** total = **1** core + **2** legitimate thin wrappers (DeepInfra + OpenCode) — the
  accepted precedent the R6 gate encodes.
- **The uniqueness greps are a WIRED gate (R6).** `test/uniqueness.test.mjs` (**23 cases**, it
  rides the existing `npm test` glob, so **no `package.json` change**) plus
  `scripts/verify-uniqueness.mjs` (a standalone runner with `--json` and exit **0 / 1 / 2**).
  The rule is **not** the naive "one definition repo-wide" (that would be false for
  `createCostStore`): (a) exactly **ONE** core implementation in `lib/**`; (b) a vendor
  definition is legal **only** if it imports the core symbol **and** calls it; (c) definitions
  outside `lib/` **and** `vendor/` are strays and fail; (d) the vendor set is **MEASURED** from
  `vendor/*/package.json`, never hand-listed.
- **The host provider seam is measured, not promised (A7).** See
  [HOST-PROVIDERS-SEAM.md](./HOST-PROVIDERS-SEAM.md). The host `dsh-llm-pi-ai` seam is
  `providers: z.dict(profile)` with 4 wire protocols; pi-ai's installed catalog already ships
  `opencode` (**85** models) and `opencode-go` (**32**), but **none** of the router's four preset
  provider ids (`antigravity`, `opencode-http-agent`, `deepinfra`, `exaone`) is a catalog route.
  The seam models **provider profiles only** — no daemon indirection, no ledger/billing, no plan
  windows, no picker, no dispatch gates — so **it cannot replace this router**. Recommended owner
  decision: keep `llm-pi-ai` **dormant** (it is dormant today; no `llm-pi-ai:` section exists in
  the live profile). This confirms the earlier removal of **P2-1** as an unreachable promise.
- **A structural tool-argument contract seam (new in rc.21).** `lib/stream/tool-argument-contract.js`
  (**163 L**) + `test/tool-argument-contract.test.mjs` (**13 cases**). A live Gemini/Antigravity
  subagent run died with `Error: invalid escalation: justification is only valid together with
  sandbox_permissions`. The root cause was **not** a Gemini quirk: the host
  (`@deepseek-ai/dsh-sandbox` `validateEscalationArgs`) enforces the escalation pairing on the
  **EXECUTION** path, a provider schema cannot express it, and every vendor hands calls to the
  **ONE** shared pipe — so a drifted call reached execution intact. The seam sits at the single
  **L1 emission point** (`finalBlock` in `lib/stream/index.js`), where the produced `block-end`
  block is authoritative for execution (the host `BlockAssembler` keeps `partial.block` and ignores
  the accumulated deltas once closed). All **five** vendor `normalizeStream` call sites now pass
  `tools: options.tools`. The rule is **DERIVED, not hardcoded**: it reads the host's own schema
  prose `Required with <field>` (measured identically on `dsh-tool-bash`, `dsh-tool-fs`,
  `dsh-tool-pwsh`), so a differently-named pair is covered with no edit. Repair direction: a
  dependent field present **without** its principal is **dropped** (a lone reason asks for
  nothing); a principal with a **blank** dependent keeps the escalation and drops the blank value
  — it **NEVER fabricates a justification** (a fabricated approval reason would be a safety
  regression). A well-formed escalation is preserved **byte-for-byte**.
- **`scripts/sync-derive.mjs` is idempotent (new in rc.21).** It was not: `locate()` ended at the
  bare `END` marker while `deriveBlock()` writes `END + ' ---…'` (40 dash bytes), so every
  `npm run build` appended **40 bytes** to the END line of `lib/client.src.js` with **no content
  change**. **Measured at HEAD in an isolated copy:** `node scripts/sync-derive.mjs` four times
  grew `lib/client.src.js` **188 602 → 188 762 bytes** (**+40 bytes per run**, the END line
  growing **3 239 → 3 439 chars**); a full `npm run build` grew it **+41 bytes per run** (the
  extra byte is `build-presets.mjs` — see the residual below). It now ends at the marker's **line**,
  so a repeat run finds what it wrote and reports `unchanged` (proven: runs 2–4 identical hashes).
  Because of this, `lib/client.src.js` and `lib/client.js` show a **lossless whitespace-only
  diff** against HEAD (the accumulated padding collapsing to the canonical form) — expected and
  correct, not a functional change. Measured: the repo's own `stripCode()` comparison of HEAD vs
  the canonical rebuild is **byte-identical** for both files.
- **The whole build chain is idempotent (new in rc.22 — the R9 closure).** The last
  non-idempotent step was `scripts/build-presets.mjs`, which grew `lib/client.src.js` by **exactly
  +1 byte per run**: `DECLARATION_LINE` was `/^\s*const PRESET_DECLARATIONS = .*$/m`, which never
  captured the trailing newline, while `declarationSource()` returns a string that **ends** in
  `"\n"` — so every bake replaced a match-**without**-newline with text-**with**-newline.
  **Measured at HEAD in an isolated copy:** 4 consecutive runs grew the file
  **185 405 → 185 406 → 185 407 → 185 408** bytes, code content unchanged. The **defect class**
  was the **divergence between the gate and the bake** — `declarationsAreCurrent()` compared
  `current === declarationSource().replace(/\n$/, '')` while `bakePresetDeclarations()` wrote the
  raw newline-bearing string, so the gate could never see what the bake actually wrote. Now the
  regex **owns its line terminator** (`^[ \t]*const PRESET_DECLARATIONS = .*\n?` — the indent
  class is `[ \t]*`, **not** `\s*`, which would re-create the leak by consuming the preceding
  blank line; `\n?` so a final line without a newline still matches) and **ONE** shared
  `normalizeDeclarationLine()` helper is used by **BOTH** callers; the `.replace(/\n$/, '')` hack
  is **gone**. **Measured after the fix:** 3 consecutive runs are **byte-identical**
  (md5 `e53f6153…`, each printing `unchanged`); `--check` **exits 1** on a real `lib/presets.js`
  drift and **exits 0** after the revert. The **residue** the old bug left behind — one stray
  blank line in `lib/client.src.js` and `lib/client.js` — was **restored to HEAD** and rebuilt, so
  both files are **byte-identical to HEAD** again (**185 403 B** / **3 460 L** and **205 839 B** /
  **3 908 L**). **A full `npm run build` followed by `git status` produces ZERO diff** — the build
  chain is a **fixed point**. Gate: `test/build-presets.test.mjs` **3 → 8** cases, including a
  bake-twice regression test; the new tests were **falsified against the old code** (**4 of 8**
  failed).

## 2. The three fixes (rc.20, same session)

Full evidence: [CHANGELOG.md](../CHANGELOG.md) §"0.0.1-rc.20 (cont. 2)".

| Commit | What was wrong | Fix |
|---|---|---|
| `0b2c516` | the credential ref was read as `ctx.credentials`; both presets inject only `llm`, so cordis threw `cannot get property "credentials" without inject` (cordis:1257) and the `try/catch` silently returned `''` | read through the **inject-free accessor** `ctx.get('credentials')` (cordis:1345) |
| `642ee06` | a replayed Gemini `functionCall.args` carried a key the tool declaration does not declare (live: `sandbox_permissions` on a `write` call, session `2a16c3bb` turn 1 step 14) → Google answered `HTTP 400 "Request contains an invalid argument."` | `declaredArguments()` + `pruneArguments()` — only declared keys are replayed (antigravity suite **190 → 193**) |
| `6388397` | the store ref was resolved once at mount, but `ctx.get(name, strict)` returns `undefined` while the provider fiber is activating (live: `HTTP 401: missing API key` on a DeepInfra child) | `strict=false` + `ctx.inject(['credentials'], …)` deferred resolution + refresh on `credentials/reference-updated` |

## 3. Architecture audit (2026-11-14) — HISTORICAL (the baseline it measured has been refactored)

> **Read this section as history.** It records the tree at HEAD `ead9daf`, **before** Phase 1 and
> Phase 2. The "VIOLATION" rows it lists were addressed by those phases — except where §3b says a
> residue remains. **The current boundary verdict is §3b.** This section is kept because the
> audit's *measurements* are the baseline the phase numbers are quoted against.

A **read-only** architecture audit ran on 2026-11-14 against the measured tree at
`@nolit/dsh-custom-router@0.0.1-rc.20` (HEAD `ead9daf`). It changed **no** code, **no** version,
**no** live state. Its full task list is in [ROADMAP.md](./ROADMAP.md) **§4 P2-A**.

**Owner principle under test:** LOWER layer = a thin standardised shared pipeline for OpenAI /
Anthropic / Gemini; UPPER layer = thin vendor/preset adapters that carry **vendor quirks only**.

### Layer table

| Layer | Measured lines | Verdict vs the owner principle |
|---|---|---|
| **Core pipe** `lib/stream/` | **764** (`index` 343, `sse` 180, `usage` 90, `wire` 68, `failure` 83) | **Protocol-agnostic in code** — zero protocol branches. But **not thin**: `lib/stream/anthropic.js` alone adds **614 L = 80.4 % on top of** the 764-line core (44.6 % of the whole 1,378-line directory including itself). |
| **↳ Anthropic fork inside the core** | **614** in `lib/stream/anthropic.js` | **VIOLATION.** One protocol forked *inside* the lower layer: own SSE reader (85 L duplicating `sse.js`), own usage writer (22 L bypassing `usageFromProjection`), 3 `abortError` copies (14 L). |
| **↳ per-stream seam** `createHooks` | `lib/stream/index.js:61-76` | **Exists and is used** — by OpenCode (`vendor/opencode/lib/http.js:2358`), but only inside the non-default `shared` branch. It is the seam the Anthropic state should ride. |
| **Core accounting** `lib/cost.js` + `plan.js` + `usage.js` | **85 + 254 + 192 = 531** | **DEAD CORE.** Imported by **zero** vendors; the serving path uses two private ledgers instead. |
| **Core retry** | **0** | **MISSING.** `grep backoff lib/` → 0 hits. Retry exists only in vendors. |
| **Vendor: antigravity** `lib/` | **5 216** (22 files) | **Mostly correct.** Rides the core (Gemini shape) at `adapter.js:280-288`. Vitals stay vendor-only: envelope, part-level `thoughtSignature`, effort-in-model-id, live catalog/quota RPC, `agy` CLI envelope, OAuth. Its 70-line retry and 92-line catalog cache are the exceptions. |
| **Vendor: deepinfra** `lib/` | **3 950** (16 files) | **Rides the core fully** — `adapter.js:225`; its second Anthropic-native route also rides it (`anthropic-adapter.js:256`). Carries a **private copy of the OpenAI wire** (`map.js` 130 L, `wire.js` 503 L). |
| **Vendor: exaone** `lib/` | **1 176** | **Rides the core** (OpenAI shape) at `adapter.js:140-148`; keeps only real quirks (static single-model catalog, effort folding, `chat_template_kwargs`, 16-stop cap). Carries the second **private copy of the OpenAI wire**. |
| **Vendor: opencode** `lib/` | **12 330** (32 files; `http.js` alone **3 073**) | **VIOLATION.** Does **not** ride the core by default: `http.js:302` `pipe: … .default('legacy')`, `http.js:2284` `parser: 'legacy'` hardcoded, legacy loop `2091-2245`, own SSE reader `440-499`, own usage writer + finish table (`openai-mapping.js:14-92`), own **335-line** tool-call assembly (`http.js:1590-1924`). `stream-parser.js` is **679 L** and the core has **no parser slot** for it. |
| **Preset / spec layer** | 4 presets, `specs/` (5 protocols, 4 providers, 4 pricing) | **NOT data-only — 0 of 4.** The declaration layer owns **mount rows + provider routing** only. `kind:'declaration'` mounts nothing; `route:'pi-ai'` has **no writer** in this repo. |

### Protocol coverage verdict

| Protocol | Verdict |
|---|---|
| **OpenAI** | **Shared seam, but duplicated in two vendors.** The core has the right shape; the vendors each keep a private copy. Measured: `vendor/exaone/lib/map.js` and `vendor/deepinfra/lib/map.js` are **130 L each with a zero non-comment diff**; of the 8 named request-projection functions, **6 are byte-identical** and 2 differ only in vendor branding. Duplicated subset across both vendor copies = **681 L** (measured by brace-matched function spans). |
| **Anthropic** | **Forked inside the core.** 614 L (80.4 % on top of the 764-line core) with its own SSE reader, own usage writer and its own `abortError`. The shared pipe is not shared for this protocol. |
| **Gemini** | **Thin vendor binding — CORRECT.** Antigravity binds through the core at `adapter.js:280-288` and keeps only genuine Gemini quirks upstairs. This is what the other two protocols should look like. |

### Vocabulary split (measured)

`totalFormula` has **two** vocabularies that do not meet:

- `lib/driver/contract.js:14` allows `['prompt+output', 'gemini']`.
- `lib/stream/usage.js:23-28` implements `['prompt+output', 'prompt+output+reasoning']`.

Measured consequences: `defineProviderDriver` **rejects** the Anthropic (`input+output+cache`)
and Antigravity (`prompt+output+reasoning`) descriptors; `usageFrom` **throws** on `gemini`
(`unknown usage formula: gemini`) and on `input+output+cache`. Only the DeepInfra/EXAONE-shaped
descriptors pass.

### Gate coverage gap

`npm run verify:stream` reports **8/8** dispatch cases and `vendor loads: 0`, but
`scripts/verify-stream.mjs:23` guards only `['dsh-antigravity', 'dsh-deepinfra',
'dsh-opencode-v2']` — **`dsh-exaone` is not guarded**, so the "0" is not proof for the 4th vendor.

### Spec ↔ preset hole (measured against `scripts/verify-specs.mjs`)

| Mutation | exit | Reading |
|---|---|---|
| `specs/providers/deepinfra.json` → wrong `endpoint` + wrong `protocol` | **0** | **not caught** |
| `specs/providers/deepinfra.json` → wrong `models` id (valid shape) | **0** | **not caught** |
| `specs/providers/deepinfra.json` → **deleted** | **1** | caught (the pricing spec cross-references it) |

> **Correction to the audit brief.** The brief reported "deleting it → exit 0". Measured: deleting a
> provider spec **fails** (exit 1). The real hole is the **content** mutations. The mirror check
> must compare a spec against the **preset**, not only against the spec set's internal references.

`specs/pricing/*.kind` (`subscription` / `live-catalog` / `free` / `flat`) and
`preset.usage.billing.mode` (`subscription` / `flat` / `pay-per-token` / `none`) are two
vocabularies with **no cross-check**; `usage.routes[].normalize` joins to a hand-written
`USAGE_READERS` table (`lib/client.src.js:772`) with **no gate**.

### Roadmap consequence

- **The former P2-1 ("a data-only 'install a preset' path") was DELETED** as an **unreachable
  promise**: 0 of 4 presets are data-only, `kind:'declaration'` mounts nothing, and `route:'pi-ai'`
  has no writer. The real "generic OpenAI-compatible provider" seam is in the **HOST**
  (`dsh-llm-pi-ai` takes `providers: z.dict(profile)`) — that is now **A7**, a measure-first task.
- The replacement queue is **[ROADMAP.md](./ROADMAP.md) §4 P2-A**: **A2 → A1 → A3 → A4 → A5 → A6**,
  with **A7 independent**.
- **P2-2** and **P2-3** are marked **superseded by A3** (they are the same work: the `pipe` default
  and the canonical parser / parser slot).
- **No progress is claimed by this audit.** It is a measurement pass; nothing in the P2-A queue has
  been started. P0-1 (rotation), P0-3 (scan) and the EXAONE child verification remain **open**.

## 3b. Phase 1 + Phase 2 result (2026-11-14) — the boundary verdict

Phase 1 (core lock) and Phase 2 (vendor fan-out) of the horizontal layered architecture are
**DONE**: `c0e48ab`, `3ac7a10`, `c2ba900`, `ae9fd1d` (Phase 1) and `8ee4ef1` (Phase 2). The
table below is a **read-only boundary check** of that diff against
[ARCHITECTURE-LAYERED.md](./ARCHITECTURE-LAYERED.md) §2.5 (L1 forbidden rules), §4 (L2
obligations) and §6 (static gates). It changed **no** code, **no** version, **no** live state.

### Layer sizes (measured, `ead9daf` → `8ee4ef1`)

| Surface | before | after | Δ |
|---|---:|---:|---:|
| `lib/stream/` total | 1 378 | **1 851** | +473 |
| ↳ `lib/stream/anthropic.js` | **614** | **433** | **−181** |
| ↳ `lib/stream/openai.js` | — | **467** | +467 |
| `lib/{cost,plan,usage}.js` | 531 | **1 669** | +1 138 |
| `lib/retry.js` + `lib/catalog-cache.js` | — | **569** | +569 |
| vendor antigravity / opencode / deepinfra / exaone `lib/` | 5 216 / 12 330 / 3 950 / 1 176 | 5 275 / 12 631 / **3 480** / **842** | **−444 total** |

The duplication left the upper layer; the standardisation entered the lower one.

### Boundary verdict

| Rule (source) | Verdict | Evidence |
|---|---|---|
| **L1 must not know L2** — no vendor import in `lib/stream/*` (ARCH §1 rule 2) | ✅ **PASS** | `grep -rn "vendor" lib/stream/*.js` → every hit is inside a `/** */` comment (`openai.js:9-14`, `anthropic.js:134`, `usage.js:12`); **0** import statements. Every `lib/stream/*` import is relative (`./failure.js`, `./sse.js`, `./usage.js`, `./wire.js`). |
| **No vendor identifiers in L1 code or error strings** (ARCH §2.5 #1) | ✅ **PASS** (was `EXCEPTION-OK`) | **0** non-comment vendor hits in all 7 `lib/stream/*.js` (AST-token scan). **Also 0 in `lib/plan.js`** — measured: `grep -ciE "opencode\|antigravity\|deepinfra\|exaone" lib/plan.js` → **0** (was 2 code ids, 9 with comments). The plan→provider-id table moved to the declaration layer (`lib/presets.js` → `PLAN_PROVIDERS` + `planProvidersOf(presetId)`); `lib/plan.js` takes the map as an explicit argument or via `bindPlanProviders()`. **R5 is CLOSED** (`77a53b0`), and `test/plan-boundary.test.mjs` (**5 cases**) measures the vendor words from `vendor/*/package.json`. |
| **No vendor envelope unwrap/wrap in L1** (ARCH §2.5 #2) | ✅ **PASS** | The CloudCode `{project,request,response}` wrapper, the OpenCode daemon session/headers and the DeepInfra `/anthropic` suffix are **not** in `lib/stream/`. `grep -n "project\|\.response" lib/stream/*.js` → **0** code hits (only prose). |
| **No config / Cordis service access in L1** (ARCH §2.5 #3) | ✅ **PASS** | `grep -rn "ctx\.\|process\.env\|node:fs\|fetch(" lib/stream/` → **0** hits. `lib/stream/index.js` is pure: `normalizeStream({events, descriptor, hooks, createHooks, signal, onUsage})`. |
| **No I/O beyond the passed stream** (ARCH §2.5 #4) | ✅ **PASS** | `lib/stream/*` imports only its sibling modules; no `node:fs`, no `fetch`, no clock read inside `normalizeStream` (`lib/stream/index.js:69-345`). |
| **No retry/backoff loop inside `lib/stream/*`** (ARCH §2.5 #5) | ✅ **PASS** | `lib/stream/*` contains **no** retry loop and **no** `backoff`/`sleep`. The bounded retry lives in `lib/retry.js` (`withRetry`, `backoffDelay`, `sleepFor`). |
| **No per-vendor conditional branch in L1** (ARCH §2.5 #6) | ✅ **PASS** | `grep -rn "provider ===\|antigravity\|deepinfra\|exaone" lib/stream/*.js` (non-comment) → **0** hits. The pipe branches only on `descriptor.toolCallShape` (`index.js:87-88`) and on hook return shapes. |
| **One SSE reader / one usage writer / one finish table / one failure taxonomy** (ARCH §2.3, §5 lock #2) | ✅ **PASS** | SSE: `lib/stream/sse.js` is the only decoder — `readAnthropicSse` is a 5-line wrapper over it (`anthropic.js:58-62`); the vendor `sse.js` files are 1-function re-export shims. Usage: `lib/stream/usage.js` — `usageFrom` / `usageFromProjection` / `usageFromAnthropic`; `vendor/deepinfra/lib/usage.js:44` delegates to it. Finish: `lib/stream/wire.js:18` `finishReasonFor` is the only table. Failure: `lib/stream/failure.js:13` `CODES` + one `abortError` (`:101`). |
| **The three protocol cores share one implementation, or a fork is left** | ✅ **PASS (no fork)** | **OpenAI**: one core `lib/stream/openai.js` (467 L) — DeepInfra (`stream-contract.js:51`), EXAONE (`stream-contract.js:37`) and OpenCode (`stream-contract.js:63`) all bind to it **by identity**. **Anthropic**: one `lib/stream/anthropic.js` (433 L ≤ the 434 L target) on the shared reader; DeepInfra's Anthropic route delegates to it (`stream-anthropic.js:41` → `createAnthropicHooks`). **Gemini**: `vendor/antigravity/lib/stream-contract.js` — a 175 L binding over the core (`finishReasonFor` at `:46`, `usageFromProjection` at `:61`). **The file that still deviates: `vendor/opencode/lib/stream-contract.js`** — it owns a vendor-local usage writer (`usageFromOpenAi`) and finish table (`finishFromOpenAi`) plus a **vendor-local notation classifier** (`notation-classifier.js`, 679 L — the renamed `stream-parser.js`; it is **shared-path live**, so it was renamed, not deleted). |
| **No vendor owns an SSE decoder** (ARCH §4 MUST-NOT #1) | ✅ **PASS** | `vendor/{antigravity,deepinfra}/lib/sse.js` are re-export shims (33 L / 43 L); every adapter uses `readSseEvents` (`antigravity/adapter.js:21`, `deepinfra/adapter.js:29`, `exaone/adapter.js:28`, `opencode/http.js:70`). **The one exception is gone:** the OpenCode private SSE reader (`chatSseEvents` / `parseSseBlock`) was **deleted** with the legacy pipeline (`e8b39f7`) — there is no second decoder left. |
| **No vendor owns a usage writer / finish table** (ARCH §4 MUST-NOT #2) | ⚠️ **EXCEPTION-OK** | `vendor/opencode/lib/openai-mapping.js:14` (`usageFromOpenAi`) and `:62` (`finishFromOpenAi`) are the vendor's **published** code — they carry the vendor's own `OPENCODE_FINISH_*` failure codes and its published total contract (`input + output + cacheRead`), which the shared writer deliberately does not reproduce. Used by the shared path (`stream-contract.js:99`, `:109`). **EXCEPTION-OK** as a published-contract exception. |
| **No vendor owns a tool-call assembler** (ARCH §4 MUST-NOT #3) | ✅ **PASS** | The 335-line assembler is gone from the live path; the shared path uses the core's part assembler (`lib/stream/index.js:291-344` `emitToolCall`). **The legacy copy is gone too** — it was deleted with the legacy pipeline (`e8b39f7`); there is no `pipe:'legacy'` path left that could reach it. |
| **No vendor owns a cost ledger** (ARCH §4 MUST-NOT #5) | ✅ **PASS (was `EXCEPTION-OK / partially remediated`)** | **CLOSED by R2.** DeepInfra imports the core's `createCostLedger`/`createCostStore`/`numberOrNull`/`pickSession` (`vendor/deepinfra/lib/cost.js:50-56`); only its wire parsing (`parseCost`) and price vocabulary stay local. **OpenCode no longer owns a private ledger**: `vendor/opencode/lib/cost.js` (**324 → 161 diff lines**), `vendor/opencode/lib/plans.js` and `vendor/opencode/lib/usage-ledger.js` now **delegate** to the core `lib/cost.js`, `lib/presets.js` and `lib/usage.js`. Measured duplicate-definition counts after the change: `numberOrNull` **2 → 1** (`lib/cost.js:145`), `pickSession` **2 → 1** (`lib/cost.js:229`), `USAGE_BUCKETS` **2 → 1** (`lib/usage.js:51`), `usageTotal` **2 → 1** (`lib/usage.js:75`). `createCostStore`/`createCostLedger` stay at **3** = **1** core + **2** legitimate thin wrappers (DeepInfra + OpenCode). **Two design points worth keeping:** (i) `PLAN_PROVIDERS` is imported from **`lib/presets.js`**, NOT `lib/plan.js`, because `plan.PLAN_PROVIDERS` is an unbound mutable `Object.create(null)` (`{}`) until `bindPlanProviders()` runs — importing it would have silently broken plan grouping (every route would classify as `other`); (ii) the core ledger stores `bySource` as **spend PARTITIONS**, while the frozen `lib/client.src.js` `detectOpencodeTier()` reads it as a **COUNT map**, so the vendor wrapper projects partitions back to counts to keep the served payload identical. |
| **No vendor owns a retry/backoff loop** (ARCH §4 MUST-NOT #4) | ✅ **PASS** (was `EXCEPTION-OK / partially remediated`) | Antigravity's 70-line loop rides `lib/retry.js` (`vendor/antigravity/lib/adapter.js:27`). **OpenCode's two loops now ride it too** (`77a53b0`): its own `sleepFor` (**24 L**) and its **inverted-signature** `backoffDelay` (**12 L**) are **deleted**. Measured: `grep -rn "function backoffDelay\|function sleepFor" lib/ vendor/` → **2** hits, **both** in `lib/retry.js` (`backoffDelay` `:130`, `sleepFor` `:147`). **R3 is CLOSED.** |
| **No vendor owns a generic TTL catalog cache** (ARCH §4 MUST-NOT #6) | ✅ **PASS** (was `EXCEPTION-OK / partially remediated`) | Antigravity rides `lib/catalog-cache.js` (`vendor/antigravity/lib/index.js:32`, instantiated `:274`). **OpenCode** (`77a53b0`): `vendor/opencode/lib/catalog-cache.js` (**362 L**) is **deleted**; its snapshot file and SWR lifecycle are split into `catalog-file.js` (**236 L**) + `catalog-lifecycle.js` (**181 L**) over the core `createCatalogCache`. **DeepInfra** (`77a53b0`): the local 30-min in-memory cache, `invalidateCatalog` closure and `fetchedAt` math are replaced by the core cache with a `ttlMs` **function** (`vendor/deepinfra/lib/index.js:237`); its 30-min default and `catalogTtlMs` config key are unchanged. Measured: `grep -rn "lib/catalog-cache.js" vendor/` → **3** hits (antigravity, deepinfra, opencode) — **one** core cache for every vendor. Antigravity's **quota**-window cache stays vendor-local (it caches a quota fact, not a catalog). |
| **The zero-vendor-loads guard is honest for all 4 vendors** (ARCH §6 #2) | ✅ **PASS** | `scripts/verify-stream.mjs:34-51` **measures** the vendor set from `vendor/*/package.json` (a 5th vendor is guarded automatically). `:94-122` **self-tests**: every alias and scoped name must be **refused**, and a specifier that resolves is reported `UNGUARDED` and fails the run. `:115-120` **control probe** (`node:fs`) proves the resolver is consulted. `:54-57` **vacuity guard**: exits **2** if no vendored package exists. Measured 2026-11-14: **4 probed, 8/8 refused, 0 loads**. |
| **Repo-wide uniqueness greps** (ARCH §6 #3) | ✅ **PASS (was `PARTIAL`)** | **CLOSED by R6.** `mapDelta` → **1** (`lib/stream/openai.js`), `numberOrNull` → **1** (`lib/cost.js:145`), `pickSession` → **1** (`lib/cost.js:229`), `backoffDelay` → **1** (`lib/retry.js:130`), `createCostStore` → **3** = 1 core + 2 legal thin wrappers. `parser:'legacy'` literal → **0**. The greps are now a **WIRED gate**, not a manual grep: `test/uniqueness.test.mjs` (**23 cases**) rides the existing `npm test` glob (**no `package.json` change**) and `scripts/verify-uniqueness.mjs` is a standalone runner (`--json`, exit **0/1/2**). The rule is **not** naive "one definition repo-wide" — (a) exactly **ONE** core implementation in `lib/**`; (b) a vendor definition is legal **only** if it imports the core symbol **and** calls it; (c) definitions outside `lib/`+`vendor/` are strays and fail; (d) the vendor set is **MEASURED** from `vendor/*/package.json`, never hand-listed. **Negative proof:** a planted duplicate produced **8** findings, then reverted; the tree was hash-verified file-by-file. |
| **Tool-argument contract at the L1 emission point** (new seam, ARCH §2.5 / §6) | ✅ **PASS (gate exists)** | `lib/stream/tool-argument-contract.js` (**163 L**) reconciles a tool call's arguments against the tool's **own declared** schema before they leave the pipe. Placed at **`finalBlock`** in `lib/stream/index.js` — the single L1 emission point, where the `block-end` block is authoritative for execution (the host `BlockAssembler` keeps `partial.block` and ignores the accumulated deltas once a block closes). All **five** vendor `normalizeStream` call sites pass `tools: options.tools` (`vendor/antigravity/lib/adapter.js:294`, `vendor/deepinfra/lib/adapter.js:229`, `vendor/deepinfra/lib/anthropic-adapter.js:263`, `vendor/exaone/lib/adapter.js:147`, `vendor/opencode/lib/http.js:1950`). The rule is **DERIVED** from the host's schema prose `Required with <field>` (measured identically on `dsh-tool-bash`, `dsh-tool-fs`, `dsh-tool-pwsh`), so a differently-named pair is covered with **no edit**. The seam carries **no vendor name, no model name and no per-vendor branch**, so the L1 boundary rule is untouched. Gate: `test/tool-argument-contract.test.mjs` (**13 cases**) pins the derivation against the measured host text. |
| **L1 boundary lint test** (`test/stream-boundary.test.mjs`, ARCH §6 #1) | ✅ **PASS (gate exists)** | `test/stream-boundary.test.mjs` (**15 cases**) exists and fails on a vendor import, a vendor identifier, `ctx.` / `process.env` / `node:fs` / `fetch(` / `require(` / a dynamic `import(` inside `lib/stream/*`, a per-vendor equality, and on more than one SSE decoder / usage writer / finish table / `abortError`. **Negative proof:** a planted forbidden import failed **3** rules; the plant was reverted with a **sha256 verification**. |
| **`USAGE_READERS` gate** (ARCH §6 #3) | ✅ **PASS (gate exists)** | `scripts/verify-usage-readers.mjs` + `test/usage-readers.test.mjs` (**12 cases**): every preset's `usage.routes[].normalize` must name a real reader, no reader may be dead, and the browser **source ↔ bundle** must stay in parity. Measured: **4 presets / 4 routes / 3 readers**; a renamed route exits **1**. |
| **`classifyBlock` dead hook slot** (ARCH §6 #3 / A6) | ✅ **PASS (removed)** | `lib/driver/contract.js` no longer declares `classifyBlock`; `test/driver-contract.test.mjs` asserts `'classifyBlock' in driver.hooks === false`. Repo-wide hits are now **0** outside the test that names it. |

**Legitimately vendor-local (the four named exceptions, all confirmed present and all justified):**

1. **Anthropic-native route** — `vendor/deepinfra/lib/wire.js:272` `requestBodyAnthropic` + its
   block projection (`:98-263`): a different protocol with a different tool/thinking/system shape.
   Its *stream* side is fully shared (`anthropic-adapter.js:22` → `readAnthropicSse`).
2. **EXAONE usage projection** — `vendor/exaone/lib/stream-contract.js:64` `usageFrom`: EXAONE
   reports `usage.reasoning_tokens` at the **top level**, so it needs one pure projection onto
   the canonical field (`usageFromProjection`) before the one shared writer runs. It is a
   **projection**, not a second writer.
3. **Antigravity envelope / `thoughtSignature`** — `vendor/antigravity/lib/stream-contract.js:145-157`
   (part-level `thoughtSignature` replay, the Gemini 3/4 400 fix) plus its CloudCode envelope,
   OAuth single-flight and quota RPC. The Gemini *protocol* binding itself is 175 L over the core.
4. **CLI subprocess paths** — `vendor/antigravity/lib/{backends,subagent}.js`: the `agy` CLI
   envelope's field names (`input_tokens`/`output_tokens`) and the subagent provider surface.
   Its usage arithmetic now routes through the core (`backends.js:15` → `usageFromProjection`;
   `subagent.js:93` delegates), so only the **vocabulary** is local.

### A3 completion + R4 closure (measured 2026-11-14, commit `e8b39f7`)

**A3 is COMPLETE and R4 is CLOSED.** Both were open caveats in the previous revision of this
file; this subsection replaces them.

**A3 — the OpenCode legacy pipeline is gone.**

- `vendor/opencode/lib/http.js` **3 272 → 2 721 L** (**−630 / +79**). Deleted: the legacy branch
  body, its prelude, its **own** SSE reader (`chatSseEvents` / `parseSseBlock`), the **`pipe`
  config key**, and **4 orphaned imports**. **No config selects a pipeline any more** — the file
  header states the pipeline explicitly.
- **`stream-parser.js` was NOT dead code.** The earlier measurement that overturned the 629 L
  delete list was right: the notation classifier is **live on the shared path**. It was therefore
  **renamed, not deleted**: `vendor/opencode/lib/stream-parser.js` →
  `vendor/opencode/lib/notation-classifier.js` (**679 L**, single named export
  `createNotationClassifier`, **one consumer** — `stream-contract.js:58`). This records the
  placement decision R1 asked for: a **vendor-local notation-quirk surface**, not a core parser
  slot.
- **Coverage did not depend on the oracle that was removed.** Two legacy-only tests were removed
  (**555 → 553**), and the two legacy↔shared parity tests were **replaced by literal golden
  sequences captured from the shared path BEFORE the deletion** — the expected output is now a
  recorded constant, not a live re-derivation.
- **Live proof:** the owner restarted the service at **09:37:14 KST** (**PID 361248**) and the
  **OpenCode shared pipe** turn returned **OK with no error** (alongside the DeepInfra OpenAI core
  and the Antigravity core). The R1 acceptance criterion *"one live turn on an OpenCode route
  through the shared pipe"* is therefore **met**.

**R4 — the boundary gates exist and are proven to fail.**

- **`test/stream-boundary.test.mjs` (15 cases)** — enforces the L1 boundary from
  [ARCHITECTURE-LAYERED.md](./ARCHITECTURE-LAYERED.md) §2.5 / §6.1: **no vendor import, no vendor
  identifier**, no `ctx` / `process.env` / `node:fs` / `fetch(` / `require(` / dynamic `import(`
  inside `lib/stream/*`, **no per-vendor equality**, and **exactly one** SSE decoder / usage
  writer / finish table / `abortError`. **Negative proof:** a planted forbidden import failed
  **3** rules; the plant was reverted with a **sha256 verification**.
- **`scripts/verify-usage-readers.mjs` + `test/usage-readers.test.mjs` (12 cases)** — every
  preset's `usage.routes[].normalize` must name a **real** reader, no reader may be dead, and the
  browser **source ↔ bundle** must stay in parity. Measured: **4 presets / 4 routes / 3 readers**
  (`normalizeAntigravityUsage`, `normalizeOpencodeUsage`, `normalizeDeepinfraUsage`); a renamed
  route exits **1**. **Negative proof** recorded.
- The dead **`classifyBlock`** hook slot is **removed** from `lib/driver/contract.js`;
  `test/driver-contract.test.mjs` asserts it is absent.

**What this did NOT close** (unchanged, still open): **R2** (OpenCode's private cost ledger),
**R3** (OpenCode's retry loops + its own `backoffDelay`, and the OpenCode + DeepInfra catalog
caches), **R5** (the `PLAN_PROVIDERS` vendor-id table inside `lib/plan.js`), **R6** (the
repo-wide uniqueness greps are still a manual grep, not a wired gate), and **A7** (the host
`dsh-llm-pi-ai` seam — measure-first, owner-gated).

> **Superseded:** **R3** and **R5** are now **CLOSED** by `77a53b0` — see the next subsection.
> **R2**, **R6** and **A7** remain open.

### R3 + R5 closed (measured 2026-11-14, commit `77a53b0`) — one retry, one catalog cache, no vendor ids in L1

**R3 is CLOSED and R5 is CLOSED.** Both were open caveats in the previous revision of this file;
this subsection replaces them.

**R3 — one retry and one catalog cache.**

- **OpenCode — one retry core.** The vendor's own `sleepFor` (**24 L**) and its
  **inverted-signature** `backoffDelay` (**12 L**) are **deleted**; **both** retry sites — the
  control-plane request and the generation-status loop — now call `lib/retry.js`. Measured:
  `grep -rn "function backoffDelay\|function sleepFor" lib/ vendor/` → **2** hits, **both** in
  `lib/retry.js` (`backoffDelay` `:130`, `sleepFor` `:147`) — **0** in any vendor.
- **Preserved exactly** (these are the semantics that must not drift):
  - the **vendor's own status set** — **429 / 451 / 502 / 503 / 504** — deliberately **NOT** widened
    to the core's wider set;
  - **unbounded progression** (the cap is deliberately raised);
  - the **abort semantics**;
  - the **one-shot 401 refresh**, kept as an **in-attempt** action that never consumes a retry.
- **OpenCode — one catalog cache.** `vendor/opencode/lib/catalog-cache.js` (**362 L**) is
  **deleted**. Its snapshot file and its stale-while-revalidate lifecycle are split into
  `vendor/opencode/lib/catalog-file.js` (**236 L**) + `vendor/opencode/lib/catalog-lifecycle.js`
  (**181 L**) on top of the core `createCatalogCache` — single-flight and the durable snapshot
  round-trip preserved. OpenCode suite **553 → 554/554**.
- **DeepInfra — one catalog cache.** The local **30-minute** in-memory cache, the
  `invalidateCatalog` closure and the `fetchedAt` math are **replaced** by the core
  `createCatalogCache` fed by a `ttlMs` **function**
  (`vendor/deepinfra/lib/index.js:237` → `numberAt('catalogTtlMs', DEFAULT_CATALOG_TTL_MS)`), so
  the plugin's **own 30-minute default** and its **config key** (`catalogTtlMs`) are **unchanged**.
- **Measured benefit:** **5 concurrent cold reads → 1 probe** (the old closure had no in-flight
  dedupe); a **failed cold fetch is still served as an empty catalog and is not cached**, so one
  bad poll does not blank the picker for a whole TTL.
- ⚠️ **Known divergence (not a defect).** `DEFAULT_CATALOG_TTL_MS` now exists in **two** places:
  `vendor/deepinfra/lib/catalog.js:111` (**30 min** — the one actually used) and
  `lib/catalog-cache.js:42` (**15 min** — the core default when no `ttl` is passed). DeepInfra
  passes its own 30-minute constant explicitly, so the **runtime** TTL is unambiguous — but the
  two names coexist, and a reader who sees only the core constant will read the wrong default.

**R5 — no vendor ids in L1.**

- `PLAN_PROVIDERS` moved **out of** `lib/plan.js` into the **declaration layer**
  (`lib/presets.js` → `PLAN_PROVIDERS`, `PLAN_PROVIDERS_BY_PRESET`, `planProvidersOf(presetId)`).
- `lib/plan.js` exposes `bindPlanProviders(map)` and takes an **explicit `providers` argument**
  (`planOfProvider`, `planOfRoute`, `availabilityOf`, `orderModels`); unbound, the map is empty
  and every provider classifies as `other` — a visible "no plan declared" instead of a guessed
  vendor.
- **Vendor-id count in `lib/plan.js`: 2 code ids (9 with comments) → 0.** Measured:
  `grep -ciE "opencode|antigravity|deepinfra|exaone" lib/plan.js` → **0**.
- New **`test/plan-boundary.test.mjs` (5 cases)** measures the vendor words **from
  `vendor/*/package.json`** instead of hand-listing them — so a new vendor cannot slip past an
  out-of-date lint list.

**Gates (independently re-measured for this handoff):** router `npm test` **807/807**;
`verify:stream` **8/8** with **4** vendored packages probed, **8/8** specifiers refused,
**vendor loads 0**; `specs:check` OK (`5 protocols, 4 providers, 4 pricing`);
`verify:presets:mutation` **26/26**; `verify:usage-readers` OK (4 presets / 4 routes / 3 readers);
vendor suites antigravity **193/193**, deepinfra **222 pass / 7 skip**, opencode **554/554**,
exaone **19/19**. **No restart**, version held at `rc.20`, **no** `~/.dsh` write, **no** API key
read, printed or reproduced.

**What this did NOT close** (still open): **R2** (OpenCode's private cost ledger:
`vendor/opencode/lib/cost.js` + the `plans.js` / `usage-ledger.js` remnants), **R6** (the
repo-wide uniqueness greps are still a manual grep, not a wired gate), and **A7** (the host
`dsh-llm-pi-ai` `providers` seam — measure-first, owner-gated).

### R2 + R6 closed, A7 closed as a measurement, and the tool-argument contract seam (measured 2026-11-14, commit `rc.21`)

**R2 is CLOSED, R6 is CLOSED, and A7 is CLOSED as a MEASUREMENT.** All three were open caveats in
the previous revision of this file; this subsection replaces them.

**R2 — one cost / usage / plan implementation.**

- `vendor/opencode/lib/cost.js`, `vendor/opencode/lib/plans.js` and
  `vendor/opencode/lib/usage-ledger.js` now **delegate** to the core `lib/cost.js`,
  `lib/presets.js` and `lib/usage.js` instead of carrying their own bodies. Measured
  duplicate-definition counts: `numberOrNull` **2 → 1** (`lib/cost.js:145`), `pickSession`
  **2 → 1** (`lib/cost.js:229`), `USAGE_BUCKETS` **2 → 1** (`lib/usage.js:51`), `usageTotal`
  **2 → 1** (`lib/usage.js:75`).
- `createCostStore` / `createCostLedger` remain **3** total = **1** core + **2** legitimate thin
  wrappers (DeepInfra + OpenCode). This is the **accepted precedent**, not a residual: the
  architecture allows a vendor to keep a same-named wrapper as long as it imports the core
  symbol and calls it, and the R6 gate encodes exactly that rule.
- **Design point 1 — `PLAN_PROVIDERS` comes from `lib/presets.js`, NOT `lib/plan.js`.**
  `plan.PLAN_PROVIDERS` is an **unbound mutable** `Object.create(null)` (`{}`) until
  `bindPlanProviders()` runs, so importing it would have silently broken plan grouping — every
  route would classify as `other`. `lib/presets.js` holds the **frozen**
  `{ go: 'opencode-go', zen: 'opencode' }` and is cycle-free (`presets.js` imports only
  `preset-schema.js`).
- **Design point 2 — `bySource` is a spend PARTITION in the core, a COUNT map on the wire.**
  The core ledger stores `bySource` as spend partitions, but the frozen `lib/client.src.js`
  `detectOpencodeTier()` reads it as a **count** map. The vendor wrapper therefore **projects
  partitions back to counts** so the served payload stays byte-identical. Both shapes are
  documented at their definitions.

**R6 — the uniqueness greps are a wired gate.**

- `test/uniqueness.test.mjs` (**23 cases**) **rides the existing `npm test` glob** — it needs
  **no `package.json` change** — and `scripts/verify-uniqueness.mjs` is a **standalone runner**
  with `--json` and exit **0** (clean) / **1** (gate failure) / **2** (the gate could not run,
  i.e. vacuity).
- The rule is **NOT** the naive "one definition repo-wide" — that would be **false** for
  `createCostStore`. The encoded rule is: (a) exactly **ONE** core implementation in `lib/**`;
  (b) a vendor definition is legal **ONLY** if it imports the core symbol **AND** calls it;
  (c) definitions outside `lib/` **and** `vendor/` are **strays** and fail; (d) the vendor set
  is **MEASURED** from `vendor/*/package.json`, never hand-listed — so a fifth vendored
  package is covered without editing the gate.
- **Negative proof (re-measured for this handoff):** a dual plant — **5** names in `scripts/`
  (strays) plus **3** vendor re-implementations — produced exactly **8** findings, and the
  revert restored the baseline exactly (findings back to **0**). A single-file stray plant
  produced **1** finding and reverted cleanly; the tree hash is stable across a scan, and no
  negative-proof scratch file survives in `scripts/`.

**A7 — closed as a MEASUREMENT, not as a feature.** Full evidence:
[HOST-PROVIDERS-SEAM.md](./HOST-PROVIDERS-SEAM.md).

- The host `dsh-llm-pi-ai` seam is `providers: z.dict(profile)` with **4** wire protocols.
  pi-ai's installed catalog already ships `opencode` (**85** models) and `opencode-go`
  (**32**) — but **NONE** of the router's four preset provider ids (`antigravity`,
  `opencode-http-agent`, `deepinfra`, `exaone`) is a catalog route.
- The seam models **provider profiles only** — **no** daemon indirection, **no** ledger/billing,
  **no** plan windows, **no** picker, **no** dispatch gates — so **it cannot replace this
  router**. This confirms the earlier removal of **P2-1** ("data-only preset") as an
  **unreachable promise** rather than a regression.
- **Recommended owner decision: keep `llm-pi-ai` dormant.** It is dormant today (no
  `llm-pi-ai:` section exists in the live profile), so the recommended option changes nothing —
  which is why it is the safe close. Nothing here authorises declaring catalog-backed profiles.

**The tool-argument contract seam — new, and it is a structural fix, not a provider patch.**

- **The bug:** a live Gemini/Antigravity subagent run died with
  `Error: invalid escalation: justification is only valid together with sandbox_permissions`.
- **The root cause was NOT a Gemini quirk.** The host (`@deepseek-ai/dsh-sandbox`
  `validateEscalationArgs`) enforces the escalation pairing on the **EXECUTION** path; a
  provider schema cannot express it; and **every** vendor hands its calls to the **ONE** shared
  pipe. So a drifted call reached execution intact, and the turn died where the model could not
  see it coming.
- **Placement:** the single **L1 emission point** — `finalBlock` in `lib/stream/index.js` — where
  the produced `block-end` block is authoritative for execution (the host `BlockAssembler` keeps
  `partial.block` and ignores the accumulated deltas once a block closes). All **five** vendor
  `normalizeStream` call sites now pass `tools: options.tools`.
- **The rule is DERIVED, not hardcoded:** it reads the host's own schema prose
  `Required with <field>` (measured **identically** on `dsh-tool-bash`, `dsh-tool-fs` and
  `dsh-tool-pwsh`), so a differently-named pair is covered with **no edit** to this repo.
- **Repair direction:** a dependent field present **WITHOUT** its principal is **dropped** (a lone
  reason asks for nothing); a principal with a **blank** dependent keeps the escalation and drops
  the blank value — it **NEVER fabricates a justification**, because a fabricated approval reason
  would be a **safety regression**, not a repair. A well-formed escalation is preserved
  **byte-for-byte**, and a call that needs no repair is returned by identity.
- **Gate:** `test/tool-argument-contract.test.mjs` (**13 cases**) pins the derivation against the
  measured host text, so an upstream rephrasing fails a test instead of going quiet.

**`scripts/sync-derive.mjs` was non-idempotent — now fixed (closed).**

- **The bug:** `locate()` ended at the **bare** `END` marker while `deriveBlock()` writes
  `END + ' ---…'` (40 dash bytes). Every `npm run build` therefore appended **40 bytes** to the
  END line of `lib/client.src.js` with **no content change**. **Measured at HEAD in an isolated
  copy:** `node scripts/sync-derive.mjs` four times grew `lib/client.src.js`
  **188 602 → 188 762 bytes** (**+40 bytes per run**; the END line grew **3 239 → 3 439 chars**).
  A full `npm run build` grew it **+41 bytes per run** — the extra byte is `build-presets.mjs`
  (see the residual below), which is a *different* script.
- **The fix:** `locate()` now ends at the **end of the marker's line**, so a repeat run finds
  exactly what it wrote and reports `unchanged`. **Proven:** runs 2–4 produce identical hashes
  (`node scripts/sync-derive.mjs` three times in a row → `unchanged` ×3, same sha256).
- **Consequence:** `lib/client.src.js` and `lib/client.js` show a **lossless whitespace-only
  diff** against HEAD (the accumulated padding collapsing to the canonical form) — expected and
  correct, **not** a functional change. Measured: the repo's own `stripCode()` comparison of
  HEAD vs the canonical rebuild is **byte-identical** for both files.
- ⚠️ **Residual, measured and NOT fixed by this session** (it is a *different* script and a
  *pre-existing* defect): `scripts/build-presets.mjs` writes the baked declaration line with a
  **trailing newline** while its `DECLARATION_LINE` regex (`/^\s*const PRESET_DECLARATIONS = .*$/m`)
  never captures one — so **each** `build-presets` run appends exactly **1 byte** (one blank line)
  after the declaration line. Measured in an isolated copy: `client.src.js` grew
  **185 407 → 185 408 → 185 409 → 185 410** bytes over 4 runs, with the code content
  unchanged. This is a **pre-existing** defect (`build-presets.mjs` is **unchanged** from HEAD)
  and it was **outside this session's scope**, so it is recorded here rather than fixed.
**Gates (independently re-measured for this handoff, not quoted from a commit message):**
router `npm test` **843/843**; `npm run verify` **exit 0**; `verify:stream` **8/8** with **4**
vendored packages probed, **8/8** specifiers refused, **vendor loads 0**; `specs:check` OK
(`5 protocols, 4 providers, 4 pricing`); **`node scripts/verify-uniqueness.mjs` clean, exit 0**;
vendor suites antigravity **193/193**, deepinfra **222 pass / 7 skip**, opencode **554/554**,
exaone **19/19**. **No restart**, **no** `~/.dsh` write, **no** API key read, printed or
reproduced.

**What this did NOT close (still open):** the **OpenCode-backend 404** (see below) — a
live-runtime observation at the provider-id resolution seam, **not** reproduced in the test
suite.

### Follow-up tasks

| # | Task | Scope |
| :-: |---|---|
| ~~**R1**~~ | ~~Finish A3~~ — **CLOSED** by `e8b39f7` (see *A3 completion + R4 closure* above) | — |
| ~~**R2**~~ | ~~A4 remnant~~ — **CLOSED** in rc.21: OpenCode's private ledger, its re-declared `plans.js` plan table and its `usage-ledger.js` constants now **delegate** to `lib/{cost,presets,usage}.js`; `numberOrNull` / `pickSession` / `USAGE_BUCKETS` / `usageTotal` are each defined **once** repo-wide; `createCostStore`/`createCostLedger` stay at 3 = 1 core + 2 legal thin wrappers | — |
| ~~**R3**~~ | ~~A5 remnant~~ — **CLOSED** by `77a53b0`: OpenCode's own `sleepFor` / inverted-signature `backoffDelay` are deleted and both retry sites ride `lib/retry.js`; `vendor/opencode/lib/catalog-cache.js` (362 L) is split into `catalog-file.js` + `catalog-lifecycle.js` over the core cache; DeepInfra's local 30-min cache rides the core cache too | — |
| ~~**R4**~~ | ~~A6 remnant~~ — **CLOSED** by `e8b39f7`: the L1 boundary lint, the `USAGE_READERS` gate and the removal of the dead `classifyBlock` slot are all done, with negative proofs | — |
| ~~**R5**~~ | ~~`PLAN_PROVIDERS` in L1~~ — **CLOSED** by `77a53b0`: the vendor-id table moved to `lib/presets.js` (+ `planProvidersOf`); `lib/plan.js` takes an explicit `providers` argument or a `bindPlanProviders()` binding; vendor-id count **2 code ids (9 with comments) → 0**; `test/plan-boundary.test.mjs` (**5 cases**) measures the vendor words from `vendor/*/package.json` | — |
| ~~**R6**~~ | ~~Uniqueness greps as a wired gate~~ — **CLOSED** in rc.21: `test/uniqueness.test.mjs` (**23 cases**, rides the `npm test` glob, **no `package.json` change**) + `scripts/verify-uniqueness.mjs` (standalone, `--json`, exit 0/1/2). Rule: one core implementation in `lib/**`; a vendor definition is legal only if it imports the core symbol **and** calls it; strays outside `lib/`+`vendor/` fail; the vendor set is **measured** from `vendor/*/package.json`. Negative proof: a dual plant produced **8** findings and reverted exactly | — |
| ~~**A7**~~ | ~~Host seam~~ — **CLOSED as a MEASUREMENT** in rc.21: [HOST-PROVIDERS-SEAM.md](./HOST-PROVIDERS-SEAM.md). The seam is `providers: z.dict(profile)` with 4 wires; the catalog ships `opencode` (85 models) and `opencode-go` (32) but **none** of the router's four preset provider ids is a catalog route, and the seam models **profiles only** — so it **cannot replace this router**. Recommended: keep `llm-pi-ai` **dormant** | — |
| ~~**R8**~~ | ~~OpenCode-backend 404~~ — **CLOSED in rc.22**: the daemon's **LIST** route `GET /api/provider` is the **authoritative provider directory** and returns **both** `opencode` and `opencode-go` with **distinct** `settings.baseURL`s, while the **single-item** route serves only a **subset** (404 for the rest). `resolveBackend()` resolved **only** through the item route, so a directory-listed id became a **dead turn**. New `backendDirectory()` (one LIST fetch, indexed by `id`, cached with the same `credentialCacheMs`/`force` semantics as `backendCache`), `backendFromItem()` (**fallback only**) and the exported `noBackendEndpointError()`. `backendProviderForRoute()` is **byte-identical**; **per-provider cache keying is untouched**; `backendBaseUrl`/`apiKey` still short-circuit; **no** hardcoded model names, **no** `opencode-go` special-casing, **no** per-provider branch | `vendor/opencode/lib/http.js` |
| ~~**R9**~~ | ~~`build-presets.mjs` appends 1 byte per run~~ — **CLOSED in rc.22**: the regex now **owns its line terminator** (`^[ \t]*const PRESET_DECLARATIONS = .*\n?` — `[ \t]*` so the match cannot start on the preceding blank line, `\n?` so a final line without a newline still matches) and **ONE shared `normalizeDeclarationLine()` helper** is used by **BOTH** `declarationsAreCurrent()` and `bakePresetDeclarations()`. The `.replace(/\n$/, '')` hack is **removed**. The **defect class** was the gate/bake **divergence** — the gate could never see what the bake wrote. Measured: 3 consecutive runs byte-identical (`e53f6153…`); `--check` exits **1** on real drift and **0** after the revert; the full `npm run build` now produces **zero diff** | `scripts/build-presets.mjs` |

## 3c. CLOSED — the OpenCode-backend 404 (the provider DIRECTORY is authoritative)

**Status: CLOSED in rc.22.** The live symptom was:

```
opencode GET /api/provider/opencode-go -> HTTP 404: {"_tag":"ProviderNotFoundError","providerID":"opencode-go","message":"Provider not found: opencode-go"} OPENCODE_BACKEND
```

**The root cause was a LIST-vs-item misunderstanding, not a missing provider.**

| Route | Measured behaviour |
| :--- | :--- |
| `GET /api/provider` (**LIST**) | the **authoritative provider directory** — returns **BOTH** `opencode` and `opencode-go`, each with its **own** `settings.baseURL` and `headers` |
| `GET /api/provider/{id}` (**item**) | serves only a **SUBSET** of the ids the directory lists — a directory-listed id can still answer **404** `ProviderNotFoundError` here |

The old `resolveBackend()` resolved **every** endpoint through the **item route alone**. So an id
that the daemon genuinely serves, but does not serve *by item*, was reported as a missing
provider and the turn died as `OPENCODE_BACKEND` — a **dead turn** for a provider the daemon was
serving all along.

**The fix (a resolution, not a string substitution).** Three pieces in
`vendor/opencode/lib/http.js`:

| Piece | What it does |
| :--- | :--- |
| `backendDirectory(signal, { force })` | fetches the **LIST** route **once** and indexes the rows by `id`; cached with the **same** `credentialCacheMs` / `force` semantics as the existing `backendCache` |
| `backendFromItem(providerId, signal)` | the **fallback only**, used when the directory lacks the id; a **404** resolves to `null`, any **other** failure keeps its status (a 401 and a dead daemon are different problems) |
| `noBackendEndpointError(providerId, directory)` | **newly exported**; names the missing id, the ids the daemon **DOES** serve, and the two bypass keys (`backendBaseUrl` + `apiKey`, or `backendProviderId`) |

**What did NOT change, deliberately.**

- `backendProviderForRoute()` is **byte-identical** to rc.21 — the route→provider mapping is not
  where the bug was.
- **Per-provider cache keying is UNTOUCHED.** `backendCache` is still keyed by `providerId`, so a
  Zen route can never reuse the Go root. This is **load-bearing**, not incidental: a Zen route on
  the Go root answers **400** "Model is unavailable." and a Go route on the Zen root answers
  **402** "Insufficient account funds".
- `backendBaseUrl` / `apiKey` still **short-circuit** the control-plane lookup.
- There is **no** hardcoded model name, **no** `opencode-go` special-casing and **no** per-provider
  branch. The gate proves genericity with the neutral ids `alpha-route` / `beta-route`.

**The gate (new).** `vendor/opencode/test/backend-directory.test.mjs` — **11 cases**, including the
exact measured shape: the directory lists an id whose **item** route answers **404**, and
resolution still succeeds. The opencode vendor suite moved **554 → 565/565** (**+11**).

**Falsification (the gate is load-bearing, not decorative).** The new test file was run against
the **old** item-route-only resolution: **8 of 11** cases failed, including
`a provider listed by the directory resolves even when the item route 404s for it` and
`a turn on a directory-only provider is served by that provider root`.

## 4. What is open (details and criteria in ROADMAP.md)

| Tier | Item | One-line state |
| :--- | :--- | :--- |
| **P0** | **P0-1** Rotate the DeepInfra + EXAONE keys | **Owner-only**; the values must be revoked at the providers |
| **P0** | **P0-2** Credential-store migration | **Agent side DELIVERED and live-verified for DeepInfra**; owner half = rotate the **FOUR** refs + re-paste into `refs:` + restart + one turn each |
| **P0** | **P0-3** Post-migration secret-hygiene scan | Blocked on the rotation; read-only worker recipe on the board |
| **P1** | **P1-1** EXAONE turn through DSH | **Top-level PASS (owner)**; only the **child** proof is missing, and it needs a NEW session |
| **P1** | **P1-3** EXAONE in the subagent allowlist | Live edit **applied** (7 routes) + repo default; the remaining proof is a **child** call from a **NEW** top-level session (the allowlist freezes at `agent/created`, and a child inherits the parent's frozen list) |
| **P2** | ~~P2-1 data-only preset install~~ | **REMOVED 2026-11-14** — deleted as an unreachable promise (0 of 4 presets are data-only); replaced by the **P2-A** queue in ROADMAP.md §4 |
| **P2-A** | **Phase 1 + Phase 2** (core lock + vendor fan-out) | ✅ **DONE** — `c0e48ab`, `3ac7a10`, `c2ba900`, `ae9fd1d` (Phase 1) + `8ee4ef1` (Phase 2). Boundary verdict in §3b. |
| **P2-A** | **A3 — OpenCode onto the shared pipe** | ✅ **COMPLETE** (`e8b39f7`) — the legacy pipeline, the `pipe` config key and the vendor's own SSE reader are deleted (`http.js` 3 272 → **2 721 L**); `stream-parser.js` was measured to be **shared-path glue** and was **renamed** `notation-classifier.js`; the live shared-pipe turn is owner-verified. |
| **P2-A** | **A4 / A5 remnants** | ✅ **BOTH CLOSED** — **R2** (rc.21): OpenCode's private ledger now delegates to `lib/{cost,presets,usage}.js`; `numberOrNull` / `pickSession` / `USAGE_BUCKETS` / `usageTotal` are each defined **once** repo-wide. **R3** (`77a53b0`): one retry core, one catalog cache for every vendor. |
| **P2-A** | **A6 remnants** | ✅ **CLOSED** (`e8b39f7`) — `test/stream-boundary.test.mjs` (**15** cases), `scripts/verify-usage-readers.mjs` + `test/usage-readers.test.mjs` (**12** cases), and the dead `classifyBlock` slot removed. The **uniqueness greps** are now a **wired gate** → **R6 CLOSED** (rc.21). |
| **P2-A** | **R5 — no vendor ids in L1** | ✅ **CLOSED** (`77a53b0`) — `PLAN_PROVIDERS` moved to `lib/presets.js`; `lib/plan.js` vendor-id count **→ 0**; `test/plan-boundary.test.mjs` (**5 cases**) measures the vendor words from `vendor/*/package.json`. |
| **P2-A** | **A7 — host seam** (measure-first) | ✅ **CLOSED as a MEASUREMENT** (rc.21) — [HOST-PROVIDERS-SEAM.md](./HOST-PROVIDERS-SEAM.md): the seam models **provider profiles only**, so it **cannot replace this router**; **recommended: keep `llm-pi-ai` dormant** (owner decision, and the recommended option changes nothing). |
| **P2-A** | **R7 — tool-argument contract seam** (new, rc.21) | ✅ **SHIPPED** — `lib/stream/tool-argument-contract.js` (**163 L**) at the L1 emission point (`finalBlock`); the rule is **derived** from the host's `Required with <field>` schema prose; **five** vendor call sites pass `tools`; gate `test/tool-argument-contract.test.mjs` (**13 cases**). |
| **P2-A** | **R8 — OpenCode-backend 404** (new, rc.21) | ✅ **CLOSED in rc.22** — the daemon's **provider DIRECTORY** (`GET /api/provider`) is authoritative; the single-item route serves only a subset, so item-route-only resolution turned a served id into a dead turn. `backendDirectory()` + `backendFromItem()` (fallback) + exported `noBackendEndpointError()`; `backendProviderForRoute()` byte-identical; per-provider cache keying untouched. Gate `vendor/opencode/test/backend-directory.test.mjs` (**11 cases**); opencode **554 → 565/565**. See §3c. |
| **P2-A** | **R9 — build idempotency** (new, rc.21) | ✅ **CLOSED in rc.22** — `build-presets.mjs` grew `lib/client.src.js` **+1 byte per run** (measured at HEAD: **185 405 → 185 406 → 185 407 → 185 408** over 4 runs) because the regex never captured the trailing newline the bake wrote. The regex now owns its terminator and **one** `normalizeDeclarationLine()` helper serves **both** the gate and the bake. The residue (one stray blank line in `lib/client.src.js` and `lib/client.js`) was **restored to HEAD** and rebuilt — a full `npm run build` now produces **zero diff**. Gate `test/build-presets.test.mjs` (**3 → 8** cases). |
| **P2** | P2-2 `pipe:'shared'` default | ✅ **DONE** — the `pipe` config key is deleted entirely; no config selects a pipeline any more |
| **P2** | P2-3 canonical parser | ✅ **DONE** — the placement is recorded: `notation-classifier.js`, a vendor-local notation-quirk surface (single named export, one consumer) |
| **P2** | P2-5 S3 Antigravity usage per model group | **Not started** (owner deferred 2026-11-08) |
| **P2** | P2-6 S4 spec-only surfaces | **Not started** (blocked on owner approval) |
| **P2** | P2-8 EXAONE live catalog | **Not started**; waits on EXAONE publishing a listing endpoint |
| **P2** | ~~P2-4 conformance fixtures~~ | **Closed** — anthropic-messages + google-generative-sse replay offline; 3 of 5 wires covered |
| **P2** | ~~P2-7 deletions~~ | **Closed** (owner-approved) — dead module + its export entry and the broken profile symlink removed |
| **P2** | ~~P2-9 doc freshness~~ | **Closed** — docs corrected to the rc.20 baseline (this session) |

### Why the rotation covers FOUR keys, not two

The store's `refs:` **values** were printed into session transcripts by a worker. Measured over the
session store: every one of the four refs — `DEEPSEEK_API_KEY`, `OPENCODE_API_KEY`,
`DEEPINFRA_API_KEY`, `EXAONE_API_KEY` — appears in session transcripts. A value that has appeared in
a transcript must be treated as **disclosed**, so all four must be rotated, not only the two this
track migrated. **No value is reproduced here or in any other document.**

## 4. Next session order

1. **Owner:** rotate all **four** keys at their providers (P0-1 / P0-2), paste the replacements into
   `refs:` in `~/.dsh/.credentials.yaml`, then **restart once**. The store is hot, so a rotated
   value reaches the next request without a restart; the profile patch is read at boot.
2. **Owner:** after that restart, open a **NEW top-level session** and run the EXAONE **child**
   check on `exaone/k-exaone_v2.5` (P1-3). The allowlist freezes at `agent/created` and a child
   inherits the parent's frozen list, so an existing session cannot prove it.
3. **Owner/agent:** the post-migration secret-hygiene scan (P0-3).
4. **P2-A** — Phase 1 and Phase 2 are **done**; **A3 is COMPLETE**, **R4 is CLOSED** (both by
   `e8b39f7`), **R3 and R5 are CLOSED** (both by `77a53b0`: one retry core, one catalog cache,
   no vendor ids in L1), and **R2 and R6 are CLOSED** and **A7 is CLOSED as a measurement** (all
   three in rc.21: the OpenCode ledger rides the core, the uniqueness greps are a wired gate,
   and the host `dsh-llm-pi-ai` seam is measured and cannot replace this router). **The rc.22
   session closed the last two: R8** (the **OpenCode-backend 404** — now resolved from the
   daemon's authoritative provider **DIRECTORY**, with the single-item route as a fallback; see
   §3c) **and R9** (the **build chain is idempotent** — a full `npm run build` produces **zero
   diff**). **The P2-A queue is now EMPTY**; there is no remaining agent-side item on this track
   that is not owner-gated. The `llm-pi-ai` **owner decision** (keep it dormant) is still the
   owner's, but the recommended option changes nothing, so nothing is blocked on it.

## 5. Do not repeat these closed items

- The synthetic `OpenCode (config default)` model row — **closed 2026-11-14**. Do not re-add it as
  a picker entry. The `default` **pseudo-route** resolution (to `defaultModel`) is a separate,
  still-live behaviour and must not be removed with it.
- P1-4 pricing re-verification, P1-5 watch-baseline age, P1-6 four-preset smoke check — **done**
  (ROADMAP-ARCHIVE §2). Do not re-open them; extend the gate instead.
- The Gemini `thoughtSignature` "nested inside `functionCall`" shape is **wrong** and its live 400 is
  documented; do not "fix" it back.
- Phase A/C/D/E, S4b/S4c, the legacy profile link removal, the five-place preset model and
  `markerDeltas` are closed (ROADMAP-ARCHIVE §1–§3).

## 6. Commands

```bash
cd dsh-custom-router

npm test                 # 843: surface + specs + spec-watch + refresh expectations + conformance
                         #        + the L1 boundary lint + the usage-readers gate
                         #        + the plan-boundary lint
                         #        + the uniqueness gate (23) + the tool-argument contract gate (13)
npm run verify           # check + test + verify:stream + specs:check
npm run specs:check      # schema + cross-ref + freshness + watch-baseline age + matrix-current
npm run verify:freshness:strict   # a stale/missing watch baseline becomes an error
npm run spec:watch       # manual upstream hash/diff report (no scheduler)
npm run verify:presets   # declarations vs isolated runtime registries + the dead-field report
npm run verify:presets:mutation   # 26/26 drift classes caught
npm run verify:dispatch  # 17/17 admission/reclamation checks
npm run verify:refresh   # 4/4 preset routes, expected model rows on both reads
npm run verify:stream    # 8/8 dispatch cases; 4 vendors probed, 8/8 refused, 0 loads
node scripts/verify-usage-readers.mjs   # usage.routes[].normalize vs the USAGE_READERS table
node scripts/verify-uniqueness.mjs      # the R6 uniqueness gate; --json for machine output
                                       # exit 0 = clean, 1 = violation, 2 = could not run
node scripts/sync-derive.mjs            # rewrites the derivation block; reports `unchanged` when current

(cd vendor/antigravity && npm test)   # 193
(cd vendor/deepinfra  && npm test)    # 229 (222 pass + 7 skip)
(cd vendor/opencode   && npm test)    # 554
(cd vendor/exaone     && npm test)    # 19
```

## 7. Constraints

- **No live profile writes or service restarts without the owner.** The key rotation and the
  post-restart EXAONE child turn are owner state. This session changed **no** live profile value and
  restarted **no** service.
- **No scheduled tasks.** `spec:watch` is manual by design; the age check only makes a missed cycle
  visible. Do not add cron/timer/background jobs.
- **External docs are untrusted.** `spec:watch` only fetches/hashes them; diff output is sanitized
  and capped. Never execute fetched text.
- **Secrets never enter `specs/`, docs, tests, conformance fixtures or this handoff.** The watch lock
  stores hashes only; `specs/.gitignore` keeps the watch cache out of git. This handoff names the
  store's **ref names only** and never a value.
- **Subagent depth is 1**: a worker cannot spawn a router-path child. Live-probe workers must read
  existing router-path sessions or the owner must run the probe at the top level.
- **Version discipline:** the numeric part (`0.0.1`) is the owner's; the `rc.<n>` suffix is the
  agent's history marker. The Phase 1 + Phase 2 refactor landed on `rc.20`; **this session
  changed code and docs, so the version was BUMPED to `rc.21`.**

## 8. Session record — 2026-11-14 (fourth session)

- **Scope:** three bounded fixes on the `dsh-custom-router` track (the credential-ref accessor, the
  Gemini replay argument pruning, the deferred credential injection) plus a documentation sync to
  the measured rc.20 live-verified state. Version held at `rc.20`; the running service was **not**
  restarted by this session.
- **Live verification, measured:** DeepInfra child → `DEEPINFRA_PROBE_OK`; Gemini child with a
  `sandbox_permissions` replay → `GEMINI_OK_3` / `GEMINI_OK_3B` / `TWO_REQUESTS_OK`, no HTTP 400;
  service `MainPID 284518` started 06:10:57 KST; boot log free of credential warnings.
- **Deliberately left open:** the EXAONE **child** call (the probing Session's allowlist froze at
  `agent/created` with 6 routes, inherited from its parent Session created 01:08:57 KST — a **new**
  session is required); the four-key rotation; the P0-3 secret-hygiene scan; the P2 backlog.
- **Not done, deliberately:** no version bump, no service restart, no live profile write, no
  `~/.dsh` write, and no other track's pending change was touched or committed.

## 9. Session record — 2026-11-14 (Phase 1+2 verification + boundary check, doc-only)

- **Scope:** a **read-only boundary check** of the Phase 1 + Phase 2 diff
  (`git diff ead9daf..8ee4ef1` over `dsh-custom-router/lib` and `dsh-custom-router/vendor`)
  against [ARCHITECTURE-LAYERED.md](./ARCHITECTURE-LAYERED.md), plus a documentation sync
  and a new boot card. **No runtime code was changed**; no version bump; no `~/.dsh` write;
  no service restart; **no API key was read, printed or reproduced.**
- **Measured (independently re-run by this session, not quoted from the commit message):**
  router `npm test` **774/774**; `verify:stream` **8/8** with **4** vendored packages probed,
  **8/8** specifiers refused, **vendor loads 0**; `specs:check` OK (`5 protocols, 4 providers,
  4 pricing`); `verify:presets:mutation` **26/26**; vendor suites antigravity **193/193**,
  deepinfra **222 pass / 7 skip**, opencode **555/555**, exaone **19/19**.
- **Result:** the layering contract holds for the three standard protocols. The full verdict table
  is **§3b**. **Six follow-up tasks** were recorded (R1–R6) — none of them was fixed here, because
  this session is documentation-only.
- **Docs changed:** [ROADMAP.md](./ROADMAP.md) (phase matrix marked done with the commits and the
  measured numbers; A3 recorded as **PARTIAL** with the measured reason; A4/A5/A6 remnants and
  the R1–R6 queue; the evidence section re-measured), this file (§1 state table, §3 historical
  marker, §3b the verdict, §4 open items, §6 commands), the new boot card, and the regenerated
  doc indexes.
- **Deliberately left open:** the four-key rotation (P0-1/P0-2, owner); the EXAONE **child** turn
  from a NEW session (P1-3, owner); the post-migration secret-hygiene scan (P0-3); the live
  OpenCode **shared-pipe** turn (owner); A3's deletion (R1); A4/A5/A6 remnants (R2–R4, R6); the
  `PLAN_PROVIDERS` L1 exception (R5); A7 (measure-first, owner-gated).

> **Superseded by the next section.** A3's deletion (R1) and the A6 remnants (R4) are now
> **closed** by `e8b39f7`, and the live OpenCode shared-pipe turn is **owner-verified** after the
> 09:37:14 KST restart. See *A3 completion + R4 closure* above.

---

## 9b. Session record — 2026-11-14 (A3 completion + R4 closure, doc-only)

- **Scope:** a **documentation sync** of the `dsh-custom-router` track to the measured state after
  `e8b39f7` (A3 complete, R4 closed). **No runtime code was changed**; no version bump; no
  `~/.dsh` write; no service restart; **no API key was read, printed or reproduced.**
- **Measured (independently re-run by this session, not quoted from the commit message):**
  router `npm test` **802/802**; `verify:stream` **8/8** with **4** vendored packages probed,
  **8/8** specifiers refused, **vendor loads 0**; `specs:check` OK (`5 protocols, 4 providers,
  4 pricing`); `verify:presets:mutation` **26/26**; `verify:usage-readers` OK (4 presets /
  4 routes / 3 readers); vendor suites antigravity **193/193**, deepinfra **222 pass / 7 skip**,
  opencode **553/553**, exaone **19/19**. `vendor/opencode/lib/http.js` = **2 721 L** (from
  **3 272**); `vendor/opencode/lib/stream-parser.js` **does not exist**;
  `vendor/opencode/lib/notation-classifier.js` = **679 L** with **one** consumer
  (`stream-contract.js:58`).
- **Docs changed:** [ROADMAP.md](./ROADMAP.md) (A3 marked COMPLETE with the measured numbers, the
  rename and the parity-fixture supersession; R4 marked CLOSED; the R1/R4 rows struck from the
  P2-A queue; P2-2 / P2-3 marked done; the size table re-measured), this file (§1 state table,
  §1 live probes, §3b verdict rows, the new *A3 completion + R4 closure* subsection, §4 open
  items, §6 commands), [ARCHITECTURE-LAYERED.md](./ARCHITECTURE-LAYERED.md) (the OpenCode
  "violation example" and the `pipe:'legacy'` references updated to the completed state), the new
  boot card, and the regenerated doc indexes.
- **Deliberately left open:** the four-key rotation (P0-1/P0-2, owner); the EXAONE **child** turn
  from a NEW session (P1-3, owner); the post-migration secret-hygiene scan (P0-3); R2 (OpenCode
  ledger), R6 (the uniqueness greps are still a manual grep); A7 (measure-first, owner-gated).

> **Superseded by the next section.** **R3** (OpenCode retry + the two catalog caches) and **R5**
> (`PLAN_PROVIDERS` in L1) are now **closed** by `77a53b0`. See *R3 + R5 closed* above.

---

## 11. Session record — 2026-11-14 (R3 + R5 closure, doc-only)

- **Scope:** a **documentation sync** of the `dsh-custom-router` track to the measured state after
  `77a53b0` (**R3 closed**: one retry core, one catalog cache; **R5 closed**: no vendor ids in
  L1). **No runtime code was changed**; no version bump (held at `rc.20`); no `~/.dsh` write; no
  service restart; **no API key was read, printed or reproduced.**
- **Measured (independently re-run for this handoff, not quoted from the commit message):**
  router `npm test` **807/807**; `verify:stream` **8/8** with **4** vendored packages probed,
  **8/8** specifiers refused, **vendor loads 0**; `specs:check` OK (`5 protocols, 4 providers,
  4 pricing`); `verify:presets:mutation` **26/26**; `verify:usage-readers` OK (4 presets /
  4 routes / 3 readers); vendor suites antigravity **193/193**, deepinfra **222 pass / 7 skip**,
  opencode **554/554**, exaone **19/19**. `grep -rn "function backoffDelay\|function sleepFor"
  lib/ vendor/` → **2** hits, both in `lib/retry.js`; `grep -ciE "opencode|antigravity|deepinfra|
  exaone" lib/plan.js` → **0**; `vendor/opencode/lib/catalog-cache.js` **does not exist**
  (`catalog-file.js` **236 L** + `catalog-lifecycle.js` **181 L**).
- **Docs changed:** [ROADMAP.md](./ROADMAP.md) (R3 and R5 marked CLOSED with the measured
  numbers; the R3/R5 queue rows struck; A4/A5 result blocks updated to the completed state; the
  size table re-measured with the `77a53b0` column), this file (§1 state table, §3b verdict rows,
  the new *R3 + R5 closed* subsection, the follow-up table, §4 open items, §4 next-session order,
  §6 commands), [ARCHITECTURE-LAYERED.md](./ARCHITECTURE-LAYERED.md) (the OpenCode retry/cache
  violation lines and the `PLAN_PROVIDERS` line updated to the completed state), the new boot
  card, and the regenerated doc indexes.
- **Deliberately left open:** the four-key rotation (P0-1/P0-2, owner); the EXAONE **child** turn
  from a NEW session (P1-3, owner); the post-migration secret-hygiene scan (P0-3); **R2**
  (OpenCode's private cost ledger), **R6** (the uniqueness greps are still a manual grep);
  **A7** (the host `dsh-llm-pi-ai` seam — measure-first, owner-gated).

---

## 10. Session record — 2026-11-14 (architecture audit, doc-only)

- **Scope:** a **read-only** architecture audit of the `dsh-custom-router` track against the owner
  principle, plus the documentation rewrite it implies. **Documentation only** — no code, no test,
  no vendor, no version, no `~/.dsh` write, no service restart. The running service was **not**
  restarted and the version was **held** at `rc.20`.
- **Measured:** core `lib/stream/` = 764 L with a **614 L** Anthropic fork inside it; vendor `lib/`
  totals antigravity 5 216 / opencode 12 330 / deepinfra 3 950 / exaone 1 176; the OpenAI delta
  mapper is a **zero non-comment diff** between exaone and deepinfra (130 L each); core
  `cost.js`+`plan.js`+`usage.js` (531 L) are imported by **zero** vendors; the core has **no**
  retry module; `verify:stream` guards only **3 of 4** vendors.
- **Docs changed:** [ROADMAP.md](./ROADMAP.md) (P2-1 deleted, P2-A A1–A7 added, ordering stated),
  this file (§3 architecture audit). The former P2-1 is recorded as **removed, not closed** — it was
  an unreachable promise, not a delivered feature.
- **Corrections to the audit brief, measured and recorded in place:** (a) the `createHooks` seam
  **is** used, by OpenCode (`vendor/opencode/lib/http.js:2358`), not by nobody; (b) the EXAONE and
  DeepInfra OpenAI request projections are **6 of 8** functions byte-identical, not 8 of 8; (c)
  deleting a provider spec **fails** `verify-specs` (exit 1) — the hole is in the *content*
  mutations, which pass with exit 0; (d) `createCostStore` differs between the two ledgers, so it
  is not byte-identical.
- **No progress is claimed *by the audit itself*.** (Phase 1 and Phase 2 have since landed — see
  §3b and [ROADMAP.md](./ROADMAP.md) §6.) P0-1 (rotation), P0-3 (scan) and the EXAONE child
  verification remain open, exactly as before this audit.

---

## 12. Session record — 2026-11-14 (R2 + R6 closure, A7 measurement, tool-argument contract seam, sync-derive fix)

- **Scope:** verification, documentation sync and commit of the work that landed in this session:
  **R2** (OpenCode's ledger, plan table and usage constants now delegate to the core),
  **R6** (the uniqueness greps are now a **wired gate**), **A7** (the host `dsh-llm-pi-ai` seam,
  closed as a **measurement** — see [HOST-PROVIDERS-SEAM.md](./HOST-PROVIDERS-SEAM.md)), the new
  **tool-argument contract seam** (`lib/stream/tool-argument-contract.js`), and the
  **`sync-derive.mjs` idempotency fix**. **Version bumped `rc.20` → `rc.21`** (code and docs
  changed). **No** `~/.dsh` write, **no** service restart, **no** API key read, printed or
  reproduced, and **no other track's pending change** was touched or committed.
- **Measured (independently re-run by this session, not quoted from the commit message):**
  router `npm test` **843/843** (was **807/807** before this session: **+23** R6 gate,
  **+13** tool-argument-contract gate); `npm run verify` **exit 0**; `verify:stream` **8/8** with
  **4** vendored packages probed, **8/8** specifiers refused, **vendor loads 0**; `specs:check`
  OK (`5 protocols, 4 providers, 4 pricing`); **`node scripts/verify-uniqueness.mjs` clean,
  exit 0**; vendor suites antigravity **193/193**, deepinfra **222 pass / 7 skip**,
  opencode **554/554**, exaone **19/19**.
- **R2 evidence (measured, not asserted):** `numberOrNull` **2 → 1** (`lib/cost.js:145`),
  `pickSession` **2 → 1** (`lib/cost.js:229`), `USAGE_BUCKETS` **2 → 1** (`lib/usage.js:51`),
  `usageTotal` **2 → 1** (`lib/usage.js:75`); `createCostStore`/`createCostLedger` remain **3** =
  **1** core + **2** legitimate thin wrappers (DeepInfra + OpenCode).
- **R6 evidence (measured, not asserted):** a dual plant (**5** strays in `scripts/` + **3**
  vendor re-implementations) produced exactly **8** findings and reverted to a **0**-finding
  baseline; the tree hash is stable across a scan; no scratch file survives in `scripts/`.
- **A7 evidence:** the seam is `providers: z.dict(profile)` with **4** wires; pi-ai's installed
  catalog ships `opencode` (**85** models) and `opencode-go` (**32**) but **none** of the router's
  four preset provider ids is a catalog route; the seam models **profiles only** and therefore
  **cannot replace this router**.
- **Tool-argument contract evidence:** the host's `validateEscalationArgs` enforces the pairing on
  the **execution** path; the host's own schema prose spells the dependency **identically** on
  `dsh-tool-bash`, `dsh-tool-fs` and `dsh-tool-pwsh` (`Required with sandbox_permissions: …`);
  the seam sits at `finalBlock` (`lib/stream/index.js`) and **all five** vendor
  `normalizeStream` call sites pass `tools: options.tools`.
- **`sync-derive.mjs` evidence:** at HEAD the script appended **40 bytes** per run to the END
  line of `lib/client.src.js` with **no content change** (measured in an isolated copy:
  **188 602 → 188 762 bytes** over 4 runs, the END line growing **3 239 → 3 439 chars**; a full
  `npm run build` grew **+41 bytes/run**, the extra byte being `build-presets.mjs`); after the
  fix, three consecutive runs report `unchanged` with identical sha256. The resulting
  `lib/client.src.js` / `lib/client.js` diff against HEAD is **lossless whitespace-only** — the
  repo's own `stripCode()` comparison of HEAD vs the canonical rebuild is **byte-identical** for
  both files.
- **Docs changed:** [ROADMAP.md](./ROADMAP.md) (R2 / R6 / A7 marked CLOSED with their evidence;
  the two new items added), [ARCHITECTURE-LAYERED.md](./ARCHITECTURE-LAYERED.md) (the stale
  "R6 is still open" summary and gate list corrected; the L1 section describes the tool-argument
  contract seam), [WORKER-DISPATCH.md](./WORKER-DISPATCH.md) (the stale remaining-queue line
  corrected), this file (§1 state table, §1 shipped list, §3b verdict rows, the new §3c, the new
  closure subsection, the follow-up table, §4 open items, §4 next-session order, §6 commands, and
  this record), [HOST-PROVIDERS-SEAM.md](./HOST-PROVIDERS-SEAM.md) (new),
  [CHANGELOG.md](../CHANGELOG.md) (the `0.0.1-rc.21` section), and the regenerated
  [INDEX.md](./INDEX.md).
- **Deliberately left open:** the four-key rotation (P0-1/P0-2, owner); the EXAONE **child** turn
  from a NEW session (P1-3, owner); the post-migration secret-hygiene scan (P0-3); the
  **OpenCode-backend 404** (§3c — needs a fix at the **provider-id resolution seam**); and the
  **pre-existing** `build-presets.mjs` **+1 byte/run** growth (measured, a different script from
  the one this session fixed, and unchanged from HEAD). **Update (rc.22):** the last two are now
  **CLOSED** — see §3c and the R9 closure in §1; see also the §13 session record.

---

## 13. Session record — 2026-11-14 (R8 + R9 closure, build idempotency, rc.22)

- **Scope:** verification, documentation sync and commit of the work that landed in this session:
  **R9** (`scripts/build-presets.mjs` is idempotent — the build chain is a fixed point), the
  **build-residue cleanup** (the stray blank line the old bug left in `lib/client.src.js` and
  `lib/client.js`, restored to HEAD and rebuilt), and **R8** (the **OpenCode-backend 404** — the
  daemon's provider **DIRECTORY** is authoritative, not the single-item route).
  **Version bumped `rc.21` → `rc.22`** (code and docs changed). **No** `~/.dsh` write, **no**
  service restart, **no** API key read, printed or reproduced, and **no other track's pending
  change** was touched or committed.
- **Measured (independently re-run by this session, not quoted from a commit message):**
  router `npm test` **848/848**, **0 fail**; `npm run verify` **exit 0** (check + 848 tests +
  `verify:stream` + `specs:check` — `5 protocols, 4 providers, 4 pricing`); `verify:stream`
  **8/8** dispatch cases with **4** vendored packages probed, **8/8** specifiers refused,
  **vendor loads 0**; **`node scripts/verify-uniqueness.mjs` clean, exit 0**; vendor suites
  antigravity **193/193**, deepinfra **222 pass / 7 skip**, opencode **565/565**, exaone **19/19**.
- **Baseline of record (measured, not quoted).** HEAD `499e8f7` (rc.21) was checked out to an
  isolated copy and measured with the same commands: router **843/843**, opencode **554/554**,
  `test/build-presets.test.mjs` **3** cases, antigravity **193/193**, deepinfra **222 pass /
  7 skip**, exaone **19/19**. So the deltas are **+5** (router, all from `build-presets` **3 → 8**)
  and **+11** (opencode, all from the new directory gate). **An earlier brief quoted the router
  baseline as 843; the measured baseline at HEAD is 843 and the post-fix figure is 848 — the
  "843 was current" reading was correct for the *pre-fix* tree and wrong for the *post-fix* one.**
- **R9 evidence (measured):** at HEAD, four consecutive `node scripts/build-presets.mjs` runs grew
  `lib/client.src.js` **185 405 → 185 406 → 185 407 → 185 408** bytes — **exactly +1 byte per
  run**, code content unchanged. After the fix, three consecutive runs are **byte-identical**
  (md5 `e53f6153…`), each printing `unchanged`. `--check` **exits 1** on a planted real
  `lib/presets.js` drift and **exits 0** after the revert.
- **Build-idempotency evidence (measured):** `npm run build` followed by `git status --porcelain`
  produced **NO CHANGE** — **zero diff**. `lib/client.src.js` (**185 403 B** / **3 460 L**) and
  `lib/client.js` (**205 839 B** / **3 908 L**) are **byte-identical to HEAD** (`git diff --stat
  -- lib/client.src.js lib/client.js` is empty). The **residue** the old bug left — one stray
  blank line in each file (3461 vs 3460 lines) — was restored to HEAD and rebuilt, so the **full
  build chain** (`gen-locale` → `sync-derive` → `build-presets` → `build-client`) is now a
  **fixed point**.
- **R9 falsification (the gate is load-bearing):** the new `test/build-presets.test.mjs` was run
  against the **old** semantics (old regex `/^\s*const PRESET_DECLARATIONS = .*$/m`, old gate
  comparison `current === declarationSource().replace(/\n$/, '')`, old bake string) with the new
  export kept in place: **4 of 8** cases failed — `the declaration regex owns its line
  terminator`, `baking twice changes nothing the second time`, `a stale file is repaired in
  exactly one bake, then stays fixed`, and `the checked-in client source is already canonical,
  so a re-bake is identity`.
- **R8 evidence (measured):** the daemon's **LIST** route `GET /api/provider` is the
  **authoritative provider directory** and returns **both** `opencode` and `opencode-go` with
  **distinct** `settings.baseURL`s; the **single-item** route `GET /api/provider/{id}` serves only
  a **subset**, so a directory-listed id can still **404** there. The old item-route-only
  resolution turned such an id into a **dead turn** as `OPENCODE_BACKEND`. The new
  `backendDirectory()` fetches the LIST route **once** and indexes the rows by `id` (cached with
  the **same** `credentialCacheMs` / `force` semantics as `backendCache`);
  `backendFromItem()` is the **fallback only**; `noBackendEndpointError()` is newly **exported**
  and names the missing id, the ids the daemon **DOES** serve, and the two bypass keys.
  `backendProviderForRoute()` is **byte-identical** to rc.21. The **per-provider cache keying is
  untouched** — load-bearing, because a Zen route on the Go root answers **400** "Model is
  unavailable." and a Go route on the Zen root answers **402** "Insufficient account funds".
  `backendBaseUrl` / `apiKey` still short-circuit. **No** hardcoded model names, **no**
  `opencode-go` special-casing, **no** per-provider branch.
- **R8 falsification (the gate is load-bearing):** the new
  `vendor/opencode/test/backend-directory.test.mjs` was run against the **old** item-route-only
  resolution: **8 of 11** cases failed, including `a provider listed by the directory resolves
  even when the item route 404s for it` and `a turn on a directory-only provider is served by that
  provider root`. The **3** that still passed are exactly the **fallback** cases
  (`an empty directory falls back to the single-item route`, `a daemon without a directory route
  resolves through the item route`, and the pure error-factory unit test) — which is the correct
  shape for a fallback-only path.
- **Docs changed:** [ROADMAP.md](./ROADMAP.md) (R8 / R9 marked CLOSED with their measured
  evidence; the header summary, the two inline summary lines, the §7 evidence block and the size
  table updated with an **rc.22** column and a correction-of-record for the baseline),
  [ARCHITECTURE-LAYERED.md](./ARCHITECTURE-LAYERED.md) (the build-idempotency gate added to the
  enforcement list and the provider-resolution seam noted), this file (§1 state table, §1 shipped
  list, the rewritten §3c, the follow-up table, §4 open items, §4 next-session order, and this
  record), [CHANGELOG.md](../CHANGELOG.md) (the `0.0.1-rc.22` section), and the regenerated
  [INDEX.md](./INDEX.md).
- **Deliberately left open:** the four-key rotation (P0-1/P0-2, owner); the EXAONE **child** turn
  from a NEW session (P1-3, owner); the post-migration secret-hygiene scan (P0-3). **Nothing else**
  on this track is open — the P2-A queue is empty.
- **Not done, and why:** no live OpenCode turn was re-run after the R8 fix. The R8 gate proves the
  resolution against a **fake daemon** that reproduces the measured directory/item shape
  (including the 404 body), and the live daemon was **not** contacted — this session was scoped to
  verification, docs and a commit, and a live turn would need the service to pick up the new
  vendor code (a restart, which is owner-gated). The next owner restart therefore also becomes
  the live proof of R8.
