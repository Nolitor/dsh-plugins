# DSH 0.2.2-rc.1 — plugin and extension delta

<!-- skeleton:
version: 1.0
kind: report
status: measured
updated: 2026-11-05
summary: Measured diff between the alpha.3 runtime our plugins were built against and the installed 0.2.2-rc.1 release, limited to plugin/extension surfaces, with per-track impact and the actions this workspace applies.
-->

> Scope: only what a DSH plugin author/operator must react to. Source of truth: the installed
> runtime (`/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh`, measured 2026-11-05) and
> the English section of the `dsh-v0.2.2-rc.1` release notes. Release notes are external data; the
> contracts below were re-measured in the installed packages, not taken on trust.

## 1. Installed state (measured before anything)

| Item | Measured |
| :--- | :--- |
| `dsh --version` | `0.2.2-rc.1` (package mtime 2026-11-05 12:21 KST) |
| Live profile composed | `~/.dsh/profiles/web/cordis.yml` mtime 2026-11-05 12:24 KST — the live service **is** rc.1 |
| Node | v24.22.1 (rc.1 requires **>= 24.9**) |
| Cordis / Loader / Include | `4.1.0` / `1.1.0` / `1.1.0` |
| Client locale dictionaries shipped | `de, en, es, fr, ja, pt, ru, zh` — **no `ko.json`** |
| `subagent_oar` package in the base install | not present (release note only); delegation must be checked against the published artefact, not assumed |

## 2. Plugin-facing changes (rc.1 release notes, English section)

| # | Change | What a plugin must do | Our tracks affected |
| :-: | :--- | :--- | :--- |
| 1 | Cordis **4.1.0**, Loader 1.1.0, Include 1.1.0; unified config access, entry changes, persistence | Peer range must admit 4.1.0; read config through the unified Fiber/effective-config view, not ad-hoc paths | all; `notify` declares `~4.0.6-alpha.1` which **excludes 4.1.0** (measured) |
| 2 | Minimum Node **24.9** | `engines.node` must be `>=24.9` | every track declares `^22.19 \|\| >=24.0`, or `>=24` — all admit unsupported runtimes |
| 3 | Third-party compatibility prioritises **`engines.dsh`** | Keep `engines.dsh` accurate; it is now the compatibility gate | all declare `>=0.2.2-alpha.2 <0.3.0` (deepinfra floors at alpha.3 — consistent with rc.1) |
| 4 | Subpath plugins no longer read a separate `package.json`; display text/icons must come from **subpath exports**; templates get localized metadata | Provide `./icon`, `./locale/*.json` exports and localized metadata for each subpath plugin | `@nolit/dsh-opencode-v2/http` (subpath entry) |
| 5 | Composer statistics split into **`activity`** and **`usage`** entries; plugins overriding the old `stats` row must change registration ids | Do not rely on the old single `stats` row; per-provider chips belong in `conversation.input.right` (list) | chips: antigravity + opencode moved to `input.right`; deepinfra still on the single `activity` seat (being migrated) |
| 6 | Tools: conditional activation per step; **migrate `tools.resolve`/`executable` and prompt-assembly integration**; native/PTC execution split; `tools.mode`/`DSH_TOOLS_MODE` migrated | Register with the rc.1 `ToolDefinition` (`output.schema` + `output.render`, `execute` returns canonical JSON), optional `when` activation; do not read internal resolve/executable | antigravity (`agy_worker`), opencode-v2 (`opencode`), subagent providers. Measured: both tool definitions already carry `output`/`defineTool` — no break found |
| 7 | **Session Projection registration is async**; plugins must retain the handle | `await` the registration and keep the returned handle | only if a track registers a projection (none measured in the 13 tracks) |
| 8 | Official bundle list exported by `@deepseek-ai/dsh-official-bundles`; custom integrations update app-boot imports | Do not import app-boot internals; use the exported list if needed | none import app-boot (`tokeneconomizer` only cites a comment) |
| 9 | Custom plugin **markets → indexes** (rename); index generation excludes private versions/tags | Market/index files remain valid JSON; naming/docs update only | `market/index.json` in notify + korean-locale |
| 10 | Settings pages may supply a **navigation icon**; plugin failures show full diagnostics and a Host-log link | Optional `icon` in the bundle/manifest; keep failure messages actionable | all client halves (icon already exported by several) |
| 11 | Plugin icons in the Session list; richer plugin details; third-party plugin **update/rollback** | Manifest/`icon` correctness matters; keep package `exports` complete for updates | all |
| 12 | Locale: added `ja, es, fr, de, ru, pt` dictionaries + extensible language catalog | Language packs register through the rc.1 catalog with an explicit fallback chain; Korean is **not** shipped by rc.1 | `@nolit/dsh-korean-locale` (currently generated from **alpha.3**: 69 namespaces / 3,088 keys) |

