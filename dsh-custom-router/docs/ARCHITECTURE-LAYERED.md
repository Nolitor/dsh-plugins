# Custom Router — Horizontal Layered Architecture

<!-- skeleton:
version: 1.2
kind: design
status: active
updated: 2026-11-14
summary: Horizontal L0–L4 architecture for @nolit/dsh-custom-router: exact L1 protocol interfaces (OpenAI/Anthropic/Gemini), L2 vendor contract, core-lock gates, and static enforcement. A3 is complete (one OpenCode pipeline); the L1 boundary, USAGE_READERS and uniqueness gates are shipped; the L1 emission point now reconciles tool arguments against the host's declared contracts (the tool-argument contract seam).
-->

> **Design target (owner principle, 2026-11-14).** LOWER layer = a thin, standardized shared
> pipeline for the three standard protocols (**OpenAI / Anthropic / Gemini**). UPPER layer = thin
> vendor/preset adapters that translate **vendor quirks only** and hand off to the lower pipeline.
>
> Measured baseline: `@nolit/dsh-custom-router@0.0.1-rc.21` (audit base `ead9daf`,
> [HANDOFF.md](./HANDOFF.md) §3). **Current state:** Phase 1 + Phase 2 are done and **A3 is
> complete** (`e8b39f7` — one OpenCode pipeline, no `pipe` config key). Active execution order
> lives in [ROADMAP.md](./ROADMAP.md) §4; worker packages live in
> [WORKER-DISPATCH.md](./WORKER-DISPATCH.md).

---

## 1. Layer Map and Dependency Arrows

The router track is split into five horizontal layers (**L0 → L4**). Cross-layer calls flow strictly
downward; no lower layer may import, name, or branch on a higher layer.

| Layer | Name | Code home (current / target) | Responsibility (one paragraph each) |
|---|---|---|---|
| **L0** | Transport & SSE framing | [lib/stream/sse.js](../lib/stream/sse.js), target `lib/retry.js` | Converts byte streams (`Response`, `ReadableStream`, async iterables) into decoded JSON event objects under explicit framing and malformed-record rules (`\r\n\r\n` / `\n\n`, multi-line `data:`, optional `event:` tag folding, `: keep-alive` skip, `[DONE]` termination, EOF flush) and handles bounded transport-only HTTP retry/backoff per [RETRY-POLICY.md](./RETRY-POLICY.md). L0 holds zero protocol semantics and zero vendor names. |
| **L1** | Common protocol cores | [lib/stream/index.js](../lib/stream/index.js), [usage.js](../lib/stream/usage.js), [wire.js](../lib/stream/wire.js), [failure.js](../lib/stream/failure.js), [anthropic.js](../lib/stream/anthropic.js), target `lib/stream/openai.js`; plus [cost.js](../lib/cost.js), [plan.js](../lib/plan.js), [usage.js](../lib/usage.js), target `lib/catalog-cache.js` | Owns the standardized downstream `normalizeStream` state machine, disjoint `TokenUsage` calculation (`TOTAL_FORMULAS`), the six-way finish table, the `LlmFailure` taxonomy, the three standard protocol wire profiles (**OpenAI**, **Anthropic**, **Gemini**), and cross-vendor accounting/cache primitives. L1 executes exclusively against descriptors, pure hooks, and decoded payloads; it never knows which vendor produced the stream. |
| **L2** | Vendor coordination | [vendor/antigravity/lib/](../vendor/antigravity/lib/), [vendor/deepinfra/lib/](../vendor/deepinfra/lib/), [vendor/exaone/lib/](../vendor/exaone/lib/), [vendor/opencode/lib/](../vendor/opencode/lib/) | Translates **vendor quirks only**: auth shapes (OAuth token refresh, `credentialRef` resolution, Bearer headers), endpoint URLs and request/response envelopes (e.g., CloudCode wrapper, daemon endpoints), parameter oddities (`EXAONE_EFFORT`, `chat_template_kwargs`, 16-stop cap, `thoughtSignature` replay/pruning, OpenCode `reasoningField` / text-tool classifier), catalog/quota RPCs, and CLI/subagent/tool surfaces, then hands off to L1. |
| **L3** | Preset, registry & gates | [lib/presets.js](../lib/presets.js), [preset-schema.js](../lib/preset-schema.js), [preset-derive.js](../lib/preset-derive.js), [preset-drift.js](../lib/preset-drift.js), [driver/contract.js](../lib/driver/contract.js), [index.js](../lib/index.js), [specs/](../specs/README.md), [scripts/](../scripts/) | Owns preset declarations, mount/bridge wiring, allowlist defaults, credential-store migration, driver contract validation, living-spec matrices, and verification gates (`verify:stream`, `verify:presets`, `verify:dispatch`, `specs:check`). L3 validates shapes and routes mounts; it never carries protocol parsing, stream normalization, or vendor wire logic. |
| **L4** | Browser & UI | [lib/client.src.js](../lib/client.src.js) → [client.js](../lib/client.js), `vendor/*/lib/client.js`, [locale/](../locale/) | Renders the Custom Router dashboard, model picker rows, and usage/plan cards from L3-derived artifacts (`MODEL_PRESETS`, locale tables) and L2 HTTP status endpoints (`USAGE_READERS`). L4 never imports L1/L2 server modules and never parses provider wire payloads. |

### Arrow rules (normative)

```text
  L4 (Browser / UI) ──── reads derived facts / HTTP ────▶ L3 (Preset / Registry) & L2 (Vendor HTTP routes)
  L3 (Preset / Gates) ── validates contracts / mounts ──▶ L2 (Vendor entrypoints) & L1 (Driver descriptors)
  L2 (Vendor adapters) ─ calls shared pipe & utils ─────▶ L1 (Protocol cores) ──▶ L0 (SSE / Retry)
```

1. **L2 may call L1 and L0.** Every vendor adapter imports `@nolit/dsh-custom-router/stream` (and core
   cost/retry/cache modules once locked) instead of keeping a vendor-local copy.
2. **L1 must never know L2.** Zero static or dynamic imports from `vendor/*`, zero vendor/provider
   identifiers in code or error strings, zero per-vendor conditional branches.
