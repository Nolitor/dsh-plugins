# DSH 0.2.2-alpha.3 — Plugin Verification Report

<!-- skeleton:
version: 1.0
kind: report
status: measured
updated: 2026-11-03
summary: Per-plugin verification against DSH 0.2.2-alpha.3 (excluding opencode-v2) — measured mount state, test results, Korean locale delta, notify settings restyle, sidebar/UTM harness and TE KV-cache interaction.
-->

> Measured: 2026-11-03 (KST) · Runtime: DSH `0.2.2-alpha.3` (commit `43a1ef1`) · Node `v24.22.1`
> Live profile: `~/.dsh/profiles/web` (13 bundles) · Live service: `dsh-web.service` on 3080, started 21:15:17 KST

## 0. Scope

Excluded by instruction: **@nolit/dsh-opencode-v2**. Everything else in the live profile was
measured per plugin, then the requested improvements were applied and re-measured.

## 1. Measured baseline (before changes)

Command: `dsh --version`, `dsh --profile web --dump-config`, `journalctl --user -u dsh-web.service`.

| Fact | Value |
|---|---|
| DSH CLI | `0.2.2-alpha.3` |
| Client boot entries served | **78** (live profile) |
| `@nolit/*` client entries | **4** — korean-locale, notify-web, sidebar-manager, opencode-v2 |
| Boot activation failures in journal | **0** (`did not activate` count = 0) |
| Plugin package imports resolving against alpha.3 | **all** (`@deepseek-ai/dsh-llm`, `dsh-tools`, `schemastery` 3.18.6-alpha.2) |
| `engines.dsh` window on every plugin | `>=0.2.2-alpha.2 <0.3.0` — includes alpha.3 |

Client bundles mounted in the live profile that matter for locale work (from the composed tree):
`ui-file-actions`, `ui-sidebar-documentpreview`, `ui-sidebar-files`, `ui-sidebar-right`,
`ui-trajectory`, `ui-subagent`, `ui-plugin-manager`, `ui-conversation`, `ui-open-in-app`.
**Not** mounted: forge, liveshare, stats, action-cards, creation-recommendations,
plugin-recommendations — their dictionaries are dead weight for this profile.

## 2. Per-plugin test results (after changes)

| Plugin | Version | Result |
|---|---|---|
| Korean locale | 0.2.5 | `verify: ok — 69 namespaces, 3088 keys` |
| Notify Web | 0.1.8 | **21/21** pass |
| Sidebar Manager | 0.1.2 | **126/126** pass + **10/10** Core-02 UTM harness |
| Token Economizer | 0.2.0 | **98 pass, 1 skipped, 0 fail** (skip needs `TE_DSH_TEST_HOME`, pre-existing) |
| Antigravity CLI | 0.1.0 | 12/12 pass |
| Subagent Antigravity | 0.1.0 | 6/6 pass |
| Subagent OpenCode | 0.1.0 | 6/6 pass |
| Subrouter | 0.1.0 | 12/12 pass |
| **docs:check** | — | `OK: 71 docs indexed, indexes up to date` |

## 3. Korean locale — did it need more translation? **Yes.**

### 3.1 Why the old numbers were wrong (correction)

`data/coverage.json` claimed `0.2.2-alpha.2` coverage with 3,019 keys and zero gaps. That snapshot
was **not** what the runtime serves. Two measurement defects were found and fixed in the new
`scripts/measure-locale-delta.mjs`:

1. The per-package `locale/*.json` files are **metadata stubs** (`{"meta":{"title":"ui-chat"}}`),
   not the UI dictionaries. Reading them measures nothing.
2. The real dictionaries are object literals passed to `ctx.locale.register(NS, { zh, en, ... })`
   inside each `lib/client.js`. Three separate bugs had to be fixed before the numbers were real:
   - the register body is `{ en: en$6 }` — the dictionary is bound on the **value** side, so
     reading `objs.get('en')` produced the *spreadsheet* dictionary for five namespaces;
   - `const NS` prefix-matched `const NS$1`, swapping `sidebarDocumentPreview` and
     `sidebarCodePreview`;
   - some literals interpolate module constants (`PLAN_NEXT_ACTION_EN`), so evaluation fails and a
     tolerant depth-1 scanner is required.

After the fixes: **69 namespaces / 3,432 English keys / 0 unresolved**.

### 3.2 Measured gap and what was added

**57 keys added** across the namespaces that are actually mounted:

| Namespace | Keys | Examples |
|---|---|---|
| `sidebarCodePreview` | 22 | loadMore, autoRefresh.*, wrap.*, error.tooLarge, rendererUnavailable |
| `open-in-app` | 11 | openInSidebar, openInFloat, finder, reveal, copyPath… |
| `fileActions` | 12 | reveal, saveAs, copyImage, download, saveFailed… |
| `conversation` | 7 | tool.title.viewSchedule/editSchedule, detail.schedule.* |
| `sidebarRight` | 3 | menu.close / closeOthers / closeRight |
| `trajectory` | 4 | toolbar.subCalls, expand/collapseSubCalls, request.collapsedTool |
| `sidebarFiles` | 4 | entry.noViewer, navigator.show/hide/resize |
| `pluginManager` | 3 | installDetailsNoOutput, installLogPath, installFailedEnabling |
| `common`, `sidebar`, `subagent` | 1 each | language.title, navigation.label, open.floatWindow |

