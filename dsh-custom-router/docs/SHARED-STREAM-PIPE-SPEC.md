# Shared Stream Pipe — one extensible parser/emitter, hooks for provider edges

<!-- skeleton:
version: 0.0.1-rc.3
kind: spec
status: active
updated: 2026-11-14
summary: Implemented spec (P1–P5 integrated; OpenCode shared-default residual is ROADMAP P2-2, parity fixtures P2-4). Normative spec for one shared downstream pipeline (SSE decode, wire-part to StreamChunk, usage, finish, failure, cut/empty policy) owned by dsh-custom-router, with declarative descriptors and overridable hooks for the three measured provider edges. Conformance covers openai-completions, anthropic-messages and google-generative-sse; openai-responses and google-generative-ai remain uncovered.
-->

> **IMPLEMENTED SPEC (2026-11-14).** P1–P5 are integrated; the “P4 is next” status is historical.
> Residuals: OpenCode `pipe:'shared'` default ([ROADMAP.md](./ROADMAP.md) P2-2) and the remaining
> conformance fixtures (P2-4) — `openai-responses` and `google-generative-ai` are still uncovered.

> **Implemented status (2026-11-14).** P1–P5 are integrated. The OpenCode `pipe:'shared'`
> default and the Anthropic/Google parity fixtures are the only residuals, tracked in
> [ROADMAP.md](./ROADMAP.md) P2-2/P2-4. The implementation history below is evidence.
> `verify:stream` runs 8/8 dispatch cases with zero vendor module loads.

## 1. Decision

`dsh-custom-router` is **not** a compatibility patch for the three existing plugins. It is the
**core routing and expansion platform**: the owner's target is that any future provider, local
model, or web-auth interface is absorbed by adding a descriptor and hooks, **without editing the
core**. That goal is unreachable while each vendor keeps its own downstream implementation, so
the first deliverable of this track is the shared core itself — not a migration of any one
plugin.

The **downstream half** — everything from decoded wire payload to the last `StreamChunk` — is
one module in this package. Provider disagreement is carried by a **descriptor** plus a small
**hook set**, never by forking the pipeline.

**Sequencing rule (owner instruction 2026-11-07):** the core is built and unit-tested first,
inside this package, with **no consumer**. Disclosure of the strategic goal:

| Stage | Content | Precondition |
| :--- | :--- | :--- |
| **P1** | shared parser/wire core + hook architecture, unit-tested, zero consumers | none — this is first |
| **P2** | `@nolit/dsh-antigravity` — primary testbed: rare live use, lowest operational risk, and the only measured **web-auth** upper pipeline | P1 complete |
| **P3** | `@nolit/dsh-deepinfra` — pure API parity, no daemon, no web auth | P2 proves the hooks |
| **P4** | `@nolit/dsh-opencode-v2` — last: it carries the most live traffic, the largest surface, and the canonical-parser work | P2+P3 prove stability |

`dsh-opencode-v2` is explicitly **never the first migration**. It is the highest-risk consumer
and it also owns the optional `classifyText` hook, so it lands only after the wire-only path and
the web-auth path are both proven.

Why one module, measured (2026-11-07):

| Concern | opencode-v2 | antigravity | deepinfra | Drift |
| :--- | :--- | :--- | :--- | :--- |
| SSE framing | inline `http.js` | `sse.js` 85 L | `sse.js` 106 L | 3 impls, 3 malformed policies |
| Block emitter | `emitPart`/`closeAll` | inline in `adapter.js` | inline in `adapter.js` | 3 impls |
| Usage normalise | `usageFromOpenAi` | `toTokenUsage` | `tokenUsage` | 3 `totalTokens` rules |
| Finish policy | 6-way table | Gemini table | OpenAI table | **different outcomes** |
| `LlmFailure.code` | present | **absent** (`SAFETY`) | present | contract violation |
| Empty completion | (none) | `throw LlmError` | `finish{error}` | 2 policies |
| Cut preservation | `streamCutPreserve` | none | none | 1 of 3 |
| Block index | fixed `0/1/2+2n` | first-seen | first-seen | violates N4 |

