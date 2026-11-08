# TokenEconomizer — Handoff

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-08
summary: Stage-by-stage handoff for @nolit/dsh-tokeneconomizer at 0.0.1-rc.1 — the shipped devstats card, the pending-restart state, and the version/CHANGELOG mismatch that a release decision must resolve.
-->

> History lives in [CHANGELOG.md](../CHANGELOG.md). This file is the **forward** view.

## 1. State

| Item | Measured value |
| :--- | :--- |
| Package | `@nolit/dsh-tokeneconomizer@0.0.1-rc.1` |
| Last code commit | `2b668ad` 2026-11-08 — devstats card redesigned for the DSH settings seat |
| Tests | `npm test` → **140 tests, 139 pass, 0 fail, 1 skipped** (the skip is the opt-in engine fixture) |
| Live state | modules loaded — `lib/client.js` mtime 11:28:51 is before the 11:53:42 service start; live *visual* check still outstanding |

## 2. Done

- Developer-statistics card follows the DSH settings surface rules: `720px` section width, correct
  heading levels, own scoped stylesheet keyed by a plugin-owned selector, scroll frame on the
  per-turn table, focus rings, full session id in the picker.
- English locale no longer carries the Korean display title.
- DSH_HOME isolation in the test harness (`integration.test.mjs`, `tiering-mount.test.mjs`).
- KV-cache-safe pinned prompt section, tiering, dedup, watchdog.

## 3. Stages

### S1 — resolve the version/CHANGELOG state

Two measurements that disagree with the rc convention (global `AGENTS.md` §6):

| Surface | Measured |
| :--- | :--- |
| `package.json` version | `0.0.1-rc.1`, unchanged since `52db3e3` (2026-11-06) |
| CHANGELOG | has a `2026-11-08` devstats entry, no `rc` heading for it |

Owner decision needed: bump `rc` for the 11-08 change, or state that this track's `rc` counts
differently. Agents must not bump the numeric part.

**Also measured — `CHANGELOG.md` is absent from `files[]`.** `npm pack` produces a 27-file
tarball, and `tar -tzf … | grep CHANGELOG` returns nothing. Same F-55 class as Sidebar Manager: the
history rule is satisfied in the working tree and violated in the published artifact.
`npm run check:publish` passes today and does **not** cover this. The fix is a one-line `files[]`
addition; reported, not fixed.

### S2 — live visual verification

The code is loaded (mtime precedes the service start). The settings card has only been proven in an
isolated `DSH_HOME` boot; what remains is a browser check in the live profile, not a restart.

### S3 — Korean rendering in a real profile

The isolated minimal boot did not compose `@nolit/dsh-korean-locale`, so Korean was asserted by the
locale unit test and table equality only. Verify in the live profile after S2.

## 4. Verification

```bash
cd dsh-tokeneconomizer && npm test
```
