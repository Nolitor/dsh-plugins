# Changelog — @nolit/dsh-antigravity

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-05
summary: Engineering history for @nolit/dsh-antigravity, including the rc.6 fix for empty stored answers and the route-gated usage chip. Created 2026-11-05 by merging the CLI worker surface of @nolit/dsh-antigravity-cli with the HTTP model route proven in @nolit/dsh-antigravity-directsdk, plus a settings section, a usage chip and per-surface switches.
-->

Current version: `0.0.1-rc.7`


### 2026-11-05 — absorbed tracks moved to `archive/` (this package now owns their surfaces)

Three tracks this package absorbed were still sitting in the active tree; they were moved to
`archive/` the same day, and two stale `node_modules` links were removed from the live profile.

| Track | Surface this package serves | Archived |
| :--- | :--- | :--- |
| `dsh-antigravity-directsdk` | the `antigravity` provider route (`ctx.llm.registerAdapter`) | `archive/dsh-antigravity-directsdk/` |
| `dsh-antigravity-cli` | `/agy`, `agy_worker` | `archive/dsh-antigravity-cli/` |
| `dsh-subagent-antigravity` | `antigravity` subagent provider + `subagent_antigravity` row | `archive/dsh-subagent-antigravity/` |

Measured state that made the move safe: all three contributed **0** rows to
`dsh --profile web --dump-config`, were absent from the profile `dependencies` and
`dsh.profile.bundles`, and nothing in `lib/` imported them. The live `tool-subagent-antigravity` row
is composed from THIS package (`# == @nolit/dsh-antigravity`), not from the archived track.

A broken `node_modules/@nolit/dsh-subagent-antigravity` symlink had been left in the live profile
since 2026-11-05 05:42; it was removed with a manifest at
`~/.dsh/quarantine-backups/broken-links-20261105_151848.txt`.

Version unchanged (`0.0.1-rc.7`): no code in this package changed. Process record:
[HISTORY.md H-1/H-2](../HISTORY.md), [docs/FAILURE-LEDGER.md F-50/F-51](../docs/FAILURE-LEDGER.md).
Absorbed tracks leaving the active tree is now a standing rule
([docs/PLUGIN-CONSOLIDATION.md §2.1](../docs/PLUGIN-CONSOLIDATION.md)).

## 0.0.1-rc.7 — version ladder + DSH 0.2.2-rc.1 policy pass — 2026-11-05

Owner decision (2026-11-05): every `@nolit` track reports `0.0.1-rc.N`; the rc number is the
only part that moves per session. This track moved `0.0.1-rc.6` → `0.0.1-rc.7`.

| Surface | Before | After |
| :--- | :--- | :--- |
| `package.json.version` | `0.0.1-rc.6` | `0.0.1-rc.7` |
| `engines.node` | `^22.19.0 \|\| >=24.0.0` | `>=24.9` (DSH 0.2.2-rc.1 minimum) |
| `engines.dsh` | `>=0.2.2-alpha.2 <0.3.0` | unchanged — the range already admits `0.2.2-rc.1` |
| Locale | English default, Korean via `locale/*.json` | unchanged; `locale/en.json` + `locale/ko.json` both complete |
| Tests | 103/103 | 103/103 green |

rc.1 audit (measured against the installed 0.2.2-rc.1 tree): both tool registrations are already
`defineTool`-shaped and use `tools.register` (no internal `tools.resolve`/`executable` read);
no Session Projection registration, no `app-boot`/official-bundles import; `peerDependencies.cordis`
`^4.0.4` admits 4.1.0; the usage chip already occupies the additive `conversation.input.right` list
seat. Nothing structural was needed.

### CLI worker now runs as a managed child session (same rc.7, owner decision 2026-11-05)

Owner decision, measured symptom: bare CLI execution left sessions in the sidebar's ungrouped
bucket because the work never became a tracked child session. The worker surfaces now delegate
through the shared subagent seam. Version stays `0.0.1-rc.7` (same session, owner normalization).

