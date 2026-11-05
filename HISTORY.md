# Plugin History — the main chain

<!-- skeleton:
version: 1.0
kind: index
status: active
updated: 2026-11-05
summary: The main plugin-history chain for this workspace — one chronological record of vendor merges, archived tracks, version ladders and live-state debt, linking each per-plugin CHANGELOG instead of duplicating it.
-->

> **This is the main history chain. Each plugin's own history stays in `dsh-<track>/CHANGELOG.md`.**
> This file records what spans several tracks: a vendor merge, a version-policy change, a track
> being archived, and the live-state debt that was left behind. Per-rule authority:
> [docs/RULES.md](docs/RULES.md) §6.1. Mistakes and their standing rules:
> [docs/FAILURE-LEDGER.md](docs/FAILURE-LEDGER.md).
>
> Read order for a new agent: `AGENTS.md` → `docs/RULES.md` → `docs/FAILURE-LEDGER.md` →
> **this file** → the plugin's own CHANGELOG.

## 1. Structure going forward (owner instruction 2026-11-05)

| Location | Meaning | Installed? | Owns CHANGELOG |
| :--- | :--- | :--- | :--- |
| `dsh-<track>/` | an **active** track | yes, in some profile | yes, required |
| `archive/dsh-<track>/` | an **absorbed** track, kept as history | **no** | yes, kept with an `ARCHIVED` banner |
| `staging/<track>/` | code held for a later stage | **no** | n/a |

Authority: [docs/PLUGIN-CONSOLIDATION.md](docs/PLUGIN-CONSOLIDATION.md) §2.1.

**A track that is merged into a vendor package must be archived in the same round that removes it
from the profile.** "Superseded but still in the active tree" is not a stable state — it is the
state that produced the defects in §3.

## 2. Chronological chain

### 2026-11-05 — vendor consolidation (one package per vendor)

| Vendor | Package | Surfaces |
| :--- | :--- | :--- |
| Antigravity | `@nolit/dsh-antigravity` | `antigravity` model route, `/agy`, `agy_worker`, `antigravity` subagent provider + `subagent_antigravity`, settings section, usage chip |
| OpenCode | `@nolit/dsh-opencode-v2` | `opencode` tool, `/ocode`, `cli_worker`, `opencode-http-agent` route, `opencode` subagent provider + `subagent_opencode` |
| Local CLI (new, experimental) | `@nolit/dsh-subagent-local` | `delegate_local` over agy / opencode / codex / claude |

Why one package per vendor: a duplicate `ctx.subagents.registerProvider` name silently shadows the
other provider, and a duplicate tool/command name aborts the whole plugin row. Two packages cannot
both serve one vendor.

### 2026-11-05 — DSH `0.2.2-rc.1` migration (all tracks)

Version ladder normalized to `0.0.1-rc.N`; `engines.node` raised to `>=24.9`; Korean pack
regenerated against rc.1 (69 ns / 3,088 keys → **74 ns / 3,843 keys**); English became the default
with Korean only when the active locale is `ko`; per-provider chips moved to
`conversation.input.right`; TokenEconomizer gained per-turn/per-step developer statistics.

Per-track detail: each `dsh-<track>/CHANGELOG.md` `0.0.1-rc.N` entry, plus
[docs/DSH-RC1-PLUGIN-DELTA.md](docs/DSH-RC1-PLUGIN-DELTA.md) for the release-level delta.

### 2026-11-05 — four tracks archived

| Track | Absorbed into | Was still in the active tree until |
| :--- | :--- | :--- |
| `dsh-antigravity-directsdk` | `@nolit/dsh-antigravity` | archived in the first round |
| `dsh-antigravity-cli` | `@nolit/dsh-antigravity` | **second round, only after the owner objected** |
| `dsh-subagent-antigravity` | `@nolit/dsh-antigravity` | **second round, only after the owner objected** |
| `dsh-subagent-opencode` | `@nolit/dsh-opencode-v2` | **second round, only after the owner objected** |

## 3. Debt this chain recorded and why it is written here

The 2026-11-05 session produced three failures of the same family — **an absorbed thing was left
where it was** — plus one process failure. They are recorded here because they span tracks, and in
the per-track CHANGELOG where a specific package was involved.

