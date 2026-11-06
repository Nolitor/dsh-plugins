# Changelog — @nolit/dsh-subrouter

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-04
summary: Engineering history for @nolit/dsh-subrouter. Seeded from git history on 2026-11-04 when the owner made per-plugin history mandatory (docs/RULES.md 6.1); entries after that date follow the same rule — what changed, why, and the measured before/after.
-->

> History lives here (owner instruction 2026-11-04). Boot cards and `AGENTS.md` are narrowed to
> the owner's unfinished asks; they are not a changelog. See [docs/RULES.md](../docs/RULES.md) §6.1.

Current version: `0.0.1-rc.1`


## 0.0.1-rc.1 — version ladder + rc.1 metadata — 2026-11-05

Owner decision: every `@nolit` track reports `0.0.1-rc.N`; `0.1.0` → `0.0.1-rc.1`.

| Surface | Before | After |
| :--- | :--- | :--- |
| `package.json.version` | `0.1.0` | `0.0.1-rc.1` |
| `engines.node` | `^22.19.0 \|\| >=24.0.0` | `>=24.9` |
| Display metadata | none | `locale/en.json` + `locale/ko.json` (meta only), exported as `./locale/*.json` and shipped |
| Tests | 12/12 | 12/12 green |

rc.1 audit: provider-only host plugin — no client half, no tool registration, no projection or
app-boot import; `cordis` is not a peer here and stays absent.

## Seeded history (from git, before this file existed)

The commits below predate this file. They are the record of what shipped, quoted from the
repository history rather than rewritten:

- `e709ec3` feat(subrouter): umbrella model-API plugin and DSH-native tiering fix
- `2640cff` docs: subrouter regression, defects, and ordered recovery plan

## Entries after 2026-11-04

Add newest first. Each entry: what changed, why, and the measured before/after. A change with no
entry here is not complete.
