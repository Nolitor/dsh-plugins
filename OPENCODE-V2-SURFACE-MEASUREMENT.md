# OpenCode v2.2.0 CLI surface — measured 2026-10-29 (post-bootcard 0919)
<!-- skeleton:
version: 1.1
kind: measurement
status: measured
updated: 2026-10-29
summary: Measured opencode v2.2.0 CLI surface: event schema, session-export tokens, removed flags, and per-model reasoning variants; corrects the 0919 boot card.
-->


> Status: **measured** · Target: `opencode v2.2.0` (`~/.bun/bin/opencode`, SHA-256
> `87a4d6ac…91fad0`) · Runtime: DSH `0.2.2-alpha.2` · Method: direct CLI probes from a
> **non-sandboxed** bash with the real `HOME`, plus the host contract in
> `@deepseek-ai/dsh-llm/lib/types/types.d.ts`.

## 0. Corrections to boot card §7.1

| §7.1 claim | Reality (measured) |
|---|---|
| "Runtime context: only workspace rw; cannot run `dsh plugin add`" | **False now.** This bash is *not* bwrap'd (`/proc/mounts` = plain ext4 rw). `~/.dsh` and `~/.config` are writable. |
| "REAL failure: `opencode-go/mimo-v2.6-flash` → `provider.no-route`" | **False in the current environment.** The run succeeds and returns text. All 45 catalog models are under `opencode-go/` (30) and `opencode/` (15). `auth list` shows 4 stored credentials (OpenCode Go, Console×3). |
| "`opencode models` → 8 models" | 45 models (30 `opencode-go/*`, 15 `opencode/*`). |
| "v2 has no `--attach`, no `--pure`" | **True.** `--attach`/`--pure` → `Unrecognized flag`, exit 1, usage text on **stdout**. |
| "v2 emits no `step_finish` → tokens always 0" | **True only for tool-free runs.** A text-only run emits `step_start`, `reasoning`, `text` — no `step_finish`, so upstream's `step_finish` token sum stays 0. A run that uses a tool emits `step_finish` **with** a `tokens` object (`input`/`output`/`reasoning`/`cache.read`/`cache.write`) for that step, so upstream reports a partial, per-step total instead of 0. Either way `step_finish` is not a whole-run total, so `session export` remains the only authoritative source. |
| "`--thinking` emits parseable `reasoning`" | **True**: `{"type":"reasoning","part":{"id":"…_reasoning-0","type":"reasoning","text":"…"}}`. |

> The 09:19 card's model-route diagnosis is **environment-specific** (it ran with a fake
> `HOME=/tmp/fakehome`, which has no `auth.json`). With the real home, `-m opencode-go/...`
> and `-m opencode/...` both work. Keep the card's *advice* (default to `opencode/...`, never
> assume a route) but drop "no-route" as a fact.

## 1. Event stream (`run --format json`)

```jsonl
{"type":"step_start","timestamp":…,"sessionID":"ses_…","part":{"id":"prt_…","type":"step-start"}}
{"type":"reasoning","sessionID":"ses_…","part":{"id":"prt_…_reasoning-0","type":"reasoning","text":"…"}}
{"type":"text","sessionID":"ses_…","part":{"id":"prt_…_text-0","type":"text","text":"…"}}
```
- `part.text` is a **cumulative snapshot**, not a delta (existing parser already diffs it).
- A tool-free run emits no `step_finish`, no `usage`, no `cost` → its token total is 0 to any `step_finish` reader.
- A run that uses a tool emits `step_finish` for that step, carrying `part.tokens`
  (`input`/`output`/`reasoning`/`cache.read`/`cache.write`) and `part.cost`. That is a **per-step**
  total, not the whole run: a two-step run reports the tool step's tokens only and omits the final
  text step's. Whole-run totals must come from elsewhere.
- `--thinking` is required for `reasoning` to appear.

## 2. Authoritative token source: `opencode session export <sid>`

```json
"info": { "cost": 0,
  "tokens": { "input": 1005, "output": 4, "reasoning": 9,
              "cache": { "read": 4096, "write": 0 } },
  "outcome": "succeeded",
  "model": { "id": "mimo-v2.6-flash", "providerID": "opencode-go", "variant": "default" } }
```
Maps onto the host `TokenUsage` contract (`dsh-llm` `types.d.ts:161`), which is **disjoint**:

| host field | source |
|---|---|
| `inputTokens` | `tokens.input` (already uncached-only) |
| `outputTokens` | `tokens.output` |
| `reasoningTokens` | `tokens.reasoning` |
| `cacheReadTokens` | `tokens.cache.read` |
| `cacheWriteTokens` | `tokens.cache.write` |
| `totalTokens` | `input + output + reasoning + cache.read + cache.write` |

