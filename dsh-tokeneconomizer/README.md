# @nolit/dsh-tokeneconomizer

<!-- skeleton:
version: 1.5
kind: readme
status: active
updated: 2026-11-08
summary: DSH 0.2.2 bridge for microsoft/TokenEconomizer: lifecycle mapping, in-memory tool mask, DSH trace reader, guarded migration, prior-session recall through the harness index, host-local in-memory features, and the Web developer-statistics card.
-->

DSH-side bridge for [microsoft/TokenEconomizer](https://github.com/microsoft/TokenEconomizer) (Apache-2.0,
pinned commit `6141bb92`). The economical behaviour stays in TokenEconomizer's stdlib-only Python
engine; this package translates the DeepSeek Harness agent lifecycle into the hook contract that
engine already speaks, and applies its answers with DSH's own levers.

Host-local features run in the Host process with `node:` builtins only: tool-result hash
deduplication, a KV-cache-safe prompt slot, a loop breaker with an advisory thinking watchdog, and
the turn-based tiered memory that keeps the newest turns whole, summarizes the middle ones and
evicts the old ones. They are described in
[docs/IN_MEMORY_FEATURES.md](docs/IN_MEMORY_FEATURES.md).

Two things in `0.2.0` are deliberately not a new store:

- **Prior-session recall** asks the harness's own FTS5 index (`ctx.sessionQuery`) for earlier
  sessions of the same repository. This package never opens or writes that database; when the
  composition leaves search disabled the recall is a silent no-op.
- **Repository keys** (`lib/repokey.js`) reproduce the engine's `repos/<slug>-<sha1[:10]>` rule in
  pure Node, so a session's `cwd` maps to the same key without a second identifier scheme.

| Mechanism | DSH lever | Written where |
|---|---|---|
| micro-skills (learned repository facts) | `systemPrompt.context()` on the agent's scope | session context only |
| tool pruning (evidence-based deny list) | `tools.restrict({ deny })` on the agent's scope | memory; no source config is edited |
| loop guard (redirect a stuck turn) | `agent.inject()` of one user-role context | session log, through the inbox event |
| prior-session recall | `agent.inject()` once, from `ctx.sessionQuery.searchSessions` | session log; the index belongs to DSH |
| session digest | decompressed session export, then detached `te fold` | `$TOKENECONOMIZER_HOME` |
| tool-result dedup | `tools/post-execute` content replacement | memory; the pointer is logged with the result |
| KV-cache-safe prefix slot (+ Think-in-Code routing) | `systemPrompt.section()` on the agent's scope | memory; the text lives in the request's first message |
| loop breaker and thinking watchdog | `agent.inject()`; `agent.cancel()` only when `watchdogAction: interrupt` | memory; the notices reach stderr and the transcript |
| tiered memory for tool outputs | a surface rewrite of the session (`compaction/prune` + a replaced `tool/result`) | the durable log keeps the original; the model context keeps a pointer |

## Install

```sh
# 1. Materialize the patched engine (clones the pinned upstream commit, applies
#    patch/0001-add-dsh-host.patch, writes <state root>/bin/te and bin/te-hook).
#    It then migrates the newest 20 finished sessions automatically (--no-migrate to skip).
node scripts/bootstrap.mjs

# 2. Install this bundle into a profile
dsh plugin --profile web add link:$PWD
# then add "@nolit/dsh-tokeneconomizer" to dsh.profile.bundles in
# $DSH_HOME/profiles/web/package.json and restart that profile

# 3. Migrate every remaining session (the bootstrap pass is bounded)
node bin/te-dsh.mjs cold-start
```

`dsh plugin add` installs the package but does not compose it: the bundle must be listed in
`dsh.profile.bundles` for its patch row to be applied. `--dump-config` passing does not prove the
row mounts; check `te-dsh status` after a session and `$TOKENECONOMIZER_HOME/errors.log`.

For prior-session recall to do anything, the composition must enable the harness's own index. The
shipped base leaves it off (`path: ':memory:'`, `openAt: never`), so add one row to the profile
patch — both keys are required, because a config object is replaced whole:

```yaml
- id: session-query-sqlite
  config:
    path: /absolute/path/to/session-search.db
    openAt: startup   # or first-search
```

## Commands

```sh
node scripts/bootstrap.mjs [--source <checkout>] [--sha <commit>] [--home <state root>]
                           [--verify-only] [--no-migrate] [--migrate-limit N]
node bin/te-dsh.mjs cold-start [--dsh-home <dir>] [--limit N] [--all] [--dry-run]
                               [--reimport] [--only <repoKey>] [--include-missing]
node bin/te-dsh.mjs purge [--exports] [--state] [--all] [--dry-run] [--yes]
node bin/te-dsh.mjs status [--cwd <dir>]
node bin/te-dsh.mjs doctor
npm test
```

