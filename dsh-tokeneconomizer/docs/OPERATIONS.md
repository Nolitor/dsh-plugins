# Operations

<!-- skeleton:
version: 1.6
kind: spec
status: active
updated: 2026-11-15
summary: Bootstrap with its bounded install-time migration, profile install and FTS recall activation, guarded cold start, purge, verification, rollback, the configuration reference including the 2026-11-14 subagentMemory switch, the 2026-11-15 토큰절약기 · 환경설정 settings page and its six routes, the deprecation gate, the tree-walking check script, and the live-state rules for the DSH TokenEconomizer bridge.
-->

## 0. Rules that apply to every step

1. `~/.dsh` (profiles, sessions, credentials) and `~/.tokeneconomizer` are the user's live state.
   Nothing here writes them without the operator running the command: the bootstrap writes the
   state root only when invoked, and `--home` keeps an experiment out of the live tree.
2. `dsh plugin add` installs a package; it does not compose it. A bundle must also appear in
   `dsh.profile.bundles`, and only a real mount proves the row loaded. `--dump-config` does not.
3. Two plugins registering the same tool or route is a hard mount failure. This plugin registers
   **no tool and no model-facing route**: it only calls `tools.restrict` and `systemPrompt.context`
   on an agent's own scope. It does register **host-local routes under its own namespace**:
   one read-only route, `POST /api/local/tokeneconomizer/devstats` (`lib/devstats-server.js`),
   which serves the developer-statistics card, and the six settings routes under
   `/api/local/tokeneconomizer/settings` (§5). None of them touches another plugin's surface.
4. Never edit the engine's copy in place. The patched tree is a pinned clone under
   `$TOKENECONOMIZER_HOME/vendor/TokenEconomizer-<sha>`; `--force`-style edits there are lost on
   the next bootstrap.

## 1. Bootstrap the engine

```sh
cd dsh-tokeneconomizer
node scripts/bootstrap.mjs
```

What it does, in order: clone `https://github.com/microsoft/TokenEconomizer.git` at
`6141bb9251a7d5cccc1b97ae340c7b872108292c` (or `--source <checkout>`), apply
`patch/0001-add-dsh-host.patch`, write `bin/te` and `bin/te-hook` with mode `0700`, and run
`te --host dsh --cwd <cwd> status --json` requiring `host: dsh`.

Re-running is safe. An already-applied patch is detected with `git apply --reverse --check` and
left alone; a different HEAD is checked out back to the pin first.

Offline or air-gapped: `node scripts/bootstrap.mjs --source /path/to/TokenEconomizer`, where the
checkout already holds the pinned commit.

## 2. Install into a profile

```sh
dsh plugin --profile web add link:$PWD/dsh-tokeneconomizer
```

Then add the bundle to `$DSH_HOME/profiles/web/package.json`:

```json
"dsh": { "profile": { "bundles": [ "...", "@nolit/dsh-tokeneconomizer" ] } }
```

and restart that profile. The row is inserted by `cordis.patch.yml`
(`id: tokeneconomizer-dsh`). Verify the mount, not the config dump:

```sh
node bin/te-dsh.mjs status --cwd <repository>
```

`status` reads `te status --json` for that repository: `host: dsh`, `state`,
`toolprune.proposal`, `microskills.injected_lines`, `ledger.sessions`. A session that ran with the
plugin mounted shows up there after `agent/disposed` folds it.

## 3. Cold start (learn from sessions that already ran)

```sh
node bin/te-dsh.mjs cold-start --dry-run      # list what would be folded, write nothing
node bin/te-dsh.mjs cold-start                # oldest-first, guarded, fold the rest
node bin/te-dsh.mjs cold-start --limit 20     # newest 20 only
node bin/te-dsh.mjs cold-start --only <key>   # one repository, from the dry run
```

It walks `$DSH_HOME/sessions/<project>/<session>/session.v*.jsonl.zstd`, decompresses with Node's
`zstdDecompressSync` (Node ≥ 22.15), writes
`$TOKENECONOMIZER_HOME/dsh-sessions/<id>.jsonl`, and calls
`te --host dsh --cwd <cwd> dsh-import <export>` once per session. A log modified in the last
minute is skipped unless `--all`, because the harness may still be writing it.

`bootstrap` runs the same command for the newest 20 sessions after it verifies the launchers, so an
install already has evidence; `--no-migrate` skips that and `--migrate-limit N` changes the bound.
The bound exists because a fold may run the engine's paid proposer.

### 3.1 Three guards, and why each exists

`te dsh-import` writes the session record **before** it folds, starting from `turns: []`. A second
import of a session the engine already knows therefore erases that record, and the engine's own
`folded.json` check cannot prevent it because the check happens after the write. The migration does
the checking itself:

| Guard | Skips | Override |
|---|---|---|
| already folded | a session id present in any `repos/<key>/dsh/folded.json` | `--reimport` |
| already recorded | a session whose `sessions/<id>.json` carries turns | `--reimport` |
| working directory gone | a session whose `cwd` no longer exists — a throwaway test tree would otherwise become a repository that never was, feeding its noise into the tool-prune evidence | `--include-missing` |

Measured on one real state root: of 127 stored sessions, 68 were already folded, 2 already
recorded, 47 belonged to deleted `/tmp` trees, 1 was still being written, leaving **9 real
sessions** to migrate. A full run orders oldest-first so the evidence lands in the order it
happened; `--limit` takes the newest N instead.

Re-running a migration is therefore safe, and a disable→enable cycle needs no special handling.

The engine folds each session: micro-skills evidence, tool-prune evidence and the ledger record.
What a session taught is available from the next session start; the loop guard needs five
ended-green turns before it has a repository envelope.

`DSH_HOME` decides the source tree; `--dsh-home` overrides it; `--home` (or
`TOKENECONOMIZER_HOME`) decides where the engine state goes. Both are honored by every command.

### 3.2 Purging the engine state

```sh
node bin/te-dsh.mjs purge --all --dry-run     # plan: paths, file counts, bytes
node bin/te-dsh.mjs purge --all --yes         # delete
node bin/te-dsh.mjs purge --exports --yes     # only $TOKENECONOMIZER_HOME/dsh-sessions
```

`--state` removes the engine's per-repository state, the session records and the launchers;
`--exports` removes the decompressed session copies. The state-root directory itself stays — it is
the shell every launcher resolves against. Without `--yes` the command only prints the plan and
exits non-zero, so a typo cannot delete anything.

Two things `purge` deliberately cannot do:

- **DSH's session logs are not touched.** They belong to the harness, so the `user/message` blocks
  this plugin injected and the tool-result surfaces it rewrote stay in those transcripts.
- **The state root is emptied, not deleted** — same reason.

## 4. Configure the mechanisms

The engine's settings are the source of truth:

```sh
te --host dsh --cwd <repo> config show
te --host dsh --cwd <repo> config set microskills=on
te --host dsh --cwd <repo> config set loopguard=off
te --host dsh --cwd <repo> microskills
te --host dsh --cwd <repo> toolprune show
```

Defaults on DSH: `microskills=off`, `toolprune=auto` (read as `propose`), `loopguard=nudge`.
`microskills=on` enables the free envfacts layer plus a model proposer every
`microskills_propose_every` sessions, through `dsh --profile headless`; `envfacts` keeps it free.

This plugin's own switches (in the bundle row, or `cordis.yml`): `microskills`, `toolprune`,
`loopguard`, `hookTimeoutMs`, `cliTimeoutMs`, `headless`, and the three path overrides. They are
validated by the plugin itself (`resolveConfig`), because the package carries no schema
dependency; an unknown key or a wrong type fails the row at load.

The host-local, in-memory features have their own switches, which need neither the engine nor a
model call. **They run in every session, a delegated child included** — a child burns the same
model context and its bill lands on the parent. `subagentMemory: false` removes them from
children; the engine path (hooks, export, fold, ledger) is root-only either way. See
[ARCHITECTURE.md](ARCHITECTURE.md) §3.1.

| Switch | Default | Effect |
|---|---|---|
| `subagentMemory` | `true` | mount the in-memory switches below in a delegated child session too; `false` gives a child no economy of its own (the engine path stays root-only either way) |
| `dedup` | `true` | replace a repeated tool output with a pointer to the step that produced it |
| `dedupMinChars` | `200` | shortest output worth replacing |
| `dedupMaxEntries` | `512` | remembered digests per session |
| `pinnedRules` | `''` | immutable instruction text, mounted in the request's first message |
| `pinnedRulesOrder` | `50` | section order of the pinned rules; the lowest accepted order is `-999` |
| `loopBreaker` | `true` | stop a turn whose identical command keeps failing |
| `loopBreakerThreshold` | `3` | consecutive identical failures that trip the breaker |
| `loopBreakerWindow` | `5` | remembered calls |
| `watchdog` | `true` | interrupt a step that commits no progress; `false` arms no timer |
| `watchdogThresholdMs` | `600000` | progress-free budget of one step |
| `watchdogToolThresholdMs` | `600000` | budget of one in-flight tool call; `Infinity` disables it |
| `watchdogAction` | `interrupt` | `warn` only writes a notice |
| `watchdogProgress` | `any` | `committed` counts only committed session events as progress |

The turn-based tiered memory has its own switches. They grade old tool outputs by turn and
never touch the newest ones:

