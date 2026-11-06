# Changelog — @nolit/dsh-sidebar-manager

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-04
summary: Engineering history for @nolit/dsh-sidebar-manager. Seeded from git history on 2026-11-04 when the owner made per-plugin history mandatory (docs/RULES.md 6.1); entries after that date follow the same rule — what changed, why, and the measured before/after.
-->

> History lives here (owner instruction 2026-11-04). Boot cards and `AGENTS.md` are narrowed to
> the owner's unfinished asks; they are not a changelog. See [docs/RULES.md](../docs/RULES.md) §6.1.

Current version: `0.0.1-rc.1`

## classifier — linked child sessions get their own label — 2026-11-05

**Owner task (2026-11-05): the cleanup plan must never propose a subagent child session.**
Measured live: of 22 `unregistered` logs, **20 are linked child sessions** (`origin:"subagent"`,
`parentSession:"session-…"`, `delegationDepth:1`); only **2** are true standalone orphans
(`/tmp/te-ms`, `/tmp/te-side-test`, `delegationDepth:0`). Before this change the classifier
reported all 22 as `unregistered` and the "disconnected" count included the children.

| Surface | Before | After |
| :--- | :--- | :--- |
| Labels | `bound`, `unregistered`, `legacy-orphan`, `binding-mismatch`, `unreadable` | adds **`child`** for a linked child session (any of `parentSession`, `origin: "subagent"`, `delegationDepth > 0`), with `reason` naming the parent/origin/depth; existing labels unchanged |
| Entry fields for children | — | `parentSession`, `origin`, `delegationDepth` projected onto the entry |
| Summary | `disconnected` = every non-`bound` log (22) | `disconnected` excludes `bound` **and** `child` (**2**); new `linkedChildren` count (**20**) |
| `byCwd` | every non-`bound` log | excludes children too (they are not disconnected history) |
| Test coverage | empty-home read-only check only | linked child (parent pointer), child via `origin`+`delegationDepth`, `bound`, standalone orphan, malformed log |
| Live dry-run (read-only) | `{"bound":98,"unregistered":22}` | `{"bound":98,"child":20,"unregistered":2}`; cleanup plan proposes only the 2 standalone logs |
| Tests | 142 passing | **145 passing** |

No destructive behavior was added: the classifier stays read-only (`destructive:false`), and the
owner-runnable quarantine plan lives in `scripts/cleanup-orphan-sessions.mjs`
([pending-docs/unpromoted/ORPHAN-SESSION-CLEANUP.md](../pending-docs/unpromoted/ORPHAN-SESSION-CLEANUP.md)).



## 0.0.1-rc.1 — version ladder + English-by-default locale — 2026-11-05

Owner decision (2026-11-05): normalize every `@nolit` track to `0.0.1-rc.N`; this track moved
`0.1.2` → `0.0.1-rc.1`.

| Surface | Before | After |
| :--- | :--- | :--- |
| `package.json.version` | `0.1.2` | `0.0.1-rc.1` |
| `engines.node` | `>=24` | `>=24.9` (DSH 0.2.2-rc.1 minimum) |
| Locale resolution | DSH locale, then `navigator.language` | DSH locale only; English unless the active language is `ko` |
| Tests | 142/142 | 142/142 green |

rc.1 audit: no `tools.resolve`/`executable` read, no Session Projection, no app-boot import;
client inject list unchanged and the bundle already declares `manifestVersion: 1`.

## Seeded history (from git, before this file existed)

The commits below predate this file. They are the record of what shipped, quoted from the
repository history rather than rewritten:

- `50f50d8` harness bootstrap
- `457c5c6` release: v0.1.2 advisory worktree guardrails
- `61c44d8` fix(plugins): native menu typography, grouping and settings panel

## Entries after 2026-11-04

Add newest first. Each entry: what changed, why, and the measured before/after. A change with no
entry here is not complete.