| # | What happened (measured) | What should have happened | Recorded in |
| :--- | :--- | :--- | :--- |
| H-1 | Only `dsh-antigravity-directsdk` was archived. `dsh-antigravity-cli`, `dsh-subagent-antigravity` and `dsh-subagent-opencode` stayed in the active tree **after** their surfaces were being served by the merged packages. The owner had to say "이미 서브에이전트는 안티그래비티에 통합되어 서비스 되고 있는데 … 서브에이전트도 아카이브에 들어가야 하는거 잖아". | Apply the archive rule to **every** absorbed track in the same round, not only the one the owner named. | [docs/FAILURE-LEDGER.md](docs/FAILURE-LEDGER.md) F-50 |
| H-2 | The live profile kept two **broken** `node_modules/@nolit` symlinks (`dsh-subagent-antigravity`, `dsh-subagent-opencode`) after the packages were removed from `package.json`. Measured: absent from `dependencies`, from `dsh.profile.bundles`, from `pnpm-lock.yaml`, from `.modules.yaml`, from `cordis.yml`, and 0 rows in `--dump-config` — they were pure residue. Removed 2026-11-05 with a manifest at `~/.dsh/quarantine-backups/broken-links-20261105_151848.txt`; afterwards all 9 remaining `@nolit` links resolve. | Removing a package from the profile is **three** actions: drop the dependency, drop the bundle row, remove the link. Verify with `readlink` + `[ -e ]` and report broken links in the same reply. | [docs/FAILURE-LEDGER.md](docs/FAILURE-LEDGER.md) F-51 |
| H-3 | Context was lost about an earlier merge: the session re-derived what was already decided and I had to be told the merge had happened. The measurement existed in `docs/PLUGIN-CONSOLIDATION.md` but was not read before acting. | Read `docs/PLUGIN-CONSOLIDATION.md` §2 **before** touching anything vendor-related; it is the record of what is absorbed. | [docs/FAILURE-LEDGER.md](docs/FAILURE-LEDGER.md) F-52 |
| H-4 | A live API key was printed into teammate session logs while inspecting the live profile patch during isolated-boot setup (tool results, 9 logs, plus the derived search index). | Mask credential values **before** any `cat`/`grep`/`sed` on a profile patch. | [docs/FAILURE-LEDGER.md](docs/FAILURE-LEDGER.md) F-49 |

## 4. Open items handed to the next session (owner: "하지 못한 처리하지 못한 건 다음에 처리하자")

| # | Item | Measured state | Next action |
| :--- | :--- | :--- | :--- |
| P-1 | **Restart** the live service to apply everything | `dsh-web.service` running; host modules changed on disk since boot | `systemctl --user restart dsh-web.service`, then verify the checklist in §5 |
| P-2 | Orphan session cleanup | dry run finds **2** removable (`/tmp/te-ms`, `/tmp/te-side-test`); 22 unregistered logs are **linked children** and must stay | re-run `node scripts/cleanup-orphan-sessions.mjs`, then `--apply --approve <digest>` (digest at handoff: `b6f3d0e929260f35`) |
| P-3 | Leaked DeepInfra key | in 9 session logs + `~/.dsh/session-search.db`(+`-wal`) + 3 quarantine patch copies; **not** in the repo, not in any commit, not in a prompt body | owner decision on rotation; if rotating is impractical, purge the logs + the derived index (it rebuilds) |
| P-4 | `dsh-subrouter` and `dsh-command-skill` are active tracks that no profile installs | `installed=False`, `bundled=False` for both on the `web` profile | decide: install, or archive with the same bar as §1 |
| P-5 | Bootcard claims `Runtime: DSH 0.2.2-alpha.3` | measured live version is `0.2.2-rc.1` | regenerate the bootcard (`npm run bootcard -- "…"`) |
| P-6 | `total_skill` (`@nolit/dsh-skill-interrupt`) still reports `0.1.0` | separate repository, not part of the `0.0.1-rc.N` normalization | owner decision; it is outside this workspace's single-writer scope |
| P-7 | Old-version artifacts in `artifacts/` | 40+ `.tgz` including `0.9.0`, `0.8.0`, `0.7.x` | keep as release history or prune; not blocking |

## 5. Restart verification checklist (for P-1)

1. Plugins page lists `로컬 CLI 위임 (실험적)` in addition to the existing tracks.
2. Antigravity turn stores its answer in the transcript (rc.6 fix).
3. Chips: Antigravity usage, DeepInfra cost, OpenCode cost — all left of the model selector, and
   absent on a foreign provider.
4. `/agy` and `/ocode` return a child session id immediately; the answer arrives as a completion
   notice; no new top-level "그룹 없음" row appears.
5. No `did not activate` / `Invalid effect` in the boot log.

## 6. Related

- [docs/PLUGIN-CONSOLIDATION.md](docs/PLUGIN-CONSOLIDATION.md) — which packages are absorbed, archived, staged.
- [docs/FAILURE-LEDGER.md](docs/FAILURE-LEDGER.md) — every mistake and its standing rule.
- [docs/DSH-RC1-PLUGIN-DELTA.md](docs/DSH-RC1-PLUGIN-DELTA.md) — the rc.1 plugin-facing delta.
- [archive/README.md](archive/README.md) — the four archived tracks and the measured bar for archiving.
