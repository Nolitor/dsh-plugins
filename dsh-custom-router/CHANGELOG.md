# Changelog — @nolit/dsh-custom-router

<!-- skeleton:
version: 0.0.1-rc.11
kind: report
status: active
updated: 2026-11-11
summary: Engineering history for the Custom Router track: created 2026-11-06 as a specification track, extended 2026-11-07 with the OpenCodex bridge library and preset mounts, extended 2026-11-08 with the browser dashboard, the settings schema, the shared stream pipe, the browser redesign, and the owner-ordered integration of the Antigravity/DeepInfra plugins into the router vendor tree, extended 2026-11-10 with the preset-based CLI dispatch policy.
-->

## 0.0.1-rc.11 — hairline token, CJK wrapping — 2026-11-11

Owner task: the four plugin UI surfaces must stop hardcoding the hairline and must not break
Korean words mid-word.

**Measured, from the shipped source (before → after):** `.5px` literals in `lib/client.src.js`
**28 → 0**; `word-break:keep-all` on the root `.crSection` absent → present.

Every border now reads `var(--dsh-hairline-width,1px) solid var(--dsw-*)`. The one negative
offset (`.crTab{margin-bottom:-.5px}`) became `calc(-1 * var(--dsh-hairline-width,1px))`, so the
tab underline still cancels exactly one hairline instead of a fixed half pixel. The token is
published on the document root by `@deepseek-ai/dsh-client-ui-theme`, which resolves it to
`max(1, floor(0.5 * dpr)) / dpr` — the literal ignored that on every display.
`test/client.test.mjs` gained a regression gate that fails the suite if a `.5px` literal or a
missing `keep-all` returns.

## 0.0.1-rc.10 — 2026-11-10 (dispatch policy: preset-based, not workspace-write)

Owner instruction: the four presets are minimal, ptc, standard, cordis. minimal and ptc hard-block
external CLI and subagent dispatch; standard and cordis may dispatch on `workspace-write`; only
`read-only` keeps the sandbox restriction.

**Measured cause of the revision.** `dsh --profile web --dump-config` shows
`sandbox-policy.mode = DSH_PERMISSION_MODE ?? 'workspace-write'`, and the service env carries no
`DSH_PERMISSION_MODE`. The rc.9 policy listed `workspace-write` as restricted, so every ordinary
session refused all four CLI tools while the HTTP model route kept working — the owner-visible
"OpenCode is broken" symptom. `ptc` was not restricted at all.

| Constant | rc.9 | rc.10 |
| :--- | :--- | :--- |
| `RESTRICTED_PRESETS` | `['minimal']` | `['minimal', 'ptc']` |
| `RESTRICTED_SANDBOX_MODES` | `['read-only', 'workspace-write']` | `['read-only']` |

Evidence: `npm test` 372/372 (four new policy cases), `verify:dispatch` 17/17 (8 denials,
3 allows), live mount unchanged. `applied pending restart` — the running `dsh-web.service` keeps
the rc.9 gate until it restarts (owner-only).

Peer alignment completed: `dsh-opencode-v2` rc.5, `vendor/antigravity` rc.11 and
`vendor/deepinfra` rc.12 now peer this package at `0.0.1-rc.10`; deepinfra had been left at `rc.2`.

## 0.0.1-rc.9 (cont.) — 2026-11-08 (provider-slot migration, Step 1)

Owner instruction: *"M9 readiness probe는 보류하고, 1) 벤더의 라우터 의존성 버전 정렬(rc.2 → rc.9)과
2) OpenCode CLI 토글 비활성화(Step 1) 두 가지만 승인한다. 규정 절차대로 문서 갱신 및 마운트 검증
거쳐서 깔끔히 커밋하고 한글로 간략히 보고해라."*

**1. Router peer alignment.** Both provider packages pinned
`@nolit/dsh-custom-router: 0.0.1-rc.2` while this package had reached `rc.9`. A strict resolver
refuses that pairing, and the failure would surface at mount time rather than in review.

| Package | Before | After |
| :--- | :--- | :--- |
| `dsh-opencode-v2` | `0.0.1-rc.2` | `0.0.1-rc.9` |
| `vendor/antigravity` | `0.0.1-rc.2` | `0.0.1-rc.9` |

The `opencode-v2` suite asserted the literal `rc.2`, so it pinned the drift instead of catching
it. That assertion now compares against the router's own `package.json` version, and this track
gained the same check.

**2. OpenCode CLI surface — switched off, then WITHDRAWN (same day).**

`vendorConfig['dsh-opencode-v2'].cli: false` was applied as "migration Step 1" and reverted within
the hour. Measured reason: that ONE vendor switch (`cliOn`) withdraws the `opencode` delegation
tool, `/ocode` and `cli_worker` together, so the step removed surfaces users call — including the
`/ocode` command the owner reported as "not loading". The owner's later instruction was that the
migration itself was already complete; the router had been mounting these surfaces all along.

| Item | State |
| :--- | :--- |
| `cli: false` in the live profile | **withdrawn** (backup `cordis.patch.yml.bak.before-ocode-restore-*`) |
| `surfaces.cli` declaration | live (no `default: false`); `gates: ['opencode']` retained |
| `/ocode`, `opencode`, `cli_worker` | mounted again on the next `dsh-web.service` restart |

**Correction to an earlier claim in this file.** A previous revision said the surfaces "ship OFF".
They do not: `dsh-opencode-v2` declares `cli: Schema.boolean().default(true)`, its own
`cordis.patch.yml` carries no `cli` key, and a booted pre-change profile shows all four surfaces
mounted. The drift gate now reports OK against the live profile.

**Latent defect (still real, still unfixed).** `dsh-opencode-v2` installs no
`app-boot/config-reload` reconcile (measured 2026-11-08; `vendor/antigravity` does), so ANY
`cli` flip — on or off — needs a `dsh-web.service` restart. This is why the withdrawal is not
visible in the running process yet. Ledger F-46 class; fixing it is a code change the owner has
not approved.

## 0.0.1-rc.9 — 2026-11-08 (CLI dispatch control plane: admission + reclamation)

Owner instruction: *"프리셋/샌드박스 제한 시 비인가 CLI 디스패치가 자연스럽게 차단될 것 … 세션
중단 시 외부 워커 프로세스가 좀비나 탈주 상태로 남지 않고 회수될 것"*

Two duties, both placed in the router because the router is the only owner of the preset
mounts, and both built on seams that already existed rather than new mechanisms.

| Duty | Implementation | Seam reused |
| :--- | :--- | :--- |
| Refuse dispatch under a restricted preset/sandbox | `tools/pre-execute` listener, `prepend`ed, installed before the rows mount | the shipped policy seam Auto-review uses; denial is an ordinary `{kind:'deny'}` |
| Reclaim a dispatched worker on session end | `CliWorkerRegistry` + `agent/disposed` / `session/disposed` / router disposer | the subprocess handle's own `terminate()` verb |

**Measured, and each one changed the implementation:**

| Finding | Consequence |
| :--- | :--- |
| The sandbox blocks file effects, not process creation (`read-only` still spawns `dsh`, nested `bwrap`) | a gate is the only thing that stops a restricted session outsourcing work |
| A child cannot see a parent-provided service via `ctx.get()`; `ctx.inject` can | every vendor acquires `customRouter` through deferred injection |
| Providers hold the parent Agent; lifecycle edges deliver a Session | `sessionOf()` normalizes both identities, or reclamation would never match |
| The settings schema materialises `[]` for an absent array | empty lists fall back to the shipped defaults instead of restricting nothing |

**Files.** New `lib/dispatch-gate.js` (gate, registry, lifecycle binding) and
`docs/CLI-DISPATCH-CONTROL-PLANE.md`; `lib/index.js` extends the existing `customRouter` seam
with `cliDispatch` and releases gate/registry in its disposer; `lib/settings-schema.js` gains
`cliDispatchGate`. Vendored AGY (`subagent.js`, `cli-batch.js`, `index.js`) and OpenCode v2
(`subagent.js`, `index.js`, `workers/run.js`, `workers/index.js`) register handles and assert
the same rule in `start()`.

**Neutralizing `auto: true`.** The decision lands before the tool body, so no argv is built and
no `--auto` can be read. A regression test pins that `--auto` never reaches a process under a
denial.

