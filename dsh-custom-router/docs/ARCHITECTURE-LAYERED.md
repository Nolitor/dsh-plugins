# Custom Router — Horizontal Layered Architecture

<!-- skeleton:
version: 1.0
kind: design
status: active
updated: 2026-11-14
summary: Horizontal L0–L4 architecture for @nolit/dsh-custom-router: exact L1 protocol interfaces (OpenAI/Anthropic/Gemini), L2 vendor contract, core-lock gates, and static enforcement.
-->

> **Design target (owner principle, 2026-11-14).** LOWER layer = a thin, standardized shared
> pipeline for the three standard protocols (**OpenAI / Anthropic / Gemini**). UPPER layer = thin
> vendor/preset adapters that translate **vendor quirks only** and hand off to the lower pipeline.
>
> Measured baseline: `@nolit/dsh-custom-router@0.0.1-rc.20` (`HEAD` `7d0bb42`, audit base `ead9daf`,
> [HANDOFF.md](./HANDOFF.md) §3). Active execution order lives in [ROADMAP.md](./ROADMAP.md) §4;
> worker packages live in [WORKER-DISPATCH.md](./WORKER-DISPATCH.md).

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
   caller).
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
  across both vendors. Meanwhile `vendor/opencode/lib/http.js` (**3,073 L** in one file, `12,330 L`
  in `lib/`) defaults to `pipe: 'legacy'` (`http.js:302`), hardcodes `parser: 'legacy'` (`http.js:2284`),
  and serves a private loop (**629 L** of legacy loop + SSE reader + `openai-mapping.js` + **335 L**
  tool-call assembly).