| Surface | Before | After |
| :--- | :--- | :--- |
| `agy_worker` execute | spawned `agy` directly (`runAgyWorker`), awaited stdout, returned the final text | calls `ctx.subagents.startActivation({provider: subagentProviderName (default `antigravity`), label, request: {parent: exec.agent, prompt: [text], cwd?}, signal: exec.signal, delivery: 'parent'})` and returns `{kind:'activation', subagentId, provider, label, status}` immediately |
| `/agy <task>` | spawned `agy` directly, awaited and returned the final text | starts the same managed child, prints its id, and states that the answer arrives as a completion notice |
| `/agy models` | read-only `agy models` process | **unchanged** (still a read-only listing, starts no session) |
| Missing `ctx.subagents` | would have spawned an untracked process | fails with a message naming the missing subagent service; **no process is spawned** |
| Missing provider / calling agent | n/a (no provider needed) | fails with a message naming the missing provider (or agent); no process is spawned |
| Per-call model/effort/mode/timeout | documented flags were not parsed by the merged command | removed from the documented surface: model/effort/mode are the plugin settings the subagent provider uses; the `/agy` hint no longer advertises non-working flags |
| Direct CLI code | `lib/worker.js` carried `runAgyWorker` + argv/collection helpers; `lib/selection.js` carried the last-selection store | `runAgyWorker` and `readSelection`/`writeSelection` removed; `lib/worker.js` keeps only `listAgyModels`; `lib/selection.js` deleted. The provider (`lib/subagent.js`) still runs `agy` for the child, as before |
| Tool shape | `output: {content, isError}` | `output: {kind, subagentId, provider, label, status}` + `presentCall`/`presentResult` cards |
| Tests | `test/cli-worker.test.mjs` exercised `runAgyWorker` directly (4 tests) | rewritten to 16 activation/error/listing/provider tests with a mocked `ctx.subagents`; suite `103/103` → `115/115` |

UX the owner must know: `/agy <task>` and `agy_worker` no longer return the answer inline. They
return a child session id; the result is delivered later as a completion notice, and the child is
visible as a tracked session. A failure after the child starts is reported in that notice, not in
the tool result. `/agy models` behaviour is unchanged.

#### Defect found by this change (measured in an isolated boot)

The first isolated `/agy` execution returned
`could not start the Antigravity child session: cannot get property "subprocess" without inject`.
Cause: the subagent provider was constructed with the plugin's outer `ctx`, which injects only
`llm`, while `AntigravitySubagentProvider.start()` reads `ctx.subprocess` — an undeclared service
read (FAILURE-LEDGER F-44 class). The provider had never been exercised through a real activation,
so unit mocks with plain properties stayed green. Fixed by handing the provider the acquired
`{ subprocess: services.subprocess }` service object and by not registering the provider until that
service exists; two regression tests now cover provider start and the no-subprocess case.

#### Verification (isolated DSH_HOME, real browser, real agy)

| Step | Measured |
| :--- | :--- |
| isolated `--dump-config` | exit 0, 321 rows, `dsh-antigravity` + `tool-subagent-antigravity` rows present |
| boot | no `did not activate` / `cannot resolve` / `Invalid effect` |
| browser: type `/agy Reply with exactly CHILD-OK and nothing else.` | page errors 0; transcript shows `started Antigravity child session d7962b40-bace-4274-ad7d-55e1aec2a657 (antigravity)`; panel shows **서브에이전트 1개** |
| session log `command/done` | `kind: "success"`, same child id |
| session log `subagent/catalog` | `childId: d7962b40…`, `mode: "external"`, `label: "Reply with exactly CHILD-OK and nothing else."` |
| session log later | `agent/inbox/spliced` + `user/message` of source kind `subagent-settled`: “Background subagent d7962b40… finished.” with closing message **`CHILD-OK`** — the completion notice arrived on the parent |
| parent turn | ended `ACCOUNT_SIGN_IN_REQUIRED` only because the isolated DSH_HOME has no DeepSeek account credential; the command and child path completed independently of the model route |
| bare-process check | no `agy -p` process owned by the plugin; `agy` ran as the subagent provider's child process, watched by the activation manager |

