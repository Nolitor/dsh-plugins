# Changelog — @nolit/dsh-sidebar-manager

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-11
summary: Engineering history for @nolit/dsh-sidebar-manager. Seeded from git history on 2026-11-04 when the owner made per-plugin history mandatory (docs/RULES.md 6.1); entries after that date follow the same rule — what changed, why, and the measured before/after.
-->

> History lives here (owner instruction 2026-11-04). Boot cards and `AGENTS.md` are narrowed to
> the owner's unfinished asks; they are not a changelog. See [docs/RULES.md](../docs/RULES.md) §6.1.

Current version: `0.0.1-rc.2`

## 0.0.1-rc.2 — hairline token, font steps, CJK wrapping — 2026-11-11

Owner task: the four plugin UI surfaces must stop hardcoding the hairline and the derived font
steps, and must not break Korean words mid-word.

**Measured, from the shipped source (before → after):**

| Fact | Before | After |
| --- | --- | --- |
| `.5px` hairline literals in `lib/client.js` | **12** | **0** |
| `calc(var(--dsh-content-font-size-secondary,13px) - Npx)` derivations | **7** | **0** |
| `text-transform:uppercase` on the group-kind chip | 1 | 0 |
| `letter-spacing:.4px` on the same chip | 1 | 0 |
| `word-break:keep-all` on the root `.smPage` | absent | present |

Every border now reads `var(--dsh-hairline-width,1px) solid var(--dsw-*)`. The token is
published on the document root by `@deepseek-ai/dsh-client-ui-theme`, which resolves it to
`max(1, floor(0.5 * dpr)) / dpr` — the `.5px` literal ignored that correction on every display.
The derived sizes now use `--dsh-content-font-size-secondary` directly, because the host defines
no smaller step: it publishes exactly two live sizes, `--dsh-content-font-size` and
`--dsh-content-font-size-secondary` (measured in the shipped theme client). `test/typography-contract.test.mjs`
gained a two-part regression gate that fails the suite if a `.5px` literal or a missing
`keep-all` returns.

## client UI — DSH design-token stylesheet — 2026-11-08

The panel and the sidebar rows were hand-written as an inline React style object with fixed pixel
sizes. That made three things impossible: the user's font-size preference could not reach the
surface, no control could carry a `:hover` / `:focus-visible` state, and no rule could respond to a
media query. The UI now lives in one scoped stylesheet, in the style of
[`dsh-custom-router`](../dsh-custom-router/lib/client.src.js).

Measured before and after, from the source (`lib/client.js`) and a headless render of every
registered slot:

| Surface | Before | After |
| :--- | :--- | :--- |
| Stylesheet | inline `styles` object, 73 entries | one `<style data-plugin-css="@nolit/dsh-sidebar-manager">` tag, 86 rules, all `.sm*`-scoped |
| Typography | fixed `fontSize: 14 / 13 / 12 / 11 / 10` px | `--dsh-content-font-size` / `--dsh-content-font-size-secondary` / `--dsh-content-font-delta`; page title `calc(20px + var(--dsh-content-font-delta,0px))` |
| Colours | 13 literal hex fallbacks (`#444`, `#555`, `#1f1f1f`, `#161616`, `#ff7b72`, `#4f7cff`, `#fff`, …) | 0 hex; every colour is a `--dsw-*` token |
| Borders | `1px solid var(--dsw-alias-border-l2, #444)` | `.5px solid var(--dsw-alias-border-l2)` |
| Cards | `border-radius: var(--dsw-radius-lg)` + `var(--dsw-alias-bg-layer-1)` | `--dsw-alias-settings-card-fill` / `--dsw-alias-settings-card-stroke` + `var(--dsw-radius-lg)` |
| Page width | `max-width: 820px`, padding `24px 28px 40px` | `max-width: 960px` centred (the manager renders in `main`, not in the 760px settings dialog), responsive below 640px |
| Section title | `fontSize: 14 / fontWeight: 500` | `calc(18px + var(--dsh-content-font-delta,0px))` / `font-weight: 600`, matching the native settings section title |
| Hover / selected | none possible | `@media (hover:hover)` block; `.smGroupItem:hover` and the selected `.smGroupItemHq` both use `--dsw-alias-interactive-bg-hover` |
| Focus ring | none | `--dsw-focus-ring-width` / `--dsw-focus-ring-color` on every interactive control (buttons, icon button, menu rows, More row, tabs, fields, checkboxes, the archived summary) |
| Reduced motion | none | `@media (prefers-reduced-motion:reduce)` removes the surface transitions |
| Dialog | `role="dialog"` with no accessible name | `aria-labelledby` pointing at the title, `tabIndex: -1`, focus moved into the dialog on open |
| Slot registrations | 8 slots | 8 slots, unchanged (`sidebar.panellist.actions`, `main`, the three session row/menu slots, two `shell.overlay` hosts) |
| Tests | 145 passing | **162 passing** |

