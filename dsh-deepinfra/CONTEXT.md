# Session Context — @nolit/dsh-deepinfra

<!-- skeleton:
version: 1.0
kind: index
status: active
updated: 2026-11-05
summary: The context a future session must load before touching this plugin — current version and state, the seven defects already made here and the rule each one produced, where each fact is measured from, and the exact verification commands.
-->

> **Read this first, then [ARCHITECTURE.md](ARCHITECTURE.md).** This file exists so a later session
> does not repeat a mistake that has already been paid for.
> History: [CHANGELOG.md](CHANGELOG.md) · Operator manual: [README.md](README.md) ·
> Vendor behaviour: [UPSTREAM-COMPAT.md](UPSTREAM-COMPAT.md)

## 1. Current state

| | |
|---|---|
| Package | `@nolit/dsh-deepinfra@0.2.5-rc.1` |
| Provider route | `deepinfra` (one route, one bearer key, no daemon) |
| Tests | 155 total; 148 pass + 7 self-skip without a key |
| Live profile | registered in `~/.dsh/profiles/web` (link dependency + bundle row + key in patch) |
| Catalog | 91 chat routes across 20 vendors |
| Ledger | `$DSH_HOME/deepinfra-session-cost.json` |

## 2. The seven defects made here, and the rule each produced

Every one of these passed `node --check`, the unit suite and `--dump-config` first.

| # | Defect | Rule it produced |
|---|---|---|
| 1 | `ctx.profileDir` read without `inject` → whole entry down | Declare a service or read it through the `optional()` guard. Never a bare `ctx.<svc>` for something not in `inject`. |
| 2 | Declaring web-only services gated the model route (headless `NO_ADAPTER`) | `inject` lists only what the plugin cannot serve **any** surface without. The panel mounts via `ctx.inject([...])`. |
| 3 | ES-module syntax in the client bundle → `web boot: 1 entry did not activate` | The client is a `window.__ModuleLoader__` CommonJS factory. Messages are inlined, not imported. |
| 4 | `ctx.connection.register` invented → four 404s while tests were green | The seam is `ctx.connection.fetch.register`. A test fake must mirror the measured host, not the guess. |
| 5 | `block-end` emitted `text: ''` → completed turn with an empty message | `block-end` carries the ASSEMBLED block. Assert content, not just chunk order. |
| 6 | 1 s debounce + `unref()` → ledger never written on short runs | Never `unref` a timer that guards a write. Persist synchronously on the event that matters. |
| 7 | Empty tool `description` → HTTP 500 on **every** Anthropic route | Required non-empty fields must be guaranteed by the serializer, not by the caller. |

## 3. Things measured here that contradict plausible assumptions

Do not re-derive these; they cost requests to establish.

| Assumption | Measured reality |
|---|---|
| "Cost must be derived locally" | `usage.estimated_cost` is exact USD on every completion |
| "There is a 16,384 output cap" | None. 50000 returns 200; catalog `max_tokens` equals `context_length` on all 91 routes |
| "Stop allows at most 4" | 16; 32 returns 422 |
| "57 of 148 routes lack `context_length`" | 0 of 91 chat routes lack it |
| "Tags predict reasoning" | `DeepSeek-V3.2` has neither reasoning tag and emitted 50 reasoning deltas with an effort |
| "Metadata has a promo tag" | Only `metadata.discount`; the tag vocabulary is capability only |
| "Reasoning tokens are always reported" | Absent entirely on some routes; report `undefined`, never 0 |
| "OpenAI-compatible means identical" | Anthropic needs a tool description; see UPSTREAM-COMPAT.md |

## 4. Where each fact must be read from

| Question | Source of truth |
|---|---|
| What does the wire look like? | Fire a request. Vendor docs are a prior, not evidence. |
| What does the host require? | Installed `@deepseek-ai/dsh-llm/lib/types`, not the online docs |
| What can the settings UI write? | Only `.volatile()` fields (`SettingsForms.write` → `volatileForm`) |
| Does the plugin mount? | An isolated real boot. `--dump-config` proves composition, never mounting. |
| Does the client load? | A real browser boot; the loader evaluates the file as a plain script |
| What does the model picker show? | `/api/session/modelCatalog` in an authenticated page |

## 5. Isolation rules (learned the hard way)

- **Never run a save path against the live profile.** `test/setup-isolate.mjs` sets a throwaway
  `DSH_HOME`; `npm test` loads it via `--import`. Verified by comparing the live ledger's session
  count before and after a full run.
- Any test that constructs a server must set `DSH_HOME` itself, because the ledger path resolves
  from it and the plugin WRITES on every recorded request.
- A live write that is genuinely required is backed up first and its exact field restored after.

## 6. Verification commands

```bash
npm run check                          # node --check on all 11 modules
npm test                               # 148 pass + 7 self-skip, live state untouched
set -a; . ~/.env; set +a; npm test     # 155/155 including live API
```

Mount proof (does not touch the live service):

```bash
ISO=$(mktemp -d); export DSH_HOME=$ISO
dsh --from-default-profile web --profile diw >/dev/null
dsh plugin --profile diw add link:$PWD
dsh --profile diw --host 127.0.0.1 --port 3097 --no-open &
grep -c "did not activate" /tmp/diw.log   # must be 0
```

## 7. Open items

| Item | State |
|---|---|
| Live service restart | **Owner action.** The plugin is registered but the running process predates it. |
| `session-x` legacy ledger row | Has `listCostUsd: 0` because it predates the dual-figure change. New turns record both. |
| `openai/gpt-oss-120b` | Returned 429 `engine_overloaded` during the survey; retry later to complete its row. |
