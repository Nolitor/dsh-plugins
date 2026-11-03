# DSH Plugins — Agent Entry

<!-- skeleton:
version: 3.0
kind: index
status: active
updated: 2026-10-29
summary: Tier-1 auto-loaded entry. Points to detailed rules, the doc skeleton index, and the latest boot card. Keep it tiny.
-->

**This file is auto-loaded. It is a pointer, not a rulebook — keep it under ~40 lines.**

## Read in this order

| # | Tier | File | When |
|---|---|---|---|
| 1 | global rules | `~/.dsh/AGENTS.md` | already loaded, always wins |
| 2 | project rules | [docs/RULES.md](docs/RULES.md) | **read before acting** |
| 3 | doc index | [docs/SKELETON.md](docs/SKELETON.md) | to find which doc answers your question |
| 4 | session card | latest boot card below | current state, active task |
| 5 | cross-project | [docs/CROSS-PROJECT-COLLABORATION.md](dsh-command-skill/docs/CROSS-PROJECT-COLLABORATION.md) | any change touching the interrupt boundary or `projects/total_skill` |

Older boot cards are historical evidence; open them only for a version/policy delta.

## Latest boot card

<!-- LATEST_BOOT_CARD:START -->
Latest boot card: [bootcards/2026-11-04T0102+0900.md](bootcards/2026-11-04T0102+0900.md)
Generated: 2026-11-04T0102+0900 (KST)
Read only this latest card by default; older cards are historical evidence.
<!-- LATEST_BOOT_CARD:END -->

## Non-negotiable (full text in docs/RULES.md)

1. **Measure first** — report measured facts before acting.
2. **Live state is the user's** — no writes to `~/.dsh` or restarts of 3080 without approval.
3. **Single writer** — write only inside your assigned `dsh-<track>/`; assert `package.json.name`.
4. **Plugin replacement is 4 steps** — disable → remove → add → verify by **real mount**
   (`--dump-config` passing does NOT prove a plugin mounts).
5. **Sidebar Manager drift gate** — run `node scripts/audit-installed-vs-packaged.mjs` before
   any version-up.
6. **Docs** — English, and every doc needs a `<!-- skeleton: -->` header; run `npm run docs:index`.
7. **Cross-project contract** — `total_skill` is a separate repository joined to this one at
   runtime. Duplicate command/skill names are a **hard mount failure**; read the contract before
   touching `/interrupt`, `interrupt-guide`, or the watchdog bridge.

## Commands

```bash
npm run docs:index    # regenerate INDEX.md + docs/SKELETON.md
npm run docs:check    # fail on missing skeleton headers or stale indexes
npm run bootcard -- "session note"   # new dated boot card
```