3. **L3 never carries protocol logic.** `lib/presets.js`, `lib/preset-schema.js`, and
   `lib/driver/contract.js` declare and validate shapes; they never parse SSE frames or assemble
   `StreamChunk`s.
4. **L0 knows neither L1 protocol quirks nor L2 vendors.** `readSseEvents` only decodes SSE framing
   (supporting `event:` name preservation for Anthropic alongside `data:`).

---

## 2. L1 Exact Interface Spec (Grounded in Measured Code)

The shared downstream contract lives in [lib/stream/index.js](../lib/stream/index.js),
[lib/stream/sse.js](../lib/stream/sse.js), [lib/stream/usage.js](../lib/stream/usage.js),
[lib/stream/wire.js](../lib/stream/wire.js), [lib/stream/failure.js](../lib/stream/failure.js), and
[lib/driver/contract.js](../lib/driver/contract.js).

### 2.1 Descriptor (`descriptor`)

Every L1 stream invocation receives an immutable descriptor describing the wire shape:

```ts
interface StreamDescriptor {
  toolCallShape: 'fragmented' | 'complete'
  usage: {
    totalFormula: 'prompt+output' | 'prompt+output+reasoning' | 'input+output+cache'
  }
  malformedRecord: 'fail' | 'skip' // default in normalizeStream/sse: 'fail'
}
```

