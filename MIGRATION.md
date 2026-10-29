# DSH Plugins — Physical Promotion & Migration Record
<!-- skeleton:
version: 1.0
kind: report
status: historical
updated: 2026-10-24
summary: Physical promotion of the former DSH Notify workspace: zstd frame header rewrite, invariants, rollback.
-->


Date: 2026-10-24 (Asia/Seoul)

This record documents the physical promotion of the former **DSH Notify** workspace
into the unified **DSH Plugins** workspace and the byte-level session re-homing that
follows from DSH session identity rules.

## 1. Workspace registry

`~/.dsh/storages/workspace.json` (domain `workspace` v2) entry
`14879f56-24e5-4b96-a1b5-0778356e8960` was updated in place:

| Field | Before | After |
|---|---|---|
| `title` | `DSH Notify` | `DSH Plugins` |
| `path` | `/home/minami/Workspace/projects/DSH Notify` | `/home/minami/Workspace/projects/dsh-workspace/dsh-plugins` |
| `sessionIds` | 8 sessions | unchanged, same order |
| `createdAt` | 2026-10-19T16:24:07.564Z | unchanged |
| `updatedAt` | 2026-10-22T18:25:09.151Z | refreshed |

The registry requires workspace paths to be unique and `fs.realpath`-canonical.
The unified tree root `/home/minami/Workspace/projects/dsh-workspace` is already
owned by the default workspace (`기본 작업공간`, `3f7ba34a-...`), so the promoted
workspace uses the dedicated sub-root `dsh-workspace/dsh-plugins` (a permitted
"dedicated sub-root" under the standardized tree).

The empty legacy directory `/home/minami/Workspace/projects/DSH Notify` was removed
after its only historical contents (session logs) were re-homed.

Backup before the edit:

```
/home/minami/.dsh/storages/workspace.json.bak.2026-10-24T10-00-49-382Z
```

## 2. Session re-homing (multi-frame Zstandard guard)

DSH stores each session at a path derived from its header `cwd`:

```text
generationLogPath(root, cwd, id, 4, "zstd")
  = root / projectKey(cwd) / encodeSegment(id) / session.v4.jsonl.zstd
```

`assertStoredIdentity` rejects any log whose physical location does not match the
`cwd` in its Frame 1 header, and `assertZstdHeaderFrame` requires Frame 1 to contain
exactly one JSONL line (the header) terminated by a single `\n`. Therefore changing a
workspace path requires a joint move + header rewrite:

1. Decode each session with `zstd -d` (all frames, byte-exact plaintext).
2. Parse the Frame 1 header line and replace `cwd` with the new canonical path.
3. Re-encode as **exactly two** independently decodable Zstandard frames using
   `node:zlib` with the checksum flag (`ZSTD_c_checksumFlag = 1`, same as the DSH writer):
   * Frame 1 = header JSON + `\n` (only frame validated by `assertZstdHeaderFrame`)
   * Frame 2 = the complete original event body (byte-identical, trailing `\n` preserved)
4. Write the artifact to `~/.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace-dsh-plugins--/<id>/session.v4.jsonl.zstd`.
5. Re-read and assert: frame count == 2, Frame 1 equals the new header, body equals the
   original body byte-for-byte.

