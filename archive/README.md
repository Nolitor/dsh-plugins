# archive/ — absorbed plugin tracks, kept as history

<!-- skeleton:
version: 1.0
kind: index
status: reference
updated: 2026-11-05
summary: What lives under archive/ (four absorbed tracks: directsdk, antigravity-cli, subagent-antigravity, subagent-opencode), the measured bar a track must clear before it is moved here, and the rule that nothing here is installed by any profile.
-->

**Nothing in this directory is installed, linked, packed, or imported by a shipped package.**

A track lands here only after it is measured dead:

1. Not listed in any live profile `package.json` (`dependencies` and `dsh.profile.bundles`).
2. Zero hits in `dsh --profile web --dump-config`.
3. No `@nolit` node_modules link pointing at it.
4. No active package imports it (`grep -rn "<track>" dsh-*/lib/*.js` is empty).
5. Its replacement exists, is mounted, and covers the surfaces it used to serve.

Moving a track here is a **move, not a delete**: the CHANGELOG and README stay, each with an
`ARCHIVED` banner naming the replacement. `node_modules/` inside an archived track is local
symlink scaffolding and is gitignored.

The chain of these moves is [HISTORY.md](../HISTORY.md) §2–§3.
`docs/PLUGIN-CONSOLIDATION.md` §2.1 is the authority for the three locations
(`dsh-<track>/` active, `archive/` absorbed, `staging/` staged-but-not-installed).

| Track | Absorbed into | Archived | Surface now served by the replacement |
| :--- | :--- | :--- | :--- |
| `dsh-antigravity-directsdk` | `@nolit/dsh-antigravity` | 2026-11-05 | the `antigravity` provider route (`ctx.llm.registerAdapter`) |
| `dsh-antigravity-cli` | `@nolit/dsh-antigravity` | 2026-11-05 | `/agy` command, `agy_worker` tool |
| `dsh-subagent-antigravity` | `@nolit/dsh-antigravity` | 2026-11-05 | `antigravity` subagent provider + `subagent_antigravity` row |
| `dsh-subagent-opencode` | `@nolit/dsh-opencode-v2` | 2026-11-05 | `opencode` subagent provider + `subagent_opencode` row |

Owner instruction for the subagent moves (2026-11-05): "이미 서브에이전트는 안티그래비티에 통합되어
서비스 되고 있는데 … 서브에이전트도 아카이브에 들어가야 하는거 잖아". The earlier round archived only
`directsdk`; that was an incomplete read of the same rule, and the three remaining absorbed tracks
were moved in the follow-up.