The child is an **external** activation: it is tracked in the parent session's subagent catalog
(and in the sub-agent panel) but creates no separate top-level DSH session, which is the behaviour
the owner asked for.

## 0.0.1-rc.6 — the answer is no longer eaten; the usage chip is route-gated — 2026-11-05

Two owner-reported defects, measured in the live session log
`session-13e95450-0a9b-4a5a-b49b-a3ac85237e4d` (read-only, not modified) and reproduced in an
isolated DSH_HOME. Version moved `0.0.1-rc.5` → `0.0.1-rc.6` (rc is agent-owned; numeric track
owner-owned). **applied pending restart** — the running daemon still serves the module loaded at boot.

### D1 — every final answer was stored as an empty assistant message ("AI가 한 답변을 모두 먹어버리는")

| Measured before (session-13e95450, event 178 / 186) | After |
| :--- | :--- |
| `text-chunks` carried 49 and 55 text fragments (2,403 and 2,696 chars), then `block-end` emitted `{"type":"text","text":""}` | `block-end` emits the concatenation of the block's deltas |
| the host persisted `content:[{type:'text',text:''}]` — the transcript showed no reply | the stored message carries the full answer |
| reasoning blocks had the same defect (`block-end` text `''`) | reasoning text is accumulated too |

Cause: the provider streams whole parts, and `lib/adapter.js` closed every block with a hardcoded
empty string. `block-end` is the authoritative block the host persists, so every streamed answer
was discarded. Fixed by accumulating per index (`textByIndex`) and emitting that on close. The
deltas are still emitted for the live view.

### D2 — the usage chip was not gated on the selected route ("다른 플러그인 모델 서빙해도 이렇게 표시가 되네")

The chip rendered whenever the plugin was enabled and the ledger was non-zero. It therefore kept
showing Antigravity's cumulative token count beside another provider's model selector — the
screenshot in the report showed the DeepSeek model selector with `사용량 179,958` still attached.
Fixed: `isOwnRoute()` reads the composer's `data-provider-id` chip (the same measured DOM contract
the opencode-v2 track uses) and compares it with `PROVIDER_ID = 'antigravity'`; `watchRoute()` is an
attribute-filtered `MutationObserver`, and the 5 s `/info` poll only runs while the route is ours.
No chip, no poll, no request on a foreign route.

### Verification (isolated DSH_HOME, real browser, real client bundle)

| Step | Measured |
| :--- | :--- |
| shell boot | 0 page errors, all entries active |
| picker → `antigravity/gemini-3.8-flash` | chip `사용량 1,025` at x=930,y=525; model selector at x=1026,y=524 (chip immediately left) |
| picker → `deepinfra/deepseek-ai/DeepSeek-V4.1-Flash-1017` | chip **absent**; 0 `/info` requests in the 6 s after the switch (before the fix it kept the chip and polling) |
| route rewrite → `deepseek-account` | chip absent |
| real turn on `antigravity/gemini-3.8-flash` | prompt `Reply with exactly this token…` → assistant message **`ANTIGRAVITY-OK`** rendered in the transcript; chip read `사용량 11,570` beside the selector — the stored answer is no longer empty |
| `npm test` | 103/103 (2 new adapter cases, 7 new chip-gate cases) |

## 0.0.1-rc.5 — generation retry parity — 2026-11-05

The 2026-11-05 post-mortem showed the OpenCode HTTP route losing a 27-step subagent turn to one
unretried `451`. Antigravity is the sibling model route used by the same subagents, so it gets the
same resilience contract instead of remaining the weaker link.

| Failure class | Change |
| :--- | :--- |
| a retryable refusal (429/451/500/502/503/504) failed the turn on first answer | `httpRetries` (default 3), `httpRetryStatuses`, `httpRetryBaseMs` (1s → 2s → 4s) in `lib/adapter.js`; the body is re-sent before any chunk reached the transcript |
| an expired token (401) failed the turn | token is invalidated and the request retried **once** with a freshly read token; a second 401 still throws `AUTH` |
| 403/404 were indistinguishable from transient faults | still thrown immediately: they need a different credential/model, never a retry |