### 2.1 New experimental extensions the owner referenced

| Release item | Actual artefact (measured) | Use |
| :--- | :--- | :--- |
| "experimental `subagent_oar` tool plugin to delegate independent tasks to local Codex or Claude CLIs" (@tianyicui) | **two npm packages**, not installed in the base tree (measured paths absent): `@deepseek-ai/dsh-experimental-tool-subagent-oar` (tool `subagent_oar`) + `@deepseek-ai/dsh-experimental-subagent-oar` (provider `oar`, runtimes antigravity/claude/codex/grok/kimi/opencode/pi). Dist-tags measured: `latest`=0.2.2-alpha.2 (peer-incompatible with rc.1), `next`=0.2.2-rc.1 (peer-compatible). Neither declares `dsh.bundle.patch` (manual profile rows). Full evidence: [dsh-subagent-local/COMPATIBILITY.md](../dsh-subagent-local/COMPATIBILITY.md) | compatibility reference for the new local-delegation plugin (item 6) |
| "experimental Developer tools — Statistics for per-turn and per-step context, cache, model, and tool measurements" (@mektpoy) | `@deepseek-ai/dsh-experimental-client-ui-stats` + `@deepseek-ai/dsh-session-stats` (both 0.2.2-rc.1) | data model / ledger reference for the TokenEconomizer stats surface (item 5) |
| Official delegation bundles | `@deepseek-ai/dsh-subagent-codex` / `dsh-subagent-claude-code` are **published but not installed** in the rc.1 base tree (measured); the base tree has `dsh-subagent`, `dsh-tool-subagent`, `dsh-subagent-spawn-in-process`, `dsh-subagent-fork-in-process` | do not assume a codex/claude provider is mounted |

## 3. Measured compliance matrix (before this round's changes)

> This section is the **before** snapshot. The after state is in §3.1, measured again after the
> rc.1 round landed in every track.

| Track | Version before | `engines.node` | `engines.dsh` | cordis peer | Notes |
| :--- | :--- | :--- | :--- | :--- | :--- |
| dsh-antigravity | 0.0.1-rc.6 | `^22.19 \|\| >=24.0` | `>=0.2.2-alpha.2 <0.3.0` | `^4.0.4` | tool def already rc.1-shaped |
| dsh-antigravity-cli | 0.1.0 | `^22.19 \|\| >=24.0` | same | `^4.0.4` | historical track |
| dsh-antigravity-directsdk | 0.0.1 | `^22.19 \|\| >=24.0` | same | `^4.0.4` | untracked new track |
| dsh-command-skill | 0.1.0 | **absent** | same | absent | skills repo, not a Loader package |
| dsh-deepinfra | 0.0.1-rc.7 | `^22.19 \|\| >=24.0` | `>=0.2.2-alpha.3 <0.3.0` | `^4.0.4` | chip still on single `activity` seat |
| dsh-korean-locale | 0.2.5 | `>=24` | same | absent | generated from alpha.3 (3,088 keys) |
| dsh-notify | 0.1.8 | `>=24` | same | **`~4.0.6-alpha.1`** (excludes 4.1.0) | needs full rewrite (item 3) |
| dsh-opencode-v2 | 0.0.2-rc.4 | `^22.19 \|\| >=24.0` | same | `^4.0.4` | subpath `./http` entry |
| dsh-sidebar-manager | 0.1.2 | `>=24` | same | absent | |
| dsh-subagent-antigravity | 0.1.0 | `^22.19 \|\| >=24.0` | same | `^4.0.4` | provider-only, no tool row |
| dsh-subagent-opencode | 0.1.0 | `^22.19 \|\| >=24.0` | same | `^4.0.4` | provider-only |
| dsh-subrouter | 0.1.0 | `^22.19 \|\| >=24.0` | same | absent | |
| dsh-tokeneconomizer | 0.2.0 | `^22.19 \|\| >=24.0` | same | absent | stats surface to add (item 5) |