Same contract implemented three times is why it diverged. The upstream half (auth, catalog,
request body, reasoning control) stays per service — those are genuinely different, and
[PROTOCOL §5](./CUSTOM-ROUTER-PROTOCOL-STANDARD.md) still forbids sharing an *adapter instance*.

## 2. Boundary — what is shared, what is a hook, what stays provider-only

| Layer | Owner | Form |
| :--- | :--- | :--- |
| SSE frame decode, `[DONE]`, malformed-record policy | **shared** | code |
| Wire-part → `StreamChunk` emission, block index/close order | **shared** | code |
| Usage → disjoint buckets, `totalTokens` rule | **shared writer**, descriptor feeds fields | code + hook |
| Finish-reason → `FinishReason` | **shared table**, descriptor may extend | code + hook |
| `LlmFailure` shape, code taxonomy | **shared** | code |
| Empty / cut / abort terminal policy | **shared** | code + hook |
| `readEvent(payload)` — provider payload to normalized record | **hook, mandatory** | per provider |
| tool-call shape (fragmented vs complete) | **descriptor** | per provider |
| text notation classification (canonical parser) | **hook, optional** | per provider |
| request body, auth, catalog, reasoning control | **provider-only** | untouched |

## 3. Module surface

New export `@nolit/dsh-custom-router/stream`.

```js
export async function* readSseEvents(body, { signal, onMalformed })
  // yields decoded payloads in wire order; returns at [DONE].
  // CRLF and LF terminators, multi-line data:, comment lines, abort honoured.

export async function* normalizeStream({ events, descriptor, hooks, signal })
  // -> AsyncGenerator<StreamChunk>
  // owns: block lifecycle, index allocation (first-seen, N4), usage, finish,
  //       failure shape, empty/cut/abort terminal policy.
  // never owns: HTTP, retry loop, credentials, catalog.

export function fail(code, message, extra)      // LlmFailure factory
export function emptyCompletion(usage)          // in-band terminal error
export function cutCompletion(state, cause)     // preserve partials, then error
```

`normalizeStream` is a pure consumer of an `AsyncIterable` — the adapter keeps its own fetch,
its own retry loop ([RETRY-POLICY.md](./RETRY-POLICY.md)) and its own `signal` plumbing.

### 3.1 Package and resolution

The module ships as a new export of the existing shared library, not a new package:

```json
"exports": { "./stream": { "default": "./lib/stream/index.js" } }
```

All three vendor packages already declare `@nolit/dsh-custom-router` in `peerDependencies`
(measured 2026-11-07), so no dependency edge is added. DSH resolves a linked plugin's bare
imports from the profile `node_modules`; `scripts/link-custom-router.mjs` already provides that
link and its [operations runbook](./OPENCODEX-OPERATIONS.md) §5 documents the one observed
failure mode (`did not activate` when the link is missing).

`dsh-custom-router` remains a **library**: it is not added to any `dsh.profile.bundles`, and the
new export mounts nothing on its own.

## 4. Required hook — `readEvent`

The only hook every provider must supply. One decoded payload in, one normalized record out.

```js
readEvent(payload, context) -> {
  parts?:   StreamPart[]        // { kind:'text'|'reasoning'|'tool-call', ... }
  usage?:   unknown             // raw provider usage, handed to usageFrom()
  finish?:  string|undefined    // raw provider finish value
  done?:    true                // provider-level end-of-stream marker
  defect?:  { code, message }   // payload decoded but violated its own shape
}
```

The pipeline never inspects provider JSON. This is what keeps Gemini's
`{response:{candidates[],usageMetadata}}` and OpenAI's `{choices:[{delta}]}` outside the shared
code while everything after the mapping is identical.

## 5. Default behaviour the shared pipeline owns

### 5.1 Block lifecycle (normative)

- Index = **first-seen allocation** (N4). One text block, one reasoning block, one block per
  tool-call ordinal. `block-start` emitted once per index, `block-end` exactly once, in index
  order, before `usage`.
- A `block-end` carries the **fully accumulated** block (measured failure on both deepinfra and
  antigravity: an empty `block-end` erased the transcript).
