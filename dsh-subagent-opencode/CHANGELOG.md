# Changelog — @nolit/dsh-subagent-opencode

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-04
summary: Engineering history for @nolit/dsh-subagent-opencode. Seeded from git history on 2026-11-04 when the owner made per-plugin history mandatory (docs/RULES.md 6.1); entries after that date follow the same rule — what changed, why, and the measured before/after.
-->



Current version: `0.0.1-rc.1`

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

**This package was absorbed into `@nolit/dsh-opencode-v2`.** No further changes will be made here.

Surfaces moved: `subagent_opencode` provider.

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