# Changelog — @nolit/dsh-antigravity-cli

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-04
summary: Engineering history for @nolit/dsh-antigravity-cli. Seeded from git history on 2026-11-04 when the owner made per-plugin history mandatory (docs/RULES.md 6.1); entries after that date follow the same rule — what changed, why, and the measured before/after.
-->



Current version: `0.0.1-rc.1`

## 0.0.1-rc.1 — version ladder; tool notice is English by default — 2026-11-05

Owner decision: every `@nolit` track reports `0.0.1-rc.N`; `0.1.0` → `0.0.1-rc.1`.

| Surface | Before | After |
| :--- | :--- | :--- |
| `package.json.version` | `0.1.0` | `0.0.1-rc.1` |
| `engines.node` | `^22.19.0 \|\| >=24.0.0` | `>=24.9` |
| `renderResult` plan notice | Korean `[PLAN_ONLY — 파일 미반영] …` on every locale | English `[PLAN_ONLY — no files changed] …`; the locale pack can translate it as copy, never a hardcoded default |
| Tests | 12/12 | 12/12 green |

rc.1 audit: command + tool registration only; no projection or app-boot import.

## [SUPERSEDED] — 2026-11-05

**This package was absorbed into `@nolit/dsh-antigravity`.** No further changes will be made here.

Surfaces moved: `/agy` command, `agy_worker` tool.

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

- `f3981ab` refactor: rename to `@nolit/dsh-antigravity-cli`, title "Antigravity Agent"
- `c0048e6` feat(agy): accept `--models` as an alias for the model list
- `1e0b373` fix(commands): declare an input descriptor so typed options reach the handler

## Entries after 2026-11-04

Add newest first. Each entry: what changed, why, and the measured before/after. A change with no
entry here is not complete.