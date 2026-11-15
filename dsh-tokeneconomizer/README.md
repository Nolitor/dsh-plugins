# @nolit/dsh-tokeneconomizer

<!-- skeleton:
version: 1.7
kind: readme
status: active
updated: 2026-11-15
summary: DSH 0.2.2 bridge for microsoft/TokenEconomizer: lifecycle mapping, in-memory tool mask, DSH trace reader, guarded migration, prior-session recall through the harness index, host-local in-memory features, plugin-record attribution, the agent/pre-step tiering trigger, and the Web developer-statistics and settings pages, the embedded engine's version and upstream check, and the side-call model slots.
-->

Version `0.0.1-rc.8`.

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
node bin/dsh-te.mjs cold-start
```

`dsh plugin add` installs the package but does not compose it: the bundle must be listed in
`dsh.profile.bundles` for its patch row to be applied. `--dump-config` passing does not prove the
row mounts; check `dsh-te status` after a session and `$TOKENECONOMIZER_HOME/errors.log`.

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
node bin/dsh-te.mjs cold-start [--dsh-home <dir>] [--limit N] [--all] [--dry-run]
                               [--reimport] [--only <repoKey>] [--include-missing]
node bin/dsh-te.mjs purge [--exports] [--state] [--all] [--dry-run] [--yes]
node bin/dsh-te.mjs status [--cwd <dir>]
node bin/dsh-te.mjs doctor
npm test
npm run check                  # syntax-check every module under lib/, bin/, scripts/
npm run audit:deprecations     # the deprecation gate over the consumed DSH seams
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

## Settings (Web) — one row, two tabs

The Web client half (`lib/client.js`) registers **one** `settings.section` seat, `tokeneconomizer`
(order 62). One navigation row for one product surface; the two halves are internal tabs:

| Tab | Content |
|---|---|
| **환경설정** | the embedded engine's version and pinned commit, an **upstream version check** button, three mode selects, the **side-call model slots**, the nine engine thresholds (default / override / effective, with a per-key reset), `toolprune restore`, reset-to-defaults, history import, and a judge-unavailable banner |
| **통계** | what the plugin actually saved — total characters removed, that saving as a share of the session context, and a per-lever breakdown — then the read-only per-turn ledger |

The section states the product name once and shows a one-line saving summary above the tabs, so the
value is visible before choosing a tab.

### The embedded engine and the upstream check

The engine this plugin runs is **not vendored in this package**: `scripts/bootstrap.mjs` clones
one pinned upstream commit (`6141bb92`) into the TokenEconomizer state root, applies this
package's patch, and writes two launchers. The engine carries **no version string of its own**
— no `__version__`, no `VERSION` file, and `te --version` is not a valid invocation — so its
version on the page is the one upstream publishes for that commit.

**TWO VERSIONS, NAMED SO THEY CANNOT BE CONFUSED.** The card shows the **plugin's** own
version (`0.0.1-rc.N`, read from its manifest) and the **upstream engine's** version (an
upstream tag plus a commit distance) under separate labels. A card that shows only the
upstream tag reads as "the plugin is v0.1.0", which is false: the tag belongs to
`microsoft/TokenEconomizer`, and this plugin's release line is `0.0.1-rc.N`.

The **업스트림 버전 확인 / Check upstream version** button compares the pin with the upstream
branch head, the latest release, the commit distance and the changed files. An unreachable
network answers "could not check" with the reason; it never answers "out of date", because an
update that turns out to be a network problem teaches the reader to ignore the button.

### The side-call model slots

The Micro-skills proposer and the Loop Guard judge are the two LLM calls the engine makes per
session, and both ran on the deployment's own route. Each may now name its own model:

| Slot | Engine config key |
|---|---|
| 기본 모델 / Default model | *(none — the deployment's own route; stated, not offered)* |
| Micro-skills 제안기 모델 | `microskills_model` |
| Loop Guard 판정기 모델 | `loopguard_model` |

The value is a **`provider/model`** pair (`deepseek-account/deepseek-flash`), because DSH routes
by provider and a model id alone belongs to one. The dropdown lists the **host's own registered
provider/model pairs**, so it names only routes this deployment can actually take. The model
reaches the call through the engine's `--patch` overlay, so it applies to **that side call
only**.

### Host integration

A settings section is **content only**. The host renders it inside the `.options` column of its own
panel, and that column already owns the width, the `0 24px 24px` padding, and the scroll. Measured
conventions this section follows, taken from DSH's own `CurrentVersionRow` and from this
repository's `dsh-custom-router` settings section:

| Surface | Rule |
|---|---|
| Width | **none.** The section sets no `max-width` and does not centre itself; the host column owns both |
| Rows | `padding: 16px 0` with a hairline `border-bottom`, no fill and no radius; the last row has none |
| Headings | title and intro are **sibling** children, body+4px/600 and 13px tertiary, both from the DSH content-font tokens |
| Tabs | the `.crSettingsTab` convention: 13px secondary, `padding: 7px 1px 9px`, `gap: 22px`, a 2px underline drawn by `::after` on the selected tab, `role="tablist"` with roving `tabindex` and Arrow/Home/End keys |
| Stylesheet | keyed by `data-plugin-css="@nolit/dsh-tokeneconomizer"`, so the host owns it and a reload replaces it instead of stacking a second copy |
| Colours | host `--dsw-alias-*` / `--dsh-*` tokens only; no literal colour or fixed pixel size |
| Focus and motion | `:focus-visible` from the DSH focus tokens; decorative transitions dropped under `prefers-reduced-motion: reduce` |
| Table | the per-turn table scrolls inside its own `280px` frame with a sticky header, and every column header carries `scope="col"` |

The plugin's own locale files carry the display title: `locale/en.json` is
`TokenEconomizer (MS tokeneconomizer)` and `locale/ko.json` keeps the Korean title.

### Control vocabulary

| Control | Values |
|---|---|
| `microskills` | `off` / `envfacts` / `envfacts+distiller` / `distiller` |
| `toolprune` | `off` / `propose` / `auto` |
| `loopguard` | `off` / `nudge` / `stop` |
| nine numeric thresholds | each with a default, an override, an effective value, and a per-key reset |
| actions | `toolprune restore`, reset-to-defaults, history import |

`on` is a **write alias** (`microskills` → `envfacts+distiller`, `toolprune` → `auto`,
`loopguard` → `nudge`), never a stored value.

`on` is a **write alias, never a stored value**. `history_import` is a plugin-owned action, not an
engine key — it maps to `bin/dsh-te.mjs cold-start`.

Eight routes under `/api/local/tokeneconomizer/settings`: `GET /settings`,
`POST /settings/config` (batched, per-key results), `POST /settings/restore`,
`POST /settings/reset`, `POST /settings/import` (202 + job id), `GET /settings/import/:jobId`,
`GET /settings/upstream-check`, `GET /settings/models`.

Engine writes go through the `child_process` boundary (`te config set`) — never a direct file write
— and every write re-reads `te config show` before answering, so the page shows the persisted
value rather than the posted one. The full description is in
[docs/OPERATIONS.md](docs/OPERATIONS.md) §5.

## Layout

```
lib/index.js        Cordis plugin: the DSH lifecycle mapping
lib/identity.js     the two-value project identity: projectDir (immutable) vs liveDir
lib/repokey-bridge.js  the legacy engine repo key, isolated behind one bridge (UNVERIFIABLE)
lib/probes.js       the capability-probe catalog: seven DSH seams, contract vs internal tier
lib/attribution.js  the record layer: plugin:tokeneconomizer/* records
lib/rewriter.js     surface composition: the prune payload and the replacement
lib/surface-attribution.js  the paired write: applyRewrite (validate -> decide -> prune -> replace -> record)
lib/settings-contract.js  the browser-safe frozen settings contract (zero imports)
lib/settings-api.js  the eight settings routes
lib/bridge.js       the process boundary: te-hook, dsh-session, dsh-import, exports
lib/repokey.js      host-local: cwd to the engine's repository key, in pure Node
lib/dedup.js        host-local: tool-result hash deduplication
lib/prefix.js       host-local: the KV-cache-safe prompt slot, its routing text and its guard
lib/watchdog.js     host-local: the loop breaker and the advisory thinking watchdog
lib/tiering.js      host-local: the tiered memory policy, its trigger and its decision records
lib/devstats.js     the per-turn/per-step fold of the committed session ledger
lib/devstats-server.js  the read-only host route behind the statistics card
lib/settings.js     the external settings file, merged on top of the Cordis config
lib/client.js       the Web half: one settings row with two internal tabs
lib/upstream.js     the embedded engine's identity and the upstream comparison
lib/types/records.d.ts  the PluginRecordMap augmentation for the three record types
bin/dsh-te.mjs      operator commands: bootstrap, cold-start, purge, status, doctor
scripts/bootstrap.mjs  pinned clone + patch + launchers + verification + bounded migration
scripts/audit-deprecations.mjs  the deprecation gate over the consumed DSH seams
scripts/check-syntax.mjs  syntax-checks every module under lib/, bin/, scripts/
patch/              the DSH host patch for the upstream engine (7 files, one new reader)
test/               node --test: bridge shaping, module load, package contract,
                    the host-local features, the repository-key parity, the attribution
                    and identity layers, one end-to-end session through a bootstrapped engine
docs/               architecture, operations, the host-local features, and the
                    DSH schema implementation record
```

Design rationale, the per-event contract, the attribution record layer, and the state/ledger format
are in [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md). The host-local, in-memory features are in
[docs/IN_MEMORY_FEATURES.md](docs/IN_MEMORY_FEATURES.md). Install, migration, purge, the settings
page, and rollback procedures are in [docs/OPERATIONS.md](docs/OPERATIONS.md). The implementation
record for the DSH schema alignment is in
[docs/DSH-SCHEMA-IMPLEMENTATION.md](docs/DSH-SCHEMA-IMPLEMENTATION.md).
