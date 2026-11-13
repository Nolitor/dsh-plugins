# DSH 0.2.2-rc.2 — plugin and extension delta

<!-- skeleton:
version: 1.0
kind: report
status: measured
updated: 2026-11-13
summary: Measured diff between the installed 0.2.2-rc.1 runtime and the published 0.2.2-rc.2 release, limited to plugin/extension surfaces, with per-track impact, breaking-change exposure, and the Korean locale coverage gap.
-->

> Scope: only what a DSH plugin author/operator must react to. Source of truth: the **published
> `0.2.2-rc.2` npm artefacts** (unpacked to `/tmp/dsh-rc2` and `/tmp/rc2install` for measurement) and
> the English section of the `dsh-v0.2.2-rc.2` release notes. Release notes are external data; every
> contract below was re-measured in the shipped packages, not taken on trust. The live runtime is
> still `0.2.2-rc.1` — this document is a **pre-upgrade delta**, not a post-upgrade record.

## 1. Installed state (measured before anything)

| Item | Measured |
| :--- | :--- |
| `dsh --version` | `0.2.2-rc.1` (installed package `package.json` version `0.2.2-rc.1`) |
| npm `latest` | `0.2.2-rc.1` |
| npm `next` | **`0.2.2-rc.2`** — rc.2 is **not** on `latest` |
| Release published | `2026-11-11T11:33:06Z` (rc.1: `2026-11-04T13:07:14Z`) |
| Release note length | rc.2 `15,618` chars vs rc.1 `27,674` |
| Live profile | `~/.dsh/profiles/web` — 7 `@nolit/*` link tracks + 3 shipped bundles |
| Node | `v24.22.1` (rc.2 still requires `>= 24.9`) |
| Installed rc.1 client bundles | 67 parsed, 60 locale namespaces, 2,699 English keys |
| rc.2 client bundles | 65 parsed, **58** locale namespaces, **2,691** English keys |
| `docs/` + `src/` in the npm package | **absent in rc.1**, **shipped in rc.2** (7.5 MB of English + Chinese docs) |

### 1.1 The documentation surface changed shape

`package.json.files` in rc.2 is:

```json
["lib/*.js", "lib/*.js.map", "lib/types/*.d.ts", "lib/types/*.d.ts.map", "docs", "src"]
```

rc.1 shipped only `lib/**` and `lib/types/**`. This is the single most useful rc.2 change for plugin
authors: the full authoring corpus now travels with the installed package instead of requiring a
repository checkout.

| Path under the installed package | Holds |
| :--- | :--- |
| `docs/architecture.md` | system map and the **"Where new behavior goes"** extension-point table |
| `docs/capability-seams.md` | generated Service Definition / Provider / Consumer graph |
| `docs/cordis-api/*.md` | generated `Context`, `Fiber`, `Registry`, `Service`, `Event` API with source links |
| `docs/cordis-tutorial/01..07` | first plugin → lifecycle → services → events → config → composition/HMR |
| `docs/cookbook/extension-cookbook.md` | tool / hook / UI / external-protocol plugin shapes |
| `docs/cookbook/adding-a-package.md` | file-by-file package checklist, role-naming table, README contract |
| `docs/user/develop/{basic,framework,practice}/` | tutorial, service/event framework, LLM adapter + dynamic-Cordis practice |
| `docs/upgrade-guide/v0.2.2-rc.1/` | **17** migration items for the rc.1 → rc.2 jump |
| `docs/tool-catalog.md`, `config-catalog.md` | generated anchors that README sections must link |
| `src/` | the TypeScript source behind the emitted declarations |

## 2. Plugin-facing changes (rc.2 release notes, English section)

The release notes split into New Features / Improvements / Bug Fixes / Chores. Only the Chores and
the plugin-visible Fixes carry author obligations; the rest is end-user UI/UX.

