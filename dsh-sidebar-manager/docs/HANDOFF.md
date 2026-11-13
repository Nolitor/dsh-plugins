# Sidebar Manager — Handoff

<!-- skeleton:
version: 1.1
kind: report
status: active
updated: 2026-11-13
summary: Stage-by-stage handoff for @nolit/dsh-sidebar-manager at 0.0.1-rc.2 — the token-stylesheet migration, the drift gate that must run before any version-up, the version/CHANGELOG mismatch, and the open UI audit items from the 2026-11-11 /ui review (hairline tokens, derived font steps, CJK wrapping, row action order), plus the deferred toast elevated-surface decision (D1).
-->

> History lives in `CHANGELOG.md`, which is **not listed in this package's `files[]`** (see S1).
> Written as inline code, not a link, because a relative link would not resolve inside the published
> tarball. This file is the **forward** view.

## 1. State

| Item | Measured value |
| :--- | :--- |
| Package | `@nolit/dsh-sidebar-manager@0.0.1-rc.2` |
| Last code commit | `86cfb66` 2026-11-08 — DSH token UI applied to the workspace manager |
| Tests | `npm test` → **167/167 pass** (re-measured 2026-11-13) |
| Publishable | yes — tarball 50 files, prerelease needs `--tag` |
| Drift audit | `node scripts/audit-installed-vs-packaged.mjs` → `LIVE_EQUALS_WORKSPACE_WITH_LOCAL_UTM_ARTIFACT`, `utmDriftDetected: true` |

## 2. Done

- Panel and sidebar rows moved from inline style objects (73 entries) to one scoped stylesheet
  (86 rules), consuming `--dsh-content-font-size` and its derived tokens.
- Three-tab manager panel (Workspaces / Groups / Diagnostics), virtual grouping, HQ promotion,
  batched placement transactions, advisory UTM policy (never a hard write-block).

## 3. Stages

### S1 — version/CHANGELOG state

| Surface | Measured |
| :--- | :--- |
| `package.json` version | `0.0.1-rc.2` (re-measured 2026-11-13; was `0.0.1-rc.1` since `bfc691c` 2026-11-06) |
| `docs/` in `package.json#files` | yes (listed) |
| `CHANGELOG.md` in `package.json#files` | **absent** |

Re-measured 2026-11-13: the version **has since been bumped to `0.0.1-rc.2`**, so the original
mismatch is closed — but `CHANGELOG.md` is **still absent** from `package.json#files`, so the bumped
release still ships without its history. Only the second half of the 11-08 finding remains open.

Measured on 2026-11-08: `npm pack` on this track produces a **51-file** tarball and
`tar -tzf … | grep CHANGELOG` returns **nothing** — the file is genuinely absent from the artifact.
This is the F-55 class (rule satisfied in the working tree, violated in the shipped package).

**Note:** `npm run check:publish` does **not** catch this; it passes today. The gate that failed
earlier in this session was the tarball **link** check, caused by a relative link to
`../CHANGELOG.md` inside this document, and it was cleared by writing the path as inline code. Do
not read a green `check:publish` as proof that `files[]` is complete.

Owner decision needed for the `rc`; the `files[]` fix is a one-line change this track can make
when told to. Reported, not fixed.

### S2 — drift gate before any version-up

The live tree carries local UTM artifacts (`utmDriftDetected: true`). Before any replacement or
version bump: re-run the audit, record the tree SHA-256, and test the current behaviour in an
isolated `DSH_HOME` first.

### S3 — residual inline `styles` map

The `styles` map still exists in `lib/client.js`; entries are now class names instead of style
objects. Not a defect — recorded so a future reader does not mistake it for leftover inline styling.

## 4. Verification

```bash
cd dsh-sidebar-manager && npm test
node scripts/audit-installed-vs-packaged.mjs
```

## 5. Next work — UI audit findings (2026-11-11)

Source read: `lib/client.js` only (no browser/CDP run, no token census). Findings are
source-level and each cites the rule it came from. **Nothing here is fixed yet.**

The audit that produced this list was run against the `/ui` skill *before* its Layer 2 rule was
corrected. That rule used to say every colour, border, radius and shadow is `--dsh-*`; the host
actually splits them (`--dsw-alias-*` for colour/border/radius/shadow/focus ring, `--dsh-*` for
layout and content metrics). **This track already follows the correct split** — the mismatch was
in the rule, not in the code (`skills/ui` commit `1a8f87b`, ledger row `host-drift`). Do not
"fix" a `--dsw-alias-*` reference into `--dsh-*` on the strength of an older copy of the rule.

### 5.1 Layer 2 — token discipline