Version moved `0.0.1-rc.4` → `0.0.1-rc.5` (rc is agent-owned; numeric track owner-owned).
Tests: 4 new adapter cases (429→success, bounded 503, 401 refresh, 403 no-retry); full suite 94/94.
**applied pending restart** — the running daemon still serves the module loaded at boot.

## 0.0.1-rc.4 — 2026-11-05 (live-defect correction)

rc.3 passed 75 unit tests and its client module loaded in isolation, but the live profile did not
contain the package and three host contracts were still wrong. Measured after the 05:13 KST
restart; everything below is a measured before → after, not a plan.

### Live state — the direct cause of the two reported symptoms (F-47)

| Check | Measured |
| :--- | :--- |
| `~/.dsh/profiles/web/package.json` dependencies | no `@nolit/dsh-antigravity`, no `@nolit/dsh-antigravity-cli` |
| same `dsh.profile.bundles` | no antigravity entry at all |
| `~/.dsh/profiles/web/node_modules/@nolit/` | no `dsh-antigravity` link |
| `dsh --profile web --dump-config` | **207 rows, zero antigravity rows** |
| `@nolit/dsh-subagent-antigravity` | present as a dependency, but not in `bundles` and mounted **0 rows** |

So the missing model route and the missing settings tab were a **missing install**, not a client
regression. The 02:51 "Profile swap" entry below was not true at measurement time; it is kept as
history and corrected here.

### Fixed defects (each measured in an isolated profile, DSH 0.2.2-alpha.3)

| # | Defect | Measured evidence | Fix |
| :--- | :--- | :--- | :--- |
| 1 | Every panel route answered **400** while registered | browser `POST /api/local/dsh-antigravity/info` -> 400, empty body; section showed "Could not save: HTTP 400" | the seam requires a WHATWG `Response`; handlers now return one via `json()` (F-45) |
| 2 | `/agy`, `agy_worker` and the subagent provider were **never registered** | slash menu listed no `/agy`; `installed` diagnostic was false | acquire `tools`/`subprocess`/`commands`/`subagents` through `ctx.inject` instead of un-injected property reads (F-44) |
| 3 | `agy_worker` used the pre-0.2 tool shape (`handler`, no `output`) | `tools.register` would reject it even when the service was reachable | `output:{schema,render}` + `execute` (DSH 0.2.2 contract) |
| 4 | Usage chip could only ever show zero | routes created a second `createLedger()` the adapter never saw | one ledger shared by adapter and routes; the adapter records before yielding `usage` |
| 5 | Surface switches saved but did not take effect | `info` showed `modelServing:false` while the route stayed mounted | volatile fields do not re-run `apply`; reconcile every surface on `app-boot/config-reload` (F-46) |
| 6 | `enabledModels` was ignored by the picker until TTL/restart | 15-minute catalog cache | invalidate the catalog on an `enabledModels` change; picker updates immediately |
| 7 | Three picker rows all named "Gemini 3.5 Flash Lite" | server returns the same `displayName` for `gemini-2.5-flash`, `-lite`, `-thinking` | append the id only for duplicated names |
| 8 | Load failure said "Could not save" | the error branch reused `saveError` | new `loadError` string in EN/KO |
| 9 | Master off removed the panel and could not be undone | routes disposed with the product surfaces | panel stays mounted; product surfaces still dispose |
| 10 | "Default" reasoning sent the **high** variant | catalog order is high, medium, low; `modelForEffort` took the first variant when no effort was requested | advertise `reasoning.defaultEffort: 'low'` and prefer `<base>-low` when the host omits an effort |
| 11 | The usage chip claimed the **single** `conversation.input.activity` seat already owned by `tk` | live pageerror `single slot "conversation.input.activity" already has a registration at priority 0 (registered by tk)`; the chip never rendered | register in the additive list slot `conversation.input.right`, the same visual position, so no single seat is contested |
| 12 | The Antigravity tab duplicated the plugin's own options | owner: the master/CLI/usage switches and the account/usage cards belong to the plugin row, not the model surface | the tab now contains **model selection only** (live list, checkboxes, Save); plugin enable/disable stays on the Plugins page |
| 13 | The model list showed reasoning levels as separate models | owner screenshot: `Gemini 3.8 Flash (Low)/(Medium)/(High)` rows; the account's usage page groups by family instead | group by **usage family** (Gemini / Claude-and-GPT / Gemini 4 Argon) and then by **base model**; effort suffixes are hidden and one checkbox owns all variants |
| 14 | The group header showed one quota percentage; the usage page shows weekly and 5-hour limits | owner screenshot: Weekly Limit 97%, Five Hour Limit 98% | call `retrieveUserQuotaSummary` (measured 2026-11-05) and render both buckets per family; the per-model fraction remains the fallback |
| 15 | Three `Gemini 3.5 Flash Lite` ids had identical names and no visible effort | `gemini-2.5-flash-lite`, `gemini-2.5-flash`, `gemini-2.5-flash-thinking` all displayed "Gemini 3.5 Flash Lite" | alias them to one base model with **low / medium / high** respectively; the settings list hides effort, the prompt picker offers the three levels, and the default is **low** |
| 16 | Antigravity was created after the OpenCode v2 stage-1 gate and never had it applied | no load beacon, no restart verifier, no S1–S7 status | added `lib/beacon.js`, `scripts/verify-antigravity-restart.sh`, `scripts/antigravity-browser-boot.mjs`, `scripts/antigravity-stabilisation-status.sh`, and `docs/ANTIGRAVITY-STAGE-PLAN.md` |