| # | Change | What a plugin must do | Our tracks affected |
| :-: | :--- | :--- | :--- |
| 1 | `BundleInfo.updatable` → `BundleInfo.update` (`'registry' \| 'git'`); `ManagementError` gains `unexpected-package` | Replace `updatable` reads with `update`; handle the new code in exhaustive switches | none (measured: no `listBundles`/`updatable`/`ManagementError` use in any track) |
| 2 | `Session.append` gains an **array overload**; wrappers must forward both | Wrappers/test doubles must accept one event and an array of tuples | **`dsh-tokeneconomizer`** calls `session.append(...)` only in the single-event form (lines 809, 814) — **compliant**, no wrapper |
| 3 | Base + `standard`/`cordis`/`ptc` presets set `config.interrupt: false` on `tool-subagent-control` | Models lose `interrupt_agent`; restore per-preset, not by a top-level row patch | live profile does not override the preset row — inherits the new default |
| 4 | `TerminalBackendCleanupError` extends `TerminalError` (`CLEANUP_FAILED`), not `AggregateError` | Replace `instanceof AggregateError`; narrow `errors: readonly unknown[]` | none (measured: no terminal-backend code in any track) |
| 5 | Persistent-terminals bundle: `optional-terminal-bash`/`optional-terminal-pwsh` → `optional-terminal-panel` | Remove patches targeting the removed rows | live profile has **no** terminal row — unaffected |
| 6 | `dsh-doc` replaces the four Creator skills (`cordis-plugin-development`, `editing-cordis-compositions`, `cordis-composition-reference`, `agent-experience`); repo skill → `dsh-doc-writing` | Rename skill references and file paths | **session skill catalog still lists the four old names** (installed rc.1) |
| 7 | Account: `deepseek-account-platform` + `api-account-controller` removed; concrete `dsh-deepseek-account`; notification APIs genericized | Swap package rows/imports; `getNotifications`, `reportNotificationEvent`; new `harnessOrigin` | none in the 7 tracks; live profile does not patch account rows |
| 8 | macOS Desktop: interactive controls get `no-drag` only inside `data-window-drag` / `data-window-drag-controls` | Custom overlays covering a header must declare `data-window-drag-exclude` | none (no `data-window-drag` in any track) |
| 9 | Plugins can register/remove **MCP servers**, query status, restart, probe | New extension point; no action required | none use it |
| 10 | Plugins can extend **chat code-block rendering** by language | New extension point | none use it |
| 11 | Plugin **indexes** can carry GitHub stars + npm weekly downloads; index order stays default | Optional `metadata.sortKeys` with `github_stars` / `npm_weekly_downloads` | 3 market indexes; see §4.2 |
| 12 | Custom model providers support the **native Gemini API** (discovery + reasoning levels) | Router presets built on OpenAI-compatible shapes may use it | `dsh-custom-router` (see §4.3) |
| 13 | Model-request **User-Agent** carries the active profile (Desktop/Web/CLI/SDK) | Servers can distinguish transports | `dsh-custom-router` already exposes a `userAgent` override — aligned |
| 14 | `schemastery` 3.18 → **3.19**, cordis **4.1.0**; Zod 4.6.6; Stagehand 4.4.0 (`extensionId` dead) | Peer ranges must admit 3.19.0 / 4.1.0 | all tracks: `^3.18.4` and `^4.0.4` **both admit** the new versions (verified with semver) |
| 15 | PTC caps total tool calls by runtime budget; over-limit terminates code and clears retained state | No action for tool plugins | none |
| 16 | Archiving a Session removes eligible clean worktrees by default (`retainOnArchive` off) | Forge plugins migrate `forge-worktree`/`optional-forge-panel` rows | none |
| 17 | AgentTeam: unified named subagents, `interrupt_agent` disabled by default | Migrate custom plugins/SDK that used the experimental team packages | none |

### 2.1 Package-set delta measured from the bundles

`dsh-base` + `dsh-web-app` dependency lists: rc.2 declares **221** packages, rc.1's installed tree
carries **330** directories (superset, includes transitive + experimental).