- A tool-call fragment with no `id` and no `name` accumulates arguments but does **not** emit
  `block-start`/`tool-call-delta` until identity is known.
- `usage` strictly before `finish`; nothing after `finish`.

### 5.2 Finish policy (normative, one table)

| Class | Wire values | `FinishReason` |
| :--- | :--- | :--- |
| normal | `stop`, `end_turn`, `eos`, `completed`, `stop_sequence`, `STOP`, `null`, `undefined` | `{kind:'stop'}` |
| tools | `tool_calls`, `function_call`, `tool_use`, `tool_use_start` | `{kind:'tool-calls'}` |
| budget | `length`, `max_tokens`, `max_output_tokens`, `token_limit`, `MAX_TOKENS` | `{kind:'max-tokens'}` |
| filtered | `content_filter`, `safety`, `refusal`, `blocked`, `guardrail`, `SAFETY`, `RECITATION`, `BLOCKLIST`, `PROHIBITED_CONTENT`, `SPII` | `{kind:'error'}`, code `CONTENT_FILTERED` |
| resource | `insufficient_system_resource`, `server_busy`, `overloaded`, `OTHER` | `{kind:'error'}`, code `PROVIDER_RESOURCE` |
| unknown | anything else | `{kind:'error'}`, code `UNKNOWN_FINISH_REASON` |

**One shared promotion rule:** a mapped `stop` becomes `{kind:'tool-calls'}` when any tool-call
block closed in this response. This removes Gemini's per-adapter special case and is correct for
every provider measured.

**Consequence to accept:** antigravity's `SAFETY`/`RECITATION`/`BLOCKLIST`/`SPII`/`OTHER` and
deepinfra's `content_filter` stop being reported as clean `stop`. That is the bug this module
exists to prevent.

### 5.3 Usage writer (normative)

Disjoint buckets, N11: `inputTokens + cacheReadTokens + cacheWriteTokens` = provider prompt
total; `outputTokens` excludes reasoning.

`totalTokens` is **not** recomputed freely. The rule:

1. provider total present and equal to the provider's own aggregate → preserve it;
2. provider total present but inconsistent with its own buckets → **omit**;
3. absent → omit. Never invent one from a subset of buckets (opencode-v2 today publishes
   `input + output + cacheRead`, which is not the call total).

Descriptor field `usage.totalFormula` selects the cross-check aggregate: `'prompt+output'`
(OpenAI-shaped) or `'prompt+output+reasoning'` (Gemini thoughts are separate from candidates).

### 5.4 Failure and terminal policy (normative)

- Every failure is `{ message: string, code: string, status?, providerRetryAfterMs? }`.
  `code` is **mandatory** — today antigravity emits `{kind:'provider', message}` with no code.
- Malformed record: descriptor `onMalformed: 'fail' | 'skip'`; default `'fail'`
  (`PROTOCOL_DEFECT`). Antigravity's silent skip becomes an explicit choice, not a default.
- Empty completion (no text/reasoning/tool-call block): in-band
  `finish{kind:'error', failure:{code:'EMPTY_RESPONSE'}}`, usage still emitted first. Never a
  throw after the stream has started, never a silent success.
- Cut after partial output: emit accumulated `block-end`s, then
  `finish{kind:'error'}` carrying the **original** cause
  ([RETRY-POLICY §6](./RETRY-POLICY.md)). Partial text is never presented as complete.
- `signal.aborted`: `finish{kind:'aborted', failure:{code:'ABORTED'}}`, no retry.

### 5.5 Extension points

| Hook | Default | Overridden by |
| :--- | :--- | :--- |
| `readEvent(payload, ctx)` | none — **mandatory** | all three |
| `classifyText(text, ctx)` | pass-through (wire-only) | opencode-v2 (canonical recipe parser, P4) |
| `mapFinish(raw, ctx)` | §5.2 table | a provider with an unmapped vocabulary |
| `usageFrom(raw, ctx)` | `usageFrom` with `descriptor.usage.totalFormula` | antigravity (`usageMetadata` projection, P2) |
| `onMalformed(defect, ctx)` | throw `PROTOCOL_DEFECT` | a provider that legitimately emits junk records |
| `onEmpty(ctx)` | in-band `EMPTY_RESPONSE` | none expected |
| `onCut(cause, state)` | preserve + error with original code | none expected |

