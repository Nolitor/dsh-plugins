# DSH Plugins
<!-- skeleton:
version: 2.2
kind: readme
status: active
updated: 2026-11-06
summary: Workspace entry point: plugin track layout by measured lifecycle (active / spec / verify-only), per-subproject document homes, live profile wiring, agent boot chain.
-->


Unified workspace for the DeepSeek Harness (DSH) plugin ecosystem on this machine.
This directory is the physical workspace root registered in
`~/.dsh/storages/workspace.json` as the **DSH Plugins** workspace
(id `14879f56-24e5-4b96-a1b5-0778356e8960`, formerly titled `DSH Notify`).

Current verified runtime: **DSH `0.2.2-alpha.2`**, Cordis `4.0.6-alpha.1`, Node `v24.22.1`.
See [DSH-0.2.2-ALPHA.2-RUNTIME-REPORT.md](./docs/DSH-0.2.2-ALPHA.2-RUNTIME-REPORT.md) and
[dsh-sidebar-manager/docs/FORGE-VS-SIDEBAR-UTM-MEASUREMENT.md](./dsh-sidebar-manager/docs/FORGE-VS-SIDEBAR-UTM-MEASUREMENT.md)
(UTM review: [dsh-sidebar-manager/docs/UTM-REVIEW-FORGE-VS-SIDEBAR.md](./dsh-sidebar-manager/docs/UTM-REVIEW-FORGE-VS-SIDEBAR.md)).

It sits under the standardized unified tree:

```
/home/minami/Workspace/projects/dsh-workspace/   # unified workspace root (default workspace)
└── dsh-plugins/                                 # <- DSH Plugins workspace root
```

## Agent boot and policy

Fixed reading chain — each tier is small and points at the next:

```
~/.dsh/AGENTS.md      tier 1  global rules            auto-loaded, always wins
  AGENTS.md           tier 1  project entry           auto-loaded, thin pointer only
    docs/RULES.md     tier 2  detailed project rules  read before acting
      docs/SKELETON.md tier 3 doc index               what exists, one line each
        bootcards/<ts>.md tier 4 dated session card   latest only by default
```

- `docs/DSH-HARNESS-POLICY.md` owns version, live-state, single-writer, replacement, release rules.
- `docs/SKELETON.md` and `INDEX.md` are **generated** — never hand-edit.
- Every tracked document carries a `<!-- skeleton: -->` header (version, kind, status, updated,
  summary). New docs are written in English.
- Older boot cards are historical evidence; read them only for version/policy deltas.

```bash
npm run docs:index                  # regenerate INDEX.md + docs/SKELETON.md
npm run docs:check                  # fail on missing header / stale index
npm run docs:new -- docs/X.md --kind spec --summary "one line"
npm run bootcard -- "session note"  # new dated boot card
```

## Layout

| Path | What it is |
|---|---|
| `dsh-<track>/` | one **active** plugin track: code, `CHANGELOG.md`, and its own documents under `docs/` |
| `docs/` | workspace **rules and policy** plus the records that genuinely span tracks |
| `pending-docs/` | shared documents whose lifecycle is 미승격 · 미구현 · 폐기 · 미정 |
| `bootcards/` | dated session cards, one per session |
| `archive/` | absorbed tracks, kept as evidence — nothing here is installed by any profile |
| `scripts/` | workspace gates: doc index, link check, plugin history, live-state isolation |

### Documentation homes

Every subproject owns its documentation. There is no single flat pile.

```
docs/                       workspace rules + policy + cross-track records
  RULES.md                  the rules (this file's tier-2 authority)
  SKELETON.md               generated index of the above
dsh-<track>/
  docs/
    INDEX.md                generated index of THIS track's documents
    <SPEC|DESIGN|MEASUREMENT>.md
pending-docs/
  INDEX.md                  generated index, one table per lifecycle
  unpromoted/ unimplemented/ deprecated/ undecided/
```

- **A document about one package goes in that package's `docs/`.** Not in the workspace `docs/`.
- **Each track gates itself:** `cd dsh-<track> && npm run docs:check`.
- **An undecided shared document goes to `pending-docs/`**, with a mandatory `lifecycle:` header
  field that must match its folder. Authority: [docs/RULES.md](docs/RULES.md) §6.2.
- **A document about a parent harness lives in that harness**, not here. This workspace keeps a
  pointer stub carrying the destination's SHA-256, and `scripts/check-doc-moves.mjs` fails if the
  destination is missing or has diverged (§6.2a).