Result: pack **3,019 → 3,088 keys**, namespaces **68 → 69** (`fileActions` added), placeholder
mismatches **0**. `coverage.json` regenerated against `0.2.2-alpha.3` and `scripts/verify.mjs`
assertions updated to 69 / 3,088 / alpha.3.

Deferred (not mounted in this profile, 728 keys): `forgePanel` (253), `liveshare` (225),
`stats` (177), `llm-pi-ai` (137), `creationRecommendations` (55), `pluginRecommendations` (25),
`actionCards` (14). Translating unmounted panels would be unverifiable work.

## 4. Notify — settings panel restyled to native DSH idiom

Before: inline pixel styles on a hand-rolled `div` card stack (`border: 1px`, `borderRadius: 12`,
hardcoded fallback hexes) that ignored the settings section conventions.

After: a single injected stylesheet (`@nolit/dsh-notify-web/notifications.css`, tagged
`data-plugin`), class-based, DSH tokens only — title + description rows with a right-aligned
control, `.5px` separators, `--dsw-radius-*` corners, custom switch with `:focus-visible`, and
five native cards (연결 상태 / 권한과 소리 / 알림 종류 / 소리 / 진단 정보).

### 4.1 A real theming defect found by measuring, not by reading

Computed styles in a real browser showed two tokens I had used are unusable:

| Token | dark | light | Problem |
|---|---|---|---|
| `--dsw-alias-bg-layer-4` | **(unset)** | **(unset)** | declared in the stylesheet but never defined at runtime → controls render with no background |
| `--dsw-alias-brand-primary` | `#f9fafb` (near-white) | `#0f1115` | a checked switch filled with it is **white-on-white in dark mode** |

Replaced with tokens measured to hold in both themes: track `interactive-bg-active`, checked fill
`button-primary-fill`, knob `label-primary` / `label-primary-foreground`. Verified:
track `rgb(249,250,251)` with knob `rgb(15,17,21)` in dark, and the inverse in light.

Tests grew 19 → 21 (render-tree structure + token-only stylesheet, both asserting the two broken
tokens are never used again).

## 5. Sidebar Manager — project/section management + Core-02 UTM harness

The groups store (`GROUPS_UNIT` v3) is the project/section model, and it already carries the UTM
contract vs implementation vocabulary (`kind: system|project`, `member.role`,
`member.policy.access`, `group.upstream`).

New `test/core02-utm-harness.test.mjs` drives the **real** store in a sandbox root — **10/10**:

1. empty store is a valid unit document
2. add a system group (UTM-style contract node)
3. add a project group (section)
4. a project group may reference an upstream contract group
5. assign workspaces as members with role and policy — and **no filesystem side effect**
6. `listGroups` projects a manager-panel view
7. remove a member without removing its group
8. reject a group that references itself upstream
9. reject unknown member role values
10. reload round-trips the document unchanged

Wired into `npm test` (126 + 10). Extension headroom is intact: `kind`, `role`, `policy` and
`upstream` are additive and advisory-only, so add-ons can extend without a schema break.

## 6. Token Economizer — KV cache interaction with DSH

TE does **not** implement a KV cache and does not read DSH's. It pins a constant block into the
request's first (system) message so the provider's **prefix** cache stays valid.

| Check | Result |
|---|---|
| `pinnedSection` matches the host `PromptSection` contract (alpha.3 `dsh-system-prompt`) | pass — `interpolate: false`, no `complete` claim |
| composed prefix byte-stable across turns | pass |
| empty pin mounts no section | pass |
| declares no storage domain / touches no `session_projcache` | pass |
| injects only `tools, systemPrompt, tokenMeter` | pass |

**No conflict** with `@deepseek-ai/dsh-session-projection-cache`: that package is a *durable
session-projection checkpoint* store (`ctx.sessionProjectionCache`, domain `session_projcache`),
a different layer from the provider prompt cache. They share no service, domain or file.

## 7. Browser boot proof (real mount)

Per this workspace's rule, a browser boot is the only valid mount proof.

**Isolated profile** (`DSH_HOME=/tmp/iso-notify`, port 3111, base + web-app + korean-locale +
notify) driven with Chromium:

- shell rendered, **0** "did not activate" strings, 0 page errors;
- boot entries include `@nolit/dsh-korean-locale` and `@nolit/dsh-notify-web`;
- settings → **알림** renders the restyled section: `1` section, `5` cards, `11` rows,
  `7` switches, stylesheet tag present, heading `DSH 알림`;