Session continuation with a **different** `-m` on an existing `-s` session works (verified:
`mimo-v2.6-flash` → `deepseek-v4.1-flash-free`), so per-route spawn is safe.

## 3. Other v2.2.0 facts

- `run` flags present: `-c/--continue`, `-s/--session`, `--fork`, `-m/--model
  provider/model#variant`, `--agent`, `--format {default,json}`, `-f/--file`, `--title`,
  `--thinking`, `--auto`. Global: `--standalone`, `--server <url>`, `--print-logs`,
  `--log-level`.
- Delegation uses a **background managed service** (`opencode serve --service`, default port
  49374). A stale service from another `HOME` squats that port and makes every command fail
  with `Managed service port 49374 … already in use`. (One such stale `/tmp/oc2` service was
  left over and had to be killed during this measurement.)
- Tool-result metadata is invisible to `dsh-tools` (`additionalProperties:false`), so
  `presentResult` cannot render any new field.

## 4. Consequences for the `dsh-opencode-v2` work

1. Upstream still works → **stays a dependency**, wrapped, never patched.
2. Remove `attach`/`pure` from argv; keep accepting the keys so existing profiles still load.
3. Add `thinking`; stream `reasoning-delta` on its own block index, text on another.
4. Fetch usage from `session export <sid>` **after** the run; fall back to the existing
   char-heuristic only when the export fails.
5. Timeout/permission: `--auto` mapping unchanged; `title` should be passed for `/opencode`.

## 5. Reasoning levels — model `variants` (measured 2026-10-29T1027+0900)

The `-m provider/model#variant` form in §3 is the **reasoning-level selector**, and the level list
is discoverable per route. Measured with `opencode serve --port 0` -> `GET /api/model`:

| Fact | Value |
|---|---|
| models | 45 |
| models with non-empty `variants` | **35** |
| variant ids | `high` 30, `low` 29, `max` 22, `medium` 20, `xhigh` 17, `none` 13, `minimal` 4, `thinking` 1 |
| entry shape | `{ id: "low", settings: { reasoningEffort: "low" } }`; Gemini-style routes use `settings.thinkingConfig.thinkingLevel`; `minimax-m3` uses `settings.thinking` |
| example | `opencode-go/deepseek-v4.1-flash` → `low`, `high`, `max`; `opencode/beam-free` → `low`,`medium`,`high`,`xhigh`,`max` |
| routes without variants | `opencode/big-pickle`, `opencode-go/longcat-2.0`, `opencode-go/mimo-v2.6-*`, `opencode-go/kimi-k2.7-code`, … (10) |

Behaviour:

* `-m opencode/deepseek-v4.1-flash-free#low` and `#high` both exit 0; same prompt, reasoning text
  46 vs 4 chars — the variant reaches the provider, it is not cosmetic.
* An unknown variant fails the run without a model call:
  `{"type":"error","error":{"type":"provider.no-route","message":"Variant unavailable for opencode/deepseek-v4.1-flash-free: bogus"}}`
* `--thinking` is orthogonal: it makes OpenCode stream `reasoning` blocks; the variant decides how
  much reasoning the model does.

Host mapping (`@deepseek-ai/dsh-llm` `LlmModelReasoningInfo`):

| Host field | OpenCode source |
|---|---|
| `reasoning.efforts[].id` / `.name` | variant id + display name (canonical order none→minimal→low→medium→high→xhigh→max, unknown ids appended) |
| `GenerateOptions.reasoningEffort` | `-m provider/model#<variant>` |
| `reasoning.defaultEffort` | not set — OpenCode's own default variant applies |

`opencode models` (the CLI fallback) lists ids only and therefore yields **no** levels; only the
`serve` discovery path can. Implemented and verified in `dsh-opencode-v2@0.1.2` (§12 of its
`VERIFICATION.md`).

### 5.1 Reading the banner requires a piped stdout

`dsh-subprocess` exposes a raw `Readable` only when the child is spawned with `stdout: 'pipe'`;
a collect-mode stdout (`{ maxBytes }`) exposes `collected.stdout` and `handle.stdout === undefined`
(`dsh-subprocess/lib/types/types.d.ts:159`). The v0.1.1 discovery probe spawned serve in collect
mode and read `handle.stdout`, so it returned null before the HTTP call: every route silently used
the conservative 32768-token floor and had no variants. Measured through a real profile mount,
before → after the v0.1.2 fix:

| Route | Before | After |
|---|---|---|
| `opencode-go/deepseek-v4.1-flash` | `ctx=32768`, no levels | `ctx=1000000`, `low\|high\|max` |
| `opencode-go/kimi-k3.1-pro` | `ctx=32768`, no levels | `ctx=1048576`, `low\|high\|max` |
| routes with levels | 0 / 46 | 35 / 46 |

The floor kept `compaction-basic` from throwing, so the degradation was invisible without
measuring the catalog itself.
