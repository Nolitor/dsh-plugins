# Changelog — @nolit/dsh-antigravity

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-05
summary: Engineering history for @nolit/dsh-antigravity. Created 2026-11-05 by merging the CLI worker surface of @nolit/dsh-antigravity-cli with the HTTP model route proven in @nolit/dsh-antigravity-directsdk, plus a settings section, a usage chip and per-surface switches.
-->

Current version: `0.0.1-rc.5`

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