### Verification

- **90 tests pass, 0 fail** (`test/server.test.mjs`, `test/ledger.test.mjs`, `test/models-group.test.mjs` and the alias cases in `catalog.test`/`wire.test`; `switch.test.mjs` asserts the panel-stays rule).
- Isolated profile `/tmp/agtest` with a real Chromium boot:
  - settings tab **Antigravity** renders **only the grouped model list, checkboxes and Save
    selection** — families `Gemini Models`, `Claude and GPT models`, `Gemini 4 Argon`, base
    names only (no Low/Medium/High rows), **weekly + 5-hour** quota on each header;
  - toggling one base model and saving updates every effort variant of that model (verified
    isolated: disabling Claude Sonnet 5.5 removed low/medium/high together);
  - live group headers read `주간 97% · 5시간 100%` (Gemini), `주간 100% · 5시간 100%`
    (Claude/GPT), `주간 100%` (Argon);
  - `Gemini 3.5 Flash Lite` is one picker entry; low/medium/high map to
    `gemini-2.5-flash-lite` / `gemini-2.5-flash` / `gemini-2.5-flash-thinking`, default low;
  - stage-1 S1–S5 and S7 PASS, S6 soak UNKNOWN (`docs/ANTIGRAVITY-STAGE-PLAN.md`);
  - `/agy` appears in the slash menu;
  - the model picker shows the `Antigravity (subscription)` route, with the duplicated
    "Gemini 3.5 Flash Lite" names disambiguated by id;
  - `POST switches {"modelServing":false}` flips `installed.model` true -> false -> true **without a restart**;
  - `models/apply {"enabled":["gemini-3.8-flash-low"]}` leaves one picker row immediately;
  - a **real turn** on `gemini-3.8-flash-low` (the model label read "Gemini 3.8 Flash,
    reasoning effort Low") answered `PONG` in 3 s, and the composer chip rendered
    `usage 9,153`; `/info` then reported `requests:2, input:8,950, output:5,
    reasoning:198` — the ledger is wired, not invented.
  - `/agy` is listed in the slash menu. The headless automation could not produce a
    command transcript for `/agy models` (the composer kept opening a fresh session),
    so the command's worker path is covered by `test/cli-worker.test.mjs` rather than
    claimed as a live run.
- **Live install (05:42 KST, no restart).** `dsh plugin --profile web add link:…/dsh-antigravity`
  added the dependency and the bundle. `dsh --profile web --dump-config` went **207 -> 209 rows**
  (this row + `tool-subagent-antigravity`). The service kept `MainPID=2009037` and
  `ActiveEnterTimestamp=05:13:10`, so the host reconciled the new bundle **without a restart**.
  Live `POST /api/local/dsh-antigravity/info` -> **200** with
  `installed:{model,cliTool,cliCommand,subagent,panel}:true`; the live Korean Settings pane lists
  **안티그래비티** and renders **only the model list + Save selection** (the duplicated switches,
  account and usage cards were removed in row 12); the live model picker lists
  **Antigravity (subscription)** and the Gemini/Claude rows.
- One pre-existing console error remains: the single `conversation.input.activity` seat is claimed
  by `tk` and by deepinfra. The merged plugin no longer joins that seat (moved to
  `conversation.input.right`), so the error count dropped by one; that remaining pair is outside
  this package (the owner asked to keep other plugins out of this round).

## [0.1.0] — 2026-11-05

Created by merging two proven pieces plus new UI surface.

### Merged from `@nolit/dsh-antigravity-cli` (CLI surface)

- `/agy` command and `agy_worker` tool, `backends.js`, `worker.js`, `selection.js`,
  `artifacts.js` carried over unchanged.

### Merged from `@nolit/dsh-antigravity-directsdk` (model surface)

- The `antigravity` `LlmAdapter`: OAuth refresh-token grant, catalog, SSE reader,
  usage accounting. Verified live end to end before the merge.

### New in this release

- **Shared credential.** CLI and HTTP read one token file, so the client id/secret
  exists in exactly one place (`lib/settings.js`). Fixes the duplication a
  two-plugin layout would have created.
- **Settings section** (`settings.section`, id `antigravity`): master switch plus
  per-surface switches, account tier, live model list with per-model quota, and
  usage counters.
- **Usage chip** (`conversation.input.right`, a list slot): total measured tokens
  beside the model selector. The single `conversation.input.activity` seat is
  already owned by the token-economizer, so this uses the additive right-hand list.
  Renders nothing when disabled, so no empty node is left.
- **Server routes**: `info`, `switches`, `models`, `models/apply`, `usage`.
- **EN/KO locale**: `locale/*.json` is the source of truth,
  `scripts/gen-locale.mjs` and `scripts/build-client.mjs` bake it into the bundle,
  and a test fails if the two drift.

### Measured decisions

- `enabled: false` removes the route, command, tool and subagent provider. The
  panel stays mounted so the master can be turned back on; plugin-level removal is
  the Plugins page. Asserted against a mock host for every switch combination
  (`test/switch.test.mjs`), and re-measured live in rc.4 (`installed` state).
- A pre-existing `/agy` or `agy_worker` (the older CLI plugin) is **yielded**, not
  a fatal duplicate, so mounting both cannot abort the plugin row.
- The stylesheet sets no `font-family` and no bare element selector; both are
  asserted, because a section that sets its own font reflows the settings pane.
- Usage is reported as measured token counts, never a dollar figure: the
  subscription exposes no per-call price.
### Profile swap (measured 2026-11-05 02:51 KST)

Replaced `@nolit/dsh-antigravity-cli` with this package in the live `web` profile.

| Before | After |
| :--- | :--- |
| `dependencies`: `dsh-antigravity-cli` | `dsh-antigravity` |
| `bundles`: `@nolit/dsh-antigravity-cli` | `@nolit/dsh-antigravity` |
| resolved rows with "antigravity": `dsh-antigravity-cli` | `dsh-antigravity` |
| orphaned `node_modules/@nolit/dsh-antigravity-cli` symlink | removed (link only; source tree preserved) |

`@nolit/dsh-subagent-antigravity` is unchanged and still mounted (rows
`subagent-antigravity`, `tool-subagent-antigravity`); it is kept as the previous
version, not merged.

### Verification

- `dsh --profile web --dump-config`: **213 rows**, this row present, old row absent.
- Real boot on a scratch port (`--port 18099`): **no warnings, no
  "did not activate", no duplicate-name failure**.
- Installed copy at `~/.dsh/profiles/web/node_modules/@nolit/dsh-antigravity`
  imports and resolves its config through the reactive accessor
  (`enabled/modelServing/cliWorker/usagePill` all `true`).
- Package tests: **41 pass, 0 fail**.

Backup of the pre-swap profile: `package.json.bak.before-antigravity-merge-20261105_025115`.
### 0.0.1-rc.1 — defects found by end-to-end verification (2026-11-05)

Each of these passed the unit tests and failed in reality.

| # | Defect | Effect | Fix |
| :--- | :--- | :--- | :--- |
| F-38 | Browser half exported `apply` but not `inject` while using `ctx.slots`/`ctx.locale` | **entire web UI failed to mount** | export `inject = ['slots','locale']`; `test/client-inject.test.mjs` asserts every `ctx.<service>` read is declared |
| F-39 | Model info used invented fields (`contextWindow`, `maxOutputTokens`, `reasoningEfforts`) | picker/context metadata wrong | use `context:{contextWindow}`, `defaultMaxTokens`, `reasoning:{efforts:[{id,name}]}` |
| F-40 | Effort passed through as separate model ids; `thinkingLevel` used, which the server ignores | 3 duplicate picker rows, no working effort control | group suffixed ids into one model + effort list; map effort back to the id suffix |
| F-41 | Docs mandated hardcoded `font-size:14px`; DSH has a live user-configurable `--dsh-content-font-size` (this profile: 13px) | surface renders one step too large | consume `var(--dsh-content-font-size,14px)` and the derived secondaries; `docs/PLUGIN-STYLE-STANDARD.md` corrected to v2.0 |
| F-43 | `index.js` passed `{ task }`; the worker reads `options.prompt` | **/agy and agy_worker never worked** | pass `{ prompt }`; `test/cli-worker.test.mjs` |
| — | Base model id (`gemini-3.8-flash`) sent when no effort was requested | 404 NOT_FOUND on the default path | always resolve to a served suffixed id |
| — | Vision guard matched exact ids only, so `gpt-oss-120b` (catalog: `-medium`) slipped through | image silently ignored by the model | match on the base id |
| — | `defaultMaxTokens` advertised the model's whole output capacity | reserved the full output window per turn | advertise only a caller-supplied cap, clamped to capacity |

**Verification after the fixes:** 74 unit tests, plus live runs — text (no effort / low / high), vision on Gemini and Claude (`Red`), vision refused on gpt-oss, tool call returned as `functionCall`, CLI worker returning `CLI-OK` with usage 8429/3, and a clean boot of an isolated profile with the plugin mounted (no `did not activate`, no `cannot resolve`).
### Subagent merge — 2026-11-05

`@nolit/dsh-subagent-antigravity` 0.1.0 merged into this package as `lib/subagent.js`.
One install now carries every Antigravity surface:

| Surface | Registration | Switch |
| :--- | :--- | :--- |
| `/agy` command | `ctx.commands` | `cliWorker` |
| `agy_worker` tool | `ctx.tools` | `cliWorker` + `workerEnabled` |
| `antigravity` model route | `ctx.llm.registerAdapter` | `modelServing` |
| `subagent_antigravity` provider | `ctx.subagents.registerProvider` | `subagent` |
| settings section + usage chip | client slots | `usagePill` |

**Duplicate-provider guard.** The old package registers `antigravity` on `ctx.subagents` as well.
`registerProvider` does not reject a duplicate, so a profile carrying both would silently shadow
one. This plugin now calls `getProvider(name)` first and **yields with a warning** instead.

**Documentation.** README gained a Requirements section (Antigravity CLI `agy` 1.5.0 with the
measured path and version, a web-authenticated consumer subscription, host reachability) and a
Google-policy section stating that the consumer endpoint is undocumented and can be suspended or
closed at any time.

**Measured facts updated.** `agy` is now **1.5.0** (`/home/minami/.local/bin/agy`, 238,604,688
bytes, 2026-11-05 01:36); earlier notes in this repository recorded 1.4.12.