The old project directory `~/.dsh/sessions/--home-minami-Workspace-projects-DSH~0020Notify--
was removed only after every artifact passed these checks.

### Promoted sessions (SHA-256 of the new artifacts)

| Session | Events | SHA-256 |
|---|---|---|
| `session-21197fd9-a032-4cbd-b5b5-cd0882ce3fe9` | 4 | `07ad1699e9f65e5052f347bcf880bc0236db69be747e171cd9c94a1b1ebdf2f6` |
| `session-318f99bb-f0dd-462a-8540-3cb7d3694e2d` | 4 | `176d50189d0de59f6abfdb565d689c8fcd6afb06206eb7200f146ee7249abe0e` |
| `session-58a2dc78-0e98-49ac-8f3a-beec8a2997c6` | 12 | `5809284d2cfeb39626f808ae355d5ab6e143ccf8216ba84ea55bc54eaac61987` |
| `session-95a9341d-a091-4a4b-879d-899cb432b9cc` | 11 | `83e441a48418b2236549b03b10d75a519d8e44392a9bd520821ebebf873f5847` |
| `session-a3b2bf75-8959-4a8e-8b53-9d4394b898e3` | 5853 | `830c5fe4282079fbbe3b0026d27a1aea3c059a272d9ea33c8857abaa2defbfab` |
| `session-b53400d8-41db-4a3b-b611-a14f43e62916` | 6043 | `d4cbfc3e281e763b3ace8c2c389434808719054db3df6431a132263871d08c2f` |
| `session-c7a8072b-507d-4679-833c-3952f3b041c6` | 4 | `7d4181a3304685931f5d2535307e92aeb4291740517983f49983ab767524e4c7` |
| `session-f9c95dba-191d-4096-94c6-be35c1f8ef4b` | 4 | `a0d676cfd89b739b9ff4acd543ca4bed95f9303e33548bf4cc109d97cc10fd17` |

Rollback backup: `/home/minami/.dsh/quarantine-backups/dsh-plugins-promotion-2026-10-24T10-03-56-132Z.tgz`
(contains the promoted session directory and workspace.json; original plaintext of all
8 sessions is also archived at `/tmp/notify-decoded/`).

## 3. Plugin suite layout

```text
dsh-workspace/
└── dsh-plugins/
    ├── README.md
    ├── MIGRATION.md
    ├── VERIFICATION-REPORT.md        # generated post-restart
    ├── docs/
    │   ├── dsh-plugin-runtime-spec.md
    │   └── plugin-boot-card.md
    ├── dsh-korean-locale/            # active, linked into the web profile
    ├── dsh-notify/                   # @nolit/dsh-notify-web + recovered Windows prototype
    ├── dsh-sidebar-manager/          # right-sidebar workspace/session switcher prototype
    └── scripts/
        ├── audit-promoted-state.mjs
        └── post-restart-verify.sh
