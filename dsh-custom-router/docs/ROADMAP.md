# Custom Router — Active Roadmap

<!-- skeleton:
version: 1.1
kind: plan
status: active
updated: 2026-11-14
summary: The only active roadmap for @nolit/dsh-custom-router at 0.0.1-rc.20. Old Phase/Step plans are closed or superseded and live in ROADMAP-ARCHIVE.md; this file keeps P0 security, P1 operating verification, and P2 backlog items with a planning intent and a completion criterion each. The 2026-11-14 architecture audit replaced the unreachable "data-only preset install" promise (former P2-1, deleted) with a measured P2-A queue of seven protocol-pipe consolidation tasks (A2 -> A1 -> A3 -> A4 -> A5 -> A6, A7 independent).
-->

> This is the **only** document that lists active work. Historical phases are in
> [ROADMAP-ARCHIVE.md](./ROADMAP-ARCHIVE.md); current state and next actions are in
> [HANDOFF.md](./HANDOFF.md). Do not execute a Phase/Step list from an older design doc.

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
  `stream-contract.js`. `verify:stream` proves the core runs with zero vendor loads — but only
  against **3 of 4** vendors (`scripts/verify-stream.mjs:23` does not guard `dsh-exaone`). OpenCode
  still defaults its request path to `pipe: 'legacy'`; the shared path exists and is test-proven.
  The 2026-11-14 architecture audit measured that the pipe is **not** yet thin: one protocol
  (Anthropic, 614 L = 44.6 % of the 764-line core) is forked inside it, and the four vendors carry
  a measured **681-line** duplicated OpenAI wire across two vendors. The consolidation queue
  is **§4 P2-A**.
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

### P2-A. Architecture consolidation — 3 standard protocol pipes

> **Owner principle.** LOWER layer = a thin standardised shared pipeline for OpenAI / Anthropic /
> Gemini. UPPER layer = thin vendor/preset adapters that carry **vendor quirks only**.
>
> **Audit verdict 2026-11-14: the principle is not met.** The core pipe
> (`lib/stream/` = **764** lines across `index` 343, `sse` 180, `usage` 90, `wire` 68, `failure` 83)
> is protocol-agnostic in code — zero protocol branches — **but `lib/stream/anthropic.js` is 614
> lines = 44.6 % of the core**: one protocol is forked *inside* the lower layer. And the upper
> layer is not thin: the four vendors carry **22 672** lines of `lib/` (antigravity 5 216, opencode
> 12 330, deepinfra 3 950, exaone 1 176) between them, with a measured **681-line** duplicated
> OpenAI wire in two of them.

**Ordering: A2 → A1 → A3 → A4 → A5 → A6.** A7 is **independent** and measure-first.

---

#### A1 — one Anthropic wire in the shared pipe

- **Measured evidence.**
  - `lib/stream/anthropic.js` = **614** lines = **44.6 %** of the 764-line core.
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

#### A3 — OpenCode onto the shared pipe

- **Measured evidence.**
  - `vendor/opencode/lib/http.js:302` — `pipe: Schema.union(['legacy','shared']).default('legacy')`.
    The shared path is **not** the default.
  - `vendor/opencode/lib/http.js:2284` — `parser: 'legacy'` is a **hardcoded literal** (not read
    from config).
  - Legacy loop `http.js:2091-2245`; own SSE reader `http.js:440-499`;
    `vendor/opencode/lib/openai-mapping.js:14-92` (own usage writer **14-29** + own finish table
    **34-92**); own tool-call assembly `http.js:1590-1924` (**335 lines**).
    Deleting the legacy loop + own SSE reader + `openai-mapping.js:14-92` = **629 lines**.
  - `vendor/opencode/lib/stream-parser.js` = **679 lines** and **the core has no parser slot for
    it**.
  - `vendor/opencode/lib/http.js` alone = **3 073 lines**; opencode `lib/` total = **12 330**.
  - **Correction to the audit brief.** The brief says the `createHooks` seam "is used by NOBODY".
    Measured: `vendor/opencode/lib/http.js:2358` **does** use it
    (`createHooks: () => ({ ...hooks, readEvent: readEventWithCost, flush: composedFlush })`) — but
    only inside the **non-default** `shared` branch (`http.js:2066`), so the seam is exercised only
    when `pipe: 'shared'` is explicitly selected.
  - The brief says "only 106 of the 681 core lines OpenCode 'consumes' are live". Measured: the
    live path is the **legacy loop**, which uses **zero** lines of `lib/stream/`; the `shared`
    branch does consume the core. The measured claim stands in substance (the shared pipe is
    proven but not served) but the "106 of 681" figure was **not independently re-derived here**.
- **Owner-principle reason.** One vendor serving a second, private protocol implementation defeats
  the shared pipe: the "one standard" claim is false for exactly the vendor with the largest
  surface. 3 073 lines in one adapter file is the opposite of a "thin vendor adapter".
- **Concrete moves / deletes.**
  1. Flip the `pipe` default to `'shared'` (`http.js:302`) and remove the `parser: 'legacy'`
     literal (`http.js:2284`).
  2. Delete the legacy loop `http.js:2091-2245`, the own SSE reader `http.js:440-499`, and
     `openai-mapping.js:14-92` — **629 lines** in total.
  3. **Decide and record** where `stream-parser.js` (**679 lines**) belongs — the core currently
     has **no parser slot** for it. Either add a parser slot to the core, or move the file under
     the vendor's own quirk surface and say so in writing. This decision is **not** made here; it
     is a required recorded outcome of A3.
  4. Move the **335-line** tool-call assembly onto the core's part assembler.