```bash
npm run docs:index     # regenerate every index (workspace + pending-docs + all tracks)
npm run docs:check     # headers + indexes + every relative link
npm run docs:check:all # docs:check + per-track CHANGELOG gate
npm run docs:links     # relative-link gate alone
npm run docs:moves     # pointer-stub gate: every Moved-out destination exists and matches
```

### Active tracks

| Path | Package | Status |
|---|---|---|
| `dsh-korean-locale/` | `@nolit/dsh-korean-locale` (font stack + dictionaries) | Active, linked into the `web` profile — **git submodule**, owns its own docs |
| `dsh-sidebar-manager/` | `@nolit/dsh-sidebar-manager` right-sidebar workspace/session switcher | Active, linked into the `web` profile |
| `dsh-opencode-v2/` | `@nolit/dsh-opencode-v2` OpenCode vendor package | Active — stage plan lives in its own `docs/` |
| `dsh-antigravity/` | `@nolit/dsh-antigravity` Antigravity vendor package | Active — stage plan lives in its own `docs/` |
| `dsh-deepinfra/` | `@nolit/dsh-deepinfra` DeepInfra adapter | Active — build brief lives in its own `docs/` |
| `dsh-tokeneconomizer/` | `@nolit/dsh-tokeneconomizer` TokenEconomizer bridge | Active — saving measurement lives in its own `docs/` |
| `archive/dsh-subagent-local/` | `@nolit/dsh-subagent-local` local delegation over agy / opencode / codex / claude | **Archived 2026-11-07** — folded into `dsh-antigravity` (`agy_cli`) and `dsh-opencode-v2` (`cli_worker`) |
| `archive/dsh-subrouter/` | `@nolit/dsh-subrouter` legacy router track | **Archived 2026-11-06** — superseded by `@nolit/dsh-opencode-v2/http`; removed from every profile |
| `dsh-notify/` | `@nolit/dsh-notify` notification plugin | **Active** — in the `web` profile `dependencies`, `dsh.profile.bundles`, and composed rows (measured 2026-11-06) |
| `dsh-command-skill/` | `@nolit/dsh-command-skill` interrupt/command contract authority | **Spec track** — ships documents only; registers nothing, installed nowhere |
| `dsh-custom-router/` | `@nolit/dsh-custom-router` model-serving router | **Spec track** — documents only, no runtime surface mounted |

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
Zstandard frames. The authoritative record moved to Core-00-System on 2026-11-06:
`Core-00-System/docs/MIGRATION.md`. The stub here
([pending-docs/undecided/MIGRATION.md](./pending-docs/undecided/MIGRATION.md)) names the destination
and its digest.

## Active profile wiring

`~/.dsh/profiles/web/package.json` links the Korean locale track from its new
canonical path:

```json
"@nolit/dsh-korean-locale": "link:/home/minami/Workspace/projects/dsh-workspace/dsh-plugins/dsh-korean-locale"
```

The `web` profile links nine `@nolit` packages from their canonical checkout
paths and lists them in `dsh.profile.bundles` — run `node scripts/check-disposal-safety.mjs`
for the current measured set rather than trusting this sentence. `dsh-notify`
**is** installed there (measured 2026-11-06); earlier revisions of this file
said it was not, which was wrong.

## Provenance

The notify and sidebar-manager source trees are recovered from the historical
DSH session logs (Windows-era project trees) — see each track's
`PROVENANCE.md` / `RECOVERY-NOTES.md`.

## Prototypes vs. active plugins

- **Active in the live `web` profile:** `dsh-korean-locale`, `dsh-sidebar-manager`,
  `dsh-notify`, `dsh-tokeneconomizer`, `dsh-deepinfra`, `dsh-opencode-v2`
  and `dsh-antigravity` (bundle + link), plus the core DSH
  sidebar plugins (`ui-sidebar`, `ui-sidebar-right`, `ui-sidebar-files`, …) that
  ship with the `@deepseek-ai/dsh-web-app` bundle. Measured with
  `node scripts/check-disposal-safety.mjs --json`, not from this list.

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

## Canonical path

The only path for this workspace is `/home/minami/Workspace/projects/dsh-workspace/dsh-plugins`.
A compatibility symlink at `projects/dsh-plugins` existed from 2026-10-24 until 2026-11-06; it was
removed because **nothing used it** — not the DSH registration (`workspace.json` names this path), not
the session directories, not any script. A second spelling of one workspace is a defect, not a
convenience.