```

### Profile link change

`~/.dsh/profiles/web/package.json`:

```json
"@nolit/dsh-korean-locale": "link:/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-korean-locale"
```

`pnpm-lock.yaml` was updated to the same specifier and `pnpm install --offline
--frozen-lockfile` reports "Lockfile is up to date". The `node_modules/@nolit/dsh-korean-locale`
symlink now resolves to the new canonical path.

## 4. Verification performed

- **Offline structural audit** (`scripts/audit-promoted-state.mjs`): workspace record, path
  uniqueness, session ownership, two-frame encoding, header cwd, body preservation, plugin
  tracks, profile link resolution.
- **Real DSH boot audit**: a cloned `DSH_HOME` was booted with a temporary audit plugin that
  injected `sessionPersistence` and `workspaceRegistry`; it opened all 8 sessions through the
  production persistence API (exercising `assertStoredIdentity`) and confirmed the DSH Plugins
  workspace title/path/8 sessions. Result: `allSessionsLoaded=true`, `noDroppedSessions=true`.
- **Service restart**: `scripts/post-restart-verify.sh` is scheduled through a transient
  `systemd --user` timer; it re-audits, restarts `dsh-web.service`, waits for the HTTP
  endpoint, scans the journal for startup/corruption/session-drop signatures, and writes
  `VERIFICATION-REPORT.md`. The restart is deliberately detached because this agent session
  itself runs inside `dsh-web.service`.


## 5. Final tree

```text
/home/minami/Workspace/projects/dsh-workspace/
├── dsh-plugins/                     # DSH Plugins workspace root (registered path)
│   ├── README.md
│   ├── MIGRATION.md
│   ├── VERIFICATION-REPORT.md       # written by post-restart verifier
│   ├── docs/
│   │   ├── dsh-plugin-runtime-spec.md
│   │   └── plugin-boot-card.md
│   ├── dsh-korean-locale/           # active @nolit/dsh-korean-locale, linked in web profile
│   ├── dsh-notify/                  # @nolit/dsh-notify-web plugin package
│   │   ├── package.json, cordis.patch.yml, lib/, locale/, market/, test/, README.md
│   │   ├── PROVENANCE.md
│   │   ├── docs/                    # 14 recovered project docs + RECOVERY-NOTES.md
│   │   └── prototype-windows/       # recovered PowerShell/WPF/bridge prototype (63 files)
│   ├── dsh-sidebar-manager/         # @nolit/dsh-sidebar-manager prototype package
│   │   ├── package.json, cordis.patch.yml, lib/, locale/, market/, README*.md
│   │   ├── docs/sidebar-manager/FINAL-REPORT.md
│   │   ├── RECOVERY-NOTES.md
│   │   └── prototype-harness/       # recovered p0*/p2*/e2e spike harnesses
│   ├── scripts/
│   │   ├── audit-promoted-state.mjs
│   │   └── post-restart-verify.sh
│   └── verification/
│       ├── boot-audit-clone.json
│       ├── offline-audit.json
│       └── README.md
└── (nothing else: the default workspace directory holds only the promoted tree)
```

All three plugin tracks and the shared docs are physically inside the DSH Plugins
workspace root. The empty legacy `DSH Notify` directory and the old
`--home-minami-Workspace-projects-DSH~0020Notify--` session directory no longer exist.
A compatibility alias `/home/minami/Workspace/projects/dsh-plugins` points at the
canonical directory.

## 6. Requirements trace

| Requirement | Implementation | Evidence |
|---|---|---|
| Physical unification under `dsh-workspace` | Dedicated sub-root `dsh-workspace/dsh-plugins`; legacy dir removed; alias symlink added | `ls`, `readlink -f` |
| Registry entry `DSH Notify` -> `DSH Plugins`, Linux POSIX path | In-place record update (title/path/updatedAt), 8 sessions preserved | `workspace.json`; boot audit |
| Frame 1 header rewrite, two-frame zstd | `node:zlib` checksummed frames, Frame 1 = header only; bodies byte-identical | `offline-audit.json`; SHA-256 table above |
| `generationLogPath` matches physical path, zero session drops | Session directory derived from new `cwd`; `assertStoredIdentity` exercised by real boot | `boot-audit-clone.json` (`allSessionsLoaded`, `noDroppedSessions`) |
| `dsh-korean-locale` active + linked | Moved to canonical path; profile dependency, lockfile, node_modules link updated; `pnpm install --offline --frozen-lockfile` clean | locale `verify.mjs` ok; `--dump-config` resolves bundle |
| `dsh-notify` track present | Reconstructed `@nolit/dsh-notify-web` plugin + recovered Windows prototype + docs | 91 files; 15/15 plugin tests |
| Right-sidebar / session-switcher extension present | Reconstructed `@nolit/dsh-sidebar-manager` package + docs + harness | 16 files; ESM/manifest/bundle validation |
| Shared docs present | `docs/dsh-plugin-runtime-spec.md`, `docs/plugin-boot-card.md` (moved, parent links updated) | audit checks |
| No broken symlinks / prototype leftovers in default workspace | default workspace dir now contains only the promoted tree; audit walks for broken symlinks | audit check |
| Restart `dsh-web.service` safely | Detached transient `systemd --user` timer runs `scripts/post-restart-verify.sh`: pre-audit -> restart -> health/journal scan -> post-audit -> report | `VERIFICATION-REPORT.md` |
| Locale + sidebar plugin health | Korean locale verify green; core `ui-sidebar*` plugins still composed in the web profile; prototype sidebar manager validated in isolated boot but not enabled (destructive prototype) | `--dump-config`; boot audit |

## 7. Service restart mechanism

This agent session runs inside the `dsh-web.service` process, so an in-band
`systemctl restart` would terminate the orchestration turn. The restart is therefore
performed by a detached transient systemd user timer:

```sh
systemd-run --user --on-active=<delay> --unit=dsh-plugins-promotion-restart \
  /bin/bash /home/minami/Workspace/projects/dsh-workspace/dsh-plugins/scripts/post-restart-verify.sh
