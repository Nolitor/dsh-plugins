# OpenCode installation cleanup log — 2026-11-07

<!-- skeleton:
version: 1.0
kind: report
status: completed
updated: 2026-11-07
summary: Executed cleanup of the legacy OpenCode 0.0.55 install and stale OpenCode caches, with before/after paths and quarantine location.
-->

## 1. Instruction

Owner: first clean the old version (0.0.55) and cache leftovers so the environment is
clean, before any 2.2.6 upgrade.

## 2. Before

| Item | Measured |
|---|---|
| Interactive `opencode` | `/home/minami/.bun/bin/opencode`, **2.2.0** |
| Second PATH entry | `/home/minami/.opencode/bin/opencode`, **0.0.55** |
| Legacy tree size | 104 MiB |
| Running service | PID 104336, 2.2.0, port 49374 |
| Bun global packages | `@opencode/cli@2.2.0`, `kordoc@4.19.2`, `pnpm@12.15.0` |
| Orphan global platform trees | `opencode-linux-x64*` **1.19.3** (four trees) |
| Stale cache groups | `opencode-ai*` and `opencode-linux-x64*` 1.18.35/1.19.3; `@opencode/cli-linux-x64*` 2.0.30–2.0.32 |
| `/tmp` measurement footprint | about 2.5 GiB of copied homes and extracted binaries |

Recorded originals: `/home/minami/.dsh/quarantine-backups/opencode-cleanup-20261107_153437/`
contains `BEFORE.txt`, `AFTER.txt`, `bashrc.bak`, and `profile.bak`.

## 3. Actions taken

1. Moved the entire legacy tree `~/.opencode` to
   `<quarantine>/legacy-opencode-0.0.55/`. It was not deleted.
2. Removed only verified OpenCode cache entries for versions other than the active 2.2.0.
   The 2.2.0 cache needed by the installed package was kept at the time of cleanup.
3. Removed the four orphan global `opencode-linux-x64*@1.19.3` platform trees. The Bun global
   dependency tree listed none of them as a dependency.
4. Removed the `~/.opencode/bin` PATH line from `~/.bashrc`.
5. Removed this session's `/tmp` measurement homes, extracted 2.2.5/2.2.6 binaries, tag
   trees, and API snapshots.

No live DSH profile edit, DSH restart, package version change, or OpenCode service restart
was performed.

## 4. After

| Check | Result |
|---|---|
| Fresh interactive shell `type -a opencode` | only `/home/minami/.bun/bin/opencode` (twice, via two symlinks) |
| `opencode --version` | `opencode v2.2.0` |
| `~/.opencode` | **absent** |
| Remaining OpenCode cache entries | none matching `opencode-*` or `@opencode/cli-*` |
| Remaining global `opencode-linux-x64*` dirs | none |
| Bun global packages | `@opencode/cli@2.2.0`, `kordoc@4.19.2`, `pnpm@12.15.0` |
| Running service | PID 104336, `/api/info` reports 2.2.0 |
| Live DSH profile `opencodePath` | unchanged: `/home/minami/.bun/bin/opencode` |
| `/tmp` size during cleanup window | about 5,541 MiB → 3,059 MiB |

## 5. What this did and did not achieve

Achieved:

- one OpenCode generation is reachable on `PATH`;
- the 0.0.55 binary is quarantined, not lingering as a fallback;
- stale OpenCode cache and orphan global platform trees are gone;
- no active DSH row or running service was disturbed.

Not achieved:

- the active version is still 2.2.0, not 2.2.6;
- the schema migrations for 2.2.1–2.2.6 have not run on the live DB;
- no 2.2.6 install or service restart has occurred.

## 6. Rollback

The legacy tree and shell originals are under the quarantine path above. Rollback is
`mv <quarantine>/legacy-opencode-0.0.55 ~/.opencode` and
`cp <quarantine>/bashrc.bak ~/.bashrc`. Cache entries were not backed up; they are
re-downloadable, and removing them was the point of the cleanup.
