# DSH Plugins — Agent Entry

<!-- skeleton:
version: 3.1
kind: index
status: active
updated: 2026-11-04
summary: Tier-1 auto-loaded entry. Points to detailed rules, the doc skeleton index, active plans, and the latest boot card. Keep it tiny.
-->

**Auto-loaded. This is a pointer, not a rulebook — keep it under ~40 lines.**

## Read in this order

| # | Tier | File | When |
|---|---|---|---|
| 1 | global rules | `~/.dsh/AGENTS.md` | always wins |
| 2 | project rules | [docs/RULES.md](docs/RULES.md) | **read before acting** |
| 3 | doc index | [docs/SKELETON.md](docs/SKELETON.md) | to find which doc answers your question |
| 4 | session card | latest boot card below | current state, active task |
| 5 | cross-project | [docs/CROSS-PROJECT-COLLABORATION.md](dsh-command-skill/docs/CROSS-PROJECT-COLLABORATION.md) | changes touching the interrupt boundary or `projects/total_skill` |
| 6 | **plugin map** | [docs/PLUGIN-CONSOLIDATION.md](docs/PLUGIN-CONSOLIDATION.md) | **before installing, removing, or reinstalling ANY plugin** — some packages in this repo are superseded |

Older boot cards are historical evidence; open them only for a version/policy delta.

## Active plans

- [docs/OPENCODE-V2-STAGE-PLAN.md](docs/OPENCODE-V2-STAGE-PLAN.md) — stage 1 (stabilisation) in progress; stages 2–3 gated on it. Check with `scripts/opencode-v2-stabilisation-status.sh`.
- [docs/DEEPINFRA-ADAPTER-BRIEF.md](docs/DEEPINFRA-ADAPTER-BRIEF.md) — next session; five keyed questions answered before any code.

## Latest boot card

<!-- LATEST_BOOT_CARD:START -->
Latest boot card: [bootcards/2026-11-04T2041+0900.md](bootcards/2026-11-04T2041+0900.md)
Generated: 2026-11-04T2041+0900 (KST)
Read only this latest card by default; older cards are historical evidence.
<!-- LATEST_BOOT_CARD:END -->

## Non-negotiable (full text in docs/RULES.md)

1. **Measure first** — report measured facts before acting.
2. **Live state is the user's** — no writes to `~/.dsh` or restarts of 3080 without approval.
3. **Single writer** — write only inside your assigned `dsh-<track>/`; assert `package.json.name`.
4. **Plugin replacement is 4 steps** — disable → remove → add → verify by **real mount**
   (`--dump-config` passing does NOT prove a plugin mounts).
5. **Sidebar Manager drift gate** — run `node scripts/audit-installed-vs-packaged.mjs` before any version-up.
6. **Docs** — English + skeleton header + `npm run docs:index`. **Plugin history → `dsh-<track>/CHANGELOG.md`**, never boot cards; done needs measured before/after (§6.1). New upstream → diff the exact tag, never master (§6.2).
7. **Cross-project contract** — `total_skill` is a separate repository joined at runtime. Duplicate command/skill names are a **hard mount failure**; read the contract first.
8. **Superseded packages** — `dsh-antigravity-cli`, `dsh-subagent-antigravity` and `dsh-subagent-opencode` are **absorbed**; their READMEs say so. A duplicate subagent provider name is silently shadowed, not rejected — check [docs/PLUGIN-CONSOLIDATION.md](docs/PLUGIN-CONSOLIDATION.md) before reinstalling.

## Commands

```bash
npm run docs:index    # regenerate INDEX.md + docs/SKELETON.md
npm run docs:check    # fail on missing skeleton headers or stale indexes
node scripts/check-plugin-history.mjs    # every plugin track owns its CHANGELOG
npm run bootcard -- "session note"   # new dated boot card
```