```

The script re-runs the audit first and aborts the restart if the promoted state is bad.
After the restart it waits for `http://127.0.0.1:3080/` to return 200, scans the journal
for startup/corruption/session-drop signatures, re-audits, and writes
`VERIFICATION-REPORT.md`. The new UI URL/token is stored in `/tmp/dsh-web-current-url.txt`.

## 8. Title restoration (projection-cache identity re-stamp)

### 8.1 Symptom

After the physical move, all eight promoted sessions rendered with the client fallback label
(`제목 없음` / Untitled) even though two of them had historical titles. Sibling workspaces were
unaffected.

### 8.2 Root cause

Display titles for **cold** sessions are not read from the log. The list pipeline is:

```
session header (Frame 1)                -> lifecycle identity witness
session_projcache record.identity      -> must match header (formatVersion, createdAt, cwd, isSeeded)
sessionProjectionCache.cachedSnapshot  -> supplies rows.title to session/list projections
client displayTitle(node, t)           -> node.title || t("session.untitled")
```

The eight cache records still carried the pre-move lifecycle stamp
`identity.cwd = /home/minami/Workspace/projects/DSH Notify`. `identityMatches` therefore
rejected every record, `session/list` served no `projections`, and the client showed the
fallback label. The session logs were never involved: `title` is not a header key
(`HEADER_REQUIRED_KEYS` + `HEADER_OPTIONAL_KEYS` exclude it), so Frame 1 could not and should
not carry a title.

### 8.3 Historical titles (pristine reference archive)

Source: `dsh_pure_assets_20261024.zip` (`storages/session_projcache`), cross-checked against the
`session/title` events in the logs. Only two of the eight sessions ever had titles; the other
six contain only configuration/command events (zero user messages, zero session/title events).

| Session | Historical title |
|---|---|
| `session-b53400d8…` | DSH Notify 하이브리드 듀얼 모드 아키텍처 설계 |
| `session-a3b2bf75…` | 부트 카드 읽고 헤더 인덱싱 작업 |
| the other six | none (null in the pristine cache; no title events) |

### 8.4 Restoration applied

Only `~/.dsh/storages/session_projcache/sessions/<id>.json` was touched:
`record.identity.cwd` was re-stamped to `/home/minami/Workspace/projects/dsh-workspace/dsh-plugins`
for all eight records, with every other field (including the complete `rows` fold) byte-identical.
Writes were atomic (tmp + fsync + rename) and preserved wrapper version 7 and file mode. The
authoritative session logs were verified byte-identical by SHA-256 after the change, so the
two-frame Zstandard encoding, `assertZstdHeaderFrame`, and `assertStoredIdentity` are untouched.

### 8.5 Verification

- Isolated real-DSH boot (clone of `~/.dsh`) with an audit plugin injecting
  `sessionProjectionCache` + `sessionPersistence`:
  `allIdentityMatch=true`, `allProjectionsPresent=true`, `allTitlesMatchHistorical=true`,
  `listedTitleServing=2`, `allPass=true` → `verification/title-restoration-clone-audit.json`.
- Before/after reproduction: `verification/title-audit-before-rebind.json` (0 titles) and
  `verification/title-audit-clone-rebind-proof.json` (2 titles).
- `scripts/audit-promoted-state.mjs` now also validates cache identity + historical titles
  (41 checks total).