| Direction | Packages |
| :--- | :--- |
| **Added in rc.2** | `dsh-agent-team`, `dsh-tool-agent-team`, `dsh-client-ui-agent-team`, `dsh-client-ui-account-notifications`, `dsh-mcp-manager`, `dsh-office-kit`, `dsh-tool-office` |
| **Consolidated away** | `dsh-experimental-agent-team` + `-profile` + `-client-ui-agent-team` → the `dsh-*agent-team` trio; `dsh-office-to-pdf` → `dsh-office-kit`; `dsh-deepseek-account-platform` + `dsh-api-account-controller` → `dsh-deepseek-account`; `dsh-experimental-forge*` → `forge-panel`/`worktree` rows |

## 3. Measured compliance matrix

| Track | Version | `engines.node` | `engines.dsh` | cordis peer | rc.2 verdict |
| :--- | :--- | :--- | :--- | :--- | :--- |
| dsh-command-skill | 0.0.1-rc.1 | `>=24.9` | `>=0.2.2-alpha.2 <0.3.0` | none declared | OK — no peer drift |
| dsh-custom-router | 0.0.1-rc.12 | `>=24.9` | `>=0.2.2-alpha.2 <0.3.0` | `^4.0.4`, schemastery `^3.18.4` | OK — admits cordis 4.1.0 / schemastery 3.19.0 |
| dsh-korean-locale | 0.0.1-rc.1 | `>=24.9` | `>=0.2.2-alpha.2 <0.3.0` | none declared | **needs regeneration** — see §4.1 |
| dsh-notify | 0.0.1-rc.5 | `>=24.9` | `>=0.2.2-alpha.2 <0.3.0` | `^4.1.0` | OK; **market index invalid** — see §4.2 |
| dsh-opencode-v2 | 0.0.1-rc.5 | `>=24.9` | `>=0.2.2-alpha.2 <0.3.0` | `@nolit/dsh-custom-router: 0.0.1-rc.11` | **peer pins rc.11, installed is rc.12** |
| dsh-sidebar-manager | 0.0.1-rc.2 | `>=24.9` | `>=0.2.2-alpha.2 <0.3.0` | none declared | OK — drift gate `LIVE_EQUALS_WORKSPACE` |
| dsh-tokeneconomizer | 0.0.1-rc.2 | `>=24.9` | `>=0.2.2-alpha.2 <0.3.0` | none declared | OK — single-event `append` only |

Test suites: every track passes (`custom-router`, `notify`, `opencode-v2`, `tokeneconomizer`,
`sidebar-manager` green; `korean-locale` `verify: ok`; `command-skill` declares no `test` script).
`node scripts/check-plugin-history.mjs`: **6 tracks OK**, `dsh-korean-locale` skipped as untracked.

## 4. Three measured defects rc.2 exposes

### 4.1 Korean locale coverage is 93.42% against rc.2 and misses one namespace

Regenerated against **rc.1**, the pack ships `74` namespaces / `3,843` keys. rc.2 ships `58`
namespaces / `2,691` English keys. Measured gap against the rc.2 client bundles:

| Metric | rc.1 pack | rc.2 runtime | Result |
| :--- | :--- | :--- | :--- |
| Namespaces present in rc.2 | 74 declared | 58 shipped | **17 stale** (no longer shipped), **1 missing** |
| English keys covered | 3,843 declared | 2,691 shipped | **2,514 covered / 177 missing = 93.42%** |
| Korean-only keys | — | — | 29 keys no rc.2 bundle reads |

Missing namespace: **`account.notifications`** (new in rc.2, 1+ keys incl. `close`).

Largest key gaps, all in surfaces rc.2 changed:

| Namespace | Missing keys | Cause |
| :--- | :-: | :--- |
| `settings.models` | 37 | API-key masking, retry settings, native Gemini |
| `sidebarFiles` | 32 | name/path search, exclusion rules, hidden files |
| `settings` | 23 | Desktop update channel |
| `settings.webSearch` | 23 | Search/Fetch billing split |
| `agent-team` | 18 | new namespace (AgentTeam) |
| `chat` | 12 | older-message auto-load |
| `conversation` | 12 | expanded context details |
| `subagent` | 7 | nested subagent browsing |
| `sidebarTerminal` | 5 | sidebar Agent terminal badges |
| `pluginManager` | 2 | `reasonUnexpectedPackage`, `statusNotRunning` |
| `entryCustomization` | 2 | pin/unpin |
| `sidebar` | 2 | panel pin/unpin |
| `account.notifications` | 1 | new namespace, not shipped by the pack at all |
| `open-in-app` | 1 | `menu.openIn` |

Stale namespaces to drop: `actionCards`, `contextMenu`, `cotTranslation`,
`creationRecommendations`, `directory-browser`, `forgePanel`, `inspectorPanel`, `liveshare`,
`messageQuotes`, `permission.access`, `pluginMarket`, `pluginRecommendations`, `schedule.manager`,
`session-inspector`, `session-log-download`, `stats`, `voice-input`.

**Action:** regenerate `data/ko.json` + `data/coverage.json` from the rc.2 client bundles before the
runtime upgrade, then `scripts/verify.mjs` must report 58 namespaces / 2,691 keys.

### 4.2 `dsh-notify` market index is invalid under the rc.2 format

`dsh-notify/market/index.json` `plugins[0].versions[0]` omits the **required** `publishTimestamp`
(Unix seconds). Validated against the rc.2 index-format table, this is the only schema error across
the three indexes; `dsh-korean-locale` and `dsh-sidebar-manager` are clean.

**Action:** add `publishTimestamp` to every version entry. The rc.2 format otherwise introduces no
breaking change to these files (`format: 1`, `title` present, `versions` non-empty, `source.type:
npm`).

**Second, worse finding in the same file:** the index advertises `0.0.1-rc.5`, which **was never
published** to npm. Measured against the registry:

| Track | Workspace + index version | Published on npm | Consequence |
| :--- | :--- | :--- | :--- |
| `dsh-korean-locale` | `0.0.1-rc.1` | `0.0.0-stage`, `0.0.1-rc.1` | consistent |
| `dsh-notify` | `0.0.1-rc.5` | `0.0.0-stage`, `0.0.1-rc.3`, **`0.0.1-rc.4`** | **index points at a nonexistent version** |
| `dsh-sidebar-manager` | `0.0.1-rc.2` | `0.0.0-stage`, **`0.0.1-rc.1`** | **index points at a nonexistent version** |

DSH installs a market npm version as `name@version`, so a client following either index gets a
registry `E404` at install time. A marketplace entry must be published **before** the index that
lists it. This is independent of rc.2 — the rc.2 index format merely makes `versions[].version` and
`source` authoritative, which is what makes the mismatch load-bearing.

**Action:** either publish `0.0.1-rc.5` / `0.0.1-rc.2`, or point each index at the highest published
version. Do not leave an index advertising an unpublished version.

### 4.3 `dsh-opencode-v2` peer still pins custom-router `rc.11`

`dsh-opencode-v2/package.json` declares `"@nolit/dsh-custom-router": "0.0.1-rc.11"` while the
workspace and the live profile both carry `0.0.1-rc.12`. This is a pre-existing workspace drift, not
an rc.2 change, but an rc.2 upgrade round is the correct point to reconcile it.

The shim is seven one-line re-exports of `@nolit/dsh-custom-router/vendor/opencode/*` (measured:
`lib/{index,client,cost,http,provider,subagent,optional-service}.js`), so the peer range is the only
thing tying it to a router revision — and a stale exact pin will fail peer resolution once the router
moves again.

### 4.4 `dsh-opencode-v2` `schemastery` range excludes rc.2's version

This is the only peer range in the workspace that **rc.2 actually breaks**, and it was found by
testing the range against the shipped version rather than reading the release note:

| Declaration | Range | rc.2 ships | Satisfied? |
| :--- | :--- | :--- | :--- |
| `dsh-opencode-v2` | `@deepseek-ai/schemastery": "~3.18.4"` | **`3.19.0`** | **no** — `~3.18.4` means `>=3.18.4 <3.19.0` |
| `dsh-custom-router` | `"^3.18.4"` | `3.19.0` | yes |
| all tracks | `@deepseek-ai/cordis": "^4.0.4"` | `4.1.0` | yes |

