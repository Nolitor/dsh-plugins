# TokenEconomizer — Handoff

<!-- skeleton:
version: 1.3
kind: report
status: active
updated: 2026-11-14
summary: Stage-by-stage handoff for @nolit/dsh-tokeneconomizer at 0.0.1-rc.5 — the shipped devstats card, the subagent-gate split that is applied pending restart, and the version/CHANGELOG state re-measured 2026-11-14 (the 11-08 change is recorded, the version is rc.5, and CHANGELOG.md is present in files[]).
-->

> History lives in [CHANGELOG.md](../CHANGELOG.md). This file is the **forward** view.

## 1. State

| Item | Measured value |
| :--- | :--- |
| Package | `@nolit/dsh-tokeneconomizer@0.0.1-rc.5` |
| Last code commit | `2b668ad` 2026-11-08 — devstats card redesigned for the DSH settings seat |
| Tests | `npm test` → **164 tests / 163 pass / 0 fail / 1 skip** (re-measured 2026-11-14, after the subagent-gate split) |
| Live state | **`applied pending restart`** — the `dsh-web` service started **2026-11-14 09:37:14 KST** and `lib/index.js` was changed at **21:24:15 KST**; the owner was in the middle of other work, so the service was not restarted and the running process still holds the pre-split behaviour |
| Visual check | modules loaded — `lib/client.js` mtime 11:28:51 is before the 11:53:42 service start; live *visual* check still outstanding |

## 2. Done

- Developer-statistics card follows the DSH settings surface rules: `720px` section width, correct
  heading levels, own scoped stylesheet keyed by a plugin-owned selector, scroll frame on the
  per-turn table, focus rings, full session id in the picker.
- English locale no longer carries the Korean display title.
- DSH_HOME isolation in the test harness (`integration.test.mjs`, `tiering-mount.test.mjs`).
- KV-cache-safe pinned prompt section, tiering, dedup, watchdog.
- **Subagent gate narrowed to the engine path** (2026-11-14, `0.0.1-rc.5`): the in-memory levers
  mount in a delegated child too; the engine path (hooks, export, fold, ledger) stays root-only.
  Switch: `subagentMemory` (default `true`). Details in
  [CHANGELOG.md](../CHANGELOG.md) and [ARCHITECTURE.md](ARCHITECTURE.md) §3.1.

## 3. Stages

### S0 — restart the service to load the subagent-gate split

The change is on disk and **not** in the running process: the service started **09:37:14 KST**,
the code changed at **21:24:15 KST**, and the owner was busy with other work, so no restart
happened. Until it does, the live behaviour is still the old blanket skip — a subagent session
gets **no** lever at all. A restart is needed before any live measurement reflects
`0.0.1-rc.5`.

### S1 — resolve the version/CHANGELOG state

Two measurements that disagree with the rc convention (global `AGENTS.md` §6):

| Surface | Measured |
| :--- | :--- |
| `package.json` version | `0.0.1-rc.5` (re-measured 2026-11-14; the 11-08 devstats change has since been followed by two `rc.2` CHANGELOG entries on 2026-11-11, the 2026-11-14 audit session bumped `rc.3` → `rc.4`, and the same day's subagent-gate session bumped `rc.4` → `rc.5`) |
| CHANGELOG | has a `2026-11-08` devstats entry, no `rc` heading for it |

**Resolved 2026-11-13 by measurement:** the version is now `0.0.1-rc.2` and the CHANGELOG carries two
`rc.2` entries dated 2026-11-11, so the 11-08 change is no longer unrecorded. Agents must not bump
the numeric part.

**Also measured — `CHANGELOG.md` is absent from `files[]`.** `npm pack` produces a 27-file
tarball, and `tar -tzf … | grep CHANGELOG` returns nothing. Same F-55 class as Sidebar Manager: the
history rule is satisfied in the working tree and violated in the published artifact.
`npm run check:publish` passes today and does **not** cover this. The fix is a one-line `files[]`
addition; reported, not fixed.

**Corrected 2026-11-14 by measurement — this gap is already fixed.** `package.json` `files[]` now
carries `"CHANGELOG.md"`, and `test/package.test.mjs` pins it:

```js
assert.ok(
  pkg.files.includes('CHANGELOG.md'),
  'package.json files[] must name CHANGELOG.md, or npm never ships the history',
)
```

The state above was recorded 2026-11-13 and is stale. It is kept as history, not as the current
finding.

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
