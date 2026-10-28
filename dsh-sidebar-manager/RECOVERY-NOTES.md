# RECOVERY-NOTES — dsh-sidebar-manager

Track: DSH Plugins workspace / **Sidebar Manager** (Right-sidebar workspace & session
switcher plug-in + prototypes), recovered from historical session logs of the original
Windows workspace `C:/Users/nolit/Workspace/projects/dsh-workspace/dsh-sidebar-manager`.

Status: **prototype extension** (v0.1.0, package `@nolit/dsh-sidebar-manager`). It is **not
currently enabled** in the live web profile of this Linux environment; no profile was changed
during this recovery.

## 1. Provenance

Decoded session logs (JSONL, event stream) used:

| session id | relevance |
|---|---|
| `session-9bde4597-b4ea-4b2e-a7a1-a92a676e726d` | main implementation P0→P3 (541 mentions of the project, 100+ write/edit calls) |
| `session-281956f8-db78-4718-ad65-1f405053248d` | finalization: linuxsung repository metadata, README clean-up, docs report (165 mentions) |
| `session-ebc6d16e-e21f-42a9-a181-817815451b45` | inventory/read-only references (5 mentions) |

Compressed originals: `~/.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace--/`
(16 logs, all already decoded to `/tmp/ws-decoded`). They were not modified.

## 2. Replay method

1. All 16 decoded logs under `/tmp/ws-decoded` were merged into one event stream sorted by
   event `time` then per-session `seq` (cross-session chronological replay).
2. Only `tool/call` events with `name === "write"` or `name === "edit"` whose `file_path` is
   under `dsh-sidebar-manager/` or `docs/sidebar-manager/` were considered (111 calls).
3. Every call was joined with its `tool/result` by `callId` **and only applied when the
   original tool result was successful**. This matters: 9 `edit` calls in the log failed with
   *"file has not been read"* and must be skipped. Blind replay (the earlier staging tree in
   `/tmp/reconstruct/sidebar`) applied them anyway and produced a wrong `README.md`.
4. Final tree: **15 source files** (14-file plugin package + `docs/sidebar-manager/FINAL-REPORT.md`).
5. One post-write mutation was made by a `pwsh` → `node -e` command, not by a write/edit tool
   call, so it was re-applied on top of the replayed files (session-281956f8, seq 2584,
   t=1792691598969):
   - `package.json`: `repository.url = git+https://github.com/linuxsung/dsh-sidebar-manager.git`,
     `homepage`, `bugs`, `files` gains `LICENSE`
   - `market/index.json`: `homepage`, `repository.url = https://github.com/linuxsung/dsh-sidebar-manager`,
     `versions[0].publishTimestamp = 1792691581`
6. Files created/edited outside the plugin package (`tools/p0-relocate-spike.mjs`,
   `tools/p0b-workspace-rename-spike.mjs`, `tools/p2-host-smoke.mjs`, `tools/e2e/*`, the
   `.scratch/publish-dsh-sidebar-manager` standalone-repo copy) are **not part of this package**
   and were not recovered here.
7. Cross-check: 11 of the 14 package files are byte-identical to the earlier staging replay
   (`/tmp/reconstruct/sidebar`). The 3 differences are intentional: `README.md` (staging had
   applied the failed edits; corrected here), and `package.json` / `market/index.json` (final
   linuxsung metadata re-applied here). `README.ko.md` is identical.

## 3. File inventory and reconstruction confidence

| file | bytes | confidence / notes |
|---|---:|---|
| `package.json` | 2184 | high; replay + re-applied final repository metadata |
| `cordis.patch.yml` | 359 | high; single write |
| `icon.svg` | 453 | high; single write (identical to market icon) |
| `lib/index.js` | 1702 | high; write + 2 successful edits |
| `lib/client.js` | 54196 | high; 3 writes + 26 successful edits, `node --check` passes |
| `lib/transaction.mjs` | 30483 | high; 2 writes + 15 successful edits |
| `lib/session-log.mjs` | 7195 | high; write + 3 successful edits |
| `locale/en.json` | 178 | high |
| `locale/ko.json` | 208 | high |
| `market/index.json` | 1919 | high; replay + final shell metadata mutation |
| `market/icons/sidebar-manager.svg` | 453 | high |
| `README.md` | 6006 | **medium-high** — see below |
| `README.ko.md` | 2646 | **medium-high** — see below |
| `LICENSE` | 1062 | high (MIT, added for standalone publish) |
| `docs/sidebar-manager/FINAL-REPORT.md` | 5187 | high; write + 5 successful edits, all results success |

### README reconstruction detail

