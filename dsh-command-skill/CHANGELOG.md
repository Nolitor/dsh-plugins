# Changelog — @nolit/dsh-command-skill

<!-- skeleton:
version: 1.0
kind: report
status: active
updated: 2026-11-04
summary: Engineering history for @nolit/dsh-command-skill. Seeded from git history on 2026-11-04 when the owner made per-plugin history mandatory (docs/RULES.md 6.1); entries after that date follow the same rule — what changed, why, and the measured before/after.
-->

> History lives here (owner instruction 2026-11-04). Boot cards and `AGENTS.md` are narrowed to
> the owner's unfinished asks; they are not a changelog. See [docs/RULES.md](../docs/RULES.md) §6.1.

Current version: `0.0.1-rc.1`

## test harness — `verify-contract.mjs` composes an isolated DSH_HOME — 2026-11-05

**Owner task (2026-11-05): CLI/test DSH_HOME isolation.** `scripts/verify-contract.mjs` ran
`dsh --profile <name> --dump-config` against the live home. `--dump-config` calls
`prepareProfile()`, which **writes** `profiles/<name>/cordis.yml`; in the sandbox that surfaced as
`EROFS`/read-only errors, outside the sandbox it was a real live write.

| Surface | Before | After |
| :--- | :--- | :--- |
| Dump target | live `DSH_HOME` (profile compose wrote live state) | temp `DSH_HOME` built from a copy of the live profile (package.json, cordis.yml, cordis.patch.yml, node_modules symlink); copied patch's absolute `$HOME/.dsh` values rewritten to the temp home; temp removed in `finally` |
| Contract checks | skill row / tokeneconomizer row / tierMinChars / watchdogAction | unchanged — the same resolved profile is dumped, just in a throwaway home |
| Guard | `scripts/check-dsh-isolation.mjs` reported `spawn-dsh-without-DSH_HOME` | guard reports **0 violations** |


## 0.0.1-rc.1 — version ladder + rc.1 Node minimum — 2026-11-05

Owner decision: every `@nolit` track reports `0.0.1-rc.N`; `0.1.0` → `0.0.1-rc.1`.

| Surface | Before | After |
| :--- | :--- | :--- |
| `package.json.version` | `0.1.0` | `0.0.1-rc.1` |
| `engines.node` | absent | `>=24.9` (DSH 0.2.2-rc.1 minimum) |
| `check` | `node --check scripts/verify-contract.mjs` | green |

This track is documentation/contract authority: it is `private: true`, declares no Loader entry and
registers nothing at runtime, so it has no user-facing copy to localize and no rc.1 plugin surface to
migrate.

## Seeded history (from git, before this file existed)

The commits below predate this file. They are the record of what shipped, quoted from the
repository history rather than rewritten:

- `ebc4aa5` feat(command-skill): contract authority, watchdog self-reset fix
- `0c82209` docs: preserve research artifacts, provenance, boot card refresh
- `5fba56a` tokeneconomizer entry that also touched this track

## Entries after 2026-11-04

Add newest first. Each entry: what changed, why, and the measured before/after. A change with no
entry here is not complete.
