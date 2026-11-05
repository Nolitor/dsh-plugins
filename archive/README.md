# archive/ — absorbed plugin tracks, kept as history

<!-- skeleton:
version: 1.0
kind: index
status: reference
updated: 2026-11-05
summary: What lives under archive/, the measured bar a track must clear before it is moved here, and the rule that nothing here is installed by any profile.
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

`docs/PLUGIN-CONSOLIDATION.md` §2.1 is the authority for the three locations
(`dsh-<track>/` active, `archive/` absorbed, `staging/` staged-but-not-installed).

| Track | Absorbed into | Archived | Why |
| :--- | :--- | :--- | :--- |
| `dsh-antigravity-directsdk` | `@nolit/dsh-antigravity` | 2026-11-05 | owner: "통합되어서 안쓰는거 아닌가 … 예전버전이면 아카이브에 보관해". Its `antigravity` provider route is now registered by the merged package, and two registrations of the same route cannot coexist. 25/25 tests still pass. |