**Verification.** `npm run verify:dispatch` — 10/10 live checks (4 restricted combinations deny
all CLI tools with `bodyRuns: 0`; a real child is killed by agent disposal, session disposal,
and router unload; a sibling session's worker survives). Suites: router 361, AGY 171,
OpenCode v2 479 — all pass. `dsh --profile web --dump-config` exits 0 and the router still
mounts with `cliDispatch` present.

## 0.0.1-rc.8 — 2026-11-08 (Antigravity/DeepInfra absorbed; llm-pi-ai re-enabled)

Owner instruction: *"커스텀라우터 플러그인 통합으로 인하여 플러그인 중에 안티그래비티, 딥인프라
플러그인 삭제 및 관련 서브 프로젝트 해당 플러그인 사용하지 않고 커스텀라우터 플러그인으로
통합되었다고 관련 문서 커밋하고, 설정-모델 pi-ai 사용 가능으로 활성화해줘"*

**Moved, not rewritten.**

| Before | After |
| :--- | :--- |
| `dsh-antigravity/` active track + profile `link:` dependency | `dsh-custom-router/vendor/antigravity/`; no profile dependency or `node_modules` link |
| `dsh-deepinfra/` active track + profile `link:` dependency | `dsh-custom-router/vendor/deepinfra/`; no profile dependency or `node_modules` link |
| preset packages resolved through the profile | internal exports `@nolit/dsh-custom-router/vendor/antigravity` and `.../vendor/deepinfra` |
| live `llm-pi-ai` row `disabled: true` | row enabled (dormant with zero routes until a provider profile is saved) |

**Code changes:** `vendor-modules.js` loads the vendored Antigravity bridge modules from
`import.meta.url`; OpenCode remains profile-resolved. The vendored libs import the shared stream
pipe and vendor bridge by relative path. `lib/presets.js` names the internal subpath packages, and
`preset-schema.js` now accepts a scoped package subpath (the previous exact `@scope/name` regex
would reject the router's own vendor export). The started-bundle guard now excludes the router's
own package name, because `@nolit/dsh-custom-router/vendor/*` subpaths were being mistaken for a
second mount of the router bundle; a regression test pins that case.

**Profile cleanup (measured before → after).**

| Check | Before | After |
| :--- | :--- | :--- |
| `~/.dsh/profiles/web/package.json` dependencies | included `@nolit/dsh-antigravity`, `@nolit/dsh-deepinfra` | neither present |
| `~/.dsh/profiles/web/node_modules/@nolit/` | both links present | neither link present |
| `dsh --profile web --dump-config` | `llm-pi-ai` `disabled: true`; router row present | `llm-pi-ai` active; router row present; no vendor dependencies |
| Isolated real boot (`scripts/verify-mount.mjs`) | router mount ok | router mount ok; providers `antigravity`, `deepinfra`, `deepinfra-anthropic`, `deepseek-account`, `opencode-http-agent`; `did not activate` 0 |

**Verification:** custom-router 332/332; vendored Antigravity 164/164; vendored DeepInfra
205 pass / 7 skip / 0 fail. The integration record is
[`docs/PROVIDER-INTEGRATION.md`](docs/PROVIDER-INTEGRATION.md).

## 0.0.1-rc.7 — 2026-11-08 (browser surface redesign — provider rows over DSH tokens)

Owner instruction: *"오늘 만든 커스텀라우터 플러그인 이 스킬 주입을 이용해서 다시 레이아웃 짜 물론 전체
스타일이랑 폰트 타이틀 모두 dsh 스타일 따르고 ui 디자인만 적용할 수 있도록 해"* — re-lay out the
custom-router browser surface with the injected `/ui` skill's component hierarchy, keep DSH's own
style, typography tokens and title conventions, change design only.

**Scope: the browser surface only.** No write path, settings path, i18n key, registration id,
locale value or data path changed. Every measurement below is a CSS value or a DOM structure read
out of `lib/client.src.js`; the router behaviour is untouched.

**Component selection (the `/ui` hierarchy, adapted).** The skill names shadcn/ui as the default
for standard dashboard surfaces. This bundle is a plain CommonJS factory evaluated by
`window.__ModuleLoader__` and may only `require('react')`, so the shadcn/ui **composition and
visual language** are reproduced locally over the DSH design tokens instead of adding packages:
row / card / form-section / field / toolbar / footer-bar / tab patterns, a segmented action style,
and one inline SVG icon set. No dependency was added, and no marketing effect (Magic UI /
Aceternity) was used.

**Layout: one column of provider rows, one full-width detail panel.** The 3-up vendor grid was
the defect. Every card was stretched to the width of its widest sibling, so a form with one
credential field got the same 380 px column as a card with three, and the measurement of one
provider sat next to the measurement of another. The surface is now a **single column of compact
provider rows** (`.crProviderList` → `.crProviderItem` → `.crProviderRow`), and the detail of the
open provider renders **below the list, full width** (`.crProviderDetail`), not inside a column of
its own.

| Complaint | Measured before | Now |
| :--- | :--- | :--- |
| The provider wall was flat: three cards in one row, no hierarchy | `.crVendorGrid{grid-template-columns:repeat(3,minmax(0,1fr))}` — every card stretched to the widest sibling | `.crProviderList` is one column (`.crProviderItem` per provider); the opened provider's detail (`.crProviderDetail`) is a full-width sibling of the row, not a column of a grid |
| Each card carried the whole measurement, so scanning meant reading | `.crVendorCard` mixed identity, measurement and switches in one stack | the row carries a **mini usage summary** (`.crMiniUsage`): the tightest window's label, percent and reset time — or the spend and balance for a pay-per-token provider — with a decorative bar (`aria-hidden`) |
| The detail had no frame of its own | the measurement was a bare list inside the card | the full measurement sits in one compact inset (`.crUsageInset`) inside the detail panel, beside the settings form |
| The page was wider than a readable dashboard | `.crPage{width:100%;max-width:1180px;margin:0 auto;padding:16px 20px}` | `.crPage{width:100%;max-width:1120px;margin:0 auto;padding:20px 24px;box-sizing:border-box}` — measured 1120 px at a 1600 px viewport |
| The settings trigger was an emoji | `.crGear` rendered the text node `'⚙'` (platform emoji font, ignores the colour tokens) | an inline 16 px SVG (stroke `currentColor`, `aria-hidden`), still `aria-expanded` + `aria-controls` |
| Keyboard focus was invisible | no `:focus-visible` rule existed | one rule for `.crButton` / `.crTab` / `.crGear` / `.crJump` / `.crSearchInput` / `.crInput` / `.crSwitch` / `.crRowCheck`, using `--dsw-focus-ring-width` and `--dsw-focus-ring-color` (the same tokens DSH's own theme uses) |
| A literal pixel size survived on the icon button | `.crGear{font-size:14px}` | removed; **every** `font-size` in the stylesheet is a `var()`/`calc()` on the DSH content tokens (measured: 0 literal sizes) |
| Credentials were one dense inline row | `.crCredentialRow` = name + input + state + two buttons on one line | `.crField` form blocks under a labelled `.crFormSection` (title + write-only hint): field name, set/unset state, masked input, primary save + ghost clear |
| The model manager chrome scrolled away | static `.crToolbar` and `.crFooterBar` | the toolbar sticks to the top (`position:sticky;top:0`), the action bar sticks to the bottom (`position:sticky;bottom:0`) |
| A dense table could widen the page | `.crPage` declared no overflow rule | `.crPage.crPageScroll{overflow-x:hidden}`; the plan table keeps its own scroll (`.crPlanTableWrap{overflow:auto}`) |
| The picker was four identical tiles | `crPickerCard` with one anonymous button | a head row (name + added badge), description, auth hint and one primary action (`data-picker-action="add"`), disabled for `custom-json` and for an already added provider |
| Empty and loading states looked identical | `.crEmpty` for both | `.crEmpty[data-state=loading|empty|error]` with the error copy in the error colour |

**Accessibility contract (the final pass).** The redesign was audited against the browser
contract, and the surface now states the following in the DOM, not only in the stylesheet:

- **Real plan table semantics.** The plan ledger was a grid of `<div>`s (`.crPlanRow`); it is now
  a `<table class="crPlanTable">` with a `<thead>`, `<th scope="col">` on every column, a `<tbody>`
  and an `aria-label`. The table keeps its own scroll (`.crPlanTableWrap`).
- **Keyboard tabs.** Both tab strips (the dashboard's usage/add strip and the model manager's
  per-preset strip) carry `role="tablist"` with an accessible name, a roving `tabIndex`
  (`0` on the selected tab, `-1` on the rest), and one `keydown` handler on the strip:
  `ArrowRight` / `ArrowLeft` move the selection and wrap, `Home` / `End` jump to the first and last
  tab. The handler moves the DOM focus with the selection, so a keyboard user follows the tab
  instead of losing the strip.
- **Collapsed settings leave the tab order and the accessibility tree.** A closed settings panel
  keeps its DOM (the reveal animates it open), so its inner box carries `inert` **and**
  `aria-hidden="true"` while collapsed. Without both, `aria-expanded="false"` on the trigger would
  be a lie.
- **Live regions.** Every write result is announced through a `role="status"` region with
  `aria-live="polite"`, and the region is **always mounted** — a region that appears together with
  its text is not announced. One per provider panel (3) plus the model manager's footer.
- **Credential labels.** Each write-only credential input is named by a real `<label htmlFor>`
  pointing at a unique input id, so the field name is visible and is the accessible name (no
  `aria-label` shadows it). The input is `type="password"` with `autoComplete="new-password"`, so a
  stored secret is never offered to the browser's autofill.
- **Progress bars carry a readable value.** Every `role="progressbar"` — the usage windows in the
  detail and the plan windows in the model manager — carries `aria-valuenow` / `aria-valuemin` /
  `aria-valuemax`, an `aria-label`, and an `aria-valuetext` that names the window and its percent
  (or the limit reached). The mini bar in the provider row is decoration and is `aria-hidden`.
- **Reduced motion.** `@media (prefers-reduced-motion: reduce)` removes every transition this
  surface owns (`.crButton`, `.crGear`, `.crTab`, `.crReveal`, `.crSwitch`).

**Typography and colour contract.** The surface root still reads
`font-size:var(--dsh-content-font-size,14px)` with
`line-height:calc(22px + var(--dsh-content-font-delta,0px))`, hints and meta use the derived
secondary token, `font-family` is `inherit` (the code seat is the only exception, for model ids
and rates), and no colour is a literal: every fill, border, radius and focus ring is a `--dsw-*`
token or `transparent` (measured: 0 hex, 0 `rgb()`/`hsl()`; the only non-token colour keyword in the
stylesheet is `transparent`). The DSH title text and the title hierarchy are unchanged.

**The settings section now matches the built-in plugin tab menu (measured).** The settings surface
(`settings.section`, id `custom-router`) was aligned to DSH's own
`packages/client/ui-settings-plugins/src/client/PluginsSettingsSection.module.css`: it is a
760 px column instead of the dashboard's full-bleed `.crPage` container, and its heading, intro and
tab strip use the built-in geometry.

| | Before | Now (measured from the built-in section) |
| :--- | :--- | :--- |
| Section width | `.crPage.crPageNarrow` — a 920 px page with `padding:20px 24px` | `.crSettingsSection{display:flex;flex-direction:column;gap:12px;max-width:760px;min-width:0}` |
| Heading | `h2.crTitle` (`.crTitle` is shared with the dashboard) | `h2.crSettingsTitle` — `calc(var(--dsh-content-font-size,14px) + 4px)` / `600` |
| Intro | `p.crSubtitle` | `p.crSettingsIntro` — the secondary content token in the tertiary label colour |
| Tab strip | `.crTabs` (dashboard chrome: `gap:2px`, `border-l3`, 14 px tabs) | `.crSettingsTabs{display:flex;align-items:flex-end;gap:22px;border-bottom:.5px solid var(--dsw-alias-border-l2);margin-top:2px}` |
| Tab | `.crTab` (14 px, `padding:10px 14px`, 2 px business-primary border) | `.crSettingsTab` — `padding:7px 1px 9px`, the secondary content token, tertiary label colour, and a 2 px `--dsw-alias-label-primary` underline (`bottom:-1px`, `border-radius:2px 2px 0 0`) on the active tab, with the host focus ring on `:focus-visible` |

The heading and intro are direct children of the section (the built-in section has no header
wrapper), so the hierarchy is `section > h2 + p + tablist + tabpanel`. The dashboard keeps its own
`.crPage` / `.crTabs` chrome and is untouched. The model data attributes, the tab ids
(`cr-models-tab-<preset>`), the panel id (`cr-models-panel-<preset>`), the `tablist` role and
accessible name, the roving `tabIndex`, the arrow-key handler, the save path and every locale
string are unchanged. Group cards keep the settings-card tokens
(`--dsw-alias-settings-card-fill` / `--dsw-alias-settings-card-stroke`, `.5px` hairline,
`--dsw-radius-lg`).

**Class names.** Removed (12): `crCredential`, `crCredentialField`, `crCredentialHead`,
`crCredentialName`, `crCredentialRow`, `crCredentialTitle`, `crPlanRow`, `crPlanRowHead`,
`crTitleBlock`, `crVendorCard`, `crVendorGrid`, `crVendorHead`. Added (27): `crField`,
`crFieldActions`, `crFieldHead`, `crFieldLabel`, `crFormSection`, `crFormSectionBody`,
`crFormSectionHead`, `crFormSectionHint`, `crFormSectionTitle`, `crMiniBar`, `crMiniBarFill`,
`crMiniLabel`, `crMiniPct`, `crMiniReset`, `crMiniRow`, `crMiniUsage`, `crPickerHead`,
`crPlanTableWrap`, `crProviderDetail`, `crProviderHead`, `crProviderItem`, `crProviderList`,
`crProviderRow`, `crProviderUsage`, `crSettingsIntro`, `crSettingsSection`, `crSettingsTab`,
`crSettingsTabs`, `crSettingsTitle`, `crStatusLive`, `crUsageInset`, `crUsageWindows`. The
stylesheet grew from 127 to 142 `.cr*` classes (23 593 → 28 813 bytes of emitted CSS) and no rule
targets a bare element selector.

**Tests:** 313 → 332 (`npm test`), all green; `npm run check` and `npm run verify:stream` green
(7/7 dispatch, 0 vendor loads). The client suite went 48 → 67 tests. New: the typography-token
form (no literal size, no literal colour, `inherit` family only), the SVG icon trigger (and the
emoji must not come back), one measurement inset per provider, the focus-visible ring on every
interactive control, the credential form blocks, the picker action contract, the responsive rules,
the provider-row / full-width-detail layout, the accessible name on every tab strip, the keyboard
tab strip on both surfaces, the inert + `aria-hidden` collapsed panel, the live regions, the real
credential labels, the `aria-valuetext` on both progress-bar families, and the reduced-motion
block. Updated for the intentional layout change: the pinned width container (1180 → 1120 px), the
provider-grid assertion (`.crVendorGrid` → `.crProviderList` / `.crProviderItem`), and the picker
action selector (`className === 'crButton'` → `data-picker-action="add"`, because the action is now
a primary button). No behaviour or accessibility assertion was weakened.

The settings-section alignment adds one test (`the settings section follows the built-in plugin
section spec`): the 760 px column, the `h2` heading class, the intro class, the tab strip class and
its three tabs, and the pinned built-in tab geometry (gap 22 px, `padding:7px 1px 9px`, the
secondary font token, the 2 px label-primary underline, the focus ring). The two heading assertions
were retargeted from the shared `.crTitle` / `.crSubtitle` classes to the section's own
`.crSettingsTitle` / `.crSettingsIntro`; the copy they assert is unchanged.

**Not verified.** The redesign was not checked in a live browser (no DSH boot in this session):
the sticky offsets, the inset contrast in both themes, the 1120 px measure and the rendered
contrast of the mini bars are read from the stylesheet and the DOM structure, not measured on
screen.

## 0.0.1-rc.6 — 2026-11-08 (Anthropic Messages protocol hooks in the shared pipe)

Owner instruction: a provider's protocol is the axis, not the vendor. The shared downstream pipe
must absorb **Anthropic Messages** the same way it absorbed OpenAI, so any provider that speaks the
protocol (DeepInfra's `/anthropic` route, OpenCode's `/v1/messages`, or a direct Anthropic key) can
be served by a thin binding instead of a copy of the parser.

**Added**
- `lib/stream/anthropic.js` (new, exported as `@nolit/dsh-custom-router/stream/anthropic`):
  - `readAnthropicSse` — event-typed SSE (`event:` + `data:`), multi-line data, CRLF, comments,
    **no `[DONE]` sentinel**, malformed JSON -> `PROTOCOL_DEFECT`, empty data frames skipped;
  - `readAnthropicEvent` — `message_start` usage, `content_block_start` (text/tool_use/thinking/
    redacted_thinking), `content_block_delta` (`text_delta`/`thinking_delta`/`input_json_delta`/
    `signature_delta`), `message_delta` (stop_reason + usage), `message_stop`; a mid-stream `error`
    event becomes an in-band failure (`PROVIDER_RESOURCE` for `overloaded_error`/`api_error`,
    `RATE_LIMIT` for `rate_limit_error`) instead of a successful stop;
  - `createAnthropicHooks()` — per-stream state so usage pieces from `message_start` and
    `message_delta` merge (the pipe replaces usage per record) and per-block `signature` survives;
  - `usageFromAnthropic` — Anthropic `input_tokens` **excludes** cache, so the projection does not
    subtract `cacheRead` the way the OpenAI writer does; `cacheReadTokens`/`cacheWriteTokens` are
    separate buckets; `totalTokens` only when the provider total agrees;
  - `mapAnthropicFinish`, `ANTHROPIC_DESCRIPTOR` (`fragmented`, `input+output+cache`, `fail`).
- `lib/stream/wire.js` finish table: `pause_turn` -> stop (server paused a long turn, not an error)
  and `model_context_window_exceeded` -> max-tokens. Measured: leaving them unmapped turned a
  provider pause into `UNKNOWN_FINISH_REASON` and killed the turn.

**Measured constraints encoded** (2026-11-08): `thinking_delta` is the only reasoning channel;
`signature_delta` emits no chunk and the host `ContentBlockMap` has no signature field, so the
signature lives in the provider binding's state and in `replayState` on the replay path; a
`tool_use` block announces `id`/`name` on `content_block_start` and its JSON arrives as
`input_json_delta.partial_json` fragments (same fragmented shape the pipe already owns).

**Addendum — subagent tool rows opt into per-call model selection (2026-11-08).**
`PRESETS.antigravity` and `PRESETS.opencode` now declare `modelSelection: true` on their
`tool-subagent-*` entry, and both vendor `cordis.patch.yml` rows carry the same switch. Measured
requirement: `dsh-tool-subagent` rejects `modelSelection` unless the provider's
`capabilities.agentOptions` is true (the vendor providers were changed in the same round), and the
allowed-route policy comes from the Session's `subagent/model-selection-policy` event, not from the
provider — so no provider-side route table was invented. `test/presets.test.mjs` was updated to the
new measured entry set.

**Verification (measured):** `npm test` **313 pass / 0 fail** (286 -> 313, +27 protocol tests);
`npm run verify:stream` 7/7, vendor loads 0; `node --check` on every edited module. No adapter
registered, no provider table, no `dsh-llm` import — R0 unchanged.

## 0.0.1-rc.5 — 2026-11-08 (width container, one tab panel, tabbed model picker)

**Addendum — OpenCode plan/usage card (2026-11-08 04:30).** The OpenCode tab now opens with a
`플랜 사용량` card built strictly from measured data:
- tier from the local ledger's `bySource` (`go-plus` present → **Go Plus**, labelled 원장 증거;
  no evidence → `플랜 미확인`, never a guess) — the console API exposes no plan id;
- the three windows (`5시간 / 주간 / 월간`) as real progress bars with a `한도 도달` badge;
- `사용 $23.60 · 허용량 $64.35 · 37%` from `cost.listCostUsd / allowanceUsd` + request count;
- a per-model table aggregating `cost.bySession[].byModel` (requests, spent, allowance) with the
  **documented monthly limit** (`Go Plus` column, docs 2026-11-07) beside it, and an explicit
  `로컬 기록 기준` note. Measured live: 9 rows; `kimi-k3.1-pro $60`, `deepseek-v4.1-flash $200`.
  Witnessed live: 3 bars, tier go-plus, allowance line, 9 table rows.


**Scope:** the two surfaces the owner rejected in the rc.4 build. No backend row, switch, schema
field or write path changed; the writes are the same ones rc.4 measured end-to-end.

| Complaint | Measured before (rc.4) | Now |
| :--- | :--- | :--- |
| Sidebar dashboard stretched across the whole window | `lib/client.js` rendered a bare `section.crSection` (`max-width:1100px`, no horizontal padding); the host main slot made it full-bleed | `div.crSection.crPage` — `width:100%;max-width:1180px;margin:0 auto;padding:16px 20px;box-sizing:border-box` |
| Both tab panels rendered at once | Both `role="tabpanel"` nodes were in the DOM and `hidden` lost to `.crPanel{display:flex}`, so "프로바이더 추가" content showed under the dashboard | Only the active panel is RENDERED (conditional). `aria-controls` exists only on the active tab, `tabIndex` follows selection, no `hidden` attribute survives |
| Settings model list ignored the DSH row style and stacked three long categories | `MODEL_SOURCES.map(...)` rendered three `crCategory` sections at once | Tabs `안티그래비티 / 오픈코드 / 딥인프라` (`cr-models-tab-<id>`), one active `role="tabpanel"` (`cr-models-panel-<id>`, `data-category`), and ONE shared toolbar/group/row/footer layout |

**Antigravity reasoning-effort collapse.** The `/models` route already returns the base rows and
their variants (`groups[].models[] = {id,name,variants,enabled}`), and rc.4 threw that away by
rendering the flat `models[]`, so Gemini 3.8 Flash appeared three times. The tab now renders one
row per base model, shows the family's remaining quota in the group header
(`limits[].remainingFraction` → `주간 4% 잔여`), and a checkbox toggles EVERY variant id of its row.
The save value is the flattened variant list, in row order:

```
mutate([{ op: 'set', path: ['vendorConfig', 'dsh-antigravity', 'enabledModels'],
          value: ['gemini-3.8-flash-high', 'gemini-3.8-flash-medium', 'gemini-3.8-flash-low',
                  'gemini-3.5-flash-lite', 'claude-sonnet-4.5'] }])
```

**Class names.** Shared layout: `crPage` / `crPageNarrow`, `crToolbar` / `crSearchInput`,
`crButtonGhost` / `crButtonPrimary`, `crCards`, `crGroup` / `crGroupHead` / `crGroupTitle` /
`crGroupMeta` / `crGroupSide` / `crGroupBody`, `crList`, `crRow` / `crRowCheck` / `crRowMain` /
`crRowName` / `crRowId` / `crRowMeta`, `crPrice` / `crPriceRate` / `crPriceList` / `crPriceNote`,
`crBadgeMeta[data-tone]` (`promo`, `positive`, `muted`), `crEmpty`, `crFooterBar`, `crPanelBody`.
`crCategory*`, `crModelRow*`, `crModelPrice`, `crPromoBadge` and `crModelEmpty` are gone.

**Normalized shapes.** `normalizeAntigravityModels` / `normalizeOpencodeModels` /
`normalizeDeepinfraModels` now return **groups** (`{id,labelKey,label,quota,quotaTitle,rows[]}`)
instead of a flat row list; OpenCode groups by plan (`go` / `zen`), DeepInfra is one price card.
A flat Antigravity `models[]` payload (no `groups`) still renders as one `기타 모델` card.

**Locale.** 8 new keys in `en` / `ko` / `zh` (parity enforced by `gen-locale`): `groupGemini`,
`groupClaudeGpt`, `groupArgon`, `groupOther`, `planOther`, `quotaLeft`, `promoCount`,
`modelsSelectedTotal`. 119 keys × 3 locales.

**Tests:** 275/275 (`npm test`). New/rewritten: the width container, conditional panels + aria
wiring, the three model tabs, the shared row layout across all three vendors, the Antigravity
family grouping + variant toggle + exact save payload, DeepInfra rate/promo/struck-through list
price, OpenCode plan grouping with no dollar figure, the empty-selection guard, the per-tab search
filter, and "no `crCategory` vendor sections". `npm run check` and `npm run docs:check` green.

**Live verification (Chromium against the running 3080, 2026-11-08 03:12).** The worker's
vm-based evidence was re-checked in the real GUI after the HMR rev moved: the dashboard
section measures exactly **1180 px** at a 1600 px viewport and now mounts **one** tabpanel
(the add-provider panel is absent from the DOM); the settings dialog shows three tabs
(안티그래비티 / 오픈코드 / 딥인프라) with one mounted panel; Antigravity renders family group
cards (`Gemini 모델` with `주간 96% 잔여 · 5시간 100% 잔여`, `Claude 및 GPT 모델`, `Gemini 4 Argon`)
and one row per base model (`Gemini 3.8 Flash` instead of High/Medium/Low), subscription rows
`구독 포함`; DeepInfra renders `입력 $0.075 · 출력 $0.225 / 1M` with the struck-through list price
and `75% 할인`. No config was written during verification.

## 0.0.1-rc.4 — 2026-11-08 (settings schema + single dashboard — M10 UI sprint)

**Scope:** the front half the rc.3 row was missing. A `Config` schema makes the row
configurable, and one browser dashboard (settings section `custom-router`) owns provider usage,
per-layer switches and credentials under the single `커스텀 라우터 / Custom Router` entry.

**Measured defects this fixes (isolated boot, 2026-11-08).**

| Symptom | Measured before | After |
| :--- | :--- | :--- |
| Settings service could not project the row | `describe()` had no `dsh-custom-router` namespace; the Plugins list showed the raw package name | namespace served with `presets` / `vendorConfig` / `usage`; locale `meta.title` renders `커스텀 라우터` |
| Browser half never registered | `clientModules.sources` had no `@nolit/dsh-custom-router` (`resolveMeta` answered null) | client bundle listed in the graph (`plugins/??@nolit/dsh-custom-router/client.js&rev=…`) |
| Switches unsaveable | no schema → `settings.write` answered "no configurable plugin entry" | `presets.<id>`/`vendorConfig.<row>.*` writes accepted as volatile; `strict` refused ("is not volatile") |
| Secret-bearing row visible | — | `role('secret')` redaction: API key absent from `value`, sidecar reports `vendorConfig.dsh-deepinfra.apiKey=true` |

**Why the loader row is now the BARE package name.** `@deepseek-ai/dsh-client-modules`
maps a row back to its manifest with `exactPackageSpecifier(row.name)`, which returns
`undefined` for a scoped SUBPATH. A row named `@nolit/dsh-custom-router/plugin` therefore
never reached `resolveMeta`, so the client half was invisible even though the host half
mounted and the settings namespace existed. The package now exports `"."`, and
`cordis.patch.yml` names the row `@nolit/dsh-custom-router`.

**The browser surface (design approved 2026-11-08).** CSS-grid dashboard, real DOM
`role="progressbar"` bars (no block characters), three equal vendor cards with independent
`0fr → 1fr` settings reveals, DeepInfra pay-per-token billing variant (unknown balance
reported as unavailable, never zero), write-only credential inputs whose "set / not set"
state comes from the settings mirror's secret sidecar (the form snapshot does not carry it),
and an add-provider tab panel. Display text comes from `locale/{en,ko,zh}.json`, baked into
`lib/client.js` by `scripts/gen-locale.mjs` + `scripts/build-client.mjs`.

**Tests:** 261/261 (`npm test`, includes the new `settings-schema`, `client`, `locale` and
`inventory-metadata` suites). `scripts/verify-mount.mjs` now reads the vendor config from
the router row's `vendorConfig` (the live profile no longer carries vendor rows) and prints
`PARITY: PASS`: providers 4/4, tools 6/6, commands 6/6, probes 19/53/178 models.

**Runtime controls and usage feed.** Volatile settings writes retain the router config object
without re-running `apply()`, so `apply()` now listens for `app-boot/config-reload` and diffs
mounted rows by an in-memory fingerprint: only the changed row is disposed/remounted, and a
master-off disposes every row of that preset. The dashboard also reads the same measured local
routes each vendor panel already exposes — Antigravity `/models`, OpenCode `/plan-usage` +
`/model-settings`, DeepInfra `/cost/summary` — and merges those readings over any published
`usage` fallback. Missing routes stay `사용량 미제공`; nothing is synthesized as zero.

**Post-restart verification (live 3080, 2026-11-08 02:08–02:12, Chromium E2E).**
The owner restarted the service at 02:01. Measured in the running GUI:

- Settings (`계정 메뉴 → 설정`) shows **커스텀 라우터** in the settings nav; the dashboard renders
  under it (KPI 3-grid, three equal vendor cards, two tabs). It is a **settings page**, not a
  sidebar row: the main sidebar's `더 보기` lists plugin pages, never settings sections.
- Live readings reach the cards: Antigravity 주간 4% / 5시간 0% (models 9), OpenCode 5시간 3% /
  주간 57% / 월간 54% (models 32), DeepInfra **$0.75** spend, 560 requests, 2,560,350 input /
  335,053 output tokens, `요금표 미제공` / `잔액 조회 미제공`. Five `role=progressbar` bars.
- Two defects found only in that live run and fixed here:
  1. `runtimeUsage` was fetched (four routes, all 200) but never merged into the view model, so
     every window still read `사용량 미제공`; `buildViewModel(mergeRuntimeUsage(...))` now feeds it.
  2. `nextReset` parsed epoch milliseconds as a date string (`new Date(String(1794…))` is
     Invalid Date), blanking the `다음 초기화` KPI; numeric values are now used directly, the KPI
     shows a 24-hour clock time, and card reset lines use a compact `11. 11. 00:00` stamp.
- Client-modules HMR picked up the rebuilt bundle without a second restart (graph rev moved
  `a4f2bc963d71 → 56b13872db32`), so the fixes were verified on the live process.

**M10 UI sprint, second pass (2026-11-08).** Two surfaces now, split by job:

- **Sidebar panel `커스텀 라우터`** (registered into `sidebar.panellist` + the `main` page slot
  keyed `custom-router`): the usage / billing / switch dashboard, reachable from the sidebar
  instead of only from Settings.
- **Settings section `커스텀 라우터`** is now the model-serving manager: one category per preset
  (Antigravity / OpenCode / DeepInfra) listing that vendor's models with a checkbox, a search
  filter and select-all/clear. The selection is saved to `vendorConfig.<row>.enabledModels`
  (the field each vendor already filters its catalog with); the router's `config-reload`
  reconcile remounts that row, so the prompt model picker shows the chosen models without a
  restart. DeepInfra rows carry the provider's per-1M input/output rate and its promotion badge
  (`75% 할인`, list price struck through); subscription plans say `구독 포함` instead of a
  fabricated price.
- Measured live (02:21–02:24): sidebar row opens the dashboard (KPI 3, 5 progress bars);
  settings shows 3 categories with 19/32/92 models, selections 6/19, 3/32, 4/92, and DeepInfra
  rates/promotions. Tests 265/265.
- The save path was measured end-to-end in an **isolated** boot (never against the live
  profile): writing `vendorConfig.dsh-deepinfra.enabledModels = ["deepseek-ai/DeepSeek-V4-Flash-Vision-Exp"]`
  through `settings.write` took the DeepInfra provider from 4 advertised models to exactly 1,
  and restoring the list brought all 4 back — the reconcile remounts the child and the prompt
  picker follows the saved selection.
- An EMPTY selection cannot be saved: every vendor reads `enabledModels: []` as "all", so the
  save button is disabled with `최소 1개 이상 선택해야 합니다` instead of silently turning a
  clear-all into select-everything (measured live: the button is disabled with zero selected).

**Deferred by the owner (2026-11-08), kept here so the next round does not re-derive them.**
- Antigravity reports usage PER MODEL GROUP (Gemini / Claude·GPT / Argon); the dashboard card
  currently merges them (first group wins) and shows one window set. Split the card per group;
  the window order inside a group is already 5시간 → 주간 → 월간.
- The OpenCode plan card code (`PlanUsageCard`, tier evidence, documented-limit table) stays
  exported but is NOT mounted in Settings: usage belongs to the sidebar dashboard, and the
  settings tab must not duplicate it.
- S-A (declaration/Custom-JSON onboarding) and S-B (readiness probe surface) are later rounds;
  S-C (per-model limit / plan tier fidelity) is on hold behind the upstream console API.

**Known gaps (measured, not claimed as done).**
- The `Custom JSON` picker entry remains disabled until the backend has a declaration-preset
  row to enable; the three measured vendor presets are wired.
- The dashboard opens from Settings only. A sidebar entry would need a page-slot contribution,
  which this sprint did not add.

## 0.0.1-rc.3 — 2026-11-07 (multi-row presets + first real mount)

**Scope:** the router's first **real mount**. `entries` makes a preset declare the loader rows it
owns, and `apply()` mounts one child per row with **that row's own config**. Ships
`cordis.patch.yml` + the `dsh.bundle` manifest, so the router is a bundle row instead of a library
only.

**The measured defect this fixes.** The old body mounted `preset.package` once. Against the live
profile that produced **providers 3/4, tools 4/6** (missing `opencode-http-agent`,
`subagent_opencode`, `subagent_antigravity`) — a vendor bundle inserts several rows, and a
single-package mount silently drops every row but the first.

| Surface | Before | After |
| :--- | :--- | :--- |
| providers | 3/4 (`opencode-http-agent` absent) | 4/4 |
| tools | 4/6 (`subagent_opencode`, `subagent_antigravity` absent) | 6/6 |
| commands | 6/6 | 6/6 |
| deepinfra probe | 0 models (`INVALID_PROBE: probe needs a baseUrl`) | 178 models |

**Design as implemented.**

- `preset.entries: [{ row, specifier?, config? }]`. `row` is the loader/settings namespace of the
  row being mounted; `specifier` defaults to `preset.package`; `config` is static NON-SECRET config
  for the host-shared rows the router owns.
- Entry sets: `antigravity` = `dsh-antigravity` + `tool-subagent-antigravity`;
  `opencode` = `dsh-opencode-v2` + `dsh-opencode-v2-http` + `tool-subagent-opencode`;
  `deepinfra` = `dsh-deepinfra`. `preset.package`/`preset.row` stay for back-compat, and a preset
  without `entries` still mounts its own package as one row.
- **Mount config lookup is keyed by `entry.row`**, because the two OpenCode rows carry different
  live configs. Merge rule: `entry.config` (declared, non-secret) is the base and
  `vendorConfig[row]` (operator/live) is applied on top, shallowly, with `undefined` values skipped
  so a live `undefined` cannot erase a declared default. The probe layer keeps scoping by
  `preset.id` — a different question — so both key sets coexist in one object.
- **Resolution is an ordered anchor chain**: profile → `installAnchor` → extras → `execPath`
  fallback. `@nolit/*` resolves through the profile; `@deepseek-ai/dsh-tool-subagent` resolves
  through the install anchor. `profileContext` supplies both when the caller passes neither.

**Measured resolution (2026-11-07).**

| Specifier | Anchor that resolved it | Path |
| :--- | :--- | :--- |
| `@nolit/dsh-antigravity` | profile | `<profile>/node_modules/@nolit/dsh-antigravity/lib/index.js` |
| `@nolit/dsh-opencode-v2/http` | profile | `…/dsh-opencode-v2/lib/http.js` |
| `@nolit/dsh-deepinfra` | profile | `…/dsh-deepinfra/lib/index.js` |
| `@deepseek-ai/dsh-tool-subagent` | installAnchor | `/home/minami/.local/nodejs/lib/node_modules/@deepseek-ai/dsh/node_modules/@deepseek-ai/dsh-tool-subagent/lib/index.js` |

**Measured hazard — why the install anchor is explicit.** DSH patches `Module._resolveFilename`
during boot (`dsh-app-boot` `profile-resolution-bootstrap`) to route `@deepseek-ai/*` into the
install tree. The SAME `createRequire(<profile>/package.json).resolve('@deepseek-ai/dsh-tool-subagent')`
call **fails before a boot and succeeds after one**, in the same process. A resolver that trusted
the profile for host packages would work only by accident and only after the first boot.

**Bundle row.** `package.json` gains `dsh.manifestVersion: 1` + `dsh.bundle.patch`, and
`cordis.patch.yml` inserts row `dsh-custom-router` with specifier `@nolit/dsh-custom-router/plugin`:
the export map has **no `"."`** entry, so the bare package name fails with
`ERR_PACKAGE_PATH_NOT_EXPORTED` while the `/plugin` subpath resolves. Measured both ways. The row
carries switches only (`strict: true`, all presets `false`); no vendor secrets. Verified as a real
loader row: booting an isolated profile with it in `dsh.profile.bundles` reports
`seam present: true` and no router warning. Without the `dsh.bundle` field the host skips the
package with `declares no dsh.bundle in its package.json` (measured), which is why the manifest is
part of this change.

**Probe `baseUrl` default.** A probe layer declares only a path (`endpoint: '/models'`); its host
lives once in `preset.endpoint.baseUrl`. The seam now defaults `baseUrl` (and `apiKey` from the
preset-scoped `vendorConfig`) so the generic executor receives it. DeepInfra keeps `shape: 'openai'`
— its `/models` IS a standard OpenAI listing, and `shape: 'vendor'` is reserved for provider-specific
RPCs the router must not parse (§2.3.4); routing it to the vendor bridge would have hidden the
missing-`baseUrl` bug instead of fixing it.

**Measured:** 192/192 tests (23 new across `presets`, `index`, `vendor-modules`).
`node /tmp/lead-verify-mount.mjs` → `PARITY: PASS` (exit 0); `npm run verify:presets` OK;
`node scripts/check-dsh-isolation.mjs` exit 0.

## 0.0.1-rc.2 — 2026-11-07 (preset declarations as data, S4)

**Scope:** `lib/presets.js` — the M13–M16 surface contract as frozen data plus a pure validator.
The module **registers nothing** (no `apply`, no `ctx`, no imports): a future mounted surface (M10)
reads the declarations instead of hard-coding per-vendor knowledge.

**Measured declarations (from the vendor tracks at HEAD):** `antigravity` (Google SSE wire, route
`own`, async `agy_worker` + sync `agy_cli`, `subagent_antigravity`, `/agy`), `opencode`
(`openai-completions`, route `own` pending the PiAiAdapter migration, sync `cli_worker` +
`/ocode`/`/worker`, `subagent_opencode`), `deepinfra` (`openai-completions`, model route only,
plan `unavailable`).

**Validator rules:** a `pi-ai` route requires a protocol the host implements
(`openai-completions` / `openai-responses` / `anthropic-messages`); subagent rows must use the host's
shared `@deepseek-ai/dsh-tool-subagent` row and a `subagent_<provider>` tool name; a CLI tool must be
listed in `surfaces.tools` and differ from the batch tool; a skill must carry `modelInvocable` and
`userInvocable`; tool/command names are unique across presets (the host registries are global).

**Measured:** 80/80 tests (9 new in `test/presets.test.mjs`). A preset-only isolated profile (the
three vendor bundles removed, `@nolit/dsh-custom-router` still linked) boots with `deepseek-account`
as the only provider and no activation failure.

## Preset drift gate — 2026-11-07 (same `rc.2`)

Owner decision 2b: presets are verified against the **runtime**, not copied by hand. Added:

- `presets[].switches` — the master/surface switches each preset owns, with the module (`index` or
  `http`) that declares them;
- `presets[].package` / `presets[].row` — identity used by the gate;
- `scripts/verify-presets.mjs` (`npm run verify:presets`) — boots an isolated `DSH_HOME`, reads
  `llm.listProviders()`, `tools.definitions()` and `commands.list()`, imports each vendor `Config.dict`
  and diffs everything. Exit 1 on drift, 2 when the harness cannot run.

Negative test: adding `/worker` to the opencode preset made the gate report
`opencode: command "/worker" is declared but not registered` and exit 1. Clean run: OK.

## Preset application body — 2026-11-07 (same `rc.2`)

`lib/index.js` (exported as `@nolit/dsh-custom-router/plugin`) is the first runtime body. It applies
presets the only way that keeps R0: it mounts each active preset's **own package plugin** as a child
with `ctx.plugin` and disposes exactly that child on deactivation. It never calls
`ctx.llm.registerAdapter` and mounts nothing unless a preset is explicitly enabled
(`presets: { <id>: true }`).

- `planApplications(config)` — pure planning: validates the declarations, rejects unknown ids,
  resolves the module (with a `packages` override) and the per-preset vendor config.
- `apply(ctx, config)` — mounts the plan, isolates per-preset failures, returns the disposer.
- `strict` (default true) throws before mounting when a declaration is invalid.

Measured: 9 new tests (plan, override, unknown id, mount/dispose, strict rejection, failure
isolation, and a source scan proving the body owns no adapter call). No bundle row yet: the package
still ships no `cordis.patch.yml`, so linked profiles keep mounting the vendor plugins directly.

## Preset common data model — 2026-11-07 (same `rc.2`)

Owner requirement: a new provider must fill one standard shape that answers **delivery** (JSON
declaration vs NPM package), **authentication** (API key vs web auth vs local socket) and
**endpoint** (protocol + transport), not a package name tag.

Added `lib/preset-schema.js` (`@nolit/dsh-custom-router/preset-schema`):

- `kind`: `package` (code-backed) | `declaration` (JSON only, no package, static catalog);
- `auth`: `api-key` | `web-auth` | `local-socket` | `none`, with ordered
  `secret-field` / `env` / `credential-ref` / `token-file` / `daemon-endpoint` sources;
- `endpoint`: `http` | `local-http` | `daemon`, protocol (`openai-completions`,
  `openai-responses`, `anthropic-messages`, `google-generative-sse`), route (`pi-ai` | `own`),
  transport (`sse`, `websocket`, `websocket-cached`, `auto`), base URL, chat path;
- measured instances: antigravity (web-auth, Google SSE), opencode (web-auth/daemon, OpenAI),
  deepinfra (api-key, OpenAI); plus `DECLARATION_EXAMPLE` for a loopback JSON preset;
- `PRESET_JSON_SCHEMA` mirrors the validator for external tools.

Measured: 96/96 tests (5 new data-model cases), drift gate still OK.

## Catalog & price 3-layer synchronization — 2026-11-07 (same `rc.2`)

Owner decision: catalog and price sync are three ordered layers, merged with 3 > 2 > 1 precedence.

- **`catalog.layers`** in `preset-schema`: `upstream` (pi-ai static snapshot, default fallback),
  `probe` (API/web-auth endpoint list), `override` (preset/local models and prices). Validator enforces
  order, uniqueness, probe endpoint shape, and partial price overlays.
- **`lib/catalog.js`** (`@nolit/dsh-custom-router/catalog`): `mergeCatalog()` merges field by field,
  keeps provenance (`source`, `layers`), lets a later layer create a model, and supports pricing-only
  patches (single rate fields; `tiers` replaces when supplied).
- **`lib/cost.js`** (`@nolit/dsh-custom-router/cost`): mirrors upstream pi-ai `calculateCost()` —
  per-1M rates, tier selection by input+cache tokens, 1h cache write at 2× input — because the DSH
  wrapper drops `usage.cost` (measured 2026-11-07).

Measured upstream coverage: 42 providers / 1,712 models / **1,712 priced** / 261 tiered, snapshot
generated 2026-11-02. Tests: 108/108 (12 new catalog/cost cases), drift gate unchanged and green.

## Routing and probe executor — 2026-11-07 (same `rc.2`)

- **`lib/routing.js`** (`@nolit/dsh-custom-router/routing`): `resolvePreset()` / `resolveRoute()` —
  explicit preset → provider id → `modelPrefixes`; an ambiguous prefix is refused, never guessed.
  Presets gained measured `modelPrefixes` (antigravity, opencode-http-agent/opencode-go/opencode,
  deepinfra, local-hub).
- **`lib/probe.js`** (`@nolit/dsh-custom-router/probe`): layer-2 executor with injected fetch.
  `openai` and `anthropic` listings normalize into catalog entries (Bearer vs `x-api-key` +
  `anthropic-version`, one Anthropic page); `shape: 'vendor'` endpoints (`/api/model`,
  `fetchAvailableModels`) are refused with `VENDOR_OWNED` because the owning plugin parses them.
  `probePreset()` skips vendor layers and returns `{models, measuredAt, errors}`.

Measured: 124/124 tests (16 new routing/probe cases); drift gate green.

## Plan (subscription/flat) layer — 2026-11-07 (same `rc.2`)

`usage.billing.mode` + `lib/plan.js` (`@nolit/dsh-custom-router/plan`):

- `subscription` (antigravity), `flat` (opencode-v2), `pay-per-token` (deepinfra), `none` (loopback);
- `judgePlan()` builds the §1.4 `PlanVerdict` from L1 declared / L2 account / L3 probe, with
  `throttled`, `mismatch`, `match`, `unknown` and `no-plan-service`;
- `billingOutcome()` returns `{billed, covered, confidence, reason}`: plan-covered → `0`, per-token →
  the catalog estimate, and **`unknown` → `null`, never a fabricated zero**.

Measured: 136/136 tests (12 new plan cases); drift gate green.

## Usage binding, quota display, vendor-probe connection — 2026-11-07 (same `rc.2`)

- **Vendor probe connection** (`probeVendor`): explicit `vendorProbes[preset.id]` → host
  `ctx.llm.discoverModels(namespace)` → `VENDOR_OWNED`. Measured: the three vendor plugins register
  **no** discovery (0 hits) and keep it in `lib/provider.js`; OpenCode's namespace is
  `dsh-opencode-v2-http`.
- **Usage binding** (`lib/usage.js`, `@nolit/dsh-custom-router/usage`): `bindUsage()` returns
  `{usage, cost, billing, readings}` — token buckets, catalog cost, plan billing outcome, and
  `UsageReading[]`.
- **Quota display** (`windowReadings`): provider windows (`rolling`/`7d`/`30d` aliased) become
  `percent-consumed` / `fraction-remaining` readings with `limited`, `resetsAt`, locale `en`/`ko`.
- Invariant preserved: an unmeasurable reading is `confidence: 'unavailable'` with a reason; an
  `unknown` plan appends that gap instead of claiming `$0`.

Measured: 147/147 tests (11 new usage/vendor cases); drift gate green.

## Antigravity vendor-probe bridge — 2026-11-07 (same `rc.2`)

`lib/bridges/antigravity.js` (`@nolit/dsh-custom-router/bridges/antigravity`) connects antigravity to
layer 2 without touching the vendor:

- reuses `./auth` `TokenProvider`, `./settings` `resolveEndpoint`, `./catalog` `parseCatalog`;
- keeps the **digital fingerprint** (measured `antigravity/cli/…` UA; without it the endpoint answers
  403 and `loadCodeAssist` reports `UNSUPPORTED_CLIENT`);
- flexible slots in `vendorConfig[presetId]`: `tokenPath`, `refreshToken`, `userAgent`, `extraHeaders`,
  `project`, `baseUrl`, `controlBaseUrl` — overrides win, nothing is invented;
- `probeVendor` now scopes `vendorConfig` per preset, so one profile can carry several providers.

Measured: 153/153 tests (6 bridge cases); drift gate green.

## Three vendor bridges, module resolution, apply seam — 2026-11-07 (same `rc.2`)

- **`opencode` bridge** (`lib/bridges/opencode.js`): daemon `GET /api/model` with
  `Basic opencode:<password>`; reuses `./http` `authHeader`/`serviceStateCandidates` and
  `lib/shared.js` `modelsFromApiPayload` (file URL — the export map does not expose it).
  Slots: `baseUrl`, `password`, `serviceFile`, `extraHeaders`.
- **`deepinfra` bridge** (`lib/bridges/deepinfra.js`): thin wrapper over `probeCatalog` with
  `apiKey`/`DEEPINFRA_API_KEY` and `baseUrl`/`extraHeaders` slots.
- **Registry** (`lib/bridges/index.js`): `createVendorBridges({modules})` → three handlers.
- **Module resolution** (`lib/vendor-modules.js`): `loadVendorModules({profileDir})` resolves every
  vendor entry through the profile `package.json` and returns the module set plus preset package URLs.
- **Apply seam:** `apply()` loads modules/bridges, resolves preset packages for `ctx.plugin`, and
  provides `customRouter` `{presets, vendorProbes, route, probe, merge}`.

Measured: 169/169 tests (16 new); drift gate green.

## 0.0.1-rc.1 — 2026-11-07 (shared downstream stream pipe specified)

**Owner instruction:** do not standardise only on paper and leave three implementations; extract
the DSH-facing parser and stream pipe into **one common module** with overridable hooks so a
provider-specific API or web-auth exception can still be absorbed.

**Before (measured, 3 tracks at HEAD):** the downstream half was implemented three times and had
already drifted.

| Concern | Drift measured |
| :--- | :--- |
| finish table | `content_filter`/`SAFETY`-class → `stop` in antigravity and deepinfra, `error` in opencode-v2 |
| `totalTokens` | three different rules; `usageFromOpenAi` publishes a subset, `addUsage` sums a different set in the same file |
| `LlmFailure.code` | missing in antigravity's `SAFETY` branch |
| empty completion | throw (AG) vs in-band `finish{kind:'error'}` (DI) |
| cut preservation | present only in opencode-v2 |
| block index | fixed constants (OC) vs first-seen (AG, DI) |
| SSE malformed record | skip (AG), fail (DI), null (OC) |

**After (specification, no code yet):**
`docs/SHARED-STREAM-PIPE-SPEC.md` defines one module — `readSseEvents`, `normalizeStream`,
`fail`, `emptyCompletion`, `cutCompletion` — owned by this track and exported as
`@nolit/dsh-custom-router/stream`. Providers differ only through a stream descriptor and hooks
(`readEvent` mandatory; `classifyText`, `mapFinish`, `usageFrom`, `closeBlock`, `onMalformed`,
`onCut`, `onEmpty` optional). The pipe registers no adapter and holds no retry loop, so R0
(no second routing table) still holds.

**Rollout corrected (same day, owner instruction):** the first draft put `dsh-opencode-v2` as
the P2 migration target. That is withdrawn. The order is now **P1 core (no consumer) → P2
`dsh-antigravity` (primary testbed: low live use, and the only measured web-auth upper
pipeline) → P3 `dsh-deepinfra` (pure API parity) → P4 `dsh-opencode-v2` (last, highest traffic,
owns the optional `classifyText` hook)**. The rationale is recorded in
`docs/SHARED-STREAM-PIPE-SPEC.md` §1 and §7. No migration has started.

**Documents corrected, not just appended:**
`CUSTOM-ROUTER-ARCHITECTURE.md` §3.1 and M3, `CUSTOM-ROUTER-PROTOCOL-STANDARD.md` §2.1/§5/§7,
`CUSTOM-ROUTER-SERVICE-SPEC.md` B2, `WEB-AUTH-PIPELINE-ENGINE.md` verdict rows,
`README-OWNERSHIP.md`, `PLAN-AND-USAGE-SPEC.md` coverage matrix,
`dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md` §4.1 (recipe parser = `classifyText` hook).

**Known deltas registered (not fixed):** D1–D8 in `CUSTOM-ROUTER-PROTOCOL-STANDARD.md` §7.

**Verification surface built (same day, before P3):** the owner asked whether this package has a
callable CLI. Measured answer: **no `bin`, no mount** — it is a library, and its only executables
were `npm test` and `npm run check`. A unit suite cannot prove the property that matters for a
shared component (that it dispatches with **none of the vendor plugins loadable**), so
`scripts/verify-stream.mjs` was added with `npm run verify:stream` /
`verify:stream:json` / `verify` (check + test + verifier). Measured: **7/7 dispatch cases,
0 vendor module loads**, and a negative control confirms the resolver really blocks a vendor
import. The same `npm run verify` was then run from a **copied sandbox with no sibling tracks and
no `node_modules`** and still passed 71 tests + 7/7 dispatch, which is the standalone proof.
`dsh-antigravity` was exercised with its profile switches off (`enabled`, `modelServing`,
`cliWorker`, `usagePill` all `false`, verified in the composed `--dump-config`); the pipe still
produced a correct terminal `finish` in that state. No `bin`, no mount, no version change.

**P2 completed (same day):** `@nolit/dsh-antigravity` is the first consumer of
`@nolit/dsh-custom-router/stream`. Its local SSE reader, usage writer, finish table and block
emitter were replaced by the shared pipe; the package now contributes only
`lib/stream-contract.js` (descriptor + `readEvent` + `usageFrom` projection). Measured:
antigravity **144/144** (was 118), shared core 71/71, deepinfra and opencode-v2 still import
nothing from the pipe (158 + 7 skip, 453). The shared reader gained `emitDone` and `Response`
acceptance to keep the published legacy contract, and `normalizeStream` gained an `onUsage`
sink so a ledger records usage before the host stops iterating. D3/D4/D6/D8 closed for this
track. D2 was **withdrawn as a defect**: the provider 403s without its CLI `user-agent`, so the
host attribution string and the provider identity genuinely collide — recorded as a declared
conflict, not a missing call.

**P1 implemented (same day, owner-approved sequence):** `lib/stream/` now exists with
`normalizeStream`, `readSseEvents`, `usageFrom`/`usageFromProjection`, `finishReasonFor`, and the
failure factories, exported as `@nolit/dsh-custom-router/stream`. Measured: **71 tests pass**
(14 SSE framing, 12 usage, 11 finish/failure, 20 pipeline, 14 pre-existing bridge tests);
`npm run check` passes over 12 files; **zero vendor consumers** (`grep` finds no import in any
`dsh-*` track); the three vendor suites are unchanged — antigravity 118, deepinfra 158 + 7 skip,
opencode-v2 453. The module imports no `dsh-llm`, registers no adapter, and contains no retry
loop, so R0 holds. P2 (`dsh-antigravity`) is next and is not started.

**Verification:** `npm run docs:check` (root) OK — 9 subproject indexes current, 1,332 links
checked. No code, profile, service, or version changed.

## 0.0.1-rc.1 — 2026-11-07 (OpenCodex bridge becomes runtime code)

**Owner instruction:** the OpenCodex bridge must not be duplicated across vendor plugins, and
the Custom Router track must document it so a future service does not re-derive it.

**Before (measured):** `dsh-opencode-v2`, `dsh-antigravity` and `dsh-deepinfra` each carried a
private `lib/opencodex-models.js`. Three consequences were measured:

1. each copy read its own server URL and key id, so the bridge had no single configuration;
2. the shared DSH client key was scoped per provider, so **the last plugin to save overwrote
   the other providers' scope** — a real silent revocation;
3. the same id-projection bugs had to be fixed three times.

**After:** `lib/` in this track is the only implementation.

| Module | Responsibility |
| :--- | :--- |
| `config.js` | `OPENCODEX_BRIDGE_URL`, `OPENCODEX_BRIDGE_KEY_ID`, management token |
| `opencodex-client.js` | `GET/PUT /api/selected-models`, `PATCH /api/keys` |
| `selection-projector.js` | DSH route → OpenCodex id, incl. Antigravity family aliases |
| `scope-aggregator.js` | union across providers, and the refusal to guess |
| `selection-sync.js` | ordering, re-read, failure propagation |
| `vendor-bridge.js` | the only import vendor plugins use |

Vendor plugins keep a one-function seam and their own checklist UI. The three vendor
`opencodexModelsUrl` / `opencodexClientKeyId` settings were removed: a per-vendor copy of shared
state is the defect, not the fix.

**Measured behavior split recorded in `docs/OPENCODEX-BRIDGE.md`:** `selectedModels` and
`disabledModels` are catalog visibility only; a direct call to an unselected, blocklisted model
still returned HTTP 200. Authorization exists only on a configured key, and only on a
non-loopback bind. The bridge therefore writes both, and skips the key write with a reason when
any provider is unrestricted rather than silently denying it.

**Measured (2026-11-07):**

| Check | Result |
| :--- | :--- |
| this track `npm test` | 14/14 pass |
| `dsh-opencode-v2` | 453/453 pass |
| `dsh-deepinfra` | 158 pass, 7 skip, 0 fail |
| `dsh-antigravity` | 118/118 pass |
| isolated real DSH boot with the bridge linked | **0** `did not activate` |
| live DSH service | not restarted; profile not edited |

**Added:** `scripts/link-custom-router.mjs` at the workspace root. A linked plugin is loaded
from its real path and DSH resolves a bare import through the profile's `node_modules` only for
declared peers, so the peer declaration alone is not enough; the script writes only the
gitignored workspace-root link.

**Not done:** no Settings-Models (Custom) surface, no client half, no real mount of that surface,
no scoped key issued, and no `rc#` bump beyond the existing `0.0.1-rc.1`.

## 0.0.1-rc.1 — 2026-11-06 (specification only)

**Before (measured):** four Custom Router specs sat in the shared `docs/` tree
(`CUSTOM-ROUTER-SERVICE-SPEC.md`, `CUSTOM-ROUTER-PROTOCOL-STANDARD.md`,
`CUSTOM-ROUTER-PRESET-SURFACE.md`, `CUSTOM-ROUTER-ARCHITECTURE.md`), indexed by
`npm run docs:index` as public documents (91→92 docs). The owner pointed out that this
pollutes the common tree and that the project belongs in its own track. Plugin versions were
also briefly written with the document version scheme; the owner separated the two:
**documents use `rc.#` for history, plugins start at `0.0.1-rc.1`**.

**Changed:** created `dsh-custom-router/` with `package.json`
(`@nolit/dsh-custom-router@0.0.1-rc.1`), `README.md`, this CHANGELOG, and `docs/`.
Moved the four specs into `dsh-custom-router/docs/` verbatim (doc skeleton versions corrected
from `0.0.1-rc1` to `0.0.1-rc.1`). Added three spec sections the owner named as missing:
subscription-plan detection logic, usage/quota normalisation, and standard-vs-custom coverage.

**Measured evidence carried into the specs:** DSH `0.2.2-rc.1`, `@deepseek-ai/dsh-llm@0.2.2-rc.1`;
`registerAdapter` all-or-nothing `DUPLICATE_ADAPTER`; real `LlmRuntime` S1–S8 scenarios;
isolated `DSH_HOME` A/B boots (81 entries, 0 activation failures, 0 page errors);
pi-ai `NO_COST` / `emptyPiUsage()` / generated `PROVIDER_DATA`; DeepInfra
`promotionOf()` 8/91; OpenCode `GET /api/experimental/usage/limits` real response
`go.rolling=2%, weekly=8%, monthly=29%, limited:false`; `GET /api/credential` 3 entries
(`Personal` oauth active, 2 keys inactive); Antigravity `retrieveUserQuotaSummary`;
DeepInfra `/v1/me` identity-only and `/v1/request-costs` 404 for this account.

**After (measured):** `npm run docs:check` reports the shared tree back to 88 docs;
`node scripts/check-plugin-history.mjs` reports this track OK; `git status` shows only the
new track plus the two regenerated shared indexes. No runtime code, live profile, service
restart, or existing plugin version was changed. No `rc#` was advanced — this is the first
session for this track and the owner's instruction is what created it.

**Same-session addition (no `rc#` bump):** `docs/PRESET-SCHEMA-AND-EXTENSION.md` — the
per-service preset descriptor/schema (`ServicePreset`, `ConfigFieldSpec`), schema conformance
rules S1–S9, measured extension limits (unlimited tabs/fields/child slots vs the uniqueness /
authority ceiling), and the T0–T7 coverage ceiling for a future service. Measured substrate:
`AgentPreset.Config.plugins = z.array(z.any())`, `settings.section` list kind, `SlotKind` union,
schemastery recursive types, and Config field counts 71 / 33 / 7.

**Same-session addition (no `rc#` bump):** `docs/WEB-AUTH-PIPELINE-ENGINE.md` — answers the
owner's layer question with measured call sites: web auth is minted/refreshed in the **lower**
pipeline (`auth.js:105-162`, `adapter.js:255-260` 401-retry, `http.js:1806`), while the upper
pipeline only constructs the provider (`index.js:374`) and reports readiness. Verdict: upper
pipeline, tool standardisation (`ToolDefinition`), and router engine (`LlmRuntime`) are **already
standard**; lower pipeline and model serving share the `LlmAdapter`/`StreamChunk` **contract**
but are implemented per service; plan/usage/promotion alone stay in the custom surface. Rule R0:
no second routing table.

**Same-session addition (no `rc#` bump):** `docs/RETRY-POLICY.md` — owner 2026-11-06
instruction: **no automatic model fallback**, harden retry only. Normative classification
(T1-T5 transport/socket/502-503-504 retryable; P1-P5 401/403/quota/402/400/404/422 terminal),
bounded 2-3 attempts at 500ms->1000->2000ms exponential jitter, clean terminal cause, **no
circuit breaker**. Recorded three measured deltas against current code: 429 and 451/500 are
currently retried, and backoff is 1000ms uncapped. Withdrew the PLAN-AND-USAGE U5 "offers another
service" wording. Spec only; no code/config/version changed.

**Not done:** no `settings.section` row, no client half, no real mount of the new surface,
no real generation turn. Those require the owner's implementation approval.
