# Changelog — @nolit/dsh-subagent-antigravity

> ## ⚠️ ARCHIVED — superseded by `@nolit/dsh-antigravity`
>
> Absorbed 2026-11-05 and moved to `archive/` the same day on owner instruction. The
> the `antigravity` subagent provider (`subagent_antigravity` tool row plus `lib/subagent.js`) now live in `@nolit/dsh-antigravity`. Kept as the historical record; do not
> install.

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-04
summary: Engineering history for @nolit/dsh-subagent-antigravity. Seeded from git history on 2026-11-04 when the owner made per-plugin history mandatory (docs/RULES.md 6.1); entries after that date follow the same rule — what changed, why, and the measured before/after.
-->



Current version: `0.0.1-rc.1`

## 2026-11-05 — archived as an absorbed track (no version change) — `0.0.1-rc.1`

Moved from `dsh-subagent-antigravity/` to `archive/dsh-subagent-antigravity/`. The `antigravity`
subagent provider and the `subagent_antigravity` tool row have been served by
`@nolit/dsh-antigravity` since the 2026-11-05 merge.

### Measured at archival

| Check | Measured |
| :--- | :--- |
| provider `antigravity` registered by | `@nolit/dsh-antigravity/lib/index.js` |
| live `--dump-config` row `tool-subagent-antigravity` supplied by | `@nolit/dsh-antigravity` (`# == @nolit/dsh-antigravity`) |
| rows owned by THIS package | **0** |
| profile `dependencies` / `dsh.profile.bundles` | absent / absent |
| broken `node_modules/@nolit/dsh-subagent-antigravity` link in the live profile | **was present**, removed the same day ([F-51](../../docs/FAILURE-LEDGER.md)); a manifest is kept at `~/.dsh/quarantine-backups/broken-links-20261105_151848.txt` |
| its own tests | **6/6 pass** — superseded, not broken |

### Process note

The owner corrected the handoff: "이미 서브에이전트는 안티그래비티에 통합되어 서비스 되고 있는데 …
서브에이전트도 아카이브에 들어가야 하는거 잖아". Both halves of that — the directory and the stale
profile link — are now recorded as standing rules
([HISTORY.md H-1/H-2](../../HISTORY.md), [F-50/F-51](../../docs/FAILURE-LEDGER.md)).

## 0.0.1-rc.1 — version ladder for a superseded package — 2026-11-05

Owner decision: every `@nolit` track reports `0.0.1-rc.N`; `0.1.0` → `0.0.1-rc.1`. The package
remains superseded (see the entry below); version normalization does not change its status or source.

| Surface | Before | After |
| :--- | :--- | :--- |
| `package.json.version` | `0.1.0` | `0.0.1-rc.1` |
| `engines.node` | `^22.19.0 \|\| >=24.0.0` | `>=24.9` |
| Display metadata | `locale/en.json` + `locale/ko.json` | unchanged, complete |
| Tests | 6/6 | 6/6 green |

rc.1 audit: provider-only registration; no tool row, no projection, no app-boot import.

## [SUPERSEDED] — 2026-11-05

**This package was absorbed into `@nolit/dsh-antigravity`.** No further changes will be made here.

Surfaces moved: `subagent_antigravity` provider.

The merge happened because two packages cannot both register the same provider or tool name:
`ctx.subagents.registerProvider` does not reject a duplicate name, so the second registration
silently shadows the first, and a duplicate tool/command name aborts the entire plugin row.

The replacement yields with a warning when it finds this package provider already registered,
so a profile that still carries both does not lose a surface silently.

Source of this package is unchanged and its tests still pass. It is superseded, not broken.


> History lives here (owner instruction 2026-11-04). Boot cards and `AGENTS.md` are narrowed to
> the owner's unfinished asks; they are not a changelog. See [docs/RULES.md](../../docs/RULES.md) §6.1.

## Seeded history (from git, before this file existed)

The commits below predate this file. They are the record of what shipped, quoted from the
repository history rather than rewritten:

- `bee228f` feat: add the Antigravity and OpenCode subagent provider bundles

## Entries after 2026-11-04

Add newest first. Each entry: what changed, why, and the measured before/after. A change with no
entry here is not complete.