- Post-restart verifier: `scripts/title-restoration-restart.sh` (detached), report
  `TITLE-RESTORATION-REPORT.md`.

### 8.6 Rollback

Projection-cache backup before the re-stamp: `title-restore-2026-10-24T10-19-32-204Z.tgz`
(contains `session_projcache_sessions/`, `workspace.json`, and the session SHA-256 manifest).
Restore it and restart `dsh-web.service`. Session logs are never modified by this procedure.

## 9. Plugin-session transfer from 기본 작업공간 (3 sessions)

Three plugin-related development sessions were re-homed from the default workspace
(`기본 작업공간`, path `/home/minami/Workspace/projects/dsh-workspace`) into **DSH Plugins**.
No other default-workspace session (API-key sync, harness installation, etc.) was touched.

| # | Session ID | Historical title | Events |
|---|---|---|---|
| 1 | `session-ebc6d16e-e21f-42a9-a181-817815451b45` | Fix Korean font persistence issue | 1,448 |
| 2 | `session-281956f8-db78-4718-ad65-1f405053248d` | DSH 한글 로컬라이징 검토 | 3,407 |
| 3 | `session-9bde4597-b4ea-4b2e-a7a1-a92a676e726d` | 현재 프로젝트(기본 작업공간 | 3,249 |

### 9.1 Physical relocation + header re-encode

Each session directory was moved from
`~/.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace--/` to
`~/.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace-dsh-plugins--/`.
Each log was fully decoded and re-encoded with `node:zlib` (checksummed Zstandard) as exactly
two frames: Frame 1 = the original header with only `cwd` replaced by the new canonical path,
Frame 2 = the complete original event body (byte-identical). One log contained 396 append
frames and was compacted to the compliant two-frame form; the other two were already two-frame.
The old session directories were removed only after byte-level verification.

### 9.2 Projection-cache re-stamp

The three `session_projcache` records were re-stamped (`identity.cwd` -> DSH Plugins path)
with all other fields and the `rows` fold untouched, so their historical titles resolve again
through `session/list` (`cachedSnapshot`).

### 9.3 Workspace registry

`~/.dsh/storages/workspace.json`:

- `기본 작업공간` (`3f7ba34a-…`): 15 -> **12** sessions (the 3 removed, all others retained).
- `DSH Plugins` (`14879f56-…`): 8 -> **11** sessions (the 3 appended in request order).
- `updatedAt` refreshed on both records; workspace order and paths unchanged.

### 9.4 Verification

Isolated real-DSH boot (clone with an audit plugin injecting `sessionPersistence`,
`sessionProjectionCache`, `workspaceRegistry`):

```json
{"workspaceTitleOk":true,"pluginsHas11":true,"transferredInPlugins":true,
 "transferredNotInDefault":true,"defaultRetains12":true,"allHeadersNewCwd":true,
 "allProjectionsPresent":true,"allTitlesMatch":true,"transferredSessionsLoad":true,
 "listedTitleServing":5,"allPass":true}
```

- All 11 DSH Plugins headers resolve to the new `cwd` (no `assertStoredIdentity` drops).
- All 11 projection blocks served; 5 titled sessions now expose their titles (the 2 DSH Notify
  titles plus the 3 transferred titles); the other 6 remain historically untitled.
- The 3 transferred logs open and replay through the production persistence API
  (1,448 / 3,407 / 3,249 events).
- Evidence: `verification/session-transfer-clone-audit.json`.
- `scripts/audit-promoted-state.mjs` now enforces the 11/12 membership split (47 checks).

### 9.5 Rollback

Backup before the transfer: `/home/minami/.dsh/quarantine-backups/session-transfer-2026-10-24T10-34-55-396Z.tgz`
(contains the 3 original session directories, their original projection-cache records,
`workspace.json`, and the original session SHA-256 manifest). Restore it and restart
`dsh-web.service`.
