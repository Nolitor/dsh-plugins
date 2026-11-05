# Orphan session logs — measured plan and owner cleanup command

<!-- skeleton:
version: 1.0
kind: report
status: measured
updated: 2026-11-05
summary: Read-only classification of the live DSH session logs behind the sidebar "그룹 없음" section (120 logs: 98 bound, 22 unregistered, only 2 removable /tmp leftovers), with the owner-runnable digest-gated cleanup script and what exactly it would move.
-->

> Status: **measured, not executed.** The agent cannot write `~/.dsh` (sandbox is read-only
> there) and must not. The owner runs the command in §5. Related:
> [DSH-HOME-ISOLATION.md](DSH-HOME-ISOLATION.md) (how the `/tmp/te-*` leftovers are prevented from
> recurring), [dsh-sidebar-manager/lib/orphan-classifier.mjs](../dsh-sidebar-manager/lib/orphan-classifier.mjs)
> (the label authority).

## 1. What "그룹 없음" actually is

It is **not** an ungrouped workspace. Workspaces are registered in
`~/.dsh/storages/workspace.json`; the section shows **session logs that no workspace lists**. A
workspace with no group is a different (and valid) thing and is not touched by this plan.

Correction to the earlier figure: the **112 `/tmp/te-side-*` logs were historical and have already
been cleaned**. The measured state at 2026-11-05 is below; report these numbers, not the old ones.

## 2. Measured state (2026-11-05, read-only)

Commands used:

```bash
node scripts/cleanup-orphan-sessions.mjs --json     # plan; calls classifyOrphanLogs + header safety pass
node scripts/check-dsh-isolation.mjs                # isolation audit of the repo
```

| Measure | Value |
| :--- | :--- |
| `DSH_HOME` | `/home/minami/.dsh` |
| Workspaces registered | 14 |
| Session logs (`sessions/<project>/<id>/session.v4.jsonl.zstd`) | **120** |
| Classifier labels | **98 `bound`**, **20 `child`**, **2 `unregistered`**, 0 `legacy-orphan`, 0 `binding-mismatch`, 0 `unreadable` |
| Unbound candidates (`disconnected`, i.e. not `bound` and not `child`) | **2** |
| — `A tmp-test` (REMOVE) | **2** (26,666 B ≈ 0.03 MiB) |
| — `B child` (KEEP — linked child session) | 20 |
| — `C real project` (KEEP) | 0 |
| — unreadable (KEEP) | 0 |

The 22 logs outside workspace membership, by `cwd` and classifier label:

| cwd | count | classifier label | class | action |
| :--- | ---: | :--- | :--- | :--- |
| `/home/minami/Workspace/projects/dsh-workspace/dsh-plugins` | 20 | `child` — `parentSession: "session-…"`, `origin: "subagent"`, `delegationDepth: 1` | B linked child | **KEEP** — connected to a live parent session; not an orphan |
| `/tmp/te-ms` | 1 | `unregistered` — `delegationDepth: 0`, no parent | A tmp-test (cwd gone) | move to quarantine |
| `/tmp/te-side-test` | 1 | `unregistered` — `delegationDepth: 0`, no parent | A tmp-test (cwd gone) | move to quarantine |

The classifier now labels linked children **`child`** (added 2026-11-05), so `disconnected` — the
cleanup-facing number — is **2**, not 22. See the
[sidebar classifier entry](../dsh-sidebar-manager/CHANGELOG.md).

## 3. Exactly what would be moved (2 logs, nothing deleted)

| session id | cwd | bytes | label |
| :--- | :--- | ---: | :--- |
| `session-4cb83471-208c-4eba-8aaa-5fa3ec0daf1e` | `/tmp/te-ms` | 13,201 | `unregistered` |
| `session-ae4c12f9-90c1-41db-bac6-051cd41e0fc2` | `/tmp/te-side-test` | 13,465 | `unregistered` |