Implemented hook set (P1): `readEvent`, `classifyText`, `mapFinish`, `usageFrom`, `onMalformed`,
`onEmpty`, `onCut`. `closeBlock` is **not** a hook: a provider that needed a different final
block shape would be changing the host contract, not adapting a vendor quirk. The accumulated
block is always what `block-end` carries (§5.1).

Hooks are **pure**: no I/O, no `ctx`, no network. A hook that needs to fetch is a design error —
that belongs in the adapter above the pipeline.

## 6. Descriptor additions

Extends [PROTOCOL §4](./CUSTOM-ROUTER-PROTOCOL-STANDARD.md) `ServiceProtocolDescriptor`:

```ts
interface StreamDescriptor {
  toolCallShape: 'fragmented' | 'complete'   // OpenAI fragments vs Gemini whole calls
  usage: { totalFormula: 'prompt+output' | 'prompt+output+reasoning' }
  malformedRecord: 'fail' | 'skip'           // default 'fail'
  emptyCompletion: 'error-finish'            // single policy; not configurable
}
```

Measured values:

| Field | opencode-v2 | antigravity | deepinfra |
| :--- | :--- | :--- | :--- |
| `toolCallShape` | `fragmented` | `complete` | `fragmented` |
| `usage.totalFormula` | `prompt+output` | `prompt+output+reasoning` | `prompt+output` |
| `malformedRecord` | `skip` (today) | `skip` (today) | `fail` |

## 7. Rollout — shared code, one provider at a time

> **Historical rollout record (2026-11-14).** P1–P5 are delivered; the counts below are each
> step's own measurement, not the current suite size (router suite is **625/625**). Live residuals
> are the OpenCode `pipe:'shared'` default ([ROADMAP.md](./ROADMAP.md) P2-2) and the
> Anthropic/Google parity fixtures (P2-4).

| Step | Change | Risk | Gate |
| :--- | :--- | :--- | :--- |
| **P1** | Build `lib/stream/` + `./stream` export **inside this package**. Zero consumers. | none — no plugin imports it yet | the module's own unit suite green; the three vendor suites byte-identical to before |
| **P2** | Integrate **`dsh-antigravity`** first — primary testbed | low: rarely used live, and it is the **only web-auth** upper pipeline, so it proves hook binding across the auth boundary | **done 2026-11-07** — 144/144 at that time (now 190/190); D3/D4/D6/D8 closed; `usageMetadata` proves `usageFrom`; the web-auth edge below was the finding |
| **P3** | Integrate **`dsh-deepinfra`** | low: pure API, no daemon, no web auth | **done 2026-11-08** — 189/189 at that time (now 217 pass / 7 skip); D4/D6 closed, D8 kept; the fragmented tool-call branch and the `prompt+output` total are proven |
| **P4** | Integrate **`dsh-opencode-v2`** last | high: most live traffic, largest surface | **done** — 554/554 vendored; replay `markerDeltas == 0` shapes identical; S2-3 prose gate; `classifyText` hook lands here |
| **P5** | Parity suite: one recorded fixture per provider replayed through the shared core | — | **done** — `test/conformance/` covers `openai-completions`, `anthropic-messages`, `google-generative-sse`; `openai-responses` and `google-generative-ai` remain uncovered |

Rationale for the order: P2 exercises **web-auth + complete tool calls + separate reasoning
bucket**; P3 exercises **bearer key + fragmented tool calls + folded reasoning**; only after
both branches are proven does the high-traffic plugin move. Each step was a separate
owner-approved round. No version bump without owner instruction. `dsh-custom-router` stays a
library outside `dsh.profile.bundles`.

### 7.1 P2 findings (measured 2026-11-07)

Three things only the integration could show:

| # | Finding | Consequence for the spec |
| :--- | :--- | :--- |
| F1 | **The web-auth edge is a request-header collision, not a token flow.** The provider answers 403 without the CLI identity `antigravity/cli/1.5.0 (...)`; the host's `attributionHeaders()` emits `deepseek-harness/<version>`. Both cannot be sent as `user-agent`. | The pipe never touches request headers, so this belongs to the adapter — but the spec must say so explicitly, otherwise N8 reads as "call `attributionHeaders()` everywhere" and a future agent silently returns 403. Recorded as D2 (withdrawn as a defect, kept as a declared conflict). |
| F2 | **Legacy reader contracts differ at `[DONE]`.** This provider yielded a `{ done: true }` sentinel; the shared reader ends iteration. | `readSseEvents` gained `emitDone` so a wrapper can keep a published contract without forking the parser. Also accepts a `Response` (not just its body), which is what the vendor files passed. |
| F3 | **Cut preservation needs a real stream, not a scripted one.** `controller.error()` in `start()` discards the already-queued chunk, so the first version of the cut test measured the harness, not the pipe. The failure must be raised on `pull` after the frame was handed over. | The cut semantics were already correct; the test now reproduces a live socket cut. No core change. |
| F4 | **Usage must reach the ledger on arrival.** The host may stop iterating at `finish`. | `normalizeStream` gained an `onUsage` sink; the adapter records there instead of after the stream. |

## 7.2 P3 findings (measured 2026-11-08)

`dsh-deepinfra` is the second integrated consumer. Its descriptor is `fragmented` /
`prompt+output` / `malformedRecord: 'fail'`; the binding is
[`dsh-deepinfra/lib/stream-contract.js`](../vendor/deepinfra/lib/stream-contract.js). Three things
only the integration could show:

| # | Finding | Consequence for the spec |
| :--- | :--- | :--- |
| F5 | **The usage-bearing event can carry `choices: []`.** DeepInfra emits `FINISH -> USAGE -> [DONE]`, and the usage event has no choice. A `readEvent` that reads usage only when a delta exists loses the ledger row. | §4: `usage` is read independently of `choices[0]`. Same class as P2's F4, different shape — `onUsage` must not be gated on parts. |
| F6 | **Cost is recorded on usage arrival, once.** The host may stop iterating at `finish`, so a post-stream `recordCost` can be skipped; the adapter records from the first usage event and a flag prevents a second row. | §7.1 F4 generalises: any ledger write rides the usage chunk, not the stream tail. |
| F7 | **`ToolCallId` is a type brand, not runtime state.** The pre-P3 adapter branded ids; the pipe emits plain strings, which the host assembler accepts (`brandString` is identity at runtime). | Pipes stay free of `dsh-llm` imports (G8); a provider that needs a branded value brands it above the pipe, never inside it. |

No core edit was required: `normalizeStream` dispatched the fragmented branch, the empty/cut/abort
policy and the `prompt+output` writer without a change. The docs corpus
(`https://docs.deepinfra.com/llms-full.txt`) also confirmed what the previous round had only
measured — `reasoning_content` reaches each streaming delta, and `usage.estimated_cost` is
documented — while the fragmented tool-call shape itself remains measurement-only.

## 8. Gates

| # | Gate | Threshold |
| :--- | :--- | :--- |
| G1 | One implementation | `readSseEvents` / block emitter / usage / finish exist in exactly one file in the workspace |
| G2 | Finish parity | all provider tables produce the same `FinishReason` for the same semantic class |
| G3 | Usage parity | disjoint buckets; `totalTokens` present only when the provider total agrees |
| G4 | Failure shape | every `finish{kind:'error'}` carries `message` **and** `code` |
| G5 | Order | `usage` before `finish`, nothing after, `block-end` before `usage` |
| G6 | Index | first-seen allocation, no fixed index constants |
| G7 | Extension | removing every hook still yields a valid wire-only pipeline; adding `classifyText` needs no pipeline edit |
| G8 | No engine | pipeline registers no adapter, owns no provider table, imports no `dsh-llm` registry |

## 9. Non-goals