| Switch | Default | Effect |
|---|---|---|
| `tiering` | `true` | grade the session's tool outputs by turn |
| `tierHotTurns` | `6` | turns kept at full fidelity, byte-identical |
| `tierWarmTurns` | `15` | turns kept as a structural summary (head, tail, and an index of files and status codes) |
| `tierHeadChars` | `2000` | characters kept from the head of a warm-tier output |
| `tierTailChars` | `600` | characters kept from the tail of a warm-tier output |
| `tierMinChars` | `3700` | shortest output worth grading; the measured crossover is 3,045 chars, below it the warm summary is larger than the original |

`TE_DIAG=1` writes the tool-event delivery counters to `<state root>/diagnostics.json`. It is
the routing check: a route that runs its tool calls outside the harness never delivers a
`tools/result` event to this plugin, and the plugin says so at the end of such a session.

Their behavior is described in [IN_MEMORY_FEATURES.md](IN_MEMORY_FEATURES.md). Their notices go
to stderr, with the `[tokeneconomizer]` prefix, and the agent's scope carries their state, so
removing the bundle row removes them.

## 5. The settings page (토큰절약기)

The plugin registers **one** `settings.section` seat — one sidebar row for one product surface:

| Seat id | Order | Content |
|---|---|---|
| `tokeneconomizer` | 62 | a title, a one-line summary of what the plugin saved, and two internal tabs: **환경설정** (write) and **통계** (read-only) |

The tabs are internal, not second navigation rows. The section states the product name once, and
the tabs switch the two halves beneath it.

The write tab carries three mode selects, nine numeric thresholds, three actions, and a
judge-unavailable banner. The statistics tab leads with the measured saving — total characters
removed, that saving as a share of the session's context, and a per-lever breakdown — then the raw
per-turn ledger.

### 5.0 Why the section looks like the rest of the dialog

A settings section is **content only**. The host renders it inside the `.options` column of its own
panel, which already owns the width, the padding (`0 24px 24px`), and the scroll. A section that
sets its own `max-width`, centres itself, or draws bordered cards fights that frame.

Measured conventions this section follows, from DSH's `CurrentVersionRow` and from this
repository's own `dsh-custom-router` settings section:

| Concern | Convention |
|---|---|
| section column | `display:flex; flex-direction:column; gap:12px`, no width, no centring |
| title / intro | two **sibling** children, body+4px/600 and 13px tertiary |
| rows | `padding:16px 0` and a hairline `border-bottom`; the last row has none |
| tabs | `.crSettingsTab` convention: 13px secondary, `padding:7px 1px 9px`, `gap:22px`, underline drawn by `::after` on the selected tab |
| focus | `--dsw-focus-ring-*` outline with a 2px offset, never a box-shadow |
| colours | host `--dsw-alias-*` / `--dsh-*` tokens only; no literal values |

### 5.1 The six routes

| Route | Method | What it does |
|---|---|---|
| `/api/local/tokeneconomizer/settings` | GET | read: modes, thresholds (default / override / effective), mechanism status, judge status |
| `/api/local/tokeneconomizer/settings/config` | POST | batched write — one result per key |
| `/api/local/tokeneconomizer/settings/restore` | POST | undo the tool-prune restriction |
| `/api/local/tokeneconomizer/settings/reset` | POST | drop stored overrides (all thresholds, or a named subset) |
| `/api/local/tokeneconomizer/settings/import` | POST | start the history import; answers **202** plus a job id |
| `/api/local/tokeneconomizer/settings/import?jobId=<id>` | GET | the job's status, exit code and output. The id is a **query parameter**: DSH exact Fetch routes reject a `:param` path segment |

### 5.2 The mode vocabulary

| Key | Stored values | Write alias |
|---|---|---|
| `microskills` | `off`, `envfacts`, `envfacts+distiller`, `distiller` | `on` → `envfacts+distiller` |
| `toolprune` | `off`, `propose`, `auto` | `on` → `auto` |
| `loopguard` | `off`, `nudge`, `stop` | `on` → `nudge` |

`on` is a **write alias, never a stored value**. The engine stores the resolved value.

### 5.3 The nine thresholds

`microskills_propose_every`, `toolprune_evidence`, `toolprune_min_sessions`,
`toolprune_sessions`, `toolprune_quiet_minutes`, `loopguard.envelope_min_samples`,
`loopguard.judge_confidence`, `loopguard_nudges`, `loopguard.backstop_mult`.

Each has its own per-key reset, and the page distinguishes the engine **default** from a stored
**override** from the **effective** value.

### 5.4 Engine writes go through the process boundary

