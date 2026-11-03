# Phase 7 — Panel Surface Refactor: Workspaces / Groups / Diagnostics

<!-- skeleton:
version: 1.0
kind: spec
status: active
updated: 2026-11-03
summary: The manager panel is three tabs (Workspaces / Groups / Diagnostics) following the native DSH settings tab idiom; records what moved where for the Core-02 UTM harness.
-->

> Status: implemented · 2026-11-03 · Verified in a real browser against DSH `0.2.2-alpha.3`
> Supersedes the single-page layout described in [Phase 4](PHASE4-VIRTUAL-GROUPING.md) and
> [Phase 6](PHASE6-ADVISORY-POLICY.md) as *presentation only* — no schema, route or policy change.

## 1. Why

The panel had grown into one page carrying four unrelated concerns: the workspace list, the
virtual group tree, and two maintenance blocks (HQ bootstrap, project promotion) plus advisory
observations and an orphan scan. Measured defects that motivated the split:

| Measured symptom | Evidence |
|---|---|
| The page printed its own name twice | DOM headings were `H1:워크스페이스 관리자`, `H2:가상 그룹 (HQ)`, `H2:워크스페이스 관리자` |
| Chrome did not follow DSH theming | 6 `color-mix(in srgb, currentColor N%)` + 12 `currentColor` uses |
| Daily work and rare maintenance shared one scroll | HQ bootstrap / promotion / orphan scan sat above the workspace list |

## 2. The surface

| Tab | Owns | Routes |
|---|---|---|
| **워크스페이스 / Workspaces** | workspace list, inline title edit, folder rename gate, archive, archived restore | `workspace/archived`, `workspace/archive`, `workspace/restore`, `workspace/rename-folder` |
| **그룹 / Groups** | virtual group tree, UTM role/policy display, order preview + align | `groups/view`, `workspace/order/preview`, `workspace/order/apply` |
| **진단 / Diagnostics** | advisory observations, HQ bootstrap, promotion gate, orphan scan | `groups/advisory`, `groups/hq/promote`, `promotion/preview`, `promotion/apply`, `groups/orphans` |

## 3. Contract for the Core-02 UTM harness

**Nothing below the UI changed.** The harness does not need to learn a new store, route or policy;
it needs to know which tab renders which capability when it drives the panel.

1. **Store schema unchanged.** `groups.json` is still `GROUPS_UNIT` v3 (`kind`, `role`,
   `policy.access`, `upstream`). A document written before the split still validates — pinned by
   *"the UTM role/policy vocabulary still round-trips through the tabbed UI contract"*.
2. **Routes unchanged.** All eight routes keep their paths and bodies; only their render location
   moved. A harness that POSTs directly is unaffected.
3. **Tab boundaries are pinned by tests.** `groups.hqTitle`, `groups.orphansTitle`,
   `groups.promoteTitle` and `groups.advisoryTitle` must render **only** on Diagnostics;
   `groups.align` must render **only** on Groups; `workspaceManager.listTitle` **only** on
   Workspaces. The check is *"the panel surface is three tabs, and each tab owns one concern"*.
4. **Advisory stays advisory.** The Diagnostics tab is a read-out, not a gate. No tab introduces a
   write block; `policy`/`role` remain descriptive.

## 4. Native parity (measured, not assumed)

The strip copies the native settings tabs (`dsh-client-ui-settings-plugins`) rather than inventing
a style:

| Property | Native | This panel |
|---|---|---|
| `role` | `tablist` / `tab` / `tabpanel` | same |
| roving keyboard | `tabIndex: selected ? 0 : -1` | same |
| keys | ArrowLeft/Right (wrapping), Home, End | same (+ Enter/Space) |
| `aria-controls` / `aria-labelledby` | present | same |
| list gap / border | `22px` / `.5px solid var(--dsw-alias-border-l2)` | measured `22px`, same token |
| tab metrics | `13px`, `7px 1px 9px` | measured identical |
| active underline | 2px, `bottom:-1px`, label-primary | measured `2px`, `rgb(249,250,251)` (dark) |

Browser measurement (isolated profile, DSH `0.2.2-alpha.3`): ArrowRight went
워크스페이스 → 그룹 → 진단, `End` → 진단, `Home` → 워크스페이스, `ArrowLeft` from the first tab
wrapped to 진단. Active tab colour `rgb(249,250,251)`, idle `rgb(173,178,184)`.

## 5. Verification

```bash
npm test                                    # 133 pass + 12/12 Core-02 UTM harness
node test/panel-presentation.test.mjs       # 7 presentation/a11y checks
node test/core02-utm-harness.test.mjs       # 12 checks incl. tab boundaries
```
