# DSH Plugins

Unified workspace for the DeepSeek Harness (DSH) plugin ecosystem on this machine.
This directory is the physical workspace root registered in
`~/.dsh/storages/workspace.json` as the **DSH Plugins** workspace
(id `14879f56-24e5-4b96-a1b5-0778356e8960`, formerly titled `DSH Notify`).

Current verified runtime: **DSH `0.2.2-alpha.2`**, Cordis `4.0.6-alpha.1`, Node `v24.22.1`.
See [DSH-0.2.2-ALPHA.2-RUNTIME-REPORT.md](./DSH-0.2.2-ALPHA.2-RUNTIME-REPORT.md) and
[FORGE-VS-SIDEBAR-UTM-MEASUREMENT.md](./FORGE-VS-SIDEBAR-UTM-MEASUREMENT.md)
(UTM review: [UTM-REVIEW-FORGE-VS-SIDEBAR.md](./UTM-REVIEW-FORGE-VS-SIDEBAR.md)).

It sits under the standardized unified tree:

```
/home/minami/Workspace/projects/dsh-workspace/   # unified workspace root (default workspace)
└── dsh-plugins/                                 # <- DSH Plugins workspace root
```

## Agent boot and policy

- `AGENTS.md` is a lightweight index; it points only to the newest timestamped boot card.
- `bootcards/YYYY-MM-DDTHHmm+0900.md` is the default read target for every agent invocation.
- Older boot cards are historical evidence; read them only for version/policy deltas.
- `docs/DSH-HARNESS-POLICY.md` owns runtime, release, notification, and UTM policy.
- `docs/BOOTCARD-POLICY.md` owns generation/read rules.
- Generate a new card with `node scripts/new-bootcard.mjs "note"`.

## Layout

| Path | Track | Status |
|---|---|---|
| `dsh-korean-locale/` | Korean (ko) language pack `@nolit/dsh-korean-locale` (font stack + dictionaries) | Active, linked into the `web` profile |
| `dsh-notify/` | `@nolit/dsh-notify-web` browser notification plugin + recovered Windows PowerShell prototype | Measured under an isolated `DSH_HOME`; not enabled in the live profile |
| `dsh-sidebar-manager/` | `@nolit/dsh-sidebar-manager` right-sidebar workspace/session switcher extension | Active, linked into the `web` profile (v0.1.1) |
| `docs/` | Shared runtime documentation: plugin runtime spec, boot card | Active reference |

Each track keeps its own `package.json`, `cordis.patch.yml`, locale dictionaries,
and `lib/client.js` browser bundle, per the plugin layout documented in
`docs/plugin-boot-card.md`.

## Workspace registration

```json
{
  "path": "/home/minami/Workspace/projects/dsh-workspace/dsh-plugins",
  "title": "DSH Plugins",
  "sessionIds": [ 8 historical DSH Notify sessions ]
}
```

The eight historical sessions were physically re-homed into
`~/.dsh/sessions/--home-minami-Workspace-projects-dsh-workspace-dsh-plugins--/`
by rewriting the Frame 1 zstd header `cwd` and re-encoding the log as two
Zstandard frames. See [MIGRATION.md](./MIGRATION.md) for the exact procedure,
invariants, and rollback notes.

## Active profile wiring

`~/.dsh/profiles/web/package.json` links the Korean locale track from its new
canonical path:

```json
"@nolit/dsh-korean-locale": "link:/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-korean-locale"
```

The `web` profile links both `@nolit/dsh-korean-locale` and
`@nolit/dsh-sidebar-manager` from their canonical checkout paths and lists both
in `dsh.profile.bundles`. `dsh-notify` remains intentionally uninstalled in the
live profile; it was boot-verified in an isolated home only.

## Provenance

The notify and sidebar-manager source trees are recovered from the historical
DSH session logs (Windows-era project trees) — see each track's
`PROVENANCE.md` / `RECOVERY-NOTES.md`.

## Prototypes vs. active plugins

- **Active in the live `web` profile:** `dsh-korean-locale` and `dsh-sidebar-manager`
  (bundle + link), plus the core DSH sidebar plugins (`ui-sidebar`,
  `ui-sidebar-right`, `ui-sidebar-files`, …) that ship with the
  `@deepseek-ai/dsh-web-app` bundle.
- **Measured but intentionally not enabled live:** `dsh-notify`. It boots with a
  linked isolated profile and renders its consent overlay, but the live profile
  is left unchanged until the user explicitly promotes it.

## Verification

- `scripts/audit-promoted-state.mjs` — structural audit of registry, session identity,
  plugin tracks, and profile wiring.
- `scripts/audit-installed-vs-packaged.mjs` — read-only parity audit between the live
  `sidebar-manager` symlink, the workspace tree, the recovery baseline, and the local
  immutable `.tgz` artifact.
- `scripts/install-korean-locale-live.sh` — backs up the live profile, installs/repairs the
  Korean locale link and bundle selection, and verifies both.
- `scripts/install-notify-live.sh` — backs up the live profile and installs the notification
  plugin link/bundle.
- `artifacts/nolit-dsh-korean-locale-0.2.3.tgz` — local installable package; SHA-256 in
  `artifacts/SHA256SUMS.korean-locale`.
- `artifacts/nolit-dsh-notify-web-0.1.6.tgz` — notification plugin package; SHA-256 in
  `artifacts/SHA256SUMS.notify`. v0.1.6 auto-requests permission once, suppresses the toast when Chrome OS notification succeeds, and restores it on a notification error the in-app toast and marks the tab
  title, so remote HTTP Chrome sessions without OS-notification permission still get
  visible feedback.
- `scripts/post-restart-verify.sh` — scheduled by a transient `systemd --user` timer;
  re-audits, restarts `dsh-web.service`, waits for the HTTP endpoint, scans the journal,
  and writes `VERIFICATION-REPORT.md`.
- `verification/` — captured evidence (isolated real-DSH boot audit, offline audit).

## Compatibility alias

`/home/minami/Workspace/projects/dsh-plugins` is a symlink to this canonical directory,
preserving the historical `dsh-notify -> dsh-plugins` rename spelling.