Plan digest at measurement time: **`70eb1ec1bee56f40`** (16 hex chars; it identifies this exact
plan). The digest changes whenever a session is created or removed, so **always re-run the dry run
before applying** and use the digest it prints then.

## 4. Why the other 20 are kept

- They are **linked child sessions**: the classifier labels them `child` from
  `header.parentSession` / `origin: "subagent"` / `delegationDepth > 0`, and each has a live
  parent session in this workspace. They carry the delegated task/result record of the parent turn.
- `disconnected` excludes `child`, so the sidebar count and this cleanup plan both reflect the
  true orphan set. The safety pass independently re-checks the same header markers, so a stale
  classifier cannot cause a child to be proposed.
- Only `A tmp-test` (classifier `unregistered`/`legacy-orphan`, cwd under `/tmp` and already
  gone, no child marker) is removable.
- Real project logs (`cwd` outside `/tmp`, or still existing) are never removable, even when
  unregistered: the owner may still be working in that directory.

## 5. Owner command (approve the digest, then run)

Dry run first (safe, changes nothing):

```bash
cd /home/minami/Workspace/projects/dsh-workspace/dsh-plugins
node scripts/cleanup-orphan-sessions.mjs
```

Then apply with the digest that dry run printed:

```bash
node scripts/cleanup-orphan-sessions.mjs --apply --approve <digest-from-the-dry-run>
# measured plan at report time would be:
# node scripts/cleanup-orphan-sessions.mjs --apply --approve 70eb1ec1bee56f40
```

The script:

1. refuses to run if `DSH_HOME` does not look like a DSH home (`storages/workspace.json` absent);
2. refuses `--apply` unless `--approve` equals the current dry-run digest (exit 2 otherwise);
3. backs up `storages/workspace.json` into
   `$DSH_HOME/quarantine-backups/orphan-sessions-<timestamp>/`, then **moves** the removable
   session directories (and their `storages/session_projcache` rows) into that folder — it never
   calls `rm` and never touches workspace membership;
4. removes only project directories left empty by the move;
5. re-runs the classifier and prints before → after counts.

It must be run **outside the agent sandbox** (the sandbox cannot write `~/.dsh`; the script turns
that into a clear "run as the DSH service user" error instead of a crash). No DSH restart is needed
for the cleanup itself; restart/refresh the web UI to re-read the session list.

## 6. Restore / rollback

The logs are not deleted. To restore a moved session, move its directory back:

```bash
cp -a "$DSH_HOME"/quarantine-backups/orphan-sessions-<stamp>/sessions/<project>/<session-id> \
      "$DSH_HOME"/sessions/<project>/
# and, if it was moved, the matching
#   quarantine-backups/orphan-sessions-<stamp>/projcache/<session-id>.json
# back to
#   storages/session_projcache/sessions/<session-id>.json
```

`workspace.json` in the backup folder is a snapshot taken before the move; restoring it is only
needed if the registry itself is damaged (the cleanup never edits it).

## 7. Risks and residual notes

- **The digest is point-in-time.** Between the dry run and the apply, new sessions appear (every
  agent turn does). The script then refuses (digest mismatch) — that is the intended safety, not a
  bug. Re-run the dry run and approve the new digest. For that reason the measured
  `70eb1ec1bee56f40` is expected to be stale by the time the owner reads this; the command form is
  what matters.
- **The 20 linked child logs stay connected but unregistered**: the panel's disconnected count now
  excludes `child`, and the cleanup never proposes them. If the owner wants them folded into the
  parent's workspace row, that is a UI/registry feature (bind child ids to the parent workspace),
  not a deletion.
- **Prevention, not just cleanup:** the historical flood came from tests/engines persisting at the
  default root. [DSH-HOME-ISOLATION.md](DSH-HOME-ISOLATION.md) records the harness fixes and the
  `scripts/check-dsh-isolation.mjs` guard that fails a future unisolated launcher.
- **Only `/tmp` garbage is ever removable.** A `/tmp` log whose directory still exists is KEPT
  (the process may still be writing); a real project log is KEPT even when unregistered.