- **Gemini is correctly thin in L2:** [vendor/antigravity/lib/adapter.js:280-288](../vendor/antigravity/lib/adapter.js#L280-L288)
  and [vendor/antigravity/lib/stream-contract.js](../vendor/antigravity/lib/stream-contract.js) (175 L)
  ride the shared core directly, leaving only genuine Gemini/CloudCode quirks upstairs (aside from
  its 70 L retry loop and 92 L catalog cache).

### Target shape table

| Protocol | Target L1 module(s) | L2 vendor responsibilities (quirks only) | Duplicated / misplaced code today (measured) |
|---|---|---|---|
| **OpenAI** | `lib/stream/openai.js` + `lib/stream/index.js` + `sse.js` + `usage.js` + `wire.js` + `failure.js` | Base URL/path, Bearer/`credentialRef` auth, EXAONE effort fold + `chat_template_kwargs` + 16-stop cap + static catalog; DeepInfra discount/pricing facts; OpenCode daemon resolution + `reasoningField` + `stream-parser.js` / JSON probe | **681 L** duplicated across `vendor/{deepinfra,exaone}/lib/{map,stream-contract,wire}.js`; **629 L** legacy loop/SSE/mapping + **335 L** tool-call assembly in `vendor/opencode/lib/http.js` & `openai-mapping.js` |
| **Anthropic** | `lib/stream/anthropic.js` (≤ 434 L) + eventName-aware `sse.js` + `usage.js` (`input+output+cache`) + `failure.js` + `createHooks` | DeepInfra `/anthropic` URL suffix + `x-api-key`/version headers + request translation (`vendor/deepinfra/lib/anthropic-adapter.js`, `stream-anthropic.js` 79 L) | **614 L** fork in `lib/stream/anthropic.js` (85 L SSE reader, 22 L usage writer, 14 L `abortError` across 3 files, non-integrated `createAnthropicHooks`) |
| **Gemini** | `lib/stream/index.js` + `sse.js` + `usage.js` (`prompt+output+reasoning`) + `wire.js` + `failure.js` (plus optional `lib/stream/gemini.js` helper) | OAuth single-flight refresh, CloudCode request/response envelope, `User-Agent`, part-level `thoughtSignature` replay + `declaredArguments`/`pruneArguments`, live quota RPC (`vendor/antigravity/`) | **Correct binding** at `adapter.js:280-288` & `stream-contract.js`; remaining misplaced mechanics are **70 L** retry, **92 L** catalog cache, and **28 L** `agy` usage double-map (`backends.js:109-118`, `subagent.js:96-113`) |

---

## 4. Upper Layer Contract (L2 Vendor Adapters)

Every vendor under `vendor/<name>/` must converge to a thin adapter wrapping L1/L0.

| Obligation | Rule | Concrete members |
|---|---|---|
| **MUST provide** | Standard binding + request translation + transport call | 1. Request body projection from DSH messages/tools to target wire JSON.<br>2. `STREAM_DESCRIPTOR` + pure `hooks` (or `createHooks` factory) passed to `normalizeStream`.<br>3. HTTP transport call using core `lib/retry.js` and `readSseEvents` from L0. |
| **MAY provide** | Genuine vendor quirks and product surfaces | 1. **Auth shape:** OAuth refresh, `credentialRef` deferred injection, daemon socket auth.<br>2. **Endpoint / envelope:** base URLs, paths (`/anthropic/v1/messages`), CloudCode envelope.<br>3. **Parameter quirks:** `EXAONE_EFFORT`, `chat_template_kwargs`, 16-stop cap, `thoughtSignature` replay & `pruneArguments`, OpenCode `reasoningField` & text-tool classifier.<br>4. **Catalog / cost / plan facts:** live RPCs, static fallback rows, DeepInfra discount math, Antigravity quota windows.<br>5. **Surfaces:** CLI worker, subagent provider, tools/commands. |
| **MUST NOT provide** | Re-implemented lower-layer mechanics | 1. Own SSE decoder (`readAnthropicSse`, `chatSseEvents` in `http.js:440-499`).<br>2. Own usage writer or finish table (`usageFromOpenAi` / `finishFromOpenAi` in `openai-mapping.js:14-92`).<br>3. Own tool-call accumulator (`http.js:1590-1924`, 335 L).<br>4. Own retry/backoff loop (`antigravity/lib/adapter.js:40-63,228-273`; OpenCode's 3 loops).<br>5. Own cost ledger (`vendor/{deepinfra,opencode}/lib/cost.js`; `plans.js`+`usage-ledger.js`+`cost-pill.js` 506 L).<br>6. Own generic TTL catalog cache (`antigravity/lib/index.js:200-291`, `deepinfra/lib/index.js:209-237`, `opencode/lib/catalog-cache.js` 362 L). |

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
  RPCs. *(Residual to move to L1 in A4/A5: its 70 L retry loop at `adapter.js:40-63, 228-273`, 92 L
  catalog cache at `index.js:200-291`, and 28 L `agy` usage double-mapping at `backends.js:109-118` /
  `subagent.js:96-113`.)*

### Concrete "violation" example — OpenCode legacy loop

- [vendor/opencode/lib/http.js:302](../vendor/opencode/lib/http.js#L302) defaults requests to
  `pipe: Schema.union(['legacy', 'shared']).default('legacy')`; the shared pipe is bypassed by
  default on the largest vendor (`12,330 L` total; `3,073 L` in `http.js` alone).
- [vendor/opencode/lib/http.js:2284](../vendor/opencode/lib/http.js#L2284) hardcodes
  `parser: 'legacy'` as a literal.
- [vendor/opencode/lib/http.js:2091-2245](../vendor/opencode/lib/http.js#L2091-L2245) runs a private
  streaming loop consuming **zero lines** of `lib/stream/`, backed by:
  - own SSE reader at `http.js:440-499` (`chatSseEvents`),
  - own usage writer (`14-29`) and finish table (`34-92`) at
    [vendor/opencode/lib/openai-mapping.js:14-92](../vendor/opencode/lib/openai-mapping.js#L14-L92),
  - own **335-line** tool-call assembly at `http.js:1590-1924`,
  - unplaced `stream-parser.js` (**679 L**) with no core parser slot decision recorded,
  - private cost ledger (`vendor/opencode/lib/cost.js` 381 L) plus `plans.js` (185 L) +
    `usage-ledger.js` (139 L) + `cost-pill.js` (182 L) = **506 L** re-implementing the unused core
    `lib/{cost,plan,usage}.js` (**531 L**, imported by **0** vendors),
  - three separate retry loops and a **362 L** `catalog-cache.js`.

---

## 5. Migration Map and "Core Interface Locked" Definition

### Migration map (today → target)

| Task | Layer change | Today (measured) | Target state |
|---|---|---|---|
| **A2** | L1 OpenAI core + L2 dedup | **681 L** duplicated across `vendor/{deepinfra,exaone}/lib/{map,stream-contract,wire}.js` | Phase 1 extracts `lib/stream/openai.js` (zero non-comment diff); Phase 2 deletes vendor copies and rewires DeepInfra + EXAONE onto core |
| **A1** | L1 Anthropic consolidation | **614 L** fork in `lib/stream/anthropic.js`; split `totalFormula` vocabulary; 3 `abortError` copies | Phase 1 folds SSE reader into `sse.js`, `usageFromAnthropic` into `usage.js` (`input+output+cache`), `abortError` into `failure.js`, `createAnthropicHooks` onto `createHooks`, unifies `contract.js:14`; `anthropic.js` ≤ 434 L |
| **A4** | L1 accounting core + L2 ledger removal | `lib/{cost,plan,usage}.js` (531 L) unused; 2 vendor ledgers + 506 L OpenCode re-impl + 28 L `agy` double-map | Phase 1 locks single core `cost`/`plan`/`usage`/store interface in `lib/`; Phase 2 deletes vendor ledgers (`numberOrNull`, `pickSession`, `createCostStore` duplicates) and routes all 4 vendors to core |
| **A5** | L0/L1 retry + catalog cache | 0 retry/cache in core; Antigravity 70 L retry + 92 L cache; OpenCode 3 retry loops + 362 L cache; DeepInfra TTL cache | Phase 1 locks `lib/retry.js` ([RETRY-POLICY.md](./RETRY-POLICY.md)) & `lib/catalog-cache.js`; Phase 2 deletes per-vendor retry loops and generic TTL caches |
| **A3** | L2 OpenCode migration | `pipe: 'legacy'` default, `parser: 'legacy'`, 629 L legacy loop/SSE/mapping, 335 L tool assembly, 679 L `stream-parser.js` unplaced | Phase 2 flips `pipe` default to `'shared'`, deletes legacy loop/SSE/`openai-mapping.js:14-92`/tool assembly, decides & documents placement of `stream-parser.js` |
| **A6** | L3 dead surfaces & gates | `verify:stream` guards 3/4 (`dsh-exaone` missing); lying `specs/providers/*.json` exits 0; dead fields un-gated; `exaone/lib/map.js:96-130` (35 L) + `classifyBlock` dead | Phase 2 deletes dead surfaces, adds `dsh-exaone` to `verify:stream`, adds spec↔preset mirror, dead-field allowlist, `pricing.kind`↔`billing.mode`, `USAGE_READERS`, and L1 boundary lint gates |
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
     222 pass / 7 skip, `opencode` 555, `exaone` 19)

---

## 6. Forbidden-Rule Enforcement (Static Gates)

Prose rules decay; Phase 2 (**W2-D / A6**) closes the horizontal boundary with automated static gates:

1. **L1 boundary lint test (`test/stream-boundary.test.mjs`, target in A6):**
   - Scan every `*.js` under `lib/stream/` (and `lib/cost.js`, `lib/plan.js`, `lib/usage.js`,
     `lib/retry.js`, `lib/catalog-cache.js`):
     - Fail on any import specifier matching `/\.\.\/vendor\//` or `@nolit\/dsh-(antigravity|deepinfra|exaone|opencode)`.
     - Fail on vendor-name string/identifier leaks (`/antigravity|deepinfra|exaone|opencode/i` outside
       neutral comments or test fixtures, enforced cleanly on non-comment AST/tokens).
     - Fail on forbidden runtime dependencies (`ctx\.`, `process\.env`, `node:fs`, `fetch\(`) inside
       `lib/stream/*`.
2. **Extended `verify:stream` zero-vendor-loads guard (`scripts/verify-stream.mjs:23`):**
   - Change `ENTRIES` from `['dsh-antigravity', 'dsh-deepinfra', 'dsh-opencode-v2']` to
     `['dsh-antigravity', 'dsh-deepinfra', 'dsh-opencode-v2', 'dsh-exaone']`.
   - Also reject relative `vendor\/(antigravity|deepinfra|exaone|opencode)` resolution from any
     module inside `lib/stream/`.
3. **Repo-wide uniqueness / dead-surface grep gates (run in A6 CI / `verify`):**
   - `mapDelta` defined only in `lib/stream/openai.js` (0 definitions in `vendor/`).
   - `numberOrNull`, `pickSession`, `createCostStore`, `backoffDelay` each defined once in `lib/`,
     zero re-definitions in `vendor/`.
   - Zero occurrences of `parser: 'legacy'` or `pipe:.*default\('legacy'\)` in `vendor/opencode/`.
   - Spec↔preset mirror gate (`scripts/verify-specs.mjs`) + mutation tests (`verify:presets:mutation`)
     catching wrong `endpoint`/`protocol`/`models` id, `pricing.kind`↔`billing.mode` mismatch, and
     unregistered `USAGE_READERS` keys.