The rc.2 release note lists "Upgrade Zod to 4.6.6, Stagehand to 4.4.0" but does **not** mention the
`schemastery` minor bump; only the installed `dsh-web-app` dependency `~3.19.0` reveals it. A tilde
range on a dependency the runtime bumps by minor version is therefore a latent install failure, and
`dsh-opencode-v2` is the one track that will refuse to resolve against rc.2 because of it.

**Action:** widen to `^3.18.4` to match the router, or pin the range to whatever the target runtime
actually ships.

### 4.5 Owner decision recorded

The four measured defects above were **not fixed** in this round. On 2026-11-13 the owner chose
"report only" for the whole set, so this document is the complete record and the code is unchanged.
Re-measured after the report was written: `dsh-opencode-v2` still declares `~3.18.4` and
`0.0.1-rc.11`; `dsh-notify` still advertises `0.0.1-rc.5` without `publishTimestamp`; the workspace
`dsh-notify` version is still `0.0.1-rc.5` against npm's published `0.0.1-rc.4`.

## 5. What this workspace does about it

Ordered by blast radius. **None of these were applied** — the owner chose "report only" on
2026-11-13 (§4.5). The list is what the next round should do, in order.

1. **Korean locale regeneration** (blocking for a Korean UI on rc.2): rebuild from rc.2 client
   bundles, drop the 17 stale namespaces, add `account.notifications`, close 177 keys → 100%.
2. **`dsh-notify` + `dsh-sidebar-manager` market indexes**: add the missing `publishTimestamp` and
   reconcile each advertised version with what npm actually publishes (§4.2). An index that points
   at an unpublished version fails at install time, which is worse than a stale index.
3. **`dsh-opencode-v2` peer**: align `@nolit/dsh-custom-router` to `0.0.1-rc.12` and widen
   `@deepseek-ai/schemastery` from `~3.18.4` to `^3.18.4` (§4.4) — the one change rc.2 genuinely
   forces.
4. **Live profile**: needs no patch for rc.2's removed rows (no terminal, forge-worktree, or account
   overrides are present). The `interrupt_agent` change is inherited from the preset; restore it
   deliberately only if the owner wants interruption back.
5. **Skill references**: after the runtime upgrade the four Creator skills disappear; any prompt or
   saved instruction naming them must say `dsh-doc`.
6. **Sidebar Manager drift gate**: re-run `node scripts/audit-installed-vs-packaged.mjs` before the
   version bump.

## 6. Verification rule for this round

A track counts as rc.2-ready only when, measured against the **installed rc.2** tree:

1. `npm test` passes and `node scripts/check-plugin-history.mjs` reports it OK.
2. `engines.dsh` admits the installed version and every peer range admits the shipped
   `cordis` / `schemastery` version.
3. No removed API appears (`updatable`, `AggregateError` for terminal cleanup, old Creator skill
   names, `deepseek-account-platform`), verified by grep rather than assumption.
4. For locale packs: namespace and key sets equal the rc.2 client-bundle extraction, with zero
   stale namespaces.
5. For market indexes: the file validates against the rc.2 index-format table, including required
   version fields.

## 7. Evidence

| Artefact | Path |
| :--- | :--- |
| Release notes (English section) | `/tmp/rc2.md` |
| rc.2 unpacked package (with `docs/`, `src/`) | `/tmp/dsh-rc2/package` |
| rc.2 bundles installed for locale extraction | `/tmp/rc2install/node_modules/@deepseek-ai` |
| rc.1 vs rc.2 locale extraction | `/tmp/rc1-locale.json`, `/tmp/rc2-locale.json` |
| Extraction script (acorn AST, no execution) | `/tmp/extract-locale-static.mjs` |
| Market-index validator | `/tmp/validate-market.mjs` |