## 3.1 After this round (measured 2026-11-05, working tree)

| Track | Version after | `engines.node` | Korean pack / locale note |
| :--- | :--- | :--- | :--- |
| dsh-antigravity | `0.0.1-rc.7` | `>=24.9` | en/ko files, English default, Korean only under `ko` |
| dsh-antigravity-cli | `0.0.1-rc.1` | `>=24.9` | plan notice no longer Korean by default |
| dsh-antigravity-directsdk | `0.0.1-rc.1` | `>=24.9` | metadata locale files added |
| dsh-command-skill | `0.0.1-rc.1` | `>=24.9` | not a Loader package (`private`, no client) |
| dsh-deepinfra | `0.0.1-rc.8` | `>=24.9` | navigator fallback removed; chip migrated to `input.right` + verified |
| dsh-korean-locale | `0.0.1-rc.1` | `>=24.9` | regenerated against rc.1: **74 namespaces / 3,843 keys** (was 69/3,088); `addLanguage({id:'ko',label:'한국어',fallback:'en'})` |
| dsh-notify-web | `0.0.1-rc.2` | `>=24.9` | Chrome-only rewrite; English default; Korean only under `ko` |
| dsh-opencode-v2 | `0.0.1-rc.1` | `>=24.9` | navigator fallback removed; chip on `input.right`; subpath locale exports |
| dsh-sidebar-manager | `0.0.1-rc.1` | `>=24.9` | navigator fallback removed |
| dsh-subagent-antigravity | `0.0.1-rc.1` | `>=24.9` | en/ko parity |
| dsh-subagent-opencode | `0.0.1-rc.1` | `>=24.9` | en/ko parity |
| dsh-subrouter | `0.0.1-rc.1` | `>=24.9` | metadata locale files added |
| dsh-tokeneconomizer | `0.0.1-rc.1` | `>=24.9` | new dev-stats card (settings.section), English default |
| dsh-subagent-local (new) | `0.0.1-rc.1` | `>=24.9` | experimental `delegate_local` tool; en/ko tables |

Every track's `engines.dsh` range was re-checked with semver against `0.2.2-rc.1` and admits it.
Cordis peer ranges admit the installed 4.1.0 (`notify` was the one exception and is now `^4.1.0`).
No track registers `conversation.input.activity` or reads internal `tools.resolve`/`executable`;
no track registers a Session Projection. Full runs: antigravity 103/103, deepinfra 155 pass
(162 total, 7 skip), opencode-v2 427/427, sidebar 142/142, subrouter 12/12, subagent providers 6/6
each, antigravity-cli 12/12, directsdk 25/25, notify 51/51, tk 131 pass/1 skip, delegate 52/52,
Korean pack verify 74 ns / 3,843 keys / 0 missing.

## 4. What this workspace does about it

| Item | Action | Owner |
| :--- | :--- | :--- |
| Versions | normalize every `@nolit` track to `0.0.1-rc.N` (owner decision): notify `0.0.1-rc.2`; existing `0.0.1-rc.N` tracks continue their rc (antigravity → rc.7, deepinfra → rc.8); all others start at `0.0.1-rc.1` | locale-version + owners |
| Node engines | `>=24.9` on every published track | locale-version + owners |
| Cordis peer | admit 4.1.0 (notify: `^4.1.0`; others keep caret ranges that already admit 4.x) | notify owner / locale-version |
| Korean | regenerate the Korean pack against rc.1 dictionaries and the `addLanguage({id,label,fallback})` catalogue; every plugin defaults to English and Korean renders only when the active locale is `ko` | locale-version |
| Chips | DeepInfra cost chip moves to `conversation.input.right` (owner item 1) | locale-version |
| Stats | TokenEconomizer gains per-turn/per-step developer statistics modelled on `dsh-session-stats` + `dsh-experimental-client-ui-stats` | tk-devstats |
| Delegation | new local-CLI delegation plugin + `subagent_oar` compatibility verdict | delegate-local |
| Notify | Chrome-only rewrite, 0.0.1-rc.2, toast as silent fallback, platform-aware parameters, no own styles | notify-chrome |

## 5. Verification rule for this round

Every applied item must show: unit tests green, `node --check` for touched modules, and for a
browser half a real isolated `DSH_HOME` boot with zero page errors. The live 3080 service is **not**
restarted by an agent; changes land as **applied pending restart** and the owner restarts.