Every write goes through `child_process` — `te config set`, `te config unset`, `te config restore` —
and **never** a direct file write into the engine's state. Every write **re-reads `te config show`
before responding**: the answer carries the persisted value, never the posted one. A key the engine
did not persist comes back as `ok: false`.

### 5.5 The `history_import` action

`history_import` is a **plugin-owned action, not an engine config key** — a whole-engine grep finds
zero hits for it. It maps to:

```sh
node bin/te-dsh.mjs cold-start
```

The import route spawns that command with a validated argument allow-list (`--all`, `--dry-run`,
`--reimport`, `--include-missing`, `--dsh-home`, `--limit`, `--only`) and answers `202` with a job
id; poll `GET /settings/import/:jobId` for the outcome. The same migration and its three guards are
described in §3.

### 5.6 The judge-unavailable banner

The banner appears when the engine's loop-guard judge cannot be reached. In the measured
deployment it always appears: `~/.tokeneconomizer/errors.log` ends with
`sidecall dsh: no reply (exit 1) dsh: ACCOUNT_SIGN_IN_REQUIRED`. The guard still fires on the
judge-independent strict heuristic, and its decision is marked degraded in the record.

## 6. Verify and diagnose

```sh
node bin/te-dsh.mjs doctor                 # launchers, vendored tree, HEAD, live check
node bin/te-dsh.mjs status --cwd <repo>    # what the engine knows about this repository
npm test                                   # 236 tests, one needs TE_DSH_TEST_HOME
TE_DSH_TEST_HOME=$TOKENECONOMIZER_HOME npm test  # includes the end-to-end session
npm run check                              # syntax-check every module under lib/, bin/, scripts/
npm run audit:deprecations                 # the deprecation gate
(cd "$TOKENECONOMIZER_HOME/vendor/TokenEconomizer-<sha>" && python3 -m unittest tests.test_dsh_trace)
```

### 6.1 `npm run check`

The check script **walks** `lib/`, `bin/` and `scripts/` instead of naming each file. The old
hardcoded 12-file list silently skipped new modules — `identity.js`, `repokey-bridge.js` and
`probes.js` were all added unchecked. A new module is checked the moment it exists.

It reports `check: <N> module(s) parse` and exits non-zero on the first failing file.

### 6.2 `npm run audit:deprecations`

The deprecation gate reads the installed DSH type declarations and checks a declared list of
consumed seams. It is read-only: it never writes to the install or the workspace.

| Exit code | Meaning |
|---|---|
| `0` | every seam is present and none is newly deprecated |
| `1` | a consumed seam is missing, or deprecated while `allowDeprecated` is false |
| `2` | the DSH install root cannot be found |

Two seams carry `allowDeprecated: true` — `session.eventAt` and `session.snapshotEvents` — because
**no replacement reader exists in 0.2.2-rc.3** and the full durable log needs the shadowed events
too. Each allowed deprecation is printed with its justification, and the FAIL branch still bites for
every other seam. The two-line warning is the intended state, not a defect to silence. The
rationale is in [ARCHITECTURE.md](ARCHITECTURE.md) §3.4.

Failure signals:

| Symptom | Where to look |
|---|---|
| no facts, no proposal | `te-dsh status` shows 0 sessions: the fold never ran (`agent/disposed` not reached, or the engine missing) |
| facts learned but none injected | `microskills` is `off`, or the next session's brief failed (`errors.log`) |
| `errors.log` traceback | engine bug or unreadable state; the session itself was unaffected |
| proposal never forms | catalog missing (`hosts/dsh/catalog.json`) or fewer than 5 sessions / 10 prompts |
| `priced_by: fallback` | expected for DSH model ids; the engine's price table does not carry them yet |

## 7. Rollback

1. Remove `"@nolit/dsh-tokeneconomizer"` from `dsh.profile.bundles` and restart the profile — the
   in-memory tool mask, the injected facts and every listener disappear with the plugin.
2. `dsh plugin --profile web remove @nolit/dsh-tokeneconomizer`.
3. The engine is independent of the plugin: `$TOKENECONOMIZER_HOME` keeps what was learned.
   Removing the state root forgets it; nothing else references the vendor tree.
4. The patch touches only the vendored clone. Upstream, every other agent's integration, and the
   user's repositories are unchanged.

## 8. Live-state note for experiments

Use an isolated home for anything experimental:

```sh
node scripts/bootstrap.mjs --home /tmp/te-probe
DSH_HOME=/tmp/dsh-probe TOKENECONOMIZER_HOME=/tmp/te-probe node bin/te-dsh.mjs cold-start --all
```

`cold-start` passes the same home to `te dsh-import`; a mismatch here would write the live state
from a probe run, which is why the flag is threaded through `--home` and not left to the
environment.
