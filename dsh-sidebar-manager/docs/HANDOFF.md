# Sidebar Manager — Handoff

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-08
summary: Stage-by-stage handoff for @nolit/dsh-sidebar-manager at 0.0.1-rc.1 — the token-stylesheet migration, the drift gate that must run before any version-up, and the version/CHANGELOG mismatch.
-->

> History lives in `CHANGELOG.md`, which is **not listed in this package's `files[]`** (see S1).
> Written as inline code, not a link, because a relative link would not resolve inside the published
> tarball. This file is the **forward** view.

## 1. State

| Item | Measured value |
| :--- | :--- |
| Package | `@nolit/dsh-sidebar-manager@0.0.1-rc.1` |
| Last code commit | `86cfb66` 2026-11-08 — DSH token UI applied to the workspace manager |
| Tests | `npm test` → **162/162 pass** |
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
| `package.json` version | `0.0.1-rc.1`, unchanged since `bfc691c` (2026-11-06) |
| `docs/` in `package.json#files` | yes (listed) |
| `CHANGELOG.md` in `package.json#files` | **absent** |

The 11-08 change is recorded in the CHANGELOG, but the version was not bumped and the CHANGELOG is
not in the published file list.

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