- `README.md` / `README.ko.md` each have 23 / 18 edit calls. In the original log, a batch of 5
  (en) + 4 (ko) edits failed server-side (*"file has not been read"*), then the model read the
  files and retried. The replay skips the failed batch and applies the successful retry, which
  reproduces the intended final text.
- Verification for `README.md`: the latest read snapshot in the log (session-281956f8 seq 2599,
  lines 1–60 of 99) matches the first 60 lines of the reconstructed file after applying the
  final 3 successful edits. The tail (lines 61–99) comes from the edit chain only; all of those
  edits reported success.
- The earlier staging tree had applied the failed edits blindly; its `README.md` (5913 B) is
  **superseded** by this reconstruction (6006 B). `README.ko.md` happens to be identical.
- Remaining gap: no post-edit full-file read of either README exists in the logs, so the full
  files cannot be independently re-derived beyond "last read + all successful edits". Risk is low
  because no edit in the final chain failed.

### Not recovered / documented gaps

- No `tests/` directory existed inside the plugin package (npm pack produced 14 files, no tests).
  The test/verification harnesses were workspace-level `tools/` scripts and are outside this track.
- No `.git` history; the recovered state is the working tree at the last recorded edits
  (`docs/sidebar-manager/FINAL-REPORT.md` cites commit f277d50 before the P3 doc refresh;
  the package metadata commit later prepared the `linuxsung/dsh-sidebar-manager` standalone repo).
- Other docs named in model planning text (`docs/sidebar-manager/DIALOG-SPEC.md`,
  `E2E-REPORT.md`, `P3-UI.md`, `docs/confirmation-gate.md`, `docs/sidebar-manager/README.md`)
  were **never created** — no write/edit call references them. Only `FINAL-REPORT.md` exists.
- Files deleted by DSH-internal cleanup outside the workspace cannot be recovered from these logs.

## 4. Nature / live-profile recommendation

- Host half is a normal Cordis plugin (`export const name`, `export const inject`,
  `export async function apply`) that registers owner-authenticated exact-fetch routes under
  `/api/local/sidebar/*` via `ctx.connection.fetch` and runs a boot journal finalizer.
- Browser half is a module-loader CJS factory bundle
  (`window.__ModuleLoader__.load({ id, factory })`) registering sidebar slots plus dialog hosts.
- The plugin performs **destructive filesystem/registry/session-log transactions** under
  `~/.dsh` (purge, archive, move, rename, fork). The original live install was a link install in
  the Windows `web` profile + bundle patch + `projectsRoot` config.
- **Recommendation: do NOT link it into the live web profile yet.** First verify against the
  migrated Linux storage layout (zstd session frames, `workspace.json`, profile paths) in an
  isolated `DSH_HOME`, then enable it deliberately with a backup. It is a prototype, not a
  production-ready plugin, and enabling it now would expose session/workspace data to
  unvalidated mutation routes.

## 5. Validation performed

- All JSON files parse (`package.json`, `locale/en.json`, `locale/ko.json`, `market/index.json`).
- All JS/MJS files parse as ESM: `node --input-type=module --check < file` for
  `lib/index.js`, `lib/client.js`, `lib/transaction.mjs`, `lib/session-log.mjs`.
- Manifest sanity: `dsh.manifestVersion === 1`, `dsh.bundle.patch` string,
  `dsh.client.platform === 'web'`, `dsh.client.inject` non-empty array, `exports['./client']`
  present, no unofficial `dsh.plugin` field.
- Host plugin shape: `export const name = 'sidebar-manager'`, `export const inject = [...]`,
  `export async function apply(ctx, config)`; imports only `./transaction.mjs`.
- Client bundle shape: single `window.__ModuleLoader__.load({ id, factory })` call; factory
  returns `module.exports` with `apply` / `inject`.
- No syntax-check failures.

## Appendix A — out-of-package harnesses (not part of this deliverable)

The implementation sessions also created workspace-level verification scripts outside the plugin
package. They replay cleanly too (all write/edit tool results successful) and were staged to
`/tmp/reconstruct/extra/tools/` as scratch material for the workspace migration (they are
**outside** this package's write scope and are not part of `@nolit/dsh-sidebar-manager`):

- `tools/p0-relocate-spike.mjs` (13.7 KB)
- `tools/p0b-workspace-rename-spike.mjs` (22.4 KB)
- `tools/p2-host-smoke.mjs` (8.6 KB)
- `tools/e2e/prepare-fixture.mjs` (7.7 KB), `tools/e2e/run-e2e.mjs` (20.6 KB),
  `tools/e2e/package.json`, `tools/e2e/README.md`

All five .mjs files pass `node --input-type=module --check`; the E2E package.json parses.