- switch labels: 턴 완료 / 도구 승인 필요 / 질문 대기 / 오류 / 서브에이전트 완료도 알림 /
  창이 활성일 때 완료 알림 숨김 / 알림 소리 사용.

**Live GUI** (`https://nolitor/`, alpha.3) also boots clean: `lang="ko"`, 78 client entries,
composer present, **0** activation failures, 0 page errors (one unrelated console line:
`[deepseek-account] account read failed`, a pre-existing 403 from the DeepSeek account endpoint).

## 8. What is applied and what needs a restart

| Change | State |
|---|---|
| Korean locale pack (3,088 keys, rebuilt `lib/client.js`) | on disk — **applied pending restart** |
| Notify settings restyle + tests | on disk — **applied pending restart** |
| Sidebar Core-02 harness, TE KV test | test-only — no runtime effect |
| Live profile / service | **untouched** (no write, no restart) |

The running 3080 process still holds the pre-edit modules in memory. The changes are `link:`
packages, so they take effect on the next service start:

```bash
systemctl --user restart dsh-web.service
```

Not run here: `~/.dsh` and the live service are the owner's, and restarting was not requested.

## 9. Remaining / optional

- 728 Korean keys for unmounted panels (forge, liveshare, stats, llm-pi-ai, recommendations,
  action-cards) — translate only if those bundles are ever added.
- `closed` css literal: the switch knob uses `--dsw-alias-label-primary-foreground`; if a future
  DSH renames it, the test that forbids literal colours will fail loudly rather than silently
  render an invisible knob.


## 11. Sidebar Manager panel: single page -> three tabs

The manager panel was one long page mixing four concerns, and it printed its own name twice
(measured DOM: `H1:워크스페이스 관리자`, `H2:가상 그룹 (HQ)`, `H2:워크스페이스 관리자`). It now follows the
native settings tab idiom:

| Tab | Owns |
|---|---|
| 워크스페이스 | workspace list, title edit, folder rename gate, archive/restore |
| 그룹 | virtual group tree, UTM role/policy, order preview + align |
| 진단 | advisory, HQ bootstrap, promotion gate, orphan scan |

**For the Core-02 UTM harness:** no store schema, route or policy changed — only where each
capability renders. `groups.json` is still `GROUPS_UNIT` v3, and the tab boundaries are pinned by
tests (`groups.hqTitle`/`orphansTitle`/`promoteTitle`/`advisoryTitle` only on Diagnostics,
`groups.align` only on Groups, `workspaceManager.listTitle` only on Workspaces). Implementation
detail: `dsh-sidebar-manager/docs/sidebar-manager/PHASE7-PANEL-TABS.md`.

Also fixed while measuring: the panel styled itself with 6 `color-mix(in srgb, currentColor N%)`
and 12 `currentColor` uses instead of DSH tokens; it now resolves entirely through
`--dsw-alias-*` / `--dsw-radius-*` (browser check: 0 remaining `color-mix`).

Browser verification (isolated profile): ArrowRight 워크스페이스 -> 그룹 -> 진단, End -> 진단,
Home -> 워크스페이스, ArrowLeft from the first tab wraps to 진단. Tab metrics match native
(13px, 7px 1px 9px, 22px gap, 2px underline at bottom -1px).


### 11.1 Correction: rail placement and heading spec (2026-11-03)

Two claims in the previous revision were wrong, and both were fixed:

1. **"The plugin panel cannot sit between native entries."** Wrong. `ui-sidebar` renders
   `panels.filter(...)` and appends the More launcher after it, so any `order` puts a
   plugin row between native rows (measured: 플러그인 y=114, 자동화 작업 y=152,
   워크스페이스 관리자 y=190, 더 보기 y=228). The panel now registers **no**
   `sidebar.panellist` entry and lives only in the More menu, opening through
   `ctx.layout.selectPanel`. Verified: the rail is exactly `[플러그인, 자동화 작업, 더 보기]`
   and More lists the panel.
2. **"All fonts match."** Only the body/description/control sizes matched. The heading
   hierarchy did not: H1 was `20px/650/lh 22px` and the section head `13px/600`. Both now
   follow the native page spec: H1 `20px/500/28px`, section head `14px/500/22px`.

The earlier measurement was also contaminated: it read the plugin's own
`[role="tabpanel"]` while labelling it "native". Re-measured with explicit scoping before
concluding.

## 10. Release artifacts (rule: artifacts are immutable)

Source changed, so the released tarballs no longer described the tree. Versions were bumped and
new artifacts packed:

| Package | New version | Artifact | SHA-256 (first 16) |
|---|---|---|---|
|  | 0.2.4 -> **0.2.5** |  |  |
|  | 0.1.7 -> **0.1.8** |  |  |

 and  were prepended and verified with
 (all OK). Market index  updated in both packages, and each
 was asserted before the write. Sidebar Manager and Token Economizer sources
did not change (tests only), so their artifacts stay as released.
