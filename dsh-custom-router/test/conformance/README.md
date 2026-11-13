# Protocol conformance fixtures

One recorded SSE stream per wire, driven through **every** router binding that
speaks that wire. The point is re-standardization: when OpenAI changes a field,
this suite fails once, and the fix lands in the shared `lib/stream` pipe or the
protocol contract — not in three vendor copies.

## Current coverage

| Fixture | Wire | Bindings |
|---|---|---|
| `fixtures/openai-completions.sse` | `openai-completions` | `vendor/deepinfra/lib/stream-contract.js`, `vendor/exaone/lib/stream-contract.js`, `vendor/opencode/lib/stream-contract.js` |
| `fixtures/anthropic-messages.sse` | `anthropic-messages` | `lib/stream/anthropic.js` via `vendor/deepinfra/lib/stream-anthropic.js` (`createAnthropicBinding`); request side also pins `vendor/antigravity/lib/wire.js` (`toContents`) and `vendor/deepinfra/lib/wire.js` (`requestBodyAnthropic`) |
| `fixtures/google-generative-sse.sse` | `google-generative-sse` | `vendor/antigravity/lib/stream-contract.js` (`STREAM_DESCRIPTOR` + `STREAM_HOOKS.readEvent`); request side pins `vendor/antigravity/lib/wire.js` (`toContents`) |

The openai-completions fixture covers: reasoning deltas (`reasoning_content`),
text deltas, fragmented tool calls (`tool_calls[]`), `finish_reason`, usage with
`prompt_tokens` / `completion_tokens` / `reasoning_tokens` /
`prompt_tokens_details.cached_tokens`, and the `[DONE]` sentinel.

The anthropic-messages fixture covers: `thinking_delta` reasoning deltas,
`text_delta`, fragmented `input_json_delta` tool-call arguments, `stop_reason`
(`tool_use` → `tool-calls`), and usage split across `message_start`
(`input_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) and
`message_delta` (`output_tokens`). Two Anthropic-specific rules are asserted
beyond the shared canonical view:

- **Usage merge.** The pipe *replaces* usage per record, so the hooks must return
  the cumulative counters on every usage-bearing record. A delta forwarded as-is
  would erase `message_start`'s input counts.
- **Signature accumulation.** Fragmented `signature_delta` events concatenate
  into one per-block thinking signature (`hooks.signature(index)`), which is not
  in the chunk view but is what makes a later request replay the thinking block.
- **Request-side tool-result grouping.** Two results of ONE assistant turn must
  land in the SAME user message — Gemini-envelope `functionResponse` parts in one
  turn, and Anthropic-native `tool_result` blocks in one `user` turn. Splitting
  them is the shape Anthropic rejects (measured 2026-11-14 on `claude-opus-5-5`:
  "tool_use ids were found without tool_result blocks immediately after").

`totalTokens` is deliberately absent for this fixture: Anthropic reports no
total, and `usageFromAnthropic` omits it rather than inventing
`input+output+cache`.

The google-generative-sse fixture covers: `thought: true` reasoning parts, plain
`{ text }` parts, a **whole** `functionCall` (`args` is an object on the wire,
stringified exactly once by the pipe), `finishReason`, and cumulative
`usageMetadata` (`promptTokenCount` / `candidatesTokenCount` /
`thoughtsTokenCount` / `cachedContentTokenCount` / `totalTokenCount`). Three
Gemini-specific rules are asserted beyond the shared canonical view:

- **Whole parts, not deltas.** This wire sends a complete part per frame, so
  `toolCallShape` is `complete` and exactly one `tool-call-delta` is emitted —
  no fragment ordinals. A replay of a fragmented shape must not be assumed here.
- **Cumulative usage.** `usageMetadata` is the running total, never summed across
  frames; `promptTokenCount` *includes* cache hits, so `cachedContentTokenCount`
  is split out into its own bucket rather than double-counted.
- **Request-side `thoughtSignature` placement.** A replayed signature is a
  **part-level sibling** of `functionCall`, never a key inside it (measured
  2026-11-14, live 400: `Unknown name "thoughtSignature" at
  'request.contents[5].parts[0].function_call': Cannot find field.`). The test
  pins the exact path `contents[N].parts[0].thoughtSignature`, walks the whole
  subtree to prove no `thoughtSignature` is reachable under any `functionCall`,
  and asserts an unsigned call carries no such key at all.

## Coverage of the declared wires

`specs/protocols/` declares five wires. Three now have a conformance fixture;
**two remain uncovered — `openai-responses` and `google-generative-ai`** (the
latter being the non-streaming sibling of the covered google-generative-sse
shape). Each needs its own recorded fixture and binding descriptor before the
table above is complete.

## Run

```bash
node --test test/conformance/*.test.mjs
# or the whole router suite
npm test
```

## What is asserted

A canonical semantic view — reasoning text, text, tool-call id/name/arguments,
finish kind, and disjoint usage buckets — must be **identical** across every
binding. The DeepInfra view is also pinned literally, so three bindings that
regress together still fail.

Zero-valued optional usage buckets (`cacheWriteTokens: 0`, `cacheReadTokens: 0`,
`reasoningTokens: 0`) are dropped before comparison: OpenCode's writer emits
`cacheWriteTokens: 0` where DeepInfra omits it, which is not a semantic
difference. Any non-zero bucket must match exactly.

**Not covered:** request serialization, vendor HTTP, retries, catalog/pricing
facts, and per-vendor error mapping. Those live in each vendor's tests and in
`specs/`.

## Adding a fixture when a wire changes

1. Record a real (or documentation-shaped) SSE stream into
   `fixtures/<wire>.sse`. Keep it small but include every signal the canonical
   view reads.
2. Add one entry to `BINDINGS` in the matching `*.test.mjs` with the contract's
   descriptor and hook factory. OpenCode-style stateful hooks must be created
   per run (`hooks: () => createStreamHooks()`), never shared.
3. If the wire's canonical mapping changes, bump `revision` in
   `specs/protocols/<wire>.json` and `verifiedAt`, then regenerate the matrix
   (`npm run specs:build`).
4. If a binding intentionally differs, encode the expected deviation explicitly
   with a comment — never widen the comparison silently.