| # | Item | Where | Measured |
| :-- | :--- | :--- | :--- |
| A1 | Literal hairline border instead of `--dsh-hairline-width` | `.smRow` 579, `.smDialog` 646, `.smField` 624, `.smGate` 630, `.smMenuSeparator` | **11** occurrences of `.5px` in the sheet |
| A2 | Font steps derived by subtracting px from the secondary token | `.smGroupKind` 609 (`-3px`), `.smGroupPin` 610 (`-2px`), `.smGroupBadge` 614 (`-3px`), `.smGroupHint` 616, `.smPath` 617, `.smInlineHint` 583, `.smMeta` 637, `.smGroupNotice` 604 | **8** occurrences; produces a third and fourth step the host scale does not define, and a user font-size change moves them non-linearly |
| A3 | No `line-height` of its own, so a small label inherits the row's `calc(22px + delta)` | `.smGroupKind` 609, `.smGroupPin` 610, `.smGroupBadge` 614 | inherit from `.smGroupItem` |
| A4 | Inline `style` colour bypasses the token layer | `groupAccent()` 552–556 → `style: {color: …}` at 1104 | a user-defined `group.color` is painted with no contrast check; it is the only route into the surface that skips `--dsw-alias-*` |
| A5 | Hierarchy expressed by opacity instead of a label token | `.smMuted` 638 (`opacity:.75`) — applied on top of already-tertiary text | AA risk; `--dsw-alias-label-*` already has the step |

### 5.2 Layer 1 — layout rhythm

| # | Item | Where | Measured |
| :-- | :--- | :--- | :--- |
| B1 | One repeated interval for every level of the list | `.smRows` 578 `gap:8px`, `.smGroupList` 605 `gap:8px`, `.smGroupModules` 611 `gap:2px`, `.smRow` 579 `padding:12px 14px` | rows and group cards are both `8px` apart with identical padding, so proximity does no grouping — the container is compensating |
| B2 | Button alignment convention differs by surface, and the control order is wrong | `.smRowActions` 581 (`flex:0 0 auto`, follows the name) vs `.smFooter` 640 (`justify-content:flex-end`); `@media (max-width:640px)` 663 turns the row actions full-width | the same cancel/confirm pair sits on a different axis in a row and in a dialog; and in a row the order is name → **actions** → `includeFolder` checkbox, so the control that changes the outcome sits *below* the actions that commit it |

### 5.3 Layer 3 — Korean CJK

| # | Item | Where | Measured |
| :-- | :--- | :--- | :--- |
| C1 | `word-break: keep-all` appears nowhere in the sheet | whole stylesheet | **0** occurrences; `overflow-wrap` exists only on `.smPath` 617, so `워크스페이스 관리자`, `작업 공간` break mid-word in narrow columns |
| C2 | `text-transform: uppercase` + `letter-spacing` on a label that renders Hangul | `.smGroupKind` 609 | the values are `시스템` / `프로젝트` / `제안` / `미분류`; uppercase is a no-op on Hangul but the positive letter-spacing is not harmless |

### 5.4 Suggested order

1. **A1 + A2/A3** — tokenise hairline and collapse the derived steps onto the two host steps.
   Mechanical, low risk, and `test/typography-contract.test.mjs` already has the harness to pin it.
2. **C1 + C2** — add `word-break: keep-all` to the text rules and drop `uppercase`/`letter-spacing`
   from `.smGroupKind`. Two lines, visible on every Korean surface.
3. **B2** — pick one action axis and move the `includeFolder` checkbox above the actions.
4. **B1** — widen the interval between group cards, keep the row interval tight.
5. **A4 + A5** — validate `group.color` against the label tokens or map it to one; replace
   `opacity:.75` with a label token.

### 5.5 Open — elevated-surface spec on the toast (deferred, owner-scoped)

| # | Item | Where | Measured |
| :-- | :--- | :--- | :--- |
| D1 | Toast pairs a hairline border with a shadow; `docs/web-styling.md` requires elevated surfaces to set `border: 0` and take `box-shadow: var(--dsw-elevation-panel)` (the 0.5px stroke is the shadow's first layer). Decide whether `.smNotice` should move to `border:0` + `--dsw-elevation-panel`, or stay a bordered non-elevated notice. | `.smNotice` `lib/client.js` 664 | measured 2026-11-11: `border:var(--dsh-hairline-width,.5px) solid var(--dsw-alias-settings-card-stroke)` **and** `box-shadow:var(--dsw-shadow-lv2)` in one rule — exactly the pairing the spec rejects. The legacy `--dsw-shadow-lv2` is not from the elevation family (`--dsw-elevation-panel` / `-prominent` / `-soft` all exist and are unused here). |

Owner disposition (2026-11-11): this toast is `dsh-sidebar-manager`'s own action-feedback surface,
so it is this plugin's isolated debt — not a shared-host concern. Recorded here so it is not lost
with a chat scrollback; **no code change has been made for it.**

Each of these needs a `test/*.test.mjs` case in the same change, per the existing contract-test
pattern (the 2026-11-03 typography migration set it).