`cold-start` skips three things by default, and each has an override: a session this state root
already folded (`--reimport`), one that already has a record carrying turns (`--reimport`), and one
whose working directory no longer exists (`--include-missing`) — a throwaway test tree would
otherwise become a repository that never was and feed its noise into the tool-prune evidence. A
full run folds oldest-first; `--limit` folds the newest N.

`purge` removes this package's engine state and keeps the state-root directory itself. It never
touches `~/.dsh/sessions`: those are DSH's, so the injected blocks and pruned surfaces already
written into a transcript stay with DSH.

## Mode — savings off, tracking on

`mode: apply` (default) saves tokens and records evidence. `mode: observe` records the same
evidence — engine hooks, usage counters, session export — but injects nothing: no pinned rules, no
recall, no pointer substitution, no loop-guard redirect, no surface rewrite, no watchdog injection.
Disabling the savings therefore never stops the tracking, and a later re-enable has history to work
with.

The engine's own settings apply unchanged (`te config set microskills=on`, `loopguard=off`, …);
this plugin only decides whether to apply each answer (see `DEFAULTS` in `lib/index.js`).

The package imports nothing outside `node:` builtins. It never imports a harness package, so a
profile can mount it with no peer dependency, and the TokenEconomizer engine is reached only
through `child_process` (`te`, `te-hook`).

## Developer statistics (Web)

The Web client half (`lib/client.js`) adds one `settings.section` seat, `tokeneconomizer-devstats`
(order 62), which shows read-only per-turn and per-step context, cache, model and tool
measurements. The numbers come from the host route
`POST /api/local/tokeneconomizer/devstats`; the derivation rules and the DSH ledger vocabulary they
copy are in [docs/DEV-STATISTICS.md](docs/DEV-STATISTICS.md).

The card follows the DSH settings surface rules:

| Surface | Rule |
|---|---|
| Width | the section stops at `max-width: 720px` and centres itself, so it stops stretching across a wide pane |
| Headings | the section title is an `h2` and each card title an `h3`, one step above body content, sized from the DSH content-font tokens |
| Stylesheet | the stylesheet is keyed by `data-plugin-css="@nolit/dsh-tokeneconomizer"`, so the host owns it and a reload replaces it instead of stacking a second copy |
| Table | the per-turn table scrolls inside its own `280px` frame with a sticky header row, and every column header carries `scope="col"` |
| Focus and motion | every control shows a `:focus-visible` ring from the DSH focus tokens; the decorative transitions are dropped under `prefers-reduced-motion: reduce` |
| Session picker | the option label is the working directory plus the **full** session id, so two sessions in one directory are distinguishable |

The plugin's own locale files carry the display title: `locale/en.json` is
`TokenEconomizer (MS tokeneconomizer)` and `locale/ko.json` keeps the Korean title.

## Layout

```
lib/index.js        Cordis plugin: the DSH lifecycle mapping
lib/bridge.js       the process boundary: te-hook, dsh-session, dsh-import, exports
lib/repokey.js      host-local: cwd to the engine's repository key, in pure Node
lib/dedup.js        host-local: tool-result hash deduplication
lib/prefix.js       host-local: the KV-cache-safe prompt slot, its routing text and its guard
lib/watchdog.js     host-local: the loop breaker and the advisory thinking watchdog
lib/tiering.js      host-local: the turn-based tiered memory for tool outputs
lib/devstats.js     the per-turn/per-step fold of the committed session ledger
lib/devstats-server.js  the read-only host route behind the statistics card
lib/client.js       the Web half: the settings.section statistics card
bin/te-dsh.mjs      operator commands: bootstrap, cold-start, purge, status, doctor
scripts/bootstrap.mjs  pinned clone + patch + launchers + verification + bounded migration
patch/              the DSH host patch for the upstream engine (7 files, one new reader)
test/               node --test: bridge shaping, module load, package contract,
                    the host-local features, the repository-key parity, one end-to-end
                    session through a bootstrapped engine
docs/               architecture, operations, and the host-local features
```

Design rationale, the per-event contract, and the state/ledger format are in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The host-local, in-memory features are in
[docs/IN_MEMORY_FEATURES.md](docs/IN_MEMORY_FEATURES.md). Install, migration, purge, and rollback
procedures are in [docs/OPERATIONS.md](docs/OPERATIONS.md).