- No router engine, no second routing table (R0 unchanged).
- No shared adapter instance and no shared request builder.
- No retry loop inside the pipeline — that stays [RETRY-POLICY.md](./RETRY-POLICY.md).
- No catalog, auth, or UI seat in this module.
- No live-profile edit, restart, or version change in this round.

## 9.1 Execution surface — what is callable today

The pipe is a **library**, so most of it is exercised through a test runner. There is one
purpose-built executable surface, added 2026-11-07 because a unit suite cannot prove the
property that matters for a shared component: that it dispatches **with none of the vendor
plugins loadable**.

| Surface | Command | What it proves | Exists? |
| :--- | :--- | :--- | :--- |
| Unit suite | `npm test` | pipe behaviour per module (SSE, usage, finish, lifecycle, hooks) | **yes** — 71 tests |
| Syntax gate | `npm run check` | every shipped module parses | **yes** — 12 files |
| **Standalone dispatch verifier** | `npm run verify:stream` | the real pipe dispatches two independent provider hook sets while **all three vendor packages are blocked at module resolution** | **yes** — `scripts/verify-stream.mjs`, 7 cases |
| Machine-readable verifier | `npm run verify:stream:json` | the same, as JSON (`ok`, `passed`, `vendorLoads`, per-case results) | **yes** |
| Everything | `npm run verify` | `check` + `test` + `verify:stream` | **yes** |
| Binary / `bin` entry | `npx dsh-custom-router …` | — | **no, by design** — see below |
| DSH plugin mount | profile bundle | — | **no, by design** — `@nolit/dsh-custom-router` is not in any `dsh.profile.bundles` |

**Why there is no `bin` and no mount.** This package is a shared library plus specifications. A
`bin` would imply an operator-facing command the package does not have, and mounting it would
register no provider while making the ownership map wrong
([README-OWNERSHIP.md](./README-OWNERSHIP.md) §4). The one executable is a verifier, so it is a
`scripts` entry, not a binary.

**How the verifier proves independence.** It installs a `module.registerHooks` resolver that
throws for `/dsh-antigravity/`, `/dsh-deepinfra/` and `/dsh-opencode-v2/` *before* the pipe is
imported, then drives `normalizeStream` through two provider hook sets whose descriptors differ
(`fragmented` vs `complete`, `prompt+output` vs `prompt+output+reasoning`). The negative control
was run in the same round: importing a blocked vendor file fails with `blocked: …`, so a pass is
not an artifact of a resolver that never fires.

## 10. P1 verification (measured 2026-11-07)

| Check | Command | Result |
| :--- | :--- | :--- |
| module syntax | `npm run check` | 12 files pass |
| module suite | `npm test` in `dsh-custom-router` | **71 pass / 0 fail** |
| consumer count | `grep -rn "custom-router/stream" dsh-*` | **0** — no vendor imports it yet |
| vendor suites unaffected | each track's `npm test` | antigravity 118, deepinfra 158 (+7 skip), opencode-v2 453 — all pass |
| no registry | review of `lib/stream/` | imports only `./failure.js`, `./sse.js`, `./usage.js`, `./wire.js`; no `dsh-llm`, no adapter, no retry loop |
| **standalone dispatch, zero vendors** | `npm run verify:stream` | **7/7 cases, 0 vendor module loads** — the pipe dispatched fragmented and complete tool-call shapes, two usage formulas, the filtered/empty/abort terminal policies, all with the three vendor packages unresolvable |
| negative control | import a blocked vendor file under the same hook | fails with `blocked: …` — the blocker really fires |

Behaviour pinned by the suite: first-seen index allocation; `block-end` carries the full
accumulated block; `usage` before `finish` with nothing after; silent argument-only tool
fragments; whole-call providers; stop→tool-calls promotion; the six-way finish table; disjoint
usage buckets with the three-case `totalTokens` rule; mandatory `{message, code}`; in-band empty
completion; cut preserves partials and the original cause; abort is its own kind; `PROTOCOL_DEFECT`
throws while a transport cut ends in-band; `classifyText` is the only path from text to a call;
and every hook overriding the core without an edit.

Next step is **P2 (`dsh-antigravity`)** and requires owner approval. Nothing in this package
mounts, registers, retries, or touches live state.