- **Acceptance criteria (gate-provable).**
  - opencode suite **555/555** green.
  - `npm run verify:stream` green.
  - **One live turn** on an OpenCode route through the shared pipe.
  - A **parity fixture** replays one recorded OpenCode response through the legacy and the shared
     path and asserts identical stream parts, usage buckets, finish reason and failure code.
  - A grep gate proves the `parser: 'legacy'` literal and the `pipe` default `'legacy'` are gone.

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

### P2-2. Flip OpenCode's `pipe: 'shared'` default — **superseded by A3**

- **Status:** **not started; folded into [A3](#a3--opencode-onto-the-shared-pipe)** on 2026-11-14.
  A3 covers this item's scope (the `pipe` default at `http.js:302`) **and** the legacy-loop removal
  it implicitly needs, so it is tracked there rather than twice.
- **Why:** the shared path is implemented and test-proven, but the default remains `legacy`; two
  stream implementations still exist in the serving path.
- **Done when:** one owner-verified live turn runs with `pipe: 'shared'`, the legacy path is either
  removed or kept as a documented fallback, and `verify:stream` stays green.

### P2-3. Canonical parser (the only genuinely unstarted Phase F item) — **superseded by A3**

- **Status:** **not started; folded into [A3](#a3--opencode-onto-the-shared-pipe)** on 2026-11-14.
  The audit measured that the core has **no parser slot** for
  `vendor/opencode/lib/stream-parser.js` (679 L), so "a canonical parser" is not one task but a
  **recorded placement decision** — which A3 requires as an outcome.
- **Why:** `vendor/opencode/lib/http.js:2284` hardcodes `parser: 'legacy'`; the canonical parser is
  not implemented. Without it, the “one protocol standard” claim is incomplete for OpenCode.
- **Done when:** a canonical parser exists behind a config seam, parity fixtures cover it, and the
  prose/glyph/`content_filter` gates named in the old Phase F are measurable.

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
3. **P2-A** in the measured order **A2 → A1 → A3 → A4 → A5 → A6** (A7 is independent and
   measure-first):

   | # | Task | Why it sits here |
   |---|---|---|
   | 1 | **A2** — one OpenAI wire profile | **First**: it is pure duplication removal with no behaviour change, and it establishes the core-module pattern (a protocol profile in `lib/stream/`) that A1 then reuses for Anthropic. Doing A1 first would build the pattern twice. |
   | 2 | **A1** — one Anthropic wire in the shared pipe | Second: it is the largest single violation (614 L = 44.6 % of the core) and it needs the A2 pattern. It also closes the `dsh-exaone` guard gap and the `totalFormula` vocabulary split, which A6's gates depend on. |
   | 3 | **A3** — OpenCode onto the shared pipe | Third: it needs the core seams A1/A2 finish (the `createHooks` seam and the OpenAI profile). It is the only task that requires a live turn, so it comes after the low-risk A2. |
   | 4 | **A4** — one cost/plan/usage accounting | Fourth: independent of the wire work, but it reads the usage projections A1/A2 normalise, so it lands after them. |
   | 5 | **A5** — one retry/backoff + one catalog cache | Fifth: pure mechanics, no wire coupling. |
   | 6 | **A6** — delete dead surfaces + close the gates | **Last**: the new gates must assert the *final* shape of the core and the four vendors, so they cannot be written before A1–A5 land. |
   | — | **A7** — the host `dsh-llm-pi-ai` providers seam | **Independent** and **measure-first**: it is a *measurement* task about a seam in another package, so it does not block or get blocked by A1–A6. It may run in parallel. |

4. The remaining **P2** items keep their own order and gates: **P2-2** and **P2-3** are superseded by
   **A3** (tracked there); **P2-5** (S3, owner deferred 2026-11-08) and **P2-6** (S4, blocked on owner
   approval) stay owner-gated and are not in the P2-A queue; **P2-8** (EXAONE live catalog) waits on
   the platform. P2-4 is split into Anthropic and Google fixtures (a single worker ran out of
   context doing both).

## 7. Evidence

Current gates (measured 2026-11-14, after rc.20 and the three fixes): router `npm test` **649/649**,
`npm run verify` exit 0 (check + 649 tests + `verify:stream` + `specs:check` — `5 protocols, 4
providers, 4 pricing` — OK), `verify:presets` OK (`OK: preset declarations, the browser registry,
the locales and the runtime registries all agree`; runtime providers `deepseek-account, antigravity,
deepinfra, deepinfra-anthropic, exaone, opencode-http-agent`). Vendor suites: antigravity **193/193**
(+3 from `642ee06`), deepinfra **222 pass / 7 skip** (229 total), opencode **555/555**, exaone
**19/19**.

The **synthetic `OpenCode (config default)` row** is closed: it was produced in
`vendor/opencode/lib/http.js` (the `models` config default and the `listModels` prepend) and in
`vendor/opencode/lib/provider.js` (same two places). Both are removed; the `default` pseudo-route
still resolves server-side to `defaultModel`, and that behaviour is unchanged. Producer grep count
for the label is **0**; `test/model-catalog-default-row.test.mjs` (4 tests) asserts the absence in
the config default, the discovered list and the fallback list, and the vendor test
`listModels hides routes outside enabledModels and never lists the synthetic default row` now
asserts absence too.
