# Changelog — @nolit/dsh-antigravity

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-05
summary: Engineering history for @nolit/dsh-antigravity. Created 2026-11-05 by merging the CLI worker surface of @nolit/dsh-antigravity-cli with the HTTP model route proven in @nolit/dsh-antigravity-directsdk, plus a settings section, a usage chip and per-surface switches.
-->

Current version: `0.0.1-rc.3`

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
- **Usage chip** (`conversation.input.activity`): total measured tokens beside the
  model selector. Renders nothing when disabled, so no empty node is left.
- **Server routes**: `info`, `switches`, `models`, `models/apply`, `usage`.
- **EN/KO locale**: `locale/*.json` is the source of truth,
  `scripts/gen-locale.mjs` and `scripts/build-client.mjs` bake it into the bundle,
  and a test fails if the two drift.

### Measured decisions

- `enabled: false` removes the route, command, tool and panel routes. Asserted
  against a mock host for every switch combination (`test/switch.test.mjs`).
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
