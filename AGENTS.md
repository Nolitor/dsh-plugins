# DSH Plugins — Agent Entry

<!-- skeleton:
version: 4.0
kind: index
status: active
updated: 2026-11-06
summary: Tier-1 auto-loaded entry. Points to the rules, the doc index, per-subproject doc homes, and the latest boot card. Keep it tiny.
-->

**Auto-loaded. This is a pointer, not a rulebook — keep it under ~40 lines.**

## Read in this order

| # | Tier | File | When |
|---|---|---|---|
| 1 | global rules | `~/.dsh/AGENTS.md` | always wins |
| 2 | project rules | [docs/RULES.md](docs/RULES.md) | **read before acting** |
| 3 | doc index | [docs/SKELETON.md](docs/SKELETON.md) | workspace docs, plus every subproject's own index |
| 4 | session card | latest boot card below | current state, active task |
| 5 | cross-project | [docs/CROSS-PROJECT-COLLABORATION.md](dsh-command-skill/docs/CROSS-PROJECT-COLLABORATION.md) | changes touching the interrupt boundary or `projects/total_skill` |

Older boot cards are historical evidence; open them only for a version/policy delta.

## Where documentation lives

| Home | Holds | Index |
|---|---|---|
| `docs/` | rules + policy + records that span tracks | [docs/SKELETON.md](docs/SKELETON.md) |
| `dsh-<track>/docs/` | everything about that one package | `dsh-<track>/docs/INDEX.md` |
| `pending-docs/` | shared docs that are 미승격 · 미구현 · 폐기 · 미정 | [pending-docs/INDEX.md](pending-docs/INDEX.md) |

A per-package document belongs in that package's `docs/`, never in the workspace `docs/`.
An undecided shared document belongs in `pending-docs/`, never in `docs/` (RULES §6.2).

## Active plans

- [archive/dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md](archive/dsh-opencode-v2/docs/OPENCODE-V2-STAGE-PLAN.md) — stage 1 (stabilisation) in progress; stages 2–3 gated on it. Check with `scripts/opencode-v2-stabilisation-status.sh`.
- [dsh-custom-router/vendor/deepinfra/docs/DEEPINFRA-ADAPTER-BRIEF.md](dsh-custom-router/vendor/deepinfra/docs/DEEPINFRA-ADAPTER-BRIEF.md) — vendored integration reference; the five keyed questions are answered by the measured build.

## Latest boot card

<!-- LATEST_BOOT_CARD:START -->
Latest boot card: [bootcards/2026-11-14T1044+0900.md](bootcards/2026-11-14T1044+0900.md)
Generated: 2026-11-14T1044+0900 (KST)
Read only this latest card by default; older cards are historical evidence.
<!-- LATEST_BOOT_CARD:END -->

## Non-negotiable (full text in docs/RULES.md)

1. **Measure first** — report measured facts before acting.
2. **Live state is the user's** — no writes to `~/.dsh` or restarts of 3080 without approval.
3. **Single writer** — write only inside your assigned `dsh-<track>/`; assert `package.json.name`.
4. **Plugin replacement is 4 steps** — disable → remove → add → verify by **real mount**
   (`--dump-config` passing does NOT prove a plugin mounts).
5. **Sidebar Manager drift gate** — run `node scripts/audit-installed-vs-packaged.mjs` before any version-up.
6. **Docs** — English + skeleton header. **Per-package doc → `dsh-<track>/docs/`** with its own index; undecided shared doc → `pending-docs/` (§6.1b, §6.2). **Plugin history → `dsh-<track>/CHANGELOG.md`**, never boot cards (§6.1). New upstream → diff the exact tag, never master (§6.3). Links must resolve (§6.0c).
7. **Cross-project contract** — `total_skill` is a separate repository joined at runtime. Duplicate command/skill names are a **hard mount failure**; read the contract first.

## Commands

```bash
npm run docs:index    # regenerate ALL indexes (workspace + pending-docs + every track)
npm run docs:check    # fail on missing headers, stale indexes, or broken relative links
npm run docs:check:all # docs:check + per-track CHANGELOG gate
node scripts/check-plugin-history.mjs    # every plugin track owns its CHANGELOG
npm run bootcard -- "session note"   # new dated boot card
```