- `toolCallShape` ([lib/stream/index.js:78-79](../lib/stream/index.js#L78-L79),
  [lib/driver/contract.js:13](../lib/driver/contract.js#L13)):
  - `'fragmented'` — identity (`id`/`name`) and JSON argument slices arrive across multiple deltas
    keyed by wire `index` (OpenAI, Anthropic).
  - `'complete'` — whole `functionCall` arrives in one part with an `args` object; the pipe
    stringifies it once (Gemini).
- `usage.totalFormula` (reconciling the measured split between
  [lib/driver/contract.js:14](../lib/driver/contract.js#L14) and
  [lib/stream/usage.js:23-28](../lib/stream/usage.js#L23-L28)):
  - `'prompt+output'` — OpenAI: `total_tokens === prompt_tokens + completion_tokens` (cache is
    folded inside `prompt_tokens`; reasoning is inside `completion_tokens`).
  - `'prompt+output+reasoning'` — Gemini: `totalTokenCount === promptTokenCount + candidatesTokenCount + thoughtsTokenCount`.
  - `'input+output+cache'` — Anthropic: `input_tokens` excludes cache reads/writes, so total is
    `input + cacheRead + cacheWrite + output`.
  - **Fix required in Phase 1 (A1):** unify `lib/driver/contract.js:14` and `lib/stream/usage.js:23-28`
    to accept all three canonical formula names (eliminating the dead `'gemini'` alias that
    `usageFrom` currently rejects).
- `malformedRecord` ([lib/stream/sse.js:6-7,36-37](../lib/stream/sse.js#L6-L7)): `'fail'` throws
  `PROTOCOL_DEFECT` on malformed JSON (default for all current providers because skipping truncates a
  turn); `'skip'` ignores undecodable frames.

### 2.2 Hooks (`hooks`) and `createHooks` Factory

```ts
interface StreamHooks {
  // Mandatory: decode one wire payload into normalized pipe records
  readEvent(
    payload: unknown,
    ctx: { descriptor: StreamDescriptor; usageFormula: string },
  ): PipeRecord | undefined | null

  // Optional overrides (defaults live in L1)
  mapFinish?(rawFinish: unknown, ctx: { descriptor: StreamDescriptor }): FinishReason
  usageFrom?(rawUsage: unknown, ctx: { formula: string }): TokenUsage | undefined
  classifyText?(text: string, ctx: { descriptor: StreamDescriptor }): PipePart[] | undefined
  classifyReasoning?(text: string, ctx: { descriptor: StreamDescriptor }): PipePart[] | undefined
  flush?(ctx: { descriptor: StreamDescriptor }): PipePart[] | undefined
  onPart?(part: PipePart, ctx: { descriptor: StreamDescriptor }): void
  onMalformed?(defect: DefectInfo, ctx: { descriptor: StreamDescriptor }): 'skip' | void
  onEmpty?(ctx: { usage?: TokenUsage; finish: FinishReason }): FinishChunk
  onCut?(failure: LlmFailure, ctx: { blocks: number; sawTool: boolean }): FinishChunk
}

type CreateHooks = (ctx: { descriptor: StreamDescriptor; signal?: AbortSignal }) => StreamHooks
```

- `PipeRecord` ([lib/stream/index.js:103-128](../lib/stream/index.js#L103-L128)):
  `{ parts?: PipePart[], usage?: unknown, finish?: unknown, defect?: { code?, message? }, done?: boolean }`.
- `PipePart`:
  - `{ kind: 'text', text: string }`
  - `{ kind: 'reasoning', text: string }`
  - `{ kind: 'tool-call', index?: number, id?: string, name?: string, argumentsDelta?: string, arguments?: string | object, thoughtSignature?: string }`
- `createHooks` ([lib/stream/index.js:53-55,67-76](../lib/stream/index.js#L53-L55)): called **once per
  stream** before any payload is read and takes precedence over `hooks`. Pure stateless providers pass
  `hooks`; stateful providers (Anthropic's two-piece usage + per-block thinking signatures; OpenCode's
  split-marker text classifier + `flush`) supply `createHooks` so concurrent streams never share
  mutable state.

### 2.3 Entry Point: `normalizeStream`

```js
normalizeStream({ events, descriptor, hooks, createHooks, signal, onUsage })
// -> AsyncGenerator<StreamChunk>
```

**Core invariants guaranteed by L1** ([lib/stream/index.js:8-14,100-247](../lib/stream/index.js#L8-L14)):

1. **One block lifecycle:** `nextIndex` allocates first-seen block indexes (`block-start` → deltas →
   `block-end` in allocation order). Fragmented tool calls remain silent (not in `started`) until an
   `id` or `name` arrives, so a nameless call never emits an orphan `block-end`. Complete calls
   stringify object `arguments` once.
2. **Usage-before-finish:** Every `usage` chunk is emitted strictly before the terminal `finish`
   chunk; `onUsage?.(normalized, { descriptor, hooks })` fires immediately on arrival so ledgers
   persist even if the host stops iterating at `finish`. `totalTokens` is emitted **only** when the
   provider's own total matches `TOTAL_FORMULAS[usageFormula]`; absence is never turned into `0`.
3. **Empty completion in-band, never thrown:** If `failure === undefined` and `started.size === 0`,
   the pipe emits `emptyCompletion()` (`{ type: 'finish', reason: { kind: 'error', failure: { code: 'EMPTY_RESPONSE', ... } } }`),
   or `hooks.onEmpty`.
4. **Abort as a terminal kind:** When `signal?.aborted` or an `AbortError` is caught, open blocks are
   closed, accumulated `usage` (if any) is emitted, and `abortedCompletion()` emits
   `{ type: 'finish', reason: { kind: 'aborted', failure: { code: 'ABORTED', ... } } }`.
5. **One finish table:** `finishReasonFor(value)` ([lib/stream/wire.js:18-57](../lib/stream/wire.js#L18-L57))
   owns the six-way mapping (`stop`, `tool-calls`, `max-tokens`, `CONTENT_FILTERED`,
   `PROVIDER_RESOURCE`, `UNKNOWN_FINISH_REASON`), and `promote()` converts `stop` → `tool-calls` when
   `sawTool === true`.
6. **One failure taxonomy:** `CODES` ([lib/stream/failure.js:13-21](../lib/stream/failure.js#L13-L21))
   defines the seven stable machine codes; every failure carries `{ message, code }`. A
   `PROTOCOL_DEFECT` rethrows; any non-abort stream interruption after partial output emits in-band
   `cutCompletion(failure)`.
7. **One emission point, and one argument contract applied there:** the `block-end` block produced
   by `finalBlock` is the block the host **executes** (the host's `BlockAssembler` keeps
   `partial.block` and ignores the accumulated `tool-call-delta` text once a block closes), so it
   is also the one place where a tool call's arguments can be made **executable**. That is where
   the **tool-argument contract seam** lives — see §2.3a.

### 2.3a The tool-argument contract seam (L1 emission point)

**The rule L1 now enforces at the emission point:** a streamed tool call's arguments must satisfy
the **host's** execution contracts, not only the **provider's** schema.

**Why it is needed at all.** The host (`@deepseek-ai/dsh-sandbox` `validateEscalationArgs`)
enforces argument **pairings** on the **EXECUTION** path:

- `sandbox_permissions` defined, `justification` undefined → *"sandbox_permissions requires a
  justification"*;
- `justification` defined, `sandbox_permissions` undefined → *"justification is only valid
  together with sandbox_permissions"*;
- `justification` defined but blank after trim → *"expected a non-empty sentence"*.

A **provider schema cannot express** a pairing, so a drifted call survived the wire and was
refused at execution — where the model could not see it coming. Measured live: a Gemini/Antigravity
subagent run died with `Error: invalid escalation: justification is only valid together with
sandbox_permissions`.

**Why L1 and not a vendor.** Every vendor hands its tool calls to the **ONE** shared pipe
(`normalizeStream`), and the pipe's `block-end` block is authoritative for execution. One function
at the single emission point therefore covers all four vendors **and** any future one; a
per-vendor patch would have to be written four times and would go stale for the fifth. The module
([lib/stream/tool-argument-contract.js](../lib/stream/tool-argument-contract.js), **163 L**) carries
**no vendor name, no model name and no per-vendor branch**, so §2.5 rule 1 and rule 6 are
untouched.

**Why the rule is derived, not hardcoded.** The pairing is a **host** contract, and the host states
its pairings the only way JSON Schema allows — in the dependent field's `description`, with the
stable phrase `Required with <other_field>`. Measured **identically** on `dsh-tool-bash`,
`dsh-tool-fs` and `dsh-tool-pwsh`. The module reads that phrase out of the tool schema the
**request itself carries**, so the rules come from the declared contract rather than from a field
list maintained here. A future host contract phrased the same way is covered with **no edit**; a
field hardcoded here would silently miss it.

**The repair direction (deliberately narrow).**

| Shape | What happens | Why |
| :--- | :--- | :--- |
| dependent present, principal **absent** | the dependent is **dropped** | the principal is what grants wider access, so a lone reason asks for nothing; dropping it turns an unrunnable call into the un-escalated call the model would have made anyway |
| principal present, dependent present but **blank** | the escalation is **kept**, the blank dependent is **dropped** | the model DID ask for wider access, so the escalation stands and the host then names the missing reason |
| a well-formed pair | **preserved byte-for-byte** | the repair must not quietly strip a legitimate permission request |
| nothing to repair | returned by **identity** (same reference, no copy) | no needless allocation on the hot path |

**Nothing here fabricates a justification.** A fabricated approval reason would be a **safety
regression**, not a repair.

**Plumbing.** `finalBlock` in `lib/stream/index.js` reconciles against the schema map built from
`options.tools`; all **five** vendor `normalizeStream` call sites pass `tools: options.tools`
(`vendor/antigravity/lib/adapter.js:294`, `vendor/deepinfra/lib/adapter.js:229`,
`vendor/deepinfra/lib/anthropic-adapter.js:263`, `vendor/exaone/lib/adapter.js:147`,
`vendor/opencode/lib/http.js:1950`). The gate is
`test/tool-argument-contract.test.mjs` (**13 cases**) — see §6 gate 4.

### 2.4 Protocol Profiles (OpenAI / Anthropic / Gemini)

| Protocol | Target L1 Descriptor | L1 Hooks / Profile | L1 Request Helpers |
|---|---|---|---|
| **OpenAI** (`lib/stream/openai.js`, target in A2) | `toolCallShape: 'fragmented'`, `usage: { totalFormula: 'prompt+output' }`, `malformedRecord: 'fail'` | `readOpenAiEvent` (reads `choices[0].delta` `content`, `reasoning_content` / configurable alias, `tool_calls[]`, `usage`, `finish_reason`), default `usageFrom`, default `finishReasonFor` | `mapDelta`, `serializeMessages`, `serializeTools`, `textOf`, `userContent`, `toolCallsOf`, `nonEmpty`, `positiveInteger`, parameterized `buildOpenAiRequestBody` |
| **Anthropic** ([lib/stream/anthropic.js](../lib/stream/anthropic.js), refactored in A1) | `toolCallShape: 'fragmented'`, `usage: { totalFormula: 'input+output+cache' }`, `malformedRecord: 'fail'` | `createAnthropicHooks` riding L1 `createHooks`: `readAnthropicEvent` + per-stream cumulative usage merge (`message_start` + `message_delta`) + per-index thinking `signatures` accessor; `usageFromAnthropic` folded into `lib/stream/usage.js`; SSE framing folded into eventName-aware [lib/stream/sse.js](../lib/stream/sse.js) | Anthropic message/tool request helpers stay protocol-scoped if shared, or thin in L2 until a second Anthropic consumer appears |
| **Gemini** (shared Gemini profile / [vendor/antigravity/lib/stream-contract.js](../vendor/antigravity/lib/stream-contract.js)) | `toolCallShape: 'complete'`, `usage: { totalFormula: 'prompt+output+reasoning' }`, `malformedRecord: 'fail'` | `readEvent` extracting `candidates[0].content.parts` (`thought: true` → `reasoning`, `functionCall` → complete `tool-call` preserving part-level `thoughtSignature`), `usageFromProjection` with `prompt+output+reasoning`, `finishReasonFor` | Gemini part/tool projection + `declaredArguments` / `pruneArguments` (currently in Antigravity) |

### 2.5 L1 Forbidden Rules

Modules inside `lib/stream/*` (and core `lib/cost.js`, `lib/plan.js`, `lib/usage.js`, target
`lib/retry.js`, `lib/catalog-cache.js`) **MUST NOT**:

1. Contain **provider or vendor names** (`antigravity`, `deepinfra`, `exaone`, `opencode`, etc.) in
   identifiers, branch logic, or error message strings (parameterize `label` if an error cites the
   caller). — **R5 is CLOSED (`77a53b0`)**: the plan→provider-id table moved out of `lib/plan.js`
   into the **declaration layer** (`lib/presets.js` → `PLAN_PROVIDERS` + `planProvidersOf`),
   `lib/plan.js` takes the map as an explicit `providers` argument or through
   `bindPlanProviders()`, and its vendor-id count is **2 code ids (9 with comments) → 0**.
   `test/plan-boundary.test.mjs` (**5 cases**) measures the vendor words **from
   `vendor/*/package.json`**, so the lint list cannot go stale.
2. Unwrap or wrap **vendor envelopes** (CloudCode `{ project, request, response }` wrapper, OpenCode
   daemon session/headers, DeepInfra `/anthropic` suffix).
3. Access **config or Cordis services** (`ctx`, `Schema`, `credentials`, `process.env`, profile paths).
4. Perform **I/O beyond the passed stream/events** (no `fetch`, no `fs`, no ledger file writes, no
   wall-clock reads inside `normalizeStream`).
5. Implement **retry or backoff loops** inside `lib/stream/*` (retry belongs in `lib/retry.js` before
   stream iteration starts).
6. Contain **per-vendor branches** (`if (provider === ...)`).

---

## 3. Why the Three Protocols Must Be Symmetric (Measured Baseline vs Target)

Today the three protocols occupy three completely different layers, breaking the horizontal split:

- **Anthropic is forked inside L1:** [lib/stream/anthropic.js](../lib/stream/anthropic.js) is **614
  lines** — **80.4 % on top of** the 764-line core (`index` 343 + `sse` 180 + `usage` 90 + `wire` 68 +
  `failure` 83 = 764 L; `anthropic.js` is 44.6 % of the whole 1,378-line directory). It ships its
  own SSE reader (`readAnthropicSse` + `decodeRecord` + `chunksOf` = **85 L** duplicating `sse.js`),
  its own usage writer (`usageFromAnthropic` = **22 L** bypassing `usageFromProjection`), its own
  `abortError` copy (3 copies across `index.js`, `sse.js`, `anthropic.js` = **14 L**), and builds
  `createAnthropicHooks` as a standalone wrapper rather than riding `normalizeStream({ createHooks })`.
- **OpenAI is duplicated across two vendors and re-implemented in a third:**
  `vendor/deepinfra/lib/map.js` and `vendor/exaone/lib/map.js` are **130 L each with zero
  non-comment diff** (50 L comment-stripped, 0 changed lines). Their `stream-contract.js`
  `readEvent` functions are **41 L each** differing only by 2 vendor-name lines in `PROTOCOL_DEFECT`.
  Of the 8 named request-projection functions in `wire.js`, **6 are byte-identical** and 2 differ
  only in vendor branding and EXAONE's effort/kwargs options — totaling **681 duplicated lines**
  across both vendors. Meanwhile `vendor/opencode/lib/http.js` used to serve a private loop
  (**629 L** of legacy loop + SSE reader + `openai-mapping.js` + **335 L** tool-call assembly).
  **Resolved (`e8b39f7`):** that private loop, the `pipe: 'legacy'` default, the hardcoded
  `parser: 'legacy'` and the vendor's own SSE reader are **deleted** — `http.js` is now
  **2 721 L** (was **3 073** at this audit base) and there is **exactly one** OpenCode pipeline.
- **Gemini is correctly thin in L2:** [vendor/antigravity/lib/adapter.js:280-288](../vendor/antigravity/lib/adapter.js#L280-L288)
  and [vendor/antigravity/lib/stream-contract.js](../vendor/antigravity/lib/stream-contract.js) (175 L)
  ride the shared core directly, leaving only genuine Gemini/CloudCode quirks upstairs. Its
  former 70 L retry loop and 92 L catalog cache now ride `lib/retry.js` / `lib/catalog-cache.js`
  (`8ee4ef1`), so **no** vendor carries a private retry or a private generic catalog cache any
  more.

### Target shape table

| Protocol | Target L1 module(s) | L2 vendor responsibilities (quirks only) | Duplicated / misplaced code today (measured) |
|---|---|---|---|
| **OpenAI** | `lib/stream/openai.js` + `lib/stream/index.js` + `sse.js` + `usage.js` + `wire.js` + `failure.js` | Base URL/path, Bearer/`credentialRef` auth, EXAONE effort fold + `chat_template_kwargs` + 16-stop cap + static catalog; DeepInfra discount/pricing facts; OpenCode daemon resolution + `reasoningField` + `notation-classifier.js` / JSON probe | **681 L** duplicated across `vendor/{deepinfra,exaone}/lib/{map,stream-contract,wire}.js` — **now deleted** (both vendors re-export the core by identity); **OpenCode legacy loop/SSE/mapping (629 L) + tool-call assembly (335 L) — now deleted** (`e8b39f7`): there is **one** OpenCode pipeline and **no config selects a pipeline** |
| **Anthropic** | `lib/stream/anthropic.js` (≤ 434 L) + eventName-aware `sse.js` + `usage.js` (`input+output+cache`) + `failure.js` + `createHooks` | DeepInfra `/anthropic` URL suffix + `x-api-key`/version headers + request translation (`vendor/deepinfra/lib/anthropic-adapter.js`, `stream-anthropic.js` 79 L) | **614 L** fork in `lib/stream/anthropic.js` (85 L SSE reader, 22 L usage writer, 14 L `abortError` across 3 files, non-integrated `createAnthropicHooks`) |
| **Gemini** | `lib/stream/index.js` + `sse.js` + `usage.js` (`prompt+output+reasoning`) + `wire.js` + `failure.js` (plus optional `lib/stream/gemini.js` helper) | OAuth single-flight refresh, CloudCode request/response envelope, `User-Agent`, part-level `thoughtSignature` replay + `declaredArguments`/`pruneArguments`, live quota RPC (`vendor/antigravity/`) | **Correct binding** at `adapter.js:280-288` & `stream-contract.js`; the 70 L retry loop, the 92 L catalog cache and the 28 L `agy` usage double-map **now ride the core** (`8ee4ef1`): `lib/retry.js`, `lib/catalog-cache.js` and `usageFromProjection` |

---

## 4. Upper Layer Contract (L2 Vendor Adapters)

Every vendor under `vendor/<name>/` must converge to a thin adapter wrapping L1/L0.

| Obligation | Rule | Concrete members |
|---|---|---|
| **MUST provide** | Standard binding + request translation + transport call | 1. Request body projection from DSH messages/tools to target wire JSON.<br>2. `STREAM_DESCRIPTOR` + pure `hooks` (or `createHooks` factory) passed to `normalizeStream`.<br>3. HTTP transport call using core `lib/retry.js` and `readSseEvents` from L0. |
| **MAY provide** | Genuine vendor quirks and product surfaces | 1. **Auth shape:** OAuth refresh, `credentialRef` deferred injection, daemon socket auth.<br>2. **Endpoint / envelope:** base URLs, paths (`/anthropic/v1/messages`), CloudCode envelope.<br>3. **Parameter quirks:** `EXAONE_EFFORT`, `chat_template_kwargs`, 16-stop cap, `thoughtSignature` replay & `pruneArguments`, OpenCode `reasoningField` & text-tool classifier.<br>4. **Catalog / cost / plan facts:** live RPCs, static fallback rows, DeepInfra discount math, Antigravity quota windows.<br>5. **Surfaces:** CLI worker, subagent provider, tools/commands. |
| **MUST NOT provide** | Re-implemented lower-layer mechanics | 1. Own SSE decoder (`readAnthropicSse`; the OpenCode `chatSseEvents` reader was **deleted** with the legacy pipeline).<br>2. Own usage writer or finish table (`usageFromOpenAi` / `finishFromOpenAi` in `openai-mapping.js` — a sanctioned *published-contract* exception).<br>3. Own tool-call accumulator (the OpenCode 335 L copy was **deleted**).<br>4. Own retry/backoff loop — ✅ **CLOSED (`77a53b0`)**: Antigravity rides `lib/retry.js` (`adapter.js:27`) and OpenCode's two loops now ride it too; the vendor's own `sleepFor` (24 L) and inverted-signature `backoffDelay` (12 L) are **deleted**.<br>5. Own cost ledger — ✅ **CLOSED (rc.21)**: `vendor/{deepinfra,opencode}/lib/cost.js` now **delegate** to the core `lib/cost.js`; OpenCode's `plans.js` imports `PLAN_PROVIDERS` from `lib/presets.js` and its `usage-ledger.js` imports `USAGE_BUCKETS`/`usageTotal` from `lib/usage.js`. Measured: `numberOrNull` **2 → 1**, `pickSession` **2 → 1**, `USAGE_BUCKETS` **2 → 1**, `usageTotal` **2 → 1**; `createCostStore`/`createCostLedger` stay at **3** = 1 core + 2 legal thin wrappers (the accepted R6 precedent).<br>6. Own generic TTL catalog cache — ✅ **CLOSED (`77a53b0`)**: `vendor/opencode/lib/catalog-cache.js` (362 L) is deleted (split into `catalog-file.js` + `catalog-lifecycle.js` over the core cache) and DeepInfra's local TTL closure now rides `lib/catalog-cache.js`; Antigravity's **quota**-window cache stays vendor-local (it caches a quota fact, not a catalog). |

### Concrete "good" example — Antigravity Gemini binding

- [vendor/antigravity/lib/stream-contract.js](../vendor/antigravity/lib/stream-contract.js) (175 L)
  declares `STREAM_DESCRIPTOR` (`toolCallShape: 'complete'`, `totalFormula: 'prompt+output+reasoning'`,
  `malformedRecord: 'fail'`), delegates `mapFinish` directly to `finishReasonFor`, projects
  `usageMetadata` through `usageFromProjection`, and implements `readEvent` in 50 lines to extract
  text, thoughts, complete `functionCall` parts, and part-level `thoughtSignature`.
- [vendor/antigravity/lib/adapter.js:280-288](../vendor/antigravity/lib/adapter.js#L280-L288) invokes
  `yield* normalizeStream({ events: readSseEvents(response, ...), descriptor: STREAM_DESCRIPTOR, hooks: STREAM_HOOKS, signal: options.signal, onUsage })`.
- Genuine Gemini/Antigravity quirks stay cleanly upstairs: `declaredArguments()` / `pruneArguments()`
  for tool-call replay (`642ee06`), CloudCode envelope wrapping, OAuth single-flight lock, and quota
  RPCs. *(Its 70 L retry loop and 92 L catalog cache now ride `lib/retry.js` / `lib/catalog-cache.js`
  (`8ee4ef1`), and the 28 L `agy` usage double-mapping collapsed onto `usageFromProjection`.)*

### Concrete "violation" example — OpenCode legacy loop — ✅ **RESOLVED** (`e8b39f7`)

> **Historical.** This section described the measured state at the audit base `ead9daf`. The
> OpenCode violation it names is **now fixed**; the short history is kept because the audit's
> measurements are the baseline the phase numbers are quoted against. The **current** facts:
> `vendor/opencode/lib/http.js` is **2 721 L** (was **3 272**), there is **exactly one** OpenCode
> pipeline, and **no config selects a pipeline any more**.

- [vendor/opencode/lib/http.js](../vendor/opencode/lib/http.js) used to default requests to
  `pipe: Schema.union(['legacy', 'shared']).default('legacy')` and hardcode `parser: 'legacy'`;
  the legacy loop consumed **zero lines** of `lib/stream/`, backed by its own SSE reader
  (`chatSseEvents`), its own usage writer + finish table
  ([vendor/opencode/lib/openai-mapping.js:14-92](../vendor/opencode/lib/openai-mapping.js#L14-L92)),
  its own **335-line** tool-call assembly, and the unplaced `stream-parser.js` (679 L).
- **What was deleted (`e8b39f7`, measured):** the legacy branch body, its prelude, its own SSE
  reader (`chatSseEvents` / `parseSseBlock`), the **`pipe` config key** and 4 orphaned imports —
  `http.js` **3 272 → 2 721 L** (**−630 / +79**).
- **What was NOT deleted, and why:** `stream-parser.js` was measured to be **shared-path glue**, not
  dead code — the shared path's `classifyText` / `classifyReasoning` hooks consume it. It was
  therefore **renamed** to `vendor/opencode/lib/notation-classifier.js` (**679 L**, single named
  export `createNotationClassifier`, **one consumer**), which records the placement decision: a
  **vendor-local notation-quirk surface**, not a core parser slot. Coverage survived the deletion
  because the two legacy↔shared parity tests were replaced by **golden sequences captured from
  the shared path before** the deletion.
- **Still vendor-local on purpose:** the published usage writer + finish table in
  `openai-mapping.js` (they carry the vendor's own `OPENCODE_FINISH_*` codes and its published
  total contract), the private cost ledger, and the vendor's own `plans.js` plan→provider-id
  table. The **ledger** was the open **R2** item and is now **CLOSED** (rc.21); the **retry loops** and the **`catalog-cache.js`**
  are **CLOSED (`77a53b0`)** — OpenCode's own `sleepFor` (24 L) and inverted-signature
  `backoffDelay` (12 L) are deleted and both retry sites ride `lib/retry.js`, and
  `vendor/opencode/lib/catalog-cache.js` (362 L) is deleted and split into `catalog-file.js`
  (236 L) + `catalog-lifecycle.js` (181 L) over the core `createCatalogCache`.

---

## 5. Migration Map and "Core Interface Locked" Definition

### Migration map (today → target)

| Task | Layer change | Today (measured) | Target state |
|---|---|---|---|
| **A2** | L1 OpenAI core + L2 dedup | **681 L** duplicated across `vendor/{deepinfra,exaone}/lib/{map,stream-contract,wire}.js` | Phase 1 extracts `lib/stream/openai.js` (zero non-comment diff); Phase 2 deletes vendor copies and rewires DeepInfra + EXAONE onto core |
| **A1** | L1 Anthropic consolidation | **614 L** fork in `lib/stream/anthropic.js`; split `totalFormula` vocabulary; 3 `abortError` copies | Phase 1 folds SSE reader into `sse.js`, `usageFromAnthropic` into `usage.js` (`input+output+cache`), `abortError` into `failure.js`, `createAnthropicHooks` onto `createHooks`, unifies `contract.js:14`; `anthropic.js` ≤ 434 L |
| **A4** | L1 accounting core + L2 ledger removal | ✅ **DONE (rc.21 closes the last remnant)** — Core `cost`/`plan`/`usage` is **1 702 L**; DeepInfra + Antigravity ride it, and **OpenCode's private ledger is gone**: `vendor/opencode/lib/cost.js` delegates to the core, `plans.js` imports `PLAN_PROVIDERS` from `lib/presets.js` (NOT `lib/plan.js`, whose copy is an unbound mutable map), and `usage-ledger.js` imports `USAGE_BUCKETS`/`usageTotal` from `lib/usage.js` | Phase 1 locked the single core `cost`/`plan`/`usage`/store interface in `lib/`; Phase 2 deleted the vendor ledgers; **rc.21 deleted OpenCode's** (`numberOrNull` / `pickSession` / `USAGE_BUCKETS` / `usageTotal` are each defined **once** repo-wide). The vendor wrapper **projects the core's `bySource` spend PARTITIONS back to the COUNT map** the frozen `lib/client.src.js` `detectOpencodeTier()` reads, so the served payload is unchanged |
| **A5** | L0/L1 retry + catalog cache | ✅ **DONE (`77a53b0` closes R3)** — the core `lib/retry.js` (255 L) and `lib/catalog-cache.js` (314 L) now serve **every** vendor; the vendor-local copies (OpenCode's `sleepFor` 24 L + inverted `backoffDelay` 12 L, OpenCode's 362 L `catalog-cache.js`, DeepInfra's in-memory TTL closure) are **deleted** | **Shipped:** one retry core and one catalog cache. OpenCode's retry sites ride `lib/retry.js` (its own status set 429/451/502/503/504, unbounded progression, abort semantics and the in-attempt one-shot 401 refresh preserved); `vendor/opencode/lib/catalog-cache.js` is split into `catalog-file.js` + `catalog-lifecycle.js` over the core `createCatalogCache`; DeepInfra's 30-min TTL and `catalogTtlMs` config key are unchanged (5 concurrent cold reads → 1 probe) |
| **A3** | L2 OpenCode migration | **DONE (`e8b39f7`)** — was: `pipe: 'legacy'` default, `parser: 'legacy'`, 629 L legacy loop/SSE/mapping, 335 L tool assembly, 679 L `stream-parser.js` unplaced | **Shipped:** the legacy loop, its prelude, the vendor's own SSE reader (`chatSseEvents`/`parseSseBlock`), the `pipe` config key and 4 orphaned imports are deleted (`http.js` **3 272 → 2 721 L**, −630/+79) — **no config selects a pipeline any more**; `stream-parser.js` was measured to be **shared-path glue** and was **renamed** `notation-classifier.js` (679 L, one named export, one consumer) = a vendor-local notation-quirk surface; the legacy↔shared parity tests were replaced by **golden sequences captured from the shared path before deletion** |
| **A6** | L3 dead surfaces & gates | **DONE (`e8b39f7` closes the last remnant)** — was: `verify:stream` guards 3/4 (`dsh-exaone` missing); lying `specs/providers/*.json` exits 0; dead fields un-gated; `exaone/lib/map.js:96-130` (35 L) + `classifyBlock` dead | **Shipped:** the guard measures all **4** vendors, the spec↔preset mirror + dead-field allowlist + `pricing.kind`↔`billing.mode` landed, the EXAONE dead exports and the `abortError` copies are gone, and **`test/stream-boundary.test.mjs` (15 cases) + `scripts/verify-usage-readers.mjs`/`test/usage-readers.test.mjs` (12 cases) exist** — the dead `classifyBlock` slot is removed. **R6 is now CLOSED** (rc.21) — the repo-wide uniqueness greps are a **wired gate** (`test/uniqueness.test.mjs` 23 cases + `scripts/verify-uniqueness.mjs`), with a negative proof |
| **A7** | Host seam (Phase 3) | `kind:'declaration'` mounts nothing; `route:'pi-ai'` has no writer; `dsh-llm-pi-ai` takes `providers: z.dict(profile)` | Measure-first after Phase 1/2 (or independently): decide router→host profile writer vs documented operator procedure |

### Definition of "Core Interface Locked" (Phase 1 exit gate)

Phase 2 parallel fan-out **MUST NOT start** until a single serial Phase 1 worker satisfies **all** of
the following lock conditions:

1. **Frozen L1 exports:** `lib/stream/index.js`, `lib/stream/sse.js`, `lib/stream/usage.js`,
   `lib/stream/wire.js`, `lib/stream/failure.js`, `lib/stream/openai.js`, `lib/stream/anthropic.js`,
   `lib/driver/contract.js`, `lib/cost.js`, `lib/plan.js`, `lib/usage.js`, `lib/retry.js`, and
   `lib/catalog-cache.js` have final signatures and `package.json` `exports` entries. No Phase 2
   worker may modify any file in `lib/stream/`, `lib/cost.js`, `lib/plan.js`, `lib/usage.js`,
   `lib/retry.js`, `lib/catalog-cache.js`, or `package.json`.
2. **Zero core-internal forks:** `lib/stream/anthropic.js` is ≤ 434 L (≥ 180 L removed); there is
   exactly **one** SSE reader (`lib/stream/sse.js`), **one** usage writer (`lib/stream/usage.js`),
   **one** `abortError` factory (`lib/stream/failure.js`), and **one** `TOTAL_FORMULAS` vocabulary
   accepted by both `defineProviderDriver` and `usageFrom`.
3. **Core gates green:**
   - `npm run check` exit 0 (including all new `lib/` modules)
   - `npm test` all pass (≥ 649 baseline + new A2/A1/A4/A5 tests; conformance suites for
     `openai-completions`, `anthropic-messages`, `google-generative-sse` all green)
   - `npm run verify:stream` → 8/8, `vendor loads: 0`
   - `npm run verify:presets` → `OK`, `npm run verify:presets:mutation` → 17/17
   - `npm run specs:check` → `OK`
   - All 4 vendor test suites remain green at their baseline (`antigravity` 193, `deepinfra`
     222 pass / 7 skip, `opencode` **553** (was 555 — the two legacy-only tests were removed with
     the legacy pipeline), `exaone` 19)

---

## 6. Forbidden-Rule Enforcement (Static Gates)

Prose rules decay; Phase 2 (**W2-D / A6**) closed the horizontal boundary with automated static
gates. **Status: gates 1, 2 and 3 are SHIPPED** (`e8b39f7` for 1 and 2, `rc.21` for the
uniqueness part of 3); a **fourth** gate — the tool-argument contract seam — now enforces the
host's execution contracts at the L1 emission point.

1. **L1 boundary lint test — ✅ SHIPPED (`test/stream-boundary.test.mjs`, 15 cases):**
   - Scans every `*.js` under `lib/stream/` (and `lib/cost.js`, `lib/plan.js`, `lib/usage.js`,
     `lib/retry.js`, `lib/catalog-cache.js`) and fails on:
     - Any import specifier matching `/\.\.\/vendor\//` or `@nolit\/dsh-(antigravity|deepinfra|exaone|opencode)`.
     - Vendor-name string/identifier leaks (`/antigravity|deepinfra|exaone|opencode/i` outside
       neutral comments or test fixtures, enforced cleanly on non-comment AST/tokens).
     - Forbidden runtime dependencies (`ctx\.`, `process\.env`, `node:fs`, `fetch\(`, `require\(`,
       a dynamic `import(`) inside `lib/stream/*`.
     - A per-vendor equality branch.
     - More than one SSE decoder / usage writer / finish table / `abortError`.
   - **Negative proof:** a planted forbidden import failed **3** rules; the plant was reverted with
     a **sha256 verification**.
2. **Extended `verify:stream` zero-vendor-loads guard — ✅ SHIPPED (`scripts/verify-stream.mjs`):**
   - The vendor set is **measured** from `vendor/*/package.json` (not typed in), so a fifth vendor
     is guarded automatically; `dsh-exaone` is included.
   - Every alias and scoped name must be **refused**; a specifier that resolves is reported
     `UNGUARDED` and fails the run. A **control probe** (`node:fs`) proves the resolver is
     consulted, and a **vacuity guard** exits **2** when no vendored package exists.
   - Measured 2026-11-14: **4 probed, 8/8 refused, 0 loads**.
3. **Repo-wide uniqueness / dead-surface grep gates — ✅ SHIPPED (R6 closed in rc.21):**
   - ✅ **SHIPPED:** the `USAGE_READERS` gate — `scripts/verify-usage-readers.mjs` +
     `test/usage-readers.test.mjs` (12 cases) gate every `usage.routes[].normalize` name against
     the real reader table, reject a dead reader, and enforce browser **source ↔ bundle** parity.
     Measured: **4 presets / 4 routes / 3 readers**; a renamed route exits **1**.
   - ✅ **SHIPPED:** the spec↔preset mirror gate (`scripts/verify-specs.mjs`) + mutation tests
     (`verify:presets:mutation`, **26/26**) catching wrong `endpoint`/`protocol`/`models` id and
     `pricing.kind`↔`billing.mode` mismatches.
   - ✅ **SHIPPED (rc.21):** the **uniqueness gate** — `test/uniqueness.test.mjs` (**23 cases**,
     which rides the existing `npm test` glob, so **no `package.json` change**) plus
     `scripts/verify-uniqueness.mjs` as a standalone runner (`--json`, exit **0** clean /
     **1** violation / **2** could-not-run).
     The rule is **NOT** the naive "one definition repo-wide" — that would be **false** for
     `createCostStore`, which legitimately appears **3** times. The encoded rule is:
     (a) exactly **ONE** core implementation in `lib/**`;
     (b) a `vendor/<pkg>/**` definition is legal **ONLY** when the file **imports** the core
     symbol **and** **calls** it (the accepted precedent is DeepInfra's `createCostStore`, which
     delegates to the core `createSharedStore`);
     (c) definitions outside `lib/` **and** `vendor/` are **strays** and fail;
     (d) the vendor set is **MEASURED** from `vendor/*/package.json`, never hand-listed, so a
     fifth vendored package is covered without editing the gate.
     Measured 2026-11-14: `node scripts/verify-uniqueness.mjs` → **clean, exit 0**; counts —
     `mapDelta` **1/0**, `numberOrNull` **1/0**, `pickSession` **1/0**, `backoffDelay` **1/0**,
     `createCostStore` **1 core / 2 vendor = 3**; **4** vendors measured; **2** generated
     artifacts excluded from the count.
     **Negative proof:** a dual plant (**5** strays in `scripts/` + **3** vendor
     re-implementations) produced exactly **8** findings and reverted to a **0**-finding
     baseline; the tree hash is stable across a scan.
     The `parser:'legacy'` and `pipe:…default('legacy')` literals are **gone** (measured **0**
     hits) — the `pipe` config key no longer exists at all.
4. **Tool-argument contract seam — ✅ SHIPPED (`lib/stream/tool-argument-contract.js`, 163 L):**
   - **The rule it enforces:** a streamed tool call's arguments must satisfy the **host's**
     execution contracts, not only the **provider's** schema. A provider schema cannot express
     "this argument is only valid together with that one", so a drifted call used to reach
     execution intact and die there — measured: a live Gemini/Antigravity subagent run failed
     with `Error: invalid escalation: justification is only valid together with
     sandbox_permissions`, thrown by the host's `@deepseek-ai/dsh-sandbox` `validateEscalationArgs`
     on the **EXECUTION** path.
   - **Why L1 and not a vendor:** every vendor hands its tool calls to the **ONE** shared pipe
     (`normalizeStream`), and the pipe's `block-end` block is authoritative for execution (the
     host's `BlockAssembler` keeps `partial.block` and ignores the accumulated `tool-call-delta`
     text once a block closes). So one function at the **single emission point** covers all four
     vendors and any future one; a per-vendor patch would have to be written four times and would
     go stale for the fifth. The module carries **no vendor name, no model name and no
     per-vendor branch**, so the L1 boundary rule above is untouched.
   - **Why the rule is derived, not hardcoded:** the pairing is a **host** contract, and the host
     states its pairings the only way JSON Schema allows — in the dependent field's `description`,
     with the stable phrase `Required with <other_field>` (measured **identically** on
     `dsh-tool-bash`, `dsh-tool-fs` and `dsh-tool-pwsh`). The module reads that phrase out of the
     tool schema the request itself carries, so the rules come from the declared contract rather
     than from a field list maintained here. A future host contract phrased the same way is
     covered with **no edit**; a field hardcoded here would silently miss it.
   - **Repair direction (fixed, and deliberately narrow):** a dependent field present **without**
     its principal is **dropped** (the principal is what grants wider access, so a lone reason
     asks for nothing — dropping it turns an unrunnable call into the un-escalated call the model
     would have made anyway). A principal with a **blank** dependent keeps the escalation and
     drops the blank value, so the host names the missing reason. **Nothing here fabricates a
     justification** — a fabricated approval reason would be a **safety regression**, not a
     repair. A well-formed escalation is preserved **byte-for-byte**, and a call that needs no
     repair is returned by identity (the same reference, no copy).
   - **Placement and plumbing:** applied at `finalBlock` in `lib/stream/index.js`; all **five**
     vendor `normalizeStream` call sites now pass `tools: options.tools`
     (`vendor/antigravity/lib/adapter.js:294`, `vendor/deepinfra/lib/adapter.js:229`,
     `vendor/deepinfra/lib/anthropic-adapter.js:263`, `vendor/exaone/lib/adapter.js:147`,
     `vendor/opencode/lib/http.js:1950`).
   - **Gate:** `test/tool-argument-contract.test.mjs` (**13 cases**) asserts every measured host
     violation is repaired at the emission point, that a well-formed escalation survives
     byte-for-byte, that a differently-named pair is covered with no edit (the anti-hardcoding
     proof), and that the derivation is **pinned against the measured host text** — so an
     upstream rephrasing fails a test instead of going quiet.