Measured: `npm test` → 162/162 pass. `npm run docs:check` → up to date. The workspace
`npm run docs:check` (36 workspace docs, 12 pending, 8 subproject indexes, 1396 relative links) and
`npm run check:publish` (3 publishable tracks, `dsh-sidebar-manager` tarball of 50 files) pass.

The `styles` map still exists, but each entry is now a class name instead of a style object, so a
surface is changed in one place (the stylesheet) rather than in the component that renders it. The
inline I18N dictionary and the `locale/*.json` metadata were not touched.


## classifier — linked child sessions get their own label — 2026-11-05

**Owner task (2026-11-05): the cleanup plan must never propose a subagent child session.**
Measured live: of 22 `unregistered` logs, **20 are linked child sessions** (`origin:"subagent"`,
`parentSession:"session-…"`, `delegationDepth:1`); only **2** are true standalone orphans
(`/tmp/te-ms`, `/tmp/te-side-test`, `delegationDepth:0`). Before this change the classifier
reported all 22 as `unregistered` and the "disconnected" count included the children.

| Surface | Before | After |
| :--- | :--- | :--- |
| Labels | `bound`, `unregistered`, `legacy-orphan`, `binding-mismatch`, `unreadable` | adds **`child`** for a linked child session (any of `parentSession`, `origin: "subagent"`, `delegationDepth > 0`), with `reason` naming the parent/origin/depth; existing labels unchanged |
| Entry fields for children | — | `parentSession`, `origin`, `delegationDepth` projected onto the entry |
| Summary | `disconnected` = every non-`bound` log (22) | `disconnected` excludes `bound` **and** `child` (**2**); new `linkedChildren` count (**20**) |
| `byCwd` | every non-`bound` log | excludes children too (they are not disconnected history) |
| Test coverage | empty-home read-only check only | linked child (parent pointer), child via `origin`+`delegationDepth`, `bound`, standalone orphan, malformed log |
| Live dry-run (read-only) | `{"bound":98,"unregistered":22}` | `{"bound":98,"child":20,"unregistered":2}`; cleanup plan proposes only the 2 standalone logs |
| Tests | 142 passing | **145 passing** |

No destructive behavior was added: the classifier stays read-only (`destructive:false`), and the
owner-runnable quarantine plan lives in `scripts/cleanup-orphan-sessions.mjs`
([pending-docs/unpromoted/ORPHAN-SESSION-CLEANUP.md](../pending-docs/unpromoted/ORPHAN-SESSION-CLEANUP.md)).



## 0.0.1-rc.1 — version ladder + English-by-default locale — 2026-11-05

Owner decision (2026-11-05): normalize every `@nolit` track to `0.0.1-rc.N`; this track moved
`0.1.2` → `0.0.1-rc.1`.

| Surface | Before | After |
| :--- | :--- | :--- |
| `package.json.version` | `0.1.2` | `0.0.1-rc.1` |
| `engines.node` | `>=24` | `>=24.9` (DSH 0.2.2-rc.1 minimum) |
| Locale resolution | DSH locale, then `navigator.language` | DSH locale only; English unless the active language is `ko` |
| Tests | 142/142 | 142/142 green |

rc.1 audit: no `tools.resolve`/`executable` read, no Session Projection, no app-boot import;
client inject list unchanged and the bundle already declares `manifestVersion: 1`.

## Seeded history (from git, before this file existed)

The commits below predate this file. They are the record of what shipped, quoted from the
repository history rather than rewritten:

- `50f50d8` harness bootstrap
- `457c5c6` release: v0.1.2 advisory worktree guardrails
- `61c44d8` fix(plugins): native menu typography, grouping and settings panel

## Entries after 2026-11-04

Add newest first. Each entry: what changed, why, and the measured before/after. A change with no
entry here is not complete.
